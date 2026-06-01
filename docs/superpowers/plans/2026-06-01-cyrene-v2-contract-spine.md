# Cyrene v2 Contract Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Cyrene v2 semantic memory pipeline 增加共享 type contracts 和 JSONL store helpers，让后续 Distillation、Router、Review UI、Activation/Reflection tracks 可以并行实现。

**Architecture:** 本 plan 只实现 PR0 Contract Spine：新增 v2 `SemanticMemory` 相关类型，以及 `semantic_memories.jsonl`、`distillation_inputs.jsonl`、`routing_decisions.jsonl`、`review_decisions.jsonl`、`activation_events.jsonl`、`reflection_candidates.jsonl` 的安全读写 helper。它不迁移旧 active memory，不删除 pending，不切换现有 runtime 行为。

**Tech Stack:** TypeScript ES2022、NodeNext、Vitest、JSONL memory store、existing symlink-safe memory root helpers。

---

## Scope

本 plan 只覆盖 `docs/superpowers/specs/2026-06-01-cyrene-v2-semantic-memory-pipeline-design.md` 的 PR0。

明确不做：

- 不修改 `proposeCodexMemoryCandidate`、pending review tools、Web UI、retrieval 或 distillation behavior。
- 不迁移旧 `index.jsonl` / `pending.jsonl`。
- 不生成或应用 `DistillationInput`。
- 不新增 `MemoryRouter` 策略实现。
- 不改 generated plugin runtime。

成功标准：

- v2 类型可被 TypeScript 使用。
- 每个 v2 JSONL store helper 可以 append/read 或 write/read。
- missing file 返回空数组。
- symlinked data file 被拒绝。
- `npm test -- tests/semantic-memory-v2-store.test.ts` 通过。
- `npm run typecheck` 通过。

## File Structure

- Modify: `src/memory/types.ts`
  - 新增 `MemoryModule`、`SemanticMemoryStatus`、`UpdatePolicy`、`ActivationEventType`、`ReflectionAction` 枚举常量和 type aliases。
  - 新增 `StructuredEvidence`、`RoutedMemoryTarget`、`SemanticMemory`、`DistillationInput`、`RoutingDecision`、`ReviewDecision`、`ActivationEvent`、`ReflectionCandidate` interfaces。
- Modify: `src/memory/memory-store.ts`
  - 新增 v2 JSONL 文件常量。
  - 新增 semantic memory read/write helpers。
  - 新增 distillation/routing/review/activation/reflection append/read helpers。
  - 复用现有 `ensureWritableMemoryRoot`、`isReadableMemoryRoot`、`readJsonLines`、`writeJsonLinesAtomic`、`appendJsonLine`、`assertSafeMemoryDataFileTarget`。
- Create: `tests/semantic-memory-v2-store.test.ts`
  - 覆盖 v2 records 的 read/write 行为、missing file、symlink safety。

## Task 1: Add v2 Store Tests

**Files:**
- Create: `tests/semantic-memory-v2-store.test.ts`

- [ ] **Step 1: Write the failing v2 store tests**

Create `tests/semantic-memory-v2-store.test.ts` with this content:

```ts
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendActivationEventFromRoot,
  appendDistillationInputFromRoot,
  appendReflectionCandidateFromRoot,
  appendReviewDecisionFromRoot,
  appendRoutingDecisionFromRoot,
  readActivationEventsFromRoot,
  readDistillationInputsFromRoot,
  readReflectionCandidatesFromRoot,
  readReviewDecisionsFromRoot,
  readRoutingDecisionsFromRoot,
  readSemanticMemoriesFromRoot,
  writeSemanticMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type {
  ActivationEvent,
  DistillationInput,
  ReflectionCandidate,
  ReviewDecision,
  RoutingDecision,
  SemanticMemory
} from '../src/memory/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function semanticMemory(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  return {
    id: 'semantic-1',
    status: 'pending',
    module: 'project_semantic',
    kind: 'known_pitfall',
    scope: 'project',
    domain: 'procedural',
    content: 'Readiness parsing should cover Chinese implementation-pattern phrases.',
    useWhen: ['Changing active-readiness heuristics'],
    doNotUseWhen: ['The task is unrelated to readiness/admission'],
    sourceOfTruth: 'review_summary:2026-06-01T03:06:00.281Z',
    evidence: [
      {
        id: 'evidence-1',
        sourceKind: 'review_summary',
        sourceRef: 'review_summary:2026-06-01T03:06:00.281Z',
        when: '2026-06-01T03:06:00.281Z',
        whatHappened: 'Readiness missed Chinese implementation-pattern phrases.',
        whyImportant: 'Raw implementation notes could be marked active-ready.',
        result: 'Heuristic was updated.'
      }
    ],
    reviewPolicy: 'pending_review',
    supersedes: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function distillationInput(overrides: Partial<DistillationInput> = {}): DistillationInput {
  return {
    id: 'distillation-input-1',
    sourceDraftIds: ['draft-1'],
    sourceEpisodeIds: ['episode-1'],
    sourceSemanticMemoryIds: ['semantic-active-1'],
    admissionDecisionIds: ['admission-1'],
    normalizedKey: 'readiness-chinese-implementation-pattern',
    candidateKind: 'known_pitfall',
    scope: 'project',
    domain: 'procedural',
    sourceKinds: ['review_summary'],
    rawContents: ['实现 active memory readiness gate，防止未压缩候选直接进入 active memory'],
    evidenceRefs: ['review_summary:2026-06-01T03:06:00.281Z'],
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function routingDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    id: 'routing-1',
    semanticMemoryId: 'semantic-1',
    target: {
      module: 'project_semantic',
      updatePolicy: 'pending_review',
      risk: 'low',
      reasons: ['project-scoped pitfall requires review before active memory']
    },
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function reviewDecision(overrides: Partial<ReviewDecision> = {}): ReviewDecision {
  return {
    id: 'review-1',
    semanticMemoryId: 'semantic-1',
    policy: 'pending_review',
    reviewHash: 'review-hash-1',
    reasons: ['visible evidence required before approval'],
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function activationEvent(overrides: Partial<ActivationEvent> = {}): ActivationEvent {
  return {
    id: 'activation-1',
    memoryId: 'semantic-active-1',
    projectId: 'project-1',
    queryHash: 'query-hash-1',
    event: 'retrieved',
    evidenceRef: 'turn:1',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function reflectionCandidate(overrides: Partial<ReflectionCandidate> = {}): ReflectionCandidate {
  return {
    id: 'reflection-1',
    sourceActivationEventIds: ['activation-1'],
    proposedAction: 'rewrite',
    candidate: semanticMemory({ id: 'semantic-reflection-1', status: 'candidate' }),
    reasons: ['memory was contradicted by tool evidence'],
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

describe('Semantic memory v2 store', () => {
  it('writes and reads semantic memories from the v2 store', async () => {
    const root = await createTempDir('cyrene-semantic-root-')

    await writeSemanticMemoriesFromRoot(root, [
      semanticMemory(),
      semanticMemory({ id: 'semantic-2', status: 'active', content: 'Second memory.' })
    ])

    await expect(readSemanticMemoriesFromRoot(root)).resolves.toEqual([
      semanticMemory(),
      semanticMemory({ id: 'semantic-2', status: 'active', content: 'Second memory.' })
    ])
    await expect(readFile(join(root, 'semantic_memories.jsonl'), 'utf8')).resolves.toContain('"id":"semantic-1"')
  })

  it('appends and reads v2 sidecar records from memory root', async () => {
    const root = await createTempDir('cyrene-v2-sidecar-root-')

    await appendDistillationInputFromRoot(root, distillationInput())
    await appendRoutingDecisionFromRoot(root, routingDecision())
    await appendReviewDecisionFromRoot(root, reviewDecision())
    await appendActivationEventFromRoot(root, activationEvent())
    await appendReflectionCandidateFromRoot(root, reflectionCandidate())

    await expect(readDistillationInputsFromRoot(root)).resolves.toEqual([distillationInput()])
    await expect(readRoutingDecisionsFromRoot(root)).resolves.toEqual([routingDecision()])
    await expect(readReviewDecisionsFromRoot(root)).resolves.toEqual([reviewDecision()])
    await expect(readActivationEventsFromRoot(root)).resolves.toEqual([activationEvent()])
    await expect(readReflectionCandidatesFromRoot(root)).resolves.toEqual([reflectionCandidate()])
  })

  it('returns empty lists when v2 files are missing', async () => {
    const root = await createTempDir('cyrene-v2-empty-root-')

    await expect(readSemanticMemoriesFromRoot(root)).resolves.toEqual([])
    await expect(readDistillationInputsFromRoot(root)).resolves.toEqual([])
    await expect(readRoutingDecisionsFromRoot(root)).resolves.toEqual([])
    await expect(readReviewDecisionsFromRoot(root)).resolves.toEqual([])
    await expect(readActivationEventsFromRoot(root)).resolves.toEqual([])
    await expect(readReflectionCandidatesFromRoot(root)).resolves.toEqual([])
  })

  it('refuses to write semantic memories through a symlinked data file', async () => {
    const root = await createTempDir('cyrene-v2-symlink-root-')
    const outside = await createTempDir('cyrene-v2-symlink-outside-')
    const outsideSemanticMemories = join(outside, 'semantic_memories.jsonl')
    await mkdir(dirname(join(root, 'semantic_memories.jsonl')), { recursive: true })
    await writeFile(outsideSemanticMemories, 'outside target must stay unchanged\n')
    await symlink(outsideSemanticMemories, join(root, 'semantic_memories.jsonl'))

    await expect(writeSemanticMemoriesFromRoot(root, [semanticMemory()])).rejects.toThrow(/memory data file symlink/)
    await expect(readFile(outsideSemanticMemories, 'utf8')).resolves.toBe('outside target must stay unchanged\n')
  })
})
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
npm test -- tests/semantic-memory-v2-store.test.ts
```

