import type { MemoryCandidateKind, MemoryDomain, MemoryScope } from '../memory/types.js'

export interface SemanticBoundaryInput {
  content: string
  candidateKind?: MemoryCandidateKind
  kind?: MemoryCandidateKind
  domain?: MemoryDomain
  scope?: MemoryScope
  sourceOfTruth?: string
  normalizedKey?: string
  evidenceRefs?: readonly string[]
  tags?: readonly string[]
}

export type SemanticBoundarySource = string | SemanticBoundaryInput

export interface SemanticBoundaries {
  useWhen: string[]
  doNotUseWhen: string[]
  reasons: string[]
}

export type SemanticBoundaryPattern =
  | 'pending_memory_rejection_workflow'
  | 'pending_review_hash_false_conflict_pitfall'

const PENDING_MEMORY_REJECTION_WORKFLOW: SemanticBoundaries = {
  useWhen: [
    'Rejecting pending memory candidates in the Cyrene review flow.',
    'Changing pending-memory review actions that depend on review-hash validation.',
    'Verifying pending queue state after reject/defer/promote mutations.'
  ],
  doNotUseWhen: [
    'The task does not mutate pending memory review state.',
    'The review hash is unavailable or was not read from the current pending record.',
    'The task concerns active memory edits rather than pending candidate review.'
  ],
  reasons: [
    'The content defines a reusable workflow rather than a one-time rejection event.',
    'It names the required pre-mutation and post-mutation checks: review-hash validation and queue verification.'
  ]
}

const PENDING_REVIEW_HASH_FALSE_CONFLICT_PITFALL: SemanticBoundaries = {
  useWhen: [
    'Diagnosing review-hash conflicts for pending memory candidates.',
    'Reading or validating pending review records.',
    'Changing semantic projection or cache code that feeds pending review state.'
  ],
  doNotUseWhen: [
    'The hash comes from an active memory record rather than pending review.',
    'The code already reads the current pending.jsonl record as the canonical source.',
    'The task is unrelated to pending review hashes, semantic projection, or cache-derived review data.'
  ],
  reasons: [
    'The content describes a known pitfall with a mitigation.',
    'It identifies semantic projection and cache-derived data as false-conflict sources and pending.jsonl as the canonical data source.'
  ]
}

export function deriveSemanticBoundaries(input: SemanticBoundarySource): SemanticBoundaries {
  const pattern = classifySemanticBoundaryPattern(input)
  if (pattern === 'pending_memory_rejection_workflow') return cloneBoundaries(PENDING_MEMORY_REJECTION_WORKFLOW)
  if (pattern === 'pending_review_hash_false_conflict_pitfall') {
    return cloneBoundaries(PENDING_REVIEW_HASH_FALSE_CONFLICT_PITFALL)
  }

  return fallbackBoundariesFor(candidateKindOf(input))
}

export function classifySemanticBoundaryPattern(input: SemanticBoundarySource): SemanticBoundaryPattern | undefined {
  const content = normalizeContent(contentOf(input))
  if (isPendingMemoryRejectionWorkflow(content)) return 'pending_memory_rejection_workflow'
  if (isPendingReviewHashFalseConflictPitfall(content)) return 'pending_review_hash_false_conflict_pitfall'
  return undefined
}

