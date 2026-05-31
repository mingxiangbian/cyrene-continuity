# Cyrene Continuity v1.0.0 Admission Gate Rollout Design

Date: 2026-05-31
Status: Draft for written review

## 背景

原始计划位于 `/Users/phoenix/Downloads/cyrene_continuity_v1_0_0_admission_gate_upgrade_plan.md`，主题是 `Candidate Admission Gate + Structured Cognitive Memory`。

这次升级的核心问题不是“记忆不够多”，而是太多 session action、临时状态、数字快照、普通进度描述和重复事实被直接提升成 pending memory candidate。继续扩大 harvester、Dream 或 reflection 只会让低质量 pending 变得更复杂。

v1.0.0 的核心边界应改为：

```txt
Raw Trace
  -> Episode
  -> CandidateDraft
  -> AdmissionDecision
  -> Pending / Distillation Input / Episode-only / Drop
```

一句话：先阻止低价值内容进入 pending，再让真正有价值的候选进入 review、distillation、activation 和 reflection。

## 决策摘要

采用方案 C：分阶段主干串行，阶段内有限 multi-agent 并行。

- 不做一个大爆炸分支。
- 使用多个小 PR / commit 阶段合并，便于单点回滚。
- `PR1` 到 `PR4` 串行执行，因为它们定义数据契约和写入入口。
- `PR5` 之后才启用 multi-agent 并行，分别处理 CLI/MCP/API、UI、文档/runtime、测试矩阵。
- `Activation`、`Reflection`、`Principle` 不进入第一波 admission gate 发布，等入口质量稳定后单独设计。

## 目标

1. 为 Codex session 生成结构化 `EpisodeMemory`，保留发生过的活动，但默认不进入 prompt、pending 或 active memory。
2. 把候选草稿与 pending review queue 分离，引入 `CandidateDraft`。
3. 增加 `AdmissionDecision`，用可测试的评分、reason 和 action 决定 draft 的去向。
4. 只有通过 admission 的高价值候选才能写入 pending。
5. 保持现有 v5 review-hash、pending review、strict low-risk auto-promote、daily cap、eval gate 和 `MemoryEvent` receipt 模型。
6. 保持旧 pending 数据可读，新字段 optional，避免一次性 migration。
7. 为后续 Distillation 2.0、Activation、Reflection 和 Principle 提供可审计 lineage。

## 非目标

- 不在第一阶段实现完整 Cognitive Operations Console。
- 不让 admission gate 直接写 active memory。
- 不让 distillation、reflection 或 principle 绕过 pending review。
- 不迁移或重写所有历史 pending candidate。
- 不改变 high-risk、ambiguous、personal、relationship、affective memory 必须人工 review 的边界。
- 不编辑 `REVIEW_REPORT.md`。
- 不直接编辑 generated plugin runtime；若 skill/runtime 需要更新，应改 source 后 rebuild。

## Core Pipeline

### EpisodeMemory

`EpisodeMemory` 描述一次 session 发生了什么。它是 raw trace 的结构化摘要，不是 pending memory。

建议字段：

```ts
interface EpisodeMemory {
  id: string
  projectId: string
  title: string
  summary: string
  actions: string[]
  decisions: string[]
  failures: string[]
  openQuestions: string[]
  changedFiles?: string[]
  commandsRun?: string[]
  toolNames?: string[]
  sourceTraceIds: string[]
  createdAt: string
  expiresAt?: string
}
```

约束：

- Stop Hook 写 episode 必须 fail-open。
- episode 默认不进入 prompt。
- episode 默认不进入 pending。
- episode 可以作为 admission、distillation、debug 和审计证据。

### CandidateDraft

`CandidateDraft` 表示“可能值得记”的草稿。draft 不能被用户 review，也不能 promote；它必须先经过 admission。

建议字段：

```ts
interface CandidateDraft {
  id: string
  episodeId?: string
  content: string
  candidateKind:
    | 'project_fact'
    | 'project_decision'
    | 'workflow_rule'
    | 'known_pitfall'
    | 'rejected_approach'
    | 'open_question'
    | 'user_instruction'
  scope: 'project' | 'global' | 'session'
  domain: 'project' | 'procedural' | 'system' | 'personal' | 'relationship' | 'affective'
  sourceKind:
    | 'file'
    | 'tool_trace'
    | 'review_summary'
    | 'user_explicit'
    | 'assistant_observed'
    | 'daily_interview'
  sourceEpisodeIds: string[]
  evidenceRefs: string[]
  normalizedKey?: string
  tags: string[]
  createdAt: string
}
```

约束：

- review summary、project harvester、explicit instruction 和 tool trace 先产 draft。
- PR4 前保留旧 pending fallback，降低发布风险。
- PR4 后默认只有 admission 允许写 pending。

