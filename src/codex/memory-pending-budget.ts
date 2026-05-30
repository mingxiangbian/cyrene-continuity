import { rankPendingForEviction } from './memory-triage.js'
import type { PendingMemory } from '../memory/types.js'

export type PendingBudgetResult =
  | { action: 'within_budget'; nextPending: PendingMemory[] }
  | { action: 'evict_existing'; evicted: PendingMemory; incoming: PendingMemory; nextPending: PendingMemory[]; reason: string }
  | { action: 'reject_incoming'; incomingId: string; nextPending: PendingMemory[]; reason: string }

export function enforcePendingBudget(input: {
  existing: PendingMemory[]
  incoming: PendingMemory
  maxItems: number
  now: string
}): PendingBudgetResult {
  const combined = [...input.existing, input.incoming]
  if (combined.length <= input.maxItems) {
    return { action: 'within_budget', nextPending: combined }
  }
  const ranked = rankPendingForEviction(combined, input.now)
  const evictable = ranked.find((item) => !item.protected)
  if (evictable === undefined) {
    return {
      action: 'reject_incoming',
      incomingId: input.incoming.id,
      nextPending: input.existing,
      reason: 'all pending candidates are protected'
    }
  }
  if (evictable.candidateId === input.incoming.id) {
    return {
      action: 'reject_incoming',
      incomingId: input.incoming.id,
      nextPending: input.existing,
      reason: 'incoming candidate is lowest-ranked under pending budget'
    }
  }
  return {
    action: 'evict_existing',
    evicted: evictable.candidate,
    incoming: input.incoming,
    nextPending: combined.filter((candidate) => candidate.id !== evictable.candidateId),
    reason: `evicted lowest-ranked pending candidate ${evictable.candidateId}`
  }
}
