import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDefaultConfig } from '../config.js'
import {
  assertMemoryMaintenanceTargetsSafeFromRoot,
  type MemoryMaintenanceBudget,
  type MemoryMaintenanceResult,
  runMemoryMaintenanceFromRootLocked,
  withMemoryMaintenanceLockFromRoot
} from '../memory/memory-maintenance.js'
import { readModelProfileFromRootIfExists } from '../memory/model-profile.js'
import {
  appendMemoryEventFromRoot,
  appendTombstoneFromRoot,
  ensureWritableMemoryRootPath,
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot
} from '../memory/memory-store.js'
import {
  activateCandidate,
  distinctEvidenceCount,
  evaluatePendingPromotion,
  validateMemoryCandidate
} from '../memory/memory-validator.js'
import type { CyreneMemory, MemoryEvent, MemoryScores, MemoryTombstone, PendingMemory } from '../memory/types.js'
import {
  ensureCodexProjectMemoryRoot,
  getReadableCodexGlobalMemoryRoot,
  getReadableCodexProjectMemoryRoot
} from './codex-memory-root.js'
import {
  nextDreamDueAt,
  readCodexMemoryDreamState,
  writeCodexMemoryDreamState
} from './memory-dream-state.js'
import { identifyCodexProject } from './project-id.js'

export type CodexMemoryDreamStage = 'light' | 'rem' | 'deep'

export interface CodexMemoryDreamResult {
  project: { projectId: string; displayName: string }
  roots: Array<{
    memoryRoot: string
    stage: CodexMemoryDreamStage
    promoted: number
    rejected: number
    keptPending: number
    maintenance?: MemoryMaintenanceResult
    skipped?: string
  }>
}

export interface CodexMemoryProfileResult {
  project: { projectId: string; displayName: string }
  profiles: Array<{ scope: 'global' | 'project'; memoryRoot: string; content: string }>
  content: string
}

export interface CodexMemoryMaintenanceResult {
  project: { projectId: string; displayName: string }
  roots: Array<{
    memoryRoot: string
    maintenance: MemoryMaintenanceResult
  }>
}

const DREAM_LOCK_DIR = 'dream.lock'
const DREAM_LOCKS_DIR = '.locks'
const MAX_PENDING_EVIDENCE = 10

export async function runCodexMemoryDream(input: {
  cwd: string
  stage?: CodexMemoryDreamStage
  now?: string
}): Promise<CodexMemoryDreamResult> {
  const project = await identifyCodexProject(input.cwd)
  const stage = input.stage ?? 'deep'
  const now = input.now ?? new Date().toISOString()
  const config = createDefaultConfig(input.cwd)
  const roots = await dreamRoots(project.projectId)
  const results: CodexMemoryDreamResult['roots'] = []

  for (const memoryRoot of roots) {
    if (stage === 'light') {
      results.push(await runLightDreamRoot(memoryRoot, stage, now, config.memoryDreamIntervalHours))
    } else if (stage === 'rem') {
      results.push(await runRemDreamRoot(memoryRoot, stage, now, config.memoryDreamIntervalHours))
    } else {
      results.push(await runDeepDreamRoot(memoryRoot, now, config))
    }
  }

  return {
    project: { projectId: project.projectId, displayName: project.displayName },
    roots: results
  }
}

export async function runCodexMemoryMaintenance(input: {
  cwd: string
  now?: string
}): Promise<CodexMemoryMaintenanceResult> {
  const project = await identifyCodexProject(input.cwd)
  const now = input.now ?? new Date().toISOString()
  const config = createDefaultConfig(input.cwd)
  const roots = await dreamRoots(project.projectId)
  const results: CodexMemoryMaintenanceResult['roots'] = []

  for (const memoryRoot of roots) {
    await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
    const maintenance = await withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedRoot) => {
      await assertMemoryMaintenanceTargetsSafeFromRoot(lockedRoot)
      return runMemoryMaintenanceFromRootLocked({
        memoryRoot: lockedRoot,
        budget: maintenanceBudget(config),
        now,
        reason: 'codex memory maintenance'
      })
    })
    results.push({ memoryRoot: maintenance.memoryRoot, maintenance })
  }

  return {
    project: { projectId: project.projectId, displayName: project.displayName },
    roots: results
  }
}

