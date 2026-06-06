import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCyreneBenchmark } from '../benchmark/runner.js'

const tempDirs: string[] = []
const originalHome = process.env.HOME

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function outputDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-benchmark-scale-'))
  tempDirs.push(dir)
  return dir
}

function evidenceText(result: { evidence: ReadonlyArray<{ summary: string }> } | undefined): string {
  return result?.evidence.map((item) => item.summary).join('\n') ?? ''
}

function metricMap(result: { metrics: ReadonlyArray<{ name: string; value: number }> } | undefined): Map<string, number> {
  return new Map(result?.metrics.map((item) => [item.name, item.value]) ?? [])
}

describe('benchmark Tier 3 scale and efficiency cases', () => {
  it('runs scale profile and records ranking, overhead, latency, and index metrics', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'scale',
      outputDir: await outputDir(),
      seed: 'scale-seed',
      now: '2026-06-05T00:00:00.000Z'
    })

    expect(report.passed).toBe(true)
    for (const [caseId, expectedEvidence] of [
      ['T3-S-SCALE', 'target active=50'],
      ['T3-M-SCALE', 'target active=500'],
      ['T3-L-SCALE', 'target active=5000'],
      ['T3-XL-SCALE', 'target active=50000'],
      ['T3-RANKING', 'recallAt3=1'],
      ['T3-TOKEN-OVERHEAD', 'profile token overhead recorded'],
      ['T3-LATENCY', 'latency p50/p95/p99 recorded'],
      ['T3-INDEX-HEALTH', 'sqlite hit rate=1']
    ] as const) {
      const result = report.caseResults.find((item) => item.caseId === caseId)
      expect(result?.status).toBe('passed')
      expect(evidenceText(result)).toContain(expectedEvidence)
      expect(evidenceText(result)).not.toContain('catalog contract executed')
      expect(result?.hardFailures).toEqual([])
    }

    const ranking = report.caseResults.find((item) => item.caseId === 'T3-RANKING')
    expect(ranking?.metrics.map((item) => item.name)).toContain('recallAt3')
    expect(ranking?.metrics.map((item) => item.name)).toContain('recallAt1')
    expect(ranking?.metrics.map((item) => item.name)).toContain('recallAt5')
    expect(ranking?.metrics.map((item) => item.name)).toContain('top1Accuracy')
    expect(ranking?.metrics.find((item) => item.name === 'mrr')?.value).toBe(1)

    const token = metricMap(report.caseResults.find((item) => item.caseId === 'T3-TOKEN-OVERHEAD'))
    for (const metric of [
      'projectMemoryTokens',
      'globalProfileTokens',
      'fastSummaryTokens',
      'fullProfileTokens',
      'sessionHintsTokens',
      'similarHintsTokens',
      'pendingTokens',
      'diagnosticsTokens',
      'contextItemCount',
      'memoryItemCount',
      'profileSectionCount',
      'sessionHintsCount',
      'diagnosticsItemCount'
    ]) {
      expect(token.has(metric)).toBe(true)
    }

    const latency = metricMap(report.caseResults.find((item) => item.caseId === 'T3-LATENCY'))
    for (const metric of [
      'continuityGetP50FastMs',
      'continuityGetP95FastMs',
      'continuityGetP99FastMs',
      'continuityGetP50BalancedMs',
      'continuityGetP95BalancedMs',
      'continuityGetP99BalancedMs',
      'continuityGetP50ReviewMs',
      'continuityGetP95ReviewMs',
      'continuityGetP99ReviewMs',
      'sessionStartHookP50Ms',
      'userPromptSubmitHookP95Ms',
      'postToolUseHookP99Ms',
      'stopHookP50Ms',
      'runtimeHookTimeoutCount',
      'runtimeHookFailOpenCount',
      'postToolUseHeavyOperationCount',
      'ordinaryHookPendingReviewCount'
    ]) {
      expect(latency.has(metric)).toBe(true)
    }

    const index = metricMap(report.caseResults.find((item) => item.caseId === 'T3-INDEX-HEALTH'))
    for (const metric of [
      'sqliteHitRate',
      'jsonlFallbackRateHotPath',
      'indexStaleRate',
      'indexRebuildTimeMs',
      'dbRebuildTimeMs',
      'memoryDbSizeBytes',
      'jsonlSizeBytes',
      'indexSourceMismatchCount',
      'hotPathRebuildCount',
      'undetectedStaleIndexCount'
    ]) {
      expect(index.has(metric)).toBe(true)
    }
  })

  it('uses explicit scale, latency, token, and hook statistic semantics', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'scale',
      outputDir: await outputDir(),
      seed: 'scale-statistic-semantics-seed',
      now: '2026-06-05T00:00:00.000Z'
    })

    const large = report.caseResults.find((item) => item.caseId === 'T3-L-SCALE')
    const extraLarge = report.caseResults.find((item) => item.caseId === 'T3-XL-SCALE')

    for (const result of [large, extraLarge]) {
      const metrics = metricMap(result)
      expect(metrics.get('runtimeSourceIsMaterialized')).toBe(0)
      expect(metrics.get('targetProjectCount')).toBeGreaterThan(metrics.get('materializedProjectCount') ?? 0)
      expect(metrics.get('targetActiveMemoryCount')).toBeGreaterThan(metrics.get('materializedActiveMemoryCount') ?? 0)
      expect(metrics.get('targetPendingMemoryCount')).toBeGreaterThan(metrics.get('materializedPendingMemoryCount') ?? 0)
      expect(metrics.get('jsonlRecordCount')).toBe(
        (metrics.get('materializedActiveMemoryCount') ?? 0) + (metrics.get('materializedPendingMemoryCount') ?? 0)
      )
      expect(metrics.get('sqliteIndexedActiveCount')).toBe(metrics.get('materializedActiveMemoryCount'))
      expect(metrics.get('sqliteIndexedPendingCount')).toBe(metrics.get('materializedPendingMemoryCount'))
      expect(metrics.has('activeMemoryGrowthPerRun')).toBe(false)
      expect(metrics.has('pendingGrowthPerRun')).toBe(false)
      expect(evidenceText(result)).toContain('storageSource=capped-materialized-fixture')
    }

    expect(metricMap(large).get('indexStaleRate')).toBe(0)

    const latency = metricMap(report.caseResults.find((item) => item.caseId === 'T3-LATENCY'))
    expect(latency.get('continuityGetSampleCount')).toBeGreaterThanOrEqual(9)
    expect(latency.get('hookSampleCount')).toBeGreaterThanOrEqual(3)
    expect(latency.get('continuityGetMinMs')).toBeLessThanOrEqual(latency.get('continuityGetMeanMs') ?? Number.POSITIVE_INFINITY)
    expect(latency.get('continuityGetMeanMs')).toBeLessThanOrEqual(latency.get('continuityGetMaxMs') ?? 0)
    expect(latency.get('runtimeHookTimeoutCount')).toBe(0)
    expect(latency.get('runtimeHookFailOpenCount')).toBe(0)
    expect(evidenceText(report.caseResults.find((item) => item.caseId === 'T3-LATENCY'))).toContain('componentZeroMeans=not_executed_or_below_timer_resolution')

    const token = metricMap(report.caseResults.find((item) => item.caseId === 'T3-TOKEN-OVERHEAD'))
    expect(token.get('fastPendingTokens')).toBe(0)
    expect(token.get('fastDiagnosticsTokens')).toBe(0)
    expect(token.get('balancedPendingTokens')).toBe(0)
    expect(token.get('balancedDiagnosticsTokens')).toBe(0)
    expect(token.get('reviewPendingTokens')).toBeGreaterThan(0)
    expect(token.get('reviewDiagnosticsTokens')).toBeGreaterThan(0)
    expect(evidenceText(report.caseResults.find((item) => item.caseId === 'T3-TOKEN-OVERHEAD'))).toContain('contextShape=compact')
    expect(evidenceText(report.caseResults.find((item) => item.caseId === 'T3-TOKEN-OVERHEAD'))).toContain('balancedDiagnosticsVisible=0')
    expect(report.metricAggregation?.continuityGetP95Ms?.sampleCount).toBeGreaterThan(1)
    expect(report.metricAggregation?.continuityGetP95Ms?.strategy).toBe('max')
    expect(report.metrics.efficiency.targetProjectCount).toBe(100)
    expect(report.metrics.capability.targetProjectCount).toBeUndefined()
  })

  it('uses measured materialized runtime for S and M while keeping L and XL synthetic', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'scale',
      outputDir: await outputDir(),
      seed: 'scale-runtime-source-seed',
      now: '2026-06-05T00:00:00.000Z'
    })

    const small = report.caseResults.find((item) => item.caseId === 'T3-S-SCALE')
    const medium = report.caseResults.find((item) => item.caseId === 'T3-M-SCALE')
    const large = report.caseResults.find((item) => item.caseId === 'T3-L-SCALE')
    const extraLarge = report.caseResults.find((item) => item.caseId === 'T3-XL-SCALE')

    expect(evidenceText(small)).toContain('runtimeSource=materialized')
    expect(evidenceText(medium)).toContain('runtimeSource=materialized')
    expect(evidenceText(large)).toContain('runtimeSource=synthetic')
    expect(evidenceText(extraLarge)).toContain('runtimeSource=synthetic')

    const smallMetrics = metricMap(small)
    const mediumMetrics = metricMap(medium)
    const largeMetrics = metricMap(large)
    const extraLargeMetrics = metricMap(extraLarge)

    expect(smallMetrics.get('scaleSRuntimeMs')).toBeGreaterThan(0)
    expect(mediumMetrics.get('scaleMRuntimeMs')).toBeGreaterThan(0)
    expect(smallMetrics.get('scaleSRuntimeMs')).not.toBe(1_200)
    expect(mediumMetrics.get('scaleMRuntimeMs')).not.toBe(7_500)
    expect(largeMetrics.get('scaleLRuntimeMs')).toBe(45_000)
    expect(extraLargeMetrics.get('scaleXLRuntimeMs')).toBe(180_000)
  })
})
