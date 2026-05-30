# Cyrene v6 Remediation Distillation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先修复 v5 现有记忆治理缺口，再交付 v6 Distillation-first MVP：默认 dry-run、证据可审计、低风险 apply 只复用 v5 policy、Web UI 只展示闭环而不绕过 review-hash。

**Architecture:** `src/memory/*` 继续作为 JSONL/SQLite 事实源；把 UI 里已有的 safe triage apply 抽成 `src/codex/triage-apply.ts`，CLI/UI 共用；新增 `src/codex/memory-distill.ts` 做只读 dry-run；UI/API/CLI 只消费同一个 dry-run 结果。

**Tech Stack:** TypeScript, Node.js, Vitest, static browser UI, Codex memory JSONL stores, SQLite memory index.

---

## Scope

Included:
- 修复 `memory triage --apply` 只生成 review-derived candidates、不实际执行 `auto_drop` / `auto_merge` / `auto_defer` 的 v5 问题。
- 统一 active memory lifecycle：`archive`、`tombstone`、`supersede` 在 `MemoryEvent.action` 中语义分离。
- 给 retrieval explain 增加 excluded diagnostics，明确 pending/tombstoned/domain-excluded memory 为什么没有进入上下文。
- 新增 `memory distill --dry-run` 和对应 Web UI 只读展示。
- 新增 release eval gate，证明 distillation dry-run 不改写 memory stores。

Excluded:
- 不做 distillation apply route。
- 不自动改写 active memory。
- 不做 project-to-global auto promotion。
- 不实现复杂 graph editor 或完整 ops console。

## Success Criteria

- `npm test` passes.
- `npm run typecheck` passes.
- `npm run dev -- codex eval run --check release` passes.
- `git diff --check` passes.
- 如果 `plugin/skills/cyrene-continuity/SKILL.md` 发生变化，额外运行 `npm run build:plugin` 和 `python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin`。

## Parallelization

Serial gate:
- Task 1 must land first because CLI and UI both depend on shared triage apply.
- Task 2 and Task 3 should land before distillation work because they fix v5 safety semantics.

Parallel after Task 3:
- Agent A: Task 4 and Task 5.
- Agent B: Task 6.
- Agent C: Task 7 after Task 4 exposes stable return types.
- Coordinator: Task 8 and final verification.

Do not let two agents edit the same file at the same time. Use separate worktrees or finish one patch before starting another patch in the same file.

---

## Task 1: Extract Safe Triage Apply From UI

**Purpose:** UI 已有 safe apply 行为；抽成共享模块，先不改变任何行为。

### Files

- Create `src/codex/triage-apply.ts`
- Modify `src/codex/codex-ui-api.ts`
- Create `tests/codex-triage-apply.test.ts`

### Steps

- [ ] Add the focused test using current `PendingMemory`, `MemoryEvent`, and `MemoryTombstone` shapes.

```ts
// tests/codex-triage-apply.test.ts
import { describe, expect, it } from 'vitest'
import { applySafeTriageDecisions } from '../src/codex/triage-apply.js'
import type { PendingMemory } from '../src/memory/types.js'

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
    evidence: [{ summary: 'Seed evidence.', sourceKind: 'file' }],
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

describe('applySafeTriageDecisions', () => {
  it('applies only safe drop, merge, and defer decisions with audit records', () => {
    const result = applySafeTriageDecisions({
      pending: [
        pending({ id: 'drop-1', content: 'Ran npm test today.', normalizedKey: 'ran-npm-test-today' }),
        pending({ id: 'merge-1', normalizedKey: 'same-key', content: 'Use npm run typecheck before release.' }),
        pending({ id: 'merge-2', normalizedKey: 'same-key', content: 'Release verification includes npm run typecheck.' }),
        pending({
          id: 'defer-1',
          normalizedKey: 'weak-single-evidence',
          scores: { evidenceStrength: 0.5, stability: 0.5, usefulness: 0.4, safety: 0.95, sensitivity: 0.05 },
          seenCount: 1
        })
      ],
      decisions: [
        { action: 'auto_drop', candidateId: 'drop-1', reason: 'transient command status noise' },
        { action: 'auto_merge', candidateIds: ['merge-1', 'merge-2'], clusterId: 'cluster-same-key', reason: 'duplicate normalizedKey/kind/scope cluster' },
        { action: 'auto_defer', candidateId: 'defer-1', days: 14, reason: 'weak single-evidence candidate' },
        { action: 'recommend', candidateId: 'manual-1', priority: 'normal', reason: 'ranked pending candidate for explicit review' }
      ],
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.counts).toEqual({ auto_drop: 1, auto_defer: 1, auto_merge: 1 })
    expect(result.pending.map((item) => item.id)).toEqual(['merge-1', 'defer-1'])
    expect(result.pending.find((item) => item.id === 'defer-1')?.promoteAfter).toBe('2026-06-13T00:00:00.000Z')
    expect(result.tombstones).toEqual([
      expect.objectContaining({ memoryId: 'drop-1', reason: 'rejected', normalizedKey: 'ran-npm-test-today' })
    ])
    expect(result.events.map((event) => event.details?.reviewAction)).toEqual([
      'triage_auto_drop',
      'triage_auto_merge',
      'triage_auto_defer'
    ])
  })
})
```

