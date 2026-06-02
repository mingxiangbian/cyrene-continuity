# Cyrene v1.3 Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补完 v1.3 剩余断点，让 source boundary、task_state、router policy、distillation breadth、review workflow UI 和 structured approval 进入主流程。

**Architecture:** 保留 legacy pending/active store，但把 explicit `sourceOfTruth`、`task_state`、`reference_only` 和 router `updatePolicy` 接入 admission pipeline。`strict_auto_promote` 只作为进入既有 v5 gate 的许可，所有 active writes 仍由 review hash、eval gate、daily cap、receipt 保护。

**Tech Stack:** TypeScript ES2022、NodeNext、Vitest、JSONL memory store、static Web UI、existing v5 auto-promotion policy。

---

## Task 1: Admission Vocabulary And Source Boundary

**Owner:** Worker A

**Files:**
- Modify: `src/memory/types.ts`
- Modify: `src/codex/candidate-drafts.ts`
- Modify: `src/codex/memory-propose.ts`
- Modify: `src/memory/memory-validator.ts`
- Modify: `src/memory/semantic-memory-adapter.ts`
- Test: `tests/codex-candidate-drafts.test.ts`
- Test: `tests/codex-memory-propose.test.ts`

- [ ] **Step 1: Add failing tests for explicit source boundary propagation**

Add assertions that a candidate with `sourceOfTruth: 'AGENTS.md'` produces:

```ts
expect(draft.sourceOfTruth).toBe('AGENTS.md')
expect(pending.sourceOfTruth).toBe('AGENTS.md')
expect(active.sourceOfTruth).toBe('AGENTS.md')
expect(pendingMemoryToSemanticMemory(pending).sourceOfTruth).toBe('AGENTS.md')
expect(activeMemoryToSemanticMemory(active).sourceOfTruth).toBe('AGENTS.md')
```

Run:

```bash
npm test -- tests/codex-candidate-drafts.test.ts tests/codex-memory-propose.test.ts
```

Expected before implementation: tests fail because pending/active memory do not preserve explicit `sourceOfTruth`.

- [ ] **Step 2: Update shared types**

Change `src/memory/types.ts`:

```ts
export const MEMORY_MODULES = [
  'project_semantic',
  'procedural',
  'system',
  'preference',
  'global_policy',
  'relationship_affective',
  'principle_candidate',
  'task_state'
] as const
```

Extend `ADMISSION_ACTIONS`:

```ts
export const ADMISSION_ACTIONS = [
  'admit_to_pending',
  'admit_to_distillation',
  'episode_only',
  'task_state',
  'reference_only',
  'auto_drop',
  'auto_defer',
  'merge_with_existing',
  'reject_duplicate'
] as const
```

Add optional source boundary fields:

```ts
export interface CyreneMemory {
  sourceOfTruth?: string
}

export interface PendingMemory {
  sourceOfTruth?: string
}

export interface SemanticMemoryReviewState {
  sourceOfTruth?: string
}
```

Keep existing required fields unchanged.

- [ ] **Step 3: Preserve sourceOfTruth through candidate/propose/activate**

Update:

- `toCandidateDraft()` keeps `candidate.sourceOfTruth`.
- `toPendingMemory()` writes `sourceOfTruth`.
- `activateCandidate()` or the activation path copies `sourceOfTruth` from pending to active.
- `semantic-memory-adapter.ts` uses `memory.sourceOfTruth ?? memory.normalizedKey` only for fallback.

Run:

```bash
npm test -- tests/codex-candidate-drafts.test.ts tests/codex-memory-propose.test.ts
```

Expected after implementation: tests pass.

## Task 2: Admission Actions And Router-Driven Pipeline

**Owner:** Worker A after Task 1

**Files:**
- Modify: `src/codex/admission-gate.ts`
- Modify: `src/codex/memory-router.ts`
- Modify: `src/codex/admission-pipeline.ts`
- Test: `tests/codex-admission-gate.test.ts`
- Test: `tests/codex-memory-router.test.ts`
- Test: `tests/codex-admission-pipeline.test.ts`

- [ ] **Step 1: Add failing tests for new actions**

Required assertions:

```ts
expect(sourceDuplicateDecision.action).toBe('reference_only')
expect(sourceDuplicateDecision.reasons).toContain('source_of_truth_duplicate')

expect(taskDecision.action).toBe('task_state')
expect(taskDecision.reasons).toContain('task_state')

expect(taskRoute.target.module).toBe('task_state')
expect(taskRoute.target.updatePolicy).toBe('defer')

expect(proposeSpy.mock.calls[0]?.[0].allowAutoPromote).toBe(false)
expect(proposeSpy.mock.calls[1]?.[0].allowAutoPromote).toBe(true)
```

