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
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-benchmark-tier0-'))
  tempDirs.push(dir)
  return dir
}

function evidenceText(result: { evidence: ReadonlyArray<{ summary: string }> } | undefined): string {
  return result?.evidence.map((item) => item.summary).join('\n') ?? ''
}

describe('benchmark Tier 0 cases', () => {
  it('runs smoke cases with real assertions instead of catalog-only evidence', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'smoke',
      outputDir: await outputDir(),
      seed: 'smoke-real',
      now: '2026-06-05T00:00:00.000Z'
    })

    const fast = report.caseResults.find((item) => item.caseId === 'T0-MODE-FAST')
    expect(fast?.status).toBe('passed')
    expect(evidenceText(fast)).toContain('mode=fast')
    expect(evidenceText(fast)).not.toContain('catalog contract executed')
    expect(fast?.hardFailures).toEqual([])

    const pending = report.caseResults.find((item) => item.caseId === 'T0-PENDING-BOUNDARY')
    expect(pending?.status).toBe('passed')
    expect(evidenceText(pending)).toContain('pending leakage=0')
    expect(pending?.hardFailures).toEqual([])

    const sqlite = report.caseResults.find((item) => item.caseId === 'T0-SQLITE-HOT-PATH')
    expect(sqlite?.status).toBe('passed')
    expect(evidenceText(sqlite)).toContain('source=sqlite')
    expect(evidenceText(sqlite)).toContain('retrieved=1')
    expect(sqlite?.hardFailures).toEqual([])
  })

  it('runs gate cases for review hash, security, routing, and hooks with real evidence', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'gate',
      outputDir: await outputDir(),
      seed: 'gate-real',
      now: '2026-06-05T00:00:00.000Z'
    })

    expect(report.passed).toBe(true)
    for (const [caseId, expectedEvidence] of [
      ['T16-REVIEW-HASH-REQUIRED', 'review hash required'],
      ['T4-SECURITY-SECRETS', 'secret persistence=0'],
      ['T4-SECURITY-PROMPT-INJECTION', 'prompt injection rejected by propose path'],
      ['T4-SECURITY-GLOBAL-WRITE', 'unauthorized global write=0'],
      ['T4-HOOK-LIGHTWEIGHT', 'hook metric=post_tool_use'],
      ['T4-HOOK-LIGHTWEIGHT', 'continuity metrics=0'],
      ['T0-SIMILAR-BOUNDARY', 'hintVisible=1'],
      ['T0-SESSION-HINTS', 'pending migration=0'],
      ['T16-ROUTING-NAMESPACE', 'namespace routing ok']
    ] as const) {
      const result = report.caseResults.find((item) => item.caseId === caseId)
      expect(result?.status).toBe('passed')
      expect(evidenceText(result)).toContain(expectedEvidence)
      expect(evidenceText(result)).not.toContain('catalog contract executed')
      expect(result?.hardFailures).toEqual([])
    }
  })

  it('checks surface consistency across policy, context-preview, MCP, and skill contracts', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'gate',
      outputDir: await outputDir(),
      seed: 'gate-surface-real',
      now: '2026-06-05T00:00:00.000Z'
    })

    const result = report.caseResults.find((item) => item.caseId === 'T0-SURFACE-CONSISTENCY')
    const evidence = evidenceText(result)
    expect(result?.status).toBe('passed')
    expect(evidence).toContain('policy surface')
    expect(evidence).toContain('context-preview surface')
    expect(evidence).toContain('MCP surface')
    expect(evidence).toContain('skill surface')
    expect(evidence).not.toContain('catalog contract executed')
    expect(result?.hardFailures).toEqual([])
  })

  it('keeps Tier 1.6 evidence deterministic when seed and clock are fixed', async () => {
    const options = {
      cwd: process.cwd(),
      profile: 'gate' as const,
      seed: 'gate-deterministic-evidence',
      now: '2026-06-05T00:00:00.000Z'
    }
    const first = await runCyreneBenchmark({ ...options, outputDir: await outputDir() })
    const second = await runCyreneBenchmark({ ...options, outputDir: await outputDir() })

    for (const caseId of ['T16-REVIEW-HASH-REQUIRED', 'T16-ROUTING-NAMESPACE'] as const) {
      const firstEvidence = evidenceText(first.caseResults.find((item) => item.caseId === caseId))
      const secondEvidence = evidenceText(second.caseResults.find((item) => item.caseId === caseId))
      expect(firstEvidence).toBe(secondEvidence)
      expect(firstEvidence).not.toMatch(/runtimeMs=/)
    }
  })
})
