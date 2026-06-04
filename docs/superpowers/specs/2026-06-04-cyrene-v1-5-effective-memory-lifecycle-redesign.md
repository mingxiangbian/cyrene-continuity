# Cyrene v1.5 Effective Memory Lifecycle Redesign

Date: 2026-06-04
Status: Design review draft

## 背景

v1.5 已经引入 `trial -> validated -> core`、daily / weekly automation、activation events、review queue 和 Web UI 方向。但当前实现仍存在几个会削弱实际效果的问题：

- `source-of-truth` 文档摘录可能被当成 Trial memory。
- Trial admission 仍可能吸收 migration log、implementation changelog 和一次性施工记录。
- retrieval / activation / duplicate detection 仍有 English-only tokenization 风险。
- usage feedback 已有雏形，但还没有成为 daily / weekly automation 的稳定 evidence。
- `Dream` 仍作为产品概念残留在 public API、docs、UI、tests 或命名里，和新的 Memory Automation 心智模型冲突。
- `review_queue`、`tombstone`、`archive` 和 runtime context 的可见性边界需要更硬的质量门验证。

本轮不做小补丁，而采用彻底收敛方案：把 public lifecycle model、runtime activation、automation、review、terminal states、tokenizer 和质量检测统一到同一套语义。

## 目标

1. 让 project runtime memory 明确收敛为 `trial -> validated -> core`。
2. 让 global runtime memory 只保留 `global_core`，并用 `global_review_queue` 承接人工审查。
3. 让 `source-of-truth` 文档不进入 memory store。
4. 修正 Trial admission，让 Trial 只接收低风险、未来可用的 project fact、workflow rule、pitfall。
5. 统一中文/英文 tokenizer，支撑 retrieval、activation、duplicate detection 和 tombstone matching。
6. 保留最小 usage feedback，并让它轻量驱动 daily / weekly automation。
7. 用 `Memory Automation` 取代 `Dream` 作为 public concept。
8. 保留 `archive` 作为 terminal state，用于退役旧 memory，但不阻断未来候选。
9. 建立 per-agent quality gates，确保 multi-agent 实现符合预期语义，而不是只通过普通测试。

## 非目标

- 不继续做 legacy pending / active migration。旧数据有价值则改造进入新模型，没价值则丢弃或 archive。
- 不引入 rough / precise usage feedback split。
- 不做泛化 LLM rewrite。implementation changelog 和 migration log 默认 drop。
- 不在验证污染前重构 context renderer。
- 不保留 Dream 作为 standalone product concept。
- 不让 Trial 成为人工审核区。
- 不把 `source-of-truth` excerpt 写入 Trial、review queue、tombstone 或任何 memory lane。
- 不让 high-risk、personal、affective、profile/global/core-impacting memory 自动进入 runtime tier。

## 总体模型

### Project Memory

项目 runtime memory 只有三个 tier：

```txt
trial -> validated -> core
```

`trial` 是低风险项目记忆试用层。它可以被 runtime 召回，但只能进入 `workflowHints`，不能生成 hard constraint、checklist 或 profile core。

`validated` 是被 usage feedback 和 automation 证据支持的项目记忆。它可以进入 `workflowHints`，也可以在低风险场景进入 `planConstraints` 或 `checklistItems`。

`core` 是长期稳定项目记忆。它可以进入 constraints、checklists、profileCore，并作为 weekly project core -> global core candidate 的来源。

### Global Memory

global runtime memory 只有：

```txt
global_core
```

global 不设置 Trial / Validated，因为 global memory 没有项目内 Trial 的真实任务试用环境。global candidate 通过 `global_review_queue` 审查后才能进入 `global_core`。

### Review And Terminal States

非 runtime 审查区：

```txt
review_queue
global_review_queue
```

terminal states：

```txt
archived
tombstoned
dropped candidate event
```

