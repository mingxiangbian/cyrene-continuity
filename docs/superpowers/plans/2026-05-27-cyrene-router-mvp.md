# Cyrene Router MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `cyrene_continuity_get` 升级为基于 SQLite/FTS 的 Continuity Router MVP，同时保留现有 JSONL audit/recovery、pending review hash 和 MCP tool 兼容性。

**Architecture:** 新增一个独立的 `MemoryIndexAdapter`，把 `~/.cyrene/codex/global/memory` 和当前 project memory root 的 JSONL 同步到 `~/.cyrene/codex/memory.db`。`cyrene_continuity_get` 先尝试 SQLite/FTS retrieval，再 fallback 到现有 JSONL retrieval，并返回分区 digest：`globalMemory`、`projectMemory`、`pendingHypotheses`、`responseStrategy`、`reviewReminders`、`similarProjectHints: []`。

**Tech Stack:** TypeScript, Node.js ESM, `node:sqlite`, SQLite FTS5, Vitest, MCP SDK, existing JSONL memory store.

---

## File Structure

- Create: `src/memory/memory-index.ts`
  - SQLite adapter、schema migration、JSONL root sync、FTS query、diagnostics。
- Modify: `src/memory/types.ts`
  - Add `MemoryPortability` and optional `portability` on active/pending memory records.
- Create: `tests/memory-index.test.ts`
  - Unit tests for SQLite initialization, sync, routing filters, FTS query, disabled fallback diagnostics.
- Create: `src/codex/codex-memory-index.ts`
  - Codex-specific wrapper that maps global/current project roots to index roots and exposes rebuild/sync helpers.
- Modify: `src/codex/codex-cli.ts`
  - Add `codex memory db rebuild`.
- Modify: `src/codex/codex-doctor.ts`
  - Report memory index availability, database path, tokenizer, fallback reason.
- Modify: `src/codex/continuity-context.ts`
  - Compile v2 routed digest while preserving legacy fields.
- Modify: `README.md`
  - Document `memory.db` and the rebuild command.
- Test: `tests/codex-continuity-context.test.ts`
  - Router digest, pending hypotheses, fallback behavior.
- Test: `tests/codex-cli.test.ts`
  - CLI rebuild and doctor diagnostics.

---

### Task 1: Memory Index Adapter

**Files:**
- Modify: `src/memory/types.ts`
- Create: `src/memory/memory-index.ts`
- Test: `tests/memory-index.test.ts`

- [ ] **Step 1: Write failing memory index tests**

Create `tests/memory-index.test.ts` with tests for initialization, sync/query, FTS, and disabled adapter diagnostics:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  openMemoryIndexAdapter,
  type MemoryIndexRoot
} from '../src/memory/memory-index.js'
import type { CyreneMemory, PendingMemory } from '../src/memory/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function activeMemory(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'SQLite FTS router keeps project memory local.',
    normalizedKey: 'sqlite-router-project-local',
    evidence: [{ runId: 'run-1', summary: 'Seed active memory.' }],
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
    tags: ['router'],
    ...overrides
  }
}

function pendingMemory(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Pending router hypothesis stays provisional.',
    normalizedKey: 'pending-router-hypothesis',
    evidence: [{ runId: 'run-pending', summary: 'Seed pending memory.' }],
    source: 'assistant_observed',
    scores: {
      evidenceStrength: 0.8,
      stability: 0.7,
      usefulness: 0.7,
      safety: 0.9,
      sensitivity: 0.2
    },
    seenCount: 1,
    firstSeenAt: '2026-05-25T00:00:00.000Z',
    lastSeenAt: '2026-05-25T00:00:00.000Z',
    expiresAt: '2026-06-24T00:00:00.000Z',
    tags: ['router'],
    ...overrides
  }
}

async function writeJsonLines(filePath: string, values: unknown[]): Promise<void> {
  await writeFile(filePath, values.map((value) => JSON.stringify(value)).join('\n') + '\n', 'utf8')
}

