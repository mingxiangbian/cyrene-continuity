import type { MemoryCandidateKind, MemoryType } from './types.js'

const MEMORY_CANDIDATE_KINDS: MemoryCandidateKind[] = [
  'project_fact',
  'project_decision',
  'user_instruction',
  'workflow_rule',
  'known_pitfall',
  'rejected_approach',
  'open_question'
]

export interface MemoryCandidateKindSource {
  candidateKind?: unknown
  candidate_kind?: unknown
  tags?: string[]
  type: MemoryType
}

export function isMemoryCandidateKind(value: unknown): value is MemoryCandidateKind {
  return typeof value === 'string' && MEMORY_CANDIDATE_KINDS.includes(value as MemoryCandidateKind)
}

export function deriveMemoryCandidateKind(candidate: MemoryCandidateKindSource): MemoryCandidateKind {
  if (isMemoryCandidateKind(candidate.candidateKind)) {
    return candidate.candidateKind
  }
  if (isMemoryCandidateKind(candidate.candidate_kind)) {
    return candidate.candidate_kind
  }

  const tagKind = (candidate.tags ?? []).find(isMemoryCandidateKind)
  if (tagKind !== undefined) {
    return tagKind
  }

  if (candidate.type === 'project_fact') {
    return 'project_fact'
  }
  if (candidate.type === 'procedural_rule' || candidate.type === 'system_policy') {
    return 'workflow_rule'
  }
  if (
    candidate.type === 'user_preference' ||
    candidate.type === 'interaction_style' ||
    candidate.type === 'relationship_boundary' ||
    candidate.type === 'affective_pattern'
  ) {
    return 'user_instruction'
  }
  if (candidate.type === 'episode') {
    return 'project_fact'
  }
  return 'project_fact'
}

