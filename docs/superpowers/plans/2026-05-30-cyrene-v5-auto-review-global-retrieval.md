# Cyrene v5 Auto Review, Global Memory, and Multi-Facet Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `Cyrene Continuity v5` 的 shared contracts、active memory lifecycle、Auto Review/Triage、global memory capture、multi-facet retrieval、`memory_edges`、pending budget enforcement，并为多 subagent 并行执行提供清晰边界。

**Architecture:** 先落 shared policy/config/schema/eval 基础，再按 P0-P4 lane 并行推进。所有 mutation path 走 lock 内 re-read、policy/eval、JSONL write、`MemoryEvent` receipt、index sync；`continuity_get` 只读，使用 query planner、facet scoring、graph edges 和 explain diagnostics。

**Tech Stack:** TypeScript, Node.js 22 `node:sqlite`, Vitest, local JSONL memory store, SQLite/FTS index, static Web UI, Codex plugin runtime.

---

## Scope Check

这个 spec 覆盖多个子系统，不能作为一个无分工的线性实现。执行方式必须是 coordinator-led：

- Task 1 是共享基础，必须先做。
- Task 2-3 是 P0 active lifecycle，可以由一个 subagent 负责。
- Task 4-5 是 P1/P4 triage + pending budget，可以由一个或两个 subagents 负责，但 Task 5 依赖 Task 4 的 ranking/triage contracts。
- Task 6 是 P2 global capture，可以在 Task 1 后开始，启用 auto-promote 依赖 Task 4。
- Task 7-8 是 P3 retrieval/graph，可以在 Task 1 后开始。
- Task 9 是 Web UI，可以在 API shape 稳定后开始。
- Task 10 是 eval/docs/release gate，贯穿集成阶段。

## File Structure

### Create

- `src/codex/active-memory-review.ts`: active memory archive/tombstone/propose-edit/supersede 核心逻辑。
- `src/codex/codex-memory-active-cli.ts`: active memory CLI formatter and command runners。
- `src/codex/memory-triage.ts`: triage decisions、candidate clusters、auto-promotion policy、pending ranking。
- `src/codex/memory-pending-budget.ts`: pending budget enforcement and eviction。
- `src/codex/global-memory-capture.ts`: explicit global phrase detection and review-derived global candidates。
- `src/codex/retrieval-planner.ts`: query planner、facet types、explain reason helpers。
- `tests/codex-active-memory-review.test.ts`
- `tests/codex-memory-triage.test.ts`
- `tests/codex-memory-pending-budget.test.ts`
- `tests/global-memory-capture.test.ts`
- `tests/retrieval-planner.test.ts`

### Modify

- `AGENTS.md`: update v5 policy invariant before auto-active writes ship。
- `README.md`: document v5 commands and changed policy。
- `plugin/skills/cyrene-continuity/SKILL.md`: update review/auto-promotion guidance, then rebuild plugin。
- `src/config.ts`: add v5 caps and pending budget config。
- `src/memory/types.ts`: add `review_event` source, active lifecycle event actions, v5 audit detail fields, and `memory_edges` value types。
- `src/memory/memory-store.ts`: reuse existing root-scoped active/pending/tombstone/event writers and add `readMemoryEventsFromRoot()` for P1 daily caps and P2 review-derived patterns。
- `src/memory/memory-validator.ts`: expose stricter v5 policy helpers without weakening manual review validation。
- `src/memory/memory-index.ts`: add `memory_edges`, query APIs, and explain fields。
- `src/memory/memory-retriever.ts`: use retrieval planner in JSONL fallback scoring。
- `src/codex/memory-propose.ts`: integrate pending budget and strict auto-promote decision path。
- `src/codex/memory-review.ts`: use active lifecycle helpers and triage summaries。
- `src/codex/codex-cli.ts`: route `memory active ...` and `memory triage ...` commands。
- `src/codex/codex-ui-api.ts`: route active-memory and triage APIs。
- `src/codex/continuity-context.ts`: call retrieval planner, query graph edges, return explain diagnostics。
- `src/eval/eval-runner.ts`: add v5 eval gates。
- `src/mcp/mcp-server.ts`: expose v5 tools only after CLI/API behavior exists。
- `src/mcp/tools/memory-review.ts`: add active lifecycle and triage handlers for the registered v5 MCP tools。
- `src/ui/static/app.js`: add Triage tab, active row actions, retrieval explain view。
- `src/ui/static/styles.css`: add styles for triage clusters, receipts, and explain reasons。
- `tests/codex-cli.test.ts`
- `tests/codex-ui-api.test.ts`
- `tests/codex-ui-assets.test.ts`
- `tests/eval-runner.test.ts`
- `tests/memory-index.test.ts`
- `tests/memory-retriever.test.ts`
- `tests/codex-continuity-context.test.ts`
- `tests/mcp-server.test.ts`

---

### Task 1: Shared v5 Policy, Config, and Types

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `plugin/skills/cyrene-continuity/SKILL.md`
- Modify: `src/config.ts`
- Modify: `src/memory/types.ts`
- Test: `tests/codex-memory-promotion-policy.test.ts`
- Test: `tests/codex-cli.test.ts`

- [ ] **Step 1: Write failing config/type tests**

Add to `tests/codex-memory-promotion-policy.test.ts`:

```ts
import { createDefaultConfig } from '../src/config.js'
import { MEMORY_SOURCES, type MemoryEvent } from '../src/memory/types.js'

it('loads v5 auto-review caps and pending budgets from env', () => {
  process.env.CYRENE_AUTO_REVIEW_PROJECT_PROMOTE_PER_DAY = '7'
  process.env.CYRENE_AUTO_REVIEW_GLOBAL_PROMOTE_PER_DAY = '2'
  process.env.CYRENE_PENDING_MAX_ITEMS_PROJECT = '250'
  process.env.CYRENE_PENDING_MAX_ITEMS_GLOBAL = '125'
  process.env.CYRENE_PENDING_PROTECTED_MAX_AGE_DAYS = '45'

  const config = createDefaultConfig(process.cwd())

  expect(config.memoryAutoReviewProjectPromotePerDay).toBe(7)
  expect(config.memoryAutoReviewGlobalPromotePerDay).toBe(2)
  expect(config.memoryPendingMaxItemsProject).toBe(250)
  expect(config.memoryPendingMaxItemsGlobal).toBe(125)
  expect(config.memoryPendingProtectedMaxAgeDays).toBe(45)
})

it('supports review_event memory source for review-derived global learning', () => {
  expect(MEMORY_SOURCES).toContain('review_event')
})

it('allows v5 audit details on memory events', () => {
  const event: MemoryEvent = {
    id: 'event-v5',
    action: 'audit',
    at: '2026-05-30T00:00:00.000Z',
    reason: 'Auto-promoted by v5 policy.',
    candidateId: 'candidate-v5',
    details: {
      policyId: 'low_risk_project_memory_v1',
      decision: 'auto_promote',
      evalGate: { passed: true, failedChecks: [] }
    }
  }
  expect(event.details?.policyId).toBe('low_risk_project_memory_v1')
})
```

- [ ] **Step 2: Run RED for shared config/type tests**

Run:

```bash
npx vitest run tests/codex-memory-promotion-policy.test.ts -t "v5 auto-review caps|review_event|v5 audit details"
```

Expected: FAIL because `AppConfig` lacks the v5 fields and `MEMORY_SOURCES` lacks `review_event`.

- [ ] **Step 3: Extend config and memory source types**

In `src/config.ts`, extend `AppConfig`:

```ts
  memoryAutoReviewProjectPromotePerDay: number
  memoryAutoReviewGlobalPromotePerDay: number
  memoryPendingMaxItemsProject: number
  memoryPendingMaxItemsGlobal: number
  memoryPendingProtectedMaxAgeDays: number
```

In `createDefaultConfig()`, add:

```ts
    memoryAutoReviewProjectPromotePerDay: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_AUTO_REVIEW_PROJECT_PROMOTE_PER_DAY'), 5),
    memoryAutoReviewGlobalPromotePerDay: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_AUTO_REVIEW_GLOBAL_PROMOTE_PER_DAY'), 1),
    memoryPendingMaxItemsProject: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_PENDING_MAX_ITEMS_PROJECT'), 200),
    memoryPendingMaxItemsGlobal: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_PENDING_MAX_ITEMS_GLOBAL'), 100),
    memoryPendingProtectedMaxAgeDays: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_PENDING_PROTECTED_MAX_AGE_DAYS'), 30),
```

In `src/memory/types.ts`, add `review_event`:

```ts
export const MEMORY_SOURCES = [
  'user_explicit',
  'user_implicit',
  'assistant_observed',
  'tool_trace',
  'file',
  'legacy_markdown',
  'review_event'
] as const
```

- [ ] **Step 4: Update policy docs before enabling auto-active writes**

Modify `AGENTS.md` to replace the old pending-only invariant with:

```md
- Preserve the v5 memory review model: high-risk or ambiguous memory still
  requires explicit user approval and review-hash validation. Strict low-risk
  project/global memory may auto-promote only through named v5 policy, daily
  caps, eval gates, and auditable `MemoryEvent` receipts.
```

Modify `README.md` under Review Policy to state:

```md
Cyrene v5 allows strict, capped auto-promotion only for low-risk project or
procedural/system global memory that passes named policy and eval gates.
Personal, relationship, affective, ambiguous, similar-project, and
assistant-observed-only candidates remain manual review items.
```

Modify `plugin/skills/cyrene-continuity/SKILL.md` to mirror the same policy in the operational rules.

- [ ] **Step 5: Run GREEN for shared tests**

Run:

```bash
npx vitest run tests/codex-memory-promotion-policy.test.ts -t "v5 auto-review caps|review_event|v5 audit details"
```

Expected: PASS.

- [ ] **Step 6: Rebuild plugin after skill change**

Run:

```bash
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit shared policy foundation**

```bash
git add AGENTS.md README.md plugin/skills/cyrene-continuity/SKILL.md src/config.ts src/memory/types.ts tests/codex-memory-promotion-policy.test.ts plugin/runtime/cyrene-continuity.mjs
git commit -m "feat: add v5 memory policy foundation"
```

---

### Task 2: P0 Active Memory Lifecycle Core

**Files:**
- Create: `src/codex/active-memory-review.ts`
- Modify: `src/codex/memory-review.ts`
- Test: `tests/codex-active-memory-review.test.ts`

- [ ] **Step 1: Write failing active lifecycle tests**

Create `tests/codex-active-memory-review.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { archiveCodexActiveMemory, contentHashForActiveMemory, proposeEditCodexActiveMemory, supersedeCodexActiveMemory, tombstoneCodexActiveMemory } from '../src/codex/active-memory-review.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { reviewHashForPendingMemory } from '../src/codex/memory-review.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import type { CyreneMemory, MemoryEvent, MemoryTombstone, PendingMemory } from '../src/memory/types.js'

const originalHome = process.env.HOME
const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function active(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'active',
    content: 'Active memory can be archived safely.',
    normalizedKey: 'active-memory-lifecycle',
    evidence: [{ summary: 'Seed active memory.' }],
    source: 'file',
    scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.9, safety: 0.95, sensitivity: 0.1 },
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
    tags: ['lifecycle'],
    ...overrides
  }
}

async function seed(cwd: string, memories: CyreneMemory[]): Promise<string> {
  const project = await identifyCodexProject(cwd)
  const root = codexProjectMemoryRoot(project.projectId)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'index.jsonl'), memories.map((item) => JSON.stringify(item)).join('\n') + '\n')
  return root
}

