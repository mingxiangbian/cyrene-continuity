# Candidate Hint Feedback Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. `superpowers:subagent-driven-development` is normally recommended for parallelizable slices, but this run uses inline execution because the available subagent tool requires an explicit user request for subagents.

**Goal:** Make every model-visible Candidate Hint carry a short-lived HMAC selection receipt, and require that receipt when candidate hint usage feedback is recorded.

**Architecture:** Keep Candidate Hints as a separate trial-only projection. Add a small receipt helper that owns local runtime verification-key storage, HMAC generation, and validation; context assembly attaches receipts only at the model-visible labeling boundary. Reuse `recordCodexMemoryFeedback` / `cyrene_memory_feedback` for feedback, adding receipt validation and audit fields without changing ordinary active memory feedback.

**Tech Stack:** TypeScript, Node `crypto`, local `~/.cyrene/codex/runtime` data, Vitest, existing MCP zod schema, existing Codex CLI.

---

## File Structure

- Create: `src/codex/candidate-hint-receipts.ts`
  - Owns `CandidateHintSelectionReceipt`, HMAC payload canonicalization, local verification-key load/create/read, receipt generation, and receipt validation.
- Modify: `src/codex/codex-memory-root.ts`
  - Adds `ensureCodexRuntimeRoot()` and `getReadableCodexRuntimeRoot()` so receipt keys are stored under runtime data, not memory data.
- Modify: `src/codex/candidate-hints.ts`
  - Adds optional `selectionReceipt` to `CandidateHint`; raw selector output may omit it.
- Modify: `src/codex/continuity-context.ts`
  - Generates one `contextId` per candidate-hint context build, attaches receipts while labeling model-visible hints, and fail-closes Candidate Hints when the key cannot be created/read.
- Modify: `src/codex/memory-feedback.ts`
  - Extends feedback input with `candidateHintReceipt`, validates receipt-bound candidate feedback, and writes audit fields `candidateHintContextId` and `candidateHintReceiptHash` without persisting the full receipt.
- Modify: `src/memory/types.ts`
  - Adds optional audit fields to `ActivationEvent`.
- Modify: `src/mcp/tools/memory-feedback.ts`
  - Adds MCP schema and handler pass-through for `candidateHintReceipt`.
- Modify: `src/mcp/mcp-server.ts`
  - Updates the `cyrene_memory_feedback` tool description to cover receipt-bound candidate hint usage feedback.
- Modify: `src/codex/codex-cli.ts`
  - Adds `--candidate-hint-receipt '<json>'` parsing for `codex memory feedback`.
- Modify: `docs/CLI.md`
  - Documents candidate hint feedback invocation.
- Modify: `plugin/skills/cyrene-continuity/SKILL.md`
  - Separates active activation feedback from receipt-bound Candidate Hint feedback.
- Modify generated: `plugin/runtime/cyrene-continuity.mjs`
  - Regenerated with `npm run build:plugin` after source and skill changes.
- Test: `tests/codex-candidate-hint-receipts.test.ts`
- Test: `tests/codex-continuity-context.test.ts`
- Test: `tests/codex-memory-feedback.test.ts`
- Test: `tests/mcp-server.test.ts`
- Test: `tests/codex-cli.test.ts`

## Execution Model

This is one implementation slice with ordered dependencies:

1. Receipt helper and runtime root are the base dependency.
2. Context output depends on the helper.
3. Feedback validation depends on the helper and context receipt shape.
4. MCP/CLI/docs/runtime updates depend on final field names.
5. Final verification depends on all source and generated runtime changes.

Subagent ownership if explicitly requested later:

- Context owner: `src/codex/candidate-hint-receipts.ts`, `src/codex/candidate-hints.ts`, `src/codex/continuity-context.ts`, `tests/codex-candidate-hint-receipts.test.ts`, `tests/codex-continuity-context.test.ts`.
- Feedback owner: `src/codex/memory-feedback.ts`, `src/memory/types.ts`, `tests/codex-memory-feedback.test.ts`.
- Surface owner: `src/mcp/tools/memory-feedback.ts`, `src/mcp/mcp-server.ts`, `src/codex/codex-cli.ts`, `docs/CLI.md`, `plugin/skills/cyrene-continuity/SKILL.md`, `tests/mcp-server.test.ts`, `tests/codex-cli.test.ts`.
- Verification owner: `npm run build:plugin`, focused tests, `npm run typecheck`, `npm test`, and runtime CLI smoke checks.

Parallelism:

- Context and feedback work should not be parallelized until the receipt helper is green.
- Feedback and surface work can be parallelized after the helper exists, but this inline run will execute serially to avoid conflicting edits in shared CLI/MCP types.

## Task 1: Receipt Helper And Runtime Key

**Files:**
- Create: `src/codex/candidate-hint-receipts.ts`
- Modify: `src/codex/codex-memory-root.ts`
- Test: `tests/codex-candidate-hint-receipts.test.ts`

- [ ] **Step 1: Write the failing receipt helper tests**

Add `tests/codex-candidate-hint-receipts.test.ts` with these behaviors:

```ts
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createCandidateHintSelectionReceipt,
  readCandidateHintReceiptVerificationKey,
  validateCandidateHintSelectionReceipt
} from '../src/codex/candidate-hint-receipts.js'

const tempDirs: string[] = []
const originalHome = process.env.HOME

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function useTempHome(): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'cyrene-candidate-hint-receipts-home-'))
  tempDirs.push(home)
  process.env.HOME = home
}

describe('candidate hint selection receipts', () => {
  it('creates a receipt with HMAC hash and no raw memory text fields', async () => {
    await useTempHome()

    const receipt = await createCandidateHintSelectionReceipt({
      contextId: 'context-1',
      hintId: 'hint-1',
      memoryId: 'memory-1',
      contentHash: 'content-hash-1',
      projectId: 'project-1',
      mode: 'balanced',
      selectedAt: '2026-06-13T00:00:00.000Z'
    })

    expect(receipt).toEqual({
      version: 1,
      contextId: 'context-1',
      hintId: 'hint-1',
      memoryId: 'memory-1',
      contentHash: 'content-hash-1',
      projectId: 'project-1',
      mode: 'balanced',
      selectedAt: '2026-06-13T00:00:00.000Z',
      receiptHash: expect.stringMatching(/^[a-f0-9]{32}$/)
    })
    expect(Object.keys(receipt)).not.toEqual(expect.arrayContaining([
      'text',
      'query',
      'transcript',
      'content'
    ]))
    await expect(readCandidateHintReceiptVerificationKey()).resolves.toMatch(/^[a-f0-9]{64}$/)
  })

  it('validates a matching receipt and rejects a plain SHA forgery', async () => {
    await useTempHome()
    const receipt = await createCandidateHintSelectionReceipt({
      contextId: 'context-2',
      hintId: 'hint-2',
      memoryId: 'memory-2',
      contentHash: 'content-hash-2',
      projectId: 'project-2',
      mode: 'review',
      selectedAt: '2026-06-13T00:00:00.000Z'
    })

    await expect(validateCandidateHintSelectionReceipt(receipt, {
      memoryId: 'memory-2',
      contentHash: 'content-hash-2',
      projectId: 'project-2',
      activationId: 'candidate-hint:hint-2',
      now: '2026-06-13T01:00:00.000Z'
    })).resolves.toEqual({
      ok: true,
      audit: {
        candidateHintContextId: 'context-2',
        candidateHintReceiptHash: receipt.receiptHash
      }
    })

    const forged = {
      ...receipt,
      receiptHash: createHash('sha256').update(JSON.stringify(receipt)).digest('hex').slice(0, 32)
    }
    await expect(validateCandidateHintSelectionReceipt(forged, {
      memoryId: 'memory-2',
      contentHash: 'content-hash-2',
      projectId: 'project-2',
      activationId: 'candidate-hint:hint-2',
      now: '2026-06-13T01:00:00.000Z'
    })).resolves.toEqual({
      ok: false,
      reason: 'candidate hint receipt hash mismatch'
    })
  })

  it('rejects expired and mismatched receipts with stable reasons', async () => {
    await useTempHome()
    const receipt = await createCandidateHintSelectionReceipt({
      contextId: 'context-3',
      hintId: 'hint-3',
      memoryId: 'memory-3',
      contentHash: 'content-hash-3',
      projectId: 'project-3',
      mode: 'balanced',
      selectedAt: '2026-06-13T00:00:00.000Z'
    })

    await expect(validateCandidateHintSelectionReceipt(receipt, {
      memoryId: 'different-memory',
      contentHash: 'content-hash-3',
      projectId: 'project-3',
      activationId: 'candidate-hint:hint-3',
      now: '2026-06-13T01:00:00.000Z'
    })).resolves.toEqual({
      ok: false,
      reason: 'candidate hint receipt does not match memory id'
    })
    await expect(validateCandidateHintSelectionReceipt(receipt, {
      memoryId: 'memory-3',
      contentHash: 'content-hash-3',
      projectId: 'project-3',
      activationId: 'candidate-hint:hint-3',
      now: '2026-06-14T00:00:01.000Z'
    })).resolves.toEqual({
      ok: false,
      reason: 'candidate hint receipt expired'
    })
  })
})
```

- [ ] **Step 2: Run RED for the helper tests**

Run:

```bash
npm test -- tests/codex-candidate-hint-receipts.test.ts
```

Expected: FAIL because `src/codex/candidate-hint-receipts.ts` does not exist.

- [ ] **Step 3: Implement runtime root helpers and receipt helper**

In `src/codex/codex-memory-root.ts`, export:

```ts
export async function ensureCodexRuntimeRoot(): Promise<string> {
  const codexDir = await ensureCodexBaseRoot()
  return ensureSafeDirectory(join(codexDir, 'runtime'), codexDir)
}

export async function getReadableCodexRuntimeRoot(): Promise<string | null> {
  const codexDir = await getReadableCodexBaseRoot()
  if (codexDir === null) return null
  return getSafeDirectoryOrNull(join(codexDir, 'runtime'), codexDir)
}
```

Create `src/codex/candidate-hint-receipts.ts` with:

```ts
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ensureCodexRuntimeRoot,
  getReadableCodexRuntimeRoot
} from './codex-memory-root.js'

export type CandidateHintReceiptMode = 'balanced' | 'review'

export interface CandidateHintSelectionReceipt {
  version: 1
  contextId: string
  hintId: string
  memoryId: string
  contentHash: string
  projectId: string
  mode: CandidateHintReceiptMode
  selectedAt: string
  receiptHash: string
}

export interface CandidateHintReceiptAudit {
  candidateHintContextId: string
  candidateHintReceiptHash: string
}

type ReceiptWithoutHash = Omit<CandidateHintSelectionReceipt, 'receiptHash'>

const RECEIPT_KEY_FILE = 'candidate-hint-receipt.key'
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000

export async function createCandidateHintSelectionReceipt(
  input: ReceiptWithoutHash
): Promise<CandidateHintSelectionReceipt> {
  const key = await loadOrCreateCandidateHintReceiptVerificationKey()
  const receipt = { ...input, version: 1 as const }
  return {
    ...receipt,
    receiptHash: candidateHintReceiptHash(receipt, key)
  }
}

export async function readCandidateHintReceiptVerificationKey(): Promise<string | undefined> {
  const root = await getReadableCodexRuntimeRoot()
  if (root === null) return undefined
  try {
    const value = (await readFile(join(root, RECEIPT_KEY_FILE), 'utf8')).trim()
    return /^[a-f0-9]{64}$/.test(value) ? value : undefined
  } catch {
    return undefined
  }
}

export async function validateCandidateHintSelectionReceipt(
  value: unknown,
  expected: {
    memoryId: string
    contentHash: string
    projectId: string
    activationId?: string
    now?: string
  }
): Promise<
  | { ok: true; audit: CandidateHintReceiptAudit }
  | { ok: false; reason: string }
> {
  if (!isCandidateHintSelectionReceipt(value)) {
    return { ok: false, reason: 'candidate hint receipt is required for candidate-hint activation' }
  }
  if (value.memoryId !== expected.memoryId) {
    return { ok: false, reason: 'candidate hint receipt does not match memory id' }
  }
  if (value.contentHash !== expected.contentHash) {
    return { ok: false, reason: 'candidate hint receipt does not match content hash' }
  }
  if (value.projectId !== expected.projectId) {
    return { ok: false, reason: 'candidate hint receipt does not match project id' }
  }
  if (expected.activationId !== `candidate-hint:${value.hintId}`) {
    return { ok: false, reason: 'candidate hint receipt does not match activation id' }
  }
  const selectedAtMs = Date.parse(value.selectedAt)
  const nowMs = Date.parse(expected.now ?? new Date().toISOString())
  if (!Number.isFinite(selectedAtMs) || !Number.isFinite(nowMs) || nowMs - selectedAtMs > RECEIPT_TTL_MS || nowMs < selectedAtMs) {
    return { ok: false, reason: 'candidate hint receipt expired' }
  }
  const key = await readCandidateHintReceiptVerificationKey()
  if (key === undefined) {
    return { ok: false, reason: 'candidate hint receipt hash mismatch' }
  }
  const expectedHash = candidateHintReceiptHash(receiptWithoutHash(value), key)
  if (!safeEqualHex(value.receiptHash, expectedHash)) {
    return { ok: false, reason: 'candidate hint receipt hash mismatch' }
  }
  return {
    ok: true,
    audit: {
      candidateHintContextId: value.contextId,
      candidateHintReceiptHash: value.receiptHash
    }
  }
}

async function loadOrCreateCandidateHintReceiptVerificationKey(): Promise<string> {
  const existing = await readCandidateHintReceiptVerificationKey()
  if (existing !== undefined) return existing
  const root = await ensureCodexRuntimeRoot()
  const key = randomBytes(32).toString('hex')
  await writeFile(join(root, RECEIPT_KEY_FILE), `${key}\n`, { mode: 0o600 })
  return key
}

function candidateHintReceiptHash(receipt: ReceiptWithoutHash, key: string): string {
  return createHmac('sha256', key)
    .update(JSON.stringify(receiptPayload(receipt)))
    .digest('hex')
    .slice(0, 32)
}

function receiptPayload(receipt: ReceiptWithoutHash): ReceiptWithoutHash {
  return {
    version: 1,
    contextId: receipt.contextId,
    hintId: receipt.hintId,
    memoryId: receipt.memoryId,
    contentHash: receipt.contentHash,
    projectId: receipt.projectId,
    mode: receipt.mode,
    selectedAt: receipt.selectedAt
  }
}

function receiptWithoutHash(receipt: CandidateHintSelectionReceipt): ReceiptWithoutHash {
  return receiptPayload(receipt)
}

function isCandidateHintSelectionReceipt(value: unknown): value is CandidateHintSelectionReceipt {
  if (typeof value !== 'object' || value === null) return false
  const receipt = value as Record<string, unknown>
  return (
    receipt.version === 1 &&
    typeof receipt.contextId === 'string' &&
    typeof receipt.hintId === 'string' &&
    typeof receipt.memoryId === 'string' &&
    typeof receipt.contentHash === 'string' &&
    typeof receipt.projectId === 'string' &&
    (receipt.mode === 'balanced' || receipt.mode === 'review') &&
    typeof receipt.selectedAt === 'string' &&
    typeof receipt.receiptHash === 'string'
  )
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/.test(left) || !/^[a-f0-9]+$/.test(right)) return false
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
```

- [ ] **Step 4: Run GREEN for the helper tests**

Run:

```bash
npm test -- tests/codex-candidate-hint-receipts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/codex/codex-memory-root.ts src/codex/candidate-hint-receipts.ts tests/codex-candidate-hint-receipts.test.ts
git commit -m "feat: add candidate hint receipt helper"
```

