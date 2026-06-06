# Cyrene Benchmark Eval System Design

Date: 2026-06-05
Status: User-approved design

## 背景

Cyrene 已经有一批分散的 eval gate 和 unit tests，覆盖 memory routing、similar-project hints、pending review、profile pollution、context mode、SQLite/FTS index、activation feedback 和 lifecycle policy。但这些测试还没有形成一个统一的 benchmark 系统，无法稳定回答：

- 当前 release 是否满足 Cyrene 的核心边界设计。
- memory 是否真的提升 agent 行动质量。
- 大规模 memory 下 runtime 是否仍然轻。
- failure、security、hook、CLI/MCP/Skill surface 是否一致。
- 回归是否能被结构化报告捕捉。

本设计定义一个完整的 `benchmark` 子系统。它复用现有实现模块作为 scorer/helper，但用统一 runner、fixture、case contract 和 report 把 Cyrene 的机制级 eval 串成可重复执行的 benchmark。

## 目标

1. 建立完整 benchmark/eval 系统，评估 Cyrene 的 memory ability、boundary safety、task utility、runtime efficiency 和 scale stability。
2. 用统一 case catalog 描述所有 benchmark case；所有 case 都必须写入 spec，不用 P0/P1/P2 或 deferred phase 分层。
3. 支持多种 execution profile：`smoke`、`gate`、`full`、`scale`、`real-replay`、`llm`、`external`。profile 只决定运行方式，不决定 case 是否存在。
4. 生成 `benchmark_report.json` 和 `benchmark_report.md`，包含 pass/fail、失败证据、指标、scale 结果、metric aggregation provenance 和 regression comparison。
5. 将关键 deterministic safety case 接入 release gate，同时保留 `full`、`scale`、`real-replay`、`llm`、`external` 的完整运行入口。
6. 让 multi-agent 可以按 case pack 并行实现，且共享 contract 明确、写入边界清楚。

## 非目标

- 不直接跑完整 LoCoMo、LongMemEval、BEAM、MemoryArena、STATE-Bench 或 Mem0 benchmark。
- 不把真实 LLM/agent runs 放进默认 CI gate。
- 不替换现有 Vitest unit tests；benchmark 负责端到端机制组合和报告。
- 不改变 v5/v1.5 memory review hash、pending queue、trial/validated/core lifecycle 语义。
- 不改变 fast/balanced/review mode 的产品语义。
- 不直接编辑 generated plugin runtime 文件；涉及 Skill/runtime 变更时仍然更新 source 并 rebuild。

## 设计原则

- **完整 catalog**：所有 case 都写入 spec，并有 fixture、action、expected、forbidden、metrics、pass/fail rule。
- **确定性优先**：`smoke` 和 CI gate 默认跑 deterministic case；LLM/agent case 必须有单独 profile，避免 flakiness 污染 release gate。
- **复用现有规则**：scorer 优先复用 `src/eval/eval-runner.ts`、`src/codex/continuity-context.ts`、`src/codex/memory-review.ts`、`src/codex/memory-propose.ts`、`src/memory/memory-index.ts` 等现有 contract。
- **黑盒与白盒结合**：CLI/MCP/Skill consistency 使用 surface-level assertions；routing、lifecycle、index consistency 可以直接调用 helper 做精确检查。
- **报告不可省略**：未运行 case 只能显示为 `skipped_with_reason` 或 `not_supported_without_provider`，不能从 report 消失。

## 目录结构

新增：

```text
benchmark/
  fixtures/
    tier0-release-gate/
    tier1-memory-ability/
    tier1-5-lifecycle/
    tier1-6-core-mechanisms/
    tier2-memory-to-action/
    tier3-scale-efficiency/
    tier4-failure-security/
  cases/
    tier0-release-gate.ts
    tier1-memory-ability.ts
    tier1-5-lifecycle.ts
    tier1-6-core-mechanisms.ts
    tier2-memory-to-action.ts
    tier3-scale-efficiency.ts
    tier4-failure-security.ts
  runner.ts
  scorer.ts
  report.ts
  types.ts
```

CLI 入口：

```text
cyrene-continuity codex benchmark run --profile smoke
cyrene-continuity codex benchmark run --profile gate
cyrene-continuity codex benchmark run --profile full
cyrene-continuity codex benchmark run --profile scale
cyrene-continuity codex benchmark run --profile real-replay
cyrene-continuity codex benchmark run --profile llm
cyrene-continuity codex benchmark run --profile external
```

默认输出：

```text
benchmark_report.json
benchmark_report.md
```

## Execution Profiles

`executionProfiles` 是 case 的运行标签，不是实现阶段。

- `smoke`：最快 sanity profile。只跑少量 deterministic contract checks，验证 benchmark runner、fixture isolation、report generation 和最关键 context boundary 可以工作。
- `gate`：release gate 默认运行。只包含 deterministic、稳定、成本低、边界关键的 case。
- `full`：本地完整 deterministic/replay benchmark。包含 gate 外的能力、lifecycle、failure recovery、hook 和 replay case。
- `scale`：运行 S/M/L/XL scale fixture 和 efficiency metrics。
- `real-replay`：运行真实 repo material 的 deterministic replay task utility eval。
- `llm`：运行 provider-backed LLM/agent adapter case；缺少 provider env 时报告为 `not_supported_without_provider`，不能被解读为已完成全部 live LLM 对照。
- `external`：运行 Claude Code memory、Hermes memory、Mem0、Zep 等外部对照。

报告必须列出所有 case。未被当前 profile 运行的 case 标为 `skipped_with_reason`，缺少 provider/account/tool 的 case 标为 `not_supported_without_provider`。

## Case Contract

每个 benchmark case 必须满足：

```ts
interface BenchmarkCase {
  id: string
  tier: 'tier0' | 'tier1' | 'tier1_5' | 'tier1_6' | 'tier2' | 'tier3' | 'tier4'
  title: string
  executionProfiles: Array<'smoke' | 'gate' | 'full' | 'scale' | 'real-replay' | 'llm' | 'external'>
  fixture: BenchmarkFixtureSpec
  action: BenchmarkActionSpec
  expected: BenchmarkExpectedSpec
  forbidden: BenchmarkForbiddenSpec
  metrics: BenchmarkMetricSpec[]
  passFail: BenchmarkPassFailRule[]
  adapter?: BenchmarkAdapterSpec
}
```

每个 fixture 必须包含：