Run:

```bash
npm test -- tests/codex-triage-apply.test.ts
```

Expected before implementation:

```text
FAIL tests/codex-triage-apply.test.ts
Cannot find module '../src/codex/triage-apply.js'
```

- [ ] Move the existing private helper block from `src/codex/codex-ui-api.ts` into `src/codex/triage-apply.ts`.

Move these functions and interface without changing logic:
- `TriageApplyCounts`
- `applySafeTriageDecisions`
- `compareSafeTriageDecisionApplyOrder`
- `triageApplyPriority`
- `tombstoneForAutoDroppedCandidate`
- `memoryEventForTriageDecision`
- `pendingCandidateAuditSnapshot`
- `addDays`

The exported signature should be:

```ts
export interface TriageApplyCounts {
  auto_drop: number
  auto_defer: number
  auto_merge: number
}

export function applySafeTriageDecisions(input: {
  pending: PendingMemory[]
  decisions: TriageDecision[]
  now: string
}): {
  pending: PendingMemory[]
  tombstones: MemoryTombstone[]
  events: MemoryEvent[]
  counts: TriageApplyCounts
}
```

- [ ] Import the shared helper in `src/codex/codex-ui-api.ts`.

```ts
import { applySafeTriageDecisions } from './triage-apply.js'
```

- [ ] Verify Task 1.

```bash
npm test -- tests/codex-triage-apply.test.ts tests/codex-ui-api.test.ts
npm run typecheck
```

Expected:

```text
Test Files  2 passed
```

```text
Found 0 errors.
```

- [ ] Commit Task 1.

```bash
git add src/codex/triage-apply.ts src/codex/codex-ui-api.ts tests/codex-triage-apply.test.ts
git commit -m "fix: share safe memory triage apply"
```

---

## Task 2: Wire CLI `memory triage --apply`

**Purpose:** CLI apply 必须实际修改 pending/tombstone/event stores，并保持 review-derived candidate 生成行为。

### Files

- Modify `src/codex/codex-memory-triage-cli.ts`
- Modify `tests/codex-memory-triage.test.ts`

### Steps

- [ ] Add a small JSONL helper to `tests/codex-memory-triage.test.ts` if it is not already present.

```ts
function jsonl<T>(text: string): T[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}
```

- [ ] Add the failing test inside `describe('memory triage', ...)`.

```ts
it('applies safe triage decisions from the CLI path', async () => {
  const home = await createTempDir('cyrene-triage-apply-home-')
  vi.stubEnv('HOME', home)
  const cwd = await createTempDir('cyrene-triage-apply-project-')
  await writeFile(join(cwd, 'package.json'), '{"name":"triage-apply-test"}\n', 'utf8')
  const project = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(project.projectId)
  await mkdir(memoryRoot, { recursive: true })
  await writeFile(
    join(memoryRoot, 'pending.jsonl'),
    [
      pending({ id: 'merge-a', normalizedKey: 'release-typecheck', content: 'Use npm run typecheck before release.' }),
      pending({ id: 'merge-b', normalizedKey: 'release-typecheck', content: 'Release verification includes npm run typecheck.' })
    ].map((item) => JSON.stringify(item)).join('\n') + '\n',
    'utf8'
  )

  const output = await runCodexMemoryTriage({
    cwd,
    dryRun: false,
    apply: true,
    now: '2026-05-30T00:00:00.000Z'
  })
  const payload = JSON.parse(output) as { applied?: { auto_drop: number; auto_defer: number; auto_merge: number } }

  expect(payload.applied).toEqual({ auto_drop: 0, auto_defer: 0, auto_merge: 1 })
  const pendingAfter = jsonl<PendingMemory>(await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8'))
  const events = jsonl<MemoryEvent>(await readFile(join(memoryRoot, 'events.jsonl'), 'utf8'))
  expect(pendingAfter.map((item) => item.id)).toEqual(['merge-a'])
  expect(events).toEqual([
    expect.objectContaining({
      action: 'pending',
      candidateId: 'merge-a',
      details: expect.objectContaining({ reviewAction: 'triage_auto_merge' })
    })
  ])
})
```

Run:

```bash
npm test -- tests/codex-memory-triage.test.ts
```

Expected before implementation:

```text
FAIL tests/codex-memory-triage.test.ts
expected undefined to deeply equal { auto_drop: 0, auto_defer: 0, auto_merge: 1 }
```

- [ ] Update imports in `src/codex/codex-memory-triage-cli.ts`.

```ts
import {
  appendMemoryEventFromRoot,
  appendTombstoneFromRoot,
  readActiveMemoriesFromRoot,
  readMemoryEventsFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot,
  writePendingMemoriesFromRoot
} from '../memory/memory-store.js'
import { applySafeTriageDecisions } from './triage-apply.js'
```

- [ ] Apply safe decisions before review-derived candidate generation.

```ts
let applied: ReturnType<typeof applySafeTriageDecisions>['counts'] | undefined
if (input.apply) {
  const safeApply = applySafeTriageDecisions({
    pending,
    decisions: result.decisions,
    now
  })
  await writePendingMemoriesFromRoot(memoryRoot, safeApply.pending)
  for (const tombstone of safeApply.tombstones) {
    await appendTombstoneFromRoot(memoryRoot, tombstone)
  }
  for (const event of safeApply.events) {
    await appendMemoryEventFromRoot(memoryRoot, event)
  }
  applied = safeApply.counts

  const reviewDerived = candidatesFromReviewEvents({
    events: await readMemoryEventsFromRoot(memoryRoot),
    now
  })
  reviewDerivedCandidateCount = reviewDerived.length
  for (const candidate of reviewDerived) {
    await proposeCodexMemoryCandidate({
      cwd: input.cwd,
      candidate,
      now,
      recordRejectedCandidate: false,
      allowAutoPromote: false
    })
  }
}
```

- [ ] Include `applied` in the JSON payload.

```ts
return `${JSON.stringify({
  action: input.apply ? 'apply' : 'dry_run',
  project,
  memoryRoot,
  reviewDerivedCandidateCount,
  ...(applied === undefined ? {} : { applied }),
  ...result
}, null, 2)}\n`
```

- [ ] Verify Task 2.

```bash
npm test -- tests/codex-memory-triage.test.ts tests/codex-ui-api.test.ts tests/codex-triage-apply.test.ts
npm run typecheck
```

Expected:

```text
Test Files  3 passed
```

```text
Found 0 errors.
```

- [ ] Commit Task 2.

```bash
git add src/codex/codex-memory-triage-cli.ts tests/codex-memory-triage.test.ts
git commit -m "fix: apply safe triage decisions from cli"
```

---

## Task 3: Fix Active Lifecycle Event Semantics

**Purpose:** active tombstone 不应继续记为 `archive` event；event action 要表达实际操作。

### Files

- Modify `src/memory/types.ts`
- Modify `src/codex/active-memory-review.ts`
- Modify `tests/codex-active-memory-review.test.ts`

### Steps

- [ ] Add `tombstone` to `MemoryEvent.action`.

```ts
export interface MemoryEvent {
  id: string
  action:
    | 'create'
    | 'update'
    | 'promote'
    | 'pending'
    | 'reject'
    | 'archive'
    | 'tombstone'
    | 'expire'
    | 'supersede'
    | 'snapshot'
    | 'restore'
    | 'audit'
  at: string
  reason: string
  memoryId?: string
  candidateId?: string
  runId?: string
  snapshotId?: string
  details?: Record<string, unknown>
}
```

- [ ] Change the existing `tombstones active memory with an expiring block` test assertions.

```ts
expect(tombstones[0]).toMatchObject({
  memoryId: memory.id,
  normalizedKey: memory.normalizedKey,
  reason: 'deleted'
})
const events = jsonl<MemoryEvent>(await readFile(join(root, 'events.jsonl'), 'utf8'))
expect(events[0]).toMatchObject({
  action: 'tombstone',
  memoryId: memory.id,
  reason: 'Wrong memory.',
  details: expect.objectContaining({ reviewAction: 'tombstone' })
})
```

Run:

```bash
npm test -- tests/codex-active-memory-review.test.ts
```

Expected before implementation:

```text
FAIL tests/codex-active-memory-review.test.ts
expected 'archived' to be 'deleted'
```

- [ ] Update `tombstoneCodexActiveMemory`.

```ts
const tombstone = tombstoneForActiveMemory(memory, {
  reason: 'deleted',
  now,
  ...(input.indefinite === true ? {} : { expiresAt: addDays(now, input.days ?? 180) })
})
```

```ts
await appendMemoryEventFromRoot(lockedMemoryRoot, {
  id: randomUUID(),
  action: 'tombstone',
  at: now,
  reason: input.reason,
  memoryId: memory.id,
  details: {
    reviewAction: 'tombstone',
    tombstoneId: tombstone.id,
    indefinite: input.indefinite === true,
    previousMemory: lifecycleMemorySnapshot(memory, 'archived')
  }
})
```

