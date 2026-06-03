# Cyrene v1.5 Memory Lifecycle And Activation Design

Date: 2026-06-03
Status: Written review draft

## 背景

v1.3 和 v1.4 已经把 Cyrene 的 memory pipeline 从松散 pending review 推进到结构化 admission、routing、semantic shaping、active-readiness 和 review hash 保护。当前仓库已经具备：

- `SemanticMemory`、`ActivationEvent`、`ReflectionCandidate` 等 v2 contract 基础。
- `activation_events.jsonl` 和最小 retrieval `retrieved` event 写入。
- admission / router / review policy / semantic prepare / quality contract / eval gate。
- active memory lifecycle 的 archive、tombstone、propose-edit、supersede 路径。
- pending review Web UI、CLI、MCP review tools 和 generated profile 基础。

新的缺口不再是“pending card 是否漂亮”，而是 memory 是否进入真实任务、是否影响行为、是否能根据使用反馈被晋升、修正、降级或淘汰。

旧路径偏向：

```txt
发现信息
  -> 生成 candidate
  -> pending review
  -> active
```

v1.5 要改成：

```txt
形成可试用记忆
  -> 在真实任务中激活为 hint / constraint / checklist
  -> 显式记录 applied / ignored / corrected / violated
  -> daily / weekly automation 晋升、整理、推荐或清理
```

本 spec 采用用户确认的方向：

- project memory 使用 `trial -> validated -> project_core`。
- global memory 只保留 `global_core`，不建立 global trial / global validated。
- runtime activation 采用双轨：`continuity_get` 输出少量可执行 activation，UI/CLI 显示完整解释和反馈。
- usage feedback 第一版只记录显式事件，不从回答文本中猜测。
- automation 每天做 trial validation，每周做 project core promotion 和 global consolidation。
- 旧 pending / active memory 不做隐式兼容。v1.5 migration 只改造有价值的旧记忆，没价值的丢弃或归档。

## 目标

1. 让 memory 在真实任务中影响 agent 行为，而不只是被 retrieval 召回。
2. 建立 project memory 的显式 lifecycle：`trial -> validated -> project_core`。
3. 让 global memory 只承载经过明确全局指令或跨项目整理得到的 `global_core`。
4. 为 activation 建立可审计 runtime 输出：`workflowHints`、`planConstraints`、`checklistItems`。
5. 扩展 usage feedback，让 `applied`、`ignored`、`corrected`、`violated` 成为 lifecycle automation 的输入。
6. 引入 daily / weekly automation，自动晋升低风险 memory，并为高风险 memory 生成 review recommendation。
7. 把最终生成 memory 的质量检测纳入 release gate，确保 trial、validated、core 和 profile 输出符合预期。
8. 清理旧 schema：有价值的旧 memory 迁移为 v1.5 shape，无价值或噪声 memory 离开 runtime path。

## 非目标

- 不继续优化 pending review card 文案作为主目标。
- 不引入 global trial 或 global validated。
- 不让 pending memory 参与 activation。
- 不从 agent final answer 或普通文本里自动猜测 `applied`。
- 不自动晋升 personal / relationship / affective / ambiguous global inference。
- 不让 high-risk memory 自动进入 core 或 profile。
- 不把 SQLite / index 变成 source of truth；它仍是派生物。
- 不编辑 `REVIEW_REPORT.md`。
- 不直接编辑 generated plugin runtime；runtime 变化必须改 source 后 rebuild。

## 设计摘要

采用 `Project Trial Loop + Global Core Consolidation`。

```txt
project memory:
  trial -> validated -> project_core

global memory:
  global_core only
```

project memory 负责试用和验证，因为只有具体项目任务能证明某条 memory 是否真正有用。global memory 只承载稳定跨项目规则，来源包括：

- low-risk explicit global instruction；
- 多个 project core 中重复出现并被应用的 workflow rule；
- review-derived procedural / system learning。

high-risk global candidate 不丢弃，但只能生成 recommendation 和 evidence package，等待人工 review。

