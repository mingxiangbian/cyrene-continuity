# Cyrene Continuity v4 P0 Active Project Memory Harvester Design

## 目标

把 Cyrene 从“能显示状态的 memory review system”推进到“能从真实项目活动中主动生成 project memory candidates”的 P0 阶段。

本 spec 只覆盖 Project Memory Harvester，不覆盖 Local Web UI。目标是让插件安装后通过 Codex lifecycle hooks 稳定采集项目活动，并在每个 turn 的 `Stop` 阶段生成 pending-only project memory candidates。

成功标准：

- `SessionStart` / `UserPromptSubmit` / `PostToolUse` 能记录轻量 project trace。
- `Stop` 在 turn 结束时汇总 trace、transcript、git/project snapshot，生成项目 pending candidates。
- 手动 `cyrene-continuity codex memory harvest-project` 和 MCP `cyrene_memory_harvest_project` 复用同一条 harvester 链路。
- 输出只写当前 project memory root 的 `pending.jsonl`。
- active memory 仍然必须用户明确 approve + matching review hash。

## 非目标

- 不做 Local Web UI、Tauri 或桌面包装。
- 不自动 promote active memory。
- 不让 `PostToolUse` 即时生成 candidates。
- 不修改 personal/profile reflection 语义。
- 不从 project harvester 生成 global pending candidates。
- 不保存完整 raw prompt、raw tool output、raw diff 或 raw patch。
- 不把缺失模型配置变成 Codex turn blocker。

## 总体架构

```txt
Plugin hooks
  SessionStart / UserPromptSubmit / PostToolUse / Stop
        ↓
HookTraceStore
  append-only trace JSONL
        ↓
ProjectSignalCollector
  trace + transcript + last assistant message + git status/diff + manifests + README/AGENTS + recent summaries
        ↓
ProjectMemoryHarvester
  deterministic rules produce signals
  LLM filters/rewrites/classifies durable project candidates
        ↓
proposeCodexMemoryCandidate
  pending-only review, approval hash required as today
```

`UserPromptSubmit` 和 `PostToolUse` 只负责采集证据。`Stop` 是唯一自动候选生成点。手动 `harvest-project` 与 `Stop` 使用同一个 collector/extractor，避免两套逻辑漂移。

## Hook Lifecycle

插件新增 `plugin/hooks/hooks.json`，声明：

```txt
SessionStart      -> cyrene-continuity codex hook session-start
UserPromptSubmit  -> cyrene-continuity codex hook user-prompt-submit
PostToolUse       -> cyrene-continuity codex hook post-tool-use
Stop              -> cyrene-continuity codex hook stop
```

`cyrene-continuity codex hook stop` 保留为正式入口，不视为 legacy。已经通过 `cyrene-continuity codex install-hook --stop` 安装过 Stop hook 的用户继续可用；该入口内部升级为“现有 review summary + ProjectMemoryHarvester”。

Hook 处理原则：

- 所有 hook fail-open，不能阻断 Codex turn。
- 默认保持 `suppressOutput: true`。
- `CYRENE_HOOK_VISIBLE=1` 时只输出短状态：summary 状态、harvest 状态、pending candidate 数量、`codex memory review` 提示。
- 不输出 candidate 全文，避免污染对话和泄漏敏感内容。

## HookTraceStore

Trace 写入当前 project memory root：

```txt
<project-memory-root>/hook-trace.jsonl
```

每行一个受控事件：

```ts
{
  id: string
  createdAt: string
  sessionId?: string
  turnId?: string
  event: 'session_start' | 'user_prompt_submit' | 'post_tool_use' | 'stop'
  cwd: string
  summary: string
  signals: string[]
  tool?: {
    name: string
    useId?: string
    commandSummary?: string
    exitCode?: number
    touchedFiles?: string[]
    outputSummary?: string
  }
}
```

Trace 只保存摘要和结构化 signals：

- `UserPromptSubmit` 保存 redacted prompt summary 和 durable-intent hints。
- `PostToolUse` 保存 tool name、命令摘要、exit status、可推断 touched files、短 output summary。
- `Stop` 写 turn summary trace，并运行 project harvester。
- 读取窗口限制为最近 100 条或最近 7 天，避免长期增长进入 prompt。
- malformed JSONL 单行跳过并生成 warning，不让整次 harvest 失败。

