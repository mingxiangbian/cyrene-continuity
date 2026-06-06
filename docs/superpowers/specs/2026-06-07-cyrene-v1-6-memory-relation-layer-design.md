# Cyrene v1.6 Memory Relation Layer Design

Date: 2026-06-07
Status: User-approved design draft

## 背景

v1.5 已经把 Cyrene memory 收敛到 `trial -> validated -> project_core`、`global_core`、review queue、daily / weekly automation、activation feedback、context mode 和 benchmark gate。但当前 memory node 之间的关系仍然是零散的：

- `SemanticMemory.supersedes` 和 pending `conflictsWith` 只能表达局部关系。
- SQLite index 已有 `memory_edges`，但它现在主要是从 evidence trace 派生的 file edge，属于可重建 projection，不是 durable source-of-truth。
- retrieval planner 已经有 `includeGraphNeighbors` 和 `edge:*` explanation 的入口，但缺少 validated memory-to-memory relation layer。
- profile projection 仍主要看单条 core memory，无法利用“旧 memory 被新 memory supersede”“某条 warning 支持当前任务”等关系。
- automation 能处理 trial / validated / core lifecycle，但还没有稳定处理 duplicate edge、conflict edge、derived edge、transfer edge 和 edge stale cleanup。

v1.6 要实现 `/Users/phoenix/Downloads/cyrene_memory_upgrade_plan.md` 中的完整 P0-P2：core memory association layer、retrieval / automation integration、relation-aware evaluation。它不是知识图谱产品化，也不是 MCP/SDK/dashboard 扩展。

## 目标

1. 新增 durable memory-to-memory relation layer，让 `supports`、`contradicts`、`supersedes`、`refines`、`derived_from`、`similar_to`、`warns_against`、`transfers_to` 有统一 source-of-truth。
2. 保持 SQLite 作为 hot-path projection，不让 SQLite 成为 relation source-of-truth。
3. 在 memory candidate 进入系统时同步生成 deterministic-safe relation edges，不在热路径调用 LLM。
4. 用 daily automation 补充 deterministic maintenance 和 LLM-assisted relation hints；无模型配置时继续 deterministic fallback 并报告 `needs_model_config`。
5. 只让 validated 且安全的 relation edge 影响 retrieval expansion、context-preview 和 profile projection。
6. 保留 v5/v1.5 memory safety model：pending memory 不进入 runtime，高风险或 ambiguous memory 不绕过 explicit approval 和 review-hash validation。
7. 新增 relation-aware benchmark cases，验证 retrieval accuracy、profile pollution、cross-project leakage、supersede handling、derived memory safety 和 token / latency cost。

## 非目标

- 不新增 MCP server tool surface。
- 不做 public SDK、external connectors、dashboard、Web UI 或 multi-user support。
- 不引入 Neo4j、Zep、Graphiti 或 full knowledge graph backend。
- 不把 profile 当 source-of-truth。
- 不让 LLM-generated relation hints 直接影响 runtime、profile、hard constraints 或 checklist。
- 不建立独立 `edge_review_queue` 或 edge review UI。
- 不直接编辑 generated plugin runtime files。
- 不编辑 `REVIEW_REPORT.md`。

## Design Decision Summary

采用 `Durable Edge Store + SQLite Projection`。

```text
SemanticMemory nodes
  + durable MemoryEdge store
  + MemoryEvent receipts
    -> SQLite projection for hot-path retrieval
    -> context-preview explanation
    -> profile projection
    -> daily / weekly automation
```

确认过的关键决策：

- v1.6 spec 覆盖完整 P0-P2，implementation plan 后续再分阶段。
- durable edge store 是 source-of-truth；SQLite `memory_edges` 是 projection。
- relation detection 是 deterministic-first + LLM-assisted review hints。
- 无 LLM provider / model config 时 fail-open：继续 deterministic edge detection / maintenance，报告 `needs_model_config`。
- 新 memory admission 热路径只同步生成 deterministic-safe edges；LLM hints 放到 daily automation 或 explicit preview。
- 不新增人工 edge review；自动 validate 仅限 deterministic low-risk edges 或 operation-backed high-impact edges。

