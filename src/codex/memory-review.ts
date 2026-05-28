import { createHash, randomUUID } from 'node:crypto'
import { createDefaultConfig } from '../config.js'
import {
  codexGlobalMemoryRoot,
  codexProjectMemoryRoot,
  getReadableCodexGlobalMemoryRoot,
  getReadableCodexProjectMemoryRoot
} from './codex-memory-root.js'
import { syncCurrentCodexMemoryIndex } from './codex-memory-index.js'
import { identifyCodexProject } from './project-id.js'
import {
  assertMemoryMaintenanceTargetsSafeFromRoot,
  runMemoryMaintenanceFromRootLocked,
  withMemoryMaintenanceLockFromRoot
} from '../memory/memory-maintenance.js'
import {
  appendMemoryEventFromRoot,
  appendTombstoneFromRoot,
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot
} from '../memory/memory-store.js'
import {
  activateCandidate,
  evaluatePendingPromotion,
  validateMemoryCandidate
} from '../memory/memory-validator.js'
import type { CyreneMemory, MemoryTombstone, PendingMemory } from '../memory/types.js'

export type CodexMemoryCandidateKind =
  | 'project_fact'
  | 'project_decision'
  | 'user_instruction'
  | 'workflow_rule'
  | 'known_pitfall'
  | 'rejected_approach'
  | 'open_question'

export type CodexPendingMemoryRecommendation = 'promote' | 'reject' | 'defer'
export type CodexPendingMemoryRisk = 'low' | 'medium' | 'high'

export interface CodexPendingMemorySummary {
  id: string
  domain: PendingMemory['domain']
  type: PendingMemory['type']
  strength: PendingMemory['strength']
  scope: PendingMemory['scope']
  candidateKind: CodexMemoryCandidateKind
  recommendation: CodexPendingMemoryRecommendation
  suggestedAction: string
  risk: CodexPendingMemoryRisk
  sensitivity: number
  evidenceCount: number
  content: string
  normalizedKey: string
  source: PendingMemory['source']
  seenCount: number
  firstSeenAt: string
  lastSeenAt: string
  expiresAt?: string
  reviewHash: string
  evidenceSummary: string[]
  scores: PendingMemory['scores']
}

export interface CodexPendingReviewNotice {
  count: number
  hasItems: boolean
  newestCandidateId?: string
  newestPreview?: string
}

interface CodexPendingMemoryProject {
  projectId: string
  displayName: string
}

export interface CodexPendingMemoryListResult {
  project: CodexPendingMemoryProject
  pending: CodexPendingMemorySummary[]
  total: number
  memoryRoot: string
}

export interface CodexPendingMemoryGetResult {
  project: CodexPendingMemoryProject
  memoryRoot: string
  result:
    | {
        action: 'get'
        candidate: PendingMemory
        reviewHash: string
      }
    | {
        action: 'not_found'
        candidateId: string
        reason: string
      }
}

export interface CodexPendingMemoryPromoteResult {
  project: CodexPendingMemoryProject
  memoryRoot: string
  result:
    | {
        action: 'promote'
        candidateId: string
        memory: CyreneMemory
        reviewHash: string
      }
    | {
        action: 'not_found'
        candidateId: string
        reason: string
      }
    | {
        action: 'conflict'
        candidateId: string
        reason: string
        latest: CodexPendingMemorySummary
      }
    | {
        action: 'rejected_by_validator'
        candidateId: string
        reason: string
        tombstone: MemoryTombstone
      }
}

export interface CodexPendingMemoryRejectResult {
  project: CodexPendingMemoryProject
  memoryRoot: string
  result:
    | {
        action: 'reject'
        candidateId: string
        tombstone: MemoryTombstone
        reviewHash: string
      }
    | {
        action: 'not_found'
        candidateId: string
        reason: string
      }
    | {
        action: 'conflict'
        candidateId: string
        reason: string
        latest: CodexPendingMemorySummary
      }
}

export interface CodexPendingMemoryEditResult {
  project: CodexPendingMemoryProject
  memoryRoot: string
  result:
    | {
        action: 'edit'
        candidateId: string
        candidate: PendingMemory
        reviewHash: string
      }
    | {
        action: 'not_found'
        candidateId: string
        reason: string
      }
    | {
        action: 'conflict'
        candidateId: string
        reason: string
        latest: CodexPendingMemorySummary
      }
    | {
        action: 'rejected_by_validator'
        candidateId: string
        reason: string
        tombstone: MemoryTombstone
      }
}

