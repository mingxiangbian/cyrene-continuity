import { readFile } from 'node:fs/promises'
import { createDefaultConfig, type AppConfig } from '../config.js'
import { callModel as defaultCallModel } from '../llm-client.js'
import { listCodexPendingMemories } from './memory-review.js'
import { proposeCodexMemoryCandidate } from './memory-propose.js'
import { runCodexReviewSummary, stableEvidenceGroupId, type RunCodexReviewSummaryInput } from './review-summary-runtime.js'
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
  const transcriptPath = asString(payload.transcript_path) ?? asString(payload.transcriptPath)
  if (transcriptPath === undefined) {
    return { action: 'noop', reason: 'No transcript path provided.' }
  }

  const transcriptText = await readTranscriptText(transcriptPath)
  if (transcriptText === undefined) {
    return { action: 'noop', reason: 'No transcript messages found.' }
  }

  const messages = parseTranscriptMessages(transcriptText)
  if (messages.length === 0) {
    return { action: 'noop', reason: 'No transcript messages found.' }
  }

  const config = deps.config ?? createDefaultConfig(cwd)
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
    }
  })
}

export async function extractRecentExplicitMemoryInstruction(payload: CodexStopHookPayload): Promise<string | undefined> {
  const transcriptPath = asString(payload.transcript_path) ?? asString(payload.transcriptPath)
  if (transcriptPath === undefined) {
    return undefined
  }

  const transcriptText = await readTranscriptText(transcriptPath)
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

async function readTranscriptText(transcriptPath: string): Promise<string | undefined> {
  try {
    return await readFile(transcriptPath, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}
