import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSafeMemoryDataFileTarget } from '../memory/memory-store.js'

const GLOBAL_FAST_SUMMARY_FILE = 'global_fast_summary.md'
const PROFILE_FAST_SUMMARY_FILE = 'profile_fast_summary.md'
const FAST_SUMMARY_META_FILE = 'fast_summary_meta.json'
const GLOBAL_CHAR_LIMIT = 900
const PROFILE_CHAR_LIMIT = 700

export interface FastSummaryProjection {
  globalFastSummary: string
  profileFastSummary: string
  generatedAt?: string
  stale?: boolean
  staleReason?: string
  sourceLatestAt?: string
}

export interface MarkFastSummaryProjectionStaleInput {
  reason: string
  sourceLatestAt?: string
  now?: string
}

interface FastSummaryProjectionMeta {
  generatedAt?: string
  stale: boolean
  staleReason?: string
  sourceLatestAt?: string
  staleMarkedAt?: string
}

export async function readFastSummaryProjection(memoryRoot: string): Promise<FastSummaryProjection> {
  const [globalFastSummary, profileFastSummary, meta] = await Promise.all([
    readOptionalSafeText(join(memoryRoot, GLOBAL_FAST_SUMMARY_FILE)),
    readOptionalSafeText(join(memoryRoot, PROFILE_FAST_SUMMARY_FILE)),
    readFastSummaryMeta(join(memoryRoot, FAST_SUMMARY_META_FILE))
  ])
  return {
    globalFastSummary,
    profileFastSummary,
    generatedAt: meta.generatedAt,
    stale: meta.stale,
    staleReason: meta.staleReason,
    sourceLatestAt: meta.sourceLatestAt
  }
}

export async function writeFastSummaryProjection(
  memoryRoot: string,
  projection: FastSummaryProjection
): Promise<void> {
  await mkdir(memoryRoot, { recursive: true })
  const globalPath = join(memoryRoot, GLOBAL_FAST_SUMMARY_FILE)
  const profilePath = join(memoryRoot, PROFILE_FAST_SUMMARY_FILE)
  const metaPath = join(memoryRoot, FAST_SUMMARY_META_FILE)
  await Promise.all([
    assertSafeMemoryDataFileTarget(globalPath),
    assertSafeMemoryDataFileTarget(profilePath),
    assertSafeMemoryDataFileTarget(metaPath)
  ])
  await Promise.all([
    writeFile(globalPath, `${capText(projection.globalFastSummary, GLOBAL_CHAR_LIMIT)}\n`, 'utf8'),
    writeFile(profilePath, `${capText(projection.profileFastSummary, PROFILE_CHAR_LIMIT)}\n`, 'utf8'),
    writeFile(metaPath, `${JSON.stringify({
      generatedAt: projection.generatedAt ?? new Date().toISOString(),
      stale: false
    })}\n`, 'utf8')
  ])
}

export async function markFastSummaryProjectionStale(
  memoryRoot: string,
  input: MarkFastSummaryProjectionStaleInput
): Promise<void> {
  await mkdir(memoryRoot, { recursive: true })
  const metaPath = join(memoryRoot, FAST_SUMMARY_META_FILE)
  await assertSafeMemoryDataFileTarget(metaPath)
  const existing = await readFastSummaryMeta(metaPath)
  await writeFile(metaPath, `${JSON.stringify({
    generatedAt: existing.generatedAt,
    stale: true,
    staleReason: input.reason,
    staleMarkedAt: input.now ?? new Date().toISOString(),
    ...(input.sourceLatestAt === undefined ? {} : { sourceLatestAt: input.sourceLatestAt })
  })}\n`, 'utf8')
}

function capText(value: string, limit: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned.length <= limit ? cleaned : cleaned.slice(0, limit).trimEnd()
}

async function readOptionalSafeText(filePath: string): Promise<string> {
  await assertSafeMemoryDataFileTarget(filePath)
  try {
    return (await readFile(filePath, 'utf8')).trim()
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) return ''
    throw error
  }
}

async function readFastSummaryMeta(filePath: string): Promise<FastSummaryProjectionMeta> {
  await assertSafeMemoryDataFileTarget(filePath)
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    if (!isPlainRecord(parsed)) {
      return emptyMeta()
    }
    return {
      generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined,
      stale: parsed.stale === true,
      staleReason: typeof parsed.staleReason === 'string' ? parsed.staleReason : undefined,
      sourceLatestAt: typeof parsed.sourceLatestAt === 'string' ? parsed.sourceLatestAt : undefined,
      staleMarkedAt: typeof parsed.staleMarkedAt === 'string' ? parsed.staleMarkedAt : undefined
    }
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) return emptyMeta()
    throw error
  }
}

function emptyMeta(): FastSummaryProjectionMeta {
  return { generatedAt: undefined, stale: false, staleReason: undefined, sourceLatestAt: undefined }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
