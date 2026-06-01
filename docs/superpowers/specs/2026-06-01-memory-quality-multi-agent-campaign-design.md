# Memory Quality Multi-Agent Campaign Design

Date: 2026-06-01
Status: Draft for written review

## 背景

Cyrene v2 semantic memory pipeline 已经有 `SemanticMemory` contract、v2 JSONL store
helpers、migration CLI、admission pipeline、pending review surface 和部分 eval gate。当前问题
不是“采集不够”，而是后续 multi-agent 实现如果没有共同质量标准，容易出现两类相反失败：

- 为了安全而什么都不产出，导致 durable signal 被漏掉。
- 为了自动化而把 task state、短期 TODO、情绪事件原文或 raw implementation note 推进
  pending / active，污染长期 memory。

这次 campaign 的第一目标不是增加 runtime 自动化，而是建立一个可用于 coordinator 审查
subagent 工作的 `Memory Quality Contract`。自动化测试和 eval harness 可以逐步补充，但
第一波成功标准是：每个 agent 的交付都能被同一份 rubric、fixture matrix 和
`Memory Delta Report` 审查。

## 决策摘要

采用 `Quality Contract + Agent Work Protocol`：

- 第一波先定义 memory 质量合同、reviewer rubric、fixture matrix 和 agent 交付模板。
- `Quality Gate` 是协作验收层，不是第一优先级的 runtime mutation gate。
- 后续 implementation plan 可以把 fixture matrix 部分自动化，但自动化不是质量标准成立的前提。
- multi-agent 可以用于后续 Distillation、Router/ReviewPolicy、Review Surface、
  Activation/Reflection 等并行 track。
- 所有 subagent 必须基于同一份 spec/plan 和同一套 module / policy / action 词表。

## 目标

1. 建立一份能同时约束 precision 和 recall 的 memory quality contract。
2. 防止低质量 signal 污染 pending / active memory。
3. 防止模型以“谨慎”为理由漏掉明显应该捕获的 durable signal。
4. 为 coordinator 提供 review rubric，用于审查每个 subagent 的 PR / 结果。
5. 建立 fixture matrix，覆盖典型 memory 输入、期望分类、module、policy、输出和禁止结果。
6. 定义 `Memory Delta Report`，要求每个 subagent 说明本次捕获、跳过和保护了什么。
7. 为后续 multi-agent implementation campaign 划清并行边界和 shared contract 边界。

## 非目标

- 不在本 spec 中实现 runtime mutation gate。
- 不把 high-risk memory 自动写入 active。
- 不让 distillation、router、reflection 或 Dream 绕过 review policy。
- 不把 rubric 变成宽泛建议；它必须能用于审查 agent 工作。
- 不在没有 coordinator 合并 shared contract 的情况下让多个 agent 各自新增字段或 policy 名称。
- 不编辑 `REVIEW_REPORT.md`。
- 不直接编辑 generated plugin runtime。

## Memory Quality Contract

核心原则：

```txt
A memory system is high quality only if it captures durable signals
and prevents unsafe activation.
```

这意味着质量合同必须同时约束两件事：

- `High precision`: 不该记的内容不能污染 pending / active。
- `High recall`: 该被捕获的 durable signal 不能被漏掉。

### Hard Red Lines

这些内容不能直接进入 active memory：

- 一次性动作和普通进度描述。
- 短期 TODO、task state、临时 UI/implementation 状态。
- 数字快照，例如测试文件数量、当前 pending 数量、临时统计。
- raw emotion event，例如“用户不满了”这类未经抽象的情绪事件原文。
- 未经 distillation 的 implementation note。
- source-of-truth rule 的 raw excerpt，除非已改写成 reusable semantic memory 并保留来源边界。

这些内容永远不能由 agent 自行自动 active：

- personal、relationship、affective memory。
- global policy、principle、identity-like memory。
- 用户偏好的隐式推断。
- source-of-truth 解释变更。
- conflicting、ambiguous、assistant-observed-only memory。

### Required Capture

模型不能用“谨慎”逃避产出。出现以下 durable signal 时，agent 必须生成
`CandidateDraft`、`DistillationInput`、pending candidate、reflection candidate，或明确写入
`No Memory Delta` 理由：

- explicit user instruction。
- durable workflow rule。
- known pitfall，尤其带 mitigation 的重复失败。
- durable project decision。
- rejected approach，且未来容易再次误选。
- source-of-truth rule，需要经过 distillation 后成为稳定规则。
- contradicted 或 stale active memory。
- repeated failure、repeated correction、repeated review feedback。

