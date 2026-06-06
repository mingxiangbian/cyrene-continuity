import { describe, expect, it } from 'vitest'
import {
  createModelHintEdge,
  createOperationBackedEdge,
  relationExpansionPolicy,
  resolveRelationExpansion,
  stableMemoryEdgeId
} from '../src/memory/memory-relations.js'
import type { MemoryEdge } from '../src/memory/types.js'

describe('memory relation semantics', () => {
  it('treats similar_to as diagnostics only for ordinary expansion', () => {
    expect(relationExpansionPolicy('similar_to')).toEqual({ runtime: false, diagnostics: true })
  })

  it('uses supersedes from replacement to old and suppresses old active truth', () => {
    const edge = createMemoryEdge({
      fromMemoryId: 'new',
      toMemoryId: 'old',
      relationType: 'supersedes',
      status: 'validated'
    })

    expect(resolveRelationExpansion({ seedMemoryId: 'old', edge })).toEqual({
      includeMemoryId: 'new',
      suppressMemoryIds: ['old'],
      reason: 'supersedes_replacement'
    })
  })

  it('keeps model-origin high impact edges trial only', () => {
    const edge = createModelHintEdge({
      fromMemoryId: 'candidate',
      toMemoryId: 'old',
      relationType: 'supersedes',
      now: '2026-06-07T00:00:00.000Z',
      reason: 'model suggested supersede'
    })

    expect(edge).toMatchObject({
      status: 'trial',
      origin: 'model',
      evidenceKind: 'model_hint',
      relationType: 'supersedes'
    })
  })

  it('requires operation evidence for validated high impact relation edges', () => {
    expect(() => createOperationBackedEdge({
      fromMemoryId: 'candidate',
      toMemoryId: 'old',
      relationType: 'supersedes',
      now: '2026-06-07T00:00:00.000Z',
      reason: 'missing evidence'
    })).toThrow('Operation-backed relation edge requires evidenceId and evidenceKind')

    expect(createOperationBackedEdge({
      fromMemoryId: 'candidate',
      toMemoryId: 'old',
      relationType: 'supersedes',
      now: '2026-06-07T00:00:00.000Z',
      reason: 'review hash supersede',
      evidenceId: 'review-1',
      evidenceKind: 'review_hash'
    })).toMatchObject({
      status: 'validated',
      origin: 'operation',
      evidenceId: 'review-1',
      evidenceKind: 'review_hash'
    })
  })

  it('builds stable ids from relation identity rather than reason text', () => {
    const left = stableMemoryEdgeId({
      fromMemoryId: 'a',
      toMemoryId: 'b',
      relationType: 'supports',
      evidenceId: 'evidence-1'
    })
    const right = stableMemoryEdgeId({
      fromMemoryId: 'a',
      toMemoryId: 'b',
      relationType: 'supports',
      evidenceId: 'evidence-1'
    })

    expect(left).toBe(right)
    expect(left).toMatch(/^edge-[a-f0-9]{16}$/)
  })
})

function createMemoryEdge(overrides: Partial<MemoryEdge> = {}): MemoryEdge {
  return {
    id: 'edge-1',
    fromMemoryId: 'memory-from',
    toMemoryId: 'memory-to',
    fromScope: 'project',
    toScope: 'project',
    fromProjectId: 'project-1',
    toProjectId: 'project-1',
    relationType: 'supports',
    status: 'trial',
    confidence: 0.8,
    origin: 'deterministic',
    reason: 'test relation',
    evidenceId: 'evidence-1',
    evidenceKind: 'normalized_key',
    createdAt: '2026-06-07T00:00:00.000Z',
    updatedAt: '2026-06-07T00:00:00.000Z',
    ...overrides
  }
}
