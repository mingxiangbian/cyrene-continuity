import { deriveMemoryCandidateKind } from '../memory/candidate-kind.js'
import { distinctEvidenceCount } from '../memory/memory-validator.js'
import type { CyreneMemory, MemoryTombstone, PendingMemory } from '../memory/types.js'

export type TriageDecision =
  | { action: 'auto_drop'; candidateId: string; reason: string }
  | { action: 'auto_merge'; candidateIds: string[]; clusterId: string; reason: string }
  | { action: 'auto_defer'; candidateId: string; days: number; reason: string }
  | { action: 'recommend'; candidateId: string; priority: 'normal' | 'high'; reason: string }
  | { action: 'auto_promote'; candidateId: string; policyId: AutoPromotionPolicyId; reason: string }
  | { action: 'manual_review'; candidateId: string; reason: string }

export type AutoPromotionPolicyId = 'low_risk_project_memory_v1' | 'low_risk_global_procedural_v1'

export interface CandidateCluster {
  id: string
  normalizedKey: string
  memberIds: string[]
  evidenceCount: number
  recommendation: 'review' | 'promote' | 'drop' | 'defer'
}

export interface AutoPromotionPolicyInput {
  candidate: PendingMemory
  scope: 'project' | 'global'
  active: CyreneMemory[]
  tombstones: MemoryTombstone[]
  promotionsUsedToday: number
  projectDailyCap: number
  globalDailyCap: number
  now: string
}

export type AutoPromotionPolicyResult =
  | { allowed: true; policyId: AutoPromotionPolicyId; reason: string; distinctEvidenceCount: number }
  | { allowed: false; reason: string; distinctEvidenceCount: number }

export interface PendingEvictionRank {
  candidateId: string
  protected: boolean
  score: number
  candidate: PendingMemory
}

const MAX_REVIEW_RECOMMENDATIONS = 20
const HIGH_PRIORITY_RECOMMENDATION_SCORE = 1_000

export function buildCandidateClusters(pending: PendingMemory[]): CandidateCluster[] {
  const byKey = new Map<string, PendingMemory[]>()
  for (const candidate of pending) {
    const key = `${candidate.normalizedKey}|${deriveMemoryCandidateKind(candidate)}|${candidate.scope}`
    byKey.set(key, [...(byKey.get(key) ?? []), candidate])
  }
  return [...byKey.values()]
    .filter((items) => items.length > 1)
    .map((items) => ({
      id: `cluster-${items[0].normalizedKey}`,
      normalizedKey: items[0].normalizedKey,
      memberIds: items.map((item) => item.id).sort(),
      evidenceCount: items.reduce((sum, item) => sum + item.evidence.length, 0),
      recommendation: 'review'
    }))
}

