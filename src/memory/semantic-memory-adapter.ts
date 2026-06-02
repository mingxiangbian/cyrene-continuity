import { deriveMemoryCandidateKind } from './candidate-kind.js'
import type {
  CyreneMemory,
  MemoryCandidateKind,
  MemoryDomain,
  MemoryEvidence,
  MemoryModule,
  MemoryScores,
  MemorySource,
  MemoryStrength,
  MemoryType,
  PendingMemory,
  RoutedMemoryTarget,
  SemanticMemory,
  StructuredEvidence,
  UpdatePolicy
} from './types.js'

const DEFAULT_SCORES: MemoryScores = {
  evidenceStrength: 0.65,
  stability: 0.65,
  usefulness: 0.65,
  safety: 0.9,
  sensitivity: 0.1
}

const MEMORY_SOURCES: MemorySource[] = [
  'user_explicit',
  'user_implicit',
  'assistant_observed',
  'tool_trace',
  'file',
  'legacy_markdown',
  'review_event'
]

export function activeMemoryToSemanticMemory(memory: CyreneMemory): SemanticMemory {
  const kind = deriveMemoryCandidateKind(memory)
  const module = moduleForMemory(memory.domain, memory.type, kind, memory.scope)
  const scores = memory.scores ?? DEFAULT_SCORES
  return {
    id: memory.id,
    status: 'active',
    module,
    kind,
    scope: memory.scope,
    domain: memory.domain,
    content: memory.content,
    useWhen: useWhenForKind(kind),
    doNotUseWhen: doNotUseWhenForKind(kind),
    sourceOfTruth: memory.sourceOfTruth ?? memory.normalizedKey,
    evidence: structuredEvidenceForMemory(memory.id, memory.evidence, memory.source, memory.createdAt, memory.content, kind),
    routing: routingForMemory(module, scores, 'active'),
    reviewPolicy: reviewPolicyForMemory(module, scores, 'active'),
    reviewState: {
      normalizedKey: memory.normalizedKey,
      ...(memory.sourceOfTruth === undefined ? {} : { sourceOfTruth: memory.sourceOfTruth }),
      type: memory.type,
      strength: memory.strength,
      source: memory.source,
      ...(memory.portability === undefined ? {} : { portability: memory.portability }),
      ...(memory.profileVisibility === undefined ? {} : { profileVisibility: memory.profileVisibility }),
      scores,
      tags: memory.tags,
      ...(memory.userConfirmed === undefined ? {} : { userConfirmed: memory.userConfirmed }),
      ...(memory.normalizedKeyConflictResolution === undefined
        ? {}
        : { normalizedKeyConflictResolution: memory.normalizedKeyConflictResolution })
    },
    supersedes: memory.supersedes ?? [],
    ...(memory.expiresAt === undefined ? {} : { expiresAt: memory.expiresAt }),
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt
  }
}

