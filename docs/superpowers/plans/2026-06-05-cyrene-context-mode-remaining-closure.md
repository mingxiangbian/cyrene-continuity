# Cyrene Context Mode Remaining Closure Implementation Plan

> **For Phoenix:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task-by-task.

**Goal:** 补齐 `docs/superpowers/specs/2026-06-05-cyrene-context-mode-remaining-closure-design.md` 里确认未完成的 runtime 行为：automatic mode router、balanced full profile、review 默认不拉 similar hints、session hints 自动生成、fast summary stale/manual refresh、README 工具清单一致性，并保留 hot path read-only。

**Architecture:** `src/codex/context-policy.ts` 负责 mode 默认值和 auto 推断；`src/codex/continuity-context.ts` 只按 policy 路由读取，不在 hot path rebuild DB；session hints 仍写入 project memory root 的 `session_hints.json`；fast summary 的 stale/manual refresh 集中在 `fast-summary-store` / `fast-summary-maintenance`，CLI 暴露显式 refresh；README 只同步已注册 MCP/CLI surface。

**Tech Stack:** TypeScript, Vitest, local JSONL/SQLite memory index, Codex MCP server, CLI via `src/main.ts`.

---

### Task 1: Context policy defaults and automatic router

**Files:**
- Modify: `src/codex/context-policy.ts`
- Modify: `src/codex/continuity-context.ts`
- Modify: `src/codex/memory-context-preview.ts`
- Modify: `tests/codex-context-policy.test.ts`
- Modify: `tests/codex-continuity-context.test.ts`

**Step 1: Add failing policy tests**

Add tests that assert:
- `buildRetrievalPolicy({ mode: 'balanced' })` has `includeFullProfile: true`.
- `buildRetrievalPolicy({ mode: 'review' })` has `includeSimilarProjectHints: false`.
- `buildRetrievalPolicy({ task: 'planning', userMessage: 'write an implementation plan' })` infers `mode: 'balanced'`.
- `buildRetrievalPolicy({ task: 'memory', userMessage: 'review pending memory' })` infers `mode: 'review'`.
- `CYRENE_CONTEXT_MODE` and explicit `mode` still override inference.
- Explicit `includeSimilarProjectHints: true` still overrides review default.

Run:

```bash
npm test -- tests/codex-context-policy.test.ts
```

Expected: new tests fail before implementation.

**Step 2: Implement router and defaults**

In `context-policy.ts`:
- Export `ContextPolicyTask = 'coding' | 'planning' | 'debugging' | 'conversation' | 'memory'`.
- Extend `BuildRetrievalPolicyInput` with `task?: ContextPolicyTask` and `userMessage?: string`.
- Set balanced `includeFullProfile: true`.
- Set review `includeSimilarProjectHints: false`.
- Add `inferContextMode(input)`:
  - review when explicit pending/review/automation/profile-memory words or pending flags are present.
  - balanced for planning, architecture, deep debugging, code review, or similar-project/project-start wording.
  - fast otherwise.
- Keep priority: explicit mode > env mode > inferred mode > fast.
- Keep explicit flags after defaults/env so callers can opt into similar hints.

In `continuity-context.ts`, pass `task` and `userMessage` into `buildRetrievalPolicy`.

In `memory-context-preview.ts`, report the resolved context mode from diagnostics or policy-compatible inference instead of hardcoding input mode to `fast`.

Run:

```bash
npm test -- tests/codex-context-policy.test.ts tests/codex-continuity-context.test.ts
```

Expected: policy tests pass; continuity tests fail only where old review/similar assumptions remain.

---

### Task 2: Review similar-hints default and explicit opt-in

**Files:**
- Modify: `tests/codex-continuity-context.test.ts`
- Modify: `tests/codex-cli.test.ts`

**Step 1: Update continuity tests**

Change existing review-mode tests:
- “review mode returns pending notice, pending hypotheses, diagnostics…” should assert `similarProjectHints: []` by default.
- Similar-hints-specific tests should pass `includeSimilarProjectHints: true` instead of relying on `mode: 'review'`.
- Add one explicit regression test that `mode: 'review'` with no include flag does not return similar hints even when a similar indexed project exists.

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts
```

Expected: fails until Task 1 implementation is complete, then passes.

**Step 2: Update CLI context-preview assertions**

Adjust or add tests so `context-preview`:
- defaults ordinary messages to `fast`;
- infers planning messages to `balanced`;
- keeps similar hints hidden unless `--include-similar-project-hints` is set.

Run:

```bash
npm test -- tests/codex-cli.test.ts
```

---

### Task 3: Session hints generation from similar-project retrieval

**Files:**
- Modify: `src/codex/continuity-context.ts`
- Modify: `tests/codex-continuity-context.test.ts`

**Step 1: Add failing session-hints generation test**

Add a continuity test that:
- seeds current and similar project roots;
- rebuilds the SQLite memory index;
- calls `getCodexContinuityContext` with planning text, `includeSessionHints: true`, and `sessionId`;
- expects `sessionHints` to contain generated transferable guidance;
- expects `similarProjectHints` to remain empty when similar hints are not explicitly requested.

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts
```