export function evaluateAutoPromotionPolicy(input: AutoPromotionPolicyInput): AutoPromotionPolicyResult {
  const candidate = input.candidate
  const distinct = distinctEvidenceCount(candidate)
  const kind = deriveMemoryCandidateKind(candidate)
  if (candidate.domain === 'personal' || candidate.domain === 'relationship' || candidate.domain === 'affective') {
    return denied('high-risk domain cannot auto-promote', distinct)
  }
  if (
    candidate.source === 'assistant_observed' &&
    candidate.evidence.every((entry) => entry.sourceKind === undefined || entry.sourceKind === 'assistant_observed')
  ) {
    return denied('assistant_observed-only candidate cannot auto-promote', distinct)
  }
  if (input.active.some((memory) => memory.normalizedKey === candidate.normalizedKey)) {
    return denied('normalizedKey conflict with active memory', distinct)
  }
  if (
    input.tombstones.some((tombstone) =>
      tombstone.normalizedKey === candidate.normalizedKey &&
      (tombstone.expiresAt === undefined || tombstone.expiresAt > input.now)
    )
  ) {
    return denied('active tombstone blocks auto-promotion', distinct)
  }
  if (
    candidate.scores.evidenceStrength < 0.85 ||
    candidate.scores.stability < 0.8 ||
    candidate.scores.usefulness < 0.7 ||
    candidate.scores.safety < 0.9 ||
    candidate.scores.sensitivity > 0.2 ||
    candidate.seenCount < 2 ||
    distinct < 2
  ) {
    return denied('candidate is below strict project score or evidence thresholds', distinct)
  }
  if (input.scope === 'project') {
    if (!['project', 'procedural', 'system'].includes(candidate.domain)) {
      return denied('domain is not project auto-promotable', distinct)
    }
    if (!['project_fact', 'workflow_rule', 'known_pitfall'].includes(kind)) {
      return denied('candidate kind is not project auto-promotable', distinct)
    }
    if (!['file', 'tool_trace', 'user_explicit'].includes(candidate.source)) {
      return denied(`source ${candidate.source} is not project auto-promotable`, distinct)
    }
    if (input.promotionsUsedToday >= input.projectDailyCap) {
      return denied('project daily auto-promotion cap reached', distinct)
    }
    return {
      allowed: true,
      policyId: 'low_risk_project_memory_v1',
      reason: 'candidate passed strict project auto-promotion policy',
      distinctEvidenceCount: distinct
    }
  }
  if (candidate.scope !== 'global') return denied('global policy requires global scope', distinct)
  if (!['procedural', 'system'].includes(candidate.domain)) {
    return denied('global auto-promotion allows only procedural/system domains', distinct)
  }
  if (!['user_instruction', 'workflow_rule'].includes(kind)) {
    return denied('global candidate kind is not auto-promotable', distinct)
  }
  if (!['user_explicit', 'review_event'].includes(candidate.source)) {
    return denied(`source ${candidate.source} is not global auto-promotable`, distinct)
  }
  if (
    candidate.scores.sensitivity > 0.1 ||
    candidate.scores.safety < 0.95 ||
    candidate.scores.evidenceStrength < 0.9 ||
    candidate.scores.stability < 0.85
  ) {
    return denied('candidate is below stricter global thresholds', distinct)
  }
  if (input.promotionsUsedToday >= input.globalDailyCap) {
    return denied('global daily auto-promotion cap reached', distinct)
  }
  return {
    allowed: true,
    policyId: 'low_risk_global_procedural_v1',
    reason: 'candidate passed strict global auto-promotion policy',
    distinctEvidenceCount: distinct
  }
}

export function triagePendingMemories(input: {
  pending: PendingMemory[]
  active: CyreneMemory[]
  tombstones: MemoryTombstone[]
  scope: 'project' | 'global'
  now: string
}): { decisions: TriageDecision[]; clusters: CandidateCluster[] } {
  const decisions: TriageDecision[] = []
  const clusters = buildCandidateClusters(input.pending)
  for (const cluster of clusters) {
    decisions.push({
      action: 'auto_merge',
      candidateIds: cluster.memberIds,
      clusterId: cluster.id,
      reason: 'duplicate normalizedKey/kind/scope cluster'
    })
  }
  for (const candidate of input.pending) {
    if (isTransientNoise(candidate)) {
      decisions.push({ action: 'auto_drop', candidateId: candidate.id, reason: 'transient command status noise' })
    } else if (candidate.seenCount === 1 && candidate.scores.evidenceStrength < 0.75 && candidate.scores.usefulness < 0.6) {
      decisions.push({ action: 'auto_defer', candidateId: candidate.id, days: 14, reason: 'weak single-evidence candidate' })
    }
  }
  const decidedCandidateIds = candidateIdsForDecisions(decisions)
  for (const item of rankPendingForEviction(input.pending, input.now)
    .filter((ranked) => !decidedCandidateIds.has(ranked.candidateId))
    .sort((left, right) => right.score - left.score || left.candidateId.localeCompare(right.candidateId))
    .slice(0, MAX_REVIEW_RECOMMENDATIONS)) {
    if (item.protected) {
      decisions.push({
        action: 'manual_review',
        candidateId: item.candidateId,
        reason: 'protected pending candidate requires explicit review'
      })
    } else {
      decisions.push({
        action: 'recommend',
        candidateId: item.candidateId,
        priority: item.score >= HIGH_PRIORITY_RECOMMENDATION_SCORE ? 'high' : 'normal',
        reason: 'ranked pending candidate for explicit review'
      })
    }
  }
  return { decisions, clusters }
}