function jsonl<T>(text: string): T[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as T)
}

describe('Codex active memory lifecycle', () => {
  it('archives active memory without creating a blocking tombstone', async () => {
    const home = await createTempDir('cyrene-active-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-active-project-')
    const memory = active()
    const root = await seed(cwd, [memory])

    const result = await archiveCodexActiveMemory({ cwd, id: memory.id, contentHash: contentHashForActiveMemory(memory), reason: 'Stale.', now: '2026-05-30T01:00:00.000Z' })

    expect(result.result.action).toBe('archive')
    expect(await readFile(join(root, 'index.jsonl'), 'utf8')).toBe('')
    await expect(readFile(join(root, 'tombstones.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const events = jsonl<MemoryEvent>(await readFile(join(root, 'events.jsonl'), 'utf8'))
    expect(events[0]).toMatchObject({ action: 'archive', memoryId: memory.id, reason: 'Stale.' })
  })

  it('archives global active memory from the global root', async () => {
    const home = await createTempDir('cyrene-active-global-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-active-global-project-')
    const memory = active({ id: 'global-active-1', scope: 'global', domain: 'procedural', type: 'procedural_rule' })
    const root = codexGlobalMemoryRoot()
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'index.jsonl'), `${JSON.stringify(memory)}\n`)

    const result = await archiveCodexActiveMemory({ cwd, id: memory.id, contentHash: contentHashForActiveMemory(memory), reason: 'Global stale.', now: '2026-05-30T01:00:00.000Z' })

    expect(result.result.action).toBe('archive')
    expect(await readFile(join(root, 'index.jsonl'), 'utf8')).toBe('')
  })

  it('tombstones active memory with an expiring block', async () => {
    const home = await createTempDir('cyrene-tombstone-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-tombstone-project-')
    const memory = active()
    const root = await seed(cwd, [memory])

    const result = await tombstoneCodexActiveMemory({ cwd, id: memory.id, contentHash: contentHashForActiveMemory(memory), reason: 'Wrong memory.', days: 180, now: '2026-05-30T01:00:00.000Z' })

    expect(result.result.action).toBe('tombstone')
    const tombstones = jsonl<MemoryTombstone>(await readFile(join(root, 'tombstones.jsonl'), 'utf8'))
    expect(tombstones[0]).toMatchObject({ memoryId: memory.id, normalizedKey: memory.normalizedKey, reason: 'archived' })
    expect(tombstones[0].expiresAt).toBe('2026-11-26T01:00:00.000Z')
  })

  it('proposes active edit as a pending replacement', async () => {
    const home = await createTempDir('cyrene-propose-edit-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-propose-edit-project-')
    const memory = active()
    const root = await seed(cwd, [memory])

    const result = await proposeEditCodexActiveMemory({ cwd, id: memory.id, contentHash: contentHashForActiveMemory(memory), content: 'Updated replacement memory.', reason: 'Clarify wording.', now: '2026-05-30T01:00:00.000Z' })

    expect(result.result.action).toBe('propose_edit')
    const pending = jsonl<PendingMemory>(await readFile(join(root, 'pending.jsonl'), 'utf8'))
    expect(pending[0]).toMatchObject({ content: 'Updated replacement memory.', conflictsWith: [memory.id] })
    expect(result.result.reviewHash).toBe(reviewHashForPendingMemory(pending[0]))
  })

  it('supersedes active memory with a pending replacement', async () => {
    const home = await createTempDir('cyrene-supersede-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-supersede-project-')
    const memory = active()
    const root = await seed(cwd, [memory])
    const proposed = await proposeEditCodexActiveMemory({ cwd, id: memory.id, contentHash: contentHashForActiveMemory(memory), content: 'Replacement active memory.', reason: 'Replace.', now: '2026-05-30T01:00:00.000Z' })
    if (proposed.result.action !== 'propose_edit') throw new Error('expected propose_edit')

    const result = await supersedeCodexActiveMemory({ cwd, id: memory.id, candidateId: proposed.result.candidateId, contentHash: contentHashForActiveMemory(memory), reviewHash: proposed.result.reviewHash, reason: 'Accept replacement.', now: '2026-05-30T02:00:00.000Z' })

    expect(result.result.action).toBe('supersede')
    const activeLines = jsonl<CyreneMemory>(await readFile(join(root, 'index.jsonl'), 'utf8'))
    expect(activeLines.map((item) => item.content)).toEqual(['Replacement active memory.'])
    expect(activeLines[0].supersedes).toEqual([memory.id])
  })
})
```

- [ ] **Step 2: Run RED for active lifecycle tests**

Run:

```bash
npx vitest run tests/codex-active-memory-review.test.ts
```

Expected: FAIL because `src/codex/active-memory-review.ts` does not exist.

- [ ] **Step 3: Implement active lifecycle core**

Create `src/codex/active-memory-review.ts` with these exported functions and result types:

```ts
import { createHash, randomUUID } from 'node:crypto'
import { syncCurrentCodexMemoryIndex } from './codex-memory-index.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from './codex-memory-root.js'
import { reviewHashForPendingMemory } from './memory-review.js'
import { identifyCodexProject } from './project-id.js'
import { assertMemoryMaintenanceTargetsSafeFromRoot, withMemoryMaintenanceLockFromRoot } from '../memory/memory-maintenance.js'
import { appendMemoryEventFromRoot, appendTombstoneFromRoot, readActiveMemoriesFromRoot, readPendingMemoriesFromRoot, writeActiveMemoriesFromRoot, writePendingMemoriesFromRoot } from '../memory/memory-store.js'
import { activateCandidate } from '../memory/memory-validator.js'
import type { CyreneMemory, MemoryTombstone, PendingMemory } from '../memory/types.js'

export type ActiveMemoryLifecycleAction = 'archive' | 'tombstone' | 'propose_edit' | 'supersede'

export function contentHashForActiveMemory(memory: CyreneMemory): string {
  return createHash('sha256').update(JSON.stringify({
    id: memory.id,
    content: memory.content,
    normalizedKey: memory.normalizedKey,
    updatedAt: memory.updatedAt,
    status: memory.status
  })).digest('hex')
}

export async function archiveCodexActiveMemory(input: { cwd: string; id: string; contentHash: string; reason: string; now?: string }) {
  return mutateActiveMemory(input.cwd, input.id, input.contentHash, async ({ lockedMemoryRoot, lockedActive, memory, now }) => {
    await writeActiveMemoriesFromRoot(lockedMemoryRoot, lockedActive.filter((item) => item.id !== memory.id))
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'archive',
      at: now,
      reason: input.reason,
      memoryId: memory.id,
      details: { previousStatus: memory.status, normalizedKey: memory.normalizedKey }
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })
    return { result: { action: 'archive' as const, memoryId: memory.id } }
  }, input.now)
}
```

Then add the same file's `tombstoneCodexActiveMemory`, `proposeEditCodexActiveMemory`, `supersedeCodexActiveMemory`, and private helpers:

```ts
export async function tombstoneCodexActiveMemory(input: { cwd: string; id: string; contentHash: string; reason: string; days?: number; indefinite?: boolean; now?: string }) {
  return mutateActiveMemory(input.cwd, input.id, input.contentHash, async ({ lockedMemoryRoot, lockedActive, memory, now }) => {
    const expiresAt = input.indefinite === true ? undefined : addDays(now, input.days ?? 180)
    const tombstone = tombstoneForActiveMemory(memory, { reason: 'archived', now, expiresAt })
    await writeActiveMemoriesFromRoot(lockedMemoryRoot, lockedActive.filter((item) => item.id !== memory.id))
    await appendTombstoneFromRoot(lockedMemoryRoot, tombstone)
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'archive',
      at: now,
      reason: input.reason,
      memoryId: memory.id,
      details: { reviewAction: 'tombstone', tombstoneId: tombstone.id, indefinite: input.indefinite === true }
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })
    return { result: { action: 'tombstone' as const, memoryId: memory.id, tombstone } }
  }, input.now)
}

export async function proposeEditCodexActiveMemory(input: { cwd: string; id: string; contentHash: string; content: string; reason: string; now?: string }) {
  return mutateActiveMemory(input.cwd, input.id, input.contentHash, async ({ lockedMemoryRoot, memory, now }) => {
    const pending: PendingMemory = {
      id: randomUUID(),
      domain: memory.domain,
      type: memory.type,
      strength: memory.strength,
      scope: memory.scope,
      status: 'pending',
      content: input.content,
      normalizedKey: memory.normalizedKey,
      evidence: memory.evidence,
      source: memory.source,
      scores: memory.scores,
      seenCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      expiresAt: addDays(now, 30),
      candidateKind: memory.candidateKind,
      tags: memory.tags,
      conflictsWith: [memory.id]
    }
    const lockedPending = await readPendingMemoriesFromRoot(lockedMemoryRoot)
    await writePendingMemoriesFromRoot(lockedMemoryRoot, [...lockedPending.filter((item) => item.id !== pending.id), pending])
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'pending',
      at: now,
      reason: input.reason,
      memoryId: memory.id,
      candidateId: pending.id,
      details: { reviewAction: 'propose_active_edit' }
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })
    return { result: { action: 'propose_edit' as const, memoryId: memory.id, candidateId: pending.id, reviewHash: reviewHashForPendingMemory(pending) } }
  }, input.now)
}

export async function supersedeCodexActiveMemory(input: { cwd: string; id: string; candidateId: string; contentHash: string; reviewHash: string; reason: string; now?: string }) {
  return mutateActiveMemory(input.cwd, input.id, input.contentHash, async ({ lockedMemoryRoot, lockedActive, memory, now }) => {
    const lockedPending = await readPendingMemoriesFromRoot(lockedMemoryRoot)
    const candidate = lockedPending.find((item) => item.id === input.candidateId)
    if (candidate === undefined) {
      return { result: { action: 'not_found' as const, reason: 'Pending replacement candidate not found' } }
    }
    if (reviewHashForPendingMemory(candidate) !== input.reviewHash) {
      return { result: { action: 'conflict' as const, reason: 'Pending replacement changed since review' } }
    }
    const promoted = { ...activateCandidate({ ...candidate, userConfirmed: true }, now), supersedes: [memory.id] }
    const tombstone = tombstoneForActiveMemory(memory, { reason: 'superseded', now, replacementMemoryId: promoted.id })
    await writeActiveMemoriesFromRoot(lockedMemoryRoot, [...lockedActive.filter((item) => item.id !== memory.id), promoted])
    await writePendingMemoriesFromRoot(lockedMemoryRoot, lockedPending.filter((item) => item.id !== candidate.id))
    await appendTombstoneFromRoot(lockedMemoryRoot, tombstone)
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'supersede',
      at: now,
      reason: input.reason,
      memoryId: promoted.id,
      candidateId: candidate.id,
      details: { supersededMemoryId: memory.id, tombstoneId: tombstone.id }
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })
    return { result: { action: 'supersede' as const, memoryId: promoted.id, supersededMemoryId: memory.id } }
  }, input.now)
}

