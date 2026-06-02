# Cyrene v1.4 Memory Quality Refinement Design

Date: 2026-06-02
Status: Written review draft

## 背景

v1.3 已经把 memory pipeline 从松散 pending 列表推进到结构化 review flow：

- `source_of_truth_duplicate`、`reference_only`、`task_state`、`admit_to_distillation` 已进入 admission vocabulary。
- `MemoryRouter` 已为 candidate 生成 `module`、`updatePolicy`、`risk` 和 routing reasons。
- pending review UI 已显示 `Proposed Semantic Memory`、`Episode Evidence`、`Admission / Routing Decision`、`Update Policy`、`Use Boundaries`、`Review Action`。
- `memory distill --dry-run` 已读取 drafts、admissions、episodes、semantic memories、events 和 review decisions。
- active promotion 已被 active-readiness、structured approval、review hash、v5 policy、eval gate、daily cap 和 receipts 保护。

剩余问题不再是“候选能不能被分类”，而是“进入 pending review 的候选是否天然像高质量 semantic memory”：

- 有些 pending content 仍像 implementation note 或操作记录。
- `useWhen` / `doNotUseWhen` 仍可能是模板化边界。
- distillation preview 仍偏聚合和代表文本选择，不够会抽象。
- 如果 v1.4 只修 `needs_rewrite` pending，范围会过窄；v1.3 主 admission path 已经会把很多坏形状候选送到 distillation 或 reference/task/episode path。

v1.4 因此不是扩大采集，也不是让模型自动写 active memory。它是一次质量收敛：让新生成的 pending 更接近可 approve 的 semantic memory 形态，并为已经进入 pending 但仍需 rewrite 的候选提供安全修复路径。

## 决策摘要

采用 `Pending Creation Shaping + Gated Auto-Prepare Rewrite + Boundary Enrichment`：

1. **Pending Creation Shaping**
   在候选已经通过 admission/router、即将写入 pending 之前，用 deterministic semantic builder 规范 content。它不决定“该不该记”，只决定“怎么写成可审 memory”。

2. **Pending Prepare Rewrite**
   对 existing pending 中被 active-readiness 或 structured approval 标成 `needs_rewrite` 的候选做 controlled content replace。它可以使用 rules first + optional LLM dry-run，但必须通过 validator。

3. **Semantic Boundary Enrichment**
   对 content 已 ready 的 pending，不改 canonical content，只补具体 `useWhen`、`doNotUseWhen`、`sourceOfTruth` 和 structured evidence projection。

自动化上限是 **Auto prepare**：

- 可以自动 shape/rewrite/enrich pending review material。
- 不自动 mutate active memory。
- 不自动 supersede / merge / deprecate active memory。
- 不把 `task_state`、`episode_only`、`reference_only`、`auto_drop`、`duplicate_active` 自动转成 pending。
- 不自动从 distillation preview materialize pending。
- LLM 只能作为 optional preview/rewrite helper，不能绕过 deterministic gate、validator、review hash 或 user review。

## 目标

1. 新生成的 pending content 应按 `candidateKind` 进入标准 semantic memory 形态。
2. 已进入 pending 且 `needs_rewrite` 的候选可自动修复为 future-facing content，而不是停留在不可 approve 状态。
3. ready pending 的 `useWhen` / `doNotUseWhen` 不再依赖 `Future task matches <normalizedKey>` 或泛化 stale/unrelated 模板。
4. distillation dry-run 能显示 rewritten representative semantic preview，但不自动创建 pending。
5. prepare 不增加 pending 数量，不改 active memory，不绕过 review hash。
6. 每次 content replacement 或 boundary enrichment 都有可审计 receipt。

## 非目标

- 不扩大 harvester 或 admission capture 范围。
- 不让 task state、episode、reference-only source excerpt、auto-drop signal 重新包装成 pending。
- 不把 distillation input 自动 materialize 成 pending。
- 不让 LLM-first 决定 memory capture、risk、scope 或 active mutation。
- 不自动修改 active memory、tombstone active memory、supersede active memory 或合并 active memory。
- 不重写整个 Web UI；v1.4 只补 prepare 状态、rewrite receipt 和 distillation preview surface。
- 不编辑 `REVIEW_REPORT.md`。
- 不直接编辑 generated plugin runtime；如 UI 或 skill source 变化，最后用 `npm run build:plugin` 生成。

## 当前约束

当前代码有两个重要事实：

1. `admission-gate.ts` 会把明显 `needs_active_memory_rewrite` 的 drafts 导向 `admit_to_distillation`，所以“只修 existing pending + needs_rewrite”不足以改善所有未来 pending。
2. `memory-propose.ts` 仍可能把 active-readiness 不通过的候选留在 pending，尤其是 auto-promote 被 readiness gate 阻止时。因此 existing pending rewrite 仍有价值，但范围应保持窄。