Expected: FAIL with TypeScript/module errors because v2 store helpers and types do not exist yet.

## Task 2: Add v2 Type Contracts

**Files:**
- Modify: `src/memory/types.ts`
- Test: `tests/semantic-memory-v2-store.test.ts`

- [ ] **Step 1: Add v2 constants and type aliases**

In `src/memory/types.ts`, add this block after `MemoryCandidateKind`:

```ts
export const MEMORY_MODULES = [
  'project_semantic',
  'procedural',
  'system',
  'preference',
  'global_policy',
  'relationship_affective',
  'principle_candidate'
] as const
export type MemoryModule = typeof MEMORY_MODULES[number]

export const SEMANTIC_MEMORY_STATUSES = [
  'candidate',
  'pending',
  'active',
  'archived',
  'rejected',
  'superseded'
] as const
export type SemanticMemoryStatus = typeof SEMANTIC_MEMORY_STATUSES[number]

export const UPDATE_POLICIES = [
  'strict_auto_promote',
  'pending_review',
  'manual_only',
  'drop',
  'defer'
] as const
export type UpdatePolicy = typeof UPDATE_POLICIES[number]

export const ACTIVATION_EVENT_TYPES = ['retrieved', 'used', 'ignored', 'contradicted', 'stale'] as const
export type ActivationEventType = typeof ACTIVATION_EVENT_TYPES[number]

export const REFLECTION_ACTIONS = ['reinforce', 'rewrite', 'deprecate', 'split', 'merge'] as const
export type ReflectionAction = typeof REFLECTION_ACTIONS[number]
```

- [ ] **Step 2: Add v2 interfaces**

In `src/memory/types.ts`, add this block after `AdmissionDecision`:

```ts
export interface StructuredEvidence {
  id: string
  sourceKind: string
  sourceRef: string
  when?: string
  whatHappened: string
  whyImportant: string
  result?: string
}

export interface RoutedMemoryTarget {
  module: MemoryModule
  updatePolicy: UpdatePolicy
  risk: 'low' | 'medium' | 'high'
  reasons: string[]
}

export interface SemanticMemory {
  id: string
  status: SemanticMemoryStatus
  module: MemoryModule
  kind: MemoryCandidateKind
  scope: MemoryScope
  domain: MemoryDomain
  content: string
  useWhen: string[]
  doNotUseWhen: string[]
  sourceOfTruth?: string
  evidence: StructuredEvidence[]
  routing?: RoutedMemoryTarget
  reviewPolicy: UpdatePolicy
  supersedes: string[]
  expiresAt?: string
  reviewAfter?: string
  createdAt: string
  updatedAt: string
}

export interface DistillationInput {
  id: string
  sourceDraftIds: string[]
  sourceEpisodeIds: string[]
  sourceSemanticMemoryIds: string[]
  admissionDecisionIds: string[]
  normalizedKey?: string
  candidateKind: MemoryCandidateKind
  scope: MemoryScope
  domain: MemoryDomain
  sourceKinds: string[]
  rawContents: string[]
  evidenceRefs: string[]
  createdAt: string
}

export interface RoutingDecision {
  id: string
  semanticMemoryId: string
  target: RoutedMemoryTarget
  createdAt: string
}

export interface ReviewDecision {
  id: string
  semanticMemoryId: string
  policy: UpdatePolicy
  reviewHash?: string
  reasons: string[]
  createdAt: string
}

export interface ActivationEvent {
  id: string
  memoryId: string
  projectId?: string
  queryHash?: string
  event: ActivationEventType
  evidenceRef?: string
  createdAt: string
}

export interface ReflectionCandidate {
  id: string
  sourceActivationEventIds: string[]
  proposedAction: ReflectionAction
  candidate: SemanticMemory
  reasons: string[]
  createdAt: string
}
```

- [ ] **Step 3: Run the focused test and confirm remaining failure is store helpers**

Run:

```bash
npm test -- tests/semantic-memory-v2-store.test.ts
```

Expected: FAIL because `memory-store.ts` still does not export the v2 helpers. Type import errors for v2 contracts should be gone.

## Task 3: Add v2 JSONL Store Helpers

**Files:**
- Modify: `src/memory/memory-store.ts`
- Test: `tests/semantic-memory-v2-store.test.ts`

- [ ] **Step 1: Add v2 types to memory-store import**

In `src/memory/memory-store.ts`, update the type import to include v2 records:

```ts
import type {
  ActivationEvent,
  AdmissionDecision,
  CandidateDraft,
  CyreneMemory,
  DistillationInput,
  EpisodeMemory,
  MemoryEvent,
  MemoryScores,
  MemoryTombstone,
  PendingMemory,
  ReflectionCandidate,
  ReviewDecision,
  RoutingDecision,
  SemanticMemory
} from './types.js'
```

- [ ] **Step 2: Add v2 file constants**

In `src/memory/memory-store.ts`, add these constants after `ADMISSION_DECISIONS_FILE`:

```ts
const SEMANTIC_MEMORIES_FILE = 'semantic_memories.jsonl'
const DISTILLATION_INPUTS_FILE = 'distillation_inputs.jsonl'
const ROUTING_DECISIONS_FILE = 'routing_decisions.jsonl'
const REVIEW_DECISIONS_FILE = 'review_decisions.jsonl'
const ACTIVATION_EVENTS_FILE = 'activation_events.jsonl'
const REFLECTION_CANDIDATES_FILE = 'reflection_candidates.jsonl'
```

- [ ] **Step 3: Add semantic memory read/write helpers**

In `src/memory/memory-store.ts`, add this block after `readAdmissionDecisionsFromRoot`:

```ts
export async function readSemanticMemoriesFromRoot(memoryRoot: string): Promise<SemanticMemory[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<SemanticMemory>(join(memoryRoot, SEMANTIC_MEMORIES_FILE))
}

export async function writeSemanticMemoriesFromRoot(
  memoryRoot: string,
  memories: SemanticMemory[]
): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await writeJsonLinesAtomic(join(root, SEMANTIC_MEMORIES_FILE), memories)
}
```