高风险 signal 也不能静默丢失。正确做法是进入 manual-review candidate 或 episode evidence，
而不是自动 active。

## Reviewer Rubric

Coordinator 审查每个 subagent 交付时，至少检查以下项目。

### Capture

- 是否捕获了 explicit user instruction、workflow rule、known pitfall、repeated failure、
  source-of-truth rule 和 durable project decision。
- 如果没有 memory delta，是否给出 `No Memory Delta` 说明。
- 是否区分“没有值得 active 的 memory”和“没有值得捕获的 signal”。

### Non-Pollution

- 是否把 task state、短期 TODO、数字快照、raw emotion event、一次性动作或 raw
  implementation note 直接写入 pending / active。
- 是否在 distillation 前保留原文边界，避免把 raw event 伪装成 durable rule。

### Routing

- Episode、Task State、DistillationInput、Project Semantic、Procedural Rule、Preference、
  Relationship/Affective、Principle 是否走了正确 module / policy。
- 高风险 module 是否保持 manual review。
- 低风险 durable project/procedural signal 是否没有被静默 drop。

### Evidence

- candidate 是否带 source、episode、what happened、why important、result、source-of-truth
  或 limitation。
- evidence 是否足以支持 future behavior，而不只是记录“发生过什么”。

### Use Boundaries

- pending / active 是否有 `useWhen` 和 `doNotUseWhen`。
- 是否避免把局部项目事实泛化成 global preference 或 policy。

### Reviewability

- reviewer 是否不用读 raw JSON 就能判断 approve / edit / reject / defer。
- review surface 是否展示 remembered content、identity、policy、risk、use boundaries、evidence
  和 review action。

### Activation Safety

- auto-promote 或 active mutation 是否限制在低风险、有证据、有 receipt 的路径。
- high-risk、ambiguous、relationship/affective、preference/global policy 是否不会自动 active。

### Reflection Safety

- activation/reflection 是否只产生候选，不直接修改 active。
- contradicted/stale memory 是否进入 reviewable replacement / deprecation path。

## Fixture Matrix

Fixture matrix 用来固定典型样例。每个 fixture 至少包含：

```txt
input signal
expected classification
expected module
expected policy
expected output
must-not outcome
review notes
```

第一批 fixture 类别：

| Fixture | Expected Classification | Expected Policy | Must Not |
| --- | --- | --- | --- |
| 一次性动作 | `episode_only` | no memory candidate | pending / active |
| 短期 TODO / task state | `task_state` 或 `episode` | no active write | durable memory 原文 |
| 数字快照 | `episode_only` 或 `distillation` | no direct pending | active fact |
| raw emotion event | episode evidence 或 manual-review evidence | manual review | active 原文 |
| durable workflow rule | procedural / project semantic candidate | pending review 或严格低风险路径 | silent drop |
| known pitfall with mitigation | project semantic candidate | pending review 或严格低风险路径 | pitfall without mitigation |
| explicit user instruction | candidate | risk-based review policy | silent drop |
| source-of-truth rule excerpt | distillation input | distill then pending review | raw excerpt active |
| preference / relationship / affective | manual-review candidate 或 evidence | manual only | auto active |
| contradicted active memory | reflection candidate | review-first rewrite/deprecate | direct supersede |
| repeated failure | known pitfall candidate | pending review / distillation | no memory delta |

Fixture matrix 可以先作为文档和 review checklist 存在。后续 plan 可以把它逐步转成
table-driven tests 或 `codex eval run --check memory-quality`。

## Memory Delta Report

每个 subagent 交付必须附 `Memory Delta Report`，最少包含：

```txt
Captured durable signals
Generated candidates / distillation inputs / reflection candidates
Episode-only or task-state signals
No-memory decisions and reasons
Pollution safeguards
Recall safeguards
Fixture coverage
Open risks
```

如果 subagent 判断本次没有值得生成的 memory candidate，必须给出 `No Memory Delta`：

```txt
Signals reviewed:
Decision:
Why no durable memory candidate:
Why no durable signal was dropped:
Why pending / active stayed clean:
```

Coordinator 不能只接受“没有 memory changes”。必须能看见 agent 审过哪些 signal，以及为什么没有漏掉
durable signal。

## Multi-Agent 分工

后续 implementation campaign 可以拆为以下 agent track。

### Agent A: Distillation Quality

职责：

- 把 raw event、implementation note、review summary、task state 改写成 reusable
  `SemanticMemory(status='candidate')`。
