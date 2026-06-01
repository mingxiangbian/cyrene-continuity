# Cyrene v1.3 Pending Quality And v2 Carryover Design

Date: 2026-06-01
Status: Draft for written review

## 背景

Cyrene v2 已经不是空设计。当前仓库已经具备：

- `SemanticMemory`、`MemoryModule`、`UpdatePolicy`、`DistillationInput`、
  `ActivationEvent`、`ReflectionCandidate` 等 v2 contract。
- `semantic_memories.jsonl` 及 v2 sidecar store helper。
- legacy active memory 到 `SemanticMemory(status='active')` 的 migration CLI。
- admission pipeline 写 `candidate_drafts.jsonl`、`admission_decisions.jsonl`，并在
  `admit_to_distillation` 时写 `distillation_inputs.jsonl`。
- pending review surface 已能显示一部分 semantic review card 字段。
- `Memory Quality Contract`、fixture matrix、`Memory Delta Report` template 和 handoff
  validator。

但 v2 还没有闭合。当前最明显的用户问题仍然在 pending review 质量上：

- source-of-truth rule 摘录、任务状态、设计过程、一次性动作和数字快照仍可能看起来像
  pending memory。
- `ready`、`defer`、`recommendation`、`risk` 和 `reasons` 的语义仍会混在一起。
- `memory distill --dry-run` 仍主要围绕 legacy pending/active duplicate cluster 工作，没有把
  v2 draft/admission/distillation input 真正作为主输入。
- router/update policy 已经存在于数据模型和 adapter 中，但还没有成为 admission 后的主流程。
- active memory approve 路径还没有强制结构化字段质量。
- `ActivationEvent` 和 `ReflectionCandidate` 目前主要是 store/type 基础，还没有接入 runtime
  feedback loop。

v1.3 因此不是“重新实现 v2”，也不是继续扩展采集范围。它是一次收敛版本：补齐 v2 已落地基础和
实际 pending review 体验之间的断点。

## 决策摘要

采用 `Pending Quality + v2 Carryover`：

- P0 先修 pending review 质量：source-of-truth duplicate gate、episode/task/memory 三分流、
  review card 语义拆分。
- P1 补完影响 pending quality 的 v2 carryover：distillation 读取 v2 inputs、router/update policy
  进入主流程、active structured approval gate。
- P2 明确自动化分级和 UI 完整性：自动化哪些步骤、low-risk strict auto-promote receipt 怎么审计、
  UI 必须显示哪些 semantic 字段。
- P3 只写入最小 Activation/Reflection carryover：记录 retrieval feedback 和生成 reviewable
  reflection candidate，不允许直接修改 active memory。
- 不扩大 harvester，不接 embedding，不做完整 Principle/Belief/Identity 层，不让 Dream 或
  Reflection 自动 active。

v1.3 成功标准不是“系统更聪明”，而是：

```txt
pending review 中出现的每条 item 都能说明：
它为什么不是 source-of-truth duplicate，
它是 episode、task state、distillation input 还是 memory candidate，
它应进入哪个 module 和 update policy，
它如果进入 active memory 会如何被安全使用。
```

## 目标

1. 阻止 source-of-truth raw excerpt 直接污染 pending / active memory。
2. 把 `episode_only`、`task_state`、`memory_candidate` 从 UI 和 runtime routing 上区分开。
3. 让 review card 能直接回答 approve/edit/reject/defer 所需问题。
4. 让 `admit_to_distillation` 产生的 v2 input 被 `memory distill --dry-run` 读取和汇总。
5. 让 `MemoryRouter` 和 `UpdatePolicy` 成为 admission 后的显式决策，而不是仅由 adapter 推导展示。
6. 让 active approval 只接受结构化、可解释、有使用边界的 semantic memory。
7. 为 v2 feedback loop 补最小可审计入口：`ActivationEvent` 和 `ReflectionCandidate` 只产生 reviewable
   evidence/candidate，不绕过 review policy。

