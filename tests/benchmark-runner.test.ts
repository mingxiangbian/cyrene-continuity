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
    expect(report.fixtureRuns).toEqual([])
    expect(report.spec.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(report.benchmark.caseCatalogHash).toMatch(/^[a-f0-9]{64}$/)

    const json = await readFile(join(outputDir, 'benchmark_report.json'), 'utf8')
    const markdown = await readFile(join(outputDir, 'benchmark_report.md'), 'utf8')
    expect(json).toContain('"profile": "smoke"')
    expect(markdown).toContain('# Cyrene Benchmark Report')
  })
})