export interface CodexPendingMemoryDeferResult {
  project: CodexPendingMemoryProject
  memoryRoot: string
  result:
    | {
        action: 'defer'
        candidateId: string
        candidate: PendingMemory
        reviewHash: string
      }
    | {
        action: 'not_found'
        candidateId: string
        reason: string
      }
    | {
        action: 'conflict'
        candidateId: string
        reason: string
        latest: CodexPendingMemorySummary
      }
}

export function reviewHashForPendingMemory(candidate: PendingMemory): string {
  const payload = {
    id: candidate.id,
    domain: candidate.domain,
    type: candidate.type,
    strength: candidate.strength,
    scope: candidate.scope,
    status: candidate.status,
    content: candidate.content,
    normalizedKey: candidate.normalizedKey,
    evidence: candidate.evidence.map((entry) => ({
      runId: entry.runId ?? null,
      messageIds: entry.messageIds ?? null,
      traceRefs: entry.traceRefs ?? null,
      quote: entry.quote ?? null,
      summary: entry.summary ?? null,
      evidenceGroupId: entry.evidenceGroupId ?? null,
      sessionId: entry.sessionId ?? null,
      taskHash: entry.taskHash ?? null,
      quoteHash: entry.quoteHash ?? null,
      sourceKind: entry.sourceKind ?? null
    })),
    source: candidate.source,
    scores: {
      evidenceStrength: candidate.scores.evidenceStrength,
      stability: candidate.scores.stability,
      usefulness: candidate.scores.usefulness,
      safety: candidate.scores.safety,
      sensitivity: candidate.scores.sensitivity
    },
    seenCount: candidate.seenCount,
    firstSeenAt: candidate.firstSeenAt,
    lastSeenAt: candidate.lastSeenAt,
    promoteAfter: candidate.promoteAfter ?? null,
    expiresAt: candidate.expiresAt,
    userConfirmed: candidate.userConfirmed ?? null,
    tags: candidate.tags,
    conflictsWith: candidate.conflictsWith ?? null
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function summarizePendingMemory(candidate: PendingMemory, now = new Date().toISOString()): CodexPendingMemorySummary {
  const reviewHash = reviewHashForPendingMemory(candidate)
  const recommendation = deriveRecommendation(candidate, now)
  return {
    id: candidate.id,
    domain: candidate.domain,
    type: candidate.type,
    strength: candidate.strength,
    scope: candidate.scope,
    candidateKind: deriveCandidateKind(candidate),
    recommendation,
    suggestedAction: suggestedReviewAction(candidate.id, reviewHash, recommendation),
    risk: deriveRisk(candidate),
    sensitivity: candidate.scores.sensitivity,
    evidenceCount: candidate.evidence.length,
    content: candidate.content,
    normalizedKey: candidate.normalizedKey,
    source: candidate.source,
    seenCount: candidate.seenCount,
    firstSeenAt: candidate.firstSeenAt,
    lastSeenAt: candidate.lastSeenAt,
    expiresAt: candidate.expiresAt,
    reviewHash,
    evidenceSummary: candidate.evidence
      .map((entry) => entry.summary ?? entry.quote ?? entry.runId ?? '')
      .filter((text) => text.trim() !== ''),
    scores: candidate.scores
  }
}

function deriveRecommendation(candidate: PendingMemory, now: string): CodexPendingMemoryRecommendation {
  if (candidate.expiresAt <= now) {
    return 'reject'
  }
  const promotion = evaluatePendingPromotion(candidate, now)
  return promotion.promotable ? 'promote' : 'defer'
}

function deriveCandidateKind(candidate: PendingMemory): CodexMemoryCandidateKind {
  const tagKind = candidate.tags.find((tag): tag is CodexMemoryCandidateKind =>
    tag === 'project_fact' ||
    tag === 'project_decision' ||
    tag === 'user_instruction' ||
    tag === 'workflow_rule' ||
    tag === 'known_pitfall' ||
    tag === 'rejected_approach' ||
    tag === 'open_question'
  )
  if (tagKind !== undefined) {
    return tagKind
  }
  if (candidate.type === 'project_fact') {
    return 'project_fact'
  }
  if (candidate.type === 'procedural_rule' || candidate.type === 'system_policy') {
    return 'workflow_rule'
  }
  if (
    candidate.type === 'user_preference' ||
    candidate.type === 'interaction_style' ||
    candidate.type === 'relationship_boundary' ||
    candidate.type === 'affective_pattern'
  ) {
    return 'user_instruction'
  }
  if (candidate.type === 'episode') {
    return 'project_fact'
  }
  return 'project_fact'
}

function deriveRisk(candidate: PendingMemory): CodexPendingMemoryRisk {
  if (candidate.scores.safety < 0.65 || candidate.scores.sensitivity > 0.6) {
    return 'high'
  }
  if (candidate.scores.safety < 0.8 || candidate.scores.sensitivity > 0.45) {
    return 'medium'
  }
  return 'low'
}

function suggestedReviewAction(
  candidateId: string,
  reviewHash: string,
  recommendation: CodexPendingMemoryRecommendation
): string {
  if (recommendation === 'promote') {
    return `cyrene-continuity codex memory approve ${candidateId} --review-hash ${reviewHash}`
  }
  if (recommendation === 'reject') {
    return `cyrene-continuity codex memory reject ${candidateId} --review-hash ${reviewHash}`
  }
  return `cyrene-continuity codex memory defer ${candidateId} --review-hash ${reviewHash}`
}

export async function listCodexPendingMemories(input: {
  cwd: string
  limit?: number
}): Promise<CodexPendingMemoryListResult> {
  const { project, memoryRoot, readableRoots } = await getProjectAndReadableMemoryRoots(input.cwd)
  const pending = sortPendingNewestFirst((await Promise.all(readableRoots.map((root) => readPendingMemoriesFromRoot(root)))).flat())
  const summaries = pending.map((candidate) => summarizePendingMemory(candidate))
  return {
    project,
    pending: input.limit === undefined ? summaries : summaries.slice(0, input.limit),
    total: pending.length,
    memoryRoot
  }
}

export async function getCodexPendingMemory(input: {
  cwd: string
  id: string
}): Promise<CodexPendingMemoryGetResult> {
  const { project, memoryRoot, candidate } = await findPendingCandidateInCodexRoots(input.cwd, input.id)
  if (candidate === undefined) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'not_found',
        candidateId: input.id,
        reason: 'Pending memory candidate not found'
      }
    }
  }

  return {
    project,
    memoryRoot,
    result: {
      action: 'get',
      candidate,
      reviewHash: reviewHashForPendingMemory(candidate)
    }
  }
}