describe('memory SQLite index', () => {
  it('initializes memory.db and reports tokenizer diagnostics', async () => {
    const root = await createTempDir('cyrene-memory-index-init-')
    const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })

    const diagnostics = await adapter.initialize()

    expect(diagnostics.available).toBe(true)
    expect(diagnostics.dbPath).toBe(join(root, 'memory.db'))
    expect(['trigram', 'unicode61']).toContain(diagnostics.ftsTokenizer)
    expect(await readFile(join(root, 'memory.db'))).toBeInstanceOf(Buffer)
  })

  it('syncs active global, active project, and pending records with portability filters', async () => {
    const root = await createTempDir('cyrene-memory-index-sync-')
    const globalRoot = join(root, 'global', 'memory')
    const projectRoot = join(root, 'projects', 'project-a', 'memory')
    const otherProjectRoot = join(root, 'projects', 'project-b', 'memory')
    await mkdir(globalRoot, { recursive: true })
    await mkdir(projectRoot, { recursive: true })
    await mkdir(otherProjectRoot, { recursive: true })
    await writeJsonLines(join(globalRoot, 'index.jsonl'), [
      activeMemory({
        id: 'global-1',
        scope: 'global',
        domain: 'procedural',
        content: 'Global router guidance applies everywhere.',
        normalizedKey: 'global-router-guidance'
      })
    ])
    await writeJsonLines(join(projectRoot, 'index.jsonl'), [activeMemory({ id: 'project-a-1' })])
    await writeJsonLines(join(otherProjectRoot, 'index.jsonl'), [
      activeMemory({
        id: 'project-b-1',
        content: 'Other project local memory must not leak.',
        normalizedKey: 'other-project-local'
      })
    ])
    await writeJsonLines(join(projectRoot, 'pending.jsonl'), [pendingMemory()])

    const roots: MemoryIndexRoot[] = [
      { memoryRoot: globalRoot, projectId: null, scope: 'global' },
      { memoryRoot: projectRoot, projectId: 'project-a', scope: 'project' },
      { memoryRoot: otherProjectRoot, projectId: 'project-b', scope: 'project' }
    ]
    const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })
    await adapter.rebuildFromRoots({ roots })

    const global = await adapter.queryActive({
      currentProjectId: 'project-a',
      query: 'router guidance',
      route: 'global',
      maxItems: 10,
      maxTokens: 2_000
    })
    const project = await adapter.queryActive({
      currentProjectId: 'project-a',
      query: 'project memory local',
      route: 'project',
      maxItems: 10,
      maxTokens: 2_000
    })
    const pending = await adapter.queryPending({
      currentProjectId: 'project-a',
      query: 'pending hypothesis',
      maxItems: 10,
      maxTokens: 2_000
    })

    expect(global.map((item) => item.memory.id)).toEqual(['global-1'])
    expect(global[0]?.portability).toBe('global')
    expect(project.map((item) => item.memory.id)).toEqual(['project-a-1'])
    expect(project.map((item) => item.memory.id)).not.toContain('project-b-1')
    expect(project[0]?.portability).toBe('local_only')
    expect(pending.map((item) => item.memory.id)).toEqual(['pending-1'])
    expect(pending[0]?.provisional).toBe(true)
  })

  it('returns unavailable diagnostics when forced unavailable', async () => {
    const root = await createTempDir('cyrene-memory-index-disabled-')
    const adapter = await openMemoryIndexAdapter({
      dbPath: join(root, 'memory.db'),
      forceUnavailableReason: 'test forced fallback'
    })

    await expect(adapter.queryActive({
      currentProjectId: 'project-a',
      query: 'anything',
      route: 'global',
      maxItems: 10,
      maxTokens: 2_000
    })).resolves.toEqual([])
    expect(adapter.diagnostics()).toMatchObject({
      available: false,
      reason: 'test forced fallback'
    })
  })
})
```

- [ ] **Step 2: Run RED for memory index tests**

Run:

```bash
npx vitest run tests/memory-index.test.ts
```

Expected: fail because `src/memory/memory-index.ts` and `MemoryPortability` do not exist.

- [ ] **Step 3: Add memory portability types**

Modify `src/memory/types.ts`:

```ts
export type MemoryPortability =
  | 'local_only'
  | 'project_family'
  | 'similar_project'
  | 'global'
```

Add optional `portability?: MemoryPortability` to both `CyreneMemory` and `PendingMemory`. Keep it optional so existing JSONL records remain valid without migration.

- [ ] **Step 4: Implement `src/memory/memory-index.ts`**

Create a focused adapter with these exported types and functions:

```ts
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { estimateTokens } from '../token-counter.js'
import {
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot
} from './memory-store.js'
import type { CyreneMemory, MemoryPortability, PendingMemory } from './types.js'

