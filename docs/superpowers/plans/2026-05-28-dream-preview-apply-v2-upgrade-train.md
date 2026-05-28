# Dream Preview / Apply And V2 Upgrade Train Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成本轮 v2 全量升级：严格移除 `deep` stage，新增 `deep-preview` / `deep-apply`，接入 unified eval gate、profile candidate flow、similar hint review、optional embedding 安全基础、doctor checks，并迁移现有 automation。

**Architecture:** 保持 JSONL 为 audit/source 层，SQLite 为 runtime index，preview artifacts 为 review/debug 层。把现有 `src/codex/memory-dream.ts` 中的 `deep` mutation 拆成 proposal 计算、preview artifact 写入、gated apply 三段；新增 profile/similar/embedding 模块，通过 CLI/MCP/doctor 暴露，不改变现有 pending review hash 安全边界。

**Tech Stack:** TypeScript, Vitest, Node.js fs/promises, `node:sqlite` adapter, existing MCP SDK, Codex automation tool.

---

## 文件结构

- Modify: `src/codex/memory-dream.ts`  
  负责 stage routing、light/rem 保持兼容、deep-preview/deep-apply 调度、dream report 输出。
- Create: `src/codex/dream-proposal.ts`  
  负责从 active/pending/tombstones 生成 `DreamProposal`、`DreamProposedChange`、logical diff 和 report model。
- Create: `src/codex/dream-artifacts.ts`  
  负责安全写入和读取 `<memoryRoot>/dream-preview/*` artifacts。
- Modify: `src/eval/eval-runner.ts`  
  扩展 unified deterministic eval gate，保留 existing similar-hints gate API。
- Create: `src/codex/profile-candidates.ts`  
  负责 `profile_candidates.jsonl`、reflection result、apply gate、profile diff。
- Create: `src/codex/similar-hints-review.ts`  
  负责 explain 和 mark-transferable。
- Create: `src/memory/embedding-provider.ts`  
  负责 optional provider interface、enablement、redaction guard、fallback diagnostics。
- Modify: `src/memory/memory-index.ts`  
  增加 embedding cache schema 和 no-provider diagnostics，不改变没有 provider 时的 retrieval 行为。
- Modify: `src/codex/codex-cli.ts`  
  增加 dream report、profile reflect/apply、similar-hints explain/mark-transferable CLI。
- Modify: `src/mcp/tools/memory-dream.ts`, `src/mcp/mcp-server.ts`  
  更新 dream schema，拒绝 `deep`，更新 MCP description。
- Modify: `src/codex/codex-doctor.ts`  
  增加 automation/stage/shim/profile-candidate/embedding checks。
- Modify: `README.md`  
  更新命令说明。
- Tests:
  - `tests/codex-memory-dream.test.ts`
  - `tests/codex-cli.test.ts`
  - `tests/eval-runner.test.ts`
  - `tests/mcp-server.test.ts`
  - `tests/memory-index.test.ts`
  - Create: `tests/profile-candidates.test.ts`
  - Create: `tests/similar-hints-review.test.ts`

## Task 1: Strict Dream Stage Migration

**Files:**
- Modify: `src/codex/memory-dream.ts`
- Modify: `src/codex/codex-cli.ts`
- Modify: `src/mcp/tools/memory-dream.ts`
- Modify: `src/mcp/mcp-server.ts`
- Test: `tests/codex-cli.test.ts`
- Test: `tests/mcp-server.test.ts`

- [x] **Step 1: Write failing CLI tests**

Add tests that assert:

```ts
expect(stderr).toContain('Invalid memory dream stage: deep')
expect(stderr).toContain('Use deep-preview to generate proposed changes or deep-apply to apply gated changes')
```

and:

```ts
await runCli(['codex', 'memory', 'dream', '--stage', 'deep-preview'])
await runCli(['codex', 'memory', 'dream', '--stage', 'deep-apply'])
```

Expected: `--stage deep` fails; the two new stages initially fail because implementation is missing.

- [x] **Step 2: Write failing MCP schema test**

Update `tests/mcp-server.test.ts` to assert tool source/schema includes:

```ts
expect(source).toContain("z.enum(['light', 'rem', 'deep-preview', 'deep-apply'])")
expect(source).not.toContain("z.enum(['light', 'rem', 'deep'])")
```

- [x] **Step 3: Implement stage type and parser**

Change:

```ts
export type CodexMemoryDreamStage = 'light' | 'rem' | 'deep'
```

to:

```ts
export type CodexMemoryDreamStage = 'light' | 'rem' | 'deep-preview' | 'deep-apply'
```