export async function promoteCodexPendingMemory(input: {
  cwd: string
  id: string
  reviewHash: string
  reason?: string
  now?: string
}): Promise<CodexPendingMemoryPromoteResult> {
  const now = input.now ?? new Date().toISOString()
  const { project, memoryRoot, candidate } = await findPendingCandidateInCodexRoots(input.cwd, input.id)
  if (candidate === undefined) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'not_found',
        candidateId: input.id,
        reason: 'Pending memory candidate not found'
      }
    }
  }

  const latestReviewHash = reviewHashForPendingMemory(candidate)
  if (latestReviewHash !== input.reviewHash) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'conflict',
        candidateId: input.id,
        reason: 'Pending memory candidate changed since review',
        latest: summarizePendingMemory(candidate)
      }
    }
  }

  const [active, tombstones] = await Promise.all([
    readActiveMemoriesFromRoot(memoryRoot),
    readTombstonesFromRoot(memoryRoot)
  ])
  const confirmedCandidate: PendingMemory = { ...candidate, userConfirmed: true }
  const decision = validateMemoryCandidate({ candidate: confirmedCandidate, existingMemories: active, tombstones, now })
  if (decision.action === 'reject') {
    return {
      project,
      memoryRoot,
      result: {
        action: 'rejected_by_validator',
        candidateId: candidate.id,
        reason: decision.reason,
        tombstone: decision.tombstone
      }
    }
  }

  const config = createDefaultConfig(input.cwd)
  const maintenanceBudget = {
    activeMaxItems: config.memoryActiveMaxItems,
    activeContentMaxChars: config.memoryActiveContentMaxChars,
    indexFileMaxChars: config.memoryIndexFileMaxChars,
    singleMemoryContentMaxChars: config.memorySingleContentMaxChars,
    singleMemoryEvidenceMaxChars: config.memorySingleEvidenceMaxChars,
    pendingMaxItems: config.memoryPendingMaxItems
  }

  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const lockedPending = await readPendingMemoriesFromRoot(lockedMemoryRoot)
    const lockedCandidate = lockedPending.find((memoryCandidate) => memoryCandidate.id === candidate.id)
    if (lockedCandidate === undefined) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'not_found',
          candidateId: candidate.id,
          reason: 'Pending memory candidate not found'
        }
      }
    }

    const lockedReviewHash = reviewHashForPendingMemory(lockedCandidate)
    if (lockedReviewHash !== input.reviewHash) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'conflict',
          candidateId: candidate.id,
          reason: 'Pending memory candidate changed since review',
          latest: summarizePendingMemory(lockedCandidate)
        }
      }
    }

    const [lockedActive, lockedTombstones] = await Promise.all([
      readActiveMemoriesFromRoot(lockedMemoryRoot),
      readTombstonesFromRoot(lockedMemoryRoot)
    ])
    const lockedConfirmedCandidate: PendingMemory = { ...lockedCandidate, userConfirmed: true }
    const lockedDecision = validateMemoryCandidate({
      candidate: lockedConfirmedCandidate,
      existingMemories: lockedActive,
      tombstones: lockedTombstones,
      now
    })
    if (lockedDecision.action === 'reject') {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'rejected_by_validator',
          candidateId: lockedCandidate.id,
          reason: lockedDecision.reason,
          tombstone: lockedDecision.tombstone
        }
      }
    }

    const lockedMemory = memoryForPromotedDecision(lockedDecision, now)
    const nextActive = upsertActiveMemory(lockedActive, lockedMemory)
    const nextPending = lockedPending.filter((memoryCandidate) => memoryCandidate.id !== lockedCandidate.id)

    await writeActiveMemoriesFromRoot(lockedMemoryRoot, nextActive)
    await writePendingMemoriesFromRoot(lockedMemoryRoot, nextPending)
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'promote',
      at: now,
      reason: input.reason ?? 'Approved by Codex pending memory review',
      memoryId: lockedMemory.id,
      candidateId: lockedCandidate.id
    })
    await runMemoryMaintenanceFromRootLocked({
      memoryRoot: lockedMemoryRoot,
      budget: maintenanceBudget,
      now,
      reason: 'after manual memory promotion'
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })

    return {
      project,
      memoryRoot: lockedMemoryRoot,
      result: {
        action: 'promote',
        candidateId: lockedCandidate.id,
        memory: lockedMemory,
        reviewHash: lockedReviewHash
      }
    }
  })
}

