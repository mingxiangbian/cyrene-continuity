# Cyrene v1.6 Memory Relation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 v1.6 durable memory-to-memory relation layer，并把 validated-safe relations 接入 SQLite projection、runtime retrieval、context-preview、profile/automation safety 和 benchmark gate。

**Architecture:** 新增 `MemoryEdge` durable JSONL store 作为 source-of-truth；SQLite `memory_edges` 继续作为 hot-path projection，同时兼容现有 file-trace edges。Runtime 通过小 helper 做 relation-specific 1-hop expansion，`continuity-context.ts` 只保留 orchestration glue。

**Tech Stack:** TypeScript, Vitest, JSONL durable memory store, Node `node:sqlite` adapter, existing Cyrene benchmark runner.

---

## Execution Model

本计划使用 multi-agent execution。Controller 负责 branch、plan、integration、final verification；subagents 只能在明确 ownership lane 内修改文件，不得回滚其他 lane 的改动。

### Agent Lanes

| Lane | Ownership | Files |
| --- | --- | --- |
| Contract Agent | relation types, edge lifecycle constants, JSONL store API | `src/memory/types.ts`, `src/memory/memory-store.ts`, `tests/memory-store.test.ts` |
| Detector Agent | deterministic relation detection and operation-backed lifecycle helpers | `src/memory/memory-relations.ts`, `tests/memory-relations.test.ts` |
| Index/Retrieval Agent | SQLite projection and relation-aware runtime expansion | `src/memory/memory-index.ts`, `src/memory/memory-retriever.ts`, `src/codex/continuity-context.ts`, `tests/memory-index.test.ts`, `tests/codex-continuity-context.test.ts` |
| Preview/Profile/Automation Agent | preview explanations, profile safety filters, daily edge maintenance | `src/codex/memory-context-preview.ts`, `src/codex/memory-lifecycle-profile.ts`, `src/codex/codex-memory-lifecycle-daily.ts`, `tests/codex-continuity-context.test.ts`, `tests/codex-memory-lifecycle-daily.test.ts` |
| Benchmark Agent | deterministic `T16-REL-*` catalog/cases/report assertions | `benchmark/catalog.ts`, `benchmark/cases/tier1-6-core-mechanisms.ts`, `benchmark/types.ts`, `tests/benchmark-cases-tier0.test.ts`, `tests/benchmark-runner.test.ts` |

### Dependency Order

```text
Task 1 Contract/Store
  -> Task 2 Detector/Lifecycle
  -> Task 3 Index Projection
  -> Task 4 Runtime Expansion
      -> Task 5 Preview/Profile/Automation
      -> Task 6 Benchmark Gates
  -> Task 7 Integration Verification
```

### Baseline

Branch: `codex/cyrene-v1-6-relation-layer`

Already verified before writing this plan:

```bash
npm install
npm test
```

Expected baseline result:

```text
Test Files  80 passed (80)
Tests       871 passed (871)
```

---

## File Structure

- Create `src/memory/memory-relations.ts`: relation constants, deterministic edge id helper, traversal/expansion policy, status transition helper, operation-backed edge constructors.
- Modify `src/memory/types.ts`: add `MemoryRelationType`, `MemoryEdgeStatus`, `MemoryEdgeOrigin`, `MemoryEdgeEvidenceKind`, `MemoryEdge`, and relation event reason details.
- Modify `src/memory/memory-store.ts`: add `memory_edges.jsonl` read/write/upsert/status transition APIs.
- Modify `src/memory/memory-index.ts`: project durable edges into SQLite, distinguish durable memory-to-memory edges from existing deterministic file-trace edges, expose edge query enough for expansion.
- Modify `src/memory/memory-retriever.ts`: keep JSONL fallback relation expansion focused and fail-closed.
- Modify `src/codex/continuity-context.ts`: call relation expansion helper after seed retrieval and before model-visible context assembly.
- Modify `src/codex/memory-context-preview.ts`: include relation inclusion/filter explanations in diagnostics.
- Modify `src/codex/memory-lifecycle-profile.ts`: use validated relations only as safety filters/explanations; do not create profile lines from trial/model-only edges.
- Modify `src/codex/codex-memory-lifecycle-daily.ts`: expire invalid edges, validate deterministic low-risk operation-backed edges, aggregate relation usage events outside retrieval hot path.
- Modify `benchmark/catalog.ts` and `benchmark/cases/tier1-6-core-mechanisms.ts`: add `T16-REL-*` deterministic gate cases.
- Add tests: `tests/memory-relations.test.ts`; extend existing memory store/index/retrieval/context/automation/benchmark tests.

