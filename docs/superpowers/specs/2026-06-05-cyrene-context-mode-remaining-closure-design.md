# Cyrene Context Mode Remaining Closure Design

Date: 2026-06-05
Status: Draft

## 背景

`2026-06-05-cyrene-context-mode-lightweight-runtime-design.md` 已经落地了
context mode、fast summary、session-hints store、MCP tool 注册、runtime metrics
和 SQLite/JSONL fallback 的大部分基础。但对照
`/Users/phoenix/Downloads/cyrene_remaining_update_plan.md` 后，当前 `main` 仍有几类
不符合预期的行为：

- `balanced` mode 仍没有读取 full profile projection。
- `review` mode 默认仍会查询 similar-project hints。
- 没有 automatic mode router；当前只有 explicit mode、env mode 和默认 `fast`。
- `session-hints` 只有 replace/read/clear/TTL store，没有自动生成或刷新路径。
- README MCP tools 列表没有完全覆盖实际注册 tools。
- fast summary refresh 只覆盖 global projection，缺少 manual refresh 和 stale 标记语义。
- daily/weekly automation 只检查 SQLite index health，没有 rebuild/maintenance 路由。
- 质量检测覆盖不完整，且部分测试锁住了与新目标相反的默认值。

本 spec 定义剩余补齐目标，避免继续用旧测试和旧文档把未完成行为误判为完成。

## 当前实现基线

当前基线以本地 `main` HEAD `26a4dfa` 为准。该提交比 `origin/main` 超前 1 个提交，主要补了
JSONL fallback policy。

已满足或基本满足：

- `plugin/skills/cyrene-continuity/SKILL.md` 已删除“pending 存在就立即 review”的普通路径规则，并说明
  fast/balanced 不展示 pending。
- `fast` 默认不读 pending notice/details、不查 similar-project hints、不返回 diagnostics、不写
  `retrieved` activation event。
- `cyrene_memory_feedback` 和 `cyrene_memory_automation_run` 已在 MCP server 和 built plugin runtime 中注册。
- `session-hints` store 已支持 replace、read、clear、TTL expiry、session/project mismatch 隔离。
- `cyrene_continuity_get` 不在 read path 生成 fast summary；summary 文件缺失时返回 empty projection。
- continuity read path 会记录 `continuity_get` runtime metrics，包括 latency、JSONL fallback 和 stale index。
- stale/unavailable SQLite index 不在 hot path rebuild；JSONL fallback 默认禁用，只能通过 policy 显式启用。

未满足或反向实现：

- `src/codex/context-policy.ts` 中 `balanced.includeFullProfile` 仍为 `false`。
- `src/codex/context-policy.ts` 中 `review.includeSimilarProjectHints` 仍为 `true`。
- `buildRetrievalPolicy()` 只执行 `explicit > env > default fast`，没有 `automatic mode inference`。
- `src/codex/codex-hook-trace.ts` 只在 `session_start` 清空 `session-hints`，没有重建。
- README MCP tools 列表缺少实际注册的 `cyrene_memory_active_archive`、
  `cyrene_memory_active_tombstone`、`cyrene_memory_active_propose_edit`、
  `cyrene_memory_active_supersede`。
- fast summary refresh 没有 manual refresh command，也没有 `profile/core updated -> mark stale`。
- daily/weekly automation 未触发 `memory db rebuild` 或把 rebuild 纳入 maintenance result。

## 目标

1. 让 `balanced` 使用 full profile projection 作为主要 profile 来源。
2. 让 `review` 默认不查询 similar-project hints，除非调用场景显式需要。
3. 新增 automatic mode router，并保持 explicit args 和 env 的优先级。
4. 补齐 `session-hints` 生成、刷新、清空重建和过期失效路径。
5. 让 MCP tools 文档列表与实际 `src/mcp/mcp-server.ts` 注册一致。
6. 补齐 fast summary maintenance：manual refresh、stale 标记、profile/core 更新后的 projection 状态。
7. 明确 SQLite index rebuild 只能在 daily/weekly automation 或 manual maintenance 中发生，不进入 hot path。
8. 补齐测试和 eval/verification 矩阵，移除当前反向默认值断言。

## 非目标