function memoryForPromotedDecision(
  decision: Exclude<ReturnType<typeof validateMemoryCandidate>, { action: 'reject' }>,
  now: string
): CyreneMemory {
  if (decision.action === 'pending') {
    return activateCandidate({ ...decision.candidate, userConfirmed: true }, now)
  }

  if (decision.action === 'auto_write') {
    return { ...decision.memory, userConfirmed: true }
  }

  throw new Error(`Unsupported validator action for Codex pending promotion: ${decision.action}`)
}

export async function rejectCodexPendingMemory(input: {
  cwd: string
  id: string
  reviewHash: string
  reason?: string
  now?: string
}): Promise<CodexPendingMemoryRejectResult> {
  const now = input.now ?? new Date().toISOString()
  const { project, memoryRoot, candidate } = await findPendingCandidateInCodexRoots(input.cwd, input.id)
  if (candidate === undefined) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'not_found',
        candidateId: input.id,
        reason: 'Pending memory candidate not found'
      }
    }
  }

  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const lockedPending = await readPendingMemoriesFromRoot(lockedMemoryRoot)
    const lockedCandidate = lockedPending.find((memoryCandidate) => memoryCandidate.id === candidate.id)
    if (lockedCandidate === undefined) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'not_found',
          candidateId: candidate.id,
          reason: 'Pending memory candidate not found'
        }
      }
    }

    const latestReviewHash = reviewHashForPendingMemory(lockedCandidate)
    if (latestReviewHash !== input.reviewHash) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'conflict',
          candidateId: candidate.id,
          reason: 'Pending memory candidate changed since review',
          latest: summarizePendingMemory(lockedCandidate)
        }
      }
    }

    const tombstone = tombstoneForRejectedCandidate(lockedCandidate, now)
    const nextPending = lockedPending.filter((memoryCandidate) => memoryCandidate.id !== lockedCandidate.id)
    await writePendingMemoriesFromRoot(lockedMemoryRoot, nextPending)
    await appendTombstoneFromRoot(lockedMemoryRoot, tombstone)
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'reject',
      at: now,
      reason: input.reason ?? 'Rejected by Codex pending memory review',
      candidateId: lockedCandidate.id
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })

    return {
      project,
      memoryRoot: lockedMemoryRoot,
      result: {
        action: 'reject',
        candidateId: lockedCandidate.id,
        tombstone,
        reviewHash: latestReviewHash
      }
    }
  })
}

