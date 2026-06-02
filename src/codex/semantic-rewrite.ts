import { randomUUID } from 'node:crypto'
import { deriveMemoryCandidateKind } from '../memory/candidate-kind.js'
import type {
  PendingMemory,
  SemanticRewriteReceipt,
  SemanticRewriteReceiptAction,
  SemanticRewriteMethod
} from '../memory/types.js'
import { evaluateActiveMemoryReadiness } from './active-memory-readiness.js'
import { reviewHashForPendingMemory } from './memory-review.js'
import {
  classifySemanticBoundaryPattern,
  deriveSemanticBoundaries
} from './semantic-boundaries.js'
import {
  contentHashForSemanticRewrite,
  validateSemanticRewriteCandidate,
  type SemanticRewriteValidationResult
} from './semantic-rewrite-validator.js'

export { validateSemanticRewriteCandidate } from './semantic-rewrite-validator.js'

export interface SemanticRewriteOptions {
  now?: string
  ineligibleReasons?: string[]
}

export interface SemanticRewritePreparationResult {
  action: SemanticRewriteReceiptAction
  original: PendingMemory
  next: PendingMemory
  eligibilityReasons: string[]
  validation: SemanticRewriteValidationResult
  receipt?: SemanticRewriteReceipt
}

export function preparePendingSemanticRewrite(
  candidate: PendingMemory,
  options: SemanticRewriteOptions = {}
): SemanticRewritePreparationResult {
  const now = options.now ?? new Date().toISOString()
  const ineligibleReasons = semanticPrepareIneligibilityReasons(candidate, options.ineligibleReasons ?? [])
  if (ineligibleReasons.length > 0) {
    return skipSemanticRewrite(candidate, ineligibleReasons)
  }
  const candidateKind = deriveMemoryCandidateKind(candidate)
  const readiness = evaluateActiveMemoryReadiness({
    content: candidate.content,
    candidateKind,
    domain: candidate.domain,
    type: candidate.type,
    tags: candidate.tags
  })

  if (!readiness.ready) {
    const rewrittenContent = rewriteContentForReadiness(candidate, readiness.reasons)
    const next: PendingMemory = rewrittenContent === undefined
      ? candidate
      : {
          ...candidate,
          content: rewrittenContent,
          lastSeenAt: now
        }
    const validation = validateSemanticRewriteCandidate({
      original: candidate,
      next,
      action: rewrittenContent === undefined ? 'fail' : 'replace_content'
    })
    const action: SemanticRewriteReceiptAction = validation.valid ? 'replace_content' : 'fail'
    return {
      action,
      original: candidate,
      next: validation.valid ? next : candidate,
      eligibilityReasons: readiness.reasons,
      validation,
      receipt: semanticRewriteReceipt({
        original: candidate,
        next: validation.valid ? next : candidate,
        action,
        method: 'deterministic',
        changedFields: validation.valid ? ['content'] : [],
        eligibilityReasons: readiness.reasons,
        validatorReasons: validation.valid ? ['rewritten_content_is_active_ready'] : validation.reasons,
        now
      })
    }
  }

  const boundaryEligibilityReason = boundaryEnrichmentEligibilityReason(candidate)
  if (boundaryEligibilityReason !== undefined) {
    const boundaries = deriveSemanticBoundaries({
      content: candidate.content,
      candidateKind,
      domain: candidate.domain,
      scope: candidate.scope,
      normalizedKey: candidate.normalizedKey,
      sourceOfTruth: candidate.sourceOfTruth,
      evidenceRefs: evidenceRefsForPending(candidate.evidence),
      tags: candidate.tags
    })
    const next: PendingMemory = {
      ...candidate,
      useWhen: boundaries.useWhen,
      doNotUseWhen: boundaries.doNotUseWhen,
      lastSeenAt: now
    }
    const validation = validateSemanticRewriteCandidate({
      original: candidate,
      next,
      action: 'enrich_boundaries'
    })
    const action: SemanticRewriteReceiptAction = validation.valid ? 'enrich_boundaries' : 'fail'
    return {
      action,
      original: candidate,
      next: validation.valid ? next : candidate,
      eligibilityReasons: [boundaryEligibilityReason],
      validation,
      receipt: semanticRewriteReceipt({
        original: candidate,
        next: validation.valid ? next : candidate,
        action,
        method: 'deterministic',
        changedFields: validation.valid ? ['useWhen', 'doNotUseWhen'] : [],
        eligibilityReasons: [boundaryEligibilityReason],
        validatorReasons: validation.valid ? ['boundary_enrichment_preserves_content_hash'] : validation.reasons,
        now
      })
    }
  }

  const validation = validateSemanticRewriteCandidate({
    original: candidate,
    next: candidate,
    action: 'skip'
  })
  return {
    action: 'skip',
    original: candidate,
    next: candidate,
    eligibilityReasons: ['already_ready_without_prepare_changes'],
    validation
  }
}

