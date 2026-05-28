import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  ensureCodexProjectMemoryRoot,
  getReadableCodexProjectMemoryRoot,
  getReadableCodexProjectRoots
} from './codex-memory-root.js'
import {
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot
} from '../memory/memory-store.js'
import { runMemoryMigrationEvalGate } from '../eval/eval-runner.js'

export interface CodexProjectRegistryEntry {
  projectId: string
  root: string
  memoryRoot: string
  aliases: string[]
  mergedFrom: string[]
  mergedInto?: string
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
  aliases?: string[]
  mergedFrom?: string[]
  mergedInto?: string
  updatedAt?: string
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
  const mergedFiles: string[] = []

  for (const fileName of MERGE_JSONL_FILES) {
    const merged = await mergeJsonlFile(join(fromMemoryRoot, fileName), join(toMemoryRoot, fileName))
    if (merged) {
      mergedFiles.push(fileName)
    }
  }

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
  const [active, pending, tombstones] = await Promise.all([
    readActiveMemoriesFromRoot(memoryRoot),
    readPendingMemoriesFromRoot(memoryRoot),
    readTombstonesFromRoot(memoryRoot)
  ])
  return {
    projectId,
    root,
    memoryRoot,
    aliases: uniqueSorted(metadata.aliases ?? []),
    mergedFrom: uniqueSorted(metadata.mergedFrom ?? []),
    mergedInto: metadata.mergedInto,
    counts: {
      active: active.length,
      pending: pending.length,
      tombstones: tombstones.length
    }
  }
}

async function mergeJsonlFile(sourcePath: string, targetPath: string): Promise<boolean> {
  const sourceLines = await readJsonLinesIfExists(sourcePath)
  if (sourceLines.length === 0) {
    return false
  }
  const targetLines = await readJsonLinesIfExists(targetPath)
  const merged = mergeJsonLines(targetLines, sourceLines)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, `${merged.join('\n')}\n`, 'utf8')
  return true
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
      aliases: readStringArray(parsed.aliases),
      mergedFrom: readStringArray(parsed.mergedFrom),
      mergedInto: typeof parsed.mergedInto === 'string' ? parsed.mergedInto : undefined,
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
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
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
