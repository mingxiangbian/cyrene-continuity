import { describe, expect, it } from 'vitest'
import { evaluateCandidateAdmission } from '../src/codex/admission-gate.js'
import type { CandidateDraft, CyreneMemory, MemoryTombstone, PendingMemory } from '../src/memory/types.js'

function draft(overrides: Partial<CandidateDraft> = {}): CandidateDraft {
  return {
    id: 'draft-1',
    content: 'Repository changes must preserve pending review.',
    candidateKind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    sourceKind: 'review_summary',
    sourceEpisodeIds: ['episode-1'],
    evidenceRefs: ['evidence-1'],
    normalizedKey: 'repository-preserve-pending-review',
    tags: ['test'],
    createdAt: '2026-05-31T00:00:00.000Z',
    ...overrides
  }
}

function active(normalizedKey: string): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Active memory.',
    normalizedKey,
    evidence: [{ summary: 'Active evidence.' }],
    source: 'file',
    scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 },
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    tags: []
  }
}

function pending(normalizedKey: string): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Pending memory.',
    normalizedKey,
    evidence: [{ summary: 'Pending evidence.' }],
    source: 'file',
    scores: { evidenceStrength: 0.8, stability: 0.7, usefulness: 0.7, safety: 0.9, sensitivity: 0.1 },
    seenCount: 1,
    firstSeenAt: '2026-05-01T00:00:00.000Z',
    lastSeenAt: '2026-05-01T00:00:00.000Z',
    expiresAt: '2026-06-01T00:00:00.000Z',
    tags: []
  }
}

function tombstone(normalizedKey: string): MemoryTombstone {
  return {
    id: 'tombstone-1',
    normalizedKey,
    domain: 'project',
    type: 'project_fact',
    scope: 'project',
    reason: 'rejected',
    createdAt: '2026-05-01T00:00:00.000Z',
    expiresAt: '2026-06-30T00:00:00.000Z'
  }
}

describe('evaluateCandidateAdmission', () => {
  it('keeps one-time action logs out of pending', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: '使用 repo-review-fix-coordinator 工具检查和修复代码审查发现的问题。',
        candidateKind: 'project_fact',
        normalizedKey: 'one-time-action'
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('episode_only')
    expect(decision.reasons).toContain('one_time_action')
    expect(decision.reasons).toContain('low_future_usefulness')
  })

  it('keeps stale numeric snapshots out of pending', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: '项目包含 44 个测试文件，广泛覆盖 active memory、CLI、distill、MCP、memory index 等模块。',
        candidateKind: 'project_fact',
        normalizedKey: 'test-count-snapshot'
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(['episode_only', 'admit_to_distillation']).toContain(decision.action)
    expect(decision.action).not.toBe('admit_to_pending')
    expect(decision.reasons).toContain('stale_numeric_snapshot')
  })

  it('admits durable workflow rules to pending', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: 'Core memory pipeline changes must preserve review-hash validation.',
        candidateKind: 'workflow_rule',
        normalizedKey: 'preserve-review-hash'
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('admit_to_pending')
    expect(decision.reasons).toContain('valuable_workflow_rule')
  })

  it('admits explicit user instructions to pending', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: '以后所有 spec 和 plan 默认用中文写。',
        candidateKind: 'user_instruction',
        sourceKind: 'user_explicit',
        normalizedKey: 'chinese-spec-plan'
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('admit_to_pending')
    expect(decision.reasons).toContain('explicit_user_instruction')
  })

  it('rejects duplicate active memory by normalizedKey', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({ normalizedKey: 'duplicate-key' }),
      pending: [],
      active: [active('duplicate-key')],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('reject_duplicate')
    expect(decision.reasons).toContain('duplicate_active')
    expect(decision.targetMemoryId).toBe('active-1')
  })

  it('merges duplicate pending memory by normalizedKey', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({ normalizedKey: 'duplicate-pending-key' }),
      pending: [pending('duplicate-pending-key')],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('merge_with_existing')
    expect(decision.reasons).toContain('duplicate_pending')
    expect(decision.targetMemoryId).toBe('pending-1')
  })

  it('drops candidates with pending duplicates when an active tombstone also matches', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({ normalizedKey: 'blocked-pending-key' }),
      pending: [pending('blocked-pending-key')],
      active: [],
      tombstones: [tombstone('blocked-pending-key')],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('auto_drop')
    expect(decision.reasons).toContain('conflicts_with_tombstone')
  })

  it('drops candidates that conflict with active tombstones', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({ normalizedKey: 'blocked-key' }),
      pending: [],
      active: [],
      tombstones: [tombstone('blocked-key')],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('auto_drop')
    expect(decision.reasons).toContain('conflicts_with_tombstone')
  })

  it('admits durable Chinese workflow rules that mention fixing issues', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: '修复问题前必须先复现并记录命令输出。',
        candidateKind: 'workflow_rule',
        normalizedKey: 'reproduce-before-fixing'
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('admit_to_pending')
    expect(decision.reasons).toContain('valuable_workflow_rule')
    expect(decision.reasons).not.toContain('one_time_action')
  })
})