export interface MemoryIndexRoot {
  memoryRoot: string
  projectId: string | null
  scope: 'global' | 'project'
}

export interface MemoryIndexDiagnostics {
  available: boolean
  dbPath: string
  ftsTokenizer?: 'trigram' | 'unicode61'
  reason?: string
}

export interface MemoryIndexRebuildInput {
  roots: MemoryIndexRoot[]
}

export interface MemoryIndexActiveQuery {
  currentProjectId: string
  query: string
  route: 'global' | 'project'
  maxItems: number
  maxTokens: number
}

export interface MemoryIndexPendingQuery {
  currentProjectId: string
  query: string
  maxItems: number
  maxTokens: number
}

export interface IndexedActiveMemory {
  memory: CyreneMemory
  score: number
  portability: MemoryPortability
  homeProjectId: string | null
}

export interface IndexedPendingMemory {
  memory: PendingMemory
  score: number
  portability: MemoryPortability
  homeProjectId: string | null
  provisional: true
}

export interface MemoryIndexAdapter {
  initialize(): Promise<MemoryIndexDiagnostics>
  rebuildFromRoots(input: MemoryIndexRebuildInput): Promise<MemoryIndexDiagnostics>
  syncRoot(root: MemoryIndexRoot): Promise<MemoryIndexDiagnostics>
  queryActive(input: MemoryIndexActiveQuery): Promise<IndexedActiveMemory[]>
  queryPending(input: MemoryIndexPendingQuery): Promise<IndexedPendingMemory[]>
  diagnostics(): MemoryIndexDiagnostics
  close(): void
}
```

Implementation requirements:

- Use `await import('node:sqlite')` inside `openMemoryIndexAdapter` so older Node runtimes can fallback without crashing module import.
- Return an unavailable adapter when `forceUnavailableReason` is provided or dynamic import fails.
- Initialize parent directory with `mkdir(dirname(dbPath), { recursive: true })`.
- Create `projects`, `memories`, `memory_evidence`, and `memories_fts`.
- Probe `trigram`; if it fails, recreate/use `unicode61`.
- Store a `payload_json text not null` column in `memories` so query results can rehydrate full `CyreneMemory` / `PendingMemory` without inventing partial objects.
- Derive portability with:

```ts
export function deriveMemoryPortability(memory: Pick<CyreneMemory | PendingMemory, 'scope' | 'portability'>): MemoryPortability {
  if (memory.portability !== undefined) return memory.portability
  return memory.scope === 'global' ? 'global' : 'local_only'
}
```

- `queryActive({ route: 'global' })` must require `status = 'active'`, `scope = 'global'`, `portability = 'global'`.
- `queryActive({ route: 'project' })` must require `status = 'active'`, `home_project_id = currentProjectId`, `portability = 'local_only'`.
- `queryPending` must include only `status = 'pending'` and either global pending or current project pending.
- If FTS `MATCH` throws on a query, fallback to structured query plus simple token scorer.
- Enforce `maxItems` and `maxTokens` using `estimateTokens(memory.content)`.

- [ ] **Step 5: Run GREEN for memory index tests**

Run:

```bash
npx vitest run tests/memory-index.test.ts
```

Expected: all tests in `tests/memory-index.test.ts` pass.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src/memory/types.ts src/memory/memory-index.ts tests/memory-index.test.ts
git commit -m "feat: add sqlite memory index adapter"
```

---

### Task 2: Codex Index Rebuild CLI And Doctor Diagnostics

**Files:**
- Create: `src/codex/codex-memory-index.ts`
- Modify: `src/codex/codex-cli.ts`
- Modify: `src/codex/codex-doctor.ts`
- Test: `tests/codex-cli.test.ts`

- [ ] **Step 1: Write failing CLI and doctor tests**

Append tests to `tests/codex-cli.test.ts`:

```ts
it('rebuilds the Codex memory SQLite index from JSONL roots', async () => {
  const home = await createTempDir('cyrene-codex-cli-memory-db-home-')
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
```

- [ ] **Step 2: Run RED for CLI diagnostics**

Run:

```bash
npx vitest run tests/codex-cli.test.ts --testNamePattern "memory SQLite index|memory index diagnostics"
```

Expected: fail because `codex memory db rebuild` and doctor memory index output do not exist.

