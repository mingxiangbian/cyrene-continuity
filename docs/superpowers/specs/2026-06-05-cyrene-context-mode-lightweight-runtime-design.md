# Cyrene Context Mode Lightweight Runtime Design

Date: 2026-06-05
Status: User-approved design

## 背景

当前 `cyrene_continuity_get` 同时承担 active memory retrieval、pending
review notice、similar-project hints、profile 读取、diagnostics、activation
event 记录和 response strategy construction。这个模型让普通 coding 请求也会接触
review queue、similar project retrieval 和较重的诊断路径，导致日常运行路径偏重。

本设计把 Cyrene 的日常 runtime context 和 memory governance 路径分开：

- 普通 coding 默认轻量、低打扰、低 token overhead。
- planning、复杂 debugging、code review 可以读取更完整但仍不打扰的 context。
- memory review、daily/weekly automation、UI review 才进入 pending、review hash、
  lifecycle evidence 和 diagnostics。

当前关键代码落点：

- `src/codex/continuity-context.ts`
- `src/codex/memory-context-preview.ts`
- `src/mcp/tools/continuity-get.ts`
- `src/codex/codex-cli.ts`
- `plugin/skills/cyrene-continuity/SKILL.md`
- `tests/codex-continuity-context.test.ts`
- `tests/codex-cli.test.ts`
- `tests/codex-memory-feedback.test.ts`

## 目标

1. 新增 `ContextMode`，用显式 mode 控制 runtime context construction 的读取策略。
2. 默认 `fast` mode，让普通 coding 不读取 pending、不查询 similar-project hints、不写
   `retrieved` activation event。
3. 保留 `balanced` mode，用于项目开始、架构规划、复杂 debugging、code review 和用户询问历史决策。
4. 保留 `review` mode，用于 memory review、daily/weekly automation、UI review、profile
   review 和 pending approve/reject/edit/defer。
5. 把 pending review 从普通 hot path 移出。pending 是 review queue，不是 active memory。
6. 把 similar-project hints 从普通 hot path 移出。similar hints 是 transferable guidance，不是
   current-project fact。
7. 用 `session-hints` 保存当前 session 的相似项目提示摘要，但不迁移 memory。
8. 用预生成 `global_fast_summary` 和 `profile_fast_summary` 支撑 fast mode。
9. 默认不记录 `retrieved` activation event，只记录明确反馈或实际使用事件。
10. 让 SQLite/FTS 成为 runtime hot path；JSONL 继续作为 audit/recovery/rebuild source of truth。
11. 增加 mode contract tests、Skill 文档断言和性能监控目标。

## 非目标

- 不改变 v5/v1.5 memory review hash 模型。
- 不改变 `trial -> validated -> core` lifecycle tier 语义。
- 不让 pending candidates 自动进入 active context。
- 不让 similar-project hints 自动写入当前项目 memory。
- 不让 daily/weekly automation 自动批准高风险、ambiguous、personal、affective、
  relationship、profile-impacting 或 global/core-impacting memory。
- 不直接编辑 generated plugin runtime 文件；涉及 Skill/runtime 变更时更新 source 并 rebuild。
- 不把本设计写成逐步 implementation plan。implementation plan 另行生成。

## Context Mode

新增三种 mode：

```ts
type ContextMode = 'fast' | 'balanced' | 'review'
```

`ContextMode` 不改变 memory tier，不负责 promotion，也不改变 review hash 校验。它只控制一次
runtime context construction 可以读取什么、返回什么、记录什么。

## Retrieval Policy

所有读取分支先归一到 `RetrievalPolicy`：

```ts
interface RetrievalPolicy {
  mode: ContextMode
  maxTokens: number
  includePendingDetails: boolean
  includePendingNotice: boolean
  includeDiagnostics: boolean
  includeSimilarProjectHints: boolean
  includeSessionHints: boolean
  includeFullProfile: boolean
  includeFastSummaries: boolean
  recordRetrievedEvents: boolean
  allowJsonlFallback: boolean
  allowHotPathIndexRebuild: false
}
```