因此 v1.4 必须同时做：

- 写 pending 前的 deterministic shaping，提升未来 pending canonical content。
- 写 pending 后的 gated prepare，修复少数 existing pending needs-rewrite。
- ready pending 的 semantic boundary enrichment，减少模板化 review card。

## 设计

### 1. Pending Creation Shaping

新增 deterministic semantic builder，位置在 admission/router 已允许候选进入 pending 之后、`PendingMemory` 写入之前：

```txt
CandidateDraft / CodexMemoryCandidateInput
  -> AdmissionDecision + RoutedMemoryTarget
  -> SemanticContentBuilder
  -> PendingMemory
```

builder 不处理以下 action：

```txt
task_state
episode_only
reference_only
auto_drop
auto_defer
reject_duplicate
admit_to_distillation
```

builder 只处理实际进入 pending 的候选：

```txt
admit_to_pending
merge_with_existing
manual pending write path from proposeCodexMemoryCandidate
```

如果 admission 决定不是 pending，builder 不得推翻该决定。`admit_to_distillation` 仍进入 distillation preview，`task_state` / `episode_only` / `reference_only` 仍留在各自路径。

#### Candidate-kind shaping

`workflow_rule`：

- content 必须是 future-facing rule。
- 避免“这次执行了什么”“已完成什么”。
- 规则必须有明确 workflow/subsystem 边界。
- 过宽的 `all/every/所有/每次` 表述必须收窄到 non-trivial 或具体 workflow。

示例：

```txt
输入：
拒绝 pending memory 的流程：按照 Cyrene review 流程，逐条进行哈希校验，确认后执行拒绝操作。操作后需验证 pending 列表为空。

输出：
Pending-memory rejection workflows must validate each candidate's review hash before mutation and verify the queue state after rejection.
```

`known_pitfall`：

- content 必须包含 failure mode、cause 和 mitigation。
- 不能只说“发生了问题”或“修复方案是”。

示例：

```txt
输入：
pending review 哈希因 semantic projection 改写导致假冲突。修复方案：调整优先从 pending.jsonl 直接读取 pending review，而非依赖缓存推导。

输出：
Pending-review hashes must be read from canonical pending.jsonl records rather than semantic projection or cache-derived data; projection rewrites can cause false review-hash conflicts.
```

`project_decision`：

- content 必须写成 decision + rationale / boundary。
- 不能只是 implementation milestone。

`rejected_approach`：

- content 必须写成 rejected approach + reason + when not to retry。

`project_fact`：

- 只有稳定项目事实才保持 project fact。
- 如果内容实际是 workflow/pitfall/decision，builder 可建议相邻 `candidateKind`，但必须保留原始 kind 和 change reason 到 receipt/review metadata。

#### Builder 输出

建议输出结构：

```ts
interface SemanticContentShape {
  content: string
  candidateKind: MemoryCandidateKind
  useWhen: string[]
  doNotUseWhen: string[]
  sourceOfTruth?: string
  evidence: StructuredEvidence[]
  changedFields: string[]
  reasons: string[]
}
```

`useWhen` / `doNotUseWhen` 在 creation shaping 阶段就生成具体边界，供 pending review projection 使用。不要生成 `Future task matches <normalizedKey>`。

### 2. Pending Prepare Rewrite

prepare layer 扫描 existing pending，但只做窄范围 content replacement。

Eligible 条件：

```txt
pending activeReadiness.status = needs_rewrite
或 readiness reasons 包含 implementation_note
或 readiness reasons 包含 raw_file_rule_excerpt
或 readiness reasons 包含 overbroad_workflow_rule
或 structured approval gate 因 raw content shape 返回 needs_rewrite
```

不 eligible：

```txt
ready pending
已被用户 approve/reject/defer/edit 的 pending
source boundary 无法确认的 pending
high-risk personal/relationship/affective pending
conflicted pending
```

prepare 触发方式：

- 自动：stop hook / review summary 后可后台扫描 small capped batch。
- 自动：dashboard/API 可提示 stale `rewrite_pending`，但不在 dashboard read path 同步等待模型。
- 手动：`codex memory prepare --scope project --dry-run`
- 手动：`codex memory prepare --scope project --apply`
- 手动：Web UI `Prepare rewrites`

LLM 策略：

- deterministic rewrite 先运行。
- 如果模型配置存在，可以对 small capped batch 做 optional LLM dry-run rewrite。
- LLM 输出只作为候选 rewrite，必须通过 validator。
- LLM 超时、未配置或输出无效时，使用 deterministic fallback。
- fallback 仍不过 validator 时 pending 不变。

### 3. Semantic Boundary Enrichment