## Lifecycle Model

### Project Memory Tiers

`trial`：

- 用于低风险 project / procedural / system memory 的试用。
- 不生成 runtime `planConstraints` 或 `checklistItems`。
- 只能生成 `workflowHints`。
- 需要 usage feedback 证明它在真实任务中被使用。

`validated`：

- 至少 2 次明确 `applied`。
- 没有 unresolved `violated` 或 `corrected`。
- 可在 trigger 命中时生成 `planConstraints` 或 `checklistItems`。
- 仍是 project-scoped，不自动变成 global memory。

`project_core`：

- 至少 2 个不同 session 或 task 中有明确 `applied`。
- 没有 unresolved `violated` 或 `corrected`。
- 可进入 generated project profile。
- 在 project activation 中优先级高于 `validated`。
- low-risk memory 可以由 weekly automation 自动晋升；high-risk memory 只生成 recommendation。

### Global Memory Tier

`global_core` 是唯一 global tier。

允许自动进入 `global_core` 的来源：

1. low-risk explicit global instruction，例如用户明确说“所有项目以后默认...”。
2. weekly consolidation 从多个 project core 中抽象出的 low-risk procedural / system rule。
3. 多次 review-derived workflow learning，且证据跨 project 或跨 session 稳定。

禁止自动进入 `global_core` 的来源：

- personal / relationship / affective；
- assistant 单方推断的长期偏好；
- ambiguous global inference；
- project-specific implementation detail；
- 缺少明确 evidence package 的候选。

这些信号必须进入 global review recommendation，而不是 global core。

## Activation Layer

v1.5 增加 `Memory Activation Layer`，位于 retrieval 之后、`continuity_get` runtime context 输出之前。

```txt
retrieved memory
  -> trigger matching
  -> activation mode decision
  -> workflowHints / planConstraints / checklistItems
  -> usage events
```

runtime 输出建议：

```ts
interface MemoryActivation {
  id: string
  memoryId: string
  confidenceTier: 'trial' | 'validated' | 'project_core' | 'global_core'
  activationMode:
    | 'workflow_hint'
    | 'plan_constraint'
    | 'checklist_item'
    | 'workflow_selection'
  text: string
  triggerReason: string
  source: 'project' | 'global'
  risk: 'low' | 'medium' | 'high'
}
```

`continuity_get` 输出新增：

```ts
activation: {
  workflowHints: MemoryActivation[]
  planConstraints: MemoryActivation[]
  checklistItems: MemoryActivation[]
}
```

tier 与 activation 行为：

```txt
trial:
  workflow_hint only

validated:
  workflow_hint
  plan_constraint
  checklist_item

project_core:
  workflow_hint
  plan_constraint
  checklist_item
  project profile

global_core:
  workflow_hint
  plan_constraint
  checklist_item
  global profile
```

边界：

- activation layer 不决定晋升，只把 memory 转成 runtime 可用的行动提示。
- trial hint 可以被 agent 忽略，但必须能记录 `ignored` 或 `applied`。
- high-risk memory 即使被 retrieval 召回，也不能自动生成硬 constraint，除非通过允许的 review/core/profile 路径。
- pending memory 不参与 activation。
- global memory 没有 trial hint；global 只有 core。

## Usage Feedback

usage feedback 第一版采用显式事件，不做文本猜测。

事件词汇：

```ts
type ActivationEventType =
  | 'retrieved'
  | 'activated'
  | 'applied'
  | 'ignored'
  | 'corrected'
  | 'violated'
  | 'stale'
```

事件语义：

```txt
retrieved:
  memory 被 retrieval 选中。

activated:
  memory 被 activation layer 转成 workflowHint / constraint / checklist。

applied:
  agent / runtime 有明确证据表明这条 activation 被执行。

ignored:
  agent / runtime 明确认为 activation 不适用，并记录 reason。

corrected:
  用户、测试、文件或工具证据表明 memory 内容需要修改。

violated:
  memory 应该约束行为，但 agent 没遵守。

stale:
  reviewAfter / expiresAt / 长期未用 / source 变更导致需要复查。
```

