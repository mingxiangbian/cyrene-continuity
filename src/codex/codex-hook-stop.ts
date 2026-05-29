import { randomUUID } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { createDefaultConfig, type AppConfig } from '../config.js'
import { callModel as defaultCallModel } from '../llm-client.js'
import { ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import { listCodexPendingMemories } from './memory-review.js'
import { proposeCodexMemoryCandidate } from './memory-propose.js'
import { identifyCodexProject } from './project-id.js'
import { redactReviewText } from './review-redaction.js'
import { runCodexReviewSummary, stableEvidenceGroupId, type RunCodexReviewSummaryInput } from './review-summary-runtime.js'
import { appendCodexReviewSummary } from './review-summary-store.js'
import { parseTranscriptMessages, type TranscriptMessage } from './transcript.js'

export interface CodexStopHookPayload {
  cwd?: unknown
  session_id?: unknown
  turn_id?: unknown
  transcript_path?: unknown
  transcriptPath?: unknown
  last_assistant_message?: unknown
  [key: string]: unknown
}

export type CodexStopHookResult =
  | { action: 'noop'; reason: string }
  | { action: 'summary'; summaryId: string; reason: string }
  | { action: 'pending'; candidateId?: string; candidateIds?: string[]; reason: string; summaryId?: string }
  | { action: 'reject'; reason: string; summaryId?: string }
  | { action: 'summary_failed'; reason: string; summaryId?: string }

export interface CodexStopHookDeps {
  callModel?: RunCodexReviewSummaryInput['callModel']
  confirmPendingCandidateIds?: (cwd: string, candidateIds: string[]) => Promise<string[]>
  config?: AppConfig
}

export interface CodexStopHookCommandOutput {
  continue: true
  suppressOutput: true
}

const DURABLE_SIGNAL = /记住|请记住|以后默认|之后默认|以后你要|以后请|from now on|please remember|remember that|default to/i
const GLOBAL_SCOPE_SIGNAL = /所有项目|全部项目|每个项目|所有 repo|全部 repo|全局|global|all projects|every project|all repos|every repo/i
const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024

export async function handleCodexStopHookCommand(): Promise<string> {
  let result: CodexStopHookResult
  try {
    const payload = await readJsonFromStdin()
    result = await handleCodexStopHookPayload(payload)
  } catch {
    result = { action: 'summary_failed', reason: 'Stop hook command failed.' }
  }
  return formatCodexStopHookCommandOutput(result)
}

export function formatCodexStopHookCommandOutput(_result: CodexStopHookResult): string {
  const output: CodexStopHookCommandOutput = {
    continue: true,
    suppressOutput: true
  }
  return `${JSON.stringify(output)}\n`
}

export async function readJsonFromStdin(): Promise<CodexStopHookPayload> {
  process.stdin.setEncoding('utf8')
  let text = ''
  for await (const chunk of process.stdin) {
    text += chunk
  }
  const trimmed = text.trim()
  return trimmed === '' ? {} : JSON.parse(trimmed) as CodexStopHookPayload
}

export async function handleCodexStopHookPayload(
  payload: CodexStopHookPayload,
  deps: CodexStopHookDeps = {}
): Promise<CodexStopHookResult> {
  const cwd = asString(payload.cwd) ?? process.cwd()
  try {
    return await handleCodexStopHookPayloadUnsafe(payload, deps, cwd)
  } catch (error) {
    return recordStopHookFailureSummary(cwd, payload, error)
  }
}

async function handleCodexStopHookPayloadUnsafe(
  payload: CodexStopHookPayload,
  deps: CodexStopHookDeps,
  cwd: string
): Promise<CodexStopHookResult> {
  const config = deps.config ?? createDefaultConfig(cwd)
  if (!config.memoryAutoExtractEnabled) {
    return { action: 'noop', reason: 'Codex memory auto extraction is disabled.' }
  }

  const transcriptPath = asString(payload.transcript_path) ?? asString(payload.transcriptPath)
  if (transcriptPath === undefined) {
    return { action: 'noop', reason: 'No transcript path provided.' }
  }

  const transcriptText = await readTranscriptText(cwd, transcriptPath)
  if (transcriptText === undefined) {
    return { action: 'noop', reason: 'No transcript messages found.' }
  }

  const messages = parseTranscriptMessages(transcriptText)
  if (messages.length === 0) {
    return { action: 'noop', reason: 'No transcript messages found.' }
  }

  const review = await runCodexReviewSummary({
    cwd,
    sessionId: asString(payload.session_id),
    turnId: asString(payload.turn_id),
    messages,
    config,
    callModel: deps.callModel ?? defaultCallModel,
    signal: AbortSignal.timeout(20_000)
  })
  const instruction = extractRecentExplicitMemoryInstructionFromMessages(messages)
  const explicitResult = instruction === undefined
    ? undefined
    : await proposeExplicitMemoryCandidate(payload, cwd, instruction)

  const reviewCandidateIds = review.action === 'pending' ? review.candidateIds : []
  const explicitPending = explicitResult?.result.action === 'pending' ? explicitResult.result : undefined
  const explicitCandidateId = explicitPending?.candidateId
  const proposedCandidateIds = [...reviewCandidateIds, ...(explicitCandidateId === undefined ? [] : [explicitCandidateId])]
  const candidateIds = proposedCandidateIds.length === 0
    ? []
    : await confirmPendingCandidateIds(deps.confirmPendingCandidateIds, cwd, proposedCandidateIds)
  const confirmedExplicitCandidateId =
    explicitCandidateId !== undefined && candidateIds.includes(explicitCandidateId) ? explicitCandidateId : undefined
  const summaryId = 'summaryId' in review ? review.summaryId : undefined

  if (candidateIds.length > 0) {
    return {
      action: 'pending',
      candidateId: confirmedExplicitCandidateId,
      candidateIds,
      reason: confirmedExplicitCandidateId === undefined
        ? 'Codex review summary proposed memory candidates.'
        : explicitPending?.reason ?? 'Codex review summary proposed memory candidates.',
      summaryId
    }
  }

  if (proposedCandidateIds.length > 0) {
    if (review.action === 'pending') {
      return {
        action: 'summary',
        summaryId: review.summaryId,
        reason: 'Codex review summary written; pending candidates were not confirmed in memory storage.'
      }
    }
    if (review.action === 'summary') {
      return {
        action: 'summary',
        summaryId: review.summaryId,
        reason: 'Codex review summary written; pending candidates were not confirmed in memory storage.'
      }
    }
    if (review.action === 'summary_failed') {
      return { action: 'summary_failed', summaryId: review.summaryId, reason: review.reason }
    }
    return { action: 'noop', reason: 'Pending memory candidates were not confirmed in memory storage.' }
  }

  if (review.action === 'summary') {
    return { action: 'summary', summaryId: review.summaryId, reason: 'Codex review summary written.' }
  }
  if (review.action === 'summary_failed') {
    return { action: 'summary_failed', summaryId: review.summaryId, reason: review.reason }
  }
  if (review.action === 'noop') {
    return { action: 'noop', reason: review.reason }
  }
  return { action: 'noop', reason: 'Codex review summary proposed no memory candidates.' }
}

async function recordStopHookFailureSummary(
  cwd: string,
  payload: CodexStopHookPayload,
  error: unknown
): Promise<CodexStopHookResult> {
  try {
    const project = await identifyCodexProject(cwd)
    const memoryRoot = await ensureCodexProjectMemoryRoot(project.projectId)
    const summaryId = randomUUID()
    const sessionId = asString(payload.session_id)
    const turnId = asString(payload.turn_id)
    const runId = [sessionId, turnId].filter(Boolean).join(':') || summaryId
    const reason = redactReviewText(error instanceof Error ? error.message : String(error))
    const failureReason = reason.text.slice(0, 500)
    await appendCodexReviewSummary(memoryRoot, {
      id: summaryId,
      runId,
      sessionId,
      turnId,
      createdAt: new Date().toISOString(),
      status: 'failed',
      summary: 'Codex Stop hook failed; no transcript content persisted.',
      redaction: { input: {}, output: reason.counts },
      candidateIds: [],
      failureReason
    })
    return { action: 'summary_failed', summaryId, reason: failureReason }
  } catch {
    return { action: 'summary_failed', reason: 'Stop hook command failed.' }
  }
}

async function confirmPendingCandidateIds(
  confirm: CodexStopHookDeps['confirmPendingCandidateIds'],
  cwd: string,
  candidateIds: string[]
): Promise<string[]> {
  try {
    const confirmed = await (confirm ?? filterExistingPendingCandidateIds)(cwd, candidateIds)
    const confirmedSet = new Set(confirmed)
    return uniqueInOrder(candidateIds).filter((id) => confirmedSet.has(id))
  } catch {
    return []
  }
}

export async function filterExistingPendingCandidateIds(cwd: string, candidateIds: string[]): Promise<string[]> {
  const ids = uniqueInOrder(candidateIds)
  if (ids.length === 0) {
    return []
  }

  const pending = await listCodexPendingMemories({ cwd })
  const existing = new Set(pending.pending.map((candidate) => candidate.id))
  return ids.filter((id) => existing.has(id))
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    if (seen.has(value)) {
      return false
    }
    seen.add(value)
    return true
  })
}

