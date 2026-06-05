import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCyreneBenchmark } from '../benchmark/runner.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-benchmark-runner-'))
  tempDirs.push(dir)
  return dir
}

describe('benchmark runner', () => {
  it('runs smoke profile, writes reports, and keeps full catalog visibility', async () => {
    const outputDir = await tempDir()
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'smoke',
      outputDir,
      seed: 'runner-seed',
      now: '2026-06-05T00:00:00.000Z'
    })

    expect(report.profile).toBe('smoke')
    expect(report.summary.totalCases).toBeGreaterThan(report.summary.passed + report.summary.failed)
    expect(report.caseResults.map((item) => item.caseId)).toContain('T0-MODE-FAST')
    expect(report.caseResults.map((item) => item.caseId)).toContain('T1-FACT-EXTRACTION')
    expect(report.failedCases).toEqual([])
    expect(report.fixtureRuns?.length).toBeGreaterThan(0)
    expect(report.fixtureRuns?.every((fixture) => fixture.timezone === 'UTC')).toBe(true)
    expect(report.fixtureRuns?.every((fixture) => fixture.cleanupStatus === 'cleaned')).toBe(true)
    expect(report.spec.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(report.benchmark.caseCatalogHash).toMatch(/^[a-f0-9]{64}$/)

    const json = await readFile(join(outputDir, 'benchmark_report.json'), 'utf8')
    const markdown = await readFile(join(outputDir, 'benchmark_report.md'), 'utf8')
    expect(json).toContain('"profile": "smoke"')
    expect(markdown).toContain('# Cyrene Benchmark Report')
  })

  it('uses the injected clock for deterministic report timestamps', async () => {
    const first = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'smoke',
      outputDir: await tempDir(),
      seed: 'deterministic-seed',
      now: '2026-06-05T00:00:00.000Z'
    })
    const second = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'smoke',
      outputDir: await tempDir(),
      seed: 'deterministic-seed',
      now: '2026-06-05T00:00:00.000Z'
    })

    expect(first.startedAt).toBe('2026-06-05T00:00:00.000Z')
    expect(first.completedAt).toBe('2026-06-05T00:00:00.000Z')
    expect(second.completedAt).toBe(first.completedAt)
    expect(second.runId).toBe(first.runId)
  })

  it('reports external adapter cases as unsupported when provider env is missing', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'external',
      outputDir: await tempDir(),
      seed: 'external-seed',
      now: '2026-06-05T00:00:00.000Z'
    })

    expect(report.passed).toBe(false)
    expect(report.summary.notSupportedWithoutProvider).toBeGreaterThan(0)
    expect(report.summary.skippedWithReason).toBeGreaterThan(0)
    expect(report.failedCases).toEqual([])
    expect(report.caseResults.find((item) => item.caseId === 'T4-SQLITE-UNAVAILABLE')?.status)
      .toBe('not_supported_without_provider')
  })
})
