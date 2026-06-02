# Cyrene v1.3 Closure Design

Date: 2026-06-02
Status: Implementation-ready delta spec

## 背景

`2026-06-01-cyrene-v1-3-pending-quality-and-v2-carryover-design.md` 已经定义了 v1.3 的完整目标，最近合并的分支也完成了部分基础：

- `source_of_truth_duplicate`、`task_state` 已作为 admission reason 存在。
- `CandidateTaskState`、`DistillationInput.sourceOfTruth`、`SemanticMemory`、`RoutedMemoryTarget` 已存在。
- `memory-router.ts` 已接入 `admission-pipeline.ts`，并写 `routing_decisions.jsonl` / `review_decisions.jsonl`。
- `memory-distill --dry-run` 已读取 `distillation_inputs.jsonl` 并输出 structured semantic preview。
- pending review UI 已显示 `module`、`updatePolicy`、`sourceOfTruth`、`evidence` 的综合卡片。
- active promotion 已用 semantic review hash，并在 promotion 前检查 structured evidence/source boundary 的基础条件。

这次 closure 不重做上述内容，只补主流程没有闭合的断点。

## 成功标准

v1.3 closure 完成后，系统必须满足：

1. `source-of-truth duplicate` 有明确运行时 action，不再只是一条 readiness reason。
2. `task_state` 有明确 admission action 和 module，不再被近似成 `episode_only`。
3. `MemoryRouter.updatePolicy` 参与 admission 后的写入策略，至少能控制 `strict_auto_promote` 是否允许进入 v5 auto-promote gate。
4. `memory distill --dry-run` 汇报 draft/admission/episode/semantic/event/read counts，并能从 orphan draft/admission 形成 preview，不只依赖 `distillation_inputs`。
5. pending detail rail 采用真实 review workflow sections，而不是一个综合卡片。
6. active approval/source boundary 不只依赖 adapter 合成字段；candidate 的 explicit `sourceOfTruth` 要进入 pending/active projection。
7. 所有新自动 decision 都有 audit reason；manual-only module 不走 strict auto-promote。

## 非目标

- 不实现 distill apply；`dryRun === false` 仍报 unsupported。
- 不实现完整 task queue UI；v1.3 只把 `task_state` 从 pending active review 主路径剥离，并记录 routing/review sidecar。
- 不让 preference、global_policy、relationship_affective、principle_candidate 自动 active。
- 不修改 `REVIEW_REPORT.md`。
- 不直接编辑 generated runtime；如 UI 或 skill source 变化，最后用 `npm run build:plugin` 生成。

## 设计

### 1. Admission Actions

新增或收紧 action vocabulary：

```ts
type AdmissionAction =
  | 'admit_to_pending'
  | 'admit_to_distillation'
  | 'episode_only'
  | 'task_state'
  | 'reference_only'
  | 'auto_drop'
  | 'auto_defer'
  | 'merge_with_existing'
  | 'reject_duplicate'
```

行为：

- `task_state`：短期任务状态、implementation progress、当前 TODO。写 draft/admission/routing/review sidecar，不写 pending。
- `reference_only`：source-of-truth raw excerpt 或重复规则摘录。写 draft/admission/routing/review sidecar，不写 pending，不写 active。
- `admit_to_distillation`：有价值但需要重写/压缩。写 `distillation_inputs.jsonl`，不写 pending。
- `admit_to_pending` / `merge_with_existing`：只有 memory-shaped candidate 才进入 pending/propose path。

### 2. Source Boundary

`sourceOfTruth` 要从 candidate input 进入：

- `CandidateDraft.sourceOfTruth`
- `PendingMemory.sourceOfTruth`
- `CyreneMemory.sourceOfTruth`
- `SemanticMemory.sourceOfTruth`
- UI review card / active detail / distillation preview