export async function getCodexMemoryProfile(input: { cwd: string }): Promise<CodexMemoryProfileResult> {
  const project = await identifyCodexProject(input.cwd)
  const profiles: CodexMemoryProfileResult['profiles'] = []
  const globalRoot = await getReadableCodexGlobalMemoryRoot()
  if (globalRoot !== null) {
    const content = await readModelProfileFromRootIfExists(globalRoot)
    if (content !== undefined) {
      profiles.push({ scope: 'global', memoryRoot: globalRoot, content })
    }
  }

  const projectRoot = await getReadableCodexProjectMemoryRoot(project.projectId)
  if (projectRoot !== null) {
    const content = await readModelProfileFromRootIfExists(projectRoot)
    if (content !== undefined) {
      profiles.push({ scope: 'project', memoryRoot: projectRoot, content })
    }
  }

  return {
    project: { projectId: project.projectId, displayName: project.displayName },
    profiles,
    content: profiles.map((profile) => `## ${profile.scope}\n\n${profile.content}`).join('\n\n')
  }
}

async function dreamRoots(projectId: string): Promise<string[]> {
  const roots: string[] = []
  const globalRoot = await getReadableCodexGlobalMemoryRoot()
  if (globalRoot !== null) {
    roots.push(await ensureWritableMemoryRootPath(globalRoot))
  }

  const projectRoot = await ensureCodexProjectMemoryRoot(projectId)
  if (!roots.includes(projectRoot)) {
    roots.push(projectRoot)
  }
  return roots
}

async function runLightDreamRoot(
  memoryRoot: string,
  stage: CodexMemoryDreamStage,
  now: string,
  intervalHours: number
): Promise<CodexMemoryDreamResult['roots'][number]> {
  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedRoot)
    const pending = await readPendingMemoriesFromRoot(lockedRoot)
    const merged = mergePendingDuplicates(pending)
    if (merged.changed) {
      await writePendingMemoriesFromRoot(lockedRoot, merged.pending)
    }
    await appendMemoryEventFromRoot(lockedRoot, {
      id: randomUUID(),
      action: 'audit',
      at: now,
      reason: 'Codex memory dream light pass audited pending memory.',
      details: { stage, pendingCount: merged.pending.length, mergedDuplicates: pending.length - merged.pending.length }
    })
    await writeDreamSuccess(lockedRoot, now, intervalHours)
    return {
      memoryRoot: lockedRoot,
      stage,
      promoted: 0,
      rejected: 0,
      keptPending: merged.pending.length
    }
  })
}

async function runRemDreamRoot(
  memoryRoot: string,
  stage: CodexMemoryDreamStage,
  now: string,
  intervalHours: number
): Promise<CodexMemoryDreamResult['roots'][number]> {
  const pending = await readPendingMemoriesFromRoot(memoryRoot)
  for (const candidate of pending) {
    const evaluation = evaluatePendingPromotion(candidate, now)
    await appendMemoryEventFromRoot(memoryRoot, {
      id: randomUUID(),
      action: 'audit',
      at: now,
      reason: 'Codex memory dream REM pass evaluated pending memory.',
      candidateId: candidate.id,
      details: {
        stage,
        candidateId: candidate.id,
        proposedAction: evaluation.promotable ? 'promote' : proposedActionForPending(candidate, evaluation.reason),
        reason: evaluation.reason,
        distinctEvidenceCount: evaluation.distinctEvidenceCount
      }
    })
  }
  await writeDreamSuccess(memoryRoot, now, intervalHours)
  return {
    memoryRoot,
    stage,
    promoted: 0,
    rejected: 0,
    keptPending: pending.length
  }
}

