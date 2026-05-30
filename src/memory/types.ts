export const MEMORY_DOMAINS = ['project', 'personal', 'relationship', 'affective', 'procedural', 'system'] as const
export type MemoryDomain = typeof MEMORY_DOMAINS[number]

export const MEMORY_TYPES = [
  'project_fact',
  'user_preference',
  'interaction_style',
  'relationship_boundary',
  'affective_pattern',
  'procedural_rule',
  'episode',
  'system_policy',
  'reference'
] as const
export type MemoryType = typeof MEMORY_TYPES[number]

export const MEMORY_STRENGTHS = ['hard', 'soft', 'session'] as const
export type MemoryStrength = typeof MEMORY_STRENGTHS[number]

export const MEMORY_SCOPES = ['global', 'project', 'session'] as const
export type MemoryScope = typeof MEMORY_SCOPES[number]

const MEMORY_PORTABILITIES = ['local_only', 'project_family', 'similar_project', 'global'] as const
export type MemoryPortability = typeof MEMORY_PORTABILITIES[number]

const MEMORY_STATUSES = ['active', 'pending', 'archived', 'rejected', 'expired', 'superseded'] as const
export type MemoryStatus = typeof MEMORY_STATUSES[number]

export const MEMORY_SOURCES = [
  'user_explicit',
  'user_implicit',
  'assistant_observed',
  'tool_trace',
  'file',
  'legacy_markdown'
] as const
export type MemorySource = typeof MEMORY_SOURCES[number]

const MEMORY_PROFILE_VISIBILITIES = ['always', 'safe_summary', 'retrieval_only', 'never'] as const
export type MemoryProfileVisibility = typeof MEMORY_PROFILE_VISIBILITIES[number]

export const MEMORY_CANDIDATE_KINDS = [
  'project_fact',
  'project_decision',
  'user_instruction',
  'workflow_rule',
  'known_pitfall',
  'rejected_approach',
  'open_question'
] as const
export type MemoryCandidateKind = typeof MEMORY_CANDIDATE_KINDS[number]

export const MEMORY_CONFLICT_RESOLUTIONS = ['supersede', 'keep_both', 'reject_new'] as const
export type MemoryConflictResolution = typeof MEMORY_CONFLICT_RESOLUTIONS[number]

export interface MemoryScores {
  evidenceStrength: number
  stability: number
  usefulness: number
  safety: number
  sensitivity: number
}

export interface MemoryEvidence {
  runId?: string
  messageIds?: string[]
  traceRefs?: string[]
  quote?: string
  summary?: string
  evidenceGroupId?: string
  sessionId?: string
  taskHash?: string
  quoteHash?: string
  sourceKind?: MemorySource
}

export interface CyreneMemory {
  id: string
  domain: MemoryDomain
  type: MemoryType
  strength: MemoryStrength
  scope: MemoryScope
  status: 'active'
  content: string
  normalizedKey: string
  evidence: MemoryEvidence[]
  source: MemorySource
  portability?: MemoryPortability
  scores: MemoryScores
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
  expiresAt?: string
  decay?: {
    enabled: boolean
    halfLifeDays?: number
  }
  userConfirmed?: boolean
  profileVisibility?: MemoryProfileVisibility
  candidateKind?: MemoryCandidateKind
  candidate_kind?: MemoryCandidateKind
  normalizedKeyConflictResolution?: 'keep_both'
  tags: string[]
  supersedes?: string[]
}

export interface PendingMemory {
  id: string
  domain: MemoryDomain
  type: MemoryType
  strength: MemoryStrength
  scope: MemoryScope
  status: 'pending'
  content: string
  normalizedKey: string
  evidence: MemoryEvidence[]
  source: MemorySource
  portability?: MemoryPortability
  scores: MemoryScores
  seenCount: number
  firstSeenAt: string
  lastSeenAt: string
  promoteAfter?: string
  expiresAt: string
  userConfirmed?: boolean
  profileVisibility?: MemoryProfileVisibility
  candidateKind?: MemoryCandidateKind
  candidate_kind?: MemoryCandidateKind
  tags: string[]
  conflictsWith?: string[]
}

export interface MemoryTombstone {
  id: string
  memoryId?: string
  normalizedKey: string
  domain: MemoryDomain
  type: MemoryType
  strength?: MemoryStrength
  scope: MemoryScope
  reason: 'rejected' | 'expired' | 'archived' | 'superseded' | 'deleted'
  createdAt: string
  expiresAt?: string
  replacementMemoryId?: string
  evidence?: MemoryEvidence[]
}

export interface MemoryEvent {
  id: string
  action:
    | 'create'
    | 'update'
    | 'promote'
    | 'pending'
    | 'reject'
    | 'archive'
    | 'expire'
    | 'supersede'
    | 'snapshot'
    | 'restore'
    | 'audit'
  at: string
  reason: string
  memoryId?: string
  candidateId?: string
  runId?: string
  snapshotId?: string
  details?: Record<string, unknown>
}

export type MemoryDecision =
  | {
      action: 'auto_write'
      reason: string
      memory: CyreneMemory
    }
  | {
      action: 'pending'
      reason: string
      candidate: PendingMemory
      promoteWhen?: string
    }
  | {
      action: 'reject'
      reason: string
      tombstone: MemoryTombstone
    }
  | {
      action: 'update_existing'
      reason: string
      targetMemoryId: string
      patch: Partial<CyreneMemory>
    }
  | {
      action: 'archive_existing'
      reason: string
      targetMemoryId: string
      tombstone: MemoryTombstone
    }