### AdmissionDecision

`AdmissionDecision` 是 pending 入口门控。

建议字段：

```ts
interface AdmissionDecision {
  id: string
  draftId: string
  action:
    | 'admit_to_pending'
    | 'admit_to_distillation'
    | 'episode_only'
    | 'auto_drop'
    | 'auto_defer'
    | 'merge_with_existing'
    | 'reject_duplicate'
  admissionScore: number
  reasons: AdmissionReason[]
  scores: {
    futureUsefulness: number
    actionability: number
    stability: number
    specificity: number
    evidenceStrength: number
    repeatPotential: number
    expiryRisk: number
    redundancy: number
    sensitivity: number
  }
  targetMemoryId?: string
  targetClusterId?: string
  createdAt: string
}
```

初始 reason 集：

```txt
one_time_action
temporary_status
stale_numeric_snapshot
low_future_usefulness
low_actionability
too_vague
duplicate_pending
duplicate_active
conflicts_with_tombstone
valuable_project_decision
valuable_workflow_rule
valuable_known_pitfall
valuable_rejected_approach
explicit_user_instruction
```

### PendingMemory Metadata

`PendingMemory` 保持现有 review-hash 和 v5 policy 模型，只新增 optional lineage 字段：

```ts
{
  admittedBy?: 'admission_gate_v1'
  admissionScore?: number
  admissionReasons?: string[]
  sourceEpisodeIds?: string[]
  sourceDraftIds?: string[]
}
```

这些字段不能成为读取旧 pending 的前置条件。

## 数据文件

第一阶段使用 JSONL 作为 source of truth，SQLite/index 在后续 PR 中同步。

建议新增：

```txt
episodes.jsonl
candidate_drafts.jsonl
admission_decisions.jsonl
distilled_candidates.jsonl
```

`activations.jsonl`、`reflections.jsonl`、`principle_candidates.jsonl` 留到后续阶段。

## PR Rollout

### PR1: Episode Layer

范围：

- 新增 `EpisodeMemory` schema。
- 在 memory store 增加 episode read/write。
- Stop Hook 写 `episodes.jsonl`。
- 增加基础测试。

验收：

- 每次 Stop Hook 可以生成 episode。
- episode 包含 summary/actions/decisions/failures/openQuestions 的结构化字段。
- episode 写入 fail-open，不阻断现有 review summary 或 pending 流程。
- episode 不进入 prompt，不进入 pending。

回滚：

- 删除或关闭 episode 写入即可，旧 pending 流程不受影响。

### PR2: Candidate Draft Layer

范围：

- 新增 `CandidateDraft` schema/store。
- review summary 和 project harvester 先产 draft。
- 保留旧 pending fallback。

验收：

- draft 写入 `candidate_drafts.jsonl`。
- draft 不出现在 pending review queue。
- 旧 pending 入口仍可用。
- draft 包含 candidateKind/sourceKind/evidenceRefs/sourceEpisodeIds。

回滚：

- 关闭 draft 写入，恢复旧 `proposeCodexMemoryCandidate` 入口。

### PR3: Admission Gate MVP

范围：

- 实现纯函数 scoring。
- 实现 admission reasons。
- 实现 dry-run / explain / stats。
- 增加 fixture-driven tests。

验收：

- 一次性动作记录判为 `episode_only`。
- 临时状态判为 `episode_only` 或 `auto_drop`。
- 数字快照判为 `episode_only` 或 `admit_to_distillation`，不能直接 `admit_to_pending`。
- 普通进度描述判为 `auto_drop` 或 `auto_defer`。
- durable workflow rule、known pitfall、project decision 和 explicit user instruction 可以 `admit_to_pending`。
- duplicate active/pending 能产生 `reject_duplicate` 或 `merge_with_existing`。

回滚：

- PR3 只读或 dry-run，不影响写路径。

### PR4: Admission Apply

范围：

- review summary、project harvester 和 explicit instruction 接入 admission apply。
- `admit_to_pending` 才写 pending。
- `episode_only`、`auto_drop`、`admit_to_distillation` 写 admission records。
- pending 写入保留 v5 review-hash、budget、auto-promote gate 和 audit receipt。

验收：

- pending 数量不会因 session action 或临时状态暴涨。
- `PendingMemory` review hash 保持稳定。
- strict low-risk auto-promote 只处理通过 admission 的 pending。
- high-risk / ambiguous / personal / relationship / affective memory 仍需要显式 review。
- `MemoryEvent` 或 admission record 能追踪 admission 决策。

回滚：

- 切回旧 `proposeCodexMemoryCandidate` 入口。

### PR5: Surface Area

PR5 开始适合 multi-agent 并行。

并行分工：

- Agent A：CLI/MCP/API。
- Agent B：UI Episode / Admission 页面。
- Agent C：文档、skill copy、plugin runtime build 和 validator。
- Agent D：测试矩阵、fixtures、regression。