## Task 2: Context Candidate Hint Receipts

**Files:**
- Modify: `src/codex/candidate-hints.ts`
- Modify: `src/codex/continuity-context.ts`
- Test: `tests/codex-continuity-context.test.ts`

- [ ] **Step 1: Write failing context tests**

Update existing candidate hint tests in `tests/codex-continuity-context.test.ts`:

```ts
import { validateCandidateHintSelectionReceipt } from '../src/codex/candidate-hint-receipts.js'
```

In `balanced mode exposes active project trial strong relevance only as candidate hint`, assert:

```ts
const receipt = context.candidateHints[0]?.selectionReceipt
expect(receipt).toEqual(expect.objectContaining({
  version: 1,
  hintId: expect.any(String),
  memoryId: 'candidate-trial-strong',
  projectId: identity.projectId,
  mode: 'balanced',
  receiptHash: expect.stringMatching(/^[a-f0-9]{32}$/)
}))
expect(receipt?.contentHash).toBe(context.candidateHints[0]?.contentHash)
expect(JSON.stringify(receipt)).not.toContain('Runtime activation validator changes')
await expect(validateCandidateHintSelectionReceipt(receipt, {
  memoryId: 'candidate-trial-strong',
  contentHash: context.candidateHints[0]?.contentHash ?? '',
  projectId: identity.projectId,
  activationId: `candidate-hint:${context.candidateHints[0]?.id}`,
  now: receipt?.selectedAt
})).resolves.toMatchObject({ ok: true })
```

In `review mode returns at most three strong-relevance candidate hints`, assert:

```ts
const contextIds = new Set(context.candidateHints.map((hint) => hint.selectionReceipt?.contextId))
expect(contextIds.size).toBe(1)
expect([...contextIds][0]).toEqual(expect.any(String))
expect(context.candidateHints.every((hint) => hint.selectionReceipt?.mode === 'review')).toBe(true)
```

Keep `fast mode returns no candidate hints even when a relevant project trial exists` unchanged as the negative receipt case.

- [ ] **Step 2: Run RED for context tests**

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts -t "candidate hint"
```

Expected: FAIL because `selectionReceipt` is missing.

- [ ] **Step 3: Implement model-visible receipt attachment**

In `src/codex/candidate-hints.ts`, import the type and make the field optional:

```ts
import type { CandidateHintSelectionReceipt } from './candidate-hint-receipts.js'

export interface CandidateHint {
  id: string
  memoryId: string
  contentHash: string
  confidenceTier: 'trial'
  activationMode: 'workflow_hint'
  text: string
  candidate: true
  validated: false
  source: 'project'
  projectId: string
  risk: 'low'
  triggerReason: string
  selectionReceipt?: CandidateHintSelectionReceipt
}
```

In `src/codex/continuity-context.ts`, import `randomUUID` and the helper:

```ts
import { createHash, randomUUID } from 'node:crypto'
import { createCandidateHintSelectionReceipt } from './candidate-hint-receipts.js'
```

Change `selectSqliteCandidateHints` so the selected hints are labeled through an async receipt step:

```ts
const selectedAt = new Date().toISOString()
const contextId = randomUUID()
const hints = await Promise.all(result.hints.map((hint) => labelModelVisibleCandidateHint({
  hint,
  contextId,
  selectedAt,
  mode: input.policy.mode === 'review' ? 'review' : 'balanced'
})))
return {
  hints,
  metrics: {
    ...result.metrics,
    candidateHintLatencyMs: elapsedSince(startedAt)
  }
}
```

Replace `labelModelVisibleCandidateHint(hint: CandidateHint)` with:

```ts
async function labelModelVisibleCandidateHint(input: {
  hint: CandidateHint
  contextId: string
  selectedAt: string
  mode: 'balanced' | 'review'
}): Promise<CandidateHint> {
  const selectionReceipt = await createCandidateHintSelectionReceipt({
    version: 1,
    contextId: input.contextId,
    hintId: input.hint.id,
    memoryId: input.hint.memoryId,
    contentHash: input.hint.contentHash,
    projectId: input.hint.projectId,
    mode: input.mode,
    selectedAt: input.selectedAt
  })
  return {
    ...input.hint,
    text: `Candidate project workflow hint, not validated:\n- ${input.hint.text.trim()}`,
    selectionReceipt
  }
}
```

The existing `try/catch` around candidate hint selection must remain so key errors fail closed with zero selected hints.

- [ ] **Step 4: Run GREEN for context tests**

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts -t "candidate hint"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/codex/candidate-hints.ts src/codex/continuity-context.ts tests/codex-continuity-context.test.ts
git commit -m "feat: attach receipts to candidate hints"
```

## Task 3: Receipt-Bound Feedback Validation

**Files:**
- Modify: `src/codex/memory-feedback.ts`
- Modify: `src/memory/types.ts`
- Test: `tests/codex-memory-feedback.test.ts`

- [ ] **Step 1: Write failing feedback tests**

Update `tests/codex-memory-feedback.test.ts`:

```ts
import { createCandidateHintSelectionReceipt } from '../src/codex/candidate-hint-receipts.js'
```

Replace the existing candidate hint feedback test with receipt-bound behavior:

```ts
it('requires a receipt for candidate hint feedback', async () => {
  const { cwd, memoryRoot, memory } = await seedActiveProjectMemory()

  const result = await recordCodexMemoryFeedback({
    cwd,
    memoryId: memory.id,
    contentHash: contentHashForActiveMemory(memory),
    event: 'applied',
    activationId: 'candidate-hint:feedback-active-1',
    query: 'Candidate hint feedback should bind to the shown workflow hint.',
    now: '2026-06-04T00:00:00.000Z'
  })

  expect(result.result).toEqual({
    action: 'invalid_request',
    reason: 'candidate hint receipt is required for candidate-hint activation'
  })
  expect(await readActivationEventsFromRoot(memoryRoot)).toEqual([])
})

it('records candidate hint feedback with receipt audit fields but not the full receipt', async () => {
  const { cwd, memoryRoot, memory } = await seedActiveProjectMemory()
  const project = await identifyCodexProject(cwd)
  const contentHash = contentHashForActiveMemory(memory)
  const receipt = await createCandidateHintSelectionReceipt({
    version: 1,
    contextId: 'candidate-context-1',
    hintId: 'feedback-active-1',
    memoryId: memory.id,
    contentHash,
    projectId: project.projectId,
    mode: 'balanced',
    selectedAt: '2026-06-04T00:00:00.000Z'
  })

  const result = await recordCodexMemoryFeedback({
    cwd,
    memoryId: memory.id,
    contentHash,
    event: 'applied',
    activationId: 'candidate-hint:feedback-active-1',
    candidateHintReceipt: receipt,
    query: 'Candidate hint feedback should bind to the shown workflow hint.',
    now: '2026-06-04T00:00:01.000Z'
  })

  expect(result.result).toMatchObject({
    action: 'recorded',
    memoryId: memory.id,
    event: 'applied',
    queryHash: expect.stringMatching(/^[a-f0-9]{16}$/)
  })
  const events = await readActivationEventsFromRoot(memoryRoot)
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    memoryId: memory.id,
    projectId: project.projectId,
    event: 'applied',
    activationId: 'candidate-hint:feedback-active-1',
    contentHash,
    candidateHintContextId: 'candidate-context-1',
    candidateHintReceiptHash: receipt.receiptHash,
    queryHash: expect.stringMatching(/^[a-f0-9]{16}$/)
  })
  expect(JSON.stringify(events)).not.toContain('candidateHintReceipt')
  expect(JSON.stringify(events)).not.toContain('Candidate hint feedback should bind')
})

it('records ignored candidate hint feedback with a matching receipt as neutral evidence', async () => {
  const { cwd, memoryRoot, memory } = await seedActiveProjectMemory()
  const project = await identifyCodexProject(cwd)
  const contentHash = contentHashForActiveMemory(memory)
  const receipt = await createCandidateHintSelectionReceipt({
    version: 1,
    contextId: 'candidate-context-ignored',
    hintId: 'feedback-active-1',
    memoryId: memory.id,
    contentHash,
    projectId: project.projectId,
    mode: 'balanced',
    selectedAt: '2026-06-04T00:00:00.000Z'
  })

  const result = await recordCodexMemoryFeedback({
    cwd,
    memoryId: memory.id,
    contentHash,
    event: 'ignored',
    activationId: 'candidate-hint:feedback-active-1',
    candidateHintReceipt: receipt,
    now: '2026-06-04T00:00:01.000Z'
  })

  expect(result.result).toMatchObject({
    action: 'recorded',
    memoryId: memory.id,
    event: 'ignored'
  })
  await expect(readActivationEventsFromRoot(memoryRoot)).resolves.toEqual([
    expect.objectContaining({
      event: 'ignored',
      candidateHintContextId: 'candidate-context-ignored',
      candidateHintReceiptHash: receipt.receiptHash
    })
  ])
})
```

Add an `it.each` table for mismatch reasons:

```ts
it.each([
  ['memory id', { memoryId: 'other-memory' }, 'candidate hint receipt does not match memory id'],
  ['content hash', { contentHash: 'other-hash' }, 'candidate hint receipt does not match content hash'],
  ['project id', { projectId: 'other-project' }, 'candidate hint receipt does not match project id'],
  ['activation id', { activationId: 'candidate-hint:other-hint' }, 'candidate hint receipt does not match activation id'],
  ['expired', { now: '2026-06-05T00:00:01.000Z' }, 'candidate hint receipt expired'],
  ['hash', { receiptHash: '0'.repeat(32) }, 'candidate hint receipt hash mismatch']
] as const)('rejects candidate hint receipt mismatch: %s', async (_label, override, reason) => {
  const { cwd, memoryRoot, memory } = await seedActiveProjectMemory()
  const project = await identifyCodexProject(cwd)
  const contentHash = contentHashForActiveMemory(memory)
  const receipt = await createCandidateHintSelectionReceipt({
    version: 1,
    contextId: 'candidate-context-mismatch',
    hintId: 'feedback-active-1',
    memoryId: memory.id,
    contentHash,
    projectId: project.projectId,
    mode: 'balanced',
    selectedAt: '2026-06-04T00:00:00.000Z'
  })
  const candidateHintReceipt = { ...receipt, ...('receiptHash' in override ? { receiptHash: override.receiptHash } : {}) }

  const result = await recordCodexMemoryFeedback({
    cwd,
    memoryId: override.memoryId ?? memory.id,
    contentHash: override.contentHash ?? contentHash,
    event: 'applied',
    activationId: override.activationId ?? 'candidate-hint:feedback-active-1',
    candidateHintReceipt: {
      ...candidateHintReceipt,
      projectId: override.projectId ?? candidateHintReceipt.projectId
    },
    query: 'Candidate hint mismatch.',
    now: override.now ?? '2026-06-04T00:00:01.000Z'
  })

  expect(result.result).toEqual({ action: 'invalid_request', reason })
  expect(await readActivationEventsFromRoot(memoryRoot)).toEqual([])
})
```

