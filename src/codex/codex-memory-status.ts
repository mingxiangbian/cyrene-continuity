import { constants } from 'node:fs'
import { access, lstat, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot
} from '../memory/memory-store.js'
import type { MemoryIndexDiagnostics } from '../memory/memory-index.js'
import {
  codexGlobalMemoryRoot,
  codexProjectMemoryRoot,
  getReadableCodexProjectMemoryRoots
} from './codex-memory-root.js'
import {
  codexMemoryDbPath,
  readCodexMemoryIndexDiagnostics
} from './codex-memory-index.js'
import { isCodexStopHookConfigured } from './codex-hook-install.js'
import { readCodexMemoryDreamState } from './memory-dream-state.js'
import { identifyCodexProject } from './project-id.js'

type CodexMemoryRootHealth = 'missing' | 'readable-writable' | 'readable-readonly' | 'unreadable' | 'unsafe'
type CodexMemoryFallbackMode = 'sqlite' | 'jsonl'
type CodexMemoryIndexFreshness = 'fresh' | 'stale' | 'empty' | 'unavailable'
type CodexSimilarProjectRetrieval = 'ready' | 'degraded'
type CodexSessionSummaryStatus = 'present' | 'missing' | 'unreadable'

interface CodexMemoryRootStatus {
  path: string
  health: CodexMemoryRootHealth
  reason?: string
}

interface CodexMemoryCounts {
  active: number
  pending: number
  tombstones: number
  profileCandidates: number
  reason?: string
}

