import { randomUUID } from 'node:crypto'
import { createDefaultConfig } from '../config.js'
import { evaluateActiveMemoryReadiness } from './active-memory-readiness.js'
import { syncCurrentCodexMemoryIndex } from './codex-memory-index.js'
import { codexProjectMemoryRoot, ensureCodexGlobalMemoryRoot, ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import { markCodexMemoryDreamDue } from './memory-dream-state.js'
import { enforcePendingBudget } from './memory-pending-budget.js'
import { summarizePendingMemory } from './memory-review.js'
import { evaluateAutoPromotionPolicy } from './memory-triage.js'
import { identifyCodexProject } from './project-id.js'
import { isCodexProjectMemoryDisabled } from './project-registry.js'
import { shapePendingCandidateContent } from './semantic-content-builder.js'
import { activationPolicyForConfidenceTier } from '../memory/memory-lifecycle.js'
import { pendingMemoryToSemanticMemory } from '../memory/semantic-memory-adapter.js'
import {
  combineEvalGateResults,
  runV5AutoPromotionEvalGate,
  runV5GlobalAutoPromotionEvalGate,
  type EvalGateResult
} from '../eval/eval-runner.js'
import {
  assertMemoryMaintenanceTargetsSafeFromRoot,
  withMemoryMaintenanceLockFromRoot
} from '../memory/memory-maintenance.js'
import {
  appendMemoryEventFromRoot,
  appendTombstoneFromRoot,
  mergePendingMemory,
  readActiveMemoriesFromRoot,
  readMemoryEventsFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot,
  upsertSemanticMemoriesFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot
} from '../memory/memory-store.js'
import { activateCandidate, validateMemoryCandidate } from '../memory/memory-validator.js'
import { deriveMemoryCandidateKind } from '../memory/candidate-kind.js'
import { normalizeMemoryKey } from '../memory/tokenizer.js'
import type {
  AdmissionAction,
  CandidateTaskState,
  MemoryCandidateKind,
  MemoryDomain,
  MemoryEvidence,
  MemoryEvent,
  MemoryScope,
  MemoryScores,
  MemorySource,
  MemoryStrength,
  MemoryType,
  PendingMemory,
  SemanticMemory
} from '../memory/types.js'
import type { CodexPendingMemorySummary } from './memory-review.js'

export interface CodexMemoryCandidateInput {
  domain: MemoryDomain
  type: MemoryType
  strength?: MemoryStrength
  scope?: MemoryScope
  content: string
  normalizedKey?: string
  sourceOfTruth?: string
  taskState?: CandidateTaskState
  candidateKind?: MemoryCandidateKind
  candidate_kind?: MemoryCandidateKind
  source?: MemorySource
  evidence: MemoryEvidence[]
  scores?: Partial<MemoryScores>
  tags?: string[]
  userConfirmed?: boolean
  admittedBy?: 'admission_gate_v1'
  admissionAction?: AdmissionAction
  admissionScore?: number
  admissionReasons?: string[]
  sourceEpisodeIds?: string[]
  sourceDraftIds?: string[]
}

export function normalizedKeyForCodexMemoryCandidate(
  input: Pick<CodexMemoryCandidateInput, 'content' | 'domain' | 'normalizedKey' | 'type'>
): string {
  return input.normalizedKey ?? normalizeMemoryKey(`${input.domain}:${input.type}:${input.content}`)
}

export interface CodexMemoryProposeResult {
  project: {
    projectId: string
    displayName: string
  }
  result:
    | {
        action: 'pending'
        candidateId: string
        reason: string
        review: CodexPendingMemorySummary
      }
    | {
        action: 'reject'
        reason: string
      }
    | {
        action: 'auto_promote'
        candidateId: string
        memoryId: string
        policyId: string
        reason: string
      }
    | {
        action: 'trial'
        candidateId: string
        memoryId: string
        policyId: 'v15_project_trial_admission_v1'
        reason: string
      }
  memoryRoot: string
}

const DEFAULT_SCORES: MemoryScores = {
  evidenceStrength: 0.75,
  stability: 0.65,
  usefulness: 0.7,
  safety: 0.9,
  sensitivity: 0.2
}

export async function proposeCodexMemoryCandidate(input: {
  cwd: string
  candidate: CodexMemoryCandidateInput
  now?: string
  recordRejectedCandidate?: boolean
  allowAutoPromote?: boolean
}): Promise<CodexMemoryProposeResult> {
  const now = input.now ?? new Date().toISOString()
  const project = await identifyCodexProject(input.cwd)
  const candidate = toPendingMemory(input.candidate, now)
  if (candidate.scope !== 'global' && await isCodexProjectMemoryDisabled(project.projectId)) {
    return {
      project: { projectId: project.projectId, displayName: project.displayName },
      result: { action: 'reject', reason: 'Project memory is disabled for this project.' },
      memoryRoot: codexProjectMemoryRoot(project.projectId)
    }
  }
  const memoryRoot = candidate.scope === 'global'
    ? await ensureCodexGlobalMemoryRoot()
    : await ensureCodexProjectMemoryRoot(project.projectId)
  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const [existingMemories, tombstones, lockedPending, events] = await Promise.all([
      readActiveMemoriesFromRoot(lockedMemoryRoot),
      readTombstonesFromRoot(lockedMemoryRoot),
      readPendingMemoriesFromRoot(lockedMemoryRoot),
      readMemoryEventsFromRoot(lockedMemoryRoot)
    ])
    const decision = validateMemoryCandidate({
      candidate,
      existingMemories,
      tombstones,
      now
    })

    if (decision.action === 'reject') {
      if (input.recordRejectedCandidate !== false) {
        await appendTombstoneFromRoot(lockedMemoryRoot, decision.tombstone)
        await appendMemoryEventFromRoot(lockedMemoryRoot, {
          id: randomUUID(),
          action: 'reject',
          at: now,
          reason: decision.reason,
          candidateId: decision.tombstone.id
        })
      }
      return {
        project: { projectId: project.projectId, displayName: project.displayName },
        result: { action: 'reject', reason: decision.reason },
        memoryRoot: lockedMemoryRoot
      }
    }

    const pendingCandidate = decision.action === 'pending' ? decision.candidate : candidate
    const activeConflict = existingMemories.find((memory) => memory.normalizedKey === pendingCandidate.normalizedKey)
    if (activeConflict !== undefined) {
      const reason = 'normalizedKey conflict with active memory'
      if (input.recordRejectedCandidate !== false) {
        await appendMemoryEventFromRoot(lockedMemoryRoot, {
          id: randomUUID(),
          action: 'reject',
          at: now,
          reason,
          memoryId: activeConflict.id,
          candidateId: pendingCandidate.id
        })
      }
      return {
        project: { projectId: project.projectId, displayName: project.displayName },
        result: { action: 'reject', reason },
        memoryRoot: lockedMemoryRoot
      }
    }
    const existingPending = lockedPending.find((item) => item.normalizedKey === pendingCandidate.normalizedKey)
    const mergedCandidateBase = existingPending === undefined
      ? pendingCandidate
      : mergePendingMemory(existingPending, pendingCandidate)
    const mergedCandidate = withMergedSourceBoundary(mergedCandidateBase, pendingCandidate)
    const pendingWithoutMerged = lockedPending.filter((item) => item.normalizedKey !== mergedCandidate.normalizedKey)
    const config = createDefaultConfig(input.cwd)
    const promotionScope = mergedCandidate.scope === 'global' ? 'global' : 'project'
    const promotionsUsedToday = countAutoPromotionsForDay(events, now)
    const dailyCap = promotionScope === 'global'
      ? config.memoryAutoReviewGlobalPromotePerDay
      : config.memoryAutoReviewProjectPromotePerDay
    const activeReadiness = evaluateActiveMemoryReadiness({
      content: mergedCandidate.content,
      candidateKind: deriveMemoryCandidateKind(mergedCandidate),
      domain: mergedCandidate.domain,
      type: mergedCandidate.type,
      tags: mergedCandidate.tags
    })
    const autoPromotion = evaluateAutoPromotionPolicy({
      candidate: mergedCandidate,
      scope: promotionScope,
      active: existingMemories,
      tombstones,
      promotionsUsedToday,
      projectDailyCap: config.memoryAutoReviewProjectPromotePerDay,
      globalDailyCap: config.memoryAutoReviewGlobalPromotePerDay,
      now
    })
    const autoPromotionEval = autoPromotion.allowed
      ? runAutoPromotionEvalGate({
          candidate: mergedCandidate,
          policyId: autoPromotion.policyId,
          scope: promotionScope,
          distinctEvidenceCount: autoPromotion.distinctEvidenceCount,
          usedToday: promotionsUsedToday,
          dailyCap
        })
      : undefined

    const trialEligibility = evaluateProjectTrialEligibility({
      candidate: mergedCandidate,
      activeReadinessReady: activeReadiness.ready
    })

    if (
      input.allowAutoPromote !== false &&
      trialEligibility.allowed
    ) {
      const trial = trialSemanticMemoryFromCandidate(mergedCandidate, now)
      await upsertSemanticMemoriesFromRoot(lockedMemoryRoot, [trial])
      await appendMemoryEventFromRoot(lockedMemoryRoot, {
        id: randomUUID(),
        action: 'create',
        at: now,
        reason: 'v1.5 admitted low-risk project memory to trial',
        memoryId: trial.id,
        candidateId: mergedCandidate.id,
        details: {
          decision: 'admit_to_trial',
          policyId: 'v15_project_trial_admission_v1',
          confidenceTier: 'trial',
          activationPolicy: trial.activationPolicy,
          scoreSnapshot: mergedCandidate.scores,
          evidenceCount: mergedCandidate.evidence.length
        }
      })
      await syncCurrentCodexMemoryIndex({ cwd: input.cwd })
      return {
        project: { projectId: project.projectId, displayName: project.displayName },
        result: {
          action: 'trial',
          candidateId: mergedCandidate.id,
          memoryId: trial.id,
          policyId: 'v15_project_trial_admission_v1',
          reason: 'v1.5 admitted low-risk project memory to trial'
        },
        memoryRoot: lockedMemoryRoot
      }
    }

    if (
      autoPromotion.allowed &&
      autoPromotionEval?.passed === true &&
      activeReadiness.ready &&
      input.allowAutoPromote !== false
    ) {
      const promoted = activateCandidate({ ...mergedCandidate, userConfirmed: true }, now)
      await writeActiveMemoriesFromRoot(lockedMemoryRoot, [...existingMemories, promoted])
      await writePendingMemoriesFromRoot(lockedMemoryRoot, pendingWithoutMerged)
      await appendMemoryEventFromRoot(lockedMemoryRoot, {
        id: randomUUID(),
        action: 'promote',
        at: now,
        reason: autoPromotion.reason,
        memoryId: promoted.id,
        candidateId: mergedCandidate.id,
        details: {
          decision: 'auto_promote',
          policyId: autoPromotion.policyId,
          semanticMemoryId: promoted.id,
          sourceIds: sourceIdsForAutoPromotion(mergedCandidate),
          thresholds: autoPromotionThresholds(promotionScope),
          evidenceCount: mergedCandidate.evidence.length,
          distinctEvidenceCount: autoPromotion.distinctEvidenceCount,
          scoreSnapshot: mergedCandidate.scores,
          capStatus: {
            scope: promotionScope,
            usedToday: promotionsUsedToday,
            dailyCap
          },
          evalGate: autoPromotionEval
        }
      })
      await syncCurrentCodexMemoryIndex({ cwd: input.cwd })
      return {
        project: { projectId: project.projectId, displayName: project.displayName },
        result: {
          action: 'auto_promote',
          candidateId: mergedCandidate.id,
          memoryId: promoted.id,
          policyId: autoPromotion.policyId,
          reason: autoPromotion.reason
        },
        memoryRoot: lockedMemoryRoot
      }
    }

    const budgetResult = enforcePendingBudget({
      existing: pendingWithoutMerged,
      incoming: mergedCandidate,
      maxItems: mergedCandidate.scope === 'global' ? config.memoryPendingMaxItemsGlobal : config.memoryPendingMaxItemsProject,
      now
    })
    await writePendingMemoriesFromRoot(lockedMemoryRoot, budgetResult.nextPending)
    if (budgetResult.action === 'reject_incoming') {
      return {
        project: { projectId: project.projectId, displayName: project.displayName },
        result: { action: 'reject', reason: budgetResult.reason },
        memoryRoot: lockedMemoryRoot
      }
    }
    if (budgetResult.action === 'evict_existing') {
      await appendMemoryEventFromRoot(lockedMemoryRoot, {
        id: randomUUID(),
        action: 'audit',
        at: now,
        reason: budgetResult.reason,
        candidateId: budgetResult.evicted.id,
        details: { decision: 'budget_evict_pending', incomingCandidateId: pendingCandidate.id }
      })
    }
    await markDreamDueFailOpen(lockedMemoryRoot, now)
    const activeReadinessReason =
      `Active-readiness requires rewrite before auto-promotion: ${activeReadiness.reasons.join(', ')}; pending for manual review.`
    let reason = decision.reason
    if (decision.action === 'auto_write') {
      if (input.allowAutoPromote === false) {
        reason = `Auto-promotion disabled for this proposal: ${autoPromotion.reason}; pending for manual review.`
      } else if (trialEligibility.otherwiseEligible && !trialEligibility.hasSourceBoundary) {
        reason = 'Trial admission requires explicit source boundary or evidence trace; pending for manual review.'
      } else if (!activeReadiness.ready) {
        reason = activeReadinessReason
      } else if (autoPromotion.allowed && autoPromotionEval?.passed === false) {
        reason = `Auto-promotion denied by eval gate: ${autoPromotionEval.failedChecks.join(', ')}; pending for manual review.`
      } else {
        reason = `Auto-promotion denied by v5 policy: ${autoPromotion.reason}; pending for manual review.`
      }
    } else if (!activeReadiness.ready && autoPromotion.allowed && autoPromotionEval?.passed === true) {
      reason = activeReadinessReason
    }

    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'pending',
      at: now,
      reason,
      candidateId: mergedCandidate.id
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })

    return {
      project: { projectId: project.projectId, displayName: project.displayName },
      result: { action: 'pending', candidateId: mergedCandidate.id, reason, review: summarizePendingMemory(mergedCandidate) },
      memoryRoot: lockedMemoryRoot
    }
  })
}

