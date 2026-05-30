import { describe, expect, it } from 'vitest'
import {
  combineEvalGateResults,
  runDreamApplyEvalGate,
  runV5ActiveLifecycleEvalGate,
  runV5AutoPromotionEvalGate,
  runV5GlobalAutoPromotionEvalGate,
  runV5MemoryEdgeEvalGate,
  runV5PendingBudgetEvalGate,
  runV5RetrievalExplainEvalGate,
  runMemoryMigrationEvalGate,
  runProfileApplyEvalGate,
  runMemoryRoutingEvalGate,
  runSimilarHintsEvalGate,
  type SimilarHintEvalCandidate
} from '../src/eval/eval-runner.js'
import type { CyreneMemory, PendingMemory } from '../src/memory/types.js'

function candidate(overrides: Partial<SimilarHintEvalCandidate> = {}): SimilarHintEvalCandidate {
  return {
    id: 'hint-1',
    currentProjectId: 'current',
    homeProjectId: 'other',
    domain: 'procedural',
    portability: 'similar_project',
    scope: 'project',
    content: 'MCP plugin projects should rebuild generated runtime explicitly.',
    transferable: true,
    notCurrentProjectFact: true,
    ...overrides
  }
}

function pending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'Use Chinese for Cyrene specs and plans.',
    normalizedKey: 'cyrene-spec-plan-language',
    evidence: [
      {
        runId: 'run-1',
        sessionId: 'session-1',
        evidenceGroupId: 'group-1',
        sourceKind: 'user_explicit',
        summary: 'User asked for Chinese specs and plans.'
      }
    ],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 2,
    firstSeenAt: '2026-05-25T00:00:00.000Z',
    lastSeenAt: '2026-05-25T00:00:00.000Z',
    expiresAt: '2026-06-24T00:00:00.000Z',
    tags: ['codex'],
    ...overrides
  }
}

function activeMemory(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Use explicit release gates before shipping plugin changes.',
    normalizedKey: 'release-gates',
    evidence: [{
      runId: 'run-1',
      sourceKind: 'user_explicit',
      summary: 'User asked for release gates.'
    }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    tags: ['codex'],
    ...overrides
  }
}

describe('memory routing eval gate', () => {
  it('passes active, pending, and similar-project memories only in their explicit routes', () => {
    const result = runMemoryRoutingEvalGate({
      currentProjectId: 'current',
      globalMemory: [{
        id: 'global-active',
        status: 'active',
        scope: 'global',
        homeProjectId: null
      }],
      projectMemory: [{
        id: 'project-active',
        status: 'active',
        scope: 'project',
        homeProjectId: 'current'
      }],
      pendingHypotheses: [{
        id: 'pending-ok',
        status: 'pending',
        provisional: true
      }],
      similarProjectHints: [{
        id: 'hint-ok',
        status: 'active',
        domain: 'procedural',
        homeProjectId: 'other',
        notCurrentProjectFact: true
      }]
    })

    expect(result.passed).toBe(true)
    expect(result.failedChecks).toEqual([])
    expect(result.results.map((check) => check.name)).toEqual(['memory_routing_eval'])
  })

  it('fails memory_routing_eval when pending or similar hints are routed as confirmed facts', () => {
    const result = runMemoryRoutingEvalGate({
      currentProjectId: 'current',
      globalMemory: [{
        id: 'pending-in-active',
        status: 'pending',
        scope: 'project',
        homeProjectId: 'current'
      }],
      projectMemory: [],
      pendingHypotheses: [{
        id: 'pending-ok',
        status: 'pending',
        provisional: true
      }],
      similarProjectHints: [{
        id: 'hint-current-fact',
        status: 'active',
        domain: 'procedural',
        homeProjectId: 'other',
        notCurrentProjectFact: false
      }]
    })

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toEqual(['memory_routing_eval'])
    expect(JSON.stringify(result.results)).toContain('pending-in-active')
    expect(JSON.stringify(result.results)).toContain('hint-current-fact')
  })
})

describe('memory migration eval gate', () => {
  it('passes project and procedural memory migration', () => {
    const result = runMemoryMigrationEvalGate({
      fromProjectId: 'legacy',
      toProjectId: 'current',
      activeMemories: [
        activeMemory({ id: 'project', domain: 'project', type: 'project_fact' }),
        activeMemory({ id: 'procedural', domain: 'procedural', type: 'procedural_rule' })
      ]
    })

    expect(result.passed).toBe(true)
    expect(result.failedChecks).toEqual([])
  })

  it('fails cross_project_leak_eval for personal relationship or affective memory migration', () => {
    const result = runMemoryMigrationEvalGate({
      fromProjectId: 'legacy',
      toProjectId: 'current',
      activeMemories: [
        activeMemory({ id: 'personal', domain: 'personal', type: 'user_preference' }),
        activeMemory({ id: 'relationship', domain: 'relationship', type: 'relationship_boundary' }),
        activeMemory({ id: 'affective', domain: 'affective', type: 'affective_pattern' })
      ]
    })

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toEqual(['cross_project_leak_eval'])
    expect(JSON.stringify(result.results)).toContain('personal')
    expect(JSON.stringify(result.results)).toContain('relationship')
    expect(JSON.stringify(result.results)).toContain('affective')
  })
})

