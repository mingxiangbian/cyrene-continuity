# Candidate Hint Feedback Receipt 设计

日期：2026-06-12
状态：Draft，已完成口头设计确认，等待用户审阅书面 spec

## 背景

2026-06-11 的 Trial / Active 状态机 repair 已确认采用独立 `candidateHints`
section，让低风险、强相关的 project trial memory 可以作为候选提示展示给 agent，
但不进入普通 `memory.items`、`projectMemory` 或 `activation`。

这解决了 trial memory 被误读成 validated/core active memory 的问题，但留下一个反馈闭环缺口：

- 原 repair spec 已写明：只有 Candidate Hint 确实展示过，且 agent 明确采纳或跳过时，才允许记录 `applied` 或 `ignored` feedback。
- 当前 `recordCodexMemoryFeedback` 只能校验 active memory 存在、`contentHash` 匹配、以及 `applied` 带 `query` 或 `evidenceRef`。
- 当前测试只用 `activationId: candidate-hint:<id>` 作为约定；后端不能验证该 hint 是否来自本轮 context build。
- `plugin/skills/cyrene-continuity/SKILL.md` 只要求对 `activation` 里的 active activation item 记录 feedback，没有明确覆盖 `candidateHints`。
- `cyrene_memory_feedback` 的 MCP 描述仍强调 active memory usage feedback，容易让 agent 忽略 candidate hint feedback。

因此，本设计的目标是把“确实展示过”从文档约束变成可校验数据，同时保持 Candidate Hint 的只读 trial projection 边界。

## 目标

- 为每条 model-visible Candidate Hint 输出一个可复算、短期有效的 selection receipt。
- 继续使用现有 `cyrene_memory_feedback` / `recordCodexMemoryFeedback` 入口，不新增专用 MCP 工具。
- 让 candidate hint 的 `applied` / `ignored` feedback 必须携带 receipt，并由后端验证。
- 保持 receipt 只证明“本轮 context build 选出并展示过该 hint”，不把 retrieval 或 selection 本身当作使用证据。
- 保持 daily lifecycle 行为不变：`ignored` 中性，`corrected` / `violated` 阻止晋升，`applied >= 2` 才可能 `trial -> validated`。

## 非目标

- 不把 Candidate Hint 合并进 `activation.workflowHints`。
- 不把 trial memory 放回普通 active memory output。
- 不新增 `cyrene_candidate_hint_feedback` 工具。
- 不把 selection/ranking 事件写成 activation feedback。
- 不保存原始用户 query、transcript、candidate text 或完整 context snapshot 作为 receipt。
- 不重新设计 trial promotion、expiration、review queue 或 similar-project hints。

## 设计概述

在 `getCodexContinuityContext` 的一次 context build 中生成一个 `contextId`。同一 context build 中返回的所有 `candidateHints` 共用该 `contextId`。

每条 Candidate Hint 增加 `selectionReceipt`：

```ts
interface CandidateHintSelectionReceipt {
  version: 1
  contextId: string
  hintId: string
  memoryId: string
  contentHash: string
  projectId: string
  mode: 'balanced' | 'review'
  selectedAt: string
  receiptHash: string
}
```

`contextId` 使用随机 UUID 或等价不可预测 token。`receiptHash` 使用 HMAC-SHA256 生成，
输入是去掉 `receiptHash` 后的 receipt 字段稳定 JSON，key 是本地 Candidate Hint
receipt verification key。hash 输出截断为 32 个 hex 字符即可。

Receipt verification key 是本地 runtime 密钥，不是 memory content，不进入 profile、dashboard、
export、benchmark report 或 MCP 返回值。实现可以在首次需要 Candidate Hint receipt 时生成并保存该 key；
这属于本地 verifier 初始化，不是 per-selection state，也不能写入 activation feedback 或 semantic memory。

receipt 不包含 hint text、raw query、raw transcript 或 memory content。

当 agent 实际采纳某条 Candidate Hint，或明确决定跳过某条已展示 Candidate Hint 时，调用现有 `cyrene_memory_feedback`，并附带 `candidateHintReceipt`：

```json
{
  "memoryId": "...",
  "contentHash": "...",
  "event": "applied",
  "query": "...",
  "activationId": "candidate-hint:<hintId>",
  "candidateHintReceipt": {
    "version": 1,
    "contextId": "...",
    "hintId": "...",
    "memoryId": "...",
    "contentHash": "...",
    "projectId": "...",
    "mode": "balanced",
    "selectedAt": "...",
    "receiptHash": "..."
  }
}
```

## 行为契约

Candidate Hint selection 本身仍然满足原 repair 约束：

- `fast` mode 不返回 Candidate Hints。
- `balanced` 最多返回 1 条 Candidate Hint。
- `review` 最多返回 3 条 Candidate Hints。
- Candidate Hints 只包含 `status: active`、`scope: project`、`confidenceTier: trial`、`activationMode: workflow_hint` 的低风险 memory。
- Candidate Hints 不进入 `memory.items`、`projectMemory`、`activation.planConstraints` 或 `activation.checklistItems`。
- Selection 不写 memory、不刷新 `expiresAt`、不记录 feedback。