function isProjectTrialEligible(input: {
  candidate: PendingMemory
  activeReadinessReady: boolean
}): boolean {
  return evaluateProjectTrialEligibility(input).allowed
}

function evaluateProjectTrialEligibility(input: {
  candidate: PendingMemory
  activeReadinessReady: boolean
}): { allowed: boolean; otherwiseEligible: boolean; hasSourceBoundary: boolean } {
  const candidate = input.candidate
  const kind = deriveMemoryCandidateKind(candidate)
  let otherwiseEligible = true
  if (!input.activeReadinessReady) otherwiseEligible = false
  if (candidate.scope !== 'project') otherwiseEligible = false
  if (!['project', 'procedural', 'system'].includes(candidate.domain)) otherwiseEligible = false
  if (!['project_fact', 'project_decision', 'workflow_rule', 'known_pitfall', 'rejected_approach'].includes(kind)) {
    otherwiseEligible = false
  }
  if (candidate.source === 'assistant_observed') otherwiseEligible = false
  if (candidate.evidence.some((entry) => entry.sourceKind === 'assistant_observed')) otherwiseEligible = false
  if (candidate.scores.evidenceStrength < 0.55) otherwiseEligible = false
  if (candidate.scores.usefulness < 0.55) otherwiseEligible = false
  if (candidate.scores.safety < 0.8) otherwiseEligible = false
  if (candidate.scores.sensitivity > 0.35) otherwiseEligible = false
  const hasSourceBoundary = hasTrialSourceBoundary(candidate)
  return { allowed: otherwiseEligible && hasSourceBoundary, otherwiseEligible, hasSourceBoundary }
}

