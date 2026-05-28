# Dream Preview / Apply And V2 Upgrade Train Design

## 目标

本次更新从已完成的 `Similar-Project Hints With Minimal Eval Gate` 继续推进 v2。核心目标是把当前会直接 mutate memory 的 `Dream Deep` 拆成明确的 `deep-preview` 和 `deep-apply`，并采用用户确认的严格迁移方案 A：

```txt
stage = deep 不再是可用阶段。
所有调用方必须迁移到 deep-preview 或 deep-apply。
```

本阶段同时把后续升级做成一条连续升级列车：先完成 Dream Preview / Apply 和必要 automation 迁移，再尽量推进更完整的 eval gate、Profile Candidate Flow / Daily Profile Reflection、Similar Hint Review Tooling，以及 optional embedding retrieval 的安全基础。每个阶段必须可测试、可回滚、可独立提交，不能为了“做完更多”牺牲 memory 安全边界。

## 成功标准

- `codex memory dream --stage deep` 被拒绝，错误信息指向 `deep-preview` 或 `deep-apply`。
- MCP tool `cyrene_memory_dream_run` 的 `stage` schema 不再接受 `deep`。
- `deep-preview` 只生成 proposed changes 和报告文件，不写 `index.jsonl`、`pending.jsonl`、`tombstones.jsonl`、`events.jsonl`、`MODEL_PROFILE.md`、`dream-state.json`。
- `deep-apply` 必须先经过 eval gate，只有 gate 通过后才允许写 active memory、pending memory、tombstone、promotion/rejection events、profile projection 和 dream success state；gate fail 只允许写非 mutation 诊断和 failed/skipped state。
- 现有 `light` 和 `rem` 行为保持兼容。
- 当前 active automation 不再调用 `--stage deep`。
- `cyrene-memory-dream-deep` automation 被迁移为等价的 `deep-apply` 调用，周期、cwd、model、reasoning effort、报告要求和功能语义保持不变。
- Daily interview automation 的用户侧行为保持不变；如果本轮实现 Profile Candidate Flow，只允许改内部 memory/profile candidate 写入策略。
- `npm test`、`npm run typecheck`、`npm run build:plugin`、plugin validator 和 MCP smoke test 通过。

## 非目标

- 不保留 `deep` alias。
- 不做静默 fallback；调用 `deep` 必须失败。
- 不让 `deep-preview` mutate memory 文件或 dream state。
- 不让 `deep-apply` 绕过 eval gate。
- 不在本阶段引入必须联网的 embedding provider。
- 不改变 pending promote/reject 的 review hash 手动审核边界。
- 不让 Daily Profile Reflection 直接写 active memory 或 active profile。
- 不改 unrelated automations，例如 `agent-evolution`、`skill-progression-map`、`github-weekly-trending-to-obsidian`。
- 不把 automation 配置当作 repo source 文件直接编辑；必须使用 Codex automation 工具迁移。

## 当前基础

当前 `runCodexMemoryDream()` 支持：

```ts
type CodexMemoryDreamStage = 'light' | 'rem' | 'deep'
```

现有行为：

- `light` 合并 duplicate pending candidates，并写 audit event / dream state。
- `rem` 评估 pending promotion 条件，并写 audit event / dream state。
- `deep` 获取 dream lock 后直接：
  - 读取 active / pending / tombstones。
  - 过期或 reject 不合格 pending。
  - promote 满足条件的 pending。
  - 写 `index.jsonl`、`pending.jsonl`、`tombstones.jsonl`、`events.jsonl`。
  - 跑 maintenance。
  - 渲染 `MODEL_PROFILE.md`。
  - 写 dream state。

本次更新要保留 `light` / `rem` 的已有职责，把 `deep` 的“计划”和“执行”拆开。

## 设计原则

Dream 的语义应改为：

```txt
Preview answers: 如果现在执行，会改变什么？
Apply answers: 这些改变是否通过 gate，并且是否已经落盘？
```

Preview 必须是低风险、可重复运行、可人工 review 的只读步骤。Apply 必须是带锁、带 gate、可审计的 mutation 步骤。任何自动化都不能再依赖模糊的 `deep`。

## Stage Model

更新 stage type：

```ts
type CodexMemoryDreamStage =
  | 'light'
  | 'rem'
  | 'deep-preview'
  | 'deep-apply'
```

CLI：

```bash
cyrene-continuity codex memory dream --stage deep-preview
cyrene-continuity codex memory dream --stage deep-apply
```

