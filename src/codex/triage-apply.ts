import { randomUUID } from 'node:crypto'
import { mergePendingMemory } from '../memory/memory-store.js'
import type { MemoryEvent, MemoryTombstone, PendingMemory } from '../memory/types.js'
import type { TriageDecision } from './memory-triage.js'

export interface TriageApplyCounts {
  auto_drop: number
  auto_defer: number
  auto_merge: number
}

export function applySafeTriageDecisions(input: {
  pending: PendingMemory[]
  decisions: TriageDecision[]
  now: string
}): {
  pending: PendingMemory[]
  tombstones: MemoryTombstone[]
  events: MemoryEvent[]
  counts: TriageApplyCounts
} {
  const byId = new Map(input.pending.map((candidate) => [candidate.id, candidate]))
  const retainedIds = new Set(input.pending.map((candidate) => candidate.id))
  const tombstones: MemoryTombstone[] = []
  const events: MemoryEvent[] = []
  const counts: TriageApplyCounts = { auto_drop: 0, auto_defer: 0, auto_merge: 0 }

  for (const decision of input.decisions.slice().sort(compareSafeTriageDecisionApplyOrder)) {
    if (decision.action === 'auto_drop') {
      const candidate = byId.get(decision.candidateId)
      if (candidate === undefined || !retainedIds.has(candidate.id)) continue
      retainedIds.delete(candidate.id)
      tombstones.push(tombstoneForAutoDroppedCandidate(candidate, input.now))
      events.push(memoryEventForTriageDecision('reject', candidate, input.now, decision.reason, {
        reviewAction: 'triage_auto_drop',
        triageDecision: 'auto_drop'
      }))
      counts.auto_drop += 1
      continue
    }

    if (decision.action === 'auto_merge') {
      const memberIds = decision.candidateIds.slice().sort()
      const keeperId = memberIds.find((id) => retainedIds.has(id) && byId.has(id))
      if (keeperId === undefined) continue
      let merged = byId.get(keeperId)
      if (merged === undefined) continue
      const mergedCandidateIds: string[] = [keeperId]
      for (const memberId of memberIds) {
        if (memberId === keeperId || !retainedIds.has(memberId)) continue
        const member = byId.get(memberId)
        if (member === undefined) continue
        merged = mergePendingMemory(merged, member)
        retainedIds.delete(memberId)
        mergedCandidateIds.push(memberId)
      }
      if (mergedCandidateIds.length < 2) continue
      byId.set(keeperId, merged)
      events.push(memoryEventForTriageDecision('pending', merged, input.now, decision.reason, {
        reviewAction: 'triage_auto_merge',
        triageDecision: 'auto_merge',
        clusterId: decision.clusterId,
        mergedCandidateIds: mergedCandidateIds.sort()
      }))
      counts.auto_merge += 1
      continue
    }

    if (decision.action === 'auto_defer') {
      const candidate = byId.get(decision.candidateId)
      if (candidate === undefined || !retainedIds.has(candidate.id)) continue
      const deferredCandidate: PendingMemory = {
        ...candidate,
        promoteAfter: addDays(input.now, decision.days)
      }
      byId.set(candidate.id, deferredCandidate)
      events.push(memoryEventForTriageDecision('pending', deferredCandidate, input.now, decision.reason, {
        reviewAction: 'triage_auto_defer',
        triageDecision: 'auto_defer',
        days: decision.days
      }))
      counts.auto_defer += 1
    }
  }

  return {
    pending: input.pending
      .filter((candidate) => retainedIds.has(candidate.id))
      .map((candidate) => byId.get(candidate.id) ?? candidate),
    tombstones,
    events,
    counts
  }
}

function compareSafeTriageDecisionApplyOrder(left: TriageDecision, right: TriageDecision): number {
  return triageApplyPriority(left.action) - triageApplyPriority(right.action)
}

function triageApplyPriority(action: TriageDecision['action']): number {
  if (action === 'auto_drop') return 0
  if (action === 'auto_merge') return 1
  if (action === 'auto_defer') return 2
  return 3
}

function tombstoneForAutoDroppedCandidate(candidate: PendingMemory, now: string): MemoryTombstone {
  return {
    id: `tombstone-${candidate.id}`,
    memoryId: candidate.id,
    normalizedKey: candidate.normalizedKey,
    domain: candidate.domain,
    type: candidate.type,
    strength: candidate.strength,
    scope: candidate.scope,
    reason: 'rejected',
    createdAt: now,
    evidence: candidate.evidence
  }
}

function memoryEventForTriageDecision(
  action: MemoryEvent['action'],
  candidate: PendingMemory,
  now: string,
  reason: string,
  details: Record<string, unknown>
): MemoryEvent {
  return {
    id: randomUUID(),
    action,
    at: now,
    reason,
    candidateId: candidate.id,
    details: {
      ...details,
      normalizedKey: candidate.normalizedKey,
      candidateSnapshot: pendingCandidateAuditSnapshot(candidate)
    }
  }
}

function pendingCandidateAuditSnapshot(candidate: PendingMemory): Record<string, unknown> {
  return {
    id: candidate.id,
    domain: candidate.domain,
    type: candidate.type,
    strength: candidate.strength,
    scope: candidate.scope,
    status: candidate.status,
    content: candidate.content,
    normalizedKey: candidate.normalizedKey,
    source: candidate.source,
    scores: candidate.scores,
    seenCount: candidate.seenCount,
    firstSeenAt: candidate.firstSeenAt,
    lastSeenAt: candidate.lastSeenAt,
    promoteAfter: candidate.promoteAfter,
    expiresAt: candidate.expiresAt,
    candidateKind: candidate.candidateKind ?? candidate.candidate_kind,
    tags: candidate.tags,
    evidence: candidate.evidence
  }
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}
