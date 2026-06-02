import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCodexAdmissionPipeline } from '../src/codex/admission-pipeline.js'
import { runCodexMemoryPrepare } from '../src/codex/codex-memory-prepare.js'
import { runCodexMemoryDistill } from '../src/codex/memory-distill.js'
import { proposeCodexMemoryCandidate } from '../src/codex/memory-propose.js'
import { reviewHashForPendingMemory } from '../src/codex/memory-review.js'
import { validateSemanticRewriteCandidate } from '../src/codex/semantic-rewrite.js'
import {
  appendDistillationInputFromRoot,
  readActiveMemoriesFromRoot,
  readDistillationInputsFromRoot,
  readPendingMemoriesFromRoot,
  readSemanticRewriteReceiptsFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type { CyreneMemory, DistillationInput, PendingMemory } from '../src/memory/types.js'

const NOW = '2026-06-02T00:00:00.000Z'

const IMPLEMENTATION_NOTE_INPUT = 'v1 admission gate 核心实现采用 subagent-driven 执行方案，并创建隔离工作区。'
const IMPLEMENTATION_NOTE_EXPECTED =
  'Admission-gate memory work should coordinate independent tasks through subagent-driven execution in an isolated worktree.'
const RAW_FILE_RULE_INPUT =
  'AGENTS.md says changes must be surgical and trace directly to the requested issue or task.'
const OVERBROAD_WORKFLOW_INPUT =
  'Every code change must be surgical and trace to the requested task.'
const OVERBROAD_WORKFLOW_EXPECTED =
  'For non-trivial code or architecture changes, keep edits traceable to the requested issue and leave unrelated code untouched.'
const PENDING_REJECTION_WORKFLOW_INPUT =
  '拒绝 pending memory 的流程：按照 Cyrene review 流程，逐条进行哈希校验，确认后执行拒绝操作。操作后需验证 pending 列表为空。'
const PENDING_REJECTION_WORKFLOW_EXPECTED =
  'Pending-memory rejection workflows must validate each candidate review hash before mutation and verify the queue state after rejection.'
const PENDING_HASH_FALSE_CONFLICT_INPUT =
  'pending review 哈希因 semantic projection 改写导致假冲突。修复方案：调整优先从 pending.jsonl 直接读取 pending review，而非依赖缓存推导。'
const PENDING_HASH_FALSE_CONFLICT_EXPECTED =
  'Pending-review hashes must be read from canonical pending.jsonl records rather than semantic projection or cache-derived data; projection rewrites can cause false review-hash conflicts.'

const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Core memory pipeline changes must preserve review-hash validation before pending mutations.',
    normalizedKey: 'core-memory-review-hash-validation',
    sourceOfTruth: 'review_summary:acceptance',
    evidence: [{ summary: 'Acceptance fixture evidence.', evidenceGroupId: 'evidence-1' }],
    source: 'review_event',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.85,
      usefulness: 0.85,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-06-01T00:00:00.000Z',
    lastSeenAt: '2026-06-01T00:00:00.000Z',
    expiresAt: '2026-07-01T00:00:00.000Z',
    candidateKind: 'workflow_rule',
    tags: ['workflow_rule'],
    ...overrides
  }
}

function createActive(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Use review-hash validation before pending memory promotion.',
    normalizedKey: 'review-hash-validation-before-promotion',
    evidence: [{ summary: 'Active memory evidence.', evidenceGroupId: 'active-evidence-1' }],
    source: 'review_event',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
    candidateKind: 'workflow_rule',
    tags: ['workflow_rule'],
    ...overrides
  }
}

function createDistillationInput(overrides: Partial<DistillationInput> = {}): DistillationInput {
  return {
    id: 'distillation-input-1',
    sourceDraftIds: [],
    sourceEpisodeIds: ['episode-1'],
    sourceSemanticMemoryIds: [],
    admissionDecisionIds: ['admission-1'],
    normalizedKey: 'pending-review-hash-canonical-records',
    candidateKind: 'known_pitfall',
    scope: 'project',
    domain: 'procedural',
    sourceKinds: ['review_summary'],
    rawContents: [PENDING_HASH_FALSE_CONFLICT_INPUT],
    evidenceRefs: ['pending.jsonl', 'semantic projection'],
    sourceOfTruth: 'review_summary:task-6',
    createdAt: NOW,
    ...overrides
  }
}

