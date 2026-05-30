import { createHash } from 'node:crypto'
import { type CodexMemoryCandidateInput, proposeCodexMemoryCandidate } from './memory-propose.js'
import {
  collectProjectMemorySignals,
  type CodexProjectHarvestMode,
  type ProjectMemorySignal
} from './project-memory-signals.js'
import { identifyCodexProject } from './project-id.js'
import { isCodexProjectMemoryDisabled } from './project-registry.js'
import { redactReviewText } from './review-redaction.js'
import type { AppConfig } from '../config.js'
import { modelBaseUrlRequiresApiKey, type CallModelInput, type ModelResponse } from '../llm-client.js'
import type { MemoryDomain, MemoryEvidence, MemorySource, MemoryType } from '../memory/types.js'

export type ProjectMemoryHarvesterCandidateKind =
  | 'project_fact'
  | 'project_decision'
  | 'workflow_rule'
  | 'known_pitfall'
  | 'rejected_approach'
  | 'open_question'

export interface RunCodexProjectMemoryHarvestInput {
  cwd: string
  config: AppConfig
  callModel: (input: CallModelInput) => Promise<ModelResponse>
  mode?: CodexProjectHarvestMode
  dryRun?: boolean
  now?: string
  signal?: AbortSignal
}

export type CodexProjectMemoryHarvestResult =
  | { action: 'noop'; reason: string; signals: ProjectMemorySignal[]; warnings: string[] }
  | { action: 'needs_model_config'; reason: string; signals: ProjectMemorySignal[]; warnings: string[] }
  | { action: 'preview'; candidates: CodexMemoryCandidateInput[]; signals: ProjectMemorySignal[]; warnings: string[] }
  | { action: 'pending'; candidateIds: string[]; memoryRoot: string; signals: ProjectMemorySignal[]; warnings: string[] }

interface ParsedProjectMemoryHarvestResponse {
  candidates: unknown[]
  summary?: string
}

const PROJECT_CANDIDATE_KINDS = [
  'project_fact',
  'project_decision',
  'workflow_rule',
  'known_pitfall',
  'rejected_approach',
  'open_question'
] as const satisfies readonly ProjectMemoryHarvesterCandidateKind[]

const SIGNAL_EVIDENCE_LIMIT = 6
const GENERATED_MEMORY_CONTENT_MAX_LENGTH = 240
const EVIDENCE_MAX_LENGTH = 320
const SENSITIVE_PROJECT_HARVEST_PATTERN =
  /\b(?:personal|private|family|medical|password|secret|token|api[_\s-]?key|bearer|sk-[a-z0-9_-]*)\b/i

export async function runCodexProjectMemoryHarvest(
  input: RunCodexProjectMemoryHarvestInput
): Promise<CodexProjectMemoryHarvestResult> {
  const project = await identifyCodexProject(input.cwd)
  if (await isCodexProjectMemoryDisabled(project.projectId)) {
    return {
      action: 'noop',
      reason: 'Project memory is disabled for this project.',
      signals: [],
      warnings: []
    }
  }

  const { signals, warnings } = await collectProjectMemorySignals({
    cwd: input.cwd,
    mode: input.mode,
    now: input.now
  })

  if (signals.length === 0) {
    return { action: 'noop', reason: 'No project memory signals collected.', signals, warnings }
  }

  const missingModelReason = missingModelConfigReason(input.config)
  if (missingModelReason !== undefined) {
    return { action: 'needs_model_config', reason: missingModelReason, signals, warnings }
  }

  const response = await input.callModel({
    config: input.config,
    messages: [{ role: 'user', content: buildCodexProjectMemoryHarvestPrompt(signals) }],
    tools: [],
    useCase: 'memory_extraction',
    signal: input.signal
  })
  const parsed = parseCodexProjectMemoryHarvestResponse(response.content)
  const candidates = parsed.candidates.flatMap((candidate) => {
    const sanitized = sanitizeProjectMemoryCandidate(candidate, signals, input.config)
    return sanitized === undefined ? [] : [sanitized]
  })

  if (input.dryRun === true) {
    return { action: 'preview', candidates, signals, warnings }
  }

  const candidateIds: string[] = []
  let memoryRoot: string | undefined
  for (const candidate of candidates) {
    const result = await proposeCodexMemoryCandidate({
      cwd: input.cwd,
      candidate,
      now: input.now,
      recordRejectedCandidate: false
    })
    memoryRoot = result.memoryRoot
    if (result.result.action === 'pending') {
      candidateIds.push(result.result.candidateId)
    }
  }

  if (candidateIds.length === 0) {
    return { action: 'noop', reason: 'No project memory candidates survived validation.', signals, warnings }
  }

  return { action: 'pending', candidateIds, memoryRoot: memoryRoot ?? '', signals, warnings }
}