## 模型配置与 API Key

Trace 写入和 deterministic signal collection 不需要模型 API。

ProjectMemoryHarvester 的 LLM filter/rewrite 阶段复用现有 OpenAI-compatible chat completions 配置：

```txt
CYRENE_BASE_URL
CYRENE_MODEL
CYRENE_API_KEY
CYRENE_CHEAP_MODEL
CYRENE_STRONG_MODEL
```

`CYRENE_API_KEY` 是否必需取决于目标 provider 是否需要 Bearer auth。Harvester 不新增专用 API key，不把 key 写入 trace、summary、pending memory 或 hook output。

模型配置缺失时：

- hook trace 仍然写入。
- deterministic signals 仍然可生成。
- `harvest-project --dry-run` 返回 signals 和 `needs_model_config` warning。
- 自动 `Stop` harvest 不写 pending candidates，并返回 fail-open warning。
- CLI/MCP 输出明确提示缺少的 env var。

这个降级策略避免因为没有模型配置而阻断 Codex，同时保持“需要 LLM 才生成自然语言候选”的边界清楚。

## ProjectSignalCollector

Collector 读取这些输入：

```txt
git status --short
git diff --name-only
git diff --stat
package.json
tsconfig.json
plugin/.codex-plugin/plugin.json
plugin/.mcp.json
README.md
AGENTS.md
tests/
recent review-summaries.jsonl
recent hook-trace.jsonl
```

Collector 输出 structured signals，不直接写 pending memory。规则示例：

```txt
plugin/.codex-plugin/plugin.json changed
-> plugin packaging behavior may have changed

AGENTS.md changed
-> repository workflow/policy changed

tests added or changed after failed command
-> known pitfall or regression guard may have been established

README command examples changed
-> workflow_rule candidate may be warranted

hook trace shows repeated failed command then passing command
-> known_pitfall or workflow_rule candidate may be warranted
```

Collector 必须在非 git repo 中降级运行：跳过 git signals，但仍读取 manifests、README、AGENTS、review summaries 和 trace。

## ProjectMemoryHarvester

Harvester 分两层：

1. Deterministic rules 生成候选 signals。
2. LLM filter/rewrite 将强 signals 转成 memory candidate schema。

LLM prompt 约束：

```txt
Extract only durable project memory candidates.

Allowed candidate_kind:
- project_fact
- project_decision
- workflow_rule
- known_pitfall
- rejected_approach
- open_question

Reject:
- one-time task status
- vague impressions
- assistant self-praise
- user psychology
- private data
- secrets
- temporary command output

Prefer candidates when:
- a design decision was made
- a command/workflow was confirmed
- a previous approach was rejected
- a repeated failure/pitfall appeared
- a project boundary or policy was clarified
```

Candidate defaults:

- `scope: "project"` always.
- `domain: "project"` by default。
- `domain: "procedural"` only for repo workflow rules。
- `source: "tool_trace"` or `"file"`。
- `strength: "soft"` by default。
- `strength: "hard"` only for explicit repository policy or documented command contracts。
- `userConfirmed` remains unset; approval still happens later through review.

P0 harvester never writes global pending candidates. Cross-project/global memory remains explicit-only through existing review mechanisms.

## Candidate Kind

`candidate_kind` 不取代现有 `domain` / `type`。它是 review UX 和项目记忆行为分类。

P0 需要修正 review summary runtime，使它正式解析：

```txt
candidateKind
candidate_kind
```

并传给 `proposeCodexMemoryCandidate()`。这样模型输出的 project taxonomy 不会被丢弃，只靠 `type` 或 `tags` 反推。

允许的 project harvester kinds：

```txt
project_fact
project_decision
workflow_rule
known_pitfall
rejected_approach
open_question
```

`user_instruction` 不由 project harvester 生成；它仍属于显式用户指令或其他 memory proposal flow。

## CLI

新增：

```bash
cyrene-continuity codex memory harvest-project
cyrene-continuity codex memory harvest-project --changed-files
cyrene-continuity codex memory harvest-project --dry-run
cyrene-continuity codex memory harvest-project --since last-summary
```

P0 行为：

- 默认模式：读取最近 trace、review summaries 和 project snapshot，写入 project pending。
- `--changed-files`：聚焦当前 working tree changed files。
- `--dry-run`：返回 signals 和 candidate preview，不写 pending。
- `--since last-summary`：设计为 public option；实现可先 alias 到默认模式并返回 warning，避免先引入复杂 checkpoint。

