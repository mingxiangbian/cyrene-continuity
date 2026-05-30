import { createHash, randomUUID } from 'node:crypto'
import { syncCurrentCodexMemoryIndex } from './codex-memory-index.js'
import {
  codexGlobalMemoryRoot,
  codexProjectMemoryRoot,
  getReadableCodexGlobalMemoryRoot,
  getReadableCodexProjectMemoryRoot
} from './codex-memory-root.js'
import { reviewHashForPendingMemory, summarizePendingMemory, type CodexPendingMemorySummary } from './memory-review.js'
import { identifyCodexProject } from './project-id.js'
import { assertMemoryMaintenanceTargetsSafeFromRoot, withMemoryMaintenanceLockFromRoot } from '../memory/memory-maintenance.js'
import { renderMemoryProjectionsFromRoot } from '../memory/memory-exporter.js'
import {
  appendMemoryEventFromRoot,
  appendTombstoneFromRoot,
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot
} from '../memory/memory-store.js'
import { activateCandidate, validateMemoryCandidate } from '../memory/memory-validator.js'
import type { CyreneMemory, MemoryEvent, MemoryTombstone, PendingMemory } from '../memory/types.js'

export type ActiveMemoryLifecycleAction = 'archive' | 'tombstone' | 'propose_edit' | 'supersede'

interface CodexActiveMemoryProject {
  projectId: string
  displayName: string
}

interface CodexActiveMemoryResultBase {
  project: CodexActiveMemoryProject
  memoryRoot: string
}

export type CodexActiveMemoryArchiveResult = CodexActiveMemoryResultBase & {
  result:
    | {
        action: 'archive'
        memoryId: string
      }
    | ActiveMemoryNotFoundOrConflict
}

export type CodexActiveMemoryTombstoneResult = CodexActiveMemoryResultBase & {
  result:
    | {
        action: 'tombstone'
        memoryId: string
        tombstone: MemoryTombstone
      }
    | ActiveMemoryNotFoundOrConflict
}

export type CodexActiveMemoryProposeEditResult = CodexActiveMemoryResultBase & {
  result:
    | {
        action: 'propose_edit'
        memoryId: string
        candidateId: string
        candidate: PendingMemory
        reviewHash: string
      }
    | ActiveMemoryNotFoundOrConflict
}

export type CodexActiveMemorySupersedeResult = CodexActiveMemoryResultBase & {
  result:
    | {
        action: 'supersede'
        memoryId: string
        supersededMemoryId: string
      }
    | {
        action: 'not_found'
        reason: string
      }
    | {
        action: 'conflict'
        reason: string
        latest?: CodexPendingMemorySummary
      }
    | {
        action: 'rejected_by_validator'
        candidateId: string
        reason: string
        tombstone: MemoryTombstone
      }
}

type ActiveMemoryNotFoundOrConflict =
  | {
      action: 'not_found'
      reason: string
    }
  | {
      action: 'conflict'
      reason: string
    }

interface ActiveMemoryMutationContext {
  project: CodexActiveMemoryProject
  lockedMemoryRoot: string
  lockedActive: CyreneMemory[]
  memory: CyreneMemory
  now: string
}

export function contentHashForActiveMemory(memory: CyreneMemory): string {
  return createHash('sha256').update(JSON.stringify({
    id: memory.id,
    content: memory.content,
    normalizedKey: memory.normalizedKey,
    updatedAt: memory.updatedAt,
    status: memory.status
  })).digest('hex')
}

export async function archiveCodexActiveMemory(input: {
  cwd: string
  id: string
  contentHash: string
  reason: string
  now?: string
}): Promise<CodexActiveMemoryArchiveResult> {
  return mutateActiveMemory(input.cwd, input.id, input.contentHash, async ({ project, lockedMemoryRoot, lockedActive, memory, now }) => {
    await writeActiveMemoriesFromRoot(lockedMemoryRoot, lockedActive.filter((item) => item.id !== memory.id))
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'archive',
      at: now,
      reason: input.reason,
      memoryId: memory.id,
      details: {
        previousStatus: memory.status,
        normalizedKey: memory.normalizedKey
      }
    })
    await refreshModelVisibleMemory({ cwd: input.cwd, memoryRoot: lockedMemoryRoot })

    return {
      project,
      memoryRoot: lockedMemoryRoot,
      result: {
        action: 'archive',
        memoryId: memory.id
      }
    }
  }, input.now)
}

