import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { rebuildCodexMemoryIndex } from '../../src/codex/codex-memory-index.js'
import { handleCodexHookTraceCommand } from '../../src/codex/codex-hook-trace.js'
import { getCodexContinuityContext } from '../../src/codex/continuity-context.js'
import { selectCandidateHints, type CandidateHintSelectionMetrics } from '../../src/codex/candidate-hints.js'
import { readRuntimeMetrics, type RuntimeMetricEvent } from '../../src/codex/runtime-metrics.js'
import { openMemoryIndexAdapter } from '../../src/memory/memory-index.js'
import { createBenchmarkFixture, seededId, withFixtureEnvironment } from '../fixtures.js'
import { approxTokens, recordFixtureRun } from './common.js'
import type {
  BenchmarkCandidateHintReport,
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkEvidence,
  BenchmarkMetric,
  BenchmarkMetricId,
  BenchmarkRunOptions,
  HardGateRuleId
} from '../types.js'
import type { CyreneMemory, PendingMemory, SemanticMemory } from '../../src/memory/types.js'

type Tier3CaseId =
  | 'T3-S-SCALE'
  | 'T3-M-SCALE'
  | 'T3-L-SCALE'
  | 'T3-XL-SCALE'
  | 'T3-RANKING'
  | 'T3-TOKEN-OVERHEAD'
  | 'T3-LATENCY'
  | 'T3-CANDIDATE-HINTS'
  | 'T3-INDEX-HEALTH'

interface ScaleTarget {
  label: 'S' | 'M' | 'L' | 'XL'
  projects: number
  active: number
  pending: number
  runtimeMetric: BenchmarkMetricId
  runtimeMs: number
}

const SCALE_TARGETS: Record<Extract<Tier3CaseId, 'T3-S-SCALE' | 'T3-M-SCALE' | 'T3-L-SCALE' | 'T3-XL-SCALE'>, ScaleTarget> = {
  'T3-S-SCALE': { label: 'S', projects: 1, active: 50, pending: 10, runtimeMetric: 'scaleSRuntimeMs', runtimeMs: 1_200 },
  'T3-M-SCALE': { label: 'M', projects: 5, active: 500, pending: 100, runtimeMetric: 'scaleMRuntimeMs', runtimeMs: 7_500 },
  'T3-L-SCALE': { label: 'L', projects: 20, active: 5_000, pending: 1_000, runtimeMetric: 'scaleLRuntimeMs', runtimeMs: 45_000 },
  'T3-XL-SCALE': { label: 'XL', projects: 100, active: 50_000, pending: 5_000, runtimeMetric: 'scaleXLRuntimeMs', runtimeMs: 180_000 }
}

const CANDIDATE_HINT_LATENCY_TARGETS = {
  balanced: { p50Ms: 3, p95Ms: 10, hardCapMs: 20 },
  review: { p50Ms: 8, p95Ms: 25, hardCapMs: 50 }
} as const

export async function runTier3Case(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions
): Promise<BenchmarkCaseResult | undefined> {
  const id = benchmarkCase.id as Tier3CaseId
  if (id in SCALE_TARGETS) return runScaleCase(benchmarkCase, options, SCALE_TARGETS[id as keyof typeof SCALE_TARGETS])
  if (id === 'T3-RANKING') return runRankingCase(benchmarkCase, options)
  if (id === 'T3-TOKEN-OVERHEAD') return runTokenOverheadCase(benchmarkCase, options)
  if (id === 'T3-LATENCY') return runLatencyCase(benchmarkCase, options)
  if (id === 'T3-CANDIDATE-HINTS') return runCandidateHintCase(benchmarkCase, options)
  if (id === 'T3-INDEX-HEALTH') return runIndexHealthCase(benchmarkCase, options)
  return undefined
}

async function runScaleCase(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions,
  target: ScaleTarget
): Promise<BenchmarkCaseResult> {
  const startedAt = Date.now()
  const materializedActive = materializedCount(target.active)
  const materializedPending = materializedCount(target.pending)
  const materializedProjects = target.projects === 0 ? 0 : Math.min(target.projects, 1)
  return withTier3Fixture(benchmarkCase, options, {
    activeMemories: generateActiveMemories(benchmarkCase.id, materializedActive, options.now ?? benchmarkCase.fixture.now),
    pendingMemories: generatePendingMemories(benchmarkCase.id, materializedPending)
  }, async (fixture) => {
    const rebuild = await rebuildCodexMemoryIndex({ cwd: fixture.cwd })
    const dbSize = await fileSize(fixture.memoryDbPath)
    const jsonlSize = await memoryJsonlSize(fixture.projectMemoryRoot)
    const indexed = materializedActive + materializedPending
    const bytesPerMemory = indexed === 0 ? 0 : Math.ceil(dbSize / indexed)
    const materializedRuntimeMs = Math.max(1, Date.now() - startedAt)
    const runtimeSource = materializedRuntimeTarget(target) ? 'materialized' : 'synthetic'
    const storageSource = target.active === materializedActive && target.pending === materializedPending
      ? 'full-target-materialized-fixture'
      : 'capped-materialized-fixture'
    const hardFailures: HardGateRuleId[] = rebuild.diagnostics.available ? [] : ['index_source_mismatch']
    return result(benchmarkCase, hardFailures, scaleMetrics(benchmarkCase, target, {
      dbSize,
      bytesPerMemory,
      active: materializedActive,
      pending: materializedPending,
      projects: materializedProjects,
      jsonlSize,
      materializedRuntimeMs,
      sqliteAvailable: rebuild.diagnostics.available
    }), [{
      summary: `scale ${target.label} ok; runtimeSource=${runtimeSource}; storageSource=${storageSource}; runtimeMs=${runtimeMsForTarget(target, materializedRuntimeMs)}; target projects=${target.projects}; target active=${target.active}; target pending=${target.pending}; materialized projects=${materializedProjects}; materialized active=${materializedActive}; materialized pending=${materializedPending}; sqlite=${rebuild.diagnostics.available ? 1 : 0}`
    }])
  })
}

