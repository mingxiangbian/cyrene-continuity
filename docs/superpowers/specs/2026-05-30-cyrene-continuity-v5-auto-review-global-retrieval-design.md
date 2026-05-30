# Cyrene Continuity v5 Auto Review, Global Memory, and Multi-Facet Retrieval Design

Date: 2026-05-30
Status: Draft for written review

## 背景

v4 已经把 Cyrene 从被动 memory review system 推进到主动采集阶段：plugin hooks 可以记录 session/project trace，`Stop` hook 可以写 review-safe summaries 和 pending candidates，Web UI 也已经支持单项 pending review action。

新的瓶颈变成：

- active memory 缺少逐条 archive/tombstone/edit/supersede 路径；
- harvester 和 hooks 开始产生大量 pending candidates，人工 review 跟不上；
- global memory 入口主要依赖 profile/interview 或显式 review，长期偏好更新太窄；
- retrieval 仍然以 exact project + similar-project hints 为主，缺少 task intent、memory kind、evidence、graph relation 等 facet；
- pending queue 需要硬预算和自动清理，否则 review surface 会持续膨胀。

本 spec 定义 `Cyrene Continuity v5` 的 umbrella design。v5 的目标不是继续增加采集量，而是让系统会筛选、会分层、会解释，并在严格条件下允许低风险 memory 自动进入 active。

## 关键政策变更

当前仓库文档和 `AGENTS.md` 强调 pending-only review model：active memory promotion 需要 explicit user approval 和 review-hash validation。

v5 有意改变这个 invariant：

```txt
v4 invariant:
  pending -> active always requires per-candidate user approval + reviewHash.

v5 target invariant:
  high-risk or ambiguous memory still requires per-candidate review.
  strict low-risk memory may auto-promote under named policy, caps, eval gates, and audit receipts.
```

这是 v5 的核心产品决策，不是当前 runtime 行为。实现阶段必须先更新 `AGENTS.md`、policy docs、skill docs、eval gates 和 release gate，再启用任何 default-on auto-active write。

## 目标

1. 为 active memory 增加安全 lifecycle：`archive`、`tombstone`、`propose-edit`、`supersede`。
2. 引入 Auto Review / Triage：`auto_drop`、`auto_merge`、`auto_defer`、`recommend`、`auto_promote`、`manual_review`。
3. 允许严格、默认启用、带 cap 的低风险 project/global auto-promotion。
4. 扩展 global memory 入口：explicit global capture、review-derived learning、cross-project pattern mining、project-to-global candidate。
5. 将 retrieval 从 single similarity path 升级为 multi-facet retrieval。
6. 引入 `memory_edges`，让 retrieval 可以利用 file/route/command/source/supersede/semantic relations，并解释召回原因。
7. 对 pending queue 实施 hard budget，通过 triage-before-write 和最低排名 pending eviction 控制 bloat。
8. 为后续 multi-agent implementation plan 定义清晰的 phase boundary 和 shared contracts。

## 非目标

- 不实现 hard delete 作为普通 active memory 操作；privacy erase 可以另行设计。
- 不允许 personal / relationship / affective memory 自动 active。
- 不允许 similar-project hint 直接 auto-promote 为 current-project fact。
- 不让 broad conversation inference 直接生成 global active memory。
- 不让 model-assisted semantic edges 未经 review 就影响 retrieval。
- 不把 SQLite 变成唯一 source of truth；JSONL 仍是 audit/recovery source。
- 不在 brainstorming 阶段派发 subagents 或写 implementation code。

## 总体架构

```txt
Signals
  hooks / UI / CLI / review events / project files
        ↓
Pending Candidate Queue
  pending candidates + clusters + scores + evidence
        ↓
Triage Engine
  policy registry + budget manager + eval gates
        ↓
Memory Mutation Layer
  active writes / archive / tombstone / supersede / pending eviction
        ↓
Audit + Index
  JSONL source files + memory events + SQLite/FTS + memory_edges
        ↓
Retrieval
  query planner + facets + graph traversal + explain diagnostics
```

所有 mutation path 必须走同一套 lock/re-read/write/sync 顺序：

1. 获取 memory maintenance lock。
2. 在 lock 内重新读取 active/pending/tombstone/events。
3. 执行 policy/eval/budget checks。
4. 写 JSONL/source files 和 `MemoryEvent` receipt。
5. 同步 SQLite index。
6. 返回 CLI/API/UI receipt。

