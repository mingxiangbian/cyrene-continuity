import { createHash, randomUUID } from 'node:crypto'
import { createDefaultConfig } from '../config.js'
import { evaluateActiveMemoryReadiness, type ActiveMemoryReadinessResult } from './active-memory-readiness.js'
import {
  codexGlobalMemoryRoot,
  codexProjectMemoryRoot,
  getReadableCodexGlobalMemoryRoot,
  getReadableCodexProjectMemoryRoot
} from './codex-memory-root.js'
import { syncCurrentCodexMemoryIndex } from './codex-memory-index.js'
import { identifyCodexProject } from './project-id.js'
import {
  assertMemoryMaintenanceTargetsSafeFromRoot,
  runMemoryMaintenanceFromRootLocked,
  withMemoryMaintenanceLockFromRoot
} from '../memory/memory-maintenance.js'
import {
  appendMemoryEventFromRoot,
  appendTombstoneFromRoot,
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readSemanticRewriteReceiptsFromRoot,
  readTombstonesFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot
} from '../memory/memory-store.js'
import {
  activateCandidate,
  evaluatePendingPromotion,
  validateMemoryCandidate
} from '../memory/memory-validator.js'
import { deriveMemoryCandidateKind } from '../memory/candidate-kind.js'
import { pendingMemoryToSemanticMemory } from '../memory/semantic-memory-adapter.js'
import { listCodexProjects } from './project-registry.js'
import type {
  CyreneMemory,
  MemoryCandidateKind,
  MemoryConflictResolution,
  MemoryScores,
  MemoryTombstone,
  PendingMemory,
  SemanticRewriteReceipt,
  SemanticMemory
} from '../memory/types.js'
import { MEMORY_CONFLICT_RESOLUTIONS } from '../memory/types.js'

export type CodexMemoryCandidateKind = MemoryCandidateKind
export type CodexMemoryConflictResolution = MemoryConflictResolution

export type CodexPendingMemoryRecommendation = 'promote' | 'reject' | 'defer'
export type CodexPendingMemoryRisk = 'low' | 'medium' | 'high'
export type CodexPendingReviewScore = 'low' | 'medium' | 'high'

const READINESS_REASON_TEXT_LIMIT = 120

export interface CodexPendingReadinessReason {
  code: string
  text: string
}

interface CodexStructuredReadinessGate {
  ready: boolean
  reasons: CodexPendingReadinessReason[]
}

type CodexPendingPromotionReadiness = Omit<ActiveMemoryReadinessResult, 'reasons'> & {
  reasons: string[]
}

export interface CodexPendingReadinessReview {
  status: ActiveMemoryReadinessResult['status']
  targetShape: string
  reasons: CodexPendingReadinessReason[]
  rewriteHint: string
}

export interface CodexPendingEpisodeEvidence {
  when: string
  whatHappened: string
  whyImportant: string
  result: string
  source: PendingMemory['source']
}

export interface CodexPendingProposedSemanticMemory {
  type: CodexMemoryCandidateKind
  scope: PendingMemory['scope']
  content: string
  useWhen: string[]
  doNotUseWhen: string[]
  evidenceStrength: CodexPendingReviewScore
  futureUsefulness: CodexPendingReviewScore
  expiry: string
}

export type CodexPendingSemanticRewriteStatus = 'needs_rewrite' | 'prepared' | 'rewrite_failed'

export interface CodexPendingSemanticRewriteSummary {
  status: CodexPendingSemanticRewriteStatus
  receipt?: SemanticRewriteReceipt
}

export interface CodexNormalizedKeyConflict {
  id: string
  content: string
  normalizedKey: string
  domain: CyreneMemory['domain']
  type: CyreneMemory['type']
  scope: CyreneMemory['scope']
  updatedAt: string
}

export interface CodexPendingMemorySummary {
  id: string
  domain: PendingMemory['domain']
  type: PendingMemory['type']
  strength: PendingMemory['strength']
  scope: PendingMemory['scope']
  candidateKind: CodexMemoryCandidateKind
  recommendation: CodexPendingMemoryRecommendation
  suggestedAction: string
  activeReadiness: ActiveMemoryReadinessResult
  readiness: CodexPendingReadinessReview
  episodeEvidence: CodexPendingEpisodeEvidence
  semanticMemory: SemanticMemory
  proposedSemanticMemory: CodexPendingProposedSemanticMemory
  risk: CodexPendingMemoryRisk
  sensitivity: number
  evidenceCount: number
  content: string
  normalizedKey: string
  source: PendingMemory['source']
  portability?: PendingMemory['portability']
  profileVisibility?: PendingMemory['profileVisibility']
  seenCount: number
  firstSeenAt: string
  lastSeenAt: string
  expiresAt?: string
  reviewHash: string
  semanticRewrite?: CodexPendingSemanticRewriteSummary
  evidenceSummary: string[]
  scores: PendingMemory['scores']
}

export interface CodexPendingReviewNotice {
  count: number
  hasItems: boolean
  newestCandidateId?: string
  newestPreview?: string
}

interface CodexPendingMemoryProject {
  projectId: string
  displayName: string
}

export interface CodexPendingMemoryListResult {
  project: CodexPendingMemoryProject
  pending: CodexPendingMemorySummary[]
  total: number
  memoryRoot: string
}

export interface CodexPendingMemoryGetResult {
  project: CodexPendingMemoryProject
  memoryRoot: string
  result:
    | {
        action: 'get'
        candidate: PendingMemory
        reviewHash: string
        review: CodexPendingMemorySummary
      }
    | {
        action: 'not_found'
        candidateId: string
        reason: string
      }
}

export interface CodexPendingMemoryPromoteResult {
  project: CodexPendingMemoryProject
  memoryRoot: string
  result:
    | {
        action: 'promote'
        candidateId: string
        memory: CyreneMemory
        reviewHash: string
      }
    | {
        action: 'reject_new'
        candidateId: string
        normalizedKey: string
        conflicts: CodexNormalizedKeyConflict[]
        tombstone: MemoryTombstone
        reviewHash: string
      }
    | {
        action: 'not_found'
        candidateId: string
        reason: string
      }
    | {
        action: 'conflict'
        candidateId: string
        reason: string
        latest: CodexPendingMemorySummary
      }
    | {
        action: 'normalized_key_conflict'
        candidateId: string
        normalizedKey: string
        reason: string
        conflicts: CodexNormalizedKeyConflict[]
        resolutionOptions: MemoryConflictResolution[]
      }
    | {
        action: 'needs_rewrite'
        candidateId: string
        reason: string
        readiness: CodexPendingPromotionReadiness
        reviewHash: string
      }
    | {
        action: 'rejected_by_validator'
        candidateId: string
        reason: string
        tombstone: MemoryTombstone
      }
}