- 不改变 pending review hash 校验模型。
- 不让 pending candidates 进入 active memory、fast summary、profile projection 或 session hints。
- 不让 similar-project hints 自动写入当前项目 memory。
- 不改变 `trial -> validated -> project_core/global_core` lifecycle tier 语义。
- 不直接编辑 generated plugin runtime；涉及 MCP/Skill runtime 时更新 source 后执行 `npm run build:plugin`。
- 不把 JSONL 从 source of truth 位置移除；SQLite/FTS 只做 hot path index。

## Mode Policy

### 优先级

`ContextMode` resolution 必须按以下顺序：

```txt
explicit MCP/CLI args > environment variables > automatic mode inference > default fast
```

显式参数包括：

- MCP `cyrene_continuity_get.mode`
- CLI `codex memory context-preview --mode`
- 显式 include flags，例如 `includePendingDetails`、`includeDiagnostics`、
  `includeSimilarProjectHints`

环境变量包括：

- `CYRENE_CONTEXT_MODE`
- `CYRENE_CONTEXT_INCLUDE_PENDING_DETAILS`
- `CYRENE_CONTEXT_INCLUDE_PENDING_NOTICE`
- `CYRENE_CONTEXT_INCLUDE_DIAGNOSTICS`
- `CYRENE_CONTEXT_INCLUDE_SIMILAR_PROJECT_HINTS`
- `CYRENE_CONTEXT_INCLUDE_SESSION_HINTS`
- `CYRENE_CONTEXT_INCLUDE_FULL_PROFILE`
- `CYRENE_CONTEXT_INCLUDE_FAST_SUMMARIES`
- `CYRENE_CONTEXT_RECORD_RETRIEVED_EVENTS`
- `CYRENE_CONTEXT_ALLOW_JSONL_FALLBACK`

### Automatic Mode Router

当没有 explicit mode 且没有 `CYRENE_CONTEXT_MODE` 时，router 根据 `task`、`userMessage` 和显式 flags
推断 mode：

- ordinary coding、small bugfix、local edit、routine command lookup -> `fast`
- planning、architecture、deep debugging、code review、repository review、historical decision lookup -> `balanced`
- memory review、pending approve/reject/edit/defer、automation、profile review、manual maintenance -> `review`

显式 include flags 可以提升 mode，但不能绕过 safety boundary：

- `includePendingDetails` 或 `includePendingNotice` 为 `true` 时，mode 至少为 `review`。
- `includeDiagnostics` 为 `true` 时，mode 至少为 `balanced`，pending diagnostics 仍要求 `review`。
- `includeSimilarProjectHints` 为 `true` 时，可以在 `balanced` 或 `review` 返回 similar hints，但仍受
  similar hint boundary gate 约束。

默认兜底仍是 `fast`。

## Balanced Profile Policy

`balanced` 必须读取 full profile projection：

- global `MODEL_PROFILE.md`
- current project `MODEL_PROFILE.md`

`balanced` 不使用 fast summary 作为主要 profile 来源。fast summary 只允许作为缺失 full profile 时的
empty-safe fallback，不得覆盖已存在的 full profile。

`balanced` 不读取：

- pending content
- pending count
- pending notice
- review hash
- diagnostics，除非 explicit flag 开启

验收要求：

- `buildRetrievalPolicy({ mode: 'balanced' }).includeFullProfile === true`
- `buildRetrievalPolicy({ mode: 'balanced' }).includeFastSummaries === false`
- `getCodexContinuityContext({ mode: 'balanced' })` 返回 full profile content。
- balanced 输出中 `pendingReview` 为 `{}`，`reviewReminders` 和 `pendingHypotheses` 为空。

## Review Similar-Hints Policy

`review` 默认不查询 similar-project hints。similar hints 只在以下场景启用：

- project start
- planning
- 用户明确询问类似项目、可迁移经验、cross-project precedent
- 当前项目 active memory 很少，需要 transferable session guidance
- daily/weekly automation 或 manual maintenance 明确需要分析相似项目
- explicit `includeSimilarProjectHints: true`

返回 similar hints 时必须保持：

- `transferable: true`
- `notCurrentProjectFact: true`
- 不进入 `memory.items`
- 不进入 `profile`
- 不进入 `trial`、`validated`、`project_core`、`global_core`
- 不写入当前项目 memory
- 若要成为当前项目 memory，必须有当前项目证据或走 pending review 流程