async function mutateActiveMemory<T>(
  cwd: string,
  id: string,
  contentHash: string,
  fn: (input: { lockedMemoryRoot: string; lockedActive: CyreneMemory[]; memory: CyreneMemory; now: string }) => Promise<T>,
  nowInput?: string
): Promise<T | { result: { action: 'not_found' | 'conflict'; reason: string } }> {
  const now = nowInput ?? new Date().toISOString()
  const project = await identifyCodexProject(cwd)
  const roots = uniqueInOrder([codexGlobalMemoryRoot(), codexProjectMemoryRoot(project.projectId)])
  const found = await findActiveMemoryRoot(roots, id)
  const memoryRoot = found ?? codexProjectMemoryRoot(project.projectId)
  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const lockedActive = await readActiveMemoriesFromRoot(lockedMemoryRoot)
    const memory = lockedActive.find((item) => item.id === id)
    if (memory === undefined) {
      return { result: { action: 'not_found', reason: 'Active memory not found' } }
    }
    if (contentHashForActiveMemory(memory) !== contentHash) {
      return { result: { action: 'conflict', reason: 'Active memory changed since review' } }
    }
    return fn({ lockedMemoryRoot, lockedActive, memory, now })
  })
}

async function findActiveMemoryRoot(roots: string[], id: string): Promise<string | undefined> {
  for (const root of roots) {
    const active = await readActiveMemoriesFromRoot(root)
    if (active.some((memory) => memory.id === id)) return root
  }
  return undefined
}

