import { describe, expect, it } from 'vitest'
import {
  deriveProfileVisibility,
  distinctEvidenceCount,
  evaluatePendingPromotion,
  isPromotablePending
} from '../src/memory/memory-validator.js'
import type { PendingMemory } from '../src/memory/types.js'

describe('Codex repeated evidence promotion policy', () => {
  it('counts repeated same run evidence once even with different evidence groups', () => {
    const candidate = createPending({
      seenCount: 2,
      evidence: [
        { runId: 'run-1', sessionId: 'session-1', summary: 'First', evidenceGroupId: 'group-1' },
        { runId: 'run-1', sessionId: 'session-1', summary: 'Second duplicate', evidenceGroupId: 'group-2' }
      ]
    })

    expect(distinctEvidenceCount(candidate)).toBe(1)
    expect(evaluatePendingPromotion(candidate).promotable).toBe(false)
  })

  it('promotes project/procedural memory after independent repeated evidence', () => {
    const candidate = createPending({
      seenCount: 2,
      evidence: [
        { runId: 'run-1', summary: 'First observation.' },
        { runId: 'run-2', summary: 'Second observation.' }
      ]
    })

    const result = evaluatePendingPromotion(candidate)
    expect(result).toMatchObject({ promotable: true, distinctEvidenceCount: 2 })
  })

  it('counts different evidence groups in the same session as independent evidence', () => {
    const candidate = createPending({
      seenCount: 2,
      evidence: [
        { runId: 'run-1', sessionId: 'same-session', evidenceGroupId: 'group-1', summary: 'First observation.' },
        { runId: 'run-2', sessionId: 'same-session', evidenceGroupId: 'group-2', summary: 'Second observation.' }
      ]
    })

    const result = evaluatePendingPromotion(candidate)
    expect(result).toMatchObject({ promotable: true, distinctEvidenceCount: 2 })
  })

  it('does not promote low-value confirmation noise', () => {
    const candidate = createPending({
      content: '确认',
      normalizedKey: 'confirm',
      seenCount: 5,
      evidence: [
        { runId: 'run-1', quote: '确认' },
        { runId: 'run-2', quote: '确认' }
      ]
    })

    expect(evaluatePendingPromotion(candidate).promotable).toBe(false)
  })

  it('allows user-confirmed hard procedural memory to satisfy evidence count', () => {
    const candidate = createPending({
      userConfirmed: true,
      seenCount: 1,
      evidence: [{ runId: 'run-1', quote: '记住：以后 spec 和 plan 默认用中文写。' }]
    })

    expect(evaluatePendingPromotion(candidate).promotable).toBe(true)
  })

  it('does not let user confirmation override assistant-derived silence evidence', () => {
    const candidate = createPending({
      userConfirmed: true,
      seenCount: 1,
      evidence: [
        { runId: 'run-1', summary: 'Assistant suggested the rule and user accepted without correction.' }
      ]
    })

    expect(evaluatePendingPromotion(candidate).promotable).toBe(false)
  })

  it('does not let user confirmation bypass evidence counts without a durable instruction', () => {
    const candidate = createPending({
      userConfirmed: true,
      seenCount: 1,
      content: 'Specs and plans are written in Chinese.',
      evidence: [{ runId: 'run-1', summary: 'User confirmed this preference.' }]
    })

    expect(evaluatePendingPromotion(candidate).promotable).toBe(false)
  })

  it('does not promote assistant-observed source or evidence sourceKind', () => {
    const candidate = createPending({
      source: 'assistant_observed',
      seenCount: 2,
      evidence: [
        { runId: 'run-1', sourceKind: 'assistant_observed', summary: 'First observation.' },
        { runId: 'run-2', sourceKind: 'assistant_observed', summary: 'Second observation.' }
      ]
    })

    const result = evaluatePendingPromotion(candidate)

    expect(result).toMatchObject({
      promotable: false,
      distinctEvidenceCount: 2,
      reason: 'Memory candidate is based on assistant output and requires user confirmation'
    })
  })

  it('does not promote before promoteAfter', () => {
    const candidate = createPending({
      seenCount: 2,
      promoteAfter: '9999-01-01T00:00:00.000Z',
      evidence: [
        { runId: 'run-1', summary: 'First observation.' },
        { runId: 'run-2', summary: 'Second observation.' }
      ]
    })

    expect(isPromotablePending(candidate)).toBe(false)
  })

  it('does not count structurally empty evidence as distinct evidence', () => {
    const candidate = createPending({
      seenCount: 2,
      evidence: [{ runId: 'run-1', summary: 'First observation.' }, {}]
    })

    expect(distinctEvidenceCount(candidate)).toBe(1)
    expect(evaluatePendingPromotion(candidate).promotable).toBe(false)
  })

  it('derives safe profile visibility without treating sensitivity as the only gate', () => {
    expect(deriveProfileVisibility(createPending({ strength: 'hard' }))).toBe('always')
    expect(
      deriveProfileVisibility(
        createPending({
          domain: 'personal',
          type: 'interaction_style',
          strength: 'soft',
          scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.9, safety: 0.9, sensitivity: 0.4 }
        })
      )
    ).toBe('safe_summary')
  })
})

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'Specs and plans default to Chinese.',
    normalizedKey: 'spec-plan-chinese',
    evidence: [{ runId: 'run-1', summary: 'User asked for Chinese specs and plans.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.85,
      usefulness: 0.85,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-05-26T00:00:00.000Z',
    lastSeenAt: '2026-05-26T00:00:00.000Z',
    expiresAt: '2026-06-25T00:00:00.000Z',
    tags: ['codex'],
    ...overrides
  }
}