- [ ] Verify Task 3.

```bash
npm test -- tests/codex-active-memory-review.test.ts tests/eval-runner.test.ts
npm run typecheck
```

Expected:

```text
Test Files  2 passed
```

```text
Found 0 errors.
```

- [ ] Commit Task 3.

```bash
git add src/memory/types.ts src/codex/active-memory-review.ts tests/codex-active-memory-review.test.ts
git commit -m "fix: record active tombstones explicitly"
```

---

## Task 4: Add Distillation Dry-Run Core

**Purpose:** v6 的第一步只产出 evidence-backed candidates，不改写 JSONL store。

### Files

- Create `src/codex/memory-distill.ts`
- Create `tests/codex-memory-distill.test.ts`

### Steps

- [ ] Add tests for deterministic clustering and no mutation.

```ts
// tests/codex-memory-distill.test.ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCodexMemoryDistill } from '../src/codex/memory-distill.js'
import type { PendingMemory } from '../src/memory/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function pending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'Use npm run typecheck before release.',
    normalizedKey: 'release-typecheck',
    evidence: [{ summary: 'Seed evidence.', sourceKind: 'file' }],
    source: 'file',
    scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.9, safety: 0.95, sensitivity: 0.05 },
    seenCount: 2,
    firstSeenAt: '2026-05-30T00:00:00.000Z',
    lastSeenAt: '2026-05-30T00:00:00.000Z',
    expiresAt: '2026-06-30T00:00:00.000Z',
    candidateKind: 'workflow_rule',
    tags: ['release'],
    ...overrides
  }
}

describe('runCodexMemoryDistill', () => {
  it('returns dry-run candidates without mutating memory files', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-memory-')
    const before = [
      pending({ id: 'p1', content: 'Use npm run typecheck before release.' }),
      pending({ id: 'p2', content: 'Release verification includes npm run typecheck.' })
    ].map((item) => JSON.stringify(item)).join('\n') + '\n'
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), before, 'utf8')
    await writeFile(join(memoryRoot, 'index.jsonl'), '', 'utf8')

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.mode).toBe('dry_run')
    expect(result.candidates).toEqual([
      expect.objectContaining({
        sourceIds: ['p1', 'p2'],
        recommendedAction: 'merge_pending',
        risk: 'low'
      })
    ])
    expect(await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).toBe(before)
  })
})
```

Run:

```bash
npm test -- tests/codex-memory-distill.test.ts
```

Expected before implementation:

```text
FAIL tests/codex-memory-distill.test.ts
Cannot find module '../src/codex/memory-distill.js'
```

- [ ] Implement `src/codex/memory-distill.ts`.

```ts
import { codexProjectMemoryRoot } from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'
import { readActiveMemoriesFromRoot, readPendingMemoriesFromRoot } from '../memory/memory-store.js'
import type { CyreneMemory, MemoryEvidence, PendingMemory } from '../memory/types.js'

export type DistillationRisk = 'low' | 'medium' | 'high'
export type DistillationRecommendedAction = 'merge_pending' | 'needs_review'

export interface DistilledMemoryCandidate {
  id: string
  normalizedKey: string
  content: string
  sourceIds: string[]
  evidence: MemoryEvidence[]
  risk: DistillationRisk
  recommendedAction: DistillationRecommendedAction
  reasons: string[]
}

export interface CodexMemoryDistillResult {
  mode: 'dry_run'
  memoryRoot: string
  candidates: DistilledMemoryCandidate[]
  summary: {
    pendingRead: number
    activeRead: number
    candidates: number
  }
}

export async function runCodexMemoryDistill(input: {
  cwd?: string
  memoryRoot?: string
  dryRun?: boolean
}): Promise<CodexMemoryDistillResult> {
  if (input.dryRun === false) {
    throw new Error('memory distill apply is not supported; use dryRun: true')
  }
  const memoryRoot = input.memoryRoot ?? await projectMemoryRootForCwd(input.cwd ?? process.cwd())
  const [pending, active] = await Promise.all([
    readPendingMemoriesFromRoot(memoryRoot),
    readActiveMemoriesFromRoot(memoryRoot)
  ])
  const candidates = buildDistillationCandidates(pending, active)
  return {
    mode: 'dry_run',
    memoryRoot,
    candidates,
    summary: {
      pendingRead: pending.length,
      activeRead: active.length,
      candidates: candidates.length
    }
  }
}

function buildDistillationCandidates(
  pending: PendingMemory[],
  active: CyreneMemory[]
): DistilledMemoryCandidate[] {
  const activeKeys = new Set(active.map((memory) => memory.normalizedKey))
  const byKey = new Map<string, PendingMemory[]>()
  for (const candidate of pending) {
    byKey.set(candidate.normalizedKey, [...(byKey.get(candidate.normalizedKey) ?? []), candidate])
  }

  return [...byKey.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([normalizedKey, items]) => {
      const sorted = [...items].sort((left, right) => left.id.localeCompare(right.id))
      const overlapsActive = activeKeys.has(normalizedKey)
      return {
        id: `distill-${normalizedKey}`,
        normalizedKey,
        content: chooseRepresentativeContent(sorted),
        sourceIds: sorted.map((item) => item.id),
        evidence: sorted.flatMap((item) => item.evidence),
        risk: overlapsActive || sorted.some((item) => item.domain === 'personal' || item.domain === 'relationship' || item.domain === 'affective') ? 'high' : 'low',
        recommendedAction: overlapsActive ? 'needs_review' : 'merge_pending',
        reasons: overlapsActive
          ? ['Pending candidates share a normalizedKey with active memory; explicit review is required.']
          : ['Pending candidates share normalizedKey, scope, and review boundary.']
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
}

function chooseRepresentativeContent(items: PendingMemory[]): string {
  return [...items].sort((left, right) => right.content.length - left.content.length || left.id.localeCompare(right.id))[0].content
}

async function projectMemoryRootForCwd(cwd: string): Promise<string> {
  const project = await identifyCodexProject(cwd)
  return codexProjectMemoryRoot(project.projectId)
}
```

