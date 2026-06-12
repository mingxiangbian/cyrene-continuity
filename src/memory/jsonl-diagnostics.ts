import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const CANONICAL_JSONL_FILES = [
  'index.jsonl',
  'pending.jsonl',
  'review_queue.jsonl',
  'episodes.jsonl',
  'candidate_drafts.jsonl',
  'admission_decisions.jsonl',
  'semantic_memories.jsonl',
  'distillation_inputs.jsonl',
  'routing_decisions.jsonl',
  'review_decisions.jsonl',
  'activation_events.jsonl',
  'reflection_candidates.jsonl',
  'semantic_rewrite_receipts.jsonl',
  'memory_edges.jsonl',
  'events.jsonl',
  'tombstones.jsonl'
] as const

export type CanonicalJsonlFile = typeof CANONICAL_JSONL_FILES[number]
export type MemoryArtifactClassification = 'canonical' | 'diagnostic_only' | 'ignored'

export interface JsonlScanOptions {
  includeRawLine?: boolean
  fileSizeCapBytes?: number
}

export interface MalformedJsonlLine {
  lineNumber: number
  relativePath?: string
  rawLineSha256: string
  parseError: string
  rawLine?: string
}

export interface JsonlFileScan {
  filePath: string
  relativePath?: string
  ok: boolean
  records: unknown[]
  validRecords: unknown[]
  malformed: MalformedJsonlLine[]
  bytesRead: number
  skippedReason?: string
}

export interface SkippedJsonlFile {
  filePath: string
  relativePath: CanonicalJsonlFile
  skippedReason: string
}

export interface CanonicalJsonlRootScan {
  memoryRoot: string
  files: JsonlFileScan[]
  corruptionCount: number
  skippedFiles: SkippedJsonlFile[]
}

const CANONICAL_JSONL_FILE_SET = new Set<string>(CANONICAL_JSONL_FILES)
const DIAGNOSTIC_ONLY_JSONL_FILES = new Set<string>([
  'profile_candidates.jsonl',
  'review-summaries.jsonl',
  'runtime_metrics.jsonl',
  'hook-trace.jsonl'
])

export function classifyMemoryArtifact(relativePath: string): MemoryArtifactClassification {
  const normalizedPath = normalizeMemoryPath(relativePath)
  if (normalizedPath.includes('/')) {
    return 'ignored'
  }
  if (CANONICAL_JSONL_FILE_SET.has(normalizedPath)) {
    return 'canonical'
  }
  if (DIAGNOSTIC_ONLY_JSONL_FILES.has(normalizedPath)) {
    return 'diagnostic_only'
  }
  return 'ignored'
}

export async function scanJsonlFile(
  filePath: string,
  options: JsonlScanOptions = {},
  relativePath?: string
): Promise<JsonlFileScan> {
  let stats
  try {
    stats = await lstat(filePath)
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return createEmptyScan(filePath, relativePath)
    }
    throw error
  }

  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to scan JSONL symlink: ${filePath}`)
  }
  if (!stats.isFile()) {
    throw new Error(`Refusing to scan non-file JSONL path: ${filePath}`)
  }

  if (options.fileSizeCapBytes !== undefined && stats.size > options.fileSizeCapBytes) {
    const skippedReason = `file_size_cap:${options.fileSizeCapBytes}`
    return {
      filePath,
      ...(relativePath === undefined ? {} : { relativePath }),
      ok: false,
      records: [],
      validRecords: [],
      malformed: [],
      bytesRead: 0,
      skippedReason
    }
  }

  const content = await readFile(filePath, 'utf8')
  const validRecords: unknown[] = []
  const malformed: MalformedJsonlLine[] = []

  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const trimmedLine = rawLine.trim()
    if (trimmedLine === '') {
      continue
    }

    try {
      validRecords.push(JSON.parse(trimmedLine) as unknown)
    } catch (error) {
      malformed.push({
        lineNumber: index + 1,
        ...(relativePath === undefined ? {} : { relativePath }),
        rawLineSha256: sha256(trimmedLine),
        parseError: errorMessage(error),
        ...(options.includeRawLine === true ? { rawLine: trimmedLine } : {})
      })
    }
  }

  return {
    filePath,
    ...(relativePath === undefined ? {} : { relativePath }),
    ok: malformed.length === 0,
    records: validRecords,
    validRecords,
    malformed,
    bytesRead: Buffer.byteLength(content, 'utf8')
  }
}

export async function scanCanonicalJsonlFilesFromRoot(
  memoryRoot: string,
  options: JsonlScanOptions = {}
): Promise<CanonicalJsonlRootScan> {
  const files: JsonlFileScan[] = []
  const skippedFiles: SkippedJsonlFile[] = []

  for (const relativePath of CANONICAL_JSONL_FILES) {
    const filePath = join(memoryRoot, relativePath)
    if (!(await pathExists(filePath))) {
      continue
    }

    const scan = await scanJsonlFile(filePath, { ...options, includeRawLine: false }, relativePath)
    files.push(scan)
    if (scan.skippedReason !== undefined) {
      skippedFiles.push({
        filePath,
        relativePath,
        skippedReason: scan.skippedReason
      })
    }
  }

  return {
    memoryRoot,
    files,
    corruptionCount: files.reduce((count, file) => count + file.malformed.length, 0),
    skippedFiles
  }
}

export function jsonlScanHasCorruption(scan: CanonicalJsonlRootScan | JsonlFileScan): boolean {
  if ('files' in scan) {
    return scan.corruptionCount > 0 || scan.skippedFiles.length > 0
  }
  return scan.malformed.length > 0 || scan.skippedReason !== undefined
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function createEmptyScan(filePath: string, relativePath?: string): JsonlFileScan {
  return {
    filePath,
    ...(relativePath === undefined ? {} : { relativePath }),
    ok: true,
    records: [],
    validRecords: [],
    malformed: [],
    bytesRead: 0
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return false
    }
    throw error
  }
}

function normalizeMemoryPath(relativePath: string): string {
  return relativePath.replaceAll('\\', '/')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