`review_queue` 可在 UI / CLI / review console 显示和操作，但不能进入 `workflowHints`、`planConstraints`、`checklistItems` 或 `profileCore`。

`archive` 用于退役已存在 memory。它不进入 runtime，也不阻断未来相似候选。

`tombstone` 用于阻断未来相似错误候选。它不进入 runtime，但 admission gate 必须查询它。

`drop` 只处理 candidate 阶段的本次丢弃。它可以写 audit event，但不参与未来阻断。

## Source-Of-Truth Boundary

`source-of-truth` 不属于 memory。

AGENTS.md、README、skill docs、project policy docs 等只作为实时 source 使用：

- retrieval / context-preview 可以读取它们解释当前规则。
- admission gate 可以用它们判断候选是否只是权威文档摘录。
- 它们不写入 Trial / Validated / Core。
- 它们不进入 `review_queue`。
- 它们不生成 tombstone。

命中 source-of-truth excerpt 的候选：

```txt
action = drop
reason = source_of_truth_excerpt
```

这样可以避免把权威文档摘录包装成长期 memory，也避免长期保存 source excerpt 的负空间版本。

## Admission Routing

候选进入系统时先经过 admission routing。routing 的输出必须区分 `drop` 和 `tombstone`。

```ts
type AdmissionAction =
  | 'admit_trial'
  | 'route_review_queue'
  | 'drop'
  | 'tombstone'
```

### Drop-Only Cases

`source-of-truth excerpt`：

- AGENTS.md / README / skill docs / policy doc 摘录。
- `action = drop`
- `reason = source_of_truth_excerpt`
- 不落库，不入 review queue，不 tombstone。

`implementation changelog` / `migration log` / task process note：

- 例如“更新了 CLI、UI、MCP 和测试以支持 trial/validated/core”。
- 例如“完成 pending/active 到 trial/validated/core 的迁移”。
- `action = drop`
- `reason = implementation_changelog`
- 不 rewrite，不 tombstone。

`duplicate exact`：

- 与已有 active runtime memory normalized key 等价。
- `action = drop`
- `reason = duplicate`
- 不自动 tombstone，除非系统反复生成同类重复候选。

### Tombstone Cases

`tombstone` 只用于未来也要阻止相似候选的情况：

- `wrong_abstraction`
- `obsolete`
- `user_rejected`
- `repeated_duplicate`

tombstone 必须包含：

```ts
interface TombstoneReceipt {
  reasonCode:
    | 'wrong_abstraction'
    | 'obsolete'
    | 'user_rejected'
    | 'repeated_duplicate'
  normalizedKey: string
  evidenceRef?: string
  createdAt: string
}
```

future admission gate 查询 tombstone 时，只能使用 tombstone receipt 和 normalized key matching。drop event 不参与未来阻断。

### Trial Admission

只有低风险、未来可用、项目内可验证的 memory 才能进入 Trial：

- project fact
- workflow rule
- known pitfall
- durable procedural preference
- repository-specific operating constraint

Trial 不接收：

- source-of-truth excerpts
- implementation changelog
- migration logs
- review-summary-only noise
- one-time task state
- duplicate / near-duplicate
- personal / affective / relationship memory
- ambiguous global inference
- profile/core-impacting changes

### Review Queue Routing

以下候选进入 `review_queue`：

- high-risk
- ambiguous
- personal
- affective
- relationship
- profile-impacting
- core-impacting
- global-impacting
- conflict-heavy

这些候选可审查、可编辑、可 approve / reject / defer，但在批准前不能进入 runtime context。

## Archive

`archive` 保留为已存在 memory 的退役状态。

用途：

- 旧 memory 已被新规则替代，但不需要阻断未来相似候选。
- low-risk Trial / Validated 长期未使用或过期。
- 低风险项目记忆不再适用，但不构成错误抽象。

边界：