Expected: new test fails because only existing session hints are read.

**Step 2: Implement fail-open generation**

In `continuity-context.ts`:
- Read existing session hints as today.
- After routed memory resolves, if policy includes session hints, session id is present, existing hints are empty, and the request is planning/debugging/similar-project/project-start/low-active-context, run a bounded similar-project retrieval.
- Convert up to three safe similar memories into `CodexSessionHint` records with generated ids, source project id/name, summary, and timestamp.
- Persist via `replaceCodexSessionHints`.
- Do not add generated hints to active memory or similarProjectHints output.
- Fail open: if index is unavailable/unsafe/eval gate fails, return no generated hints.

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts tests/codex-session-hints.test.ts
```

---

### Task 4: Fast summary stale metadata and manual refresh command

**Files:**
- Modify: `src/codex/fast-summary-store.ts`
- Modify: `src/codex/fast-summary-maintenance.ts`
- Modify: `src/codex/active-memory-review.ts`
- Modify: `src/codex/codex-cli.ts`
- Modify: `tests/codex-fast-summary-store.test.ts`
- Modify: `tests/codex-active-memory-review.test.ts`
- Modify: `tests/codex-cli.test.ts`

**Step 1: Add failing summary-store tests**

Add tests for:
- `markFastSummaryProjectionStale(memoryRoot, { reason, sourceLatestAt, now })`.
- `readFastSummaryProjection` returning `stale`, `staleReason`, and `sourceLatestAt`.
- `writeFastSummaryProjection` clearing stale state by default.

Run:

```bash
npm test -- tests/codex-fast-summary-store.test.ts
```

**Step 2: Implement stale metadata**

In `fast-summary-store.ts`:
- Extend `FastSummaryProjection` with `stale?: boolean`, `staleReason?: string`, `sourceLatestAt?: string`.
- Read/write meta as structured JSON.
- Add exported `markFastSummaryProjectionStale`.

In `active-memory-review.ts`, after archive/tombstone/supersede refresh model-visible memory, mark the affected memory root summary stale with action-specific reason. Do not rebuild summaries here.

Run:

```bash
npm test -- tests/codex-fast-summary-store.test.ts tests/codex-active-memory-review.test.ts
```

**Step 3: Add manual refresh CLI**

In `fast-summary-maintenance.ts`, add a function that refreshes one root from existing semantic memory and profile projections.

In `codex-cli.ts`, add:

```bash
cyrene-continuity codex memory summary refresh [--scope project|global]
```

Defaults to current project scope. Global scope refreshes the Codex global memory root. This command is explicit maintenance only; `continuity_get` must not call it.

Run:

```bash
npm test -- tests/codex-cli.test.ts
```

---

### Task 5: README registry and mode docs

**Files:**
- Modify: `README.md`
- Modify: `tests/mcp-server.test.ts`

**Step 1: Add doc consistency checks**

Add/adjust tests that README contains registered active-memory MCP tools:
- `cyrene_memory_active_archive`
- `cyrene_memory_active_tombstone`
- `cyrene_memory_active_propose_edit`
- `cyrene_memory_active_supersede`

Run:

```bash
npm test -- tests/mcp-server.test.ts
```

**Step 2: Update README**

Update:
- MCP tools list to include active-memory tools.
- Context Modes section to say mode can be explicit or inferred.
- balanced uses full profiles; review defaults to pending/diagnostics but not similar hints.
- Similar hints require explicit opt-in or session-hints generation path.
- Commands list includes `memory summary refresh`.

Run:

```bash
npm test -- tests/mcp-server.test.ts
git diff --check
```

---

### Task 6: Full verification and generated plugin runtime

**Files:**
- Generated: `plugin/runtime/cyrene-continuity.mjs`
- Generated if applicable: plugin skill/runtime artifacts from build

**Step 1: Focused verification**

Run:

```bash
npm test -- tests/codex-context-policy.test.ts tests/codex-continuity-context.test.ts tests/codex-session-hints.test.ts tests/codex-fast-summary-store.test.ts tests/codex-active-memory-review.test.ts tests/codex-cli.test.ts tests/mcp-server.test.ts
```

**Step 2: Typecheck and plugin build**

Because CLI/API contracts and plugin runtime behavior changed, run:

```bash
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
git diff --check
```

**Step 3: Final audit**

Run:

```bash
git status --short
git diff --stat
```

Confirm:
- hot path `continuity_get` remains read-only for SQLite rebuilds;
- JSONL fallback policy remains explicit and tested;
- generated plugin runtime is updated through build, not manual edits.