输出 shape：

```ts
{
  project: { projectId: string; displayName: string }
  action: 'dry_run' | 'pending' | 'noop' | 'failed'
  signalCount: number
  candidateIds: string[]
  candidatesPreview?: Array<{
    candidateKind: string
    domain: string
    type: string
    scope: string
    content: string
    evidenceCount: number
  }>
  warnings: string[]
}
```

## MCP

新增 tool：

```txt
cyrene_memory_harvest_project
```

Input：

```ts
{
  mode?: 'default' | 'changed_files'
  dryRun?: boolean
}
```

Output 复用 CLI result shape。

MCP handler 不接受 caller-controlled `cwd`；沿用 server fallback cwd，保持现有 R2 修复边界。

## Global Memory 现状和边界

当前 global memory 仍通过现有显式路径生成：

- Stop hook 识别明确 all-project/global durable instruction，写入 global pending。
- MCP `cyrene_memory_propose` 传 `scope: "global"`，写入 global pending。
- Review CLI/MCP approve 后，global pending 进入 global active `index.jsonl`。

ProjectMemoryHarvester 不参与 global memory 生成。项目活动默认只属于当前 project root，避免把某个 repo 的流程误扩散到所有项目。

## Error Handling

- Hook handler 失败时返回有效 Codex hook JSON，`continue: true`。
- transcript、trace、git、manifest 读取失败时收集 warning，并使用剩余 signals。
- LLM request 失败时不写 pending，记录 failed harvest result。
- LLM 返回 invalid JSON 或 invalid candidate schema 时跳过无效 candidate；如果全部无效，返回 `noop` 或 `failed`，不写空 pending。
- pending write 继续走 `proposeCodexMemoryCandidate()`，复用 validator、merge、review hash、dream due 标记和 index sync。
- `CYRENE_HOOK_VISIBLE=1` 输出只包含状态和数量。

## Documentation Updates

需要更新：

- `README.md`
  - lifecycle hooks are bundled by plugin
  - `harvest-project` CLI examples
  - model config / API key requirements
  - pending-only approval policy
- `plugin/skills/cyrene-continuity/SKILL.md`
  - when to call `cyrene_memory_harvest_project`
  - how to review pending project memory
  - no automatic global memory from harvester
- `plugin/hooks/hooks.json`
  - bundled lifecycle config

如果 `plugin/skills/cyrene-continuity/SKILL.md` changes, verification must include `npm run build:plugin` and plugin validation.

## Testing

Test coverage:

```txt
HookTraceStore
- appends valid session/user/tool/stop trace events
- redacts prompt/tool output
- skips malformed JSONL lines
- limits recent trace window

ProjectSignalCollector
- handles git repo and non-git repo
- summarizes changed files without storing full diff
- reads manifests/README/AGENTS safely
- includes recent review summaries and hook traces

ProjectMemoryHarvester
- dry-run does not write pending
- default mode writes project-root pending only
- changed-files mode limits signals
- missing model config returns needs_model_config without writing pending
- LLM invalid JSON/invalid candidate schema is skipped or failed cleanly
- candidateKind/candidate_kind survives into pending review
- duplicate candidates merge through existing pending upsert behavior

Hook handlers
- fail-open output shape is valid Codex hook JSON
- Stop calls review summary and project harvester
- visible mode returns short status only
- PostToolUse never writes pending directly

CLI/MCP
- CLI routes memory harvest-project
- MCP exposes cyrene_memory_harvest_project
- MCP smoke test includes new tool
```

Verification commands:

```bash
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
git diff --check
```

## Rollout

1. Implement `HookTraceStore` and hook command routing.
2. Implement `ProjectSignalCollector`.
3. Implement `ProjectMemoryHarvester` and project-only prompt.
4. Add CLI `codex memory harvest-project`.
5. Add MCP `cyrene_memory_harvest_project`.
6. Bundle `plugin/hooks/hooks.json`.
7. Update README and skill docs.
8. Build plugin runtime and validate plugin.

P0 is complete when a normal Codex turn can leave trace, `Stop` can generate project pending candidates when model config exists, and missing model config produces a clear warning without blocking Codex.
