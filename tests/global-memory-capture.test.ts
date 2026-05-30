import { describe, expect, it } from 'vitest'
import { candidateFromExplicitGlobalInstruction, candidateFromReviewPattern, candidatesFromReviewEvents } from '../src/codex/global-memory-capture.js'

describe('global memory capture', () => {
  it('creates global candidate from explicit global instruction', () => {
    const candidate = candidateFromExplicitGlobalInstruction({
      text: '以后所有项目都默认先运行 git diff --check。',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(candidate).toMatchObject({
      scope: 'global',
      source: 'user_explicit',
      candidateKind: 'user_instruction',
      domain: 'procedural',
      type: 'procedural_rule'
    })
    expect(candidate?.content).toContain('所有项目')
  })

  it('does not create candidate from ordinary conversation', () => {
    expect(candidateFromExplicitGlobalInstruction({ text: '这个项目先跑测试。', now: '2026-05-30T00:00:00.000Z' })).toBeUndefined()
  })

  it('does not turn personal preference wording into global procedural memory', () => {
    expect(candidateFromExplicitGlobalInstruction({
      text: 'I always prefer concise status updates.',
      now: '2026-05-30T00:00:00.000Z'
    })).toBeUndefined()
  })

  it('creates review-derived global candidate from repeated rejection pattern', () => {
    const candidate = candidateFromReviewPattern({
      patternId: 'reject-transient-test-status',
      action: 'reject',
      count: 5,
      reasonSamples: ['temporary status', 'not durable memory'],
      candidateKind: 'project_fact',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(candidate).toMatchObject({
      scope: 'global',
      source: 'review_event',
      candidateKind: 'workflow_rule',
      domain: 'procedural'
    })
    expect(candidate?.content).toContain('一次性')
  })

  it('aggregates review events into review-derived global candidates', () => {
    const candidates = candidatesFromReviewEvents({
      events: [
        { id: 'event-1', action: 'reject', at: '2026-05-28T00:00:00.000Z', reason: 'temporary status', candidateId: 'a', details: { reviewPatternId: 'reject-transient-test-status', candidateKind: 'project_fact' } },
        { id: 'event-2', action: 'reject', at: '2026-05-29T00:00:00.000Z', reason: 'not durable memory', candidateId: 'b', details: { reviewPatternId: 'reject-transient-test-status', candidateKind: 'project_fact' } },
        { id: 'event-3', action: 'reject', at: '2026-05-30T00:00:00.000Z', reason: 'one-off command output', candidateId: 'c', details: { reviewPatternId: 'reject-transient-test-status', candidateKind: 'project_fact' } }
      ],
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ source: 'review_event', normalizedKey: 'review-derived-reject-transient-test-status' })
  })

  it('aggregates repeated approved project memory events without explicit pattern metadata', () => {
    const candidates = candidatesFromReviewEvents({
      events: [
        { id: 'event-1', action: 'promote', at: '2026-05-28T00:00:00.000Z', reason: 'approved durable project fact', candidateId: 'a', memoryId: 'memory-a', details: { candidateKind: 'project_fact' } },
        { id: 'event-2', action: 'promote', at: '2026-05-29T00:00:00.000Z', reason: 'approved another durable project fact', candidateId: 'b', memoryId: 'memory-b', details: { candidateKind: 'project_fact' } },
        { id: 'event-3', action: 'promote', at: '2026-05-30T00:00:00.000Z', reason: 'approved third durable project fact', candidateId: 'c', memoryId: 'memory-c', details: { candidateKind: 'project_fact' } }
      ],
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ source: 'review_event', normalizedKey: 'review-derived-approve-project_fact' })
  })

  it('aggregates edit review events stored as pending review actions', () => {
    const candidates = candidatesFromReviewEvents({
      events: [
        { id: 'event-1', action: 'pending', at: '2026-05-28T00:00:00.000Z', reason: 'edited vague wording', candidateId: 'a', details: { reviewAction: 'edit', reviewPatternId: 'edit-vague-workflow-rule', candidateKind: 'workflow_rule' } },
        { id: 'event-2', action: 'pending', at: '2026-05-29T00:00:00.000Z', reason: 'edited broad wording', candidateId: 'b', details: { reviewAction: 'edit', reviewPatternId: 'edit-vague-workflow-rule', candidateKind: 'workflow_rule' } },
        { id: 'event-3', action: 'pending', at: '2026-05-30T00:00:00.000Z', reason: 'edited unclear wording', candidateId: 'c', details: { reviewAction: 'edit', reviewPatternId: 'edit-vague-workflow-rule', candidateKind: 'workflow_rule' } }
      ],
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ source: 'review_event', normalizedKey: 'review-derived-edit-vague-workflow-rule' })
  })
})