## 非目标

- 不做完整 v2 重写。
- 不移除 `Memory Quality Contract` 现有实现；v1.3 应复用它。
- 不扩大 project harvester 采集范围。
- 不接 embedding 或 semantic search。
- 不实现完整 Reflection Layer、Principle、Belief、Identity。
- 不让 personal、relationship、affective、global policy、principle candidate 自动 active。
- 不让 Dream、Activation 或 Reflection 绕过 review hash 和 manual review。
- 不重写整个 Web UI；只改 pending review、distillation 和相关 detail surface。
- 不编辑 `REVIEW_REPORT.md`。
- 不直接编辑 generated plugin runtime；runtime 更新必须改 source 后 rebuild。

## 当前已完成基础

### v2 Store And Migration

已有：

- `src/memory/types.ts` 定义 v2 contracts。
- `src/memory/memory-store.ts` 读写 `semantic_memories.jsonl`、`distillation_inputs.jsonl`、
  `routing_decisions.jsonl`、`review_decisions.jsonl`、`activation_events.jsonl`、
  `reflection_candidates.jsonl`。
- `src/memory/semantic-memory-adapter.ts` 在 legacy active/pending 与 `SemanticMemory` 之间做兼容转换。
- `codex memory migrate-v2` 能迁移 legacy active，并 reset legacy pending。

仍需纳入 v1.3：

- runtime 主路径仍要清楚记录什么时候使用 semantic store，什么时候只是 legacy projection。
- approval 前不能只依赖 adapter 合成的 `useWhen` / `doNotUseWhen` / `sourceOfTruth`，需要质量 gate。

### Admission Pipeline

已有：

- `runCodexAdmissionPipeline()` 写 `CandidateDraft` 和 `AdmissionDecision`。
- `AdmissionDecision(action='admit_to_distillation')` 会写 `DistillationInput`。
- numeric snapshot 等低价值信号不会直接写 pending。

仍需纳入 v1.3：

- admission action 需要表达 `task_state`，不能只靠 `episode_only` 或 `admit_to_distillation` 近似。
- source-of-truth duplicate 需要有明确 reason/action，而不是只依赖 active duplicate 或 readiness rewrite。
- admission 后应进入 router/policy decision，产生可审计 `RoutingDecision` / `ReviewDecision`。

### Review Surface

已有：

- Web UI 已有 readable semantic review card。
- CLI/MCP review 输出包含 `proposedSemanticMemory`、`episodeEvidence`、readiness、review hash。

仍需纳入 v1.3：

- `Readiness`、`Priority`、`Recommended Action` 必须拆开。
- `Reasons: none` 不允许出现在 ready item 上；没有 blocking reason 也要显示正向 admission/routing reason。
- task state 和 episode-only 不应混在 pending review 主列表。
- source-of-truth duplicate、distillation input、manual-only module 要有清楚标签和 action。

## P0: Pending Quality

### P0-1 Source-of-Truth Duplicate Gate

问题：

```txt
AGENTS.md / README / config / docs 中已有的规则，被摘录成 pending memory。
```

v1.3 行为：

- 对候选内容做 source-of-truth scan，至少覆盖 `AGENTS.md`、`README*`、`docs/**`、plugin config
  和 project config。
- 如果候选只是复述 source-of-truth 内容，标记为：

  ```txt
  classification = source_of_truth_duplicate
  admission action = reject_duplicate 或 admit_to_distillation
  recommended action = reference_only / distill_only
  sourceOfTruth = 文件路径或 doc section
  ```

- 只有当候选包含新的 operational interpretation、例外、踩坑、适用边界或 runtime implication，才允许进入
  distillation 或 pending review。

验收：

