import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultConfig } from '../src/config.js'
import {
  deriveProfileVisibility,
  distinctEvidenceCount,
  evaluatePendingPromotion,
  isPromotablePending
} from '../src/memory/memory-validator.js'
import { MEMORY_SOURCES, type MemoryEvent, type PendingMemory } from '../src/memory/types.js'

const V5_ENV_KEYS = [
  'CYRENE_AUTO_REVIEW_PROJECT_PROMOTE_PER_DAY',
  'CYRENE_AUTO_REVIEW_GLOBAL_PROMOTE_PER_DAY',
  'CYRENE_PENDING_MAX_ITEMS_PROJECT',
  'CYRENE_PENDING_MAX_ITEMS_GLOBAL',
  'CYRENE_PENDING_PROTECTED_MAX_AGE_DAYS'
] as const
const ORIGINAL_ENV = new Map(V5_ENV_KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of V5_ENV_KEYS) {
    const value = ORIGINAL_ENV.get(key)
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('Codex repeated evidence promotion policy', () => {
  it('loads v5 auto-review caps and pending budgets from env', () => {
    process.env.CYRENE_AUTO_REVIEW_PROJECT_PROMOTE_PER_DAY = '7'
    process.env.CYRENE_AUTO_REVIEW_GLOBAL_PROMOTE_PER_DAY = '2'
    process.env.CYRENE_PENDING_MAX_ITEMS_PROJECT = '250'
    process.env.CYRENE_PENDING_MAX_ITEMS_GLOBAL = '125'
    process.env.CYRENE_PENDING_PROTECTED_MAX_AGE_DAYS = '45'

    const config = createDefaultConfig(process.cwd())

    expect(config.memoryAutoReviewProjectPromotePerDay).toBe(7)
    expect(config.memoryAutoReviewGlobalPromotePerDay).toBe(2)
    expect(config.memoryPendingMaxItemsProject).toBe(250)
    expect(config.memoryPendingMaxItemsGlobal).toBe(125)
    expect(config.memoryPendingProtectedMaxAgeDays).toBe(45)
  })

  it('supports review_event memory source for review-derived global learning', () => {
    expect(MEMORY_SOURCES).toContain('review_event')
  })

  it('allows v5 audit details on memory events', () => {
    const event: MemoryEvent = {
      id: 'event-v5',
      action: 'audit',
      at: '2026-05-30T00:00:00.000Z',
      reason: 'Auto-promoted by v5 policy.',
      candidateId: 'candidate-v5',
      details: {
        policyId: 'low_risk_project_memory_v1',
        decision: 'auto_promote',
        evalGate: { passed: true, failedChecks: [] }
      }
    }
    expect(event.details?.policyId).toBe('low_risk_project_memory_v1')
  })

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
