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
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-benchmark-real-replay-'))
  tempDirs.push(dir)
  return dir
}

function evidenceText(result: { evidence: ReadonlyArray<{ summary: string }> } | undefined): string {
  return result?.evidence.map((item) => item.summary).join('\n') ?? ''
}

function metricMap(result: { metrics: ReadonlyArray<{ name: string; value: number }> } | undefined): Map<string, number> {
  return new Map(result?.metrics.map((item) => [item.name, item.value]) ?? [])
}

const expectedRealReplayCases = [
  'T2-REAL-PROJECT-REPLAY',
  'T2-REAL-UPDATED-WORKFLOW-REPLAY',
  'T2-REAL-MULTI-FILE-FIX-REPLAY',
  'T2-REAL-DOCS-ONLY-REPLAY'
] as const

describe('benchmark real project replay cases', () => {
  it('runs repo-grounded replay fixtures for real coding utility', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'real-replay',
      outputDir: await outputDir(),
      seed: 'real-replay-seed',
      now: '2026-06-05T00:00:00.000Z'
    })

    expect(report.passed).toBe(true)
    expect(report.profile).toBe('real-replay')
    expect(report.summary).toEqual({
      totalCases: report.summary.totalCases,
      passed: expectedRealReplayCases.length,
      failed: 0,
      skippedWithReason: report.summary.totalCases - expectedRealReplayCases.length,
      notSupportedWithoutProvider: 0
    })
    expect(report.caseResults.filter((item) => item.status === 'passed').map((item) => item.caseId)).toEqual([
      ...expectedRealReplayCases
    ])
    expect(report.fixtureRuns).toHaveLength(expectedRealReplayCases.length)
    expect(report.fixtureRuns?.every((fixture) => fixture.cleanupStatus === 'cleaned')).toBe(true)
    expect(report.fixtureRuns?.every((fixture) => fixture.preserveFixture === false)).toBe(true)
    expect(report.fixtureRuns?.every((fixture) => fixture.timezone === 'UTC')).toBe(true)

    for (const caseId of expectedRealReplayCases) {
      const result = report.caseResults.find((item) => item.caseId === caseId)
      const metrics = metricMap(result)

      expect(result?.status).toBe('passed')
      expect(result?.hardFailures).toEqual([])
      expect(evidenceText(result)).toContain('real project replay ok')
      expect(evidenceText(result)).toContain('fixture files verified')
      expect(evidenceText(result)).not.toContain('catalog contract executed')
      expect(metrics.get('taskSuccessRate')).toBe(1)
      expect(metrics.get('noMemoryTaskSuccessRate')).toBe(0)
      expect(metrics.get('withMemoryTaskSuccessRate')).toBe(1)
      expect(metrics.get('repeatedMistakeReduction')).toBeGreaterThanOrEqual(0.6)
      expect(metrics.get('userCorrectionReduction')).toBeGreaterThanOrEqual(0.6)
      expect(metrics.get('toolCallReduction')).toBeGreaterThan(0)
    }
  }, 20_000)
})