export function pendingMemoryToSemanticMemory(memory: PendingMemory): SemanticMemory {
  const kind = deriveMemoryCandidateKind(memory)
  const module = moduleForMemory(memory.domain, memory.type, kind, memory.scope)
  const scores = memory.scores ?? DEFAULT_SCORES
  return {
    id: memory.id,
    status: 'pending',
    module,
    kind,
    scope: memory.scope,
    domain: memory.domain,
    content: memory.content,
    useWhen: useWhenForKind(kind),
    doNotUseWhen: doNotUseWhenForKind(kind),
    sourceOfTruth: memory.sourceOfTruth ?? memory.normalizedKey,
    evidence: structuredEvidenceForMemory(memory.id, memory.evidence, memory.source, memory.lastSeenAt, memory.content, kind),
    routing: routingForMemory(module, scores, 'pending'),
    reviewPolicy: reviewPolicyForMemory(module, scores, 'pending'),
    reviewState: {
      normalizedKey: memory.normalizedKey,
      ...(memory.sourceOfTruth === undefined ? {} : { sourceOfTruth: memory.sourceOfTruth }),
      type: memory.type,
      strength: memory.strength,
      source: memory.source,
      ...(memory.portability === undefined ? {} : { portability: memory.portability }),
      ...(memory.profileVisibility === undefined ? {} : { profileVisibility: memory.profileVisibility }),
      scores,
      seenCount: memory.seenCount,
      firstSeenAt: memory.firstSeenAt,
      lastSeenAt: memory.lastSeenAt,
      ...(memory.promoteAfter === undefined ? {} : { promoteAfter: memory.promoteAfter }),
      ...(memory.admittedBy === undefined ? {} : { admittedBy: memory.admittedBy }),
      ...(memory.admissionScore === undefined ? {} : { admissionScore: memory.admissionScore }),
      ...(memory.admissionReasons === undefined ? {} : { admissionReasons: memory.admissionReasons }),
      ...(memory.sourceEpisodeIds === undefined ? {} : { sourceEpisodeIds: memory.sourceEpisodeIds }),
      ...(memory.sourceDraftIds === undefined ? {} : { sourceDraftIds: memory.sourceDraftIds }),
      ...(memory.userConfirmed === undefined ? {} : { userConfirmed: memory.userConfirmed }),
      tags: memory.tags,
      ...(memory.conflictsWith === undefined ? {} : { conflictsWith: memory.conflictsWith })
    },
    supersedes: [],
    expiresAt: memory.expiresAt,
    ...(memory.promoteAfter === undefined ? {} : { reviewAfter: memory.promoteAfter }),
    createdAt: memory.firstSeenAt,
    updatedAt: memory.lastSeenAt
  }
}

export function semanticMemoryToActiveMemory(memory: SemanticMemory): CyreneMemory {
  const reviewState = memory.reviewState ?? {}
  const type = reviewState.type ?? typeForSemanticMemory(memory)
  const scores = reviewState.scores ?? scoresForSemanticMemory(memory)
  const source = memorySource(reviewState.source ?? firstEvidenceSource(memory.evidence))
  const sourceOfTruth = reviewState.sourceOfTruth ?? memory.sourceOfTruth
  return {
    id: memory.id,
    domain: memory.domain,
    type,
    strength: reviewState.strength ?? strengthForSemanticMemory(memory),
    scope: memory.scope,
    status: 'active',
    content: memory.content,
    normalizedKey: reviewState.normalizedKey ?? memory.sourceOfTruth ?? normalizedKeyForContent(memory.domain, type, memory.content),
    ...(sourceOfTruth === undefined ? {} : { sourceOfTruth }),
    evidence: memoryEvidenceForSemantic(memory),
    source,
    ...(reviewState.portability === undefined ? {} : { portability: reviewState.portability }),
    scores,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    ...(memory.expiresAt === undefined ? {} : { expiresAt: memory.expiresAt }),
    ...(reviewState.userConfirmed === undefined ? {} : { userConfirmed: reviewState.userConfirmed }),
    ...(reviewState.profileVisibility === undefined ? {} : { profileVisibility: reviewState.profileVisibility }),
    candidateKind: memory.kind,
    ...(reviewState.normalizedKeyConflictResolution === undefined
      ? {}
      : { normalizedKeyConflictResolution: reviewState.normalizedKeyConflictResolution }),
    tags: reviewState.tags ?? [memory.kind],
    supersedes: memory.supersedes
  }
}