function tombstoneForActiveMemory(
  memory: CyreneMemory,
  input: { reason: MemoryTombstone['reason']; now: string; expiresAt?: string; replacementMemoryId?: string }
): MemoryTombstone {
  return {
    id: `tombstone-${memory.id}-${createHash('sha256').update(`${memory.updatedAt}:${input.now}`).digest('hex').slice(0, 8)}`,
    memoryId: memory.id,
    normalizedKey: memory.normalizedKey,
    domain: memory.domain,
    type: memory.type,
    strength: memory.strength,
    scope: memory.scope,
    reason: input.reason,
    createdAt: input.now,
    expiresAt: input.expiresAt,
    replacementMemoryId: input.replacementMemoryId,
    evidence: memory.evidence
  }
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function uniqueInOrder(values: string[]): string[] {
  return Array.from(new Set(values))
}
```

Implementation requirements:

- `archive` removes the active item from the global or current project `index.jsonl` that contains the id and writes no tombstone.
- `tombstone` removes the active item, appends a `MemoryTombstone` with `reason: 'archived'`, and sets `expiresAt` unless `indefinite` is true.
- `propose-edit` appends a pending candidate with `conflictsWith: [active.id]`, source/evidence copied from active, `candidateKind` copied from active, and new content.
- `supersede` revalidates candidate review hash, activates the pending candidate with `supersedes: [active.id]`, removes old active and pending candidate, appends tombstone with `reason: 'superseded'`, writes `supersede` event, and syncs index.
- stale content hash returns `{ result: { action: 'conflict', reason: 'Active memory changed since review' } }`.

- [ ] **Step 4: Run GREEN for active lifecycle core**

Run:

```bash
npx vitest run tests/codex-active-memory-review.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit active lifecycle core**

```bash
git add src/codex/active-memory-review.ts tests/codex-active-memory-review.test.ts
git commit -m "feat: add active memory lifecycle core"
```

---

### Task 3: P0 CLI, API, MCP, and Active UI Actions

**Files:**
- Create: `src/codex/codex-memory-active-cli.ts`
- Modify: `src/codex/codex-cli.ts`
- Modify: `src/codex/codex-ui-api.ts`
- Modify: `src/mcp/mcp-server.ts`
- Modify: `src/mcp/tools/memory-review.ts`
- Modify: `src/ui/static/app.js`
- Modify: `src/ui/static/styles.css`
- Test: `tests/codex-cli.test.ts`
- Test: `tests/codex-ui-api.test.ts`
- Test: `tests/codex-ui-assets.test.ts`
- Test: `tests/mcp-server.test.ts`

- [ ] **Step 1: Write failing CLI/API tests**

Add to `tests/codex-ui-api.test.ts`:

```ts
it('archives active memory through hash-checked UI API', async () => {
  const home = await createTempDir('cyrene-ui-active-archive-home-')
  vi.stubEnv('HOME', home)
  const { cwd, active } = await seedProject()
  const { contentHashForActiveMemory } = await import('../src/codex/active-memory-review.js')

  const result = await handleCodexUiApiRequest({
    cwd,
    method: 'POST',
    pathname: `/api/active-memory/${active.id}/archive`,
    body: { contentHash: contentHashForActiveMemory(active), reason: 'Stale UI memory.' },
    now: '2026-05-30T00:00:00.000Z'
  })

  expect(result.status).toBe(200)
  expect(result.body.ok).toBe(true)
  if (result.body.ok) {
    expect(result.body.data).toMatchObject({ receipt: { action: 'archive_active_memory', id: active.id } })
  }
})
```

Add to `tests/codex-cli.test.ts`:

```ts
it('runs active memory archive from the Codex CLI', async () => {
  const home = await createTempDir('cyrene-cli-active-home-')
  const cwd = await createTempDir('cyrene-cli-active-project-')
  process.env.HOME = home
  const { active, contentHash } = await seedCliActiveMemory(cwd)

  const result = await runCodexCli(cwd, ['memory', 'active', 'archive', active.id, '--content-hash', contentHash, '--reason', 'Stale.'])

  expect(result.status).toBe(0)
  expect(result.stdout).toContain('"action": "archive"')
})
```

Add helper `seedCliActiveMemory()` beside existing CLI helpers:

```ts
async function seedCliActiveMemory(cwd: string) {
  const { identifyCodexProject } = await import('../src/codex/project-id.js')
  const { codexProjectMemoryRoot } = await import('../src/codex/codex-memory-root.js')
  const { contentHashForActiveMemory } = await import('../src/codex/active-memory-review.js')
  const project = await identifyCodexProject(cwd)
  const root = codexProjectMemoryRoot(project.projectId)
  await mkdir(root, { recursive: true })
  const active = createCliActiveMemory()
  await writeFile(join(root, 'index.jsonl'), JSON.stringify(active) + '\n')
  return { active, contentHash: contentHashForActiveMemory(active) }
}
```

- [ ] **Step 2: Run RED for CLI/API routes**

Run:

```bash
npx vitest run tests/codex-ui-api.test.ts tests/codex-cli.test.ts -t "active memory archive"
```

Expected: FAIL because CLI/API routes do not exist.

- [ ] **Step 3: Implement CLI formatter**

Create `src/codex/codex-memory-active-cli.ts`:

```ts
import { archiveCodexActiveMemory, proposeEditCodexActiveMemory, supersedeCodexActiveMemory, tombstoneCodexActiveMemory } from './active-memory-review.js'

export async function runCodexMemoryActiveArchive(input: { cwd: string; id: string; contentHash: string; reason: string }): Promise<string> {
  return `${JSON.stringify(await archiveCodexActiveMemory(input), null, 2)}\n`
}

export async function runCodexMemoryActiveTombstone(input: { cwd: string; id: string; contentHash: string; reason: string; days?: number; indefinite?: boolean }): Promise<string> {
  return `${JSON.stringify(await tombstoneCodexActiveMemory(input), null, 2)}\n`
}

export async function runCodexMemoryActiveProposeEdit(input: { cwd: string; id: string; contentHash: string; content: string; reason: string }): Promise<string> {
  return `${JSON.stringify(await proposeEditCodexActiveMemory(input), null, 2)}\n`
}

export async function runCodexMemoryActiveSupersede(input: { cwd: string; id: string; candidateId: string; contentHash: string; reviewHash: string; reason: string }): Promise<string> {
  return `${JSON.stringify(await supersedeCodexActiveMemory(input), null, 2)}\n`
}
```

- [ ] **Step 4: Route active CLI commands**

In `src/codex/codex-cli.ts`, import the new runners and add routes before `memory review`:

```ts
if (command === 'memory' && input.args[1] === 'active' && input.args[2] === 'archive') {
  process.stdout.write(await runCodexMemoryActiveArchive({
    cwd: input.cwd,
    id: parseRequiredPositional(input.args, 3, 'active memory id'),
    contentHash: parseRequiredOption(input.args, '--content-hash', 'active content hash'),
    reason: parseRequiredOption(input.args, '--reason', 'archive reason')
  }))
  return
}
```

Add equivalent routes for:

- `memory active tombstone <id> --content-hash <hash> --reason <text> [--days <n>|--indefinite]`
- `memory active propose-edit <id> --content-hash <hash> --content <text> --reason <text>`
- `memory active supersede <id> --candidate <candidateId> --content-hash <hash> --review-hash <hash> --reason <text>`

- [ ] **Step 5: Route active UI API**

In `src/codex/codex-ui-api.ts`, add:

```ts
type ActiveMemoryWriteAction = 'archive' | 'tombstone' | 'propose-edit' | 'supersede'

function parseActiveMemoryWriteRoute(pathname: string): { id: string; action: ActiveMemoryWriteAction } | undefined {
  const match = /^\/api\/active-memory\/([^/]+)\/(archive|tombstone|propose-edit|supersede)$/.exec(pathname)
  if (match === null) return undefined
  return { id: decodeURIComponent(match[1]), action: match[2] as ActiveMemoryWriteAction }
}
```

Dispatch it before GET routing. Every active write body must include non-empty `contentHash` and `reason`. Return receipt shape:

```ts
{
  receipt: {
    action: `${route.action.replace('-', '_')}_active_memory`,
    id: route.id,
    createdAt: input.now ?? new Date().toISOString(),
    summary: 'Active memory action applied.'
  },
  result
}
```

- [ ] **Step 6: Add MCP handlers**

In `src/mcp/tools/memory-review.ts`, add zod schemas and handlers:

```ts
export const activeMemoryArchiveInputSchema = {
  id: z.string(),
  contentHash: z.string().min(1),
  reason: z.string().min(1)
}

export async function handleActiveMemoryArchive(input: { cwd?: string; id: string; contentHash: string; reason: string }, fallbackCwd: string) {
  return jsonText(await archiveCodexActiveMemory({ cwd: input.cwd ?? fallbackCwd, id: input.id, contentHash: input.contentHash, reason: input.reason }))
}
```

Register tools in `src/mcp/mcp-server.ts` with names:

```txt
cyrene_memory_active_archive
cyrene_memory_active_tombstone
cyrene_memory_active_propose_edit
cyrene_memory_active_supersede
```

- [ ] **Step 7: Add active UI controls**

In `src/ui/static/app.js`, add active action state:

```js
activeAction: null,
activeReceipt: null,
activeActionError: ''
```

In Project Memory/Global Memory active row rendering, add buttons:

```js
<button class="ghost-button" type="button" data-active-action="archive" data-memory-id="${escapeHtml(memory.id)}">Archive</button>
<button class="ghost-button" type="button" data-active-action="tombstone" data-memory-id="${escapeHtml(memory.id)}">Tombstone</button>
<button class="ghost-button" type="button" data-active-action="propose-edit" data-memory-id="${escapeHtml(memory.id)}">Propose edit</button>
```

Bind click handlers to POST `/api/active-memory/:id/:action` with `contentHash`, `reason`, and optional content fields.

- [ ] **Step 8: Run GREEN for CLI/API/UI/MCP**

Run:

```bash
npx vitest run tests/codex-ui-api.test.ts tests/codex-cli.test.ts tests/codex-ui-assets.test.ts tests/mcp-server.test.ts -t "active memory|active-memory|Active"
```

Expected: PASS.

- [ ] **Step 9: Commit P0 surfaces**

```bash
git add src/codex/codex-memory-active-cli.ts src/codex/codex-cli.ts src/codex/codex-ui-api.ts src/mcp/mcp-server.ts src/mcp/tools/memory-review.ts src/ui/static/app.js src/ui/static/styles.css tests/codex-cli.test.ts tests/codex-ui-api.test.ts tests/codex-ui-assets.test.ts tests/mcp-server.test.ts
git commit -m "feat: expose active memory lifecycle actions"
```

---

### Task 4: P1 Auto Review and Triage Engine

**Files:**
- Create: `src/codex/memory-triage.ts`
- Create: `src/codex/codex-memory-triage-cli.ts`
- Modify: `src/codex/codex-cli.ts`
- Modify: `src/codex/memory-propose.ts`
- Modify: `src/memory/memory-store.ts`
- Modify: `src/memory/memory-validator.ts`
- Test: `tests/codex-memory-triage.test.ts`
- Test: `tests/codex-memory-propose.test.ts`
- Test: `tests/codex-cli.test.ts`

- [ ] **Step 1: Write failing triage tests**

Create `tests/codex-memory-triage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildCandidateClusters, evaluateAutoPromotionPolicy, rankPendingForEviction, triagePendingMemories } from '../src/codex/memory-triage.js'
import type { CyreneMemory, MemoryTombstone, PendingMemory } from '../src/memory/types.js'

function pending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Project uses SQLite FTS for memory retrieval.',
    normalizedKey: 'project-sqlite-fts-retrieval',
    evidence: [
      { summary: 'README documents SQLite FTS.', evidenceGroupId: 'file-1', sourceKind: 'file' },
      { summary: 'Tool trace rebuilt memory.db.', evidenceGroupId: 'tool-1', sourceKind: 'tool_trace' }
    ],
    source: 'file',
    scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.05 },
    seenCount: 2,
    firstSeenAt: '2026-05-30T00:00:00.000Z',
    lastSeenAt: '2026-05-30T00:00:00.000Z',
    expiresAt: '2026-06-30T00:00:00.000Z',
    candidateKind: 'project_fact',
    tags: ['project_harvest'],
    ...overrides
  }
}

describe('memory triage', () => {
  it('auto-drops transient command status noise', () => {
    const result = triagePendingMemories({
      pending: [pending({ id: 'noise', content: 'Ran npm test today.', normalizedKey: 'ran-npm-test-today', evidence: [{ summary: 'temporary command result' }], seenCount: 1 })],
      active: [],
      tombstones: [],
      scope: 'project',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.decisions).toContainEqual(expect.objectContaining({ action: 'auto_drop', candidateId: 'noise' }))
  })

  it('clusters duplicate normalized keys', () => {
    const clusters = buildCandidateClusters([
      pending({ id: 'a', normalizedKey: 'same-key' }),
      pending({ id: 'b', normalizedKey: 'same-key', content: 'Project memory retrieval uses SQLite FTS.' })
    ])

    expect(clusters).toEqual([expect.objectContaining({ memberIds: ['a', 'b'], normalizedKey: 'same-key' })])
  })

  it('allows strict low-risk project auto-promotion', () => {
    const result = evaluateAutoPromotionPolicy({
      candidate: pending(),
      scope: 'project',
      active: [],
      tombstones: [],
      promotionsUsedToday: 0,
      projectDailyCap: 5,
      globalDailyCap: 1,
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result).toMatchObject({ allowed: true, policyId: 'low_risk_project_memory_v1' })
  })

  it('denies strict low-risk project auto-promotion after daily cap is reached', () => {
    const result = evaluateAutoPromotionPolicy({
      candidate: pending(),
      scope: 'project',
      active: [],
      tombstones: [],
      promotionsUsedToday: 5,
      projectDailyCap: 5,
      globalDailyCap: 1,
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result).toMatchObject({ allowed: false })
    expect(result.reason).toContain('daily auto-promotion cap')
  })

  it('denies assistant-observed-only auto-promotion', () => {
    const result = evaluateAutoPromotionPolicy({
      candidate: pending({ source: 'assistant_observed', evidence: [{ summary: 'Assistant observed this.' }] }),
      scope: 'project',
      active: [],
      tombstones: [],
      promotionsUsedToday: 0,
      projectDailyCap: 5,
      globalDailyCap: 1,
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result).toMatchObject({ allowed: false })
    expect(result.reason).toContain('assistant_observed')
  })

  it('ranks protected pending after evictable pending', () => {
    const ranked = rankPendingForEviction([
      pending({ id: 'weak', scores: { evidenceStrength: 0.3, stability: 0.3, usefulness: 0.2, safety: 0.9, sensitivity: 0.1 } }),
      pending({ id: 'explicit', source: 'user_explicit', candidateKind: 'user_instruction' })
    ], '2026-05-30T00:00:00.000Z')

    expect(ranked[0]).toMatchObject({ candidateId: 'weak', protected: false })
    expect(ranked[1]).toMatchObject({ candidateId: 'explicit', protected: true })
  })
})
```

Add to `tests/codex-memory-propose.test.ts`, reusing the file's existing temp-dir and env cleanup helpers:

```ts
it('auto-promotes repeated strict low-risk project candidates after merge', async () => {
  const home = await createTempDir('cyrene-propose-auto-promote-home-')
  process.env.HOME = home
  const cwd = await createTempDir('cyrene-propose-auto-promote-project-')
  const candidate = {
    domain: 'project' as const,
    type: 'project_fact' as const,
    scope: 'project' as const,
    source: 'file' as const,
    candidateKind: 'project_fact' as const,
    content: 'Project uses SQLite FTS for memory retrieval.',
    normalizedKey: 'project-sqlite-fts-retrieval',
    evidence: [{ summary: 'README documents SQLite FTS.', evidenceGroupId: 'file-1', sourceKind: 'file' as const }],
    scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.05 },
    tags: ['project_harvest']
  }

  const first = await proposeCodexMemoryCandidate({ cwd, candidate, now: '2026-05-30T00:00:00.000Z' })
  expect(first.result.action).toBe('pending')

  const second = await proposeCodexMemoryCandidate({
    cwd,
    candidate: {
      ...candidate,
      evidence: [{ summary: 'Tool trace rebuilt memory.db.', evidenceGroupId: 'tool-1', sourceKind: 'tool_trace' as const }]
    },
    now: '2026-05-30T01:00:00.000Z'
  })

  expect(second.result.action).toBe('auto_promote')
  const active = await readFile(join(second.memoryRoot, 'index.jsonl'), 'utf8')
  expect(active).toContain('Project uses SQLite FTS for memory retrieval.')
  await expect(readFile(join(second.memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toBe('')
  const events = await readFile(join(second.memoryRoot, 'events.jsonl'), 'utf8')
  expect(events).toContain('"decision":"auto_promote"')
  expect(events).toContain('"policyId":"low_risk_project_memory_v1"')
})
```

- [ ] **Step 2: Run RED for triage tests**

Run:

```bash
npx vitest run tests/codex-memory-triage.test.ts tests/codex-memory-propose.test.ts -t "auto-promotion|auto-promotes repeated strict"
```

Expected: FAIL because `src/codex/memory-triage.ts` does not exist and `proposeCodexMemoryCandidate()` has no `auto_promote` result.

- [ ] **Step 3: Implement triage types and cluster builder**

Create `src/codex/memory-triage.ts`:

```ts
import { deriveMemoryCandidateKind } from '../memory/candidate-kind.js'
import { distinctEvidenceCount } from '../memory/memory-validator.js'
import type { CyreneMemory, MemoryTombstone, PendingMemory } from '../memory/types.js'

export type TriageDecision =
  | { action: 'auto_drop'; candidateId: string; reason: string }
  | { action: 'auto_merge'; candidateIds: string[]; clusterId: string; reason: string }
  | { action: 'auto_defer'; candidateId: string; days: number; reason: string }
  | { action: 'recommend'; candidateId: string; priority: 'normal' | 'high'; reason: string }
  | { action: 'auto_promote'; candidateId: string; policyId: string; reason: string }
  | { action: 'manual_review'; candidateId: string; reason: string }

export interface CandidateCluster {
  id: string
  normalizedKey: string
  memberIds: string[]
  evidenceCount: number
  recommendation: 'review' | 'promote' | 'drop' | 'defer'
}

export function buildCandidateClusters(pending: PendingMemory[]): CandidateCluster[] {
  const byKey = new Map<string, PendingMemory[]>()
  for (const candidate of pending) {
    const key = `${candidate.normalizedKey}|${deriveMemoryCandidateKind(candidate)}|${candidate.scope}`
    byKey.set(key, [...(byKey.get(key) ?? []), candidate])
  }
  return [...byKey.values()]
    .filter((items) => items.length > 1)
    .map((items) => ({
      id: `cluster-${items[0].normalizedKey}`,
      normalizedKey: items[0].normalizedKey,
      memberIds: items.map((item) => item.id).sort(),
      evidenceCount: items.reduce((sum, item) => sum + item.evidence.length, 0),
      recommendation: 'review'
    }))
}
```

- [ ] **Step 4: Implement auto-promotion policy**

In `src/codex/memory-triage.ts`, add:

```ts
export interface AutoPromotionPolicyInput {
  candidate: PendingMemory
  scope: 'project' | 'global'
  active: CyreneMemory[]
  tombstones: MemoryTombstone[]
  promotionsUsedToday: number
  projectDailyCap: number
  globalDailyCap: number
  now: string
}

export type AutoPromotionPolicyResult =
  | { allowed: true; policyId: 'low_risk_project_memory_v1' | 'low_risk_global_procedural_v1'; reason: string; distinctEvidenceCount: number }
  | { allowed: false; reason: string; distinctEvidenceCount: number }

export function evaluateAutoPromotionPolicy(input: AutoPromotionPolicyInput): AutoPromotionPolicyResult {
  const candidate = input.candidate
  const distinct = distinctEvidenceCount(candidate)
  const kind = deriveMemoryCandidateKind(candidate)
  if (candidate.domain === 'personal' || candidate.domain === 'relationship' || candidate.domain === 'affective') {
    return denied('high-risk domain cannot auto-promote', distinct)
  }
  if (candidate.source === 'assistant_observed' && candidate.evidence.every((entry) => entry.sourceKind === undefined || entry.sourceKind === 'assistant_observed')) {
    return denied('assistant_observed-only candidate cannot auto-promote', distinct)
  }
  if (input.active.some((memory) => memory.normalizedKey === candidate.normalizedKey)) {
    return denied('normalizedKey conflict with active memory', distinct)
  }
  if (input.tombstones.some((tombstone) => tombstone.normalizedKey === candidate.normalizedKey && (tombstone.expiresAt === undefined || tombstone.expiresAt > input.now))) {
    return denied('active tombstone blocks auto-promotion', distinct)
  }
  if (candidate.scores.evidenceStrength < 0.85 || candidate.scores.stability < 0.8 || candidate.scores.usefulness < 0.7 || candidate.scores.safety < 0.9 || candidate.scores.sensitivity > 0.2 || candidate.seenCount < 2 || distinct < 2) {
    return denied('candidate is below strict project score or evidence thresholds', distinct)
  }
  if (input.scope === 'project') {
    if (!['project', 'procedural', 'system'].includes(candidate.domain)) return denied('domain is not project auto-promotable', distinct)
    if (!['project_fact', 'workflow_rule', 'known_pitfall'].includes(kind)) return denied('candidate kind is not project auto-promotable', distinct)
    if (!['file', 'tool_trace', 'user_explicit'].includes(candidate.source)) return denied(`source ${candidate.source} is not project auto-promotable`, distinct)
    if (input.promotionsUsedToday >= input.projectDailyCap) return denied('project daily auto-promotion cap reached', distinct)
    return { allowed: true, policyId: 'low_risk_project_memory_v1', reason: 'candidate passed strict project auto-promotion policy', distinctEvidenceCount: distinct }
  }
  if (candidate.scope !== 'global') return denied('global policy requires global scope', distinct)
  if (!['procedural', 'system'].includes(candidate.domain)) return denied('global auto-promotion allows only procedural/system domains', distinct)
  if (!['user_instruction', 'workflow_rule'].includes(kind)) return denied('global candidate kind is not auto-promotable', distinct)
  if (!['user_explicit', 'review_event'].includes(candidate.source)) return denied(`source ${candidate.source} is not global auto-promotable`, distinct)
  if (candidate.scores.sensitivity > 0.1 || candidate.scores.safety < 0.95 || candidate.scores.evidenceStrength < 0.9 || candidate.scores.stability < 0.85) return denied('candidate is below stricter global thresholds', distinct)
  if (input.promotionsUsedToday >= input.globalDailyCap) return denied('global daily auto-promotion cap reached', distinct)
  return { allowed: true, policyId: 'low_risk_global_procedural_v1', reason: 'candidate passed strict global auto-promotion policy', distinctEvidenceCount: distinct }
}

function denied(reason: string, distinctEvidenceCount: number): AutoPromotionPolicyResult {
  return { allowed: false, reason, distinctEvidenceCount }
}
```

- [ ] **Step 5: Implement triage and eviction ranking**

In `src/codex/memory-triage.ts`, add:

```ts
export function triagePendingMemories(input: { pending: PendingMemory[]; active: CyreneMemory[]; tombstones: MemoryTombstone[]; scope: 'project' | 'global'; now: string }) {
  const decisions: TriageDecision[] = []
  const clusters = buildCandidateClusters(input.pending)
  for (const cluster of clusters) {
    decisions.push({ action: 'auto_merge', candidateIds: cluster.memberIds, clusterId: cluster.id, reason: 'duplicate normalizedKey/kind/scope cluster' })
  }
  for (const candidate of input.pending) {
    if (isTransientNoise(candidate)) {
      decisions.push({ action: 'auto_drop', candidateId: candidate.id, reason: 'transient command status noise' })
    } else if (candidate.seenCount === 1 && candidate.scores.evidenceStrength < 0.75 && candidate.scores.usefulness < 0.6) {
      decisions.push({ action: 'auto_defer', candidateId: candidate.id, days: 14, reason: 'weak single-evidence candidate' })
    }
  }
  return { decisions, clusters }
}

export function rankPendingForEviction(pending: PendingMemory[], now: string) {
  return pending
    .map((candidate) => {
      const protectedCandidate = isProtectedPending(candidate, now)
      const score = pendingEvictionScore(candidate, protectedCandidate)
      return { candidateId: candidate.id, protected: protectedCandidate, score, candidate }
    })
    .sort((left, right) => left.score - right.score || left.candidateId.localeCompare(right.candidateId))
}
```

Rules:

- `isTransientNoise()` matches content like `ran npm test`, `current branch`, `git status`, and `today`.
- `isProtectedPending()` returns true for `source: 'user_explicit'`, `candidateKind: 'user_instruction'`, domains personal/relationship/affective, `scores.sensitivity > 0.6`, or `lastSeenAt` within 30 days with direct user evidence.
- `pendingEvictionScore()` puts protected candidates above `10_000`; weak assistant-observed/no-review candidates below `1_000`.

- [ ] **Step 6: Integrate strict auto-promotion in the proposal path**

In `src/memory/memory-store.ts`, add the event reader used for daily caps:

```ts
export async function readMemoryEventsFromRoot(memoryRoot: string): Promise<MemoryEvent[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<MemoryEvent>(join(memoryRoot, EVENTS_FILE))
}
```

In `src/codex/memory-propose.ts`, update imports:

```ts
import { createDefaultConfig } from '../config.js'
import { evaluateAutoPromotionPolicy } from './memory-triage.js'
import {
  appendMemoryEventFromRoot,
  appendTombstoneFromRoot,
  mergePendingMemory,
  readActiveMemoriesFromRoot,
  readMemoryEventsFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot
} from '../memory/memory-store.js'
import { activateCandidate, validateMemoryCandidate } from '../memory/memory-validator.js'
```

Add `MemoryEvent` to the existing `../memory/types.js` type import in the same file because `countAutoPromotionsForDay()` accepts `MemoryEvent[]`.

Extend `CodexMemoryProposeResult.result`:

```ts
    | {
        action: 'auto_promote'
        candidateId: string
        memoryId: string
        policyId: string
        reason: string
      }
```

Replace the current direct `upsertPendingMemoryFromRoot()` fallback with a merge-then-policy branch inside the existing maintenance lock:

```ts
const pendingCandidate = decision.action === 'pending' ? decision.candidate : candidate
const lockedPending = await readPendingMemoriesFromRoot(lockedMemoryRoot)
const existingPending = lockedPending.find((item) => item.normalizedKey === pendingCandidate.normalizedKey)
const mergedCandidate = existingPending === undefined
  ? pendingCandidate
  : mergePendingMemory(existingPending, pendingCandidate)
const pendingWithoutMerged = lockedPending.filter((item) => item.normalizedKey !== mergedCandidate.normalizedKey)
const config = createDefaultConfig(input.cwd)
const events = await readMemoryEventsFromRoot(lockedMemoryRoot)
const promotionsUsedToday = countAutoPromotionsForDay(events, now)
const autoPromotion = evaluateAutoPromotionPolicy({
  candidate: mergedCandidate,
  scope: mergedCandidate.scope === 'global' ? 'global' : 'project',
  active: existingMemories,
  tombstones,
  promotionsUsedToday,
  projectDailyCap: config.memoryAutoReviewProjectPromotePerDay,
  globalDailyCap: config.memoryAutoReviewGlobalPromotePerDay,
  now
})

if (autoPromotion.allowed) {
  const promoted = activateCandidate({ ...mergedCandidate, userConfirmed: true }, now)
  await writeActiveMemoriesFromRoot(lockedMemoryRoot, [...existingMemories, promoted])
  await writePendingMemoriesFromRoot(lockedMemoryRoot, pendingWithoutMerged)
  await appendMemoryEventFromRoot(lockedMemoryRoot, {
    id: randomUUID(),
    action: 'promote',
    at: now,
    reason: autoPromotion.reason,
    memoryId: promoted.id,
    candidateId: mergedCandidate.id,
    details: {
      decision: 'auto_promote',
      policyId: autoPromotion.policyId,
      distinctEvidenceCount: autoPromotion.distinctEvidenceCount,
      evalGate: { passed: true, failedChecks: [] }
    }
  })
  await syncCurrentCodexMemoryIndex({ cwd: input.cwd })
  return {
    project: { projectId: project.projectId, displayName: project.displayName },
    result: { action: 'auto_promote', candidateId: mergedCandidate.id, memoryId: promoted.id, policyId: autoPromotion.policyId, reason: autoPromotion.reason },
    memoryRoot: lockedMemoryRoot
  }
}

await writePendingMemoriesFromRoot(lockedMemoryRoot, [...pendingWithoutMerged, mergedCandidate])
```

Add the helper:

```ts
function countAutoPromotionsForDay(events: MemoryEvent[], now: string): number {
  const day = now.slice(0, 10)
  return events.filter((event) =>
    event.action === 'promote' &&
    event.at.slice(0, 10) === day &&
    event.details?.decision === 'auto_promote'
  ).length
}
```

For pending fallback, append the existing `pending` event with reason:

```ts
const reason = decision.action === 'auto_write'
  ? `Auto-promotion denied by v5 policy: ${autoPromotion.reason}; pending for manual review.`
  : decision.reason
```

This keeps single-observation, high-risk, ambiguous, assistant-observed-only, tombstoned, or over-cap candidates pending.

- [ ] **Step 7: Add triage CLI**

Create `src/codex/codex-memory-triage-cli.ts`:

```ts
import { readPendingMemoriesFromRoot, readActiveMemoriesFromRoot, readTombstonesFromRoot } from '../memory/memory-store.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'
import { triagePendingMemories } from './memory-triage.js'

export async function runCodexMemoryTriage(input: { cwd: string; dryRun: boolean; apply: boolean; policy?: 'strict' | 'balanced'; now?: string }): Promise<string> {
  const project = await identifyCodexProject(input.cwd)
  const memoryRoot = codexProjectMemoryRoot(project.projectId)
  const now = input.now ?? new Date().toISOString()
  const [pending, active, tombstones] = await Promise.all([
    readPendingMemoriesFromRoot(memoryRoot),
    readActiveMemoriesFromRoot(memoryRoot),
    readTombstonesFromRoot(memoryRoot)
  ])
  const result = triagePendingMemories({ pending, active, tombstones, scope: 'project', now })
  return `${JSON.stringify({ action: input.apply ? 'apply' : 'dry_run', project, memoryRoot, ...result }, null, 2)}\n`
}
```

Route in `src/codex/codex-cli.ts`:

```ts
if (command === 'memory' && input.args[1] === 'triage') {
  process.stdout.write(await runCodexMemoryTriage({
    cwd: input.cwd,
    dryRun: input.args.includes('--dry-run') || !input.args.includes('--apply'),
    apply: input.args.includes('--apply'),
    policy: input.args.includes('--policy') ? parseRequiredOption(input.args, '--policy', 'triage policy') as 'strict' | 'balanced' : 'strict'
  }))
  return
}
```

- [ ] **Step 8: Run GREEN for triage engine**

Run:

```bash
npx vitest run tests/codex-memory-triage.test.ts tests/codex-memory-propose.test.ts tests/codex-cli.test.ts -t "memory triage|auto-drops|clusters|auto-promotion|auto-promotes repeated strict|eviction"
```

Expected: PASS.

- [ ] **Step 9: Commit triage engine**

```bash
git add src/codex/memory-triage.ts src/codex/codex-memory-triage-cli.ts src/codex/codex-cli.ts src/codex/memory-propose.ts src/memory/memory-store.ts src/memory/memory-validator.ts tests/codex-memory-triage.test.ts tests/codex-memory-propose.test.ts tests/codex-cli.test.ts
git commit -m "feat: add memory triage engine"
```

---

### Task 5: P4 Pending Budget Enforcement

**Files:**
- Create: `src/codex/memory-pending-budget.ts`
- Modify: `src/codex/memory-propose.ts`
- Modify: `src/codex/project-memory-harvester.ts`
- Test: `tests/codex-memory-pending-budget.test.ts`
- Test: `tests/codex-memory-propose.test.ts`
- Test: `tests/project-memory-harvester.test.ts`

- [ ] **Step 1: Write failing pending budget tests**

Create `tests/codex-memory-pending-budget.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { enforcePendingBudget } from '../src/codex/memory-pending-budget.js'
import type { PendingMemory } from '../src/memory/types.js'

function pending(id: string, overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id,
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: `Pending ${id}`,
    normalizedKey: id,
    evidence: [{ summary: `evidence ${id}` }],
    source: 'assistant_observed',
    scores: { evidenceStrength: 0.4, stability: 0.4, usefulness: 0.3, safety: 0.9, sensitivity: 0.1 },
    seenCount: 1,
    firstSeenAt: '2026-05-01T00:00:00.000Z',
    lastSeenAt: '2026-05-01T00:00:00.000Z',
    expiresAt: '2026-06-01T00:00:00.000Z',
    tags: [],
    ...overrides
  }
}

describe('pending budget enforcement', () => {
  it('keeps new candidate when it outranks the weakest unprotected pending item', () => {
    const result = enforcePendingBudget({
      existing: [pending('weak'), pending('strong', { source: 'user_explicit', candidateKind: 'user_instruction' })],
      incoming: pending('incoming', { scores: { evidenceStrength: 0.9, stability: 0.8, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 }, source: 'file' }),
      maxItems: 2,
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.action).toBe('evict_existing')
    if (result.action !== 'evict_existing') throw new Error('expected eviction')
    expect(result.evicted.id).toBe('weak')
    expect(result.nextPending.map((item) => item.id).sort()).toEqual(['incoming', 'strong'])
  })

  it('rejects incoming when it is the lowest ranked candidate', () => {
    const result = enforcePendingBudget({
      existing: [pending('kept-a', { source: 'file' }), pending('kept-b', { source: 'tool_trace' })],
      incoming: pending('incoming-weak'),
      maxItems: 2,
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result).toMatchObject({ action: 'reject_incoming', incomingId: 'incoming-weak' })
  })
})
```

- [ ] **Step 2: Run RED for pending budget**

Run:

```bash
npx vitest run tests/codex-memory-pending-budget.test.ts
```

Expected: FAIL because `src/codex/memory-pending-budget.ts` does not exist.

- [ ] **Step 3: Implement budget enforcement**

Create `src/codex/memory-pending-budget.ts`:

```ts
import { rankPendingForEviction } from './memory-triage.js'
import type { PendingMemory } from '../memory/types.js'

export type PendingBudgetResult =
  | { action: 'within_budget'; nextPending: PendingMemory[] }
  | { action: 'evict_existing'; evicted: PendingMemory; incoming: PendingMemory; nextPending: PendingMemory[]; reason: string }
  | { action: 'reject_incoming'; incomingId: string; nextPending: PendingMemory[]; reason: string }

export function enforcePendingBudget(input: { existing: PendingMemory[]; incoming: PendingMemory; maxItems: number; now: string }): PendingBudgetResult {
  const combined = [...input.existing, input.incoming]
  if (combined.length <= input.maxItems) {
    return { action: 'within_budget', nextPending: combined }
  }
  const ranked = rankPendingForEviction(combined, input.now)
  const evictable = ranked.find((item) => !item.protected)
  if (evictable === undefined) {
    return { action: 'reject_incoming', incomingId: input.incoming.id, nextPending: input.existing, reason: 'all pending candidates are protected' }
  }
  if (evictable.candidateId === input.incoming.id) {
    return { action: 'reject_incoming', incomingId: input.incoming.id, nextPending: input.existing, reason: 'incoming candidate is lowest-ranked under pending budget' }
  }
  return {
    action: 'evict_existing',
    evicted: evictable.candidate,
    incoming: input.incoming,
    nextPending: combined.filter((candidate) => candidate.id !== evictable.candidateId),
    reason: `evicted lowest-ranked pending candidate ${evictable.candidateId}`
  }
}
```

- [ ] **Step 4: Integrate budget into pending proposal path**

In `src/codex/memory-propose.ts`, import `enforcePendingBudget` and replace the Task 4 pending fallback:

```ts
await writePendingMemoriesFromRoot(lockedMemoryRoot, [...pendingWithoutMerged, mergedCandidate])
```

with budget-aware write:

```ts
const budgetResult = enforcePendingBudget({
  existing: pendingWithoutMerged,
  incoming: mergedCandidate,
  maxItems: mergedCandidate.scope === 'global' ? config.memoryPendingMaxItemsGlobal : config.memoryPendingMaxItemsProject,
  now
})
```

Write `budgetResult.nextPending` with `writePendingMemoriesFromRoot()`. If action is `evict_existing`, append `MemoryEvent`:

```ts
await appendMemoryEventFromRoot(lockedMemoryRoot, {
  id: randomUUID(),
  action: 'audit',
  at: now,
  reason: budgetResult.reason,
  candidateId: budgetResult.evicted.id,
  details: { decision: 'budget_evict_pending', incomingCandidateId: pendingCandidate.id }
})
```

If action is `reject_incoming`, return:

```ts
return {
  project: { projectId: project.projectId, displayName: project.displayName },
  result: { action: 'reject', reason: budgetResult.reason },
  memoryRoot: lockedMemoryRoot
}
```

- [ ] **Step 5: Run GREEN for budget and proposal tests**

Run:

```bash
npx vitest run tests/codex-memory-pending-budget.test.ts tests/codex-memory-propose.test.ts tests/project-memory-harvester.test.ts -t "budget|pending|harvest"
```

Expected: PASS.

- [ ] **Step 6: Commit pending budget enforcement**

```bash
git add src/codex/memory-pending-budget.ts src/codex/memory-propose.ts src/codex/project-memory-harvester.ts tests/codex-memory-pending-budget.test.ts tests/codex-memory-propose.test.ts tests/project-memory-harvester.test.ts
git commit -m "feat: enforce pending memory budgets"
```

---

### Task 6: P2 Global Memory Capture

**Files:**
- Create: `src/codex/global-memory-capture.ts`
- Modify: `src/codex/codex-memory-triage-cli.ts`
- Modify: `src/codex/review-summary-runtime.ts`
- Modify: `src/codex/memory-review.ts`
- Test: `tests/global-memory-capture.test.ts`
- Test: `tests/codex-memory-triage.test.ts`
- Test: `tests/codex-review-summary-runtime.test.ts`

- [ ] **Step 1: Write failing global capture tests**

Create `tests/global-memory-capture.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { candidateFromExplicitGlobalInstruction, candidateFromReviewPattern, candidatesFromReviewEvents } from '../src/codex/global-memory-capture.js'

describe('global memory capture', () => {
  it('creates global candidate from explicit global instruction', () => {
    const candidate = candidateFromExplicitGlobalInstruction({
      text: '以后所有项目都默认先运行 git diff --check。',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(candidate).toMatchObject({
      scope: 'global',
      source: 'user_explicit',
      candidateKind: 'user_instruction',
      domain: 'procedural',
      type: 'procedural_rule'
    })
    expect(candidate?.content).toContain('所有项目')
  })

  it('does not create candidate from ordinary conversation', () => {
    expect(candidateFromExplicitGlobalInstruction({ text: '这个项目先跑测试。', now: '2026-05-30T00:00:00.000Z' })).toBeUndefined()
  })

  it('creates review-derived global candidate from repeated rejection pattern', () => {
    const candidate = candidateFromReviewPattern({
      patternId: 'reject-transient-test-status',
      action: 'reject',
      count: 5,
      reasonSamples: ['temporary status', 'not durable memory'],
      candidateKind: 'project_fact',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(candidate).toMatchObject({
      scope: 'global',
      source: 'review_event',
      candidateKind: 'workflow_rule',
      domain: 'procedural'
    })
    expect(candidate?.content).toContain('一次性')
  })

  it('aggregates review events into review-derived global candidates', () => {
    const candidates = candidatesFromReviewEvents({
      events: [
        { id: 'event-1', action: 'reject', at: '2026-05-28T00:00:00.000Z', reason: 'temporary status', candidateId: 'a', details: { reviewPatternId: 'reject-transient-test-status', candidateKind: 'project_fact' } },
        { id: 'event-2', action: 'reject', at: '2026-05-29T00:00:00.000Z', reason: 'not durable memory', candidateId: 'b', details: { reviewPatternId: 'reject-transient-test-status', candidateKind: 'project_fact' } },
        { id: 'event-3', action: 'reject', at: '2026-05-30T00:00:00.000Z', reason: 'one-off command output', candidateId: 'c', details: { reviewPatternId: 'reject-transient-test-status', candidateKind: 'project_fact' } }
      ],
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ source: 'review_event', normalizedKey: 'review-derived-reject-transient-test-status' })
  })
})
```

- [ ] **Step 2: Run RED for global capture**

Run:

```bash
npx vitest run tests/global-memory-capture.test.ts
```

Expected: FAIL because `src/codex/global-memory-capture.ts` does not exist.

- [ ] **Step 3: Implement explicit and review-derived global capture**

Create `src/codex/global-memory-capture.ts`:

```ts
import { createHash } from 'node:crypto'
import type { CodexMemoryCandidateInput } from './memory-propose.js'
import type { MemoryEvent } from '../memory/types.js'

const GLOBAL_INSTRUCTION_PATTERN = /(以后所有项目|所有项目|all projects|always|by default|默认|长期记住|remember globally)/i

export function candidateFromExplicitGlobalInstruction(input: { text: string; now: string }): CodexMemoryCandidateInput | undefined {
  const text = input.text.trim()
  if (!GLOBAL_INSTRUCTION_PATTERN.test(text)) return undefined
  return {
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'global',
    source: 'user_explicit',
    candidateKind: 'user_instruction',
    content: text,
    normalizedKey: `global-instruction-${shortHash(text)}`,
    evidence: [{ summary: 'Explicit global instruction from user prompt.', sourceKind: 'user_explicit', evidenceGroupId: shortHash(`global:${text}`) }],
    scores: { evidenceStrength: 0.92, stability: 0.88, usefulness: 0.85, safety: 0.96, sensitivity: 0.05 },
    tags: ['global_capture', 'explicit_instruction'],
    userConfirmed: true
  }
}

export function candidateFromReviewPattern(input: { patternId: string; action: 'reject' | 'edit' | 'approve'; count: number; reasonSamples: string[]; candidateKind: string; now: string }): CodexMemoryCandidateInput | undefined {
  if (input.count < 3) return undefined
  const content = input.patternId.includes('transient')
    ? '全局 workflow rule：不要把一次性命令结果、临时测试状态或当前 branch 状态作为 durable memory。'
    : `全局 workflow rule：根据重复 ${input.action} review pattern ${input.patternId} 调整 memory 候选质量。`
  return {
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'soft',
    scope: 'global',
    source: 'review_event',
    candidateKind: 'workflow_rule',
    content,
    normalizedKey: `review-derived-${input.patternId}`,
    evidence: input.reasonSamples.slice(0, 5).map((summary, index) => ({ summary, sourceKind: 'review_event' as const, evidenceGroupId: `${input.patternId}-${index}` })),
    scores: { evidenceStrength: 0.9, stability: 0.86, usefulness: 0.82, safety: 0.97, sensitivity: 0.03 },
    tags: ['global_capture', 'review_derived']
  }
}

export function candidatesFromReviewEvents(input: { events: MemoryEvent[]; now: string }): CodexMemoryCandidateInput[] {
  const groups = new Map<string, { action: 'reject' | 'edit' | 'approve'; reasonSamples: string[]; candidateKind: string; count: number }>()
  for (const event of input.events) {
    const patternId = typeof event.details?.reviewPatternId === 'string' ? event.details.reviewPatternId : undefined
    if (patternId === undefined || !['reject', 'update', 'promote'].includes(event.action)) continue
    const action = event.action === 'reject' ? 'reject' : event.action === 'update' ? 'edit' : 'approve'
    const current = groups.get(patternId) ?? { action, reasonSamples: [], candidateKind: 'project_fact', count: 0 }
    groups.set(patternId, {
      action: current.action,
      reasonSamples: [...current.reasonSamples, event.reason].slice(-5),
      candidateKind: typeof event.details?.candidateKind === 'string' ? event.details.candidateKind : current.candidateKind,
      count: current.count + 1
    })
  }
  return [...groups.entries()]
    .flatMap(([patternId, group]) => candidateFromReviewPattern({ patternId, action: group.action, count: group.count, reasonSamples: group.reasonSamples, candidateKind: group.candidateKind, now: input.now }) ?? [])
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
```

- [ ] **Step 4: Integrate explicit and review-event global capture**

In `src/codex/review-summary-runtime.ts`, after `redactCandidate` processing, inspect recent user messages:

```ts
for (const message of window.filter((entry) => entry.role === 'user')) {
  const globalCandidate = candidateFromExplicitGlobalInstruction({ text: message.content, now: createdAt })
  if (globalCandidate === undefined) continue
  const result = await proposeCodexMemoryCandidate({
    cwd: input.cwd,
    candidate: globalCandidate,
    now: input.now,
    recordRejectedCandidate: false
  })
  if (result.result.action === 'pending') candidateIds.push(result.result.candidateId)
}
```

Ensure explicit capture runs through `proposeCodexMemoryCandidate()` so budget and auto-promotion policy apply consistently.

In `src/codex/memory-review.ts`, add `reviewPatternId` details to reject/edit/promote review events. For transient rejected command status, use:

```ts
details: {
  reviewPatternId: transientReviewPatternId(lockedCandidate),
  candidateKind: lockedCandidate.candidateKind ?? lockedCandidate.candidate_kind
}
```

Implement:

```ts
function transientReviewPatternId(candidate: PendingMemory): string | undefined {
  const text = `${candidate.content} ${candidate.normalizedKey}`.toLowerCase()
  return /(ran npm test|git status|current branch|today|temporary|one-off)/.test(text)
    ? 'reject-transient-test-status'
    : undefined
}
```

In `src/codex/codex-memory-triage-cli.ts`, during `--apply`, read review events from the triage memory root and propose review-derived global candidates:

```ts
const reviewEvents = await readMemoryEventsFromRoot(memoryRoot)
const reviewDerived = candidatesFromReviewEvents({ events: reviewEvents, now })
for (const candidate of reviewDerived) {
  await proposeCodexMemoryCandidate({ cwd: input.cwd, candidate, now, recordRejectedCandidate: false })
}
```

Return `reviewDerivedCandidateCount` in the triage CLI JSON output.

- [ ] **Step 5: Run GREEN for P2**

Run:

```bash
npx vitest run tests/global-memory-capture.test.ts tests/codex-memory-triage.test.ts tests/codex-review-summary-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit global capture**

```bash
git add src/codex/global-memory-capture.ts src/codex/codex-memory-triage-cli.ts src/codex/review-summary-runtime.ts src/codex/memory-review.ts tests/global-memory-capture.test.ts tests/codex-memory-triage.test.ts tests/codex-review-summary-runtime.test.ts
git commit -m "feat: capture global memory candidates"
```

---

### Task 7: P3 memory_edges Index Schema

**Files:**
- Modify: `src/memory/memory-index.ts`
- Test: `tests/memory-index.test.ts`

- [ ] **Step 1: Write failing memory_edges tests**

Add to `tests/memory-index.test.ts`:

```ts
import { deriveDeterministicMemoryEdges } from '../src/memory/memory-index.js'

it('derives approved deterministic file edges from memory evidence trace refs', () => {
  const edges = deriveDeterministicMemoryEdges(activeMemory({
    id: 'memory-1',
    evidence: [{ summary: 'Route implementation.', traceRefs: ['src/codex/codex-ui-api.ts'] }]
  }), '2026-05-30T00:00:00.000Z')

  expect(edges).toEqual([expect.objectContaining({
    fromId: 'memory-1',
    toId: 'src/codex/codex-ui-api.ts',
    toKind: 'file',
    edgeType: 'memory_mentions_file',
    source: 'deterministic',
    status: 'approved'
  })])
})

it('stores deterministic memory edges and returns approved graph neighbors', async () => {
  const root = await createTempDir('cyrene-memory-index-edges-')
  const dbPath = join(root, 'memory.db')
  const adapter = await openMemoryIndexAdapter({ dbPath })
  await adapter.initialize()

  await adapter.upsertMemoryEdge({
    id: 'edge-1',
    fromId: 'memory-1',
    fromKind: 'memory',
    toId: 'src/codex/codex-ui-api.ts',
    toKind: 'file',
    edgeType: 'memory_mentions_file',
    weight: 1,
    source: 'deterministic',
    status: 'approved',
    createdAt: '2026-05-30T00:00:00.000Z'
  })

  const edges = await adapter.queryMemoryEdges({ fromId: 'memory-1', status: 'approved' })

  expect(edges).toEqual([expect.objectContaining({ id: 'edge-1', edgeType: 'memory_mentions_file', toId: 'src/codex/codex-ui-api.ts' })])
})
```

- [ ] **Step 2: Run RED for memory_edges**

Run:

```bash
npx vitest run tests/memory-index.test.ts -t "memory edges"
```

Expected: FAIL because adapter methods do not exist.

- [ ] **Step 3: Add edge types and adapter methods**

In `src/memory/memory-index.ts`, add exported interfaces:

```ts
export interface MemoryEdge {
  id: string
  fromId: string
  fromKind: string
  toId: string
  toKind: string
  edgeType: string
  weight: number
  source: 'deterministic' | 'model'
  status: 'approved' | 'pending' | 'rejected'
  evidenceId?: string
  createdAt: string
  approvedAt?: string
}

export interface MemoryEdgeQuery {
  fromId?: string
  toId?: string
  status?: 'approved' | 'pending' | 'rejected'
}
```

Add deterministic edge derivation in the same file:

```ts
import { createHash } from 'node:crypto'

export function deriveDeterministicMemoryEdges(memory: CyreneMemory | PendingMemory, now: string): MemoryEdge[] {
  return memory.evidence
    .flatMap((entry) => entry.traceRefs ?? [])
    .filter((ref) => /^[\w./-]+\.[\w]+$/.test(ref) && !ref.includes('..'))
    .map((ref) => ({
      id: `edge-${memory.id}-${createHash('sha256').update(ref).digest('hex').slice(0, 12)}`,
      fromId: memory.id,
      fromKind: 'memory',
      toId: ref,
      toKind: 'file',
      edgeType: 'memory_mentions_file',
      weight: 1,
      source: 'deterministic' as const,
      status: 'approved' as const,
      createdAt: now
    }))
}
```

Extend `MemoryIndexAdapter`:

```ts
upsertMemoryEdge(edge: MemoryEdge): Promise<MemoryIndexDiagnostics>
queryMemoryEdges(input: MemoryEdgeQuery): Promise<MemoryEdge[]>
```

- [ ] **Step 4: Create SQLite table and queries**

Inside `initialize()` SQL, add:

```sql
create table if not exists memory_edges (
  id text primary key,
  from_id text not null,
  from_kind text not null,
  to_id text not null,
  to_kind text not null,
  edge_type text not null,
  weight real not null,
  source text not null,
  status text not null,
  evidence_id text,
  created_at text not null,
  approved_at text
);
```

Implement:

```ts
async upsertMemoryEdge(edge: MemoryEdge): Promise<MemoryIndexDiagnostics> {
  const diagnostics = await this.initialize()
  this.requireDatabase().prepare(`
    insert into memory_edges (id, from_id, from_kind, to_id, to_kind, edge_type, weight, source, status, evidence_id, created_at, approved_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      from_id = excluded.from_id,
      from_kind = excluded.from_kind,
      to_id = excluded.to_id,
      to_kind = excluded.to_kind,
      edge_type = excluded.edge_type,
      weight = excluded.weight,
      source = excluded.source,
      status = excluded.status,
      evidence_id = excluded.evidence_id,
      approved_at = excluded.approved_at
  `).run(edge.id, edge.fromId, edge.fromKind, edge.toId, edge.toKind, edge.edgeType, edge.weight, edge.source, edge.status, edge.evidenceId ?? null, edge.createdAt, edge.approvedAt ?? null)
  return diagnostics
}
```

Implement `queryMemoryEdges()` with `where` clauses for provided filters.

In `syncRootRecords()`, set `const indexedAt = new Date().toISOString()` once, then after each active or pending memory row is indexed, call `deriveDeterministicMemoryEdges(memory, indexedAt)` and upsert those edges. Only deterministic edges are inserted with `status: 'approved'`; future model-assisted semantic edges must be inserted with `source: 'model'` and `status: 'pending'` until a review action approves them.

- [ ] **Step 5: Run GREEN for memory_edges**

Run:

```bash
npx vitest run tests/memory-index.test.ts -t "memory edges"
```

Expected: PASS.

- [ ] **Step 6: Commit memory_edges schema**

```bash
git add src/memory/memory-index.ts tests/memory-index.test.ts
git commit -m "feat: add memory edge index schema"
```

---

### Task 8: P3 Query Planner and Retrieval Explain

**Files:**
- Create: `src/codex/retrieval-planner.ts`
- Modify: `src/codex/continuity-context.ts`
- Modify: `src/memory/memory-retriever.ts`
- Test: `tests/retrieval-planner.test.ts`
- Test: `tests/codex-continuity-context.test.ts`
- Test: `tests/memory-retriever.test.ts`

- [ ] **Step 1: Write failing retrieval planner tests**

Create `tests/retrieval-planner.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildRetrievalPlan, explainRetrievalReasons } from '../src/codex/retrieval-planner.js'

