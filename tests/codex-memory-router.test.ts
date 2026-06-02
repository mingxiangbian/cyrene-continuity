import { describe, expect, it } from 'vitest'
import {
  reviewDecisionForRoute,
  routeCandidateDraft,
  semanticCandidateFromDraft
} from '../src/codex/memory-router.js'
import type { AdmissionDecision, AdmissionScores, CandidateDraft } from '../src/memory/types.js'

const now = '2026-06-01T00:00:00.000Z'

function draft(overrides: Partial<CandidateDraft> = {}): CandidateDraft {
  return {
    id: 'draft-1',
    content: 'Repo workflow rules must follow AGENTS.md for surgical changes.',
    candidateKind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    sourceKind: 'review_summary',
    sourceEpisodeIds: ['episode-1'],
    evidenceRefs: ['AGENTS.md'],
    normalizedKey: 'agents-md-workflow-rule',
    tags: ['test'],
    createdAt: now,
    ...overrides
  }
}

function admission(overrides: Partial<AdmissionDecision> = {}): AdmissionDecision {
  return {
    id: 'admission-1',
    draftId: 'draft-1',
    action: 'admit_to_pending',
    admissionScore: 0.72,
    reasons: ['valuable_workflow_rule'],
    scores: scores(),
    createdAt: now,
    ...overrides
  }
}

function scores(overrides: Partial<AdmissionScores> = {}): AdmissionScores {
  return {
    futureUsefulness: 0.85,
    actionability: 0.85,
    stability: 0.8,
    specificity: 0.75,
    evidenceStrength: 0.75,
    repeatPotential: 0.7,
    expiryRisk: 0.1,
    redundancy: 0,
    sensitivity: 0.1,
    ...overrides
  }
}

describe('Codex memory router', () => {
  it('routes workflow rules to procedural pending review with low risk', () => {
    const route = routeCandidateDraft({ draft: draft(), admission: admission() })

    expect(route).toEqual({
      module: 'procedural',
      updatePolicy: 'pending_review',
      risk: 'low',
      reasons: [
        'candidate kind workflow_rule maps to procedural module',
        'project/procedural memory requires review before activation'
      ]
    })
  })

  it('routes relationship user instructions to manual-only high risk', () => {
    const route = routeCandidateDraft({
      draft: draft({
        candidateKind: 'user_instruction',
        domain: 'relationship',
        normalizedKey: 'relationship-user-instruction'
      }),
      admission: admission({ reasons: ['explicit_user_instruction'], scores: scores({ sensitivity: 0.7 }) })
    })

    expect(route.module).toBe('relationship_affective')
    expect(route.updatePolicy).toBe('manual_only')
    expect(route.risk).toBe('high')
    expect(route.reasons).toContain('high sensitivity or protected domain requires manual review')
  })

  it('routes task-state admissions to the task_state module with defer policy', () => {
    const taskRoute = routeCandidateDraft({
      draft: draft({
        taskState: {
          kind: 'implementation_progress',
          summary: 'Task 2 implementation is in progress.'
        }
      }),
      admission: admission({
        action: 'task_state' as AdmissionDecision['action'],
        reasons: ['task_state', 'temporary_status']
      })
    })

    expect(taskRoute.module).toBe('task_state')
    expect(taskRoute.updatePolicy).toBe('defer')
    expect(taskRoute.reasons).toContain('task state is deferred outside active memory review')
  })

  it('routes source-of-truth duplicates to drop as reference-only', () => {
    const route = routeCandidateDraft({
      draft: draft({ sourceOfTruth: 'AGENTS.md' }),
      admission: admission({
        action: 'reference_only' as AdmissionDecision['action'],
        reasons: ['source_of_truth_duplicate', 'raw_file_rule_excerpt']
      })
    })

    expect(route.updatePolicy).toBe('drop')
    expect(route.reasons).toContain('source-of-truth duplicate is reference-only')
  })

  it('permits strict auto-promotion only for low-risk trusted source candidates', () => {
    const route = routeCandidateDraft({
      draft: draft({ sourceKind: 'file' }),
      admission: admission({ action: 'admit_to_pending' })
    })

    expect(route.module).toBe('procedural')
    expect(route.updatePolicy).toBe('strict_auto_promote')
    expect(route.reasons).toContain('trusted low-risk project/procedural memory may enter v5 auto-promotion gate')
  })

  it('does not route high-sensitivity procedural candidates into strict auto-promotion', () => {
    const route = routeCandidateDraft({
      draft: draft({ sourceKind: 'file' }),
      admission: admission({
        action: 'admit_to_pending',
        scores: scores({ sensitivity: 0.7 })
      })
    })

    expect(route.module).toBe('procedural')
    expect(route.risk).toBe('high')
    expect(route.updatePolicy).toBe('manual_only')
    expect(route.updatePolicy).not.toBe('strict_auto_promote')
  })

  it('creates a semantic candidate with source-of-truth evidence and usage rules', () => {
    const sourceDraft = draft({ sourceOfTruth: 'AGENTS.md' })
    const route = routeCandidateDraft({ draft: sourceDraft, admission: admission() })
    const semantic = semanticCandidateFromDraft({ draft: sourceDraft, admission: admission(), route, now })

    expect(semantic.sourceOfTruth).toBe('AGENTS.md')
    expect(semantic.useWhen).toEqual(['Future task matches agents-md-workflow-rule'])
    expect(semantic.doNotUseWhen.length).toBeGreaterThan(0)
    expect(semantic.doNotUseWhen.join(' ')).toContain('AGENTS.md')
    expect(semantic.evidence).toEqual([
      {
        id: 'evidence-draft-1-0',
        sourceKind: 'review_summary',
        sourceRef: 'AGENTS.md',
        when: now,
        whatHappened: 'Repo workflow rules must follow AGENTS.md for surgical changes.',
        whyImportant: 'Candidate was admitted as workflow_rule with reasons: valuable_workflow_rule'
      }
    ])
  })

  it('creates deterministic review decisions for a route', () => {
    const route = routeCandidateDraft({ draft: draft(), admission: admission() })
    const decision = reviewDecisionForRoute({
      semanticMemoryId: 'semantic-draft-1',
      route,
      reviewHash: 'hash-1',
      now
    })

    expect(decision.id).toBe('review-semantic-draft-1')
    expect(decision.policy).toBe('pending_review')
    expect(decision.reviewHash).toBe('hash-1')
    expect(decision.reasons).toEqual(route.reasons)
  })
})
