import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rm, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  CANONICAL_JSONL_FILES,
  sha256,
  type CanonicalJsonlFile,
  type MalformedJsonlLine
} from './jsonl-diagnostics.js'
import { withMemoryMaintenanceLockFromRoot } from './memory-maintenance.js'
import { assertSafeMemoryDataFileTarget, ensureWritableMemoryRootPath } from './memory-store.js'

const REPAIR_DIR = 'repair'
const TOOL_VERSION = '0.1.0'
const UNSUPPORTED_DIRECTORY_FSYNC_ERROR_CODES = new Set(['EINVAL', 'EISDIR', 'ENOTSUP', 'ENOSYS', 'EPERM'])

interface JsonlRepairTestHooks {
  fsyncDirectory?: (dirPath: string) => Promise<void>
}

let jsonlRepairTestHooks: JsonlRepairTestHooks = {}

export interface JsonlRepairInput {
  memoryRoot: string
  apply: boolean
  now?: string
  beforeRewrite?: () => Promise<void>
}

export interface JsonlRepairResult {
  action: 'dry_run' | 'repaired' | 'noop'
  repairTransactionId: string
  memoryRoot: string
  filesScanned: number
  filesRepaired: number
  malformedLineCount: number
  backupPaths: string[]
  quarantinePath?: string
  summaryPath?: string
}

export function setJsonlRepairTestHooksForTest(hooks: JsonlRepairTestHooks): () => void {
  const previousHooks = jsonlRepairTestHooks
  jsonlRepairTestHooks = hooks
  return () => {
    jsonlRepairTestHooks = previousHooks
  }
}

interface RepairSource {
  relativePath: CanonicalJsonlFile
  filePath: string
  scan: RepairFileScan
  snapshot: SourceSnapshot
}

interface RepairFileScan {
  validRecords: unknown[]
  malformed: MalformedJsonlLine[]
}

interface SourceSnapshot {
  size: number
  mtimeMs: number
  sha256: string
  bytes: Buffer
}

interface RepairSummary {
  status: 'pending' | 'repaired' | 'failed'
  repairTransactionId: string
  memoryRoot: string
  startedAt: string
  finishedAt?: string
  filesScanned: number
  filesRepaired: number
  malformedLineCount: number
  backupPaths: string[]
  quarantinePath?: string
  toolVersion: string
  error?: string
}

export async function runJsonlRepairFromRoot(input: JsonlRepairInput): Promise<JsonlRepairResult> {
  return withMemoryMaintenanceLockFromRoot(input.memoryRoot, async (lockedRoot) => {
    const memoryRoot = await ensureWritableMemoryRootPath(lockedRoot)
    const now = input.now ?? new Date().toISOString()
    const repairTransactionId = createRepairTransactionId(now)
    const scannedFiles = await scanCanonicalJsonlFiles(memoryRoot)
    const malformedLineCount = scannedFiles.reduce((count, file) => count + file.scan.malformed.length, 0)

    if (!input.apply) {
      return {
        action: 'dry_run',
        repairTransactionId,
        memoryRoot,
        filesScanned: scannedFiles.length,
        filesRepaired: 0,
        malformedLineCount,
        backupPaths: []
      }
    }

    if (malformedLineCount === 0) {
      return {
        action: 'noop',
        repairTransactionId,
        memoryRoot,
        filesScanned: scannedFiles.length,
        filesRepaired: 0,
        malformedLineCount: 0,
        backupPaths: []
      }
    }

    return applyJsonlRepair({
      memoryRoot,
      repairTransactionId,
      scannedFiles,
      now,
      beforeRewrite: input.beforeRewrite
    })
  })
}

async function scanCanonicalJsonlFiles(memoryRoot: string): Promise<RepairSource[]> {
  const files: RepairSource[] = []
  for (const relativePath of CANONICAL_JSONL_FILES) {
    const filePath = join(memoryRoot, relativePath)
    if (!(await pathExists(filePath))) {
      continue
    }
    files.push(await readRepairSource(filePath, relativePath))
  }
  return files
}