describe('eval gate result combination', () => {
  it('reports each failed check once when combining gates', () => {
    const left = runSimilarHintsEvalGate([candidate({ id: 'personal-hint', domain: 'personal' })])
    const right = runSimilarHintsEvalGate([candidate({ id: 'relationship-hint', domain: 'relationship' })])

    const result = combineEvalGateResults([left, right])

    expect(result.passed).toBe(false)
    expect(result.failedChecks.filter((check) => check === 'similar_hint_eval')).toHaveLength(1)
  })
})

describe('similar hints eval gate', () => {
  it('passes safe transferable procedural hints', () => {
    const result = runSimilarHintsEvalGate([candidate()])

    expect(result.passed).toBe(true)
    expect(result.failedChecks).toEqual([])
    expect(result.results.every((check) => check.passed)).toBe(true)
  })

  it('fails cross-project leak candidates', () => {
    const result = runSimilarHintsEvalGate([
      candidate({ id: 'same-project', homeProjectId: 'current' }),
      candidate({ id: 'local-only', portability: 'local_only' }),
      candidate({ id: 'global', scope: 'global' }),
      candidate({ id: 'missing-home', homeProjectId: null })
    ])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('cross_project_leak_eval')
    expect(JSON.stringify(result.results)).toContain('same-project')
    expect(JSON.stringify(result.results)).toContain('local-only')
    expect(JSON.stringify(result.results)).toContain('global')
    expect(JSON.stringify(result.results)).toContain('missing-home')
  })

  it('fails boundary violations in domain and content', () => {
    const result = runSimilarHintsEvalGate([
      candidate({ id: 'personal', domain: 'personal' }),
      candidate({ id: 'relationship', domain: 'relationship' }),
      candidate({ id: 'affective', domain: 'affective' }),
      candidate({ id: 'path-users', content: 'Use /Users/phoenix/private/project/config.json.' }),
      candidate({ id: 'path-home', content: 'Use /home/agent/private/project/config.json.' }),
      candidate({ id: 'path-var', content: 'Use /var/tmp/private/project/config.json.' }),
      candidate({ id: 'path-etc', content: 'Use /etc/private/project/config.json.' }),
      candidate({ id: 'path-tmp', content: 'Use /tmp/private/project/config.json.' }),
      candidate({ id: 'remote-ssh', content: 'Clone git@github.com:secret/private.git.' }),
      candidate({ id: 'remote-https', content: 'Clone https://github.com/secret/private.git.' }),
      candidate({ id: 'secret-openai', content: 'Token sk-123456789012345678901234567890123456789012345678.' }),
      candidate({ id: 'secret-ghp', content: 'Token ghp_1234567890123456789012345678901234567890.' }),
      candidate({ id: 'secret-github-pat', content: 'Token github_pat_1234567890123456789012345678901234567890.' }),
      candidate({ id: 'secret-slack', content: 'Token xoxb-1234567890123456789012345678901234567890.' }),
      candidate({ id: 'flags', transferable: false, notCurrentProjectFact: false })
    ])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('similar_hint_eval')
    expect(JSON.stringify(result.results)).toContain('personal')
    expect(JSON.stringify(result.results)).toContain('relationship')
    expect(JSON.stringify(result.results)).toContain('affective')
    expect(JSON.stringify(result.results)).toContain('absolute path')
    expect(JSON.stringify(result.results)).toContain('raw remote')
    expect(JSON.stringify(result.results)).toContain('secret-like')
    expect(JSON.stringify(result.results)).toContain('missing similar hint flags')
  })

  it('fails wrapped paths, non-GitHub raw remotes, and review hashes', () => {
    const result = runSimilarHintsEvalGate([
      candidate({ id: 'wrapped-path', content: 'Use `/Users/phoenix/private/config.json`.' }),
      candidate({ id: 'gitlab-ssh', content: 'Clone git@gitlab.com:org/private.git.' }),
      candidate({ id: 'gitlab-https', content: 'Clone https://gitlab.com/org/private.git.' }),
      candidate({
        id: 'review-hash',
        content: 'reviewHash=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      })
    ])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('similar_hint_eval')
    expect(JSON.stringify(result.results)).toContain('wrapped-path')
    expect(JSON.stringify(result.results)).toContain('gitlab-ssh')
    expect(JSON.stringify(result.results)).toContain('gitlab-https')
    expect(JSON.stringify(result.results)).toContain('review-hash')
    expect(JSON.stringify(result.results)).toContain('absolute path')
    expect(JSON.stringify(result.results)).toContain('raw remote')
    expect(JSON.stringify(result.results)).toContain('secret-like')
  })

  it('fails broad absolute paths and hash separator forms', () => {
    const result = runSimilarHintsEvalGate([
      candidate({ id: 'path-opt', content: 'Use /opt/private/config.json.' }),
      candidate({ id: 'path-usr', content: 'Run /usr/local/bin/tool.' }),
      candidate({ id: 'path-windows', content: 'Use C:\\Users\\phoenix\\secret.txt.' }),
      candidate({
        id: 'review-hash-colon',
        content: 'reviewHash: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      }),
      candidate({
        id: 'candidate-hash-space',
        content: 'candidateHash 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      })
    ])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('similar_hint_eval')
    expect(JSON.stringify(result.results)).toContain('path-opt')
    expect(JSON.stringify(result.results)).toContain('path-usr')
    expect(JSON.stringify(result.results)).toContain('path-windows')
    expect(JSON.stringify(result.results)).toContain('review-hash-colon')
    expect(JSON.stringify(result.results)).toContain('candidate-hash-space')
    expect(JSON.stringify(result.results)).toContain('absolute path')
    expect(JSON.stringify(result.results)).toContain('secret-like')
  })

  it('reports HTTPS raw remotes without git suffix with a raw remote finding', () => {
    const result = runSimilarHintsEvalGate([
      candidate({ id: 'github-https-no-suffix', content: 'Clone https://github.com/org/private-repo.' }),
      candidate({ id: 'gitlab-https-no-suffix', content: 'Clone https://gitlab.com/org/private.' })
    ])
    const boundary = result.results.find((check) => check.name === 'similar_hint_eval')

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('similar_hint_eval')
    expect(boundary?.findings).toEqual(expect.arrayContaining([
      { memoryId: 'github-https-no-suffix', reason: 'content contains raw remote' },
      { memoryId: 'gitlab-https-no-suffix', reason: 'content contains raw remote' }
    ]))
  })

  it('reports raw remotes using ssh git and http protocols', () => {
    const result = runSimilarHintsEvalGate([
      candidate({ id: 'ssh-url', content: 'Clone ssh://git@github.com/org/private.git.' }),
      candidate({ id: 'git-url', content: 'Clone git://github.com/org/private.git.' }),
      candidate({ id: 'http-url', content: 'Clone http://github.com/org/private.git.' })
    ])
    const boundary = result.results.find((check) => check.name === 'similar_hint_eval')

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('similar_hint_eval')
    expect(boundary?.findings).toEqual(expect.arrayContaining([
      { memoryId: 'ssh-url', reason: 'content contains raw remote' },
      { memoryId: 'git-url', reason: 'content contains raw remote' },
      { memoryId: 'http-url', reason: 'content contains raw remote' }
    ]))
  })
})

describe('profile apply eval gate', () => {
  it('fails profile_pollution_eval when source memory ids are not approved active memory', () => {
    const result = runProfileApplyEvalGate({
      id: 'profile-stale-source',
      content: 'Prefer concise implementation summaries.',
      sourceMemoryIds: ['missing-active-memory'],
      approvedSourceMemoryIds: ['active-memory']
    })

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toEqual(['profile_pollution_eval'])
    expect(JSON.stringify(result.results)).toContain('missing approved source memory')
  })
})

describe('dream apply eval gate', () => {
  it('fails pending_usage_eval for assistant-observed promotion', () => {
    const candidate = pending({
      source: 'assistant_observed',
      evidence: [
        {
          runId: 'run-1',
          evidenceGroupId: 'group-1',
          sourceKind: 'assistant_observed',
          summary: 'Assistant observed a possible preference.'
        }
      ]
    })

    const result = runDreamApplyEvalGate({
      pending: [candidate],
      proposedChanges: [{
        action: 'promote',
        candidateId: candidate.id,
        memoryId: candidate.id,
        normalizedKey: candidate.normalizedKey,
        reason: 'test promote',
        distinctEvidenceCount: 1
      }]
    })

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('pending_usage_eval')
    expect(JSON.stringify(result.results)).toContain('assistant_observed')
  })

  it('treats recommend_promote as review material, not an active mutation', () => {
    const candidate = pending({
      source: 'assistant_observed',
      evidence: [
        {
          runId: 'run-1',
          evidenceGroupId: 'group-1',
          sourceKind: 'assistant_observed',
          summary: 'Assistant observed a possible preference.'
        }
      ]
    })

    const result = runDreamApplyEvalGate({
      pending: [candidate],
      proposedChanges: [{
        action: 'recommend_promote',
        candidateId: candidate.id,
        recommendedMemoryId: candidate.id,
        normalizedKey: candidate.normalizedKey,
        reason: 'test recommendation',
        distinctEvidenceCount: 1
      }]
    })

    expect(result.failedChecks).not.toContain('pending_usage_eval')
  })

  it('fails profile_pollution_eval when profile preview includes pending-only content', () => {
    const candidate = pending({ content: 'Pending-only preference must not enter MODEL_PROFILE.md.' })

    const result = runDreamApplyEvalGate({
      pending: [candidate],
      proposedChanges: [{
        action: 'keep_pending',
        candidateId: candidate.id,
        normalizedKey: candidate.normalizedKey,
        reason: 'needs more evidence',
        distinctEvidenceCount: 1
      }],
      profilePreview: '# Cyrene Model Profile\n\nPending-only preference must not enter MODEL_PROFILE.md.\n'
    })

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('profile_pollution_eval')
    expect(JSON.stringify(result.results)).toContain('pending-only content')
  })

  it('fails affective_boundary_eval for diagnostic affective claims', () => {
    const candidate = pending({
      id: 'pending-affective',
      domain: 'affective',
      type: 'affective_pattern',
      strength: 'soft',
      scope: 'session',
      content: 'The user is unstable and emotionally dependent.',
      normalizedKey: 'diagnostic-affective-claim'
    })

    const result = runDreamApplyEvalGate({
      pending: [candidate],
      proposedChanges: [{
        action: 'reject',
        candidateId: candidate.id,
        normalizedKey: candidate.normalizedKey,
        reason: 'Affective memory cannot contain diagnostic claims',
        tombstoneReason: 'rejected'
      }]
    })

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('affective_boundary_eval')
    expect(JSON.stringify(result.results)).toContain('diagnostic affective claim')
  })
})

describe('v5 eval gates', () => {
  it('fails auto_promotion_policy_eval for personal memory auto-promotion', () => {
    const result = runV5AutoPromotionEvalGate([{
      candidateId: 'personal-auto',
      domain: 'personal',
      scope: 'global',
      source: 'user_explicit',
      policyId: 'low_risk_global_procedural_v1',
      decision: 'auto_promote'
    }])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('auto_promotion_policy_eval')
  })

  it('fails auto_promotion_policy_eval for assistant-observed global auto-promotion', () => {
    const result = runV5AutoPromotionEvalGate([{
      candidateId: 'assistant-global-auto',
      domain: 'procedural',
      scope: 'global',
      source: 'assistant_observed',
      policyId: 'low_risk_global_procedural_v1',
      decision: 'auto_promote'
    }])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('auto_promotion_policy_eval')
  })

  it('fails global_auto_promotion_eval when the daily cap is exhausted', () => {
    const result = runV5GlobalAutoPromotionEvalGate([{
      candidateId: 'global-cap',
      domain: 'procedural',
      scope: 'global',
      source: 'review_event',
      policyId: 'low_risk_global_procedural_v1',
      decision: 'auto_promote',
      usedToday: 1,
      dailyCap: 1,
      evidenceCount: 3,
      distinctEvidenceCount: 3
    }])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('global_auto_promotion_eval')
  })

  it('fails active_lifecycle_eval for an unlinked supersede candidate', () => {
    const result = runV5ActiveLifecycleEvalGate([{
      memoryId: 'active-1',
      action: 'supersede',
      contentHashChecked: true,
      linkedCandidate: false,
      normalizedKeyConflict: false
    }])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('active_lifecycle_eval')
  })

  it('fails pending_budget_eval when budget is exceeded without eviction', () => {
    const result = runV5PendingBudgetEvalGate([{
      scope: 'project',
      pendingCount: 201,
      maxPending: 200,
      evictionApplied: false,
      evictedLowestRank: false
    }])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('pending_budget_eval')
  })

  it('fails memory_edge_eval for unapproved semantic edge used in retrieval', () => {
    const result = runV5MemoryEdgeEvalGate([{
      edgeId: 'edge-pending',
      source: 'model',
      status: 'pending',
      usedInRetrieval: true
    }])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('memory_edge_eval')
  })

  it('fails retrieval_explain_eval when retrieved memory lacks explain reasons', () => {
    const result = runV5RetrievalExplainEvalGate([{
      memoryId: 'retrieved-1',
      usedInRetrieval: true,
      explainReasons: []
    }])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('retrieval_explain_eval')
  })
})
