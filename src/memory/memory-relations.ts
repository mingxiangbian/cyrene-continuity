import { createHash } from 'node:crypto'
import type {
  MemoryEdge,
  MemoryEdgeEvidenceKind,
  MemoryRelationType,
  MemoryScope
} from './types.js'

export const ORDINARY_RUNTIME_RELATIONS = new Set<MemoryRelationType>([
  'supports',
  'supersedes',
  'refines',
  'derived_from',
  'warns_against',
  'transfers_to'
])

const HIGH_IMPACT_RELATIONS = new Set<MemoryRelationType>([
  'contradicts',
  'supersedes',
  'transfers_to',
  'derived_from'
])

interface EdgeIdentity {
  fromMemoryId: string
  toMemoryId: string
  relationType: MemoryRelationType
  evidenceId?: string
}

interface EdgeDraft extends EdgeIdentity {
  fromScope?: MemoryScope
  toScope?: MemoryScope
  fromProjectId?: string
  toProjectId?: string
  now: string
  reason: string
  confidence?: number
}

interface OperationBackedEdgeDraft extends EdgeDraft {
  evidenceId?: string
  evidenceKind?: MemoryEdgeEvidenceKind
}

export function relationExpansionPolicy(relationType: MemoryRelationType): {
  runtime: boolean
  diagnostics: boolean
} {
  if (relationType === 'similar_to' || relationType === 'contradicts') {
    return { runtime: false, diagnostics: true }
  }
  return { runtime: ORDINARY_RUNTIME_RELATIONS.has(relationType), diagnostics: true }
}

export function resolveRelationExpansion(input: {
  seedMemoryId: string
  edge: MemoryEdge
}): { includeMemoryId?: string; suppressMemoryIds: string[]; reason: string } {
  const { seedMemoryId, edge } = input
  if (edge.status !== 'validated') {
    return { suppressMemoryIds: [], reason: 'edge_not_validated' }
  }
  if (!relationExpansionPolicy(edge.relationType).runtime) {
    return { suppressMemoryIds: [], reason: 'diagnostics_only' }
  }
  if (edge.relationType === 'supersedes' && seedMemoryId === edge.toMemoryId) {
    return {
      includeMemoryId: edge.fromMemoryId,
      suppressMemoryIds: [edge.toMemoryId],
      reason: 'supersedes_replacement'
    }
  }
  if (edge.relationType === 'supersedes' && seedMemoryId === edge.fromMemoryId) {
    return {
      suppressMemoryIds: [edge.toMemoryId],
      reason: 'supersedes_evidence_only'
    }
  }
  if (seedMemoryId === edge.fromMemoryId) {
    return { includeMemoryId: edge.toMemoryId, suppressMemoryIds: [], reason: edge.relationType }
  }
  if (seedMemoryId === edge.toMemoryId && (edge.relationType === 'supports' || edge.relationType === 'refines')) {
    return { includeMemoryId: edge.fromMemoryId, suppressMemoryIds: [], reason: edge.relationType }
  }
  return { suppressMemoryIds: [], reason: 'wrong_direction' }
}

export function stableMemoryEdgeId(input: EdgeIdentity): string {
  return `edge-${createHash('sha256').update(JSON.stringify({
    fromMemoryId: input.fromMemoryId,
    toMemoryId: input.toMemoryId,
    relationType: input.relationType,
    evidenceId: input.evidenceId ?? null
  })).digest('hex').slice(0, 16)}`
}

export function createModelHintEdge(input: EdgeDraft): MemoryEdge {
  return {
    id: stableMemoryEdgeId(input),
    fromMemoryId: input.fromMemoryId,
    toMemoryId: input.toMemoryId,
    fromScope: input.fromScope ?? 'project',
    toScope: input.toScope ?? 'project',
    ...(input.fromProjectId === undefined ? {} : { fromProjectId: input.fromProjectId }),
    ...(input.toProjectId === undefined ? {} : { toProjectId: input.toProjectId }),
    relationType: input.relationType,
    status: 'trial',
    confidence: input.confidence ?? 0.7,
    origin: 'model',
    reason: input.reason,
    evidenceKind: 'model_hint',
    createdAt: input.now,
    updatedAt: input.now
  }
}

export function createOperationBackedEdge(input: OperationBackedEdgeDraft): MemoryEdge {
  if (input.evidenceId === undefined || input.evidenceKind === undefined) {
    throw new Error('Operation-backed relation edge requires evidenceId and evidenceKind')
  }
  return {
    id: stableMemoryEdgeId(input),
    fromMemoryId: input.fromMemoryId,
    toMemoryId: input.toMemoryId,
    fromScope: input.fromScope ?? 'project',
    toScope: input.toScope ?? 'project',
    ...(input.fromProjectId === undefined ? {} : { fromProjectId: input.fromProjectId }),
    ...(input.toProjectId === undefined ? {} : { toProjectId: input.toProjectId }),
    relationType: input.relationType,
    status: 'validated',
    confidence: input.confidence ?? (HIGH_IMPACT_RELATIONS.has(input.relationType) ? 0.9 : 0.8),
    origin: 'operation',
    reason: input.reason,
    evidenceId: input.evidenceId,
    evidenceKind: input.evidenceKind,
    createdAt: input.now,
    updatedAt: input.now
  }
}
