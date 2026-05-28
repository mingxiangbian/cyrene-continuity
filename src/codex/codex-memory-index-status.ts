import { lstat, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoryIndexDiagnostics } from '../memory/memory-index.js'
import { readCodexMemoryIndexDiagnostics } from './codex-memory-index.js'

export type CodexMemoryFallbackMode = 'sqlite' | 'jsonl'
export type CodexMemoryIndexFreshness = 'fresh' | 'stale' | 'empty' | 'unavailable'

export interface CodexMemoryIndexStatus {
  available: boolean
  dbPath: string
  ftsTokenizer?: MemoryIndexDiagnostics['ftsTokenizer']
  reason?: string
  fallbackMode: CodexMemoryFallbackMode
  freshness: CodexMemoryIndexFreshness
  lastSyncAt?: string
  sourceLatestAt?: string
  staleReason?: string
}

const INDEXED_SOURCE_FILES = ['index.jsonl', 'pending.jsonl']

export async function readCodexMemoryIndexStatus(memoryRoots: string[]): Promise<CodexMemoryIndexStatus> {
  const diagnostics = await readStatusIndexDiagnostics()
  return readIndexStatus(diagnostics, memoryRoots)
}

async function readStatusIndexDiagnostics(): Promise<MemoryIndexDiagnostics> {
  const diagnostics = await readCodexMemoryIndexDiagnostics()
  const dbPathProblem = await readDbPathProblem(diagnostics.dbPath)
  if (dbPathProblem === undefined) {
    return diagnostics
  }
  return {
    ...diagnostics,
    available: false,
    reason: dbPathProblem
  }
}

async function readIndexStatus(
  diagnostics: MemoryIndexDiagnostics,
  memoryRoots: string[]
): Promise<CodexMemoryIndexStatus> {
  const dbPath = diagnostics.dbPath
  const fallbackMode: CodexMemoryFallbackMode = diagnostics.available ? 'sqlite' : 'jsonl'
  const dbMtime = await readMtime(dbPath)
  const sourceMtime = await readLatestIndexedSourceMtime(memoryRoots)
  const base = {
    available: diagnostics.available,
    dbPath,
    ftsTokenizer: diagnostics.ftsTokenizer,
    reason: diagnostics.reason,
    fallbackMode,
    lastSyncAt: dbMtime?.toISOString(),
    sourceLatestAt: sourceMtime?.mtime.toISOString()
  }

  if (!diagnostics.available) {
    return { ...base, freshness: 'unavailable' }
  }
  if (sourceMtime === undefined) {
    return { ...base, freshness: 'empty' }
  }
  if (dbMtime === undefined) {
    return {
      ...base,
      freshness: 'stale',
      staleReason: `memory db is missing while indexed source exists: ${sourceMtime.path}`
    }
  }
  if (sourceMtime.mtime.getTime() > dbMtime.getTime() + 1000) {
    return {
      ...base,
      freshness: 'stale',
      staleReason: `indexed source is newer than memory db: ${sourceMtime.path}`
    }
  }
  return { ...base, freshness: 'fresh' }
}

async function readDbPathProblem(dbPath: string): Promise<string | undefined> {
  try {
    const stats = await lstat(dbPath)
    if (stats.isDirectory()) {
      return `memory db path is a directory: ${dbPath}`
    }
    if (!stats.isFile()) {
      return `memory db path is not a file: ${dbPath}`
    }
    return undefined
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return undefined
    }
    return errorMessage(error)
  }
}

async function readLatestIndexedSourceMtime(memoryRoots: string[]): Promise<{ path: string; mtime: Date } | undefined> {
  let latest: { path: string; mtime: Date } | undefined
  for (const root of memoryRoots) {
    for (const file of INDEXED_SOURCE_FILES) {
      const filePath = join(root, file)
      const mtime = await readMtime(filePath)
      if (mtime === undefined) {
        continue
      }
      if (latest === undefined || mtime > latest.mtime) {
        latest = { path: filePath, mtime }
      }
    }
  }
  return latest
}

async function readMtime(path: string): Promise<Date | undefined> {
  try {
    return (await stat(path)).mtime
  } catch (error) {
    if (isErrorCode(error, 'ENOENT') || isErrorCode(error, 'ENOTDIR')) {
      return undefined
    }
    throw error
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