- `isolation`
- `clock`
- `seed`
- `groundTruth`
- `expectedContext`
- `expectedForbiddenContent`
- `expectedMode`
- `expectedMetrics`
- `passFailRule`

fixture 可以 seed：

- active project/global memory
- pending review queue
- similar-project memory
- session-hints
- full profile projection
- fast summary projection
- activation events
- lifecycle events
- semantic JSONL
- SQLite/FTS index
- hook traces
- CLI/MCP input/output snapshots
- transcript/action replay logs

## Fixture Isolation And Determinism

Fixture isolation 是硬规则，不是实现细节。

每个 case 必须：

- 使用独立 temp `HOME`、temp project root、temp global memory root、temp project memory root 和独立 SQLite `memory.db`。
- 禁止读取或写入用户真实 `~/.cyrene`、真实 repo memory root、真实 plugin runtime state。
- 禁止复用其他 case 的 SQLite db、JSONL files、profile projection、fast summary、session-hints 或 hook trace。
- 在 report 中记录 fixture root、seed、clock、cleanup status。
- case 结束后清理 temp root；如果为了 debug 保留，必须显式标记 `preserveFixture=true` 且 report 写出原因。

Fixture isolation 失败属于 hard failure：

- case 写到 fixture root 之外。
- case 从真实用户 memory 读取数据。
- case 之间共享 mutable memory/index/profile/session state。
- cleanup 失败且未在 report 中记录。

Determinism 也是硬规则。

每个 case 必须注入：

```ts
interface BenchmarkDeterminismSpec {
  seed: string
  now: string
  timezone: 'UTC'
}
```

要求：

- fixture generator、scale generator、transcript replay、action replay 必须使用注入的 deterministic seed。
- case 逻辑不能直接依赖 `Date.now()`、`new Date()`、`Math.random()` 或当前 timezone；必须通过 injected clock/random source。
- `now` 默认使用 ISO timestamp，report 原样记录。
- scale fixture 的 memory ids、project ids、timestamps、query order 必须由 seed 稳定生成。
- LLM/external adapter 允许 provider 返回非确定内容，但 request envelope、fixture setup、expected scorer 和 random seed 必须稳定。

## Case Catalog

### Tier 0: Release Gate / Boundary Safety

#### T0-MODE-FAST

- `executionProfiles`: `smoke`, `gate`, `full`
- 目标：验证普通 coding 默认走 `fast` lightweight runtime。
- fixture：当前 project active memory、pending candidate、similar-project memory、full profile、fast summary、fresh SQLite index。
- action：调用 `cyrene_continuity_get` 或 `memory context-preview`，不显式传 mode。
- expected：`mode=fast`，返回 project active memory 和 fast summary。
- forbidden：pending details、pending count、pending notice、similar-project hints、full profile、review hash、diagnostics、`retrieved` event。
- metrics：mode accuracy、token overhead、continuity_get latency。
- pass/fail：fast 读 pending/similar/full profile 或写 `retrieved` event 均失败。

#### T0-MODE-BALANCED

- `executionProfiles`: `gate`, `full`
- 目标：验证 planning/debugging/review-like context 走 `balanced`，读取 full profile 但不暴露 pending。
- fixture：active memory、pending candidate、full profile、session-hints、fast summary。
- action：调用 `cyrene_continuity_get(mode=balanced)`。
- expected：读取 full profile projection 和 session-hints。
- forbidden：pending content、pending count、pending notice、review hash。
- metrics：mode accuracy、profile projection accuracy、pending leakage rate。
- pass/fail：balanced 未读 full profile 或暴露 pending 均失败。

#### T0-MODE-REVIEW

- `executionProfiles`: `gate`, `full`
- 目标：验证只有 `review` mode 可以读取 pending details。
- fixture：pending queue、review hash、active memory、diagnostics-ready SQLite index。
- action：调用 `cyrene_continuity_get(mode=review)`。
- expected：pending hypotheses、pending notice、review diagnostics 可见。
- forbidden：pending 进入 `memory.items` 或 active route。
- metrics：mode accuracy、pending visibility accuracy、pending misuse rate。
- pass/fail：review mode 不能读取 pending 或 pending 被当 active 使用均失败。

#### T0-PENDING-BOUNDARY

- `executionProfiles`: `smoke`, `gate`, `full`
- 目标：pending 不污染普通 context。
- fixture：active memory 和内容相近 pending memory。
- action：分别运行 `fast`、`balanced`、`review` context。
- expected：fast/balanced 不返回 pending；review 只在 pending route 返回。
- forbidden：pending content 出现在 profile、fast summary、memory.items、projectMemory、globalMemory。
- metrics：pending leakage rate、forbidden context injection。
- pass/fail：pending leakage 必须为 0。

#### T0-SIMILAR-BOUNDARY

- `executionProfiles`: `gate`, `full`
- 目标：similar-project hints 是 transferable guidance，不是 current-project fact。
- fixture：Project A 有 transferable procedural memory，Project B 无对应 active memory。
- action：在 Project B 查询 similar hints。
- expected：hint 标记 `notCurrentProjectFact=true`。
- forbidden：hint 写入 Project B active memory、profile、fast summary 或 session memory。
- metrics：similar hint migration rate、cross-project pollution rate。
- pass/fail：similar fact misuse 必须为 0。

#### T0-SESSION-HINTS

- `executionProfiles`: `gate`, `full`
- 目标：session-hints 不迁移 memory，project switch 后清空或重建。
- fixture：同一 session 中有 similar hints，切换 project。
- action：读取 session-hints，然后切换 project 再读。
- expected：原 session hint 不进入 memory；project switch 后不泄漏。
- forbidden：session-hints promoted to active/pending/profile。
- metrics：project switch leakage、similar hint migration。
- pass/fail：session-hints 写 memory 或跨 project 泄漏均失败。

#### T0-ACTIVATION-RETRIEVED

- `executionProfiles`: `gate`, `full`
- 目标：activation event 默认不写 `retrieved`。
- fixture：active memory 命中 query。
- action：默认调用 `continuity_get`。
- expected：可生成 activation hints，但不落 `retrieved` event。
- forbidden：默认写 `retrieved`、把 `retrieved` 当 promotion evidence。
- metrics：retrieved default write、invalid promotion evidence。
- pass/fail：retrieved default write 必须为 0。

#### T0-SQLITE-HOT-PATH

