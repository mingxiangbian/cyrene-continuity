# Dream Preview / Apply And V2 Upgrade Train Design

## 目标

本次更新从已完成的 `Similar-Project Hints With Minimal Eval Gate` 继续推进 v2。核心目标是把当前会直接 mutate memory 的 `Dream Deep` 拆成明确的 `deep-preview` 和 `deep-apply`，并采用用户确认的严格迁移方案 A：

```txt
stage = deep 不再是可用阶段。
所有调用方必须迁移到 deep-preview 或 deep-apply。
```

本轮不再把 Profile Candidate Flow、Profile Apply Gate、Similar Hint Review Tooling、更完整的 eval gate、Optional Embedding Retrieval 安全基础留到后续。它们与 Dream Preview / Apply 的安全边界有重合，全部纳入本次升级范围，按阶段连续实现、测试和提交。

本次升级的原则是：全量纳入，不混成一团。每个子系统必须有独立接口、独立测试和独立验收；如果某一项遇到 runtime 或外部 provider blocker，必须保留前面阶段的可合并状态，并把 blocker 限定在该子系统内。

## 成功标准

- `codex memory dream --stage deep` 被拒绝，错误信息指向 `deep-preview` 或 `deep-apply`。
- MCP tool `cyrene_memory_dream_run` 的 `stage` schema 不再接受 `deep`。
- `deep-preview` 只生成 proposed changes 和报告文件，不写 `index.jsonl`、`pending.jsonl`、`tombstones.jsonl`、`events.jsonl`、`MODEL_PROFILE.md`、`dream-state.json`。
- `deep-apply` 必须先经过 eval gate，只有 gate 通过后才允许写 active memory、pending memory、tombstone、promotion/rejection events、profile projection 和 dream success state；gate fail 只允许写非 mutation 诊断和 failed/skipped state。
- 现有 `light` 和 `rem` 行为保持兼容。
- 当前 active automation 不再调用 `--stage deep`。
- `cyrene-memory-dream-deep` automation 被迁移为等价的 `deep-apply` 调用，周期、cwd、model、reasoning effort、报告要求和功能语义保持不变。
- Daily interview automation 的用户侧行为保持不变；Profile Candidate Flow 只允许改内部 memory/profile candidate 写入策略。
- Profile Candidate Flow / Daily Profile Reflection 完成本轮实现：daily reflection 只产出 `profile_candidates`、open questions、conflict notes，不直接写 active memory 或 active profile。
- Profile Apply Gate 完成本轮实现：profile candidate apply 必须经过 `profile_pollution_eval` 和 `affective_boundary_eval`，并输出 profile diff。
- Similar Hint Review Tooling 完成本轮实现：可以解释某条 similar hint 为什么入选或被 gate 拒绝，并支持受控的 `similar_project` portability 标记流程。
- Optional Embedding Retrieval 完成本轮安全基础：实现 provider interface、cache schema、rerank 接入和 no-provider fallback；外部 provider 调用必须显式 opt-in。
- `codex doctor` 能检查 `--stage deep` 迁移、stable shim 的 `deep-preview` / `deep-apply` 可用性，以及 embedding/provider 配置状态。
- `npm test`、`npm run typecheck`、`npm run build:plugin`、plugin validator 和 MCP smoke test 通过。

## 非目标

- 不保留 `deep` alias。
- 不做静默 fallback；调用 `deep` 必须失败。
- 不让 `deep-preview` mutate memory 文件或 dream state。
- 不让 `deep-apply` 绕过 eval gate。
- 不把联网 embedding provider 设为必需依赖；provider 调用必须显式 opt-in。
- 不改变 pending promote/reject 的 review hash 手动审核边界。
- 不让 Daily Profile Reflection 直接写 active memory 或 active profile。
- 不改 unrelated automations，例如 `agent-evolution`、`skill-progression-map`、`github-weekly-trending-to-obsidian`。
- 不把 automation 配置当作 repo source 文件直接编辑；必须使用 Codex automation 工具迁移。

## 本轮完整范围

本轮必须完成以下 11 个子系统，计划可以分 task 执行，但 spec 不再把 3-11 作为可选后续项：

1. Dream strict stage migration。
2. Read-only `deep-preview` proposal artifacts。
3. Gated `deep-apply`。
4. Unified Eval Gate。
5. Automation migration。
6. Profile Candidate Flow / Daily Profile Reflection。
7. Profile Apply Gate。
8. Similar Hint Review Tooling。
9. Optional Embedding Retrieval 安全基础。
10. Dream Review UX。
11. Doctor / Migration checks。

