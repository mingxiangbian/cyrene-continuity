# Cyrene v1.3 Pending Quality And v2 Carryover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 v1.3 pending quality 更新和 v2 未完成的 semantic memory 主路径补齐到可审查、可验证、可 UI 展示的状态。

**Architecture:** 先落一个共享 `MemoryRouter`/structured review vocabulary，后续 admission、distillation、pending review、Web UI、Activation/Reflection 都复用同一套 `module`、`updatePolicy`、`sourceOfTruth`、`evidence` 字段。legacy `PendingMemory` 和 active memory 仍是写入主存储，v2 sidecar records 只增加可审计路径，不绕过 v5 review-hash、manual review 和 strict low-risk auto-promote receipt。

**Tech Stack:** TypeScript ES2022、NodeNext、Vitest、JSONL memory store、existing v5 memory review/auto-promotion policy、static Web UI source under `src/ui/static/app.js`。

---

## Scope

本 plan 覆盖 `docs/superpowers/specs/2026-06-01-cyrene-v1-3-pending-quality-and-v2-carryover-design.md` 中 v1.3 与 v2 carryover 的实现任务：

- P0 pending quality：source-of-truth duplicate gate、episode/task/memory classification、review card semantics。
- P1 v2 carryover：`DistillationInput` 被 distill dry-run 消费、`MemoryRouter`/`UpdatePolicy` 成为 admission 后的显式决策、Active Memory Structured Approval Gate。
- P2 automation/UI completeness：P2-1 自动化分级策略、P2-2 low-risk strict auto-promote receipt、P2-3 UI 显示 `module`/`updatePolicy`/`sourceOfTruth`/`evidence`。
- P3 feedback loop carryover：`ActivationEvent` minimal runtime hook、`ReflectionCandidate` review-first。
- Multi-agent execution：每个实现任务由 fresh subagent 执行，coordinator 在每个任务后做 spec compliance review 和 code quality review。

明确不做：

- 不允许高风险、ambiguous、personal、relationship、affective、assistant-observed-only memory auto-promote。
- 不删除旧 pending/active 存储，也不迁移 `index.jsonl`。
- 不实现 distill apply；`runCodexMemoryDistill` 仍只支持 `dry_run`。
- 不直接编辑 generated plugin runtime；如 `src/codex/codex-ui-static.generated.ts` 需要变化，通过 `npm run build:plugin` 生成。
- 不编辑 `REVIEW_REPORT.md`。

成功标准：

- `npm test -- tests/codex-memory-router.test.ts tests/codex-admission-gate.test.ts tests/codex-admission-pipeline.test.ts tests/codex-memory-distill.test.ts tests/codex-memory-review.test.ts tests/codex-ui-api.test.ts tests/codex-ui-static.test.ts tests/codex-continuity-context.test.ts tests/semantic-memory-v2-store.test.ts` 通过。
- `npm run typecheck` 通过。
- `npm run build:plugin` 通过。
- `python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin` 通过。
- `git diff --check` 通过。

## File Structure

- Modify: `src/memory/types.ts`
  - 给 `CandidateDraft` 增加 optional `sourceOfTruth` 和 `taskState`。
  - 给 `DistillationInput` 增加 optional `sourceOfTruth`。
  - 给 `ADMISSION_REASONS` 增加 `source_of_truth_duplicate`、`task_state`。
- Modify: `src/codex/candidate-drafts.ts`
  - 从 `CodexMemoryCandidateInput.sourceOfTruth` 和 evidence refs 生成 draft-level `sourceOfTruth`。
- Modify: `src/codex/memory-propose.ts`
  - 给 `CodexMemoryCandidateInput` 增加 optional `sourceOfTruth`，保持 `MemoryEvent` auto-promote receipt 的 v5 policy details。
- Create: `src/codex/memory-router.ts`
  - 唯一维护 `module`、`updatePolicy`、`risk`、routing reasons、structured evidence、source-of-truth normalization。
- Create: `tests/codex-memory-router.test.ts`
  - 覆盖 routing vocabulary、high-risk manual-only、structured semantic candidate preview。
- Modify: `src/codex/admission-gate.ts`
  - source-of-truth duplicate gate。
  - task-state / episode-only classification。
  - ready item 必须有正向 admission/routing reason。
- Modify: `src/codex/admission-pipeline.ts`
  - admission 后写 `routing_decisions.jsonl` 和 `review_decisions.jsonl`。
  - `admit_to_distillation` 的 `DistillationInput` 携带 `sourceOfTruth`。
  - `admit_to_pending` / `merge_with_existing` 继续调用 `proposeCodexMemoryCandidate`，不绕过 v5 policy。
- Modify: `src/codex/memory-distill.ts`
  - dry-run 读取 `distillation_inputs.jsonl`，输出 semantic candidate preview。
- Modify: `src/codex/memory-review.ts`
  - pending summary 和 active approval gate 显示/校验 structured fields。
- Modify: `src/codex/codex-ui-api.ts`
  - dashboard API 输出结构不剥离 structured fields；auto-promote receipt 对 UI 可见。
- Modify: `src/ui/static/app.js`
  - pending/active review card 显示 `module`、`updatePolicy`、`sourceOfTruth`、structured `evidence`。
- Modify: `src/codex/continuity-context.ts`
  - retrieval 主路径 fail-open 写 `ActivationEvent`。
- Create: `src/codex/memory-feedback.ts`
  - `ActivationEvent` append helper 和 contradicted/stale -> `ReflectionCandidate` builder。
