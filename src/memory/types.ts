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

export const PROJECT_CONFIDENCE_TIERS = ['trial', 'validated', 'project_core'] as const
export type ProjectConfidenceTier = typeof PROJECT_CONFIDENCE_TIERS[number]

export const GLOBAL_CONFIDENCE_TIERS = ['global_core'] as const
export type GlobalConfidenceTier = typeof GLOBAL_CONFIDENCE_TIERS[number]

export const CONFIDENCE_TIERS = [...PROJECT_CONFIDENCE_TIERS, ...GLOBAL_CONFIDENCE_TIERS] as const
export type ConfidenceTier = typeof CONFIDENCE_TIERS[number]

export const ACTIVATION_MODES = [
  'workflow_hint',
  'plan_constraint',
  'checklist_item',
  'workflow_selection'
] as const
export type ActivationMode = typeof ACTIVATION_MODES[number]

export const RUNTIME_ACTIVATION_STRENGTHS = ['hint', 'constraint', 'checklist', 'profile'] as const
export type RuntimeActivationStrength = typeof RUNTIME_ACTIVATION_STRENGTHS[number]

export interface ActivationPolicy {
  allowedModes: ActivationMode[]
  maxRuntimeStrength: RuntimeActivationStrength
}

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
  'legacy_markdown',
  'review_event'
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

export const MEMORY_MODULES = [
  'project_semantic',
  'procedural',
  'system',
  'preference',
  'global_policy',
  'relationship_affective',
  'principle_candidate',
  'task_state'
] as const
export type MemoryModule = typeof MEMORY_MODULES[number]

export const SEMANTIC_MEMORY_STATUSES = [
  'candidate',
  'pending',
  'active',
  'archived',
  'rejected',
  'superseded'
] as const
export type SemanticMemoryStatus = typeof SEMANTIC_MEMORY_STATUSES[number]

export const UPDATE_POLICIES = [
  'strict_auto_promote',
  'pending_review',
  'manual_only',
  'drop',
  'defer'
] as const
export type UpdatePolicy = typeof UPDATE_POLICIES[number]

export const ACTIVATION_EVENT_TYPES = [
  'retrieved',
  'activated',
  'applied',
  'ignored',
  'corrected',
  'violated',
  'stale'
] as const
export type ActivationEventType = typeof ACTIVATION_EVENT_TYPES[number]

export const REFLECTION_ACTIONS = ['reinforce', 'rewrite', 'deprecate', 'split', 'merge'] as const
export type ReflectionAction = typeof REFLECTION_ACTIONS[number]

export const MEMORY_CONFLICT_RESOLUTIONS = ['supersede', 'keep_both', 'reject_new'] as const
export type MemoryConflictResolution = typeof MEMORY_CONFLICT_RESOLUTIONS[number]

export const SEMANTIC_REWRITE_RECEIPT_ACTIONS = [
  'shape_on_create',
  'replace_content',
  'enrich_boundaries',
  'skip',
  'fail'
] as const
export type SemanticRewriteReceiptAction = typeof SEMANTIC_REWRITE_RECEIPT_ACTIONS[number]

export const SEMANTIC_REWRITE_METHODS = ['deterministic', 'llm', 'deterministic_fallback'] as const
export type SemanticRewriteMethod = typeof SEMANTIC_REWRITE_METHODS[number]

export const MEMORY_RELATION_TYPES = [
  'supports',
  'contradicts',
  'supersedes',
  'refines',
  'derived_from',
  'similar_to',
  'warns_against',
  'transfers_to'
] as const
export type MemoryRelationType = typeof MEMORY_RELATION_TYPES[number]

export const MEMORY_EDGE_STATUSES = ['trial', 'validated', 'rejected', 'expired', 'superseded'] as const
export type MemoryEdgeStatus = typeof MEMORY_EDGE_STATUSES[number]

export const MEMORY_EDGE_ORIGINS = ['deterministic', 'model', 'operation'] as const
export type MemoryEdgeOrigin = typeof MEMORY_EDGE_ORIGINS[number]