`continuity_get` 保持 read path：它可以 query index、读取 safe fallback、返回 diagnostics，但不能 rebuild index 或写 memory。

## Shared Contracts

### TriageDecision

```ts
type TriageDecision =
  | { action: 'auto_drop'; candidateId: string; reason: string }
  | { action: 'auto_merge'; candidateIds: string[]; clusterId: string; reason: string }
  | { action: 'auto_defer'; candidateId: string; days: number; reason: string }
  | { action: 'recommend'; candidateId: string; priority: 'normal' | 'high'; reason: string }
  | { action: 'auto_promote'; candidateId: string; policyId: string; reason: string }
  | { action: 'manual_review'; candidateId: string; reason: string }
```

### CandidateCluster

Clusters group repeated pending candidates so the UI does not show the same idea many times.

Cluster keys may use:

- `normalizedKey`;
- `candidateKind`;
- `domain` / `type` / `scope`;
- source/evidence kind;
- week bucket;
- embedding similarity when a safe provider is configured.

Cluster output should preserve member ids and evidence summaries so review remains auditable.

### AutoPromotionPolicy

Auto-promotion policies are named, versioned, and testable:

```txt
low_risk_project_memory_v1
low_risk_global_procedural_v1
review_derived_global_preference_v1
```

Every auto-promote event must include:

- `policyId`;
- thresholds used;
- candidate id and resulting memory id;
- evidence count and distinct evidence count;
- score snapshot;
- cap status;
- eval gate result;
- reason string.

### MemoryEvent Extensions

`MemoryEvent.details` carries v5 metadata without making every event a new top-level schema:

```json
{
  "policyId": "low_risk_project_memory_v1",
  "decision": "auto_promote",
  "thresholds": {
    "sensitivityMax": 0.2,
    "safetyMin": 0.9,
    "evidenceStrengthMin": 0.85
  },
  "budget": {
    "dailyCap": 5,
    "usedToday": 2
  },
  "evalGate": {
    "passed": true,
    "failedChecks": []
  }
}
```

Schema note: review-derived global memory needs an explicit source representation. The implementation plan should either extend `MEMORY_SOURCES` with `review_event`, or keep `source: 'user_explicit' | 'tool_trace'` and represent review provenance through `evidence.sourceKind` plus `MemoryEvent.details`. The choice must be made once and reflected consistently in validators, index rows, and eval tests.

## P0: Active Memory Lifecycle

P0 adds per-active-memory write paths.

### Operations

`archive`

- Sets active memory out of retrieval.
- Writes `MemoryEvent` action `archive` and marks the memory archived.
- Must not create a blocking tombstone record used by candidate validation.
- Does not block future candidates with the same normalized key.
- Used when memory is stale or no longer helpful.

`tombstone`

- Removes active memory from retrieval.
- Blocks matching future candidates by `normalizedKey`.
- Default tombstone expires, e.g. 180 days.
- User can explicitly choose indefinite tombstone for "do not recreate this" cases.

`propose-edit`

- Does not modify active memory directly.
- Creates a pending replacement candidate linked to the active memory.
- Replacement still goes through review/triage policy.

`supersede`

- Replaces old active memory with a new active memory.
- Old memory becomes `superseded`.
- Writes tombstone with `replacementMemoryId`.
- Requires conflict-safe lock and index sync.

### API / CLI Shape

Active API shape:

```txt
POST /api/active-memory/:id/archive
POST /api/active-memory/:id/tombstone
POST /api/active-memory/:id/propose-edit
POST /api/active-memory/:id/supersede
```

Requests include:

```json
{
  "contentHash": "current-active-memory-hash",
  "reason": "No longer accurate after v5 triage changes",
  "expiresAt": "2026-11-26T00:00:00.000Z",
  "indefinite": false
}
```

CLI:

```bash
npm run dev -- codex memory active archive <memoryId> --content-hash <hash> --reason <text>
npm run dev -- codex memory active tombstone <memoryId> --content-hash <hash> --days 180 --reason <text>
npm run dev -- codex memory active propose-edit <memoryId> --content-hash <hash> --content <text> --reason <text>
npm run dev -- codex memory active supersede <memoryId> --candidate <candidateId> --content-hash <hash> --reason <text>
```