async function runDeepDreamRoot(
  memoryRoot: string,
  now: string,
  config: ReturnType<typeof createDefaultConfig>
): Promise<CodexMemoryDreamResult['roots'][number]> {
  let acquiredLock: Extract<DreamLockResult, { acquired: true }> | undefined
  try {
    const lock = await tryAcquireDreamLock(memoryRoot, now, config.memoryDreamLockTtlMs)
    if (!lock.acquired) {
      return {
        memoryRoot: lock.memoryRoot,
        stage: 'deep',
        promoted: 0,
        rejected: 0,
        keptPending: (await readPendingMemoriesFromRoot(lock.memoryRoot)).length,
        skipped: lock.reason
      }
    }
    acquiredLock = lock

    const result = await withMemoryMaintenanceLockFromRoot(lock.memoryRoot, async (lockedRoot) => {
      await assertMemoryMaintenanceTargetsSafeFromRoot(lockedRoot)
      return runDeepDreamRootLocked(lockedRoot, now, maintenanceBudget(config), config.memoryDreamIntervalHours)
    })
    return result
  } catch (error) {
    await writeDreamFailedFailOpen(memoryRoot, now, error)
    throw error
  } finally {
    if (acquiredLock !== undefined) {
      await releaseDreamLock(acquiredLock)
    }
  }
}

async function runDeepDreamRootLocked(
  memoryRoot: string,
  now: string,
  budget: MemoryMaintenanceBudget,
  intervalHours: number
): Promise<CodexMemoryDreamResult['roots'][number]> {
  let active = await readActiveMemoriesFromRoot(memoryRoot)
  const tombstones = await readTombstonesFromRoot(memoryRoot)
  const pending = await readPendingMemoriesFromRoot(memoryRoot)
  const nextPending: PendingMemory[] = []
  const events: MemoryEvent[] = []
  const newTombstones: MemoryTombstone[] = []
  let promoted = 0
  let rejected = 0
  let mutated = false

  for (const candidate of pending) {
    if (candidate.expiresAt <= now) {
      newTombstones.push(tombstoneForExpiredPending(candidate, now))
      events.push({
        id: randomUUID(),
        action: 'reject',
        at: now,
        reason: 'Memory candidate expired before dream promotion',
        candidateId: candidate.id
      })
      rejected += 1
      mutated = true
      continue
    }

    const decision = validateMemoryCandidate({ candidate, existingMemories: active, tombstones, now })
    if (decision.action === 'reject') {
      newTombstones.push(decision.tombstone)
      events.push({
        id: randomUUID(),
        action: 'reject',
        at: now,
        reason: decision.reason,
        candidateId: candidate.id
      })
      rejected += 1
      mutated = true
      continue
    }

    const evaluation = evaluatePendingPromotion(candidate, now)
    if (!evaluation.promotable) {
      nextPending.push(candidate)
      continue
    }

    const memory = decision.action === 'auto_write'
      ? decision.memory
      : decision.action === 'pending'
        ? activateCandidate(decision.candidate, now)
        : undefined
    if (memory === undefined) {
      nextPending.push(candidate)
      continue
    }
    active = upsertActiveMemory(active, memory)
    events.push({
      id: randomUUID(),
      action: 'promote',
      at: now,
      reason: evaluation.reason,
      memoryId: memory.id,
      candidateId: candidate.id,
      details: { distinctEvidenceCount: evaluation.distinctEvidenceCount, source: 'dream' }
    })
    promoted += 1
    mutated = true
  }

  if (mutated) {
    await writeActiveMemoriesFromRoot(memoryRoot, active)
    await writePendingMemoriesFromRoot(memoryRoot, nextPending)
    for (const tombstone of newTombstones) {
      await appendTombstoneFromRoot(memoryRoot, tombstone)
    }
    for (const event of events) {
      await appendMemoryEventFromRoot(memoryRoot, event)
    }
  }
  const maintenance = await runMemoryMaintenanceFromRootLocked({
    memoryRoot,
    budget,
    now,
    reason: 'after codex memory dream deep pass'
  })

  await writeDreamSuccess(memoryRoot, now, intervalHours)
  return {
    memoryRoot,
    stage: 'deep',
    promoted,
    rejected,
    keptPending: maintenance.pendingCount,
    maintenance
  }
}

function mergePendingDuplicates(pending: PendingMemory[]): { changed: boolean; pending: PendingMemory[] } {
  const merged: PendingMemory[] = []
  for (const candidate of pending) {
    const index = merged.findIndex((existing) => existing.normalizedKey === candidate.normalizedKey)
    if (index === -1) {
      merged.push(candidate)
    } else {
      merged[index] = mergePendingMemory(merged[index] as PendingMemory, candidate)
    }
  }
  return { changed: merged.length !== pending.length, pending: merged }
}

