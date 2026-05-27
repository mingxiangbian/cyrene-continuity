# Cyrene Router MVP With SQLite/FTS Design

## 目标

把 `cyrene-continuity` 从 v1 的 JSONL/Markdown memory bridge 升级为 v2 第一阶段的 `Continuity Router MVP`。本阶段重点是让 `cyrene_continuity_get` 返回结构化、可控、不会污染事实判断的 continuity digest，并引入 SQLite/FTS5 作为 runtime retrieval index。

本阶段不是完整 v2。完整 v2 里的 similar-project retrieval、embedding、dream preview/apply、profile candidate flow、eval gate 会作为下一次更新目标保留在 spec 中，但不进入本阶段实现。

## 成功标准

- Codex 仍然主要调用 `cyrene_continuity_get` 获取上下文。
- Runtime retrieval 优先使用 `~/.cyrene/codex/memory.db`，而不是让模型读散落的 JSONL/Markdown 文件。
- 现有 `index.jsonl`、`pending.jsonl`、`events.jsonl`、`tombstones.jsonl` 保持为 audit/recovery 层。
- Digest 明确分开 `globalMemory`、`projectMemory`、`pendingHypotheses`、`responseStrategy`、`reviewReminders`、`similarProjectHints`。
- Pending candidates 可以作为 provisional hypotheses 出现在 digest 中，但不能被当作 active memory 或事实。
- `similarProjectHints` 在本阶段保留为空数组，API 形状向 v2 靠拢，但不实现 similar-project 检索。
- `MODEL_PROFILE.md` 继续只投影 active memory，不投影 pending hypotheses。

## 非目标

- 不实现 similar-project retrieval。
- 不计算项目相似度，不写项目迁移 hint。
- 不接 embedding provider。
- 不实现 `memory_embeddings` 或 `project_embeddings` 的生成逻辑。
- 不拆分 dream 为 `deep-preview` / `deep-apply`。
- 不新增完整 `cyrene_eval_run`。
- 不新增一组 router MCP tools。保留现有 MCP tool 名称和兼容输入。
- 不改变 pending promote/reject 的 review-hash 安全边界。
- 不让 pending candidates 进入 `MODEL_PROFILE.md`。
- 不重写 Stop hook、Daily Profile Reflection、PreToolUse、SessionStart 等 hook 策略。

## 当前系统约束

当前 repo 已经有以下基础：

- MCP server 和 `cyrene_continuity_get`。
- `global` 与 `project` memory root。
- active memory 存在 `index.jsonl`。
- pending memory 存在 `pending.jsonl`。
- pending promote/reject 使用 review hash。
- dream `light` / `rem` / `deep` 已有基础流程。
- `MODEL_PROFILE.md` 是 generated projection。
- `memory-retriever` 目前主要依赖 token overlap。

设计必须保留这些路径，避免一次性迁移破坏已经可用的 plugin bridge。

## 架构

采用三层存储模型：

```txt
JSONL:
  append/audit/recovery source

SQLite memory.db:
  runtime retrieval index

Markdown projections:
  human review/debug only
```

`memory.db` 不取代 JSONL 的审计角色。写入 memory 时仍写现有 JSONL 文件；SQLite 通过 sync/rebuild 从 JSONL 更新，作为快速检索和 routing 的 runtime index。

## SQLite Runtime 适配

SQLite 是本阶段最大的适配风险，必须先通过 adapter 层隔离。实现时新增 `MemoryIndexAdapter` 或等价接口，业务代码只依赖：

- `initialize()`
- `rebuildFromRoots()`
- `syncRoot()`
- `queryActive()`
- `queryPending()`
- `diagnostics()`

首选实现是 `node:sqlite`，因为它不需要 native npm dependency，也更适合当前 standalone plugin bundle。实现前必须验证 Codex plugin runtime 使用的 Node 版本支持 `node:sqlite` 和 FTS5。本地当前 runtime 已支持 `node:sqlite`，但 repo 当前 `engines.node` 仍是 `>=20`，因此实现 plan 必须二选一：

1. 如果正式采用 `node:sqlite`，同步把 `engines.node` 提升到实际需要的最低版本，并让 `codex doctor` 检测不兼容 Node。
2. 如果必须继续支持 Node 20，SQLite adapter 要保持可选，`cyrene_continuity_get` 在 adapter 不可用时 fallback 到 JSONL retrieval。

第一阶段不建议引入 `better-sqlite3` 或 `sqlite3` native dependency，除非先证明 plugin bundle、install、runtime smoke test 都能稳定携带 native binary。

## 文件布局

```txt
~/.cyrene/codex/
  memory.db
  global/
    memory/
      index.jsonl
      pending.jsonl
      events.jsonl
      tombstones.jsonl
      MODEL_PROFILE.md
  projects/
    <projectId>/
      memory/
        index.jsonl
        pending.jsonl
        events.jsonl
        tombstones.jsonl
        MODEL_PROFILE.md
```

本阶段不新增大量 runtime Markdown 文件。已有 generated projection 继续保持短、可 review、非 source of truth。

## 数据模型

保留现有 `MemoryScope`：