export interface CodexPendingMemoryRejectResult {
  project: CodexPendingMemoryProject
  memoryRoot: string
  result:
    | {
        action: 'reject'
        candidateId: string
        tombstone: MemoryTombstone
        reviewHash: string
      }
    | {
        action: 'not_found'
        candidateId: string
        reason: string
      }
    | {
        action: 'conflict'
        candidateId: string
        reason: string
        latest: CodexPendingMemorySummary
      }
}

export interface CodexPendingMemoryEditResult {
  project: CodexPendingMemoryProject
  memoryRoot: string
  result:
    | {
        action: 'edit'
        candidateId: string
        candidate: PendingMemory
        reviewHash: string
      }
    | {
        action: 'not_found'
        candidateId: string
        reason: string
      }
    | {
        action: 'conflict'
        candidateId: string
        reason: string
        latest: CodexPendingMemorySummary
      }
    | {
        action: 'rejected_by_validator'
        candidateId: string
        reason: string
        tombstone: MemoryTombstone
      }
}

export interface CodexPendingMemoryDeferResult {
  project: CodexPendingMemoryProject
  memoryRoot: string
  result:
    | {
        action: 'defer'
        candidateId: string
        candidate: PendingMemory
        reviewHash: string
      }
    | {
        action: 'not_found'
        candidateId: string
        reason: string
      }
    | {
        action: 'conflict'
        candidateId: string
        reason: string
        latest: CodexPendingMemorySummary
      }
}

const NORMALIZED_KEY_CONFLICT_RESOLUTIONS: MemoryConflictResolution[] = [...MEMORY_CONFLICT_RESOLUTIONS]

export function reviewHashForPendingMemory(candidate: PendingMemory): string {
  return reviewHashForSemanticMemory(pendingReviewSemanticMemory(candidate))
}