- [ ] **Step 3: Implement Codex index wrapper**

Create `src/codex/codex-memory-index.ts`:

```ts
import { join } from 'node:path'
import {
  openMemoryIndexAdapter,
  type MemoryIndexDiagnostics,
  type MemoryIndexRoot
} from '../memory/memory-index.js'
import {
  codexGlobalRoot,
  getReadableCodexGlobalMemoryRoot,
  getReadableCodexProjectMemoryRoot
} from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'

export interface CodexMemoryIndexRebuildResult {
  dbPath: string
  diagnostics: MemoryIndexDiagnostics
  syncedRoots: number
}

export function codexMemoryDbPath(): string {
  return join(codexGlobalRoot(), 'memory.db')
}

export async function codexMemoryIndexRoots(projectId: string): Promise<MemoryIndexRoot[]> {
  const roots: MemoryIndexRoot[] = []
  const globalRoot = await getReadableCodexGlobalMemoryRoot()
  if (globalRoot !== null) {
    roots.push({ memoryRoot: globalRoot, projectId: null, scope: 'global' })
  }
  const projectRoot = await getReadableCodexProjectMemoryRoot(projectId)
  if (projectRoot !== null) {
    roots.push({ memoryRoot: projectRoot, projectId, scope: 'project' })
  }
  return roots
}

export async function rebuildCodexMemoryIndex(input: { cwd: string }): Promise<CodexMemoryIndexRebuildResult> {
  const project = await identifyCodexProject(input.cwd)
  const roots = await codexMemoryIndexRoots(project.projectId)
  const adapter = await openMemoryIndexAdapter({ dbPath: codexMemoryDbPath() })
  const diagnostics = await adapter.rebuildFromRoots({ roots })
  adapter.close()
  return { dbPath: codexMemoryDbPath(), diagnostics, syncedRoots: roots.length }
}

export async function readCodexMemoryIndexDiagnostics(): Promise<MemoryIndexDiagnostics> {
  const adapter = await openMemoryIndexAdapter({ dbPath: codexMemoryDbPath() })
  const diagnostics = await adapter.diagnostics()
  adapter.close()
  return diagnostics
}
```

If `codexGlobalRoot()` does not exist yet, `rebuildCodexMemoryIndex` must create it through the adapter's `mkdir(dirname(dbPath))`; do not manually create unrelated memory roots.

- [ ] **Step 4: Add CLI command**

Modify `src/codex/codex-cli.ts`:

```ts
import { rebuildCodexMemoryIndex } from './codex-memory-index.js'
```

Add before `memory profile` handling:

```ts
if (command === 'memory' && input.args[1] === 'db' && input.args[2] === 'rebuild') {
  process.stdout.write(`${JSON.stringify(await rebuildCodexMemoryIndex({ cwd: input.cwd }), null, 2)}\n`)
  return
}
```

Update usage text to include:

```txt
memory db rebuild
```

- [ ] **Step 5: Add doctor diagnostics**

Modify `src/codex/codex-doctor.ts` to import `codexMemoryDbPath` and `readCodexMemoryIndexDiagnostics`. Include in output under `memory:`:

```ts
const memoryIndex = await readCodexMemoryIndexDiagnostics()
```

Add lines:

```ts
`  memory index: ${memoryIndex.available ? 'available' : 'unavailable'}`,
`  memory db: ${codexMemoryDbPath()}`,
memoryIndex.ftsTokenizer === undefined ? undefined : `  memory fts: ${memoryIndex.ftsTokenizer}`,
memoryIndex.reason === undefined ? undefined : `  memory index reason: ${memoryIndex.reason}`,
```

- [ ] **Step 6: Run GREEN for CLI diagnostics**

Run:

```bash
npx vitest run tests/codex-cli.test.ts --testNamePattern "memory SQLite index|memory index diagnostics"
```

