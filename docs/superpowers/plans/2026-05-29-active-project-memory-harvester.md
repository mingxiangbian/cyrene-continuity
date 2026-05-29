# Active Project Memory Harvester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Cyrene v4 P0 Active Project Memory Harvester so Codex lifecycle hooks collect project activity and `Stop`/manual harvest generate project-scoped pending memory candidates.

**Architecture:** Add a trace-first pipeline: lightweight lifecycle hooks append sanitized trace records, a collector converts trace/git/project files into structured signals, and a project-only harvester uses existing model config to rewrite durable signals into pending-only memory candidates. Keep global memory and active promotion unchanged.

**Tech Stack:** TypeScript, Node.js 20, Vitest, Commander-style CLI routing, MCP SDK tool registration, existing Cyrene JSONL memory store and OpenAI-compatible `callModel()`.

---

## File Structure

- Modify `src/codex/review-summary-runtime.ts`: preserve `candidateKind` / `candidate_kind` from model candidates.
- Create `src/codex/hook-trace-store.ts`: append/read sanitized hook trace JSONL under the current project memory root.
- Create `src/codex/codex-hook-trace.ts`: non-Stop lifecycle hook handlers and payload summarization.
- Create `src/codex/project-memory-signals.ts`: collect git/project/review/trace signals.
- Create `src/codex/project-memory-harvester.ts`: run project-only LLM extraction and write project pending candidates.
- Modify `src/codex/codex-hook-stop.ts`: append stop trace, call project harvester after existing review summary, keep fail-open behavior.
- Modify `src/codex/codex-cli.ts`: route new hook commands and `memory harvest-project`.
- Create `src/mcp/tools/memory-harvest-project.ts`: MCP handler for project harvest.
- Modify `src/mcp/mcp-server.ts`: register `cyrene_memory_harvest_project`.
- Add `plugin/hooks/hooks.json`: bundled lifecycle hook declarations.
- Modify `README.md` and `plugin/skills/cyrene-continuity/SKILL.md`: document lifecycle hooks, API key behavior, harvester CLI/MCP, and project-only pending policy.
- Add tests:
  - `tests/codex-review-summary-runtime.test.ts`
  - `tests/codex-hook-trace-store.test.ts`
  - `tests/codex-hook-trace.test.ts`
  - `tests/project-memory-signals.test.ts`
  - `tests/project-memory-harvester.test.ts`
  - `tests/codex-hook-stop.test.ts`
  - `tests/codex-cli.test.ts`
  - `tests/mcp-server.test.ts`

## Shared Interfaces

Use these names consistently across tasks.

```ts
export type CodexHookTraceEventName =
  | 'session_start'
  | 'user_prompt_submit'
  | 'post_tool_use'
  | 'stop'

export interface CodexHookTraceTool {
  name: string
  useId?: string
  commandSummary?: string
  exitCode?: number
  touchedFiles?: string[]
  outputSummary?: string
}

export interface CodexHookTraceRecord {
  id: string
  createdAt: string
  sessionId?: string
  turnId?: string
  event: CodexHookTraceEventName
  cwd: string
  summary: string
  signals: string[]
  tool?: CodexHookTraceTool
}

export type CodexProjectHarvestMode = 'default' | 'changed_files'

export interface CodexProjectHarvestResult {
  project: { projectId: string; displayName: string }
  action: 'dry_run' | 'pending' | 'noop' | 'failed'
  signalCount: number
  candidateIds: string[]
  candidatesPreview?: CodexProjectHarvestCandidatePreview[]
  warnings: string[]
}
```

## Task 1: Preserve `candidateKind` in Review Summary Runtime

**Files:**
- Modify: `src/codex/review-summary-runtime.ts`
- Modify: `tests/codex-review-summary-runtime.test.ts`

- [ ] **Step 1: Write failing test for camelCase `candidateKind`**

Add a test to `tests/codex-review-summary-runtime.test.ts`:

```ts
it('preserves candidateKind from review summary candidates', async () => {
  const home = await createTempDir('cyrene-review-runtime-kind-home-')
  vi.stubEnv('HOME', home)
  const cwd = await createTempDir('cyrene-review-runtime-kind-project-')

  const result = await runCodexReviewSummary({
    cwd,
    messages: [{ role: 'assistant', content: 'Implemented plugin hook packaging decision.' }],
    config: createConfig(cwd),
    callModel: async () =>
      modelResponse(JSON.stringify({
        summary: 'The session established a plugin packaging decision.',
        candidates: [{
          domain: 'project',
          type: 'project_fact',
          content: 'Plugin lifecycle hooks are bundled through plugin/hooks/hooks.json.',
          candidateKind: 'project_decision',
          evidence: [{ summary: 'The assistant described bundled lifecycle hooks.' }]
        }]
      })),
    now: '2026-05-29T00:00:00.000Z'
  })

  expect(result.action).toBe('pending')
  if (result.action !== 'pending') throw new Error(`Expected pending, got ${result.action}`)
  const pending = await readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')
  expect(pending).toContain('"candidateKind":"project_decision"')
})
```

- [ ] **Step 2: Write failing test for snake_case `candidate_kind`**

Add a second test:

```ts
it('preserves candidate_kind from review summary candidates', async () => {
  const home = await createTempDir('cyrene-review-runtime-kind-snake-home-')
  vi.stubEnv('HOME', home)
  const cwd = await createTempDir('cyrene-review-runtime-kind-snake-project-')

  const result = await runCodexReviewSummary({
    cwd,
    messages: [{ role: 'assistant', content: 'Found a repeated test failure pattern.' }],
    config: createConfig(cwd),
    callModel: async () =>
      modelResponse(JSON.stringify({
        summary: 'The session found a durable pitfall.',
        candidates: [{
          domain: 'project',
          type: 'project_fact',
          content: 'Malformed JSONL lines must be skipped instead of failing the whole reader.',
          candidate_kind: 'known_pitfall',
          evidence: [{ summary: 'A JSONL robustness issue was discussed.' }]
        }]
      })),
    now: '2026-05-29T00:00:00.000Z'
  })

  expect(result.action).toBe('pending')
  if (result.action !== 'pending') throw new Error(`Expected pending, got ${result.action}`)
  const pending = await readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')
  expect(pending).toContain('"candidateKind":"known_pitfall"')
})
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm test -- tests/codex-review-summary-runtime.test.ts
```

Expected: both new tests fail because `candidateKind` is absent from `pending.jsonl`.

- [ ] **Step 4: Implement minimal parser**

In `src/codex/review-summary-runtime.ts`, import:

```ts
import { isMemoryCandidateKind } from '../memory/candidate-kind.js'
```

Inside `redactCandidate()`, before constructing `candidate`, add:

```ts
const candidateKind = isMemoryCandidateKind(value.candidateKind)
  ? value.candidateKind
  : isMemoryCandidateKind(value.candidate_kind)
    ? value.candidate_kind
    : undefined
```

Add the field to the `CodexMemoryCandidateInput` object:

```ts
...(candidateKind === undefined ? {} : { candidateKind }),
```

- [ ] **Step 5: Verify tests pass**

Run:

```bash
npm test -- tests/codex-review-summary-runtime.test.ts
```

Expected: all tests in the file pass.

- [ ] **Step 6: Commit**

```bash
git add src/codex/review-summary-runtime.ts tests/codex-review-summary-runtime.test.ts
git commit -m "fix: preserve review summary candidate kind"
```

## Task 2: Add HookTraceStore

**Files:**
- Create: `src/codex/hook-trace-store.ts`
- Create: `tests/codex-hook-trace-store.test.ts`

- [ ] **Step 1: Write tests for append/read behavior**

Create `tests/codex-hook-trace-store.test.ts` with tests named:

```ts
it('appends and reads recent hook trace records from the project memory root', async () => {})
it('redacts secret-like content before writing trace records', async () => {})
it('skips malformed trace JSONL lines and returns warnings', async () => {})
it('limits recent trace records by count and age', async () => {})
```

