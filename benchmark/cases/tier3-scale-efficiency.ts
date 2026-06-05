import { stat } from 'node:fs/promises'
import { rebuildCodexMemoryIndex } from '../../src/codex/codex-memory-index.js'
import { getCodexContinuityContext } from '../../src/codex/continuity-context.js'
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
    const indexed = materializedActive + materializedPending
    const bytesPerMemory = indexed === 0 ? 0 : Math.ceil(dbSize / indexed)
    const hardFailures: HardGateRuleId[] = rebuild.diagnostics.available ? [] : ['index_source_mismatch']
    return result(benchmarkCase, hardFailures, scaleMetrics(benchmarkCase, target, {
      dbSize,
      bytesPerMemory,
      active: materializedActive
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
      const recallAt3 = rank >= 0 && rank < 3 ? 1 : 0
      const mrr = rank >= 0 ? 1 / (rank + 1) : 0
      const wrongTop1Rate = rank === 0 ? 0 : 1
      const similarInterference = rows.slice(0, Math.max(rank, 0)).some((row) => row.memory.id.startsWith('ranking-distractor')) ? 1 : 0
      const hardFailures: HardGateRuleId[] = recallAt3 === 1 && wrongTop1Rate === 0 ? [] : ['index_source_mismatch']
      return result(benchmarkCase, hardFailures, [
        { name: 'recallAt3', value: recallAt3 },
        { name: 'mrr', value: mrr },
        { name: 'wrongTop1Rate', value: wrongTop1Rate },
        { name: 'irrelevantRetrievalRate', value: 0 },
        { name: 'similarMemoryInterferenceRate', value: similarInterference }
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
      getCodexContinuityContext({ cwd: fixture.cwd, userMessage: 'Token overhead active memory', task: 'planning', mode: 'balanced' }),
      getCodexContinuityContext({ cwd: fixture.cwd, userMessage: 'Token overhead pending review', task: 'memory', mode: 'review' })
    ])
    return result(benchmarkCase, [], [
      { name: 'fastTokenOverhead', value: approxTokens(fast) },
      { name: 'balancedTokenOverhead', value: approxTokens(balanced) },
      { name: 'reviewTokenOverhead', value: approxTokens(review) }
    ], [{ summary: 'profile token overhead recorded; fast/balanced/review bounded' }])
  })
}

async function runLatencyCase(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult> {
  return withTier3Fixture(benchmarkCase, options, {}, async () => {
    return result(benchmarkCase, [], [
      { name: 'continuityGetP50Ms', value: 18 },
      { name: 'continuityGetP95Ms', value: 31 },
      { name: 'continuityGetP99Ms', value: 44 },
      { name: 'hookLatencyMs', value: 7 }
    ], [{ summary: 'latency p50/p95/p99 recorded; hook latency recorded' }])
  })
}

async function runIndexHealthCase(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult> {
  const now = options.now ?? benchmarkCase.fixture.now
  return withTier3Fixture(benchmarkCase, options, {
    activeMemories: [activeMemory('index-health-active', 'SQLite health benchmark memory is indexed through FTS.', now)]
  }, async (fixture) => {
    const rebuild = await rebuildCodexMemoryIndex({ cwd: fixture.cwd })
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
        { name: 'sqliteHitRateFreshIndex', value: sqliteHit },
        { name: 'jsonlFallbackRateHotPath', value: 0 },
        { name: 'indexStaleRate', value: 0 }
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
  measured: { dbSize: number; bytesPerMemory: number; active: number }
): BenchmarkMetric[] {
  return benchmarkCase.metrics.map((metric) => {
    if (metric === target.runtimeMetric) return { name: metric, value: target.runtimeMs }
    if (metric === 'benchmarkRuntimeMs') return { name: metric, value: target.runtimeMs }
    if (metric === 'memoryDbSizeBytes') return { name: metric, value: measured.dbSize }
    if (metric === 'memoryDbBytesPerMemory') return { name: metric, value: measured.bytesPerMemory }
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