其中 Optional Embedding Retrieval 的“完成”定义不是强制连外部 API，而是完成 opt-in provider interface、embedding cache、rerank integration、diagnostics 和 fallback。没有 provider 时系统仍必须完整可用。

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
memory dream report [--root global|project]
profile reflect [--source daily-interview]
profile apply --candidate <id> --review-hash <hash>
similar-hints explain [--memory-id <id>|--source-project-id <projectId>]
similar-hints mark-transferable --memory-id <id> --review-hash <hash>
```

MCP tool description 更新为：

```txt
Run a Cyrene Codex memory dream pass. Use deep-preview for read-only proposed changes and deep-apply for gated mutation.
```

MCP schema 不接受 `deep`。这会让旧调用尽早失败，迫使 automation 和手动命令迁移。

## Profile Candidate Flow / Daily Profile Reflection

新增 profile candidate 层，用于承接 Daily Profile Reflection 和其他 profile-related insight。它不是 active memory，也不是 `MODEL_PROFILE.md` 的输入。

```ts
interface ProfileCandidate {
  id: string
  scope: 'global' | 'project'
  status: 'pending' | 'applied' | 'rejected'
  source: 'daily_profile_reflection' | 'manual_review' | 'memory_dream'
  proposedSection:
    | 'Always Apply'
    | 'Project Context'
    | 'Interaction Preferences'
    | 'Response Policy'
    | 'Restricted Notes'
  content: string
  rationale: string
  sourceMemoryIds: string[]
  evidenceSummary: string
  createdAt: string
  updatedAt: string
  reviewHash: string
}
```

存储位置：

```txt
<memoryRoot>/profile_candidates.jsonl
```

Daily Profile Reflection 的职责：

- 基于用户回答和 active continuity context 产出 profile candidates、open questions、conflict notes。
- 不直接调用 active memory promotion。
- 不直接写 `MODEL_PROFILE.md`。
- 不保存 raw private answer；只保存 review-safe abstract candidate。
- 对 assistant inference 降级处理：可以生成 open question 或 conflict note，不能生成可直接 apply 的 hard preference。

CLI：

```bash
cyrene-continuity codex profile reflect --source daily-interview
```

输出 JSON：

```ts
interface ProfileReflectionResult {
  project: { projectId: string; displayName: string }
  candidates: ProfileCandidate[]
  openQuestions: Array<{ id: string; question: string; rationale: string }>
  conflictNotes: Array<{ id: string; summary: string; candidateIds: string[] }>
}
```

Daily interview automation 的用户侧 prompt 保持 exactly 3 个中文问题；如果用户回答触发候选写入，内部从 `cyrene_memory_propose` 逐步迁移为 profile candidate / pending-only memory candidate 的组合，但不改变用户看到的访谈流程。

## Profile Apply Gate

新增 profile apply path：

```bash
cyrene-continuity codex profile apply --candidate <id> --review-hash <hash>
```

Apply 流程：

1. 读取 `profile_candidates.jsonl`。
2. 根据 `<id>` 找到 `status = pending` 的 candidate。
3. 校验 `--review-hash` 是否匹配 candidate 的 `reviewHash`。
4. 运行 `profile_pollution_eval` 和 `affective_boundary_eval`。
5. 生成 profile diff。
6. gate pass 后，把 candidate 标记为 `applied`，并把对应内容转换为 active memory 或 profile projection input。
7. 重新生成 `MODEL_PROFILE.md`。

Profile diff：

```ts
interface ProfileDiff {
  candidateId: string
  section: ProfileCandidate['proposedSection']
  before: string
  after: string
  addedLines: string[]
  removedLines: string[]
}
```

Profile apply 不能直接把 pending-only text 拼进 markdown。最终 profile 仍必须由 active memory 或明确 applied candidate 的 structured record 生成。

## Similar Hint Review Tooling

Similar hint review tooling 是 explain / audit 工具，不是自动 promotion 工具。

CLI：

```bash
cyrene-continuity codex similar-hints explain --memory-id <id>
cyrene-continuity codex similar-hints explain --source-project-id <projectId>
cyrene-continuity codex similar-hints mark-transferable --memory-id <id> --review-hash <hash>
```

`explain` 输出：

```ts
interface SimilarHintExplanation {
  memoryId: string
  sourceProjectId: string
  selected: boolean
  similarityScore?: number
  portability: string
  domain: string
  allowedByPolicy: boolean
  gateFindings: Array<{ check: string; severity: string; reason: string }>
  rationale: string
}
```

`mark-transferable` 只能把 eligible `project | procedural | system` memory 标记为 `portability = similar_project`。它必须：

- 要求 review hash。
- 拒绝 `personal | relationship | affective`。
- 拒绝 `local_only` private facts that contain paths, remotes, secrets, or current-project-only wording。
- 写 audit event。
- 触发 SQLite index sync。

## Optional Embedding Retrieval 安全基础

本轮实现 embedding 的安全基础，但不要求默认启用外部 provider。

新增 provider interface：

```ts
interface EmbeddingProvider {
  name: string
  embed(input: { texts: string[]; purpose: 'memory_rerank' | 'project_similarity' }): Promise<number[][]>
}
```

新增 cache schema：

```sql
create table if not exists memory_embeddings (
  memory_id text not null,
  provider text not null,
  model text not null,
  content_hash text not null,
  embedding_json text not null,
  created_at text not null,
  primary key (memory_id, provider, model, content_hash)
);