Use `vi.stubEnv('HOME', home)`, `mkdtemp()`, and `identifyCodexProject()` as in existing Codex tests. Assertions:

- appended file path is `codexProjectMemoryRoot(projectId)/hook-trace.jsonl`
- redacted output contains `[REDACTED_SECRET]` and not `sk-abc`
- malformed line does not throw and adds a warning containing `Malformed hook trace line`
- `readRecentCodexHookTrace({ limit: 1 })` returns only newest record
- age filter excludes records older than 7 days when `now` is fixed

- [ ] **Step 2: Run tests and verify failure**

```bash
npm test -- tests/codex-hook-trace-store.test.ts
```

Expected: module import fails because `src/codex/hook-trace-store.ts` does not exist.

- [ ] **Step 3: Implement `hook-trace-store.ts`**

Create `src/codex/hook-trace-store.ts` with exported functions:

```ts
export async function appendCodexHookTrace(input: {
  cwd: string
  event: CodexHookTraceEventName
  sessionId?: string
  turnId?: string
  summary: string
  signals?: string[]
  tool?: CodexHookTraceTool
  now?: string
}): Promise<CodexHookTraceRecord>

export async function readRecentCodexHookTrace(input: {
  cwd: string
  limit?: number
  now?: string
  maxAgeDays?: number
}): Promise<{ records: CodexHookTraceRecord[]; warnings: string[] }>
```

Implementation requirements:

- Resolve project via `identifyCodexProject(input.cwd)`.
- Ensure memory root via `ensureCodexProjectMemoryRoot(project.projectId)`.
- Use `assertSafeMemoryDataFileTarget(join(memoryRoot, 'hook-trace.jsonl'))`.
- Redact every string field with `redactReviewText()`.
- Truncate `summary`, `signals`, `commandSummary`, and `outputSummary` to bounded lengths.
- Use `randomUUID()` for `id`.
- Write one JSON record per line with `appendFile()`.
- `readRecentCodexHookTrace()` reads missing file as empty, skips malformed lines, sorts by `createdAt`, filters by age, and returns the newest `limit ?? 100`.

- [ ] **Step 4: Verify tests pass**

```bash
npm test -- tests/codex-hook-trace-store.test.ts
```

Expected: all hook trace store tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/codex/hook-trace-store.ts tests/codex-hook-trace-store.test.ts
git commit -m "feat: add codex hook trace store"
```

## Task 3: Add Project Signal Collector

**Files:**
- Create: `src/codex/project-memory-signals.ts`
- Create: `tests/project-memory-signals.test.ts`

- [ ] **Step 1: Write collector tests**

Create `tests/project-memory-signals.test.ts` with tests named:

```ts
it('collects changed-file signals from a git working tree', async () => {})
it('falls back in a non-git project and still reads project files', async () => {})
it('includes recent hook trace and review summary signals', async () => {})
it('honors changed_files mode by focusing on git changed files', async () => {})
```

Test data:

- Initialize a temp git repo with `git init`.
- Write `README.md`, `AGENTS.md`, `plugin/.codex-plugin/plugin.json`, and `tests/example.test.ts`.
- Commit baseline, then modify `AGENTS.md` and `README.md`.
- Seed hook trace through `appendCodexHookTrace()`.
- Seed `review-summaries.jsonl` in the project memory root with one valid record.

Assertions:

- `collectProjectMemorySignals({ cwd, mode: 'default' })` returns signals whose summaries mention `AGENTS.md`, `README.md`, and recent hook trace.
- non-git project returns warnings with `git` but still returns file signals.
- `changed_files` mode includes changed paths and does not require reading every project file.

- [ ] **Step 2: Run tests and verify failure**

```bash
npm test -- tests/project-memory-signals.test.ts
```

Expected: module import fails because `project-memory-signals.ts` does not exist.

- [ ] **Step 3: Implement collector types**

Create `src/codex/project-memory-signals.ts` with:

```ts
export type CodexProjectHarvestMode = 'default' | 'changed_files'

