import { describe, expect, it } from 'vitest'
import { applySafeTriageDecisions } from '../src/codex/triage-apply.js'
import type { TriageDecision } from '../src/codex/memory-triage.js'
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
    evidence: [{ summary: 'Seeded pending memory.', sourceKind: 'file' }],
    source: 'file',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.85,
      usefulness: 0.8,
      safety: 0.95,
      sensitivity: 0.05
    },
    seenCount: 1,
    firstSeenAt: '2026-05-30T00:00:00.000Z',
    lastSeenAt: '2026-05-30T00:00:00.000Z',
    expiresAt: '2026-06-30T00:00:00.000Z',
    candidateKind: 'project_fact',
    tags: ['project_harvest'],
    ...overrides
  }
}

describe('applySafeTriageDecisions', () => {
  it('applies safe cleanup decisions and leaves review recommendations untouched', () => {
    const decisions: TriageDecision[] = [
      { action: 'recommend', candidateId: 'defer-1', priority: 'normal', reason: 'ranked for explicit review' },
      { action: 'auto_defer', candidateId: 'defer-1', days: 14, reason: 'weak single-evidence candidate' },
      { action: 'auto_merge', candidateIds: ['merge-2', 'merge-1'], clusterId: 'cluster-merge', reason: 'duplicate cluster' },
      { action: 'auto_drop', candidateId: 'drop-1', reason: 'transient command status noise' }
    ]

    const result = applySafeTriageDecisions({
      pending: [
        pending({
          id: 'drop-1',
          content: 'Ran npm test today.',
          normalizedKey: 'ran-npm-test-today'
        }),
        pending({ id: 'merge-1', normalizedKey: 'shared-merge-key', content: 'Project uses SQLite FTS.' }),
        pending({ id: 'merge-2', normalizedKey: 'shared-merge-key', content: 'Memory retrieval uses SQLite FTS.' }),
        pending({ id: 'defer-1', normalizedKey: 'defer-key', content: 'Weak single evidence candidate.' })
      ],
      decisions,
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.counts).toEqual({ auto_drop: 1, auto_defer: 1, auto_merge: 1 })
    expect(result.pending.map((candidate) => candidate.id)).toEqual(['merge-1', 'defer-1'])
    expect(result.pending.find((candidate) => candidate.id === 'defer-1')?.promoteAfter).toBe(
      '2026-06-13T00:00:00.000Z'
    )
    expect(result.tombstones).toContainEqual(expect.objectContaining({
      memoryId: 'drop-1',
      reason: 'rejected',
      normalizedKey: 'ran-npm-test-today'
    }))
    expect(result.events.map((event) => event.details?.reviewAction)).toEqual([
      'triage_auto_drop',
      'triage_auto_merge',
      'triage_auto_defer'
    ])
  })
})
