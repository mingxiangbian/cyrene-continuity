import { randomUUID } from 'node:crypto'
import { lstat, open, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { createDefaultConfig, type AppConfig } from '../config.js'
import { callModel as defaultCallModel, modelBaseUrlRequiresApiKey } from '../llm-client.js'
import { runCodexAdmissionPipeline } from './admission-pipeline.js'
import { ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import { appendGlobalStopHookEpisodeFailOpen, appendStopHookEpisodeFailOpen } from './episode-memory.js'
import { candidateFromExplicitGlobalInstruction } from './global-memory-capture.js'
import { appendCodexHookTrace } from './hook-trace-store.js'
import { listCodexPendingMemories } from './memory-review.js'
import type { CodexMemoryCandidateInput } from './memory-propose.js'
import { identifyCodexProject } from './project-id.js'
import { isCodexProjectMemoryDisabled } from './project-registry.js'
import { runCodexProjectMemoryHarvest } from './project-memory-harvester.js'
import { redactReviewText } from './review-redaction.js'
import {
  CODEX_REVIEW_SUMMARY_MESSAGE_WINDOW,
  runCodexReviewSummary,
  stableEvidenceGroupId,
  type RunCodexReviewSummaryInput
} from './review-summary-runtime.js'
import { appendCodexReviewSummary } from './review-summary-store.js'
import { parseTranscriptMessages, recentTranscriptMessages, type TranscriptMessage } from './transcript.js'

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
  | { action: 'trial'; candidateIds?: string[]; memoryIds: string[]; reason: string; summaryId?: string }
  | { action: 'reject'; reason: string; summaryId?: string }
  | { action: 'summary_failed'; reason: string; summaryId?: string }

export interface CodexStopHookDeps {
  callModel?: RunCodexReviewSummaryInput['callModel']
  confirmPendingCandidateIds?: (cwd: string, candidateIds: string[]) => Promise<string[]>
  config?: AppConfig
}

export interface CodexStopHookCommandOutput {
  continue: true
  suppressOutput: boolean
  systemMessage?: string
}

type ReviewSummaryOrSkipResult =
  | Awaited<ReturnType<typeof runCodexReviewSummary>>
  | { action: 'summary'; summaryId: string; memoryRoot: string; candidateIds: []; reason: string }

const DURABLE_SIGNAL = /记住|请记住|以后默认|之后默认|以后你要|以后请|from now on|please remember|remember that|default to/i
const GLOBAL_SCOPE_SIGNAL = /所有项目|全部项目|每个项目|所有 repo|全部 repo|全局|global|all projects|every project|all repos|every repo/i
const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024

interface SafeTranscriptPath {
  path: string
  size: number
}

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

export function formatCodexStopHookCommandOutput(result: CodexStopHookResult): string {
  const output: CodexStopHookCommandOutput = {
    continue: true,
    suppressOutput: true
  }
  if (process.env.CYRENE_HOOK_VISIBLE === '1') {
    output.suppressOutput = false
    output.systemMessage = visibleHookMessage(result)
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
  const project = await identifyCodexProject(cwd)
  if (await isCodexProjectMemoryDisabled(project.projectId)) {
    return { action: 'noop', reason: 'Project memory is disabled for this project.' }
  }
  await appendStopHookTrace(cwd, payload)
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

  const stopEpisodeId = randomUUID()
  const review = await runReviewSummaryOrSkip({
    payload,
    cwd,
    messages,
    config,
    deps,
    sourceEpisodeIds: [stopEpisodeId]
  })
  const instruction = extractRecentExplicitMemoryInstructionFromMessages(messages)
  const episodeMessages = recentTranscriptMessages(messages, CODEX_REVIEW_SUMMARY_MESSAGE_WINDOW)
  const episodeInput = {
    id: stopEpisodeId,
    cwd,
    projectId: project.projectId,
    payload,
    messages: episodeMessages,
    summary: review.action === 'summary_failed'
      ? review.reason
      : review.action === 'pending'
        ? 'Codex Stop hook wrote review summary and proposed pending candidates.'
        : review.action === 'summary'
          ? 'Codex Stop hook wrote review summary.'
          : review.reason,
    actions: [
      'Parsed Codex Stop hook transcript.',
      review.action === 'pending' ? 'Proposed pending memory candidates.' : 'Wrote review-safe summary.'
    ],
    decisions: [],
    failures: review.action === 'summary_failed' ? [review.reason] : [],
    openQuestions: [],
    toolNames: ['stop_hook', 'review_summary']
  }
  await appendStopHookEpisodeFailOpen(episodeInput)
  if (shouldMirrorGlobalStopEpisode(messages, instruction)) {
    await appendGlobalStopHookEpisodeFailOpen(episodeInput)
  }
  const explicitResult = instruction === undefined || shouldSkipExplicitMemoryFallback(instruction, review, messages)
    ? undefined
    : await proposeExplicitMemoryCandidate(payload, cwd, instruction, [stopEpisodeId])
  const harvest = await runProjectMemoryHarvestFailOpen({
    cwd,
    config,
    callModel: deps.callModel ?? defaultCallModel,
    sourceEpisodeIds: [stopEpisodeId],
    signal: AbortSignal.timeout(20_000)
  })

  const reviewCandidateIds = review.action === 'pending' ? review.candidateIds : []
  const explicitPending =
    explicitResult?.action === 'pending' && explicitResult.result.action === 'pending' ? explicitResult.result : undefined
  const explicitCandidateId = explicitPending?.candidateId
  const harvestCandidateIds = harvest?.action === 'pending' ? harvest.candidateIds : []
  const harvestTrialMemoryIds = harvest?.action === 'trial'
    ? harvest.memoryIds
    : harvest?.action === 'pending'
      ? harvest.trialMemoryIds ?? []
      : []
  const harvestTrialCandidateIds = harvest?.action === 'trial' ? harvest.candidateIds : []
  const proposedCandidateIds = [
    ...reviewCandidateIds,
    ...(explicitCandidateId === undefined ? [] : [explicitCandidateId]),
    ...harvestCandidateIds
  ]
  const candidateIds = proposedCandidateIds.length === 0
    ? []
    : await confirmPendingCandidateIds(deps.confirmPendingCandidateIds, cwd, proposedCandidateIds)
  const confirmedExplicitCandidateId =
    explicitCandidateId !== undefined && candidateIds.includes(explicitCandidateId) ? explicitCandidateId : undefined
  const confirmedHarvestCandidateIds = harvestCandidateIds.filter((id) => candidateIds.includes(id))
  const summaryId = 'summaryId' in review ? review.summaryId : undefined

  if (candidateIds.length > 0) {
    return {
      action: 'pending',
      candidateId: confirmedExplicitCandidateId,
      candidateIds,
      reason: pendingReason({
        hasHarvestCandidates: confirmedHarvestCandidateIds.length > 0,
        explicitReason: confirmedExplicitCandidateId === undefined ? undefined : explicitPending?.reason
      }),
      summaryId
    }
  }

  if (harvestTrialMemoryIds.length > 0) {
    return {
      action: 'trial',
      candidateIds: harvestTrialCandidateIds,
      memoryIds: harvestTrialMemoryIds,
      reason: 'Codex project memory harvest admitted trial memories.',
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
    return {
      action: 'summary',
      summaryId: review.summaryId,
      reason: 'reason' in review ? review.reason : 'Codex review summary written.'
    }
  }
  if (review.action === 'summary_failed') {
    return { action: 'summary_failed', summaryId: review.summaryId, reason: review.reason }
  }
  if (review.action === 'noop') {
    return { action: 'noop', reason: review.reason }
  }
  return { action: 'noop', reason: 'Codex review summary proposed no memory candidates.' }
}

async function appendStopHookTrace(cwd: string, payload: CodexStopHookPayload): Promise<void> {
  try {
    const transcriptPath = asString(payload.transcript_path) ?? asString(payload.transcriptPath)
    await appendCodexHookTrace({
      cwd,
      event: 'stop',
      sessionId: asString(payload.session_id),
      turnId: asString(payload.turn_id),
      summary: 'Stop hook received.',
      signals: [
        transcriptPath === undefined ? undefined : 'transcript path provided',
        asString(payload.last_assistant_message) === undefined ? undefined : 'last assistant message provided'
      ].filter((signal): signal is string => signal !== undefined)
    })
  } catch {
    // Trace collection must never fail the Stop hook.
  }
}

async function runProjectMemoryHarvestFailOpen(input: Parameters<typeof runCodexProjectMemoryHarvest>[0]): Promise<Awaited<ReturnType<typeof runCodexProjectMemoryHarvest>> | undefined> {
  try {
    return await runCodexProjectMemoryHarvest(input)
  } catch {
    return undefined
  }
}

async function runReviewSummaryOrSkip(input: {
  payload: CodexStopHookPayload
  cwd: string
  messages: TranscriptMessage[]
  config: AppConfig
  deps: CodexStopHookDeps
  sourceEpisodeIds?: string[]
}): Promise<ReviewSummaryOrSkipResult> {
  if (input.deps.callModel === undefined && !isMemoryExtractionModelConfigured(input.config)) {
    return recordModelConfigSkippedSummary(input.cwd, input.payload)
  }

  return runCodexReviewSummary({
    cwd: input.cwd,
    sessionId: asString(input.payload.session_id),
    turnId: asString(input.payload.turn_id),
    messages: input.messages,
    config: input.config,
    callModel: input.deps.callModel ?? defaultCallModel,
    sourceEpisodeIds: input.sourceEpisodeIds,
    signal: AbortSignal.timeout(20_000)
  })
}

function isMemoryExtractionModelConfigured(config: AppConfig): boolean {
  const routeModel = config.model.cheapModel || config.model.strongModel || config.model.model
  return config.model.baseUrl.trim() !== ''
    && config.model.model.trim() !== ''
    && routeModel.trim() !== ''
    && (!modelBaseUrlRequiresApiKey(config.model.baseUrl) || Boolean(config.model.apiKey?.trim()))
}

function pendingReason(input: { hasHarvestCandidates: boolean; explicitReason?: string }): string {
  if (input.hasHarvestCandidates) {
    if (input.explicitReason !== undefined) {
      return `${input.explicitReason} Codex project memory harvest proposed pending candidates.`
    }
    return 'Codex review summary and project memory harvest proposed pending candidates.'
  }
  return input.explicitReason ?? 'Codex review summary proposed memory candidates.'
}

function visibleHookMessage(result: CodexStopHookResult): string {
  const summary = result.action === 'summary_failed'
    ? 'failed'
    : result.action === 'noop' ? 'none' : 'ok'
  const candidateIds = 'candidateIds' in result && Array.isArray(result.candidateIds)
    ? result.candidateIds
    : 'candidateId' in result && typeof result.candidateId === 'string' ? [result.candidateId] : []
  const memoryIds = 'memoryIds' in result && Array.isArray(result.memoryIds) ? result.memoryIds : []
  return `Cyrene captured this session: summary=${summary}, pending=${uniqueInOrder(candidateIds).length}, trial=${uniqueInOrder(memoryIds).length}. Review: cyrene-continuity codex memory review`
}

async function recordStopHookFailureSummary(
  cwd: string,
  payload: CodexStopHookPayload,
  error: unknown
): Promise<CodexStopHookResult> {
  try {
    const project = await identifyCodexProject(cwd)
    if (await isCodexProjectMemoryDisabled(project.projectId)) {
      return { action: 'noop', reason: 'Project memory is disabled for this project.' }
    }
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

async function recordModelConfigSkippedSummary(
  cwd: string,
  payload: CodexStopHookPayload
): Promise<Extract<ReviewSummaryOrSkipResult, { action: 'summary'; reason: string }>> {
  const project = await identifyCodexProject(cwd)
  if (await isCodexProjectMemoryDisabled(project.projectId)) {
    return {
      action: 'summary',
      summaryId: '',
      memoryRoot: codexDisabledMemoryRoot(project.projectId),
      candidateIds: [],
      reason: 'Project memory is disabled for this project.'
    }
  }
  const memoryRoot = await ensureCodexProjectMemoryRoot(project.projectId)
  const summaryId = randomUUID()
  const sessionId = asString(payload.session_id)
  const turnId = asString(payload.turn_id)
  const runId = [sessionId, turnId].filter(Boolean).join(':') || summaryId
  await appendCodexReviewSummary(memoryRoot, {
    id: summaryId,
    runId,
    sessionId,
    turnId,
    createdAt: new Date().toISOString(),
    status: 'ok',
    summary: 'Codex Stop hook skipped LLM review summary because model config is incomplete.',
    redaction: { input: {}, output: {} },
    candidateIds: []
  })
  return {
    action: 'summary',
    summaryId,
    memoryRoot,
    candidateIds: [],
    reason: 'Codex review summary skipped because model config is incomplete.'
  }
}

function codexDisabledMemoryRoot(projectId: string): string {
  return `disabled:${projectId}`
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
  instruction: string,
  sourceEpisodeIds: string[]
): Promise<Awaited<ReturnType<typeof runCodexAdmissionPipeline>>> {
  const runId = [asString(payload.session_id), asString(payload.turn_id)].filter(Boolean).join(':') || undefined
  const sessionId = asString(payload.session_id)
  const content = instruction.slice(0, 500)
  const candidate = {
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
  } satisfies CodexMemoryCandidateInput
  return runCodexAdmissionPipeline({
    cwd,
    candidate,
    sourceKind: 'user_explicit',
    sourceEpisodeIds,
    now: undefined,
    recordRejectedCandidate: false,
    allowAutoPromote: false
  })
}

function shouldMirrorGlobalStopEpisode(messages: TranscriptMessage[], instruction: string | undefined): boolean {
  if (instruction !== undefined && GLOBAL_SCOPE_SIGNAL.test(instruction)) {
    return true
  }

  return recentTranscriptMessages(messages, CODEX_REVIEW_SUMMARY_MESSAGE_WINDOW).some((message) =>
    message.role === 'user' &&
    candidateFromExplicitGlobalInstruction({
      text: redactReviewText(message.content).text,
      now: new Date(0).toISOString()
    }) !== undefined
  )
}

function shouldSkipExplicitMemoryFallback(
  instruction: string,
  review: ReviewSummaryOrSkipResult,
  messages: TranscriptMessage[]
): boolean {
  if (!reviewSummaryRanExtraction(review)) {
    return false
  }
  if (!recentTranscriptMessages(messages, CODEX_REVIEW_SUMMARY_MESSAGE_WINDOW).some((message) =>
    message.role === 'user' && message.content === instruction
  )) {
    return false
  }

  return candidateFromExplicitGlobalInstruction({
    text: redactReviewText(instruction).text,
    now: new Date(0).toISOString()
  }) !== undefined
}

function reviewSummaryRanExtraction(review: ReviewSummaryOrSkipResult): boolean {
  return review.action === 'pending' || (review.action === 'summary' && !('reason' in review))
}

function extractRecentExplicitMemoryInstructionFromMessages(messages: TranscriptMessage[]): string | undefined {
  const userMessages = messages.filter((message) => message.role === 'user')
  return userMessages.reverse().find((message) => DURABLE_SIGNAL.test(message.content))?.content
}

async function readTranscriptText(cwd: string, transcriptPath: string): Promise<string | undefined> {
  try {
    const safePath = await resolveSafeTranscriptPath(cwd, transcriptPath)
    if (safePath.size > MAX_TRANSCRIPT_BYTES) {
      return readTranscriptTail(safePath)
    }
    return await readFile(safePath.path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

async function resolveSafeTranscriptPath(cwd: string, transcriptPath: string): Promise<SafeTranscriptPath> {
  const resolved = isAbsolute(transcriptPath) ? transcriptPath : resolve(cwd, transcriptPath)
  const stats = await lstat(resolved)
  if (stats.isSymbolicLink()) {
    throw new Error('Transcript path is a symlink.')
  }
  if (!stats.isFile()) {
    throw new Error('Transcript path is not a regular file.')
  }
  const safePath = await realpath(resolved)
  const allowedRoots = await allowedTranscriptRoots(cwd)
  if (!allowedRoots.some((root) => isPathInside(root, safePath))) {
    throw new Error('Transcript path must be inside the project cwd or Codex home.')
  }
  return { path: safePath, size: stats.size }
}

async function readTranscriptTail(target: SafeTranscriptPath): Promise<string | undefined> {
  const length = Math.min(target.size, MAX_TRANSCRIPT_BYTES)
  const start = Math.max(0, target.size - length)
  const file = await open(target.path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const result = await file.read(buffer, 0, length, start)
    let text = buffer.subarray(0, result.bytesRead).toString('utf8')
    if (start > 0) {
      const firstNewline = text.indexOf('\n')
      text = firstNewline === -1 ? '' : text.slice(firstNewline + 1)
    }
    return text.trim() === '' ? undefined : text
  } finally {
    await file.close()
  }
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
