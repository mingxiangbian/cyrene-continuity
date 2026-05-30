import { createHash, randomUUID } from 'node:crypto'
import { createDefaultConfig } from '../config.js'
import { syncCurrentCodexMemoryIndex } from './codex-memory-index.js'
import { codexProjectMemoryRoot, ensureCodexGlobalMemoryRoot, ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import { markCodexMemoryDreamDue } from './memory-dream-state.js'
import { enforcePendingBudget } from './memory-pending-budget.js'
import { summarizePendingMemory } from './memory-review.js'
import { evaluateAutoPromotionPolicy } from './memory-triage.js'
import { identifyCodexProject } from './project-id.js'
import { isCodexProjectMemoryDisabled } from './project-registry.js'
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
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot
} from '../memory/memory-store.js'
import { activateCandidate, validateMemoryCandidate } from '../memory/memory-validator.js'
import { deriveMemoryCandidateKind } from '../memory/candidate-kind.js'
import type {
  MemoryCandidateKind,
  MemoryDomain,
  MemoryEvidence,
  MemoryEvent,
  MemoryScope,
  MemoryScores,
  MemorySource,
  MemoryStrength,
  MemoryType,
  PendingMemory
} from '../memory/types.js'
import type { CodexPendingMemorySummary } from './memory-review.js'

export interface CodexMemoryCandidateInput {
  domain: MemoryDomain
  type: MemoryType
  strength?: MemoryStrength
  scope?: MemoryScope
  content: string
  normalizedKey?: string
  candidateKind?: MemoryCandidateKind
  candidate_kind?: MemoryCandidateKind
  source?: MemorySource
  evidence: MemoryEvidence[]
  scores?: Partial<MemoryScores>
  tags?: string[]
  userConfirmed?: boolean
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
    const existingPending = lockedPending.find((item) => item.normalizedKey === pendingCandidate.normalizedKey)
    const mergedCandidate = existingPending === undefined
      ? pendingCandidate
      : mergePendingMemory(existingPending, pendingCandidate)
    const pendingWithoutMerged = lockedPending.filter((item) => item.normalizedKey !== mergedCandidate.normalizedKey)
    const config = createDefaultConfig(input.cwd)
    const autoPromotion = evaluateAutoPromotionPolicy({
      candidate: mergedCandidate,
      scope: mergedCandidate.scope === 'global' ? 'global' : 'project',
      active: existingMemories,
      tombstones,
      promotionsUsedToday: countAutoPromotionsForDay(events, now),
      projectDailyCap: config.memoryAutoReviewProjectPromotePerDay,
      globalDailyCap: config.memoryAutoReviewGlobalPromotePerDay,
      now
    })

    if (autoPromotion.allowed) {
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
          distinctEvidenceCount: autoPromotion.distinctEvidenceCount,
          evalGate: { passed: true, failedChecks: [] }
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
    const reason =
      decision.action === 'auto_write'
        ? `Auto-promotion denied by v5 policy: ${autoPromotion.reason}; pending for manual review.`
        : decision.reason

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

async function markDreamDueFailOpen(memoryRoot: string, now: string): Promise<void> {
  try {
    await markCodexMemoryDreamDue(memoryRoot, now)
  } catch {
    // Dream scheduling must never make pending-only memory proposal fail.
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
  return {
    id: randomUUID(),
    domain: input.domain,
    type: input.type,
    strength: input.strength ?? 'soft',
    scope: input.scope ?? 'project',
    status: 'pending',
    content: input.content,
    normalizedKey: input.normalizedKey ?? normalizeKey(`${input.domain}:${input.type}:${input.content}`),
    evidence: input.evidence,
    source: input.source ?? 'assistant_observed',
    scores: { ...DEFAULT_SCORES, ...input.scores },
    seenCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    expiresAt: addDays(now, 30),
    userConfirmed: input.userConfirmed,
    candidateKind,
    tags: input.tags ?? []
  }
}

function normalizeKey(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug.length > 0 ? slug : createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}