---

### Task 1: Contract And Durable Edge Store

**Files:**
- Modify: `src/memory/types.ts`
- Modify: `src/memory/memory-store.ts`
- Test: `tests/memory-store.test.ts`

- [ ] **Step 1: Write failing store contract tests**

Add tests that prove edge store round-trips, upserts by id, and writes invalidation receipts:

```ts
it('stores memory relation edges as durable JSONL records', async () => {
  const root = await makeTempMemoryRoot()
  const edge: MemoryEdge = memoryEdgeFixture({
    id: 'edge-replacement-old',
    fromMemoryId: 'replacement',
    toMemoryId: 'old',
    relationType: 'supersedes',
    status: 'validated',
    origin: 'operation',
    evidenceKind: 'review_hash'
  })

  await upsertMemoryEdgeFromRoot(root, edge)

  await expect(readMemoryEdgesFromRoot(root)).resolves.toEqual([edge])
})

it('marks a validated relation rejected and records an invalidation receipt', async () => {
  const root = await makeTempMemoryRoot()
  await upsertMemoryEdgeFromRoot(root, memoryEdgeFixture({ id: 'edge-bad', status: 'validated' }))

  await transitionMemoryEdgeStatusFromRoot(root, {
    id: 'edge-bad',
    status: 'rejected',
    now: '2026-06-07T00:00:00.000Z',
    reason: 'relation_edge_invalidated',
    details: { reviewer: 'benchmark' }
  })

  expect((await readMemoryEdgesFromRoot(root))[0]).toMatchObject({ id: 'edge-bad', status: 'rejected' })
  expect(await readMemoryEventsFromRoot(root)).toEqual([
    expect.objectContaining({
      action: 'audit',
      reason: 'relation_edge_invalidated',
      memoryId: 'edge-bad'
    })
  ])
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm run test -- tests/memory-store.test.ts
```

Expected: fail because `MemoryEdge`, `readMemoryEdgesFromRoot`, `upsertMemoryEdgeFromRoot`, and `transitionMemoryEdgeStatusFromRoot` do not exist.

- [ ] **Step 3: Add relation types**

In `src/memory/types.ts`, add exported constants/types/interfaces:

```ts
export const MEMORY_RELATION_TYPES = [
  'supports',
  'contradicts',
  'supersedes',
  'refines',
  'derived_from',
  'similar_to',
  'warns_against',
  'transfers_to'
] as const
export type MemoryRelationType = typeof MEMORY_RELATION_TYPES[number]

export const MEMORY_EDGE_STATUSES = ['trial', 'validated', 'rejected', 'expired', 'superseded'] as const
export type MemoryEdgeStatus = typeof MEMORY_EDGE_STATUSES[number]

export const MEMORY_EDGE_ORIGINS = ['deterministic', 'model', 'operation'] as const
export type MemoryEdgeOrigin = typeof MEMORY_EDGE_ORIGINS[number]

export const MEMORY_EDGE_EVIDENCE_KINDS = [
  'normalized_key',
  'content_hash',
  'review_hash',
  'activation_feedback',
  'distillation_input',
  'project_similarity',
  'model_hint'
] as const
export type MemoryEdgeEvidenceKind = typeof MEMORY_EDGE_EVIDENCE_KINDS[number]

export interface MemoryEdge {
  id: string
  fromMemoryId: string
  toMemoryId: string
  fromScope: MemoryScope
  toScope: MemoryScope
  fromProjectId?: string
  toProjectId?: string
  relationType: MemoryRelationType
  status: MemoryEdgeStatus
  confidence: number
  origin: MemoryEdgeOrigin
  reason: string
  evidenceId?: string
  evidenceKind?: MemoryEdgeEvidenceKind
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
}
```