优先级：

```txt
explicit tool/CLI args > environment variables > mode defaults
```

默认值：

- `mode`: `fast`
- `includePendingDetails`: `false`
- `includePendingNotice`: `false`
- `includeDiagnostics`: `false`
- `includeSimilarProjectHints`: `false`
- `recordRetrievedEvents`: `false`
- `allowHotPathIndexRebuild`: `false`

后续代码只看 policy，不在各处散落判断 `task`、flag 或调用场景。

## Fast Mode

用于普通 coding、普通 debugging、小修改和连续开发中的大部分请求。

读取：

- 当前项目 active memory。
- 预生成 `global_fast_summary`。
- 预生成 `profile_fast_summary`。

不读取：

- pending 内容。
- pending count。
- pending notice。
- similar-project hints。
- diagnostics。
- review hash。
- 完整 profile。
- 原始 global memory 大库。

要求：

- 默认 mode 为 `fast`。
- 普通 coding token overhead 控制在 600-800 tokens。
- 不写入 `retrieved` activation event。
- `pendingReview`、`reviewReminders`、`pendingHypotheses` 返回 safe empty/omitted shape。
- `similarProjectHints` 返回空数组。

## Balanced Mode

用于项目开始、架构规划、复杂 debugging、code review、用户询问历史决策或类似项目经验。

读取：

- 当前项目 active memory。
- global/profile 的较完整摘要。
- 当前 session 中已有的 `session-hints`。

可选读取：

- similar-project hints。

不读取：

- pending 内容。
- pending count。
- pending notice。
- review hash。

要求：

- 不打断用户处理 pending review。
- 不输出 pending 提醒。
- token overhead 控制在 1000-1200 tokens。
- similar hints 只在显式参数、project start、planning、用户询问类似项目经验或当前项目 active
  memory 很少时触发。

## Review Mode

用于 memory review、daily automation、weekly automation、UI review、profile review、
pending approve/reject/edit/defer。

读取：

- pending candidates。
- review hash。
- diagnostics。
- lifecycle evidence。
- profile candidates。
- automation recommendations。

要求：

- 只有 `review` mode 可以展示 pending 内容。
- pending 操作必须保持 review hash 校验。
- daily/weekly automation 负责集中处理 pending review。
- review mode 可以返回完整 diagnostics 和 lifecycle evidence。

## Runtime Data Flow

`cyrene_continuity_get` 的新流程分成四层：

1. `Input Resolution`
   解析 `mode`、显式 include flags、env defaults、task intent。
2. `Policy Build`
   通过 `buildRetrievalPolicy({ mode, task, flags })` 生成唯一 policy。
3. `Data Fetch`
   按 policy 读取 active memory、summary、profile、pending、similar、diagnostics。
4. `Response Projection`
   按 policy 收缩输出对象，确保 fast/balanced 不暴露 review queue。

输出兼容策略：

- 可以保留既有字段，但 fast/balanced 必须返回 safe empty/omitted shape。
- `pendingReview` 在 fast/balanced 不含 `count`、`hasItems`、`newestPreview`。
- `reviewReminders` 在 fast/balanced 永远为空。
- `pendingHypotheses` 在 fast/balanced 永远为空。
- `diagnostics` 只在 policy 允许时返回。
- `activation` 只从 active runtime memory 构建，不从 pending 或 similar hints 构建。

## Pending Review Boundary

普通运行路径不处理 pending。

需要修改：

- `fast` 不读取 pending 内容。
- `fast` 不返回 pending count/notice。
- `balanced` 不读取 pending 内容。
- `balanced` 不返回 pending count/notice。
- `plugin/skills/cyrene-continuity/SKILL.md` 删除或改写“有 pending 就立即
  pending_list/pending_get 并要求 approve/reject”的规则。