- Modify existing tests:
  - `tests/codex-admission-gate.test.ts`
  - `tests/codex-admission-pipeline.test.ts`
  - `tests/codex-memory-distill.test.ts`
  - `tests/codex-memory-review.test.ts`
  - `tests/codex-ui-api.test.ts`
  - `tests/codex-ui-static.test.ts`
  - `tests/codex-continuity-context.test.ts`

## Subagent Execution Protocol

- Coordinator 先执行 Task 1，冻结 shared vocabulary。
- Task 2 到 Task 6 串行派发 fresh `worker` subagent；不要并行实现，因为这些任务会共享 `src/memory/types.ts`、`src/codex/memory-review.ts` 或 test fixtures。
- 每个 worker 必须：
  - 在自己的任务 scope 内直接编辑文件。
  - 不 revert 其他 worker 或用户的改动。
  - 运行任务内指定 tests。
  - 返回 `DONE`、changed files、commands run、residual concerns。
- 每个任务完成后 coordinator 派发两个 read-only reviewer subagents：
  - spec reviewer：只检查该任务是否满足本 plan 和 spec。
  - code quality reviewer：只检查 bug、regression、missing tests、overreach。
- reviewer 有 open issue 时，coordinator 把具体 issue 发回同一个 worker 修复，再重复 review。

## Task 1: Shared Memory Router Contract

**Files:**
- Modify: `src/memory/types.ts`
- Modify: `src/codex/memory-propose.ts`
- Modify: `src/codex/candidate-drafts.ts`
- Create: `src/codex/memory-router.ts`
- Create: `tests/codex-memory-router.test.ts`

- [ ] **Step 1: Write failing router tests**

Create `tests/codex-memory-router.test.ts` with tests that assert these exact behaviors:

```ts
import { describe, expect, it } from 'vitest'
import {
  reviewDecisionForRoute,
  routeCandidateDraft,
  semanticCandidateFromDraft
} from '../src/codex/memory-router.js'
import type { AdmissionDecision, CandidateDraft } from '../src/memory/types.js'

function draft(overrides: Partial<CandidateDraft> = {}): CandidateDraft {
  return {
    id: 'draft-1',
    content: 'For non-trivial code or architecture changes, edits must stay surgical. Source of truth: AGENTS.md.',
    candidateKind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    sourceKind: 'review_summary',
    sourceEpisodeIds: ['episode-1'],
    evidenceRefs: ['AGENTS.md'],
    normalizedKey: 'workflow-agents-surgical-edits',
    sourceOfTruth: 'AGENTS.md',
    tags: ['workflow'],
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function admission(overrides: Partial<AdmissionDecision> = {}): AdmissionDecision {
  return {
    id: 'admission-1',
    draftId: 'draft-1',
    action: 'admit_to_pending',
    admissionScore: 0.72,
    reasons: ['valuable_workflow_rule'],
    scores: {
      futureUsefulness: 0.85,
      actionability: 0.85,
      stability: 0.8,
      specificity: 0.75,
      evidenceStrength: 0.75,
      repeatPotential: 0.7,
      expiryRisk: 0.1,
      redundancy: 0,
      sensitivity: 0.1
    },
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

describe('memory router', () => {
  it('routes project workflow rules to procedural pending review with explicit reasons', () => {
    const route = routeCandidateDraft({ draft: draft(), admission: admission() })

    expect(route).toEqual({
      module: 'procedural',
      updatePolicy: 'pending_review',
      risk: 'low',
      reasons: [
        'candidate kind workflow_rule maps to procedural module',
        'project/procedural memory requires review before activation'
      ]
    })
  })

  it('forces high-risk domains to manual_only', () => {
    const route = routeCandidateDraft({
      draft: draft({ domain: 'relationship', candidateKind: 'user_instruction' }),
      admission: admission({ reasons: ['explicit_user_instruction'], scores: { ...admission().scores, sensitivity: 0.8 } })
    })

    expect(route.updatePolicy).toBe('manual_only')
    expect(route.risk).toBe('high')
    expect(route.reasons).toContain('high sensitivity or protected domain requires manual review')
  })

  it('builds structured semantic candidate preview with sourceOfTruth, boundaries, and evidence', () => {
    const route = routeCandidateDraft({ draft: draft(), admission: admission() })
    const semantic = semanticCandidateFromDraft({
      draft: draft(),
      admission: admission(),
      route,
      now: '2026-06-01T00:00:00.000Z'
    })

    expect(semantic).toMatchObject({
      id: 'semantic-draft-1',
      status: 'candidate',
      module: 'procedural',
      kind: 'workflow_rule',
      sourceOfTruth: 'AGENTS.md',
      reviewPolicy: 'pending_review',
      routing: route,
      useWhen: ['Future task matches workflow-agents-surgical-edits'],
      doNotUseWhen: ['The source of truth no longer says AGENTS.md']
    })
    expect(semantic.evidence).toEqual([
      {
        id: 'evidence-draft-1-0',
        sourceKind: 'review_summary',
        sourceRef: 'AGENTS.md',
        whatHappened: 'For non-trivial code or architecture changes, edits must stay surgical. Source of truth: AGENTS.md.',
        whyImportant: 'Candidate was admitted as workflow_rule with reasons: valuable_workflow_rule'
      }
    ])
  })

  it('creates review decisions from routed policy without inventing active approval', () => {
    const route = routeCandidateDraft({ draft: draft(), admission: admission() })

    expect(reviewDecisionForRoute({
      semanticMemoryId: 'semantic-draft-1',
      route,
      reviewHash: 'hash-1',
      now: '2026-06-01T00:00:00.000Z'
    })).toEqual({
      id: 'review-semantic-draft-1',
      semanticMemoryId: 'semantic-draft-1',
      policy: 'pending_review',
      reviewHash: 'hash-1',
      reasons: route.reasons,
      createdAt: '2026-06-01T00:00:00.000Z'
    })
  })
})
```