async function readRepairSource(filePath: string, relativePath: CanonicalJsonlFile): Promise<RepairSource> {
  const stats = await lstat(filePath)
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to repair JSONL symlink: ${filePath}`)
  }
  if (!stats.isFile()) {
    throw new Error(`Refusing to repair non-file JSONL path: ${filePath}`)
  }
  const bytes = await readFile(filePath)
  const content = bytes.toString('utf8')
  return {
    relativePath,
    filePath,
    scan: parseJsonlContentForRepair(content, relativePath),
    snapshot: createSourceSnapshot(stats.mtimeMs, content, bytes)
  }
}

function parseJsonlContentForRepair(content: string, relativePath: CanonicalJsonlFile): RepairFileScan {
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
        relativePath,
        rawLineSha256: sha256(trimmedLine),
        parseError: errorMessage(error),
        rawLine: trimmedLine
      })
    }
  }
  return { validRecords, malformed }
}

async function applyJsonlRepair(input: {
  memoryRoot: string
  repairTransactionId: string
  scannedFiles: RepairSource[]
  now: string
  beforeRewrite?: () => Promise<void>
}): Promise<JsonlRepairResult> {
  const repairRoot = join(input.memoryRoot, REPAIR_DIR)
  const transactionRoot = join(repairRoot, input.repairTransactionId)
  const backupRoot = join(transactionRoot, 'backups')
  const quarantinePath = join(transactionRoot, 'quarantine.jsonl')
  const pendingSummaryPath = join(transactionRoot, 'summary.pending.json')
  const summaryPath = join(transactionRoot, 'summary.json')

  const sources = input.scannedFiles.filter((source) => source.scan.malformed.length > 0)
  const backupPaths = sources.map((source) => join(backupRoot, source.relativePath))
  const malformedLineCount = sources.reduce((count, source) => count + source.scan.malformed.length, 0)
  const pendingSummary: RepairSummary = {
    status: 'pending',
    repairTransactionId: input.repairTransactionId,
    memoryRoot: input.memoryRoot,
    startedAt: input.now,
    filesScanned: input.scannedFiles.length,
    filesRepaired: sources.length,
    malformedLineCount,
    backupPaths,
    quarantinePath,
    toolVersion: TOOL_VERSION
  }

  let pendingSummaryWritten = false
  try {
    await ensureDirectory(repairRoot)
    await mkdir(transactionRoot)
    await ensureDirectory(backupRoot)
    await writeJsonFileDurable(pendingSummaryPath, pendingSummary)
    pendingSummaryWritten = true
    for (const source of sources) {
      await writeBufferDurable(join(backupRoot, source.relativePath), source.snapshot.bytes)
    }
    await writeJsonLinesDurable(
      quarantinePath,
      sources.flatMap((source) => source.scan.malformed.map((line) =>
        quarantineRecord(input.repairTransactionId, source.relativePath, line, input.now)
      ))
    )

    if (input.beforeRewrite !== undefined) {
      await input.beforeRewrite()
    }
    for (const source of sources) {
      await assertSourceUnchanged(source.filePath, source.snapshot)
    }
    for (const source of sources) {
      await rewriteCanonicalJsonlFile(source.filePath, source.scan.validRecords)
    }

    const repairedSummary: RepairSummary = {
      ...pendingSummary,
      status: 'repaired',
      finishedAt: input.now
    }
    await writeJsonFileDurable(summaryPath, repairedSummary)
  } catch (error) {
    if (pendingSummaryWritten) {
      await writeJsonFileDurable(summaryPath, {
        ...pendingSummary,
        status: 'failed',
        finishedAt: input.now,
        error: errorMessage(error)
      }).catch(() => undefined)
    }
    throw createRepairFailedError(input.repairTransactionId, summaryPath, error)
  }

  return {
    action: 'repaired',
    repairTransactionId: input.repairTransactionId,
    memoryRoot: input.memoryRoot,
    filesScanned: input.scannedFiles.length,
    filesRepaired: sources.length,
    malformedLineCount,
    backupPaths,
    quarantinePath,
    summaryPath
  }
}

function quarantineRecord(
  repairTransactionId: string,
  relativePath: string,
  line: MalformedJsonlLine,
  quarantinedAt: string
): Record<string, unknown> {
  return {
    repairTransactionId,
    source: relativePath,
    lineNumber: line.lineNumber,
    rawLineSha256: line.rawLineSha256,
    rawLine: line.rawLine ?? '',
    parseError: line.parseError,
    quarantinedAt
  }
}

async function rewriteCanonicalJsonlFile(filePath: string, records: unknown[]): Promise<void> {
  await assertSafeMemoryDataFileTarget(filePath)
  await writeJsonLinesDurable(filePath, records)
}

async function captureSourceSnapshot(filePath: string): Promise<SourceSnapshot> {
  const stats = await lstat(filePath)
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to repair JSONL symlink: ${filePath}`)
  }
  if (!stats.isFile()) {
    throw new Error(`Refusing to repair non-file JSONL path: ${filePath}`)
  }
  const bytes = await readFile(filePath)
  const content = bytes.toString('utf8')
  return createSourceSnapshot(stats.mtimeMs, content, bytes)
}