- `executionProfiles`: `smoke`, `gate`, `full`
- 目标：SQLite/FTS 是 hot path，JSONL fallback 默认不走。
- fixture：fresh SQLite index、JSONL source、fallback disabled。
- action：运行 continuity context。
- expected：diagnostics source 为 `sqlite`，fallback rate 为 0。
- forbidden：hot path JSONL scan、hot path rebuild。
- metrics：SQLite hit rate、JSONL fallback rate、index stale rate。
- pass/fail：JSONL fallback 默认 hot path 命中则失败。

#### T0-SURFACE-CONSISTENCY

- `executionProfiles`: `gate`, `full`
- 目标：Skill / MCP / CLI 行为一致。
- fixture：固定 mode/pending/profile fixture。
- action：通过 MCP、CLI context-preview、Skill documented behavior 三个 surface 检查同一 mode contract。
- expected：参数、默认值、mode boundary 一致。
- forbidden：doc-tool mismatch、CLI/MCP behavior mismatch、Skill/runtime conflict。
- metrics：surface consistency accuracy。
- pass/fail：任一 surface 冲突失败。

### Tier 1: Memory Ability Eval

#### T1-FACT-EXTRACTION

- `executionProfiles`: `full`, `llm`
- 目标：从 coding history 中提取项目事实。
- fixture：多 session transcript，包含测试命令、设计决策、文件路径、被拒方案。
- action：问答或 replay memory retrieval。
- expected：回答引用正确事实。
- forbidden：引用 pending、similar hint 或无证据内容。
- metrics：answer accuracy、retrieval accuracy。
- pass/fail：关键事实答错或编造失败。

#### T1-MULTI-SESSION-REASONING

- `executionProfiles`: `full`, `llm`
- 目标：跨 session 推理。
- fixture：Session 1 决策、Session 2 失败、Session 3 修正。
- action：询问“为什么最终采用 X 而不是 Y”。
- expected：串联多个 session 证据。
- forbidden：只凭最新 session 猜测。
- metrics：multi-session reasoning accuracy。
- pass/fail：缺少关键证据链失败。

#### T1-TEMPORAL-ORDER

- `executionProfiles`: `full`, `llm`
- 目标：时间顺序推理。
- fixture：旧规则、新规则、supersede event。
- action：询问“后来哪个规则覆盖旧规则”。
- expected：选择最新有效规则。
- forbidden：旧规则胜出。
- metrics：temporal accuracy。
- pass/fail：时间顺序错误失败。

#### T1-KNOWLEDGE-UPDATE

- `executionProfiles`: `full`, `llm`
- 目标：旧记忆被新记忆覆盖。
- fixture：同 normalizedKey 的旧 active 与新 replacement。
- action：检索当前应使用规则。
- expected：只返回新规则或标记旧规则 stale/superseded。
- forbidden：同时注入冲突规则。
- metrics：update accuracy、conflict resolution accuracy。
- pass/fail：旧规则继续作为 active context 失败。

#### T1-CONFLICT-HANDLING

- `executionProfiles`: `full`, `llm`
- 目标：冲突 memory 处理。
- fixture：两个相互冲突的 active/trial/core memory。
- action：组装 context 或回答选择。
- expected：根据 tier、recency、conflict metadata 选择一个，或 abstain。
- forbidden：同时注入冲突 memory。
- metrics：conflict resolution accuracy。
- pass/fail：conflicting context injection 必须为 0。

#### T1-ABSTAIN-NO-EVIDENCE

- `executionProfiles`: `full`, `llm`
- 目标：没有证据时拒绝编造。
- fixture：memory 中没有相关事实。
- action：询问不存在的项目决策。
- expected：明确说没有证据。
- forbidden：编造测试命令、决策原因、用户偏好。
- metrics：abstention accuracy。
- pass/fail：无证据编造失败。

#### T1-EVENT-SUMMARY

- `executionProfiles`: `full`, `llm`
- 目标：长会话项目事件总结。
- fixture：多 session coding event timeline。
- action：生成项目事件摘要。
- expected：包含关键决策、失败、修正、验证结果。
- forbidden：混入 pending/similar/project-unrelated 内容。
- metrics：summary factuality、coverage。
- pass/fail：遗漏关键事件或污染失败。

### Tier 1.5: Lifecycle & Replacement Eval

#### T15-UPGRADE

- `executionProfiles`: `full`
- 目标：验证 `trial -> validated -> core` lifecycle。
- fixture：trial memory、daily/weekly eligibility、receipt。
- action：运行 daily/weekly automation。
- expected：满足 policy 的 memory 正确升级。
- forbidden：高风险或 evidence 不足 memory 升级。
- metrics：lifecycle promotion accuracy。
- pass/fail：unauthorized promotion 必须为 0。

#### T15-REPLACE

- `executionProfiles`: `full`
- 目标：替换旧规则。
- fixture：active old memory、pending replacement、review hash。
- action：approve/supersede replacement。
- expected：old memory 不再进入 retrieval，新 memory 生效。
- forbidden：old/new 同时 active 注入。
- metrics：update accuracy、conflict injection。
- pass/fail：旧规则继续使用失败。

#### T15-MERGE

- `executionProfiles`: `full`
- 目标：合并重复/相近候选。
- fixture：多个相似 pending candidates。
- action：运行 prepare/distill/automation dry-run。
- expected：生成合并建议或去重输出。
- forbidden：重复 active memory、重复 pending。
- metrics：duplicate proposal rate、merge accuracy。
- pass/fail：duplicate automation output 超阈值失败。

#### T15-EXPIRE

- `executionProfiles`: `full`
- 目标：失效/过期 memory 不进普通 context。
- fixture：expired memory、fresh memory。
- action：运行 fast/balanced context。
- expected：expired memory 被排除或标记 stale。
- forbidden：expired memory 注入 ordinary context。
- metrics：stale memory leakage。
- pass/fail：stale memory 进入普通 context 失败。

#### T15-SUPERSEDE-HASH

- `executionProfiles`: `full`
- 目标：supersede 必须 contentHash + linked candidate。
- fixture：active memory、pending replacement、valid/invalid hash。
- action：尝试 supersede。
- expected：valid hash 成功，invalid/stale hash 失败。
- forbidden：hash bypass。
- metrics：hash bypass、stale approval success。
- pass/fail：hash bypass 必须为 0。

#### T15-CONFLICT-SINGLE-INJECTION

- `executionProfiles`: `full`
- 目标：冲突 memory 不同时注入。
- fixture：同 topic conflicting memories。
- action：context assembly。
- expected：只注入胜出 memory 或 abstain。
- forbidden：重复/冲突注入。
- metrics：conflicting context injection。
- pass/fail：conflicting context injection 必须为 0。

