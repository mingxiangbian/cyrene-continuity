import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { assertMemoryProjectionTargetsSafe, renderMemoryProjectionsFromRoot } from './memory-exporter.js'
import { assertMemorySnapshotTargetSafeFromRoot, createMemorySnapshotFromRoot } from './memory-snapshot.js'
import {
  appendMemoryEventFromRoot,
  appendTombstoneFromRoot,
  ensureWritableMemoryRootPath,
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot
} from './memory-store.js'
import type { CyreneMemory, MemoryEvent, MemoryEvidence, MemoryTombstone, PendingMemory } from './types.js'

const MAINTENANCE_LOCK_DIR = '.maintenance.lock'
const MAINTENANCE_LOCK_TIMEOUT_MS = 30_000
const MAINTENANCE_LOCK_POLL_MS = 10
const MAINTENANCE_LOCK_TIMEOUT_ENV = 'CYRENE_MEMORY_MAINTENANCE_LOCK_TIMEOUT_MS'

export interface MemoryMaintenanceBudget {
  activeMaxItems: number
  activeContentMaxChars: number
  indexFileMaxChars: number
  singleMemoryContentMaxChars: number
  singleMemoryEvidenceMaxChars: number
  pendingMaxItems: number
}

export interface MemoryMaintenanceResult {
  memoryRoot: string
  snapshotId: string
  expired: number
  deduped: number
  archived: number
  trimmed: number
  activeCount: number
  pendingCount: number
}

export interface MemoryMaintenanceLockOptions {
  timeoutMs?: number
  pollMs?: number
}

export async function runMemoryMaintenanceFromRoot(input: {
  memoryRoot: string
  budget: MemoryMaintenanceBudget
  now?: string
  reason?: string
}): Promise<MemoryMaintenanceResult> {
  return withMemoryMaintenanceLockFromRoot(input.memoryRoot, (memoryRoot) =>
    runMemoryMaintenanceFromRootLocked({ ...input, memoryRoot })
  )
}

export async function assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot: string): Promise<string> {
  const root = await assertMemorySnapshotTargetSafeFromRoot(memoryRoot)
  await assertMemoryProjectionTargetsSafe(root)
  return root
}

export async function runMemoryMaintenanceFromRootLocked(input: {
  memoryRoot: string
  budget: MemoryMaintenanceBudget
  now?: string
  reason?: string
}): Promise<MemoryMaintenanceResult> {
  const now = input.now ?? new Date().toISOString()
  const snapshot = await createMemorySnapshotFromRoot(
    input.memoryRoot,
    input.reason ?? 'before memory maintenance'
  )
  const [active, pending, existingTombstones] = await Promise.all([
    readActiveMemoriesFromRoot(input.memoryRoot),
    readPendingMemoriesFromRoot(input.memoryRoot),
    readTombstonesFromRoot(input.memoryRoot)
  ])
  void existingTombstones

  const events: MemoryEvent[] = []
  const tombstones: MemoryTombstone[] = []
  const liveActive: CyreneMemory[] = []

  for (const memory of active) {
    if (memory.expiresAt !== undefined && memory.expiresAt <= now) {
      tombstones.push(tombstoneForMemory(memory, 'expired', now))
      events.push(eventForMemory('expire', memory, now, 'expired'))
      continue
    }
    liveActive.push(memory)
  }

  const dedupedActive = dedupeByNormalizedKey(liveActive, input.budget, now, tombstones, events)
  let trimmed = 0
  let boundedActive = dedupedActive.map((memory) => {
    const next = trimMemory(memory, input.budget)
    if (JSON.stringify(next) !== JSON.stringify(memory)) {
      trimmed += 1
    }
    return next
  })

  const archiveResult = archiveToBudget(boundedActive, input.budget, now, tombstones, events)
  boundedActive = archiveResult.active

  const boundedPending = sortPendingNewestFirst(pending).slice(0, input.budget.pendingMaxItems)

  await writeActiveMemoriesFromRoot(input.memoryRoot, boundedActive)
  await writePendingMemoriesFromRoot(input.memoryRoot, boundedPending)
  for (const tombstone of tombstones) {
    await appendTombstoneFromRoot(input.memoryRoot, tombstone)
  }
  for (const event of events) {
    await appendMemoryEventFromRoot(input.memoryRoot, event)
  }
  await renderMemoryProjectionsFromRoot(input.memoryRoot)

  return {
    memoryRoot: input.memoryRoot,
    snapshotId: snapshot.id,
    expired: active.length - liveActive.length,
    deduped: dedupedActive.removed,
    archived: archiveResult.archived,
    trimmed,
    activeCount: boundedActive.length,
    pendingCount: boundedPending.length
  }
}

