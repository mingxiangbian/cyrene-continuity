# Cyrene Continuity v6 Upgrade Plan Review + v5 Remediation Design

Date: 2026-05-30
Status: Draft for written review

## 背景

原始 v6 计划位于 `/Users/phoenix/Downloads/cyrene_continuity_v6_upgrade_plan.md`，主题是 `Project Memory Distillation & Operations Console`。它的核心判断成立：`cyrene-continuity` 下一阶段不应该继续简单扩大采集量，而应该把真实项目活动压缩成少量、高价值、可审查、可解释的长期项目 memory。

但当前仓库已经部分具备 v5/v6 计划中提到的一些能力，例如：

- `memory_edges` SQLite table 和 deterministic file edges；
- `retrieval-planner`、`why retrieved` explain 和 Web UI retrieval explain 面板；
- Web UI `triage apply` 的 safe `auto_drop` / `auto_defer` / `auto_merge` mutation；
- `review_event` source 和 review-derived global candidate capture；
- project harvester 的 signal collection、LLM rewrite、pending-only candidate write；
- strict low-risk auto-promote policy、daily caps、eval gates 和 `MemoryEvent` receipt。

因此 v6 plan 需要先做两件事：

1. 修复 v5 仍未闭环或语义不一致的问题。
2. 把 v6 收敛为 `Distillation-first continuity core`，避免重复规划已经存在的 v5 能力。

## 结论摘要

v6 的方向应该保留，但 implementation boundary 需要改写：

- 先设 `P0: v5 Remediation Gate`，修掉当前执行闭环和语义不一致问题。
- v6 的新增核心不是 `more harvesters`，而是 `Distilled Memory`、lineage、safe distillation apply、以及更可运营的 review surface。
- `Dream`、harvester、triage、distillation 都不能成为绕过 review 的 authority。它们只能提出、合并、降噪、推荐或执行严格低风险 policy 允许的动作。
- `global`、personal、relationship、affective、assistant_observed-only、similar-project transfer 仍默认 manual review。
- 第一轮 v6 不应该做完整认知层或大规模 UI 重写；应该以可验证的 distillation dry-run、safe apply subset、lineage detail、retrieval explain plus 为边界。

## v5 Capability Matrix

| Capability | 当前状态 | v6 审稿判断 |
| --- | --- | --- |
| Codex plugin / MCP / skill / lifecycle hooks | 已实现 | 作为基础设施，不在 v6 重做 |
| Pending -> review -> active pipeline | 已实现 | 保留 review-first 模型 |
| Strict low-risk auto-promote | 已实现/部分实现 | 只能通过 v5 named policy、daily caps、eval gates、auditable `MemoryEvent` receipt |
| Web UI pending review actions | 已实现 | 不允许扩展成高风险 batch approval |
| Web UI triage apply | 已部分实现 | 需要与 CLI triage apply 语义统一 |
| CLI triage apply | 部分实现 | 当前更偏 review-derived capture，需要补 safe triage mutation |
| Project harvester | 已实现 | 需要明确 deterministic evidence 与 LLM rewrite 分层 |
| Global review-derived learning | 已实现/部分实现 | 保持 manual review 默认，避免 broad conversation inference |
| `memory_edges` | 已实现基础表和 deterministic file edges | v6 应补 lineage/use/explain，不重建 schema |
| Retrieval explain | 已有雏形 | 需要补 `why excluded`、route boundary、degraded mode |
| Operations Console | Dashboard/console 雏形 | v6 只做最小可运营闭环，不做整站重写 |
| Distilled Memory | 缺失 | v6 真正新增核心 |

## P0: v5 Remediation Gate

P0 不引入新的 product ambition。它只修复 v5 已存在的问题，作为 v6 的前置条件。

### 1. Triage Executor 一致性

`codex memory triage --apply` 和 Web UI `/api/memory/triage/apply` 必须共享同一套 safe apply semantics：

- `auto_drop` 真实移出 pending queue，写 tombstone 和 `MemoryEvent`；
- `auto_defer` 真实更新 `promoteAfter` 或等价 defer metadata，写 `MemoryEvent`；
- `auto_merge` 真实合并 duplicate pending，保留 source candidate ids、evidence、tags、seenCount，写 `MemoryEvent`；
- `recommend` 和 `manual_review` 不做 mutation；
- high-risk candidate 不参与 unsafe batch approval。

成功标准：CLI 和 Web UI 对同一 pending fixture 输出一致的 mutation result、event receipt 和 index sync 行为。

### 2. Mutation Audit Receipt

所有自动动作都必须写 audit receipt。`MemoryEvent.details` 至少包含：

- `reviewAction` 或 `triageDecision`；
- source candidate ids；
- `clusterId`（如适用）；
- decision reason；
- policy id / eval gate / cap snapshot（如适用）；
- mutation 前后可解释的摘要。

不能只返回 decision JSON 而不写 durable event。

