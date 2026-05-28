# Cyrene v3 PR5 Project Identification Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 v3 PR5：提供 `codex project status/list/alias/merge`，让用户能发现并显式修复 projectId 分裂，同时证明 wrong projectId 的 project-local memory 不会泄漏到当前 project context。

**Architecture:** 新增 `src/codex/project-registry.ts` 作为 project metadata 和 project-root JSONL merge 的唯一写入层；新增 `src/codex/project-tools.ts` 作为 CLI formatter/runtime。`codex project alias` 只写 `project.json` metadata；`codex project merge` 只在显式命令下把 selected JSONL memory artifacts 从 `<from>` 合并到 `<to>`，不自动改 retrieval，不复制 `MODEL_PROFILE.md`。

**Tech Stack:** TypeScript, Node fs/promises, Vitest, existing Codex CLI (`src/codex/codex-cli.ts`), existing memory JSONL store.

---

### Task 1: Project Registry Metadata And Merge Core

**Files:**
- Modify: `src/codex/codex-memory-root.ts`
- Create: `src/codex/project-registry.ts`
- Test: `tests/codex-project-tools.test.ts`

- [ ] **Step 1: Write failing registry tests**

Create `tests/codex-project-tools.test.ts` with tests that:

```ts
it('adds aliases to project metadata and lists known project roots', async () => {
  const home = await createTempDir('cyrene-project-tools-home-')
  vi.stubEnv('HOME', home)
  const projectId = 'old-project-id'
  await addCodexProjectAlias({ projectId, alias: 'repo-renamed' })
  const projects = await listCodexProjects()
  expect(projects).toEqual([
    expect.objectContaining({
      projectId,
      aliases: ['repo-renamed'],
      counts: expect.objectContaining({ active: 0, pending: 0, tombstones: 0 })
    })
  ])
})
```

Also add:

```ts
it('explicitly merges memory JSONL from one project to another without copying model profile', async () => {
  const home = await createTempDir('cyrene-project-merge-home-')
  vi.stubEnv('HOME', home)
  const fromRoot = await ensureCodexProjectMemoryRoot('from-project')
  const toRoot = await ensureCodexProjectMemoryRoot('to-project')
  await writeFile(join(fromRoot, 'index.jsonl'), `${JSON.stringify(createActive({ id: 'from-active', content: 'From project memory.' }))}\n`)
  await writeFile(join(toRoot, 'index.jsonl'), `${JSON.stringify(createActive({ id: 'to-active', content: 'To project memory.' }))}\n`)
  await writeFile(join(fromRoot, 'MODEL_PROFILE.md'), '# Source Profile\n')

  const result = await mergeCodexProjects({ fromProjectId: 'from-project', toProjectId: 'to-project' })

  expect(result.mergedFiles).toContain('index.jsonl')
  await expect(readFile(join(toRoot, 'index.jsonl'), 'utf8')).resolves.toContain('From project memory.')
  await expect(readFile(join(toRoot, 'MODEL_PROFILE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/codex-project-tools.test.ts -t "adds aliases|explicitly merges"
```

Expected: FAIL because `project-registry.ts` and exported project-root helper do not exist.

- [ ] **Step 3: Implement registry**

In `src/codex/codex-memory-root.ts`, export safe project root helpers:

```ts
export async function ensureCodexProjectRoot(projectId: string): Promise<string> { ... }
export async function getReadableCodexProjectRoot(projectId: string): Promise<string | null> { ... }
export async function getReadableCodexProjectRoots(): Promise<string[]> { ... }
```

Keep the existing safe-directory checks; `getReadableCodexProjectMemoryRoots()` should continue using the same safety behavior.

Create `src/codex/project-registry.ts` with:

```ts
export interface CodexProjectRegistryEntry {
  projectId: string
  root: string
  memoryRoot: string
  aliases: string[]
  mergedFrom: string[]
  mergedInto?: string
  counts: { active: number; pending: number; tombstones: number }
}

export async function listCodexProjects(): Promise<CodexProjectRegistryEntry[]> { ... }
export async function addCodexProjectAlias(input: { projectId: string; alias: string }): Promise<CodexProjectRegistryEntry> { ... }
export async function mergeCodexProjects(input: { fromProjectId: string; toProjectId: string }): Promise<{ fromProjectId: string; toProjectId: string; mergedFiles: string[] }> { ... }
```

Implementation constraints:

- Validate `projectId` with `/^[A-Za-z0-9._-]+$/`; reject empty aliases.
- Store metadata at `~/.cyrene/codex/projects/<projectId>/project.json`.
- Merge only JSONL files: `index.jsonl`, `pending.jsonl`, `tombstones.jsonl`, `events.jsonl`, `profile_candidates.jsonl`, `review-summaries.jsonl`.
- For JSONL files with an `id`, dedupe by `id`; otherwise dedupe by raw line.
- Do not copy `MODEL_PROFILE.md`, dream reports, locks, or arbitrary files.
- Keep source root present and mark source metadata `mergedInto: <to>`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/codex-project-tools.test.ts -t "adds aliases|explicitly merges"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codex/codex-memory-root.ts src/codex/project-registry.ts tests/codex-project-tools.test.ts
git commit -m "feat: add codex project registry merge core"
```

---

### Task 2: Codex Project CLI Tools

**Files:**
- Create: `src/codex/project-tools.ts`
- Modify: `src/codex/codex-cli.ts`
- Test: `tests/codex-cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Add CLI tests:

```ts
it('project status and list expose split diagnostics and aliases', async () => {
  const home = await createTempDir('cyrene-codex-cli-project-home-')
  process.env.HOME = home
  const repo = await createTempDir('cyrene-codex-cli-project-repo-')
  const identity = await identifyCodexProject(repo)
  await mkdir(codexProjectMemoryRoot(identity.projectId), { recursive: true })
  await mkdir(codexProjectMemoryRoot('legacy-project-id'), { recursive: true })

  await execFileAsync(process.execPath, [
    'node_modules/tsx/dist/cli.mjs',
    'src/main.ts',
    'codex',
    'project',
    'alias',
    'legacy-project-id',
    identity.displayName
  ], { env: cliEnv(home) })

  const status = await execFileAsync(process.execPath, [
    'node_modules/tsx/dist/cli.mjs',
    'src/main.ts',
    '--cwd',
    repo,
    'codex',
    'project',
    'status'
  ], { env: cliEnv(home) })
  const list = await execFileAsync(process.execPath, [
    'node_modules/tsx/dist/cli.mjs',
    'src/main.ts',
    '--cwd',
    repo,
    'codex',
    'project',
    'list'
  ], { env: cliEnv(home) })

  expect(status.stdout).toContain(`projectId: ${identity.projectId}`)
  expect(status.stdout).toContain('projectId split: possible')
  expect(status.stdout).toContain('split candidates: legacy-project-id')
  expect(status.stdout).toContain(`action: cyrene-continuity codex project merge legacy-project-id ${identity.projectId}`)
  expect(list.stdout).toContain('legacy-project-id')
  expect(list.stdout).toContain(`aliases: ${identity.displayName}`)
})
```

Add merge CLI test:

```ts
it('project merge requires an explicit command and merges into the selected target', async () => {
  const home = await createTempDir('cyrene-codex-cli-project-merge-home-')
  process.env.HOME = home
  await mkdir(codexProjectMemoryRoot('from-project'), { recursive: true })
  await mkdir(codexProjectMemoryRoot('to-project'), { recursive: true })
  await writeFile(join(codexProjectMemoryRoot('from-project'), 'index.jsonl'), `${JSON.stringify(createActive({ id: 'from-active', content: 'Merged project memory.' }))}\n`)

  const result = await execFileAsync(process.execPath, [
    'node_modules/tsx/dist/cli.mjs',
    'src/main.ts',
    'codex',
    'project',
    'merge',
    'from-project',
    'to-project'
  ], { env: cliEnv(home) })

  expect(result.stdout).toContain('merged from: from-project')
  expect(result.stdout).toContain('merged into: to-project')
  await expect(readFile(join(codexProjectMemoryRoot('to-project'), 'index.jsonl'), 'utf8')).resolves.toContain('Merged project memory.')
})
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/codex-cli.test.ts -t "project status and list|project merge requires"
```

Expected: FAIL because `codex project ...` is not routed.

- [ ] **Step 3: Implement CLI tools**

Create `src/codex/project-tools.ts`:

```ts
export async function formatCodexProjectStatus(input: { cwd: string }): Promise<string> { ... }
export async function formatCodexProjectList(input: { cwd: string }): Promise<string> { ... }
export async function runCodexProjectAlias(input: { projectId: string; alias: string }): Promise<string> { ... }
export async function runCodexProjectMerge(input: { fromProjectId: string; toProjectId: string }): Promise<string> { ... }
```