- archive 不是一个新 lane。
- archive 不进入 runtime context。
- archive 不阻断 future admission。
- automation 可以自动 archive 低风险过时 Trial / Validated。
- Core / global / profile 相关 archive 默认进入 weekly review digest。

## Tokenizer And Retrieval

新增统一 tokenizer：

```txt
src/memory/tokenizer.ts
```

以下路径必须使用同一 tokenizer：

- memory retriever relevance
- memory activation
- duplicate / near-duplicate detection
- normalized key
- tombstone matching

### Tokenizer Rules

- 英文技术词保持原样。
- 保留 `multi-agent`、`multi_agent`、`multiagent` 等常见变体。
- 中文生成 CJK 2-gram / 3-gram。
- 中文/英文 alias 注入同一 token set。
- tokenizer 输出必须稳定，可用于 normalized key。

最小 alias 表：

```ts
const MEMORY_TOKEN_ALIASES = {
  '多智能体': ['multi-agent', 'multi_agent', 'multiagent'],
  '仓库': ['repo', 'repository'],
  '审查': ['review', 'audit'],
  '验证': ['verify', 'validation'],
  '记忆': ['memory'],
  '自动化': ['automation'],
  '上下文': ['context'],
  '污染': ['pollution'],
}
```

alias 表的作用是让中文表达和英文技术表达命中同一条 memory。例如“多智能体审查”应能匹配 “multi-agent review”，也应避免这两种表达被 duplicate detection 当成两条不同记忆。

### Acceptance Examples

- “多智能体审查” matches “multi-agent review”。
- “仓库更新验证” matches “repo update verification”。
- “上下文污染” matches “context pollution”。
- retriever 不再 English-only。
- activation / retriever / duplicate detection / tombstone matching 对同一输入产生一致 token behavior。

## Usage Feedback

只保留最小 usage feedback 事件：

```ts
type ActivationEventType =
  | 'retrieved'
  | 'activated'
  | 'applied'
  | 'ignored'
  | 'corrected'
  | 'violated'
```

字段：

```ts
interface ActivationEvent {
  memoryId: string
  activationId: string
  event: ActivationEventType
  reason?: string
  evidenceRef?: string
  createdAt: string
}
```

事件语义：

- `retrieved`：`continuity_get` 检索到 memory。
- `activated`：memory 进入 `workflowHints`、`planConstraints` 或 `checklistItems`。
- `applied`：计划或最终回答明确使用了 activation。
- `ignored`：activated 但本轮未使用。
- `corrected`：用户纠正 memory 的使用边界。
- `violated`：activated 的 plan constraint 没有被执行。

usage feedback 是 automation evidence，不是单独裁决器。

允许：

- 支持 low-risk Trial cleanup。
- 支持 low-risk `trial -> validated`。
- 支持 weekly promotion candidate evidence。
- 支持 downgrade / review recommendation。

禁止：

- 仅凭 feedback 自动 promote high-risk memory。
- 绕过 quality gate、risk gate 或 review queue。
- 从普通 final answer 中猜测 applied，而没有明确 activation reference。

## Runtime Context And Context Preview

新增 debug/eval 命令：

```bash
cyrene-continuity memory context-preview
```

输出 runtime context：

```txt
workflowHints
planConstraints
checklistItems
profileCore
excludedReviewItems
excludedTombstones
excludedArchived
exclusionReasons
```

runtime isolation rules：

- `review_queue` 不能进入 runtime context。
- `global_review_queue` 不能进入 runtime context。
- `tombstone` 不能进入 runtime context。
- `archived` 不能进入 runtime context。
- `trial` 只能进入 `workflowHints`。
- `trial` 不能生成 must / required / verify / checklist language。
- `validated` / `core` / `global_core` 才能进入 `planConstraints`、`checklistItems`、`profileCore`。

本轮先用 context-preview 证明污染是否存在。只有 context-preview 证明 renderer 仍会污染 runtime，才进入 renderer 重构。