function skipSemanticRewrite(candidate: PendingMemory, eligibilityReasons: string[]): SemanticRewritePreparationResult {
  return {
    action: 'skip',
    original: candidate,
    next: candidate,
    eligibilityReasons,
    validation: validateSemanticRewriteCandidate({
      original: candidate,
      next: candidate,
      action: 'skip'
    })
  }
}

function semanticPrepareIneligibilityReasons(
  candidate: PendingMemory,
  externalReasons: readonly string[]
): string[] {
  return uniqueInOrder([
    ...externalReasons,
    ...(nonEmptyString(candidate.sourceOfTruth) === undefined ? ['source_boundary_unconfirmed'] : []),
    ...(candidate.domain === 'personal' || candidate.domain === 'relationship' || candidate.domain === 'affective'
      ? ['high_risk_memory_domain']
      : []),
    ...(candidate.conflictsWith !== undefined && candidate.conflictsWith.length > 0 ? ['conflicted_pending'] : []),
    ...(candidate.promoteAfter !== undefined ? ['user_deferred_pending'] : []),
    ...(candidate.userConfirmed ? ['user_confirmed_pending'] : [])
  ])
}

function boundaryEnrichmentEligibilityReason(candidate: PendingMemory): string | undefined {
  if (classifySemanticBoundaryPattern(candidate) !== undefined) return 'semantic_boundary_pattern'
  if (hasTemplateSemanticBoundaries(candidate)) return 'template_semantic_boundaries'
  return undefined
}

function hasTemplateSemanticBoundaries(candidate: PendingMemory): boolean {
  return [
    ...(candidate.useWhen ?? []),
    ...(candidate.doNotUseWhen ?? [])
  ].some(isTemplateSemanticBoundary)
}

function isTemplateSemanticBoundary(value: string): boolean {
  return /Future task matches/i.test(value) ||
    /evidence no longer supports this memory/i.test(value) ||
    /source of truth no longer says/i.test(value)
}

function rewriteContentForReadiness(candidate: PendingMemory, reasons: readonly string[]): string | undefined {
  if (reasons.includes('implementation_note')) {
    return rewriteImplementationNote(candidate.content)
  }
  if (reasons.includes('raw_file_rule_excerpt')) {
    return rewriteRawFileRuleExcerpt(candidate.content)
  }
  if (reasons.includes('overbroad_workflow_rule')) {
    return 'For non-trivial code or architecture changes, keep edits traceable to the requested issue and leave unrelated code untouched.'
  }
  return undefined
}

function rewriteImplementationNote(content: string): string {
  if (/admission[-\s]?gate/i.test(content) && /subagent-driven/i.test(content) && /(?:隔离工作区|worktree)/i.test(content)) {
    return 'Admission-gate memory work should coordinate independent tasks through subagent-driven execution in an isolated worktree.'
  }
  return 'Project memory should retain reusable guidance from completed implementation work instead of storing one-time implementation history.'
}

function rewriteRawFileRuleExcerpt(content: string): string {
  const source = /\bAGENTS\.md\b/i.test(content) ? 'AGENTS.md' : 'the source-of-truth file'
  return `${source} is the source of truth for repository working rules; active memory should reference it instead of copying raw policy text.`
}

function nonEmptyString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function uniqueInOrder(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

function semanticRewriteReceipt(input: {
  original: PendingMemory
  next: PendingMemory
  action: SemanticRewriteReceiptAction
  method: SemanticRewriteMethod
  changedFields: string[]
  eligibilityReasons: string[]
  validatorReasons: string[]
  now: string
}): SemanticRewriteReceipt {
  const oldReviewHash = reviewHashForPendingMemory(input.original)
  const newReviewHash = input.action === 'replace_content' || input.action === 'enrich_boundaries'
    ? reviewHashForPendingMemory(input.next)
    : undefined
  const rewrittenContentHash = input.action === 'replace_content' || input.action === 'enrich_boundaries'
    ? contentHashForSemanticRewrite(input.next.content)
    : undefined
  return {
    id: randomUUID(),
    pendingMemoryId: input.original.id,
    action: input.action,
    method: input.method,
    oldReviewHash,
    ...(newReviewHash === undefined ? {} : { newReviewHash }),
    originalContentHash: contentHashForSemanticRewrite(input.original.content),
    ...(rewrittenContentHash === undefined ? {} : { rewrittenContentHash }),
    changedFields: input.changedFields,
    eligibilityReasons: input.eligibilityReasons,
    validatorReasons: input.validatorReasons,
    ...(input.original.sourceOfTruth === undefined ? {} : { sourceOfTruth: input.original.sourceOfTruth }),
    createdAt: input.now
  }
}

function evidenceRefsForPending(evidence: PendingMemory['evidence']): string[] {
  return evidence.flatMap((entry) => [
    ...(entry.traceRefs ?? []),
    ...(entry.messageIds ?? []),
    entry.runId,
    entry.sessionId,
    entry.taskHash,
    entry.quoteHash,
    entry.evidenceGroupId,
    entry.summary
  ]).flatMap((value) => value === undefined ? [] : [value])
}