- [ ] **Step 4: Add v2 sidecar append/read helpers**

In `src/memory/memory-store.ts`, add this block after `writeSemanticMemoriesFromRoot`:

```ts
export async function appendDistillationInputFromRoot(
  memoryRoot: string,
  input: DistillationInput
): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, DISTILLATION_INPUTS_FILE), input)
}

export async function readDistillationInputsFromRoot(memoryRoot: string): Promise<DistillationInput[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<DistillationInput>(join(memoryRoot, DISTILLATION_INPUTS_FILE))
}

export async function appendRoutingDecisionFromRoot(
  memoryRoot: string,
  decision: RoutingDecision
): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, ROUTING_DECISIONS_FILE), decision)
}

export async function readRoutingDecisionsFromRoot(memoryRoot: string): Promise<RoutingDecision[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<RoutingDecision>(join(memoryRoot, ROUTING_DECISIONS_FILE))
}

export async function appendReviewDecisionFromRoot(
  memoryRoot: string,
  decision: ReviewDecision
): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, REVIEW_DECISIONS_FILE), decision)
}

export async function readReviewDecisionsFromRoot(memoryRoot: string): Promise<ReviewDecision[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<ReviewDecision>(join(memoryRoot, REVIEW_DECISIONS_FILE))
}

export async function appendActivationEventFromRoot(
  memoryRoot: string,
  event: ActivationEvent
): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, ACTIVATION_EVENTS_FILE), event)
}

export async function readActivationEventsFromRoot(memoryRoot: string): Promise<ActivationEvent[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<ActivationEvent>(join(memoryRoot, ACTIVATION_EVENTS_FILE))
}

export async function appendReflectionCandidateFromRoot(
  memoryRoot: string,
  candidate: ReflectionCandidate
): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, REFLECTION_CANDIDATES_FILE), candidate)
}

export async function readReflectionCandidatesFromRoot(memoryRoot: string): Promise<ReflectionCandidate[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<ReflectionCandidate>(join(memoryRoot, REFLECTION_CANDIDATES_FILE))
}
```

- [ ] **Step 5: Run the focused v2 store test**

Run:

```bash
npm test -- tests/semantic-memory-v2-store.test.ts
```

Expected: PASS.

## Task 4: Run Contract Spine Verification

**Files:**
- Modify: `src/memory/types.ts`
- Modify: `src/memory/memory-store.ts`
- Test: `tests/semantic-memory-v2-store.test.ts`

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 2: Run focused memory tests**

Run:

```bash
npm test -- tests/semantic-memory-v2-store.test.ts tests/codex-candidate-drafts.test.ts tests/codex-episode-memory.test.ts
```

Expected: PASS. This verifies new helpers and confirms existing episode/draft store helpers still behave.

- [ ] **Step 3: Commit PR0 contract spine**

Run:

```bash
git add src/memory/types.ts src/memory/memory-store.ts tests/semantic-memory-v2-store.test.ts
git commit -m "feat: add cyrene v2 memory contract spine"
```

Expected: commit succeeds with only the three PR0 files staged.

## Plan Self-Review

Spec coverage:

- PR0 contract spine: covered by Tasks 1-4.
- v2 type contracts: covered by Task 2.
- v2 store helpers: covered by Task 3.
- Tests for missing files, symlink safety, and read/write behavior: covered by Task 1 and Task 4.
- Migration, DistillationInput generation, Router policy, Review UI, Activation/Reflection behavior: intentionally out of scope for PR0 and require follow-up plans.

Placeholder scan:

- No placeholder markers or “similar to” shortcuts are present.

Type consistency:

- Plan uses `sourceSemanticMemoryIds`, matching the accepted spec.
- Plan uses `SemanticMemory(status='pending'|'active'|'candidate')`, matching the accepted spec.
- Store helper names use `FromRoot` suffix consistently with existing `memory-store.ts` patterns.
