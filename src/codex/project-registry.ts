import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import {
  codexProjectMemoryRoot,
  ensureCodexProjectRoot,
  ensureCodexProjectMemoryRoot,
  getReadableCodexProjectMemoryRoot,
  getReadableCodexProjectRoot,
  getReadableCodexProjectRoots
} from './codex-memory-root.js'
import {
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot,
  assertSafeMemoryDataFileTarget
} from '../memory/memory-store.js'
import { withMemoryMaintenanceLockFromRoot } from '../memory/memory-maintenance.js'
import { runMemoryMigrationEvalGate } from '../eval/eval-runner.js'

export interface CodexProjectRegistryEntry {
  projectId: string
  displayName: string
  root: string
  memoryRoot: string
  aliases: string[]
  mergedFrom: string[]
  mergedInto?: string
  disabled: boolean
  disabledAt?: string
  disabledReason?: string
  counts: {
    active: number
    pending: number
    tombstones: number
  }
}

export interface CodexProjectMergeResult {
  fromProjectId: string
  toProjectId: string
  mergedFiles: string[]
}

interface CodexProjectMetadata {
  projectId?: string
  displayName?: string
  aliases?: string[]
  mergedFrom?: string[]
  mergedInto?: string
  disabled?: boolean
  disabledAt?: string
  disabledReason?: string
  updatedAt?: string
}

export interface CodexProjectDeleteMemoryResult {
  projectId: string
  memoryRoot: string
  disabled: true
  memoryDeleted: boolean
  disabledAt: string
  disabledReason?: string
}

const PROJECT_METADATA_FILE = 'project.json'
const MERGE_JSONL_FILES = [
  'index.jsonl',
  'pending.jsonl',
  'tombstones.jsonl',
  'events.jsonl',
  'profile_candidates.jsonl',
  'review-summaries.jsonl'
]
const HOOK_TRACE_FILE = 'hook-trace.jsonl'
const execFileAsync = promisify(execFile)

export async function listCodexProjects(): Promise<CodexProjectRegistryEntry[]> {
  const projectRoots = await getReadableCodexProjectRoots()
  const entries = await Promise.all(projectRoots.map((root) => registryEntryFromRoot(root)))
  return entries.sort((left, right) => left.projectId.localeCompare(right.projectId))
}

export async function addCodexProjectAlias(input: { projectId: string; alias: string }): Promise<CodexProjectRegistryEntry> {
  const projectId = validateProjectId(input.projectId)
  const alias = validateAlias(input.alias)
  const memoryRoot = await ensureCodexProjectMemoryRoot(projectId)
  const projectRoot = dirname(memoryRoot)
  const metadata = await readProjectMetadata(projectRoot)
  await writeProjectMetadata(projectRoot, {
    ...metadata,
    projectId,
    aliases: uniqueSorted([...(metadata.aliases ?? []), alias]),
    updatedAt: new Date().toISOString()
  })
  return registryEntryFromRoot(projectRoot)
}

export async function deleteCodexProjectMemory(input: {
  projectId: string
  reason?: string
  now?: string
}): Promise<CodexProjectDeleteMemoryResult> {
  const projectId = validateProjectId(input.projectId)
  const projectRoot = await ensureCodexProjectRoot(projectId)
  const memoryRoot = codexProjectMemoryRoot(projectId)
  const metadata = await readProjectMetadata(projectRoot)
  const displayName = await displayNameForProjectEntry(projectId, memoryRoot, metadata)
  const now = input.now ?? new Date().toISOString()
  const reason = input.reason?.trim() || undefined
  const memoryDeleted = await rmDirectoryIfExists(memoryRoot)
  await writeProjectMetadata(projectRoot, {
    ...metadata,
    projectId,
    displayName,
    disabled: true,
    disabledAt: now,
    disabledReason: reason,
    updatedAt: now
  })
  return {
    projectId,
    memoryRoot,
    disabled: true,
    memoryDeleted,
    disabledAt: now,
    ...(reason === undefined ? {} : { disabledReason: reason })
  }
}

export async function isCodexProjectMemoryDisabled(projectIdInput: string): Promise<boolean> {
  const projectId = validateProjectId(projectIdInput)
  const projectRoot = await getReadableCodexProjectRoot(projectId)
  if (projectRoot === null) {
    return false
  }
  const metadata = await readProjectMetadata(projectRoot)
  return metadata.disabled === true
}

