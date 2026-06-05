import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSafeMemoryDataFileTarget } from '../memory/memory-store.js'

const SESSION_HINTS_FILE = 'session_hints.json'
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000

export interface CodexSessionHint {
  id: string
  sourceProjectId: string
  sourceProjectName?: string
  summary: string
  createdAt: string
}

export interface ReplaceCodexSessionHintsInput {
  sessionId: string
  projectId: string
  hints: CodexSessionHint[]
  now?: string
  ttlMs?: number
}

export interface ReadCodexSessionHintsInput {
  sessionId: string
  projectId: string
  now?: string
}

interface CodexSessionHintsFile {
  sessionId: string
  projectId: string
  updatedAt: string
  expiresAt: string
  hints: CodexSessionHint[]
}

export async function replaceCodexSessionHints(
  memoryRoot: string,
  input: ReplaceCodexSessionHintsInput
): Promise<void> {
  await mkdir(memoryRoot, { recursive: true })
  const targetPath = join(memoryRoot, SESSION_HINTS_FILE)
  await assertSafeMemoryDataFileTarget(targetPath)
  const updatedAt = input.now ?? new Date().toISOString()
  const expiresAt = new Date(Date.parse(updatedAt) + (input.ttlMs ?? DEFAULT_TTL_MS)).toISOString()
  const record: CodexSessionHintsFile = {
    sessionId: input.sessionId,
    projectId: input.projectId,
    updatedAt,
    expiresAt,
    hints: input.hints.map(cleanSessionHint)
  }
  await writeFile(targetPath, `${JSON.stringify(record)}\n`, 'utf8')
}

export async function readCodexSessionHints(
  memoryRoot: string,
  input: ReadCodexSessionHintsInput
): Promise<CodexSessionHint[]> {
  const targetPath = join(memoryRoot, SESSION_HINTS_FILE)
  await assertSafeMemoryDataFileTarget(targetPath)

  let content: string
  try {
    content = await readFile(targetPath, 'utf8')
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) return []
    throw error
  }

  const parsed = JSON.parse(content) as unknown
  if (!isCodexSessionHintsFile(parsed)) {
    return []
  }
  if (parsed.sessionId !== input.sessionId || parsed.projectId !== input.projectId) {
    return []
  }
  if (Date.parse(parsed.expiresAt) < Date.parse(input.now ?? new Date().toISOString())) {
    return []
  }
  return parsed.hints
}

export async function clearCodexSessionHints(memoryRoot: string): Promise<void> {
  const targetPath = join(memoryRoot, SESSION_HINTS_FILE)
  await assertSafeMemoryDataFileTarget(targetPath)
  await rm(targetPath, { force: true })
}

function cleanSessionHint(hint: CodexSessionHint): CodexSessionHint {
  return {
    id: hint.id,
    sourceProjectId: hint.sourceProjectId,
    ...(hint.sourceProjectName === undefined ? {} : { sourceProjectName: hint.sourceProjectName }),
    summary: hint.summary,
    createdAt: hint.createdAt
  }
}

function isCodexSessionHintsFile(value: unknown): value is CodexSessionHintsFile {
  if (!isPlainRecord(value)) {
    return false
  }

  return (
    typeof value.sessionId === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.updatedAt === 'string' &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    typeof value.expiresAt === 'string' &&
    Number.isFinite(Date.parse(value.expiresAt)) &&
    Array.isArray(value.hints) &&
    value.hints.every(isCodexSessionHint)
  )
}

function isCodexSessionHint(value: unknown): value is CodexSessionHint {
  if (!isPlainRecord(value)) {
    return false
  }

  return (
    typeof value.id === 'string' &&
    typeof value.sourceProjectId === 'string' &&
    (value.sourceProjectName === undefined || typeof value.sourceProjectName === 'string') &&
    typeof value.summary === 'string' &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt))
  )
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