export interface ProjectMemorySignal {
  kind:
    | 'git_changed_file'
    | 'project_manifest'
    | 'repository_policy'
    | 'documentation'
    | 'test_signal'
    | 'hook_trace'
    | 'review_summary'
  summary: string
  source: 'git' | 'file' | 'tool_trace' | 'review_summary'
  files?: string[]
  evidence?: string
}

export async function collectProjectMemorySignals(input: {
  cwd: string
  mode?: CodexProjectHarvestMode
  now?: string
}): Promise<{ signals: ProjectMemorySignal[]; warnings: string[] }>
```

- [ ] **Step 4: Implement git and file collection**

Implementation requirements:

- Use `execFile('git', args, { cwd })` through `promisify`.
- Collect `git status --short`, `git diff --name-only`, and `git diff --stat`.
- Catch git errors and add warnings; do not throw for non-git repos.
- Read only bounded text from `package.json`, `tsconfig.json`, `plugin/.codex-plugin/plugin.json`, `plugin/.mcp.json`, `README.md`, `AGENTS.md`.
- For `tests/`, list filenames only; do not read full test bodies.
- Do not store raw diff.

- [ ] **Step 5: Implement trace and review summary collection**

Use `readRecentCodexHookTrace({ cwd })` and safe reading of `review-summaries.jsonl`. For review summaries:

- skip malformed lines
- include recent `status: "ok"` summaries
- include failed summaries as warning-style signals with failure reason

- [ ] **Step 6: Verify tests pass**

```bash
npm test -- tests/project-memory-signals.test.ts
```

Expected: all collector tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/codex/project-memory-signals.ts tests/project-memory-signals.test.ts
git commit -m "feat: collect project memory signals"
```

## Task 4: Add ProjectMemoryHarvester

**Files:**
- Create: `src/codex/project-memory-harvester.ts`
- Create: `tests/project-memory-harvester.test.ts`

- [ ] **Step 1: Write harvester tests**

Create `tests/project-memory-harvester.test.ts` with tests named:

```ts
it('returns dry-run previews without writing pending memory', async () => {})
it('writes project-root pending candidates from LLM output', async () => {})
it('never writes global pending candidates from project harvest output', async () => {})
it('returns needs_model_config warning without writing pending when model config is missing', async () => {})
it('skips invalid LLM candidates cleanly', async () => {})
```

Use a stub `callModel` returning:

```ts
JSON.stringify({
  candidates: [{
    domain: 'project',
    type: 'project_fact',
    scope: 'project',
    candidate_kind: 'workflow_rule',
    content: 'After source changes, run npm run build:plugin before plugin validation.',
    source: 'tool_trace',
    evidence: [{ summary: 'Project signal mentioned build:plugin before validation.' }]
  }]
})
```

Assertions:

- dry-run leaves `pending.jsonl` absent
- normal run writes project `pending.jsonl`
- LLM `scope: "global"` is coerced to project or rejected; no global pending file is created
- missing `CYRENE_BASE_URL` / `CYRENE_MODEL` yields warning `needs_model_config`

- [ ] **Step 2: Run tests and verify failure**

```bash
npm test -- tests/project-memory-harvester.test.ts
```

Expected: module import fails because `project-memory-harvester.ts` does not exist.

- [ ] **Step 3: Implement public result types**

Create `src/codex/project-memory-harvester.ts` with:

```ts
export interface CodexProjectHarvestCandidatePreview {
  candidateKind: MemoryCandidateKind
  domain: MemoryDomain
  type: MemoryType
  scope: MemoryScope
  content: string
  evidenceCount: number
}

export interface CodexProjectHarvestResult {
  project: { projectId: string; displayName: string }
  action: 'dry_run' | 'pending' | 'noop' | 'failed'
  signalCount: number
  candidateIds: string[]
  candidatesPreview?: CodexProjectHarvestCandidatePreview[]
  warnings: string[]
}
```

- [ ] **Step 4: Implement `runCodexProjectMemoryHarvest()`**

Signature:

```ts
export async function runCodexProjectMemoryHarvest(input: {
  cwd: string
  mode?: CodexProjectHarvestMode
  dryRun?: boolean
  config?: AppConfig
  callModel?: (input: CallModelInput) => Promise<ModelResponse>
  now?: string
  signal?: AbortSignal
}): Promise<CodexProjectHarvestResult>
```

Implementation requirements:

- Identify project with `identifyCodexProject(input.cwd)`.
- Collect signals with `collectProjectMemorySignals()`.
- If no signals, return `action: 'noop'`.
- If model config is missing, return `action: input.dryRun ? 'dry_run' : 'failed'`, warning `needs_model_config: set CYRENE_BASE_URL and CYRENE_MODEL`.
- Build a project-only prompt from bounded signal summaries.
- Call model with `useCase: 'memory_extraction'`, no tools, `AbortSignal.timeout(20_000)` for hook use when caller does not pass a signal.
- Parse JSON object with shape `{ "candidates": [] }`.
- Allow only `project_fact`, `project_decision`, `workflow_rule`, `known_pitfall`, `rejected_approach`, `open_question`.
- Force `scope: "project"` for every accepted candidate.
- Allow only `domain: "project"` or `domain: "procedural"`.
- Use `source: "tool_trace"` or `"file"`, defaulting to `"tool_trace"`.
- Evidence must use bounded summaries and `sourceKind`.
- For `dryRun`, return `candidatesPreview` and do not call `proposeCodexMemoryCandidate()`.
- For normal run, call `proposeCodexMemoryCandidate()` with `recordRejectedCandidate: false`; collect only pending candidate ids.

- [ ] **Step 5: Add prompt builder**

Add an exported prompt function for testability:

```ts
export function buildProjectMemoryHarvestPrompt(signals: ProjectMemorySignal[]): string
```

The prompt must include the allow/reject rules from the spec and require JSON only.

- [ ] **Step 6: Verify tests pass**

```bash
npm test -- tests/project-memory-harvester.test.ts
```

Expected: all harvester tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/codex/project-memory-harvester.ts tests/project-memory-harvester.test.ts
git commit -m "feat: add project memory harvester"
```

## Task 5: Add Lifecycle Hook Commands and Stop Integration

**Files:**
- Create: `src/codex/codex-hook-trace.ts`
- Modify: `src/codex/codex-hook-stop.ts`
- Modify: `src/codex/codex-cli.ts`
- Add: `plugin/hooks/hooks.json`
- Add/modify: `tests/codex-hook-trace.test.ts`
- Modify: `tests/codex-hook-stop.test.ts`
- Modify: `tests/codex-cli.test.ts`

- [ ] **Step 1: Write tests for non-Stop hook commands**

Create `tests/codex-hook-trace.test.ts` with tests:

```ts
it('handles SessionStart payload by appending a session_start trace', async () => {})
it('handles UserPromptSubmit payload without storing raw prompt text', async () => {})
it('handles PostToolUse payload by recording tool summary without writing pending memory', async () => {})
it('returns fail-open hook JSON when trace writing fails', async () => {})
```

Expected command output shape:

```json
{"continue":true,"suppressOutput":true}
```

- [ ] **Step 2: Implement `codex-hook-trace.ts`**

Exports:

```ts
export type CodexTraceHookEvent = 'session-start' | 'user-prompt-submit' | 'post-tool-use'

