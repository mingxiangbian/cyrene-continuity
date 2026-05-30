import { createHash, randomUUID } from 'node:crypto'
import { ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import { candidateFromExplicitGlobalInstruction } from './global-memory-capture.js'
import { type CodexMemoryCandidateInput, proposeCodexMemoryCandidate } from './memory-propose.js'
import { identifyCodexProject } from './project-id.js'
import { redactReviewText, mergeRedactionCounts } from './review-redaction.js'
import { appendCodexReviewSummary } from './review-summary-store.js'
import { recentTranscriptMessages, type TranscriptMessage } from './transcript.js'
import type { AppConfig } from '../config.js'
import type { CallModelInput, ModelResponse } from '../llm-client.js'
import { isMemoryCandidateKind } from '../memory/candidate-kind.js'
import {
  MEMORY_DOMAINS,
  MEMORY_SCOPES,
  MEMORY_SOURCES,
  MEMORY_STRENGTHS,
  MEMORY_TYPES,
  type MemoryEvidence,
  type MemorySource
} from '../memory/types.js'

export type CodexReviewSummaryResult =
  | { action: 'noop'; reason: string }
  | { action: 'summary'; summaryId: string; memoryRoot: string; candidateIds: [] }
  | { action: 'pending'; summaryId: string; memoryRoot: string; candidateIds: string[] }
  | { action: 'summary_failed'; summaryId: string; memoryRoot: string; reason: string }

export interface RunCodexReviewSummaryInput {
  cwd: string
  sessionId?: string
  turnId?: string
  messages: TranscriptMessage[]
  config: AppConfig
  callModel: (input: CallModelInput) => Promise<ModelResponse>
  now?: string
  signal?: AbortSignal
}

interface ParsedReviewSummary {
  summary: string
  candidates: unknown[]
}

const FAILED_SUMMARY = 'Codex review summary failed; no transcript content persisted.'
const GENERATED_MEMORY_CONTENT_MAX_LENGTH = 240
const GENERATED_MEMORY_EVIDENCE_MAX_LENGTH = 320

export async function runCodexReviewSummary(input: RunCodexReviewSummaryInput): Promise<CodexReviewSummaryResult> {
  const window = recentTranscriptMessages(input.messages, 40)
  if (window.length === 0) {
    return { action: 'noop', reason: 'No transcript messages to summarize.' }
  }

  const project = await identifyCodexProject(input.cwd)
  const memoryRoot = await ensureCodexProjectMemoryRoot(project.projectId)
  const summaryId = randomUUID()
  const runId = [input.sessionId, input.turnId].filter(Boolean).join(':') || summaryId
  const createdAt = input.now ?? new Date().toISOString()
  const inputRedaction = redactReviewText(formatMessages(window))
  const model = { useCase: 'memory_extraction' as const, model: input.config.model.cheapModel || input.config.model.strongModel }

  try {
    const response = await input.callModel({
      config: input.config,
      messages: [{ role: 'user', content: buildCodexReviewSummaryPrompt(inputRedaction.text) }],
      tools: [],
      useCase: 'memory_extraction',
      signal: input.signal
    })
    const parsed = parseReviewSummaryResponse(response.content)
    const outputRedaction = createOutputRedactor()
    const summary = outputRedaction.redact(parsed.summary)
    const candidateIds: string[] = []

    for (const candidate of parsed.candidates) {
      const safeCandidate = redactCandidate(candidate, runId, input.sessionId, summary, outputRedaction, input.config)
      if (safeCandidate === undefined) {
        continue
      }

      const result = await proposeCodexMemoryCandidate({
        cwd: input.cwd,
        candidate: safeCandidate,
        now: input.now,
        recordRejectedCandidate: false
      })
      if (result.result.action === 'pending') {
        candidateIds.push(result.result.candidateId)
      }
    }

    for (const message of window.filter((entry) => entry.role === 'user')) {
      const globalCandidate = candidateFromExplicitGlobalInstruction({
        text: redactReviewText(message.content).text,
        now: createdAt
      })
      if (globalCandidate === undefined) {
        continue
      }

      const result = await proposeCodexMemoryCandidate({
        cwd: input.cwd,
        candidate: globalCandidate,
        now: input.now,
        recordRejectedCandidate: false,
        allowAutoPromote: false
      })
      if (result.result.action === 'pending') {
        candidateIds.push(result.result.candidateId)
      }
    }

    await appendCodexReviewSummary(memoryRoot, {
      id: summaryId,
      runId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      createdAt,
      status: 'ok',
      summary,
      redaction: { input: inputRedaction.counts, output: outputRedaction.counts },
      model,
      candidateIds
    })

    if (candidateIds.length > 0) {
      return { action: 'pending', summaryId, memoryRoot, candidateIds }
    }
    return { action: 'summary', summaryId, memoryRoot, candidateIds: [] }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const failureRedaction = redactReviewText(reason)
    const redactedReason = failureRedaction.text.slice(0, 500)
    await appendCodexReviewSummary(memoryRoot, {
      id: summaryId,
      runId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      createdAt,
      status: 'failed',
      summary: FAILED_SUMMARY,
      redaction: { input: inputRedaction.counts, output: failureRedaction.counts },
      model,
      candidateIds: [],
      failureReason: redactedReason
    })
    return { action: 'summary_failed', summaryId, memoryRoot, reason: redactedReason }
  }
}

export function buildCodexReviewSummaryPrompt(redactedTranscript: string): string {
  return [
    'Return JSON only with this shape: {"summary":"review-safe summary","candidates":[]}.',
    'Prefer no candidates over weak candidates.',
    'Use only the redacted transcript text below.',
    'Do not store secrets, credentials, raw quotes, psychological diagnoses, or assistant-only suggestions.',
    'Write generated memory summaries, candidate content, and evidence summaries in Chinese by default.',
    'Keep English proper nouns and technical terms such as file paths, commands, APIs, libraries, model names, field names, and identifiers in English.',
    `Candidate content must be ${GENERATED_MEMORY_CONTENT_MAX_LENGTH} characters or fewer.`,
    `Evidence summaries and quotes must be ${GENERATED_MEMORY_EVIDENCE_MAX_LENGTH} characters or fewer.`,
    'Memory candidates must match the existing memory candidate schema.',
    'Candidates may include domain, type, strength, scope, content, normalizedKey, source, scores, evidence, and tags.',
    '',
    'Redacted transcript:',
    redactedTranscript
  ].join('\n')
}

export function parseReviewSummaryResponse(content: string): ParsedReviewSummary {
  const objectText = extractJsonObject(content)
  const parsed = JSON.parse(objectText) as unknown
  if (!isRecord(parsed) || typeof parsed.summary !== 'string' || parsed.summary.trim() === '') {
    throw new Error('Review summary response is missing summary.')
  }

  return {
    summary: parsed.summary,
    candidates: Array.isArray(parsed.candidates) ? parsed.candidates : []
  }
}

function formatMessages(messages: TranscriptMessage[]): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join('\n')
}

