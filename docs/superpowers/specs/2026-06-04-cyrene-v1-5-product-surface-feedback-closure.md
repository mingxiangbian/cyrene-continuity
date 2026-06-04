# Cyrene v1.5 Product Surface And Feedback Closure

Date: 2026-06-04
Status: Implemented through plan

## Parallel Review Inputs

本 spec 由 4 个并行 review 视角合并而成：

- Feedback closure：`ActivationEvent` 已有类型和 automation 消费逻辑，但缺少 hash-checked、idempotent、fail-closed 的 public feedback write boundary。
- UI boundary：Web UI 和 API 已有 selection-level scope/root 信息，但 pending/active/lifecycle item 缺 per-item `origin`，用户无法快速判断 root、source 和污染风险。
- Automation surface：MCP/CLI/docs 已基本切到 `Automation`，但 Web UI JSON shape、artifact 文案和 internal state 仍透出 `dream*`。
- Quality gates：下一轮必须以可验收 gates 收口，不能只靠普通测试通过。

## Background

v1.5 已完成 `trial -> validated -> project_core`、`global_core`、daily/weekly automation、中文 tokenizer、Web UI lifecycle inventory、global capture gate 和 public `cyrene_memory_automation_run`。当前版本可作为插件 MVP 使用，但还需要一轮产品面收口，解决三个实际风险：

1. Trial promotion 需要真实 usage feedback 作为燃料，而不是只依赖 retrieved event 或手写测试 fixture。
2. UI 必须让用户一眼看出 memory 属于哪个 root/source/scope，否则无法判断跨项目或 personal/application workflow 污染。
3. Public surface 必须只讲 `Automation`，避免 `Dream` internal legacy 泄漏回用户和 Codex tool 心智。

本轮目标不是重做 memory architecture，而是把 v1.5 产品面和质量门收干净。

## Goals

1. 新增 `cyrene_memory_feedback`，让 Codex/MCP 可以显式记录 `applied|ignored|corrected|violated`。
2. feedback 写入必须 hash-checked、idempotent、fail-closed，并且只允许绑定 active runtime memory。
3. `continuity_get` 的 activation items 必须携带 `contentHash`，供 feedback 调用做 stale write 防护。
4. Web UI/API 对每条 pending/active/lifecycle memory 暴露 per-item `origin` 和 `sourceBoundary`。
5. Lifecycle Memory 列表层显示 `Root`、`Scope`、`Source`、`Tier`、duplicate/pollution warning。
6. exact duplicate 可以在严格边界内自动 merge；near-duplicate、cross-root collision 和 high-risk 内容只做 recommendation/manual review。
7. Public docs、Skill、MCP tool、CLI help、Web UI visible text 和 Web UI JSON shape 不再暴露 `Dream`。
8. 建立 hard gates，能客观证明 feedback、UI boundary、dedupe/pollution 和 Automation surface 达到预期。

## Non-Goals

- 不从 final answer 自动猜测 `applied`。
- 不让 feedback 绕过 low-risk policy、eval gate、daily cap、review hash 或 high-risk manual review。
- 不用 feedback 直接 edit、supersede、archive 或 tombstone memory。
- 不做 global `trial` / `validated`。
- 不把 raw query、完整 transcript、appshot、attachment dump 写入 `activation_events.jsonl`。
- 不做跨 root 自动 merge。
- 不做 LLM semantic merge。
- 不把 `normalizedKey` fallback 伪装成真实 `sourceOfTruth`。
- 不在本轮全仓 rename `memory-dream*` internal files，也不迁移用户已有 `dream-state.json`、`dream-preview/`、`.locks/dream.lock`。
- 不直接编辑 `plugin/runtime/cyrene-continuity.mjs`；runtime 只能由 source rebuild 生成。

## Current Facts

### Feedback

已有：

- `ActivationEventType` 包含 `retrieved|activated|applied|ignored|corrected|violated|stale`。
- `src/codex/memory-feedback.ts` 有 fail-open helper，能写 activation event，并把 raw query 哈希成 `queryHash`。
- `continuity_get` 自动记录 retrieved event。
- daily automation 已消费 `applied/corrected/violated`：Trial 至少需要两个 `applied`，任意 `corrected|violated` 阻断 promotion。
- weekly automation 已消费 distinct applied context 和 negative feedback。
- active memory mutation 已有 `contentHashForActiveMemory()` 作为 stale write 防护。

缺口：