```ts
type MemoryScope = 'global' | 'project' | 'session'
```

新增最小 `MemoryPortability`：

```ts
type MemoryPortability =
  | 'local_only'
  | 'global'
  | 'project_family'
  | 'similar_project'
```

本阶段只实际使用：

- `global`：跨所有项目可用。
- `local_only`：只能用于 home project 或当前 exact project。

`project_family` 和 `similar_project` 只进入 type/schema，为下一阶段保留，不参与 retrieval 逻辑。

默认映射：

- `scope = global` 的 active memory：`portability = global`。
- `scope = project` 的 active memory：`portability = local_only`。
- `scope = session` 的 memory：不进入常规 continuity digest，除非 `task = memory` 且仍未过期。

## SQLite Schema

第一阶段使用最小 schema：

```sql
create table if not exists projects (
  project_id text primary key,
  root_hash text,
  remote_hash text,
  name text,
  created_at text not null,
  updated_at text not null
);

create table if not exists memories (
  id text primary key,
  scope text not null,
  domain text not null,
  type text not null,
  strength text not null,
  status text not null,
  home_project_id text,
  portability text not null,
  content text not null,
  normalized_key text not null,
  tags_json text not null,
  scores_json text not null,
  source text not null,
  profile_visibility text,
  first_seen_at text,
  last_seen_at text,
  created_at text not null,
  updated_at text not null,
  expires_at text
);

create table if not exists memory_evidence (
  id text primary key,
  memory_id text not null,
  source_kind text,
  project_id text,
  session_id text,
  run_id text,
  evidence_group_id text,
  quote_hash text,
  summary text,
  created_at text not null
);

create virtual table if not exists memories_fts
using fts5(content, normalized_key, tags, tokenize='trigram', content='memories', content_rowid='rowid');
```

FTS tokenizer 需要 runtime probe。优先使用 `trigram`，因为它更适合中英文混合和 substring-heavy memory query；如果当前 SQLite build 不支持 `trigram`，fallback 到 `unicode61` 并保留现有 token scorer 作为 rerank/fallback。无论使用哪个 tokenizer，scope/portability 都必须由 structured filters 决定，不能由 FTS 匹配结果决定。

本阶段不创建实际使用的 embedding 表。可以在 migration 注释中预留 future migration，但不要写未使用 runtime 逻辑。

## Sync / Rebuild 策略

新增 SQLite index 模块，负责：

- 初始化 `memory.db` 和 migrations。
- 从 global/project JSONL roots 读取 active 和 pending records。
- Upsert 到 `memories`，保留 `status = active | pending | rejected | archived`。
- 为 FTS 表同步 `content`、`normalized_key`、`tags`。
- 支持 `cyrene db rebuild` 或等价内部 rebuild 函数。

写入路径保持保守：

- `cyrene_memory_propose` 继续写 `pending.jsonl`。
- promote/reject 继续写现有 JSONL 和 tombstone/event。
- 写入完成后可以触发 best-effort SQLite sync。
- 如果 SQLite sync 失败，memory 写入不应被破坏；`cyrene_continuity_get` 可以 fallback 到 JSONL retrieval 并返回 diagnostics。

## Retrieval Pipeline

`cyrene_continuity_get` 的 pipeline：

1. Identify current project。
2. Ensure/read SQLite index；必要时 best-effort sync 当前 global/project roots。
3. Retrieve active global memory：`status = active`、`scope = global`、`portability = global`。
4. Retrieve active project memory：`status = active`、`home_project_id = currentProjectId`、`portability = local_only`。
5. Retrieve pending candidates：global pending + current project pending，按 query relevance、safety、sensitivity、lastSeenAt 排序。
6. Compile `responseStrategy`，继续使用现有 affect/strategy logic，但只输出 policy hint。
7. Compile token-budgeted digest。
8. Return `similarProjectHints: []`。

FTS relevance 负责文本匹配，structured filters 负责安全边界。不能只靠全文检索决定 scope。

## Digest Shape

`cyrene_continuity_get` 继续保持向后兼容，同时增加 v2 digest 字段。建议返回：

```ts
interface ContinuityDigest {
  project: {
    projectId: string
    displayName: string
  }
  memory: {
    items: LegacyMemoryDigestItem[]
  }
  globalMemory: MemoryDigestItem[]
  projectMemory: MemoryDigestItem[]
  pendingHypotheses: PendingHypothesis[]
  similarProjectHints: []
  responseStrategy: CodexStrategyHint
  reviewReminders: ReviewReminder[]
  profile: {
    global?: string
    project?: string
    content: string
  }
  pendingReview: CodexPendingReviewNotice
  strategy: LegacyStrategy
  dissent: LegacyDissent
}
```

`memory.items`、`profile`、`pendingReview`、`strategy`、`dissent` 保持兼容，避免破坏现有 skill 和 tests。新消费方应优先使用 `globalMemory`、`projectMemory`、`pendingHypotheses`、`responseStrategy`。

## Pending Hypotheses 策略

Pending 可以读，但必须被降级呈现：

```txt
Pending hypotheses are provisional and unconfirmed.
Use them for clarification, conflict detection, or review suggestions.
Do not treat them as settled user preferences, project facts, or active memory.
```

