import { appendFile, lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureMemoryRoot, getReadableMemoryRoot } from './paths.js'
import type { CyreneMemory, MemoryEvent, MemoryScores, MemoryTombstone, PendingMemory } from './types.js'

const INDEX_FILE = 'index.jsonl'
const PENDING_FILE = 'pending.jsonl'
const EVENTS_FILE = 'events.jsonl'
const TOMBSTONES_FILE = 'tombstones.jsonl'
const MAX_PENDING_EVIDENCE = 10

export async function readActiveMemories(cwd: string): Promise<CyreneMemory[]> {
  const root = await getReadableMemoryRoot(cwd)
  if (root === null) {
    return []
  }
  return readActiveMemoriesFromRoot(root)
}

export async function writeActiveMemories(cwd: string, memories: CyreneMemory[]): Promise<void> {
  const root = await ensureMemoryRoot(cwd)
  await writeActiveMemoriesFromRoot(root, memories)
}

export async function readPendingMemories(cwd: string): Promise<PendingMemory[]> {
  const root = await getReadableMemoryRoot(cwd)
  if (root === null) {
    return []
  }
  return readPendingMemoriesFromRoot(root)
}

export async function readActiveMemoriesFromRoot(memoryRoot: string): Promise<CyreneMemory[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return (await readJsonLines<CyreneMemory>(join(memoryRoot, INDEX_FILE))).filter((memory) => memory.status === 'active')
}

export async function writeActiveMemoriesFromRoot(memoryRoot: string, memories: CyreneMemory[]): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await writeJsonLinesAtomic(join(root, INDEX_FILE), memories.filter((memory) => memory.status === 'active'))
}

export async function ensureWritableMemoryRootPath(memoryRoot: string): Promise<string> {
  return ensureWritableMemoryRoot(memoryRoot)
}

export async function readPendingMemoriesFromRoot(memoryRoot: string): Promise<PendingMemory[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return (await readJsonLines<PendingMemory>(join(memoryRoot, PENDING_FILE))).filter((memory) => memory.status === 'pending')
}

export async function writePendingMemories(cwd: string, memories: PendingMemory[]): Promise<void> {
  const root = await ensureMemoryRoot(cwd)
  await writePendingMemoriesFromRoot(root, memories)
}

export async function upsertPendingMemory(cwd: string, candidate: PendingMemory): Promise<PendingMemory> {
  const root = await ensureMemoryRoot(cwd)
  return upsertPendingMemoryFromRoot(root, candidate)
}

export async function writePendingMemoriesFromRoot(memoryRoot: string, memories: PendingMemory[]): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await writeJsonLinesAtomic(join(root, PENDING_FILE), memories.filter((memory) => memory.status === 'pending'))
}

export async function upsertPendingMemoryFromRoot(memoryRoot: string, candidate: PendingMemory): Promise<PendingMemory> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  const pending = await readPendingMemoriesFromRoot(root)
  const existingIndex = pending.findIndex((memory) => memory.normalizedKey === candidate.normalizedKey)
  let result = candidate

  if (existingIndex >= 0) {
    const existing = pending[existingIndex]
    result = mergePendingMemory(existing, candidate)
    pending[existingIndex] = result
  } else {
    pending.push(candidate)
  }

  await writeJsonLinesAtomic(join(root, PENDING_FILE), pending)
  return result
}

export async function appendMemoryEvent(cwd: string, event: MemoryEvent): Promise<void> {
  const root = await ensureMemoryRoot(cwd)
  await appendMemoryEventFromRoot(root, event)
}

export async function appendMemoryEventFromRoot(memoryRoot: string, event: MemoryEvent): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, EVENTS_FILE), event)
}

export async function readMemoryEvents(cwd: string, limit?: number): Promise<MemoryEvent[]> {
  const root = await getReadableMemoryRoot(cwd)
  if (root === null) {
    return []
  }
  const events = await readJsonLines<MemoryEvent>(join(root, EVENTS_FILE))
  return limit === undefined ? events : events.slice(Math.max(0, events.length - limit))
}

export async function readTombstones(cwd: string): Promise<MemoryTombstone[]> {
  const root = await getReadableMemoryRoot(cwd)
  if (root === null) {
    return []
  }
  return readTombstonesFromRoot(root)
}

export async function readTombstonesFromRoot(memoryRoot: string): Promise<MemoryTombstone[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<MemoryTombstone>(join(memoryRoot, TOMBSTONES_FILE))
}

export async function writeTombstones(cwd: string, tombstones: MemoryTombstone[]): Promise<void> {
  const root = await ensureMemoryRoot(cwd)
  await writeJsonLinesAtomic(join(root, TOMBSTONES_FILE), tombstones)
}

export async function appendTombstone(cwd: string, tombstone: MemoryTombstone): Promise<void> {
  const root = await ensureMemoryRoot(cwd)
  await appendTombstoneFromRoot(root, tombstone)
}

export async function appendTombstoneFromRoot(memoryRoot: string, tombstone: MemoryTombstone): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, TOMBSTONES_FILE), tombstone)
}

function mergePendingMemory(existing: PendingMemory, candidate: PendingMemory): PendingMemory {
  const seenCount = existing.seenCount + candidate.seenCount
  return {
    ...existing,
    content: existing.content,
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

function averageScores(
  left: MemoryScores,
  leftWeight: number,
  right: MemoryScores,
  rightWeight: number
): MemoryScores {
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

async function isReadableMemoryRoot(memoryRoot: string): Promise<boolean> {
  try {
    const stats = await lstat(memoryRoot)
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to use memory symlink: ${memoryRoot}`)
    }
    if (!stats.isDirectory()) {
      throw new Error(`Refusing to use non-directory memory path: ${memoryRoot}`)
    }
    return true
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return false
    }
    throw error
  }
}

async function ensureWritableMemoryRoot(memoryRoot: string): Promise<string> {
  try {
    return await getSafeMemoryRoot(memoryRoot)
  } catch (error) {
    if (!isFileErrorCode(error, 'ENOENT')) {
      throw error
    }
  }

  await mkdir(memoryRoot, { recursive: true })
  return getSafeMemoryRoot(memoryRoot)
}

async function getSafeMemoryRoot(memoryRoot: string): Promise<string> {
  const stats = await lstat(memoryRoot)
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to use memory symlink: ${memoryRoot}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`Refusing to use non-directory memory path: ${memoryRoot}`)
  }
  return realpath(memoryRoot)
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  let content: string
  try {
    content = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return []
    }
    throw error
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

async function writeJsonLinesAtomic(filePath: string, values: unknown[]): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const content = values.map((value) => JSON.stringify(value)).join('\n')
  await writeFile(tempPath, content === '' ? '' : `${content}\n`, 'utf8')
  await rename(tempPath, filePath)
}

async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8')
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
