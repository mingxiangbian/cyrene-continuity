export type MemoryDomain =
  | 'project'
  | 'personal'
  | 'relationship'
  | 'affective'
  | 'procedural'
  | 'system'

export type MemoryType =
  | 'project_fact'
  | 'user_preference'
  | 'interaction_style'
  | 'relationship_boundary'
  | 'affective_pattern'
  | 'procedural_rule'
  | 'episode'
  | 'system_policy'
  | 'reference'

export type MemoryStrength = 'hard' | 'soft' | 'session'

export type MemoryScope = 'global' | 'project' | 'session'

export type MemoryStatus =
  | 'active'
  | 'pending'
  | 'archived'
  | 'rejected'
  | 'expired'
  | 'superseded'

export type MemorySource =
  | 'user_explicit'
  | 'user_implicit'
  | 'assistant_observed'
  | 'tool_trace'
  | 'file'
  | 'legacy_markdown'

export type MemoryProfileVisibility = 'always' | 'safe_summary' | 'retrieval_only' | 'never'

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
  scores: MemoryScores
  seenCount: number
  firstSeenAt: string
  lastSeenAt: string
  promoteAfter?: string
  expiresAt: string
  userConfirmed?: boolean
  profileVisibility?: MemoryProfileVisibility
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
