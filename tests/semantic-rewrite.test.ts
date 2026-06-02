import { describe, expect, it } from 'vitest'
import { reviewHashForPendingMemory } from '../src/codex/memory-review.js'
import {
  preparePendingSemanticRewrite,
  validateSemanticRewriteCandidate
} from '../src/codex/semantic-rewrite.js'
import type { PendingMemory } from '../src/memory/types.js'

const NOW = '2026-06-02T00:00:00.000Z'

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Pending-memory rejection workflows must validate each candidate review hash before mutation.',
    normalizedKey: 'pending-memory-rejection-review-hash',
    sourceOfTruth: 'review_summary:task-1',
    evidence: [{ summary: 'Review workflow evidence.', evidenceGroupId: 'evidence-1' }],
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

describe('semantic rewrite preparation', () => {
  it('rewrites implementation-note pending content into an active-ready project decision', () => {
    const candidate = createPending({
      id: 'pending-implementation-note',
      domain: 'project',
      type: 'project_fact',
      content: 'v1 admission gate 核心实现采用 subagent-driven 执行方案，并创建隔离工作区。',
      normalizedKey: 'v1-admission-gate-subagent-worktree',
      candidateKind: 'project_decision',
      tags: ['project_decision']
    })

    const result = preparePendingSemanticRewrite(candidate, { now: NOW })

    expect(result.action).toBe('replace_content')
    expect(result.next.content).toBe(
      'Admission-gate memory work should coordinate independent tasks through subagent-driven execution in an isolated worktree.'
    )
    expect(result.validation.valid).toBe(true)
    expect(result.validation.afterReadiness.ready).toBe(true)
    expect(result.receipt).toMatchObject({
      pendingMemoryId: 'pending-implementation-note',
      action: 'replace_content',
      method: 'deterministic',
      oldReviewHash: reviewHashForPendingMemory(candidate),
      changedFields: ['content'],
      sourceOfTruth: 'review_summary:task-1',
      eligibilityReasons: ['implementation_note', 'needs_active_memory_rewrite']
    })
    expect(result.receipt).toBeDefined()
    const receipt = result.receipt
    expect(receipt?.newReviewHash).not.toBe(receipt?.oldReviewHash)
  })

  it('enriches ready pending boundaries without changing content hash', () => {
    const candidate = createPending({
      content: '拒绝 pending memory 的流程：按照 Cyrene review 流程，逐条进行哈希校验，确认后执行拒绝操作。操作后需验证 pending 列表为空。'
    })

    const result = preparePendingSemanticRewrite(candidate, { now: NOW })
    const next = result.next as PendingMemory & { useWhen?: string[]; doNotUseWhen?: string[] }

    expect(result.action).toBe('enrich_boundaries')
    expect(result.next.content).toBe(candidate.content)
    expect(result.receipt).toBeDefined()
    const receipt = result.receipt
    expect(receipt?.changedFields).toEqual(['useWhen', 'doNotUseWhen'])
    expect(receipt?.originalContentHash).toBe(receipt?.rewrittenContentHash)
    expect(next.useWhen).toContain('Rejecting pending memory candidates in the Cyrene review flow.')
    expect(next.doNotUseWhen).toContain('The task does not mutate pending memory review state.')
  })

  it('rejects invalid replacement output that loses source truth or still needs rewrite', () => {
    const candidate = createPending({
      id: 'pending-invalid-rewrite',
      domain: 'project',
      type: 'project_fact',
      content: 'v1 admission gate 核心实现采用 subagent-driven 执行方案，并创建隔离工作区。',
      candidateKind: 'project_decision',
      tags: ['project_decision']
    })

    const validation = validateSemanticRewriteCandidate({
      original: candidate,
      next: {
        ...candidate,
        content: 'v2 implementation used a direct active-memory rewrite.',
        sourceOfTruth: undefined
      },
      action: 'replace_content'
    })

    expect(validation.valid).toBe(false)
    expect(validation.reasons).toContain('source_of_truth_must_be_preserved')
    expect(validation.reasons).toContain('rewritten_content_must_be_active_ready')
  })
})