- [ ] **Step 4: Add edge store APIs**

In `src/memory/memory-store.ts`, add `MEMORY_EDGES_FILE = 'memory_edges.jsonl'` and exported APIs:

```ts
export async function readMemoryEdgesFromRoot(memoryRoot: string): Promise<MemoryEdge[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) return []
  return readJsonLines<MemoryEdge>(join(memoryRoot, MEMORY_EDGES_FILE))
}

export async function writeMemoryEdgesFromRoot(memoryRoot: string, edges: MemoryEdge[]): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await writeJsonLinesAtomic(join(root, MEMORY_EDGES_FILE), edges)
}

export async function upsertMemoryEdgeFromRoot(memoryRoot: string, edge: MemoryEdge): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  const current = await readMemoryEdgesFromRoot(root)
  const next = upsertMemoryEdges(current, [edge])
  await writeMemoryEdgesFromRoot(root, next)
}

export async function transitionMemoryEdgeStatusFromRoot(
  memoryRoot: string,
  input: {
    id: string
    status: MemoryEdgeStatus
    now: string
    reason: string
    details?: Record<string, unknown>
  }
): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  const current = await readMemoryEdgesFromRoot(root)
  const edge = current.find((item) => item.id === input.id)
  if (edge === undefined) throw new Error(`Memory edge not found: ${input.id}`)
  await writeMemoryEdgesFromRoot(root, current.map((item) =>
    item.id === input.id ? { ...item, status: input.status, updatedAt: input.now } : item
  ))
  await appendMemoryEventFromRoot(root, {
    id: randomUUID(),
    action: 'audit',
    at: input.now,
    reason: input.reason,
    memoryId: input.id,
    details: {
      relationType: edge.relationType,
      fromMemoryId: edge.fromMemoryId,
      toMemoryId: edge.toMemoryId,
      previousStatus: edge.status,
      nextStatus: input.status,
      ...(input.details ?? {})
    }
  })
}
```

Also add a local `upsertMemoryEdges()` helper that replaces by `id` and preserves deterministic order by `createdAt` then `id`.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
npm run test -- tests/memory-store.test.ts
npm run typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/memory/types.ts src/memory/memory-store.ts tests/memory-store.test.ts
git commit -m "feat: add durable memory relation edge store"
```

---

### Task 2: Deterministic Relation Helper And Lifecycle Rules

**Files:**
- Create: `src/memory/memory-relations.ts`
- Test: `tests/memory-relations.test.ts`

- [ ] **Step 1: Write failing relation helper tests**

Create `tests/memory-relations.test.ts` with tests for traversal policy and operation-backed validation:

```ts
it('treats similar_to as diagnostics only for ordinary expansion', () => {
  expect(relationExpansionPolicy('similar_to')).toEqual({ runtime: false, diagnostics: true })
})

it('uses supersedes from replacement to old and suppresses old active truth', () => {
  const edge = memoryEdgeFixture({ fromMemoryId: 'new', toMemoryId: 'old', relationType: 'supersedes', status: 'validated' })
  expect(resolveRelationExpansion({ seedMemoryId: 'old', edge })).toEqual({
    includeMemoryId: 'new',
    suppressMemoryIds: ['old'],
    reason: 'supersedes_replacement'
  })
})