pending 只在以下场景处理：

- daily automation。
- weekly automation。
- UI review。
- 用户明确要求 review memory。
- 用户明确要求处理 pending candidate。

pending 是 review queue，不是 active memory。pending 不能作为 factual context，不能进入
`workflowHints`、`planConstraints`、`checklistItems` 或 profile projection。

## Similar-Project Hints Boundary

similar-project hints 从普通 hot path 移出。

只在以下场景运行：

- `SessionStart` / project start。
- planning。
- 用户明确询问类似项目经验。
- 当前项目 active memory 很少。
- daily/weekly automation 需要分析相似项目时。

禁止：

- 普通 coding 每次查询 similar-project hints。
- fast mode 查询 similar-project hints。
- `PostToolUse` 查询 similar-project hints。
- 将 similar-project hints 自动写入当前项目 memory。

规则：

- similar-project hints 只作为 transferable guidance。
- similar-project hints 不能作为 current-project fact。
- similar-project hints 不能自动进入 trial、validated 或 core。
- 若要成为当前项目 memory，必须有当前项目证据或进入 review 流程。

## Session Hints

新增 session-local hints，用于保存当前会话中的相似项目提示。

要求：

- `session-hints` 不是 memory。
- `session-hints` 不进入 active memory。
- `session-hints` 不迁移其他项目 memory。
- `session-hints` 只保存摘要，不保存完整相似项目 memory。
- 每次刷新使用 replace，不使用 append。
- session 结束、TTL 到期或项目切换时失效。

更新时机：

- `SessionStart`。
- project start。
- 用户明确请求 similar-project hints。
- 当前项目 memory 很少时。
- 项目切换时清空并重建。

## Fast Summary Artifacts

fast mode 不直接读取完整 global memory 或完整 profile。

新增两个预生成摘要：

- `global_fast_summary`
- `profile_fast_summary`

生成方式：

- 由 daily/weekly automation 生成。
- 只从 active memory 和确认过的 profile 提取。
- 排除 pending、trial 噪声、临时状态、similar-project hints、未确认推断。
- summary 是 runtime projection，不是新的 source of truth。

`global_fast_summary` 只包含：

- 跨项目稳定开发规则。
- 长期工具习惯。
- 全局安全边界。
- 通用 workflow 偏好。

`profile_fast_summary` 只包含：

- 长期回答风格偏好。
- coding 协作偏好。
- 与当前 agent 行为直接相关的用户偏好。

目标：

- `global_fast_summary` 控制在 200 tokens 内。
- `profile_fast_summary` 控制在 150 tokens 内。

## Activation Events

默认不记录：

- `retrieved`

保留：

- `applied`
- `ignored`
- `corrected`
- `violated`
- `stale`

要求：

- `cyrene_continuity_get` 默认不写 `retrieved` event。
- 只有明确反馈或实际使用时才记录 feedback event。
- feedback event 可用于 daily/weekly lifecycle 判断。
- 不把 `retrieved` 当作 strong evidence。
- activation event 不是 memory，不进入 active context。

## SQLite And JSONL

运行时检索优先使用 SQLite/FTS。

职责划分：

- `memory.db`: runtime hot path retrieval。
- JSONL: audit/recovery/rebuild source of truth。
- Markdown profile: human/model readable projection。

要求：

- `cyrene_continuity_get` 不在 hot path 扫 JSONL，除非 policy 允许 degraded fallback。
- index stale 时不在 hot path rebuild。
- index stale 时返回 degraded context。
- db rebuild 放到 daily/weekly automation 或 manual maintenance。
- 记录 JSONL fallback 和 index stale 情况。

## CLI And MCP Parameters

为 `cyrene_continuity_get` 和 `memory context-preview` 增加运行参数：

- `mode`
- `includeSimilarProjectHints`
- `includePendingDetails`
- `includeDiagnostics`
- `recordRetrievedEvents`
- `maxTokens`

