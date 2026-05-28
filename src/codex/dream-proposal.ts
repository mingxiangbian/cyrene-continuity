import { lstat, realpath } from 'node:fs/promises'
import {
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot
} from '../memory/memory-store.js'
import {
  runDreamApplyEvalGate,
  type EvalCheckName,
  type EvalResult
} from '../eval/eval-runner.js'
import {
  activateCandidate,
  evaluatePendingPromotion,
  validateMemoryCandidate
} from '../memory/memory-validator.js'
import type { MemoryTombstone, PendingMemory } from '../memory/types.js'

export interface DreamEvalGateResult {
  passed: boolean
  failedChecks: EvalCheckName[]
  results: EvalResult[]
}

export interface DreamProposalSummary {
  recommendedPromotions: number
  reject: number
  expire: number
  keepPending: number
  maintenanceWouldRun: boolean
}

export type DreamProposedChange =
  | {
      action: 'recommend_promote'
      candidateId: string
      recommendedMemoryId: string
      normalizedKey: string
      reason: string
      distinctEvidenceCount: number
    }
  | {
      action: 'promote'
      candidateId: string
      memoryId: string
      normalizedKey: string
      reason: string
      distinctEvidenceCount: number
    }
  | {
      action: 'reject'
      candidateId: string
      normalizedKey: string
      reason: string
      tombstoneReason: MemoryTombstone['reason']
    }
  | {
      action: 'keep_pending'
      candidateId: string
      normalizedKey: string
      reason: string
      distinctEvidenceCount: number
    }

export type DreamApplyOperation =
  | {
      action: 'reject'
      candidateId: string
      tombstone: MemoryTombstone
      reason: string
    }
  | {
      action: 'keep_pending'
      candidate: PendingMemory
      reason: string
    }

export interface DreamLogicalDiff {
  addActiveMemoryIds: string[]
  recommendActiveMemoryIds: string[]
  removePendingCandidateIds: string[]
  addTombstoneIds: string[]
  keepPendingCandidateIds: string[]
}

export interface DreamRootProposal {
  memoryRoot: string
  proposedChanges: DreamProposedChange[]
  applyPlan: DreamApplyOperation[]
  diff: DreamLogicalDiff
  summary: DreamProposalSummary
  evalGate: DreamEvalGateResult
}