describe('retrieval planner', () => {
  it('detects memory review UI intent and excludes affective domains', () => {
    const plan = buildRetrievalPlan({
      query: 'active memory delete button does not work in Web UI',
      task: 'memory'
    })

    expect(plan.taskIntent).toEqual(expect.arrayContaining(['memory_review', 'ui']))
    expect(plan.memoryKinds).toEqual(expect.arrayContaining(['workflow_rule', 'known_pitfall']))
    expect(plan.requiredFacets).toEqual(expect.arrayContaining(['exact_project', 'memory_kind', 'evidence']))
    expect(plan.optionalFacets).toEqual(expect.arrayContaining(['graph_edges', 'transferability']))
    expect(plan.excludeDomains).toEqual(expect.arrayContaining(['affective', 'relationship']))
  })

  it('explains retrieval reasons from matched facets and edges', () => {
    const reasons = explainRetrievalReasons({
      exactProject: true,
      memoryKind: 'workflow_rule',
      edgeTypes: ['memory_about_route'],
      score: 0.91
    })

    expect(reasons).toEqual(['exact_project', 'memory_kind:workflow_rule', 'edge:memory_about_route'])
  })
})
```

- [ ] **Step 2: Run RED for planner tests**

Run:

```bash
npx vitest run tests/retrieval-planner.test.ts
```

Expected: FAIL because `src/codex/retrieval-planner.ts` does not exist.

- [ ] **Step 3: Implement retrieval planner**

Create `src/codex/retrieval-planner.ts`:

```ts
import type { RetrieveMemoriesInput } from '../memory/memory-retriever.js'