Candidate Hint feedback 满足新的 receipt 约束：

- `activationId` 使用 `candidate-hint:<hintId>`。
- candidate hint 的 `applied` 和 `ignored` 都必须带 `candidateHintReceipt`。
- receipt 必须与 `memoryId`、`contentHash`、当前 `projectId` 和 `activationId` 匹配。
- receipt 必须在 TTL 内。初始 TTL 为 24 小时。
- receipt hash 必须可由 receipt 的其他字段和本地 verification key 复算为 HMAC。
- `applied` 仍必须带 `query` 或 `evidenceRef`。
- `corrected` / `violated` 仍必须带 `reason`。

如果没有实际采纳、没有明确跳过、只是被 selector 排名或在 diagnostics 中出现，不记录 feedback。

## 数据流

1. `cyrene_continuity_get` 调用 `getCodexContinuityContext`。
2. `getCodexContinuityContext` 生成 `contextId`，并把它传入 Candidate Hint selection / labeling path。
3. selector 仍只负责返回符合条件的 Candidate Hints；receipt 生成发生在 context assembly 的 model-visible labeling 阶段。
4. 返回给 agent 的 `candidateHints[]` 每项包含 `selectionReceipt`。
5. agent 读取 `candidateHints` 后，如果实际按某条 hint 行动，完成相关行动后调用 `cyrene_memory_feedback`，事件为 `applied`，并传入 receipt。
6. agent 如果明确判断不采用某条已展示 hint，可以调用 `cyrene_memory_feedback`，事件为 `ignored`，并传入 receipt。
7. `recordCodexMemoryFeedback` 校验 receipt 和 hash 后写 activation event。
8. daily lifecycle 继续只消费 activation events，不读取 Candidate Hint selection state。

## 校验规则

`recordCodexMemoryFeedback` 对带 candidate hint 语义的 feedback 执行额外校验。触发 candidate hint 语义的条件为：

- 输入包含 `candidateHintReceipt`；或
- `activationId` 以 `candidate-hint:` 开头。

触发后必须满足：

- `candidateHintReceipt` 存在。
- `candidateHintReceipt.version === 1`。
- `candidateHintReceipt.memoryId === input.memoryId`。
- `candidateHintReceipt.contentHash === input.contentHash`。
- `candidateHintReceipt.projectId === currentProjectId`。
- `candidateHintReceipt.hintId` 与 `activationId: candidate-hint:<hintId>` 一致。
- `candidateHintReceipt.mode` 是 `balanced` 或 `review`。
- `candidateHintReceipt.selectedAt` 是有效 ISO 时间，且未超过 24 小时 TTL。
- `candidateHintReceipt.receiptHash` 与本地 receipt verification key 复算出的 HMAC 一致。

失败时返回 `invalid_request`，reason 使用稳定、可诊断但不泄露原文的文案：

- `candidate hint receipt is required for candidate-hint activation`
- `candidate hint receipt does not match memory id`
- `candidate hint receipt does not match content hash`
- `candidate hint receipt does not match project id`
- `candidate hint receipt does not match activation id`
- `candidate hint receipt expired`
- `candidate hint receipt hash mismatch`

普通 active memory feedback 不受 receipt 约束；除非调用者传了 `candidateHintReceipt` 或 `activationId: candidate-hint:*`。

## 数据与隐私

Receipt 只包含验证所需的元数据：

- 不包含 raw query。
- 不包含 transcript。
- 不包含 Candidate Hint 文案。
- 不包含 memory content。
- 不包含 review queue pending content。
- 不包含 receipt verification key。

Activation event 继续保存 `queryHash`，不保存 raw query。Candidate Hint feedback event
必须保留以下审计字段：

- `activationId`
- `contentHash`
- `queryHash` 或 `evidenceRef`
- `candidateHintContextId`
- `candidateHintReceiptHash`

Event 不写完整 `candidateHintReceipt`，避免把可重放凭证长期保存在 activation log 中。

Receipt verification key 必须保存在本地运行数据中，不能提交到 Git，不能通过 MCP、CLI、UI
或 benchmark artifact 输出。若 key 文件缺失，context build 先生成新 key，再生成 receipt。
若 key 文件不可读或生成失败，context build fail closed：不返回 Candidate Hints，并记录
candidate hint metrics 为 selected 0。Feedback 校验在缺少可读 key 时必须返回
`invalid_request`，不能接受 candidate hint feedback。

## Skill 与工具契约

`plugin/skills/cyrene-continuity/SKILL.md` 需要拆清两类 feedback：