export function semanticMemoryToPendingMemory(memory: SemanticMemory): PendingMemory {
  const reviewState = memory.reviewState ?? {}
  const type = reviewState.type ?? typeForSemanticMemory(memory)
  const source = memorySource(reviewState.source ?? firstEvidenceSource(memory.evidence))
  const updatedAt = memory.updatedAt || memory.createdAt
  const firstSeenAt = reviewState.firstSeenAt ?? memory.createdAt
  const lastSeenAt = reviewState.lastSeenAt ?? updatedAt
  const sourceOfTruth = reviewState.sourceOfTruth ?? memory.sourceOfTruth
  return {
    id: memory.id,
    domain: memory.domain,
    type,
    strength: reviewState.strength ?? strengthForSemanticMemory(memory),
    scope: memory.scope,
    status: 'pending',
    content: memory.content,
    normalizedKey: reviewState.normalizedKey ?? memory.sourceOfTruth ?? normalizedKeyForContent(memory.domain, type, memory.content),
    ...(sourceOfTruth === undefined ? {} : { sourceOfTruth }),
    evidence: memoryEvidenceForSemantic(memory),
    source,
    ...(reviewState.portability === undefined ? {} : { portability: reviewState.portability }),
    scores: reviewState.scores ?? scoresForSemanticMemory(memory),
    seenCount: reviewState.seenCount ?? 1,
    firstSeenAt,
    lastSeenAt,
    ...(reviewState.promoteAfter === undefined ? {} : { promoteAfter: reviewState.promoteAfter }),
    expiresAt: memory.expiresAt ?? addDays(lastSeenAt, 30),
    ...(reviewState.admittedBy === undefined ? {} : { admittedBy: reviewState.admittedBy }),
    ...(reviewState.admissionScore === undefined ? {} : { admissionScore: reviewState.admissionScore }),
    ...(reviewState.admissionReasons === undefined ? {} : { admissionReasons: reviewState.admissionReasons }),
    ...(reviewState.sourceEpisodeIds === undefined ? {} : { sourceEpisodeIds: reviewState.sourceEpisodeIds }),
    ...(reviewState.sourceDraftIds === undefined ? {} : { sourceDraftIds: reviewState.sourceDraftIds }),
    ...(reviewState.userConfirmed === undefined ? {} : { userConfirmed: reviewState.userConfirmed }),
    ...(reviewState.profileVisibility === undefined ? {} : { profileVisibility: reviewState.profileVisibility }),
    candidateKind: memory.kind,
    tags: reviewState.tags ?? [memory.kind],
    ...(reviewState.conflictsWith === undefined ? {} : { conflictsWith: reviewState.conflictsWith })
  }
}

function structuredEvidenceForMemory(
  memoryId: string,
  evidence: MemoryEvidence[],
  source: MemorySource,
  when: string,
  content: string,
  kind: MemoryCandidateKind
): StructuredEvidence[] {
  const entries = evidence.length > 0 ? evidence : [{ summary: content, sourceKind: source }]
  return entries.map((entry, index) => ({
    id: entry.evidenceGroupId ?? entry.taskHash ?? entry.runId ?? `${memoryId}-evidence-${index + 1}`,
    sourceKind: entry.sourceKind ?? source,
    sourceRef: evidenceRef(entry, memoryId, index),
    when,
    whatHappened: entry.summary ?? entry.quote ?? content,
    whyImportant: whyImportantForKind(kind),
    ...(entry.quoteHash === undefined ? {} : { result: `quoteHash=${entry.quoteHash}` })
  }))
}

function memoryEvidenceForSemantic(memory: SemanticMemory): MemoryEvidence[] {
  if (memory.evidence.length === 0) {
    return [{ summary: memory.content, sourceKind: memorySource(firstEvidenceSource(memory.evidence)) }]
  }
  return memory.evidence.map((entry) => ({
    summary: entry.whatHappened || memory.content,
    evidenceGroupId: entry.id,
    sourceKind: memorySource(entry.sourceKind),
    ...(entry.sourceRef === '' ? {} : { traceRefs: [entry.sourceRef] })
  }))
}

function moduleForMemory(
  domain: MemoryDomain,
  type: MemoryType,
  kind: MemoryCandidateKind,
  scope: string
): MemoryModule {
  if (domain === 'system' || type === 'system_policy') return scope === 'global' ? 'global_policy' : 'system'
  if (domain === 'procedural' || kind === 'workflow_rule') return 'procedural'
  if (domain === 'personal' || type === 'user_preference' || type === 'interaction_style' || kind === 'user_instruction') {
    return 'preference'
  }
  if (domain === 'relationship' || domain === 'affective') return 'relationship_affective'
  return 'project_semantic'
}

function typeForSemanticMemory(memory: SemanticMemory): MemoryType {
  if (memory.kind === 'workflow_rule') return memory.module === 'system' ? 'system_policy' : 'procedural_rule'
  if (memory.kind === 'user_instruction') return 'user_preference'
  return 'project_fact'
}

function strengthForSemanticMemory(memory: SemanticMemory): MemoryStrength {
  if (memory.reviewPolicy === 'manual_only') return 'hard'
  if (memory.status === 'active') return 'hard'
  return 'soft'
}