interface CodexMemoryIndexStatus {
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

interface CodexStopHookStatus {
  configured: boolean
  sessionSummaries: CodexSessionSummaryStatus
  lastRunAt?: string
  lastRunStatus?: 'ok' | 'failed'
  reason?: string
}

export interface CodexMemoryStatus {
  nodeVersion: string
  project: {
    projectId: string
    displayName: string
    cwd: string
    gitRoot?: string
    gitRemoteHash?: string
    knownProjectRootCount: number
    knownProjectIds: string[]
    idDiagnostic: string
  }
  roots: {
    global: CodexMemoryRootStatus & { counts: CodexMemoryCounts }
    project: CodexMemoryRootStatus & { counts: CodexMemoryCounts }
  }
  index: CodexMemoryIndexStatus
  similarProjectRetrieval: CodexSimilarProjectRetrieval
  stopHookConfigured: boolean
  stopHook: CodexStopHookStatus
  dream: {
    state: 'ok' | 'unreadable'
    due: boolean
    lastDreamAt?: string
    reason?: string
  }
}

const INDEXED_SOURCE_FILES = ['index.jsonl', 'pending.jsonl']
const PROFILE_CANDIDATES_FILE = 'profile_candidates.jsonl'
const REVIEW_SUMMARIES_FILE = 'review-summaries.jsonl'

export async function readCodexMemoryStatus(input: { cwd: string }): Promise<CodexMemoryStatus> {
  const project = await identifyCodexProject(input.cwd)
  const globalRoot = codexGlobalMemoryRoot()
  const projectRoot = codexProjectMemoryRoot(project.projectId)
  const [knownProjectMemoryRoots, globalStatus, projectStatus, globalCounts, projectCounts, diagnostics, stopHook, dream] =
    await Promise.all([
      readKnownProjectMemoryRoots(),
      readRootStatus(globalRoot),
      readRootStatus(projectRoot),
      readRootCounts(globalRoot),
      readRootCounts(projectRoot),
      readStatusIndexDiagnostics(),
      readStopHookStatus(projectRoot),
      readDreamStatus(projectRoot)
    ])
  const indexedMemoryRoots = uniqueStrings([globalRoot, projectRoot, ...knownProjectMemoryRoots])
  const knownProjectIds = projectIdsFromMemoryRoots(knownProjectMemoryRoots)
  const index = await readIndexStatus(diagnostics, indexedMemoryRoots)

  return {
    nodeVersion: process.versions.node,
    project: {
      projectId: project.projectId,
      displayName: project.displayName,
      cwd: project.cwd,
      gitRoot: project.gitRoot,
      gitRemoteHash: project.gitRemoteHash,
      knownProjectRootCount: knownProjectIds.length,
      knownProjectIds,
      idDiagnostic: projectIdDiagnostic(project.projectId, knownProjectIds)
    },
    roots: {
      global: { ...globalStatus, counts: globalCounts },
      project: { ...projectStatus, counts: projectCounts }
    },
    index,
    similarProjectRetrieval: index.available && index.freshness !== 'stale' ? 'ready' : 'degraded',
    stopHookConfigured: stopHook.configured,
    stopHook,
    dream
  }
}

export async function formatCodexMemoryStatus(input: { cwd: string }): Promise<string> {
  const status = await readCodexMemoryStatus(input)
  return [
    'Cyrene Memory Status',
    '',
    'runtime:',
    `  node: ${status.nodeVersion}`,
    '',
    'project:',
    `  projectId: ${status.project.projectId}`,
    `  displayName: ${status.project.displayName}`,
    `  cwd: ${status.project.cwd}`,
    `  git root: ${status.project.gitRoot ?? 'none'}`,
    `  remote hash: ${status.project.gitRemoteHash ?? 'none'}`,
    `  known project roots: ${status.project.knownProjectRootCount}`,
    `  projectId diagnostic: ${status.project.idDiagnostic}`,
    status.project.knownProjectIds.length === 0 ? undefined : `  known projectIds: ${status.project.knownProjectIds.join(', ')}`,
    '',
    'roots:',
    `  global root: ${status.roots.global.path}`,
    `  global root health: ${formatRootHealth(status.roots.global)}`,
    `  project root: ${status.roots.project.path}`,
    `  project root health: ${formatRootHealth(status.roots.project)}`,
    '',
    'memory:',
    `  global active: ${status.roots.global.counts.active}`,
    `  global pending: ${status.roots.global.counts.pending}`,
    `  global tombstones: ${status.roots.global.counts.tombstones}`,
    `  global profile candidates: ${status.roots.global.counts.profileCandidates}`,
    `  project active: ${status.roots.project.counts.active}`,
    `  project pending: ${status.roots.project.counts.pending}`,
    `  project tombstones: ${status.roots.project.counts.tombstones}`,
    `  project profile candidates: ${status.roots.project.counts.profileCandidates}`,
    status.roots.global.counts.reason === undefined ? undefined : `  global counts reason: ${status.roots.global.counts.reason}`,
    status.roots.project.counts.reason === undefined ? undefined : `  project counts reason: ${status.roots.project.counts.reason}`,
    '',
    'index:',
    `  sqlite index: ${status.index.available ? 'available' : 'unavailable'}`,
    `  memory db: ${status.index.dbPath}`,
    status.index.ftsTokenizer === undefined ? undefined : `  memory fts: ${status.index.ftsTokenizer}`,
    status.index.reason === undefined ? undefined : `  sqlite reason: ${status.index.reason}`,
    `  fallback mode: ${status.index.fallbackMode}`,
    `  index freshness: ${status.index.freshness}`,
    status.index.lastSyncAt === undefined ? undefined : `  last sync: ${status.index.lastSyncAt}`,
    status.index.sourceLatestAt === undefined ? undefined : `  source latest: ${status.index.sourceLatestAt}`,
    status.index.staleReason === undefined ? undefined : `  stale reason: ${status.index.staleReason}`,
    `  similar-project retrieval: ${status.similarProjectRetrieval}`,
    status.index.freshness === 'stale' ? '  action: run cyrene-continuity codex memory db rebuild' : undefined,
    '',
    'hooks:',
    `  stop hook: ${status.stopHook.configured ? 'configured' : 'missing'}`,
    `  session summaries: ${status.stopHook.sessionSummaries}`,
    `  last stop hook run: ${formatStopHookRun(status.stopHook)}`,
    status.stopHook.reason === undefined ? undefined : `  stop hook reason: ${status.stopHook.reason}`,
    '',
    'dream:',
    `  dream state: ${status.dream.state}`,
    status.dream.reason === undefined ? undefined : `  dream state reason: ${status.dream.reason}`,
    `  dream due: ${status.dream.due ? 'yes' : 'no'}`,
    `  last dream: ${status.dream.lastDreamAt ?? 'never'}`
  ].filter((line): line is string => line !== undefined && line !== '').join('\n') + '\n'
}

async function readKnownProjectMemoryRoots(): Promise<string[]> {
  try {
    return getReadableCodexProjectMemoryRoots()
  } catch {
    return []
  }
}

function projectIdsFromMemoryRoots(memoryRoots: string[]): string[] {
  return memoryRoots.map((root) => basename(dirname(root))).sort()
}

function projectIdDiagnostic(currentProjectId: string, knownProjectIds: string[]): string {
  if (knownProjectIds.length === 0) {
    return 'no project memory roots found'
  }
  const hasCurrent = knownProjectIds.includes(currentProjectId)
  if (knownProjectIds.length === 1 && hasCurrent) {
    return 'current project root only'
  }
  if (!hasCurrent) {
    return 'current projectId has no readable project memory root'
  }
  return 'multiple project memory roots detected'
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

async function readRootStatus(root: string): Promise<CodexMemoryRootStatus> {
  try {
    const stats = await lstat(root)
    if (stats.isSymbolicLink()) {
      return { path: root, health: 'unsafe', reason: 'memory root is a symlink' }
    }
    if (!stats.isDirectory()) {
      return { path: root, health: 'unsafe', reason: 'memory root is not a directory' }
    }
    const [readable, writable] = await Promise.all([
      canAccess(root, constants.R_OK),
      canAccess(root, constants.W_OK)
    ])
    if (readable && writable) {
      return { path: root, health: 'readable-writable' }
    }
    if (readable) {
      return { path: root, health: 'readable-readonly' }
    }
    return { path: root, health: 'unreadable', reason: 'memory root is not readable' }
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return { path: root, health: 'missing' }
    }
    return { path: root, health: 'unreadable', reason: errorMessage(error) }
  }
}

async function readRootCounts(root: string): Promise<CodexMemoryCounts> {
  try {
    const [active, pending, tombstones, profileCandidates] = await Promise.all([
      readActiveMemoriesFromRoot(root),
      readPendingMemoriesFromRoot(root),
      readTombstonesFromRoot(root),
      readPendingProfileCandidateCount(root)
    ])
    return {
      active: active.length,
      pending: pending.length,
      tombstones: tombstones.length,
      profileCandidates
    }
  } catch (error) {
    return {
      active: 0,
      pending: 0,
      tombstones: 0,
      profileCandidates: 0,
      reason: errorMessage(error)
    }
  }
}

async function readStopHookStatus(projectRoot: string): Promise<CodexStopHookStatus> {
  const [configured, latestSummary] = await Promise.all([
    isCodexStopHookConfigured(),
    readLatestReviewSummary(projectRoot)
  ])
  return {
    configured,
    sessionSummaries: latestSummary.status,
    lastRunAt: latestSummary.lastRunAt,
    lastRunStatus: latestSummary.lastRunStatus,
    reason: latestSummary.reason
  }
}

async function readLatestReviewSummary(root: string): Promise<{
  status: CodexSessionSummaryStatus
  lastRunAt?: string
  lastRunStatus?: 'ok' | 'failed'
  reason?: string
}> {
  let text: string
  try {
    text = await readFile(join(root, REVIEW_SUMMARIES_FILE), 'utf8')
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return { status: 'missing' }
    }
    return { status: 'unreadable', reason: errorMessage(error) }
  }