- `AGENTS.md` 中“surgical changes”规则摘录不会成为 ready active memory。
- UI 显示 `Source of truth: AGENTS.md` 或更具体路径。
- UI 显示 `reference_only` / `reject_duplicate` / `distill_only`。
- 有新增 operational interpretation 的候选不会被 silent drop。

### P0-2 Episode / Task / Memory 三分流

问题：

pending 中混着：

```txt
发生了什么
当前还要做什么
以后应该记住什么
```

v1.3 分类：

```txt
episode_only:
  只描述发生过的事件，不改变未来行为。

task_state:
  当前任务状态、短期 TODO、局部 UI/implementation checkpoint。

distillation_input:
  raw signal 有价值，但需要压缩、合并或重写后才能成为 memory。

memory_candidate:
  已经足够结构化，可能改变未来行为。
```

行为：

- `episode_only` 只进 episode/timeline，不进 pending review 主列表。
- `task_state` 进入 task/work queue 或低优先区，不显示 active readiness。
- `distillation_input` 进入 distillation queue / dry-run report，不显示为可 approve active memory。
- `memory_candidate` 才进入 pending review 主列表。

验收：

- 短期 TODO 不再显示成 `ready active_memory`。
- review summary timeout 若没有 mitigation，则为 `episode_only`；若有 mitigation，才是 `known_pitfall`。
- “Quality Gate First should define contract/rubric/fixtures first” 可作为 project decision 或 workflow rule，
  但重复版本进入 distillation cluster。

### P0-3 Review Card 语义重做

v1.3 review card 默认显示六段，和 v2 review layout 对齐：

```txt
1. What will be remembered
   content, kind, short rationale

2. Evidence
   when, what happened, why important, result, source

3. Source Boundary
   sourceOfTruth, source-of-truth duplicate status, raw excerpt boundary

4. Routing
   classification, module, domain, scope, risk

5. Policy
   readiness, priority, recommendedAction, updatePolicy, manual/auto status, reviewHash

6. Use Boundaries
   useWhen, doNotUseWhen, reviewAfter, supersedes
```

规则：

- `Readiness` 回答“是否具备 active memory shape”。
- `Priority` 回答“现在是否值得用户处理”。
- `Recommended Action` 回答“approve / edit / reject / defer / distill / reference_only”。
- `UpdatePolicy` 回答“strict_auto_promote / pending_review / manual_only / defer / drop”。
- `Reasons: none` 必须替换为明确 reason，例如 `structured_candidate_shape`、
  `project_scoped_low_risk`、`source_duplicate_reference_only`。

验收：

- 用户看一张卡就能判断它是事件、任务、distillation input 还是真 memory candidate。
- ready item 必须显示 admission/routing reason。
- `ready` 和 `defer low` 不再放在同一个语义字段里。

## P1: v2 Carryover Required For v1.3

### P1-1 Distillation Reads v2 Inputs

当前状态：

- admission pipeline 已写 `distillation_inputs.jsonl`。
- `memory distill --dry-run` 仍主要读 pending/active 并按 `normalizedKey` 合并重复 pending。

v1.3 行为：

`memory distill --dry-run` 读取：

```txt
candidate_drafts.jsonl
admission_decisions.jsonl
distillation_inputs.jsonl
episodes.jsonl
semantic_memories.jsonl
pending.jsonl
index.jsonl
events.jsonl / review events where available
```

dry-run summary 必须显示：

```txt
inputsRead:
  drafts
  admissions
  distillationInputs
  episodes
  semanticMemories
  legacyPending
  legacyActive
```

输出：

- 仍然是 dry-run，不 apply。
- 输出 distilled `SemanticMemory(status='candidate')` preview。
- 重复 Quality Gate / Memory Quality Contract / Reviewer Rubric / Fixture Matrix 类 pending 应被压成 1-2 条
  project decision / workflow rule candidate。
- active overlap、source-of-truth duplicate、manual-only module、high-risk signal 必须出现在 reasons。

验收：

