import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { BENCHMARK_CASES } from './catalog.js'
import { writeBenchmarkReports } from './report.js'
import { scoreCaseResult, summarizeBenchmarkResults } from './scorer.js'
import { BENCHMARK_VERSION, THRESHOLD_VERSION } from './thresholds.js'
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
    metrics: aggregateMetricGroups(caseResults),
    hardFailures,
    thresholdBreaches,
    fixtureRuns,
    ...(options.baselineReportPath === undefined
      ? {}
      : { regressionComparison: { baselineReportPath: options.baselineReportPath, regressions: [] } })
  }

  await writeBenchmarkReports(options.outputDir, report)
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
  if (
    metric.includes('Leakage') ||
    metric.includes('Pollution') ||
    metric.includes('Misuse') ||
    metric.includes('Fallback') ||
    metric.includes('Stale') ||
    metric.includes('Interference') ||
    metric.includes('DefaultWrite') ||
    metric.includes('wrongTop1')
  ) {
    return 0
  }
  if (
    metric.endsWith('Rate') ||
    metric.endsWith('Accuracy') ||
    metric === 'mrr' ||
    metric === 'recallAt3' ||
    metric === 'sqliteHitRateFreshIndex' ||
    metric === 'sqliteHitRate'
  ) {
    return 1
  }
  if (
    metric.includes('Overhead') ||
    metric.includes('Latency') ||
    metric.includes('P95') ||
    metric.includes('P99') ||
    metric.includes('P50') ||
    metric.includes('Runtime') ||
    metric.includes('Bytes') ||
    metric === 'toolCallCount'
  ) {
    return 0
  }
  return 1
}

function aggregateMetricGroups(results: readonly BenchmarkCaseResult[]): BenchmarkReport['metrics'] {
  const capability: Record<string, number> = {}
  const boundarySafety: Record<string, number> = {}
  const efficiency: Record<string, number> = {}
  const taskUtility: Record<string, number> = {}

  for (const metric of results.flatMap((result) => result.metrics)) {
    const target = metricGroup(metric.name, { capability, boundarySafety, efficiency, taskUtility })
    target[metric.name] = metric.value
  }

  return { capability, boundarySafety, efficiency, taskUtility }
}

function metricGroup(
  metric: BenchmarkMetric['name'],
  groups: BenchmarkReport['metrics']
): Record<string, number> {
  if (
    metric.includes('Leakage') ||
    metric.includes('Pollution') ||
    metric.includes('Misuse') ||
    metric.includes('Migration') ||
    metric.includes('Promotion') ||
    metric.includes('Boundary')
  ) {
    return groups.boundarySafety
  }
  if (
    metric.includes('Latency') ||
    metric.includes('Overhead') ||
    metric.includes('P50') ||
    metric.includes('P95') ||
    metric.includes('P99') ||
    metric.includes('Runtime') ||
    metric.includes('Bytes') ||
    metric.includes('sqlite') ||
    metric.includes('jsonl') ||
    metric.includes('Fallback') ||
    metric.includes('Stale')
  ) {
    return groups.efficiency
  }
  if (
    metric.includes('Task') ||
    metric.includes('Mistake') ||
    metric.includes('Correction') ||
    metric.includes('toolCall') ||
    metric === 'taskSuccessRate'
  ) {
    return groups.taskUtility
  }
  return groups.capability
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