Web UI adds per-row actions in Project Memory and Global Memory active views.

## P1: Auto Review / Triage

P1 reduces pending review load and introduces strict low-risk auto-promotion.

### Decisions

`auto_drop`

Reject or expire candidates that are clearly not durable memory:

- one-time command status;
- temporary branch/status/test output;
- content too short to be useful;
- duplicate of active memory;
- matches active tombstone;
- expired `open_question` without renewed evidence.

`auto_merge`

Merge repeated candidates into a cluster instead of displaying each one.

`auto_defer`

Delay weak but not worthless candidates, typically 7-14 days.

`recommend`

Put high-value or high-risk candidates at the top of the Inbox.

`auto_promote`

Write active memory automatically only when the relevant policy passes.

### Project Auto-Promotion Policy

`low_risk_project_memory_v1` allows default-on auto-promotion when all conditions pass:

```txt
scope = project
domain in ['project', 'procedural', 'system']
candidateKind in ['project_fact', 'workflow_rule', 'known_pitfall']
source in ['file', 'tool_trace', 'user_explicit']
sensitivity <= 0.2
safety >= 0.9
evidenceStrength >= 0.85
stability >= 0.8
usefulness >= 0.7
seenCount >= 2
distinctEvidenceCount >= 2
no normalizedKey conflict
no active tombstone match
not assistant_observed-only
not similar-project hint
not personal / relationship / affective
```

Default cap:

```txt
CYRENE_AUTO_REVIEW_PROJECT_PROMOTE_PER_DAY=5
```

### Global Auto-Promotion Policy

Global auto-promotion is stricter.

Allowed sources:

- explicit global instruction from user language such as "always", "all projects", "by default", "remember globally";
- repeated review-derived procedural/system preference.

Allowed shape:

```txt
scope = global
domain in ['procedural', 'system']
candidateKind in ['user_instruction', 'workflow_rule']
source in ['user_explicit', 'review_event']
sensitivity <= 0.1
safety >= 0.95
evidenceStrength >= 0.9
stability >= 0.85
distinctEvidenceCount >= 2
no conflict with active global memory
not affective / personal / relationship
```

Default cap:

```txt
CYRENE_AUTO_REVIEW_GLOBAL_PROMOTE_PER_DAY=1
```

### Commands

```bash
npm run dev -- codex memory triage --dry-run
npm run dev -- codex memory triage --apply
npm run dev -- codex memory triage --policy strict
npm run dev -- codex memory triage --policy balanced
```

`strict` is the default runtime policy for active writes. `balanced` may broaden defer/recommend behavior, but must not weaken auto-promotion gates.

## P2: Global Memory Capture

P2 broadens global memory updates without relying only on profile interview.

### Explicit Global Capture

`UserPromptSubmit` / `Stop` can propose global candidates when the user clearly says:

```txt
always ...
for all projects ...
by default ...
remember globally ...
long-term ...
```

These candidates use:

```txt
scope = global
source = user_explicit
candidateKind = user_instruction
```

They may auto-promote only through the stricter global policy.

### Review-Derived Learning

The system mines structured review actions, not vague conversation similarity.

Examples:

- repeated rejects of "ran tests today" -> global candidate: do not treat one-time command results as durable memory;
- repeated edits from vague summaries to workflow rules -> global candidate: project memory should be operational and action-oriented;
- repeated approvals of same procedural pattern across projects -> global candidate: this is a cross-project workflow preference.

Inputs:

- `MemoryEvent` action;
- candidate kind/domain/type/source;
- normalized key;
- review reason/change note;
- candidate scores;
- project id.

Output is a global pending candidate or, only if strict policy passes, global auto-promoted memory.

### Cross-Project Pattern Miner

When similar active memories are approved in multiple projects, the miner can propose a global procedural candidate. It must not infer personal/relationship/affective memory.

### Promote Project Memory To Global

Web UI and CLI provide a project active memory action:

```txt
Promote to global candidate
```

This creates a global pending candidate; it does not mutate global active memory directly unless the stricter global auto-promotion policy passes.

## P3: Multi-Facet Retrieval

P3 upgrades retrieval from exact-project + similar-project into a planner-driven system.

### Query Planner

The planner derives:

```ts
interface RetrievalPlan {
  taskIntent: string[]
  memoryKinds: string[]
  requiredFacets: RetrievalFacet[]
  optionalFacets: RetrievalFacet[]
  excludeDomains: string[]
  includePendingHypotheses: boolean
  includeSimilarHints: boolean
  includeGraphNeighbors: boolean
}
```

Facets:

```txt
exact_project
global_policy
task_intent
memory_kind
evidence
recency
transferability
graph_edges
personal_boundary
```

### Ranking

Ranking should combine:

- exact project match;
- global policy relevance;
- task intent match;
- memory kind match;
- evidence strength;
- usefulness;
- safety;
- recency;
- graph proximity;
- transferability;
- sensitivity penalty;
- pending penalty.

Similar-project hints become one facet, not the primary retrieval path. They remain labeled as hints and never become current-project facts.

### memory_edges

SQLite adds a graph table:

```sql
memory_edges(
  id text primary key,
  from_id text not null,
  from_kind text not null,
  to_id text not null,
  to_kind text not null,
  edge_type text not null,
  weight real not null,
  source text not null,
  status text not null,
  evidence_id text,
  created_at text not null,
  approved_at text
)
```

Deterministic edges write directly:

```txt
memory_mentions_file
memory_about_command
memory_about_route
candidate_from_session
candidate_from_signal
memory_supersedes_memory
memory_replaces_memory
```

Model-assisted semantic edges are proposed for review:

```txt
decision_affects_module
pitfall_caused_by_route
global_pref_derived_from_reviews
memory_related_to_memory
```

Only approved semantic edges affect retrieval ranking.

### Explain Diagnostics

`continuity_get` diagnostics should include:

```json
{
  "retrievalPlan": {
    "taskIntent": ["memory_review", "ui"],
    "requiredFacets": ["exact_project", "memory_kind", "evidence"],
    "optionalFacets": ["graph_edges", "similar_project"]
  },
  "items": [
    {
      "memoryId": "mem_123",
      "score": 0.91,
      "reasons": ["exact_project", "memory_kind:workflow_rule", "edge:memory_about_route"]
    }
  ]
}
```

## P4: Memory Bloat Control

P4 enforces hard pending budgets. Active memory budgets start with warnings and cleanup recommendations; pending queue gets hard enforcement first.

### Pending Budget

Config:

```txt
CYRENE_PENDING_MAX_ITEMS_PROJECT=200
CYRENE_PENDING_MAX_ITEMS_GLOBAL=100
CYRENE_PENDING_PROTECTED_MAX_AGE_DAYS=30
```

Before any pending write:

1. Read current pending count.
2. If under budget, write normally.
3. If over budget, run triage-before-write.
4. If still over budget, rank existing pending plus the new candidate.
5. Evict the lowest-ranked unprotected pending item.
6. Write the new candidate only if it is not the lowest-ranked item.
7. Record a budget eviction/audit event.

This is not silent deletion. The candidate leaves active pending review, but the system keeps an event receipt with enough metadata to explain what happened.

### Protected Pending Candidates

Do not evict automatically:

- explicit user instructions;
- personal / relationship / affective candidates;
- recently edited candidates;
- candidates selected for manual review;
- high-risk candidates that need a human decision;
- candidates with fresh direct user evidence.

### Ranking Signals

Lower-ranked candidates are more evictable:

- low evidence strength;
- low usefulness;
- old and unseen;
- assistant-observed-only;
- duplicate/noisy candidate kind;
- no review interaction;
- eligible for deterministic noise rejection under triage policy;
- weak source quality.

If the new candidate is the lowest-ranked item, it is not written and the event records `budget_rejected_new_candidate`.

## Web UI Changes

### Active Memory Views

Project Memory and Global Memory active rows add:

- `Archive`;
- `Tombstone`;
- `Propose edit`;
- `Supersede`;
- `Promote to global candidate` for project active memory.

High-risk domains hide one-click tombstone/supersede and require explicit confirm text.

### Triage View

Add a Triage page:

```txt
Run triage dry-run
Apply safe triage
Review clusters
Review recommended
Inspect auto-promote receipts
Inspect budget evictions
```

The UI should not provide unsafe batch approval for high-risk candidates.

### Retrieval Explain View

Add diagnostics for:

- facets used;
- edges used;
- similar-project hint status;
- why items were excluded;
- index freshness/degraded mode.