- 没有 public `cyrene_memory_feedback` tool。
- 没有 CLI `memory feedback`。
- `MemoryActivation` payload 缺 `contentHash`。
- feedback 写入没有 idempotency，重复 `applied` 可能误触发 promotion。
- feedback 写入没有 fail-closed validation，可能错误绑定 pending、archived、changed memory。
- `ignored` 暂时不应促进 promotion，只能作为 neutral cleanup signal。

### UI Boundary

已有：

- API 已支持 `scope=project|global|all`，selection-level 有 `memoryRoot`、`memoryRoots`、`globalMemoryRoot`、`projectMemoryRoot`。
- Manual Review detail 已显示 `Scope`、`Domain`、`Source of truth`、`Evidence ref`、`Source`。
- memory 数据有 `scope`、`source`、`sourceOfTruth`、`evidence`、`confidenceTier`。

缺口：

- per-item active/pending/lifecycle payload 缺 `origin`，root attribution 在 flatMap roots 后丢失。
- Lifecycle Memory row 主要显示 content、kind/time、tier，缺 row-level root/source/project badge。
- UI 只暴露 `project/global` selector，不显示 `all`，但 API 支持 `all`，grouping 对 `all` 的 global_core 可见性需要 gate。
- duplicate 目前主要是 exact normalized key；near-duplicate 和 cross-root collision 缺可见性。

### Automation Surface

已有：

- README、Skill、plugin manifest 已主要使用 `Automation`。
- MCP public tool 是 `cyrene_memory_automation_run`。
- CLI 已支持 `codex memory automation --job daily|weekly`。
- tests 已断言 `cyrene_memory_dream_run` 不出现在 MCP tool list。

缺口：

- Web UI `/api/automation` 和 `/api/dashboard` 仍可能返回 `dreamDue`、`lastDreamAt`、`nextDreamDueAt`、`lastDreamStatus` 这类 field。
- `src/ui/static/app.js` 仍可能读 `dream*` field，虽然 visible text 是 Automation。
- `dream-artifacts.ts`、state/error/report 文案可能把 `codex memory dream`、`DREAM_REPORT`、`dream-preview` 暴露给用户。
- internal `memory-dream*`、`CYRENE_MEMORY_DREAM_*` 可以暂留，但必须被 public boundary adapter 隔离。

## Design

### 1. Usage Feedback Closure

新增 fail-closed API：

```ts
recordCodexMemoryFeedback(input): Promise<CodexMemoryFeedbackResult>
```

现有 `appendActivationEventFailOpen()` 保留给 retrieval 自动日志，不作为 public feedback write boundary。

#### MCP Tool

新增 tool：

```txt
cyrene_memory_feedback
```

MCP schema 不接受 `cwd`。handler 使用 MCP server fallback cwd，与现有 MCP 工具边界保持一致。

输入：

```ts
{
  memoryId: string
  contentHash: string
  event: 'applied' | 'ignored' | 'corrected' | 'violated'
  activationId?: string
  evidenceRef?: string
  query?: string
  reason?: string
  idempotencyKey?: string
}
```

约束：

- `corrected|violated` 必须有 `reason`。
- `applied` 必须有 `evidenceRef` 或 `query`，否则 weekly distinct context 会退化为时间戳，不可验收。
- `query` 只用于计算 `queryHash`，不得落 raw query。
- `reason` 必须长度封顶，并经过 `redactReviewText()` 或等价 redaction。
- 只允许对 active runtime memory 写 feedback。pending、review_queue、archived、tombstoned、missing memory 都不能写。
- handler 必须重新读取 current project root 和 global root，按 `memoryId` 定位 memory，并比较 `contentHash`。
- `contentHash` mismatch 返回 `conflict`，不写 event。
- 写入必须 idempotent。优先使用 caller 提供的 `idempotencyKey`；否则基于 `memoryId:event:evidenceRef|activationId|queryHash` 派生。
- 已存在同 idempotency key 或同 context 的 event 时返回 `duplicate`，不追加事件。
- 写入应使用 memory maintenance lock 或等价 root-level lock，避免与 daily/weekly apply 并发竞态。

#### CLI

新增 CLI：

```bash
cyrene-continuity codex memory feedback <memoryId> \
  --content-hash <hash> \
  --event applied|ignored|corrected|violated \
  [--activation-id <id>] \
  [--evidence-ref <ref>] \
  [--query <text>] \
  [--reason <text>]
```

CLI 输出 JSON：