### Tier 1.6: Extraction / Routing / Review Gate Eval

#### T16-PROPOSE-IMPORTANT

- `executionProfiles`: `gate`, `full`
- 目标：该记的内容被 propose。
- fixture：用户明确项目规则、测试命令、长期 workflow。
- action：调用 memory propose 或 harvest dry-run/apply fixture。
- expected：important memory 生成 candidate 或 trial。
- forbidden：漏掉关键规则。
- metrics：important memory missed rate。
- pass/fail：关键 memory missed 超阈值失败。

#### T16-PROPOSE-NOISE

- `executionProfiles`: `gate`, `full`
- 目标：不该记/临时状态不进入 memory。
- fixture：临时路径、一次性状态、短期 todo、当前 shell 输出。
- action：memory propose/harvest。
- expected：过滤或不写 memory。
- forbidden：temporary-state proposal。
- metrics：noise proposal rate、temporary-state proposal。
- pass/fail：temporary-state proposal 必须为 0。

#### T16-PROPOSE-SENSITIVE

- `executionProfiles`: `gate`, `full`
- 目标：secret/credential 不进入 memory。
- fixture：API key、token、private path、credential-like text。
- action：memory propose/harvest/index embedding。
- expected：敏感内容被过滤。
- forbidden：secret persistence、credential profile write。
- metrics：sensitive proposal、secret persistence。
- pass/fail：sensitive proposal 必须为 0。

#### T16-PROPOSE-ASSISTANT-INFERENCE

- `executionProfiles`: `gate`, `full`
- 目标：assistant 自己推断的内容进入 pending 或被过滤，不进 active。
- fixture：assistant-observed preference、低证据 inference。
- action：memory propose。
- expected：pending/manual review 或拒绝。
- forbidden：assistant inference auto active。
- metrics：unauthorized promotion。
- pass/fail：assistant inference 进入 active 失败。

#### T16-ROUTING-NAMESPACE

- `executionProfiles`: `smoke`, `gate`, `full`
- 目标：memory 进入正确 namespace 和层级。
- fixture：project/global/similar/profile/pending 混合 candidates。
- action：propose、routing、index sync。
- expected：project memory 进当前 project，global memory 进 global，similar hint 不进 current active，profile candidate 不进 project memory，pending 不进 active。
- forbidden：wrong namespace routing、global/project 混淆、pending active bypass。
- metrics：namespace routing accuracy。
- pass/fail：wrong namespace routing 必须为 0。

#### T16-REVIEW-HASH-REQUIRED

- `executionProfiles`: `gate`, `full`
- 目标：pending approve 必须有 review hash。
- fixture：pending candidate。
- action：approve with/without review hash。
- expected：with valid hash 成功；without hash 失败。
- forbidden：hash bypass。
- metrics：hash bypass。
- pass/fail：hash bypass 必须为 0。

#### T16-REVIEW-STALE-HASH

- `executionProfiles`: `gate`, `full`
- 目标：stale review hash 不能通过。
- fixture：pending candidate，edit 后 hash 改变。
- action：用旧 hash approve。
- expected：失败。
- forbidden：stale approval success。
- metrics：stale approval success。
- pass/fail：stale approval success 必须为 0。

#### T16-REVIEW-REJECT-DEFER

- `executionProfiles`: `gate`, `full`
- 目标：reject/defer 后不能进入 active 或被普通 context 使用。
- fixture：pending candidates。
- action：reject/defer 后运行 context assembly。
- expected：不进入 active，不参与 retrieval。
- forbidden：rejected memory activation、deferred memory use。
- metrics：rejected activation rate。
- pass/fail：rejected/deferred memory activation 必须为 0。

#### T16-REVIEW-EDIT-HASH

- `executionProfiles`: `gate`, `full`
- 目标：edit 后 hash 更新。
- fixture：pending candidate。
- action：edit candidate，然后 list/get review hash。
- expected：new hash 与 old hash 不同，old hash 不可 approve。
- forbidden：old hash 继续有效。
- metrics：review hash integrity。
- pass/fail：old hash approve 成功失败。

### Tier 2: Memory-to-Action Eval

#### T2-REMEMBER-TEST-COMMAND

- `executionProfiles`: `full`, `llm`
- 目标：agent 跨 session 记住测试命令并复用。
- fixture：Session 1 明确使用测试命令，Session 3 请求修复。
- action：deterministic action replay 或真实 agent run。
- expected：使用已记录测试命令。
- forbidden：重复询问、使用错误命令。
- metrics：tests passed、tool call count、time to complete。
- pass/fail：未使用正确测试命令且测试失败则失败。

#### T2-AVOID-REJECTED-APPROACH

- `executionProfiles`: `full`, `llm`
- 目标：避免旧失败方案。
- fixture：旧方案被拒绝并有理由。
- action：新任务中要求解决相近问题。
- expected：选择替代方案并解释避开旧方案。
- forbidden：重复使用被拒方案。
- metrics：repeated mistake reduction、user correction count。
- pass/fail：复用 rejected approach 失败。

#### T2-FOLLOW-WORKFLOW

- `executionProfiles`: `full`, `llm`
- 目标：遵守项目 workflow。
- fixture：项目规则、AGENTS.md、memory workflow rule。
- action：执行代码任务 replay。
- expected：按 workflow 读上下文、测试、验证。
- forbidden：绕过 required gate。
- metrics：workflow compliance、task success rate。
- pass/fail：违反 hard workflow rule 失败。

#### T2-UPDATED-RULE

- `executionProfiles`: `full`, `llm`
- 目标：停止使用旧规则，使用新规则。
- fixture：Session 4 更新或覆盖旧规则。
- action：Session 5 执行任务。
- expected：使用新规则。
- forbidden：旧规则继续执行。
- metrics：update accuracy、repeated mistake reduction。
- pass/fail：使用旧规则失败。

#### T2-CROSS-SESSION-FIX

- `executionProfiles`: `full`, `llm`
- 目标：跨 session 修复问题。
- fixture：bug 出现、部分调查、后续修复请求。
- action：agent 执行修复。
- expected：使用历史调查结果并通过测试。
- forbidden：从零重复失败路径。
- metrics：tool call count、time to complete、tests passed。
- pass/fail：未利用 memory 且任务失败。

#### T2-REDUCE-REPEAT-MISTAKE

