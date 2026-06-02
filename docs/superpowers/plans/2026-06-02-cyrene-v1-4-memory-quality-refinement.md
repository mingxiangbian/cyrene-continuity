# Cyrene v1.4 Memory Quality Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 v1.4 memory quality refinement，让新 pending 在写入前被 deterministic shaping，既有 `needs_rewrite` pending 可 controlled replace，ready pending 可补具体 semantic boundaries，并保证 pending 不膨胀、active 不自动变更。

**Architecture:** 新增 focused modules：`semantic-content-builder` 负责 pending creation shaping，`semantic-boundaries` 负责具体 `useWhen/doNotUseWhen`，`semantic-rewrite` / `semantic-rewrite-validator` / `codex-memory-prepare` 负责 prepare pass 和 receipts。共享 store/type 由 coordinator 修改；UI/API/CLI 只调用 service，不复刻业务逻辑。

**Tech Stack:** TypeScript ES2022、NodeNext、Vitest、JSONL memory store、static Web UI、existing v5 review hash / active-readiness gates。

---

## Multi-Agent Ownership

- Coordinator：`src/memory/types.ts`、`src/memory/memory-store.ts`、`src/codex/memory-propose.ts`、`src/codex/admission-pipeline.ts`、最终集成和 verification。
- Worker A：`src/codex/semantic-boundaries.ts`、`src/codex/semantic-content-builder.ts`、对应 tests。
- Worker B：`src/codex/semantic-rewrite-validator.ts`、`src/codex/semantic-rewrite.ts`、对应 tests。
- Worker C：`src/codex/codex-memory-prepare.ts`、CLI/API integration。
- Worker D：`src/codex/memory-distill.ts` preview enhancement、acceptance fixtures。
- Worker E：`src/ui/static/app.js`、UI tests。

Workers are not alone in the codebase. Do not revert edits made by others; adapt to shared types and coordinator changes.

## File Structure

- Create `src/codex/semantic-boundaries.ts`: derive concrete `useWhen` / `doNotUseWhen` / structured evidence helpers by candidate kind.
- Create `src/codex/semantic-content-builder.ts`: deterministic content shaping for candidates already allowed into pending.
- Create `src/codex/semantic-rewrite-validator.ts`: validate content replacement and boundary enrichment.
- Create `src/codex/semantic-rewrite.ts`: prepare individual pending candidates and produce receipts.
- Create `src/codex/codex-memory-prepare.ts`: memory-root level prepare service, dry-run/apply behavior.
- Modify `src/memory/types.ts`: add `SemanticRewriteReceipt` and receipt action/method types.
- Modify `src/memory/memory-store.ts`: read/append/write semantic rewrite receipts.
- Modify `src/codex/memory-propose.ts` and `src/codex/admission-pipeline.ts`: apply creation shaping only for candidates that actually enter pending.
- Modify `src/codex/memory-review.ts`: expose enriched semantic boundaries and receipt status in pending summaries.
- Modify `src/codex/memory-distill.ts`: add rewritten representative preview without materializing pending.
- Modify `src/codex/codex-cli.ts`: add `memory prepare --dry-run|--apply`.
- Modify `src/codex/codex-ui-api.ts`: add `/api/memory/prepare/dry-run` and `/api/memory/prepare/apply`.
- Modify `src/ui/static/app.js`: show prepare buttons/status and receipt details.
- Modify `src/codex/memory-quality-contract.ts`: add `semantic_prepare` rubric.
- Add tests listed in each task.

## Task 1: Shared Receipt Types And Store

**Owner:** Coordinator

**Files:**
- Modify: `src/memory/types.ts`
- Modify: `src/memory/memory-store.ts`
- Test: `tests/semantic-rewrite-receipt.test.ts`

- [ ] **Step 1: Write failing receipt store tests**

Create `tests/semantic-rewrite-receipt.test.ts`:

```ts
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  appendSemanticRewriteReceiptFromRoot,
  readSemanticRewriteReceiptsFromRoot
} from '../src/memory/memory-store.js'
import type { SemanticRewriteReceipt } from '../src/memory/types.js'

describe('semantic rewrite receipts', () => {
  it('appends and reads rewrite receipts from a memory root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cyrene-rewrite-receipt-'))
    const receipt: SemanticRewriteReceipt = {
      id: 'receipt-1',
      pendingMemoryId: 'pending-1',
      action: 'replace_content',
      method: 'deterministic',
      oldReviewHash: 'old-hash',
      newReviewHash: 'new-hash',
      originalContentHash: 'original-hash',
      rewrittenContentHash: 'rewritten-hash',
      changedFields: ['content', 'useWhen'],
      eligibilityReasons: ['needs_active_memory_rewrite'],
      validatorReasons: ['rewritten content is active-ready'],
      sourceOfTruth: 'AGENTS.md',
      createdAt: '2026-06-02T00:00:00.000Z'
    }

    await appendSemanticRewriteReceiptFromRoot(root, receipt)

    await expect(readSemanticRewriteReceiptsFromRoot(root)).resolves.toEqual([receipt])
    await expect(readFile(join(root, 'semantic_rewrite_receipts.jsonl'), 'utf8')).resolves.toContain('"replace_content"')
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- tests/semantic-rewrite-receipt.test.ts
```