### 3. Archive / Tombstone / Supersede 语义校正

P0 需要复核 active lifecycle 的 vocabulary：

- `archive`：从 retrieval 隐藏，但不阻止未来同 key candidate；
- `tombstone`：从 retrieval 隐藏，并阻止未来同 `normalizedKey` candidate；
- `supersede`：用新 active memory 替代旧 memory，旧 memory 进入 superseded 状态，并保留 replacement lineage。

CLI、Web UI copy、`MemoryEvent.action`、`MemoryTombstone.reason` 必须一致，避免把 tombstone 行为记录成含糊的 archive 语义。

### 4. Retrieval Explain 缺口

现有 `why retrieved` 要保留，但 P0 应补齐：

- `why excluded`：说明 memory 因 domain、scope、route、sensitivity、stale、tombstone、similar-project boundary 等原因被排除；
- degraded mode：SQLite unavailable/stale、embedding disabled/fallback、JSONL fallback 时明确提示；
- route boundary：global/project/pending/similar-project 的来源、状态和限制必须可见。

`continuity_get` 仍必须保持 read-only，不能 rebuild index 或写 memory。

### 5. Harvester Evidence Contract

当前 project harvester 已经能采集 signals 并用 LLM rewrite 生成 candidates。P0 要把 contract 写清楚：

- deterministic evidence 是 source of truth；
- LLM 只能生成或压缩 candidate content；
- LLM 不能替代 source、candidateKind、scope、evidenceGroupId、safety/sensitivity gate；
- project harvester 不生成 personal、relationship、affective 或 global active memory；
- weak signal 应返回 no candidate，而不是制造低质量 pending。

### 6. Global Learning Safety

`review_event` global capture 可以保留，但必须保持边界：

- explicit global instruction 可以生成 global pending candidate；
- review-derived learning 默认生成 global pending candidate；
- broad conversation inference 不得生成 global active memory；
- project-only pattern 不得自动扩散到 global；
- global auto-promote 只允许 strict low-risk procedural/system memory 通过 named policy、daily cap、eval gate 和 event receipt。

## v6 Refined Design

### 1. Distilled Memory 数据模型

`Distilled Memory` 不能只是普通 pending 的改名。它需要能回答：从哪里来、合并了什么、为什么这样代表、是否存在冲突、下一步应 review 还是 safe apply。

建议新增或等价表示以下字段：

```ts
interface DistilledMemoryCandidate {
  distilledCandidateId: string
  clusterId: string
  sourceCandidateIds: string[]
  sourceEventIds?: string[]
  sourceMemoryIds?: string[]
  distillationPolicyId: string
  representativeContent: string
  candidateKind: string
  scope: 'project' | 'global'
  evidenceRollup: Array<{
    evidenceGroupId?: string
    sourceKind?: string
    summary: string
  }>
  conflictSet?: string[]
  recommendedAction: 'drop' | 'defer' | 'merge' | 'review' | 'strict_auto_promote_candidate'
  reviewHash: string
  scores: {
    evidenceStrength: number
    stability: number
    usefulness: number
    safety: number
    sensitivity: number
    distillationScore: number
  }
}
```

`strict_auto_promote_candidate` 不是 active write。它只表示可以送入既有 v5 strict policy；是否 active 仍由 named policy、daily cap、eval gate、event receipt 决定。

### 2. Distillation Dry-Run First

第一阶段只做：

```bash
cyrene-continuity codex memory distill --dry-run
```

输入：

- pending candidates；
- review summaries；
- recent events；
- active memories；
- tombstones；
- project harvester outputs；
- Dream preview themes（只作为 hint）。

输出：

- duplicate clusters；
- conflict clusters；
- low-value one-off candidates；
- representative distilled candidates；
- drop/defer/merge/review recommendations；
- unsafe-to-apply reasons。

dry-run 不写 active、不写 profile、不做 global promotion。

### 3. Safe Apply Subset

后续 `distill --apply` 只能先允许：

- safe drop；
- safe defer；
- safe merge；
- write distilled pending candidate；
- write lineage/event receipts。

不允许：

- direct promote high-risk memory；
- direct global active write；
- direct profile update；
- similar-project hint 变成 current-project fact；
- assistant_observed-only candidate auto-active；
- personal / relationship / affective auto-active。

### 4. Memory Lineage

v6 lineage 应优先使用 deterministic edges：

- `derived_from`
- `mentions_file`
- `about_command`
- `promoted_from_candidate`
- `merged_into_distilled`
- `supersedes`
- `conflicts_with`
- `retrieved_for_task`（可先作为 diagnostic/event，不一定进入 ranking）

`related_to`、`influenced_response`、model-assisted semantic edges 应放入 later phase。未批准 semantic edge 不得参与 retrieval ranking。

### 5. Operations Console 最小闭环

第一轮 v6 UI 不重写整站，只新增或强化三个工作面：