- [ ] **Step 2: Run RED for feedback tests**

Run:

```bash
npm test -- tests/codex-memory-feedback.test.ts
```

Expected: FAIL because candidate hint feedback without receipt is currently accepted and `candidateHintReceipt` is not in the input type.

- [ ] **Step 3: Implement feedback validation and audit fields**

In `src/memory/types.ts`, extend `ActivationEvent`:

```ts
  candidateHintContextId?: string
  candidateHintReceiptHash?: string
```

In `src/codex/memory-feedback.ts`, import and extend:

```ts
import {
  validateCandidateHintSelectionReceipt,
  type CandidateHintReceiptAudit,
  type CandidateHintSelectionReceipt
} from './candidate-hint-receipts.js'

export interface CodexMemoryFeedbackInput {
  cwd: string
  memoryId: string
  contentHash: string
  event: PublicActivationFeedbackEvent
  activationId?: string
  evidenceRef?: string
  query?: string
  reason?: string
  idempotencyKey?: string
  candidateHintReceipt?: CandidateHintSelectionReceipt
  now?: string
}

type ActivationFeedbackEvent = ActivationEvent & {
  contentHash?: string
  idempotencyKey?: string
  candidateHintContextId?: string
  candidateHintReceiptHash?: string
}
```

After `validatePublicFeedbackInput(input)`, add:

```ts
const candidateHintValidation = await validateCandidateHintFeedbackInput(input, {
  projectId: project.projectId,
  now: input.now
})
if (candidateHintValidation.ok === false) {
  return defaultResult({ action: 'invalid_request', reason: candidateHintValidation.reason })
}
```

When constructing `event`, add:

```ts
      ...(candidateHintValidation.audit === undefined ? {} : candidateHintValidation.audit),
```

Add helper:

```ts
async function validateCandidateHintFeedbackInput(
  input: CodexMemoryFeedbackInput,
  context: { projectId: string; now?: string }
): Promise<
  | { ok: true; audit?: CandidateHintReceiptAudit }
  | { ok: false; reason: string }
> {
  const hasCandidateHintActivation = input.activationId?.startsWith('candidate-hint:') === true
  if (!hasCandidateHintActivation && input.candidateHintReceipt === undefined) {
    return { ok: true }
  }
  const result = await validateCandidateHintSelectionReceipt(input.candidateHintReceipt, {
    memoryId: input.memoryId,
    contentHash: input.contentHash,
    projectId: context.projectId,
    activationId: input.activationId,
    now: context.now
  })
  if (result.ok === false) {
    return result
  }
  return { ok: true, audit: result.audit }
}
```

- [ ] **Step 4: Run GREEN for feedback tests**

Run:

```bash
npm test -- tests/codex-memory-feedback.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/codex/memory-feedback.ts src/memory/types.ts tests/codex-memory-feedback.test.ts
git commit -m "feat: validate candidate hint feedback receipts"
```

## Task 4: MCP, CLI, Skill, Docs, Runtime

**Files:**
- Modify: `src/mcp/tools/memory-feedback.ts`
- Modify: `src/mcp/mcp-server.ts`
- Modify: `src/codex/codex-cli.ts`
- Modify: `docs/CLI.md`
- Modify: `plugin/skills/cyrene-continuity/SKILL.md`
- Modify generated: `plugin/runtime/cyrene-continuity.mjs`
- Test: `tests/mcp-server.test.ts`
- Test: `tests/codex-cli.test.ts`

- [ ] **Step 1: Write failing MCP and CLI tests**

In `tests/mcp-server.test.ts`, import the receipt helper and add a check to the memory feedback test:

```ts
import { createCandidateHintSelectionReceipt } from '../src/codex/candidate-hint-receipts.js'
```

Append:

```ts
const receipt = await createCandidateHintSelectionReceipt({
  version: 1,
  contextId: 'mcp-candidate-context',
  hintId: 'mcp-feedback-active',
  memoryId: memory.id,
  contentHash: contentHashForActiveMemory(memory),
  projectId: project.projectId,
  mode: 'balanced',
  selectedAt: '2026-06-04T00:00:00.000Z'
})
const candidateFeedbackJson = JSON.parse(
  (await handleMemoryFeedback({
    memoryId: memory.id,
    contentHash: contentHashForActiveMemory(memory),
    event: 'ignored',
    activationId: 'candidate-hint:mcp-feedback-active',
    candidateHintReceipt: receipt
  }, cwd)).content[0]?.text ?? '{}'
)

expect(candidateFeedbackJson.result.action).toBe('recorded')
expect(memoryFeedbackInputSchema).toHaveProperty('candidateHintReceipt')
```

In `tests/codex-cli.test.ts`, add:

```ts
it('records candidate hint feedback from the CLI with a receipt', async () => {
  const home = await createTempDir('cyrene-codex-cli-candidate-feedback-home-')
  process.env.HOME = home
  const cwd = await createTempDir('cyrene-codex-cli-candidate-feedback-project-')
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'candidate-feedback-cli-test' }), 'utf8')
  const { active, contentHash, memoryRoot } = await seedCliActiveMemory(cwd)
  const project = await identifyCodexProject(cwd)
  const receipt = await createCandidateHintSelectionReceipt({
    version: 1,
    contextId: 'cli-candidate-context',
    hintId: active.id,
    memoryId: active.id,
    contentHash,
    projectId: project.projectId,
    mode: 'balanced',
    selectedAt: '2026-06-04T00:00:00.000Z'
  })

  const result = await execFileAsync(
    process.execPath,
    [
      join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
      join(process.cwd(), 'src/main.ts'),
      '--cwd',
      cwd,
      'codex',
      'memory',
      'feedback',
      active.id,
      '--content-hash',
      contentHash,
      '--event',
      'ignored',
      '--activation-id',
      `candidate-hint:${active.id}`,
      '--candidate-hint-receipt',
      JSON.stringify(receipt)
    ],
    { cwd: process.cwd(), env: cliEnv(home), timeout: 10_000 }
  )
  const parsed = JSON.parse(result.stdout)

  expect(parsed.result.action).toBe('recorded')
  await expect(readActivationEventsFromRoot(memoryRoot)).resolves.toEqual([
    expect.objectContaining({
      event: 'ignored',
      candidateHintContextId: 'cli-candidate-context',
      candidateHintReceiptHash: receipt.receiptHash
    })
  ])
})
```

Extend the invalid CLI feedback table with:

```ts
['invalid candidate hint receipt JSON', ['--event', 'ignored', '--activation-id', 'candidate-hint:x', '--candidate-hint-receipt', '{bad-json'], 'Invalid --candidate-hint-receipt: expected JSON object']
```

- [ ] **Step 2: Run RED for MCP and CLI tests**

Run:

```bash
npm test -- tests/mcp-server.test.ts tests/codex-cli.test.ts -t "feedback"
```

Expected: FAIL because schema and CLI do not accept `candidateHintReceipt`.

- [ ] **Step 3: Implement MCP and CLI pass-through**

In `src/mcp/tools/memory-feedback.ts`, add:

```ts
const candidateHintReceiptSchema = z.object({
  version: z.literal(1),
  contextId: z.string(),
  hintId: z.string(),
  memoryId: z.string(),
  contentHash: z.string(),
  projectId: z.string(),
  mode: z.enum(['balanced', 'review']),
  selectedAt: z.string(),
  receiptHash: z.string()
})

export const memoryFeedbackInputSchema = {
  memoryId: z.string().min(1),
  contentHash: z.string().min(1),
  event: z.enum(['applied', 'ignored', 'corrected', 'violated']),
  activationId: z.string().optional(),
  evidenceRef: z.string().optional(),
  query: z.string().optional(),
  reason: z.string().optional(),
  idempotencyKey: z.string().optional(),
  candidateHintReceipt: candidateHintReceiptSchema.optional()
}
```

Pass `candidateHintReceipt: input.candidateHintReceipt` into `recordCodexMemoryFeedback`.

In `src/mcp/mcp-server.ts`, update the description:

```ts
'Record hash-checked active memory usage feedback or receipt-bound candidate hint usage feedback as lifecycle evidence; this never promotes, edits, archives, or tombstones memory directly.'
```

In `src/codex/codex-cli.ts`, add:

```ts
candidateHintReceipt: parseOptionalCandidateHintReceipt(input.args),
```

and:

```ts
function parseOptionalCandidateHintReceipt(args: string[]): unknown {
  const value = parseOptionalOption(args, '--candidate-hint-receipt')
  if (value === undefined) return undefined
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed
    }
  } catch {
    // handled below
  }
  throw new Error('Invalid --candidate-hint-receipt: expected JSON object')
}
```

Update usage text to include `[--candidate-hint-receipt <json>]`.

- [ ] **Step 4: Update docs and skill**

In `docs/CLI.md`, add a candidate hint example:

```md
npm run dev -- codex memory feedback <memoryId> --content-hash <hash> --event applied --activation-id candidate-hint:<hintId> --candidate-hint-receipt '<json>' --query "..."
npm run dev -- codex memory feedback <memoryId> --content-hash <hash> --event ignored --activation-id candidate-hint:<hintId> --candidate-hint-receipt '<json>'
```

In `plugin/skills/cyrene-continuity/SKILL.md`, replace the feedback rule with two explicit bullets:

```md
26. When `cyrene_continuity_get` returns an active activation item with `memoryId` and `contentHash`, call `cyrene_memory_feedback` after the memory is actually applied, ignored, corrected, or violated. Feedback is active-memory evidence only: it must not include raw transcript/appshot/attachment content, must rely on `contentHash`, and must not be described as promotion.
27. When `cyrene_continuity_get` returns `candidateHints`, call `cyrene_memory_feedback` only after a Candidate Hint is actually applied or explicitly ignored. Candidate Hint feedback must include `activationId: candidate-hint:<hintId>` and that hint's `selectionReceipt` as `candidateHintReceipt`; mere display, ranking, diagnostics, or retrieval does not justify feedback.
```

Renumber following items if necessary.