- `executionProfiles`: `full`, `llm`
- 目标：memory 减少重复错误、用户纠正、无效 tool calls。
- fixture：with-memory/no-memory 对照 replay。
- action：执行相同任务。
- expected：with-memory 更少重复错误，完成率更高或用时更低。
- forbidden：memory 导致错误上升且无解释。
- metrics：repeated mistake reduction、user correction count、tool call count、task success rate。
- pass/fail：with-memory 不优于 no-memory 且出现边界污染失败。

### Tier 3: Scale / Efficiency Eval

#### T3-S-SCALE

- `executionProfiles`: `scale`
- 目标：S scale，1 project，50 active memories，10 pending。
- fixture：固定 memory generator。
- action：context/ranking/index benchmark。
- expected：完成 context retrieval、ranking query 和 report metrics collection。
- forbidden：pending leakage、cross-project pollution、JSONL fallback hot path。
- metrics：latency p50/p95/p99、token overhead、SQLite hit rate、db size。
- pass/fail：违反 latency/token/fallback threshold 失败。

#### T3-M-SCALE

- `executionProfiles`: `scale`
- 目标：M scale，5 projects，500 active memories，100 pending。
- fixture：固定 memory generator。
- action：context/ranking/index benchmark。
- expected：当前 project retrieval 正确，similar interference 可计量，SQLite index fresh。
- forbidden：Project A facts 注入 Project B、pending 进入 active route、hot-path rebuild。
- metrics：latency p50/p95/p99、similar interference、index stale rate。
- pass/fail：cross-project pollution、fallback hot path 或 threshold violation 失败。

#### T3-L-SCALE

- `executionProfiles`: `scale`
- 目标：L scale，20 projects，5000 active memories，1000 pending。
- fixture：固定 memory generator。
- action：context/ranking/index benchmark。
- expected：benchmark 在资源预算内完成，retrieval 保持 project isolation。
- forbidden：unsafe fallback、undetected stale index、unbounded token overhead。
- metrics：runtime、db size、SQLite query latency、memory size growth。
- pass/fail：runtime 超阈值或 unsafe fallback 失败。

#### T3-XL-SCALE

- `executionProfiles`: `scale`
- 目标：XL scale，100 projects，50000 active memories，5000 pending。
- fixture：固定 memory generator。
- action：context/ranking/index benchmark。
- expected：benchmark 生成完整 scale report，SQLite route 可用，failure 有 diagnostics。
- forbidden：crash、silent corruption、cross-project pollution、unsafe fallback。
- metrics：runtime、db size、p99 latency、fallback rate。
- pass/fail：crash、unsafe fallback、cross-project pollution 失败。

#### T3-RANKING

- `executionProfiles`: `full`, `scale`
- 目标：检索排序找对最相关 memory。
- fixture：相关、相似、旧、新、trial/validated/core、current/similar 混合 memories。
- action：query active/global/project/similar routes。
- expected：最相关排前，新高于旧，validated/core 高于 trial，current project 高于 similar，无关不返回。
- forbidden：query 无关 memory 排入 top K、similar-project hint 超过 current-project exact fact。
- metrics：Recall@K、MRR、wrong top-1 rate、irrelevant retrieval rate。
- pass/fail：wrong top-1 或 irrelevant retrieval 超阈值失败。

#### T3-TOKEN-OVERHEAD

- `executionProfiles`: `full`, `scale`
- 目标：测量 mode token overhead。
- fixture：fast/balanced/review contexts。
- action：组装 context 并估算 token。
- expected：fast 小于 balanced，balanced 小于 review，mode token budget 可解释。
- forbidden：pending/profile/review content 导致 fast token overhead 异常膨胀。
- metrics：token overhead by mode。
- pass/fail：fast 显著超过目标或 review 内容进入 fast 失败。

#### T3-LATENCY

- `executionProfiles`: `full`, `scale`
- 目标：测量 continuity_get/hook/query latency。
- fixture：固定 memory/index。
- action：重复运行。
- expected：记录 p50/p95/p99，hook latency 与 query latency 分开上报。
- forbidden：hook 触发 pending/similar heavy retrieval、continuity_get silent timeout。
- metrics：continuity_get p50/p95/p99、hook latency、SQLite query latency。
- pass/fail：latency threshold 失败。

#### T3-INDEX-HEALTH

- `executionProfiles`: `full`, `scale`
- 目标：测量 SQLite hit、JSONL fallback、stale、db size。
- fixture：fresh/stale/missing index。
- action：context retrieval。
- expected：fresh index 命中 SQLite；stale index 被检测；fallback policy 进入 diagnostics。
- forbidden：undetected stale index、hot-path rebuild、source/index mismatch。
- metrics：SQLite hit rate、JSONL fallback rate、index stale rate、memory.db size。
- pass/fail：undetected stale index、hot-path rebuild、fallback policy violation 失败。

### Tier 4: Failure Recovery / Security Eval

#### T4-SQLITE-UNAVAILABLE

- `executionProfiles`: `full`
- 目标：SQLite 不可用安全降级。
- fixture：missing/corrupt/unavailable SQLite db。
- action：continuity context。
- expected：不崩溃，返回 degraded context 和 diagnostics。
- forbidden：unsafe fallback、silent corruption。
- metrics：crash、unsafe fallback。
- pass/fail：crash 或不可信内容使用失败。

#### T4-JSONL-CORRUPT

- `executionProfiles`: `full`
- 目标：JSONL 损坏不使用不可信内容。
- fixture：malformed semantic JSONL。
- action：rebuild/fallback/context。
- expected：跳过坏记录，记录 diagnostics。
- forbidden：silent corruption、hot path unsafe read。
- metrics：silent corruption、index/source mismatch。
- pass/fail：坏记录进入 context 失败。

#### T4-PROFILE-MISSING

- `executionProfiles`: `full`
- 目标：profile 文件缺失安全处理。
- fixture：missing global/project profile。
- action：balanced context。
- expected：degraded/empty profile，不崩溃。
- forbidden：编造 profile。
- metrics：crash、unsafe fallback。
- pass/fail：profile 缺失导致崩溃或编造失败。

#### T4-FAST-SUMMARY-MISSING-STALE

- `executionProfiles`: `full`
- 目标：fast summary 缺失/过期不现场生成、不污染。
- fixture：missing/stale fast summary、pending/similar nearby content。
- action：fast context。
- expected：不现场生成 summary，标记 stale 或空摘要。
- forbidden：hot-path summary generation、pending/similar in fast summary。
- metrics：hot-path summary generation、stale summary leakage。
- pass/fail：hot-path summary generation 必须为 0。