参数优先级：

```txt
explicit parameter > environment variable > mode default
```

默认：

- `mode=fast`
- `includeSimilarProjectHints=false`
- `includePendingDetails=false`
- `includeDiagnostics=false`
- `recordRetrievedEvents=false`

`context-preview` 可以显式使用 `--mode review` 做调试和 review visibility。普通 preview 默认不应造成
activation side effect。

## Skill And Docs Updates

`plugin/skills/cyrene-continuity/SKILL.md` 必须改写：

- 删除 pending 存在时立即展示并要求用户 approve/reject 的规则。
- 新增 pending 是 review queue，不是 active memory。
- 新增 pending 不能作为 factual context。
- 新增 fast/balanced 不展示 pending 内容。
- 新增 fast/balanced 不输出 pending count 或 notice。
- 新增 review mode 才处理 pending。
- 新增 similar-project hints 不是 current-project fact。
- 新增 session-hints 不是 memory migration。
- 新增 activation event 不是 memory。

如果修改 `plugin/skills/cyrene-continuity/SKILL.md`，必须运行：

```sh
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

## Daily And Weekly Automation

daily automation 负责：

- pending review 汇总。
- 新增 pending candidates 展示。
- 低风险 trial -> validated 推进。
- index health 检查。
- `global_fast_summary` 更新。
- `profile_fast_summary` 更新。

weekly automation 负责：

- validated -> project_core 候选。
- global_core 候选。
- stale memory 检查。
- 重复 memory 合并建议。
- 长期 profile summary 更新。

要求：

- 不自动批准高风险 pending。
- 不自动迁移 similar-project hints。
- 不绕过 review hash。
- 自动化输出 recommendation 和 receipt，但不伪装成用户 review。

## Performance Metrics

新增性能记录。

至少记录：

- `continuity_get` latency。
- SQLite query latency。
- similar query latency。
- pending query latency。
- profile read latency。
- token overhead。
- JSONL fallback rate。
- index stale rate。
- hook latency。

目标：

- `continuity_get` p95 < 250ms。
- `UserPromptSubmit` p95 < 50ms。
- `PostToolUse` p95 < 50ms。
- 普通 coding token overhead < 800。
- JSONL fallback rate < 1%。

## Multi-Agent Workstreams

multi-agent 作为实现 workstream 架构，不作为 runtime dependency。

### Runtime Agent

职责：

- `ContextMode`。
- `RetrievalPolicy`。
- `cyrene_continuity_get`。
- MCP/CLI 参数。
- mode default 和 env override。

验收：

- fast/balanced/review 输出 contract 测试通过。
- fast 默认不读取 pending、不查 similar、不写 `retrieved`。

### Memory Governance Agent

职责：

- pending/review hash 边界。
- activation event 默认行为。
- similar-project hints transferable boundary。
- session-hints 不迁移 memory。

验收：

- pending 不能进入 active context。
- similar hints 不能写入当前项目 memory。
- review hash 校验保持不变。

### Automation Agent

职责：

- daily/weekly summary。
- index health。
- fallback/stale recording。
- fast summary freshness。

验收：

- summary 只从允许来源生成。
- stale/fallback 有可审计记录。
- automation 不绕过高风险 review。

### Testing Agent

职责：

- mode contract tests。
- CLI/MCP schema tests。
- Skill doc assertions。
- regression tests。
- performance instrumentation smoke tests。

验收：

- 每个 mode 有明确 positive/negative tests。
- 旧 pending notice assumptions 被替换为 mode-specific assertions。

### Docs/Skill Agent

职责：

- `SKILL.md`。
- README。
- release notes。
- command examples。
- terminology consistency。

验收：

- 文档不再要求普通请求立即 review pending。
- docs 明确 fast/balanced/review 边界。
- generated runtime 通过 source rebuild 更新。

### Coordinator

职责：

- 维护 `RetrievalPolicy` contract。
- 串行合并 cross-workstream changes。
- 去重测试和文档。
- 执行最终 verification。

串行边界：

1. 先定 `ContextMode` 和 `RetrievalPolicy` 类型。
2. 再并行推进 runtime、governance、automation、tests、docs。
3. 最后由 coordinator 做 integration、build、typecheck、eval 和 release note。

## Test Matrix

新增或调整测试：

- fast 不读取 pending。
- fast 不返回 pending count/notice。
- fast 不返回 pending hypotheses。
- fast 不查询 similar-project hints。
- fast 不写 `retrieved` event。
- fast 使用 `global_fast_summary` / `profile_fast_summary`。
- fast 不读完整 profile。
- balanced 不返回 pending count/notice。
- balanced 不展示 pending 内容。
- balanced 只在条件满足时读取 similar-project hints。
- review 可以读取 pending details。
- pending 操作保持 review hash 校验。
- pending 不进入 active context。
- pending 不进入 activation。
- similar-project hints 不写入当前项目 memory。
- session-hints replace 而不是 append。
- SQLite/FTS 是默认 hot path。
- JSONL fallback 被记录。
- index stale 不触发 hot path rebuild。
- `SKILL.md` 不再强制 pending review。
- CLI/MCP 参数优先级正确。
- context-preview 可以用 `--mode review` 显示 review diagnostics。

## Acceptance Criteria

完成后应满足：

- 普通 coding 默认 `fast`。
- `fast` 不读取 pending。
- `fast` 不返回 pending count/notice。
- `fast` 不查 similar-project hints。
- `fast` 不写 `retrieved` activation event。
- `balanced` 不返回 pending count/notice。
- `balanced` 只在必要时使用 session-hints 或 similar-project hints。
- `review` 才展示 pending candidates。
- daily automation 负责 pending review 汇总。
- similar-project hints 不自动迁移。
- session-hints 不进入 memory。
- SQLite/FTS 是 hot path。
- JSONL fallback 被监控。
- Skill 不再打断用户处理 pending。
- performance metrics 能区分 SQLite、similar、pending、profile 和 hook latency。

## Compatibility And Migration

兼容风险：

- 现有 tests 和 MCP clients 可能依赖 `pendingReview.count`。
- 现有 context-preview 可能依赖 pending exclusions。
- 现有 activation tests 可能默认期望 `retrieved` event。

迁移策略：

- 输出对象保留字段名，但 fast/balanced 返回 safe empty/omitted shape。
- review mode 保留 pending visibility。
- CLI/MCP 文档明确 `--mode review` 才能看到 pending details。
- release notes 标明 `retrieved` 不再默认记录。
- tests 从全局断言改为 mode-specific assertions。

## Risks

### 诊断能力下降

fast 不暴露 pending/similar 会让临时调试信息减少。解决方式是使用
`memory context-preview --mode review`、Web UI review console 或 explicit review request。

### Summary Stale

fast summary 由 automation 生成，可能滞后。解决方式是返回 summary freshness，并让
daily/weekly automation 维护。

### Similar Hints Misuse

similar hints 可能被误当作当前项目事实。解决方式是 `session-hints` 类型边界、eval gate、
response projection 和 tests。

### Multi-Agent Conflict

多个 workstream 可能修改同一 contract。解决方式是 coordinator 先冻结
`RetrievalPolicy` contract，再允许并行实现，最终统一集成。

### JSONL Fallback Ambiguity

如果完全禁止 JSONL fallback，stale index 场景可能返回过少 context；如果允许 fallback，
hot path 又可能变重。设计选择是 policy-controlled degraded fallback，并记录 fallback/stale
diagnostic，不在 hot path rebuild。

## Verification For This Spec

文档-only 变更需要运行：

```sh
git diff --check
```

本 spec 不进入 implementation plan。implementation plan 必须在用户 review 该 spec 后单独生成。
