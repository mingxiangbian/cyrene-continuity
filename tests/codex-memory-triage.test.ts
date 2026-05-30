import { describe, expect, it } from 'vitest'
import {
  buildCandidateClusters,
  evaluateAutoPromotionPolicy,
  rankPendingForEviction,
  triagePendingMemories
} from '../src/codex/memory-triage.js'
import type { PendingMemory } from '../src/memory/types.js'

function pending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Project uses SQLite FTS for memory retrieval.',
    normalizedKey: 'project-sqlite-fts-retrieval',
    evidence: [
      { summary: 'README documents SQLite FTS.', evidenceGroupId: 'file-1', sourceKind: 'file' },
      { summary: 'Tool trace rebuilt memory.db.', evidenceGroupId: 'tool-1', sourceKind: 'tool_trace' }
    ],
    source: 'file',
    scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.05 },
    seenCount: 2,
    firstSeenAt: '2026-05-30T00:00:00.000Z',
    lastSeenAt: '2026-05-30T00:00:00.000Z',
    expiresAt: '2026-06-30T00:00:00.000Z',
    candidateKind: 'project_fact',
    tags: ['project_harvest'],
    ...overrides
  }
}

describe('memory triage', () => {
  it('auto-drops transient command status noise', () => {
    const result = triagePendingMemories({
      pending: [
        pending({
          id: 'noise',
          content: 'Ran npm test today.',
          normalizedKey: 'ran-npm-test-today',
          evidence: [{ summary: 'temporary command result' }],
          seenCount: 1
        })
      ],
      active: [],
      tombstones: [],
      scope: 'project',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.decisions).toContainEqual(expect.objectContaining({ action: 'auto_drop', candidateId: 'noise' }))
  })

  it('clusters duplicate normalized keys', () => {
    const clusters = buildCandidateClusters([
      pending({ id: 'a', normalizedKey: 'same-key' }),
      pending({ id: 'b', normalizedKey: 'same-key', content: 'Project memory retrieval uses SQLite FTS.' })
    ])

    expect(clusters).toEqual([expect.objectContaining({ memberIds: ['a', 'b'], normalizedKey: 'same-key' })])
  })

  it('allows strict low-risk project auto-promotion', () => {
    const result = evaluateAutoPromotionPolicy({
      candidate: pending(),
      scope: 'project',
      active: [],
      tombstones: [],
      promotionsUsedToday: 0,
      projectDailyCap: 5,
      globalDailyCap: 1,
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result).toMatchObject({ allowed: true, policyId: 'low_risk_project_memory_v1' })
  })

  it('denies strict low-risk project auto-promotion after daily cap is reached', () => {
    const result = evaluateAutoPromotionPolicy({
      candidate: pending(),
      scope: 'project',
      active: [],
      tombstones: [],
      promotionsUsedToday: 5,
      projectDailyCap: 5,
      globalDailyCap: 1,
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result).toMatchObject({ allowed: false })
    expect(result.reason).toContain('daily auto-promotion cap')
  })

  it('denies assistant-observed-only auto-promotion', () => {
    const result = evaluateAutoPromotionPolicy({
      candidate: pending({ source: 'assistant_observed', evidence: [{ summary: 'Assistant observed this.' }] }),
      scope: 'project',
      active: [],
      tombstones: [],
      promotionsUsedToday: 0,
      projectDailyCap: 5,
      globalDailyCap: 1,
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result).toMatchObject({ allowed: false })
    expect(result.reason).toContain('assistant_observed')
  })

  it('ranks protected pending after evictable pending', () => {
    const ranked = rankPendingForEviction([
      pending({ id: 'weak', scores: { evidenceStrength: 0.3, stability: 0.3, usefulness: 0.2, safety: 0.9, sensitivity: 0.1 } }),
      pending({ id: 'explicit', source: 'user_explicit', candidateKind: 'user_instruction' })
    ], '2026-05-30T00:00:00.000Z')

    expect(ranked[0]).toMatchObject({ candidateId: 'weak', protected: false })
    expect(ranked[1]).toMatchObject({ candidateId: 'explicit', protected: true })
  })
})