export type RetrievalFacet = 'exact_project' | 'global_policy' | 'task_intent' | 'memory_kind' | 'evidence' | 'recency' | 'transferability' | 'graph_edges' | 'personal_boundary'

export interface RetrievalPlan {
  taskIntent: string[]
  memoryKinds: string[]
  requiredFacets: RetrievalFacet[]
  optionalFacets: RetrievalFacet[]
  excludeDomains: string[]
  includePendingHypotheses: boolean
  includeSimilarHints: boolean
  includeGraphNeighbors: boolean
}

export function buildRetrievalPlan(input: { query: string; task: NonNullable<RetrieveMemoriesInput['task']> }): RetrievalPlan {
  const text = input.query.toLowerCase()
  const taskIntent = [
    ...(matches(text, ['memory', 'pending', 'active', 'archive', 'tombstone', 'review']) ? ['memory_review'] : []),
    ...(matches(text, ['ui', 'button', 'web ui', 'route']) ? ['ui'] : []),
    ...(matches(text, ['debug', 'fail', 'error', 'bug']) || input.task === 'debugging' ? ['debugging'] : [])
  ]
  const memoryKinds = taskIntent.includes('memory_review')
    ? ['workflow_rule', 'known_pitfall', 'project_decision']
    : ['project_fact', 'workflow_rule']
  return {
    taskIntent,
    memoryKinds,
    requiredFacets: ['exact_project', 'memory_kind', 'evidence'],
    optionalFacets: ['graph_edges', 'transferability', 'recency'],
    excludeDomains: input.task === 'coding' || input.task === 'debugging' || input.task === 'memory' ? ['affective', 'relationship'] : [],
    includePendingHypotheses: input.task === 'memory',
    includeSimilarHints: true,
    includeGraphNeighbors: true
  }
}