export async function withMemoryMaintenanceLockFromRoot<T>(
  memoryRoot: string,
  task: (memoryRoot: string) => Promise<T>,
  options: MemoryMaintenanceLockOptions = {}
): Promise<T> {
  const root = await ensureWritableMemoryRootPath(memoryRoot)
  const lockDir = join(root, MAINTENANCE_LOCK_DIR)
  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? memoryMaintenanceLockTimeoutMs()
  const pollMs = options.pollMs ?? MAINTENANCE_LOCK_POLL_MS
  while (true) {
    try {
      await mkdir(lockDir)
      break
    } catch (error) {
      if (!isFileErrorCode(error, 'EEXIST')) {
        throw error
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for memory maintenance lock: ${lockDir}`)
      }
      await delay(pollMs)
    }
  }

  try {
    return await task(root)
  } finally {
    await rm(lockDir, { recursive: true, force: true })
  }
}

function memoryMaintenanceLockTimeoutMs(): number {
  const raw = process.env[MAINTENANCE_LOCK_TIMEOUT_ENV]
  if (raw === undefined) return MAINTENANCE_LOCK_TIMEOUT_MS
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : MAINTENANCE_LOCK_TIMEOUT_MS
}

type DedupedMemories = CyreneMemory[] & { removed: number }

function dedupeByNormalizedKey(
  memories: CyreneMemory[],
  budget: MemoryMaintenanceBudget,
  now: string,
  tombstones: MemoryTombstone[],
  events: MemoryEvent[]
): DedupedMemories {
  const groups = new Map<string, CyreneMemory[]>()
  for (const memory of memories) {
    const group = groups.get(memory.normalizedKey)
    if (group === undefined) {
      groups.set(memory.normalizedKey, [memory])
    } else {
      group.push(memory)
    }
  }

  const deduped: CyreneMemory[] = []
  let removed = 0
  for (const group of groups.values()) {
    if (group.length === 1) {
      deduped.push(group[0] as CyreneMemory)
      continue
    }

    const winner = [...group].sort(compareDedupWinner)[0] as CyreneMemory
    const duplicates = group.filter((memory) => memory.id !== winner.id)
    removed += duplicates.length
    deduped.push(mergeDuplicateGroup(winner, duplicates, budget))
    for (const duplicate of duplicates) {
      tombstones.push(tombstoneForMemory(duplicate, 'superseded', now, winner.id))
      events.push({
        ...eventForMemory('supersede', duplicate, now, 'deduped'),
        details: { replacementMemoryId: winner.id, normalizedKey: winner.normalizedKey }
      })
    }
  }

  return Object.assign(deduped, { removed })
}

function compareDedupWinner(left: CyreneMemory, right: CyreneMemory): number {
  const evidence = right.scores.evidenceStrength - left.scores.evidenceStrength
  if (evidence !== 0) return evidence
  return right.updatedAt.localeCompare(left.updatedAt)
}

function mergeDuplicateGroup(
  winner: CyreneMemory,
  duplicates: CyreneMemory[],
  budget: MemoryMaintenanceBudget
): CyreneMemory {
  const supersedes = uniqueOptional([
    ...(winner.supersedes ?? []),
    ...duplicates.flatMap((memory) => [...(memory.supersedes ?? []), memory.id])
  ])
  const merged: CyreneMemory = {
    ...winner,
    evidence: trimEvidence(
      [...winner.evidence, ...duplicates.flatMap((memory) => memory.evidence)],
      budget.singleMemoryEvidenceMaxChars
    ),
    tags: unique([...winner.tags, ...duplicates.flatMap((memory) => memory.tags)]),
    updatedAt: latestIso([winner.updatedAt, ...duplicates.map((memory) => memory.updatedAt)])
  }
  return supersedes === undefined ? merged : { ...merged, supersedes }
}

function trimMemory(memory: CyreneMemory, budget: MemoryMaintenanceBudget): CyreneMemory {
  return {
    ...memory,
    content: truncateWithSuffix(memory.content, budget.singleMemoryContentMaxChars),
    evidence: trimEvidence(memory.evidence, budget.singleMemoryEvidenceMaxChars)
  }
}

function trimEvidence(evidence: MemoryEvidence[], maxChars: number): MemoryEvidence[] {
  let remaining = maxChars
  return evidence.map((entry) => {
    const next: MemoryEvidence = { ...entry }
    if (entry.quote !== undefined) {
      const value = truncateWithSuffix(entry.quote, remaining)
      remaining -= value.length
      if (value === '') {
        delete next.quote
      } else {
        next.quote = value
      }
    }
    if (entry.summary !== undefined) {
      const value = truncateWithSuffix(entry.summary, remaining)
      remaining -= value.length
      if (value === '') {
        delete next.summary
      } else {
        next.summary = value
      }
    }
    return next
  })
}

function archiveToBudget(
  active: CyreneMemory[],
  budget: MemoryMaintenanceBudget,
  now: string,
  tombstones: MemoryTombstone[],
  events: MemoryEvent[]
): { active: CyreneMemory[]; archived: number } {
  const next = [...active]
  let archived = 0
  while (exceedsBudget(next, budget) && next.length > 0) {
    const archiveIndex = next
      .map((memory, index) => ({ memory, index }))
      .sort(compareArchiveCandidate)[0]?.index
    if (archiveIndex === undefined) break
    const [memory] = next.splice(archiveIndex, 1)
    if (memory === undefined) break
    tombstones.push(tombstoneForMemory(memory, 'archived', now))
    events.push(eventForMemory('archive', memory, now, 'budget'))
    archived += 1
  }
  return { active: next, archived }
}

function exceedsBudget(active: CyreneMemory[], budget: MemoryMaintenanceBudget): boolean {
  return (
    active.length > budget.activeMaxItems ||
    totalContentLength(active) > budget.activeContentMaxChars ||
    estimatedIndexFileLength(active) > budget.indexFileMaxChars
  )
}

function compareArchiveCandidate(
  left: { memory: CyreneMemory; index: number },
  right: { memory: CyreneMemory; index: number }
): number {
  const protectedOrder = Number(isProtectedMemory(left.memory)) - Number(isProtectedMemory(right.memory))
  if (protectedOrder !== 0) return protectedOrder
  const score = archiveScore(left.memory) - archiveScore(right.memory)
  if (score !== 0) return score
  const updated = left.memory.updatedAt.localeCompare(right.memory.updatedAt)
  return updated === 0 ? left.index - right.index : updated
}

function archiveScore(memory: CyreneMemory): number {
  return memory.scores.usefulness + memory.scores.evidenceStrength + memory.scores.safety
}

function isProtectedMemory(memory: CyreneMemory): boolean {
  return (
    memory.strength === 'hard' &&
    memory.scope === 'global' &&
    (memory.domain === 'procedural' || memory.type === 'procedural_rule')
  )
}

function totalContentLength(active: CyreneMemory[]): number {
  return active.reduce((sum, memory) => sum + memory.content.length, 0)
}

function estimatedIndexFileLength(active: CyreneMemory[]): number {
  return active.reduce((sum, memory) => sum + JSON.stringify(memory).length + 1, 0)
}

function tombstoneForMemory(
  memory: CyreneMemory,
  reason: MemoryTombstone['reason'],
  now: string,
  replacementMemoryId?: string
): MemoryTombstone {
  return {
    id: `tombstone-${memory.id}-${reason}`,
    memoryId: memory.id,
    normalizedKey: memory.normalizedKey,
    domain: memory.domain,
    type: memory.type,
    strength: memory.strength,
    scope: memory.scope,
    reason,
    createdAt: now,
    evidence: memory.evidence,
    ...(replacementMemoryId === undefined ? {} : { replacementMemoryId })
  }
}

function eventForMemory(action: MemoryEvent['action'], memory: CyreneMemory, now: string, reason: string): MemoryEvent {
  return {
    id: randomUUID(),
    action,
    at: now,
    reason,
    memoryId: memory.id
  }
}

function sortPendingNewestFirst(pending: PendingMemory[]): PendingMemory[] {
  return [...pending].sort((left, right) => {
    const lastSeen = right.lastSeenAt.localeCompare(left.lastSeenAt)
    return lastSeen === 0 ? left.id.localeCompare(right.id) : lastSeen
  })
}

function truncateWithSuffix(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  if (maxChars <= 0) return ''
  if (maxChars <= 3) return '.'.repeat(maxChars)
  return `${value.slice(0, maxChars - 3)}...`
}

function latestIso(values: string[]): string {
  return values.reduce((latest, value) => (value > latest ? value : latest), values[0] ?? '')
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function uniqueOptional(values: string[]): string[] | undefined {
  const uniqueValues = unique(values)
  return uniqueValues.length === 0 ? undefined : uniqueValues
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