```ts
{
  action: 'memory_feedback'
  memoryRoot: string
  project: { projectId: string; displayName: string }
  result:
    | { action: 'recorded'; eventId: string; memoryId: string; event: string; queryHash?: string; idempotencyKey: string }
    | { action: 'duplicate'; eventId: string; memoryId: string; event: string; idempotencyKey: string }
    | { action: 'not_found'; reason: string }
    | { action: 'conflict'; reason: 'Active memory changed since review' }
    | { action: 'invalid_request'; reason: string }
}
```

#### Activation Payload

`continuity_get.activation.workflowHints|planConstraints|checklistItems` must include:

```ts
contentHash: string
```

The hash should reuse `contentHashForActiveMemory()` semantics so active review and feedback share stale-write protection.

#### Event Semantics

- `applied`：正向证据。可推动 daily `trial -> validated` 和 weekly `validated -> project_core`，但仍受 low-risk、caps、eval gates 约束。
- `ignored`：中性证据。不得促进 promotion。`ignored >= 3 && applied == 0` 可生成 “repeatedly ignored” recommendation，不自动删除。
- `corrected`：负向边界信号。阻断 auto-promotion，生成 review recommendation，不直接 edit/supersede。
- `violated`：负向执行信号。阻断 auto-promotion，生成 review recommendation，不直接 tombstone/archive。

### 2. UI Origin And Source Boundary

API 给每条 pending/active/lifecycle memory 增加 view-only `origin`：

```ts
{
  rootScope: 'project' | 'global'
  memoryRoot: string
  projectId?: string
  projectDisplayName?: string
  selectionScope: 'project' | 'global' | 'all'
  declaredScope: 'project' | 'global' | 'session'
  rootLabel: string
}
```

`origin` 不写入 memory store，只在 UI/API projection 生成。

API 给每条 memory 增加 `sourceBoundary`：

```ts
{
  sourceOfTruth?: string
  sourceKind?: string
  evidenceRefs: string[]
  status: 'explicit' | 'evidence_trace' | 'missing' | 'fallback_normalized_key'
}
```

规则：

- 有非 fallback `sourceOfTruth` 时，显示为 `explicit`。
- 有 structured evidence refs 时，显示为 `evidence_trace`，并把普通 `source` 暴露为 `sourceKind`。
- 只有 `normalizedKey` 时，不得显示成真实 `sourceOfTruth`；必须标为 `fallback_normalized_key`。
- source missing 时列表层显示 warning，不静默隐藏。

#### List Badges

Manual Review row 和 Lifecycle Memory row 至少显示：

- `Root: Project|Global`
- project displayName + short `projectId`，detail 显示 full `memoryRoot`
- `Scope: project|global`
- `Source: file|tool_trace|user_explicit|review_event|...`
- `Tier: Trial|Validated|Project Core|Global Core`
- duplicate/pollution warning badge

#### Detail Metadata

详情层新增 `Storage / Origin` 区块：

- `declaredScope`
- `rootScope`
- `projectId`
- `memoryRoot`
- `source`
- `sourceOfTruth`
- `evidenceRefs`
- `normalizedKey`
- `confidenceTier`
- `activationPolicy.allowedModes`

### 3. Duplicate And Pollution Boundaries

新增 UI/API warning flags：

```ts
type MemoryBoundaryFlag =
  | 'scope_root_mismatch'
  | 'global_project_specific_source'
  | 'project_personal_domain'
  | 'missing_source_boundary'
  | 'cross_root_normalized_key_collision'
  | 'active_pending_collision'
  | 'same_key_mixed_metadata'
```

这些 flags 只影响 UI warning 和 review recommendation，不直接 mutate memory。

#### Auto Merge Allowed

只允许自动 merge 满足全部条件的 pending duplicates：

- 同一 `memoryRoot`
- 同一 `normalizedKey`
- 同一 `candidateKind`
- 同一 `scope`
- 同一或兼容 `domain/type/sourceOfTruth`
- 非 `personal|relationship|affective`
- 无 `conflictsWith`
- 非 high-risk

重复 evidence 使用现有 `evidenceIdentity` dedupe，不重复累计。

#### Manual Review Only

以下情况只生成 recommendation，不自动 merge：

- near-duplicate
- cross-root collision
- global/project mixed metadata
- 不同 `sourceOfTruth`
- mixed `candidateKind`
- active overlap
- high-risk domain
- personal/application workflow 污染嫌疑

### 4. Automation Public Surface Closure

Public contract 只讲 `Automation`：

- README
- `plugin/skills/cyrene-continuity/SKILL.md`
- plugin manifest
- MCP tool names/descriptions
- CLI help
- Web UI visible text
- Web UI JSON response shape