Expected: the two new tests pass.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src/codex/codex-memory-index.ts src/codex/codex-cli.ts src/codex/codex-doctor.ts tests/codex-cli.test.ts
git commit -m "feat: add codex memory index rebuild"
```

---

### Task 3: Continuity Router Digest

**Files:**
- Modify: `src/codex/continuity-context.ts`
- Modify: `tests/codex-continuity-context.test.ts`

- [ ] **Step 1: Write failing router digest tests**

Append tests to `tests/codex-continuity-context.test.ts`:

```ts
it('returns routed global and project memory digest sections', async () => {
  const home = await createTempDir('cyrene-codex-continuity-router-home-')
  process.env.HOME = home
  const repo = await createTempDir('cyrene-codex-continuity-router-repo-')
  const identity = await identifyCodexProject(repo)
  const globalMemoryRoot = codexGlobalMemoryRoot()
  const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
  await mkdir(globalMemoryRoot, { recursive: true })
  await mkdir(projectMemoryRoot, { recursive: true })
  await writeFile(join(globalMemoryRoot, 'index.jsonl'), JSON.stringify(createMemory({
    id: 'global-router-memory',
    scope: 'global',
    domain: 'procedural',
    content: 'Global continuity router guidance applies across projects.',
    normalizedKey: 'global-continuity-router-guidance'
  })) + '\n')
  await writeFile(join(projectMemoryRoot, 'index.jsonl'), JSON.stringify(createMemory({
    id: 'project-router-memory',
    content: 'Project continuity router fact stays local.',
    normalizedKey: 'project-continuity-router-local'
  })) + '\n')

  const context = await getCodexContinuityContext({
    cwd: repo,
    userMessage: 'router continuity guidance local project',
    task: 'planning'
  })

  expect(context.globalMemory.map((item) => item.id)).toEqual(['global-router-memory'])
  expect(context.projectMemory.map((item) => item.id)).toEqual(['project-router-memory'])
  expect(context.similarProjectHints).toEqual([])
  expect(context.responseStrategy.challengePolicy).toBeDefined()
  expect(context.memory.items.map((item) => item.id)).toEqual(
    expect.arrayContaining(['global-router-memory', 'project-router-memory'])
  )
})

it('returns pending hypotheses as provisional without mixing them into active memory', async () => {
  const home = await createTempDir('cyrene-codex-continuity-router-pending-home-')
  process.env.HOME = home
  const repo = await createTempDir('cyrene-codex-continuity-router-pending-repo-')
  const identity = await identifyCodexProject(repo)
  const memoryRoot = codexProjectMemoryRoot(identity.projectId)
  const pending = createPendingMemory()
  await mkdir(memoryRoot, { recursive: true })
  await writeFile(join(memoryRoot, 'pending.jsonl'), JSON.stringify({
    ...pending,
    content: 'Pending router candidate can guide clarification only.',
    normalizedKey: 'pending-router-clarification-only'
  }) + '\n')

  const context = await getCodexContinuityContext({
    cwd: repo,
    userMessage: 'pending router clarification',
    task: 'memory'
  })

  expect(context.pendingHypotheses).toHaveLength(1)
  expect(context.pendingHypotheses[0]).toMatchObject({
    id: pending.id,
    provisional: true,
    status: 'pending'
  })
  expect(context.memory.items).toEqual([])
  expect(context.profile.content).not.toContain('Pending router candidate can guide clarification only.')
})
```

- [ ] **Step 2: Run RED for router digest tests**

Run:

```bash
npx vitest run tests/codex-continuity-context.test.ts --testNamePattern "routed global|pending hypotheses"
```

Expected: fail because `globalMemory`, `projectMemory`, `pendingHypotheses`, `similarProjectHints`, and `responseStrategy` do not exist.

- [ ] **Step 3: Add routed digest types**

Modify `src/codex/continuity-context.ts`:

```ts
interface RoutedMemoryDigestItem {
  id: string
  domain: string
  type: string
  strength: string
  scope: string
  portability: string
  status: 'active'
  content: string
  score: number
}

interface PendingHypothesisDigestItem {
  id: string
  domain: string
  type: string
  strength: string
  scope: string
  portability: string
  status: 'pending'
  content: string
  provisional: true
  score: number
}

