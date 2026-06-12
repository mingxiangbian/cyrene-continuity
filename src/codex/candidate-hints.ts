import { createHash } from 'node:crypto'
import { contentHashForActiveMemory } from './active-memory-review.js'
import type { CandidateHintSelectionReceipt } from './candidate-hint-receipts.js'
import { isRuntimeActivatableSemanticMemory } from '../memory/memory-lifecycle.js'
import { semanticMemoryToActiveMemory } from '../memory/semantic-memory-adapter.js'
import type { SemanticMemory } from '../memory/types.js'

export interface CandidateHint {
  id: string
  memoryId: string
  contentHash: string
  confidenceTier: 'trial'
  activationMode: 'workflow_hint'
  text: string
  candidate: true
  validated: false
  source: 'project'
  projectId: string
  risk: 'low'
  triggerReason: string
  selectionReceipt?: CandidateHintSelectionReceipt
}

export interface CandidateHintSelectionMetrics {
  candidateHintLatencyMs: number
  candidateHintEligibleCount: number
  candidateHintRelevantCount: number
  candidateHintSelectedCount: number
  candidateHintTimeoutCount: number
  candidateHintSuppressedByLatencyCount: number
}

export interface CandidateHintMemoryCandidate {
  memory: SemanticMemory
  projectId?: string
  sqliteRelevanceScore?: number
  appliedCount?: number
}

export interface CandidateHintValidatedMemoryCandidate {
  memory: SemanticMemory
  projectId?: string
}

export interface CandidateHintSelectionInput {
  mode: 'fast' | 'balanced' | 'review'
  query: string
  projectId: string
  task: 'coding' | 'planning' | 'debugging' | 'conversation' | 'memory'
  candidates: CandidateHintMemoryCandidate[]
  validatedMemories?: CandidateHintValidatedMemoryCandidate[]
  now?: string
  maxItems?: number
}

export interface CandidateHintSelectionDiagnostics {
  ineligible: Array<{ memoryId: string; reasons: string[] }>
  irrelevant: Array<{ memoryId: string; reason: string }>
  relevant: Array<{ memoryId: string; matchedTokens: string[] }>
}

export interface CandidateHintSelectionResult {
  hints: CandidateHint[]
  metrics: CandidateHintSelectionMetrics
  diagnostics: CandidateHintSelectionDiagnostics
}

const DISTINCTIVE_TOKEN_LENGTH = 8
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'being',
  'but',
  'by',
  'can',
  'could',
  'for',
  'from',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'may',
  'must',
  'of',
  'on',
  'or',
  'should',
  'that',
  'the',
  'then',
  'these',
  'this',
  'those',
  'to',
  'was',
  'were',
  'when',
  'while',
  'will',
  'with',
  'without',
  'would'
])

const COMMAND_PHRASE_PATTERNS: Array<{ pattern: RegExp; token: string }> = [
  { pattern: /\bnpm\s+run\s+typecheck\b/g, token: 'npm run typecheck' },
  { pattern: /\bnpm\s+test\b/g, token: 'npm test' },
  { pattern: /\bpnpm\s+run\s+typecheck\b/g, token: 'pnpm run typecheck' },
  { pattern: /\bpnpm\s+typecheck\b/g, token: 'pnpm typecheck' },
  { pattern: /\bpnpm\s+test\b/g, token: 'pnpm test' },
  { pattern: /\bdry[-\s]+run\s+first\b/g, token: 'dry-run first' },
  { pattern: /\bapply\s+directly\b/g, token: 'apply directly' }
]
const ALLOWED_DOMAINS = new Set<string>(['project', 'procedural', 'system'])
const APPLIED_COUNT_CAP = 2

interface CandidateHintRelevance {
  matchedTokens: string[]
  useWhenMatchClass: number
  contentMatchClass: number
  reason: string
}

interface CandidateHintRankKey {
  useWhenMatchClass: number
  contentMatchClass: number
  sqliteRelevanceScore: number
  appliedCountCapped: number
  updatedAt: number
  createdAt: number
  id: string
}

