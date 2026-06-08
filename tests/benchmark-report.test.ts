import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { archiveBenchmarkReports } from '../benchmark/artifacts.js'
import { renderBenchmarkReportMarkdown, writeBenchmarkReports } from '../benchmark/report.js'
import { scoreCaseResult, summarizeBenchmarkResults } from '../benchmark/scorer.js'
import type { BenchmarkCaseResult, BenchmarkReport } from '../benchmark/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-benchmark-report-'))
  tempDirs.push(dir)
  return dir
}

function result(overrides: Partial<BenchmarkCaseResult> = {}): BenchmarkCaseResult {
  return {
    caseId: 'T0-MODE-FAST',
    title: 'fast mode excludes review and similar hot paths',
    tier: 'tier0',
    status: 'passed',
    passed: true,
    hardFailures: [],
    metrics: [{ name: 'fastTokenOverhead', value: 700 }],
    evidence: [{ summary: 'fast mode stayed isolated' }],
    thresholdBreaches: [],
    ...overrides
  }
}

describe('benchmark scorer and report', () => {
  it('marks hard failures as failed and records profile threshold breaches', () => {
    const scored = scoreCaseResult(result({
      hardFailures: ['pending_leakage'],
      metrics: [
        { name: 'fastTokenOverhead', value: 900 },
        { name: 'jsonlFallbackRateHotPath', value: 0 }
      ]
    }), 'gate')

    expect(scored.status).toBe('failed')
    expect(scored.passed).toBe(false)
    expect(scored.thresholdBreaches).toEqual([
      {
        caseId: 'T0-MODE-FAST',
        metric: 'fastTokenOverhead',
        actual: 900,
        threshold: '<= 800',
        severity: 'warning'
      }
    ])
  })

  it('keeps soft threshold breaches from forcing hard failure status', () => {
    const scored = scoreCaseResult(result({
      metrics: [{ name: 'fastTokenOverhead', value: 900 }]
    }), 'gate')

    expect(scored.status).toBe('passed')
    expect(scored.passed).toBe(true)
    expect(scored.thresholdBreaches).toHaveLength(1)
  })

  it('supports relative thresholds and escalates declared pass/fail metric breaches', () => {
    const relativeResult = result({
      metrics: [
        { name: 'noMemoryTaskSuccessRate', value: 0.8 },
        { name: 'withMemoryTaskSuccessRate', value: 0.7 }
      ]
    })

    const warningOnly = scoreCaseResult(relativeResult, 'llm')
    expect(warningOnly.status).toBe('passed')
    expect(warningOnly.passed).toBe(true)
    expect(warningOnly.thresholdBreaches).toEqual([{
      caseId: 'T0-MODE-FAST',
      metric: 'withMemoryTaskSuccessRate',
      actual: 0.7,
      threshold: '>= noMemoryTaskSuccessRate',
      severity: 'warning'
    }])

    const hardFailure = scoreCaseResult(relativeResult, 'llm', ['withMemoryTaskSuccessRate'])
    expect(hardFailure.status).toBe('failed')
    expect(hardFailure.passed).toBe(false)
    expect(hardFailure.thresholdBreaches).toEqual([{
      caseId: 'T0-MODE-FAST',
      metric: 'withMemoryTaskSuccessRate',
      actual: 0.7,
      threshold: '>= noMemoryTaskSuccessRate',
      severity: 'error'
    }])
  })

  it('enforces task utility thresholds for real-replay pass/fail metrics', () => {
    const scored = scoreCaseResult(result({
      caseId: 'T2-REAL-PROJECT-REPLAY',
      tier: 'tier2',
      metrics: [
        { name: 'noMemoryTaskSuccessRate', value: 1 },
        { name: 'withMemoryTaskSuccessRate', value: 0 },
        { name: 'repeatedMistakeReduction', value: 0 },
        { name: 'userCorrectionReduction', value: 0 },
        { name: 'toolCallReduction', value: 0 }
      ]
    }), 'real-replay', [
      'withMemoryTaskSuccessRate',
      'repeatedMistakeReduction',
      'userCorrectionReduction',
      'toolCallReduction'
    ])

    expect(scored.status).toBe('failed')
    expect(scored.passed).toBe(false)
    expect(scored.thresholdBreaches.map((item) => item.metric)).toEqual([
      'withMemoryTaskSuccessRate',
      'repeatedMistakeReduction',
      'userCorrectionReduction',
      'toolCallReduction'
    ])
    expect(scored.thresholdBreaches.every((item) => item.severity === 'error')).toBe(true)
  })

  it('summarizes passed, failed, skipped, and unsupported case results', () => {
    const summary = summarizeBenchmarkResults([
      result({ caseId: 'pass', status: 'passed', passed: true }),
      result({ caseId: 'fail', status: 'failed', passed: false }),
      result({ caseId: 'skip', status: 'skipped_with_reason', passed: false }),
      result({ caseId: 'unsupported', status: 'not_supported_without_provider', passed: false })
    ])

    expect(summary).toEqual({
      totalCases: 4,
      passed: 1,
      failed: 1,
      skippedWithReason: 1,
      notSupportedWithoutProvider: 1
    })
  })

  it('writes JSON and Markdown reports with report metadata', async () => {
    const outputDir = await createTempDir()
    await mkdir(outputDir, { recursive: true })
    const caseResult = result()
    const failedResult = result({
      caseId: 'T0-PENDING-BOUNDARY',
      title: 'pending boundary failure',
      status: 'failed',
      passed: false,
      hardFailures: ['pending_leakage'],
      evidence: [{ summary: 'pending leaked\nwith newline' }]
    })
    const skippedResult = result({
      caseId: 'T3-XL-SCALE',
      title: 'XL scale skipped',
      status: 'skipped_with_reason',
      passed: false,
      skippedReason: 'scale profile not selected'
    })
    const unsupportedResult = result({
      caseId: 'T4-SECURITY-SECRETS',
      title: 'external provider unsupported',
      status: 'not_supported_without_provider',
      passed: false,
      skippedReason: 'external provider not configured'
    })
    const report: BenchmarkReport = {
      runId: 'run-1',
      startedAt: '2026-06-05T00:00:00.000Z',
      completedAt: '2026-06-05T00:00:01.000Z',
      profile: 'smoke',
      spec: {
        path: 'benchmark/fixtures/benchmark-eval-system-design.md',
        title: 'Cyrene Benchmark Eval System Design',
        date: '2026-06-05',
        contentHash: 'spec-hash'
      },
      benchmark: {
        version: '1.0.0',
        thresholdVersion: '2026-06-05',
        caseCatalogHash: 'catalog-hash'
      },
      package: {
        name: 'cyrene-continuity',
        version: '0.1.0'
      },
      git: {
        branch: 'main',
        commit: 'abc123',
        dirty: false,
        trackedChanges: []
      },
      runtime: {
        nodeVersion: process.version,
        npmVersion: '10.0.0',
        platform: process.platform,
        arch: process.arch
      },
      passed: false,
      summary: { totalCases: 4, passed: 1, failed: 1, skippedWithReason: 1, notSupportedWithoutProvider: 1 },
      failedCases: [failedResult],
      caseResults: [caseResult, failedResult, skippedResult, unsupportedResult],
      metrics: {
        capability: { modeAccuracy: 1 },
        boundarySafety: { pendingLeakageRate: 0 },
        efficiency: { fastTokenOverhead: 700 },
        taskUtility: {}
      },
      versionFeatureDelta: {
        note: 'Functional comparison derived from benchmark tier coverage, not a commit-to-commit A/B run.',
        generatedFromTiers: ['tier1_5', 'tier1_6'],
        versions: [{
          version: 'v1.5',
          tier: 'tier1_5',
          functionalFocus: 'Memory lifecycle and review safety',
          capabilityAreas: ['replace / merge / expire lifecycle transitions'],
          caseCount: 1,
          executedCaseCount: 1,
          passed: 1,
          failed: 0,
          skippedWithReason: 0,
          notSupportedWithoutProvider: 0,
          passRate: 1,
          representativeCases: ['T15-REPLACE'],
          keyMetrics: { replacementAccuracy: 1 }
        }, {
          version: 'v1.6',
          tier: 'tier1_6',
          functionalFocus: 'Memory proposal, routing, review, and relation-model safety',
          capabilityAreas: ['important / noise / sensitive proposal filtering'],
          caseCount: 1,
          executedCaseCount: 1,
          passed: 1,
          failed: 0,
          skippedWithReason: 0,
          notSupportedWithoutProvider: 0,
          passRate: 1,
          representativeCases: ['T16-PROPOSE-IMPORTANT'],
          keyMetrics: { proposalPrecision: 1 }
        }],
        functionalDifferences: [{
          area: 'Memory admission',
          v1_5: 'Validates controlled promotion from pending/trial memory into active memory.',
          v1_6: 'Adds proposal filtering so important evidence is proposed while noise, sensitive content, and assistant-only inference are blocked.'
        }]
      },
      hardFailures: ['pending_leakage'],
      thresholdBreaches: [{
        caseId: 'T0-MODE-FAST',
        metric: 'fastTokenOverhead',
        actual: 900,
        threshold: '<= 800',
        severity: 'warning'
      }],
      fixtureRuns: [{
        root: '/tmp/fixture-a',
        home: '/tmp/fixture-a/home',
        cwd: '/tmp/fixture-a/project',
        seed: 'seed-a',
        clock: '2026-06-05T00:00:00.000Z',
        timezone: 'UTC',
        cleanupStatus: 'preserved',
        preserveFixture: true,
        preserveReason: 'debug failing fixture'
      }],
      scaleResults: {
        S: {
          caseId: 'T3-S-SCALE',
          status: 'passed',
          passed: true,
          runtimeSource: 'materialized',
          storageSource: 'full-target-materialized-fixture',
          runtimeMs: 100,
          targetProjectCount: 1,
          targetActiveMemoryCount: 50,
          targetPendingMemoryCount: 10,
          materializedProjectCount: 1,
          materializedActiveMemoryCount: 50,
          materializedPendingMemoryCount: 10,
          sqliteIndexedActiveCount: 50,
          sqliteIndexedPendingCount: 10,
          jsonlRecordCount: 60,
          jsonlSizeBytes: 1000,
          memoryDbSizeBytes: 2000,
          memoryDbBytesPerMemory: 34,
          hardFailures: []
        }
      },
      regressionComparison: { regressions: [] }
    }

    const paths = await writeBenchmarkReports(outputDir, report)

    const payload = JSON.parse(await readFile(paths.jsonPath, 'utf8')) as BenchmarkReport
    expect(payload.profile).toBe('smoke')
    expect(payload.spec).toEqual({
      path: 'benchmark/fixtures/benchmark-eval-system-design.md',
      title: 'Cyrene Benchmark Eval System Design',
      date: '2026-06-05',
      contentHash: 'spec-hash'
    })
    expect(payload.benchmark).toEqual({
      version: '1.0.0',
      thresholdVersion: '2026-06-05',
      caseCatalogHash: 'catalog-hash'
    })
    expect(payload.package).toEqual({
      name: 'cyrene-continuity',
      version: '0.1.0'
    })
    expect(payload.git).toEqual({
      branch: 'main',
      commit: 'abc123',
      dirty: false,
      trackedChanges: []
    })
    expect(payload.runtime).toEqual({
      nodeVersion: process.version,
      npmVersion: '10.0.0',
      platform: process.platform,
      arch: process.arch
    })
    expect(payload.completedAt).toBe('2026-06-05T00:00:01.000Z')
    expect(payload.summary).toEqual({ totalCases: 4, passed: 1, failed: 1, skippedWithReason: 1, notSupportedWithoutProvider: 1 })
    expect(payload.failedCases.map((item) => item.caseId)).toEqual(['T0-PENDING-BOUNDARY'])
    expect(payload.caseResults).toEqual([
      expect.objectContaining({
        caseId: 'T0-MODE-FAST',
        status: 'passed',
        passed: true,
        evidence: [{ summary: 'fast mode stayed isolated' }]
      }),
      expect.objectContaining({
        caseId: 'T0-PENDING-BOUNDARY',
        status: 'failed',
        passed: false,
        evidence: [{ summary: 'pending leaked\nwith newline' }]
      }),
      expect.objectContaining({
        caseId: 'T3-XL-SCALE',
        status: 'skipped_with_reason',
        passed: false,
        skippedReason: 'scale profile not selected'
      }),
      expect.objectContaining({
        caseId: 'T4-SECURITY-SECRETS',
        status: 'not_supported_without_provider',
        passed: false,
        skippedReason: 'external provider not configured'
      })
    ])
    expect('skippedReason' in payload.caseResults[0]).toBe(false)
    expect('skippedReason' in payload.caseResults[1]).toBe(false)
    expect(payload.metrics).toEqual({
      capability: { modeAccuracy: 1 },
      boundarySafety: { pendingLeakageRate: 0 },
      efficiency: { fastTokenOverhead: 700 },
      taskUtility: {}
    })
    expect(payload.versionFeatureDelta?.versions.map((item) => item.version)).toEqual(['v1.5', 'v1.6'])
    expect(payload.scaleResults?.S).toEqual(expect.objectContaining({
      caseId: 'T3-S-SCALE',
      passed: true,
      runtimeSource: 'materialized',
      targetActiveMemoryCount: 50
    }))
    expect(payload.regressionComparison).toEqual({ regressions: [] })
    expect(payload.hardFailures).toEqual(['pending_leakage'])
    expect(payload.thresholdBreaches).toEqual([{
      caseId: 'T0-MODE-FAST',
      metric: 'fastTokenOverhead',
      actual: 900,
      threshold: '<= 800',
      severity: 'warning'
    }])
    expect(payload.fixtureRuns).toEqual([{
      root: '/tmp/fixture-a',
      home: '/tmp/fixture-a/home',
      cwd: '/tmp/fixture-a/project',
      seed: 'seed-a',
      clock: '2026-06-05T00:00:00.000Z',
      timezone: 'UTC',
      cleanupStatus: 'preserved',
      preserveFixture: true,
      preserveReason: 'debug failing fixture'
    }])

    const markdown = await readFile(paths.markdownPath, 'utf8')
    expect(markdown).toContain('# Cyrene Benchmark Report')
    expect(markdown).toContain('## Failed Cases')
    expect(markdown).toContain('## Skipped Cases')
    expect(markdown).toContain('## Unsupported Cases')
    expect(markdown).toContain('## Capability Metrics')
    expect(markdown).toContain('## Boundary Safety Metrics')
    expect(markdown).toContain('## Efficiency Metrics')
    expect(markdown).toContain('## Task Utility Metrics')
    expect(markdown).toContain('## V1.5 vs V1.6 Functional Delta')
    expect(markdown).toContain('## Case Metric Details')
    expect(markdown).toContain('## Scale Results')
    expect(markdown).toContain('## Regression Comparison')
    expect(markdown).toContain('## Fixture Runs')
    expect(markdown).toContain('## Spec')
    expect(markdown).toContain('## Benchmark')
    expect(markdown).toContain('## Package')
    expect(markdown).toContain('## Git')
    expect(markdown).toContain('## Runtime')
    expect(markdown).toContain('T0-MODE-FAST')
    expect(markdown).toContain('T0-PENDING-BOUNDARY')
    expect(markdown).toContain('T3-XL-SCALE: scale profile not selected')
    expect(markdown).toContain('T4-SECURITY-SECRETS: external provider not configured')
    expect(markdown).toContain('pending_leakage')
    expect(markdown).toContain('WARNING T0-MODE-FAST fastTokenOverhead: 900 (<= 800)')
    expect(markdown).toContain('- T0-MODE-FAST')
    expect(markdown).toContain('fastTokenOverhead: 700')
    expect(markdown).toContain('v1.5 (tier1_5): focus=Memory lifecycle and review safety')
    expect(markdown).toContain('| Memory admission | Validates controlled promotion from pending/trial memory into active memory.')
    expect(markdown).toContain('fast mode stayed isolated')
    expect(markdown).toContain('pending leaked with newline')
    expect(markdown).toContain('/tmp/fixture-a')
    expect(markdown).toContain('cleanup=preserved')
    expect(markdown).toContain('seed=seed-a')
    expect(markdown).toContain('timezone=UTC')
    expect(markdown).toContain('reason=debug failing fixture')
    expect(markdown).toContain('spec-hash')
    expect(markdown).toContain('2026-06-05')
    expect(markdown).toContain('10.0.0')
  })

  it('marks the version feature delta as not evaluated when the profile skipped both version tiers', () => {
    const report: BenchmarkReport = {
      runId: 'run-real-replay',
      startedAt: '2026-06-05T00:00:00.000Z',
      completedAt: '2026-06-05T00:00:01.000Z',
      profile: 'real-replay',
      spec: {
        path: 'benchmark/fixtures/benchmark-eval-system-design.md',
        title: 'Cyrene Benchmark Eval System Design',
        date: '2026-06-05',
        contentHash: 'spec-hash'
      },
      benchmark: {
        version: '1.0.0',
        thresholdVersion: '2026-06-05',
        caseCatalogHash: 'catalog-hash'
      },
      package: {
        name: 'cyrene-continuity',
        version: '0.1.0'
      },
      git: {
        branch: 'main',
        commit: 'abc123',
        dirty: false,
        trackedChanges: []
      },
      runtime: {
        nodeVersion: process.version,
        npmVersion: '10.0.0',
        platform: process.platform,
        arch: process.arch
      },
      passed: true,
      summary: { totalCases: 2, passed: 0, failed: 0, skippedWithReason: 2, notSupportedWithoutProvider: 0 },
      failedCases: [],
      caseResults: [],
      metrics: {
        capability: {},
        boundarySafety: {},
        efficiency: {},
        taskUtility: {}
      },
      versionFeatureDelta: {
        note: 'Functional comparison derived from benchmark tier coverage, not a commit-to-commit A/B run.',
        generatedFromTiers: ['tier1_5', 'tier1_6'],
        versions: [{
          version: 'v1.5',
          tier: 'tier1_5',
          functionalFocus: 'Memory lifecycle and review safety',
          capabilityAreas: [],
          caseCount: 8,
          executedCaseCount: 0,
          passed: 0,
          failed: 0,
          skippedWithReason: 8,
          notSupportedWithoutProvider: 0,
          passRate: null,
          representativeCases: [],
          keyMetrics: {}
        }, {
          version: 'v1.6',
          tier: 'tier1_6',
          functionalFocus: 'Memory proposal, routing, review, and relation-model safety',
          capabilityAreas: [],
          caseCount: 17,
          executedCaseCount: 0,
          passed: 0,
          failed: 0,
          skippedWithReason: 17,
          notSupportedWithoutProvider: 0,
          passRate: null,
          representativeCases: [],
          keyMetrics: {}
        }],
        functionalDifferences: [{
          area: 'Memory admission',
          v1_5: 'v1.5 text',
          v1_6: 'v1.6 text'
        }]
      },
      hardFailures: [],
      thresholdBreaches: []
    }

    const markdown = renderBenchmarkReportMarkdown(report)

    expect(markdown).toContain('v1.5/v1.6 functional delta was not evaluated by profile real-replay')
    expect(markdown).toContain('v1.5 (tier1_5): executed=0/8')
    expect(markdown).toContain('v1.6 (tier1_6): executed=0/17')
    expect(markdown).not.toContain('| Area | v1.5 | v1.6 |')
  })

  it('archives only sanitized report artifacts under the profile directory', async () => {
    const outputDir = await createTempDir()
    const artifactRoot = await createTempDir()
    const secretResult = result({
      evidence: [{ summary: 'report mentions provider token sk-test-secret-123' }]
    })
    const report: BenchmarkReport = {
      runId: 'run-archive',
      startedAt: '2026-06-05T00:00:00.000Z',
      completedAt: '2026-06-05T00:00:01.000Z',
      profile: 'smoke',
      spec: {
        path: 'benchmark/fixtures/benchmark-eval-system-design.md',
        title: 'Cyrene Benchmark Eval System Design',
        date: '2026-06-05',
        contentHash: 'spec-hash'
      },
      benchmark: {
        version: '1.0.0',
        thresholdVersion: '2026-06-05',
        caseCatalogHash: 'catalog-hash'
      },
      package: {
        name: 'cyrene-continuity',
        version: '0.1.0'
      },
      git: {
        branch: 'main',
        commit: 'abc123',
        dirty: false,
        trackedChanges: []
      },
      runtime: {
        nodeVersion: process.version,
        npmVersion: '10.0.0',
        platform: process.platform,
        arch: process.arch
      },
      passed: true,
      summary: { totalCases: 1, passed: 1, failed: 0, skippedWithReason: 0, notSupportedWithoutProvider: 0 },
      failedCases: [],
      caseResults: [secretResult],
      metrics: {
        capability: {},
        boundarySafety: {},
        efficiency: {},
        taskUtility: {}
      },
      hardFailures: [],
      thresholdBreaches: [],
      fixtureRuns: [{
        root: '/tmp/cyrene-preserved-fixture',
        home: '/tmp/cyrene-preserved-fixture/home',
        cwd: '/tmp/cyrene-preserved-fixture/project',
        seed: 'seed-a',
        clock: '2026-06-05T00:00:00.000Z',
        timezone: 'UTC',
        cleanupStatus: 'preserved',
        preserveFixture: true,
        preserveReason: 'debug fixture'
      }]
    }
    const paths = await writeBenchmarkReports(outputDir, report)
    await writeFile(join(outputDir, 'preserved-fixture-content.txt'), 'preserved fixture content with sk-test-secret-123', 'utf8')

    const archived = await archiveBenchmarkReports({
      outputDir,
      artifactRoot,
      profile: report.profile
    })

    expect(archived).toEqual({
      jsonPath: join(artifactRoot, 'smoke', 'benchmark_report.json'),
      markdownPath: join(artifactRoot, 'smoke', 'benchmark_report.md')
    })
    expect(archived.jsonPath).not.toBe(paths.jsonPath)
    const archivedJson = await readFile(archived.jsonPath, 'utf8')
    const archivedMarkdown = await readFile(archived.markdownPath, 'utf8')
    expect(archivedJson).toContain('"profile": "smoke"')
    expect(archivedMarkdown).toContain('# Cyrene Benchmark Report')
    expect(archivedJson).not.toContain('sk-test-secret-123')
    expect(archivedMarkdown).not.toContain('sk-test-secret-123')
    expect(archivedJson).not.toContain('preserved fixture content')
    expect(archivedMarkdown).not.toContain('preserved fixture content')
  })
})
