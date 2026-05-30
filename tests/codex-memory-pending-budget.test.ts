import { describe, expect, it } from 'vitest'
import { enforcePendingBudget } from '../src/codex/memory-pending-budget.js'
import type { PendingMemory } from '../src/memory/types.js'

function pending(id: string, overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id,
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: `Pending ${id}`,
    normalizedKey: id,
    evidence: [{ summary: `evidence ${id}` }],
    source: 'assistant_observed',
    scores: { evidenceStrength: 0.4, stability: 0.4, usefulness: 0.3, safety: 0.9, sensitivity: 0.1 },
    seenCount: 1,
    firstSeenAt: '2026-05-01T00:00:00.000Z',
    lastSeenAt: '2026-05-01T00:00:00.000Z',
    expiresAt: '2026-06-01T00:00:00.000Z',
    tags: [],
    ...overrides
  }
}

describe('pending budget enforcement', () => {
  it('keeps new candidate when it outranks the weakest unprotected pending item', () => {
    const result = enforcePendingBudget({
      existing: [pending('weak'), pending('strong', { source: 'user_explicit', candidateKind: 'user_instruction' })],
      incoming: pending('incoming', {
        scores: { evidenceStrength: 0.9, stability: 0.8, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 },
        source: 'file'
      }),
      maxItems: 2,
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.action).toBe('evict_existing')
    if (result.action !== 'evict_existing') throw new Error('expected eviction')
    expect(result.evicted.id).toBe('weak')
    expect(result.nextPending.map((item) => item.id).sort()).toEqual(['incoming', 'strong'])
  })

  it('rejects incoming when it is the lowest ranked candidate', () => {
    const result = enforcePendingBudget({
      existing: [pending('kept-a', { source: 'file' }), pending('kept-b', { source: 'tool_trace' })],
      incoming: pending('incoming-weak'),
      maxItems: 2,
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result).toMatchObject({ action: 'reject_incoming', incomingId: 'incoming-weak' })
  })
})
