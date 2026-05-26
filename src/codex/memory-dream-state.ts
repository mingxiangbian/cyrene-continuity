import { randomUUID } from 'node:crypto'
import { lstat, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureWritableMemoryRootPath } from '../memory/memory-store.js'

export interface CodexMemoryDreamState {
  lastDreamAt?: string
  nextDreamDueAt?: string
  dreamDue: boolean
  lastDreamStatus?: 'success' | 'skipped' | 'failed'
  lastDreamError?: string
}

const DREAM_STATE_FILE = 'dream-state.json'

export async function readCodexMemoryDreamState(memoryRoot: string): Promise<CodexMemoryDreamState> {
  let stats
  try {
    stats = await lstat(memoryRoot)
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return { dreamDue: false }
    }
    throw error
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to read dream state from symlink memory root: ${memoryRoot}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`Refusing to read dream state from non-directory memory root: ${memoryRoot}`)
  }

  try {
    const parsed = JSON.parse(await readFile(join(memoryRoot, DREAM_STATE_FILE), 'utf8')) as Partial<CodexMemoryDreamState>
    return {
      dreamDue: parsed.dreamDue === true,
      ...(typeof parsed.lastDreamAt === 'string' ? { lastDreamAt: parsed.lastDreamAt } : {}),
      ...(typeof parsed.nextDreamDueAt === 'string' ? { nextDreamDueAt: parsed.nextDreamDueAt } : {}),
      ...(isDreamStatus(parsed.lastDreamStatus) ? { lastDreamStatus: parsed.lastDreamStatus } : {}),
      ...(typeof parsed.lastDreamError === 'string' ? { lastDreamError: parsed.lastDreamError } : {})
    }
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return { dreamDue: false }
    }
    throw error
  }
}

export async function writeCodexMemoryDreamState(memoryRoot: string, state: CodexMemoryDreamState): Promise<void> {
  const root = await ensureWritableMemoryRootPath(memoryRoot)
  const targetPath = join(root, DREAM_STATE_FILE)
  const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(tempPath, targetPath)
}

export async function markCodexMemoryDreamDue(memoryRoot: string, now?: string): Promise<void> {
  const dueAt = now ?? new Date().toISOString()
  const current = await readCodexMemoryDreamState(memoryRoot)
  await writeCodexMemoryDreamState(memoryRoot, {
    ...current,
    dreamDue: true,
    nextDreamDueAt: dueAt
  })
}

export function nextDreamDueAt(now: string, intervalHours: number): string {
  const date = new Date(now)
  date.setUTCHours(date.getUTCHours() + intervalHours)
  return date.toISOString()
}

function isDreamStatus(value: unknown): value is CodexMemoryDreamState['lastDreamStatus'] {
  return value === 'success' || value === 'skipped' || value === 'failed'
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