export function reviewHashForSemanticMemory(memory: SemanticMemory): string {
  const payload = {
    id: memory.id,
    status: memory.status,
    module: memory.module,
    kind: memory.kind,
    scope: memory.scope,
    domain: memory.domain,
    content: memory.content,
    useWhen: memory.useWhen,
    doNotUseWhen: memory.doNotUseWhen,
    sourceOfTruth: memory.sourceOfTruth ?? null,
    evidence: memory.evidence,
    routing: memory.routing ?? null,
    reviewPolicy: memory.reviewPolicy,
    reviewState: memory.reviewState ?? null,
    supersedes: memory.supersedes,
    expiresAt: memory.expiresAt ?? null,
    reviewAfter: memory.reviewAfter ?? null,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function summarizePendingMemory(
  candidate: PendingMemory,
  now = new Date().toISOString(),
  semanticRewriteReceipts: SemanticRewriteReceipt[] = []
): CodexPendingMemorySummary {
  const semanticMemory = pendingReviewSemanticMemory(candidate)
  const reviewHash = reviewHashForPendingMemory(candidate)
  const candidateKind = deriveMemoryCandidateKind(candidate)
  const activeReadiness = evaluateActiveMemoryReadiness({
    content: candidate.content,
    candidateKind,
    domain: candidate.domain,
    type: candidate.type,
    tags: candidate.tags
  })
  const structuredGate = evaluateStructuredReadinessGate(candidate, semanticMemory, activeReadiness)
  const recommendation = deriveRecommendation(candidate, now, activeReadiness, structuredGate)
  const risk = deriveRisk(candidate)
  return {
    id: candidate.id,
    domain: candidate.domain,
    type: candidate.type,
    strength: candidate.strength,
    scope: candidate.scope,
    candidateKind,
    recommendation,
    suggestedAction: suggestedReviewAction(candidate.id, reviewHash, recommendation),
    activeReadiness,
    readiness: deriveStructuredReadiness(candidate, candidateKind, activeReadiness, structuredGate),
    episodeEvidence: deriveEpisodeEvidence(candidate, candidateKind, recommendation, activeReadiness.status, risk),
    semanticMemory,
    proposedSemanticMemory: deriveProposedSemanticMemory(candidate, candidateKind, activeReadiness),
    risk,
    sensitivity: candidate.scores.sensitivity,
    evidenceCount: candidate.evidence.length,
    content: candidate.content,
    normalizedKey: candidate.normalizedKey,
    source: candidate.source,
    ...(candidate.portability === undefined ? {} : { portability: candidate.portability }),
    ...(candidate.profileVisibility === undefined ? {} : { profileVisibility: candidate.profileVisibility }),
    seenCount: candidate.seenCount,
    firstSeenAt: candidate.firstSeenAt,
    lastSeenAt: candidate.lastSeenAt,
    expiresAt: candidate.expiresAt,
    reviewHash,
    ...semanticRewriteSummaryFor(candidate, semanticRewriteReceipts, activeReadiness),
    evidenceSummary: candidate.evidence
      .map((entry) => entry.summary ?? entry.quote ?? entry.runId ?? '')
      .filter((text) => text.trim() !== ''),
    scores: candidate.scores
  }
}

function semanticRewriteSummaryFor(
  candidate: PendingMemory,
  receipts: SemanticRewriteReceipt[],
  activeReadiness: ActiveMemoryReadinessResult
): { semanticRewrite?: CodexPendingSemanticRewriteSummary } {
  const receipt = latestSemanticRewriteReceiptForCandidate(candidate, receipts)
  if (receipt !== undefined) {
    const status: CodexPendingSemanticRewriteStatus = receipt.action === 'fail'
      ? 'rewrite_failed'
      : 'prepared'
    return { semanticRewrite: { status, receipt } }
  }
  if (activeReadiness.status === 'needs_rewrite') {
    return { semanticRewrite: { status: 'needs_rewrite' } }
  }
  return {}
}

function latestSemanticRewriteReceiptForCandidate(
  candidate: PendingMemory,
  receipts: SemanticRewriteReceipt[]
): SemanticRewriteReceipt | undefined {
  return receipts
    .filter((receipt) => receipt.pendingMemoryId === candidate.id)
    .sort((left, right) => {
      const byTime = right.createdAt.localeCompare(left.createdAt)
      return byTime === 0 ? right.id.localeCompare(left.id) : byTime
    })[0]
}

function deriveRecommendation(
  candidate: PendingMemory,
  now: string,
  activeReadiness: ActiveMemoryReadinessResult,
  structuredGate: CodexStructuredReadinessGate
): CodexPendingMemoryRecommendation {
  if (candidate.expiresAt <= now) {
    return 'reject'
  }
  if (!structuredGate.ready) {
    return 'defer'
  }
  if (!activeReadiness.ready) {
    return 'defer'
  }
  const promotion = evaluatePendingPromotion(candidate, now)
  return promotion.promotable ? 'promote' : 'defer'
}

function deriveRisk(candidate: PendingMemory): CodexPendingMemoryRisk {
  if (candidate.scores.safety < 0.65 || candidate.scores.sensitivity > 0.6) {
    return 'high'
  }
  if (candidate.scores.safety < 0.8 || candidate.scores.sensitivity > 0.45) {
    return 'medium'
  }
  return 'low'
}

function deriveStructuredReadiness(
  candidate: PendingMemory,
  candidateKind: CodexMemoryCandidateKind,
  activeReadiness: ActiveMemoryReadinessResult,
  structuredGate: CodexStructuredReadinessGate
): CodexPendingReadinessReview {
  return {
    status: activeReadiness.status,
    targetShape: deriveTargetShape(candidate, candidateKind, activeReadiness),
    reasons: deriveReadinessReasons(candidate, candidateKind, activeReadiness, structuredGate),
    rewriteHint: activeReadiness.rewriteHint
  }
}

function deriveTargetShape(
  candidate: PendingMemory,
  candidateKind: CodexMemoryCandidateKind,
  activeReadiness: ActiveMemoryReadinessResult
): string {
  if (!activeReadiness.ready && activeReadiness.suggestedShape === 'episode') return 'episode'
  const scope = candidate.scope === 'global' ? 'global' : 'project'
  if (candidateKind === 'known_pitfall') return `${scope}_known_pitfall`
  if (candidateKind === 'workflow_rule') return `${scope}_workflow_rule`
  if (candidateKind === 'project_decision') return `${scope}_project_decision`
  if (activeReadiness.suggestedShape === 'project_policy' || candidate.type === 'system_policy') return `${scope}_policy`
  if (candidate.type === 'episode') return 'episode'
  return `${scope}_${candidate.type}`
}

function deriveReadinessReasons(
  candidate: PendingMemory,
  candidateKind: CodexMemoryCandidateKind,
  activeReadiness: ActiveMemoryReadinessResult,
  structuredGate: CodexStructuredReadinessGate
): CodexPendingReadinessReason[] {
  if (!structuredGate.ready) {
    return structuredGate.reasons
  }
  if (!activeReadiness.ready) {
    const blockerReasons = activeReadiness.reasons.map((code) => readinessReason(code, blockingReasonText(code)))
    return blockerReasons.length > 0
      ? blockerReasons
      : [readinessReason('needs_active_memory_rewrite', blockingReasonText('needs_active_memory_rewrite'))]
  }

  const reasons = [
    readinessReason('explicit_memory_kind', `Candidate is typed as ${candidateKind} for structured review.`),
    readinessReason('scoped_for_review', `Candidate is scoped to ${candidate.scope} memory review.`)
  ]
  if (candidate.evidence.length > 0) {
    reasons.push(readinessReason('has_review_evidence', 'Candidate includes review evidence for the proposed memory.'))
  }
  if (candidate.scores.usefulness >= 0.5) {
    reasons.push(readinessReason('actionable_future_use', 'Candidate is likely useful for future project behavior or review.'))
  }
  return reasons.length > 0 ? reasons : [readinessReason('reviewable_candidate_shape', 'Candidate has no blocking active-memory rewrite signals.')]
}

function pendingReviewSemanticMemory(candidate: PendingMemory): SemanticMemory {
  const semanticMemory = pendingMemoryToSemanticMemory(candidate)
  const sourceOfTruth = sourceOfTruthForPendingMemory(candidate)
  const explicitSourceOfTruth = explicitSourceOfTruthForPendingMemory(candidate)
  return {
    ...semanticMemory,
    sourceOfTruth,
    evidence: candidate.evidence.length === 0
      ? []
      : semanticMemory.evidence.map((entry) => ({
          ...entry,
          sourceRef: explicitSourceOfTruth ?? entry.sourceRef
        }))
  }
}

function sourceOfTruthForPendingMemory(candidate: PendingMemory): string {
  return explicitSourceOfTruthForPendingMemory(candidate) ?? evidenceTraceForPendingMemory(candidate) ?? ''
}

function evaluateStructuredReadinessGate(
  candidate: PendingMemory,
  semanticMemory: SemanticMemory,
  activeReadiness?: ActiveMemoryReadinessResult
): CodexStructuredReadinessGate {
  const reasons: CodexPendingReadinessReason[] = []
  if (
    candidate.evidence.length === 0 ||
    semanticMemory.evidence.length === 0 ||
    semanticMemory.evidence.some((entry) => !hasStructuredEvidenceBoundary(entry))
  ) {
    reasons.push(readinessReason('missing_structured_evidence', 'Candidate needs structured evidence before promotion review.'))
  }
  if (!hasStructuredSourceBoundary(candidate, semanticMemory)) {
    reasons.push(readinessReason('missing_source_of_truth', 'Candidate needs a source of truth before promotion review.'))
  }
  if (semanticMemory.useWhen.every((item) => item.trim() === '') || semanticMemory.doNotUseWhen.every((item) => item.trim() === '')) {
    reasons.push(readinessReason('missing_use_boundaries', 'Candidate needs use and non-use boundaries before promotion review.'))
  }
  const readiness = activeReadiness ?? activeReadinessForPending(candidate)
  if (readiness.reasons.includes('raw_file_rule_excerpt')) {
    reasons.push(readinessReason('raw_file_rule_excerpt', blockingReasonText('raw_file_rule_excerpt')))
  }
  return {
    ready: reasons.length === 0,
    reasons: uniqueReadinessReasons(reasons)
  }
}

function explicitSourceOfTruthForPendingMemory(candidate: PendingMemory): string | undefined {
  return nonEmptyString(candidate.sourceOfTruth)
}

function evidenceTraceForPendingMemory(candidate: PendingMemory): string | undefined {
  const normalizedKey = nonEmptyString(candidate.normalizedKey)
  for (const entry of candidate.evidence) {
    const refs = [
      ...(entry.traceRefs ?? []),
      ...(entry.messageIds ?? []),
      entry.runId,
      entry.sessionId,
      entry.taskHash,
      entry.quoteHash,
      entry.evidenceGroupId
    ]
    const trace = refs
      .map(nonEmptyString)
      .find((ref) => ref !== undefined && ref !== normalizedKey && !isBareHashRef(ref))
    if (trace !== undefined) return trace
  }
  return undefined
}

function isBareHashRef(value: string): boolean {
  return /^[a-f0-9]{32,}$/i.test(value)
}

function hasStructuredSourceBoundary(candidate: PendingMemory, semanticMemory: SemanticMemory): boolean {
  if (nonEmptyString(semanticMemory.sourceOfTruth) === undefined) return false
  return explicitSourceOfTruthForPendingMemory(candidate) !== undefined || evidenceTraceForPendingMemory(candidate) !== undefined
}

function hasStructuredEvidenceBoundary(entry: SemanticMemory['evidence'][number]): boolean {
  return nonEmptyString(entry.sourceKind) !== undefined &&
    nonEmptyString(entry.sourceRef) !== undefined &&
    nonEmptyString(entry.whatHappened) !== undefined
}

function activeReadinessForPending(candidate: PendingMemory): ActiveMemoryReadinessResult {
  return evaluateActiveMemoryReadiness({
    content: candidate.content,
    candidateKind: deriveMemoryCandidateKind(candidate),
    domain: candidate.domain,
    type: candidate.type,
    tags: candidate.tags
  })
}

function nonEmptyString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function uniqueReadinessReasons(reasons: CodexPendingReadinessReason[]): CodexPendingReadinessReason[] {
  const seen = new Set<string>()
  return reasons.filter((reason) => {
    if (seen.has(reason.code)) return false
    seen.add(reason.code)
    return true
  })
}

function structuredPromotionReadiness(gate: CodexStructuredReadinessGate): CodexPendingPromotionReadiness {
  const reasonCodes = gate.reasons.map((reason) => reason.code)
  return {
    ready: false,
    status: 'needs_rewrite',
    reasons: reasonCodes,
    suggestedShape: 'active_memory',
    rewriteHint: `Resolve structured review blockers before promotion: ${reasonCodes.join(', ')}.`
  }
}

function structuredPromotionBlockReason(gate: CodexStructuredReadinessGate): string {
  return `Pending memory needs structured review before promotion: ${gate.reasons.map((reason) => reason.code).join(', ')}.`
}

function blockingReasonText(code: string): string {
  if (code === 'implementation_note') {
    return 'Implementation history should become an episode or reusable rule before promotion.'
  }
  if (code === 'raw_file_rule_excerpt') {
    return 'Raw file-rule excerpts should name the source of truth instead of duplicating policy text.'
  }
  if (code === 'overbroad_workflow_rule') {
    return 'Broad workflow rules need narrower applicability before promotion.'
  }
  if (code === 'needs_active_memory_rewrite') {
    return 'Candidate needs rewriting before active-memory review.'
  }
  return 'Candidate has a readiness blocker that needs review.'
}

function readinessReason(code: string, text: string): CodexPendingReadinessReason {
  return {
    code,
    text: truncateReason(text)
  }
}

function truncateReason(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (normalized.length <= READINESS_REASON_TEXT_LIMIT) return normalized
  return `${normalized.slice(0, READINESS_REASON_TEXT_LIMIT - 3)}...`
}

function deriveEpisodeEvidence(
  candidate: PendingMemory,
  candidateKind: CodexMemoryCandidateKind,
  recommendation: CodexPendingMemoryRecommendation,
  readinessStatus: ActiveMemoryReadinessResult['status'],
  risk: CodexPendingMemoryRisk
): CodexPendingEpisodeEvidence {
  const evidence = candidate.evidence[0]
  return {
    when: candidate.lastSeenAt || candidate.firstSeenAt,
    whatHappened: evidence?.summary || evidence?.quote || candidate.content,
    whyImportant: deriveWhyImportant(candidateKind, readinessStatus),
    result: `Recommended action: ${recommendation}; readiness: ${readinessStatus}; risk: ${risk}.`,
    source: candidate.source
  }
}

function deriveWhyImportant(candidateKind: CodexMemoryCandidateKind, readinessStatus: ActiveMemoryReadinessResult['status']): string {
  if (readinessStatus === 'needs_rewrite') {
    return 'The candidate should not enter active memory until it is reshaped for future use.'
  }
  if (candidateKind === 'known_pitfall') {
    return 'Capturing the pitfall can prevent repeated project mistakes.'
  }
  if (candidateKind === 'workflow_rule') {
    return 'The candidate may guide future project workflow.'
  }
  if (candidateKind === 'project_decision') {
    return 'The candidate may preserve project context for future work.'
  }
  return 'The candidate may affect future memory review behavior.'
}

function deriveProposedSemanticMemory(
  candidate: PendingMemory,
  candidateKind: CodexMemoryCandidateKind,
  activeReadiness: ActiveMemoryReadinessResult
): CodexPendingProposedSemanticMemory {
  return {
    type: candidateKind,
    scope: candidate.scope,
    content: candidate.content,
    useWhen: deriveUseWhen(candidateKind),
    doNotUseWhen: deriveDoNotUseWhen(activeReadiness),
    evidenceStrength: scoreLabel(candidate.scores.evidenceStrength),
    futureUsefulness: scoreLabel(candidate.scores.usefulness),
    expiry: candidate.expiresAt ?? 'none'
  }
}

function deriveUseWhen(candidateKind: CodexMemoryCandidateKind): string[] {
  if (candidateKind === 'known_pitfall') {
    return ['Diagnosing similar project failures.', 'Modifying related memory or readiness behavior.']
  }
  if (candidateKind === 'workflow_rule') {
    return ['Planning non-trivial project changes.', 'Reviewing future implementation workflow.']
  }
  if (candidateKind === 'project_decision') {
    return ['Continuing related project work.', 'Checking whether this project context is still current.']
  }
  return ['Reviewing future project memory candidates.']
}

function deriveDoNotUseWhen(activeReadiness: ActiveMemoryReadinessResult): string[] {
  if (!activeReadiness.ready) {
    return ['Promoting directly to active memory without rewriting.', 'Reviewing unrelated UI or workflow issues.']
  }
  return ['The candidate is stale or contradicted by source files.', 'The future task is unrelated to this project scope.']
}

function scoreLabel(score: number): CodexPendingReviewScore {
  if (score >= 0.75) return 'high'
  if (score >= 0.45) return 'medium'
  return 'low'
}

function suggestedReviewAction(
  candidateId: string,
  reviewHash: string,
  recommendation: CodexPendingMemoryRecommendation
): string {
  return `Review ${candidateId} in Codex chat before any ${recommendation} action; review hash ${reviewHash}.`
}

export async function listCodexPendingMemories(input: {
  cwd: string
  projectId?: string
  limit?: number
}): Promise<CodexPendingMemoryListResult> {
  const { project, memoryRoot, readableRoots } = await getProjectAndReadableMemoryRoots(input.cwd, input.projectId)
  const now = new Date().toISOString()
  const pendingByRoot = await Promise.all(readableRoots.map(async (root) => ({
    pending: await readPendingMemoriesFromRoot(root),
    receipts: await readSemanticRewriteReceiptsFromRoot(root)
  })))
  const summaries = sortPendingNewestFirst(pendingByRoot.flatMap((root) =>
    root.pending.map((candidate) => summarizePendingMemory(candidate, now, root.receipts))
  ))
  return {
    project,
    pending: input.limit === undefined ? summaries : summaries.slice(0, input.limit),
    total: summaries.length,
    memoryRoot
  }
}

export async function getCodexPendingMemory(input: {
  cwd: string
  projectId?: string
  id: string
}): Promise<CodexPendingMemoryGetResult> {
  const { project, memoryRoot, candidate } = await findPendingCandidateInCodexRoots(input.cwd, input.id, input.projectId)
  if (candidate === undefined) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'not_found',
        candidateId: input.id,
        reason: 'Pending memory candidate not found'
      }
    }
  }

  return {
    project,
    memoryRoot,
    result: {
      action: 'get',
      candidate,
      reviewHash: reviewHashForPendingMemory(candidate),
      review: summarizePendingMemory(candidate)
    }
  }
}