不得恢复：

```txt
cyrene_memory_dream_run
codex memory dream --stage ...
```

Web UI API 应返回 automation shape：

```ts
automation: {
  due: boolean
  nextRunAt?: string
  lastRunAt?: string
  status?: 'success' | 'skipped' | 'failed'
  error?: string
}
```

旧 `dream-state.json` 可继续由 internal adapter 读取，但不得把 `dreamDue`、`lastDreamAt`、`nextDreamDueAt` 透传到 browser/API public payload。

`codex memory lifecycle daily|weekly` 可保留一轮 compatibility alias，但主 usage、README、Skill 应只推荐：

```bash
cyrene-continuity codex memory automation --job daily --dry-run
cyrene-continuity codex memory automation --job weekly --dry-run
```

`dream-artifacts.ts` 里的用户可见提示必须改成 automation/report 语义，不得提示 `codex memory dream`。

## Acceptance Gates

### Hard Gate 1: Feedback Contract

Required tests:

- `tests/codex-memory-feedback.test.ts`
- `tests/mcp-server.test.ts`
- `tests/codex-cli.test.ts`
- `tests/codex-continuity-context.test.ts`
- `tests/codex-memory-lifecycle-daily.test.ts`
- `tests/codex-memory-lifecycle-weekly.test.ts`

Must prove:

- `recordCodexMemoryFeedback` records all four public events.
- `corrected|violated` without `reason` is rejected.
- `applied` without `evidenceRef` or `query` is rejected.
- `contentHash` mismatch returns `conflict` and writes no event.
- pending/archived/tombstoned/missing memory cannot receive feedback.
- duplicate idempotency key or duplicate context returns `duplicate` and does not append.
- `query` only persists as `queryHash`; raw query is absent from `activation_events.jsonl`.
- `cyrene_memory_feedback` exists in source MCP server and built plugin runtime tool list.
- MCP schema does not expose `cwd`.
- CLI usage includes `memory feedback`.
- new feedback API can drive daily promotion when two valid `applied` events exist.
- `ignored` alone does not promote.
- `corrected|violated` blocks daily and weekly promotion.

Focused command:

```bash
npm run test -- tests/codex-memory-feedback.test.ts tests/mcp-server.test.ts tests/codex-cli.test.ts tests/codex-continuity-context.test.ts tests/codex-memory-lifecycle-daily.test.ts tests/codex-memory-lifecycle-weekly.test.ts
```

### Hard Gate 2: UI Origin / Boundary Visibility

Required tests:

- `tests/codex-ui-api.test.ts`
- `tests/codex-ui-assets.test.ts`
- `tests/codex-ui-static.test.ts`
- `tests/codex-ui-server.test.ts`

Must prove:

- `/api/dashboard?scope=project|global|all` gives every pending/active/lifecycle item an `origin`.
- `origin.rootScope` and `origin.memoryRoot` are per-item, not only selection-level.
- project items include `origin.projectId`.
- global items do not masquerade as project root items.
- `scope_root_mismatch` appears when a project-scoped memory is stored under global root.
- `scope=all` grouping includes `Global Core`, `Trial`, `Validated`, and `Project Core` without losing global_core.
- source UI asset and generated static bundle contain labels for `Root`, `Project ID`, `Source`, `Source of truth`, `Duplicate`, `Scope mismatch`.
- Lifecycle row shows root/source/tier badges, not only tier.
- API/server tests still do not expose API keys.

Focused command:

```bash
npm run test -- tests/codex-ui-api.test.ts tests/codex-ui-assets.test.ts tests/codex-ui-static.test.ts tests/codex-ui-server.test.ts
```

### Hard Gate 3: Duplicate / Pollution

Required tests:

- `tests/codex-memory-propose.test.ts`
- `tests/codex-memory-triage.test.ts`
- `tests/codex-triage-apply.test.ts`
- `tests/memory-quality-contract.test.ts`

Must prove:

- Trial candidate without explicit/evidence-trace source boundary does not enter Trial.
- Trial candidate with valid `sourceOfTruth` or evidence trace preserves boundary metadata.
- same-root exact duplicate low-risk `workflow_rule|known_pitfall` can auto merge.
- cross-root duplicate, different `sourceOfTruth`, mixed `candidateKind`, high-risk domain, and personal/relationship/affective content only produce recommendation/manual review.
- apply does not mutate files for manual-review-only duplicate recommendations.
- duplicate evidence does not inflate evidence count.