- [ ] **Step 2: Verify test fails**

Run:

```bash
npm test -- tests/codex-memory-router.test.ts
```

Expected: FAIL because `src/codex/memory-router.ts` does not exist.

- [ ] **Step 3: Extend shared types**

In `src/memory/types.ts`, extend the existing interfaces and reason list:

```ts
export interface CandidateTaskState {
  kind: 'temporary_status' | 'one_time_action' | 'implementation_progress'
  summary: string
}
```

Add these optional fields to `CandidateDraft`:

```ts
sourceOfTruth?: string
taskState?: CandidateTaskState
```

Add this optional field to `DistillationInput`:

```ts
sourceOfTruth?: string
```

Add these strings to `ADMISSION_REASONS`:

```ts
'source_of_truth_duplicate',
'task_state',
```

- [ ] **Step 4: Extend candidate input and draft conversion**

In `src/codex/memory-propose.ts`, add this optional field to `CodexMemoryCandidateInput`:

```ts
sourceOfTruth?: string
```

In `src/codex/candidate-drafts.ts`, include:

```ts
const sourceOfTruth = input.candidate.sourceOfTruth ?? sourceOfTruthFromEvidence(input.candidate.evidence)
```

and return it only when defined:

```ts
...(sourceOfTruth === undefined ? {} : { sourceOfTruth }),
```

Add helper:

```ts
function sourceOfTruthFromEvidence(evidence: MemoryEvidence[]): string | undefined {
  return evidence
    .map((entry) => entry.evidenceGroupId ?? entry.runId ?? entry.sessionId ?? entry.taskHash ?? entry.summary ?? entry.quote)
    .find((value): value is string => typeof value === 'string' && value.trim() !== '')
}
```

- [ ] **Step 5: Implement router**

Create `src/codex/memory-router.ts` with exported functions:

```ts
import type {
  AdmissionDecision,
  CandidateDraft,
  MemoryModule,
  ReviewDecision,
  RoutedMemoryTarget,
  SemanticMemory,
  StructuredEvidence
} from '../memory/types.js'

export function routeCandidateDraft(input: {
  draft: CandidateDraft
  admission: AdmissionDecision
}): RoutedMemoryTarget {
  const module = moduleForDraft(input.draft)
  const risk = riskForDraft(input.draft, input.admission)
  const updatePolicy = updatePolicyForRoute(input.draft, risk)
  return {
    module,
    updatePolicy,
    risk,
    reasons: routingReasons(input.draft, module, risk)
  }
}

export function semanticCandidateFromDraft(input: {
  draft: CandidateDraft
  admission: AdmissionDecision
  route: RoutedMemoryTarget
  now: string
}): SemanticMemory {
  const normalizedKey = input.draft.normalizedKey ?? input.draft.id
  return {
    id: `semantic-${input.draft.id}`,
    status: 'candidate',
    module: input.route.module,
    kind: input.draft.candidateKind,
    scope: input.draft.scope,
    domain: input.draft.domain,
    content: input.draft.content,
    useWhen: [`Future task matches ${normalizedKey}`],
    doNotUseWhen: [
      input.draft.sourceOfTruth === undefined
        ? 'The evidence no longer supports this memory'
        : `The source of truth no longer says ${input.draft.sourceOfTruth}`
    ],
    ...(input.draft.sourceOfTruth === undefined ? {} : { sourceOfTruth: input.draft.sourceOfTruth }),
    evidence: structuredEvidenceForDraft(input.draft, input.admission),
    routing: input.route,
    reviewPolicy: input.route.updatePolicy,
    reviewState: {
      normalizedKey: input.draft.normalizedKey,
      admittedBy: 'admission_gate_v1',
      admissionScore: input.admission.admissionScore,
      admissionReasons: input.admission.reasons,
      sourceEpisodeIds: input.draft.sourceEpisodeIds,
      sourceDraftIds: [input.draft.id]
    },
    supersedes: [],
    createdAt: input.now,
    updatedAt: input.now
  }
}

export function reviewDecisionForRoute(input: {
  semanticMemoryId: string
  route: RoutedMemoryTarget
  reviewHash?: string
  now: string
}): ReviewDecision {
  return {
    id: `review-${input.semanticMemoryId}`,
    semanticMemoryId: input.semanticMemoryId,
    policy: input.route.updatePolicy,
    ...(input.reviewHash === undefined ? {} : { reviewHash: input.reviewHash }),
    reasons: input.route.reasons,
    createdAt: input.now
  }
}

function moduleForDraft(draft: CandidateDraft): MemoryModule {
  if (draft.domain === 'system') return 'system'
  if (draft.domain === 'personal') return 'preference'
  if (draft.domain === 'relationship' || draft.domain === 'affective') return 'relationship_affective'
  if (draft.candidateKind === 'workflow_rule' || draft.domain === 'procedural') return 'procedural'
  if (draft.candidateKind === 'user_instruction') return 'preference'
  return 'project_semantic'
}

function riskForDraft(draft: CandidateDraft, admission: AdmissionDecision): RoutedMemoryTarget['risk'] {
  if (draft.domain === 'personal' || draft.domain === 'relationship' || draft.domain === 'affective') return 'high'
  if (admission.scores.sensitivity > 0.6) return 'high'
  if (admission.scores.sensitivity > 0.35 || admission.scores.evidenceStrength < 0.55) return 'medium'
  return 'low'
}

function updatePolicyForRoute(draft: CandidateDraft, risk: RoutedMemoryTarget['risk']): RoutedMemoryTarget['updatePolicy'] {
  if (risk === 'high') return 'manual_only'
  if (draft.domain === 'system') return 'manual_only'
  if (draft.scope === 'session') return 'defer'
  return 'pending_review'
}

function routingReasons(draft: CandidateDraft, module: MemoryModule, risk: RoutedMemoryTarget['risk']): string[] {
  const reasons = [`candidate kind ${draft.candidateKind} maps to ${module} module`]
  if (risk === 'high') {
    reasons.push('high sensitivity or protected domain requires manual review')
  } else {
    reasons.push('project/procedural memory requires review before activation')
  }
  return reasons
}

function structuredEvidenceForDraft(draft: CandidateDraft, admission: AdmissionDecision): StructuredEvidence[] {
  const refs = draft.evidenceRefs.length > 0 ? draft.evidenceRefs : [draft.sourceOfTruth ?? draft.id]
  return refs.map((sourceRef, index) => ({
    id: `evidence-${draft.id}-${index}`,
    sourceKind: draft.sourceKind,
    sourceRef,
    whatHappened: draft.content,
    whyImportant: `Candidate was admitted as ${draft.candidateKind} with reasons: ${admission.reasons.join(', ')}`
  }))
}
```

