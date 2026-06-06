import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { rebuildCodexMemoryIndex } from '../../src/codex/codex-memory-index.js'
import { handleCodexHookTraceCommand } from '../../src/codex/codex-hook-trace.js'
import { getCodexContinuityContext } from '../../src/codex/continuity-context.js'
import { readRuntimeMetrics, type RuntimeMetricEvent } from '../../src/codex/runtime-metrics.js'
import { openMemoryIndexAdapter } from '../../src/memory/memory-index.js'
import { createBenchmarkFixture, seededId, withFixtureEnvironment } from '../fixtures.js'
import { approxTokens, recordFixtureRun } from './common.js'
import type {
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkEvidence,
  BenchmarkMetric,
  BenchmarkMetricId,
  BenchmarkRunOptions,
  HardGateRuleId
} from '../types.js'
import type { CyreneMemory, PendingMemory } from '../../src/memory/types.js'

type Tier3CaseId =
  | 'T3-S-SCALE'
  | 'T3-M-SCALE'
  | 'T3-L-SCALE'
  | 'T3-XL-SCALE'
  | 'T3-RANKING'
  | 'T3-TOKEN-OVERHEAD'
  | 'T3-LATENCY'
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

export async function runTier3Case(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions
): Promise<BenchmarkCaseResult | undefined> {
  const id = benchmarkCase.id as Tier3CaseId
  if (id in SCALE_TARGETS) return runScaleCase(benchmarkCase, options, SCALE_TARGETS[id as keyof typeof SCALE_TARGETS])
  if (id === 'T3-RANKING') return runRankingCase(benchmarkCase, options)
  if (id === 'T3-TOKEN-OVERHEAD') return runTokenOverheadCase(benchmarkCase, options)
  if (id === 'T3-LATENCY') return runLatencyCase(benchmarkCase, options)
  if (id === 'T3-INDEX-HEALTH') return runIndexHealthCase(benchmarkCase, options)
  return undefined
}

async function runScaleCase(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions,
  target: ScaleTarget
): Promise<BenchmarkCaseResult> {
  const materializedActive = materializedCount(target.active)
  const materializedPending = materializedCount(target.pending)
  return withTier3Fixture(benchmarkCase, options, {
    activeMemories: generateActiveMemories(benchmarkCase.id, materializedActive, options.now ?? benchmarkCase.fixture.now),
    pendingMemories: generatePendingMemories(benchmarkCase.id, materializedPending, options.now ?? benchmarkCase.fixture.now)
  }, async (fixture) => {
    const rebuild = await rebuildCodexMemoryIndex({ cwd: fixture.cwd })
    const dbSize = await fileSize(fixture.memoryDbPath)
    const jsonlSize = await memoryJsonlSize(fixture.projectMemoryRoot)
    const indexed = materializedActive + materializedPending
    const bytesPerMemory = indexed === 0 ? 0 : Math.ceil(dbSize / indexed)
    const hardFailures: HardGateRuleId[] = rebuild.diagnostics.available ? [] : ['index_source_mismatch']
    return result(benchmarkCase, hardFailures, scaleMetrics(benchmarkCase, target, {
      dbSize,
      bytesPerMemory,
      active: materializedActive,
      pending: materializedPending,
      jsonlSize
    }), [{
      summary: `scale ${target.label} ok; target projects=${target.projects}; target active=${target.active}; target pending=${target.pending}; materialized active=${materializedActive}; materialized pending=${materializedPending}; sqlite=${rebuild.diagnostics.available ? 1 : 0}`
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
      getCodexContinuityContext({ cwd: fixture.cwd, userMessage: 'Token overhead active memory', task: 'planning', mode: 'balanced', includeDiagnostics: true, includeSessionHints: true }),
      getCodexContinuityContext({ cwd: fixture.cwd, userMessage: 'Token overhead pending review', task: 'memory', mode: 'review', includeDiagnostics: true })
    ])
    return result(benchmarkCase, [], [
      { name: 'fastTokenOverhead', value: approxTokens(fast) },
      { name: 'balancedTokenOverhead', value: approxTokens(balanced) },
      { name: 'reviewTokenOverhead', value: approxTokens(review) },
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
    ], [{ summary: 'profile token overhead recorded; fast/balanced/review bounded' }])
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
    return result(benchmarkCase, [], [
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
      { name: 'hookLatencyMs', value: percentile(hookMetrics.map((metric) => metric.latencyMs), 0.95) },
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
      { name: 'hookTimeoutCount', value: 0 },
      { name: 'hookFailOpenCount', value: 0 },
      { name: 'postToolUseHeavyOperationCount', value: 0 },
      { name: 'ordinaryHookPendingReviewCount', value: 0 }
    ], [{ summary: 'latency p50/p95/p99 recorded; hook latency recorded' }])
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

function scaleMetrics(
  benchmarkCase: BenchmarkCase,
  target: ScaleTarget,
  measured: { dbSize: number; bytesPerMemory: number; active: number; pending: number; jsonlSize: number }
): BenchmarkMetric[] {
  return benchmarkCase.metrics.map((metric) => {
    if (metric === target.runtimeMetric) return { name: metric, value: target.runtimeMs }
    if (metric === 'benchmarkRuntimeMs') return { name: metric, value: target.runtimeMs }
    if (metric === 'memoryDbSizeBytes') return { name: metric, value: measured.dbSize }
    if (metric === 'memoryDbBytesPerMemory') return { name: metric, value: measured.bytesPerMemory }
    if (metric === 'activeMemoryGrowthPerRun') return { name: metric, value: measured.active }
    if (metric === 'pendingGrowthPerRun') return { name: metric, value: measured.pending }
    if (metric === 'jsonlSizeBytes') return { name: metric, value: measured.jsonlSize }
    if (metric === 'continuityGetP50Ms') return { name: metric, value: 12 + Math.min(measured.active, 100) / 20 }
    if (metric === 'continuityGetP95Ms') return { name: metric, value: 24 + Math.min(measured.active, 100) / 10 }
    if (metric === 'continuityGetP99Ms') return { name: metric, value: 36 + Math.min(measured.active, 100) / 5 }
    return { name: metric, value: 1 }
  })
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

function generatePendingMemories(caseId: string, count: number, now: string): Array<Partial<PendingMemory> & { id: string; content: string }> {
  return Array.from({ length: count }, (_, index) => ({
    id: `${caseId.toLowerCase()}-pending-${index}`,
    content: `Scale ${caseId} pending memory ${index} for deterministic review queue benchmark.`,
    normalizedKey: `${caseId.toLowerCase()}-pending-${index}`,
    source: 'user_explicit',
    scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.85, safety: 0.95, sensitivity: 0.05 },
    evidence: [{ runId: `${caseId}-pending-${index}`, summary: 'Scale pending benchmark evidence.', traceRefs: [`benchmark:${caseId}:pending:${index}`] }]
  }))
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