1. Active activation feedback：当 `cyrene_continuity_get` 返回 `activation.workflowHints`、`activation.planConstraints` 或 `activation.checklistItems`，且 agent 实际应用、忽略、纠正或发现违反时，按现有规则调用 `cyrene_memory_feedback`。
2. Candidate Hint feedback：当 `cyrene_continuity_get` 返回 `candidateHints`，且 agent 实际采纳或明确跳过某条 Candidate Hint 时，必须带该 hint 的 `selectionReceipt` 调用 `cyrene_memory_feedback`。未采纳、未明确跳过、仅展示或仅排序不记录 feedback。

`cyrene_memory_feedback` 的 MCP 描述应从 active memory usage feedback 扩展为：

```text
Record hash-checked active memory usage feedback or receipt-bound candidate hint usage feedback as lifecycle evidence; this never promotes, edits, archives, or tombstones memory directly.
```

CLI 文档需要增加 candidate receipt 参数。建议参数名为：

```sh
--candidate-hint-receipt '<json>'
```

MCP schema 增加 `candidateHintReceipt` object；CLI 解析 JSON 后传给同一底层函数。

## 错误处理

- Candidate Hint receipt 校验失败必须 fail closed，不写 activation event。
- `contentHash` 冲突继续返回现有 conflict 语义。
- 过期 receipt 不能自动刷新；agent 需要重新获取 continuity context。
- 普通 active memory feedback 不需要 receipt，避免破坏现有调用方。
- 如果实现无法解析 CLI receipt JSON，CLI 应抛出参数错误，不进入 feedback write。

## 测试要求

Context assembly tests：

- `balanced` Candidate Hint 包含 `selectionReceipt`。
- `review` 多条 Candidate Hints 共享同一个 `contextId`。
- `fast` 仍不返回 Candidate Hints。
- Receipt 不包含 raw query、candidate text、memory content 或 transcript 字段。
- Receipt hash 可用本地 verification key 复算。

Feedback validation tests：

- `activationId: candidate-hint:<id>` 缺 receipt 返回 `invalid_request`。
- receipt 缺失、version 错误、memory id 不匹配、content hash 不匹配、project id 不匹配、hint id 不匹配、mode 无效、hash 不匹配、TTL 过期均返回 `invalid_request`。
- 用普通 SHA 或错误 key 伪造的 receipt 返回 `invalid_request`。
- 匹配 receipt 的 `applied` 写入 activation event，并保留 `activationId`、`contentHash`、`queryHash`。
- 匹配 receipt 的 `ignored` 写入 activation event，并保持 neutral。
- Candidate Hint feedback event 保留 `candidateHintContextId` 和 `candidateHintReceiptHash`，但不保留完整 receipt。
- 普通 active memory feedback 不传 receipt 仍保持现有行为。

Lifecycle compatibility tests：

- Candidate Hint selection 不产生 activation events。
- `ignored` 不推动 trial promotion。
- 两次 receipt-bound `applied` 后，daily lifecycle 仍通过原有 low-risk/source/eval/cap gates 才能晋升。
- `corrected` / `violated` 仍阻止 trial auto-promotion。

MCP/CLI tests：

- `cyrene_memory_feedback` schema 接受 `candidateHintReceipt`。
- CLI `memory feedback` 支持 `--candidate-hint-receipt`。
- CLI receipt JSON 无效时失败且不写 event。

## Execution Model

该设计是一个单一 implementation slice，可以分工但不应拆成多个独立 feature：

- Context owner：在 Candidate Hint model-visible output 中生成 receipt，并补 context assembly tests。
- Feedback owner：扩展 feedback input/schema/validation，并补 invalid/valid receipt tests。
- Instruction owner：更新 Cyrene skill、MCP/CLI docs 和 tool description。
- Verification owner：运行 focused tests、`npm test`、`npm run typecheck`；如 runtime 变化，运行 `npm run build:plugin` 并确认 generated diff。

依赖顺序：

1. 先定义 receipt type、local verification key helper 和 HMAC helper。
2. 再接入 context output。
3. 再扩展 feedback validation。
4. 最后更新 skill/docs/runtime 并跑完整验证。

并行性：

- Receipt type/key/hash helper 需要先落地。
- Context output 和 feedback validation 可在 helper 完成后并行。
- Skill/docs 更新可与测试补充并行，但最终必须与实际 schema 字段一致。

## Acceptance Criteria

- Candidate Hints 仍然是独立 trial-only section。
- 每条 model-visible Candidate Hint 都带可复算、短期有效的 selection receipt。
- Candidate hint 的 `applied` / `ignored` feedback 必须带 receipt，否则 fail closed。
- Receipt mismatch 或 expired 时不写 activation event。
- 普通 active memory feedback 不受新 receipt 要求影响。
- Selection 本身不产生 feedback，也不改变 memory state。
- Daily lifecycle 仍只消费 activation feedback 和既有 gates。
- Skill、MCP 描述、CLI 文档和测试都明确 candidate hint feedback 的调用条件。