export async function tombstoneCodexActiveMemory(input: {
  cwd: string
  id: string
  contentHash: string
  reason: string
  days?: number
  indefinite?: boolean
  now?: string
}): Promise<CodexActiveMemoryTombstoneResult> {
  return mutateActiveMemory(input.cwd, input.id, input.contentHash, async ({ project, lockedMemoryRoot, lockedActive, memory, now }) => {
    const tombstone = tombstoneForActiveMemory(memory, {
      reason: 'archived',
      now,
      ...(input.indefinite === true ? {} : { expiresAt: addDays(now, input.days ?? 180) })
    })
    await writeActiveMemoriesFromRoot(lockedMemoryRoot, lockedActive.filter((item) => item.id !== memory.id))
    await appendTombstoneFromRoot(lockedMemoryRoot, tombstone)
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'archive',
      at: now,
      reason: input.reason,
      memoryId: memory.id,
      details: {
        reviewAction: 'tombstone',
        tombstoneId: tombstone.id,
        indefinite: input.indefinite === true
      }
    })
    await refreshModelVisibleMemory({ cwd: input.cwd, memoryRoot: lockedMemoryRoot })

    return {
      project,
      memoryRoot: lockedMemoryRoot,
      result: {
        action: 'tombstone',
        memoryId: memory.id,
        tombstone
      }
    }
  }, input.now)
}

export async function proposeEditCodexActiveMemory(input: {
  cwd: string
  id: string
  contentHash: string
  content: string
  reason: string
  now?: string
}): Promise<CodexActiveMemoryProposeEditResult> {
  return mutateActiveMemory(input.cwd, input.id, input.contentHash, async ({ project, lockedMemoryRoot, memory, now }) => {
    const candidate: PendingMemory = {
      id: randomUUID(),
      domain: memory.domain,
      type: memory.type,
      strength: memory.strength,
      scope: memory.scope,
      status: 'pending',
      content: input.content,
      normalizedKey: memory.normalizedKey,
      evidence: memory.evidence,
      source: memory.source,
      ...(memory.portability === undefined ? {} : { portability: memory.portability }),
      scores: memory.scores,
      seenCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      expiresAt: addDays(now, 30),
      ...(memory.userConfirmed === undefined ? {} : { userConfirmed: memory.userConfirmed }),
      ...(memory.profileVisibility === undefined ? {} : { profileVisibility: memory.profileVisibility }),
      ...(memory.candidateKind === undefined ? {} : { candidateKind: memory.candidateKind }),
      ...(memory.candidate_kind === undefined ? {} : { candidate_kind: memory.candidate_kind }),
      tags: memory.tags,
      conflictsWith: [memory.id]
    }
    const lockedPending = await readPendingMemoriesFromRoot(lockedMemoryRoot)
    await writePendingMemoriesFromRoot(lockedMemoryRoot, [...lockedPending, candidate])
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'pending',
      at: now,
      reason: input.reason,
      memoryId: memory.id,
      candidateId: candidate.id,
      details: { reviewAction: 'propose_active_edit' }
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })

    return {
      project,
      memoryRoot: lockedMemoryRoot,
      result: {
        action: 'propose_edit',
        memoryId: memory.id,
        candidateId: candidate.id,
        candidate,
        reviewHash: reviewHashForPendingMemory(candidate)
      }
    }
  }, input.now)
}

export async function supersedeCodexActiveMemory(input: {
  cwd: string
  id: string
  candidateId: string
  contentHash: string
  reviewHash: string
  reason: string
  now?: string
}): Promise<CodexActiveMemorySupersedeResult> {
  return mutateActiveMemory(input.cwd, input.id, input.contentHash, async ({ project, lockedMemoryRoot, lockedActive, memory, now }) => {
    const lockedPending = await readPendingMemoriesFromRoot(lockedMemoryRoot)
    const candidate = lockedPending.find((item) => item.id === input.candidateId)
    if (candidate === undefined) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'not_found',
          reason: 'Pending replacement candidate not found'
        }
      }
    }

    const latestReviewHash = reviewHashForPendingMemory(candidate)
    if (latestReviewHash !== input.reviewHash) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'conflict',
          reason: 'Pending replacement changed since review',
          latest: summarizePendingMemory(candidate)
        }
      }
    }

    if (!(candidate.conflictsWith ?? []).includes(memory.id)) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'conflict',
          reason: 'Pending replacement is not linked to the active memory'
        }
      }
    }

    const normalizedKeyConflict = lockedActive.find((item) => {
      return item.id !== memory.id && item.normalizedKey === candidate.normalizedKey
    })
    if (normalizedKeyConflict !== undefined) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'conflict',
          reason: 'Replacement normalizedKey conflicts with another active memory'
        }
      }
    }

    const lockedTombstones = await readTombstonesFromRoot(lockedMemoryRoot)
    const confirmedCandidate: PendingMemory = { ...candidate, userConfirmed: true }
    const decision = validateMemoryCandidate({
      candidate: confirmedCandidate,
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

    const candidateForActivation = decision.action === 'pending' ? decision.candidate : confirmedCandidate
    const promoted: CyreneMemory = {
      ...activateCandidate(candidateForActivation, now),
      supersedes: uniqueInOrder([...(candidateForActivation.conflictsWith ?? []), memory.id])
    }
    const tombstone = tombstoneForActiveMemory(memory, {
      reason: 'superseded',
      now,
      replacementMemoryId: promoted.id
    })
    await writeActiveMemoriesFromRoot(lockedMemoryRoot, [
      ...lockedActive.filter((item) => item.id !== memory.id),
      promoted
    ])
    await writePendingMemoriesFromRoot(lockedMemoryRoot, lockedPending.filter((item) => item.id !== candidate.id))
    await appendTombstoneFromRoot(lockedMemoryRoot, tombstone)
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'supersede',
      at: now,
      reason: input.reason,
      memoryId: promoted.id,
      candidateId: candidate.id,
      details: {
        supersededMemoryId: memory.id,
        tombstoneId: tombstone.id
      }
    })
    await refreshModelVisibleMemory({ cwd: input.cwd, memoryRoot: lockedMemoryRoot })

    return {
      project,
      memoryRoot: lockedMemoryRoot,
      result: {
        action: 'supersede',
        memoryId: promoted.id,
        supersededMemoryId: memory.id
      }
    }
  }, input.now)
}

