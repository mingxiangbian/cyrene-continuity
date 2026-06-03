import {
  classifySemanticBoundaryPattern,
  deriveSemanticBoundaries,
  type SemanticBoundaries,
  type SemanticBoundarySource
} from './semantic-boundaries.js'

export interface ShapedPendingCandidateContent extends SemanticBoundaries {
  content: string
  changed: boolean
}

const PENDING_MEMORY_REJECTION_WORKFLOW_CONTENT =
  'Pending-memory rejection workflows must validate each candidate review hash before mutation and verify the queue state after rejection.'

const PENDING_REVIEW_HASH_FALSE_CONFLICT_PITFALL_CONTENT =
  'Pending-review hashes must be read from review_queue.jsonl records rather than semantic projection or cache-derived data; projection rewrites can cause false review-hash conflicts.'

export function shapePendingCandidateContent(input: SemanticBoundarySource): ShapedPendingCandidateContent {
  const originalContent = contentOf(input)
  const shapedContent = rewriteContentFor(input) ?? originalContent

  return {
    content: shapedContent,
    changed: shapedContent !== originalContent,
    ...deriveSemanticBoundaries(input)
  }
}

function rewriteContentFor(input: SemanticBoundarySource): string | undefined {
  const pattern = classifySemanticBoundaryPattern(input)
  if (pattern === 'pending_memory_rejection_workflow') return PENDING_MEMORY_REJECTION_WORKFLOW_CONTENT
  if (pattern === 'pending_review_hash_false_conflict_pitfall') return PENDING_REVIEW_HASH_FALSE_CONFLICT_PITFALL_CONTENT
  return undefined
}

function contentOf(input: SemanticBoundarySource): string {
  return typeof input === 'string' ? input : input.content
}