验收：

- CLI 可以 list/show episodes。
- CLI 可以 admission dry-run/explain/stats。
- MCP/API 与 CLI 行为一致。
- UI 可以展示 Episode 和 Admission 结果。
- UI 不提供绕过 review 的 active write。
- 若修改 `plugin/skills/cyrene-continuity/SKILL.md`，必须 rebuild runtime 并 validate plugin。

### PR6: Distillation 2.0

范围：

- 消费 drafts + pending。
- cluster duplicate/weak candidates。
- 生成 source-linked distilled candidates。
- 显示 compression ratio。

验收：

- distilled candidate 保留 sourceDraftIds/sourcePendingIds/sourceEpisodeIds。
- distillation review-first，不直接 active。
- safe apply 只允许 drop/defer/merge/write distilled pending candidate。

### PR7+: Activation / Reflection / Principle

延后到 admission gate 稳定后。

范围：

- `continuity_get` activation event。
- Stop Hook 更新 activation outcome。
- `memory reflect --dry-run` 输出 strengthen/weaken/supersede/principle candidates。
- principle candidates 必须 review-first。

## Multi-Agent Policy

`PR1` 到 `PR4` 不使用并行 implementation agent 修改同一契约。主 agent 串行控制 schema、store、写入入口和验证。

允许的并行点：

- `PR5` 的 CLI/MCP/API、UI、docs/runtime、tests 可以并行。
- `PR6` 的 algorithm、store adapters、UI、tests 可以并行，但必须先冻结 distilled schema。
- 每条并行线都必须基于同一份已提交 spec/plan，不得各自发明字段。

禁止的并行点：

- 多个 agent 同时修改 `PendingMemory` schema。
- 多个 agent 同时改 Stop Hook 写路径。
- 一个 agent 改 admission action，另一个 agent 同时改 UI action copy 而不共享 contract。
- 在 admission apply 稳定前并行开发 reflection/principle。

## 验证策略

### PR1

- episode store read/write 单测。
- Stop Hook fail-open 测试。
- 旧 review summary/pending 流程 regression。
- `npm run typecheck`。

### PR2

- draft store read/write 单测。
- review summary 产 draft 测试。
- harvester 产 draft 测试。
- 旧 pending fallback 测试。

### PR3

使用表驱动 admission fixture：

| 输入类型 | 预期 |
| --- | --- |
| repo-review 一次性动作 | `episode_only` |
| 测试文件数量等数字快照 | `episode_only` 或 `admit_to_distillation` |
| vague progress summary | `auto_drop` 或 `auto_defer` |
| durable workflow rule | `admit_to_pending` |
| explicit user instruction | `admit_to_pending` |
| duplicate active/pending | `reject_duplicate` 或 `merge_with_existing` |

### PR4

- Stop Hook end-to-end。
- project harvester end-to-end。
- explicit instruction end-to-end。
- pending review-hash regression。
- v5 auto-promote policy regression。
- high-risk / ambiguous manual review regression。
- MemoryEvent/admission record lineage regression。

### PR5+

- CLI/MCP/API parity tests。
- UI API tests。
- UI snapshot or DOM-level tests for Episode/Admission pages。
- plugin build + validator when skill/runtime changes。
- `git diff --check` for docs-only changes。

## 风险与控制

| 风险 | 控制 |
| --- | --- |
| Stop Hook 失败阻断 Codex | episode/draft/admission 写入都 fail-open |
| draft 与 pending 双写造成重复 | PR2 只新增 draft visibility，PR4 才切换写入口 |
| 旧 pending 无新字段导致读取失败 | new metadata optional |
| admission gate 误拒 explicit instruction | explicit user instruction fixture 必须覆盖 |
| auto-promote 绕过 admission | PR4 后 auto-promote 只处理 admitted pending |
| UI 过早提供 override apply | PR5 先展示，不做 high-risk mutation |
| multi-agent 字段漂移 | PR1-PR4 串行，PR5 并行前冻结 contract |
| 回滚困难 | 每个 PR 都有独立验收和回滚点 |

## 成功标准

v1.0.0 第一阶段完成后，系统应满足：

- session action、临时状态、数字快照和 vague progress 不再直接污染 pending queue。
- 用户能看到系统不是“没记”，而是把低价值内容保存在 episode 或 admission records 中。
- pending queue 更小，候选更稳定、更具体、更有未来行动价值。
- 每个通过 admission 的 pending candidate 都能追踪 episode/draft/admission source。
- 现有 review-hash、manual review、高风险边界和 v5 auto-promote 安全模型保持成立。
- 后续 distillation、activation、reflection 和 principle 有清晰的数据来源，而不是基于混乱 pending 做二次加工。