interface ReviewReminder {
  kind: 'pending_review'
  candidateId: string
  content: string
}
```

Extend `CodexContinuityContext` with:

```ts
globalMemory: RoutedMemoryDigestItem[]
projectMemory: RoutedMemoryDigestItem[]
pendingHypotheses: PendingHypothesisDigestItem[]
similarProjectHints: []
responseStrategy: {
  tone: string
  verbosity: string
  challengePolicy: string
  avoid: string[]
  rationale: string
}
reviewReminders: ReviewReminder[]
diagnostics?: {
  memoryIndex?: {
    available: boolean
    reason?: string
    ftsTokenizer?: string
  }
}
```

- [ ] **Step 4: Use SQLite index with JSONL fallback**

In `getCodexContinuityContext`:

- Identify current project as today.
- Build current global/project roots.
- Open `openMemoryIndexAdapter({ dbPath: codexMemoryDbPath() })`.
- `rebuildFromRoots({ roots })` for current roots only; this is acceptable for MVP because similar-project retrieval is not implemented.
- Query:

```ts
const [globalMemory, projectMemory, pendingHypotheses] = await Promise.all([
  adapter.queryActive({ currentProjectId: project.projectId, query: input.userMessage, route: 'global', maxItems: 8, maxTokens: 500 }),
  adapter.queryActive({ currentProjectId: project.projectId, query: input.userMessage, route: 'project', maxItems: 12, maxTokens: 900 }),
  adapter.queryPending({ currentProjectId: project.projectId, query: input.userMessage, maxItems: 6, maxTokens: 400 })
])
```

- If adapter diagnostics are unavailable or query throws, fallback to current `retrieveMemories` behavior and split retrieved active memories by `scope`.
- Preserve current `pendingReview`, `profile`, `strategy`, and `dissent` behavior.
- Build legacy `memory.items` from `globalMemory + projectMemory` only, never from `pendingHypotheses`.
- Add `similarProjectHints: []`.
- Map `responseStrategy` from existing snapshot:

```ts
responseStrategy: {
  tone: snapshot.strategy.tone,
  verbosity: snapshot.strategy.verbosity,
  challengePolicy: snapshot.strategy.challenge,
  avoid: [
    'claimed sentience',
    'psychological diagnosis',
    'romantic attachment',
    'emotional manipulation'
  ],
  rationale: snapshot.strategy.rationale
}
```

- `reviewReminders` should include at most one newest pending review reminder from `pendingReview.newestCandidateId/newestPreview`.

- [ ] **Step 5: Run GREEN for router digest tests**

Run:

```bash
npx vitest run tests/codex-continuity-context.test.ts --testNamePattern "routed global|pending hypotheses"
```

Expected: new router digest tests pass.

- [ ] **Step 6: Run existing continuity-context tests**

Run:

```bash
npx vitest run tests/codex-continuity-context.test.ts
```

Expected: all existing continuity context tests still pass.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add src/codex/continuity-context.ts tests/codex-continuity-context.test.ts
git commit -m "feat: return routed continuity digest"
```

---

### Task 4: Index Sync On Memory Writes

**Files:**
- Modify: `src/codex/memory-propose.ts`
- Modify: `src/codex/memory-review.ts`
- Test: `tests/codex-memory-propose.test.ts`
- Test: `tests/codex-memory-review.test.ts`

- [ ] **Step 1: Write failing sync-after-write tests**

Add one test to `tests/codex-memory-propose.test.ts`:

```ts
it('best-effort syncs the memory index after proposing pending memory', async () => {
  const home = await createTempDir('cyrene-codex-propose-index-home-')
  process.env.HOME = home
  const cwd = await createTempDir('cyrene-codex-propose-index-repo-')

  const result = await proposeCodexMemoryCandidate({
    cwd,
    candidate: {
      domain: 'project',
      type: 'project_fact',
      content: 'Pending proposal should be visible to router index sync.',
      normalizedKey: 'pending-proposal-router-index-sync',
      evidence: [{ runId: 'run-index', summary: 'Index sync test.' }]
    }
  })

  expect(result.result.action).toBe('pending')
  await expect(readFile(join(home, '.cyrene', 'codex', 'memory.db'))).resolves.toBeInstanceOf(Buffer)
})
```

Add one test to `tests/codex-memory-review.test.ts`:

```ts
it('best-effort syncs the memory index after promoting pending memory', async () => {
  const home = await createTempDir('cyrene-codex-review-index-home-')
  process.env.HOME = home
  const cwd = await createTempDir('cyrene-codex-review-index-repo-')
  const memoryRoot = await seedPending(cwd, [createPendingMemory({
    id: 'pending-index-sync',
    content: 'Promoted memory should be visible to router index sync.',
    normalizedKey: 'promoted-router-index-sync'
  })])
  const candidate = (await readPendingMemoriesFromRoot(memoryRoot))[0]
  if (candidate === undefined) throw new Error('missing candidate')

  await promoteCodexPendingMemory({
    cwd,
    id: candidate.id,
    reviewHash: reviewHashForPendingMemory(candidate)
  })

  await expect(readFile(join(home, '.cyrene', 'codex', 'memory.db'))).resolves.toBeInstanceOf(Buffer)
})
```