## Architecture

### Source Layer

`SemanticMemory` 继续表示 memory node。v1.6 新增 durable `MemoryEdge` store，建议使用 JSONL file 或 semantic store extension，例如：

```text
memory_edges.jsonl
```

它和 `semantic_memories.jsonl`、`activation_events.jsonl`、`events.jsonl` 一样属于 durable memory data，而不是派生索引。

### Projection Layer

SQLite index 继续负责 hot-path 查询：

- `memories`
- `memory_evidence`
- existing deterministic file trace edges
- projected durable memory-to-memory edges

SQLite rebuild 必须从 durable memory nodes 和 durable edge store 重建，不得丢失 relation lifecycle state。现有 deterministic file trace edges 可以继续作为 index-only edge，但必须和 durable memory-to-memory edges 区分。

### Runtime Layer

Runtime retrieval 先获取 seed memories，再通过 validated edges 做 1-hop expansion。fast / balanced / review mode 的既有边界保持不变：

- pending memory 不进入 fast / balanced active context。
- trial edge 不进入 `memory.items`、hard constraints、checklists 或 profile。
- similar-project relation 只能显示为 transferable guidance，不是 current-project fact。

### Automation Layer

Daily automation 做 edge maintenance，weekly automation 做 relation cluster summary、experience distillation 和 profile refresh。LLM-generated hints 只能生成 `trial` edge 或 diagnostics，不直接 validated。

## Data Model

新增 relation constants：

```ts
type MemoryRelationType =
  | 'supports'
  | 'contradicts'
  | 'supersedes'
  | 'refines'
  | 'derived_from'
  | 'similar_to'
  | 'warns_against'
  | 'transfers_to'

type MemoryEdgeStatus =
  | 'trial'
  | 'validated'
  | 'rejected'
  | 'expired'
  | 'superseded'

type MemoryEdgeOrigin =
  | 'deterministic'
  | 'model'
  | 'operation'

type MemoryEdgeEvidenceKind =
  | 'normalized_key'
  | 'content_hash'
  | 'review_hash'
  | 'activation_feedback'
  | 'distillation_input'
  | 'project_similarity'
  | 'model_hint'
```

新增 durable edge shape：

```ts
interface MemoryEdge {
  id: string
  fromMemoryId: string
  toMemoryId: string
  relationType: MemoryRelationType
  status: MemoryEdgeStatus
  confidence: number
  origin: MemoryEdgeOrigin
  reason: string
  evidenceId?: string
  evidenceKind?: MemoryEdgeEvidenceKind
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
}
```

字段语义：

- `fromMemoryId` 是主动关系源。例如 replacement `supersedes` old memory 时，replacement 是 `fromMemoryId`。
- `toMemoryId` 是关系目标。
- `status` 决定 edge 是否能影响 runtime/profile。
- `origin` 区分 deterministic rule、LLM hint 和 operation-backed receipt。
- `evidenceId` 指向 operation receipt、activation event、distillation input、project similarity receipt 或 model hint receipt。
- `lastUsedAt` 仅在 edge 被 relation-aware retrieval 或 profile projection 实际使用时更新。

## Relation Detection

### Synchronous Candidate Path

当新 memory candidate 进入时，继续先走现有 admission pipeline。之后同步执行 deterministic relation detection：

- `normalizedKey` 精确重复：生成 `similar_to` 或 duplicate relation，默认 `validated` 或用于 merge/drop decision。
- explicit `supersedes` / `conflictsWith` 字段：生成 `supersedes` / `contradicts` trial edge，只有 operation-backed evidence 时 validated。
- hash-checked active supersede receipt：生成 validated `supersedes` edge。
- maintenance dedupe receipt：winner 生成 validated `supersedes` / `similar_to` edge 指向 duplicate。
- shared source evidence / distillation input：生成 trial `derived_from` edge。
- project similarity + transferable portability：生成 trial `transfers_to` edge。