export async function editCodexPendingMemory(input: {
  cwd: string
  id: string
  reviewHash: string
  content: string
  normalizedKey?: string
  reason?: string
  now?: string
}): Promise<CodexPendingMemoryEditResult> {
  const now = input.now ?? new Date().toISOString()
  const { project, memoryRoot, candidate } = await findPendingCandidateInCodexRoots(input.cwd, input.id)
  if (candidate === undefined) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'not_found',
        candidateId: input.id,
        reason: 'Pending memory candidate not found'
      }
    }
  }

  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const lockedPending = await readPendingMemoriesFromRoot(lockedMemoryRoot)
    const lockedCandidate = lockedPending.find((memoryCandidate) => memoryCandidate.id === candidate.id)
    if (lockedCandidate === undefined) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'not_found',
          candidateId: candidate.id,
          reason: 'Pending memory candidate not found'
        }
      }
    }

    const latestReviewHash = reviewHashForPendingMemory(lockedCandidate)
    if (latestReviewHash !== input.reviewHash) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'conflict',
          candidateId: candidate.id,
          reason: 'Pending memory candidate changed since review',
          latest: summarizePendingMemory(lockedCandidate)
        }
      }
    }

    const editedCandidate: PendingMemory = {
      ...lockedCandidate,
      content: input.content,
      normalizedKey: input.normalizedKey ?? lockedCandidate.normalizedKey,
      lastSeenAt: now
    }
    const [lockedActive, lockedTombstones] = await Promise.all([
      readActiveMemoriesFromRoot(lockedMemoryRoot),
      readTombstonesFromRoot(lockedMemoryRoot)
    ])
    const decision = validateMemoryCandidate({
      candidate: editedCandidate,
      existingMemories: lockedActive,
      tombstones: lockedTombstones,
      now
    })
    if (decision.action === 'reject') {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'rejected_by_validator',
          candidateId: candidate.id,
          reason: decision.reason,
          tombstone: decision.tombstone
        }
      }
    }

    const validatedCandidate = decision.action === 'pending' ? decision.candidate : editedCandidate
    const nextPending = lockedPending.map((memoryCandidate) =>
      memoryCandidate.id === candidate.id ? validatedCandidate : memoryCandidate
    )
    await writePendingMemoriesFromRoot(lockedMemoryRoot, nextPending)
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'pending',
      at: now,
      reason: input.reason ?? 'Edited by Codex pending memory review',
      candidateId: validatedCandidate.id,
      details: { reviewAction: 'edit' }
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })

    return {
      project,
      memoryRoot: lockedMemoryRoot,
      result: {
        action: 'edit',
        candidateId: validatedCandidate.id,
        candidate: validatedCandidate,
        reviewHash: reviewHashForPendingMemory(validatedCandidate)
      }
    }
  })
}