## Memory Automation

`Dream` 作为 public concept 退场。新的 public concept 是：

```txt
Memory Automation
```

主 MCP tool：

```txt
cyrene_memory_automation_run
```

jobs：

```txt
daily
weekly
```

方案 3 默认不保留 Dream public alias。README、skill、UI、主 CLI、主 MCP tool 和测试命名不得继续把 Dream 当核心概念。若未来明确需要外部兼容，必须另开兼容 spec，不能混入本轮 quality gate。

### Daily Automation

时间：每天 15:00。

职责：

- Trial cleanup。
- expired / unused / noisy Trial drop 或 archive。
- duplicate Trial merge / drop。
- usage feedback 聚合。
- admission / routing 修正。
- low-risk `trial -> validated` 自动 promote。
- 新 high-risk candidate 写入 `review_queue`，但不 daily 打扰用户审查。

daily automation 可以自动处理低风险噪音，但不能自动 promote high-risk memory。

### Weekly Automation

时间：周日 15:00。

职责：

- high-risk review queue digest。
- low-risk `validated -> core` 自动 promote。
- core stale / downgrade candidate。
- profile pruning preview。
- global candidate preview。
- project core -> global core candidate 评估。
- project / global memory 整理报告。

weekly 是人工审查节奏的主要入口。高风险 review queue 默认一周检查一次，而不是每天打扰。

### Receipts

automation 每次写操作必须产生 receipt：

- job name
- source memory ids
- action
- risk decision
- usage evidence summary
- quality gate result
- createdAt

receipt 是调试和回滚依据，不是 runtime memory。

## UI And Docs

UI 必须清楚显示：

- Trial
- Validated
- Core
- Review Queue
- Global Core
- Global Review Queue
- Archived / Tombstoned debug view

UI 禁止：

- 用 pending / active 表示新的 memory lifecycle。
- 把 Inbox 误导成 Trial。
- 把 review_queue 显示成 runtime memory。
- 把 Dream 作为核心产品概念。

Docs 必须更新：

- README
- plugin skill
- MCP tool docs
- CLI docs
- verify / eval docs

文档必须明确：

- source-of-truth docs 不进入 memory store。
- daily / weekly automation 的时间和职责。
- high-risk review queue 每周集中检查。
- global memory 只有 global core + global review queue。
- archive 和 tombstone 的区别。

## Multi-Agent Execution Model

方案 3 可以使用 multi-agent 实现，但必须按独立 ownership 拆分，避免多个 agent 同时修改 shared files。

建议 agent 分工：

1. **Memory Lane / Schema Agent**
   - 负责 Trial / Validated / Core / review_queue / tombstone / archive / global core 的类型和存储边界。
   - 负责 Dream 残留命名与旧 lane 清理的 schema 层影响。

2. **Admission Gate Agent**
   - 负责 source-of-truth drop、implementation changelog drop、tombstone reason code、Trial quality gate、duplicate / normalized key 边界。

3. **Tokenizer / Retrieval Agent**
   - 负责 `src/memory/tokenizer.ts`。
   - 接入 retriever、activation、duplicate detection、normalized key、tombstone matching。

4. **Automation Agent**
   - 负责 Dream -> Memory Automation。
   - 负责 daily / weekly jobs、receipts、CLI / MCP / API naming，并移除 Dream public alias。

5. **Context Preview / Runtime Isolation Agent**
   - 负责 `memory context-preview`。
   - 负责验证 review_queue / tombstone / archive 不进入 runtime。
   - 负责 Trial 只进入 workflow hints。

6. **Docs / UI / Quality Agent**
   - 负责 README、skill、UI 文案、旧概念清理、最终 memory quality gate。

Shared files 只能由主控或单一 owner 修改，例如：

- central type definitions
- CLI command registry
- MCP tool registry
- package scripts
- generated plugin runtime rebuild output

## Agent Quality Gates