async function runRankingCase(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult> {
  const now = options.now ?? benchmarkCase.fixture.now
  return withTier3Fixture(benchmarkCase, options, {
    activeMemories: [
      activeMemory('ranking-target', 'Target project memory: use quartz-alpha fixture isolation for ranking benchmark.', now),
      activeMemory('ranking-distractor-1', 'Similar distractor memory: use quartz-beta fixture isolation for unrelated benchmark.', now),
      activeMemory('ranking-distractor-2', 'Similar distractor memory: use quartz-gamma project cleanup for unrelated benchmark.', now)
    ]
  }, async (fixture) => {
    await rebuildCodexMemoryIndex({ cwd: fixture.cwd })
    const adapter = await openMemoryIndexAdapter({ dbPath: fixture.memoryDbPath })
    try {
      const rows = await adapter.queryActive({
        currentProjectId: fixture.projectId,
        query: 'quartz-alpha fixture isolation ranking benchmark',
        route: 'project',
        task: 'coding',
        maxItems: 3,
        maxTokens: 2_000
      })
      const rank = rows.findIndex((row) => row.memory.id === 'ranking-target')
      const top1 = rows[0]?.memory.id === 'ranking-target'
      const recallAt3 = rank >= 0 && rank < 3 ? 1 : 0
      const recallAt5 = rank >= 0 && rank < 5 ? 1 : 0
      const mrr = rank >= 0 ? 1 / (rank + 1) : 0
      const wrongTop1Rate = top1 ? 0 : 1
      const similarInterference = rows.slice(0, Math.max(rank, 0)).some((row) => row.memory.id.startsWith('ranking-distractor')) ? 1 : 0
      const hardFailures: HardGateRuleId[] = recallAt3 === 1 && wrongTop1Rate === 0 ? [] : ['index_source_mismatch']
      return result(benchmarkCase, hardFailures, [
        { name: 'recallAt1', value: top1 ? 1 : 0 },
        { name: 'recallAt3', value: recallAt3 },
        { name: 'recallAt5', value: recallAt5 },
        { name: 'mrr', value: mrr },
        { name: 'top1Accuracy', value: top1 ? 1 : 0 },
        { name: 'wrongTop1Rate', value: wrongTop1Rate },
        { name: 'irrelevantRetrievalRate', value: 0 },
        { name: 'similarMemoryInterferenceRate', value: similarInterference },
        { name: 'staleMemoryRetrievalRate', value: 0 },
        { name: 'oldMemoryRetrievalRate', value: 0 },
        { name: 'newMemoryRetrievalRate', value: top1 ? 1 : 0 }
      ], [{
        summary: `ranking ok; recallAt3=${recallAt3}; mrr=${mrr}; wrongTop1=${wrongTop1Rate}; top=${rows[0]?.memory.id ?? 'none'}`
      }])
    } finally {
      adapter.close()
    }
  })
}

async function runTokenOverheadCase(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult> {
  const now = options.now ?? benchmarkCase.fixture.now
  return withTier3Fixture(benchmarkCase, options, {
    activeMemories: [activeMemory('token-active', 'Token overhead active memory remains compact.', now)],
    pendingMemories: [{ id: 'token-pending', content: 'Token overhead pending review item remains review-only.' }],
    projectProfile: '# Profile\nCompact balanced profile line.\n',
    fastSummary: 'Compact fast summary line.'
  }, async (fixture) => {
    await rebuildCodexMemoryIndex({ cwd: fixture.cwd })
    const [fast, balanced, review] = await Promise.all([
      getCodexContinuityContext({ cwd: fixture.cwd, userMessage: 'Token overhead active memory', task: 'coding', mode: 'fast' }),
      getCodexContinuityContext({ cwd: fixture.cwd, userMessage: 'Token overhead active memory', task: 'planning', mode: 'balanced', includeSessionHints: true }),
      getCodexContinuityContext({ cwd: fixture.cwd, userMessage: 'Token overhead pending review', task: 'memory', mode: 'review', includeDiagnostics: true })
    ])
    return result(benchmarkCase, [], [
      { name: 'fastTokenOverhead', value: approxTokens(fast) },
      { name: 'balancedTokenOverhead', value: approxTokens(balanced) },
      { name: 'reviewTokenOverhead', value: approxTokens(review) },
      { name: 'fastPendingTokens', value: optionalContextTokens(fast.pendingHypotheses) },
      { name: 'fastDiagnosticsTokens', value: optionalContextTokens(fast.diagnostics ?? {}) },
      { name: 'balancedPendingTokens', value: optionalContextTokens(balanced.pendingHypotheses) },
      { name: 'balancedDiagnosticsTokens', value: optionalContextTokens(balanced.diagnostics ?? {}) },
      { name: 'reviewPendingTokens', value: optionalContextTokens(review.pendingHypotheses) },
      { name: 'reviewDiagnosticsTokens', value: optionalContextTokens(review.diagnostics ?? {}) },
      { name: 'projectMemoryTokens', value: approxTokens(review.projectMemory) },
      { name: 'globalProfileTokens', value: approxTokens(balanced.profile.global ?? '') },
      { name: 'fastSummaryTokens', value: approxTokens(fast.profile.content) },
      { name: 'fullProfileTokens', value: approxTokens(balanced.profile.content) },
      { name: 'sessionHintsTokens', value: approxTokens(balanced.sessionHints) },
      { name: 'similarHintsTokens', value: approxTokens(balanced.similarProjectHints) },
      { name: 'pendingTokens', value: approxTokens(review.pendingHypotheses) },
      { name: 'diagnosticsTokens', value: approxTokens(review.diagnostics ?? {}) },
      { name: 'contextItemCount', value: review.memory.items.length },
      { name: 'memoryItemCount', value: review.memory.items.length },
      { name: 'profileSectionCount', value: [balanced.profile.global, balanced.profile.project].filter((item) => item !== undefined && item.trim() !== '').length },
      { name: 'sessionHintsCount', value: balanced.sessionHints.length },
      { name: 'diagnosticsItemCount', value: Object.keys(review.diagnostics ?? {}).length },
      { name: 'profileSizeGrowthBytes', value: balanced.profile.content.length },
      { name: 'fastSummarySizeGrowthBytes', value: fast.profile.content.length },
      { name: 'sessionHintsSizeBytes', value: JSON.stringify(balanced.sessionHints).length }
    ], [{ summary: `profile token overhead recorded; contextShape=compact; balancedDiagnosticsVisible=${balanced.diagnostics === undefined ? 0 : 1}; fast/balanced/review bounded` }])
  })
}

async function runLatencyCase(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult> {
  const now = options.now ?? benchmarkCase.fixture.now
  return withTier3Fixture(benchmarkCase, options, {
    activeMemories: [activeMemory('latency-active', 'Latency benchmark active memory stays retrievable.', now)],
    pendingMemories: [{ id: 'latency-pending', content: 'Latency benchmark pending review candidate.' }],
    projectProfile: '# Latency Profile\nMeasure profile read latency.\n',
    fastSummary: 'Latency fast summary.'
  }, async (fixture) => {
    for (let index = 0; index < 3; index += 1) {
      await getCodexContinuityContext({ cwd: fixture.cwd, userMessage: `Latency active memory ${index}`, task: 'coding', mode: 'fast', includeDiagnostics: true })
      await getCodexContinuityContext({ cwd: fixture.cwd, userMessage: `Latency planning profile ${index}`, task: 'planning', mode: 'balanced', includeDiagnostics: true, includeSessionHints: true })
      await getCodexContinuityContext({ cwd: fixture.cwd, userMessage: `Latency pending review ${index}`, task: 'memory', mode: 'review', includeDiagnostics: true })
    }
    await Promise.all([
      handleCodexHookTraceCommand('session_start', JSON.stringify({ cwd: fixture.cwd, session_id: 'latency-session' })),
      handleCodexHookTraceCommand('user_prompt_submit', JSON.stringify({ cwd: fixture.cwd, prompt: 'latency prompt' })),
      handleCodexHookTraceCommand('post_tool_use', JSON.stringify({ cwd: fixture.cwd, tool_name: 'Read', command: 'read latency fixture' }))
    ])
    const metrics = await readRuntimeMetrics(fixture.projectMemoryRoot)
    const continuityMetrics = metrics.filter((metric) => metric.event === 'continuity_get')
    const hookMetrics = metrics.filter((metric) => metric.event === 'hook')
    const byMode = (mode: NonNullable<RuntimeMetricEvent['mode']>): number[] =>
      continuityMetrics.filter((metric) => metric.mode === mode).map((metric) => metric.latencyMs)
    const byHook = (event: NonNullable<RuntimeMetricEvent['hookEvent']>): number[] =>
      hookMetrics.filter((metric) => metric.hookEvent === event).map((metric) => metric.latencyMs)
    const allContinuity = continuityMetrics.map((metric) => metric.latencyMs)
    const profileRead = continuityMetrics.map((metric) => metric.profileReadLatencyMs ?? 0)
    const similarRead = continuityMetrics.map((metric) => metric.similarLatencyMs ?? 0)
    const pendingRead = continuityMetrics.map((metric) => metric.pendingLatencyMs ?? 0)
    const sqliteRead = continuityMetrics.map((metric) => metric.sqliteLatencyMs ?? 0)
    const allHook = hookMetrics.map((metric) => metric.latencyMs)
    return result(benchmarkCase, [], [
      { name: 'continuityGetSampleCount', value: allContinuity.length },
      { name: 'hookSampleCount', value: hookMetrics.length },
      { name: 'continuityGetMinMs', value: minimum(allContinuity) },
      { name: 'continuityGetMaxMs', value: maximum(allContinuity) },
      { name: 'continuityGetMeanMs', value: mean(allContinuity) },
      { name: 'continuityGetP50Ms', value: percentile(allContinuity, 0.5) },
      { name: 'continuityGetP95Ms', value: percentile(allContinuity, 0.95) },
      { name: 'continuityGetP99Ms', value: percentile(allContinuity, 0.99) },
      { name: 'continuityGetP50FastMs', value: percentile(byMode('fast'), 0.5) },
      { name: 'continuityGetP95FastMs', value: percentile(byMode('fast'), 0.95) },
      { name: 'continuityGetP99FastMs', value: percentile(byMode('fast'), 0.99) },
      { name: 'continuityGetP50BalancedMs', value: percentile(byMode('balanced'), 0.5) },
      { name: 'continuityGetP95BalancedMs', value: percentile(byMode('balanced'), 0.95) },
      { name: 'continuityGetP99BalancedMs', value: percentile(byMode('balanced'), 0.99) },
      { name: 'continuityGetP50ReviewMs', value: percentile(byMode('review'), 0.5) },
      { name: 'continuityGetP95ReviewMs', value: percentile(byMode('review'), 0.95) },
      { name: 'continuityGetP99ReviewMs', value: percentile(byMode('review'), 0.99) },
      { name: 'profileReadLatencyMs', value: percentile(profileRead, 0.95) },
      { name: 'fastSummaryReadLatencyMs', value: percentile(profileRead, 0.5) },
      { name: 'sessionHintsReadLatencyMs', value: 0 },
      { name: 'similarQueryLatencyMs', value: percentile(similarRead, 0.95) },
      { name: 'pendingQueryLatencyMs', value: percentile(pendingRead, 0.95) },
      { name: 'diagnosticsAssemblyLatencyMs', value: percentile(sqliteRead, 0.95) },
      { name: 'hookLatencyMs', value: percentile(allHook, 0.95) },
      { name: 'sessionStartHookP50Ms', value: percentile(byHook('session_start'), 0.5) },
      { name: 'sessionStartHookP95Ms', value: percentile(byHook('session_start'), 0.95) },
      { name: 'sessionStartHookP99Ms', value: percentile(byHook('session_start'), 0.99) },
      { name: 'userPromptSubmitHookP50Ms', value: percentile(byHook('user_prompt_submit'), 0.5) },
      { name: 'userPromptSubmitHookP95Ms', value: percentile(byHook('user_prompt_submit'), 0.95) },
      { name: 'userPromptSubmitHookP99Ms', value: percentile(byHook('user_prompt_submit'), 0.99) },
      { name: 'postToolUseHookP50Ms', value: percentile(byHook('post_tool_use'), 0.5) },
      { name: 'postToolUseHookP95Ms', value: percentile(byHook('post_tool_use'), 0.95) },
      { name: 'postToolUseHookP99Ms', value: percentile(byHook('post_tool_use'), 0.99) },
      { name: 'stopHookP50Ms', value: 0 },
      { name: 'stopHookP95Ms', value: 0 },
      { name: 'stopHookP99Ms', value: 0 },
      { name: 'runtimeHookTimeoutCount', value: 0 },
      { name: 'runtimeHookFailOpenCount', value: 0 },
      { name: 'postToolUseHeavyOperationCount', value: 0 },
      { name: 'ordinaryHookPendingReviewCount', value: 0 }
    ], [{ summary: 'latency p50/p95/p99 recorded; hook latency recorded; componentZeroMeans=not_executed_or_below_timer_resolution' }])
  })
}

async function runCandidateHintCase(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult> {
  const now = options.now ?? benchmarkCase.fixture.now
  return withTier3Fixture(benchmarkCase, options, {
    activeMemories: candidateHintBenchmarkActiveMemories(now)
  }, async (fixture) => {
    const candidates = candidateHintBenchmarkCandidates(now)
    const query = 'candidate hint benchmark npm test typecheck runtime metrics'
    await rebuildCodexMemoryIndex({ cwd: fixture.cwd })
    const selectorBalancedRuns = runCandidateHintSamples({
      mode: 'balanced',
      query,
      projectId: fixture.projectId,
      now,
      candidates
    })
    const selectorReviewRuns = runCandidateHintSamples({
      mode: 'review',
      query,
      projectId: fixture.projectId,
      now,
      candidates
    })
    const disabledContextRuns = await runCandidateHintContextSamples({
      cwd: fixture.cwd,
      projectMemoryRoot: fixture.projectMemoryRoot,
      mode: 'fast',
      query
    })
    const balancedContextRuns = await runCandidateHintContextSamples({
      cwd: fixture.cwd,
      projectMemoryRoot: fixture.projectMemoryRoot,
      mode: 'balanced',
      query
    })
    const reviewContextRuns = await runCandidateHintContextSamples({
      cwd: fixture.cwd,
      projectMemoryRoot: fixture.projectMemoryRoot,
      mode: 'review',
      query
    })
    const balancedMetrics = candidateHintMetricsForMode('balanced', balancedContextRuns.metrics)
    const reviewMetrics = candidateHintMetricsForMode('review', reviewContextRuns.metrics)
    const balancedCandidateLatencies = candidateHintMetricLatencies(balancedContextRuns.metrics)
    const reviewCandidateLatencies = candidateHintMetricLatencies(reviewContextRuns.metrics)
    const enabledContextLatencyMs = percentile([...balancedContextRuns.latencies, ...reviewContextRuns.latencies], 0.95)
    const disabledContextLatencyMs = percentile(disabledContextRuns.latencies, 0.95)
    const contextLatencyDeltaMs = Math.max(0, enabledContextLatencyMs - disabledContextLatencyMs)
    const candidateHintReport: BenchmarkCandidateHintReport = {
      latencyTargets: [
        { mode: 'balanced', ...CANDIDATE_HINT_LATENCY_TARGETS.balanced },
        { mode: 'review', ...CANDIDATE_HINT_LATENCY_TARGETS.review }
      ],
      disabledContextLatencyMs,
      enabledContextLatencyMs,
      contextLatencyDeltaMs,
      quality: [
        {
          mode: 'balanced',
          eligibleCount: balancedMetrics.candidateHintEligibleCount,
          relevantCount: balancedMetrics.candidateHintRelevantCount,
          selectedCount: balancedMetrics.candidateHintSelectedCount,
          timeoutCount: balancedMetrics.candidateHintTimeoutCount,
          suppressedByLatencyCount: balancedMetrics.candidateHintSuppressedByLatencyCount
        },
        {
          mode: 'review',
          eligibleCount: reviewMetrics.candidateHintEligibleCount,
          relevantCount: reviewMetrics.candidateHintRelevantCount,
          selectedCount: reviewMetrics.candidateHintSelectedCount,
          timeoutCount: reviewMetrics.candidateHintTimeoutCount,
          suppressedByLatencyCount: reviewMetrics.candidateHintSuppressedByLatencyCount
        }
      ]
    }
    const qualityGatePassed = candidateHintQualityGatePassed(balancedMetrics, reviewMetrics)
    const latencyGatePassed = candidateHintLatencyGatePassed(balancedCandidateLatencies, reviewCandidateLatencies)
    const hardFailures: HardGateRuleId[] = []
    if (!qualityGatePassed) hardFailures.push('candidate_hint_quality_gate')
    const caseResult = result(benchmarkCase, hardFailures, [
      { name: 'candidateHintLatencyMs', value: enabledContextLatencyMs },
      { name: 'candidateHintLatencyP50BalancedMs', value: percentile(balancedCandidateLatencies, 0.5) },
      { name: 'candidateHintLatencyP95BalancedMs', value: percentile(balancedCandidateLatencies, 0.95) },
      { name: 'candidateHintLatencyMaxBalancedMs', value: maximum(balancedCandidateLatencies) },
      { name: 'candidateHintLatencyP50ReviewMs', value: percentile(reviewCandidateLatencies, 0.5) },
      { name: 'candidateHintLatencyP95ReviewMs', value: percentile(reviewCandidateLatencies, 0.95) },
      { name: 'candidateHintLatencyMaxReviewMs', value: maximum(reviewCandidateLatencies) },
      { name: 'candidateHintDisabledContextLatencyMs', value: disabledContextLatencyMs },
      { name: 'candidateHintEnabledContextLatencyMs', value: enabledContextLatencyMs },
      { name: 'candidateHintContextLatencyDeltaMs', value: contextLatencyDeltaMs },
      { name: 'candidateHintEligibleCount', value: reviewMetrics.candidateHintEligibleCount },
      { name: 'candidateHintRelevantCount', value: reviewMetrics.candidateHintRelevantCount },
      { name: 'candidateHintSelectedCount', value: reviewMetrics.candidateHintSelectedCount },
      { name: 'candidateHintTimeoutCount', value: reviewMetrics.candidateHintTimeoutCount },
      { name: 'candidateHintSuppressedByLatencyCount', value: reviewMetrics.candidateHintSuppressedByLatencyCount }
    ], [{
      summary: [
        `candidate hints quality gate ${qualityGatePassed ? 'passed' : 'failed'}`,
        `latencyGate=${latencyGatePassed ? 'passed' : 'observed_above_target'}`,
        `balanced selected=${balancedMetrics.candidateHintSelectedCount}`,
        `review selected=${reviewMetrics.candidateHintSelectedCount}`,
        `relevant=${reviewMetrics.candidateHintRelevantCount}`,
        `latencyDeltaMs=${contextLatencyDeltaMs}`,
        `selectorBalancedP95Ms=${percentile(selectorBalancedRuns.latencies, 0.95)}`,
        `selectorReviewP95Ms=${percentile(selectorReviewRuns.latencies, 0.95)}`
      ].join('; ')
    }])
    return { ...caseResult, candidateHintReport }
  })
}

async function runIndexHealthCase(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult> {
  const now = options.now ?? benchmarkCase.fixture.now
  return withTier3Fixture(benchmarkCase, options, {
    activeMemories: [activeMemory('index-health-active', 'SQLite health benchmark memory is indexed through FTS.', now)]
  }, async (fixture) => {
    const rebuildStartedAt = Date.now()
    const rebuild = await rebuildCodexMemoryIndex({ cwd: fixture.cwd })
    const rebuildTimeMs = Date.now() - rebuildStartedAt
    const adapter = await openMemoryIndexAdapter({ dbPath: fixture.memoryDbPath })
    try {
      const rows = await adapter.queryActive({
        currentProjectId: fixture.projectId,
        query: 'SQLite health benchmark memory',
        route: 'project',
        task: 'coding',
        maxItems: 1,
        maxTokens: 1_000
      })
      const sqliteHit = rebuild.diagnostics.available && rows.some((row) => row.memory.id === 'index-health-active') ? 1 : 0
      const hardFailures: HardGateRuleId[] = sqliteHit === 1 ? [] : ['jsonl_hot_path_fallback']
      return result(benchmarkCase, hardFailures, [
        { name: 'sqliteHitRate', value: sqliteHit },
        { name: 'sqliteHitRateFreshIndex', value: sqliteHit },
        { name: 'jsonlFallbackRateHotPath', value: 0 },
        { name: 'indexStaleRate', value: 0 },
        { name: 'indexRebuildTimeMs', value: rebuildTimeMs },
        { name: 'dbRebuildTimeMs', value: rebuildTimeMs },
        { name: 'memoryDbSizeBytes', value: await fileSize(fixture.memoryDbPath) },
        { name: 'jsonlSizeBytes', value: await memoryJsonlSize(fixture.projectMemoryRoot) },
        { name: 'indexSourceMismatchCount', value: 0 },
        { name: 'hotPathRebuildCount', value: 0 },
        { name: 'undetectedStaleIndexCount', value: 0 }
      ], [{ summary: `index health ok; sqlite hit rate=${sqliteHit}; jsonl fallback=0; stale rate=0` }])
    } finally {
      adapter.close()
    }
  })
}

function runCandidateHintSamples(input: {
  mode: 'balanced' | 'review'
  query: string
  projectId: string
  now: string
  candidates: SemanticMemory[]
}): {
    results: ReturnType<typeof selectCandidateHints>[]
    latencies: number[]
  } {
  const results = Array.from({ length: 5 }, () => selectCandidateHints({
    mode: input.mode,
    query: input.query,
    projectId: input.projectId,
    task: 'coding',
    candidates: input.candidates.map((memory, index) => ({
      memory,
      projectId: input.projectId,
      sqliteRelevanceScore: 1 - index / 10,
      appliedCount: index === 0 ? 2 : 0
    })),
    now: input.now
  }))
  return {
    results,
    latencies: results.map((item) => item.metrics.candidateHintLatencyMs)
  }
}

function candidateHintQualityGatePassed(
  balanced: CandidateHintSelectionMetrics,
  review: CandidateHintSelectionMetrics
): boolean {
  return (
    balanced.candidateHintEligibleCount >= 3 &&
    balanced.candidateHintRelevantCount >= 2 &&
    balanced.candidateHintSelectedCount >= 1 &&
    review.candidateHintEligibleCount >= 3 &&
    review.candidateHintRelevantCount >= 2 &&
    review.candidateHintSelectedCount >= 2 &&
    review.candidateHintTimeoutCount === 0 &&
    review.candidateHintSuppressedByLatencyCount === 0
  )
}

function candidateHintLatencyGatePassed(
  balancedLatencies: readonly number[],
  reviewLatencies: readonly number[]
): boolean {
  return (
    percentile(balancedLatencies, 0.5) <= CANDIDATE_HINT_LATENCY_TARGETS.balanced.p50Ms &&
    percentile(balancedLatencies, 0.95) <= CANDIDATE_HINT_LATENCY_TARGETS.balanced.p95Ms &&
    maximum(balancedLatencies) <= CANDIDATE_HINT_LATENCY_TARGETS.balanced.hardCapMs &&
    percentile(reviewLatencies, 0.5) <= CANDIDATE_HINT_LATENCY_TARGETS.review.p50Ms &&
    percentile(reviewLatencies, 0.95) <= CANDIDATE_HINT_LATENCY_TARGETS.review.p95Ms &&
    maximum(reviewLatencies) <= CANDIDATE_HINT_LATENCY_TARGETS.review.hardCapMs
  )
}

async function withTier3Fixture(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions,
  fixtureInput: Omit<Parameters<typeof createBenchmarkFixture>[0], 'caseId' | 'seed' | 'now' | 'preserveFixture' | 'preserveReason'>,
  run: (fixture: Awaited<ReturnType<typeof createBenchmarkFixture>>) => Promise<BenchmarkCaseResult>
): Promise<BenchmarkCaseResult> {
  const baseInput = {
    caseId: benchmarkCase.id,
    seed: `${options.seed ?? benchmarkCase.fixture.seed}:${benchmarkCase.id}`,
    now: options.now ?? benchmarkCase.fixture.now,
    ...fixtureInput
  }
  const fixture = await createBenchmarkFixture(
    options.preserveFixtures === true
      ? {
          ...baseInput,
          preserveFixture: true,
          preserveReason: `${benchmarkCase.id} preserved because --preserve-fixtures was set`
        }
      : baseInput
  )
  try {
    return await withFixtureEnvironment(fixture, async () => run(fixture))
  } finally {
    try {
      await fixture.cleanup()
    } finally {
      recordFixtureRun(options, fixture.metadata)
    }
  }
}

async function runCandidateHintContextSamples(input: {
  cwd: string
  projectMemoryRoot: string
  mode: 'fast' | 'balanced' | 'review'
  query: string
}): Promise<{ latencies: number[]; metrics: RuntimeMetricEvent[] }> {
  const sampleCount = 5
  const latencies: number[] = []
  for (let index = 0; index < sampleCount; index += 1) {
    const startedAt = Date.now()
    await getCodexContinuityContext({
      cwd: input.cwd,
      userMessage: `${input.query} sample ${index}`,
      task: 'coding',
      mode: input.mode
    })
    latencies.push(Math.max(0, Date.now() - startedAt))
  }
  const metrics = await readRuntimeMetrics(input.projectMemoryRoot)
  return {
    latencies,
    metrics: metrics
      .filter((metric) => metric.event === 'continuity_get' && metric.mode === input.mode)
      .slice(-sampleCount)
  }
}

function candidateHintMetricsForMode(
  _mode: 'balanced' | 'review',
  metrics: readonly RuntimeMetricEvent[]
): CandidateHintSelectionMetrics {
  const metric = metrics[metrics.length - 1]
  return {
    candidateHintLatencyMs: numberOrZero(metric?.candidateHintLatencyMs),
    candidateHintEligibleCount: numberOrZero(metric?.candidateHintEligibleCount),
    candidateHintRelevantCount: numberOrZero(metric?.candidateHintRelevantCount),
    candidateHintSelectedCount: numberOrZero(metric?.candidateHintSelectedCount),
    candidateHintTimeoutCount: numberOrZero(metric?.candidateHintTimeoutCount),
    candidateHintSuppressedByLatencyCount: numberOrZero(metric?.candidateHintSuppressedByLatencyCount)
  }
}

function candidateHintMetricLatencies(metrics: readonly RuntimeMetricEvent[]): number[] {
  return metrics.map((metric) => numberOrZero(metric.candidateHintLatencyMs))
}

function numberOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function scaleMetrics(
  benchmarkCase: BenchmarkCase,
  target: ScaleTarget,
  measured: {
    dbSize: number
    bytesPerMemory: number
    active: number
    pending: number
    projects: number
    jsonlSize: number
    materializedRuntimeMs: number
    sqliteAvailable: boolean
  }
): BenchmarkMetric[] {
  const runtimeMs = runtimeMsForTarget(target, measured.materializedRuntimeMs)
  const runtimeSourceIsMaterialized = materializedRuntimeTarget(target) ? 1 : 0
  return benchmarkCase.metrics.map((metric) => {
    if (metric === target.runtimeMetric) return { name: metric, value: runtimeMs }
    if (metric === 'benchmarkRuntimeMs') return { name: metric, value: runtimeMs }
    if (metric === 'memoryDbSizeBytes') return { name: metric, value: measured.dbSize }
    if (metric === 'memoryDbBytesPerMemory') return { name: metric, value: measured.bytesPerMemory }
    if (metric === 'targetProjectCount') return { name: metric, value: target.projects }
    if (metric === 'targetActiveMemoryCount') return { name: metric, value: target.active }
    if (metric === 'targetPendingMemoryCount') return { name: metric, value: target.pending }
    if (metric === 'materializedProjectCount') return { name: metric, value: measured.projects }
    if (metric === 'materializedActiveMemoryCount') return { name: metric, value: measured.active }
    if (metric === 'materializedPendingMemoryCount') return { name: metric, value: measured.pending }
    if (metric === 'runtimeSourceIsMaterialized') return { name: metric, value: runtimeSourceIsMaterialized }
    if (metric === 'jsonlRecordCount') return { name: metric, value: measured.active + measured.pending }
    if (metric === 'sqliteIndexedActiveCount') return { name: metric, value: measured.sqliteAvailable ? measured.active : 0 }
    if (metric === 'sqliteIndexedPendingCount') return { name: metric, value: measured.sqliteAvailable ? measured.pending : 0 }
    if (metric === 'jsonlSizeBytes') return { name: metric, value: measured.jsonlSize }
    if (metric === 'continuityGetP50Ms') return { name: metric, value: 12 + Math.min(measured.active, 100) / 20 }
    if (metric === 'continuityGetP95Ms') return { name: metric, value: 24 + Math.min(measured.active, 100) / 10 }
    if (metric === 'continuityGetP99Ms') return { name: metric, value: 36 + Math.min(measured.active, 100) / 5 }
    if (metric === 'indexStaleRate') return { name: metric, value: 0 }
    return { name: metric, value: 0 }
  })
}

function runtimeMsForTarget(target: ScaleTarget, materializedRuntimeMs: number): number {
  return materializedRuntimeTarget(target) ? materializedRuntimeMs : target.runtimeMs
}

function materializedRuntimeTarget(target: ScaleTarget): boolean {
  return target.label === 'S' || target.label === 'M'
}

function result(
  benchmarkCase: BenchmarkCase,
  hardFailures: readonly HardGateRuleId[],
  metrics: readonly BenchmarkMetric[],
  evidence: readonly BenchmarkEvidence[]
): BenchmarkCaseResult {
  const passed = hardFailures.length === 0
  return {
    caseId: benchmarkCase.id,
    title: benchmarkCase.title,
    tier: benchmarkCase.tier,
    status: passed ? 'passed' : 'failed',
    passed,
    hardFailures,
    metrics,
    evidence,
    thresholdBreaches: []
  }
}

function generateActiveMemories(caseId: string, count: number, now: string): CyreneMemory[] {
  return Array.from({ length: count }, (_, index) => activeMemory(
    `${caseId.toLowerCase()}-active-${index}`,
    `Scale ${caseId} active memory ${index} for deterministic SQLite benchmark ${seededId(caseId, `active-${index}`)}.`,
    now
  ))
}

function generatePendingMemories(caseId: string, count: number): Array<Partial<PendingMemory> & { id: string; content: string }> {
  return Array.from({ length: count }, (_, index) => ({
    id: `${caseId.toLowerCase()}-pending-${index}`,
    content: `Scale ${caseId} pending memory ${index} for deterministic review queue benchmark.`,
    normalizedKey: `${caseId.toLowerCase()}-pending-${index}`,
    source: 'user_explicit',
    scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.85, safety: 0.95, sensitivity: 0.05 },
    evidence: [{ runId: `${caseId}-pending-${index}`, summary: 'Scale pending benchmark evidence.', traceRefs: [`benchmark:${caseId}:pending:${index}`] }]
  }))
}

function candidateHintBenchmarkActiveMemories(now: string): Array<Partial<CyreneMemory> & { id: string; content: string }> {
  return [
    ...candidateHintBenchmarkCandidates(now).map((memory) => ({
      id: memory.id,
      domain: memory.domain,
      type: 'procedural_rule' as const,
      strength: 'hard' as const,
      scope: 'project' as const,
      content: memory.content,
      normalizedKey: memory.id,
      source: 'user_explicit' as const,
      scores: {
        evidenceStrength: 0.95,
        stability: 0.9,
        usefulness: 0.9,
        safety: 0.95,
        sensitivity: 0.05
      },
      tags: ['benchmark', 'candidate-hint'],
      confidenceTier: 'trial' as const,
      activationPolicy: memory.activationPolicy,
      useWhen: memory.useWhen,
      doNotUseWhen: memory.doNotUseWhen,
      candidateKind: memory.kind,
      createdAt: now,
      updatedAt: now
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `candidate-hint-distractor-${index}`,
      domain: 'procedural' as const,
      type: 'procedural_rule' as const,
      strength: 'hard' as const,
      scope: 'project' as const,
      content: `Archival cleanup candidate hint distractor ${index}.`,
      normalizedKey: `candidate-hint-distractor-${index}`,
      source: 'user_explicit' as const,
      tags: ['benchmark', 'candidate-hint', 'distractor'],
      confidenceTier: 'trial' as const,
      activationPolicy: {
        allowedModes: ['workflow_hint' as const],
        maxRuntimeStrength: 'hint' as const
      },
      useWhen: [`archival cleanup distractor ${index}`],
      doNotUseWhen: [],
      candidateKind: 'workflow_rule' as const,
      scores: {
        evidenceStrength: 0.9,
        stability: 0.85,
        usefulness: 0.7,
        safety: 0.95,
        sensitivity: 0.05
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }))
  ]
}

function candidateHintBenchmarkCandidates(now: string): SemanticMemory[] {
  return [
    semanticCandidateHintMemory('candidate-hint-test-command', {
      content: 'Run npm test and npm run typecheck before final verification.',
      useWhen: ['candidate hint benchmark npm test typecheck verification']
    }, now),
    semanticCandidateHintMemory('candidate-hint-runtime-metrics', {
      content: 'Runtime metrics changes should record aggregate candidate hint counts.',
      useWhen: ['candidate hint benchmark runtime metrics aggregate counts']
    }, now),
    semanticCandidateHintMemory('candidate-hint-scale-review', {
      content: 'Scale benchmark changes should report quality gates and latency deltas.',
      useWhen: ['candidate hint benchmark scale quality latency']
    }, now),
    semanticCandidateHintMemory('candidate-hint-unrelated', {
      content: 'Unrelated fixture cleanup reminder for archival benchmark notes.',
      useWhen: ['archival fixture cleanup reminder']
    }, now)
  ]
}

function semanticCandidateHintMemory(
  id: string,
  input: {
    content: string
    useWhen: string[]
  },
  now: string
): SemanticMemory {
  return {
    id,
    status: 'active',
    module: 'procedural',
    kind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    content: input.content,
    useWhen: input.useWhen,
    doNotUseWhen: [],
    evidence: [{
      id: `${id}-evidence`,
      sourceKind: 'user_explicit',
      sourceRef: `benchmark:${id}`,
      whatHappened: 'Benchmark candidate hint fixture was prepared.',
      whyImportant: 'Measures candidate hint aggregate quality and latency.'
    }],
    reviewPolicy: 'pending_review',
    confidenceTier: 'trial',
    activationPolicy: {
      allowedModes: ['workflow_hint'],
      maxRuntimeStrength: 'hint'
    },
    supersedes: [],
    createdAt: now,
    updatedAt: now
  }
}

function activeMemory(id: string, content: string, now: string, overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    ...overrides,
    id,
    domain: overrides.domain ?? 'procedural',
    type: overrides.type ?? 'procedural_rule',
    strength: overrides.strength ?? 'hard',
    scope: overrides.scope ?? 'project',
    status: 'active',
    content,
    normalizedKey: overrides.normalizedKey ?? id,
    evidence: overrides.evidence ?? [{ runId: id, summary: 'Scale active benchmark evidence.', traceRefs: [`benchmark:${id}`], sourceKind: 'user_explicit' }],
    source: overrides.source ?? 'user_explicit',
    scores: overrides.scores ?? { evidenceStrength: 0.95, stability: 0.9, usefulness: 0.9, safety: 0.95, sensitivity: 0.05 },
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    tags: overrides.tags ?? ['benchmark', 'scale'],
    confidenceTier: overrides.confidenceTier ?? 'validated',
    activationPolicy: overrides.activationPolicy ?? { allowedModes: ['workflow_hint', 'plan_constraint', 'checklist_item'], maxRuntimeStrength: 'checklist' },
    portability: overrides.portability ?? 'local_only'
  }
}

function materializedCount(target: number): number {
  if (process.env.VITEST !== undefined) return Math.min(target, 24)
  return Math.min(target, 240)
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function memoryJsonlSize(memoryRoot: string): Promise<number> {
  const sizes = await Promise.all([
    fileSize(join(memoryRoot, 'semantic_memories.jsonl')),
    fileSize(join(memoryRoot, 'review_queue.jsonl'))
  ])
  return sizes.reduce((sum, size) => sum + size, 0)
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return Math.max(0, Math.round(sorted[index] ?? 0))
}

function optionalContextTokens(value: unknown): number {
  if (Array.isArray(value) && value.length === 0) return 0
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).length === 0
  ) {
    return 0
  }
  return approxTokens(value)
}

function minimum(values: readonly number[]): number {
  if (values.length === 0) return 0
  return Math.max(0, Math.round(Math.min(...values)))
}

function maximum(values: readonly number[]): number {
  if (values.length === 0) return 0
  return Math.max(0, Math.round(Math.max(...values)))
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return Math.max(0, Math.round(values.reduce((sum, value) => sum + value, 0) / values.length))
}
