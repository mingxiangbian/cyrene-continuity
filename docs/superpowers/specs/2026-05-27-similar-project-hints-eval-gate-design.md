# Similar-Project Hints With Minimal Eval Gate Design

## 目标

在已经完成的 `Continuity Router MVP` 基础上，推进 v2 的下一阶段：让 `cyrene_continuity_get` 返回真实可用的 `similarProjectHints`，并引入最小 `eval gate`，防止相似项目检索把其他项目的 `local_only` 事实泄漏到当前项目。

本阶段的重点不是提升语义检索复杂度，而是先把跨项目 memory 的安全边界、数据结构、检索路径和可验证闸门打稳。SQLite/FTS 仍然是 runtime retrieval index；JSONL 仍然是 audit/recovery source of truth；Markdown 仍然只做人类 review/debug/projection。

## 成功标准

- `cyrene_continuity_get` 的 `similarProjectHints` 不再恒为空数组。
- Similar hint 只来自明确可迁移的 memory，不来自当前项目的 `local_only` fact。
- 每条 similar hint 明确标注为 transferable guidance，不是 current repo fact。
- `domain = personal | relationship | affective` 默认不进入 similar hints。
- SQLite index 能记录项目 fingerprint / metadata，并能保存项目相似度结果。
- `project_similarity` 只作为 hint routing 信号，不能绕过 `scope` / `portability` policy。
- 新增最小 `eval gate`，至少覆盖 `cross_project_leak_eval` 和 `similar_hint_boundary_eval`。
- 如果 eval gate 发现泄漏风险，`similarProjectHints` 必须返回空数组，并在 diagnostics 里说明原因。
- 系统没有 embedding provider 时仍完整可用。
- 现有 `globalMemory`、`projectMemory`、`pendingHypotheses`、`responseStrategy`、legacy `memory.items` 行为不被破坏。

## 非目标

- 不接 embedding provider。
- 不新增 `memory_embeddings` / `project_embeddings` 的 runtime 生成逻辑。
- 不实现 dream `deep-preview` / `deep-apply`。
- 不改 Daily Profile Reflection / profile candidate flow。
- 不自动 promote similar-project memory。
- 不让 `local_only` project memory 跨项目返回。
- 不把 personal / relationship / affective memory 当作跨项目 hint。
- 不新增复杂 UI。
- 不把 eval gate 做成完整策略引擎；本阶段只做最小可测试边界。

## 当前基础

当前 repo 已经具备：

- `cyrene_continuity_get` 返回分区 digest。
- `memory.db` 作为 SQLite/FTS runtime index。
- `MemoryPortability = local_only | project_family | similar_project | global`。
- `scope = global` 的 active memory 进入 `globalMemory`。
- 当前项目 `local_only` project memory 进入 `projectMemory`。
- pending candidates 进入 `pendingHypotheses`，并标注 `provisional: true`。
- `similarProjectHints` 字段存在，但当前恒为空数组。
- `codex memory db rebuild` 可以重建当前 global + current project roots。

本阶段必须复用这些边界，不重写 Router MVP。

## 设计原则

Similar-project retrieval 的语义是：

```txt
这个经验可能对当前项目有启发。
它不是当前项目事实。
它不能覆盖当前项目 memory。
它不能携带其他项目的私有事实、路径、配置、用户偏好或关系线索。
```

因此 similar hint 是低权限 digest section。它可以影响建议和提问，但不能作为事实回答依据。

## 数据模型

### Project Fingerprint

新增 `ProjectFingerprint`，用于描述项目形态，不保存不必要的敏感细节：

```ts
interface ProjectFingerprint {
  projectId: string
  displayName: string
  rootHash?: string
  remoteHash?: string
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'
  languages: string[]
  frameworks: string[]
  dependencyNames: string[]
  domainTags: string[]
  updatedAt: string
}
```

fingerprint 来源只包括当前 repo 可读的低敏元数据：

- `package.json` dependencies / devDependencies。
- lockfile 类型。
- 文件扩展名和顶层配置文件。
- 已 hash 的 git root / remote。
- 轻量 framework 线索，如 `vite`、`vitest`、`@modelcontextprotocol/sdk`、`typescript`。

不把绝对路径、完整 remote URL、源码内容、用户 prompt、transcript 内容写入 fingerprint。

### SQLite Schema 增量

