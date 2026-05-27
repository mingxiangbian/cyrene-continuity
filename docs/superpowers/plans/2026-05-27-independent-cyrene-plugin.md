# Independent Cyrene Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `cyrene-continuity` 做成可由 Codex plugin 自己提供 MCP runtime 的独立 plugin，并把 hook/automation 迁到稳定 shim。

**Architecture:** plugin 内新增 `.mcp.json` 和 `plugin/runtime/cyrene-continuity.mjs` bundle；Codex Stop hook 和 Dream automation 使用 `~/.cyrene/codex/bin/cyrene-continuity` stable shim。repo-local `npm --prefix ... run dev` 只保留为开发入口，doctor 把旧手写 MCP 识别为需要禁用的冲突入口。

**Tech Stack:** TypeScript, Node.js ESM, esbuild, Vitest, Codex plugin manifest, MCP SDK.

---

### Task 1: Plugin Manifest And Bundled Runtime

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `plugin/.codex-plugin/plugin.json`
- Create: `plugin/.mcp.json`
- Create: `scripts/build-plugin.mjs`
- Test: `tests/plugin-runtime.test.ts`
- Test: `tests/mcp-server.test.ts`

- [x] **Step 1: Write failing plugin manifest/runtime tests**

Add `tests/plugin-runtime.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('plugin runtime package', () => {
  it('declares a plugin MCP server named cyrene-continuity', async () => {
    const manifest = JSON.parse(await readFile('plugin/.codex-plugin/plugin.json', 'utf8'))
    const mcp = JSON.parse(await readFile('plugin/.mcp.json', 'utf8'))

    expect(manifest.name).toBe('cyrene-continuity')
    expect(manifest.skills).toBe('./skills/')
    expect(manifest.mcpServers).toBe('./.mcp.json')
    expect(manifest).not.toHaveProperty('schema_version')
    expect(mcp.mcpServers['cyrene-continuity']).toMatchObject({
      command: 'node',
      args: ['./runtime/cyrene-continuity.mjs', 'mcp-server', '--stdio'],
      cwd: '.'
    })
  })

  it('builds a standalone plugin runtime bundle', async () => {
    await execFileAsync('npm', ['run', 'build:plugin'])

    const runtimePath = join(process.cwd(), 'plugin', 'runtime', 'cyrene-continuity.mjs')
    const stats = await stat(runtimePath)
    const source = await readFile(runtimePath, 'utf8')
    expect(stats.isFile()).toBe(true)
    expect(source.startsWith('#!/usr/bin/env node')).toBe(true)
    expect(source).toContain('cyrene_continuity_get')
    expect(source).not.toContain("from '@modelcontextprotocol/sdk")
  })
})
```

Extend `tests/mcp-server.test.ts` with a smoke test that runs the built plugin runtime:

```ts
it('exposes MCP tools from the built plugin runtime', async () => {
  await execFileAsync('npm', ['run', 'build:plugin'], { env: cliEnv() })
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  const client = new Client({ name: 'cyrene-plugin-mcp-test', version: '0.0.0' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['plugin/runtime/cyrene-continuity.mjs', 'mcp-server', '--stdio'],
    env: cliEnv()
  })

  await client.connect(transport)
  try {
    const result = await client.listTools()
    const names = result.tools.map((tool) => tool.name)
    expect(names).toContain('cyrene_continuity_get')
    expect(names).toContain('cyrene_memory_pending_list')
    expect(names).toContain('cyrene_memory_dream_run')
    expect(names).toContain('cyrene_memory_profile_get')
  } finally {
    await client.close()
  }
})
```

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
npx vitest run tests/plugin-runtime.test.ts tests/mcp-server.test.ts --testNamePattern "plugin runtime|built plugin runtime"
```

Expected: fail because `plugin/.mcp.json`, `npm run build:plugin`, and `plugin/runtime/cyrene-continuity.mjs` do not exist.

- [x] **Step 3: Implement manifest, `.mcp.json`, and build script**

Update `plugin/.codex-plugin/plugin.json` to the validator-compatible shape:

```json
{
  "name": "cyrene-continuity",
  "version": "0.1.0",
  "description": "Cyrene continuity MCP, Codex skill, and local memory bridge.",
  "author": {
    "name": "Local developer"
  },
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "Cyrene Continuity",
    "shortDescription": "Project memory and continuity tools for Codex.",
    "longDescription": "Cyrene Continuity provides a local Codex MCP server, memory review tools, and a continuity skill backed by ~/.cyrene/codex memory.",
    "developerName": "Local developer",
    "category": "Productivity",
    "capabilities": ["MCP", "Memory"],
    "defaultPrompt": [
      "Use Cyrene continuity for this project.",
      "Review pending Cyrene memory candidates.",
      "Run a Cyrene memory dream pass."
    ],
    "brandColor": "#2563EB",
    "screenshots": []
  }
}
```

Create `plugin/.mcp.json`:

```json
{
  "mcpServers": {
    "cyrene-continuity": {
      "command": "node",
      "args": ["./runtime/cyrene-continuity.mjs", "mcp-server", "--stdio"],
      "cwd": "."
    }
  }
}
```

Add `build:plugin` to `package.json`:

```json
"build:plugin": "node scripts/build-plugin.mjs"
```

Add `esbuild` as a dev dependency.

Create `scripts/build-plugin.mjs`:

```js
#!/usr/bin/env node
import { chmod, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'

const outfile = resolve('plugin/runtime/cyrene-continuity.mjs')

await mkdir(dirname(outfile), { recursive: true })
await build({
  entryPoints: ['src/main.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: false,
  logLevel: 'info'
})
await chmod(outfile, 0o755)
```

- [x] **Step 4: Run tests to verify GREEN**

Run:

```bash
npx vitest run tests/plugin-runtime.test.ts tests/mcp-server.test.ts --testNamePattern "plugin runtime|built plugin runtime"
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: plugin runtime tests pass, built MCP runtime lists `cyrene_*` tools, plugin validator passes.

### Task 2: Stable Shim And `codex install --plugin`

**Files:**
- Create: `src/codex/stable-shim.ts`
- Modify: `src/codex/codex-install.ts`
- Modify: `src/codex/codex-cli.ts`
- Modify: `src/main.ts`
- Test: `tests/codex-cli.test.ts`

- [x] **Step 1: Write failing install/shim tests**

Add tests to `tests/codex-cli.test.ts`:

```ts
it('install --plugin writes a stable shim that points at the plugin runtime', async () => {
  const home = await createTempDir('cyrene-codex-plugin-install-home-')
  await execFileAsync('npm', ['run', 'build:plugin'], { env: cliEnv(home) })

  const result = await execFileAsync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--plugin'],
    { env: cliEnv(home) }
  )

  const shimPath = join(home, '.cyrene', 'codex', 'bin', 'cyrene-continuity')
  const shim = await readFile(shimPath, 'utf8')
  expect(result.stderr).toBe('')
  expect(result.stdout).toContain('Cyrene Codex plugin bridge installed.')
  expect(result.stdout).toContain(shimPath)
  expect(result.stdout).toContain('Disable or remove manual Cyrene MCP config')
  expect(shim).toContain('plugin/runtime/cyrene-continuity.mjs')
  expect(shim).toContain('exec node "$runtime" "$@"')
})

it('install --plugin refuses to write a shim when the plugin runtime has not been built', async () => {
  const home = await createTempDir('cyrene-codex-plugin-install-missing-runtime-home-')

  await expect(
    execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--plugin'],
      { env: cliEnv(home) }
    )
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining('Cyrene plugin runtime is missing')
  })
})
```

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
npx vitest run tests/codex-cli.test.ts --testNamePattern "install --plugin"
```

Expected: fail because `install --plugin` is not implemented.

- [x] **Step 3: Implement stable shim and install command**

Create `src/codex/stable-shim.ts`:

```ts
import { access, chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { codexGlobalRoot } from './codex-memory-root.js'

export function codexStableBinRoot(): string {
  return resolve(codexGlobalRoot(), 'bin')
}

export function codexStableExecutablePath(): string {
  return resolve(codexStableBinRoot(), 'cyrene-continuity')
}

export async function assertRuntimeExists(runtimePath: string): Promise<void> {
  try {
    await access(runtimePath)
  } catch {
    throw new Error(`Cyrene plugin runtime is missing: ${runtimePath}`)
  }
}

export async function writeCodexStableShim(runtimePath: string): Promise<string> {
  await assertRuntimeExists(runtimePath)
  const shimPath = codexStableExecutablePath()
  await mkdir(dirname(shimPath), { recursive: true })
  await writeFile(shimPath, formatStableShim(runtimePath), 'utf8')
  await chmod(shimPath, 0o755)
  return shimPath
}

export function formatStableShim(runtimePath: string): string {
  return [
    '#!/bin/sh',
    'set -eu',
    `runtime=${shellQuote(runtimePath)}`,
    'if [ ! -f "$runtime" ]; then',
    '  echo "Cyrene plugin runtime is missing: $runtime" >&2',
    '  echo "Reinstall the cyrene-continuity Codex plugin or run cyrene-continuity codex install --plugin." >&2',
    '  exit 1',
    'fi',
    'exec node "$runtime" "$@"',
    ''
  ].join('\n')
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
```

Extend `src/codex/codex-install.ts`:

```ts
export async function installCodexPluginBridge(input: { runtimeEntryPath: string }): Promise<string> {
  const runtimePath = resolvePluginRuntimePath(input.runtimeEntryPath)
  const shimPath = await writeCodexStableShim(runtimePath)
  await mkdir(codexGlobalRoot(), { recursive: true })
  await writeFile(join(codexGlobalRoot(), '.keep'), 'created by cyrene-continuity codex install --plugin\n', 'utf8')
  return [
    'Cyrene Codex plugin bridge installed.',
    '',
    `shim: ${shimPath} -> ${runtimePath}`,
    '',
    'Disable or remove manual Cyrene MCP config from ~/.codex/config.toml after verifying plugin MCP in a new Codex thread.',
    'Use the Codex plugin UI to reinstall or refresh cyrene-continuity so .mcp.json is picked up.',
    ''
  ].join('\n')
}

export function resolvePluginRuntimePath(runtimeEntryPath: string): string {
  const entry = resolve(runtimeEntryPath)
  if (entry.endsWith('/src/main.ts') || entry.endsWith('/src/main.js')) {
    return resolve(dirname(entry), '..', 'plugin', 'runtime', 'cyrene-continuity.mjs')
  }
  return entry
}
```

Update `src/main.ts` to pass `runtimeEntryPath: fileURLToPath(import.meta.url)` into `handleCodexCommand`.

Update `src/codex/codex-cli.ts` to route `codex install --plugin` to `installCodexPluginBridge`.

- [x] **Step 4: Run tests to verify GREEN**

Run:

```bash
npx vitest run tests/codex-cli.test.ts --testNamePattern "install --plugin"
```

Expected: both install plugin tests pass.

### Task 3: Hook Installer Uses Stable Shim

**Files:**
- Modify: `src/codex/codex-hook-install.ts`
- Test: `tests/codex-hook-install.test.ts`
- Test: `tests/codex-cli.test.ts`

- [x] **Step 1: Write/update failing hook tests**

Update `tests/codex-hook-install.test.ts`:

```ts
it('uses the stable shim command for the Stop hook', () => {
  const command = codexStopHookCommand()

  expect(command).toContain('.cyrene/codex/bin/cyrene-continuity')
  expect(command).toContain('codex hook stop')
  expect(command).not.toContain('npm --prefix')
  expect(command).not.toContain('run --silent dev')
})
```

Update existing expectations that previously required repo-local `npm --prefix`.

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
npx vitest run tests/codex-hook-install.test.ts tests/codex-cli.test.ts --testNamePattern "Stop hook|install-hook"
```

Expected: fail because `codexStopHookCommand()` still returns repo-local command.

- [x] **Step 3: Implement stable shim hook command**

Change `src/codex/codex-hook-install.ts`:

```ts
import { codexStableExecutablePath, shellQuote } from './stable-shim.js'

export function codexStopHookCommand(): string {
  return [codexStableExecutablePath(), 'codex', 'hook', 'stop'].map(shellQuote).join(' ')
}
```

Keep `isCyreneStopHookCommand()` broad enough to remove old repo-local Cyrene commands and the new shim command during idempotent merge.

- [x] **Step 4: Run tests to verify GREEN**

Run:

```bash
npx vitest run tests/codex-hook-install.test.ts tests/codex-cli.test.ts --testNamePattern "Stop hook|install-hook"
```

Expected: hook tests pass and installed hook uses stable shim.

### Task 4: Doctor Detects Plugin/Shim And Old Manual MCP

**Files:**
- Modify: `src/codex/codex-doctor.ts`
- Test: `tests/codex-cli.test.ts`

- [x] **Step 1: Write failing doctor tests**

Add or update tests in `tests/codex-cli.test.ts`:

```ts
it('doctor reports plugin MCP and shim state', async () => {
  const home = await createTempDir('cyrene-codex-cli-plugin-doctor-home-')
  const configPath = join(home, '.codex-config.toml')
  await writeFile(configPath, '')
  await execFileAsync('npm', ['run', 'build:plugin'], { env: cliEnv(home) })
  await execFileAsync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--plugin'],
    { env: cliEnv(home) }
  )

  const result = await execFileAsync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
    { env: cliEnv(home) }
  )

  expect(result.stderr).toBe('')
  expect(result.stdout).toContain('plugin mcp: present')
  expect(result.stdout).toContain('stable shim: configured')
  expect(result.stdout).toContain('manual mcp: absent')
  expect(result.stdout).toContain('status: ready')
})

it('doctor marks an enabled manual Cyrene MCP as a conflict after plugin install', async () => {
  const home = await createTempDir('cyrene-codex-cli-plugin-doctor-conflict-home-')
  const configPath = join(home, '.codex-config.toml')
  await writeFile(
    configPath,
    [
      '[mcp_servers.cyrene]',
      ...currentRepoMcpConfigLines(),
      'enabled = true'
    ].join('\n')
  )
  await execFileAsync('npm', ['run', 'build:plugin'], { env: cliEnv(home) })
  await execFileAsync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--plugin'],
    { env: cliEnv(home) }
  )

  const result = await execFileAsync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
    { env: cliEnv(home) }
  )

  expect(result.stderr).toBe('')
  expect(result.stdout).toContain('manual mcp: enabled')
  expect(result.stdout).toContain('status: not ready')
  expect(result.stdout).toContain('action: disable or remove manual Cyrene MCP config')
})
```

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
npx vitest run tests/codex-cli.test.ts --testNamePattern "doctor reports plugin MCP|manual Cyrene MCP"
```

Expected: fail because doctor has no plugin/shim/manual conflict model yet.

- [x] **Step 3: Implement doctor state**

Update `src/codex/codex-doctor.ts`:

- Read `plugin/.mcp.json` relative to current repo when running from source.
- Report:
  - `plugin mcp: present|missing`
  - `stable shim: configured|missing`
  - `cyrene-continuity mcp: configured|missing`
  - `manual mcp: enabled|absent`
- Treat enabled manual Cyrene MCP as not ready once plugin MCP exists.
- Keep `agentmemory` blocking behavior.
- Keep Stop hook advisory behavior.

Use `codexStableExecutablePath()` and `pathExists()` for shim state.

- [x] **Step 4: Run tests to verify GREEN**

Run:

```bash
npx vitest run tests/codex-cli.test.ts --testNamePattern "doctor"
```

Expected: doctor tests pass with the new plugin/shim model.

### Task 5: Current Automation/Hook Migration

**Files:**
- External: `/Users/phoenix/.codex/hooks.json`
- External automation: `cyrene-memory-dream-deep`

- [x] **Step 1: Build plugin runtime and install shim/hook**

Run:

```bash
npm run build:plugin
npm run dev -- codex install --plugin
npm run dev -- codex install-hook --stop
```

Expected: `~/.cyrene/codex/bin/cyrene-continuity` exists and `/Users/phoenix/.codex/hooks.json` uses the stable shim command.

- [x] **Step 2: Update Dream Deep automation to use stable shim**

Use `codex_app.automation_update` for automation id `cyrene-memory-dream-deep`, preserving its cadence/model/workspace fields, and change only the prompt command to:

```bash
/Users/phoenix/.cyrene/codex/bin/cyrene-continuity codex memory dream --stage deep
```

Expected: automation no longer instructs Codex to run `npm run dev` from the repo.

- [x] **Step 3: Do not disable manual MCP automatically**

Leave `~/.codex/config.toml` unchanged in this task. The original MCP should be disabled only after plugin MCP is installed and verified in a new Codex thread, because this current thread still depends on the old MCP.

### Task 6: Final Verification

**Files:**
- All modified source, tests, plugin files, and plan/spec docs.

- [x] **Step 1: Run plugin validation**

Run:

```bash
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: validation passes.

- [x] **Step 2: Run targeted tests**

Run:

```bash
npx vitest run tests/plugin-runtime.test.ts tests/mcp-server.test.ts tests/codex-cli.test.ts tests/codex-hook-install.test.ts
```

Expected: targeted tests pass.

- [x] **Step 3: Run full verification**

Run:

```bash
npm test
npm run typecheck
```

Expected: all tests and typecheck pass.

- [x] **Step 4: Run runtime smoke checks**

Run:

```bash
npm run build:plugin
/Users/phoenix/.cyrene/codex/bin/cyrene-continuity codex doctor
/Users/phoenix/.cyrene/codex/bin/cyrene-continuity codex memory dream --stage light
```

Expected: shim command can invoke the bundled runtime; doctor reports plugin MCP and stable shim; memory dream light returns JSON without source changes.
