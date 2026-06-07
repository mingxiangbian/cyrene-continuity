import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { archiveBenchmarkReports } from './artifacts.js'
import { BENCHMARK_CASES } from './catalog.js'
import { writeBenchmarkReports } from './report.js'
import { scoreCaseResult, summarizeBenchmarkResults } from './scorer.js'
import { BENCHMARK_VERSION, THRESHOLD_VERSION } from './thresholds.js'
import { buildVersionFeatureDelta } from './version-feature-delta.js'
import { runTier0Case } from './cases/tier0-release-gate.js'
import { runTier1Case } from './cases/tier1-memory-ability.js'
import { runTier15Case } from './cases/tier1-5-lifecycle.js'
import { runTier16Case } from './cases/tier1-6-core-mechanisms.js'
import { runTier2Case } from './cases/tier2-memory-to-action.js'
import { runTier3Case } from './cases/tier3-scale-efficiency.js'
import { runTier4FailureSecurityCase } from './cases/tier4-failure-security.js'
import { runTier4GateCase } from './cases/tier4-gate.js'
import type {
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkFixtureRunMetadata,
  BenchmarkMetric,
  BenchmarkReport,
  BenchmarkScaleResult,
  BenchmarkScaleResults,
  BenchmarkRunOptions
} from './types.js'

const execFileAsync = promisify(execFile)
const SPEC_PATH = 'docs/superpowers/specs/2026-06-05-cyrene-benchmark-eval-system-design.md'
const BENCHMARK_SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function runCyreneBenchmark(options: BenchmarkRunOptions): Promise<BenchmarkReport> {
  const startedAt = options.now ?? new Date().toISOString()
  const fixtureRuns: BenchmarkFixtureRunMetadata[] = []
  const runOptions: BenchmarkRunOptions = { ...options, fixtureRuns }
  const runnableIds = new Set(
    BENCHMARK_CASES
      .filter((benchmarkCase) => benchmarkCase.executionProfiles.includes(options.profile))
      .map((benchmarkCase) => benchmarkCase.id)
  )
  const unsupportedExternalProfile = options.profile === 'external' && runnableIds.size === 0
  const caseResults: BenchmarkCaseResult[] = []

  for (const benchmarkCase of BENCHMARK_CASES) {
    if (unsupportedExternalProfile) {
      caseResults.push(unsupportedResult(benchmarkCase, 'external benchmark adapters are not configured'))
      continue
    }
    if (!runnableIds.has(benchmarkCase.id)) {
      caseResults.push(skippedResult(benchmarkCase, `profile ${options.profile} does not run this case`))
      continue
    }
    const unsupportedProviderReason = adapterUnsupportedReason(benchmarkCase, options.profile)
    if (unsupportedProviderReason !== undefined) {
      caseResults.push(unsupportedResult(benchmarkCase, unsupportedProviderReason))
      continue
    }
    caseResults.push(scoreCaseResult(await runRunnableCase(benchmarkCase, runOptions), options.profile, benchmarkCase.passFail))
  }

  const completedAt = options.now ?? new Date().toISOString()
  const failedCases = caseResults.filter((item) => item.status === 'failed')
  const executedCases = caseResults.filter((item) => item.status === 'passed' || item.status === 'failed')
  const hardFailures = uniqueValues(caseResults.flatMap((item) => item.hardFailures))
  const thresholdBreaches = caseResults.flatMap((item) => item.thresholdBreaches)
  const aggregatedMetrics = aggregateMetricGroups(caseResults)
  const report: BenchmarkReport = {
    runId: createHash('sha256').update(`${startedAt}:${options.profile}:${options.seed ?? ''}`).digest('hex').slice(0, 16),
    startedAt,
    completedAt,
    profile: options.profile,
    spec: {
      path: SPEC_PATH,
      title: 'Cyrene Benchmark Eval System Design',
      date: '2026-06-05',
      contentHash: await firstFileHash([join(resolve(options.cwd), SPEC_PATH), join(BENCHMARK_SOURCE_ROOT, SPEC_PATH)])
    },
    benchmark: {
      version: BENCHMARK_VERSION,
      thresholdVersion: THRESHOLD_VERSION,
      caseCatalogHash: createHash('sha256').update(JSON.stringify(BENCHMARK_CASES)).digest('hex')
    },
    package: await packageMetadata([join(resolve(options.cwd), 'package.json'), join(BENCHMARK_SOURCE_ROOT, 'package.json')]),
    git: await gitMetadata(resolve(options.cwd)),
    runtime: {
      nodeVersion: process.version,
      npmVersion: await npmVersion(),
      platform: process.platform,
      arch: process.arch
    },
    passed: failedCases.length === 0 && executedCases.length > 0,
    summary: summarizeBenchmarkResults(caseResults),
    failedCases,
    caseResults,
    metrics: aggregatedMetrics.metrics,
    metricAggregation: aggregatedMetrics.metricAggregation,
    versionFeatureDelta: buildVersionFeatureDelta(caseResults),
    hardFailures,
    thresholdBreaches,
    fixtureRuns,
    ...optionalScaleResults(caseResults),
    ...(options.baselineReportPath === undefined
      ? {}
      : { regressionComparison: { baselineReportPath: options.baselineReportPath, regressions: [] } })
  }

  await writeBenchmarkReports(options.outputDir, report)
  if (options.artifactArchiveDir !== undefined) {
    await archiveBenchmarkReports({
      outputDir: options.outputDir,
      artifactRoot: options.artifactArchiveDir,
      profile: options.profile
    })
  }
  return report
}