- `admit_to_distillation` 写出的 input 会被 distill dry-run 读取。
- distill report 能说明每个 distilled candidate 来自哪些 draft/admission/input/pending/active。
- distillation 不直接写 active。

### P1-2 Memory Router And ReviewPolicy Main Path

当前状态：

- `SemanticMemory` 和 adapter 有 module/policy 推导。
- 但 admission 后没有统一 router step 生成主流程 decision。

v1.3 流程：

```txt
CandidateDraft
  -> AdmissionDecision
  -> DistillationInput or SemanticMemory(candidate)
  -> MemoryRouter
  -> RoutingDecision
  -> ReviewDecision
  -> pending / manual_only / strict_auto_promote / defer / drop
```

模块策略：

```txt
episode:
  自动记录，短期保留，不进 prompt。

task_state:
  自动记录到 task/work queue，任务完成后 archive/expire。

project_semantic:
  项目事实、项目决策、known pitfall。低风险可 pending_review；strict_auto_promote 需 gate。

procedural:
  工作流规则。低风险可 pending_review；strict_auto_promote 需 gate。

system:
  插件自身规则。通常 pending_review；repo-local low-risk 可 gate。

preference:
  manual_only。

global_policy:
  manual_only。

relationship_affective:
  manual_only，只能用安全摘要和 explicit review。

principle_candidate:
  manual_only，v1.3 不主推。
```

验收：

- 每条 reviewable candidate 都有 `module`、`updatePolicy`、`risk`、`reasons`。
- global / preference / relationship / principle 不会 strict auto-promote。
- project_semantic / procedural / repo-local system 即使 low-risk，也必须经过 eval gate、daily cap、receipt。

### P1-3 Active Memory Structured Approval Gate

新 active memory 必须具备：

```txt
content
module
kind
scope
domain
useWhen
doNotUseWhen
sourceOfTruth
evidence
updatePolicy / reviewPolicy
reviewAfter or expiry decision
supersedes
```

行为：

- approve 前，如果缺 `useWhen`、`doNotUseWhen`、structured evidence 或 source boundary，要求 edit/rewrite。
- adapter 自动合成字段可以用于 preview，但不能作为 high-confidence approval 的唯一依据。
- source-of-truth raw excerpt 必须保留 source boundary，并且 active content 必须是 semantic rewrite。

验收：

- approve 缺字段 candidate 会返回 needs rewrite，不直接 active。
- UI active detail 能显示这些字段。
- migration 生成的 active memory 如果字段是 conservative synthesis，应标记来源，避免误认为用户确认。

## P2: Automation Classification And UI Completeness

### P2-1 自动化分级策略

v1.3 不做“全自动 active memory”，但要把哪些步骤可以自动、哪些必须人工 review 写清楚。

完全自动：


```txt
episode recording
candidate draft generation
admission scoring
episode-only rejection
source-of-truth duplicate rejection/defer
task-state routing
auto defer/drop for low-value non-memory
distillation dry-run
retrieval explain
```

严格自动只允许进入 low-risk project/procedural/system active path；任何不满足条件的 candidate 必须降级为
`pending_review`、`manual_only`、`defer` 或 `drop`。

必须人工 review：

```txt
global_policy
preference
relationship_affective
principle_candidate
source-of-truth interpretation changes
conflicting memory
project-to-global promotion
assistant_observed-only durable claim
raw affective / relationship observation
```

验收：

- auto-drop/auto-defer 能减少 pending review 主队列噪音。
- manual-only 类型不会进入 strict auto-promote path。
- 每个自动 decision 都有 reason，不能只显示 `none`。

### P2-2 low-risk strict auto-promote receipt

strict auto-promote 是 v1.3 中最高风险的自动化，只允许低风险、本项目范围、强证据 candidate 通过。

允许条件：