实现要求：

- Pending 不进入 `memory.items`。
- Pending 不进入 `MODEL_PROFILE.md`。
- Pending 不参与 active fact answer。
- Pending 可以触发 `reviewReminders`。
- Pending 可以帮助 agent 决定是否向用户请求确认。
- Pending 必须带 `provisional: true` 或等价字段。

## Token Budget

第一阶段默认预算：

```txt
globalMemory: 500 tokens
projectMemory: 900 tokens
pendingHypotheses: 400 tokens
responseStrategy: 200 tokens
reviewReminders: 150 tokens
similarProjectHints: 0 tokens
```

总 digest 目标控制在 2000 到 2500 tokens 内。超过预算时优先保留：

1. hard/system/procedural project memory
2. high-safety global procedural memory
3. relevant pending review reminders
4. lower-confidence personal/relationship hints

## Response Strategy Overlay

本阶段继续坚持 Codex plugin 边界：

- 不注入 `You are Cyrene`。
- 不声称 Cyrene 有 subjective emotion。
- 不输出心理诊断、依赖暗示、浪漫化关系描述。
- 只输出 compact strategy hint：
  - `tone`
  - `verbosity`
  - `challengePolicy`
  - `avoid`
  - `rationale`

`responseStrategy` 可以影响回答方式，但不能覆盖 Codex personality。

## Error Handling

- `memory.db` 不存在：自动初始化。
- migration 失败：返回明确 error，不写坏 JSONL。
- SQLite sync 失败：`cyrene_continuity_get` fallback 到当前 JSONL retrieval，并在 digest diagnostics 中说明。
- FTS 不可用：fallback 到 structured query + current token scorer。
- SQLite adapter 不可用：fallback 到 JSONL retrieval，并在 diagnostics 中暴露原因。
- JSONL 解析失败：跳过损坏行或返回可定位 diagnostics，不能静默污染 index。
- Pending record 缺少必要字段：不进入 `pendingHypotheses`，保留在 review list 中等待人工处理。

## 测试策略

新增或更新测试覆盖：

- `memory.db` 初始化和 migration。
- SQLite adapter diagnostics；如果采用 `node:sqlite`，测试不兼容 runtime 会得到清晰错误或 JSONL fallback。
- JSONL active memory sync 到 SQLite。
- JSONL pending memory sync 到 SQLite。
- FTS query 能找到中文和英文 memory；如果 `trigram` 不可用，测试 fallback tokenizer + token scorer。
- `scope = global` 返回到 `globalMemory`。
- 当前项目 `scope = project` 返回到 `projectMemory`。
- 其他项目 `local_only` memory 不返回。
- Pending 返回到 `pendingHypotheses`，不返回到 `memory.items`。
- Pending 不进入 `MODEL_PROFILE.md`。
- `similarProjectHints` 在本阶段恒为空数组。
- SQLite 故障时 fallback 到 JSONL retrieval。
- 旧字段保持兼容，现有 MCP tests 不破。

## 验收标准

- `npm test` 通过。
- `npm run typecheck` 通过。
- `cyrene_continuity_get` 返回新 digest 字段。
- 当前 active global/project memory 分区正确。
- Pending candidates 可读但始终标记为 provisional。
- Similar-project hints 不实现且返回空。
- `MODEL_PROFILE.md` 仍只投影 active memory。
- Plugin MCP tool 名称和输入保持兼容。
- 没有新增 personality override 或 claimed sentience language。

## 下一次更新目标

下一次更新从本阶段的 Router MVP 继续推进，不回头重做基础数据层。

### 1. Similar-Project Hints

- 增加 project fingerprint。
- 增加 `project_similarity` 表。
- 支持 `portability = similar_project` 的 procedural hint。
- Similar hint 必须标注为 transferable guidance，不是当前 repo fact。
- 防止 `local_only` memory 跨项目泄漏。

### 2. Dream Preview / Apply

- 把 `deep` 拆为 `deep-preview` 和 `deep-apply`。
- `deep-preview` 只生成 proposed changes，不 mutate active memory。
- `deep-apply` 必须经过 eval gate。
- 输出 `DREAM_REPORT.md`、`proposed_changes.json`、`diff.json`、`eval_results.json`。

### 3. Minimal Eval Gate

- 增加 `pending_usage_eval`。
- 增加 `cross_project_leak_eval`。
- 增加 `profile_pollution_eval`。
- 增加 `affective_boundary_eval`。
- 在 dream apply、profile promotion、similar-project transfer 前运行。

### 4. Profile Candidate Flow

- 将 Daily Self-Interview 重命名为 Daily Profile Reflection。
- Daily Profile Reflection 只产出 `profile_candidates`、open questions、conflict notes。
- 不直接写 active profile。
- 不把 assistant inference 当作用户长期偏好。

### 5. Optional Embedding Retrieval

- 在 FTS/structured filters 稳定后再引入 optional embedding cache。
- Embedding 只能作为 rerank 信号，不能绕过 scope/portability policy。
- 没有 embedding provider 时系统必须完整可用。