验收要求：

- `buildRetrievalPolicy({ mode: 'review' }).includeSimilarProjectHints === false`
- `getCodexContinuityContext({ mode: 'review' })` 默认 `similarProjectHints` 为空。
- `getCodexContinuityContext({ mode: 'review', includeSimilarProjectHints: true })` 才查询 similar hints。
- similar hints 不参与 activation、profile、fast summary、current project active memory。

## Session-Hints Generation

`session-hints` 是 session-local transferable guidance summary，不是 memory。

### Store Contract

已有 store contract 保留：

- 使用 replace，不使用 append。
- 只保存摘要，不保存 raw memory。
- 不写入 `index.jsonl`、`semantic_memories.jsonl`、`review_queue.jsonl`。
- session/project mismatch 返回空。
- TTL expired 返回空。
- project switch 或 new session 清空旧 hints。

### Generation Paths

新增生成路径：

1. `SessionStart` / project start
   - 清空旧 hints。
   - 若当前项目 active memory 很少，生成新的 session-hints。
2. planning / architecture / deep debugging
   - 进入 `balanced` 后可以刷新 session-hints。
3. explicit similar request
   - 用户明确询问类似项目时刷新 session-hints。
4. project switch
   - 清空旧 project hints。
   - 识别新 project 后按 project start 规则重建。
5. TTL expired
   - read path 返回空。
   - 下次 eligible generation path 可重新生成。

### Generation Source

生成只允许读取 eligible similar-project active memory：

- `portability` 为 `similar_project` 或 `project_family`
- 非 personal / relationship / affective
- 通过 `similar_hint_eval`
- 摘要压缩到 session-local guidance

禁止：

- 迁移 other-project memory。
- 把 similar hint 当 current-project fact。
- 将 hint 写入 pending/active/core/profile。
- 保存 raw evidence、raw transcript、absolute path、secret-like value。

## Fast Summary Maintenance

fast summary 是 projection，不是 memory。

### Source

`global_fast_summary` 只来自 confirmed active global/core memory，且必须排除：

- pending
- trial
- similar-project hints
- assistant-observed-only inference
- high-risk / ambiguous / personal / relationship / affective content
- 未确认推断

`profile_fast_summary` 只来自 full profile projection 的安全压缩结果。

### Refresh Paths

必须支持：

- daily automation refresh
- weekly automation refresh
- manual refresh command
- profile/core 更新后 mark stale
- stale summary 在下一次 daily/weekly/manual maintenance 中刷新

`cyrene_continuity_get` 只读取 summary，不生成 summary，不修复 stale summary。
summary 不存在时跳过，不报错。

### Stale Semantics

新增或完善 `fast_summary_meta.json`：

```json
{
  "generatedAt": "2026-06-05T00:00:00.000Z",
  "stale": false,
  "staleReason": "profile_updated",
  "sourceLatestAt": "2026-06-05T00:00:00.000Z"
}
```

当 active profile/core 更新、active memory archive/tombstone/supersede 或 lifecycle promotion 改变
model-visible memory 时，应 mark stale 或直接 refresh。

## SQLite / JSONL Fallback And Maintenance

Hot path:

- `cyrene_continuity_get` 优先 SQLite/FTS。
- SQLite unavailable/stale 时默认不读 JSONL fallback；只有 policy 显式启用时才 fallback。
- JSONL fallback 必须在 diagnostics 和 runtime metrics 中记录。
- stale index 必须在 diagnostics 和 runtime metrics 中记录。
- hot path 不 rebuild DB。

Maintenance path:

- manual command `codex memory db rebuild` 继续保留。
- daily/weekly automation 可以执行 index health check。
- 若 daily/weekly 要 rebuild，必须在 maintenance phase 执行，并记录结果；不能在
  `getCodexContinuityContext()` 内触发。

需要补齐 metrics：

- `continuity_get latency`
- SQLite query latency
- JSONL fallback
- index stale
- db rebuild
- runtime token overhead

## MCP Tools Documentation Contract

README MCP tools 列表必须与 `src/mcp/mcp-server.ts` 注册工具一致。

当前实际注册工具包括：