Expected: FAIL because `SemanticRewriteReceipt` store helpers do not exist.

- [ ] **Step 3: Add types and store helpers**

In `src/memory/types.ts`, add:

```ts
export const SEMANTIC_REWRITE_RECEIPT_ACTIONS = [
  'shape_on_create',
  'replace_content',
  'enrich_boundaries',
  'skip',
  'fail'
] as const
export type SemanticRewriteReceiptAction = typeof SEMANTIC_REWRITE_RECEIPT_ACTIONS[number]

export const SEMANTIC_REWRITE_METHODS = ['deterministic', 'llm', 'deterministic_fallback'] as const
export type SemanticRewriteMethod = typeof SEMANTIC_REWRITE_METHODS[number]

export interface SemanticRewriteReceipt {
  id: string
  pendingMemoryId: string
  preparedSemanticMemoryId?: string
  action: SemanticRewriteReceiptAction
  method: SemanticRewriteMethod
  oldReviewHash?: string
  newReviewHash?: string
  originalContentHash: string
  rewrittenContentHash?: string
  changedFields: string[]
  eligibilityReasons: string[]
  validatorReasons: string[]
  sourceOfTruth?: string
  createdAt: string
}
```

In `src/memory/memory-store.ts`, add `SEMANTIC_REWRITE_RECEIPTS_FILE = 'semantic_rewrite_receipts.jsonl'`, import `SemanticRewriteReceipt`, and implement:

```ts
export async function appendSemanticRewriteReceiptFromRoot(
  memoryRoot: string,
  receipt: SemanticRewriteReceipt
): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, SEMANTIC_REWRITE_RECEIPTS_FILE), receipt)
}

export async function readSemanticRewriteReceiptsFromRoot(memoryRoot: string): Promise<SemanticRewriteReceipt[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) return []
  return readJsonLines<SemanticRewriteReceipt>(join(memoryRoot, SEMANTIC_REWRITE_RECEIPTS_FILE))
}
```

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- tests/semantic-rewrite-receipt.test.ts
```

Expected: PASS.

## Task 2: Semantic Boundaries And Content Builder

**Owner:** Worker A

**Files:**
- Create: `src/codex/semantic-boundaries.ts`
- Create: `src/codex/semantic-content-builder.ts`
- Test: `tests/semantic-boundaries.test.ts`
- Test: `tests/semantic-content-builder.test.ts`

- [ ] **Step 1: Write failing boundary tests**

Create `tests/semantic-boundaries.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deriveSemanticBoundaries } from '../src/codex/semantic-boundaries.js'

describe('semantic boundaries', () => {
  it('derives concrete workflow boundaries from pending review content', () => {
    const result = deriveSemanticBoundaries({
      candidateKind: 'workflow_rule',
      content: 'Pending-memory rejection workflows must validate each candidate review hash before mutation.',
      normalizedKey: 'pending-memory-rejection-review-hash',
      sourceOfTruth: 'review_summary:1',
      evidenceRefs: ['pending.jsonl', 'review_hash']
    })

    expect(result.useWhen.join(' ')).toContain('pending-memory rejection')
    expect(result.useWhen.join(' ')).toContain('review hash')
    expect(result.doNotUseWhen.join(' ')).not.toContain('Future task matches')
    expect(result.reasons).toContain('workflow_rule_boundaries')
  })

  it('derives known-pitfall boundaries for canonical pending hash failures', () => {
    const result = deriveSemanticBoundaries({
      candidateKind: 'known_pitfall',
      content: 'Pending-review hashes must be read from canonical pending.jsonl records rather than semantic projection or cache-derived data; projection rewrites can cause false review-hash conflicts.',
      normalizedKey: 'pending-review-hash-canonical-records',
      evidenceRefs: ['pending.jsonl', 'semantic projection']
    })

    expect(result.useWhen.join(' ')).toContain('pending review')
    expect(result.useWhen.join(' ')).toContain('review hash')
    expect(result.doNotUseWhen.join(' ')).toContain('canonical pending')
  })
})
```

- [ ] **Step 2: Write failing builder tests**

Create `tests/semantic-content-builder.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { shapePendingCandidateContent } from '../src/codex/semantic-content-builder.js'