同步路径不调用 LLM，不等待 embedding，不做 expensive scan。它只比较 relevant existing memories，候选集合来自 normalized key、retrieval planner、same source/evidence、same project/global root 和 existing active/pending metadata。

### LLM-Assisted Hints

LLM hints 是模型辅助提出的 relation candidates，不是 active memory，不是 profile rule，也不是 runtime instruction。

LLM hint 可以说：

```text
new memory refines old memory because it narrows the trigger from skill edits to SKILL.md edits
```

但只能写成：

```text
status = trial
origin = model
relationType = refines
confidence = 0.72
evidenceKind = model_hint
```

LLM-generated edge 不得直接：

- 注入 runtime context。
- 更新 profile.static / profile.dynamic。
- supersede old memory。
- promote derived memory。
- 生成 hard constraint 或 checklist。

### Operation-Backed Evidence

明确操作证据指系统已发生可审计、可复现、带 id/hash/receipt 的操作，且该操作本身证明两条 memory 的关系。

算作 operation-backed evidence：

- `supersedeCodexActiveMemory` 或 `cyrene_memory_active_supersede` 成功执行，且有 `contentHash`、`reviewHash`、`candidateId`、old `memoryId`。
- pending duplicate merge 由 `normalizedKey` 精确命中并写入 merge receipt。
- active memory maintenance dedupe 合并重复 active，并为旧 memory 写 `superseded` tombstone。
- activation feedback 明确绑定 `memoryId`、`contentHash`、`activationId`、`evidenceRef`，可生成 `warns_against` 或 conflict diagnostics。
- distillation input 明确列出 `sourceSemanticMemoryIds` 并生成新 trial memory，可生成 `derived_from` trial edge。
- project similarity selector 给出 deterministic similarity score 且 source memory 有 transferable portability，可生成 `transfers_to` trial edge。

不算 operation-backed evidence：

- LLM 判断两条 memory 看起来矛盾。
- token overlap 或 semantic similarity。
- 没有指向具体 memory id/hash 的泛泛用户反馈。
- context-preview 里同时出现过两条 memory。
- automation 推断“可能 supersede”，但没有 hash-checked supersede 或 dedupe receipt。

## Edge Lifecycle

Edge lifecycle：

```text
trial -> validated
trial -> rejected
trial -> expired
validated -> superseded
validated -> expired
```

Rules：

- deterministic low-risk edge 可以由 daily automation validate。
- operation-backed high-impact edge 可以 validate。
- model-only edge 保持 trial 或 diagnostics-only，不能自动影响 runtime/profile。
- missing related memory 时 edge 不扩展，daily 可 mark `expired`。
- 被新 edge 替代时旧 edge mark `superseded`。
- `contradicts`、`supersedes`、`transfers_to`、`derived_from` 属于高影响 relation；validated 前必须有 operation-backed evidence 或低风险 deterministic rule。

Edge status transition 必须写 `MemoryEvent`：

```text
action = audit
reason = relation_edge_validated | relation_edge_rejected | relation_edge_expired | relation_edge_superseded
details = {
  edgeId,
  relationType,
  fromMemoryId,
  toMemoryId,
  beforeStatus,
  afterStatus,
  policyId,
  evidenceId,
  projectionImpact
}
```

## Retrieval Integration

Retrieval flow：

```text
normal retrieval
  -> seed memories
  -> SQLite validated-edge 1-hop expansion
  -> filter unsafe / stale / over-budget related memories
  -> context digest + explanation
```

Defaults：

```text
max_depth = 1
max_related_per_memory = 3
```

Allowed expansion relation types：

```text
supports
supersedes
refines
derived_from
warns_against
transfers_to
```

Filtered：

