import { createHash } from 'node:crypto'
import { deriveMemoryCandidateKind } from '../memory/candidate-kind.js'
import type {
  PendingMemory,
  SemanticRewriteReceiptAction
} from '../memory/types.js'
import {
  evaluateActiveMemoryReadiness,
  type ActiveMemoryReadinessResult
} from './active-memory-readiness.js'

export interface SemanticRewriteValidationInput {
  original: PendingMemory
  next: PendingMemory
  action: SemanticRewriteReceiptAction
}

export interface SemanticRewriteValidationResult {
  valid: boolean
  reasons: string[]
  beforeReadiness: ActiveMemoryReadinessResult
  afterReadiness: ActiveMemoryReadinessResult
}

export function validateSemanticRewriteCandidate(
  input: SemanticRewriteValidationInput
): SemanticRewriteValidationResult {
  const beforeReadiness = activeReadinessForPending(input.original)
  const afterReadiness = activeReadinessForPending(input.next)
  const reasons: string[] = []

  if (input.original.sourceOfTruth !== undefined && input.next.sourceOfTruth !== input.original.sourceOfTruth) {
    reasons.push('source_of_truth_must_be_preserved')
  }
  if (input.next.scope !== input.original.scope) {
    reasons.push('scope_must_not_change')
  }
  if (input.next.domain !== input.original.domain) {
    reasons.push('domain_must_not_change')
  }
  if (
    input.next.scores.safety < input.original.scores.safety ||
    input.next.scores.sensitivity > input.original.scores.sensitivity
  ) {
    reasons.push('risk_must_not_expand')
  }

  if (input.action === 'replace_content') {
    if (beforeReadiness.ready) {
      reasons.push('replace_content_requires_needs_rewrite')
    }
    if (input.next.content === input.original.content) {
      reasons.push('replacement_content_must_change')
    }
    if (!afterReadiness.ready) {
      reasons.push('rewritten_content_must_be_active_ready')
    }
  }

  if (input.action === 'enrich_boundaries') {
    if (contentHashForSemanticRewrite(input.next.content) !== contentHashForSemanticRewrite(input.original.content)) {
      reasons.push('boundary_enrichment_must_not_change_content')
    }
  }

  return {
    valid: reasons.length === 0,
    reasons,
    beforeReadiness,
    afterReadiness
  }
}

export function contentHashForSemanticRewrite(content: string): string {
  return createHash('sha256').update(content).digest('hex')
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