  let latest: { createdAt: string; status: 'ok' | 'failed'; failureReason?: string } | undefined
  try {
    for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      const parsed = JSON.parse(line) as { createdAt?: unknown; status?: unknown; failureReason?: unknown }
      if (typeof parsed.createdAt !== 'string' || !isSummaryStatus(parsed.status)) {
        continue
      }
      if (latest === undefined || parsed.createdAt > latest.createdAt) {
        latest = {
          createdAt: parsed.createdAt,
          status: parsed.status,
          failureReason: typeof parsed.failureReason === 'string' ? parsed.failureReason : undefined
        }
      }
    }
  } catch (error) {
    return { status: 'unreadable', reason: errorMessage(error) }
  }

  if (latest === undefined) {
    return { status: 'missing' }
  }
  return {
    status: 'present',
    lastRunAt: latest.createdAt,
    lastRunStatus: latest.status,
    reason: latest.status === 'failed' ? latest.failureReason : undefined
  }
}

async function readDreamStatus(root: string): Promise<CodexMemoryStatus['dream']> {
  try {
    const dreamState = await readCodexMemoryDreamState(root)
    return {
      state: 'ok',
      due: dreamState.dreamDue === true,
      lastDreamAt: dreamState.lastDreamAt
    }
  } catch (error) {
    return {
      state: 'unreadable',
      due: false,
      reason: errorMessage(error)
    }
  }
}

async function readPendingProfileCandidateCount(root: string): Promise<number> {
  let text: string
  try {
    text = await readFile(join(root, PROFILE_CANDIDATES_FILE), 'utf8')
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return 0
    }
    throw error
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      try {
        const parsed = JSON.parse(line) as { status?: unknown }
        return parsed.status === 'pending'
      } catch {
        return false
      }
    }).length
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

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode)
    return true
  } catch {
    return false
  }
}

function formatRootHealth(root: CodexMemoryRootStatus): string {
  return root.reason === undefined ? root.health : `${root.health} (${root.reason})`
}

function formatStopHookRun(status: CodexStopHookStatus): string {
  return status.lastRunAt === undefined ? 'never' : `${status.lastRunAt} (${status.lastRunStatus ?? 'unknown'})`
}

function isSummaryStatus(value: unknown): value is 'ok' | 'failed' {
  return value === 'ok' || value === 'failed'
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
