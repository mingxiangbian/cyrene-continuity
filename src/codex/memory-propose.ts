import { createHash, randomUUID } from 'node:crypto'
import { ensureCodexGlobalMemoryRoot, ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import { markCodexMemoryDreamDue } from './memory-dream-state.js'
import { summarizePendingMemory } from './memory-review.js'
import { identifyCodexProject } from './project-id.js'
import {
  assertMemoryMaintenanceTargetsSafeFromRoot,
  withMemoryMaintenanceLockFromRoot
} from '../memory/memory-maintenance.js'
import {
  appendMemoryEventFromRoot,
  appendTombstoneFromRoot,
  readActiveMemoriesFromRoot,
  readTombstonesFromRoot,
  upsertPendingMemoryFromRoot
} from '../memory/memory-store.js'
import { validateMemoryCandidate } from '../memory/memory-validator.js'
import type {
  MemoryDomain,
  MemoryEvidence,
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
}): Promise<CodexMemoryProposeResult> {
  const now = input.now ?? new Date().toISOString()
  const project = await identifyCodexProject(input.cwd)
  const candidate = toPendingMemory(input.candidate, now)
  const memoryRoot = candidate.scope === 'global'
    ? await ensureCodexGlobalMemoryRoot()
    : await ensureCodexProjectMemoryRoot(project.projectId)
  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const [existingMemories, tombstones] = await Promise.all([
      readActiveMemoriesFromRoot(lockedMemoryRoot),
      readTombstonesFromRoot(lockedMemoryRoot)
    ])
    const decision = validateMemoryCandidate({
      candidate,
      existingMemories,
      tombstones,
      now
    })

    if (decision.action === 'reject') {
      await appendTombstoneFromRoot(lockedMemoryRoot, decision.tombstone)
      await appendMemoryEventFromRoot(lockedMemoryRoot, {
        id: randomUUID(),
        action: 'reject',
        at: now,
        reason: decision.reason,
        candidateId: decision.tombstone.id
      })
      return {
        project: { projectId: project.projectId, displayName: project.displayName },
        result: { action: 'reject', reason: decision.reason },
        memoryRoot: lockedMemoryRoot
      }
    }

    const pendingCandidate = decision.action === 'pending' ? decision.candidate : candidate
    const merged = await upsertPendingMemoryFromRoot(lockedMemoryRoot, pendingCandidate)
    await markDreamDueFailOpen(lockedMemoryRoot, now)
    const reason =
      decision.action === 'auto_write' ? `Pending-only Codex bridge downgraded auto-write: ${decision.reason}` : decision.reason

    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'pending',
      at: now,
      reason,
      candidateId: merged.id
    })

    return {
      project: { projectId: project.projectId, displayName: project.displayName },
      result: { action: 'pending', candidateId: merged.id, reason, review: summarizePendingMemory(merged) },
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

function toPendingMemory(input: CodexMemoryCandidateInput, now: string): PendingMemory {
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
