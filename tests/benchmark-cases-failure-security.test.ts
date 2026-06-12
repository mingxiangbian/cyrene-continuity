import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCyreneBenchmark } from '../benchmark/runner.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function outputDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-benchmark-tier4-'))
  tempDirs.push(dir)
  return dir
}

function evidenceText(result: { evidence: ReadonlyArray<{ summary: string }> } | undefined): string {
  return result?.evidence.map((item) => item.summary).join('\n') ?? ''
}

function metricMap(result: { metrics: ReadonlyArray<{ name: string; value: number }> } | undefined): Map<string, number> {
  return new Map(result?.metrics.map((item) => [item.name, item.value]) ?? [])
}

describe('benchmark Tier 4 failure, security, and adapter cases', () => {
  it('runs full-profile failure and recovery cases with real assertions', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'full',
      outputDir: await outputDir(),
      seed: 'tier4-full-real',
      now: '2026-06-05T00:00:00.000Z'
    })

    expect(report.passed).toBe(true)
    for (const [caseId, expectedEvidence] of [
      ['T4-SQLITE-UNAVAILABLE', 'sqlite unavailable diagnostic'],
      ['T4-JSONL-CORRUPT', 'corrupt jsonl rejected'],
      ['T4-PROFILE-MISSING', 'missing profile handled'],
      ['T4-FAST-SUMMARY-MISSING-STALE', 'stale fast summary skipped'],
      ['T4-SESSION-HINTS-EXPIRED', 'expired session hints ignored'],
      ['T4-MCP-ERROR', 'bounded MCP error'],
      ['T4-AUTOMATION-INTERRUPT', 'automation idempotent'],
      ['T4-HOOK-TIMEOUT', 'hook timeout fail-open']
    ] as const) {
      const result = report.caseResults.find((item) => item.caseId === caseId)
      expect(result?.status).toBe('passed')
      expect(evidenceText(result)).toContain(expectedEvidence)
      expect(evidenceText(result)).not.toContain('catalog contract executed')
      expect(result?.hardFailures).toEqual([])
    }

    const automation = metricMap(report.caseResults.find((item) => item.caseId === 'T4-AUTOMATION-INTERRUPT'))
    for (const metric of [
      'dailyAutomationRuntimeMs',
      'weeklyAutomationRuntimeMs',
      'dailyPromotedCount',
      'weeklyCoreCandidateCount',
      'pendingReviewedCount',
      'pendingGeneratedCount',
      'duplicateAutomationOutputCount',
      'dryRunWriteCount',
      'repeatedPromotionCount',
      'automationInterruptRecoveryTimeMs'
    ]) {
      expect(automation.has(metric)).toBe(true)
    }
    expect(evidenceText(report.caseResults.find((item) => item.caseId === 'T4-AUTOMATION-INTERRUPT'))).toContain('automationFixtureScale=toy')

    const hook = metricMap(report.caseResults.find((item) => item.caseId === 'T4-HOOK-TIMEOUT'))
    expect(hook.has('hookTimeoutCount')).toBe(false)
    expect(hook.has('hookFailOpenCount')).toBe(false)
    expect(hook.get('simulatedHookTimeoutCount')).toBe(1)
    expect(hook.get('simulatedHookFailOpenCount')).toBe(1)
    expect(hook.get('runtimeHookTimeoutCount')).toBe(0)
    expect(hook.get('runtimeHookFailOpenCount')).toBe(0)
    expect(hook.has('stopHookP95Ms')).toBe(true)
    expect(report.metrics.efficiency.runtimeHookTimeoutCount).toBe(0)
    expect(report.metrics.efficiency.simulatedHookTimeoutCount).toBe(1)
    expect(evidenceText(report.caseResults.find((item) => item.caseId === 'T4-JSONL-CORRUPT'))).toContain(
      'gate=jsonl-corruption-write-block'
    )
  }, 20_000)

  it('marks llm and external adapter cases unsupported when provider env is missing', async () => {
    const llm = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'llm',
      outputDir: await outputDir(),
      seed: 'tier4-llm-adapter',
      now: '2026-06-05T00:00:00.000Z'
    })
    const external = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'external',
      outputDir: await outputDir(),
      seed: 'tier4-external-adapter',
      now: '2026-06-05T00:00:00.000Z'
    })

    const llmAdapter = llm.caseResults.find((item) => item.caseId === 'T2-REDUCE-REPEAT-MISTAKE')
    expect(llmAdapter?.status).toBe('not_supported_without_provider')
    expect(evidenceText(llmAdapter)).toContain('missing provider env')

    const externalAdapter = external.caseResults.find((item) => item.caseId === 'T4-SQLITE-UNAVAILABLE')
    expect(externalAdapter?.status).toBe('not_supported_without_provider')
    expect(evidenceText(externalAdapter)).toContain('missing provider env')
    expect(external.failedCases).toEqual([])
  }, 20_000)
})