export async function deferCodexPendingMemory(input: {
  cwd: string
  id: string
  reviewHash: string
  days?: number
  reason?: string
  now?: string
}): Promise<CodexPendingMemoryDeferResult> {
  const now = input.now ?? new Date().toISOString()
  const days = input.days ?? 7
  const { project, memoryRoot, candidate } = await findPendingCandidateInCodexRoots(input.cwd, input.id)
  if (candidate === undefined) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'not_found',
        candidateId: input.id,
        reason: 'Pending memory candidate not found'
      }
    }
  }

  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const lockedPending = await readPendingMemoriesFromRoot(lockedMemoryRoot)
    const lockedCandidate = lockedPending.find((memoryCandidate) => memoryCandidate.id === candidate.id)
    if (lockedCandidate === undefined) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'not_found',
          candidateId: candidate.id,
          reason: 'Pending memory candidate not found'
        }
      }
    }

    const latestReviewHash = reviewHashForPendingMemory(lockedCandidate)
    if (latestReviewHash !== input.reviewHash) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'conflict',
          candidateId: candidate.id,
          reason: 'Pending memory candidate changed since review',
          latest: summarizePendingMemory(lockedCandidate)
        }
      }
    }

    const deferredCandidate: PendingMemory = {
      ...lockedCandidate,
      promoteAfter: addDays(now, days)
    }
    const nextPending = lockedPending.map((memoryCandidate) =>
      memoryCandidate.id === candidate.id ? deferredCandidate : memoryCandidate
    )
    await writePendingMemoriesFromRoot(lockedMemoryRoot, nextPending)
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'pending',
      at: now,
      reason: input.reason ?? 'Deferred by Codex pending memory review',
      candidateId: deferredCandidate.id,
      details: { reviewAction: 'defer', days }
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })

    return {
      project,
      memoryRoot: lockedMemoryRoot,
      result: {
        action: 'defer',
        candidateId: deferredCandidate.id,
        candidate: deferredCandidate,
        reviewHash: reviewHashForPendingMemory(deferredCandidate)
      }
    }
  })
}

export async function getCodexPendingReviewNotice(input: { cwd: string }): Promise<CodexPendingReviewNotice> {
  const { readableRoots } = await getProjectAndReadableMemoryRoots(input.cwd)
  const pending = sortPendingNewestFirst((await Promise.all(readableRoots.map((root) => readPendingMemoriesFromRoot(root)))).flat())
  const newest = pending[0]
  return {
    count: pending.length,
    hasItems: pending.length > 0,
    ...(newest === undefined
      ? {}
      : {
          newestCandidateId: newest.id,
          newestPreview: previewContent(newest.content)
        })
  }
}

function upsertActiveMemory(active: CyreneMemory[], memory: CyreneMemory): CyreneMemory[] {
  const index = active.findIndex((candidate) => candidate.id === memory.id || candidate.normalizedKey === memory.normalizedKey)
  if (index < 0) {
    return [...active, memory]
  }

  const next = [...active]
  next[index] = memory
  return next
}

function tombstoneForRejectedCandidate(candidate: PendingMemory, now: string): MemoryTombstone {
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

async function getProjectAndMemoryRoot(cwd: string): Promise<{
  project: CodexPendingMemoryProject
  memoryRoot: string
}> {
  const identity = await identifyCodexProject(cwd)
  const memoryRoot =
    (await getReadableCodexProjectMemoryRoot(identity.projectId)) ?? codexProjectMemoryRoot(identity.projectId)
  return {
    project: { projectId: identity.projectId, displayName: identity.displayName },
    memoryRoot
  }
}

async function getProjectAndReadableMemoryRoots(cwd: string): Promise<{
  project: CodexPendingMemoryProject
  memoryRoot: string
  readableRoots: string[]
}> {
  const { project, memoryRoot } = await getProjectAndMemoryRoot(cwd)
  const globalRoot = (await getReadableCodexGlobalMemoryRoot()) ?? codexGlobalMemoryRoot()
  return {
    project,
    memoryRoot,
    readableRoots: uniqueInOrder([globalRoot, memoryRoot])
  }
}

async function findPendingCandidateInCodexRoots(cwd: string, id: string): Promise<{
  project: CodexPendingMemoryProject
  memoryRoot: string
  pending: PendingMemory[]
  candidate?: PendingMemory
}> {
  const { project, memoryRoot, readableRoots } = await getProjectAndReadableMemoryRoots(cwd)
  for (const root of readableRoots) {
    const pending = await readPendingMemoriesFromRoot(root)
    const candidate = pending.find((memory) => memory.id === id)
    if (candidate !== undefined) {
      return { project, memoryRoot: root, pending, candidate }
    }
  }

  return { project, memoryRoot, pending: [], candidate: undefined }
}

function sortPendingNewestFirst(pending: PendingMemory[]): PendingMemory[] {
  return [...pending].sort((left, right) => {
    const lastSeen = right.lastSeenAt.localeCompare(left.lastSeenAt)
    return lastSeen === 0 ? left.id.localeCompare(right.id) : lastSeen
  })
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    if (seen.has(value)) {
      return false
    }
    seen.add(value)
    return true
  })
}

function previewContent(content: string): string {
  return content.length <= 160 ? content : `${content.slice(0, 157)}...`
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}