function mergePendingMemory(existing: PendingMemory, candidate: PendingMemory): PendingMemory {
  const seenCount = existing.seenCount + candidate.seenCount
  return {
    ...existing,
    scores: averageScores(existing.scores, existing.seenCount, candidate.scores, candidate.seenCount),
    seenCount,
    lastSeenAt: latestIso(existing.lastSeenAt, candidate.lastSeenAt),
    expiresAt: latestIso(existing.expiresAt, candidate.expiresAt),
    promoteAfter: candidate.promoteAfter ?? existing.promoteAfter,
    evidence: [...existing.evidence, ...candidate.evidence].slice(-MAX_PENDING_EVIDENCE),
    tags: Array.from(new Set([...existing.tags, ...candidate.tags])),
    conflictsWith: uniqueOptional([...(existing.conflictsWith ?? []), ...(candidate.conflictsWith ?? [])])
  }
}

function averageScores(left: MemoryScores, leftWeight: number, right: MemoryScores, rightWeight: number): MemoryScores {
  const total = leftWeight + rightWeight
  return {
    evidenceStrength: weightedAverage(left.evidenceStrength, leftWeight, right.evidenceStrength, rightWeight, total),
    stability: weightedAverage(left.stability, leftWeight, right.stability, rightWeight, total),
    usefulness: weightedAverage(left.usefulness, leftWeight, right.usefulness, rightWeight, total),
    safety: weightedAverage(left.safety, leftWeight, right.safety, rightWeight, total),
    sensitivity: weightedAverage(left.sensitivity, leftWeight, right.sensitivity, rightWeight, total)
  }
}

function weightedAverage(left: number, leftWeight: number, right: number, rightWeight: number, total: number): number {
  return total === 0 ? right : (left * leftWeight + right * rightWeight) / total
}

function latestIso(left: string, right: string): string {
  return left >= right ? left : right
}

function uniqueOptional(values: string[]): string[] | undefined {
  const unique = Array.from(new Set(values))
  return unique.length === 0 ? undefined : unique
}

function proposedActionForPending(candidate: PendingMemory, reason: string): string {
  if (shouldRejectWithoutMoreEvidence(reason)) {
    return 'reject'
  }
  return distinctEvidenceCount(candidate) > 0 ? 'keep_pending' : 'reject'
}