export async function handleCodexTraceHookCommand(event: CodexTraceHookEvent): Promise<string>
export async function handleCodexTraceHookPayload(event: CodexTraceHookEvent, payload: Record<string, unknown>): Promise<void>
```

Behavior:

- read JSON from stdin for command handler
- map event names to trace names
- summarize only bounded/redacted payload fields
- use `appendCodexHookTrace()`
- return valid fail-open JSON even on exceptions

- [ ] **Step 3: Route new hook commands in CLI**

In `src/codex/codex-cli.ts`:

```ts
if (command === 'hook' && ['session-start', 'user-prompt-submit', 'post-tool-use'].includes(input.args[1] ?? '')) {
  process.stdout.write(await handleCodexTraceHookCommand(input.args[1] as CodexTraceHookEvent))
  return
}
```

Add CLI tests that invoke:

```bash
node_modules/tsx/dist/cli.mjs src/main.ts codex hook session-start
node_modules/tsx/dist/cli.mjs src/main.ts codex hook user-prompt-submit
node_modules/tsx/dist/cli.mjs src/main.ts codex hook post-tool-use
```

with JSON stdin and assert valid hook JSON.

- [ ] **Step 4: Integrate Stop with trace and harvester**

In `src/codex/codex-hook-stop.ts`:

- append a `stop` trace after transcript parsing succeeds
- run existing `runCodexReviewSummary()` first
- run `runCodexProjectMemoryHarvest({ cwd, mode: 'default', dryRun: false, config, callModel, signal })`
- merge review candidate ids and harvest candidate ids into the returned pending result
- if harvester returns missing model config, keep summary result and do not treat the Stop hook as failed
- do not let harvester exceptions escape Stop handler

Add tests to `tests/codex-hook-stop.test.ts`:

```ts
it('runs project harvest during Stop and includes harvest candidate ids', async () => {})
it('does not block Stop when project harvest needs model config', async () => {})
it('visible mode reports summary and pending counts without candidate content', async () => {})
```

- [ ] **Step 5: Add bundled plugin hooks**

Create `plugin/hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cyrene-continuity codex hook session-start",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cyrene-continuity codex hook user-prompt-submit",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cyrene-continuity codex hook post-tool-use",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cyrene-continuity codex hook stop",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

If plugin validation rejects bare `cyrene-continuity`, switch commands to:

```txt
sh -lc 'exec "$HOME/.cyrene/codex/bin/cyrene-continuity" codex hook stop'
```

and use the same stable shim pattern for all hook commands.

- [ ] **Step 6: Verify hook tests pass**

```bash
npm test -- tests/codex-hook-trace.test.ts tests/codex-hook-stop.test.ts tests/codex-cli.test.ts
```

Expected: all targeted hook/CLI tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/codex/codex-hook-trace.ts src/codex/codex-hook-stop.ts src/codex/codex-cli.ts plugin/hooks/hooks.json tests/codex-hook-trace.test.ts tests/codex-hook-stop.test.ts tests/codex-cli.test.ts
git commit -m "feat: add project memory lifecycle hooks"
```

## Task 6: Add CLI and MCP Harvest Entrypoints

**Files:**
- Modify: `src/codex/codex-cli.ts`
- Create: `src/mcp/tools/memory-harvest-project.ts`
- Modify: `src/mcp/mcp-server.ts`
- Modify: `tests/codex-cli.test.ts`
- Modify: `tests/mcp-server.test.ts`

- [ ] **Step 1: Write CLI tests**

Add tests to `tests/codex-cli.test.ts`:

```ts
it('runs memory harvest-project dry-run from the CLI', async () => {})
it('runs memory harvest-project changed-files mode from the CLI', async () => {})
it('rejects invalid memory harvest-project mode options', async () => {})
```

Assertions:

- stdout is JSON
- `action` is `dry_run`, `noop`, or `failed`
- invalid option exits with code 1 and clear stderr

- [ ] **Step 2: Implement CLI parser**

In `src/codex/codex-cli.ts`, route:

```ts
if (command === 'memory' && input.args[1] === 'harvest-project') {
  process.stdout.write(`${JSON.stringify(await runCodexProjectMemoryHarvest({
    cwd: input.cwd,
    mode: parseHarvestMode(input.args),
    dryRun: input.args.includes('--dry-run')
  }), null, 2)}\n`)
  return
}
```

Implement:

```ts
function parseHarvestMode(args: string[]): CodexProjectHarvestMode {
  if (args.includes('--changed-files')) return 'changed_files'
  if (args.includes('--since')) return 'default'
  return 'default'
}
```

If `--since` is present and value is not `last-summary`, throw a clear error.

- [ ] **Step 3: Write MCP tests**

Add to `tests/mcp-server.test.ts`:

```ts
it('handles project memory harvest MCP dry-run as JSON text', async () => {})
it('registers the project harvest MCP tool on the server', async () => {})
```

Call the handler directly with:

```ts
await handleMemoryHarvestProject({ dryRun: true, mode: 'default' }, cwd)
```

- [ ] **Step 4: Implement MCP tool**

Create `src/mcp/tools/memory-harvest-project.ts`:

```ts
import { z } from 'zod'
import { runCodexProjectMemoryHarvest } from '../../codex/project-memory-harvester.js'
import { jsonText } from '../mcp-json.js'

