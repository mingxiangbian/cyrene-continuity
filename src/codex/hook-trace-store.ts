import { randomUUID } from 'node:crypto'
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSafeMemoryDataFileTarget } from '../memory/memory-store.js'
import { codexProjectMemoryRoot, ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'
import { redactReviewText } from './review-redaction.js'

const HOOK_TRACE_FILE = 'hook-trace.jsonl'
const DEFAULT_LIMIT = 100
const SUMMARY_MAX_LENGTH = 500
const SIGNAL_MAX_LENGTH = 240
const COMMAND_SUMMARY_MAX_LENGTH = 500
const OUTPUT_SUMMARY_MAX_LENGTH = 500
const MAX_TOUCHED_FILES = 50

export type CodexHookTraceEventName = 'session_start' | 'user_prompt_submit' | 'post_tool_use' | 'stop'

export interface CodexHookTraceTool {
  name: string
  useId?: string
  commandSummary?: string
  exitCode?: number
  touchedFiles?: string[]
  outputSummary?: string
}

export interface CodexHookTraceRecord {
  id: string
  createdAt: string
  sessionId?: string
  turnId?: string
  event: CodexHookTraceEventName
  cwd: string
  summary: string
  signals: string[]
  tool?: CodexHookTraceTool
}

export async function appendCodexHookTrace(input: {
  cwd: string
  event: CodexHookTraceEventName
  sessionId?: string
  turnId?: string
  summary: string
  signals?: string[]
  tool?: CodexHookTraceTool
  now?: string
}): Promise<CodexHookTraceRecord> {
  const project = await identifyCodexProject(input.cwd)
  const memoryRoot = await ensureCodexProjectMemoryRoot(project.projectId)
  const targetPath = join(memoryRoot, HOOK_TRACE_FILE)
  await assertSafeMemoryDataFileTarget(targetPath)

  const record: CodexHookTraceRecord = {
    id: randomUUID(),
    createdAt: cleanString(input.now ?? new Date().toISOString()),
    event: input.event,
    cwd: cleanString(project.cwd),
    summary: cleanString(input.summary, SUMMARY_MAX_LENGTH),
    signals: (input.signals ?? []).map((signal) => cleanString(signal, SIGNAL_MAX_LENGTH)),
    ...(input.sessionId === undefined ? {} : { sessionId: cleanString(input.sessionId) }),
    ...(input.turnId === undefined ? {} : { turnId: cleanString(input.turnId) }),
    ...(input.tool === undefined ? {} : { tool: cleanTool(input.tool) })
  }

  await appendFile(targetPath, `${JSON.stringify(record)}\n`, 'utf8')
  return record
}

export async function readRecentCodexHookTrace(input: {
  cwd: string
  limit?: number
  now?: string
  maxAgeDays?: number
}): Promise<{ records: CodexHookTraceRecord[]; warnings: string[] }> {
  const project = await identifyCodexProject(input.cwd)
  const memoryRoot = await ensureCodexProjectMemoryRoot(project.projectId)
  const targetPath = join(codexProjectMemoryRoot(project.projectId), HOOK_TRACE_FILE)
  await assertSafeMemoryDataFileTarget(targetPath)

  let content: string
  try {
    content = await readFile(join(memoryRoot, HOOK_TRACE_FILE), 'utf8')
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return { records: [], warnings: [] }
    }
    throw error
  }

  const warnings: string[] = []
  const records: CodexHookTraceRecord[] = []
  const lines = content.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }

    try {
      records.push(JSON.parse(trimmed) as CodexHookTraceRecord)
    } catch {
      warnings.push(`Malformed hook trace line ${index + 1} skipped.`)
    }
  }

  const newestLimit = Math.max(0, input.limit ?? DEFAULT_LIMIT)
  return {
    records: records
      .filter((record) => isWithinMaxAge(record, input.now, input.maxAgeDays))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-newestLimit),
    warnings
  }
}

function cleanTool(tool: CodexHookTraceTool | undefined): CodexHookTraceTool | undefined {
  if (tool === undefined) {
    return undefined
  }

  return {
    name: cleanString(tool.name),
    ...(tool.useId === undefined ? {} : { useId: cleanString(tool.useId) }),
    ...(tool.commandSummary === undefined
      ? {}
      : { commandSummary: cleanString(tool.commandSummary, COMMAND_SUMMARY_MAX_LENGTH) }),
    ...(tool.exitCode === undefined ? {} : { exitCode: tool.exitCode }),
    ...(tool.touchedFiles === undefined
      ? {}
      : { touchedFiles: tool.touchedFiles.slice(0, MAX_TOUCHED_FILES).map((file) => cleanString(file)) }),
    ...(tool.outputSummary === undefined
      ? {}
      : { outputSummary: cleanString(tool.outputSummary, OUTPUT_SUMMARY_MAX_LENGTH) })
  }
}

function cleanString(value: string, maxLength?: number): string {
  const redacted = redactReviewText(value).text
  return maxLength === undefined ? redacted : redacted.slice(0, maxLength)
}

function isWithinMaxAge(record: CodexHookTraceRecord, now: string | undefined, maxAgeDays: number | undefined): boolean {
  if (maxAgeDays === undefined) {
    return true
  }

  const createdAt = Date.parse(record.createdAt)
  const nowTime = Date.parse(now ?? new Date().toISOString())
  if (!Number.isFinite(createdAt) || !Number.isFinite(nowTime)) {
    return false
  }

  return createdAt >= nowTime - maxAgeDays * 24 * 60 * 60 * 1000
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