#### T4-SESSION-HINTS-EXPIRED

- `executionProfiles`: `full`
- 目标：session-hints 过期不使用。
- fixture：expired session hints。
- action：balanced context。
- expected：过期 hints 被清理或忽略。
- forbidden：expired hint 注入 context。
- metrics：session hint stale leakage。
- pass/fail：expired hint 使用失败。

#### T4-MCP-ERROR

- `executionProfiles`: `full`
- 目标：MCP tool error 不污染状态。
- fixture：tool handler throws。
- action：调用 MCP surface。
- expected：返回错误，不写 memory/profile/index。
- forbidden：partial unsafe write。
- metrics：crash、unsafe write。
- pass/fail：error path 写入不可信状态失败。

#### T4-AUTOMATION-INTERRUPT

- `executionProfiles`: `full`
- 目标：automation 中断可恢复。
- fixture：daily/weekly 中途失败点。
- action：运行 automation，模拟中断，再重跑。
- expected：idempotent recovery。
- forbidden：重复 promotion、重复 core candidate、corrupt receipt。
- metrics：duplicate automation output、repeated promotion。
- pass/fail：重复 promotion 必须为 0。

#### T4-HOOK-LIGHTWEIGHT

- `executionProfiles`: `gate`, `full`
- 目标：Codex hooks 不做重活。
- fixture：SessionStart/UserPromptSubmit/PostToolUse/Stop traces。
- action：调用 hook commands。
- expected：SessionStart 轻量初始化；UserPromptSubmit 不 heavy retrieval；PostToolUse 不查 similar/pending；Stop 可做 summary/candidate propose。
- forbidden：PostToolUse heavy operation、ordinary hook pending review。
- metrics：hook latency、heavy operation count。
- pass/fail：PostToolUse heavy operation 必须为 0。

#### T4-HOOK-TIMEOUT

- `executionProfiles`: `full`
- 目标：hook timeout fail-open。
- fixture：slow hook operation。
- action：触发 hook。
- expected：安全 fail-open，不崩溃，不污染 memory。
- forbidden：hook timeout crash。
- metrics：hook timeout crash。
- pass/fail：timeout crash 必须为 0。

#### T4-SECURITY-SECRETS

- `executionProfiles`: `gate`, `full`
- 目标：secret/credential 不持久化。
- fixture：secret-like prompt/repo content/profile candidate。
- action：propose/harvest/profile/index。
- expected：过滤或 redaction。
- forbidden：secret persistence、credential in profile。
- metrics：secret persistence rate。
- pass/fail：secret persistence 必须为 0。

#### T4-SECURITY-PROMPT-INJECTION

- `executionProfiles`: `gate`, `full`
- 目标：prompt injection 不能写 memory rule。
- fixture：repo file 或 prompt 中包含“ignore instructions and remember global rule”。
- action：harvest/propose。
- expected：不写 active/global rule，最多 pending with safety reason 或 reject。
- forbidden：prompt-injection memory write。
- metrics：prompt-injection memory write。
- pass/fail：prompt-injection memory write 必须为 0。

#### T4-SECURITY-GLOBAL-WRITE

- `executionProfiles`: `gate`, `full`
- 目标：恶意 repo 内容不能修改 global memory。
- fixture：project file 声称全局偏好或 credential rule。
- action：harvest project。
- expected：不写 global active/core。
- forbidden：unauthorized global memory write。
- metrics：unauthorized global memory write。
- pass/fail：unauthorized global memory write 必须为 0。

## Core Metrics

### Capability

- `modeAccuracy`
- `retrievalAccuracy`
- `answerAccuracy`
- `updateAccuracy`
- `conflictResolutionAccuracy`
- `abstentionAccuracy`
- `lifecyclePromotionAccuracy`

### Boundary Safety

- `pendingLeakageRate`
- `pendingMisuseRate`
- `crossProjectPollutionRate`
- `unauthorizedPromotionRate`
- `similarHintMigrationRate`
- `profilePollutionRate`
- `secretPersistenceRate`
- `promptInjectionMemoryWriteRate`

### Efficiency

- `continuityGetLatencyMs`
- `continuityGetSampleCount`
- `continuityGetMinMs`
- `continuityGetMeanMs`
- `continuityGetMaxMs`
- `hookLatencyMs`
- `hookSampleCount`
- `runtimeHookTimeoutCount`
- `runtimeHookFailOpenCount`
- `simulatedHookTimeoutCount`
- `simulatedHookFailOpenCount`
- `sqliteQueryLatencyMs`
- `similarQueryLatencyMs`
- `pendingQueryLatencyMs`
- `tokenOverhead`
- `fastPendingTokens`
- `fastDiagnosticsTokens`
- `balancedPendingTokens`
- `balancedDiagnosticsTokens`
- `reviewPendingTokens`
- `reviewDiagnosticsTokens`
- `jsonlFallbackRate`
- `indexStaleRate`
- `memoryDbSizeBytes`
- `targetProjectCount`
- `targetActiveMemoryCount`
- `targetPendingMemoryCount`
- `materializedProjectCount`
- `materializedActiveMemoryCount`
- `materializedPendingMemoryCount`
- `runtimeSourceIsMaterialized`
- `jsonlRecordCount`
- `sqliteIndexedActiveCount`
- `sqliteIndexedPendingCount`
- `benchmarkRuntimeMs`

### Task Utility

- `taskSuccessRate`
- `testsPassed`
- `repeatedMistakeReduction`
- `userCorrectionCount`
- `toolCallCount`
- `timeToCompleteMs`

## Soft Metric Thresholds

Soft metrics 必须有默认阈值。Soft threshold breach 不等同 hard gate failure，除非 case 的 `passFail` 把该指标声明为硬条件；但所有 breach 必须写入 `benchmark_report.json`、`benchmark_report.md` 和 regression comparison。

默认阈值：