- [ ] Verify Task 4.

```bash
npm test -- tests/codex-memory-distill.test.ts
npm run typecheck
```

Expected:

```text
Test Files  1 passed
```

```text
Found 0 errors.
```

- [ ] Commit Task 4.

```bash
git add src/codex/memory-distill.ts tests/codex-memory-distill.test.ts
git commit -m "feat: add memory distillation dry run"
```

---

## Task 5: Add CLI `memory distill --dry-run`

**Purpose:** 先提供 CLI 可审查入口，保持 dry-run only。

### Files

- Modify `src/codex/codex-cli.ts`
- Modify `tests/codex-cli.test.ts`

### Steps

- [ ] Add a CLI integration test using existing `execFileAsync` and `seedCliPending`.

```ts
it('runs memory distill dry-run from the CLI', async () => {
  const home = await createTempDir('cyrene-distill-cli-home-')
  process.env.HOME = home
  const cwd = await createTempDir('cyrene-distill-cli-project-')
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'distill-cli-test' }), 'utf8')
  await seedCliPending(cwd, [
    createPending({ id: 'distill-a', normalizedKey: 'release-typecheck', content: 'Use npm run typecheck before release.' }),
    createPending({ id: 'distill-b', normalizedKey: 'release-typecheck', content: 'Release verification includes npm run typecheck.' })
  ])

  const result = await execFileAsync(
    process.execPath,
    [
      'node_modules/tsx/dist/cli.mjs',
      'src/main.ts',
      '--cwd',
      cwd,
      'codex',
      'memory',
      'distill',
      '--dry-run'
    ],
    { cwd: process.cwd(), env: cliEnv(home), timeout: 5_000 }
  )

  expect(result.stdout).toContain('"mode": "dry_run"')
  expect(result.stdout).toContain('"recommendedAction": "merge_pending"')
})
```

Run:

```bash
npm test -- tests/codex-cli.test.ts
```

Expected before implementation:

```text
FAIL tests/codex-cli.test.ts
Command failed with exit code 1 and stderr containing "Usage: cyrene-continuity codex"
```

- [ ] Import distillation in `src/codex/codex-cli.ts`.

```ts
import { runCodexMemoryDistill } from './memory-distill.js'
```

- [ ] Add a manual parser branch before `memory active`.

```ts
if (command === 'memory' && input.args[1] === 'distill') {
  if (input.args.includes('--apply')) {
    throw new Error('memory distill --apply is not supported; use --dry-run')
  }
  process.stdout.write(`${JSON.stringify(await runCodexMemoryDistill({
    cwd: input.cwd,
    dryRun: true
  }), null, 2)}\n`)
  return
}
```

- [ ] Add `memory distill [--dry-run]` to the long usage string in `src/codex/codex-cli.ts`.

- [ ] Verify Task 5.

```bash
npm test -- tests/codex-cli.test.ts tests/codex-memory-distill.test.ts
npm run typecheck
```

Expected:

```text
Test Files  2 passed
```

```text
Found 0 errors.
```

- [ ] Commit Task 5.

```bash
git add src/codex/codex-cli.ts tests/codex-cli.test.ts
git commit -m "feat: expose memory distill dry run cli"
```