export async function promoteCodexPendingMemory(input: {
  cwd: string
  projectId?: string
  id: string
  reviewHash: string
  conflictResolution?: MemoryConflictResolution
  reason?: string
  now?: string
}): Promise<CodexPendingMemoryPromoteResult> {
  const now = input.now ?? new Date().toISOString()
  const { project, memoryRoot, candidate } = await findPendingCandidateInCodexRoots(input.cwd, input.id, input.projectId)
  if (candidate === undefined) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'not_found',
        candidateId: input.id,
        reason: 'Pending memory candidate not found'
      }
    }
  }

  const latestReviewHash = reviewHashForPendingMemory(candidate)
  if (latestReviewHash !== input.reviewHash) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'conflict',
        candidateId: input.id,
        reason: 'Pending memory candidate changed since review',
        latest: summarizePendingMemory(candidate)
      }
    }
  }

  const activeReadiness = activeReadinessForPending(candidate)
  const structuredGate = evaluateStructuredReadinessGate(candidate, pendingReviewSemanticMemory(candidate), activeReadiness)
  if (!structuredGate.ready) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'needs_rewrite',
        candidateId: candidate.id,
        reason: structuredPromotionBlockReason(structuredGate),
        readiness: structuredPromotionReadiness(structuredGate),
        reviewHash: latestReviewHash
      }
    }
  }

  const [active, tombstones] = await Promise.all([
    readActiveMemoriesFromRoot(memoryRoot),
    readTombstonesFromRoot(memoryRoot)
  ])
  const confirmedCandidate: PendingMemory = { ...candidate, userConfirmed: true }
  const decision = validateMemoryCandidate({ candidate: confirmedCandidate, existingMemories: active, tombstones, now })
  if (decision.action === 'reject') {
    return {
      project,
      memoryRoot,
      result: {
        action: 'rejected_by_validator',
        candidateId: candidate.id,
        reason: decision.reason,
        tombstone: decision.tombstone
      }
    }
  }

  const config = createDefaultConfig(input.cwd)
  const maintenanceBudget = {
    activeMaxItems: config.memoryActiveMaxItems,
    activeContentMaxChars: config.memoryActiveContentMaxChars,
    indexFileMaxChars: config.memoryIndexFileMaxChars,
    singleMemoryContentMaxChars: config.memorySingleContentMaxChars,
    singleMemoryEvidenceMaxChars: config.memorySingleEvidenceMaxChars,
    pendingMaxItems: config.memoryPendingMaxItems
  }

  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const lockedPending = await readPendingMemoriesFromRoot(lockedMemoryRoot)
    const lockedCandidate = lockedPending.find((memoryCandidate) => memoryCandidate.id === candidate.id)
    if (lockedCandidate === undefined) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'not_found',
          candidateId: candidate.id,
          reason: 'Pending memory candidate not found'
        }
      }
    }

    const lockedReviewHash = reviewHashForPendingMemory(lockedCandidate)
    if (lockedReviewHash !== input.reviewHash) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'conflict',
          candidateId: candidate.id,
          reason: 'Pending memory candidate changed since review',
          latest: summarizePendingMemory(lockedCandidate)
        }
      }
    }

    const lockedActiveReadiness = activeReadinessForPending(lockedCandidate)
    const lockedStructuredGate = evaluateStructuredReadinessGate(lockedCandidate, pendingReviewSemanticMemory(lockedCandidate), lockedActiveReadiness)
    if (!lockedStructuredGate.ready) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'needs_rewrite',
          candidateId: lockedCandidate.id,
          reason: structuredPromotionBlockReason(lockedStructuredGate),
          readiness: structuredPromotionReadiness(lockedStructuredGate),
          reviewHash: lockedReviewHash
        }
      }
    }

    const [lockedActive, lockedTombstones] = await Promise.all([
      readActiveMemoriesFromRoot(lockedMemoryRoot),
      readTombstonesFromRoot(lockedMemoryRoot)
    ])
    const lockedConfirmedCandidate: PendingMemory = { ...lockedCandidate, userConfirmed: true }
    const lockedDecision = validateMemoryCandidate({
      candidate: lockedConfirmedCandidate,
      existingMemories: lockedActive,
      tombstones: lockedTombstones,
      now
    })
    if (lockedDecision.action === 'reject') {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'rejected_by_validator',
          candidateId: lockedCandidate.id,
          reason: lockedDecision.reason,
          tombstone: lockedDecision.tombstone
        }
      }
    }

    if (!lockedActiveReadiness.ready) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'needs_rewrite',
          candidateId: lockedCandidate.id,
          reason: 'Pending memory must be rewritten before it can become active memory.',
          readiness: lockedActiveReadiness,
          reviewHash: lockedReviewHash
        }
      }
    }

    const baseMemory = memoryForPromotedDecision(lockedDecision, now)
    const normalizedKeyConflicts = findNormalizedKeyConflicts(lockedActive, baseMemory)
    if (normalizedKeyConflicts.length > 0 && input.conflictResolution === undefined) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: normalizedKeyConflictResult(lockedCandidate, normalizedKeyConflicts)
      }
    }

    if (normalizedKeyConflicts.length > 0 && input.conflictResolution === 'reject_new') {
      const tombstone = tombstoneForRejectedCandidate(lockedCandidate, now)
      const nextPending = lockedPending.filter((memoryCandidate) => memoryCandidate.id !== lockedCandidate.id)
      await writePendingMemoriesFromRoot(lockedMemoryRoot, nextPending)
      await appendTombstoneFromRoot(lockedMemoryRoot, tombstone)
      await appendMemoryEventFromRoot(lockedMemoryRoot, {
        id: randomUUID(),
        action: 'reject',
        at: now,
        reason: input.reason ?? 'Rejected by normalizedKey conflict resolution',
        candidateId: lockedCandidate.id,
        details: reviewEventDetails(
          lockedCandidate,
          'reject',
          conflictResolutionDetails('reject_new', lockedCandidate.normalizedKey, normalizedKeyConflicts)
        )
      })
      await appendMemoryEventFromRoot(lockedMemoryRoot, {
        id: randomUUID(),
        action: 'audit',
        at: now,
        reason: 'NormalizedKey conflict resolved by rejecting the new candidate',
        candidateId: lockedCandidate.id,
        details: conflictResolutionDetails('reject_new', lockedCandidate.normalizedKey, normalizedKeyConflicts)
      })
      await syncCurrentCodexMemoryIndex({ cwd: input.cwd })

      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'reject_new',
          candidateId: lockedCandidate.id,
          normalizedKey: lockedCandidate.normalizedKey,
          conflicts: normalizedKeyConflicts.map(summarizeNormalizedKeyConflict),
          tombstone,
          reviewHash: lockedReviewHash
        }
      }
    }

    const supersededMemoryIds = input.conflictResolution === 'supersede'
      ? normalizedKeyConflicts.map((memory) => memory.id)
      : []
    const promotedMemory: CyreneMemory = supersededMemoryIds.length === 0
      ? baseMemory
      : {
          ...baseMemory,
          supersedes: uniqueInOrder([...(baseMemory.supersedes ?? []), ...supersededMemoryIds])
        }
    const activeWithoutSuperseded = supersededMemoryIds.length === 0
      ? lockedActive
      : lockedActive.filter((memory) => !supersededMemoryIds.includes(memory.id))
    const keepBothConflictIds = new Set(
      input.conflictResolution === 'keep_both' ? normalizedKeyConflicts.map((memory) => memory.id) : []
    )
    const activeForWrite: CyreneMemory[] = keepBothConflictIds.size === 0
      ? activeWithoutSuperseded
      : activeWithoutSuperseded.map((memory) =>
          keepBothConflictIds.has(memory.id)
            ? { ...memory, normalizedKeyConflictResolution: 'keep_both' as const }
            : memory
        )
    const lockedMemory: CyreneMemory = input.conflictResolution === 'keep_both'
      ? { ...promotedMemory, normalizedKeyConflictResolution: 'keep_both' }
      : promotedMemory
    const nextActive = input.conflictResolution === 'keep_both'
      ? appendActiveMemory(activeForWrite, lockedMemory)
      : upsertActiveMemory(activeForWrite, lockedMemory)
    const nextPending = lockedPending.filter((memoryCandidate) => memoryCandidate.id !== lockedCandidate.id)

    await writeActiveMemoriesFromRoot(lockedMemoryRoot, nextActive)
    await writePendingMemoriesFromRoot(lockedMemoryRoot, nextPending)
    if (input.conflictResolution === 'supersede') {
      for (const conflict of normalizedKeyConflicts) {
        await appendTombstoneFromRoot(lockedMemoryRoot, tombstoneForSupersededMemory(conflict, lockedMemory, now))
      }
      await appendMemoryEventFromRoot(lockedMemoryRoot, {
        id: randomUUID(),
        action: 'supersede',
        at: now,
        reason: input.reason ?? 'NormalizedKey conflict resolved by superseding active memory',
        memoryId: lockedMemory.id,
        candidateId: lockedCandidate.id,
        details: conflictResolutionDetails('supersede', lockedCandidate.normalizedKey, normalizedKeyConflicts)
      })
    } else if (input.conflictResolution === 'keep_both') {
      await appendMemoryEventFromRoot(lockedMemoryRoot, {
        id: randomUUID(),
        action: 'audit',
        at: now,
        reason: input.reason ?? 'NormalizedKey conflict resolved by keeping both memories',
        memoryId: lockedMemory.id,
        candidateId: lockedCandidate.id,
        details: conflictResolutionDetails('keep_both', lockedCandidate.normalizedKey, normalizedKeyConflicts)
      })
    }
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'promote',
      at: now,
      reason: input.reason ?? 'Approved by Codex pending memory review',
      memoryId: lockedMemory.id,
      candidateId: lockedCandidate.id,
      details: reviewEventDetails(lockedCandidate, 'promote')
    })
    await runMemoryMaintenanceFromRootLocked({
      memoryRoot: lockedMemoryRoot,
      budget: maintenanceBudget,
      now,
      reason: 'after manual memory promotion',
      preserveDuplicateNormalizedKeys: input.conflictResolution === 'keep_both' ? [lockedCandidate.normalizedKey] : undefined
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })

    return {
      project,
      memoryRoot: lockedMemoryRoot,
      result: {
        action: 'promote',
        candidateId: lockedCandidate.id,
        memory: lockedMemory,
        reviewHash: lockedReviewHash
      }
    }
  })
}