MCP input schema：

```ts
stage: z.enum(['light', 'rem', 'deep-preview', 'deep-apply']).optional()
```

默认 stage 建议改为 `deep-preview`，避免无参调用产生 mutation。现有 automation 必须显式调用 `deep-apply` 保持原来的深度应用功能。

如果用户或 automation 继续传入 `deep`，返回明确错误：

```txt
Invalid memory dream stage: deep. Use deep-preview to generate proposed changes or deep-apply to apply gated changes.
```

## Dream Proposal Model

新增 proposal 层，作为 preview 和 apply 共享的中间表示。

```ts
interface DreamProposal {
  id: string
  stage: 'deep-preview'
  createdAt: string
  project: { projectId: string; displayName: string }
  roots: DreamRootProposal[]
}

interface DreamRootProposal {
  memoryRoot: string
  proposedChanges: DreamProposedChange[]
  summary: {
    promote: number
    reject: number
    expire: number
    keepPending: number
    maintenanceWouldRun: boolean
  }
  evalGate: DreamEvalGateResult
}

type DreamProposedChange =
  | {
      action: 'promote'
      candidateId: string
      memoryId: string
      normalizedKey: string
      reason: string
      distinctEvidenceCount: number
    }
  | {
      action: 'reject'
      candidateId: string
      normalizedKey: string
      reason: string
      tombstoneReason: 'rejected' | 'expired'
    }
  | {
      action: 'keep_pending'
      candidateId: string
      normalizedKey: string
      reason: string
    }
```

Proposal 中不保存原始敏感证据全文。需要报告时使用 normalized key、candidate id、摘要 reason 和计数，不复制 raw quote。

## Preview 输出文件

`deep-preview` 在每个 memory root 下写入 preview artifacts，但不写 memory source files：

```txt
<memoryRoot>/dream-preview/
  DREAM_REPORT.md
  proposed_changes.json
  diff.json
  eval_results.json
```

这些文件是 review/debug artifacts，不是 source of truth。它们可以被覆盖为最新 preview。它们的存在不代表 apply 已执行。

### DREAM_REPORT.md

人类可读 summary，包含：

- root path。
- proposed promote/reject/keep counts。
- eval gate pass/fail。
- blocked reasons。
- apply command 提示。

不包含原始私人自白、raw quote、token、secret-like 字符串。

### proposed_changes.json

机器可读 proposal，用于测试和 apply 前复核。包含 `proposalId`、`createdAt`、`root proposals` 和 stable proposed changes。

### diff.json

逻辑 diff，不是文件 patch：

- active memory 会新增或更新哪些 ids。
- pending memory 会保留或移除哪些 ids。
- tombstone 会新增哪些 normalized keys。
- profile projection 是否会变化。

### eval_results.json

记录 eval gate 结果。Preview 阶段可以 fail，但 fail 只阻止 apply，不抛出 fatal error，除非 memory root 本身不安全。

## Deep Apply

`deep-apply` 的执行顺序：

1. Identify current project。
2. 获取 global + current project memory roots。
3. 对每个 root 获取 dream lock。
4. 在 lock 内重新读取 active / pending / tombstones。
5. 重新计算 proposal，不能盲信旧 preview artifact。
6. 运行 eval gate。
7. 如果 gate fail：
   - 不写 active / pending / tombstone / profile。
   - 可写 `dream-preview/eval_results.json` 和 apply result summary。
   - dream state 标记为 failed 或 skipped，原因是 eval gate blocked。
8. 如果 gate pass：
   - 写 active / pending / tombstone / events。
   - 跑 maintenance。
   - 渲染 `MODEL_PROFILE.md`。
   - 写 dream state success。
9. 返回 JSON summary。

Apply 重新计算 proposal 是必要的：preview 到 apply 之间 pending 可能变化，直接 replay 旧 artifact 会造成 stale write。

## Eval Gate

本阶段复用已有 deterministic eval runner 思路，扩展到 dream apply。建议新增：

```ts
type EvalCheckName =
  | 'cross_project_leak_eval'
  | 'similar_hint_boundary_eval'
  | 'pending_usage_eval'
  | 'profile_pollution_eval'
  | 'affective_boundary_eval'
```

### pending_usage_eval

检查：

- pending 不能被写入 `MODEL_PROFILE.md`。
- pending 只有在满足 `evaluatePendingPromotion()` 且 `validateMemoryCandidate()` 允许时才能 promote。
- assistant-derived candidates 不能被自动 promote。
- 缺少 auditable evidence 的 candidate 不能 promote。