function redactCandidate(
  value: unknown,
  runId: string,
  sessionId: string | undefined,
  redactedSummary: string,
  redactor: ReturnType<typeof createOutputRedactor>,
  config: AppConfig
): CodexMemoryCandidateInput | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const domain = parseEnum(value.domain, MEMORY_DOMAINS)
  const type = parseEnum(value.type, MEMORY_TYPES)
  const content = parseBoundedString(
    value.content,
    redactor,
    Math.min(config.memorySingleContentMaxChars, GENERATED_MEMORY_CONTENT_MAX_LENGTH)
  )
  if (domain === undefined || type === undefined || content === undefined) {
    return undefined
  }

  const source = parseEnum(value.source, MEMORY_SOURCES)
  const candidateKind = isMemoryCandidateKind(value.candidateKind)
    ? value.candidateKind
    : isMemoryCandidateKind(value.candidate_kind)
      ? value.candidate_kind
      : undefined
  const candidate: CodexMemoryCandidateInput = {
    domain,
    type,
    ...(candidateKind === undefined ? {} : { candidateKind }),
    strength: parseEnum(value.strength, MEMORY_STRENGTHS),
    scope: parseEnum(value.scope, MEMORY_SCOPES),
    content,
    normalizedKey: redactOptionalString(value.normalizedKey, redactor),
    source,
    evidence: redactEvidence(
      value.evidence,
      runId,
      sessionId,
      redactedSummary,
      source ?? 'assistant_observed',
      redactor,
      Math.min(config.memorySingleEvidenceMaxChars, GENERATED_MEMORY_EVIDENCE_MAX_LENGTH)
    ),
    scores: parseScores(value.scores),
    tags: redactTags(value.tags, redactor)
  }

  return candidate
}