- 输出 `useWhen`、`doNotUseWhen`、structured evidence、source links、mitigation。
- 防止 raw event 原文进入 pending。
- 防止 durable signal 因为需要改写而被静默丢掉。

交付重点：

- Distillation fixtures。
- Memory Delta Report。
- Source lineage。

### Agent B: Router / ReviewPolicy

职责：

- 实现或强化 module classification 和 policy decision。
- 区分 `episode_only`、`task_state`、`distillation`、`pending_review`、`manual_only`、
  `strict_auto_promote`。
- 保证 high-risk manual review。
- 保证 low-risk durable signal 不被 silent drop。

交付重点：

- Routing fixtures。
- Policy decision explain。
- High-risk manual-only regression。

### Agent C: Review Surface

职责：

- 让 CLI / MCP / UI 展示 readable review card。
- 显示 content、identity、policy、risk、use boundaries、evidence 和 review action。
- 避免默认展示 raw JSON 或只展示 readiness 标签。

交付重点：

- Reviewer can decide without raw JSON。
- Pending / active review hash boundary 保持。
- UI/API parity。

### Agent D: Activation / Reflection

职责：

- 记录 active memory 的 retrieved / used / ignored / contradicted / stale。
- 把反馈转成 reflection candidate。
- 不直接 mutate active memory。

交付重点：

- Reflection review-first。
- Contradicted/stale fixtures。
- No direct supersede without review。

### Agent E: Quality Harness / Fixtures

职责：

- 维护 fixture matrix、rubric checklist、agent deliverable template。
- 审查 cross-agent regression。
- 帮助把文档 fixtures 逐步转为 tests/evals。

交付重点：

- Fixture coverage map。
- Coordinator review checklist。
- Contract drift detection。

## Coordinator Review Protocol

1. 每个 agent 开工前必须引用同一份 spec / plan。
2. agent 不得新增未登记的 module、policy、action 或 review meaning。
3. 每个 agent 交付必须附 `Memory Delta Report`。
4. Coordinator 用 rubric 审查，不只看测试通过。
5. 任一 agent 修改 shared contract，必须先回到 coordinator 合并 contract，再让其他 agent rebase。
6. 最终集成以 fixture matrix 和 rubric 通过为完成标准，而不是以功能存在为完成标准。

## Campaign 阶段

### PR0: Memory Quality Contract

写入 spec/plan 级文档，定义 quality rubric、fixture matrix、Memory Delta Report 模板和
coordinator review protocol。可以创建 fixture 文件或测试 skeleton，但不要求 runtime 自动化。

### PR1: Quality Harness Foundation

把 fixture matrix 放到 repo 可执行或半可执行的位置。最低要求是文档化 fixtures；更好是轻量
test/eval harness，能检查 routing / policy 预期。这个阶段不改 memory 写入策略。

### PR2: Distillation Quality Track

实现或强化 distillation，从 drafts、admission、episodes、pending、active 生成
`SemanticMemory(status='candidate')`。输出必须包含 use boundaries、structured evidence、
source links 和 mitigation。不能直接 active。

### PR3: Router / ReviewPolicy Track

实现 module-aware routing 和 review policy。重点是 high-risk manual、durable signal 不漏、
低风险自动路径有 receipt。

### PR4: Review Surface Track

CLI / MCP / UI 展示 readable review card。目标是 human review，不是 raw JSON debug。

### PR5: Activation / Reflection Track

写 `ActivationEvent`，生成 `ReflectionCandidate`，处理 stale / contradicted / unused memory。
所有结果回到 review pipeline，不直接修改 active。

### PR6: Integration Review

Coordinator 跑完整 fixture / rubric 审查，检查 multi-agent 字段一致性、迁移边界、
review-hash 安全、runtime/plugin build。

## 成功标准

- 每个 durable signal 都有去处：candidate、distillation、pending/manual review、reflection
  candidate，或有明确 `No Memory Delta` 理由。
- 明显低质量 signal 不直接进 pending / active。
- 所有 high-risk memory 都 manual review。
- 每条 pending 能被人审清楚。
- Distillation、Router、Review Surface、Activation/Reflection 共用同一套 module / policy /
  action 词表。
- 每个 subagent 交付都有 `Memory Delta Report`。
- 最终不是“自动化最多”，而是“该记的没漏，不该 active 的没污染”。

## 验证

本 spec 是 documentation-only change，验证命令：

```bash
git diff --check
```

后续如果 implementation plan 修改 `plugin/skills/cyrene-continuity/SKILL.md`，还必须运行：

```bash
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```