Set default stage to `deep-preview`:

```ts
const stage = input.stage ?? 'deep-preview'
```

Update `parseDreamStage()` to accept only `light`, `rem`, `deep-preview`, `deep-apply`; special-case `deep` with the migration guidance message.

- [x] **Step 4: Update MCP schema and description**

In `src/mcp/tools/memory-dream.ts`:

```ts
stage: z.enum(['light', 'rem', 'deep-preview', 'deep-apply']).optional()
```

Use the matching TypeScript input union.

- [x] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/codex-cli.test.ts tests/mcp-server.test.ts
```

Expected: focused tests pass, with existing deep tests still failing until Task 3 migration updates them.

- [x] **Step 6: Commit**

```bash
git add src/codex/memory-dream.ts src/codex/codex-cli.ts src/mcp/tools/memory-dream.ts src/mcp/mcp-server.ts tests/codex-cli.test.ts tests/mcp-server.test.ts
git commit -m "feat: require explicit dream preview or apply stages"
```

## Task 2: Dream Proposal Model

**Files:**
- Create: `src/codex/dream-proposal.ts`
- Modify: `src/codex/memory-dream.ts`
- Test: `tests/codex-memory-dream.test.ts`

- [x] **Step 1: Write failing proposal tests**

Add tests for:

```ts
const proposal = await buildDreamProposalForRoot({ memoryRoot, now })
expect(proposal.summary).toMatchObject({ promote: 1, reject: 0, keepPending: 0 })
expect(proposal.proposedChanges[0]).toMatchObject({
  action: 'promote',
  candidateId: candidate.id,
  normalizedKey: candidate.normalizedKey
})
```

and expired pending:

```ts
expect(proposal.proposedChanges[0]).toMatchObject({
  action: 'reject',
  tombstoneReason: 'expired'
})
```

- [x] **Step 2: Create proposal types**

Create `DreamProposal`, `DreamRootProposal`, `DreamProposedChange`, `DreamLogicalDiff`, `DreamEvalGateResult` interfaces in `src/codex/dream-proposal.ts`.

- [x] **Step 3: Extract decision calculation**

Move the non-mutating loop from `runDeepDreamRootLocked()` into:

```ts
export async function buildDreamProposalForRoot(input: {
  memoryRoot: string
  now: string
}): Promise<DreamRootProposal>
```

It must read active/pending/tombstones and compute promote/reject/keep without writing files.

- [x] **Step 4: Preserve old activation semantics**

For promotable candidates, proposal uses `validateMemoryCandidate()`, `evaluatePendingPromotion()`, and `activateCandidate()` exactly as old deep did. It records generated active memory in a private apply plan, but public JSON omits raw evidence quotes.

- [x] **Step 5: Run focused test**

```bash
npm test -- tests/codex-memory-dream.test.ts
```

Expected: proposal tests pass; old deep tests still need Task 4 migration.

- [x] **Step 6: Commit**

```bash
git add src/codex/dream-proposal.ts src/codex/memory-dream.ts tests/codex-memory-dream.test.ts
git commit -m "feat: build read-only dream proposals"
```

## Task 3: Deep Preview Artifacts And Report UX

**Files:**
- Create: `src/codex/dream-artifacts.ts`
- Modify: `src/codex/memory-dream.ts`
- Modify: `src/codex/codex-cli.ts`
- Test: `tests/codex-memory-dream.test.ts`
- Test: `tests/codex-cli.test.ts`

- [x] **Step 1: Write failing preview artifact test**

Assert `deep-preview` creates:

```txt
dream-preview/DREAM_REPORT.md
dream-preview/proposed_changes.json
dream-preview/diff.json
dream-preview/eval_results.json
```

and does not create or mutate:

```txt
index.jsonl
pending.jsonl
tombstones.jsonl
MODEL_PROFILE.md
dream-state.json
```

- [x] **Step 2: Implement artifact writer**

Create:

```ts
export async function writeDreamPreviewArtifacts(input: {
  memoryRoot: string
  proposal: DreamRootProposal
}): Promise<DreamPreviewArtifactPaths>
```

Use `ensureWritableMemoryRootPath()`, create `dream-preview`, and write atomic JSON/Markdown files.

- [x] **Step 3: Implement report reader**

Create:

```ts
export async function readDreamReport(input: {
  cwd: string
  root: 'global' | 'project'
}): Promise<{ memoryRoot: string; report: string }>
```

- [x] **Step 4: Wire `deep-preview` and `memory dream report`**

`runCodexMemoryDream({ stage: 'deep-preview' })` writes artifacts and returns counts. CLI command:

```bash
cyrene-continuity codex memory dream report --root project
```

prints `DREAM_REPORT.md`.

- [x] **Step 5: Run focused tests**

```bash
npm test -- tests/codex-memory-dream.test.ts tests/codex-cli.test.ts
```

- [x] **Step 6: Commit**

```bash
git add src/codex/dream-artifacts.ts src/codex/memory-dream.ts src/codex/codex-cli.ts tests/codex-memory-dream.test.ts tests/codex-cli.test.ts
git commit -m "feat: write dream preview artifacts"
```

## Task 4: Unified Eval Gate For Dream Apply

**Files:**
- Modify: `src/eval/eval-runner.ts`
- Modify: `src/codex/dream-proposal.ts`
- Test: `tests/eval-runner.test.ts`
- Test: `tests/codex-memory-dream.test.ts`

- [x] **Step 1: Write failing eval tests**

Add cases for:

```ts
pending_usage_eval rejects assistant_observed promotion
profile_pollution_eval rejects pending profile content
affective_boundary_eval rejects diagnostic affective claim
```

- [x] **Step 2: Extend check names**

Extend `EvalCheckName` with:

```ts
| 'pending_usage_eval'
| 'profile_pollution_eval'
| 'affective_boundary_eval'
```

- [x] **Step 3: Add dream candidate gate**

Implement:

```ts
export function runDreamApplyEvalGate(input: {
  proposedChanges: DreamProposedChange[]
  pending: PendingMemory[]
  profilePreview?: string
}): EvalGateResult
```

This function is deterministic and fail-closed on error severity.

- [x] **Step 4: Preserve similar hint API**

Keep `runSimilarHintsEvalGate(candidates)` behavior and tests unchanged except for expanded `EvalCheckName` type.

- [x] **Step 5: Run tests**

```bash
npm test -- tests/eval-runner.test.ts tests/codex-memory-dream.test.ts
```

- [x] **Step 6: Commit**

```bash
git add src/eval/eval-runner.ts src/codex/dream-proposal.ts tests/eval-runner.test.ts tests/codex-memory-dream.test.ts
git commit -m "feat: add unified dream eval gate"
```

## Task 5: Gated Deep Apply

**Files:**
- Modify: `src/codex/memory-dream.ts`
- Modify: `src/codex/dream-proposal.ts`
- Modify: `src/codex/dream-artifacts.ts`
- Test: `tests/codex-memory-dream.test.ts`

- [x] **Step 1: Rewrite old deep tests**

Replace old `stage: 'deep'` tests with `stage: 'deep-apply'`. Add one test that `stage: 'deep'` is rejected at CLI/MCP level, not runtime direct type level.

- [x] **Step 2: Write fail-closed test**

Seed a candidate that triggers `affective_boundary_eval`; assert:

```ts
expect(result.roots[0]).toMatchObject({ stage: 'deep-apply', promoted: 0, rejected: 0 })
await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toBe('')
await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
```

- [x] **Step 3: Implement apply from proposal**

Replace `runDeepDreamRootLocked()` internals with:

```ts
const proposal = await buildDreamProposalForRoot({ memoryRoot, now })
const gate = runDreamApplyEvalGate(...)
if (!gate.passed) {
  await writeDreamApplyBlockedArtifacts(...)
  await writeDreamFailed(memoryRoot, now, new Error('Dream apply blocked by eval gate'))
  return blockedResult
}
await applyDreamProposal(...)
```

- [x] **Step 4: Preserve lock and maintenance semantics**

`deep-apply` keeps dream lock, maintenance lock, stale lock replacement, and maintenance/profile rendering behavior equivalent to old deep when gate passes.

- [x] **Step 5: Run focused tests**

```bash
npm test -- tests/codex-memory-dream.test.ts
```

- [x] **Step 6: Commit**

```bash
git add src/codex/memory-dream.ts src/codex/dream-proposal.ts src/codex/dream-artifacts.ts tests/codex-memory-dream.test.ts
git commit -m "feat: gate dream apply mutations"
```

## Task 6: Profile Candidate Flow And Apply Gate

**Files:**
- Create: `src/codex/profile-candidates.ts`
- Modify: `src/codex/codex-cli.ts`
- Test: `tests/profile-candidates.test.ts`
- Test: `tests/codex-cli.test.ts`

- [x] **Step 1: Write profile candidate tests**

Tests cover:

```ts
reflect creates profile_candidates.jsonl
reflect returns openQuestions and conflictNotes arrays
reflect does not write MODEL_PROFILE.md
apply requires matching reviewHash
apply gate fail does not write profile
apply gate pass returns ProfileDiff
```

- [x] **Step 2: Implement store**

Create read/write/upsert helpers for:

```txt
<memoryRoot>/profile_candidates.jsonl
```

Use atomic writes and reject symlink/non-directory memory root via existing memory root helpers.

- [x] **Step 3: Implement reflection**

Implement:

```ts
export async function runCodexProfileReflection(input: {
  cwd: string
  source: 'daily-interview'
  now?: string
}): Promise<ProfileReflectionResult>
```

It may generate zero candidates when there is no safe input context; it must still return arrays and write no active memory.

- [x] **Step 4: Implement apply**

Implement:

```ts
export async function applyCodexProfileCandidate(input: {
  cwd: string
  candidateId: string
  reviewHash: string
  now?: string
}): Promise<ProfileApplyResult>
```

It validates hash, runs profile/affective gate, marks candidate `applied`, writes audit event, and regenerates profile only from structured applied state.

- [x] **Step 5: Wire CLI**

Add:

```bash
codex profile reflect --source daily-interview
codex profile apply --candidate <id> --review-hash <hash>
```

- [x] **Step 6: Run tests**

```bash
npm test -- tests/profile-candidates.test.ts tests/codex-cli.test.ts
```

- [x] **Step 7: Commit**

```bash
git add src/codex/profile-candidates.ts src/codex/codex-cli.ts tests/profile-candidates.test.ts tests/codex-cli.test.ts
git commit -m "feat: add profile candidate flow"
```

## Task 7: Similar Hint Review Tooling

**Files:**
- Create: `src/codex/similar-hints-review.ts`
- Modify: `src/codex/codex-cli.ts`
- Test: `tests/similar-hints-review.test.ts`
- Test: `tests/codex-cli.test.ts`

- [x] **Step 1: Write explain and mark tests**

Tests cover:

```ts
explain returns selected false with gate findings for disallowed memory
explain returns similarity metadata for sourceProjectId
mark-transferable rejects personal relationship affective domains
mark-transferable requires reviewHash
mark-transferable writes portability similar_project and audit event
```

- [x] **Step 2: Implement explain**

Implement:

```ts
export async function explainSimilarHints(input: {
  cwd: string
  memoryId?: string
  sourceProjectId?: string
}): Promise<SimilarHintExplanation[]>
```

It reads index/project similarity data and uses `runSimilarHintsEvalGate()` findings.

- [x] **Step 3: Implement mark-transferable**

Implement:

```ts
export async function markSimilarHintTransferable(input: {
  cwd: string
  memoryId: string
  reviewHash: string
}): Promise<{ memoryId: string; portability: 'similar_project' }>
```

It updates only eligible active project memory and appends an audit event.

- [x] **Step 4: Wire CLI**

Add:

```bash
codex similar-hints explain --memory-id <id>
codex similar-hints explain --source-project-id <projectId>
codex similar-hints mark-transferable --memory-id <id> --review-hash <hash>
```

- [x] **Step 5: Run tests**

```bash
npm test -- tests/similar-hints-review.test.ts tests/codex-cli.test.ts
```

- [x] **Step 6: Commit**

```bash
git add src/codex/similar-hints-review.ts src/codex/codex-cli.ts tests/similar-hints-review.test.ts tests/codex-cli.test.ts
git commit -m "feat: add similar hint review tooling"
```

## Task 8: Optional Embedding Retrieval Safety Foundation

**Files:**
- Create: `src/memory/embedding-provider.ts`
- Modify: `src/memory/memory-index.ts`
- Modify: `src/codex/continuity-context.ts`
- Test: `tests/memory-index.test.ts`
- Test: `tests/codex-continuity-context.test.ts`

- [x] **Step 1: Write embedding tests**

Tests cover:

```ts
embedding diagnostics disabled by default
embedding tables are created by memory index migration
provider enabled reranks only structured-policy-approved candidates
provider failure falls back to FTS results with fallbackReason
redaction guard rejects paths/remotes/secrets before provider call
```

- [x] **Step 2: Add provider interface**

Create `EmbeddingProvider`, `EmbeddingDiagnostics`, `NullEmbeddingProvider`, and `createEmbeddingProviderFromEnv()`.

- [x] **Step 3: Add SQLite schema**

In memory index initialize migration, add `memory_embeddings` and `project_embeddings` tables exactly as spec.

- [x] **Step 4: Add no-provider diagnostics**

Expose:

```ts
embedding?: {
  enabled: boolean
  provider?: string
  cacheHits: number
  cacheMisses: number
  fallbackReason?: string
}
```

through continuity diagnostics without changing retrieval results when disabled.

- [x] **Step 5: Wire safe rerank hook**

Only rerank candidates already returned by structured filters. Do not send raw evidence or unsafe content to provider.

- [x] **Step 6: Run tests**

```bash
npm test -- tests/memory-index.test.ts tests/codex-continuity-context.test.ts
```

- [x] **Step 7: Commit**

```bash
git add src/memory/embedding-provider.ts src/memory/memory-index.ts src/codex/continuity-context.ts tests/memory-index.test.ts tests/codex-continuity-context.test.ts
git commit -m "feat: add optional embedding retrieval foundation"
```

## Task 9: Doctor And Migration Checks

**Files:**
- Modify: `src/codex/codex-doctor.ts`
- Test: `tests/codex-cli.test.ts`

- [ ] **Step 1: Write doctor tests**

Tests cover doctor output includes:

```txt
automation dream stage: migrated|needs migration|unknown
stable shim deep-preview: ok|missing|failed
stable shim deep-apply: ok|missing|failed
embedding provider: disabled|enabled|misconfigured
profile candidates: ok|missing|unreadable
```

- [ ] **Step 2: Implement read-only automation scan**

Doctor may read `${HOME}/.codex/automations/*/automation.toml`, but it must not edit it.

- [ ] **Step 3: Implement shim stage checks**

Use stable shim path existence and command text checks conservatively. Avoid running mutating `deep-apply` inside doctor; report command availability based on runtime and parser where possible.

- [ ] **Step 4: Implement embedding/profile candidate status**

Read env config and memory root file state; report status only.

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/codex-cli.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/codex/codex-doctor.ts tests/codex-cli.test.ts
git commit -m "feat: extend codex doctor migration checks"
```

## Task 10: Runtime Docs, MCP Smoke, And Plugin Build

**Files:**
- Modify: `README.md`
- Modify: `plugin/runtime/cyrene-continuity.mjs`
- Test: `tests/plugin-runtime.test.ts`
- Test: `tests/mcp-server.test.ts`

- [ ] **Step 1: Update README commands**

Replace `--stage deep` with `--stage deep-apply`; add `deep-preview`, `memory dream report`, profile, similar-hints, and embedding disabled-by-default notes.

- [ ] **Step 2: Build plugin runtime**

```bash
npm run build:plugin
```

- [ ] **Step 3: Run plugin and MCP tests**

```bash
npm test -- tests/plugin-runtime.test.ts tests/mcp-server.test.ts
```

- [ ] **Step 4: Validate plugin**

```bash
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

- [ ] **Step 5: Commit**

```bash
git add README.md plugin/runtime/cyrene-continuity.mjs tests/plugin-runtime.test.ts tests/mcp-server.test.ts
git commit -m "build: update cyrene runtime for v2 upgrade train"
```

## Task 11: Automation Migration And Final Verification

**Files:**
- No repo source files unless verification exposes a required fix.
- Automation: `cyrene-memory-dream-deep`

- [ ] **Step 1: Update automation through Codex automation tool**

Use `automation_update` with id `cyrene-memory-dream-deep`, preserving all fields except prompt text. Replace:

```bash
/Users/phoenix/.cyrene/codex/bin/cyrene-continuity codex memory dream --stage deep
```

with:

```bash
/Users/phoenix/.cyrene/codex/bin/cyrene-continuity codex memory dream --stage deep-apply
```

- [ ] **Step 2: Verify automation config**

Run:

```bash
rg -- '--stage deep(\\s|"|$)' /Users/phoenix/.codex/automations
```

Expected: no active prompt uses `--stage deep`.

- [ ] **Step 3: Run full verification**

```bash
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

- [ ] **Step 4: Run runtime smoke commands**

```bash
/Users/phoenix/.cyrene/codex/bin/cyrene-continuity codex memory dream --stage deep-preview
/Users/phoenix/.cyrene/codex/bin/cyrene-continuity codex profile reflect --source daily-interview
/Users/phoenix/.cyrene/codex/bin/cyrene-continuity codex similar-hints explain --source-project-id b717665028a2ca0a
```

Only run `deep-apply` smoke after confirming it is acceptable to mutate real Cyrene memory roots, or use an isolated HOME fixture for the smoke.

- [ ] **Step 5: Final code review**

Dispatch final reviewer for spec compliance and code quality. Fix findings before completion.

- [ ] **Step 6: Finish branch**

Use `superpowers:verification-before-completion`, then `superpowers:finishing-a-development-branch` for merge/push choice.