export async function mergeCodexProjects(input: {
  fromProjectId: string
  toProjectId: string
}): Promise<CodexProjectMergeResult> {
  const fromProjectId = validateProjectId(input.fromProjectId)
  const toProjectId = validateProjectId(input.toProjectId)
  if (fromProjectId === toProjectId) {
    throw new Error('Cannot merge a project into itself.')
  }

  const fromMemoryRoot = await getReadableCodexProjectMemoryRoot(fromProjectId)
  if (fromMemoryRoot === null) {
    throw new Error(`Project memory root not found: ${fromProjectId}`)
  }
  const toMemoryRoot = await ensureCodexProjectMemoryRoot(toProjectId)
  await assertMergeJsonlFilesSafe(fromMemoryRoot, 'source')
  const gate = runMemoryMigrationEvalGate({
    fromProjectId,
    toProjectId,
    activeMemories: await readActiveMemoriesFromRoot(fromMemoryRoot)
  })
  if (!gate.passed) {
    throw new Error(`Project merge blocked by eval gate: ${gate.failedChecks.join(', ')}`)
  }
  const fromProjectRoot = dirname(fromMemoryRoot)
  const toProjectRoot = dirname(toMemoryRoot)
  const mergedFiles = await withMemoryMaintenanceLockFromRoot(toMemoryRoot, async (lockedToMemoryRoot) => {
    const files: string[] = []
    for (const fileName of MERGE_JSONL_FILES) {
      const merged = await mergeJsonlFile(join(fromMemoryRoot, fileName), join(lockedToMemoryRoot, fileName))
      if (merged) {
        files.push(fileName)
      }
    }
    return files
  })

  const now = new Date().toISOString()
  const fromMetadata = await readProjectMetadata(fromProjectRoot)
  const toMetadata = await readProjectMetadata(toProjectRoot)
  await writeProjectMetadata(fromProjectRoot, {
    ...fromMetadata,
    projectId: fromProjectId,
    mergedInto: toProjectId,
    updatedAt: now
  })
  await writeProjectMetadata(toProjectRoot, {
    ...toMetadata,
    projectId: toProjectId,
    aliases: uniqueSorted([...(toMetadata.aliases ?? []), ...(fromMetadata.aliases ?? [])]),
    mergedFrom: uniqueSorted([...(toMetadata.mergedFrom ?? []), fromProjectId, ...(fromMetadata.mergedFrom ?? [])]),
    updatedAt: now
  })

  return { fromProjectId, toProjectId, mergedFiles }
}

async function registryEntryFromRoot(root: string): Promise<CodexProjectRegistryEntry> {
  const projectId = basename(root)
  const memoryRoot = join(root, 'memory')
  const metadata = await readProjectMetadata(root)
  const displayName = await displayNameForProjectEntry(projectId, memoryRoot, metadata)
  const [active, pending, tombstones] = await Promise.all([
    readActiveMemoriesFromRoot(memoryRoot),
    readPendingMemoriesFromRoot(memoryRoot),
    readTombstonesFromRoot(memoryRoot)
  ])
  return {
    projectId,
    displayName,
    root,
    memoryRoot,
    aliases: uniqueSorted(metadata.aliases ?? []),
    mergedFrom: uniqueSorted(metadata.mergedFrom ?? []),
    mergedInto: metadata.mergedInto,
    disabled: metadata.disabled === true,
    ...(metadata.disabledAt === undefined ? {} : { disabledAt: metadata.disabledAt }),
    ...(metadata.disabledReason === undefined ? {} : { disabledReason: metadata.disabledReason }),
    counts: {
      active: active.length,
      pending: pending.length,
      tombstones: tombstones.length
    }
  }
}

async function displayNameForProjectEntry(
  projectId: string,
  memoryRoot: string,
  metadata: CodexProjectMetadata
): Promise<string> {
  const alias = metadata.aliases?.find((value) => value.trim() !== '')
  if (alias !== undefined) {
    return alias
  }
  const metadataDisplayName = cleanDisplayName(metadata.displayName)
  if (metadataDisplayName !== undefined && metadataDisplayName !== projectId) {
    return metadataDisplayName
  }
  const tracedCwd = await latestHookTraceCwd(memoryRoot)
  if (tracedCwd !== undefined) {
    const inferred = await inferProjectDisplayNameFromCwd(tracedCwd)
    if (inferred !== undefined && inferred !== projectId) {
      return inferred
    }
  }
  return projectId
}

async function latestHookTraceCwd(memoryRoot: string): Promise<string | undefined> {
  let content: string
  try {
    content = await readFile(join(memoryRoot, HOOK_TRACE_FILE), 'utf8')
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return undefined
    }
    throw error
  }

  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '').reverse()
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown
      if (isRecord(parsed) && typeof parsed.cwd === 'string' && parsed.cwd.trim() !== '') {
        return parsed.cwd.trim()
      }
    } catch {
      // Ignore malformed hook trace lines when deriving a display name.
    }
  }
  return undefined
}

async function inferProjectDisplayNameFromCwd(cwd: string): Promise<string | undefined> {
  const gitRoot = (await tryGit(['rev-parse', '--show-toplevel'], cwd))?.trim()
  const remote = (await tryGit(['config', '--get', 'remote.origin.url'], gitRoot ?? cwd))?.trim()
  const remoteDisplayName = cleanDisplayName(remote === undefined ? undefined : repoNameFromRemote(remote))
  if (remoteDisplayName !== undefined) {
    return remoteDisplayName
  }

  const packageNameDisplay = await packageDisplayName(cwd)
  if (packageNameDisplay !== undefined) {
    return packageNameDisplay
  }

  return cleanDisplayName(basename(gitRoot ?? cwd))
}

