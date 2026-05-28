import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import type { CyreneMemory, PendingMemory } from '../src/memory/types.js'

const execFileAsync = promisify(execFile)
const originalHome = process.env.HOME
const tempDirs: string[] = []

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function cliEnv(home: string): NodeJS.ProcessEnv {
  const { FORCE_COLOR: _forceColor, NO_COLOR: _noColor, ...env } = process.env
  return { ...env, HOME: home, CYRENE_MEMORY_AUTO_EXTRACT: '0' }
}

function currentRepoMcpConfigLines(): string[] {
  return [
    'command = "npm"',
    `args = ["--prefix", ${JSON.stringify(process.cwd())}, "run", "--silent", "dev", "--", "mcp-server", "--stdio"]`
  ]
}

function createPending(): PendingMemory {
  return {
    id: 'cli-pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'CLI dream promotes repeated pending memory.',
    normalizedKey: 'cli-dream-promotes-pending',
    evidence: [
      { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
      { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
    ],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 2,
    firstSeenAt: '2026-05-25T00:00:00.000Z',
    lastSeenAt: '2026-05-25T01:00:00.000Z',
    expiresAt: '2026-06-24T00:00:00.000Z',
    tags: ['cli']
  }
}

function createActive(): CyreneMemory {
  return {
    id: 'cli-active-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'CLI maintenance renders active memory into the model profile.',
    normalizedKey: 'cli-maintenance-renders-profile',
    evidence: [{ runId: 'run-active', sourceKind: 'user_explicit', summary: 'Active seed.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    tags: ['cli']
  }
}

describe('cyrene-continuity codex CLI', () => {
  it('doctor rejects --config without a path', async () => {
    const home = await createTempDir('cyrene-codex-cli-config-missing-home-')

    await expect(
      execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config'],
        { env: cliEnv(home) }
      )
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Invalid doctor config path: missing value')
    })
  })

  it('doctor rejects --config= without a path', async () => {
    const home = await createTempDir('cyrene-codex-cli-config-empty-home-')

    await expect(
      execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config='],
        { env: cliEnv(home) }
      )
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Invalid doctor config path: missing value')
    })
  })

  it('doctor reports agentmemory as not ready when configured', async () => {
    const home = await createTempDir('cyrene-codex-cli-home-')
    await writeFile(
      join(home, '.codex-config.toml'),
      [
        '[mcp_servers.agentmemory]',
        'command = "npx"',
        'args = ["-y", "@agentmemory/mcp"]',
        '',
        '[mcp_servers.cyrene]',
        ...currentRepoMcpConfigLines()
      ].join('\n')
    )

    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        'codex',
        'doctor',
        '--config',
        join(home, '.codex-config.toml')
      ],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Cyrene Codex Doctor')
    expect(result.stdout).toContain('cyrene-continuity mcp: configured')
    expect(result.stdout).toContain('mcp command:')
    expect(result.stdout).toContain('npm')
    expect(result.stdout).toContain('--prefix')
    expect(result.stdout).toContain(process.cwd())
    expect(result.stdout).toContain('mcp-server')
    expect(result.stdout).toContain('--stdio')
    expect(result.stdout).toContain('mcp command freshness: current repo')
    expect(result.stdout).toContain('agentmemory: enabled')
    expect(result.stdout).toContain('status: not ready')
  })

  it('doctor is not ready until the Cyrene skill is registered', async () => {
    const home = await createTempDir('cyrene-codex-cli-no-skill-home-')
    await writeFile(
      join(home, '.codex-config.toml'),
      [
        '[mcp_servers.cyrene]',
        ...currentRepoMcpConfigLines(),
        'enabled = true'
      ].join('\n')
    )

    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        'codex',
        'doctor',
        '--config',
        join(home, '.codex-config.toml')
      ],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('cyrene-continuity mcp: configured')
    expect(result.stdout).toContain('agentmemory: disabled')
    expect(result.stdout).toContain('cyrene-continuity: missing')
    expect(result.stdout).toContain('status: not ready')
    expect(result.stdout).toContain('action: run npm --prefix')
    expect(result.stdout).toContain(process.cwd())
    expect(result.stdout).toContain('run --silent dev -- codex install --dev')
  })

  it('doctor reads the cyrene-continuity manual MCP config name', async () => {
    const home = await createTempDir('cyrene-codex-cli-named-mcp-home-')
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers."cyrene-continuity"]',
        ...currentRepoMcpConfigLines(),
        'enabled = true'
      ].join('\n')
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('cyrene-continuity mcp: configured')
    expect(result.stdout).toContain('manual mcp: enabled')
    expect(result.stdout).toContain('mcp command freshness: current repo')
  })

  it('doctor reports ready after the skill is installed and agentmemory is disabled', async () => {
    const home = await createTempDir('cyrene-codex-cli-ready-home-')
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene]',
        ...currentRepoMcpConfigLines(),
        'enabled = true',
        '',
        '[mcp_servers.agentmemory]',
        'command = "npx"',
        'args = ["-y", "@agentmemory/mcp"]',
        'enabled = false'
      ].join('\n')
    )

    await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
      { env: cliEnv(home) }
    )
    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        'codex',
        'doctor',
        '--config',
        configPath
      ],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('cyrene-continuity mcp: configured')
    expect(result.stdout).toContain('agentmemory: disabled')
    expect(result.stdout).toContain('cyrene-continuity: ok')
    expect(result.stdout).toContain('status: ready')
  })

  it('doctor reports stale MCP commands as not ready even when the skill is installed', async () => {
    const home = await createTempDir('cyrene-codex-cli-stale-home-')
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene]',
        'command = "cyrene-continuity"',
        'args = ["mcp-server", "--stdio"]',
        'enabled = true',
        '',
        '[mcp_servers.agentmemory]',
        'command = "npx"',
        'args = ["-y", "@agentmemory/mcp"]',
        'enabled = false'
      ].join('\n')
    )
    await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
      { env: cliEnv(home) }
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('cyrene-continuity mcp: configured')
    expect(result.stdout).toContain('mcp command freshness: stale or external')
    expect(result.stdout).toContain('agentmemory: disabled')
    expect(result.stdout).toContain('cyrene-continuity: ok')
    expect(result.stdout).toContain('status: not ready')
    expect(result.stdout).toContain('action: rerun npm --prefix')
    expect(result.stdout).toContain(process.cwd())
    expect(result.stdout).toContain('run --silent dev -- codex install --dev')
    expect(result.stdout).toContain('update [mcp_servers."cyrene-continuity"] from its printed config')
  })

  it('install --dev creates only the skill symlink and Cyrene Codex state root', async () => {
    const home = await createTempDir('cyrene-codex-install-home-')
    const codexConfig = join(home, '.codex', 'config.toml')
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(codexConfig, 'existing = true\n')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('[mcp_servers."cyrene-continuity"]')
    expect(result.stdout).not.toContain('[mcp_servers.cyrene]')
    expect(result.stdout).toContain('command = "npm"')
    expect(result.stdout).toContain('--prefix')
    expect(result.stdout).toContain(process.cwd())
    expect(result.stdout).toContain('run')
    expect(result.stdout).toContain('--silent')
    expect(result.stdout).toContain('dev')
    expect(result.stdout).toContain('mcp-server')
    expect(result.stdout).toContain('--stdio')
    expect(result.stdout).toContain('Disable agentmemory before validating Cyrene')
    await expect(readFile(join(home, '.agents', 'skills', 'cyrene-continuity', 'SKILL.md'), 'utf8')).resolves.toContain(
      'Cyrene Continuity Skill'
    )
    await expect(readFile(join(home, '.cyrene', 'codex', '.keep'), 'utf8')).resolves.toBe(
      'created by cyrene-continuity codex install --dev\n'
    )
    await expect(readFile(codexConfig, 'utf8')).resolves.toBe('existing = true\n')
  })

  it('install --dev refuses to replace an existing non-symlink skill path', async () => {
    const home = await createTempDir('cyrene-codex-install-existing-home-')
    const skillPath = join(home, '.agents', 'skills', 'cyrene-continuity')
    await mkdir(skillPath, { recursive: true })
    await writeFile(join(skillPath, 'SKILL.md'), 'custom skill\n')

    try {
      await execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
        { env: cliEnv(home) }
      )
      throw new Error('install unexpectedly succeeded')
    } catch (error) {
      expect((error as { code?: number }).code).toBe(1)
      expect(String((error as { stderr?: string }).stderr ?? '')).toContain('Refusing to replace existing non-symlink skill path')
    }

    await expect(readFile(join(skillPath, 'SKILL.md'), 'utf8')).resolves.toBe('custom skill\n')
  })

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
    await rm(join(process.cwd(), 'plugin', 'runtime'), { recursive: true, force: true })

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

  it('doctor reports plugin bridge ready without a manual MCP config', async () => {
    const home = await createTempDir('cyrene-codex-plugin-doctor-home-')
    const configPath = join(home, '.codex-config.toml')
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
    expect(result.stdout).toContain('cyrene-continuity mcp: missing')
    expect(result.stdout).toContain('manual mcp: absent')
    expect(result.stdout).toContain('plugin mcp: declared')
    expect(result.stdout).toContain('runtime: present')
    expect(result.stdout).toContain('stable shim: present')
    expect(result.stdout).toContain('cyrene-continuity: plugin')
    expect(result.stdout).toContain('status: ready')
  })

  it('doctor reports a manual MCP config as a plugin bridge conflict', async () => {
    const home = await createTempDir('cyrene-codex-plugin-conflict-home-')
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
    expect(result.stdout).toContain('plugin mcp: declared')
    expect(result.stdout).toContain('stable shim: present')
    expect(result.stdout).toContain('status: not ready')
    expect(result.stdout).toContain('action: disable or remove manual Cyrene MCP config')
    expect(result.stdout).not.toContain('action: rerun')
  })

  it('install-hook --stop --dry-run does not write hooks.json', async () => {
    const home = await createTempDir('cyrene-codex-hook-dry-run-home-')
    const hooksPath = join(home, '.codex', 'hooks.json')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install-hook', '--stop', '--dry-run'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('dry-run')
    expect(result.stdout).toContain('codex hook stop')
    await expect(readFile(hooksPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('install-hook --stop writes hooks.json and preserves existing Stop hooks', async () => {
    const home = await createTempDir('cyrene-codex-hook-install-home-')
    const hooksPath = join(home, '.codex', 'hooks.json')
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(
      hooksPath,
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [{ type: 'command', command: '/Users/phoenix/.codex/hooks/task_done_sound.sh', timeout: 5 }]
              }
            ]
          }
        },
        null,
        2
      )
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install-hook', '--stop'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Codex Stop hook installed')
    const parsed = JSON.parse(await readFile(hooksPath, 'utf8')) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> }
    }
    const commands = parsed.hooks.Stop.flatMap((entry) => entry.hooks.map((hook) => hook.command))
    expect(commands).toContain('/Users/phoenix/.codex/hooks/task_done_sound.sh')
    expect(commands.filter((command) => command.includes('codex hook stop'))).toHaveLength(1)
  })

  it('doctor reports missing Stop hook as an advisory without blocking readiness', async () => {
    const home = await createTempDir('cyrene-codex-cli-stop-hook-advisory-home-')
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene]',
        ...currentRepoMcpConfigLines(),
        'enabled = true',
        '',
        '[mcp_servers.agentmemory]',
        'command = "npx"',
        'args = ["-y", "@agentmemory/mcp"]',
        'enabled = false'
      ].join('\n')
    )
    await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
      { env: cliEnv(home) }
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('status: ready')
    expect(result.stdout).toContain('stop hook: missing')
    expect(result.stdout).toContain('advisory: optional Stop hook is not installed')
  })

  it('doctor reports memory profile and dream state without blocking readiness', async () => {
    const home = await createTempDir('cyrene-codex-cli-memory-doctor-home-')
    process.env.HOME = home
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene]',
        ...currentRepoMcpConfigLines(),
        'enabled = true',
        '',
        '[mcp_servers.agentmemory]',
        'command = "npx"',
        'args = ["-y", "@agentmemory/mcp"]',
        'enabled = false'
      ].join('\n')
    )
    await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
      { env: cliEnv(home) }
    )
    const identity = await identifyCodexProject(process.cwd())
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const globalMemoryRoot = codexGlobalMemoryRoot()
    await mkdir(projectMemoryRoot, { recursive: true })
    await mkdir(globalMemoryRoot, { recursive: true })
    await writeFile(join(globalMemoryRoot, 'MODEL_PROFILE.md'), '# Global Profile\n')
    await writeFile(
      join(projectMemoryRoot, 'dream-state.json'),
      JSON.stringify({ dreamDue: true, lastDreamAt: '2026-05-25T00:00:00.000Z' }) + '\n'
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('status: ready')
    expect(result.stdout).toContain('memory:')
    expect(result.stdout).toContain('global profile: present')
    expect(result.stdout).toContain('project profile: missing')
    expect(result.stdout).toContain('dream due: yes')
    expect(result.stdout).toContain('last dream: 2026-05-25T00:00:00.000Z')
    expect(result.stdout).toContain('auto promote: enabled')
  })

  it('rebuilds the Codex memory SQLite index from JSONL roots', async () => {
    const home = await createTempDir('cyrene-codex-cli-memory-db-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-memory-db-repo-')
    const identity = await identifyCodexProject(repo)
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(projectMemoryRoot, { recursive: true })
    await writeFile(join(projectMemoryRoot, 'index.jsonl'), `${JSON.stringify(createActive())}\n`)

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'db', 'rebuild'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as {
      dbPath: string
      diagnostics: { available: boolean; ftsTokenizer?: string }
      syncedRoots: number
    }
    expect(parsed.dbPath).toBe(join(home, '.cyrene', 'codex', 'memory.db'))
    expect(parsed.diagnostics.available).toBe(true)
    expect(parsed.syncedRoots).toBeGreaterThanOrEqual(1)
  })

  it('doctor reports memory index diagnostics', async () => {
    const home = await createTempDir('cyrene-codex-cli-doctor-index-home-')
    const repo = await createTempDir('cyrene-codex-cli-doctor-index-repo-')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'doctor'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('memory index:')
    expect(result.stdout).toContain(join(home, '.cyrene', 'codex', 'memory.db'))
  })

  it('doctor reports pending counts and current repo MCP command freshness', async () => {
    const home = await createTempDir('cyrene-codex-cli-doctor-pending-home-')
    process.env.HOME = home
    const repoRoot = process.cwd()
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene]',
        'command = "npm"',
        `args = ["--prefix", ${JSON.stringify(repoRoot)}, "run", "--silent", "dev", "--", "mcp-server", "--stdio"]`,
        'enabled = true'
      ].join('\n')
    )
    const globalMemoryRoot = codexGlobalMemoryRoot()
    const globalPending = {
      ...createPending(),
      id: 'global-pending-1',
      scope: 'global' as const,
      normalizedKey: 'global-pending-count-diagnostic'
    }
    await mkdir(globalMemoryRoot, { recursive: true })
    await writeFile(join(globalMemoryRoot, 'pending.jsonl'), `${JSON.stringify(globalPending)}\n`)

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('global pending: 1')
    expect(result.stdout).toContain('project pending: 0')
    expect(result.stdout).toContain('mcp command:')
    expect(result.stdout).toContain('npm')
    expect(result.stdout).toContain('--prefix')
    expect(result.stdout).toContain(repoRoot)
    expect(result.stdout).toContain('mcp-server')
    expect(result.stdout).toContain('--stdio')
    expect(result.stdout).toContain('mcp command freshness: current repo')
  })

  it('doctor parses TOML inline comments and reports project pending counts', async () => {
    const home = await createTempDir('cyrene-codex-cli-doctor-comments-home-')
    process.env.HOME = home
    const repoRoot = process.cwd()
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene] # local dev',
        'command = "npm" # local',
        `args = ["--prefix", ${JSON.stringify(repoRoot)}, "run", "--silent", "dev", "--", "mcp-server", "--stdio"] # local`,
        'enabled = true # local'
      ].join('\n')
    )
    const identity = await identifyCodexProject(process.cwd())
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const projectPending = {
      ...createPending(),
      id: 'project-pending-1',
      normalizedKey: 'project-pending-count-diagnostic'
    }
    await mkdir(projectMemoryRoot, { recursive: true })
    await writeFile(join(projectMemoryRoot, 'pending.jsonl'), `${JSON.stringify(projectPending)}\n`)

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('cyrene-continuity mcp: configured')
    expect(result.stdout).toContain('legacy mcp name: cyrene')
    expect(result.stdout).toContain('mcp command:')
    expect(result.stdout).toContain('npm')
    expect(result.stdout).toContain('--prefix')
    expect(result.stdout).toContain(repoRoot)
    expect(result.stdout).toContain('mcp command freshness: current repo')
    expect(result.stdout).toContain('global pending: 0')
    expect(result.stdout).toContain('project pending: 1')
  })

  it('runs memory dream apply from the CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-dream-home-')
    process.env.HOME = home
    const identity = await identifyCodexProject(process.cwd())
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), `${JSON.stringify(createPending())}\n`)

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'dream', '--stage', 'deep-apply'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as { roots: Array<{ promoted: number }> }
    expect(parsed.roots.some((root) => root.promoted === 1)).toBe(true)
  })

  it('runs memory dream preview from the CLI without promoting pending memory', async () => {
    const home = await createTempDir('cyrene-codex-cli-dream-preview-home-')
    process.env.HOME = home
    const identity = await identifyCodexProject(process.cwd())
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), `${JSON.stringify(createPending())}\n`)

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'dream', '--stage', 'deep-preview'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as { roots: Array<{ stage: string; promoted: number; keptPending: number }> }
    expect(parsed.roots.some((root) => root.stage === 'deep-preview' && root.promoted === 1 && root.keptPending === 0)).toBe(true)
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'dream-preview', 'DREAM_REPORT.md'), 'utf8')).resolves.toContain('cli-dream-promotes-pending')
  })

  it('prints the latest project dream report from the CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-dream-report-home-')
    process.env.HOME = home
    const identity = await identifyCodexProject(process.cwd())
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), `${JSON.stringify(createPending())}\n`)

    await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'dream', '--stage', 'deep-preview'],
      { env: cliEnv(home) }
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'dream', 'report', '--root', 'project'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Cyrene Dream Preview')
    expect(result.stdout).toContain(memoryRoot)
    expect(result.stdout).toContain('cli-dream-promotes-pending')
  })

  it('runs memory maintenance from the CLI without promoting pending memory', async () => {
    const home = await createTempDir('cyrene-codex-cli-maintenance-home-')
    process.env.HOME = home
    const identity = await identifyCodexProject(process.cwd())
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'index.jsonl'), `${JSON.stringify(createActive())}\n`)
    await writeFile(join(memoryRoot, 'pending.jsonl'), `${JSON.stringify(createPending())}\n`)

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'maintenance'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as { roots: Array<{ maintenance: { activeCount: number; pendingCount: number }; promoted?: number }> }
    expect(parsed.roots.some((root) => root.maintenance.activeCount === 1 && root.maintenance.pendingCount === 1)).toBe(true)
    expect(parsed.roots.every((root) => root.promoted === undefined || root.promoted === 0)).toBe(true)
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain('CLI dream promotes repeated pending memory.')
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain('CLI maintenance renders active memory into the model profile.')
  })

  it('runs the similar hints eval check from the Codex CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-eval-home-')
    const repo = await createTempDir('cyrene-codex-cli-eval-repo-')
    const repoRoot = process.cwd()

    const result = await execFileAsync(
      process.execPath,
      [
        join(repoRoot, 'node_modules/tsx/dist/cli.mjs'),
        join(repoRoot, 'src/main.ts'),
        'codex',
        'eval',
        'run',
        '--check',
        'similar-hints'
      ],
      { cwd: repo, env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as {
      check: string
      passed: boolean
      failedChecks: string[]
      similarProjectHints: number
    }
    expect(parsed).toEqual({
      check: 'similar-hints',
      passed: true,
      failedChecks: [],
      similarProjectHints: 0
    })
  })

  it('rejects similar hints eval check with trailing unsupported args', async () => {
    const home = await createTempDir('cyrene-codex-cli-eval-extra-home-')

    await expect(
      execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'eval', 'run', '--check', 'similar-hints', 'extra'],
        { env: cliEnv(home) }
      )
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Usage')
    })
  })

  it('rejects memory dream --stage without a value', async () => {
    const home = await createTempDir('cyrene-codex-cli-dream-home-')
    process.env.HOME = home

    await expect(
      execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'dream', '--stage'],
        { env: cliEnv(home) }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Invalid memory dream stage')
    })
  })

  it('rejects legacy memory dream deep stage with migration guidance', async () => {
    const home = await createTempDir('cyrene-codex-cli-dream-legacy-home-')
    process.env.HOME = home

    await expect(
      execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'dream', '--stage', 'deep'],
        { env: cliEnv(home) }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Invalid memory dream stage: deep. Use deep-preview to generate proposed changes or deep-apply to apply gated changes.')
    })
  })

  it('forwards --cwd to codex subcommands', async () => {
    const home = await createTempDir('cyrene-codex-cli-cwd-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-codex-cli-cwd-project-')
    const identity = await identifyCodexProject(cwd)
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(projectMemoryRoot, { recursive: true })
    await writeFile(join(projectMemoryRoot, 'MODEL_PROFILE.md'), '# Cyrene Model Profile\n\n- Cwd-specific profile.\n')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', cwd, 'codex', 'memory', 'profile'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Cwd-specific profile.')
  })

  it('prints effective memory profile from the CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-profile-home-')
    process.env.HOME = home
    const identity = await identifyCodexProject(process.cwd())
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const globalMemoryRoot = codexGlobalMemoryRoot()
    await mkdir(projectMemoryRoot, { recursive: true })
    await mkdir(globalMemoryRoot, { recursive: true })
    await writeFile(join(globalMemoryRoot, 'MODEL_PROFILE.md'), '# Cyrene Model Profile\n\n- Global profile.\n')
    await writeFile(join(projectMemoryRoot, 'MODEL_PROFILE.md'), '# Cyrene Model Profile\n\n- Project profile.\n')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'profile'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Global profile.')
    expect(result.stdout).toContain('Project profile.')
  })
})