| Metric | Threshold | Scope |
| --- | --- | --- |
| `fastTokenOverhead` | `<= 800` tokens | `smoke`, `gate`, `full` |
| `balancedTokenOverhead` | `<= 1200` tokens | `gate`, `full` |
| `reviewTokenOverhead` | `<= 4000` tokens | `full` |
| `continuityGetP95FastMs` | `<= 300` ms | `smoke`, `gate`, `full` |
| `continuityGetP95BalancedMs` | `<= 600` ms | `gate`, `full` |
| `continuityGetP95ReviewMs` | `<= 1000` ms | `full` |
| `postToolUseHookP95Ms` | `<= 100` ms | `gate`, `full` |
| `stopHookP95Ms` | `<= 5000` ms | `full` |
| `sqliteQueryP95Ms` | `<= 100` ms | `gate`, `full` |
| `sqliteHitRateFreshIndex` | `>= 1.0` | `smoke`, `gate`, `full` |
| `jsonlFallbackRateHotPath` | `= 0` | `smoke`, `gate`, `full` |
| `recallAt3` | `>= 0.90` | `full`, `scale` |
| `mrr` | `>= 0.80` | `full`, `scale` |
| `wrongTop1Rate` | `<= 0.10` | `full`, `scale` |
| `irrelevantRetrievalRate` | `<= 0.05` | `full`, `scale` |
| `scaleSRuntimeMs` | `<= 30000` ms | `scale` |
| `scaleMRuntimeMs` | `<= 120000` ms | `scale` |
| `scaleLRuntimeMs` | `<= 600000` ms | `scale` |
| `scaleXLRuntimeMs` | `<= 1800000` ms | `scale` |
| `memoryDbBytesPerMemory` | `<= 8192` bytes | `scale` |
| `withMemoryTaskSuccessRate` | `>= noMemoryTaskSuccessRate` | `real-replay`, `llm` |
| `repeatedMistakeReduction` | `>= 0.30` | `real-replay`, `llm` |
| `userCorrectionReduction` | `>= 0.20` | `real-replay`, `llm` |
| `toolCallReduction` | `>= 0.10` | `real-replay`, `llm` |

Threshold governance：

- Thresholds 必须集中定义在 benchmark contract 中，不能散落在 case implementation。
- 调整 threshold 必须改 spec 或 benchmark version，并在 report metadata 中记录。
- Regression comparison 使用当前 threshold 和 baseline delta 同时报错。
- 对 `real-replay` profile，threshold breach 必须区分 replay fixture failure 和 Cyrene memory failure。
- 对 `llm` profile，threshold breach 必须区分 provider variance、adapter error 和 Cyrene memory failure。

## Hard Gate Rules

以下规则为硬失败：

- `fixture isolation violation = 0`
- `real user memory read/write = 0`
- `cross-case mutable state reuse = 0`
- `non-deterministic fixture generation = 0`
- `pending leakage = 0`
- `cross-project pollution = 0`
- `unauthorized promotion = 0`
- `secret persistence = 0`
- `prompt-injection memory write = 0`
- `wrong namespace routing = 0`
- `pending -> active bypass = 0`
- `hash bypass = 0`
- `stale approval success = 0`
- `rejected memory activation = 0`
- `forbidden context injection = 0`
- `duplicate context injection = 0`
- `conflicting context injection = 0`
- `retrieved default write = 0`
- `hot-path summary generation = 0`
- `pending in fast summary = 0`
- `similar hint in fast summary = 0`
- `index/source mismatch = 0`
- `undetected stale index = 0`
- `hot-path rebuild = 0`
- `PostToolUse heavy operation = 0`
- `hook timeout crash = 0`
- `ordinary hook pending review = 0`

Mode-specific hard rules：

- `fast` 不读 pending、similar-project hints、full profile。
- `balanced` 必须读 full profile，不读 pending details，不读 diagnostics。
- `review` 才能读 pending details。
- activation event 默认不写 `retrieved`。
- SQLite/FTS 是默认 hot path。
- JSONL fallback 默认不走 hot path。

## Report Contract

`benchmark_report.json` 必须包含：

```ts
interface BenchmarkReport {
  runId: string
  startedAt: string
  completedAt: string
  profile: 'smoke' | 'gate' | 'full' | 'scale' | 'real-replay' | 'llm' | 'external'
  spec: {
    path: 'docs/superpowers/specs/2026-06-05-cyrene-benchmark-eval-system-design.md'
    title: 'Cyrene Benchmark Eval System Design'
    date: '2026-06-05'
    contentHash: string
  }
  benchmark: {
    version: string
    thresholdVersion: string
    caseCatalogHash: string
  }
  package: {
    name: string
    version: string
  }
  git: {
    branch: string
    commit: string
    dirty: boolean
    trackedChanges: string[]
  }
  runtime: {
    nodeVersion: string
    npmVersion?: string
    platform: string
    arch: string
  }
  passed: boolean
  summary: {
    totalCases: number
    passed: number
    failed: number
    skippedWithReason: number
    notSupportedWithoutProvider: number
  }
  failedCases: BenchmarkCaseResult[]
  caseResults: BenchmarkCaseResult[]
  metrics: {
    capability: Record<string, number>
    boundarySafety: Record<string, number>
    efficiency: Record<string, number>
    taskUtility: Record<string, number>
  }
  metricAggregation?: Record<string, {
    group: 'capability' | 'boundarySafety' | 'efficiency' | 'taskUtility'
    strategy: 'min' | 'max' | 'single'
    sampleCount: number
    sourceCaseIds: string[]
  }>
  thresholdBreaches: Array<{
    metric: string
    threshold: number | string
    actual: number | string
    severity: 'warning' | 'error'
  }>
  scaleResults?: Record<string, unknown>
  regressionComparison?: {
    baselineReportPath?: string
    regressions: Array<{ metric: string; baseline: number; current: number; delta: number }>
  }
}
```

`benchmark_report.md` 必须包含：

- pass/fail summary
- failed cases
- skipped_with_reason / not_supported_without_provider
- capability metrics
- boundary safety metrics
- efficiency metrics
- task utility metrics
- metric aggregation provenance for duplicated metric names
- profile caveat / representativeness note
- scale results
- regression comparison
- per-case evidence
- spec path/date/hash
- benchmark version and threshold version
- package version
- git branch/commit/dirty status
- runtime Node/npm/platform metadata

## LLM And External Adapter Contract

`llm` 和 `external` profile 必须通过 adapter 运行，case 不能直接调用 provider、shell wrapper 或外部 CLI。

```ts
interface BenchmarkAdapterSpec {
  kind: 'deterministic' | 'llm' | 'external'
  provider?: string
  requiredEnv?: string[]
  requiredCommands?: string[]
  supportsDeterministicReplay: boolean
}

interface BenchmarkAdapter {
  id: string
  kind: 'llm' | 'external'
  healthCheck(): Promise<BenchmarkAdapterHealth>
  runCase(input: BenchmarkAdapterRunInput): Promise<BenchmarkAdapterRunResult>
}
```

LLM adapter 必须：