describe('semantic content builder', () => {
  it('shapes pending-memory rejection workflow into future-facing rule', () => {
    const shaped = shapePendingCandidateContent({
      content: '拒绝 pending memory 的流程：按照 Cyrene review 流程，逐条进行哈希校验，确认后执行拒绝操作。操作后需验证 pending 列表为空。',
      candidateKind: 'workflow_rule',
      scope: 'project',
      domain: 'procedural',
      normalizedKey: 'pending-memory-rejection-review-hash',
      evidenceRefs: ['review_hash', 'pending list']
    })

    expect(shaped.content).toBe('Pending-memory rejection workflows must validate each candidate review hash before mutation and verify the queue state after rejection.')
    expect(shaped.changedFields).toContain('content')
    expect(shaped.useWhen.join(' ')).toContain('pending-memory rejection')
  })

  it('shapes pending-review hash pitfall into failure/cause/mitigation content', () => {
    const shaped = shapePendingCandidateContent({
      content: 'pending review 哈希因 semantic projection 改写导致假冲突。修复方案：调整优先从 pending.jsonl 直接读取 pending review，而非依赖缓存推导。',
      candidateKind: 'known_pitfall',
      scope: 'project',
      domain: 'procedural',
      normalizedKey: 'pending-review-hash-canonical-records',
      evidenceRefs: ['pending.jsonl', 'semantic projection']
    })

    expect(shaped.content).toBe('Pending-review hashes must be read from canonical pending.jsonl records rather than semantic projection or cache-derived data; projection rewrites can cause false review-hash conflicts.')
    expect(shaped.changedFields).toContain('content')
    expect(shaped.useWhen.join(' ')).toContain('review hash')
  })
})
```

- [ ] **Step 3: Implement focused deterministic helpers**

Implement `deriveSemanticBoundaries()` and `shapePendingCandidateContent()` with deterministic regex/pattern helpers. Keep the implementation conservative: only known patterns are rewritten; otherwise return original content with improved boundaries.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- tests/semantic-boundaries.test.ts tests/semantic-content-builder.test.ts
```

Expected: PASS.

## Task 3: Creation Shaping Integration

**Owner:** Coordinator

**Files:**
- Modify: `src/codex/memory-propose.ts`
- Modify: `src/codex/admission-pipeline.ts`
- Test: `tests/codex-memory-propose-v1-4-shaping.test.ts`
- Test: `tests/codex-admission-pipeline.test.ts`

- [ ] **Step 1: Add failing creation-shaping tests**

Create `tests/codex-memory-propose-v1-4-shaping.test.ts` with tests asserting:

```ts
expect(pending[0]?.content).toBe('Pending-memory rejection workflows must validate each candidate review hash before mutation and verify the queue state after rejection.')
expect(pending[0]?.candidateKind).toBe('workflow_rule')
expect(pending).toHaveLength(1)
```

Also assert a `task_state` or `admit_to_distillation` admission path does not become pending.

- [ ] **Step 2: Apply shaping before pending writes**

In pending write paths, call `shapePendingCandidateContent()` only when the candidate is actually about to be written to pending. Preserve input evidence, source, scope/domain, and only adopt changed `content`, `candidateKind`, `useWhen`/`doNotUseWhen` projection metadata if supported by current store shape.

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- tests/codex-memory-propose-v1-4-shaping.test.ts tests/codex-admission-pipeline.test.ts
```

Expected: PASS.

## Task 4: Rewrite Validator And Prepare Service

**Owner:** Worker B + Worker C

**Files:**
- Create: `src/codex/semantic-rewrite-validator.ts`
- Create: `src/codex/semantic-rewrite.ts`
- Create: `src/codex/codex-memory-prepare.ts`
- Test: `tests/semantic-rewrite.test.ts`
- Test: `tests/codex-memory-prepare.test.ts`

- [ ] **Step 1: Write failing validator tests**

Create tests that assert implementation notes rewrite to active-ready content, ready content is not rewritten, invalid LLM-like output is rejected, and active memory is not changed.

- [ ] **Step 2: Implement validator**

Validator must call `evaluateActiveMemoryReadiness()` on rewritten content and enforce:

```txt
sourceOfTruth preserved when present
risk/scope/domain not expanded
content replacement only for needs_rewrite
boundary enrichment does not alter content hash
```

- [ ] **Step 3: Implement `runCodexMemoryPrepare()`**

Service inputs:

```ts
{
  cwd?: string
  memoryRoot?: string
  dryRun?: boolean
  now?: string
  maxItemsPerRun?: number
}
```

Service behavior:

```txt
read pending + active + receipts
for each pending:
  if needs_rewrite -> attempt replace_content
  else if template boundaries -> enrich_boundaries
  else skip