export const MEMORY_EDGE_EVIDENCE_KINDS = [
  'normalized_key',
  'content_hash',
  'review_hash',
  'activation_feedback',
  'distillation_input',
  'project_similarity',
  'model_hint'
] as const
export type MemoryEdgeEvidenceKind = typeof MEMORY_EDGE_EVIDENCE_KINDS[number]

export interface MemoryEdge {
  id: string
  fromMemoryId: string
  toMemoryId: string
  fromScope: MemoryScope
  toScope: MemoryScope
  fromProjectId?: string
  toProjectId?: string
  relationType: MemoryRelationType
  status: MemoryEdgeStatus
  confidence: number
  origin: MemoryEdgeOrigin
  reason: string
  evidenceId?: string
  evidenceKind?: MemoryEdgeEvidenceKind
  createdAt: string
  updatedAt: string
  lastUsedAt?: string
}

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

export interface EpisodeMemory {
  id: string
  projectId: string
  title: string
  summary: string
  actions: string[]
  decisions: string[]
  failures: string[]
  openQuestions: string[]
  changedFiles?: string[]
  commandsRun?: string[]
  toolNames?: string[]
  sourceTraceIds: string[]
  createdAt: string
  expiresAt?: string
}

export const CANDIDATE_DRAFT_SOURCE_KINDS = [
  'file',
  'tool_trace',
  'review_summary',
  'user_explicit',
  'assistant_observed',
  'daily_interview'
] as const
export type CandidateDraftSourceKind = typeof CANDIDATE_DRAFT_SOURCE_KINDS[number]

export interface CandidateTaskState {
  kind: 'temporary_status' | 'one_time_action' | 'implementation_progress'
  summary: string
}

export interface CandidateDraft {
  id: string
  episodeId?: string
  content: string
  candidateKind: MemoryCandidateKind
  scope: MemoryScope
  domain: MemoryDomain
  sourceKind: CandidateDraftSourceKind
  sourceEpisodeIds: string[]
  evidenceRefs: string[]
  normalizedKey?: string
  sourceOfTruth?: string
  taskState?: CandidateTaskState
  tags: string[]
  createdAt: string
}

export const ADMISSION_ACTIONS = [
  'admit_to_pending',
  'admit_to_distillation',
  'episode_only',
  'task_state',
  'reference_only',
  'auto_drop',
  'auto_defer',
  'merge_with_existing',
  'reject_duplicate'
] as const
export type AdmissionAction = typeof ADMISSION_ACTIONS[number]

export const ADMISSION_REASONS = [
  'one_time_action',
  'temporary_status',
  'stale_numeric_snapshot',
  'low_future_usefulness',
  'low_actionability',
  'too_vague',
  'implementation_note',
  'implementation_changelog',
  'raw_file_rule_excerpt',
  'source_of_truth_excerpt',
  'overbroad_workflow_rule',
  'needs_active_memory_rewrite',
  'duplicate_pending',
  'duplicate_active',
  'source_of_truth_duplicate',
  'conflicts_with_tombstone',
  'task_state',
  'valuable_project_decision',
  'valuable_workflow_rule',
  'valuable_known_pitfall',
  'valuable_rejected_approach',
  'explicit_user_instruction'
] as const
export type AdmissionReason = typeof ADMISSION_REASONS[number]

export interface AdmissionScores {
  futureUsefulness: number
  actionability: number
  stability: number
  specificity: number
  evidenceStrength: number
  repeatPotential: number
  expiryRisk: number
  redundancy: number
  sensitivity: number
}

export interface AdmissionDecision {
  id: string
  draftId: string
  action: AdmissionAction
  admissionScore: number
  reasons: AdmissionReason[]
  scores: AdmissionScores
  targetMemoryId?: string
  targetClusterId?: string
  createdAt: string
}

export interface StructuredEvidence {
  id: string
  sourceKind: string
  sourceRef: string
  when?: string
  whatHappened: string
  whyImportant: string
  result?: string
}

export interface RoutedMemoryTarget {
  module: MemoryModule
  updatePolicy: UpdatePolicy
  risk: 'low' | 'medium' | 'high'
  reasons: string[]
}