it('keeps model-origin high impact edges trial only', () => {
  const edge = createModelHintEdge({
    fromMemoryId: 'candidate',
    toMemoryId: 'old',
    relationType: 'supersedes',
    now: '2026-06-07T00:00:00.000Z',
    reason: 'model suggested supersede'
  })

  expect(edge).toMatchObject({ status: 'trial', origin: 'model', evidenceKind: 'model_hint' })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm run test -- tests/memory-relations.test.ts
```

Expected: fail because `memory-relations.ts` does not exist.

- [ ] **Step 3: Implement relation helper**

Create `src/memory/memory-relations.ts` with:

```ts
export const ORDINARY_RUNTIME_RELATIONS = new Set<MemoryRelationType>([
  'supports',
  'supersedes',
  'refines',
  'derived_from',
  'warns_against',
  'transfers_to'
])

export function relationExpansionPolicy(relationType: MemoryRelationType): {
  runtime: boolean
  diagnostics: boolean
} {
  if (relationType === 'similar_to' || relationType === 'contradicts') return { runtime: false, diagnostics: true }
  return { runtime: ORDINARY_RUNTIME_RELATIONS.has(relationType), diagnostics: true }
}

export function resolveRelationExpansion(input: {
  seedMemoryId: string
  edge: MemoryEdge
}): { includeMemoryId?: string; suppressMemoryIds: string[]; reason: string } {
  const { seedMemoryId, edge } = input
  if (edge.status !== 'validated') return { suppressMemoryIds: [], reason: 'edge_not_validated' }
  if (!relationExpansionPolicy(edge.relationType).runtime) return { suppressMemoryIds: [], reason: 'diagnostics_only' }
  if (edge.relationType === 'supersedes' && seedMemoryId === edge.toMemoryId) {
    return { includeMemoryId: edge.fromMemoryId, suppressMemoryIds: [edge.toMemoryId], reason: 'supersedes_replacement' }
  }
  if (edge.relationType === 'supersedes' && seedMemoryId === edge.fromMemoryId) {
    return { suppressMemoryIds: [edge.toMemoryId], reason: 'supersedes_evidence_only' }
  }
  if (seedMemoryId === edge.fromMemoryId) return { includeMemoryId: edge.toMemoryId, suppressMemoryIds: [], reason: edge.relationType }
  if (seedMemoryId === edge.toMemoryId && (edge.relationType === 'supports' || edge.relationType === 'refines')) {
    return { includeMemoryId: edge.fromMemoryId, suppressMemoryIds: [], reason: edge.relationType }
  }
  return { suppressMemoryIds: [], reason: 'wrong_direction' }
}
```

Add constructors for:

- `stableMemoryEdgeId(edge input)` using stable JSON + sha256.
- `createModelHintEdge(...)` always `status: 'trial'`, `origin: 'model'`.
- `createOperationBackedEdge(...)` allows `status: 'validated'` only with `evidenceId` and allowed `evidenceKind`.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
npm run test -- tests/memory-relations.test.ts
npm run typecheck
```

Expected: both pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/memory/memory-relations.ts tests/memory-relations.test.ts
git commit -m "feat: add deterministic memory relation semantics"
```

---

### Task 3: SQLite Projection For Durable Relations

**Files:**
- Modify: `src/memory/memory-index.ts`
- Modify: `tests/memory-index.test.ts`

- [ ] **Step 1: Write failing projection tests**

Extend `tests/memory-index.test.ts` with:

```ts
it('projects durable memory-to-memory relation edges during index rebuild', async () => {
  const fixture = await createIndexFixture()
  await writeActiveMemoriesFromRoot(fixture.projectRoot, [activeMemoryFixture({ id: 'new' }), activeMemoryFixture({ id: 'old' })])
  await upsertMemoryEdgeFromRoot(fixture.projectRoot, memoryEdgeFixture({
    id: 'edge-new-old',
    fromMemoryId: 'new',
    toMemoryId: 'old',
    fromScope: 'project',
    toScope: 'project',
    fromProjectId: fixture.projectId,
    toProjectId: fixture.projectId,
    relationType: 'supersedes',
    status: 'validated'
  }))

  const adapter = await openMemoryIndexAdapter({ dbPath: fixture.dbPath })
  await adapter.rebuildFromRoots([{ memoryRoot: fixture.projectRoot, projectId: fixture.projectId, scope: 'project' }])

  await expect(adapter.queryMemoryEdges({ fromId: 'new', status: 'approved' })).resolves.toEqual([
    expect.objectContaining({
      edgeType: 'relation:supersedes',
      fromKind: 'memory',
      toKind: 'memory',
      source: 'deterministic'
    })
  ])
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm run test -- tests/memory-index.test.ts
```

Expected: fail because rebuild does not read durable edges.

- [ ] **Step 3: Project durable edges**

Modify `src/memory/memory-index.ts`:

- Import `readMemoryEdgesFromRoot`.
- Extend `syncRootRecords()` to read edges with active/pending memories.
- Insert durable relation edges only when both endpoints exist in the same projected root or a safe global/project route is represented.
- Map `MemoryEdge.status === 'validated'` to index status `approved`; map `trial` to `pending`; map `rejected|expired|superseded` to `rejected`.
- Use `edgeType = relation:${relationType}` and `toKind = 'memory'`.
- Preserve existing `deriveIndexedDeterministicMemoryEdges()` for file-trace edges.
- Add schema columns only if needed for denormalized metadata; if using `payload_json` in `memory_edges`, add migration via `alter table` guarded against duplicate columns.

- [ ] **Step 4: Run projection tests**

Run:

```bash
npm run test -- tests/memory-index.test.ts
npm run typecheck
```

Expected: both pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/memory/memory-index.ts tests/memory-index.test.ts
git commit -m "feat: project memory relation edges into sqlite"
```

---

### Task 4: Relation-Aware Runtime Expansion

**Files:**
- Modify: `src/codex/continuity-context.ts`
- Modify: `src/memory/memory-retriever.ts`
- Test: `tests/codex-continuity-context.test.ts`
- Test: `tests/memory-retriever.test.ts`

- [ ] **Step 1: Write failing runtime expansion tests**

Add context tests:

```ts
it('uses a validated supersedes edge to replace stale seed memory', async () => {
  const fixture = await createContinuityFixture()
  await seedActiveProjectMemories(fixture, [
    activeMemoryFixture({ id: 'old-rule', content: 'Use the old relation workflow.', normalizedKey: 'relation-workflow' }),
    activeMemoryFixture({ id: 'new-rule', content: 'Use the new relation workflow.', normalizedKey: 'relation-workflow-new' })
  ])
  await upsertMemoryEdgeFromRoot(fixture.projectMemoryRoot, memoryEdgeFixture({
    fromMemoryId: 'new-rule',
    toMemoryId: 'old-rule',
    relationType: 'supersedes',
    status: 'validated',
    fromProjectId: fixture.projectId,
    toProjectId: fixture.projectId
  }))
  await rebuildFixtureIndex(fixture)

  const context = await getCodexContinuityContext({
    cwd: fixture.cwd,
    userMessage: 'old relation workflow',
    task: 'coding',
    mode: 'balanced',
    includeDiagnostics: true
  })

  expect(context.memory.items.map((item) => item.content)).toContain('Use the new relation workflow.')
  expect(context.memory.items.map((item) => item.content)).not.toContain('Use the old relation workflow.')
  expect(context.projectMemory[0]?.explain).toEqual(expect.arrayContaining(['edge:relation:supersedes']))
})

it('does not expand similar_to during ordinary runtime retrieval', async () => {
  const fixture = await createContinuityFixture()
  await seedActiveProjectMemories(fixture, [
    activeMemoryFixture({ id: 'seed', content: 'Primary relation benchmark memory.' }),
    activeMemoryFixture({ id: 'duplicate', content: 'Duplicate relation benchmark memory.' })
  ])
  await upsertMemoryEdgeFromRoot(fixture.projectMemoryRoot, memoryEdgeFixture({
    fromMemoryId: 'seed',
    toMemoryId: 'duplicate',
    relationType: 'similar_to',
    status: 'validated'
  }))
  await rebuildFixtureIndex(fixture)

  const context = await getCodexContinuityContext({ cwd: fixture.cwd, userMessage: 'Primary relation benchmark', task: 'coding' })

  expect(context.memory.items.map((item) => item.id)).toContain('seed')
  expect(context.memory.items.map((item) => item.id)).not.toContain('duplicate')
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm run test -- tests/codex-continuity-context.test.ts tests/memory-retriever.test.ts
```

Expected: fail because runtime does not expand relation edges.

- [ ] **Step 3: Implement expansion helper**

Add a local helper in `continuity-context.ts` or a new `src/codex/relation-expansion.ts`:

- Query `adapter.queryMemoryEdges()` for selected seed memories only.
- Allow only `approved` index edges with `edgeType` prefix `relation:`.
- Convert to relation type and call `resolveRelationExpansion()`.
- Fetch related memory from already queried route rows when available; if not available, issue bounded `queryActive` with empty query and filter by id.
- Enforce scope/project guard by comparing edge metadata and memory payload metadata.
- Never include `similar_to`; keep `contradicts` diagnostics-only.
- Do not write durable `lastUsedAt` in this path.
- Add `edge:relation:<type>` to explanation for included relation results.

- [ ] **Step 4: Add JSONL fallback guard**

In `memory-retriever.ts`, add optional relation fallback only when `allowJsonlFallback` path is already used and roots are readable:

- Read durable edges.
- Expand only validated same-root safe edges.
- Fail closed on malformed store by returning seed results without expansion.
- Do not cross project boundary in JSONL fallback.

- [ ] **Step 5: Run runtime tests**

Run:

```bash
npm run test -- tests/codex-continuity-context.test.ts tests/memory-retriever.test.ts
npm run typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/codex/continuity-context.ts src/memory/memory-retriever.ts tests/codex-continuity-context.test.ts tests/memory-retriever.test.ts
git commit -m "feat: expand validated memory relations at runtime"
```

---

### Task 5: Preview, Profile, And Daily Maintenance

**Files:**
- Modify: `src/codex/memory-context-preview.ts`
- Modify: `src/codex/memory-lifecycle-profile.ts`
- Modify: `src/codex/codex-memory-lifecycle-daily.ts`
- Test: `tests/codex-continuity-context.test.ts`
- Test: `tests/codex-memory-lifecycle-daily.test.ts`

- [ ] **Step 1: Write failing preview/profile/automation tests**

Add tests:

```ts
it('shows trial relation hints only in review diagnostics', async () => {
  const fixture = await createContinuityFixture()
  await upsertMemoryEdgeFromRoot(fixture.projectMemoryRoot, memoryEdgeFixture({
    id: 'edge-model-trial',
    relationType: 'refines',
    status: 'trial',
    origin: 'model',
    evidenceKind: 'model_hint'
  }))

  const fast = await runCodexMemoryContextPreview({ cwd: fixture.cwd, userMessage: 'relation hints', mode: 'fast' })
  const review = await runCodexMemoryContextPreview({ cwd: fixture.cwd, userMessage: 'relation hints', mode: 'review', includeDiagnostics: true })

  expect(JSON.stringify(fast)).not.toContain('edge-model-trial')
  expect(JSON.stringify(review)).toContain('edge-model-trial')
})

it('daily automation expires edges whose related memory is missing', async () => {
  const root = await makeTempMemoryRoot()
  await upsertMemoryEdgeFromRoot(root, memoryEdgeFixture({ id: 'edge-orphan', toMemoryId: 'missing', status: 'validated' }))

  const result = await runCodexMemoryLifecycleDaily({
    projectRoots: [{ projectId: 'project-a', memoryRoot: root }],
    apply: true,
    now: '2026-06-07T00:00:00.000Z'
  })

  expect(result.roots[0]).toMatchObject({ expiredRelationEdges: 1 })
  expect((await readMemoryEdgesFromRoot(root))[0]).toMatchObject({ id: 'edge-orphan', status: 'expired' })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm run test -- tests/codex-continuity-context.test.ts tests/codex-memory-lifecycle-daily.test.ts
```

Expected: fail because relation diagnostics and daily edge maintenance do not exist.

- [ ] **Step 3: Add preview relation diagnostics**

Update `CodexMemoryContextPreview` with a bounded `diagnostics.relations` section:

```ts
relations?: {
  included: Array<{ edgeId: string; relationType: string; fromMemoryId: string; toMemoryId: string; reason: string }>
  filtered: Array<{ edgeId: string; relationType: string; status: string; reason: string }>
}
```

Only include trial/model edge details in review mode or when `includeDiagnostics === true`.

- [ ] **Step 4: Add profile safety filter**

Keep profile generation source as core memories. Add optional relation-aware filter that excludes core memory if a validated `supersedes` edge points from a newer active memory to that memory. Do not generate new profile lines from relations.

- [ ] **Step 5: Add daily edge maintenance**

In `runDailyForReadableRoot()`:

- Read `readMemoryEdgesFromRoot(root.memoryRoot)`.
- If related memory id is missing, transition `validated/trial -> expired`.
- If model-only high-impact edge is `trial`, leave it trial and add recommendation count only if result shape already has recommendations.
- Add `relationEdgesExpired`, `relationEdgesValidated`, `relationEdgesRejected` counters to `DailyLifecycleRootResult`.
- Write receipts through `transitionMemoryEdgeStatusFromRoot()`.

- [ ] **Step 6: Run tests**

Run:

```bash
npm run test -- tests/codex-continuity-context.test.ts tests/codex-memory-lifecycle-daily.test.ts
npm run typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/codex/memory-context-preview.ts src/codex/memory-lifecycle-profile.ts src/codex/codex-memory-lifecycle-daily.ts tests/codex-continuity-context.test.ts tests/codex-memory-lifecycle-daily.test.ts
git commit -m "feat: maintain and explain memory relation edges"
```

---

### Task 6: Relation Benchmark Gates

**Files:**
- Modify: `benchmark/catalog.ts`
- Modify: `benchmark/cases/tier1-6-core-mechanisms.ts`
- Modify: `benchmark/types.ts`
- Test: `tests/benchmark-cases-tier0.test.ts`
- Test: `tests/benchmark-runner.test.ts`
- Test: `tests/benchmark-types.test.ts`

- [ ] **Step 1: Write failing benchmark tests**

Add assertions that catalog contains the eight relation cases and that gate profile runs them deterministically:

```ts
it('includes v1.6 relation quality gate cases', () => {
  expect(BENCHMARK_CASE_IDS).toEqual(expect.arrayContaining([
    'T16-REL-SUPERSEDES-DIRECTION',
    'T16-REL-SIMILAR-NO-EXPANSION',
    'T16-REL-DERIVED-TRIAL-BLOCK',
    'T16-REL-TRANSFER-HINT-ONLY',
    'T16-REL-TRIAL-HINT-EXCLUSION',
    'T16-REL-EDGE-INVALIDATION',
    'T16-REL-FALLBACK-SCOPE-GUARD',
    'T16-REL-LASTUSED-HOTPATH'
  ]))
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm run test -- tests/benchmark-types.test.ts tests/benchmark-runner.test.ts tests/benchmark-cases-tier0.test.ts
```

Expected: fail because new case ids are missing.

- [ ] **Step 3: Add catalog cases**

Add `caseSpec()` entries matching the spec. Use existing metric ids only:

- `retrievalAccuracy`
- `staleMemoryLeakageRate`
- `replacementAccuracy`
- `irrelevantRetrievalRate`
- `duplicateActiveMemoryRate`
- `tokenOverhead`
- `profilePollutionRate`
- `promotionAccuracy`
- `crossProjectPollutionRate`
- `similarHintMigrationRate`
- `pendingLeakageRate`
- `sessionHintsCount`
- `auditLogGrowth`
- `jsonlFallbackRateHotPath`
- `indexSourceMismatchCount`
- `retrievedDefaultWriteRate`
- `hotPathRebuildCount`
- `activationEventGrowth`

- [ ] **Step 4: Implement relation case assertions**

Extend `Tier16CaseId` and `CASES` in `benchmark/cases/tier1-6-core-mechanisms.ts`.

Each case should:

- Use isolated fixture memory roots.
- Seed semantic memories and durable edges directly.
- Rebuild SQLite index where runtime retrieval is under test.
- Call real `getCodexContinuityContext()`, `runCodexMemoryContextPreview()`, `runCodexMemoryLifecycleDaily()`, or store APIs.
- Return evidence with metric names matching catalog.
- Throw with mapped hard gate failure if forbidden content appears.

- [ ] **Step 5: Run benchmark tests**

Run:

```bash
npm run test -- tests/benchmark-types.test.ts tests/benchmark-runner.test.ts tests/benchmark-cases-tier0.test.ts
cyrene-continuity codex benchmark run --profile smoke
cyrene-continuity codex benchmark run --profile gate
```

Expected: all pass, relation cases included in `gate` report.

- [ ] **Step 6: Commit Task 6**

```bash
git add benchmark/catalog.ts benchmark/cases/tier1-6-core-mechanisms.ts benchmark/types.ts tests/benchmark-types.test.ts tests/benchmark-runner.test.ts tests/benchmark-cases-tier0.test.ts
git commit -m "feat: add relation quality benchmark gates"
```

---

### Task 7: Integration Verification And Cleanup

**Files:**
- Review all changed files.
- Do not edit `REVIEW_REPORT.md`.
- Do not edit generated plugin runtime files directly.

- [ ] **Step 1: Run targeted tests**

```bash
npm run test -- tests/memory-store.test.ts tests/memory-relations.test.ts tests/memory-index.test.ts tests/memory-retriever.test.ts tests/codex-continuity-context.test.ts
npm run test -- tests/codex-memory-lifecycle-daily.test.ts tests/benchmark-types.test.ts tests/benchmark-runner.test.ts tests/benchmark-cases-tier0.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Run runtime benchmark verification**

```bash
cyrene-continuity codex benchmark run --profile smoke
cyrene-continuity codex benchmark run --profile gate
```

Expected:

- `smoke` report passes.
- `gate` report passes.
- `T16-REL-*` cases appear in the gate/full catalog and relation gate evidence.
- No real user memory root is read or written by fixtures.

- [ ] **Step 5: Inspect diff boundaries**

Run:

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
git status --short
```

Expected:

- Only source/tests/benchmark/plan files changed.
- `plugin/` generated runtime files unchanged.
- `REVIEW_REPORT.md` unchanged.
- Working tree clean after final commit.

- [ ] **Step 6: Final commit if needed**

If verification required cleanup edits:

```bash
git add src/memory src/codex benchmark tests docs/superpowers/plans/2026-06-07-cyrene-v1-6-memory-relation-layer.md
git commit -m "chore: verify v1.6 relation layer integration"
```

---

## Self-Review

- Spec coverage: durable edge store, SQLite projection, relation-specific traversal, trial/model safety, operation-backed validation, context-preview, profile safety, daily maintenance, benchmark gates, and multi-agent execution are covered.
- Placeholder scan: no unresolved placeholders or unspecified file paths remain.
- Type consistency: plan uses `MemoryEdge`, `MemoryRelationType`, `MemoryEdgeStatus`, `MemoryEdgeOrigin`, `MemoryEdgeEvidenceKind`, `readMemoryEdgesFromRoot`, `upsertMemoryEdgeFromRoot`, and `transitionMemoryEdgeStatusFromRoot` consistently.
- Execution risk: the largest integration risk is `continuity-context.ts`; Task 4 explicitly routes relation logic through helpers to avoid broad inline rewrites.
