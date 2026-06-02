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
}

export interface SemanticRewritePreparationResult {
  action: SemanticRewriteReceiptAction
  original: PendingMemory
  next: PendingMemory
  validation: SemanticRewriteValidationResult
  receipt?: SemanticRewriteReceipt
}

export function preparePendingSemanticRewrite(
  candidate: PendingMemory,
  options: SemanticRewriteOptions = {}
): SemanticRewritePreparationResult {
  const now = options.now ?? new Date().toISOString()
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

  if (classifySemanticBoundaryPattern(candidate) !== undefined) {
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
      validation,
      receipt: semanticRewriteReceipt({
        original: candidate,
        next: validation.valid ? next : candidate,
        action,
        method: 'deterministic',
        changedFields: validation.valid ? ['useWhen', 'doNotUseWhen'] : [],
        eligibilityReasons: ['semantic_boundary_pattern'],
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
    validation
  }
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