function memoryForPromotedDecision(
  decision: Exclude<ReturnType<typeof validateMemoryCandidate>, { action: 'reject' }>,
  now: string
): CyreneMemory {
  if (decision.action === 'pending') {
    return activateCandidate({ ...decision.candidate, userConfirmed: true }, now)
  }

  if (decision.action === 'auto_write') {
    return { ...decision.memory, userConfirmed: true }
  }

  throw new Error(`Unsupported validator action for Codex pending promotion: ${decision.action}`)
}

export async function rejectCodexPendingMemory(input: {
  cwd: string
  projectId?: string
  id: string
  reviewHash: string
  reason?: string
  now?: string
}): Promise<CodexPendingMemoryRejectResult> {
  const now = input.now ?? new Date().toISOString()
  const { project, memoryRoot, candidate } = await findPendingCandidateInCodexRoots(input.cwd, input.id, input.projectId)
  if (candidate === undefined) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'not_found',
        candidateId: input.id,
        reason: 'Pending memory candidate not found'
      }
    }
  }

  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const lockedPending = await readPendingMemoriesFromRoot(lockedMemoryRoot)
    const lockedCandidate = lockedPending.find((memoryCandidate) => memoryCandidate.id === candidate.id)
    if (lockedCandidate === undefined) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'not_found',
          candidateId: candidate.id,
          reason: 'Pending memory candidate not found'
        }
      }
    }

    const latestReviewHash = reviewHashForPendingMemory(lockedCandidate)
    if (latestReviewHash !== input.reviewHash) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'conflict',
          candidateId: candidate.id,
          reason: 'Pending memory candidate changed since review',
          latest: summarizePendingMemory(lockedCandidate)
        }
      }
    }

    const tombstone = tombstoneForRejectedCandidate(lockedCandidate, now)
    const nextPending = lockedPending.filter((memoryCandidate) => memoryCandidate.id !== lockedCandidate.id)
    await writePendingMemoriesFromRoot(lockedMemoryRoot, nextPending)
    await appendTombstoneFromRoot(lockedMemoryRoot, tombstone)
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'reject',
      at: now,
      reason: input.reason ?? 'Rejected by Codex pending memory review',
      candidateId: lockedCandidate.id,
      details: reviewEventDetails(lockedCandidate, 'reject')
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })

    return {
      project,
      memoryRoot: lockedMemoryRoot,
      result: {
        action: 'reject',
        candidateId: lockedCandidate.id,
        tombstone,
        reviewHash: latestReviewHash
      }
    }
  })
}