### profile_pollution_eval

检查：

- `MODEL_PROFILE.md` 只能由 active memory 生成。
- Preview 不能改 profile。
- Daily Profile Reflection 的 profile candidates 不能直接进入 active profile。
- profile content 不包含 pending-only、raw interview answer 或 assistant inference。

### affective_boundary_eval

检查：

- 诊断式 affective claim 不能 promote。
- relationship / affective memory 的 profile projection 必须保持低敏、非诊断、非主观情感声明。
- 不能写入模型声称自己有主观感受的内容。

任一 error 触发 `deep-apply` fail-closed。

## CLI 与 MCP 行为

CLI usage 更新为：

```txt
memory dream [--stage light|rem|deep-preview|deep-apply]
```

MCP tool description 更新为：

```txt
Run a Cyrene Codex memory dream pass. Use deep-preview for read-only proposed changes and deep-apply for gated mutation.
```

MCP schema 不接受 `deep`。这会让旧调用尽早失败，迫使 automation 和手动命令迁移。

## Automation 迁移

本轮实现完成后必须更新 active automations，保证功能不变。

### 必须迁移

`/Users/phoenix/.codex/automations/cyrene-memory-dream-deep/automation.toml`

当前 prompt 包含：

```bash
/Users/phoenix/.cyrene/codex/bin/cyrene-continuity codex memory dream --stage deep
```

迁移后必须使用：

```bash
/Users/phoenix/.cyrene/codex/bin/cyrene-continuity codex memory dream --stage deep-apply
```

保持不变：

- `id = "cyrene-memory-dream-deep"`
- `name = "Cyrene Memory Dream Deep"`，除非用户另行要求改名。
- `rrule`
- `model`
- `reasoning_effort`
- `execution_environment`
- `cwds`
- 报告 JSON summary 的要求。
- 不修改 source files、不写 run notes、不绕过 Dream policy 的要求。

迁移必须使用 `automation_update`，不能直接编辑 TOML。迁移后必须读取 automation 配置复核，确认没有 active automation 继续调用 `--stage deep`。

### Daily interview automation

`每日存在主义自我访谈` 的用户侧功能必须保持：

- 每天 20:00。
- 只问 exactly 3 个中文问题。
- 用户回答后可以提出 pending-only memory candidate。
- 不直接 promote active memory。

如果本轮实现 Profile Candidate Flow / Daily Profile Reflection，则只更新内部写入策略：

- 产出 `profile_candidates` 或 pending-only candidates。
- 不把 assistant inference 直接写入 active profile。
- 不改变访谈问题数量、语言、时间和对用户的交互体验。

### 不应修改

以下 automations 与本轮 runtime breaking change 无直接关系，不应修改：

- `agent-evolution`
- `skill-progression-map`
- `github-weekly-trending-to-obsidian`

## Testing Strategy

新增或更新测试：

- CLI rejects `--stage deep` with migration guidance。
- CLI accepts `--stage deep-preview`。
- CLI accepts `--stage deep-apply`。
- MCP schema rejects `deep` and accepts `deep-preview` / `deep-apply`。
- `deep-preview` 生成 preview artifacts，但不创建或修改 `index.jsonl`、`pending.jsonl`、`tombstones.jsonl`、`MODEL_PROFILE.md`、dream state。
- `deep-preview` 对 promotable candidate 生成 promote proposed change。
- `deep-preview` 对 expired candidate 生成 reject/expired proposed change。
- `deep-apply` gate pass 后执行与旧 `deep` 等价的 promote/reject/maintenance/profile 行为。
- `deep-apply` gate fail 时 fail-closed，不写 active/pending/profile mutation。
- `pending_usage_eval` 阻止 assistant-derived 或缺少 auditable evidence 的 promotion。
- `profile_pollution_eval` 确认 profile 只来自 active memory。
- `affective_boundary_eval` 阻止 diagnostic affective claim。
- automation migration 后不再出现 `--stage deep`。
- plugin runtime build 后 MCP tools 仍暴露。

## 验收命令

实现完成后至少运行：

```bash
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
/Users/phoenix/.cyrene/codex/bin/cyrene-continuity codex memory dream --stage deep-preview
/Users/phoenix/.cyrene/codex/bin/cyrene-continuity codex memory dream --stage deep-apply
```

还必须做 MCP smoke test，确认 `cyrene_memory_dream_run` 接受 `deep-preview` / `deep-apply`，拒绝 `deep`。