function hasTrialSourceBoundary(candidate: PendingMemory): boolean {
  if (nonEmptyString(candidate.sourceOfTruth) !== undefined) return true
  return candidate.evidence.some((entry) =>
    nonEmptyString(entry.runId) !== undefined ||
    nonEmptyString(entry.sessionId) !== undefined ||
    nonEmptyString(entry.taskHash) !== undefined ||
    nonEmptyString(entry.quoteHash) !== undefined ||
    nonEmptyString(entry.evidenceGroupId) !== undefined ||
    (entry.traceRefs ?? []).some((value) => nonEmptyString(value) !== undefined) ||
    (entry.messageIds ?? []).some((value) => nonEmptyString(value) !== undefined)
  )
}

function trialSemanticMemoryFromCandidate(candidate: PendingMemory, now: string): SemanticMemory {
  const semantic = pendingMemoryToSemanticMemory(candidate)
  return {
    ...semantic,
    status: 'active',
    routing: {
      module: semantic.module,
      updatePolicy: 'strict_auto_promote',
      risk: 'low',
      reasons: ['v1.5 low-risk project memory admitted to trial']
    },
    reviewPolicy: 'strict_auto_promote',
    confidenceTier: 'trial',
    activationPolicy: activationPolicyForConfidenceTier('trial'),
    updatedAt: now
  }
}