export function buildCodexProjectMemoryHarvestPrompt(signals: ProjectMemorySignal[]): string {
  return [
    'Return JSON only with this shape: {"summary":"optional concise extraction summary","candidates":[]}.',
    'Extract durable project memory candidates only from the collected project signals below.',
    `Allowed candidate_kind values: ${PROJECT_CANDIDATE_KINDS.join(', ')}.`,
    'Prefer no candidates over weak candidates.',
    'Good candidates capture design decisions, confirmed workflows, rejected approaches, repeated pitfalls, project boundaries, and repository policies.',
    'Write generated memory summaries, candidate content, and evidence summaries in Chinese by default.',
    'Keep English proper nouns and technical terms such as file paths, commands, APIs, libraries, model names, field names, and identifiers in English.',
    `Candidate content must be ${GENERATED_MEMORY_CONTENT_MAX_LENGTH} characters or fewer.`,
    'Reject one-time status, vague impressions, assistant self-praise, user psychology, private data, secrets, credentials, temporary output, and raw command dumps.',
    'Each candidate should include candidateKind or candidate_kind, content, signalIndexes, and optional tags.',
    'signalIndexes must be 1-based indexes of the collected signals that support that specific candidate.',
    'Domain, type, scope, source, normalizedKey, and evidence will be normalized.',
    '',
    'Collected project signals:',
    formatSignalsForPrompt(signals)
  ].join('\n')
}

export function parseCodexProjectMemoryHarvestResponse(content: string): ParsedProjectMemoryHarvestResponse {
  const parsed = JSON.parse(extractJsonObject(content)) as unknown
  if (!isRecord(parsed)) {
    throw new Error('Project memory harvest response is not a JSON object.')
  }

  return {
    candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
    ...(typeof parsed.summary === 'string' ? { summary: parsed.summary } : {})
  }
}

function sanitizeProjectMemoryCandidate(
  value: unknown,
  signals: ProjectMemorySignal[],
  config: AppConfig
): CodexMemoryCandidateInput | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const candidateKind = parseProjectCandidateKind(value.candidateKind) ?? parseProjectCandidateKind(value.candidate_kind)
  if (candidateKind === undefined) {
    return undefined
  }

  const content = cleanString(
    value.content,
    Math.min(config.memorySingleContentMaxChars, GENERATED_MEMORY_CONTENT_MAX_LENGTH)
  )
  if (content === undefined) {
    return undefined
  }

  if (hasSensitiveProjectHarvestContent(value, content)) {
    return undefined
  }

  const selectedSignals = signalsForCandidate(value.signalIndexes, signals)
  if (selectedSignals === undefined) {
    return undefined
  }

  const { domain, type } = domainTypeForCandidate(candidateKind, value)
  const source = sourceForSignals(selectedSignals)
  const tags = uniqueStrings([
    'project_harvest',
    candidateKind,
    ...parseTags(value.tags).map((tag) => cleanTag(tag)).filter((tag): tag is string => tag !== undefined)
  ])

  return {
    domain,
    type,
    strength: 'soft',
    scope: 'project',
    content,
    candidateKind,
    source,
    evidence: evidenceFromSignals(selectedSignals, config, source),
    scores: {
      evidenceStrength: 0.75,
      stability: 0.7,
      usefulness: 0.7,
      safety: 0.9,
      sensitivity: 0.2
    },
    tags
  }
}

function domainTypeForCandidate(
  candidateKind: ProjectMemoryHarvesterCandidateKind,
  value: Record<string, unknown>
): { domain: MemoryDomain; type: MemoryType } {
  if (candidateKind === 'project_fact' || candidateKind === 'project_decision' || candidateKind === 'open_question') {
    return { domain: 'project', type: 'project_fact' }
  }

  if (value.domain === 'project' && value.type === 'project_fact') {
    return { domain: 'project', type: 'project_fact' }
  }

  return { domain: 'procedural', type: 'procedural_rule' }
}

function evidenceFromSignals(
  signals: ProjectMemorySignal[],
  config: AppConfig,
  fallbackSource: MemorySource
): MemoryEvidence[] {
  return signals.slice(0, SIGNAL_EVIDENCE_LIMIT).map((signal) => {
    const sourceKind = sourceForSignal(signal) ?? fallbackSource
    const files = signal.files === undefined || signal.files.length === 0 ? '' : ` files=${signal.files.join(', ')}`
    const evidence = signal.evidence === undefined ? '' : ` evidence=${signal.evidence}`
    const summary = cleanRequiredString(
      `${signal.kind} from ${signal.source}:${files} ${signal.summary}${evidence}`,
      Math.min(config.memorySingleEvidenceMaxChars, EVIDENCE_MAX_LENGTH)
    )
    return {
      summary,
      sourceKind,
      evidenceGroupId: stableEvidenceGroupId({ sourceKind, summary })
    }
  })
}