`normalizedKey` 仍是 duplicate key，不再伪装成 source boundary。缺 explicit `sourceOfTruth` 时 UI 可以显示 `missing`，review gate 可要求 rewrite。

### 3. Task State Module

`MemoryModule` 增加 `task_state`。router 遇到 `admission.action === 'task_state'` 或 `draft.taskState` 时：

```txt
module = task_state
updatePolicy = defer
risk = low | medium
reasons includes task state routing reason
```

`task_state` 不生成 approveable active memory card，不触发 active readiness。

### 4. Router-Driven Write Strategy

`MemoryRouter` 不只写标签，还要影响 `admission-pipeline` 的下一步：

```txt
reference_only -> sidecar only
task_state -> sidecar only
episode_only -> sidecar only
admit_to_distillation -> distillation input + sidecar
manual_only -> pending review with allowAutoPromote=false
pending_review -> pending review with allowAutoPromote=false
strict_auto_promote -> pending/propose path with allowAutoPromote controlled by caller and v5 gate
drop/defer -> sidecar only
```

`strict_auto_promote` 只是进入既有 v5 gate 的许可，不是直接 active write。最终仍必须经过 named policy、eval gate、daily cap、no-conflict check、receipt。

### 5. Distillation Breadth

`runCodexMemoryDistill({ dryRun: true })` 读取：

- `candidate_drafts.jsonl`
- `admission_decisions.jsonl`
- `distillation_inputs.jsonl`
- `episodes.jsonl`
- `semantic_memories.jsonl`
- `pending.jsonl`
- `active` projection
- `events.jsonl`
- `review_decisions.jsonl`

summary 保留旧字段，并新增：

```ts
inputsRead: {
  drafts: number
  admissions: number
  distillationInputs: number
  episodes: number
  semanticMemories: number
  legacyPending: number
  legacyActive: number
  memoryEvents: number
  reviewDecisions: number
}
```

orphan `CandidateDraft + AdmissionDecision(action='admit_to_distillation')` 可以形成 dry-run preview。已有 `DistillationInput` 仍优先，因为它是更明确的 distillation source。

### 6. Review Workflow UI

pending detail rail 改为固定 sections：

1. `Proposed Semantic Memory`
2. `Episode Evidence`
3. `Admission / Routing Decision`
4. `Update Policy`
5. `Use Boundaries`
6. `Review Action`

列表卡片可以继续 compact，但 detail rail 必须把 workflow 拆开。`reference_only`、`task_state`、`admit_to_distillation`、`manual_only`、`strict_auto_promote` 要一眼可见。

### 7. Structured Approval Gate

approve 前至少要求：

- `sourceOfTruth` explicit 或 evidence trace 明确。
- `SemanticMemory.useWhen` 非空。
- `SemanticMemory.doNotUseWhen` 非空。
- structured evidence 有 `sourceKind`、`sourceRef`、`whatHappened`。
- raw source-of-truth excerpt 必须已 semantic rewrite。

adapter 合成字段可用于 preview，但不能掩盖缺 explicit source boundary 的候选。

## Multi-Agent Execution

执行时使用 subagent-driven development：

- Coordinator 负责 shared type/router 变更、冲突整合和最终验证。
- Worker A：admission action/source boundary/router policy。
- Worker B：distillation breadth。
- Worker C：review UI sections。
- Worker D：structured approval/sourceOfTruth projection。
- Reviewer agents：每个 worker 结果先做 spec compliance review，再做 code quality review。

写入范围必须尽量 disjoint；共享文件由 coordinator 或单个 worker owner 修改，其他 worker 不碰。

## 验收命令

```bash
npm test -- tests/codex-admission-gate.test.ts tests/codex-admission-pipeline.test.ts tests/codex-memory-router.test.ts tests/codex-memory-distill.test.ts tests/codex-memory-review.test.ts tests/codex-ui-static.test.ts tests/codex-ui-api.test.ts tests/codex-memory-propose.test.ts
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
git diff --check
```