在现有 `projects` 表基础上增加可选字段，或通过兼容 migration 补齐：

```sql
alter table projects add column languages_json text;
alter table projects add column package_manager text;
alter table projects add column frameworks_json text;
alter table projects add column dependency_fingerprint text;
alter table projects add column domain_tags_json text;
```

新增 `project_similarity`：

```sql
create table if not exists project_similarity (
  source_project_id text not null,
  target_project_id text not null,
  score real not null,
  reason_json text not null,
  updated_at text not null,
  primary key (source_project_id, target_project_id)
);
```

`source_project_id` 是当前项目，`target_project_id` 是候选相似项目。相似度可以对称计算，但落库方向按 query 方向保存，方便 diagnostics。

### Similar Hint Digest

新增 digest item：

```ts
interface SimilarProjectHint {
  id: string
  sourceProjectId: string
  sourceProjectName?: string
  domain: 'project' | 'procedural' | 'system'
  type: string
  strength: string
  portability: 'similar_project' | 'project_family'
  content: string
  score: number
  similarityScore: number
  transferable: true
  notCurrentProjectFact: true
  rationale: string
}
```

`content` 保留原 memory 的可迁移表达，但调用方必须通过 `transferable` 和 `notCurrentProjectFact` 理解它的低权限语义。

## Similarity 策略

本阶段使用 deterministic、无 provider 的相似度：

- package manager 相同加权。
- framework overlap 加权。
- dependency name overlap 加权。
- language overlap 加权。
- domain tags overlap 加权。
- git remote hash 只用于识别 exact/family，不用于暴露 remote。

不做 embedding，不调外部 API。

相似项目候选来源：

- SQLite `projects` 表中已 index 的其他项目。
- 当前 rebuild/sync 只保证当前 global + current project roots；因此需要扩展 Codex memory index roots 的发现能力，读取 `~/.cyrene/codex/projects/*/memory` 的已存在项目 root。
- 如果没有其他项目 root，`similarProjectHints` 返回空数组，并在 diagnostics 中说明 `no_similar_projects_indexed`。

## Retrieval Pipeline

`cyrene_continuity_get` 更新为：

1. Identify current project。
2. Build/read current `ProjectFingerprint`。
3. Rebuild/sync global、current project、known project roots 到 `memory.db`。
4. Upsert current project metadata 到 `projects`。
5. Compute/update `project_similarity` for current project against known project fingerprints。
6. Query active global memory。
7. Query active current project memory。
8. Query pending hypotheses。
9. Query similar-project candidate memories：
   - `status = active`
   - `home_project_id != currentProjectId`
   - `portability in ('similar_project', 'project_family')`
   - `domain in ('project', 'procedural', 'system')`
   - exclude `personal | relationship | affective`
   - obey task-specific retrieval eligibility
10. Run `eval gate` on candidate hints。
11. If eval passes, return token-budgeted `similarProjectHints`。
12. If eval fails, return `similarProjectHints: []` with diagnostics。
13. Compile digest and preserve legacy fields。

## Eval Gate

新增最小 eval runner，不做 LLM judge。第一阶段全部是 deterministic checks。

```ts
type EvalCheckName =
  | 'cross_project_leak_eval'
  | 'similar_hint_boundary_eval'

interface EvalResult {
  name: EvalCheckName
  passed: boolean
  severity: 'info' | 'warning' | 'error'
  findings: Array<{
    memoryId?: string
    reason: string
  }>
}
```

### cross_project_leak_eval

检查：

- candidate 不得来自 current project。
- candidate 不得是 `portability = local_only`。
- candidate 不得是 `scope = global` 的普通 global memory；global memory 已有自己的 digest section。
- candidate 不得缺少 `homeProjectId`。

任一 error 触发 gate fail。

### similar_hint_boundary_eval

检查：

- candidate domain 不得为 `personal`、`relationship`、`affective`。
- content 不应包含明显绝对路径。
- content 不应包含 raw remote URL。
- content 不应包含 review hash、candidate hash、token、secret-like 字符串。
- hint 输出必须包含 `transferable: true` 和 `notCurrentProjectFact: true`。

任一 error 触发 gate fail。

## Diagnostics

扩展 digest diagnostics：