function sourceForSignals(signals: ProjectMemorySignal[]): MemorySource {
  if (signals.some((signal) => signal.source === 'file' || signal.source === 'git' || signal.source === 'review_summary')) {
    return 'file'
  }
  if (signals.some((signal) => signal.source === 'tool_trace')) {
    return 'tool_trace'
  }
  return 'assistant_observed'
}

function sourceForSignal(signal: ProjectMemorySignal): MemorySource | undefined {
  if (signal.source === 'tool_trace') {
    return 'tool_trace'
  }
  if (signal.source === 'file' || signal.source === 'git' || signal.source === 'review_summary') {
    return 'file'
  }
  return undefined
}

function missingModelConfigReason(config: AppConfig): string | undefined {
  const routeModel = config.model.cheapModel || config.model.strongModel || config.model.model
  const missing: string[] = []
  if (config.model.baseUrl.trim() === '') {
    missing.push('CYRENE_BASE_URL')
  }
  if (config.model.model.trim() === '' || routeModel.trim() === '') {
    missing.push('CYRENE_MODEL')
  }
  if (modelBaseUrlRequiresApiKey(config.model.baseUrl) && !config.model.apiKey?.trim()) {
    missing.push('CYRENE_API_KEY')
  }
  return missing.length === 0 ? undefined : `Model config is incomplete: set ${missing.join(' and ')}.`
}

function signalsForCandidate(value: unknown, signals: ProjectMemorySignal[]): ProjectMemorySignal[] | undefined {
  const indexes = Array.isArray(value)
    ? uniqueNumbers(value.filter((entry): entry is number => Number.isInteger(entry)))
    : []
  const selectedSignals = indexes
    .filter((index) => index >= 1 && index <= signals.length)
    .map((index) => signals[index - 1] as ProjectMemorySignal)

  if (selectedSignals.length > 0) {
    return selectedSignals
  }

  return signals.length === 1 ? signals : undefined
}

function hasSensitiveProjectHarvestContent(value: Record<string, unknown>, content: string): boolean {
  if (value.domain === 'personal' || value.domain === 'relationship' || value.domain === 'affective') {
    return true
  }

  return [content, ...parseTags(value.tags)].some((entry) => SENSITIVE_PROJECT_HARVEST_PATTERN.test(entry))
}

function formatSignalsForPrompt(signals: ProjectMemorySignal[]): string {
  return signals
    .map((signal, index) => {
      const files = signal.files === undefined || signal.files.length === 0 ? '' : `\n  files: ${signal.files.join(', ')}`
      const evidence = signal.evidence === undefined ? '' : `\n  evidence: ${cleanRequiredString(signal.evidence, EVIDENCE_MAX_LENGTH)}`
      return [
        `${index + 1}. kind: ${signal.kind}`,
        `  source: ${signal.source}`,
        `  summary: ${cleanRequiredString(signal.summary, EVIDENCE_MAX_LENGTH)}${files}${evidence}`
      ].join('\n')
    })
    .join('\n')
}

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const cleaned = cleanRequiredString(value, maxLength)
  return cleaned === '' ? undefined : cleaned
}

function cleanRequiredString(value: string, maxLength: number): string {
  const redacted = redactReviewText(value.replace(/\s+/g, ' ').trim()).text
  return truncateWithSuffix(redacted, maxLength)
}

function truncateWithSuffix(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  if (maxChars <= 0) return ''
  if (maxChars <= 3) return '.'.repeat(maxChars)
  return `${value.slice(0, maxChars - 3)}...`
}

function cleanTag(value: string): string | undefined {
  const cleaned = cleanRequiredString(value, 48)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned === '' ? undefined : cleaned
}

function parseProjectCandidateKind(value: unknown): ProjectMemoryHarvesterCandidateKind | undefined {
  return typeof value === 'string' && (PROJECT_CANDIDATE_KINDS as readonly string[]).includes(value)
    ? value as ProjectMemoryHarvesterCandidateKind
    : undefined
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values))
}

function stableEvidenceGroupId(input: { sourceKind: MemorySource; summary: string }): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function extractJsonObject(content: string): string {
  const start = content.indexOf('{')
  if (start === -1) {
    throw new Error('Project memory harvest response did not contain JSON.')
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

  throw new Error('Project memory harvest response JSON was incomplete.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