function shouldRejectWithoutMoreEvidence(reason: string): boolean {
  return /diagnostic affective claim|missing auditable evidence/i.test(reason)
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

function upsertActiveMemory(active: CyreneMemory[], memory: CyreneMemory): CyreneMemory[] {
  const index = active.findIndex((entry) => entry.id === memory.id || entry.normalizedKey === memory.normalizedKey)
  if (index === -1) {
    return [...active, memory]
  }
  const next = [...active]
  next[index] = memory
  return next
}

function maintenanceBudget(config: ReturnType<typeof createDefaultConfig>): MemoryMaintenanceBudget {
  return {
    activeMaxItems: config.memoryActiveMaxItems,
    activeContentMaxChars: config.memoryActiveContentMaxChars,
    indexFileMaxChars: config.memoryIndexFileMaxChars,
    singleMemoryContentMaxChars: config.memorySingleContentMaxChars,
    singleMemoryEvidenceMaxChars: config.memorySingleEvidenceMaxChars,
    pendingMaxItems: config.memoryPendingMaxItems
  }
}

async function writeDreamSuccess(memoryRoot: string, now: string, intervalHours: number): Promise<void> {
  const current = await readCodexMemoryDreamState(memoryRoot)
  await writeCodexMemoryDreamState(memoryRoot, {
    ...current,
    dreamDue: false,
    lastDreamAt: now,
    nextDreamDueAt: nextDreamDueAt(now, intervalHours),
    lastDreamStatus: 'success',
    lastDreamError: undefined
  })
}

async function writeDreamFailed(memoryRoot: string, now: string, error: unknown): Promise<void> {
  const current = await readCodexMemoryDreamState(memoryRoot)
  await writeCodexMemoryDreamState(memoryRoot, {
    ...current,
    dreamDue: true,
    lastDreamAt: now,
    lastDreamStatus: 'failed',
    lastDreamError: error instanceof Error ? error.message : String(error)
  })
}

async function writeDreamFailedFailOpen(memoryRoot: string, now: string, error: unknown): Promise<void> {
  try {
    await writeDreamFailed(memoryRoot, now, error)
  } catch {
    // If the memory root itself is not writable, the original dream error is the actionable failure.
  }
}

interface DreamLockOwner {
  acquiredAt: string
  pid?: number
  token?: string
}

type DreamLockResult =
  | { acquired: true; memoryRoot: string; lockDir: string; token: string }
  | { acquired: false; memoryRoot: string; reason: string }

async function tryAcquireDreamLock(memoryRoot: string, now: string, ttlMs: number): Promise<DreamLockResult> {
  const root = await ensureWritableMemoryRootPath(memoryRoot)
  const locksDir = await ensureDreamLocksDir(root)
  const lockDir = join(locksDir, DREAM_LOCK_DIR)
  const token = randomUUID()
  while (true) {
    try {
      await mkdir(lockDir)
      await writeFile(join(lockDir, 'owner.json'), `${JSON.stringify({ acquiredAt: now, pid: process.pid, token })}\n`, 'utf8')
      return { acquired: true, memoryRoot: root, lockDir, token }
    } catch (error) {
      if (!isFileErrorCode(error, 'EEXIST')) {
        throw error
      }
      const owner = await readDreamLockOwner(lockDir)
      if (owner !== undefined && isDreamLockOwnerStale(owner, now, ttlMs) && await removeDreamLockIfOwner(lockDir, owner)) {
        continue
      }
      return { acquired: false, memoryRoot: root, reason: `Skipped because dream lock is active: ${lockDir}` }
    }
  }
}

async function ensureDreamLocksDir(memoryRoot: string): Promise<string> {
  const locksDir = join(memoryRoot, DREAM_LOCKS_DIR)
  await mkdir(locksDir).catch((error: unknown) => {
    if (!isFileErrorCode(error, 'EEXIST')) {
      throw error
    }
  })
  const stats = await lstat(locksDir)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Refusing to use invalid memory dream locks path: ${locksDir}`)
  }
  return locksDir
}

async function readDreamLockOwner(lockDir: string): Promise<DreamLockOwner | undefined> {
  let stats
  try {
    stats = await lstat(lockDir)
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return undefined
    }
    throw error
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Refusing to use invalid memory dream lock path: ${lockDir}`)
  }
  try {
    const parsed = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8')) as { acquiredAt?: unknown; pid?: unknown; token?: unknown }
    if (typeof parsed.acquiredAt !== 'string') {
      return undefined
    }
    return {
      acquiredAt: parsed.acquiredAt,
      ...(typeof parsed.pid === 'number' ? { pid: parsed.pid } : {}),
      ...(typeof parsed.token === 'string' ? { token: parsed.token } : {})
    }
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return undefined
    }
    throw error
  }
}

function isDreamLockOwnerStale(owner: DreamLockOwner, now: string, ttlMs: number): boolean {
  return new Date(now).getTime() - new Date(owner.acquiredAt).getTime() > ttlMs
}

async function removeDreamLockIfOwner(lockDir: string, expectedOwner: DreamLockOwner): Promise<boolean> {
  const owner = await readDreamLockOwner(lockDir)
  if (owner === undefined) {
    return false
  }
  if (!isSameDreamLockOwner(owner, expectedOwner)) {
    return false
  }
  await rm(lockDir, { recursive: true, force: true })
  return true
}

function isSameDreamLockOwner(owner: DreamLockOwner, expectedOwner: DreamLockOwner): boolean {
  if (expectedOwner.token !== undefined) {
    return owner.token === expectedOwner.token
  }
  return owner.acquiredAt === expectedOwner.acquiredAt && owner.pid === expectedOwner.pid
}

async function releaseDreamLock(lock: Extract<DreamLockResult, { acquired: true }>): Promise<void> {
  const owner = await readDreamLockOwner(lock.lockDir)
  if (owner !== undefined && owner.token === lock.token) {
    await rm(lock.lockDir, { recursive: true, force: true })
  }
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

export const testOnlyDreamLock = {
  acquire: tryAcquireDreamLock,
  release: releaseDreamLock
}