事件结构建议：

```ts
interface ActivationEvent {
  id: string
  memoryId: string
  activationId?: string
  projectId?: string
  queryHash?: string
  event: ActivationEventType
  reason?: string
  evidenceRef?: string
  createdAt: string
}
```

第一版只在明确节点写 `applied` / `ignored` / `corrected` / `violated`：

- runtime checklist 完成时可写 `applied`。
- agent 明确说明某条 hint 不适用时可写 `ignored`。
- 用户纠正或工具证据证明 memory 错误时写 `corrected`。
- completion claims、verification rules 等 core constraint 被违反时写 `violated`。

不允许通过扫描 final answer 自动推断 `applied` 作为 promotion evidence。

## Automation

v1.5 引入两个 automation job。

### DailyTrialValidationJob

运行范围：

- 每个有 Cyrene memory/plugin 数据的 project memory root。
- global memory root。

project phase 自动晋升：


```txt
project trial -> validated
```

必须满足：

- low-risk project / procedural / system。
- 至少 2 次 `applied`。
- 0 次 unresolved `violated` 或 `corrected`。
- 没有 source-of-truth conflict。
- 未过 daily cap。
- eval gate 通过。
- 写 `MemoryEvent` receipt。

high-risk 行为：

- 不自动晋升。
- 生成 review recommendation 和 evidence package。

维护行为：

- expire stale trial。
- 合并明显重复的 trial candidate 或输出 merge recommendation。
- compact old usage stats，但不删除 source event。

global phase 不做 trial promotion，因为 global 没有 trial tier。它只处理 low-risk explicit global instruction 的 core 写入、high-risk global recommendation、global event/stat cleanup 和 global profile stale warning。

### WeeklyCoreAndGlobalConsolidationJob

运行范围：

- 每个 project memory root。
- global memory root。

project phase：

```txt
validated -> project_core
```

必须满足：

- low-risk project / procedural / system。
- 至少 2 个不同 session 或 task 中有 `applied`。
- 0 次 unresolved `violated` 或 `corrected`。
- eval gate 通过。
- 写 promotion receipt。

profile 行为：

- low-risk `project_core` 可进入 generated project profile。
- high-risk `project_core` recommendation 不写 profile。

global consolidation phase：

输入：

- 所有 project core。
- project core 的 usage stats。
- explicit global instructions。
- review-derived workflow learning。

自动写入 `global_core` 的条件：

- low-risk procedural / system。
- 是明确 global instruction，或在多个 project core 中稳定重复。
- 不包含 project-specific implementation detail。
- evidence package 包含 source project、usage event、decision reason。
- eval gate 和 cap 通过。

high-risk / ambiguous global candidate：

- 只生成 review recommendation。
- 不写 global core。
- 不写 global profile。

global maintenance：

- dedupe global core。
- 生成 supersede / deprecate / split / rewrite recommendation。
- 根据 global core 重新生成 global profile。
- 输出 stale warning，但不自动删除 high-risk memory。

## Explicit Global Instructions

用户明确表达全局规则时：

```txt
low-risk explicit global instruction
  -> global_core
  -> receipt + eval gate + cap

high-risk / ambiguous explicit global instruction
  -> global review recommendation
  -> user review required
```

high-risk 包括：

- personal / relationship / affective；
- 身份、长期偏好、关系边界、情感模式；
- 可能改变所有项目协作边界的 broad rule；
- evidence 不清楚或 scope 不清楚的全局化判断。

## Data Model

v1.5 不做隐式 compatibility。runtime 只读取 v1.5-shaped active memory。

`trial` 是 project runtime memory 的 confidence tier，不是 pending review 状态。pending / candidate records 可以继续作为 review 或 admission artifact 存在，但它们不进入 activation，也不参与 daily / weekly promotion，除非 migration 或 review path 明确把它们写成 v1.5-shaped active project trial memory。

