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
    expect(ranking?.metrics.find((item) => item.name === 'mrr')?.value).toBe(1)
  })
})