export function explainRetrievalReasons(input: { exactProject: boolean; memoryKind?: string; edgeTypes?: string[]; score: number }): string[] {
  return [
    ...(input.exactProject ? ['exact_project'] : []),
    ...(input.memoryKind === undefined ? [] : [`memory_kind:${input.memoryKind}`]),
    ...((input.edgeTypes ?? []).map((edge) => `edge:${edge}`))
  ]
}

function matches(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term))
}
```

- [ ] **Step 4: Wire planner into continuity context diagnostics**

In `src/codex/continuity-context.ts`:

- import `buildRetrievalPlan`;
- call it before `retrieveRoutedMemory`;
- pass plan to `retrieveRoutedMemory`;
- add diagnostics:

```ts
retrievalPlan: {
  taskIntent: retrievalPlan.taskIntent,
  memoryKinds: retrievalPlan.memoryKinds,
  requiredFacets: retrievalPlan.requiredFacets,
  optionalFacets: retrievalPlan.optionalFacets
}
```

Add item-level explain reasons for `globalMemory`, `projectMemory`, and `similarProjectHints` using `explainRetrievalReasons()`.

- [ ] **Step 5: Run GREEN for planner and context**

Run:

```bash
npx vitest run tests/retrieval-planner.test.ts tests/codex-continuity-context.test.ts tests/memory-retriever.test.ts -t "retrieval planner|diagnostics|memory"
```

Expected: PASS.

- [ ] **Step 6: Commit retrieval planner**

```bash
git add src/codex/retrieval-planner.ts src/codex/continuity-context.ts src/memory/memory-retriever.ts tests/retrieval-planner.test.ts tests/codex-continuity-context.test.ts tests/memory-retriever.test.ts
git commit -m "feat: add multi-facet retrieval planner"
```

---

### Task 9: Web UI Triage and Retrieval Explain

**Files:**
- Modify: `src/codex/codex-ui-api.ts`
- Modify: `src/ui/static/app.js`
- Modify: `src/ui/static/styles.css`
- Test: `tests/codex-ui-api.test.ts`
- Test: `tests/codex-ui-assets.test.ts`

- [ ] **Step 1: Write failing UI asset tests**

Add to `tests/codex-ui-assets.test.ts`:

```ts
it('includes triage and retrieval explain UI surfaces', async () => {
  const source = await readFile('src/ui/static/app.js', 'utf8')

  expect(source).toContain("{ id: 'triage', label: 'Triage' }")
  expect(source).toContain('Run triage dry-run')
  expect(source).toContain('Apply safe triage')
  expect(source).toContain('Retrieval Explain')
  expect(source).toContain('/api/memory/triage/dry-run')
})
```

- [ ] **Step 2: Run RED for UI surfaces**

Run:

```bash
npx vitest run tests/codex-ui-assets.test.ts -t "triage and retrieval explain"
```

Expected: FAIL because UI does not include the new tab.

- [ ] **Step 3: Add UI API endpoints**

In `src/codex/codex-ui-api.ts`, add POST endpoints:

```txt
POST /api/memory/triage/dry-run
POST /api/memory/triage/apply
```

`dry-run` returns `triagePendingMemories()` result and clusters. `apply` initially applies safe `auto_drop`, `auto_defer`, and `auto_merge`; high-risk batch approve remains unavailable.

- [ ] **Step 4: Add Triage tab**

In `src/ui/static/app.js`, add to `TABS`:

```js
{ id: 'triage', label: 'Triage' }
```

Add state:

```js
triage: { loading: false, result: null, error: '', receipt: null }
```

Add render branch:

```js
if (state.activeTab === 'triage') return renderTriage()
```

Implement `renderTriage()` with buttons:

```js
<button class="primary-button" type="button" data-triage-dry-run>Run triage dry-run</button>
<button class="ghost-button" type="button" data-triage-apply>Apply safe triage</button>
```

Show counts for `auto_drop`, `auto_merge`, `auto_defer`, `recommend`, `auto_promote`, and `manual_review`.

- [ ] **Step 5: Add Retrieval Explain panel**

In Overview or Project Memory detail rail, render:

```js
<section class="panel">
  <h3>Retrieval Explain</h3>
  ${renderRetrievalPlan(state.dashboard.diagnostics?.retrievalPlan)}
