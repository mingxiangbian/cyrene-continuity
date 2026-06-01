# Cyrene v2 Semantic Memory Pipeline Design

Date: 2026-06-01
Status: Draft for written review

## 背景

当前仓库已经有 `EpisodeMemory`、`CandidateDraft`、`AdmissionDecision`、pending review
结构化展示、active-readiness gate、distillation dry-run、Web UI 和 MCP review tools。
但现有链路仍有关键断点：`admit_to_distillation` 还没有稳定进入真实 distillation
输入池，distillation 主要围绕旧 pending duplicate cluster 工作，active/pending memory
仍由不同 record shape 承载，Activation 与 Reflection 也没有形成闭环。

这份 spec 设计 v2 语义记忆流水线，目标是把 Cyrene 从“候选句子审查系统”升级成
“可审计、可路由、可反思的长期 semantic memory pipeline”。

## 决策摘要

采用 `Contract Spine + Reviewed Closed Loop`：

- 先串行定义共享 contracts，避免并行 track 各自发明不同数据结构。
- 再并行推进 `Distillation Input`、`Memory Router + Update Policy`、`Semantic Schema + Review UI`。
- 第一批包含完整 `ActivationEvent -> ReflectionCandidate -> Admission/Router` 闭环。
- Reflection 生成 reviewable candidates，不直接修改 active memory。
- 长期保留更激进自动化目标，但第一批只允许严格低风险 `project` / `procedural` / repo-local `system` memory 通过 gate auto-promote。
- v2 直接替换当前 active/pending memory schema：old active 必须迁移，old pending 可以删除或 reset。

## 目标

1. 建立从 `EpisodeMemory` 到 `SemanticMemory` 的端到端 pipeline：

   ```txt
   Raw Trace / Stop Hook / User Explicit / Harvester
     -> EpisodeMemory
     -> CandidateDraft
     -> AdmissionDecision
     -> DistillationInput
     -> SemanticMemory(status='candidate')
     -> MemoryRouter
     -> ReviewPolicy
     -> SemanticMemory(status='pending'|'active')
     -> ActivationEvent
     -> ReflectionCandidate
     -> AdmissionDecision ...
   ```

2. 让 `admit_to_distillation` 进入真实 distillation input，而不是只停留在 draft/decision audit records。
3. 用统一 `SemanticMemory` schema 覆盖 candidate、pending、active、reflection output。
4. 用 `MemoryRouter` 明确不同 memory module 的 update policy。
5. 用 `ActivationEvent` 和 `ReflectionCandidate` 建立可审计闭环。
6. 保留 v5 review-hash、eval gate、daily cap、manual review 和 `MemoryEvent` receipt 边界。
7. 迁移 old active memory；reset old pending queue。

## 非目标

- 不让 Stop Hook、Dream、Reflection 或 Activation 直接绕过 review policy 写 active memory。
- 不在第一批默认启用 preference 或 global policy auto-promote。
- 不让 `relationship_affective` 或 `principle_candidate` 自动晋升。
- 不做一个一次性巨大 PR；实现 plan 应拆成 contract spine 和并行 tracks。
- 不编辑 `REVIEW_REPORT.md`。
- 不直接编辑 generated plugin runtime；runtime 更新必须改 source 后 rebuild。

## 总体架构

v2 pipeline 把“发生了什么”和“未来应该怎么行动”分开：

- `EpisodeMemory` 保存 session evidence，不直接进入 prompt、pending 或 active。
- `CandidateDraft` 保存原始 memory hypothesis，不可 review、不可 promote。
- `AdmissionDecision` 判断去向，不负责 semantic rewrite。
- `DistillationInput` 接住 `admit_to_distillation` 和需要压缩的候选。
- `SemanticMemory` 表示未来可用的结构化长期知识。
- `MemoryRouter` 决定 memory module。
- `ReviewPolicy` 决定 pending、manual review、strict auto-promote、drop 或 defer。
- `ActivationEvent` 记录 active memory 被召回、使用、忽略或反驳。
- `ReflectionCandidate` 根据 activation feedback 生成可审查的 reinforce/rewrite/deprecate/split/merge 候选。

## Schema v2