---

## Task 6: Add Retrieval Excluded Diagnostics

**Purpose:** Retrieval explain 要能说明 excluded candidates，特别是 pending-only、tombstoned、domain-excluded。

### Files

- Modify `src/codex/continuity-context.ts`
- Modify `tests/codex-continuity-context.test.ts`
- Modify `src/ui/static/app.js` only if the existing Retrieval Explain panel should display the new data
- Modify `tests/codex-ui-static.test.ts` if UI rendering changes

### Steps

- [ ] Add diagnostic types in `src/codex/continuity-context.ts`.

```ts
interface RetrievalExcludedMemory {
  id: string
  scope: string
  content: string
  reason: 'pending_review_required' | 'domain_excluded' | 'tombstoned' | 'below_score_threshold'
  score?: number
}
```

Add this field under returned `diagnostics`:

```ts
retrievalExcluded?: RetrievalExcludedMemory[]
```

- [ ] Add a test by extending the existing retrieval explain fixture.

```ts
await writeFile(join(projectMemoryRoot, 'pending.jsonl'), JSON.stringify({
  id: 'pending-route-memory',
  domain: 'procedural',
  type: 'procedural_rule',
  strength: 'soft',
  scope: 'project',
  status: 'pending',
  content: 'Pending route guidance must not be treated as confirmed memory.',
  normalizedKey: 'pending-route-guidance',
  evidence: [{ summary: 'Pending seed.', sourceKind: 'file' }],
  source: 'file',
  scores: { evidenceStrength: 0.7, stability: 0.7, usefulness: 0.7, safety: 0.95, sensitivity: 0.05 },
  seenCount: 1,
  firstSeenAt: '2026-05-30T00:00:00.000Z',
  lastSeenAt: '2026-05-30T00:00:00.000Z',
  expiresAt: '2026-06-30T00:00:00.000Z',
  candidateKind: 'workflow_rule',
  tags: ['route']
}) + '\n')

expect(context.diagnostics?.retrievalExcluded).toContainEqual(
  expect.objectContaining({
    id: 'pending-route-memory',
    reason: 'pending_review_required'
  })
)
```

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts
```

Expected before implementation:

```text
FAIL tests/codex-continuity-context.test.ts
expected undefined to contain object
```

- [ ] Populate excluded diagnostics from routed pending hypotheses and explicit domain exclusions.

```ts
function pendingExcludedDiagnostics(items: PendingHypothesisDigestItem[]): RetrievalExcludedMemory[] {
  return items.map((item) => ({
    id: item.id,
    scope: item.scope,
    content: item.content,
    reason: 'pending_review_required',
    score: item.score
  }))
}
```

When building the final context:

```ts
retrievalExcluded: [
  ...pendingExcludedDiagnostics(routedMemory.pendingHypotheses)
]
```

- [ ] If UI changes, render excluded diagnostics in the existing panel.

```js
function renderRetrievalExcluded(excluded) {
  const rows = Array.isArray(excluded) ? excluded : []
  if (rows.length === 0) return emptyState('No excluded memory diagnostics returned.')
  return `
    <ul class="explain-list">
      ${rows.slice(0, 6).map((item) => `<li class="soft-inset rail-item"><strong>${escapeHtml(item.id || 'memory')}</strong><span>${escapeHtml(item.reason || 'excluded')}</span></li>`).join('')}
    </ul>
  `
}
```

Then add it below `renderRetrievalReasons(...)`.

- [ ] Verify Task 6.

```bash
npm test -- tests/codex-continuity-context.test.ts tests/codex-ui-static.test.ts
npm run typecheck
```

Expected:

```text
Test Files  2 passed
```

```text
Found 0 errors.
```

- [ ] Commit Task 6.

```bash
git add src/codex/continuity-context.ts src/ui/static/app.js tests/codex-continuity-context.test.ts tests/codex-ui-static.test.ts
git commit -m "feat: explain excluded memory retrieval candidates"
```

Only stage `src/ui/static/app.js` and `tests/codex-ui-static.test.ts` if they changed.

---

## Task 7: Add Minimal Distillation Web UI

**Purpose:** UI 可以触发 dry-run 并展示 candidates，但没有 apply button。

### Files

- Modify `src/codex/codex-ui-api.ts`
- Modify `tests/codex-ui-api.test.ts`
- Modify `src/ui/static/app.js`
- Modify `src/ui/static/styles.css`
- Modify `tests/codex-ui-static.test.ts`

### Steps

- [ ] Add an API route test using existing `seedProject` and `handleCodexUiApiRequest`.

```ts
it('returns memory distillation dry-run results', async () => {
  const home = await createTempDir('cyrene-ui-home-')
  vi.stubEnv('HOME', home)
  const { cwd, memoryRoot } = await seedProject()
  await writeFile(
    join(memoryRoot, 'pending.jsonl'),
    [
      createPending({ id: 'distill-a', normalizedKey: 'ui-distill', content: 'Use dry-run for memory distillation.' }),
      createPending({ id: 'distill-b', normalizedKey: 'ui-distill', content: 'Memory distillation starts with dry-run.' })
    ].map((item) => JSON.stringify(item)).join('\n') + '\n',
    'utf8'
  )

  const result = await handleCodexUiApiRequest({
    cwd,
    method: 'POST',
    pathname: '/api/memory/distill/dry-run'
  })

  expect(result.status).toBe(200)
  expect(result.body.ok).toBe(true)
  if (result.body.ok) {
    expect(result.body.data).toMatchObject({
      mode: 'dry_run',
      candidates: [expect.objectContaining({ recommendedAction: 'merge_pending' })]
    })
  }
})
```

Run:

```bash
npm test -- tests/codex-ui-api.test.ts
```

Expected before implementation:

```text
FAIL tests/codex-ui-api.test.ts
expected 404 to be 200
```

- [ ] Import and add route in `src/codex/codex-ui-api.ts`.

```ts
import { runCodexMemoryDistill } from './memory-distill.js'
```

```ts
if (request.method === 'POST' && request.pathname === '/api/memory/distill/dry-run') {
  return ok(await runCodexMemoryDistill({
    cwd: request.cwd,
    dryRun: true
  }))
}
```

- [ ] Add static UI state and renderer.

```js
async function runMemoryDistillDryRun() {
  state.distill = { loading: true, error: '', result: null }
  render()
  try {
    const response = await apiFetch('/api/memory/distill/dry-run', { method: 'POST' })
    const payload = await response.json()
    if (!payload.ok) throw new Error(payload.error?.message || 'Distillation dry-run failed.')
    state.distill = { loading: false, error: '', result: payload.data }
  } catch (error) {
    state.distill = { loading: false, error: errorMessage(error), result: null }
  }
  render()
}