function runAutoPromotionEvalGate(input: {
  candidate: PendingMemory
  policyId: string
  scope: 'project' | 'global'
  distinctEvidenceCount: number
  usedToday: number
  dailyCap: number
}): EvalGateResult {
  const item = {
    candidateId: input.candidate.id,
    domain: input.candidate.domain,
    scope: input.scope,
    source: input.candidate.source,
    policyId: input.policyId,
    decision: 'auto_promote',
    evidenceCount: input.candidate.evidence.length,
    distinctEvidenceCount: input.distinctEvidenceCount,
    usedToday: input.usedToday,
    dailyCap: input.dailyCap
  }
  const gates = [runV5AutoPromotionEvalGate([item])]
  if (input.scope === 'global') {
    gates.push(runV5GlobalAutoPromotionEvalGate([item]))
  }
  return combineEvalGateResults(gates)
}

function autoPromotionThresholds(scope: 'project' | 'global'): Record<string, number> {
  return scope === 'global'
    ? {
        evidenceStrength: 0.9,
        stability: 0.85,
        usefulness: 0.7,
        safety: 0.95,
        maxSensitivity: 0.1,
        minSeenCount: 2,
        minDistinctEvidence: 2
      }
    : {
        evidenceStrength: 0.85,
        stability: 0.8,
        usefulness: 0.7,
        safety: 0.9,
        maxSensitivity: 0.2,
        minSeenCount: 2,
        minDistinctEvidence: 2
      }
}