create table if not exists project_embeddings (
  project_id text not null,
  provider text not null,
  model text not null,
  fingerprint_hash text not null,
  embedding_json text not null,
  created_at text not null,
  primary key (project_id, provider, model, fingerprint_hash)
);
```

启用规则：

- 默认 disabled。
- 只有配置了 provider env 和 explicit enable flag 时才调用 provider。
- Provider 失败时返回 diagnostics，retrieval fallback 到 FTS + structured filters。
- Embedding 只能 rerank 已通过 structured policy 的候选。
- 不向 provider 发送 raw private evidence、raw interview answer、secret-like content、absolute local path 或 raw remote URL。

Diagnostics：

```ts
embedding?: {
  enabled: boolean
  provider?: string
  cacheHits: number
  cacheMisses: number
  fallbackReason?: string
}
```

## Doctor / Migration Checks

`codex doctor` 增加检查：

- 是否存在 active automation prompt 调用 `--stage deep`。
- stable shim 是否能执行 `codex memory dream --stage deep-preview`。
- stable shim 是否能执行 `codex memory dream --stage deep-apply`。
- MCP schema 是否已拒绝 `deep`。
- embedding provider 是否 disabled / enabled / misconfigured。
- profile candidate store 是否可读写。

Doctor 只报告状态和建议，不直接修改 automation 或 memory。

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

本轮实现 Profile Candidate Flow / Daily Profile Reflection 时，只更新内部写入策略：

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
- `profile reflect --source daily-interview` 只生成 profile candidates / open questions / conflict notes，不写 active profile。
- `profile apply --candidate <id> --review-hash <hash>` 在 gate pass 后生成 profile diff 并更新 profile source；gate fail 时不写 profile。
- similar hint explain 能说明 selected / rejected 的原因和 gate findings。
- similar hint mark-transferable 要求 review hash，拒绝 personal / relationship / affective memory。
- embedding provider 默认 disabled。
- embedding provider enabled 时只 rerank structured-policy-approved candidates。
- embedding provider unavailable 时 fallback 到 FTS + structured filters。
- `codex doctor` 报告 automation `--stage deep` 迁移状态、stable shim dream stages、embedding provider 状态和 profile candidate store 状态。
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
/Users/phoenix/.cyrene/codex/bin/cyrene-continuity codex profile reflect --source daily-interview
/Users/phoenix/.cyrene/codex/bin/cyrene-continuity codex similar-hints explain --source-project-id b717665028a2ca0a
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

## 本轮实施顺序

为了全量完成但保持可验证，implementation plan 应按以下阶段连续推进：

1. Dream strict stage migration。
2. Read-only `deep-preview` proposal artifacts。
3. Gated `deep-apply`。
4. Unified Eval Gate。
5. Automation migration。
6. Profile Candidate Flow / Daily Profile Reflection。
7. Profile Apply Gate。
8. Similar Hint Review Tooling。
9. Optional Embedding Retrieval 安全基础。
10. Dream Review UX。
11. Doctor / Migration checks。

每个阶段必须独立测试和提交。后续阶段可以依赖前面阶段的接口，但不能修改已验证阶段的语义，除非测试先证明原语义不满足本 spec。

## 完成本轮后的后续方向

本轮完成后，后续才考虑以下增强：

### 1. External Embedding Provider Implementations

- 为具体 provider 增加生产级 adapter。
- 增加 provider-specific rate limit、batching、retry 和 cost diagnostics。
- 增加用户级隐私开关和 per-domain redaction policy。

### 2. LLM-Assisted Eval Advisory

- 在 deterministic gate 之后增加 advisory judge。
- advisory judge 只能提供 warning 和解释，不能覆盖 structured fail-closed checks。
- 所有 LLM judge prompt 和输入都要可审计。

### 3. Review UI

- 在 CLI 稳定后再考虑 Web/UI 或 TUI review surface。
- UI 只读展示 preview、profile candidates、similar hint explanation 和 eval results。
- Apply 操作仍必须走 review hash 或等价确认。

### 4. Cross-Project Transfer Policy Tuning

- 基于实际使用反馈调整 similarity scoring 权重。
- 增加 per-project allowlist / denylist。
- 增加 family-level transfer policy，但不能绕过 portability 和 eval gate。