async function proposeExplicitMemoryCandidate(
  payload: CodexStopHookPayload,
  cwd: string,
  instruction: string
): Promise<Awaited<ReturnType<typeof proposeCodexMemoryCandidate>>> {
  const runId = [asString(payload.session_id), asString(payload.turn_id)].filter(Boolean).join(':') || undefined
  const sessionId = asString(payload.session_id)
  const content = instruction.slice(0, 500)
  return proposeCodexMemoryCandidate({
    cwd,
    candidate: {
      domain: 'procedural',
      type: 'procedural_rule',
      strength: 'hard',
      scope: GLOBAL_SCOPE_SIGNAL.test(instruction) ? 'global' : 'project',
      source: 'user_explicit',
      content,
      evidence: [
        {
          runId,
          sessionId,
          sourceKind: 'user_explicit',
          evidenceGroupId: stableEvidenceGroupId({
            runId,
            sessionId,
            quote: content,
            summary: 'Codex Stop hook captured explicit durable user instruction.'
          }),
          quote: content,
          summary: 'Codex Stop hook captured explicit durable user instruction.'
        }
      ],
      tags: ['codex-hook', 'explicit-memory']
    },
    recordRejectedCandidate: false
  })
}

export async function extractRecentExplicitMemoryInstruction(payload: CodexStopHookPayload): Promise<string | undefined> {
  const transcriptPath = asString(payload.transcript_path) ?? asString(payload.transcriptPath)
  if (transcriptPath === undefined) {
    return undefined
  }

  const cwd = asString(payload.cwd) ?? process.cwd()
  const transcriptText = await readTranscriptText(cwd, transcriptPath)
  if (transcriptText === undefined) {
    return undefined
  }

  const messages = parseTranscriptMessages(transcriptText)
  return extractRecentExplicitMemoryInstructionFromMessages(messages)
}