export async function buildDreamProposalForRoot(input: {
  memoryRoot: string
  now: string
  recommendPromotionEnabled?: boolean
}): Promise<DreamRootProposal> {
  const memoryRoot = await resolveReadableMemoryRootPath(input.memoryRoot)
  const active = await readActiveMemoriesFromRoot(memoryRoot)
  const tombstones = await readTombstonesFromRoot(memoryRoot)
  const pending = await readPendingMemoriesFromRoot(memoryRoot)
  const proposedChanges: DreamProposedChange[] = []
  const applyPlan: DreamApplyOperation[] = []
  const diff: DreamLogicalDiff = {
    addActiveMemoryIds: [],
    recommendActiveMemoryIds: [],
    removePendingCandidateIds: [],
    addTombstoneIds: [],
    keepPendingCandidateIds: []
  }
  const summary: DreamProposalSummary = {
    recommendedPromotions: 0,
    reject: 0,
    expire: 0,
    keepPending: 0,
    maintenanceWouldRun: true
  }

  for (const candidate of pending) {
    if (candidate.expiresAt <= input.now) {
      const tombstone = tombstoneForExpiredPending(candidate, input.now)
      proposedChanges.push({
        action: 'reject',
        candidateId: candidate.id,
        normalizedKey: candidate.normalizedKey,
        reason: 'Memory candidate expired before dream promotion',
        tombstoneReason: 'expired'
      })
      applyPlan.push({
        action: 'reject',
        candidateId: candidate.id,
        tombstone,
        reason: 'Memory candidate expired before dream promotion'
      })
      diff.removePendingCandidateIds.push(candidate.id)
      diff.addTombstoneIds.push(tombstone.id)
      summary.reject += 1
      summary.expire += 1
      continue
    }

    const decision = validateMemoryCandidate({ candidate, existingMemories: active, tombstones, now: input.now })
    if (decision.action === 'reject') {
      proposedChanges.push({
        action: 'reject',
        candidateId: candidate.id,
        normalizedKey: candidate.normalizedKey,
        reason: decision.reason,
        tombstoneReason: decision.tombstone.reason
      })
      applyPlan.push({
        action: 'reject',
        candidateId: candidate.id,
        tombstone: decision.tombstone,
        reason: decision.reason
      })
      diff.removePendingCandidateIds.push(candidate.id)
      diff.addTombstoneIds.push(decision.tombstone.id)
      summary.reject += 1
      continue
    }

    const evaluation = evaluatePendingPromotion(candidate, input.now)
    if (!evaluation.promotable) {
      proposedChanges.push({
        action: 'keep_pending',
        candidateId: candidate.id,
        normalizedKey: candidate.normalizedKey,
        reason: evaluation.reason,
        distinctEvidenceCount: evaluation.distinctEvidenceCount
      })
      applyPlan.push({ action: 'keep_pending', candidate, reason: evaluation.reason })
      diff.keepPendingCandidateIds.push(candidate.id)
      summary.keepPending += 1
      continue
    }

    if (input.recommendPromotionEnabled === false) {
      proposedChanges.push({
        action: 'keep_pending',
        candidateId: candidate.id,
        normalizedKey: candidate.normalizedKey,
        reason: 'Promotion recommendations are disabled by configuration',
        distinctEvidenceCount: evaluation.distinctEvidenceCount
      })
      applyPlan.push({
        action: 'keep_pending',
        candidate,
        reason: 'Promotion recommendations are disabled by configuration'
      })
      diff.keepPendingCandidateIds.push(candidate.id)
      summary.keepPending += 1
      continue
    }

    const memory = decision.action === 'auto_write'
      ? decision.memory
      : decision.action === 'pending'
        ? activateCandidate(decision.candidate, input.now)
        : undefined
    if (memory === undefined) {
      proposedChanges.push({
        action: 'keep_pending',
        candidateId: candidate.id,
        normalizedKey: candidate.normalizedKey,
        reason: decision.reason,
        distinctEvidenceCount: evaluation.distinctEvidenceCount
      })
      applyPlan.push({ action: 'keep_pending', candidate, reason: decision.reason })
      diff.keepPendingCandidateIds.push(candidate.id)
      summary.keepPending += 1
      continue
    }

    proposedChanges.push({
      action: 'recommend_promote',
      candidateId: candidate.id,
      recommendedMemoryId: memory.id,
      normalizedKey: candidate.normalizedKey,
      reason: evaluation.reason,
      distinctEvidenceCount: evaluation.distinctEvidenceCount
    })
    applyPlan.push({ action: 'keep_pending', candidate, reason: evaluation.reason })
    diff.recommendActiveMemoryIds.push(memory.id)
    diff.keepPendingCandidateIds.push(candidate.id)
    summary.recommendedPromotions += 1
    summary.keepPending += 1
  }

  const evalGate = runDreamApplyEvalGate({ proposedChanges, pending })

  return {
    memoryRoot,
    proposedChanges,
    applyPlan,
    diff,
    summary,
    evalGate
  }
}

async function resolveReadableMemoryRootPath(memoryRoot: string): Promise<string> {
  try {
    const stats = await lstat(memoryRoot)
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to use memory symlink: ${memoryRoot}`)
    }
    if (!stats.isDirectory()) {
      throw new Error(`Refusing to use non-directory memory path: ${memoryRoot}`)
    }
    return realpath(memoryRoot)
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return memoryRoot
    }
    throw error
  }
}

function tombstoneForExpiredPending(candidate: PendingMemory, now: string): MemoryTombstone {
  return {
    id: `tombstone-${candidate.id}`,
    normalizedKey: candidate.normalizedKey,
    domain: candidate.domain,
    type: candidate.type,
    strength: candidate.strength,
    scope: candidate.scope,
    reason: 'expired',
    createdAt: now,
    evidence: candidate.evidence
  }
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