Use spies on `proposeCodexMemoryCandidate()` where needed; do not infer `allowAutoPromote` from final action alone.

- [ ] **Step 2: Implement explicit admission actions**

In `evaluateCandidateAdmission()`:

```ts
if (reasons.includes('task_state')) {
  return decision(input.draft, 'task_state', reasons, scores, now)
}
```

Add source duplicate handling before `actionFor()`:

```ts
if (isSourceOfTruthReferenceOnly(input.draft, reasons)) {
  return decision(input.draft, 'reference_only', ['source_of_truth_duplicate', ...reasons], scores, now)
}
```

`isSourceOfTruthReferenceOnly()` should be conservative:

- true when `sourceOfTruth` is present,
- readiness includes `raw_file_rule_excerpt`,
- content has no new operational interpretation signal such as `because`, `exception`, `applies when`, `mitigation`, `避免`, `例外`, `适用`, `边界`, `改写`.

- [ ] **Step 3: Make router policy drive write path**

In `memory-router.ts`:

- `admission.action === 'task_state'` => `module: 'task_state'`, `updatePolicy: 'defer'`.
- `admission.action === 'reference_only'` => `updatePolicy: 'drop'` and reason `source-of-truth duplicate is reference-only`.
- low-risk project/procedural/repo-local system with `sourceKind` in `file | tool_trace | user_explicit` and `admission.action === 'admit_to_pending'` => `strict_auto_promote`.
- high risk/protected modules => `manual_only`.

In `admission-pipeline.ts`:

```ts
const allowAutoPromote =
  route.updatePolicy === 'strict_auto_promote' &&
  input.allowAutoPromote !== false
```

Pass `allowAutoPromote` into `proposeCodexMemoryCandidate()`. For `pending_review` and `manual_only`, force `allowAutoPromote: false`.

`reference_only`, `task_state`, `episode_only`, `auto_drop`, `auto_defer`, and `reject_duplicate` write routing/review sidecars but not pending.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- tests/codex-admission-gate.test.ts tests/codex-memory-router.test.ts tests/codex-admission-pipeline.test.ts
```

Expected: all pass, and existing task-state tests updated from `episode_only` to `task_state`.

## Task 3: Distillation Reads Drafts, Admissions, Episodes, Semantic And Events

**Owner:** Worker B

**Files:**
- Modify: `src/codex/memory-distill.ts`
- Test: `tests/codex-memory-distill.test.ts`

- [ ] **Step 1: Add failing dry-run breadth tests**

Add a test memory root containing:

- one `candidate_drafts.jsonl` item with `normalizedKey: 'quality-gate-first'`,
- one `admission_decisions.jsonl` item with `action: 'admit_to_distillation'`,
- one `episodes.jsonl` item referenced by the draft,
- one `semantic_memories.jsonl` active memory with a different key,
- one `events.jsonl` audit event,
- no `distillation_inputs.jsonl`.

Expected:

```ts
expect(result.summary.inputsRead).toMatchObject({
  drafts: 1,
  admissions: 1,
  distillationInputs: 0,
  episodes: 1,
  semanticMemories: 1,
  memoryEvents: 1
})
expect(result.candidates[0]).toMatchObject({
  normalizedKey: 'quality-gate-first',
  sourceAdmissionDecisionIds: ['admission-1'],
  semanticMemory: {
    status: 'candidate',
    reviewState: {
      sourceDraftIds: ['draft-1'],
      sourceEpisodeIds: ['episode-1']
    }
  }
})
```

- [ ] **Step 2: Implement additional reads**

Import and read:

```ts
readCandidateDraftsFromRoot
readAdmissionDecisionsFromRoot
readEpisodeMemoriesFromRoot
readSemanticMemoriesFromRoot
readMemoryEventsFromRoot
readReviewDecisionsFromRoot
```

Keep old summary fields and add `inputsRead`.

- [ ] **Step 3: Build orphan draft/admission candidates**

Create preview candidates from admissions where:

```ts
admission.action === 'admit_to_distillation'
```

and no matching `DistillationInput.sourceDraftIds` already covers the draft. Use the draft content, source ids, source episode ids, evidence refs, sourceOfTruth, and route through `semanticCandidateFromDraft()`.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- tests/codex-memory-distill.test.ts
```