export function rankPendingForEviction(pending: PendingMemory[], now: string): PendingEvictionRank[] {
  return pending
    .map((candidate) => {
      const protectedCandidate = isProtectedPending(candidate, now)
      return {
        candidateId: candidate.id,
        protected: protectedCandidate,
        score: pendingEvictionScore(candidate, protectedCandidate),
        candidate
      }
    })
    .sort((left, right) => left.score - right.score || left.candidateId.localeCompare(right.candidateId))
}

function denied(reason: string, distinctEvidenceCount: number): AutoPromotionPolicyResult {
  return { allowed: false, reason, distinctEvidenceCount }
}

function candidateIdsForDecisions(decisions: TriageDecision[]): Set<string> {
  const ids = new Set<string>()
  for (const decision of decisions) {
    if ('candidateId' in decision) ids.add(decision.candidateId)
    if ('candidateIds' in decision) {
      for (const candidateId of decision.candidateIds) ids.add(candidateId)
    }
  }
  return ids
}

function isTransientNoise(candidate: PendingMemory): boolean {
  const text = `${candidate.content} ${candidate.evidence.map((entry) => `${entry.summary ?? ''} ${entry.quote ?? ''}`).join(' ')}`.toLowerCase()
  return (
    /\bran\s+npm\s+(test|run|install|ci)\b/.test(text) ||
    /\bgit\s+status\b/.test(text) ||
    /\bcurrent\s+branch\b/.test(text) ||
    /\btemporary\s+command\s+result\b/.test(text) ||
    /\bone-off\s+command\s+output\b/.test(text)
  )
}

function isProtectedPending(candidate: PendingMemory, now: string): boolean {
  if (candidate.source === 'user_explicit') return true
  if (deriveMemoryCandidateKind(candidate) === 'user_instruction') return true
  if (candidate.domain === 'personal' || candidate.domain === 'relationship' || candidate.domain === 'affective') return true
  if (candidate.scores.sensitivity > 0.6) return true
  return hasRecentDirectUserEvidence(candidate, now)
}

function hasRecentDirectUserEvidence(candidate: PendingMemory, now: string): boolean {
  if (!candidate.evidence.some((entry) => entry.sourceKind === 'user_explicit')) return false
  const nowMs = Date.parse(now)
  const lastSeenMs = Date.parse(candidate.lastSeenAt)
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastSeenMs)) return false
  const ageMs = nowMs - lastSeenMs
  return ageMs >= 0 && ageMs <= 30 * 24 * 60 * 60 * 1000
}

function pendingEvictionScore(candidate: PendingMemory, protectedCandidate: boolean): number {
  const score =
    candidate.scores.evidenceStrength * 400 +
    candidate.scores.stability * 200 +
    candidate.scores.usefulness * 300 +
    candidate.scores.safety * 100 -
    candidate.scores.sensitivity * 100 +
    candidate.seenCount * 20 +
    distinctEvidenceCount(candidate) * 30 +
    sourceBonus(candidate.source)
  return protectedCandidate ? score + 10_000 : score
}

function sourceBonus(source: PendingMemory['source']): number {
  if (source === 'user_explicit') return 500
  if (source === 'file') return 250
  if (source === 'tool_trace') return 200
  if (source === 'review_event') return 150
  if (source === 'legacy_markdown') return 100
  if (source === 'user_implicit') return 50
  return 0
}