```ts
type ProjectConfidenceTier = 'trial' | 'validated' | 'project_core'
type GlobalConfidenceTier = 'global_core'

type ActivationMode =
  | 'workflow_hint'
  | 'plan_constraint'
  | 'checklist_item'
  | 'workflow_selection'

interface ActivationPolicy {
  allowedModes: ActivationMode[]
  maxRuntimeStrength: 'hint' | 'constraint' | 'checklist' | 'profile'
}

interface SemanticMemory {
  id: string
  status: 'active' | 'archived' | 'rejected' | 'superseded'
  scope: 'project' | 'global'
  confidenceTier: ProjectConfidenceTier | GlobalConfidenceTier
  activationPolicy: ActivationPolicy
  // existing semantic fields remain: module, kind, domain, content,
  // useWhen, doNotUseWhen, sourceOfTruth, evidence, routing, reviewPolicy,
  // supersedes, expiresAt, reviewAfter, createdAt, updatedAt.
}
```

valid combinations：

```txt
scope = project:
  confidenceTier in trial | validated | project_core

scope = global:
  confidenceTier = global_core only
```

invalid combinations：

```txt
global trial
global validated
trial profile activation
pending activation
high-risk auto global_core
core without evidence
profile entry outside core
```

## Migration And Normalization

v1.5 migration 是一次清理，不是兼容层。

原则：

```txt
old pending / active memory
  -> 有价值的改造成 v1.5 memory
  -> 没价值的丢弃或归档
  -> high-risk 的输出 review recommendation
```

old pending：

- 默认丢弃。
- 有明确 future behavior、evidence、use boundaries、source boundary 的，可改造成 `project trial`。
- high-risk pending 不自动改造，生成 review recommendation。
- task state、episode、raw source excerpt、review_summary 噪声直接丢弃或归档为 audit。

old active project memory：

- 有价值且 low-risk 的，迁移为 `validated` 或 `project_core`。
- 价值不足、过期、模糊的，archive / drop with receipt。
- high-risk 的，生成 manual review recommendation。

old active global memory：

- 有价值且 low-risk procedural / system / explicit global instruction 的，迁移为 `global_core`。
- 价值不足、模糊、inferred personal / relationship / affective 的，生成 manual review recommendation 或 archive。

migration 后：

- 没有 explicit `confidenceTier` 和 `activationPolicy` 的 memory 不参与 runtime activation。
- automation 遇到缺 tier 的 memory 必须 report invalid / needs_migration。
- tests 不允许通过 implicit adapter 推断旧 memory tier。

## Memory Output Quality Gate

v1.5 的 release gate 必须验证最终生成出来的 memory 是否符合预期，而不只是验证 lifecycle mechanics。

质量检查对象：

- generated project trial；
- generated validated；
- generated project_core；
- generated global_core；
- generated activation；
- generated project/global profile；
- generated high-risk recommendation。

检查规则：

`project trial`：

- future-facing。
- 不是 task state、episode、raw review_summary 或 raw source excerpt。
- 有 `useWhen`、`doNotUseWhen`、evidence 和 source boundary。
- 只能产生 `workflowHint`。

`validated`：

- 至少 2 次 `applied`。
- 没有 unresolved `violated` / `corrected`。
- 可以产生 constraint / checklist。
- content 不是 implementation note。
- 不是 source-of-truth raw excerpt。

`project_core`：

- 在不同 session / task 中稳定被应用。
- 适合进入 project profile。
- 不 overbroad。
- 有清楚 subsystem / workflow boundary。

`global_core`：

- 只允许 procedural / system / explicit global instruction。
- 有 explicit global evidence 或 cross-project evidence。
- 不包含 project-specific implementation detail。
- 不包含 inferred personal / relationship / affective。
- 适合进入 global profile。

`recommendation`：

- high-risk reason 可见。
- evidence package 完整。
- 没有 active/core/profile mutation。

release gate 必须拒绝：