const modeSchema = z.enum(['default', 'changed_files'])

export const memoryHarvestProjectInputSchema = {
  mode: modeSchema.optional(),
  dryRun: z.boolean().optional()
}

export async function handleMemoryHarvestProject(
  input: { mode?: z.infer<typeof modeSchema>; dryRun?: boolean },
  fallbackCwd: string
) {
  return jsonText(await runCodexProjectMemoryHarvest({
    cwd: fallbackCwd,
    mode: input.mode ?? 'default',
    dryRun: input.dryRun ?? false
  }))
}
```

Register `cyrene_memory_harvest_project` in `src/mcp/mcp-server.ts`.

- [ ] **Step 5: Verify CLI/MCP tests pass**

```bash
npm test -- tests/codex-cli.test.ts tests/mcp-server.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/codex/codex-cli.ts src/mcp/mcp-server.ts src/mcp/tools/memory-harvest-project.ts tests/codex-cli.test.ts tests/mcp-server.test.ts
git commit -m "feat: expose project memory harvest entrypoints"
```

## Task 7: Update Documentation, Runtime, and Validation

**Files:**
- Modify: `README.md`
- Modify: `plugin/skills/cyrene-continuity/SKILL.md`
- Modify conditionally: `plugin/.codex-plugin/plugin.json` only when plugin validation requires an explicit hooks declaration.
- Generated by command: `plugin/runtime/cyrene-continuity.mjs`

- [ ] **Step 1: Update README**

Document:

- plugin bundles lifecycle hooks
- `codex memory harvest-project` examples
- `CYRENE_BASE_URL`, `CYRENE_MODEL`, optional `CYRENE_API_KEY`
- missing model config fail-open behavior
- project harvester writes only project pending, not global pending
- review remains `codex memory review` + approve/reject/edit/defer with hash

- [ ] **Step 2: Update skill guidance**

In `plugin/skills/cyrene-continuity/SKILL.md`, add guidance:

- use `cyrene_memory_harvest_project` when project memory seems stale or missing
- do not promote pending memory without explicit user approval and review hash
- project harvester does not create global memory
- missing model config means trace may exist but project candidates are not generated

- [ ] **Step 3: Update plugin manifest only if validation requires hooks declaration**

Inspect plugin validation output. If `plugin/.codex-plugin/plugin.json` must declare hooks, add the smallest accepted field that points to `./hooks/hooks.json`. If validation accepts default `plugin/hooks/hooks.json`, leave manifest unchanged.

- [ ] **Step 4: Build plugin runtime**

```bash
npm run build:plugin
```

Expected: `plugin/runtime/cyrene-continuity.mjs` is regenerated successfully.

- [ ] **Step 5: Run plugin validation**

```bash
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: validation passes. If it fails on hooks schema, update `plugin/hooks/hooks.json` or manifest using the smallest valid schema and rerun.

- [ ] **Step 6: Run full verification**

```bash
npm test
npm run typecheck
git diff --check
```

Expected: all commands pass.

- [ ] **Step 7: Commit**

```bash
git add README.md plugin/skills/cyrene-continuity/SKILL.md plugin/.codex-plugin/plugin.json plugin/hooks/hooks.json plugin/runtime/cyrene-continuity.mjs
git commit -m "docs: document project memory harvester"
```

Only include `plugin/.codex-plugin/plugin.json` if it changed.

## Final Verification

After all tasks:

```bash
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
git diff --check
```

Expected:

- all tests pass
- typecheck passes
- plugin runtime builds
- plugin validation passes
- working tree has only intended implementation/doc/runtime changes