function createSourceSnapshot(mtimeMs: number, content: string, bytes: Buffer): SourceSnapshot {
  return {
    size: Buffer.byteLength(content, 'utf8'),
    mtimeMs,
    sha256: sha256(content),
    bytes
  }
}

async function assertSourceUnchanged(filePath: string, expected: SourceSnapshot): Promise<void> {
  const current = await captureSourceSnapshot(filePath)
  if (
    current.size !== expected.size ||
    current.mtimeMs !== expected.mtimeMs ||
    current.sha256 !== expected.sha256
  ) {
    throw new Error(`JSONL source changed during repair: ${filePath}`)
  }
}

async function writeJsonFileDurable(filePath: string, value: unknown): Promise<void> {
  await writeBufferDurable(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'))
}

async function writeJsonLinesDurable(filePath: string, values: unknown[]): Promise<void> {
  const content = values.map((value) => JSON.stringify(value)).join('\n')
  await writeBufferDurable(filePath, Buffer.from(content === '' ? '' : `${content}\n`, 'utf8'))
}

async function writeBufferDurable(filePath: string, content: Buffer): Promise<void> {
  await ensureDirectory(dirname(filePath))
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`)
  const file = await open(tempPath, 'wx')
  let closed = false
  try {
    await file.writeFile(content)
    await file.sync()
    await file.close()
    closed = true
    await rename(tempPath, filePath)
    await fsyncDirectory(dirname(filePath))
  } catch (error) {
    if (!closed) {
      await file.close().catch(() => undefined)
    }
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    const stats = await lstat(dirPath)
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to use repair directory symlink: ${dirPath}`)
    }
    if (!stats.isDirectory()) {
      throw new Error(`Refusing to use non-directory repair path: ${dirPath}`)
    }
    return
  } catch (error) {
    if (!isFileErrorCode(error, 'ENOENT')) {
      throw error
    }
  }
  await mkdir(dirPath, { recursive: true })
}

async function fsyncDirectory(dirPath: string): Promise<void> {
  let directory
  try {
    directory = await open(dirPath, 'r')
    if (jsonlRepairTestHooks.fsyncDirectory !== undefined) {
      await jsonlRepairTestHooks.fsyncDirectory(dirPath)
    } else {
      await directory.sync()
    }
  } catch (error) {
    if (isUnsupportedDirectoryFsyncError(error)) {
      return
    }
    throw error
  } finally {
    await directory?.close().catch(() => undefined)
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

function createRepairTransactionId(now: string): string {
  const sanitizedNow = now.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `repair-${sanitizedNow}-${randomUUID()}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function createRepairFailedError(repairTransactionId: string, summaryPath: string, cause: unknown): Error {
  const error = new Error(
    `repair_failed repairTransactionId=${repairTransactionId} summaryPath=${summaryPath}: ${errorMessage(cause)}`
  )
  Object.assign(error, { cause })
  return error
}

function isUnsupportedDirectoryFsyncError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    UNSUPPORTED_DIRECTORY_FSYNC_ERROR_CODES.has(error.code)
  )
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