```txt
scope = project
module = project_semantic / procedural / repo-local system
source = file / tool_trace / user_explicit
risk = low
sensitivity = low
evidence >= threshold
no conflicts
not source-of-truth raw duplicate
not assistant_observed-only
has useWhen and doNotUseWhen
eval gate passed
daily cap available
MemoryEvent receipt written
```

验收：

- strict auto-promote 必须写 `MemoryEvent` receipt。
- receipt 包含 named policy、gate result、daily cap usage、source ids、candidate id、semantic memory id。
- receipt 可以从 CLI/MCP/UI diagnostic 中查到。
- manual-only module 永远不走 strict auto-promote。

### P2-3 UI 显示 module/updatePolicy/sourceOfTruth/evidence

v1.3 UI 不只显示 pending review 文案，还要显示 reviewer 判断所需的 semantic 字段。

Pending review card、active detail、distillation preview 至少显示：

```txt
module
updatePolicy / reviewPolicy
sourceOfTruth
evidence / episodeEvidence
classification
risk
recommendedAction
useWhen
doNotUseWhen
```

行为：

- pending review card 显示这些字段，用于 approve/edit/reject/defer 判断。
- active detail 显示这些字段，用于判断 active memory 的使用边界和来源。
- distillation preview 显示这些字段，用于判断 distilled candidate 是否可进入 review。
- 缺字段时显示 `missing` 和 rewrite requirement，不用空白或 `none` 掩盖。

验收：

- UI 中每条 reviewable candidate 都能看到 `module`、`updatePolicy`、`sourceOfTruth`、`evidence`。
- active memory detail 能显示同一组字段。
- distillation dry-run preview 能显示 candidate 的 module/policy/source/evidence。

## P3: v2 Feedback Loop Carryover

### P3-1 ActivationEvent Minimal Runtime Hook

v1.3 不做完整 reflection system，但应补最小 activation audit：

- continuity retrieval/context 可以在低成本路径写 `ActivationEvent`。
- event 类型限制为 `retrieved`、`used`、`ignored`、`contradicted`、`stale`。
- event 不影响 active memory 本身。
- event 只作为未来 reflection 或 review evidence。

验收：

- retrieval 产生可读 `ActivationEvent`。
- contradicted/stale 事件能关联 source/evidence ref。
- 写 event 失败不能中断用户请求；只记录 warning/diagnostic。

### P3-2 ReflectionCandidate Review-First

v1.3 的 reflection 只做候选生成：

```txt
ActivationEvent[]
  + active SemanticMemory[]
  + recent episodes
  -> ReflectionCandidate(proposedAction)
  -> admission/router/review
```

允许 proposed action：

```txt
reinforce
rewrite
deprecate
split
merge
```

禁止：

- reflection 直接 supersede active。
- reflection 自动删除 high-risk memory。
- reflection 把 affective/relationship observation 直接 active。

验收：

- contradicted active memory 生成 `ReflectionCandidate`，不直接 mutate active。
- reflection candidate 重新进入 admission/router/review policy。
- UI/CLI 能看到 reflection candidate 的 reasons 和 source activation events。

## Data Flow

### Normal Candidate

```txt
signal
  -> EpisodeMemory
  -> CandidateDraft
  -> AdmissionDecision
  -> SemanticMemory(status='candidate')
  -> RoutingDecision
  -> ReviewDecision
  -> pending review card
  -> approve/edit/reject/defer with reviewHash
```

### Source-of-Truth Duplicate

```txt
candidate text
  -> source scan
  -> source_of_truth_duplicate
  -> reference_only / reject_duplicate / distill_only
  -> no active write
```

If there is operational interpretation:

```txt
source excerpt + new interpretation
  -> DistillationInput
  -> SemanticMemory(status='candidate') preview
  -> pending_review / manual_only
```

### Task State

```txt
task/status signal
  -> task_state
  -> work queue / episode evidence
  -> no active readiness
  -> expire/archive when task completes
```

### Distillation