```ts
diagnostics: {
  memoryIndex: {
    available: boolean
    reason?: string
    ftsTokenizer?: string
  }
  projectSimilarity?: {
    indexedProjects: number
    candidateProjects: number
    selectedProjects: number
    reason?: string
  }
  evalGate?: {
    passed: boolean
    failedChecks: string[]
  }
}
```

Diagnostics 面向 debugging，不应该让模型把失败细节当成用户事实。

## CLI

本阶段增加或扩展 CLI，保持最小：

```bash
cyrene-continuity codex memory db rebuild
cyrene-continuity codex eval run --check similar-hints
```

`eval run --check similar-hints` 只针对当前 cwd 输出 JSON 或简短文本 summary。它用于开发验证，不作为日常用户入口。

如果实现中发现 CLI 增加会牵连过大，可以先保留内部 `runCodexEvalGate()` API 和 tests，把 CLI 放到 plan 的后置任务；但 spec 要求 eval gate 本身必须可测试。

## Error Handling

- SQLite unavailable：沿用现有 JSONL fallback，`similarProjectHints` 返回空数组。
- project fingerprint 失败：不影响 global/project/pending retrieval，similar hints 返回空数组并记录 diagnostics。
- project root 扫描失败：只使用当前项目 root，不抛出 fatal error。
- similarity 表 migration 失败：similar hints 返回空数组，active memory retrieval fallback 或继续按 adapter diagnostics 处理。
- eval gate fail：不抛出 fatal error；返回空 hints 和 diagnostics。
- 单条 memory payload 损坏：跳过该条，不能让坏数据污染 hints。

## 测试策略

新增或更新测试：

- project fingerprint 不包含绝对路径或 raw remote。
- SQLite migration 创建 `project_similarity`，并能 upsert/query similarity。
- index roots 能发现多个 existing project memory roots。
- `portability = similar_project` 的 project/procedural/system memory 可以进入 hints。
- `local_only` memory 不进入 hints。
- personal / relationship / affective memory 不进入 hints。
- current project memory 不作为 similar hint 返回。
- eval gate 检出 cross-project leak 并让 hints 返回空数组。
- eval gate 检出 absolute path / raw remote / secret-like content。
- `cyrene_continuity_get` 保持 legacy fields 和现有 digest 字段兼容。
- 没有其他项目或没有 eligible memory 时，`similarProjectHints` 为空且 diagnostics 清楚。
- plugin runtime build 后仍暴露现有 MCP tools。

## 验收标准

- `npm test` 通过。
- `npm run typecheck` 通过。
- `npm run build:plugin` 通过。
- plugin validator 通过。
- 人工 MCP smoke test 能看到：
  - `similarProjectHints` 字段存在。
  - 有 eligible similar memory 时返回 hint。
  - 无 eligible similar memory 时返回空数组和非 fatal diagnostics。
- `memory.items` 不包含 similar hints。
- `projectMemory` 不包含其他项目的 `local_only` memory。

## 后续更新目标

本阶段完成后，下一批更新按以下顺序推进：

### 1. Dream Preview / Apply

- 把 `deep` 拆成 `deep-preview` 和 `deep-apply`。
- `deep-preview` 只生成 proposed changes，不 mutate active memory。
- `deep-apply` 必须经过 eval gate。
- 输出 `DREAM_REPORT.md`、`proposed_changes.json`、`diff.json`、`eval_results.json`。

### 2. Profile Candidate Flow / Daily Profile Reflection

- 将 Daily Self-Interview 重命名为 Daily Profile Reflection。
- Daily Profile Reflection 只产出 `profile_candidates`、open questions、conflict notes。
- 不直接写 active profile。
- 不把 assistant inference 当作用户长期偏好。

### 3. Optional Embedding Retrieval

- 在 FTS + structured policy + similar hints 稳定后再接 optional embedding cache。
- Embedding 只能作为 rerank 信号，不能绕过 scope/portability policy。
- 没有 embedding provider 时系统必须完整可用。

### 4. 更完整的 Eval Gate

- 增加 `pending_usage_eval`。
- 增加 `profile_pollution_eval`。
- 增加 `affective_boundary_eval`。
- 把 eval gate 接入 dream apply、profile promotion、similar-project transfer。

### 5. Similar Hint Review Tooling

- 增加 similar hint 的 review/debug 输出。
- 支持解释某条 hint 为什么被选中或被 gate 拒绝。
- 支持手动把某条 procedural memory 标记为 `similar_project`，但仍需 review hash 或等价确认。