- `cyrene_project_identify`
- `cyrene_continuity_get`
- `cyrene_memory_propose`
- `cyrene_memory_harvest_project`
- `cyrene_memory_feedback`
- `cyrene_memory_pending_list`
- `cyrene_memory_pending_get`
- `cyrene_memory_promote`
- `cyrene_memory_reject`
- `cyrene_memory_edit`
- `cyrene_memory_defer`
- `cyrene_memory_active_archive`
- `cyrene_memory_active_tombstone`
- `cyrene_memory_active_propose_edit`
- `cyrene_memory_active_supersede`
- `cyrene_memory_automation_run`
- `cyrene_memory_profile_get`

验收要求：

- README 列表无缺项。
- README 不列 CLI-only command 作为 MCP tool。
- tests 通过 fresh MCP server 验证 tools list。
- tests 通过 built plugin runtime 验证 tools list。

## Test Matrix

必须新增或更新以下测试。

### Context Policy

- default ordinary read -> `fast`
- explicit mode 优先 env
- env mode 优先 automatic inference
- automatic ordinary coding -> `fast`
- automatic planning / architecture / code review -> `balanced`
- automatic memory review / automation / pending action -> `review`
- `balanced.includeFullProfile === true`
- `review.includeSimilarProjectHints === false`
- explicit `includeSimilarProjectHints` 可覆盖 mode default

### Continuity Context

- `fast` 不读 pending。
- `fast` 不返回 pending count。
- `fast` 不返回 pending notice。
- `fast` 不返回 pending content。
- `balanced` 不读 pending。
- `balanced` 不返回 pending count。
- `balanced` 不返回 pending notice。
- `balanced` 读取 full profile projection。
- `fast` 只读取 fast summary projection。
- `review` 才读取 pending details。
- `review` 默认不查 similar-project hints。
- explicit similar request 才返回 similar hints。
- `cyrene_continuity_get` 不生成 fast summary。
- `retrieved` activation event 默认关闭。

### Session-Hints

- replace，不 append。
- 不进入 memory files。
- session/project mismatch 返回空。
- TTL expired 返回空。
- `SessionStart` 清空并按 eligible 条件重建。
- planning/explicit similar request 刷新。
- project switch 清空并重建。

### Fast Summary

- daily refresh `global_fast_summary` / `profile_fast_summary`。
- weekly refresh summary。
- manual refresh 生成 summary。
- profile/core 更新后 stale。
- stale summary 不由 `cyrene_continuity_get` 修复。
- pending/similar/unconfirmed inference 不进入 summary。

### MCP / Runtime

- `cyrene_memory_feedback` 已注册。
- `cyrene_memory_automation_run` 已注册。
- active memory MCP tools 全部在 README 中列出。
- README MCP list 与 actual registry 一致。
- built plugin runtime tools list 与 source server 一致。

### SQLite / JSONL

- fresh SQLite index 使用 SQLite route。
- stale index 默认不读 JSONL fallback。
- JSONL fallback 显式启用时才读 JSONL。
- hot path 不 rebuild stale index。
- runtime metrics 记录 `jsonlFallback`、`indexStale`、latency。
- manual db rebuild 记录结果。

## Verification

文档-only 变更：

```bash
git diff --check
```

实现变更后最低验证：

```bash
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
npm run dev -- codex eval run --check similar-hints
npm run dev -- codex eval run --check release
```

若新增独立 eval command，应补：

```bash
npm run dev -- codex eval run --check context-mode
npm run dev -- codex eval run --check memory-routing
npm run dev -- codex eval run --check pending-boundary
npm run dev -- codex eval run --check activation-events
```

在这些 command 不存在前，对应验收必须由 named test files 覆盖，并在 release note 或 plan completion
中列明替代关系。

## Implementation Ownership

建议用 multi-agent 分配，但每个 agent 只负责独立边界，避免互相改同一文件：

- Policy Agent: `src/codex/context-policy.ts`、`tests/codex-context-policy.test.ts`
- Context Agent: `src/codex/continuity-context.ts`、`tests/codex-continuity-context.test.ts`
- Session Agent: `src/codex/session-hints.ts`、hook/session tests
- Maintenance Agent: fast summary、SQLite rebuild/metrics、daily/weekly tests
- Docs/MCP Agent: README、Skill、MCP registry consistency tests、plugin rebuild

合并前由 coordinator 统一跑完整 verification，检查 generated runtime、README registry 和 tests 是否一致。
