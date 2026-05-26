import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { renderMemoryProjections } from './memory-exporter.js'
import {
  appendMemoryEvent,
  appendMemoryEventFromRoot,
  ensureWritableMemoryRootPath,
  readActiveMemories,
  readActiveMemoriesFromRoot,
  readPendingMemories,
  readPendingMemoriesFromRoot,
  readTombstones,
  readTombstonesFromRoot,
  writeActiveMemories,
  writePendingMemories,
  writeTombstones
} from './memory-store.js'
import { ensureMemoryRoot, getReadableMemoryRoot } from './paths.js'
import type { CyreneMemory, MemoryTombstone, PendingMemory } from './types.js'

interface MemorySnapshotFile {
  version: 1
  id: string
  createdAt: string
  reason: string
  active: CyreneMemory[]
  pending: PendingMemory[]
  tombstones: MemoryTombstone[]
}

export interface MemorySnapshotSummary {
  id: string
  createdAt: string
  reason: string
  activeCount: number
  pendingCount: number
  tombstoneCount: number
}

export interface RestoreMemorySnapshotInput {
  cwd: string
  snapshotId: string
  dryRun?: boolean
}

export interface RestoreMemorySnapshotResult extends MemorySnapshotSummary {
  restored: boolean
  backupSnapshotId?: string
}

export async function createMemorySnapshot(cwd: string, reason: string): Promise<MemorySnapshotSummary> {
  const root = await ensureMemoryRoot(cwd)
  const dir = await ensureSnapshotDir(root)
  const createdAt = new Date().toISOString()
  const id = `memory-${createdAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const snapshot: MemorySnapshotFile = {
    version: 1,
    id,
    createdAt,
    reason,
    active: await readActiveMemories(cwd),
    pending: await readPendingMemories(cwd),
    tombstones: await readTombstones(cwd)
  }

  await writeFile(snapshotFilePath(dir, id), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' })
  await appendMemoryEvent(cwd, {
    id: randomUUID(),
    action: 'snapshot',
    at: createdAt,
    reason,
    snapshotId: id,
    details: { ...summarizeSnapshot(snapshot) }
  })

  return summarizeSnapshot(snapshot)
}

export async function createMemorySnapshotFromRoot(memoryRoot: string, reason: string): Promise<MemorySnapshotSummary> {
  const root = await ensureWritableMemoryRootPath(memoryRoot)
  const dir = await ensureSnapshotDir(root)
  const createdAt = new Date().toISOString()
  const id = `memory-${createdAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const snapshot: MemorySnapshotFile = {
    version: 1,
    id,
    createdAt,
    reason,
    active: await readActiveMemoriesFromRoot(root),
    pending: await readPendingMemoriesFromRoot(root),
    tombstones: await readTombstonesFromRoot(root)
  }

  await writeFile(snapshotFilePath(dir, id), `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' })
  await appendMemoryEventFromRoot(root, {
    id: randomUUID(),
    action: 'snapshot',
    at: createdAt,
    reason,
    snapshotId: id,
    details: { ...summarizeSnapshot(snapshot) }
  })

  return summarizeSnapshot(snapshot)
}

export async function assertMemorySnapshotTargetSafeFromRoot(memoryRoot: string): Promise<string> {
  const root = await ensureWritableMemoryRootPath(memoryRoot)
  await ensureSnapshotDir(root)
  return root
}

export async function listMemorySnapshots(cwd: string): Promise<MemorySnapshotSummary[]> {
  const root = await getReadableMemoryRoot(cwd)
  if (root === null) return []
  const dir = await getSnapshotDirOrNull(root)
  if (dir === null) return []

  const entries = await readdir(dir)
  const snapshots = await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.json'))
      .map(async (entry) => summarizeSnapshot(await readSnapshotFile(join(dir, entry))))
  )
  return snapshots.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export async function restoreMemorySnapshot(input: RestoreMemorySnapshotInput): Promise<RestoreMemorySnapshotResult> {
  const root = await ensureMemoryRoot(input.cwd)
  const dir = await ensureSnapshotDir(root)
  const snapshot = await readSnapshotFile(snapshotFilePath(dir, input.snapshotId))
  const summary = summarizeSnapshot(snapshot)

  if (input.dryRun === true) {
    return { ...summary, restored: false }
  }

  const backup = await createMemorySnapshot(input.cwd, `before restoring ${input.snapshotId}`)
  await writeActiveMemories(input.cwd, snapshot.active)
  await writePendingMemories(input.cwd, snapshot.pending)
  await writeTombstones(input.cwd, snapshot.tombstones)
  await renderMemoryProjections(input.cwd)
  await appendMemoryEvent(input.cwd, {
    id: randomUUID(),
    action: 'restore',
    at: new Date().toISOString(),
    reason: `Restored memory snapshot ${input.snapshotId}`,
    snapshotId: input.snapshotId,
    details: { backupSnapshotId: backup.id, ...summary }
  })

  return { ...summary, restored: true, backupSnapshotId: backup.id }
}

async function readSnapshotFile(filePath: string): Promise<MemorySnapshotFile> {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Partial<MemorySnapshotFile>
  if (
    parsed.version !== 1 ||
    typeof parsed.id !== 'string' ||
    typeof parsed.createdAt !== 'string' ||
    typeof parsed.reason !== 'string' ||
    !Array.isArray(parsed.active) ||
    !Array.isArray(parsed.pending) ||
    !Array.isArray(parsed.tombstones)
  ) {
    throw new Error(`Invalid memory snapshot: ${filePath}`)
  }
  return parsed as MemorySnapshotFile
}

async function ensureSnapshotDir(memoryRoot: string): Promise<string> {
  const dir = join(memoryRoot, 'snapshots')
  await mkdir(dir).catch((error: unknown) => {
    if (!isFileErrorCode(error, 'EEXIST')) {
      throw error
    }
  })
  return getSnapshotDir(dir, memoryRoot)
}

async function getSnapshotDirOrNull(memoryRoot: string): Promise<string | null> {
  try {
    return await getSnapshotDir(join(memoryRoot, 'snapshots'), memoryRoot)
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) return null
    throw error
  }
}

async function getSnapshotDir(dir: string, memoryRoot: string): Promise<string> {
  const stats = await lstat(dir)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Refusing to use invalid memory snapshots path: ${dir}`)
  }
  if (!isPathInside(memoryRoot, dir)) {
    throw new Error(`Refusing to use memory snapshots path outside memory root: ${dir}`)
  }
  return dir
}

function snapshotFilePath(dir: string, id: string): string {
  if (!/^memory-[A-Za-z0-9_.-]+$/.test(id)) {
    throw new Error(`Invalid memory snapshot id: ${id}`)
  }
  return join(dir, `${id}.json`)
}

function summarizeSnapshot(snapshot: MemorySnapshotFile): MemorySnapshotSummary {
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    reason: snapshot.reason,
    activeCount: snapshot.active.length,
    pendingCount: snapshot.pending.length,
    tombstoneCount: snapshot.tombstones.length
  }
}

function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