export interface SemanticMemoryReviewState {
  normalizedKey?: string
  sourceOfTruth?: string
  type?: MemoryType
  strength?: MemoryStrength
  source?: MemorySource
  portability?: MemoryPortability
  profileVisibility?: MemoryProfileVisibility
  scores?: MemoryScores
  tags?: string[]
  seenCount?: number
  firstSeenAt?: string
  lastSeenAt?: string
  promoteAfter?: string
  admittedBy?: 'admission_gate_v1'
  admissionAction?: AdmissionAction
  admissionScore?: number
  admissionReasons?: string[]
  sourceEpisodeIds?: string[]
  sourceDraftIds?: string[]
  userConfirmed?: boolean
  normalizedKeyConflictResolution?: 'keep_both'
  conflictsWith?: string[]
}

export interface SemanticMemory {
  id: string
  status: SemanticMemoryStatus
  module: MemoryModule
  kind: MemoryCandidateKind
  scope: MemoryScope
  domain: MemoryDomain
  content: string
  useWhen: string[]
  doNotUseWhen: string[]
  sourceOfTruth?: string
  evidence: StructuredEvidence[]
  routing?: RoutedMemoryTarget
  reviewPolicy: UpdatePolicy
  reviewState?: SemanticMemoryReviewState
  confidenceTier?: ConfidenceTier
  activationPolicy?: ActivationPolicy
  supersedes: string[]
  expiresAt?: string
  reviewAfter?: string
  createdAt: string
  updatedAt: string
}

export interface DistillationInput {
  id: string
  sourceDraftIds: string[]
  sourceEpisodeIds: string[]
  sourceSemanticMemoryIds: string[]
  admissionDecisionIds: string[]
  normalizedKey?: string
  candidateKind: MemoryCandidateKind
  scope: MemoryScope
  domain: MemoryDomain
  sourceKinds: string[]
  rawContents: string[]
  evidenceRefs: string[]
  sourceOfTruth?: string
  createdAt: string
}

export interface RoutingDecision {
  id: string
  semanticMemoryId: string
  target: RoutedMemoryTarget
  createdAt: string
}

export interface ReviewDecision {
  id: string
  semanticMemoryId: string
  policy: UpdatePolicy
  reviewHash?: string
  reasons: string[]
  createdAt: string
}

export interface ActivationEvent {
  id: string
  memoryId: string
  projectId?: string
  queryHash?: string
  event: ActivationEventType
  activationId?: string
  contentHash?: string
  reason?: string
  evidenceRef?: string
  createdAt: string
}

export interface ReflectionCandidate {
  id: string
  sourceActivationEventIds: string[]
  proposedAction: ReflectionAction
  candidate: SemanticMemory
  reasons: string[]
  createdAt: string
}

export interface SemanticRewriteReceipt {
  id: string
  pendingMemoryId: string
  preparedSemanticMemoryId?: string
  action: SemanticRewriteReceiptAction
  method: SemanticRewriteMethod
  oldReviewHash?: string
  newReviewHash?: string
  originalContentHash: string
  rewrittenContentHash?: string
  changedFields: string[]
  eligibilityReasons: string[]
  validatorReasons: string[]
  sourceOfTruth?: string
  createdAt: string
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
  sourceOfTruth?: string
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
  confidenceTier?: ConfidenceTier
  activationPolicy?: ActivationPolicy
  useWhen?: string[]
  doNotUseWhen?: string[]
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
  useWhen?: string[]
  doNotUseWhen?: string[]
  normalizedKey: string
  sourceOfTruth?: string
  evidence: MemoryEvidence[]
  source: MemorySource
  portability?: MemoryPortability
  scores: MemoryScores
  seenCount: number
  firstSeenAt: string
  lastSeenAt: string
  promoteAfter?: string
  expiresAt: string
  admittedBy?: 'admission_gate_v1'
  admissionAction?: AdmissionAction
  admissionScore?: number
  admissionReasons?: string[]
  sourceEpisodeIds?: string[]
  sourceDraftIds?: string[]
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
  reason:
    | 'rejected'
    | 'expired'
    | 'archived'
    | 'superseded'
    | 'deleted'
    | 'wrong_abstraction'
    | 'obsolete'
    | 'user_rejected'
    | 'repeated_duplicate'
    | 'source_of_truth_excerpt'
    | 'implementation_changelog'
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
    | 'tombstone'
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
