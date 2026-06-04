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

  it('drops version-bound implementation changelog instead of routing it to memory', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: 'v1 admission gate 核心实现采用 subagent-driven 执行方案，并创建隔离工作区。',
        candidateKind: 'project_decision',
        domain: 'project',
        normalizedKey: 'v1-admission-gate-subagent-worktree'
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('auto_drop')
    expect(decision.reasons).toContain('implementation_note')
    expect(decision.reasons).toContain('implementation_changelog')
    expect(decision.reasons).not.toContain('needs_active_memory_rewrite')
  })

  it('drops raw file rule excerpts instead of routing them to distillation', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: 'AGENTS.md 中规定：所有修改必须直接追溯到指定的 issue 或 task，进行精确的手术式更改。',
        candidateKind: 'workflow_rule',
        normalizedKey: 'agents-md-all-edits-surgical'
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('auto_drop')
    expect(decision.reasons).toContain('raw_file_rule_excerpt')
    expect(decision.reasons).not.toContain('needs_active_memory_rewrite')
  })

  it('drops source-of-truth raw excerpts instead of creating reference memory', () => {
    const sourceDuplicateDecision = evaluateCandidateAdmission({
      draft: draft({
        content: 'AGENTS.md 中规定：所有修改必须直接追溯到指定的 issue 或 task，进行精确的手术式更改。',
        candidateKind: 'workflow_rule',
        normalizedKey: 'agents-md-all-edits-surgical',
        sourceKind: 'file',
        sourceOfTruth: 'AGENTS.md'
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(sourceDuplicateDecision.action).toBe('auto_drop')
    expect(sourceDuplicateDecision.reasons).toContain('source_of_truth_excerpt')
    expect(sourceDuplicateDecision.reasons).toContain('raw_file_rule_excerpt')
    expect(sourceDuplicateDecision.reasons).not.toContain('source_of_truth_duplicate')
  })

  it('drops single-evidence AGENTS.md repository policy excerpts', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: '仓库工作规则：必须进行直接针对请求问题的精确更改（surgical changes）。',
        candidateKind: 'workflow_rule',
        normalizedKey: 'agents-md-surgical-changes-excerpt',
        sourceKind: 'file',
        sourceOfTruth: 'AGENTS.md',
        evidenceRefs: ['AGENTS.md']
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-06-02T00:00:00.000Z'
    })

    expect(decision.action).toBe('auto_drop')
    expect(decision.reasons).toContain('source_of_truth_excerpt')
    expect(decision.reasons).toContain('raw_file_rule_excerpt')
  })

  it('keeps review-summary implementation status out of pending even when typed as a project decision', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: '修复 automation prompt 误捕获漏洞，清理旧 pending 并使之归零，全量测试 620 通过，typecheck 和 plugin validation 均通过。',
        candidateKind: 'project_decision',
        domain: 'project',
        normalizedKey: 'fixed-automation-prompt-cleared-pending-tests-passed',
        sourceKind: 'review_summary',
        sourceOfTruth: 'review_summary:status-noise'
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-06-02T00:00:00.000Z'
    })

    expect(decision.action).not.toBe('admit_to_pending')
    expect(decision.action).toBe('auto_drop')
    expect(decision.reasons).toContain('implementation_changelog')
    expect(decision.reasons).toContain('temporary_status')
    expect(decision.reasons).toContain('stale_numeric_snapshot')
    expect(decision.reasons).toContain('low_future_usefulness')
  })

  it('drops operational raw source-of-truth excerpts unless they are rewritten as memory', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: 'AGENTS.md requires Codex to use surgical edits for non-trivial code changes and keep each changed line tied to the requested task.',
        candidateKind: 'workflow_rule',
        normalizedKey: 'agents-md-operational-surgical-edits',
        sourceOfTruth: 'AGENTS.md'
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('auto_drop')
    expect(decision.reasons).toContain('raw_file_rule_excerpt')
    expect(decision.reasons).not.toContain('source_of_truth_duplicate')
  })

  it('admits canonical workflow rules with source-of-truth context', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: 'For non-trivial code or architecture changes in this repo, edits should trace directly to a specified issue/task and remain surgical: avoid unrelated refactors, broad rewrites, or opportunistic cleanup unless explicitly requested. Source of truth: AGENTS.md.',
        candidateKind: 'workflow_rule',
        normalizedKey: 'workflow-agents-md-surgical-edits'
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('admit_to_pending')
    expect(decision.reasons).not.toContain('raw_file_rule_excerpt')
    expect(decision.reasons).not.toContain('needs_active_memory_rewrite')
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

  it('routes task state before active duplicate handling', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: 'This branch review is currently in progress.',
        candidateKind: 'project_fact',
        normalizedKey: 'duplicate-key',
        taskState: {
          kind: 'implementation_progress',
          summary: 'Branch review is in progress.'
        }
      }),
      pending: [],
      active: [active('duplicate-key')],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('task_state')
    expect(decision.reasons).toContain('task_state')
    expect(decision.reasons).not.toContain('duplicate_active')
  })

  it('drops active source-of-truth duplicate raw excerpts before duplicate handling', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: 'AGENTS.md 中规定：所有修改必须直接追溯到指定的 issue 或 task，进行精确的手术式更改。',
        candidateKind: 'workflow_rule',
        normalizedKey: 'duplicate-key',
        sourceKind: 'file',
        sourceOfTruth: 'AGENTS.md'
      }),
      pending: [],
      active: [active('duplicate-key')],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('auto_drop')
    expect(decision.reasons).toContain('source_of_truth_excerpt')
    expect(decision.reasons).toContain('raw_file_rule_excerpt')
    expect(decision.reasons).not.toContain('duplicate_active')
    expect(decision.targetMemoryId).toBeUndefined()
  })

  it('rejects source-of-truth duplicate active memory with exact reasons', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({ normalizedKey: 'duplicate-key', sourceOfTruth: 'AGENTS.md' }),
      pending: [],
      active: [active('duplicate-key')],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('reject_duplicate')
    expect(decision.reasons).toEqual(['duplicate_active', 'source_of_truth_duplicate'])
    expect(decision.targetMemoryId).toBe('active-1')
  })

  it('routes implementation progress task state to task state before durable handling', () => {
    const taskDecision = evaluateCandidateAdmission({
      draft: draft({
        content: 'Core memory pipeline changes must preserve review-hash validation. 当前 Task 2 implementation is in progress.',
        candidateKind: 'workflow_rule',
        normalizedKey: 'task-state-implementation-progress',
        taskState: {
          kind: 'implementation_progress',
          summary: 'Task 2 implementation is in progress.'
        }
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(taskDecision.action).toBe('task_state')
    expect(taskDecision.reasons).toContain('task_state')
    expect(taskDecision.reasons).toContain('temporary_status')
  })

  it('routes explicit implementation progress task state to task state instead of pending', () => {
    const taskDecision = evaluateCandidateAdmission({
      draft: draft({
        content: 'I have finished checking this update for review bugs in the current branch.',
        candidateKind: 'user_instruction',
        sourceKind: 'user_explicit',
        normalizedKey: 'explicit-task-state-review-progress',
        taskState: {
          kind: 'implementation_progress',
          summary: 'Review bug check finished in current branch.'
        }
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(taskDecision.action).toBe('task_state')
    expect(taskDecision.reasons).toContain('explicit_user_instruction')
    expect(taskDecision.reasons).toContain('task_state')
  })

  it('routes task state to task state instead of merging with duplicate pending memory', () => {
    const taskDecision = evaluateCandidateAdmission({
      draft: draft({
        content: 'This branch review is currently in progress.',
        candidateKind: 'project_fact',
        normalizedKey: 'duplicate-pending-key',
        taskState: {
          kind: 'implementation_progress',
          summary: 'Branch review is in progress.'
        }
      }),
      pending: [pending('duplicate-pending-key')],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(taskDecision.action).toBe('task_state')
    expect(taskDecision.reasons).toContain('task_state')
    expect(taskDecision.reasons).not.toContain('duplicate_pending')
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
