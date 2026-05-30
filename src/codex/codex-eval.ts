import { getCodexContinuityContext } from './continuity-context.js'
import {
  combineEvalGateResults,
  MINIMUM_EVAL_CHECKS,
  runDreamApplyEvalGate,
  runMemoryRoutingEvalGate,
  runSimilarHintsEvalGate,
  runV5AutoPromotionEvalGate,
  runV5MemoryEdgeEvalGate,
  type EvalCheckName,
  type EvalResult
} from '../eval/eval-runner.js'

export interface CodexSimilarHintsEvalSummary {
  check: 'similar-hints'
  passed: boolean
  failedChecks: string[]
  similarProjectHints: number
}

export interface CodexReleaseEvalSummary {
  check: 'release'
  passed: boolean
  failedChecks: EvalCheckName[]
  minimumChecks: EvalCheckName[]
  results: EvalResult[]
}

export async function runCodexSimilarHintsEval(input: { cwd: string }): Promise<CodexSimilarHintsEvalSummary> {
  const context = await getCodexContinuityContext({
    cwd: input.cwd,
    userMessage: 'Run similar-project hints boundary eval.',
    task: 'memory'
  })

  return {
    check: 'similar-hints',
    passed: context.diagnostics?.evalGate?.passed ?? true,
    failedChecks: context.diagnostics?.evalGate?.failedChecks ?? [],
    similarProjectHints: context.similarProjectHints.length
  }
}

export async function runCodexReleaseEval(): Promise<CodexReleaseEvalSummary> {
  const combined = combineEvalGateResults([
    runMemoryRoutingEvalGate({
      currentProjectId: 'release-current',
      globalMemory: [{
        id: 'release-global-active',
        status: 'active',
        scope: 'global',
        homeProjectId: null
      }],
      projectMemory: [{
        id: 'release-project-active',
        status: 'active',
        scope: 'project',
        homeProjectId: 'release-current'
      }],
      pendingHypotheses: [{
        id: 'release-pending',
        status: 'pending',
        provisional: true
      }],
      similarProjectHints: [{
        id: 'release-similar-hint',
        status: 'active',
        domain: 'procedural',
        homeProjectId: 'release-other',
        notCurrentProjectFact: true
      }]
    }),
    runSimilarHintsEvalGate([{
      id: 'release-similar-hint',
      currentProjectId: 'release-current',
      homeProjectId: 'release-other',
      domain: 'procedural',
      portability: 'similar_project',
      scope: 'project',
      content: 'Release checks keep similar-project hints transferable and non-current.',
      transferable: true,
      notCurrentProjectFact: true
    }]),
    runDreamApplyEvalGate({
      proposedChanges: [{
        action: 'promote',
        candidateId: 'release-pending',
        memoryId: 'release-memory',
        normalizedKey: 'release-pending',
        reason: 'Synthetic release eval promotion with auditable evidence.',
        distinctEvidenceCount: 1
      }],
      pending: [{
        id: 'release-pending',
        domain: 'procedural',
        type: 'procedural_rule',
        strength: 'hard',
        scope: 'project',
        status: 'pending',
        content: 'Release eval candidates stay auditable.',
        normalizedKey: 'release-pending',
        evidence: [{ runId: 'release-run', sourceKind: 'user_explicit', summary: 'Release eval fixture.' }],
        source: 'user_explicit',
        scores: {
          evidenceStrength: 0.95,
          stability: 0.9,
          usefulness: 0.9,
          safety: 0.95,
          sensitivity: 0.1
        },
        seenCount: 1,
        firstSeenAt: '2026-05-29T00:00:00.000Z',
        lastSeenAt: '2026-05-29T00:00:00.000Z',
        expiresAt: '2026-06-29T00:00:00.000Z',
        tags: ['release_eval']
      }],
      profilePreview: 'Release eval candidates stay auditable.'
    }),
    runV5AutoPromotionEvalGate([{
      candidateId: 'release-auto-promote',
      domain: 'procedural',
      scope: 'global',
      source: 'user_explicit',
      policyId: 'low_risk_global_procedural_v1',
      decision: 'auto_promote'
    }]),
    runV5MemoryEdgeEvalGate([{
      edgeId: 'release-memory-edge',
      source: 'model',
      status: 'approved',
      usedInRetrieval: true
    }])
  ])
  const results = minimumEvalResults(combined.results)
  const completedChecks = new Set(results.map((result) => result.name))
  const missingChecks = MINIMUM_EVAL_CHECKS.filter((check) => !completedChecks.has(check))
  return {
    check: 'release',
    passed: combined.passed && missingChecks.length === 0,
    failedChecks: uniqueChecks([...combined.failedChecks, ...missingChecks]),
    minimumChecks: [...MINIMUM_EVAL_CHECKS],
    results
  }
}

function minimumEvalResults(results: EvalResult[]): EvalResult[] {
  const firstByName = new Map<EvalCheckName, EvalResult>()
  for (const result of results) {
    if (MINIMUM_EVAL_CHECKS.includes(result.name) && !firstByName.has(result.name)) {
      firstByName.set(result.name, result)
    }
  }
  return MINIMUM_EVAL_CHECKS.flatMap((check) => {
    const result = firstByName.get(check)
    return result === undefined ? [] : [result]
  })
}

function uniqueChecks(checks: EvalCheckName[]): EvalCheckName[] {
  return Array.from(new Set(checks))
}