function renderDistillPanel() {
  const distill = state.distill || { loading: false, error: '', result: null }
  const candidates = Array.isArray(distill.result?.candidates) ? distill.result.candidates : []
  return `
    <div class="soft-panel">
      <div class="panel-heading-row">
        <h3>Distillation</h3>
        <button class="soft-button compact" type="button" data-memory-distill-dry-run>Dry Run</button>
      </div>
      ${distill.loading ? '<p class="muted">Loading dry run...</p>' : ''}
      ${distill.error ? `<p class="notice error">${escapeHtml(distill.error)}</p>` : ''}
      ${candidates.length === 0 ? emptyState('No distillation candidates returned.') : renderDistillCandidates(candidates)}
    </div>
  `
}

function renderDistillCandidates(candidates) {
  return `
    <div class="distill-list">
      ${candidates.slice(0, 10).map((candidate) => `
        <article class="soft-inset distill-item">
          <strong>${escapeHtml(candidate.id || 'candidate')}</strong>
          <span>${escapeHtml(candidate.recommendedAction || 'review')}</span>
          <p>${escapeHtml(candidate.content || '')}</p>
        </article>
      `).join('')}
    </div>
  `
}
```

- [ ] Bind the button.

```js
const distillButton = document.querySelector('[data-memory-distill-dry-run]')
if (distillButton) {
  distillButton.addEventListener('click', () => {
    runMemoryDistillDryRun()
  })
}
```

- [ ] Add static tests.

```ts
it('contains memory distillation dry-run UI hooks', async () => {
  const script = await readFile(join(projectRoot, 'src/ui/static/app.js'), 'utf8')
  expect(script).toContain('data-memory-distill-dry-run')
  expect(script).toContain('renderDistillCandidates')
})
```

- [ ] Verify Task 7.

```bash
npm test -- tests/codex-ui-api.test.ts tests/codex-ui-static.test.ts tests/codex-memory-distill.test.ts
npm run typecheck
```

Expected:

```text
Test Files  3 passed
```

```text
Found 0 errors.
```

- [ ] Manual Browser verification after implementation:
  - Start the existing UI dev command.
  - Open the localhost URL with the Browser plugin.
  - Verify the Distillation panel renders.
  - Click Dry Run and confirm candidate rows appear.
  - Confirm there is no apply action.
  - Check desktop and mobile widths for text overlap.

- [ ] Commit Task 7.

```bash
git add src/codex/codex-ui-api.ts src/ui/static/app.js src/ui/static/styles.css tests/codex-ui-api.test.ts tests/codex-ui-static.test.ts
git commit -m "feat: add distillation dry run ui"
```

---

## Task 8: Add Release Eval Gate And Docs

**Purpose:** release gate 要证明 distillation 没有绕开 v5 review model。

### Files

- Modify `src/eval/eval-runner.ts`
- Modify `tests/eval-runner.test.ts`
- Modify the project documentation file that lists Codex memory CLI commands
- Modify `plugin/skills/cyrene-continuity/SKILL.md` only if the public skill workflow changes

### Steps

- [ ] Add eval check name.

```ts
export type EvalCheckName =
  | 'memory_routing_eval'
  | 'cross_project_leak_eval'
  | 'similar_hint_eval'
  | 'pending_usage_eval'
  | 'profile_pollution_eval'
  | 'affective_boundary_eval'
  | 'auto_promotion_policy_eval'
  | 'global_auto_promotion_eval'
  | 'active_lifecycle_eval'
  | 'pending_budget_eval'
  | 'memory_edge_eval'
  | 'retrieval_explain_eval'
  | 'distillation_review_gate'