async function mutateActiveMemory<T extends CodexActiveMemoryResultBase>(
  cwd: string,
  id: string,
  contentHash: string,
  fn: (input: ActiveMemoryMutationContext) => Promise<T>,
  nowInput?: string
): Promise<T | (CodexActiveMemoryResultBase & { result: ActiveMemoryNotFoundOrConflict })> {
  const now = nowInput ?? new Date().toISOString()
  const { project, memoryRoot, readableRoots } = await getProjectAndReadableActiveRoots(cwd)
  const foundMemoryRoot = await findActiveMemoryRoot(readableRoots, id)
  const targetRoot = foundMemoryRoot ?? memoryRoot

  await assertMemoryMaintenanceTargetsSafeFromRoot(targetRoot)
  return withMemoryMaintenanceLockFromRoot(targetRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const lockedActive = await readActiveMemoriesFromRoot(lockedMemoryRoot)
    const memory = lockedActive.find((item) => item.id === id)
    if (memory === undefined) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'not_found',
          reason: 'Active memory not found'
        }
      }
    }
    if (contentHashForActiveMemory(memory) !== contentHash) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'conflict',
          reason: 'Active memory changed since review'
        }
      }
    }

    return fn({ project, lockedMemoryRoot, lockedActive, memory, now })
  })
}

async function getProjectAndReadableActiveRoots(cwd: string): Promise<{
  project: CodexActiveMemoryProject
  memoryRoot: string
  readableRoots: string[]
}> {
  const identity = await identifyCodexProject(cwd)
  const projectMemoryRoot = (await getReadableCodexProjectMemoryRoot(identity.projectId)) ??
    codexProjectMemoryRoot(identity.projectId)
  const globalMemoryRoot = (await getReadableCodexGlobalMemoryRoot()) ?? codexGlobalMemoryRoot()
  return {
    project: { projectId: identity.projectId, displayName: identity.displayName },
    memoryRoot: projectMemoryRoot,
    readableRoots: uniqueInOrder([globalMemoryRoot, projectMemoryRoot])
  }
}

async function findActiveMemoryRoot(roots: string[], id: string): Promise<string | undefined> {
  for (const root of roots) {
    const active = await readActiveMemoriesFromRoot(root)
    if (active.some((memory) => memory.id === id)) {
      return root
    }
  }
  return undefined
}

async function refreshModelVisibleMemory(input: { cwd: string; memoryRoot: string }): Promise<void> {
  await renderMemoryProjectionsFromRoot(input.memoryRoot)
  await syncCurrentCodexMemoryIndex({ cwd: input.cwd })
}

function tombstoneForActiveMemory(
  memory: CyreneMemory,
  input: {
    reason: MemoryTombstone['reason']
    now: string
    expiresAt?: string
    replacementMemoryId?: string
  }
): MemoryTombstone {
  return {
    id: `tombstone-${memory.id}-${createHash('sha256').update(`${memory.updatedAt}:${input.now}:${input.reason}`).digest('hex').slice(0, 8)}`,
    memoryId: memory.id,
    normalizedKey: memory.normalizedKey,
    domain: memory.domain,
    type: memory.type,
    strength: memory.strength,
    scope: memory.scope,
    reason: input.reason,
    createdAt: input.now,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    ...(input.replacementMemoryId === undefined ? {} : { replacementMemoryId: input.replacementMemoryId }),
    evidence: memory.evidence
  }
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
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