async function packageDisplayName(cwd: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as unknown
    if (!isRecord(parsed) || typeof parsed.name !== 'string') {
      return undefined
    }
    const unscoped = parsed.name.startsWith('@') ? parsed.name.split('/').slice(1).join('/') : parsed.name
    return cleanDisplayName(unscoped)
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return undefined
    }
    return undefined
  }
}

function repoNameFromRemote(remote: string): string | undefined {
  const trimmed = remote.trim().replace(/\/+$/, '')
  const match = /([^/:]+?)(?:\.git)?$/.exec(trimmed)
  return match?.[1]
}

async function tryGit(args: string[], cwd: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync('git', args, { cwd })
    const text = result.stdout.trim()
    return text === '' ? undefined : text
  } catch {
    return undefined
  }
}

function cleanDisplayName(value: string | undefined): string | undefined {
  const cleaned = value?.trim().replace(/\.git$/i, '')
  return cleaned === undefined || cleaned === '' ? undefined : cleaned
}

async function rmDirectoryIfExists(path: string): Promise<boolean> {
  try {
    await rm(path, { recursive: true })
    return true
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return false
    }
    throw error
  }
}

async function mergeJsonlFile(sourcePath: string, targetPath: string): Promise<boolean> {
  await assertMergeJsonlFileSafe(sourcePath, 'source')
  const sourceLines = await readJsonLinesIfExists(sourcePath)
  if (sourceLines.length === 0) {
    return false
  }
  await assertMergeJsonlFileSafe(targetPath, 'target')
  const targetLines = await readJsonLinesIfExists(targetPath)
  const merged = mergeJsonLines(targetLines, sourceLines)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeJsonLinesAtomic(targetPath, merged)
  return true
}

async function assertMergeJsonlFilesSafe(memoryRoot: string, role: 'source' | 'target'): Promise<void> {
  await Promise.all(MERGE_JSONL_FILES.map((fileName) => assertMergeJsonlFileSafe(join(memoryRoot, fileName), role)))
}

async function assertMergeJsonlFileSafe(filePath: string, role: 'source' | 'target'): Promise<void> {
  try {
    await assertSafeMemoryDataFileTarget(filePath)
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Unsafe project merge ${role} JSONL file: ${error.message}`)
    }
    throw error
  }
}

async function writeJsonLinesAtomic(filePath: string, values: string[]): Promise<void> {
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  let renamed = false
  try {
    await writeFile(tempPath, `${values.join('\n')}\n`, 'utf8')
    await assertMergeJsonlFileSafe(filePath, 'target')
    await rename(tempPath, filePath)
    renamed = true
  } finally {
    if (!renamed) {
      await rm(tempPath, { force: true })
    }
  }
}

function mergeJsonLines(targetLines: string[], sourceLines: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of [...targetLines, ...sourceLines]) {
    const key = jsonLineKey(line)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(line)
  }
  return result
}

function jsonLineKey(line: string): string {
  try {
    const parsed = JSON.parse(line) as { id?: unknown }
    if (typeof parsed.id === 'string' && parsed.id.trim() !== '') {
      return `id:${parsed.id}`
    }
  } catch {
    // Invalid JSONL is still deduped by exact line.
  }
  return `line:${line}`
}

async function readJsonLinesIfExists(path: string): Promise<string[]> {
  try {
    return (await readFile(path, 'utf8'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return []
    }
    throw error
  }
}

async function readProjectMetadata(projectRoot: string): Promise<CodexProjectMetadata> {
  try {
    const parsed = JSON.parse(await readFile(join(projectRoot, PROJECT_METADATA_FILE), 'utf8')) as unknown
    if (!isRecord(parsed)) {
      return {}
    }
    return {
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : undefined,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : undefined,
      aliases: readStringArray(parsed.aliases),
      mergedFrom: readStringArray(parsed.mergedFrom),
      mergedInto: typeof parsed.mergedInto === 'string' ? parsed.mergedInto : undefined,
      disabled: typeof parsed.disabled === 'boolean' ? parsed.disabled : undefined,
      disabledAt: typeof parsed.disabledAt === 'string' ? parsed.disabledAt : undefined,
      disabledReason: typeof parsed.disabledReason === 'string' ? parsed.disabledReason : undefined,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined
    }
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return {}
    }
    throw error
  }
}

async function writeProjectMetadata(projectRoot: string, metadata: CodexProjectMetadata): Promise<void> {
  await mkdir(projectRoot, { recursive: true })
  await writeFile(join(projectRoot, PROJECT_METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
}

function validateProjectId(value: string): string {
  const trimmed = value.trim()
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed) || /^\.+$/.test(trimmed)) {
    throw new Error(`Invalid projectId: ${value}`)
  }
  return trimmed
}

function validateAlias(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new Error('Invalid project alias: missing value')
  }
  return trimmed
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