export async function editCodexPendingMemory(input: {
  cwd: string
  projectId?: string
  id: string
  reviewHash: string
  content: string
  normalizedKey?: string
  candidateKind?: MemoryCandidateKind
  tags?: string[]
  scores?: Partial<MemoryScores>
  reason?: string
  now?: string
}): Promise<CodexPendingMemoryEditResult> {
  const now = input.now ?? new Date().toISOString()
  const { project, memoryRoot, candidate } = await findPendingCandidateInCodexRoots(input.cwd, input.id, input.projectId)
  if (candidate === undefined) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'not_found',
        candidateId: input.id,
        reason: 'Pending memory candidate not found'
      }
    }
  }

  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const lockedPending = await readPendingMemoriesFromRoot(lockedMemoryRoot)
    const lockedCandidate = lockedPending.find((memoryCandidate) => memoryCandidate.id === candidate.id)
    if (lockedCandidate === undefined) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'not_found',
          candidateId: candidate.id,
          reason: 'Pending memory candidate not found'
        }
      }
    }

    const latestReviewHash = reviewHashForPendingMemory(lockedCandidate)
    if (latestReviewHash !== input.reviewHash) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'conflict',
          candidateId: candidate.id,
          reason: 'Pending memory candidate changed since review',
          latest: summarizePendingMemory(lockedCandidate)
        }
      }
    }

    const editedCandidate: PendingMemory = {
      ...lockedCandidate,
      content: input.content,
      normalizedKey: input.normalizedKey ?? lockedCandidate.normalizedKey,
      ...(input.candidateKind === undefined ? {} : { candidateKind: input.candidateKind }),
      ...(input.tags === undefined ? {} : { tags: uniqueInOrder(input.tags) }),
      ...(input.scores === undefined ? {} : { scores: { ...lockedCandidate.scores, ...input.scores } }),
      lastSeenAt: now
    }
    const [lockedActive, lockedTombstones] = await Promise.all([
      readActiveMemoriesFromRoot(lockedMemoryRoot),
      readTombstonesFromRoot(lockedMemoryRoot)
    ])
    const decision = validateMemoryCandidate({
      candidate: editedCandidate,
      existingMemories: lockedActive,
      tombstones: lockedTombstones,
      now
    })
    if (decision.action === 'reject') {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'rejected_by_validator',
          candidateId: candidate.id,
          reason: decision.reason,
          tombstone: decision.tombstone
        }
      }
    }

    const validatedCandidate = decision.action === 'pending' ? decision.candidate : editedCandidate
    const nextPending = lockedPending.map((memoryCandidate) =>
      memoryCandidate.id === candidate.id ? validatedCandidate : memoryCandidate
    )
    await writePendingMemoriesFromRoot(lockedMemoryRoot, nextPending)
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'pending',
      at: now,
      reason: input.reason ?? 'Edited by Codex pending memory review',
      candidateId: validatedCandidate.id,
      details: reviewEventDetails(validatedCandidate, 'edit')
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })

    return {
      project,
      memoryRoot: lockedMemoryRoot,
      result: {
        action: 'edit',
        candidateId: validatedCandidate.id,
        candidate: validatedCandidate,
        reviewHash: reviewHashForPendingMemory(validatedCandidate)
      }
    }
  })
}