Focused command:

```bash
npm run test -- tests/codex-memory-propose.test.ts tests/codex-memory-triage.test.ts tests/codex-triage-apply.test.ts tests/memory-quality-contract.test.ts
```

### Hard Gate 4: Automation Public Surface

Required tests/checks:

- `tests/mcp-server.test.ts`
- `tests/codex-cli.test.ts`
- `tests/codex-ui-api.test.ts`
- `tests/codex-ui-static.test.ts`
- `tests/plugin-runtime.test.ts`

Must prove:

- MCP `listTools` includes `cyrene_memory_automation_run`.
- MCP `listTools` does not include `cyrene_memory_dream_run`.
- CLI supports `memory automation --job daily|weekly`.
- CLI usage does not recommend `codex memory dream`.
- Web UI API returns `automation.due|nextRunAt|lastRunAt|status|error`, not `dreamDue|nextDreamDueAt|lastDreamAt|lastDreamStatus`.
- `src/ui/static/app.js` does not read `dreamDue`.
- Public docs/Skill/plugin manifest do not mention `Dream` as a user-facing concept.
- `dream-artifacts.ts` user-facing instructions do not mention `codex memory dream`.

Static check should use an explicit allowlist for internal legacy files:

```txt
Allowed internal legacy:
src/codex/memory-dream.ts
src/codex/memory-dream-state.ts
src/codex/dream-artifacts.ts
src/codex/dream-proposal.ts
tests/codex-memory-dream.test.ts
src/config.ts CYRENE_MEMORY_DREAM_* compatibility env names
```

Focused command:

```bash
npm run test -- tests/mcp-server.test.ts tests/codex-cli.test.ts tests/codex-ui-api.test.ts tests/codex-ui-static.test.ts tests/plugin-runtime.test.ts
```

### Hard Gate 5: Release Verification

Every implementation PR for this spec must pass:

```bash
npm run typecheck
npm run build:plugin
npm test
git diff --check
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
npm run dev -- codex eval run --check release
```

Release eval must return:

```json
{
  "passed": true,
  "failedChecks": []
}
```

If a change edits `plugin/skills/cyrene-continuity/SKILL.md`, `npm run build:plugin` and plugin validator are mandatory before completion.

### Soft Gate: Local UI Smoke

Before final merge, run:

```bash
npm run dev -- codex ui --port 0
```

Manual smoke should confirm:

- scope switch works for Project and Global.
- Lifecycle Memory rows visibly show Root/Scope/Source/Tier.
- pollution/duplicate badges are visible in seeded fixture rows.
- no API key or raw query appears in the UI.

This smoke gate is useful but should not depend on external network, real API key, provider availability, or current wall-clock time.

## PR Decomposition

### PR 1: Feedback Boundary

Scope:

- `recordCodexMemoryFeedback`
- `cyrene_memory_feedback`
- CLI `memory feedback`
- activation `contentHash`
- feedback tests

This is P0 and should land first because automation promotion quality depends on it.

### PR 2: UI Origin / Source Boundary

Scope:

- per-item `origin`
- `sourceBoundary`
- list badges
- detail metadata
- scope/root mismatch flags
- UI/API/static tests

This is P0 because it makes memory pollution visible to the user.

### PR 3: Duplicate / Pollution Recommendations

Scope:

- exact duplicate auto merge boundary
- near-duplicate/cross-root/high-risk manual recommendation
- source boundary admission guard for Trial
- triage/quality tests

This is P1 and should not auto merge cross-root or high-risk content.

### PR 4: Automation Surface Cleanup

Scope:

- Web UI API automation shape
- public grep/static tests
- artifact/report public wording
- docs/Skill cleanup if needed

This is P1. Internal `memory-dream*` rename remains a later debt unless public leakage persists.

## Final Acceptance Checklist

- `cyrene_memory_feedback` exists and is safe to call from Codex.
- feedback cannot be recorded against changed, pending, archived, tombstoned, or missing memory.
- duplicate feedback cannot inflate `applied` count.
- raw query never lands in `activation_events.jsonl`.
- daily/weekly promotion uses feedback but still respects low-risk policy and eval gates.
- Lifecycle UI makes root/source/scope visible without opening a detail card.
- cross-root or personal/application workflow pollution is visible as warning, not silently mixed into Trial.
- exact same-root low-risk duplicates can merge; near-duplicates and high-risk cases remain manual.
- public surface says Automation, not Dream.
- all hard gates pass without real API key, external network, real provider calls, or current-date assumptions.