Automation 验收：

```bash
rg -- '--stage deep(\\s|\"|$)' /Users/phoenix/.codex/automations
```

预期：没有 active automation 仍调用 `--stage deep`。如果文档历史或旧注释被匹配，需要人工区分；active prompt 不能包含旧命令。

## 风险与取舍

### Breaking change 风险

严格方案 A 会破坏任何继续传 `deep` 的调用方。这个风险由两层控制：

- 错误信息必须清楚。
- 本轮必须迁移已知 active automation。

不做 alias 是刻意选择：`deep` 的语义已经不够精确，继续兼容会让自动化调用者不知道自己是在 preview 还是 apply。

### Preview artifact 风险

Preview artifacts 可能被误认为事实。通过命名和内容约束降低风险：

- 放在 `dream-preview/`。
- 报告明确写 `not applied`。
- Apply 永远重新计算 proposal，不 replay artifact。

### Eval gate 复杂度风险

Eval gate 不能变成大型策略引擎。本阶段只做 deterministic checks。后续如果接 LLM judge，必须作为 advisory 或二级信号，不能替代 structured policy。

## 本轮升级范围建议

为了“做完或尽量多完成”但保持可验证，implementation plan 应按以下阶段连续推进：

1. Dream strict stage migration。
2. Read-only `deep-preview` proposal artifacts。
3. Gated `deep-apply`。
4. Extended eval gate。
5. Automation migration。
6. Profile Candidate Flow / Daily Profile Reflection，如果前五项完成且测试稳定。
7. Similar Hint Review Tooling，如果 profile flow 完成后仍无 blocker。
8. Optional Embedding Retrieval 的安全基础，如果不会引入 provider/runtime 不稳定性。

前五项是本轮必须完成的最小完整升级。后续三项是尽量推进项，必须在 spec/plan 中单独成 task，不能和 Dream mutation 混在一个不可审查的大改里。

## 后续升级方向

### 1. Profile Candidate Flow / Daily Profile Reflection

- 将 Daily Self-Interview 语义升级为 Daily Profile Reflection。
- Daily Profile Reflection 只产出 `profile_candidates`、open questions、conflict notes。
- Profile candidate 默认 pending-only。
- 不直接写 active memory。
- 不直接写 `MODEL_PROFILE.md`。
- 不把 assistant inference 当作用户长期偏好。
- 用户侧每日三问体验保持不变，除非用户另行要求。

### 2. Profile Apply Gate

- 增加 profile candidate apply path。
- profile apply 必须经过 `profile_pollution_eval` 和 `affective_boundary_eval`。
- profile apply 只接受 active memory 或用户明确批准的 candidate。
- 输出 profile diff，显示哪些 section 会变化。

### 3. Similar Hint Review Tooling

- 增加 CLI/debug 输出，解释某条 similar hint 为什么入选。
- 支持解释某条 hint 为什么被 gate 拒绝。
- 支持按 memory id 或 source project id 查询。
- 支持手动将 procedural/project/system memory 标记为 `similar_project`，但必须经过 review hash 或等价确认。
- Review tooling 只解释和辅助审核，不自动提升权限。

### 4. 更完整的 Eval Gate

- 把 eval gate 统一为可复用模块，覆盖 dream apply、profile apply、similar-project transfer。
- 增加 check-level diagnostics 和 machine-readable findings。
- 保持 deterministic checks 为主。
- LLM judge 如果加入，只能作为 advisory，不允许绕过 structured fail-closed checks。

### 5. Optional Embedding Retrieval

- 增加 optional embedding provider interface。
- 增加 embedding cache schema。
- Embedding 只作为 rerank 信号。
- Embedding 不能绕过 `scope`、`portability`、`domain` 和 eval gate。
- 没有 provider 或 provider 失败时，FTS + structured filters 必须完整可用。
- 不把 raw private content 发给 provider，除非用户显式开启并接受隐私边界。

### 6. Dream Review UX

- 增加 `codex memory dream report` 或等价 CLI。
- 支持查看最新 `DREAM_REPORT.md`。
- 支持输出 JSON summary，方便 automation 报告。
- 支持 explain 单条 proposed change 的原因、证据计数和 gate status。

### 7. Migration / Doctor Enhancements

- `codex doctor` 检查是否仍有 automation 调用 `--stage deep`。
- `codex doctor` 检查 stable shim 是否可运行 `deep-preview` 和 `deep-apply`。
- `codex doctor` 提示旧文档或旧 automation prompt 的迁移建议。