- [ ] **Step 6: Verify router contract**

Run:

```bash
npm test -- tests/codex-memory-router.test.ts
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 7: Commit task**

Run:

```bash
git add src/memory/types.ts src/codex/memory-propose.ts src/codex/candidate-drafts.ts src/codex/memory-router.ts tests/codex-memory-router.test.ts
git commit -m "feat: add memory router contract"
```

## Task 2: Admission Gate And Pipeline Sidecar Routing

**Files:**
- Modify: `src/codex/admission-gate.ts`
- Modify: `src/codex/admission-pipeline.ts`
- Modify: `tests/codex-admission-gate.test.ts`
- Modify: `tests/codex-admission-pipeline.test.ts`

- [ ] **Step 1: Add admission gate tests**

Append tests to `tests/codex-admission-gate.test.ts`:

```ts
it('marks active source-of-truth duplicates explicitly', () => {
  const decision = evaluateCandidateAdmission({
    draft: draft({
      content: 'For non-trivial code changes, keep edits surgical. Source of truth: AGENTS.md.',
      candidateKind: 'workflow_rule',
      normalizedKey: 'workflow-agents-md-surgical-edits',
      sourceOfTruth: 'AGENTS.md'
    }),
    pending: [],
    active: [active('workflow-agents-md-surgical-edits')],
    tombstones: [],
    now: '2026-06-01T00:00:00.000Z'
  })

  expect(decision.action).toBe('reject_duplicate')
  expect(decision.reasons).toEqual(['duplicate_active', 'source_of_truth_duplicate'])
  expect(decision.targetMemoryId).toBe('active-1')
})