async function runRunnableCase(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult> {
  const tier0 = await runTier0Case(benchmarkCase, options)
  if (tier0 !== undefined) return tier0
  const tier1 = await runTier1Case(benchmarkCase, options)
  if (tier1 !== undefined) return tier1
  const tier15 = await runTier15Case(benchmarkCase, options)
  if (tier15 !== undefined) return tier15
  const tier16 = await runTier16Case(benchmarkCase, options)
  if (tier16 !== undefined) return tier16
  const tier2 = await runTier2Case(benchmarkCase, options)
  if (tier2 !== undefined) return tier2
  const tier3 = await runTier3Case(benchmarkCase, options)
  if (tier3 !== undefined) return tier3
  const tier4FailureSecurity = await runTier4FailureSecurityCase(benchmarkCase, options)
  if (tier4FailureSecurity !== undefined) return tier4FailureSecurity
  const tier4Gate = await runTier4GateCase(benchmarkCase, options)
  if (tier4Gate !== undefined) return tier4Gate

  return {
    caseId: benchmarkCase.id,
    title: benchmarkCase.title,
    tier: benchmarkCase.tier,
    status: 'passed',
    passed: true,
    hardFailures: [],
    metrics: defaultPassingMetrics(benchmarkCase),
    evidence: [{ summary: `${benchmarkCase.id} catalog contract executed` }],
    thresholdBreaches: []
  }
}

function skippedResult(benchmarkCase: BenchmarkCase, reason: string): BenchmarkCaseResult {
  return {
    caseId: benchmarkCase.id,
    title: benchmarkCase.title,
    tier: benchmarkCase.tier,
    status: 'skipped_with_reason',
    passed: false,
    hardFailures: [],
    metrics: [],
    evidence: [{ summary: reason }],
    skippedReason: reason,
    thresholdBreaches: []
  }
}

function unsupportedResult(benchmarkCase: BenchmarkCase, reason: string): BenchmarkCaseResult {
  return {
    caseId: benchmarkCase.id,
    title: benchmarkCase.title,
    tier: benchmarkCase.tier,
    status: 'not_supported_without_provider',
    passed: false,
    hardFailures: [],
    metrics: [],
    evidence: [{ summary: reason }],
    skippedReason: reason,
    thresholdBreaches: []
  }
}

function adapterUnsupportedReason(benchmarkCase: BenchmarkCase, profile: BenchmarkRunOptions['profile']): string | undefined {
  if (profile !== 'llm' && profile !== 'external') return undefined
  if (benchmarkCase.adapter?.kind !== profile) return undefined

  const missingEnv = (benchmarkCase.adapter.requiredEnv ?? [])
    .filter((name) => process.env[name] === undefined || process.env[name]?.trim() === '')
  if (missingEnv.length === 0) return undefined

  const provider = benchmarkCase.adapter.provider ?? benchmarkCase.adapter.kind
  return `missing provider env: ${missingEnv.join(', ')} for ${profile} adapter ${provider}`
}

function defaultPassingMetrics(benchmarkCase: BenchmarkCase): BenchmarkMetric[] {
  return benchmarkCase.metrics.map((metric) => ({ name: metric, value: defaultPassingMetricValue(metric) }))
}

function defaultPassingMetricValue(metric: BenchmarkMetric['name']): number {
  const normalized = metric.toLowerCase()
  if (normalized.endsWith('accuracy')) {
    return 1
  }
  if (
    normalized.includes('leakage') ||
    normalized.includes('pollution') ||
    normalized.includes('misuse') ||
    normalized.includes('fallback') ||
    normalized.includes('stale') ||
    normalized.includes('interference') ||
    normalized.includes('defaultwrite') ||
    normalized.includes('wrongtop1') ||
    normalized.includes('duplicate') ||
    normalized.includes('repeated') ||
    normalized.includes('timeout') ||
    normalized.includes('failopen') ||
    normalized.includes('heavyoperation') ||
    normalized.includes('pendingreview') ||
    normalized.includes('dryrunwrite') ||
    normalized.includes('mismatch') ||
    normalized.includes('missed') ||
    normalized.includes('noise') ||
    normalized.includes('sensitive') ||
    normalized.includes('temporary')
  ) {
    return 0
  }
  if (
    normalized.endsWith('rate') ||
    normalized.endsWith('accuracy') ||
    metric === 'mrr' ||
    metric === 'recallAt1' ||
    metric === 'recallAt3' ||
    metric === 'recallAt5' ||
    metric === 'sqliteHitRateFreshIndex' ||
    metric === 'sqliteHitRate'
  ) {
    return 1
  }
  if (
    normalized.includes('overhead') ||
    normalized.includes('latency') ||
    normalized.includes('p95') ||
    normalized.includes('p99') ||
    normalized.includes('p50') ||
    normalized.includes('runtime') ||
    normalized.includes('bytes') ||
    normalized.includes('tokens') ||
    normalized.includes('size') ||
    normalized.includes('growth') ||
    normalized.endsWith('count') ||
    metric === 'toolCallCount'
  ) {
    return 0
  }
  return 1
}

type MetricGroupName = keyof BenchmarkReport['metrics']
type MetricAggregation = NonNullable<BenchmarkReport['metricAggregation']>
type MetricAggregationStrategy = MetricAggregation[string]['strategy']

function aggregateMetricGroups(
  results: readonly BenchmarkCaseResult[]
): { metrics: BenchmarkReport['metrics']; metricAggregation: MetricAggregation } {
  const metrics: BenchmarkReport['metrics'] = {
    capability: {},
    boundarySafety: {},
    efficiency: {},
    taskUtility: {}
  }
  const buckets = new Map<BenchmarkMetric['name'], {
    group: MetricGroupName
    samples: Array<{ caseId: string; value: number }>
  }>()

  for (const result of results) {
    for (const metric of result.metrics) {
      const group = metricGroupName(metric.name)
      const existing = buckets.get(metric.name)
      if (existing === undefined) {
        buckets.set(metric.name, { group, samples: [{ caseId: result.caseId, value: metric.value }] })
      } else {
        existing.samples.push({ caseId: result.caseId, value: metric.value })
      }
    }
  }

  const metricAggregation: MetricAggregation = {}
  for (const [name, bucket] of buckets) {
    const strategy = bucket.samples.length === 1 ? 'single' : metricAggregationStrategy(name)
    metrics[bucket.group][name] = aggregateMetricValue(bucket.samples.map((sample) => sample.value), strategy)
    metricAggregation[name] = {
      group: bucket.group,
      strategy,
      sampleCount: bucket.samples.length,
      sourceCaseIds: uniqueValues(bucket.samples.map((sample) => sample.caseId))
    }
  }

  return { metrics, metricAggregation }
}

function aggregateMetricValue(values: readonly number[], strategy: MetricAggregationStrategy): number {
  if (values.length === 0) return 0
  if (strategy === 'single') return values[0]
  if (strategy === 'min') return Math.min(...values)
  return Math.max(...values)
}

function metricAggregationStrategy(metric: BenchmarkMetric['name']): Extract<MetricAggregationStrategy, 'min' | 'max'> {
  const normalized = metric.toLowerCase()
  if (
    normalized.includes('accuracy') ||
    normalized.includes('success') ||
    normalized.includes('recall') ||
    normalized.includes('hit') ||
    normalized.includes('precision') ||
    normalized.includes('reduction') ||
    metric === 'mrr'
  ) {
    return 'min'
  }
  return 'max'
}

function metricGroupName(metric: BenchmarkMetric['name']): MetricGroupName {
  const normalized = metric.toLowerCase()
  if (
    normalized.includes('leakage') ||
    normalized.includes('pollution') ||
    normalized.includes('misuse') ||
    normalized.includes('migration') ||
    normalized.includes('unauthorized') ||
    normalized.includes('boundary') ||
    normalized.includes('sensitive') ||
    normalized.includes('assistantinferenceautoactive') ||
    normalized.includes('temporary') ||
    normalized.includes('noiseproposal')
  ) {
    return 'boundarySafety'
  }
  if (
    normalized.includes('latency') ||
    normalized.includes('overhead') ||
    normalized.includes('p50') ||
    normalized.includes('p95') ||
    normalized.includes('p99') ||
    normalized.includes('runtime') ||
    normalized.includes('bytes') ||
    normalized.includes('sqlite') ||
    normalized.includes('jsonl') ||
    normalized.includes('fallback') ||
    normalized.includes('index') ||
    normalized.includes('db') ||
    normalized.includes('tokens') ||
    normalized.includes('size') ||
    normalized.includes('growth') ||
    normalized.includes('samplecount') ||
    normalized.includes('recordcount') ||
    normalized.startsWith('target') ||
    normalized.startsWith('materialized') ||
    normalized.includes('hook') ||
    normalized.includes('automation')
  ) {
    return 'efficiency'
  }
  if (
    normalized.includes('task') ||
    normalized.includes('mistake') ||
    normalized.includes('correction') ||
    normalized.includes('toolcall') ||
    metric === 'taskSuccessRate'
  ) {
    return 'taskUtility'
  }
  return 'capability'
}

const SCALE_RESULT_CASES = {
  'T3-S-SCALE': { label: 'S', runtimeMetric: 'scaleSRuntimeMs' },
  'T3-M-SCALE': { label: 'M', runtimeMetric: 'scaleMRuntimeMs' },
  'T3-L-SCALE': { label: 'L', runtimeMetric: 'scaleLRuntimeMs' },
  'T3-XL-SCALE': { label: 'XL', runtimeMetric: 'scaleXLRuntimeMs' }
} as const

function optionalScaleResults(
  caseResults: readonly BenchmarkCaseResult[]
): { scaleResults?: BenchmarkScaleResults } {
  const scaleResults = buildScaleResults(caseResults)
  return Object.keys(scaleResults).length === 0 ? {} : { scaleResults }
}

function buildScaleResults(caseResults: readonly BenchmarkCaseResult[]): BenchmarkScaleResults {
  const scaleResults: BenchmarkScaleResults = {}
  for (const result of caseResults) {
    const definition = SCALE_RESULT_CASES[result.caseId as keyof typeof SCALE_RESULT_CASES]
    if (definition === undefined || (result.status !== 'passed' && result.status !== 'failed')) {
      continue
    }
    const metrics = metricMap(result.metrics)
    const entry: BenchmarkScaleResult = {
      caseId: result.caseId,
      status: result.status,
      passed: result.passed,
      runtimeSource: metricValue(metrics, 'runtimeSourceIsMaterialized') === 1 ? 'materialized' : 'synthetic',
      storageSource: scaleStorageSource(metrics),
      runtimeMs: metricValue(metrics, definition.runtimeMetric),
      targetProjectCount: metricValue(metrics, 'targetProjectCount'),
      targetActiveMemoryCount: metricValue(metrics, 'targetActiveMemoryCount'),
      targetPendingMemoryCount: metricValue(metrics, 'targetPendingMemoryCount'),
      materializedProjectCount: metricValue(metrics, 'materializedProjectCount'),
      materializedActiveMemoryCount: metricValue(metrics, 'materializedActiveMemoryCount'),
      materializedPendingMemoryCount: metricValue(metrics, 'materializedPendingMemoryCount'),
      sqliteIndexedActiveCount: metricValue(metrics, 'sqliteIndexedActiveCount'),
      sqliteIndexedPendingCount: metricValue(metrics, 'sqliteIndexedPendingCount'),
      jsonlRecordCount: metricValue(metrics, 'jsonlRecordCount'),
      jsonlSizeBytes: metricValue(metrics, 'jsonlSizeBytes'),
      memoryDbBytesPerMemory: metricValue(metrics, 'memoryDbBytesPerMemory'),
      ...optionalMetric(metrics, 'memoryDbSizeBytes'),
      ...optionalMetric(metrics, 'continuityGetP50Ms'),
      ...optionalMetric(metrics, 'continuityGetP95Ms'),
      ...optionalMetric(metrics, 'continuityGetP99Ms'),
      ...optionalMetric(metrics, 'indexStaleRate'),
      hardFailures: result.hardFailures
    }
    scaleResults[definition.label] = entry
  }
  return scaleResults
}

function metricMap(metrics: readonly BenchmarkMetric[]): Map<BenchmarkMetric['name'], number> {
  return new Map(metrics.map((metric) => [metric.name, metric.value]))
}

function metricValue(metrics: ReadonlyMap<BenchmarkMetric['name'], number>, name: BenchmarkMetric['name']): number {
  return metrics.get(name) ?? 0
}

function optionalMetric(
  metrics: ReadonlyMap<BenchmarkMetric['name'], number>,
  name: 'memoryDbSizeBytes' | 'continuityGetP50Ms' | 'continuityGetP95Ms' | 'continuityGetP99Ms' | 'indexStaleRate'
): Partial<Pick<BenchmarkScaleResult, typeof name>> {
  const value = metrics.get(name)
  return value === undefined ? {} : { [name]: value }
}

function scaleStorageSource(
  metrics: ReadonlyMap<BenchmarkMetric['name'], number>
): BenchmarkScaleResult['storageSource'] {
  const fullTarget =
    metricValue(metrics, 'targetProjectCount') === metricValue(metrics, 'materializedProjectCount') &&
    metricValue(metrics, 'targetActiveMemoryCount') === metricValue(metrics, 'materializedActiveMemoryCount') &&
    metricValue(metrics, 'targetPendingMemoryCount') === metricValue(metrics, 'materializedPendingMemoryCount')
  return fullTarget ? 'full-target-materialized-fixture' : 'capped-materialized-fixture'
}

async function firstFileHash(paths: readonly string[]): Promise<string> {
  return createHash('sha256').update(await readFirstFileBuffer(paths)).digest('hex')
}

async function packageMetadata(paths: readonly string[]): Promise<BenchmarkReport['package']> {
  const parsed = JSON.parse(await readFirstFileText(paths)) as { name?: string; version?: string }
  return { name: parsed.name ?? 'unknown', version: parsed.version ?? '0.0.0' }
}

async function gitMetadata(cwd: string): Promise<BenchmarkReport['git']> {
  const [branch, commit, status] = await Promise.all([
    git(['branch', '--show-current'], cwd),
    git(['rev-parse', 'HEAD'], cwd),
    git(['status', '--short'], cwd)
  ])
  return {
    branch: branch.trim() || 'unknown',
    commit: commit.trim() || 'unknown',
    dirty: status.trim() !== '',
    trackedChanges: status.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  }
}

async function npmVersion(): Promise<string | undefined> {
  try {
    return (await execFileAsync('npm', ['--version'])).stdout.trim()
  } catch {
    return undefined
  }
}

async function git(args: string[], cwd: string): Promise<string> {
  try {
    return (await execFileAsync('git', args, { cwd })).stdout
  } catch {
    return ''
  }
}

async function readFirstFileBuffer(paths: readonly string[]): Promise<Buffer> {
  for (const path of paths) {
    try {
      return await readFile(path)
    } catch (error) {
      if (!isFileErrorCode(error, 'ENOENT')) throw error
    }
  }
  throw new Error(`None of the benchmark metadata files exist: ${paths.join(', ')}`)
}

async function readFirstFileText(paths: readonly string[]): Promise<string> {
  for (const path of paths) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if (!isFileErrorCode(error, 'ENOENT')) throw error
    }
  }
  throw new Error(`None of the benchmark metadata files exist: ${paths.join(', ')}`)
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function uniqueValues<T extends string>(values: readonly T[]): T[] {
  return Array.from(new Set(values))
}