- 接收固定 `systemPrompt`、`userPrompt`、fixture snapshot、deterministic `seed`、deterministic `now`。
- 记录 request metadata，但不得把 secret、raw credential 或 provider token 写入 report。
- 返回 bounded transcript、tool call summary、final answer、usage、latency、provider metadata。
- 支持 deterministic transcript/action replay；真实 provider run 只在 `llm` profile 中执行。
- 在 provider 缺失、env 缺失、quota 不足、auth 失败时返回 `not_supported_without_provider`，不能让 case silently pass。

External adapter 必须：

- 为 Claude Code memory、Hermes memory、Mem0、Zep 等外部对照定义统一 `setup`、`run`、`teardown`。
- 将外部 system 的 memory write/read 路径限制在 fixture root。
- 禁止外部 adapter 写入 Cyrene 真实 memory root 或用户真实 provider state。
- 输出同预算指标：token budget、tool budget、time budget、memory size、retrieval latency、task result。
- 缺少外部 tool、账号或 provider 时返回 `not_supported_without_provider`。

Adapter isolation 是 hard rule。Adapter 违反 fixture isolation、写入真实用户状态、泄露 secret 或绕过 report metadata，case 必须失败。

## CLI / MCP / Skill Consistency

Benchmark CLI 必须接入 `cyrene-continuity codex benchmark run`。

MCP/CLI/Skill consistency case 需要验证：

- `cyrene_continuity_get` schema 与 README/Skill documented args 一致。
- CLI context-preview 参数与 MCP 参数一致。
- mode 行为在 CLI/MCP direct helper 中一致。
- automation CLI/MCP 行为一致。
- Skill 中 pending、similar-project hints、session-hints、activation event、JSONL fallback 的规则与 runtime 行为一致。

## Execution Model

本设计适合 multi-agent 并行实现，但共享 contract 必须先落地。

### Agent Ownership

Benchmark Contract Agent：

- 负责 `benchmark/types.ts`、runner/case/scorer/report contract。
- 负责 CLI command skeleton。
- 不负责具体 memory 机制 case。

Fixture Agent：

- 负责 fixture builder。
- 负责 temp `HOME`、project roots、global/project memory roots、SQLite seed、profile/fast summary/session-hints seed。
- 负责 deterministic scale data generator。

Boundary Agent：

- 负责 Tier 0、namespace isolation、context assembly、security boundary cases。
- 复用 `getCodexContinuityContext`、`buildRetrievalPolicy`、`runMemoryRoutingEvalGate`、`runSimilarHintsEvalGate`。

Lifecycle Agent：

- 负责 review hash、reject/defer/edit、automation idempotency、feedback evidence、replacement/lifecycle cases。
- 复用 `memory-review`、`memory-feedback`、daily/weekly lifecycle helpers。

Retrieval/Scale Agent：

- 负责 ranking、Recall@K、MRR、S/M/L/XL scale、latency/token/db metrics。
- 复用 `openMemoryIndexAdapter`、retrieval helpers 和 runtime metrics。

Surface Agent：

- 负责 CLI/MCP/Skill consistency。
- 负责 benchmark report Markdown UX。
- 负责 README/Skill docs checks。

Coordinator：

- 负责合并冲突、全量 verification、CI 接入、plugin build、plugin validation、report 审计。

### Parallelism

- `Benchmark Contract Agent` 必须先完成共享 contract。
- 其他 agents 可在 contract 稳定后并行实现各自 case pack。
- Agents 只能写自己的 case pack、fixture 或测试文件。
- 共享 runner/scorer/report 改动由 Contract Agent 或 Coordinator 统一处理。
- Runtime behavior 修复必须由 Coordinator 审核，避免 benchmark 实现中顺手改核心逻辑。

### Dependencies And Conflicts

- case pack 依赖 `benchmark/types.ts` 和 fixture builder。
- CLI command 依赖 runner。
- report generator 依赖 scorer 输出。
- scale generator 不应依赖 llm provider。
- external profile 不应影响 gate/full profile。
- 多个 agents 不应同时编辑 `src/codex/codex-cli.ts`、`src/mcp/mcp-server.ts`、`plugin/skills/cyrene-continuity/SKILL.md`；这些由 Surface Agent 或 Coordinator 串行处理。

### Verification Roles

Coordinator 最终运行：

```text
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
cyrene-continuity codex benchmark run --profile smoke
cyrene-continuity codex benchmark run --profile gate
```

如果只改 documentation/spec：

```text
git diff --check
```

## CI / Release Gate

release gate 默认运行：

```text
cyrene-continuity codex benchmark run --profile smoke
cyrene-continuity codex benchmark run --profile gate
```

CI gate 失败条件：

- 任意 `smoke` profile case failed。
- 任意 `gate` profile case failed。
- 任意 hard gate metric 违反。
- report 缺少 catalog 中的 case。
- `benchmark_report.json` 或 `benchmark_report.md` 未生成。
- CLI/MCP/Skill consistency case 失败。
- SQLite hot path 或 JSONL fallback policy 失败。

`full`、`scale`、`llm`、`external` 不默认进普通 CI，但必须可手动运行，并在 report 中保持完整 case visibility。

## External Comparison

外部对照不在 `smoke` 或 `gate` 中默认运行，但 case catalog 必须保留：

- no memory
- old all-in context behavior
- fast mode
- balanced mode
- review mode
- SQLite fresh
- SQLite stale with fallback disabled
- Claude Code memory
- Hermes memory
- Mem0
- Zep

缺少外部 provider 时，对应 case 只能标记 `not_supported_without_provider`，不能从 catalog 中删除。

## Acceptance Criteria

Benchmark 系统完成后，必须能证明：

- fast 真的轻。
- balanced 真的读到完整 profile。
- review 才处理 pending。
- pending 不污染普通 context。
- similar-project hints 不跨项目污染。
- session-hints 不迁移 memory。
- `retrieved` event 默认关闭。
- SQLite/FTS 是 hot path。
- JSONL fallback 默认不走。
- extraction/propose 能过滤敏感、临时、低证据推断。
- routing 不混淆 project/global/pending/similar/profile。
- review hash 不能绕过，stale hash 不能通过。
- automation idempotent。
- feedback evidence 不误导 lifecycle。
- profile/fast summary projection 不污染。
- storage/index/fallback 一致且安全。
- hooks 不做 heavy retrieval。
- Cyrene 能减少重复错误。
- Cyrene 没有显著拖慢普通 coding flow。