function fallbackBoundariesFor(candidateKind: MemoryCandidateKind | undefined): SemanticBoundaries {
  if (candidateKind === 'workflow_rule') {
    return cloneBoundaries({
      useWhen: [
        'Applying the workflow rule described in this memory.',
        'Changing the process or code path named by the memory content.'
      ],
      doNotUseWhen: [
        'The task is outside the process or code path named by the memory content.',
        'Current source files or explicit user instructions contradict the memory.'
      ],
      reasons: [
        'The candidate kind is workflow_rule, so boundaries emphasize when to apply the procedure and when to ignore it.'
      ]
    })
  }

  if (candidateKind === 'known_pitfall') {
    return cloneBoundaries({
      useWhen: [
        'Diagnosing or preventing the pitfall described in this memory.',
        'Changing the component or workflow named by the memory content.'
      ],
      doNotUseWhen: [
        'The task cannot encounter the described failure mode.',
        'Current source files or explicit user instructions contradict the memory.'
      ],
      reasons: [
        'The candidate kind is known_pitfall, so boundaries emphasize the failure mode and mitigation context.'
      ]
    })
  }

  if (candidateKind === 'project_decision') {
    return cloneBoundaries({
      useWhen: [
        'Making design changes that touch the project decision described in this memory.',
        'Checking the current rationale for the architecture or workflow boundary named by the memory content.'
      ],
      doNotUseWhen: [
        'The task is outside the decision boundary named by the memory content.',
        'A newer project decision or explicit user instruction supersedes this memory.'
      ],
      reasons: [
        'The candidate kind is project_decision, so boundaries emphasize the decision boundary and supersession conditions.'
      ]
    })
  }

  if (candidateKind === 'rejected_approach') {
    return cloneBoundaries({
      useWhen: [
        'Considering the rejected approach described in this memory.',
        'Reopening a design decision in the same project area.'
      ],
      doNotUseWhen: [
        'The task uses a different approach or project area.',
        'New explicit direction supersedes the rejection rationale.'
      ],
      reasons: [
        'The candidate kind is rejected_approach, so boundaries prevent repeating a previously rejected design path.'
      ]
    })
  }

  if (candidateKind === 'open_question') {
    return cloneBoundaries({
      useWhen: [
        'Resolving the open question described in this memory.',
        'Continuing work in the project area named by the question.'
      ],
      doNotUseWhen: [
        'The question has already been answered or superseded.',
        'The task is outside the project area named by the question.'
      ],
      reasons: [
        'The candidate kind is open_question, so boundaries emphasize unresolved context rather than stable facts.'
      ]
    })
  }

  if (candidateKind === 'user_instruction') {
    return cloneBoundaries({
      useWhen: [
        'Following the explicit user instruction captured in this memory.',
        'Choosing defaults for work covered by the instruction.'
      ],
      doNotUseWhen: [
        'The user gives a newer instruction for the current task.',
        'The task falls outside the instruction scope.'
      ],
      reasons: [
        'The candidate kind is user_instruction, so boundaries preserve explicit user direction while allowing newer overrides.'
      ]
    })
  }

  return cloneBoundaries({
    useWhen: [
      'Using the project context described in this memory.',
      'Working in the project area named by the memory content.'
    ],
    doNotUseWhen: [
      'The task is outside the project area named by the memory content.',
      'Current source files or explicit user instructions contradict the memory.'
    ],
    reasons: [
      'No specialized semantic pattern matched, so boundaries stay conservative and tied to the memory content.'
    ]
  })
}

function cloneBoundaries(boundaries: SemanticBoundaries): SemanticBoundaries {
  return {
    useWhen: [...boundaries.useWhen],
    doNotUseWhen: [...boundaries.doNotUseWhen],
    reasons: [...boundaries.reasons]
  }
}

function isPendingMemoryRejectionWorkflow(content: string): boolean {
  return /(?:拒绝\s*pending\s*memory|pending-memory rejection|reject(?:ing)?\s+pending memory)/i.test(content) &&
    /(?:哈希校验|review hash|review-hash)/i.test(content) &&
    /(?:pending\s*列表|queue state|列表为空|after rejection)/i.test(content)
}

function isPendingReviewHashFalseConflictPitfall(content: string): boolean {
  return /(?:pending\s*review|pending-review)/i.test(content) &&
    /(?:哈希|hash|review-hash)/i.test(content) &&
    /semantic\s*projection/i.test(content) &&
    /(?:假冲突|false conflict|false review-hash conflicts?)/i.test(content) &&
    /(?:pending\.jsonl|缓存|cache-derived|cache)/i.test(content)
}

function candidateKindOf(input: SemanticBoundarySource): MemoryCandidateKind | undefined {
  return typeof input === 'string' ? undefined : input.candidateKind ?? input.kind
}

function contentOf(input: SemanticBoundarySource): string {
  return typeof input === 'string' ? input : input.content
}

function normalizeContent(content: string): string {
  return content.trim().replace(/\s+/g, ' ')
}