对 content 已 ready 的 pending，不改 canonical content，只生成或更新 semantic review projection：

- `useWhen`
- `doNotUseWhen`
- `sourceOfTruth`
- structured evidence
- routing/review display fields

边界生成按 `candidateKind` 和 subsystem/failure mode 具体化：

`workflow_rule`：

```txt
Use when: planning or executing the same workflow/subsystem.
Do not use when: the task does not touch that workflow, or a newer source-of-truth rule supersedes it.
```

`known_pitfall`：

```txt
Use when: debugging the same failure mode or modifying the affected subsystem.
Do not use when: the subsystem was replaced, or the failure mode no longer applies.
```

`project_decision`：

```txt
Use when: making design changes at the same architecture boundary.
Do not use when: a newer decision supersedes this one or the task is outside that boundary.
```

如果无法从 evidence/source refs 找到 `sourceOfTruth`，不得伪造；标记为 `needs_review_source_boundary`。

### 4. Distillation Preview

v1.4 可以提升 `memory distill --dry-run` 的 representative content，但不自动创建 pending。

行为：

```txt
distillation inputs
  -> representative semantic preview
  -> source ids / evidence refs / sourceOfTruth
  -> user review
```

明确不做：

```txt
distillation input -> automatic pending
distillation input -> active memory
distillation input -> active merge/supersede
```

如果后续要支持 materialize，应是显式 action，例如：

```txt
Create pending from preview
```

v1.4 spec 不要求实现该按钮。

### 5. Validator

#### Content rewrite validator

只适用于 existing pending + `needs_rewrite`。

通过条件：

- rewritten content 必须 future-facing。
- rewritten content 不能继续描述“这次实现了/修复了/完成了什么”。
- raw source excerpt 不能原样进入 rewritten content。
- `sourceOfTruth` 必须保留或收紧，不能丢失。
- `candidateKind` 只能保持不变或变成相邻类型。
- `scope` / `domain` / `risk` 不能扩大，risk 不能降低。
- rewritten content 必须通过 `evaluateActiveMemoryReadiness().ready === true`。
- `useWhen` / `doNotUseWhen` / structured evidence 必须非空且非模板化。

#### Boundary enrichment validator

适用于 content ready pending。

通过条件：

- canonical content hash 不变。
- `useWhen` 具体到 workflow/subsystem/failure mode/architecture boundary。
- `doNotUseWhen` 说明真实不适用边界。
- 缺 source boundary 时只能标记 review blocker，不能编造。
- structured evidence 只能来自 pending evidence、draft、episode 或 source refs。

### 6. Receipt And Hash Lineage

新增 sidecar：

```txt
semantic_rewrite_receipts.jsonl
```

建议类型：

```ts
interface SemanticRewriteReceipt {
  id: string
  pendingMemoryId: string
  preparedSemanticMemoryId?: string
  action: 'shape_on_create' | 'replace_content' | 'enrich_boundaries' | 'skip' | 'fail'
  method: 'deterministic' | 'llm' | 'deterministic_fallback'
  oldReviewHash?: string
  newReviewHash?: string
  originalContentHash: string
  rewrittenContentHash?: string
  changedFields: string[]
  eligibilityReasons: string[]
  validatorReasons: string[]
  sourceOfTruth?: string
  createdAt: string
}
```

规则：

- `replace_content` 后必须重新生成 review hash。
- `enrich_boundaries` 不应改变 content hash。
- `shape_on_create` 可记录 pending creation 阶段的 content shaping。
- UI 显示 `Prepared` / `Needs rewrite` / `Rewrite failed` 状态。
- detail rail 显示 method、old/new review hash、changed fields、eligibility reasons、validator reasons、original content hash。
- 用户已确认或编辑过的 pending 不再被 prepare 覆盖。

### 7. API And CLI

新增 service：

```txt
runCodexMemoryPrepare()
```

CLI：

```bash
codex memory prepare --scope project --dry-run
codex memory prepare --scope project --apply
```

API：

```txt
POST /api/memory/prepare/dry-run
POST /api/memory/prepare/apply
```

结果字段：

```ts
{
  scanned: number
  eligible: number
  shapedOnCreate: number
  contentRewrites: number
  boundaryEnrichments: number
  skipped: number
  failed: number
  pendingCountBefore: number
  pendingCountAfter: number
  activeCountBefore: number
  activeCountAfter: number
  receipts: SemanticRewriteReceipt[]
}
```

后台自动 prepare 使用同一 service，但必须有 caps：

```txt
maxItemsPerRun
maxLlmItemsPerRun
timeoutMs
```

## v1.4 Expected Results

v1.4 完成后，未来类似这两类、且已经被 admission/router 允许进入 pending 的候选，应自动接近目标形态：