Expected: old distillation input tests still pass and new breadth summary passes.

## Task 4: Review Workflow Detail Rail

**Owner:** Worker C

**Files:**
- Modify: `src/ui/static/app.js`
- Modify: `src/ui/static/styles.css` only if existing classes cannot support the layout.
- Test: `tests/codex-ui-static.test.ts`
- Test: `tests/codex-ui-assets.test.ts`

- [ ] **Step 1: Add failing UI static assertions**

Assert `src/ui/static/app.js` contains and uses section labels:

```txt
Proposed Semantic Memory
Episode Evidence
Admission / Routing Decision
Update Policy
Use Boundaries
Review Action
```

Also assert `renderPendingDetail()` calls workflow-specific render helpers instead of only `renderSemanticReviewCard(candidate, { compact: false })`.

- [ ] **Step 2: Implement workflow sections**

Refactor `renderPendingDetail(candidate)`:

```js
return `
  <div class="rail-stack">
    ${renderProposedSemanticMemorySection(candidate)}
    ${renderEpisodeEvidenceSection(candidate)}
    ${renderAdmissionRoutingSection(candidate)}
    ${renderUpdatePolicySection(candidate)}
    ${renderUseBoundariesSection(candidate)}
    ${renderReviewActionSection(candidate)}
  </div>
`
```

Each section must show `missing` instead of empty values for absent `sourceOfTruth`, evidence, route reasons, or boundaries.

- [ ] **Step 3: Keep compact list card**

Do not remove `renderSemanticReviewCard()` from list rendering. It remains the compact overview card.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- tests/codex-ui-static.test.ts tests/codex-ui-assets.test.ts
```

Expected: UI static tests pass.

## Task 5: Structured Approval Gate And Receipts

**Owner:** Worker D after Task 1

**Files:**
- Modify: `src/codex/memory-review.ts`
- Modify: `src/codex/memory-propose.ts`
- Modify: `src/codex/codex-ui-api.ts`
- Test: `tests/codex-memory-review.test.ts`
- Test: `tests/codex-memory-propose.test.ts`
- Test: `tests/codex-ui-api.test.ts`

- [ ] **Step 1: Add failing review gate tests**

Required cases:

```ts
expect(promoteWithoutSourceOfTruth.result.action).toBe('needs_rewrite')
expect(promoteRawFileRuleExcerpt.result.action).toBe('needs_rewrite')
expect(autoPromoteReceipt.details).toMatchObject({
  decision: 'auto_promote',
  policyId: expect.any(String),
  capStatus: expect.any(Object),
  evalGate: expect.any(Object),
  semanticMemoryId: expect.any(String),
  sourceIds: expect.any(Array)
})
```

- [ ] **Step 2: Strengthen structured gate**

In `evaluateStructuredReadinessGate()`:

- require explicit `candidate.sourceOfTruth` or at least one evidence ref/trace that is not just `normalizedKey`;
- require semantic evidence entries with `sourceKind`, `sourceRef`, `whatHappened`;
- require non-empty `useWhen` and `doNotUseWhen`;
- if `activeReadiness.reasons` includes `raw_file_rule_excerpt`, block promotion until rewritten.

- [ ] **Step 3: Enrich auto-promote receipt**

In `memory-propose.ts`, when appending the auto-promote `MemoryEvent`, include:

```ts
details: {
  decision: 'auto_promote',
  policyId,
  semanticMemoryId: promoted.id,
  sourceIds: [
    ...(mergedCandidate.sourceDraftIds ?? []),
    ...(mergedCandidate.sourceEpisodeIds ?? [])
  ],
  ...
}
```

Preserve existing `thresholds`, `capStatus`, and `evalGate`.

- [ ] **Step 4: Verify**

Run:

```bash
npm test -- tests/codex-memory-review.test.ts tests/codex-memory-propose.test.ts tests/codex-ui-api.test.ts
```

Expected: strengthened gate blocks weak candidates; existing manual review hash behavior remains unchanged.

## Final Verification

Coordinator runs:

```bash
npm test -- tests/codex-admission-gate.test.ts tests/codex-admission-pipeline.test.ts tests/codex-memory-router.test.ts tests/codex-memory-distill.test.ts tests/codex-memory-review.test.ts tests/codex-ui-static.test.ts tests/codex-ui-api.test.ts tests/codex-memory-propose.test.ts
npm run typecheck
npm test
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
git diff --check
```

Expected: all pass; generated runtime changes only appear after `npm run build:plugin`.