dry-run returns next records without writing
apply writes pending and appends receipts
active before/after counts must match
```

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- tests/semantic-rewrite.test.ts tests/codex-memory-prepare.test.ts
```

Expected: PASS.

## Task 5: CLI/API/UI Integration

**Owner:** Worker C + Worker E

**Files:**
- Modify: `src/codex/codex-cli.ts`
- Modify: `src/codex/codex-ui-api.ts`
- Modify: `src/ui/static/app.js`
- Test: `tests/codex-cli.test.ts`
- Test: `tests/codex-ui-api.test.ts`
- Test: `tests/codex-ui-static.test.ts`

- [ ] **Step 1: Add failing CLI/API tests**

Assert:

```txt
codex memory prepare --dry-run returns JSON summary
POST /api/memory/prepare/dry-run returns ok
POST /api/memory/prepare/apply mutates only pending
```

- [ ] **Step 2: Wire commands and routes**

Import `runCodexMemoryPrepare()` in CLI and API. Add route rejection for `scope=all`, matching distillation/triage single-root behavior.

- [ ] **Step 3: Add UI controls**

Add `PREPARE_DRY_RUN_ENDPOINT` / `PREPARE_APPLY_ENDPOINT`, buttons for dry-run/apply, and detail rail display for receipt status. Keep UI compact; no new full redesign.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- tests/codex-cli.test.ts tests/codex-ui-api.test.ts tests/codex-ui-static.test.ts
```

Expected: PASS.

## Task 6: Distillation Preview And Quality Contract

**Owner:** Worker D

**Files:**
- Modify: `src/codex/memory-distill.ts`
- Modify: `src/codex/memory-quality-contract.ts`
- Test: `tests/codex-memory-distill.test.ts`
- Test: `tests/memory-quality-contract.test.ts`

- [ ] **Step 1: Add failing distillation preview test**

Assert a distillation input cluster for pending hash conflicts returns:

```ts
expect(candidate.semanticMemory?.content ?? candidate.content).toContain('canonical pending.jsonl records')
expect(result.summary.inputsRead.distillationInputs).toBeGreaterThan(0)
```

and pending count is not changed by dry-run.

- [ ] **Step 2: Reuse semantic builder for preview**

Use `shapePendingCandidateContent()` to compute representative preview content for distillation candidate previews. Do not write pending records.

- [ ] **Step 3: Add semantic_prepare rubric**

Extend `MEMORY_QUALITY_RUBRIC` with `semantic_prepare` checks and update test expectations.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- tests/codex-memory-distill.test.ts tests/memory-quality-contract.test.ts
```

Expected: PASS.

## Task 7: v1.4 Acceptance Verification

**Owner:** Coordinator

**Files:**
- Create: `tests/codex-memory-prepare-v1-4-acceptance.test.ts`

- [ ] **Step 1: Add acceptance tests**

Cover all expected results from the spec:

```txt
implementation_note pending -> replace_content and active-ready
raw_file_rule_excerpt pending -> preserves sourceOfTruth and updates reviewHash
overbroad_workflow_rule pending -> constrained content
ready pending with template boundaries -> content hash unchanged and enrich_boundaries
good ready pending -> skip or no receipt
distillation input -> preview improves but pending count unchanged
task_state/episode/reference/auto_drop -> no pending materialization
LLM unavailable -> deterministic fallback works
invalid LLM output -> pending unchanged and fail receipt
active memory -> active index unchanged
new pending creation shaping -> two motivating examples reach expected content
```

- [ ] **Step 2: Run acceptance test**

Run:

```bash
npm test -- tests/codex-memory-prepare-v1-4-acceptance.test.ts
```

Expected: PASS.

## Final Verification

Run:

```bash
npm test -- tests/codex-memory-prepare-v1-4-acceptance.test.ts tests/semantic-rewrite.test.ts tests/semantic-boundaries.test.ts tests/semantic-content-builder.test.ts tests/semantic-rewrite-receipt.test.ts tests/codex-memory-prepare.test.ts tests/codex-memory-distill.test.ts tests/codex-memory-review.test.ts tests/codex-ui-static.test.ts tests/codex-ui-api.test.ts tests/codex-cli.test.ts tests/memory-quality-contract.test.ts
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
git diff --check
```

Expected:

```txt
all targeted tests pass
typecheck passes
plugin build passes
plugin validation passes
git diff --check has no output
pending count does not grow in acceptance fixtures
active memory does not mutate in prepare fixtures
motivating pending examples are shaped into target content
```