- [ ] **Step 5: Run GREEN for surface tests**

Run:

```bash
npm test -- tests/mcp-server.test.ts tests/codex-cli.test.ts -t "feedback"
```

Expected: PASS.

- [ ] **Step 6: Rebuild plugin runtime**

Run:

```bash
npm run build:plugin
```

Expected: generated `plugin/runtime/cyrene-continuity.mjs` updates include the new schema, description, helper, and skill text.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add src/mcp/tools/memory-feedback.ts src/mcp/mcp-server.ts src/codex/codex-cli.ts docs/CLI.md plugin/skills/cyrene-continuity/SKILL.md plugin/runtime/cyrene-continuity.mjs tests/mcp-server.test.ts tests/codex-cli.test.ts
git commit -m "feat: expose candidate hint receipts through feedback surfaces"
```

## Task 5: Final Verification And Runtime Smoke

**Files:**
- No planned source edits.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/codex-candidate-hint-receipts.test.ts tests/codex-continuity-context.test.ts tests/codex-memory-feedback.test.ts tests/mcp-server.test.ts tests/codex-cli.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run runtime context smoke**

Run:

```bash
npm run dev -- --cwd /Users/phoenix/Assistant/cyrene-continuity/.worktrees/codex-candidate-hint-feedback-receipts codex memory context-preview --message "candidate hint feedback receipt implementation" --task coding --mode balanced --include-diagnostics
```

Expected: JSON output is valid. If `candidateHints` is non-empty, each item includes `selectionReceipt.version === 1` and a 32-hex `receiptHash`. If no local candidate is selected, run the temp fixture smoke in Step 5.

- [ ] **Step 5: Run temp runtime feedback smoke if Step 4 has no candidate hint**

Run a temp HOME smoke with `tsx` that seeds one active memory, creates a receipt through the public helper, and records CLI feedback:

```bash
node --input-type=module <<'EOF'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execFileAsync = promisify(execFile)
const cwd = process.cwd()
const home = await mkdtemp(join(tmpdir(), 'cyrene-runtime-candidate-feedback-home-'))
const project = await mkdtemp(join(tmpdir(), 'cyrene-runtime-candidate-feedback-project-'))
await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'runtime-candidate-feedback' }), 'utf8')
const seed = `
import { identifyCodexProject } from './src/codex/project-id.js'
import { codexProjectMemoryRoot } from './src/codex/codex-memory-root.js'
import { contentHashForActiveMemory } from './src/codex/active-memory-review.js'
import { createCandidateHintSelectionReceipt } from './src/codex/candidate-hint-receipts.js'
import { writeActiveMemoriesFromRoot } from './src/memory/memory-store.js'
const project = await identifyCodexProject(process.argv[2])
const memoryRoot = codexProjectMemoryRoot(project.projectId)
const memory = {
  id: 'runtime-candidate-feedback-memory',
  domain: 'procedural',
  type: 'procedural_rule',
  strength: 'hard',
  scope: 'project',
  status: 'active',
  content: 'Runtime smoke candidate feedback should require a receipt.',
  normalizedKey: 'runtime-smoke-candidate-feedback',
  evidence: [{ runId: 'runtime-smoke', summary: 'Runtime smoke seed.' }],
  source: 'review_event',
  scores: { evidenceStrength: 0.95, stability: 0.9, usefulness: 0.9, safety: 0.95, sensitivity: 0.1 },
  createdAt: '2026-06-13T00:00:00.000Z',
  updatedAt: '2026-06-13T00:00:00.000Z',
  tags: []
}
await writeActiveMemoriesFromRoot(memoryRoot, [memory])
const contentHash = contentHashForActiveMemory(memory)
const receipt = await createCandidateHintSelectionReceipt({
  version: 1,
  contextId: 'runtime-smoke-context',
  hintId: memory.id,
  memoryId: memory.id,
  contentHash,
  projectId: project.projectId,
  mode: 'balanced',
  selectedAt: '2026-06-13T00:00:00.000Z'
})
console.log(JSON.stringify({ memoryId: memory.id, contentHash, receipt }))
`
const seedResult = await execFileAsync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--eval', seed, project], { cwd, env: { ...process.env, HOME: home } })
const seeded = JSON.parse(seedResult.stdout)
const feedback = await execFileAsync(process.execPath, [
  'node_modules/tsx/dist/cli.mjs',
  'src/main.ts',
  '--cwd',
  project,
  'codex',
  'memory',
  'feedback',
  seeded.memoryId,
  '--content-hash',
  seeded.contentHash,
  '--event',
  'ignored',
  '--activation-id',
  `candidate-hint:${seeded.memoryId}`,
  '--candidate-hint-receipt',
  JSON.stringify(seeded.receipt)
], { cwd, env: { ...process.env, HOME: home } })
console.log(feedback.stdout)
await rm(home, { recursive: true, force: true })
await rm(project, { recursive: true, force: true })
EOF
```

Expected: JSON output has `result.action === "recorded"` and event `"ignored"`.

- [ ] **Step 6: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected: only planned files changed, no whitespace errors.

- [ ] **Step 7: Commit any verification-only doc updates**

If final verification required a small docs correction, commit it:

```bash
git add <changed-doc-file>
git commit -m "docs: clarify candidate hint feedback receipts"
```

If no extra doc correction exists, skip this step.