export function selectCandidateHints(input: CandidateHintSelectionInput): CandidateHintSelectionResult {
  const startedAt = Date.now()
  const now = input.now ?? new Date().toISOString()
  const diagnostics: CandidateHintSelectionDiagnostics = {
    ineligible: [],
    irrelevant: [],
    relevant: []
  }
  const budget = selectionBudget(input.mode, input.maxItems)
  const queryTokens = tokenizeCandidateHintText(input.query)
  const ranked: Array<{
    candidate: CandidateHintMemoryCandidate
    relevance: CandidateHintRelevance
    rankKey: CandidateHintRankKey
  }> = []
  let eligibleCount = 0
  let relevantCount = 0

  for (const candidate of input.candidates) {
    const memory = candidate.memory
    const ineligibleReasons = ineligibleReasonsForCandidate(candidate, {
      now,
      projectId: input.projectId,
      validatedMemories: input.validatedMemories ?? []
    })
    if (ineligibleReasons.length > 0) {
      diagnostics.ineligible.push({ memoryId: memory.id, reasons: ineligibleReasons })
      continue
    }
    eligibleCount += 1

    const relevance = evaluateRelevance(memory, queryTokens)
    if (!isRelevanceQualified(relevance)) {
      diagnostics.irrelevant.push({ memoryId: memory.id, reason: relevance.reason })
      continue
    }
    relevantCount += 1
    diagnostics.relevant.push({ memoryId: memory.id, matchedTokens: relevance.matchedTokens })
    ranked.push({ candidate, relevance, rankKey: rankKeyForCandidate(candidate, relevance) })
  }

  ranked.sort(compareRankedCandidates)

  const hints = ranked.slice(0, budget).map(({ candidate, relevance }) => candidateHintForMemory({
    memory: candidate.memory,
    projectId: input.projectId,
    triggerReason: `matched candidate tokens: ${relevance.matchedTokens.join(', ')}`
  }))

  return {
    hints,
    metrics: {
      candidateHintLatencyMs: Date.now() - startedAt,
      candidateHintEligibleCount: eligibleCount,
      candidateHintRelevantCount: relevantCount,
      candidateHintSelectedCount: hints.length,
      candidateHintTimeoutCount: 0,
      candidateHintSuppressedByLatencyCount: 0
    },
    diagnostics
  }
}

function ineligibleReasonsForCandidate(candidate: CandidateHintMemoryCandidate, context: {
  now: string
  projectId: string
  validatedMemories: CandidateHintValidatedMemoryCandidate[]
}): string[] {
  const memory = candidate.memory
  const reasons: string[] = []
  if (!isRuntimeActivatableSemanticMemory(memory)) reasons.push('not_runtime_activatable')
  if (memory.scope !== 'project') reasons.push('not_project_scope')
  if (candidate.projectId !== undefined && candidate.projectId !== context.projectId) reasons.push('project_mismatch')
  if (memory.confidenceTier !== 'trial') reasons.push('not_trial')
  if (memory.activationPolicy?.allowedModes.length !== 1 || memory.activationPolicy.allowedModes[0] !== 'workflow_hint') {
    reasons.push('not_workflow_hint_only')
  }
  if (!ALLOWED_DOMAINS.has(memory.domain)) reasons.push('domain_not_allowed')
  if (riskForMemory(memory) !== 'low') reasons.push('not_low_risk')
  if (isSecuritySensitiveMemory(memory)) reasons.push('security_sensitive')
  if (hasPromptInjectionMarker(memory)) reasons.push('prompt_injection')
  if (hasNegativeFeedbackMarker(memory)) reasons.push('negative_feedback')
  if (memory.expiresAt !== undefined && memory.expiresAt <= context.now) reasons.push('expired')
  if (hasHardConflict(candidate, context.validatedMemories, context.projectId)) reasons.push('hard_conflict')
  return reasons
}

function hasHardConflict(
  candidate: CandidateHintMemoryCandidate,
  validatedMemories: CandidateHintValidatedMemoryCandidate[],
  projectId: string
): boolean {
  const key = normalizedKeyForMemory(candidate.memory)
  if (key === undefined) return false
  const boundary = sourceBoundaryForCandidate(candidate, projectId)
  return validatedMemories.some((validatedMemory) => {
    return (
      normalizedKeyForMemory(validatedMemory.memory) === key &&
      sourceBoundaryForCandidate(validatedMemory, projectId) === boundary &&
      hasContradictoryDirective(candidate.memory, validatedMemory.memory)
    )
  })
}

function hasContradictoryDirective(left: SemanticMemory, right: SemanticMemory): boolean {
  const leftText = directiveText(left)
  const rightText = directiveText(right)
  const pairs: Array<[string[], string[]]> = [
    [['npm test'], ['pnpm test']],
    [['npm run typecheck'], ['pnpm typecheck', 'pnpm run typecheck']],
    [['dry run first'], ['apply directly']]
  ]
  return pairs.some(([leftDirectives, rightDirectives]) => {
    return (
      hasAnyDirective(leftText, leftDirectives) && hasAnyDirective(rightText, rightDirectives) ||
      hasAnyDirective(leftText, rightDirectives) && hasAnyDirective(rightText, leftDirectives)
    )
  })
}