- `trial`
- `rejected`
- `expired`
- `archived`
- `superseded`
- model-only edge
- unsafe high-impact edge without operation-backed evidence
- related memory that fails `isMemoryEligibleForRetrieval`
- relation crossing project boundary without `transfers_to` and transferable portability

Ranking signals：

- seed memory score
- relation type priority
- memory confidence tier
- edge confidence
- scope match
- recency
- last successful use
- token cost

`contradicts` is not used for ordinary expansion by default. It appears in diagnostics/context-preview unless an operation-backed warning or correction has converted it into a validated `warns_against` relation.

## Context Preview

`memory context-preview` should become relation-aware in review/diagnostic modes:

- show seed retrieved memory。
- show included related memories。
- show relation type、status、confidence、origin、reason。
- show filtered related memories and filter reason。
- show token impact。
- show SQLite / JSONL fallback status。
- show `needs_model_config` when LLM relation hint pass was skipped。

Fast/balanced context must not expose pending review content or trial edge content. Review/diagnostic mode may show trial edge metadata, but trial edge metadata is not active memory.

## Profile Projection

Profile remains projection, never source-of-truth.

Layers：

```text
profile.static:
  stable long-term user facts
  stable preferences
  project core constraints
  validated procedural rules
  validated low-risk relation effects

profile.dynamic:
  recent project state
  recent decisions
  active unresolved issues
  recent validated relation changes

profile.session_hints:
  temporary session-only hints
```

Projection rules：

- core memories can enter `profile.static`。
- validated recent memories can enter `profile.dynamic`。
- trial memories and trial edges can only appear as `session_hints` or diagnostics。
- episodes stay as evidence unless explicitly distilled。
- derived memories cannot enter profile without normal memory validation。
- `contradicts` / `supersedes` / `transfers_to` cannot affect profile unless validated by operation-backed evidence。
- profile projection must record reason and edge ids for relation-derived profile lines。

## Automation

### Daily Automation

Daily automation processes：

- duplicate edges
- stale edges
- conflict edges
- supersede candidates
- unsafe derived memories
- low-confidence relation candidates
- operation-backed relation validation
- deterministic relation cleanup
- optional LLM hint generation

Daily actions：

- validate deterministic low-risk edges。
- validate operation-backed high-impact edges。
- reject unsafe edges。
- expire stale edges。
- mark ambiguous conflict/supersede as diagnostics or trial。
- update confidence and `lastUsedAt`。
- record feedback-derived evidence。
- report `needs_model_config` when LLM hint pass is skipped。

### Weekly Automation

Weekly automation processes：

- relation clusters
- experience distillation
- procedural rule candidates
- core memory clusters
- profile.static refresh
- profile.dynamic cleanup
- similar-project transferable candidates

Weekly actions：

- distill repeated operation-backed experience into `experience_note` candidates。
- promote stable experience_note to procedural_rule candidate only through existing memory lifecycle gates。
- refresh profile projection from validated/core memories and validated relation edges。
- summarize related memory clusters。
- send global/similar-project candidates through existing v1.5 policy; relation edges cannot bypass global core gates。

## Safety And Error Handling

- SQLite unavailable/stale：fallback to durable edge JSONL scan or disable expansion; do not inject stale relation data。
- LLM unavailable：continue deterministic edge maintenance; report `needs_model_config`。
- malformed edge JSONL：fail-closed for affected root relation expansion; report malformed count。
- missing related memory：skip expansion; daily may expire or supersede the edge。
- ambiguous contradiction/supersede：trial or diagnostics only unless operation-backed。
- cross-project transfer：`transfers_to` only becomes similar-project guidance; it does not write current-project memory/profile/session。
- profile pollution guard：exclude trial/model-only/derived-unvalidated edges。
- auditability：every edge validation/rejection/expiration writes a receipt event。
- hot path latency：candidate admission must not wait on model calls or broad graph scans。

## Testing And Evaluation

### Unit And Integration Tests

Add focused tests for：