Use existing helper names in those test files. If a helper has a different name, use the local helper already present in the file instead of creating a duplicate with conflicting semantics.

- [ ] **Step 2: Run RED for write sync tests**

Run:

```bash
npx vitest run tests/codex-memory-propose.test.ts tests/codex-memory-review.test.ts --testNamePattern "router index sync|memory index"
```

Expected: fail because memory writes do not sync `memory.db`.

- [ ] **Step 3: Add best-effort sync helper**

In `src/codex/codex-memory-index.ts`, add:

```ts
export async function syncCurrentCodexMemoryIndex(input: { cwd: string }): Promise<void> {
  try {
    await rebuildCodexMemoryIndex(input)
  } catch {
    // JSONL writes are the source of truth. Index sync must not break memory writes.
  }
}
```

- [ ] **Step 4: Call sync helper after successful writes**

In `src/codex/memory-propose.ts`, import and call after the pending event is appended and before returning:

```ts
await syncCurrentCodexMemoryIndex({ cwd: input.cwd })
```

In `src/codex/memory-review.ts`, import and call after successful promote and reject mutations:

```ts
await syncCurrentCodexMemoryIndex({ cwd: input.cwd })
```

Do not call sync when validator rejects a proposal before writing pending memory.

- [ ] **Step 5: Run GREEN for write sync tests**

Run:

```bash
npx vitest run tests/codex-memory-propose.test.ts tests/codex-memory-review.test.ts --testNamePattern "router index sync|memory index"
```

Expected: new write sync tests pass.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add src/codex/codex-memory-index.ts src/codex/memory-propose.ts src/codex/memory-review.ts tests/codex-memory-propose.test.ts tests/codex-memory-review.test.ts
git commit -m "feat: sync memory index after writes"
```

---

### Task 5: Documentation And Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-05-27-cyrene-router-mvp.md`

- [ ] **Step 1: Update README data and commands**

Modify `README.md`:

- Under `Commands`, add:

```bash
npm run dev -- codex memory db rebuild
```

- Under `Data`, add:

```txt
~/.cyrene/codex/memory.db
```

Explain in one concise paragraph:

```md
`memory.db` is the runtime SQLite/FTS retrieval index. JSONL files remain the audit/recovery source of truth, and generated Markdown profiles remain review/debug projections.
```

- [ ] **Step 2: Run targeted test suite**

Run:

```bash
npx vitest run tests/memory-index.test.ts tests/codex-continuity-context.test.ts tests/codex-cli.test.ts tests/codex-memory-propose.test.ts tests/codex-memory-review.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected:

- `npm test` exits 0.
- `npm run typecheck` exits 0.
- `npm run build:plugin` exits 0.
- Plugin validator exits 0.

- [ ] **Step 4: Update plan checkboxes**

Update this plan file’s checkboxes for tasks that were actually completed. Do not mark a task complete unless its verification command ran and passed.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add README.md docs/superpowers/plans/2026-05-27-cyrene-router-mvp.md
git commit -m "docs: document cyrene router mvp runtime index"
```

---

## Final Acceptance Checklist

- [ ] `memory.db` initializes under `~/.cyrene/codex/memory.db`.
- [ ] SQLite/FTS sync reads existing global and current project JSONL roots.
- [ ] `globalMemory` contains only active global memory.
- [ ] `projectMemory` contains only active current-project local memory.
- [ ] Other-project `local_only` memory does not appear in current project digest.
- [ ] `pendingHypotheses` contains pending candidates with `provisional: true`.
- [ ] Pending candidates never appear in `memory.items` or `MODEL_PROFILE.md`.
- [ ] `similarProjectHints` returns `[]`.
- [ ] `responseStrategy` is a policy hint and does not override Codex personality.
- [ ] SQLite unavailable/failure path falls back to JSONL retrieval.
- [ ] Existing MCP tool names and schemas remain compatible.
- [ ] `npm test`, `npm run typecheck`, `npm run build:plugin`, and plugin validator pass.