function withMergedSourceBoundary(mergedCandidate: PendingMemory, incomingCandidate: PendingMemory): PendingMemory {
  const sourceOfTruth = nonEmptyString(mergedCandidate.sourceOfTruth) ?? nonEmptyString(incomingCandidate.sourceOfTruth)
  return sourceOfTruth === undefined ? mergedCandidate : { ...mergedCandidate, sourceOfTruth }
}

function sourceIdsForAutoPromotion(candidate: PendingMemory): string[] {
  return uniqueInOrder([
    ...(candidate.sourceDraftIds ?? []),
    ...(candidate.sourceEpisodeIds ?? [])
  ])
}

function uniqueInOrder(values: string[]): string[] {
  return Array.from(new Set(values))
}

function nonEmptyString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

async function markDreamDueFailOpen(memoryRoot: string, now: string): Promise<void> {
  try {
    await markCodexMemoryDreamDue(memoryRoot, now)
  } catch {
    // Dream scheduling must never make review queue proposal handling fail.
  }
}

function countAutoPromotionsForDay(events: MemoryEvent[], now: string): number {
  const day = now.slice(0, 10)
  return events.filter((event) =>
    event.action === 'promote' &&
    event.at.slice(0, 10) === day &&
    event.details?.decision === 'auto_promote'
  ).length
}

function toPendingMemory(input: CodexMemoryCandidateInput, now: string): PendingMemory {
  const candidateKind = deriveMemoryCandidateKind({
    candidateKind: input.candidateKind,
    candidate_kind: input.candidate_kind,
    tags: input.tags ?? [],
    type: input.type
  })
  const shaped = shapePendingCandidateContent({
    content: input.content,
    candidateKind,
    scope: input.scope ?? 'project',
    domain: input.domain,
    normalizedKey: normalizedKeyForCodexMemoryCandidate(input),
    sourceOfTruth: input.sourceOfTruth,
    evidenceRefs: evidenceRefsForCandidate(input.evidence),
    tags: input.tags ?? []
  })
  return {
    id: randomUUID(),
    domain: input.domain,
    type: input.type,
    strength: input.strength ?? 'soft',
    scope: input.scope ?? 'project',
    status: 'pending',
    content: shaped.content,
    useWhen: shaped.useWhen,
    doNotUseWhen: shaped.doNotUseWhen,
    normalizedKey: normalizedKeyForCodexMemoryCandidate(input),
    ...(input.sourceOfTruth === undefined ? {} : { sourceOfTruth: input.sourceOfTruth }),
    evidence: input.evidence,
    source: input.source ?? 'assistant_observed',
    scores: { ...DEFAULT_SCORES, ...input.scores },
    seenCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    expiresAt: addDays(now, 30),
    ...(input.admittedBy === undefined ? {} : { admittedBy: input.admittedBy }),
    ...(input.admissionAction === undefined ? {} : { admissionAction: input.admissionAction }),
    ...(input.admissionScore === undefined ? {} : { admissionScore: input.admissionScore }),
    ...(input.admissionReasons === undefined ? {} : { admissionReasons: input.admissionReasons }),
    ...(input.sourceEpisodeIds === undefined ? {} : { sourceEpisodeIds: input.sourceEpisodeIds }),
    ...(input.sourceDraftIds === undefined ? {} : { sourceDraftIds: input.sourceDraftIds }),
    userConfirmed: input.userConfirmed,
    candidateKind,
    tags: input.tags ?? []
  }
}

function evidenceRefsForCandidate(evidence: MemoryEvidence[]): string[] {
  return evidence.flatMap((entry) => [
    ...(entry.traceRefs ?? []),
    ...(entry.messageIds ?? []),
    entry.runId,
    entry.sessionId,
    entry.taskHash,
    entry.quoteHash,
    entry.evidenceGroupId,
    entry.summary
  ]).flatMap((value) => value === undefined ? [] : [value])
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}
