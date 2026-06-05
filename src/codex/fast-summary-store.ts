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
}

export async function readFastSummaryProjection(memoryRoot: string): Promise<FastSummaryProjection> {
  const [globalFastSummary, profileFastSummary, generatedAt] = await Promise.all([
    readOptionalSafeText(join(memoryRoot, GLOBAL_FAST_SUMMARY_FILE)),
    readOptionalSafeText(join(memoryRoot, PROFILE_FAST_SUMMARY_FILE)),
    readGeneratedAt(join(memoryRoot, FAST_SUMMARY_META_FILE))
  ])
  return { globalFastSummary, profileFastSummary, generatedAt }
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
    writeFile(metaPath, `${JSON.stringify({ generatedAt: projection.generatedAt ?? new Date().toISOString() })}\n`, 'utf8')
  ])
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

async function readGeneratedAt(filePath: string): Promise<string | undefined> {
  await assertSafeMemoryDataFileTarget(filePath)
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as { generatedAt?: unknown }
    return typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) return undefined
    throw error
  }
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