## Error Handling

Recoverable errors:

- stale active `contentHash`;
- stale pending `reviewHash`;
- normalized key conflict;
- tombstone conflict;
- policy denial;
- daily cap exceeded;
- budget eviction protected all candidates;
- semantic edge awaiting review;
- index sync failed after JSONL write.

Index sync failure must not roll back authoritative JSONL writes. The response reports degraded retrieval and suggests `codex memory db rebuild`.

## Eval Gates

v5 extends eval gates with:

```txt
auto_promotion_policy_eval
global_auto_promotion_eval
active_lifecycle_eval
pending_budget_eval
memory_edge_eval
retrieval_explain_eval
```

Release gate must fail if:

- personal/relationship/affective candidate can auto-promote;
- similar-project hint can become current active memory without current evidence;
- global auto-promotion uses broad conversation inference;
- model-assisted semantic edge affects retrieval before approval;
- pending budget enforcement deletes protected candidates;
- `continuity_get` mutates memory or rebuilds index.

## Testing Strategy

### P0 Tests

- archive removes active memory from retrieval but keeps audit.
- expiring tombstone blocks matching candidates until expiry.
- indefinite tombstone blocks until manual removal.
- propose-edit creates pending replacement only.
- supersede writes replacement and tombstones old memory.
- stale `contentHash` returns conflict.

### P1 Tests

- auto_drop rejects one-time command status.
- auto_merge clusters duplicates.
- auto_defer delays weak candidates.
- project low-risk candidate auto-promotes under `low_risk_project_memory_v1`.
- conflicting or assistant-observed-only candidate cannot auto-promote.
- global candidate follows stricter cap and thresholds.
- auto-promote writes event details and syncs index.

### P2 Tests

- explicit global phrase creates global candidate.
- review-derived learning creates candidate from repeated reject/edit events.
- broad conversation inference does not create global active memory.
- project-to-global action creates global pending candidate.

### P3 Tests

- planner identifies task intent and memory kinds.
- retrieval ranking uses exact project, kind, evidence, graph, and sensitivity.
- deterministic edges write directly.
- model-assisted semantic edges require review.
- explain diagnostics include retrieval reasons.
- similar-project hints remain non-current-project facts.

### P4 Tests

- pending write under budget succeeds.
- over-budget write runs triage first.
- if still over budget, lowest-ranked unprotected pending item is evicted.
- protected candidates are not evicted.
- if new candidate is lowest ranked, it is not written.
- budget eviction writes audit receipt.

### Repo Verification

For implementation PRs:

```bash
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
git diff --check
```

Documentation-only changes run:

```bash
git diff --check
```

## Multi-Agent Implementation Model

After this spec is approved and a `writing-plans` implementation plan exists, use a coordinator-led multi-agent model.

Lead coordinator owns:

- shared schema/contracts;
- policy registry;
- eval gate order;
- integration sequence;
- conflict resolution between lanes;
- final verification.

Parallel lanes after shared interfaces freeze:

```txt
Lane A: P0 active lifecycle CLI/API/UI
Lane B: P1 triage engine and auto-promotion policy
Lane C: P2 global capture and review-derived learning
Lane D: P3 query planner, memory_edges, and retrieval explain
Lane E: P4 pending budgets and eviction
Lane F: Web UI integration and visual QA
Lane G: eval gates and cross-lane tests
```

Dependencies:

- P0 lifecycle and event receipts should land before P1 active auto-promotion writes.
- P1 policy registry and event shape should land before P2 global auto-promotion.
- P3 graph schema can start after shared `memory_edges` contract freezes.
- P4 budget manager must integrate with every pending write path before release.
- Eval gates must block release until all mutation paths satisfy v5 policy.

## Success Criteria

- Users can archive/tombstone/edit/supersede active memory from CLI and Web UI.
- Pending queue is grouped, triaged, capped, and no longer grows without bound.
- Strict low-risk project/global auto-promotion works with clear receipts and caps.
- Global memory can be updated from explicit instructions and review behavior.
- Retrieval uses multiple facets and can explain why memory was returned.
- `memory_edges` improves retrieval without unreviewed semantic pollution.
- Pending budget enforcement evicts only lowest-ranked unprotected pending items.
- High-risk memory remains manual.
- Release gate proves `continuity_get` is still read-only.