```txt
pending activated
global trial / global validated
trial checklistItems
high-risk auto core/profile
core without evidence
profile entry outside core
raw review_summary memory
raw source excerpt core
project-specific detail in global core
```

## Fixture Matrix

v1.5 扩展 `memory-quality-contract` fixture：

```txt
old review_summary noise
  expected: dropped, not project trial

valuable old pending workflow rule
  expected: project trial

trial applied twice
  expected: validated

trial with corrected event
  expected: not validated, review recommendation

validated applied across distinct sessions
  expected: project_core

validated with violated event
  expected: no core promotion, recommendation

same project_core appears across projects
  expected: global_core candidate or global_core if low-risk

explicit all-projects instruction
  expected: global_core if low-risk

affective inferred pattern
  expected: recommendation only

source-of-truth excerpt
  expected: distill/rewrite/drop, never raw core

project-specific implementation note
  expected: not global_core

core profile generation
  expected: profile contains only project_core/global_core memory
```

## UI And CLI Surfaces

runtime context should stay compact. Full inspection belongs in UI / CLI.

UI / CLI should show per memory:

- `confidenceTier`；
- activation mode；
- trigger reason；
- latest usage events；
- promotion eligibility；
- blocking negative feedback；
- automation receipts；
- high-risk recommendation evidence。

Suggested CLI surfaces:

```txt
codex memory activation inspect <memoryId>
codex memory lifecycle status
codex memory lifecycle migrate-v1-5 --dry-run
codex memory lifecycle migrate-v1-5 --apply
codex memory lifecycle daily --dry-run
codex memory lifecycle daily --apply
codex memory lifecycle weekly --dry-run
codex memory lifecycle weekly --apply
```

Suggested UI surfaces:

- activation diagnostics on memory detail page；
- lifecycle tier filters；
- automation recommendation inbox；
- profile generation diff；
- global consolidation report。

## Rollout Plan

Implementation should not be a single large PR. Suggested tracks:

```txt
PR1: v1.5 contracts and validators
  confidenceTier
  activationPolicy
  valid scope/tier combinations
  missing-tier invalid reports

PR2: migration / normalization
  dry-run report
  convert valuable old pending/active
  drop/archive noisy old memory
  recommendation path for high-risk old memory

PR3: activation layer
  trigger matching
  workflowHints / planConstraints / checklistItems
  continuity_get output
  activation diagnostics

PR4: usage feedback events
  activated/applied/ignored/corrected/violated/stale
  activationId linkage
  fail-open write path
  usage stats projection

PR5: DailyTrialValidationJob
  trial -> validated
  conservative thresholds
  cap/eval/receipt
  high-risk recommendation

PR6: WeeklyCoreAndGlobalConsolidationJob
  validated -> project_core
  project core -> global_core consolidation
  profile regeneration
  project/global memory cleanup recommendations

PR7: memory output quality gate
  fixture matrix
  generated memory shape validation
  activation/profile output validation
  release gate integration
```

## Verification

Documentation-only changes for this spec require:

```bash
git diff --check
```

Implementation verification should include:

```bash
npm run typecheck
npm test
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Required tests:

- confidence tier validation；
- invalid global trial rejected；
- missing tier not activated；
- activation mode by tier；
- explicit usage event append/read；
- trial only appears as workflowHint；
- validated/project_core generate checklist/constraints；
- daily trial -> validated thresholds；
- weekly validated -> project_core thresholds；
- weekly project core -> global core consolidation；
- high-risk recommendation path；
- migration drops or converts old pending/active correctly；
- generated project/global profile contains only core memory；
- memory output quality gate rejects polluted memory。

## Open Risks

- `applied` 需要明确 runtime 写入点；如果写入点太少，automation 会偏保守。
- `violated` 事件需要谨慎定义，避免把普通未召回或不适用误记为违反。
- global consolidation 必须避免把 project-specific detail 抽象成 global core。
- profile generation 需要保持 auditable diff，否则 core promotion 会难以 review。
- high-risk recommendation 如果 UI 不明显，用户仍可能错过重要 memory 维护建议。