1. **Distillation**：展示 clusters、representative candidates、safe recommendations、unsafe reasons。
2. **Memory Lineage Detail**：展示 raw signal / pending / distilled / active / retrieval event 的路径。
3. **Retrieval Explain Plus**：展示 why retrieved、why excluded、route boundary、degraded mode。

UI 仍保持 single-candidate review-first。高风险 memory 不提供 unsafe batch approval。

## Scope Decomposition

### MVP

- P0 v5 remediation gate；
- `memory distill --dry-run`；
- Distilled candidate schema / event detail；
- duplicate/conflict/low-value cluster preview；
- deterministic lineage edges for distillation；
- Operations Console 最小 Distillation + Lineage + Retrieval Explain Plus；
- eval fixtures 覆盖 high-risk 不 auto-promote、similar-project 不变 current-project fact、global 不被 broad inference 污染。

### vNext

- `distill --apply` safe subset；
- Harvester 2.0 deterministic extraction layer；
- project-to-global candidate action；
- cross-project approved pattern mining；
- stale active memory detector；
- memory bloat score；
- richer retrieval reranker。

### Long-Term

- Dream REM / Deep 与 distillation proposal 深度协作；
- approved semantic edges；
- embedding-assisted clustering；
- project family knowledge；
- personal cognitive layer；
- broader Cyrene Agent Runtime continuity core。

## Multi-Agent Review / Implementation Model

后续实现可以使用 coordinator-led multi-agent，但必须先串行冻结 shared contracts。

### 串行先行

**Contracts Lane** 先冻结：

- distillation types；
- `MemoryEvent.details` shape；
- policy ids；
- eval names；
- CLI/API shape；
- unsafe action boundaries。

其他 agent 在 contracts freeze 前不应并行改 shared schema。

### 可并行 lanes

- **Triage / Mutation Lane**：修 P0 CLI/UI triage apply 一致性、audit receipts、pending mutation、index sync。
- **Harvester Lane**：强化 deterministic signal extraction 与 LLM rewrite 分层。
- **Distillation Lane**：实现 dry-run clustering、duplicate/conflict detection、representative preview。
- **Retrieval / Graph Lane**：补 why excluded、degraded diagnostics、deterministic lineage use。
- **Web UI Lane**：在稳定 API 之上做 Distillation、Lineage、Retrieval Explain Plus。
- **Eval / Verification Lane**：补 release gate 与负例 fixtures。

### 必须串行处理

- shared memory schema；
- auto-promotion policy；
- `distill --apply` mutation semantics；
- global memory policy；
- final integration；
- full verification；
- plugin build and validation。

## Risk & Verification Matrix

| Risk | Required verification |
| --- | --- |
| high-risk memory 被 auto-promote | eval gate + negative tests for personal/relationship/affective/assistant_observed-only |
| CLI/UI triage apply 不一致 | shared fixture tests for CLI and Web UI API |
| pending queue mutation 无 receipt | event JSONL assertions for every safe action |
| tombstone/archive 语义混乱 | active lifecycle tests for retrieval visibility and future candidate blocking |
| retrieval route 污染 | global/project/pending/similar routing eval |
| similar-project hint 变 current-project fact | similar hint eval + continuity context tests |
| LLM rewrite 覆盖 deterministic evidence | harvester tests asserting source/evidence/kind are deterministic |
| distillation merge 丢 evidence | cluster tests asserting all source ids and evidence rollups survive |
| semantic edge 污染 ranking | edge eval ensuring unapproved model edges do not affect retrieval |
| real memory data 被测试污染 | all tests use temp `HOME` |

Repo verification for implementation PRs:

```bash
npm test
npm run typecheck
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
npm run dev -- codex eval run --check release
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
git diff --exit-code -- src/codex/codex-ui-static.generated.ts plugin/runtime/cyrene-continuity.mjs
git diff --check
```

Documentation-only changes run:

```bash
git diff --check
```

## Recommended Decisions For Review

1. MVP should represent distilled candidates as pending candidates with `candidateKind` / tags / `MemoryEvent.details` lineage. A separate `distilled_candidates.jsonl` can wait until the lineage model proves useful.
2. `distill` should be a new command, not a `triage --distill` mode. Triage is quick queue cleanup; distillation is deeper clustering and representative candidate generation.
3. `retrieved_for_task` should start as a bounded diagnostic event, not a durable graph edge. This avoids graph bloat while preserving retrieval explainability.
4. Project-to-global candidate action should be vNext, not MVP. Project-only distillation should stabilize before any broader global-memory surface expands.

## Approval Gate

This spec is approved for implementation planning only when the reviewer accepts:

- P0 v5 remediation must happen before v6 distillation apply.
- v6 does not weaken the v5 review model.
- Distilled candidates remain reviewable/provisional unless strict v5 policy explicitly promotes them.
- Multi-agent implementation starts only after shared contracts are frozen.