function redactEvidence(
  value: unknown,
  runId: string,
  sessionId: string | undefined,
  redactedSummary: string,
  sourceKind: MemorySource,
  redactor: ReturnType<typeof createOutputRedactor>,
  maxLength: number
): MemoryEvidence[] {
  const evidence = Array.isArray(value)
    ? value.flatMap((entry) => {
        if (!isRecord(entry)) {
          return []
        }
        const summary = parseBoundedString(entry.summary, redactor, maxLength)
        const quote = parseBoundedString(entry.quote, redactor, maxLength)
        if (summary === undefined && quote === undefined) {
          return []
        }
        return [evidenceEntry({ runId, sessionId, summary, quote, sourceKind })]
      })
    : []

  if (evidence.length > 0) {
    return evidence
  }
  return [evidenceEntry({ runId, sessionId, summary: truncateWithSuffix(redactedSummary, maxLength), sourceKind })]
}

export function stableEvidenceGroupId(input: {
  runId?: string
  sessionId?: string
  summary?: string
  quote?: string
}): string {
  return createHash('sha256')
    .update(JSON.stringify({
      runId: input.runId ?? null,
      sessionId: input.sessionId ?? null,
      summary: input.summary ?? null,
      quote: input.quote ?? null
    }))
    .digest('hex')
}

function evidenceEntry(input: {
  runId: string
  sessionId: string | undefined
  summary?: string
  quote?: string
  sourceKind: MemorySource
}): MemoryEvidence {
  return {
    runId: input.runId,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    summary: input.summary,
    quote: input.quote,
    sourceKind: input.sourceKind,
    evidenceGroupId: stableEvidenceGroupId(input)
  }
}

function redactTags(value: unknown, redactor: ReturnType<typeof createOutputRedactor>): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.flatMap((entry) => {
    const tag = parseString(entry)
    return tag === undefined ? [] : [redactor.redact(tag)]
  })
}

function redactOptionalString(value: unknown, redactor: ReturnType<typeof createOutputRedactor>): string | undefined {
  const text = parseString(value)
  return text === undefined ? undefined : redactor.redact(text)
}

function parseBoundedString(
  value: unknown,
  redactor: ReturnType<typeof createOutputRedactor>,
  maxLength: number
): string | undefined {
  const text = parseString(value)
  if (text === undefined) {
    return undefined
  }
  return truncateWithSuffix(redactor.redact(text.replace(/\s+/g, ' ').trim()), maxLength)
}

function truncateWithSuffix(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  if (maxChars <= 0) return ''
  if (maxChars <= 3) return '.'.repeat(maxChars)
  return `${value.slice(0, maxChars - 3)}...`
}

function parseScores(value: unknown): CodexMemoryCandidateInput['scores'] {
  if (!isRecord(value)) {
    return undefined
  }

  const scores: Record<string, number> = {}
  for (const key of ['evidenceStrength', 'stability', 'usefulness', 'safety', 'sensitivity']) {
    const score = value[key]
    if (typeof score === 'number' && Number.isFinite(score)) {
      scores[key] = score
    }
  }
  return Object.keys(scores).length > 0 ? scores : undefined
}

function extractJsonObject(content: string): string {
  const start = content.indexOf('{')
  if (start === -1) {
    throw new Error('Review summary response did not contain JSON.')
  }

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < content.length; index += 1) {
    const char = content[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return content.slice(start, index + 1)
      }
    }
  }

  throw new Error('Review summary response JSON was incomplete.')
}

function createOutputRedactor(): { counts: Record<string, number>; redact: (text: string) => string } {
  return {
    counts: {},
    redact(text: string): string {
      const result = redactReviewText(text)
      this.counts = mergeRedactionCounts(this.counts, result.counts)
      return result.text
    }
  }
}

function parseEnum<T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T[number] : undefined
}

function parseString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
