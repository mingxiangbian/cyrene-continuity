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
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-benchmark-lifecycle-'))
  tempDirs.push(dir)
  return dir
}

function evidenceText(result: { evidence: ReadonlyArray<{ summary: string }> } | undefined): string {
  return result?.evidence.map((item) => item.summary).join('\n') ?? ''
}

describe('benchmark Tier 1.5 lifecycle cases', () => {
  it('runs lifecycle cases through real memory review and maintenance paths', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'full',
      outputDir: await outputDir(),
      seed: 'lifecycle-real',
      now: '2026-06-05T00:00:00.000Z'
    })

    expect(report.passed).toBe(true)
    for (const [caseId, expectedEvidence] of [
      ['T15-UPGRADE', 'promotion receipt=promote'],
      ['T15-REPLACE', 'active supersede=supersede'],
      ['T15-MERGE', 'deduped=1'],
      ['T15-EXPIRE', 'expired=1'],
      ['T15-SUPERSEDE-HASH', 'stale supersede hash rejected'],
      ['T15-CONFLICT-SINGLE-INJECTION', 'single injection=1']
    ] as const) {
      const result = report.caseResults.find((item) => item.caseId === caseId)
      expect(result?.status).toBe('passed')
      expect(evidenceText(result)).toContain(expectedEvidence)
      expect(evidenceText(result)).not.toContain('catalog contract executed')
      expect(result?.hardFailures).toEqual([])
    }
  }, 20_000)
})