it('routes task-state progress into episode_only instead of pending', () => {
  const decision = evaluateCandidateAdmission({
    draft: draft({
      content: '本轮已经完成 v1.3 spec 更新并准备开始实现。',
      candidateKind: 'project_fact',
      taskState: { kind: 'implementation_progress', summary: 'prepared implementation' },
      normalizedKey: 'v1-3-prepared-implementation'
    }),
    pending: [],
    active: [],
    tombstones: [],
    now: '2026-06-01T00:00:00.000Z'
  })

  expect(decision.action).toBe('episode_only')
  expect(decision.reasons).toContain('task_state')
  expect(decision.reasons).toContain('temporary_status')
})
```

- [ ] **Step 2: Add pipeline sidecar tests**

Append a test to `tests/codex-admission-pipeline.test.ts`:

```ts
it('writes routing and review decisions for admitted pending candidates', async () => {
  const home = await createTempDir('cyrene-admission-pipeline-route-home-')
  vi.stubEnv('HOME', home)
  const cwd = await createTempDir('cyrene-admission-pipeline-route-project-')

  const result = await runCodexAdmissionPipeline({
    cwd,
    sourceKind: 'review_summary',
    sourceEpisodeIds: ['episode-1'],
    allowAutoPromote: false,
    candidate: {
      domain: 'procedural',
      type: 'procedural_rule',
      candidateKind: 'workflow_rule',
      content: 'For non-trivial code changes, edits must stay surgical. Source of truth: AGENTS.md.',
      normalizedKey: 'workflow-agents-md-surgical-edits',
      sourceOfTruth: 'AGENTS.md',
      evidence: [{ summary: 'AGENTS.md', sourceKind: 'file' }],
      source: 'file',
      scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 }
    },
    now: '2026-06-01T00:00:00.000Z'
  })

  expect(result.action).toBe('pending')
  await expect(readFile(join(result.memoryRoot, 'routing_decisions.jsonl'), 'utf8')).resolves.toContain('"module":"procedural"')
  await expect(readFile(join(result.memoryRoot, 'review_decisions.jsonl'), 'utf8')).resolves.toContain('"policy":"pending_review"')
})
```

Update the existing imports in that file:

```ts
import {
  readDistillationInputsFromRoot,
  readReviewDecisionsFromRoot,
  readRoutingDecisionsFromRoot
} from '../src/memory/memory-store.js'
```

Use the read helpers in assertions when possible:

```ts
await expect(readRoutingDecisionsFromRoot(result.memoryRoot)).resolves.toHaveLength(1)
await expect(readReviewDecisionsFromRoot(result.memoryRoot)).resolves.toHaveLength(1)
```

- [ ] **Step 3: Verify tests fail**

Run:

```bash
npm test -- tests/codex-admission-gate.test.ts tests/codex-admission-pipeline.test.ts
```

Expected: FAIL because new reasons and sidecar writes are missing.

- [ ] **Step 4: Implement source-of-truth duplicate and task-state reasons**

In `src/codex/admission-gate.ts`:

```ts
const duplicateActive = findByNormalizedKey(input.active, input.draft.normalizedKey)
if (duplicateActive !== undefined) {
  const reasons: AdmissionReason[] = ['duplicate_active']
  if (input.draft.sourceOfTruth !== undefined) {
    reasons.push('source_of_truth_duplicate')
  }
  return decision(input.draft, 'reject_duplicate', reasons, scoresFor(input.draft, { redundancy: 1 }), now, {
    targetMemoryId: duplicateActive.id
  })
}
```

In `reasonsForDraft`, add:

```ts
if (draft.taskState !== undefined) {
  reasons.push('task_state')
}
```

In `actionFor`, before valuable durable memory handling:

```ts
if (reasons.includes('task_state')) return 'episode_only'
```

- [ ] **Step 5: Implement pipeline routing sidecars**

In `src/codex/admission-pipeline.ts`, import:

```ts
import {
  reviewDecisionForRoute,
  routeCandidateDraft,
  semanticCandidateFromDraft
} from './memory-router.js'
```

and store helpers:

```ts
appendReviewDecisionFromRoot,
appendRoutingDecisionFromRoot,
```

After writing `admission` and before action branching:

```ts
const route = routeCandidateDraft({ draft, admission })
const semanticCandidate = semanticCandidateFromDraft({
  draft,
  admission,
  route,
  now: admission.createdAt
})
await appendRoutingDecisionFromRoot(memoryRoot, {
  id: `routing-${admission.id}`,
  semanticMemoryId: semanticCandidate.id,
  target: route,
  createdAt: admission.createdAt
})
await appendReviewDecisionFromRoot(memoryRoot, reviewDecisionForRoute({
  semanticMemoryId: semanticCandidate.id,
  route,
  now: admission.createdAt
}))
```

In `distillationInputFromAdmission`, carry source of truth:

```ts
...(draft.sourceOfTruth === undefined ? {} : { sourceOfTruth: draft.sourceOfTruth }),
```

- [ ] **Step 6: Verify admission path**

Run:

```bash
npm test -- tests/codex-admission-gate.test.ts tests/codex-admission-pipeline.test.ts tests/semantic-memory-v2-store.test.ts
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 7: Commit task**

Run:

```bash
git add src/codex/admission-gate.ts src/codex/admission-pipeline.ts tests/codex-admission-gate.test.ts tests/codex-admission-pipeline.test.ts
git commit -m "feat: route admitted memory sidecars"
```

## Task 3: Distillation Reads v2 Inputs

**Files:**
- Modify: `src/codex/memory-distill.ts`
- Modify: `tests/codex-memory-distill.test.ts`

- [ ] **Step 1: Add v2 distillation dry-run test**

Append to `tests/codex-memory-distill.test.ts`:

```ts
it('includes v2 distillation inputs as structured semantic preview candidates', async () => {
  const memoryRoot = await createTempDir('cyrene-distill-v2-inputs-')
  await mkdir(memoryRoot, { recursive: true })
  await writeJsonLines(join(memoryRoot, 'pending.jsonl'), [])
  await writeJsonLines(join(memoryRoot, 'index.jsonl'), [])
  await writeJsonLines(join(memoryRoot, 'distillation_inputs.jsonl'), [{
    id: 'distillation-input-1',
    sourceDraftIds: ['draft-1'],
    sourceEpisodeIds: ['episode-1'],
    sourceSemanticMemoryIds: [],
    admissionDecisionIds: ['admission-1'],
    normalizedKey: 'workflow-agents-md-surgical-edits',
    sourceOfTruth: 'AGENTS.md',
    candidateKind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    sourceKinds: ['review_summary'],
    rawContents: ['For non-trivial code changes, edits must stay surgical. Source of truth: AGENTS.md.'],
    evidenceRefs: ['AGENTS.md'],
    createdAt: '2026-06-01T00:00:00.000Z'
  }])

  const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

  expect(result.summary.distillationInputsRead).toBe(1)
  expect(result.candidates).toEqual([
    expect.objectContaining({
      id: 'distill-workflow-agents-md-surgical-edits',
      normalizedKey: 'workflow-agents-md-surgical-edits',
      sourceIds: ['draft-1'],
      recommendedAction: 'needs_review',
      risk: 'low',
      sourceOfTruth: 'AGENTS.md',
      semanticMemory: expect.objectContaining({
        module: 'procedural',
        reviewPolicy: 'pending_review',
        sourceOfTruth: 'AGENTS.md',
        evidence: [expect.objectContaining({ sourceRef: 'AGENTS.md' })]
      })
    })
  ])
})
```