</section>
```

Do not expose raw sensitive memory content beyond existing dashboard data.

- [ ] **Step 6: Add CSS**

In `src/ui/static/styles.css`, add:

```css
.triage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.explain-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
```

- [ ] **Step 7: Run GREEN for UI**

Run:

```bash
npx vitest run tests/codex-ui-api.test.ts tests/codex-ui-assets.test.ts -t "triage|Retrieval Explain"
```

Expected: PASS.

- [ ] **Step 8: Commit Web UI triage/explain**

```bash
git add src/codex/codex-ui-api.ts src/ui/static/app.js src/ui/static/styles.css tests/codex-ui-api.test.ts tests/codex-ui-assets.test.ts
git commit -m "feat: add memory triage UI"
```

---

### Task 10: v5 Eval Gates and Release Gate

**Files:**
- Modify: `src/eval/eval-runner.ts`
- Modify: `src/codex/codex-eval.ts`
- Test: `tests/eval-runner.test.ts`
- Test: `tests/codex-eval.test.ts`

- [ ] **Step 1: Write failing eval gate tests**

Add to `tests/eval-runner.test.ts`:

```ts
it('fails auto_promotion_policy_eval for personal memory auto-promotion', () => {
  const result = runV5AutoPromotionEvalGate([{
    candidateId: 'personal-auto',
    domain: 'personal',
    scope: 'global',
    source: 'user_explicit',
    policyId: 'low_risk_global_procedural_v1',
    decision: 'auto_promote'
  }])

  expect(result.passed).toBe(false)
  expect(result.failedChecks).toContain('auto_promotion_policy_eval')
})

it('fails memory_edge_eval for unapproved semantic edge used in retrieval', () => {
  const result = runV5MemoryEdgeEvalGate([{
    edgeId: 'edge-pending',
    source: 'model',
    status: 'pending',
    usedInRetrieval: true
  }])

  expect(result.passed).toBe(false)
  expect(result.failedChecks).toContain('memory_edge_eval')
})
```

- [ ] **Step 2: Run RED for v5 eval gates**

Run:

```bash
npx vitest run tests/eval-runner.test.ts -t "auto_promotion_policy_eval|memory_edge_eval"
```

Expected: FAIL because v5 eval helpers do not exist.

- [ ] **Step 3: Implement v5 eval helpers**

In `src/eval/eval-runner.ts`, add eval names:

```ts
  | 'auto_promotion_policy_eval'
  | 'global_auto_promotion_eval'
  | 'active_lifecycle_eval'
  | 'pending_budget_eval'
  | 'memory_edge_eval'
  | 'retrieval_explain_eval'
```

Add:

```ts
export function runV5AutoPromotionEvalGate(items: Array<{ candidateId: string; domain: string; scope: string; source: string; policyId: string; decision: string }>): EvalGateResult {
  const findings = items.flatMap((item) => {
    if (item.decision !== 'auto_promote') return []
    if (['personal', 'relationship', 'affective'].includes(item.domain)) return [{ memoryId: item.candidateId, reason: 'high-risk domain cannot auto-promote' }]
    if (item.scope === 'global' && !['procedural', 'system'].includes(item.domain)) return [{ memoryId: item.candidateId, reason: 'global auto-promotion allows only procedural/system domains' }]
    return []
  })
  return result('auto_promotion_policy_eval', findings)
}

export function runV5MemoryEdgeEvalGate(items: Array<{ edgeId: string; source: string; status: string; usedInRetrieval: boolean }>): EvalGateResult {
  const findings = items
    .filter((item) => item.usedInRetrieval && item.source === 'model' && item.status !== 'approved')
    .map((item) => ({ memoryId: item.edgeId, reason: 'model semantic edge used before approval' }))
  return result('memory_edge_eval', findings)
}
```

- [ ] **Step 4: Wire release gate**

In `src/codex/codex-eval.ts`, add v5 sample cases to `runCodexReleaseEval()` so release output includes the v5 gate names and fails unsafe samples.

- [ ] **Step 5: Run GREEN for eval gates**

Run:

```bash
npx vitest run tests/eval-runner.test.ts tests/codex-eval.test.ts -t "auto_promotion_policy_eval|memory_edge_eval|release"
```

Expected: PASS.

- [ ] **Step 6: Commit eval gates**

```bash
git add src/eval/eval-runner.ts src/codex/codex-eval.ts tests/eval-runner.test.ts tests/codex-eval.test.ts
git commit -m "feat: add v5 memory eval gates"
```

---

### Task 11: Integration Verification and Plugin Runtime

**Files:**
- Modify: `README.md`
- Modify: `plugin/skills/cyrene-continuity/SKILL.md`
- Generated: `plugin/runtime/cyrene-continuity.mjs`

- [ ] **Step 1: Run focused test suite**

Run:

```bash
npx vitest run tests/codex-active-memory-review.test.ts tests/codex-memory-triage.test.ts tests/codex-memory-pending-budget.test.ts tests/global-memory-capture.test.ts tests/retrieval-planner.test.ts tests/memory-index.test.ts tests/codex-continuity-context.test.ts tests/codex-ui-api.test.ts tests/codex-ui-assets.test.ts tests/eval-runner.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Rebuild plugin runtime**

Run:

```bash
npm run build:plugin
```

Expected: PASS and `plugin/runtime/cyrene-continuity.mjs` updates if source changed.

- [ ] **Step 5: Validate plugin package**

Run:

```bash
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: PASS.

- [ ] **Step 6: Run release eval**

Run:

```bash
npm run dev -- codex eval run --check release
```

Expected: JSON includes v5 eval checks with no failed release gate.

- [ ] **Step 7: Run diff check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 8: Commit final integration docs/runtime**

```bash
git add README.md plugin/skills/cyrene-continuity/SKILL.md plugin/runtime/cyrene-continuity.mjs
git commit -m "docs: document cyrene v5 memory workflow"
```

---

## Execution Order for Subagents

1. Coordinator executes Task 1 first.
2. Dispatch Lane A to Task 2 and Task 3.
3. Dispatch Lane B to Task 4.
4. Dispatch Lane E to Task 5 after Task 4 exports `rankPendingForEviction()`.
5. Dispatch Lane C to Task 6 after Task 1.
6. Dispatch Lane D to Task 7 and Task 8 after Task 1.
7. Dispatch Lane F to Task 9 after Task 3 and Task 4 API shapes stabilize.
8. Dispatch Lane G to Task 10 after Tasks 4, 5, and 7 expose their result shapes.
9. Coordinator runs Task 11 after all lanes merge.

## Final Verification Checklist

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run build:plugin`
- [ ] `python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin`
- [ ] `npm run dev -- codex eval run --check release`
- [ ] `git diff --check`
- [ ] Manual Web UI check for active actions, Triage tab, and Retrieval Explain.