function routingForMemory(module: MemoryModule, scores: MemoryScores, status: 'active' | 'pending'): RoutedMemoryTarget {
  const risk = riskForScores(scores)
  const updatePolicy = reviewPolicyForMemory(module, scores, status)
  return {
    module,
    updatePolicy,
    risk,
    reasons: [status === 'pending' ? 'review required before activation' : 'migrated into semantic memory v2']
  }
}

function reviewPolicyForMemory(module: MemoryModule, scores: MemoryScores, status: 'active' | 'pending'): UpdatePolicy {
  if (module === 'relationship_affective' || module === 'global_policy' || scores.sensitivity > 0.6 || scores.safety < 0.65) {
    return 'manual_only'
  }
  return status === 'pending' ? 'pending_review' : 'strict_auto_promote'
}

function scoresForSemanticMemory(memory: SemanticMemory): MemoryScores {
  const evidenceStrength = memory.evidence.length > 0 ? 0.75 : 0.45
  const sensitivity = memory.routing?.risk === 'high' ? 0.7 : memory.routing?.risk === 'medium' ? 0.45 : 0.1
  return {
    evidenceStrength,
    stability: memory.status === 'active' ? 0.8 : 0.65,
    usefulness: memory.useWhen.length > 0 ? 0.75 : 0.55,
    safety: memory.reviewPolicy === 'manual_only' ? 0.7 : 0.9,
    sensitivity
  }
}

function riskForScores(scores: MemoryScores): RoutedMemoryTarget['risk'] {
  if (scores.sensitivity > 0.6 || scores.safety < 0.65) return 'high'
  if (scores.sensitivity > 0.45 || scores.safety < 0.8) return 'medium'
  return 'low'
}

function useWhenForKind(kind: MemoryCandidateKind): string[] {
  if (kind === 'known_pitfall') return ['Diagnosing similar project failures.', 'Changing related memory behavior.']
  if (kind === 'workflow_rule') return ['Planning non-trivial project changes.', 'Reviewing future implementation workflow.']
  if (kind === 'project_decision') return ['Continuing related project work.', 'Checking current project context.']
  if (kind === 'rejected_approach') return ['Considering a previously rejected approach.', 'Avoiding repeated design churn.']
  if (kind === 'open_question') return ['Continuing the same project area.', 'Resolving deferred design questions.']
  return ['Reviewing future project memory candidates.']
}

function doNotUseWhenForKind(kind: MemoryCandidateKind): string[] {
  if (kind === 'open_question') return ['The question has been answered or superseded.', 'The task is unrelated to this project scope.']
  return ['The memory is stale or contradicted by source files.', 'The future task is unrelated to this scope.']
}

function whyImportantForKind(kind: MemoryCandidateKind): string {
  if (kind === 'known_pitfall') return 'Capturing the pitfall can prevent repeated project mistakes.'
  if (kind === 'workflow_rule') return 'The rule can guide future project workflow.'
  if (kind === 'project_decision') return 'The decision preserves project context for future work.'
  if (kind === 'rejected_approach') return 'The rejected approach prevents repeated design churn.'
  if (kind === 'open_question') return 'The question preserves unresolved project context.'
  return 'The memory may affect future review behavior.'
}

function evidenceRef(entry: MemoryEvidence, memoryId: string, index: number): string {
  return entry.evidenceGroupId
    ?? entry.runId
    ?? entry.sessionId
    ?? entry.taskHash
    ?? entry.quoteHash
    ?? entry.traceRefs?.[0]
    ?? `memory:${memoryId}:evidence:${index + 1}`
}

function firstEvidenceSource(evidence: StructuredEvidence[]): string | undefined {
  return evidence[0]?.sourceKind
}

function memorySource(value: unknown): MemorySource {
  return typeof value === 'string' && MEMORY_SOURCES.includes(value as MemorySource) ? value as MemorySource : 'review_event'
}

function normalizedKeyForContent(domain: MemoryDomain, type: MemoryType, content: string): string {
  const normalized = content
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${domain}-${type}-${normalized || 'memory'}`
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}