- [ ] **Step 2: Verify test fails**

Run:

```bash
npm test -- tests/codex-memory-distill.test.ts
```

Expected: FAIL because `summary.distillationInputsRead`, `sourceOfTruth`, and `semanticMemory` are missing.

- [ ] **Step 3: Implement v2 input consumption**

In `src/codex/memory-distill.ts`:

- Import `readDistillationInputsFromRoot`.
- Extend `DistilledMemoryCandidate` with:

```ts
sourceOfTruth?: string
semanticMemory?: SemanticMemory
```

- Extend summary with:

```ts
distillationInputsRead: number
```

- Read inputs alongside pending/active:

```ts
const [pending, active, distillationInputs] = await Promise.all([
  readPendingMemoriesFromRoot(memoryRoot),
  readActiveMemoriesFromRoot(memoryRoot),
  readDistillationInputsFromRoot(memoryRoot)
])
```

- Convert v2 inputs with a helper that creates a `CandidateDraft`-shaped object and uses `routeCandidateDraft` / `semanticCandidateFromDraft`.

Use deterministic IDs:

```ts
id: `distill-${normalizedKey}`
semantic id: `semantic-distillation-${input.id}`
```

Risk rules:

- active overlap => `high`
- high-risk domain => `high`
- mixed metadata => `medium`
- v2 singleton distillation input => `low` and `recommendedAction: 'needs_review'`

- [ ] **Step 4: Verify distillation**

Run:

```bash
npm test -- tests/codex-memory-distill.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit task**

Run:

```bash
git add src/codex/memory-distill.ts tests/codex-memory-distill.test.ts
git commit -m "feat: include v2 distillation inputs"
```

## Task 4: Structured Pending Review And Approval Gate

**Files:**
- Modify: `src/codex/memory-review.ts`
- Modify: `tests/codex-memory-review.test.ts`

- [ ] **Step 1: Add review summary tests**

Add tests to `tests/codex-memory-review.test.ts` using existing `pendingMemory` fixture style:

```ts
it('summarizes pending memory with structured module update policy source of truth and evidence', () => {
  const summary = summarizePendingMemory(pendingMemory({
    id: 'pending-structured',
    domain: 'procedural',
    type: 'procedural_rule',
    candidateKind: 'workflow_rule',
    content: 'For non-trivial code changes, edits must stay surgical. Source of truth: AGENTS.md.',
    normalizedKey: 'workflow-agents-md-surgical-edits',
    evidence: [{ summary: 'AGENTS.md', sourceKind: 'file' }],
    source: 'file',
    tags: ['workflow']
  }), '2026-06-01T00:00:00.000Z')

  expect(summary.semanticMemory).toMatchObject({
    module: 'procedural',
    reviewPolicy: 'pending_review',
    sourceOfTruth: 'workflow-agents-md-surgical-edits',
    routing: expect.objectContaining({
      module: 'procedural',
      updatePolicy: 'pending_review'
    }),
    evidence: [expect.objectContaining({
      sourceRef: 'workflow-agents-md-surgical-edits'
    })]
  })
  expect(summary.readiness.reasons.map((reason) => reason.code)).not.toContain('none')
})
```

Add a gate test:

```ts
it('defers promotion when structured active-memory fields are missing', async () => {
  const candidate = pendingMemory({
    id: 'pending-missing-structure',
    domain: 'project',
    type: 'project_fact',
    candidateKind: 'project_fact',
    content: 'A short fact without source of truth.',
    normalizedKey: 'short-fact',
    evidence: []
  })
  const summary = summarizePendingMemory(candidate, '2026-06-01T00:00:00.000Z')

  expect(summary.recommendation).toBe('defer')
  expect(summary.readiness.reasons.map((reason) => reason.code)).toContain('missing_structured_evidence')
})
```

- [ ] **Step 2: Verify tests fail**

Run:

```bash
npm test -- tests/codex-memory-review.test.ts
```

Expected: FAIL for missing structured gate reason or field derivation.

- [ ] **Step 3: Add structured gate derivation**

In `src/codex/memory-review.ts`:

- Reuse `pendingMemoryToSemanticMemory(candidate)` for the canonical semantic projection.
- Extend `deriveReadinessReasons` so ready items always have positive reasons and missing structured fields produce blocking reasons:

```ts
if (candidate.evidence.length === 0) {
  return [readinessReason('missing_structured_evidence', 'Structured evidence is required before active-memory approval.')]
}
if (candidate.normalizedKey.trim() === '') {
  return [readinessReason('missing_source_of_truth', 'sourceOfTruth/normalizedKey is required before active-memory approval.')]
}
```

- Keep high-risk or ambiguous memory on explicit review path by preserving `deriveRecommendation` behavior.
- Do not call `promoteCodexPendingMemory` automatically from summary code.

- [ ] **Step 4: Verify review behavior**

Run:

```bash
npm test -- tests/codex-memory-review.test.ts tests/codex-memory-promotion-policy.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit task**

Run:

```bash
git add src/codex/memory-review.ts tests/codex-memory-review.test.ts
git commit -m "feat: enforce structured pending review"
```

## Task 5: Web UI Structured Field Visibility