v2 用 `SemanticMemory` 替换当前 `CyreneMemory` 和 `PendingMemory` 作为主 store record。
pending 不再是单独 schema，而是 `SemanticMemory(status='pending')`。

```ts
type MemoryModule =
  | 'project_semantic'
  | 'procedural'
  | 'system'
  | 'preference'
  | 'global_policy'
  | 'relationship_affective'
  | 'principle_candidate'

type SemanticMemoryStatus =
  | 'candidate'
  | 'pending'
  | 'active'
  | 'archived'
  | 'rejected'
  | 'superseded'

type UpdatePolicy =
  | 'strict_auto_promote'
  | 'pending_review'
  | 'manual_only'
  | 'drop'
  | 'defer'

interface StructuredEvidence {
  id: string
  sourceKind: string
  sourceRef: string
  when?: string
  whatHappened: string
  whyImportant: string
  result?: string
}

interface SemanticMemory {
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
```

Contract spine 还需要这些 records：

```ts
interface DistillationInput {
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

interface RoutedMemoryTarget {
  module: MemoryModule
  updatePolicy: UpdatePolicy
  risk: 'low' | 'medium' | 'high'
  reasons: string[]
}

interface RoutingDecision {
  id: string
  semanticMemoryId: string
  target: RoutedMemoryTarget
  createdAt: string
}

interface ReviewDecision {
  id: string
  semanticMemoryId: string
  policy: UpdatePolicy
  reviewHash?: string
  reasons: string[]
  createdAt: string
}

interface ActivationEvent {
  id: string
  memoryId: string
  projectId?: string
  queryHash?: string
  event: 'retrieved' | 'used' | 'ignored' | 'contradicted' | 'stale'
  evidenceRef?: string
  createdAt: string
}

interface ReflectionCandidate {
  id: string
  sourceActivationEventIds: string[]
  proposedAction: 'reinforce' | 'rewrite' | 'deprecate' | 'split' | 'merge'
  candidate: SemanticMemory
  reasons: string[]
  createdAt: string
}
```

## Store Layout

v2 source-of-truth files:

```txt
episodes.jsonl
candidate_drafts.jsonl
admission_decisions.jsonl
distillation_inputs.jsonl
semantic_memories.jsonl
routing_decisions.jsonl
review_decisions.jsonl
activation_events.jsonl
reflection_candidates.jsonl
events.jsonl
```

`semantic_memories.jsonl` 取代旧 `pending.jsonl` + `index.jsonl` 作为主 memory store。
SQLite / FTS / retrieval index 可以从 `semantic_memories.jsonl` 派生。

## Migration

v2 migration 是 selective migration：

```txt
old active memory:
  migrate to SemanticMemory(status='active')
  preserve id, content, scope, domain, source, evidence, timestamps, tags where possible
  synthesize useWhen/doNotUseWhen conservatively when missing
  write migration MemoryEvent receipts

old pending memory:
  drop/reset during v2 migration
  write a migration event that pending queue was reset
  do not preserve reviewHash because pending is provisional

old events/tombstones:
  keep readable for audit where cheap
  do not block v2 adoption
```

Migration must be explicit and auditable. It must not silently reinterpret old pending candidates as active memory.

## Distillation Flow

`AdmissionDecision(action='admit_to_distillation')` writes a `DistillationInput`.
Distillation reads:

```txt
CandidateDraft[]
AdmissionDecision(action='admit_to_distillation')[]
EpisodeMemory[]
SemanticMemory(status='pending'|'active')[]
```

Distillation outputs `SemanticMemory(status='candidate')` plus a report.

Distillation responsibilities:

1. Cluster related drafts, pending semantic memories, and episode evidence.
2. Convert implementation notes, transient summaries, and raw review text into reusable semantic memory.
3. Populate `useWhen`, `doNotUseWhen`, `sourceOfTruth`, `evidence`, and `supersedes`.
4. Mark active overlap, high-risk domains, source-of-truth conflicts, and manual-review requirements.

## Router And Review Policy

`MemoryRouter` receives `SemanticMemory(status='candidate')` and writes `RoutingDecision`.

Module policies:

```txt
project_semantic:
  low risk + strong evidence + no conflict -> may strict auto-promote
  otherwise pending review

procedural:
  low risk + user_explicit/file/tool evidence + eval gate -> may strict auto-promote
  otherwise pending review

system:
  repo-local system behavior, low risk -> may strict auto-promote
  global system behavior -> manual review

preference:
  first-wave default manual review
  long-term contract may allow multi-evidence low-risk auto-promote behind policy

global_policy:
  first-wave manual review
  long-term contract may allow low-risk auto-promote behind explicit feature flag

relationship_affective:
  always manual review
  never auto-promote in first wave

principle_candidate:
  always manual review
  slow update path
```

`ReviewPolicy` decisions:

```txt
strict_auto_promote:
  candidate -> active
  requires allowed module, low risk, eval gate, daily cap, no conflicts, MemoryEvent receipt

pending_review:
  candidate -> pending
  requires reviewHash, visible evidence, rewrite/edit support

manual_only:
  candidate -> pending/manual review, no auto path

drop/defer:
  candidate -> rejected/archived/deferred status + event
```

First-wave automation is intentionally conservative. The v2 contracts allow future preference/global policy automation, but default implementation keeps those modules manual.

## Review UI And MCP Tools

Review surfaces should treat pending as `SemanticMemory(status='pending')` and show four sections:

```txt
1. Proposed Semantic Memory
2. Structured Evidence
3. Routing + Review Policy
4. Review Action
```

Review tools must continue to require review-hash validation for approve/reject/edit/defer.
Editing a pending semantic memory keeps it pending and creates a fresh review hash.

## Activation And Reflection

Retrieval/context code writes `ActivationEvent`:

```txt
retrieved:
  memory was selected for context

used:
  response relied on the memory

ignored:
  memory was retrieved but not used

contradicted:
  user, file, test, or tool evidence showed the memory may be stale or wrong

stale:
  memory exceeded reviewAfter or has long-term low use
```

Reflection reads `ActivationEvent`, active `SemanticMemory`, and recent episodes, then writes
`ReflectionCandidate` records:

```txt
reinforce
rewrite
deprecate
split
merge
```

Reflection candidates re-enter normal pipeline:

```txt
ReflectionCandidate
  -> CandidateDraft / SemanticMemory(status='candidate')
  -> Admission
  -> Distillation if needed
  -> Router
  -> ReviewPolicy
```

Reflection must not directly mutate active memory. Any preference, global policy,
relationship/affective, or principle reflection remains manual review in the first wave.

## Rollout

Use `Contract Spine + Parallel Tracks`:

```txt
PR0: Contract spine
  define v2 types, store helpers, migration plan, compatibility boundaries

PR1: Selective migration
  old active -> SemanticMemory(active)
  old pending -> reset/drop with event

PR2: Distillation input
  write DistillationInput for admit_to_distillation
  read drafts/decisions/episodes/semantic_memories

PR3: Router + ReviewPolicy
  deterministic module routing
  strict low-risk auto-promote gates
  manual-only modules

PR4: Semantic review surfaces
  Web UI and MCP review tools use SemanticMemory(status='pending')
  four-section pending detail

PR5: Activation + Reflection
  write ActivationEvent
  generate ReflectionCandidate
  route candidates back through admission/router

PR6: Integration gate
  evals, typecheck, plugin build, plugin validation, migration smoke test
```

PR2, PR3, and PR4 can proceed in parallel after PR0 because they share the same contracts.
PR5 depends on the v2 active store and router policy.

## Testing

Required test coverage:

```txt
schema v2 migration:
  old active -> SemanticMemory(active)
  old pending -> dropped/reset with event
  migration never promotes old pending

admission/distillation:
  admit_to_distillation writes DistillationInput
  distillation reads drafts/decisions/episodes/semantic_memories
  output has useWhen/doNotUseWhen/sourceOfTruth/evidence

router/policy:
  module classification is deterministic
  high-risk modules never auto-promote
  low-risk project/procedural can strict auto-promote only with gates

activation/reflection:
  retrieval writes ActivationEvent
  reflection creates candidates, not active mutations

UI/API:
  pending review is SemanticMemory(status='pending')
  detail view shows semantic/evidence/routing/action sections
```

Verification commands for implementation PRs:

```bash
npm run typecheck
npm test
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

For this documentation-only spec change, `git diff --check` is sufficient.