每个 agent 的完成标准不是“改完并通过局部测试”，而是必须证明它符合本 spec 的语义。

每个 agent 必须交付：

- 模块级单元测试。
- 至少 2-3 个真实场景 fixture / example。
- 至少 1 个负例测试，证明旧错误不会复发。
- 与相邻模块的 contract test。
- quality gate summary。

### Admission Gate Examples

必须通过：

- AGENTS.md 摘录候选 -> `drop(source_of_truth_excerpt)`，不落库。
- “更新了 CLI/UI/MCP/tests 支持新生命周期” -> `drop(implementation_changelog)`，不 tombstone。
- 低风险项目规则 -> `trial`。
- 用户明确拒绝的长期规则 -> `tombstone(user_rejected)`，带 `normalizedKey`。
- exact duplicate -> `drop(duplicate)`。
- repeated duplicate -> `tombstone(repeated_duplicate)`。

### Tokenizer Examples

必须通过：

- “多智能体审查” matches “multi-agent review”。
- “仓库更新验证” matches “repo update verification”。
- “上下文污染” matches “context pollution”。
- activation / retriever / duplicate detection 使用同一个 tokenizer。

### Runtime Isolation Examples

必须通过：

- `review_queue` 不进入 `workflowHints` / `planConstraints` / `checklistItems` / `profileCore`。
- `global_review_queue` 不进入 runtime context。
- `tombstone` 不进入 runtime context。
- `archived` 不进入 runtime context。
- `trial` 只能进入 `workflowHints`。
- `trial` 不能生成 must / required / verify checklist。
- `validated` / `core` / `global_core` 才能进入 constraints / checklist / profileCore。

### Automation Examples

必须通过：

- daily 自动清理低风险 Trial 噪音。
- daily 可以低风险 `trial -> validated`。
- daily 不提醒用户审查 high-risk review queue。
- weekly 汇总 high-risk review queue。
- weekly 可以低风险 `validated -> core`。
- weekly 生成 project core -> global core candidate。
- Dream 主命名不再出现在 public docs / UI / primary tool。

### UI / Docs Examples

必须通过：

- UI 不再显示 pending / active 作为 memory lifecycle。
- review_queue 是人工审核区，不是 Trial。
- README / skill / MCP docs 不再把 Dream 当核心概念。
- 用户能看到 Trial / Validated / Core / review_queue / global_core / global_review_queue 的位置。

## Release Quality Gate

最终合并前必须通过统一质量门：

1. `git diff --check`
2. `npm run typecheck`
3. full test suite
4. plugin build
5. plugin validation
6. memory context-preview fixture test
7. memory quality examples
8. public docs old-term scan
9. public API old Dream naming scan

public docs old-term scan 关注 README、plugin skill、MCP docs、CLI help、UI text 和 generated public runtime docs。历史 specs / plans 中引用旧概念作为背景说明时，不作为失败依据。

- pending / active 是否仍作为 lifecycle public concept 出现。
- Dream 是否仍作为 core product concept 出现。
- Trial 是否被描述为 manual review area。
- source-of-truth excerpt 是否仍可能进入 memory store。

## Success Criteria

本轮更新完成后，应满足：

1. Trial 只包含低风险、未来可用、项目内可验证的 memory。
2. source-of-truth 文档摘录不会进入 memory store。
3. implementation changelog / migration log 被 drop，不 rewrite，不 tombstone。
4. 中文查询能命中英文 technical memory，英文查询也能命中中文 memory。
5. usage feedback 能作为 daily / weekly automation evidence。
6. review_queue、global_review_queue、tombstone、archive 不污染 runtime context。
7. daily automation 自动维护低风险 Trial。
8. weekly automation 集中处理 high-risk review digest、core/global/profile candidate。
9. Dream 不再作为 public product concept。
10. 每个 agent 的输出都有 fixture-backed quality gate，证明行为符合预期。