**Files:**
- Modify: `src/ui/static/app.js`
- Modify: `tests/codex-ui-static.test.ts`
- Modify: `tests/codex-ui-api.test.ts`
- Generated by build: `src/codex/codex-ui-static.generated.ts`

- [ ] **Step 1: Add UI static rendering tests**

In `tests/codex-ui-static.test.ts`, add or extend the existing static render test to assert the exported app source contains these labels:

```ts
expect(appSource).toContain('Update policy')
expect(appSource).toContain('Source of truth')
expect(appSource).toContain('Evidence ref')
expect(appSource).toContain('Routing reasons')
```

- [ ] **Step 2: Add API preservation test**

In `tests/codex-ui-api.test.ts`, add a dashboard/pending fixture assertion that a pending summary includes:

```ts
expect(candidate.semanticMemory).toMatchObject({
  module: expect.any(String),
  reviewPolicy: expect.any(String),
  sourceOfTruth: expect.any(String),
  evidence: expect.any(Array)
})
```

- [ ] **Step 3: Verify tests fail**

Run:

```bash
npm test -- tests/codex-ui-static.test.ts tests/codex-ui-api.test.ts
```

Expected: FAIL because labels or API assertions are not all present.

- [ ] **Step 4: Update review card rendering**

In `src/ui/static/app.js`, update `renderSemanticReviewCard` policy and evidence sections:

```js
const updatePolicy = memory.routing?.updatePolicy || memory.reviewPolicy || 'pending_review'
const routingReasons = Array.isArray(memory.routing?.reasons) ? memory.routing.reasons : []
const sourceOfTruth = memory.sourceOfTruth || candidate.normalizedKey || 'unknown'
```

Render:

```js
${reviewSection('Policy', [
  ['Update policy', updatePolicy],
  ['Review policy', reviewPolicy],
  ['Readiness', `${readinessStatus} · ${targetShape}`],
  ['Recommendation', candidate.recommendation || 'review'],
  ['Routing reasons', formatValueList(routingReasons)],
  ['Review hash', shortHash(candidate.reviewHash || '')]
])}
${reviewSection('Evidence', [
  ['Source of truth', sourceOfTruth],
  ['Evidence ref', evidencePreview.sourceRef || candidate.normalizedKey || 'unknown'],
  ['When', evidencePreview.when || candidate.episodeEvidence?.when || 'unknown'],
  ['What happened', evidencePreview.whatHappened || candidate.episodeEvidence?.whatHappened || 'No event summary available.'],
  ['Source', evidencePreview.sourceKind || evidencePreview.source || candidate.source || 'unknown']
])}
```

In `semanticMemoryForCandidate`, preserve `sourceOfTruth`:

```js
sourceOfTruth: proposed.sourceOfTruth || candidate.normalizedKey,
```

- [ ] **Step 5: Rebuild generated UI and verify**

Run:

```bash
npm test -- tests/codex-ui-static.test.ts tests/codex-ui-api.test.ts
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: all PASS and `src/codex/codex-ui-static.generated.ts` updates through build.

- [ ] **Step 6: Commit task**

Run:

```bash
git add src/ui/static/app.js src/codex/codex-ui-static.generated.ts tests/codex-ui-static.test.ts tests/codex-ui-api.test.ts
git commit -m "feat: show structured memory review fields"
```

## Task 6: ActivationEvent And ReflectionCandidate Minimal Hook

**Files:**
- Create: `src/codex/memory-feedback.ts`
- Modify: `src/codex/continuity-context.ts`
- Modify: `tests/codex-continuity-context.test.ts`

- [ ] **Step 1: Add feedback hook tests**

In `tests/codex-continuity-context.test.ts`, add a test in the existing temp HOME/project style:

```ts
it('records activation events for retrieved active memory without activating reflection candidates', async () => {
  const home = await createTempDir('cyrene-continuity-activation-home-')
  vi.stubEnv('HOME', home)
  const cwd = await createTempDir('cyrene-continuity-activation-project-')
  const identity = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(identity.projectId)
  await mkdir(memoryRoot, { recursive: true })
  await writeJsonLines(join(memoryRoot, 'index.jsonl'), [activeMemory({
    id: 'active-activation-1',
    content: 'Use subagents for implementation and read-only review when reasonable.',
    normalizedKey: 'use-subagents-for-implementation',
    scope: 'project',
    domain: 'procedural',
    type: 'procedural_rule'
  })])

  await getCodexContinuityContext({
    cwd,
    userMessage: '请用 subagent 执行实现计划',
    task: 'coding'
  })

  await expect(readActivationEventsFromRoot(memoryRoot)).resolves.toEqual([
    expect.objectContaining({
      memoryId: 'active-activation-1',
      projectId: identity.projectId,
      event: 'retrieved'
    })
  ])
  await expect(readReflectionCandidatesFromRoot(memoryRoot)).resolves.toEqual([])
})
```

Update imports:

```ts
import {
  readActivationEventsFromRoot,
  readReflectionCandidatesFromRoot
} from '../src/memory/memory-store.js'
```

- [ ] **Step 2: Verify test fails**

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts
```

Expected: FAIL because activation events are not written.

- [ ] **Step 3: Implement feedback helper**

Create `src/codex/memory-feedback.ts`:

```ts
import { createHash, randomUUID } from 'node:crypto'
import { appendActivationEventFromRoot, appendReflectionCandidateFromRoot } from '../memory/memory-store.js'
import type { ActivationEvent, ActivationEventType, ReflectionCandidate, SemanticMemory } from '../memory/types.js'

export async function appendActivationEventsFailOpen(input: {
  memoryRoot: string
  memoryIds: string[]
  projectId: string
  query: string
  event?: ActivationEventType
  evidenceRef?: string
  now?: string
}): Promise<void> {
  try {
    const now = input.now ?? new Date().toISOString()
    const queryHash = createHash('sha256').update(input.query).digest('hex').slice(0, 16)
    for (const memoryId of Array.from(new Set(input.memoryIds)).sort()) {
      await appendActivationEventFromRoot(input.memoryRoot, {
        id: randomUUID(),
        memoryId,
        projectId: input.projectId,
        queryHash,
        event: input.event ?? 'retrieved',
        ...(input.evidenceRef === undefined ? {} : { evidenceRef: input.evidenceRef }),
        createdAt: now
      })
    }
  } catch {
    // Feedback telemetry must never block continuity context construction.
  }
}

export async function appendReflectionCandidateFailOpen(input: {
  memoryRoot: string
  sourceActivationEventIds: string[]
  proposedAction: ReflectionCandidate['proposedAction']
  candidate: SemanticMemory
  reasons: string[]
  now?: string
}): Promise<void> {
  try {
    await appendReflectionCandidateFromRoot(input.memoryRoot, {
      id: randomUUID(),
      sourceActivationEventIds: input.sourceActivationEventIds,
      proposedAction: input.proposedAction,
      candidate: input.candidate,
      reasons: input.reasons,
      createdAt: input.now ?? new Date().toISOString()
    })
  } catch {
    // Reflection candidates are review-first sidecars and must be fail-open.
  }
}
```

- [ ] **Step 4: Hook continuity retrieval**

In `src/codex/continuity-context.ts`, import:

```ts
import { appendActivationEventsFailOpen } from './memory-feedback.js'
```

After `const activeMemory = [...routedMemory.globalMemory, ...routedMemory.projectMemory]`, append:

```ts
await Promise.all([
  appendActivationEventsFailOpen({
    memoryRoot: globalMemoryRoot,
    memoryIds: routedMemory.globalMemory.map((item) => item.memory.id),
    projectId: project.projectId,
    query: input.userMessage,
    event: 'retrieved'
  }),
  appendActivationEventsFailOpen({
    memoryRoot: projectMemoryRoot,
    memoryIds: routedMemory.projectMemory.map((item) => item.memory.id),
    projectId: project.projectId,
    query: input.userMessage,
    event: 'retrieved'
  })
])
```

- [ ] **Step 5: Verify feedback hook**

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts tests/semantic-memory-v2-store.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit task**

Run:

```bash
git add src/codex/memory-feedback.ts src/codex/continuity-context.ts tests/codex-continuity-context.test.ts
git commit -m "feat: record memory activation events"
```

## Task 7: Full Verification And Plugin Runtime

**Files:**
- Generated by build: `src/codex/codex-ui-static.generated.ts`
- No manual source edits unless verification exposes a concrete failing test.

- [ ] **Step 1: Run targeted suite**

Run:

```bash
npm test -- tests/codex-memory-router.test.ts tests/codex-admission-gate.test.ts tests/codex-admission-pipeline.test.ts tests/codex-memory-distill.test.ts tests/codex-memory-review.test.ts tests/codex-ui-api.test.ts tests/codex-ui-static.test.ts tests/codex-continuity-context.test.ts tests/semantic-memory-v2-store.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Rebuild and validate plugin**

Run:

```bash
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: both PASS.

- [ ] **Step 4: Run full tests if targeted suite changed shared behavior**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Run diff checks**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` prints no output. `git status --short` only shows intentional source, test, generated runtime, and plan changes.

- [ ] **Step 6: Final commit**

If verification fixes created additional changes, commit them:

```bash
git add src tests docs/superpowers/plans/2026-06-01-cyrene-v1-3-pending-quality-and-v2-carryover.md
git commit -m "test: verify v1.3 memory quality carryover"
```

If no additional changes exist after Task 6 commit, do not create an empty commit.

## Self-Review

- Spec coverage:
  - P0 source-of-truth duplicate gate: Task 2.
  - P0 episode/task/memory split: Task 2 and Task 4.
  - P0 review card semantics: Task 4 and Task 5.
  - P1 DistillationInput consumption: Task 3.
  - P1 MemoryRouter/UpdatePolicy main path: Task 1 and Task 2.
  - P1 Active Memory Structured Approval Gate: Task 4.
  - P2-1 automation grading strategy: Task 1 router policy and Task 2 sidecar decisions.
  - P2-2 low-risk strict auto-promote receipt: Task 2 preserves `proposeCodexMemoryCandidate`; Task 7 verifies existing v5 tests.
  - P2-3 UI fields: Task 5.
  - P3 ActivationEvent/ReflectionCandidate: Task 6.
  - Multi-agent execution: Subagent Execution Protocol plus this task breakdown.
- Placeholder scan:
  - No placeholder markers.
  - Each task has exact file paths and commands.
  - Code identifiers introduced in later tasks are defined in Task 1 or Task 6.
- Type consistency:
  - `sourceOfTruth` is optional on `CandidateDraft` and `DistillationInput`, required only at review/readiness level when promoting.
  - `reviewPolicy` and `routing.updatePolicy` both use existing `UpdatePolicy`.
  - `ActivationEvent` and `ReflectionCandidate` reuse existing v2 store helpers.