- edge store read/write/upsert/status transition。
- deterministic relation detection。
- operation-backed validation from active supersede, maintenance dedupe, activation feedback。
- SQLite projection rebuild from durable edge store。
- 1-hop retrieval expansion limit and relation filters。
- stale/superseded related memory suppression。
- relation-aware context-preview explanations。
- profile projection excluding trial/model-only/derived-unvalidated edges。
- JSONL malformed fail-closed behavior。
- LLM unavailable deterministic fallback with `needs_model_config` reporting。

### Benchmark Additions

Add relation-aware cases to the benchmark catalog:

- new memory supersedes old project decision。
- new preference contradicts old preference。
- episode is kept as evidence, not core memory。
- derived memory remains trial。
- retrieved memory activates relevant warning。
- similar-project memory is not used unless transferable。
- profile.static excludes trial edges。
- profile.dynamic updates after validated project change。
- automation rejects unsafe relation。
- operation-backed supersede edge validates without edge review。

### Success Criteria

The upgrade is acceptable only if:

- retrieval accuracy improves or remains stable。
- cross-project leakage does not increase。
- profile pollution decreases or remains zero。
- superseded memories are not injected。
- derived memories do not enter core/profile directly。
- context token cost remains controlled by benchmark thresholds。
- automation does not promote unsafe inferred relations。
- context-preview clearly explains included and filtered relation decisions。

## Implementation Boundary

Files likely to change during implementation:

- `src/memory/types.ts`
- `src/memory/memory-store.ts`
- new relation detector / edge lifecycle helper module under `src/memory/` or `src/codex/`
- `src/memory/memory-index.ts`
- `src/memory/memory-retriever.ts`
- `src/codex/continuity-context.ts`
- `src/codex/memory-context-preview.ts`
- `src/codex/memory-lifecycle-profile.ts`
- `src/codex/codex-memory-lifecycle-daily.ts`
- `src/codex/codex-memory-lifecycle-weekly.ts`
- `benchmark/types.ts`
- benchmark case catalog / scorer / report tests

Generated plugin runtime files are not edited directly. If future implementation changes `plugin/skills/cyrene-continuity/SKILL.md`, run `npm run build:plugin` and plugin validation per `AGENTS.md`; this design does not require that skill change.

## Execution Model

This is a non-trivial spec/plan and future implementation should use an explicit multi-agent execution model when the plan is written.

Parallelizable work:

- Edge store and type foundation。
- Deterministic relation detector and edge lifecycle helper。
- SQLite projection and retrieval expansion。
- Daily / weekly automation integration。
- Relation-aware benchmark cases。

Dependencies:

- Retrieval, automation, profile projection, and benchmark implementation all depend on the edge data contract.
- SQLite projection depends on durable edge store APIs.
- Profile projection depends on validated edge semantics and safety filters.
- Benchmark implementation can start with contract cases but final scorer assertions depend on runtime integration.

Conflict risks:

- `memory-store.ts` and `memory-index.ts` are shared write hotspots and should have clear ownership.
- `continuity-context.ts` already contains retrieval/index/preview glue; relation expansion should be implemented through small helpers rather than a broad inline rewrite.
- Existing `SemanticMemory.supersedes` and pending `conflictsWith` should be bridged into edges without deleting them until compatibility is proven.

Verification roles:

- Type/data-contract owner verifies `npm run typecheck` and relation unit tests.
- Retrieval owner verifies context-preview and runtime output, not only internal tests.
- Automation owner verifies daily/weekly dry-run and apply receipts.
- Benchmark owner verifies `cyrene-continuity codex benchmark run --profile smoke` and `--profile gate` after relation cases are wired.

## Verification Plan

Documentation-only spec verification:

```text
git diff --check
```

Future implementation verification:

```text
npm run typecheck
npm run test -- tests/<relation-focused-tests>
cyrene-continuity codex benchmark run --profile smoke
cyrene-continuity codex benchmark run --profile gate
```

If skill or plugin runtime source changes in implementation:

```text
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```