export async function deferCodexPendingMemory(input: {
  cwd: string
  projectId?: string
  id: string
  reviewHash: string
  days?: number
  reason?: string
  now?: string
}): Promise<CodexPendingMemoryDeferResult> {
  const now = input.now ?? new Date().toISOString()
  const days = input.days ?? 7
  const { project, memoryRoot, candidate } = await findPendingCandidateInCodexRoots(input.cwd, input.id, input.projectId)
  if (candidate === undefined) {
    return {
      project,
      memoryRoot,
      result: {
        action: 'not_found',
        candidateId: input.id,
        reason: 'Pending memory candidate not found'
      }
    }
  }

  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const lockedPending = await readPendingMemoriesFromRoot(lockedMemoryRoot)
    const lockedCandidate = lockedPending.find((memoryCandidate) => memoryCandidate.id === candidate.id)
    if (lockedCandidate === undefined) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'not_found',
          candidateId: candidate.id,
          reason: 'Pending memory candidate not found'
        }
      }
    }

    const latestReviewHash = reviewHashForPendingMemory(lockedCandidate)
    if (latestReviewHash !== input.reviewHash) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'conflict',
          candidateId: candidate.id,
          reason: 'Pending memory candidate changed since review',
          latest: summarizePendingMemory(lockedCandidate)
        }
      }
    }

    const deferredCandidate: PendingMemory = {
      ...lockedCandidate,
      promoteAfter: addDays(now, days)
    }
    const nextPending = lockedPending.map((memoryCandidate) =>
      memoryCandidate.id === candidate.id ? deferredCandidate : memoryCandidate
    )
    await writePendingMemoriesFromRoot(lockedMemoryRoot, nextPending)
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'pending',
      at: now,
      reason: input.reason ?? 'Deferred by Codex pending memory review',
      candidateId: deferredCandidate.id,
      details: { reviewAction: 'defer', days }
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })

    return {
      project,
      memoryRoot: lockedMemoryRoot,
      result: {
        action: 'defer',
        candidateId: deferredCandidate.id,
        candidate: deferredCandidate,
        reviewHash: reviewHashForPendingMemory(deferredCandidate)
      }
    }
  })
}

export async function getCodexPendingReviewNotice(input: { cwd: string; projectId?: string }): Promise<CodexPendingReviewNotice> {
  const { readableRoots } = await getProjectAndReadableMemoryRoots(input.cwd, input.projectId)
  const pending = sortPendingNewestFirst((await Promise.all(readableRoots.map((root) => readPendingMemoriesFromRoot(root)))).flat())
  const newest = pending[0]
  return {
    count: pending.length,
    hasItems: pending.length > 0,
    ...(newest === undefined
      ? {}
      : {
          newestCandidateId: newest.id,
          newestPreview: previewContent(newest.content)
        })
  }
}

function upsertActiveMemory(active: CyreneMemory[], memory: CyreneMemory): CyreneMemory[] {
  const index = active.findIndex((candidate) => candidate.id === memory.id || candidate.normalizedKey === memory.normalizedKey)
  if (index < 0) {
    return [...active, memory]
  }

  const next = [...active]
  next[index] = memory
  return next
}

function appendActiveMemory(active: CyreneMemory[], memory: CyreneMemory): CyreneMemory[] {
  return [...active.filter((candidate) => candidate.id !== memory.id), memory]
}