function hasAnyDirective(text: string, directives: string[]): boolean {
  return directives.some((directive) => text.includes(directive))
}

function directiveText(memory: SemanticMemory): string {
  return [memory.content, ...memory.useWhen]
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizedKeyForMemory(memory: SemanticMemory): string | undefined {
  return nonEmptyString(memory.reviewState?.normalizedKey)
}

function sourceBoundaryForCandidate(candidate: CandidateHintValidatedMemoryCandidate, projectId: string): string {
  const memory = candidate.memory
  return [
    candidate.projectId ?? projectId,
    nonEmptyString(memory.reviewState?.sourceOfTruth) ??
      nonEmptyString(memory.sourceOfTruth) ??
      nonEmptyString(memory.evidence[0]?.sourceRef) ??
      nonEmptyString(memory.evidence[0]?.sourceKind) ??
      'source:unknown'
  ].join(':')
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function evaluateRelevance(memory: SemanticMemory, queryTokens: string[]): CandidateHintRelevance {
  if (memory.doNotUseWhen.some((boundary) => isStrongMatch(matchingTokens(queryTokens, tokenizeCandidateHintText(boundary))))) {
    return {
      matchedTokens: [],
      useWhenMatchClass: 0,
      contentMatchClass: 0,
      reason: 'do_not_use_when'
    }
  }
  const useWhenMatchedTokens = matchingTokens(queryTokens, tokenizeCandidateHintText(memory.useWhen.join(' ')))
  const contentMatchedTokens = matchingTokens(queryTokens, tokenizeCandidateHintText(memory.content))
  const matchedTokens = mergeMatchedTokens(queryTokens, [...useWhenMatchedTokens, ...contentMatchedTokens])
  return {
    matchedTokens,
    useWhenMatchClass: matchClass(useWhenMatchedTokens),
    contentMatchClass: matchClass(contentMatchedTokens),
    reason: matchedTokens.length === 0 ? 'no_relevance' : 'weak_relevance'
  }
}

function candidateHintForMemory(input: {
  memory: SemanticMemory
  projectId: string
  triggerReason: string
}): CandidateHint {
  return {
    id: stableCandidateHintId(input.memory.id, input.projectId),
    memoryId: input.memory.id,
    contentHash: contentHashForActiveMemory(semanticMemoryToActiveMemory(input.memory)),
    confidenceTier: 'trial',
    activationMode: 'workflow_hint',
    text: input.memory.content,
    candidate: true,
    validated: false,
    source: 'project',
    projectId: input.projectId,
    risk: 'low',
    triggerReason: input.triggerReason
  }
}

function tokenizeCandidateHintText(text: string): string[] {
  const tokens = new Set<string>()
  const normalized = text.toLowerCase()
  for (const { pattern, token } of COMMAND_PHRASE_PATTERNS) {
    if (pattern.test(normalized)) addToken(tokens, token)
    pattern.lastIndex = 0
  }
  for (const token of normalized.match(/[a-z0-9]+(?:[._:/-][a-z0-9]+)*|[\u4e00-\u9fff]+/g) ?? []) {
    addToken(tokens, token)
    if (/[._:/-]/.test(token)) {
      for (const part of token.split(/[._:/-]+/)) addToken(tokens, part)
    }
  }
  return Array.from(tokens)
}

function addToken(tokens: Set<string>, token: string): void {
  const trimmed = token.trim()
  if (trimmed === '' || STOP_WORDS.has(trimmed)) return
  tokens.add(trimmed)
}

function matchingTokens(queryTokens: string[], candidateTokens: string[]): string[] {
  const candidateTokenSet = new Set(candidateTokens)
  return queryTokens.filter((token) => candidateTokenSet.has(token))
}

function mergeMatchedTokens(queryTokens: string[], matchedTokens: string[]): string[] {
  const matchedTokenSet = new Set(matchedTokens)
  return queryTokens.filter((token) => matchedTokenSet.has(token))
}

function isStrongMatch(tokens: string[]): boolean {
  return tokens.length >= 2 || tokens.some((token) => token.length >= DISTINCTIVE_TOKEN_LENGTH)
}

function matchClass(tokens: string[]): number {
  if (isStrongMatch(tokens)) return 2
  return tokens.length > 0 ? 1 : 0
}

function isRelevanceQualified(relevance: CandidateHintRelevance): boolean {
  return relevance.useWhenMatchClass === 2 || relevance.contentMatchClass === 2
}

function rankKeyForCandidate(candidate: CandidateHintMemoryCandidate, relevance: CandidateHintRelevance): CandidateHintRankKey {
  return {
    useWhenMatchClass: relevance.useWhenMatchClass,
    contentMatchClass: relevance.contentMatchClass,
    sqliteRelevanceScore: finiteNumber(candidate.sqliteRelevanceScore),
    appliedCountCapped: Math.min(APPLIED_COUNT_CAP, Math.max(0, Math.floor(finiteNumber(candidate.appliedCount)))),
    updatedAt: timestampForSort(candidate.memory.updatedAt),
    createdAt: timestampForSort(candidate.memory.createdAt),
    id: candidate.memory.id
  }
}

function compareRankedCandidates(
  left: { rankKey: CandidateHintRankKey },
  right: { rankKey: CandidateHintRankKey }
): number {
  return (
    compareDescending(left.rankKey.useWhenMatchClass, right.rankKey.useWhenMatchClass) ||
    compareDescending(left.rankKey.contentMatchClass, right.rankKey.contentMatchClass) ||
    compareDescending(left.rankKey.sqliteRelevanceScore, right.rankKey.sqliteRelevanceScore) ||
    compareDescending(left.rankKey.appliedCountCapped, right.rankKey.appliedCountCapped) ||
    compareDescending(left.rankKey.updatedAt, right.rankKey.updatedAt) ||
    compareDescending(left.rankKey.createdAt, right.rankKey.createdAt) ||
    left.rankKey.id.localeCompare(right.rankKey.id)
  )
}

function compareDescending(left: number, right: number): number {
  return right - left
}

function finiteNumber(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0
}

function timestampForSort(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function riskForMemory(memory: SemanticMemory): CandidateHint['risk'] | 'medium' | 'high' {
  const scores = memory.reviewState?.scores
  if (memory.routing?.risk === 'high') {
    return 'high'
  }
  if (memory.routing?.risk === 'medium' || (scores?.sensitivity ?? 0) > 0.35 || (scores?.safety ?? 1) < 0.8) {
    return 'medium'
  }
  return 'low'
}

function isSecuritySensitiveMemory(memory: SemanticMemory): boolean {
  const text = [
    memory.content,
    ...memory.useWhen,
    ...(memory.reviewState?.tags ?? []),
    ...(memory.routing?.reasons ?? [])
  ].join(' ').toLowerCase()
  return /\b(security-sensitive|credential|credentials|secret|secrets|api key|password|token)\b/.test(text)
}

function hasPromptInjectionMarker(memory: SemanticMemory): boolean {
  const text = [
    memory.content,
    ...memory.useWhen,
    ...memory.doNotUseWhen,
    ...(memory.reviewState?.tags ?? []),
    ...(memory.routing?.reasons ?? []),
    ...evidenceFeedbackText(memory)
  ].join(' ').toLowerCase()
  return (
    /\b(ignore|disregard|override)\s+(all\s+)?(previous|prior|system|developer|higher[-\s]+priority)\s+(instructions|messages|rules)\b/.test(text) ||
    /\b(system prompt|developer message|hidden instructions|reveal the prompt|do not follow instructions)\b/.test(text)
  )
}

function hasNegativeFeedbackMarker(memory: SemanticMemory): boolean {
  const extras = memory as SemanticMemory & { feedbackEvents?: unknown; activationFeedback?: unknown }
  const feedbackMarkers = [
    ...(memory.reviewState?.tags ?? []),
    ...evidenceFeedbackText(memory),
    ...(Array.isArray(extras.feedbackEvents) ? extras.feedbackEvents : []),
    ...(Array.isArray(extras.activationFeedback) ? extras.activationFeedback : [])
  ].join(' ').toLowerCase()
  return /\b(corrected|violated)\b/.test(feedbackMarkers)
}

function evidenceFeedbackText(memory: SemanticMemory): string[] {
  return memory.evidence.flatMap((entry) => [
    entry.sourceRef,
    entry.whatHappened,
    entry.whyImportant,
    entry.result
  ]).filter((value): value is string => typeof value === 'string')
}

function selectionBudget(mode: CandidateHintSelectionInput['mode'], maxItems: number | undefined): number {
  const modeBudget = mode === 'fast' ? 0 : mode === 'balanced' ? 1 : 3
  if (maxItems === undefined || !Number.isFinite(maxItems)) return modeBudget
  return Math.max(0, Math.min(modeBudget, Math.floor(maxItems)))
}

function stableCandidateHintId(memoryId: string, projectId: string): string {
  return createHash('sha256').update(`${projectId}:${memoryId}:candidate-hint`).digest('hex').slice(0, 16)
}