function pendingById(items: PendingMemory[]): Map<string, PendingMemory> {
  return new Map(items.map((item) => [item.id, item]))
}

function resultByPendingId(
  result: Awaited<ReturnType<typeof runCodexMemoryPrepare>>
): Map<string, Awaited<ReturnType<typeof runCodexMemoryPrepare>>['results'][number]> {
  return new Map(result.results.map((item) => [item.original.id, item]))
}

describe('Codex memory v1.4 acceptance outcomes', () => {
  it('applies needs-rewrite pending refinements without mutating active memory', async () => {
    const memoryRoot = await createTempDir('cyrene-v14-prepare-rewrites-')
    await writeActiveMemoriesFromRoot(memoryRoot, [createActive()])
    const implementationNote = createPending({
      id: 'pending-implementation-note',
      domain: 'project',
      type: 'project_fact',
      content: IMPLEMENTATION_NOTE_INPUT,
      normalizedKey: 'v1-admission-gate-subagent-worktree',
      sourceOfTruth: 'review_summary:task-1',
      candidateKind: 'project_decision',
      tags: ['project_decision']
    })
    const rawFileRule = createPending({
      id: 'pending-raw-file-rule',
      content: RAW_FILE_RULE_INPUT,
      normalizedKey: 'agents-md-surgical-edits',
      sourceOfTruth: 'AGENTS.md',
      candidateKind: 'workflow_rule',
      tags: ['workflow_rule']
    })
    const overbroadWorkflowRule = createPending({
      id: 'pending-overbroad-workflow-rule',
      content: OVERBROAD_WORKFLOW_INPUT,
      normalizedKey: 'all-code-changes-surgical',
      candidateKind: 'workflow_rule',
      tags: ['workflow_rule']
    })
    await writePendingMemoriesFromRoot(memoryRoot, [implementationNote, rawFileRule, overbroadWorkflowRule])
    const activeBefore = await readActiveMemoriesFromRoot(memoryRoot)
    const rawFileRuleReviewHashBefore = reviewHashForPendingMemory(rawFileRule)

    const result = await runCodexMemoryPrepare({ memoryRoot, dryRun: false, now: NOW })

    expect(result).toMatchObject({
      dryRun: false,
      activeBeforeCount: 1,
      activeAfterCount: 1,
      pendingBeforeCount: 3,
      pendingAfterCount: 3
    })
    await expect(readActiveMemoriesFromRoot(memoryRoot)).resolves.toEqual(activeBefore)
    const pendingAfter = pendingById(await readPendingMemoriesFromRoot(memoryRoot))
    const results = resultByPendingId(result)

    const implementationAfter = pendingAfter.get('pending-implementation-note')
    expect(implementationAfter?.content).toBe(IMPLEMENTATION_NOTE_EXPECTED)
    expect(results.get('pending-implementation-note')).toMatchObject({
      action: 'replace_content',
      validation: {
        beforeReadiness: { ready: false, status: 'needs_rewrite' },
        afterReadiness: { ready: true, status: 'ready' }
      }
    })

    const rawFileRuleAfter = pendingAfter.get('pending-raw-file-rule')
    expect(rawFileRuleAfter?.sourceOfTruth).toBe('AGENTS.md')
    expect(rawFileRuleAfter).toBeDefined()
    expect(reviewHashForPendingMemory(rawFileRuleAfter as PendingMemory)).not.toBe(rawFileRuleReviewHashBefore)

    const overbroadAfter = pendingAfter.get('pending-overbroad-workflow-rule')
    expect(overbroadAfter?.content).toBe(OVERBROAD_WORKFLOW_EXPECTED)
    expect(results.get('pending-overbroad-workflow-rule')).toMatchObject({
      action: 'replace_content',
      validation: {
        afterReadiness: { ready: true, status: 'ready' }
      }
    })

    const receipts = await readSemanticRewriteReceiptsFromRoot(memoryRoot)
    expect(receipts).toHaveLength(3)
    expect(receipts.find((receipt) => receipt.pendingMemoryId === 'pending-raw-file-rule')).toMatchObject({
      action: 'replace_content',
      sourceOfTruth: 'AGENTS.md',
      oldReviewHash: rawFileRuleReviewHashBefore,
      newReviewHash: reviewHashForPendingMemory(rawFileRuleAfter as PendingMemory)
    })
  })

  it('enriches recognized ready pending boundaries without changing content hash', async () => {
    const memoryRoot = await createTempDir('cyrene-v14-prepare-boundaries-')
    const pending = createPending({
      id: 'pending-ready-boundaries',
      content: PENDING_REJECTION_WORKFLOW_INPUT,
      normalizedKey: 'pending-memory-rejection-review-hash',
      candidateKind: 'workflow_rule',
      tags: ['workflow_rule']
    })
    await writePendingMemoriesFromRoot(memoryRoot, [pending])

    const result = await runCodexMemoryPrepare({ memoryRoot, dryRun: false, now: NOW })

    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({
      action: 'enrich_boundaries',
      validation: {
        beforeReadiness: { ready: true, status: 'ready' },
        afterReadiness: { ready: true, status: 'ready' }
      }
    })
    const pendingAfter = await readPendingMemoriesFromRoot(memoryRoot)
    expect(pendingAfter[0]?.content).toBe(PENDING_REJECTION_WORKFLOW_INPUT)
    expect(pendingAfter[0]?.useWhen).toContain('Rejecting pending memory candidates in the Cyrene review flow.')
    expect(pendingAfter[0]?.doNotUseWhen).toContain('The task does not mutate pending memory review state.')
    const receipt = (await readSemanticRewriteReceiptsFromRoot(memoryRoot))[0]
    expect(receipt).toMatchObject({
      pendingMemoryId: 'pending-ready-boundaries',
      action: 'enrich_boundaries',
      changedFields: ['useWhen', 'doNotUseWhen']
    })
    expect(receipt?.originalContentHash).toBe(receipt?.rewrittenContentHash)
  })

  it('skips ready unrecognized pending without queue mutation or receipts', async () => {
    const memoryRoot = await createTempDir('cyrene-v14-prepare-skip-')
    const pending = createPending({
      id: 'pending-good-ready',
      content: 'Core memory pipeline changes must preserve review-hash validation before pending mutations.',
      normalizedKey: 'core-memory-review-hash-validation',
      candidateKind: 'workflow_rule',
      tags: ['workflow_rule']
    })
    await writePendingMemoriesFromRoot(memoryRoot, [pending])
    const pendingBefore = await readPendingMemoriesFromRoot(memoryRoot)

    const result = await runCodexMemoryPrepare({ memoryRoot, dryRun: false, now: NOW })

    expect(result.results).toHaveLength(1)
    expect(result.results[0]?.action).toBe('skip')
    expect(result.receipts).toEqual([])
    await expect(readSemanticRewriteReceiptsFromRoot(memoryRoot)).resolves.toEqual([])
    await expect(readPendingMemoriesFromRoot(memoryRoot)).resolves.toEqual(pendingBefore)
  })

  it('improves distillation previews without increasing pending count', async () => {
    const memoryRoot = await createTempDir('cyrene-v14-distill-preview-')
    const pending = createPending({
      id: 'existing-pending',
      content: 'Existing pending memory must not be changed by distillation dry-run.',
      normalizedKey: 'existing-pending'
    })
    await writePendingMemoriesFromRoot(memoryRoot, [pending])
    await appendDistillationInputFromRoot(memoryRoot, createDistillationInput())
    const pendingBefore = await readPendingMemoriesFromRoot(memoryRoot)

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.summary).toMatchObject({
      pendingRead: 1,
      distillationInputsRead: 1,
      candidates: 1
    })
    expect(result.candidates[0]).toMatchObject({
      normalizedKey: 'pending-review-hash-canonical-records',
      content: PENDING_HASH_FALSE_CONFLICT_EXPECTED,
      semanticMemory: {
        content: PENDING_HASH_FALSE_CONFLICT_EXPECTED,
        useWhen: expect.arrayContaining([
          'Diagnosing review-hash conflicts for pending memory candidates.'
        ])
      }
    })
    await expect(readPendingMemoriesFromRoot(memoryRoot)).resolves.toEqual(pendingBefore)
  })

  it('keeps distillation-only admissions out of pending memory', async () => {
    const home = await createTempDir('cyrene-v14-admission-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-v14-admission-project-')

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'review_summary',
      candidate: {
        domain: 'project',
        type: 'project_fact',
        scope: 'project',
        source: 'review_event',
        candidateKind: 'project_decision',
        content: IMPLEMENTATION_NOTE_INPUT,
        normalizedKey: 'v1-admission-gate-subagent-worktree',
        evidence: [{ summary: 'Review summary recorded implementation detail.', evidenceGroupId: 'summary-1' }],
        scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.05 },
        tags: ['project_decision']
      },
      now: NOW
    })

    expect(result.action).toBe('admit_to_distillation')
    await expect(readPendingMemoriesFromRoot(result.memoryRoot)).resolves.toEqual([])
    const distillationInputs = await readDistillationInputsFromRoot(result.memoryRoot)
    expect(distillationInputs).toHaveLength(1)
    expect(distillationInputs[0]?.rawContents).toEqual([IMPLEMENTATION_NOTE_INPUT])
  })

  it('rejects invalid rewrite output through the validator', () => {
    const original = createPending({
      id: 'pending-invalid-rewrite',
      content: RAW_FILE_RULE_INPUT,
      normalizedKey: 'agents-md-surgical-edits',
      sourceOfTruth: 'AGENTS.md',
      candidateKind: 'workflow_rule',
      tags: ['workflow_rule']
    })

    const validation = validateSemanticRewriteCandidate({
      original,
      next: {
        ...original,
        content: 'AGENTS.md says every rule should be copied into active memory.',
        sourceOfTruth: 'README.md'
      },
      action: 'replace_content'
    })

    expect(validation.valid).toBe(false)
    expect(validation.reasons).toContain('source_of_truth_must_be_preserved')
    expect(validation.reasons).toContain('rewritten_content_must_be_active_ready')
  })

  it('shapes new pending creation for both motivating examples', async () => {
    const home = await createTempDir('cyrene-v14-shaping-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-v14-shaping-project-')

    const workflow = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        scope: 'project',
        source: 'review_event',
        candidateKind: 'workflow_rule',
        content: PENDING_REJECTION_WORKFLOW_INPUT,
        normalizedKey: 'pending-memory-rejection-review-hash',
        evidence: [{ summary: 'Review flow recorded pending rejection hash checks.', evidenceGroupId: 'review-1' }],
        scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.05 },
        tags: ['workflow_rule']
      },
      now: NOW,
      allowAutoPromote: false
    })
    const pitfall = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        scope: 'project',
        source: 'review_event',
        candidateKind: 'known_pitfall',
        content: PENDING_HASH_FALSE_CONFLICT_INPUT,
        normalizedKey: 'pending-review-hash-canonical-records',
        evidence: [{ summary: 'Review flow recorded pending hash false-conflict mitigation.', evidenceGroupId: 'review-2' }],
        scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.05 },
        tags: ['known_pitfall']
      },
      now: NOW,
      allowAutoPromote: false
    })

    expect(workflow.result.action).toBe('pending')
    expect(pitfall.result.action).toBe('pending')
    expect(pitfall.memoryRoot).toBe(workflow.memoryRoot)
    const pending = await readPendingMemoriesFromRoot(workflow.memoryRoot)
    expect(pending).toHaveLength(2)
    const byKey = new Map(pending.map((item) => [item.normalizedKey, item]))
    expect(byKey.get('pending-memory-rejection-review-hash')).toMatchObject({
      content: PENDING_REJECTION_WORKFLOW_EXPECTED
    })
    expect(byKey.get('pending-review-hash-canonical-records')).toMatchObject({
      content: PENDING_HASH_FALSE_CONFLICT_EXPECTED
    })
  })
})