function findNormalizedKeyConflicts(active: CyreneMemory[], memory: Pick<CyreneMemory, 'id' | 'normalizedKey'>): CyreneMemory[] {
  return active.filter((candidate) => candidate.id !== memory.id && candidate.normalizedKey === memory.normalizedKey)
}

function normalizedKeyConflictResult(
  candidate: PendingMemory,
  conflicts: CyreneMemory[]
): Extract<CodexPendingMemoryPromoteResult['result'], { action: 'normalized_key_conflict' }> {
  return {
    action: 'normalized_key_conflict',
    candidateId: candidate.id,
    normalizedKey: candidate.normalizedKey,
    reason: 'Active memory with the same normalizedKey requires explicit conflict resolution',
    conflicts: conflicts.map(summarizeNormalizedKeyConflict),
    resolutionOptions: NORMALIZED_KEY_CONFLICT_RESOLUTIONS
  }
}

function summarizeNormalizedKeyConflict(memory: CyreneMemory): CodexNormalizedKeyConflict {
  return {
    id: memory.id,
    content: memory.content,
    normalizedKey: memory.normalizedKey,
    domain: memory.domain,
    type: memory.type,
    scope: memory.scope,
    updatedAt: memory.updatedAt
  }
}

function conflictResolutionDetails(
  resolution: MemoryConflictResolution,
  normalizedKey: string,
  conflicts: CyreneMemory[]
): Record<string, unknown> {
  return {
    resolution,
    normalizedKey,
    conflictingMemoryIds: conflicts.map((memory) => memory.id),
    conflicts: conflicts.map(summarizeNormalizedKeyConflict),
    ...(resolution === 'supersede'
      ? { supersededMemories: conflicts.map((memory) => lifecycleMemorySnapshot(memory, 'superseded')) }
      : {})
  }
}

function lifecycleMemorySnapshot(memory: CyreneMemory, status: 'superseded'): Record<string, unknown> {
  return {
    ...memory,
    status
  }
}

function reviewEventDetails(
  candidate: PendingMemory,
  reviewAction: 'reject' | 'edit' | 'promote',
  base: Record<string, unknown> = {}
): Record<string, unknown> {
  const reviewPatternId = transientReviewPatternId(candidate)
  return {
    ...base,
    reviewAction,
    ...(reviewPatternId === undefined ? {} : { reviewPatternId }),
    candidateKind: deriveMemoryCandidateKind(candidate),
    normalizedKey: candidate.normalizedKey
  }
}

function transientReviewPatternId(candidate: PendingMemory): string | undefined {
  const text = `${candidate.content} ${candidate.normalizedKey}`.toLowerCase()
  return /(ran npm test|git status|current branch|today|temporary|one-off)/.test(text)
    ? 'reject-transient-test-status'
    : undefined
}

function tombstoneForRejectedCandidate(candidate: PendingMemory, now: string): MemoryTombstone {
  return {
    id: `tombstone-${candidate.id}`,
    memoryId: candidate.id,
    normalizedKey: candidate.normalizedKey,
    domain: candidate.domain,
    type: candidate.type,
    strength: candidate.strength,
    scope: candidate.scope,
    reason: 'rejected',
    createdAt: now,
    evidence: candidate.evidence
  }
}

function tombstoneForSupersededMemory(memory: CyreneMemory, replacementMemory: CyreneMemory, now: string): MemoryTombstone {
  return {
    id: `tombstone-${memory.id}`,
    memoryId: memory.id,
    normalizedKey: memory.normalizedKey,
    domain: memory.domain,
    type: memory.type,
    strength: memory.strength,
    scope: memory.scope,
    reason: 'superseded',
    createdAt: now,
    replacementMemoryId: replacementMemory.id,
    evidence: memory.evidence
  }
}

async function getProjectAndMemoryRoot(cwd: string, projectId?: string): Promise<{
  project: CodexPendingMemoryProject
  memoryRoot: string
}> {
  const identity = projectId === undefined ? await identifyCodexProject(cwd) : await identifyCodexProjectById(cwd, projectId)
  const memoryRoot =
    (await getReadableCodexProjectMemoryRoot(identity.projectId)) ?? codexProjectMemoryRoot(identity.projectId)
  return {
    project: { projectId: identity.projectId, displayName: identity.displayName },
    memoryRoot
  }
}

async function identifyCodexProjectById(cwd: string, projectId: string): Promise<CodexPendingMemoryProject> {
  const validProjectId = validateProjectId(projectId)
  const current = await identifyCodexProject(cwd)
  if (current.projectId === validProjectId) {
    return { projectId: current.projectId, displayName: current.displayName }
  }

  const projects = await listCodexProjects().catch(() => [])
  const project = projects.find((entry) => entry.projectId === validProjectId)
  return {
    projectId: validProjectId,
    displayName: project?.aliases[0] ?? validProjectId
  }
}

async function getProjectAndReadableMemoryRoots(cwd: string, projectId?: string): Promise<{
  project: CodexPendingMemoryProject
  memoryRoot: string
  readableRoots: string[]
}> {
  const { project, memoryRoot } = await getProjectAndMemoryRoot(cwd, projectId)
  const globalRoot = (await getReadableCodexGlobalMemoryRoot()) ?? codexGlobalMemoryRoot()
  return {
    project,
    memoryRoot,
    readableRoots: uniqueInOrder([globalRoot, memoryRoot])
  }
}

async function findPendingCandidateInCodexRoots(cwd: string, id: string, projectId?: string): Promise<{
  project: CodexPendingMemoryProject
  memoryRoot: string
  pending: PendingMemory[]
  candidate?: PendingMemory
}> {
  const { project, memoryRoot, readableRoots } = await getProjectAndReadableMemoryRoots(cwd, projectId)
  for (const root of readableRoots) {
    const pending = await readPendingMemoriesFromRoot(root)
    const candidate = pending.find((memory) => memory.id === id)
    if (candidate !== undefined) {
      return { project, memoryRoot: root, pending, candidate }
    }
  }

  return { project, memoryRoot, pending: [], candidate: undefined }
}

function sortPendingNewestFirst<T extends { id: string; lastSeenAt: string }>(pending: T[]): T[] {
  return [...pending].sort((left, right) => {
    const lastSeen = right.lastSeenAt.localeCompare(left.lastSeenAt)
    return lastSeen === 0 ? left.id.localeCompare(right.id) : lastSeen
  })
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

function validateProjectId(value: string): string {
  const trimmed = value.trim()
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed) || /^\.+$/.test(trimmed)) {
    throw new Error(`Invalid projectId: ${value}`)
  }
  return trimmed
}

function previewContent(content: string): string {
  return content.length <= 160 ? content : `${content.slice(0, 157)}...`
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}