function extractRecentExplicitMemoryInstructionFromMessages(messages: TranscriptMessage[]): string | undefined {
  const userMessages = messages.filter((message) => message.role === 'user')
  return userMessages.reverse().find((message) => DURABLE_SIGNAL.test(message.content))?.content
}

async function readTranscriptText(cwd: string, transcriptPath: string): Promise<string | undefined> {
  try {
    const safePath = await resolveSafeTranscriptPath(cwd, transcriptPath)
    return await readFile(safePath, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

async function resolveSafeTranscriptPath(cwd: string, transcriptPath: string): Promise<string> {
  const resolved = isAbsolute(transcriptPath) ? transcriptPath : resolve(cwd, transcriptPath)
  const stats = await lstat(resolved)
  if (stats.isSymbolicLink()) {
    throw new Error('Transcript path is a symlink.')
  }
  if (!stats.isFile()) {
    throw new Error('Transcript path is not a regular file.')
  }
  if (stats.size > MAX_TRANSCRIPT_BYTES) {
    throw new Error('Transcript path exceeds the maximum readable size.')
  }
  const safePath = await realpath(resolved)
  const allowedRoots = await allowedTranscriptRoots(cwd)
  if (!allowedRoots.some((root) => isPathInside(root, safePath))) {
    throw new Error('Transcript path must be inside the project cwd or Codex home.')
  }
  return safePath
}

async function allowedTranscriptRoots(cwd: string): Promise<string[]> {
  const roots = [cwd, codexHomePath()].filter((root): root is string => root !== undefined)
  const realRoots: string[] = []
  for (const root of roots) {
    try {
      realRoots.push(await realpath(root))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue
      }
      throw error
    }
  }
  return Array.from(new Set(realRoots))
}

function codexHomePath(): string | undefined {
  const configured = process.env.CODEX_HOME?.trim()
  if (configured !== undefined && configured !== '') {
    return configured
  }
  const home = process.env.HOME?.trim()
  return home === undefined || home === '' ? undefined : join(home, '.codex')
}

function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}