Status output must include current identity, memory root, known project count, split candidates, and explicit merge command when a split is possible. List output must include project id, current marker, aliases, mergedFrom/mergedInto, counts, and memory root.

Modify `src/codex/codex-cli.ts`:

- Route `codex project status`.
- Route `codex project list`.
- Route `codex project alias <projectId> <alias>`.
- Route `codex project merge <from> <to>`.
- Update usage text with the new commands.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/codex-cli.test.ts -t "project status and list|project merge requires"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codex/project-tools.ts src/codex/codex-cli.ts tests/codex-cli.test.ts
git commit -m "feat: add codex project cli tools"
```

---

### Task 3: Wrong ProjectId Non-Leak Regression

**Files:**
- Test: `tests/codex-continuity-context.test.ts`

- [ ] **Step 1: Write failing-or-proving regression test**

Add:

```ts
it('does not leak project-local memory from another projectId into current continuity context', async () => {
  const home = await createTempDir('cyrene-codex-continuity-wrong-project-home-')
  vi.stubEnv('HOME', home)
  const currentRepo = await createTempDir('cyrene-current-project-')
  const otherRepo = await createTempDir('cyrene-other-project-')
  const current = await identifyCodexProject(currentRepo)
  const other = await identifyCodexProject(otherRepo)
  const currentRoot = codexProjectMemoryRoot(current.projectId)
  const otherRoot = codexProjectMemoryRoot(other.projectId)
  await mkdir(currentRoot, { recursive: true })
  await mkdir(otherRoot, { recursive: true })
  await writeFile(join(currentRoot, 'index.jsonl'), `${JSON.stringify(createActive({ id: 'current-memory', content: 'Current project memory.' }))}\n`)
  await writeFile(join(otherRoot, 'index.jsonl'), `${JSON.stringify(createActive({ id: 'other-memory', content: 'Other project local memory must not leak.' }))}\n`)

  const context = await getCodexContinuityContext({
    cwd: currentRepo,
    userMessage: 'What memory applies here?'
  })

  expect(JSON.stringify(context.projectMemory)).toContain('Current project memory.')
  expect(JSON.stringify(context.projectMemory)).not.toContain('Other project local memory must not leak.')
  expect(JSON.stringify(context.globalMemory)).not.toContain('Other project local memory must not leak.')
  expect(JSON.stringify(context.memory.items)).not.toContain('Other project local memory must not leak.')
})
```

- [ ] **Step 2: Verify test**

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts -t "does not leak project-local memory"
```

Expected: PASS if existing retrieval already obeys the PR5 invariant; if it fails, fix only the retrieval root selection so fallback and indexed retrieval exclude project-local memory from non-current projectIds.

- [ ] **Step 3: Commit**

```bash
git add tests/codex-continuity-context.test.ts
git commit -m "test: cover wrong project id memory isolation"
```

---

### Task 4: Docs, Runtime Build, And Verification

**Files:**
- Modify: `README.md`
- Modify: `plugin/runtime/cyrene-continuity.mjs`

- [ ] **Step 1: Update README**

Add a short Project tools section:

```md
## Project Tools

Use `cyrene-continuity codex project status` and `cyrene-continuity codex project list`
to inspect projectId drift. Use `cyrene-continuity codex project alias <projectId> <alias>`
to label a known project root, and `cyrene-continuity codex project merge <from> <to>`
to explicitly merge split project memory. Alias and merge never run implicitly from
retrieval.
```

- [ ] **Step 2: Rebuild plugin runtime**

Run:

```bash
npm run build:plugin
```

Expected: PASS and `plugin/runtime/cyrene-continuity.mjs` updates.

- [ ] **Step 3: Full verification**

Run:

```bash
npm test -- tests/codex-project-tools.test.ts tests/codex-cli.test.ts tests/codex-continuity-context.test.ts
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit**

```bash
git add README.md plugin/runtime/cyrene-continuity.mjs
git commit -m "docs: document codex project tools"
```

---

## Self-Review

- Spec coverage: PR5 status/list/alias/merge covered by Tasks 1-2; projectId split diagnostics covered by Task 2; wrong projectId non-leak covered by Task 3; explicit-only merge/alias covered by Task 2 and README.
- Placeholder scan: no unresolved placeholder markers or unspecified “add tests” steps remain.
- Type consistency: `projectId`, `aliases`, `mergedFrom`, `mergedInto`, `memoryRoot`, and CLI route names match across tasks.