```txt
DistillationInput[]
  + CandidateDraft[]
  + AdmissionDecision[]
  + EpisodeMemory[]
  + SemanticMemory[]
  + legacy pending/active
  -> dry-run clusters
  -> distilled SemanticMemory(status='candidate') previews
```

## Error Handling

- Missing v2 sidecar files read as empty arrays.
- Malformed sidecar records are skipped with diagnostics; they must not corrupt pending/active reads.
- Source-of-truth scan failures degrade to `needs_review` with reason `source_scan_unavailable`, not auto active.
- Distillation dry-run failures do not mutate memory files.
- Router failures produce `manual_only` / `pending_review` fallback, never strict auto-promote.
- Review card rendering must tolerate missing optional fields but mark them as `missing` instead of silently showing `none`.
- Activation event write failures are non-fatal and visible in diagnostics.

## Testing

Required test objectives:

```txt
1. Source-of-truth duplicate gate
   - AGENTS.md raw excerpt -> reject_duplicate/reference_only/distill_only
   - raw excerpt with operational interpretation -> distillation input or pending candidate
   - UI/API exposes sourceOfTruth and duplicate status

2. Episode/task/memory routing
   - one-time action -> episode_only, no pending
   - short-term TODO -> task_state, no active readiness
   - durable workflow rule -> memory_candidate
   - numeric snapshot -> episode_only or distillation_input, no direct pending

3. Review card semantics
   - readiness, priority, recommendedAction, updatePolicy are separate
   - no ready card has empty reasons
   - source boundary and use boundaries are visible
   - module/updatePolicy/sourceOfTruth/evidence are visible in pending review cards

4. Distillation v2 input consumption
   - distill dry-run reads candidate_drafts, admission_decisions, distillation_inputs, episodes, semantic_memories
   - summary reports counts per input source
   - output previews SemanticMemory(status='candidate')
   - preview shows module/updatePolicy/sourceOfTruth/evidence
   - dry-run never writes active

5. Router/policy main path
   - each candidate gets module/updatePolicy/risk/reasons
   - high-risk/manual-only modules never auto-promote
   - strict low-risk path requires eval gate, daily cap, receipt

6. Structured approval gate
   - missing useWhen/doNotUseWhen/sourceOfTruth/evidence blocks approval
   - edit keeps candidate pending and refreshes reviewHash
   - active detail displays module/updatePolicy/sourceOfTruth/evidence and use boundaries

7. Activation/reflection carryover
   - retrieval can write ActivationEvent
   - contradicted/stale event can produce ReflectionCandidate
   - reflection never directly mutates active memory
```

Verification commands for implementation PRs:

```bash
npm run typecheck
npm test
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

For documentation-only changes:

```bash
git diff --check
```

## Implementation Tracks

Suggested plan split after this spec:

```txt
PR1: Source-of-truth duplicate gate + routing classification
PR2: Review card semantic fields and queue separation
PR3: Distillation reads v2 inputs
PR4: Router / ReviewPolicy main path
PR5: Structured active approval gate
PR6: Automation classification, strict auto-promote receipts, UI field completeness
PR7: Minimal ActivationEvent / ReflectionCandidate carryover
PR8: Integration tests, plugin build, validation
```

PR1-PR3 can proceed in parallel only after shared classification/action vocabulary is agreed.
PR4 and PR5 depend on `SemanticMemory` field quality.
PR6 must not start before manual-only policy regressions exist.
PR7 must not mutate active memory directly.

## Acceptance Summary

v1.3 is complete when:

- raw source-of-truth excerpts no longer become ready active memory.
- episode/task/distillation/memory candidate are visibly separate.
- pending review cards are understandable without reading raw JSON.
- distillation dry-run consumes v2 sidecar inputs.
- router/update policy decisions are persisted and visible.
- active memory approval requires structured semantic fields.
- low-risk automation is receipt-backed and capped.
- activation/reflection feedback exists only as reviewable audit/candidate records.