### Pending-memory rejection workflow

输入信号：

```txt
拒绝 pending memory 的流程：按照 Cyrene review 流程，逐条进行哈希校验，确认后执行拒绝操作。操作后需验证 pending 列表为空。
```

期望 pending content：

```txt
Pending-memory rejection workflows must validate each candidate's review hash before mutation and verify the queue state after rejection.
```

期望结果：

- `candidateKind = workflow_rule`
- content 是 future-facing rule
- `useWhen` 指向 pending-memory reject/defer/promote/review-hash workflows
- `doNotUseWhen` 排除 unrelated memory review tasks
- pending count 不增加
- active memory 不变

### Pending-review hash pitfall

输入信号：

```txt
pending review 哈希因 semantic projection 改写导致假冲突。修复方案：调整优先从 pending.jsonl 直接读取 pending review，而非依赖缓存推导。
```

期望 pending content：

```txt
Pending-review hashes must be read from canonical pending.jsonl records rather than semantic projection or cache-derived data; projection rewrites can cause false review-hash conflicts.
```

期望结果：

- `candidateKind = known_pitfall`
- content 包含 failure mode、cause、mitigation
- `useWhen` 指向 pending review state、review hash validation、reject/defer/promote flows
- `doNotUseWhen` 排除不触及 canonical pending records 的任务
- pending count 不增加
- active memory 不变

## Acceptance Verification

新增 v1.4 acceptance fixtures / tests：

```txt
1. implementation_note pending
   apply 后 pending count 不变，content 被改成 future-facing rule，activeReadiness.ready = true，receipt action = replace_content。

2. raw_file_rule_excerpt pending
   apply 后 content 不再复制 AGENTS.md 原文，sourceOfTruth = AGENTS.md 保留，reviewHash 更新。

3. overbroad_workflow_rule pending
   apply 后规则被收窄到 non-trivial / specific workflow，不能保留 all/every 绝对表述。

4. ready pending with template boundaries
   content hash 不变，只补 useWhen/doNotUseWhen，receipt action = enrich_boundaries。

5. good ready pending
   content 和 semantic fields 都不变，receipt action = skip 或无 receipt。

6. distillation input
   dry-run 有 rewritten representative preview，但 pending count 不增加，active 不变。

7. task_state / episode_only / reference_only / auto_drop
   prepare 不会把它们 materialize 成 pending。

8. LLM unavailable
   deterministic fallback 能完成；失败也不能阻塞 prepare run。

9. invalid LLM output
   validator reject，pending 不变，receipt action = fail。

10. active memory
   prepare 前后 active index 完全不变，没有 promote/supersede/deprecate event。

11. new pending creation shaping
   pending-memory rejection workflow 和 pending-review hash pitfall 的新候选在写入 pending 前达到目标 content shape。
```

新增 `memory-quality-contract` rubric：

```txt
semantic_prepare:
- bad pending becomes reviewable
- good pending remains stable
- new pending is shaped before review
- distillation preview improves without creating pending
- no active mutation
- no pending inflation
```

验证命令：

```bash
npm test -- tests/codex-memory-prepare-v1-4-acceptance.test.ts tests/semantic-rewrite.test.ts tests/semantic-boundaries.test.ts tests/codex-memory-prepare.test.ts tests/codex-memory-distill.test.ts tests/codex-memory-review.test.ts tests/codex-ui-static.test.ts tests/codex-ui-api.test.ts tests/memory-quality-contract.test.ts
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
git diff --check
```

## Open Risks

- Deterministic shaping may be too conservative for nuanced Chinese implementation notes. LLM can help, but only after deterministic eligibility and validator checks.
- Boundary enrichment may still be generic if evidence refs are weak. In that case the system should mark source/boundary review blockers instead of inventing specificity.
- Controlled content replacement changes review hash. Receipts and UI lineage are required so reviewers understand why a hash changed.
- If creation shaping rewrites too aggressively, it can distort user intent. The builder should only normalize structure and remove implementation/session phrasing; it must not infer new rules beyond the input evidence.

## Implementation Notes

Likely files:

```txt
src/codex/semantic-content-builder.ts
src/codex/semantic-boundaries.ts
src/codex/semantic-rewrite.ts
src/codex/semantic-rewrite-validator.ts
src/codex/codex-memory-prepare.ts
src/codex/codex-cli.ts
src/codex/codex-ui-api.ts
src/ui/static/app.js
src/memory/types.ts
src/memory/memory-store.ts
src/codex/memory-distill.ts
src/codex/memory-propose.ts
src/codex/admission-pipeline.ts
src/codex/memory-review.ts
src/codex/memory-quality-contract.ts
```

Shared files should be owned carefully during implementation. UI/source changes must be followed by `npm run build:plugin` and plugin validation.