```

Add `'distillation_review_gate'` to `MINIMUM_EVAL_CHECKS`.

- [ ] Add pure gate function.

```ts
export interface V6DistillationReviewGateItem {
  candidateId: string
  mode: 'dry_run' | 'apply'
  mutatedStores: string[]
  recommendedAction: string
  sourceIds: string[]
}

export function runV6DistillationReviewGate(items: V6DistillationReviewGateItem[]): EvalGateResult {
  const findings = items
    .filter((item) => item.mode !== 'dry_run' || item.mutatedStores.length > 0 || item.sourceIds.length === 0)
    .map((item) => ({
      memoryId: item.candidateId,
      reason: item.mode !== 'dry_run'
        ? 'distillation MVP must run in dry_run mode'
        : item.mutatedStores.length > 0
          ? `distillation dry_run mutated stores: ${item.mutatedStores.join(', ')}`
          : 'distillation candidate lacks source ids'
    }))
  return gate([result('distillation_review_gate', findings)])
}
```

- [ ] Include the gate in `runV5ReleaseReadinessEvalGate`.

```ts
...runV6DistillationReviewGate([{
  candidateId: 'release-distill-preview',
  mode: 'dry_run',
  mutatedStores: [],
  recommendedAction: 'merge_pending',
  sourceIds: ['pending-a', 'pending-b']
}]).results
```

- [ ] Add tests.

```ts
it('passes distillation_review_gate for dry-run candidates with sources', () => {
  const result = runV6DistillationReviewGate([{
    candidateId: 'distill-1',
    mode: 'dry_run',
    mutatedStores: [],
    recommendedAction: 'merge_pending',
    sourceIds: ['p1', 'p2']
  }])

  expect(result.passed).toBe(true)
})

it('fails distillation_review_gate when dry-run mutates stores', () => {
  const result = runV6DistillationReviewGate([{
    candidateId: 'distill-1',
    mode: 'dry_run',
    mutatedStores: ['pending.jsonl'],
    recommendedAction: 'merge_pending',
    sourceIds: ['p1', 'p2']
  }])

  expect(result.failedChecks).toContain('distillation_review_gate')
})
```

- [ ] Document the CLI behavior.

```md
### Memory distillation

`codex memory distill --dry-run` previews evidence-backed distillation candidates. It does not mutate pending memory, active memory, tombstones, or events. Apply flows remain gated by v5 review policy and review-hash validation.
```

- [ ] Verify Task 8.

```bash
npm test -- tests/eval-runner.test.ts tests/codex-memory-distill.test.ts
npm run dev -- codex eval run --check release
npm run typecheck
git diff --check
```

Expected:

```text
Test Files  2 passed
```

```text
Release check passed
```

```text
Found 0 errors.
```

- [ ] If the plugin skill changed, rebuild and validate.

```bash
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected:

```text
Plugin validation passed
```

- [ ] Commit Task 8.

```bash
git add src/eval/eval-runner.ts tests/eval-runner.test.ts README.md plugin/skills/cyrene-continuity/SKILL.md plugin
git commit -m "test: gate memory distillation release safety"
```

Only stage files that actually changed.

---

## Final Verification

Run:

```bash
npm test
npm run typecheck
npm run dev -- codex eval run --check release
git diff --check
git status --short
```

Expected:

```text
Test Files  all passed
```

```text
Found 0 errors.
```

```text
Release check passed
```

```text
git status shows only intentional files or a clean tree after commits
```

## Review Notes

- High-risk or ambiguous memory still requires explicit user approval and review-hash validation.
- Strict low-risk project/global memory may auto-promote only through named v5 policy, daily caps, eval gates, and auditable `MemoryEvent` receipts.
- Distillation MVP remains dry-run only. Any apply path needs a new spec and must reuse v5 review policy.
