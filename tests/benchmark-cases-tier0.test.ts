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

function metricMap(result: { metrics: ReadonlyArray<{ name: string; value: number }> } | undefined): Map<string, number> {
  return new Map(result?.metrics.map((item) => [item.name, item.value]) ?? [])
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
      ['T0-CROSS-PROJECT-ADVERSARIAL', 'adversarial cross-project boundary ok'],
      ['T0-CROSS-PROJECT-PROMPT-INJECTION', 'promptInjectionInjected=0'],
      ['T0-SESSION-HINTS', 'pending migration=0'],
      ['T16-ROUTING-NAMESPACE', 'namespace routing ok'],
      ['T16-REL-SUPERSEDES-DIRECTION', 'supersedes direction ok; staleLeakage=0'],
      ['T16-REL-SIMILAR-NO-EXPANSION', 'similar relation diagnostics-only; expansion=0'],
      ['T16-REL-DERIVED-TRIAL-BLOCK', 'derived trial relation blocked; activeHintLeakage=0'],
      ['T16-REL-TRANSFER-HINT-ONLY', 'transfer relation hint-only; migration=0'],
      ['T16-REL-TRIAL-HINT-EXCLUSION', 'trial relation hint excluded from runtime; diagnosticsOnly=1'],
      ['T16-REL-EDGE-INVALIDATION', 'relation edge invalidation ok; expired=1'],
      ['T16-REL-FALLBACK-SCOPE-GUARD', 'JSONL fallback scope guard ok; crossProjectPollution=0'],
      ['T16-REL-LASTUSED-HOTPATH', 'relation hot path read-only; lastUsedWrites=0']
    ] as const) {
      const result = report.caseResults.find((item) => item.caseId === caseId)
      expect(result?.status).toBe('passed')
      expect(evidenceText(result)).toContain(expectedEvidence)
      expect(evidenceText(result)).not.toContain('catalog contract executed')
      expect(result?.hardFailures).toEqual([])
    }

    const proposeImportant = metricMap(report.caseResults.find((item) => item.caseId === 'T16-PROPOSE-IMPORTANT'))
    expect(proposeImportant.get('importantMemoryMissedRate')).toBe(0)
    expect(proposeImportant.get('proposalPrecision')).toBe(1)
    expect(proposeImportant.get('proposalRecall')).toBe(1)
    const proposeNoise = metricMap(report.caseResults.find((item) => item.caseId === 'T16-PROPOSE-NOISE'))
    expect(proposeNoise.get('noiseProposalRate')).toBe(0)
    expect(proposeNoise.get('proposalPrecision')).toBe(1)
    const proposeSensitive = metricMap(report.caseResults.find((item) => item.caseId === 'T16-PROPOSE-SENSITIVE'))
    expect(proposeSensitive.get('sensitiveProposalRate')).toBe(0)
    expect(proposeSensitive.get('proposalPrecision')).toBe(1)
    expect(metricMap(report.caseResults.find((item) => item.caseId === 'T16-PROPOSE-ASSISTANT-INFERENCE')).get('assistantInferenceAutoActiveRate')).toBe(0)
    expect(metricMap(report.caseResults.find((item) => item.caseId === 'T16-REVIEW-REJECT-DEFER')).get('rejectCount')).toBe(1)
    expect(metricMap(report.caseResults.find((item) => item.caseId === 'T16-REVIEW-REJECT-DEFER')).get('deferCount')).toBe(1)
    expect(metricMap(report.caseResults.find((item) => item.caseId === 'T16-REVIEW-EDIT-HASH')).get('editCount')).toBe(1)
    expect(metricMap(report.caseResults.find((item) => item.caseId === 'T0-CROSS-PROJECT-ADVERSARIAL')).get('crossProjectPollutionRate')).toBe(0)
    expect(metricMap(report.caseResults.find((item) => item.caseId === 'T0-CROSS-PROJECT-ADVERSARIAL')).get('similarHintMigrationRate')).toBe(0)
    const promptInjection = metricMap(report.caseResults.find((item) => item.caseId === 'T0-CROSS-PROJECT-PROMPT-INJECTION'))
    expect(promptInjection.get('crossProjectPollutionRate')).toBe(0)
    expect(promptInjection.get('similarHintMigrationRate')).toBe(0)
    expect(promptInjection.get('profilePollutionRate')).toBe(0)
    const relationSupersedes = metricMap(report.caseResults.find((item) => item.caseId === 'T16-REL-SUPERSEDES-DIRECTION'))
    expect(relationSupersedes.get('replacementAccuracy')).toBe(1)
    expect(relationSupersedes.get('staleMemoryLeakageRate')).toBe(0)
    expect(relationSupersedes.get('duplicateActiveMemoryRate')).toBe(0)
    expect(metricMap(report.caseResults.find((item) => item.caseId === 'T16-REL-TRANSFER-HINT-ONLY')).get('similarHintMigrationRate')).toBe(0)
    expect(metricMap(report.caseResults.find((item) => item.caseId === 'T16-REL-FALLBACK-SCOPE-GUARD')).get('crossProjectPollutionRate')).toBe(0)
    expect(metricMap(report.caseResults.find((item) => item.caseId === 'T16-REL-LASTUSED-HOTPATH')).get('retrievedDefaultWriteRate')).toBe(0)
  }, 20_000)

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
  }, 20_000)

  it('keeps Tier 1.6 evidence deterministic when seed and clock are fixed', async () => {
    const options = {
      cwd: process.cwd(),
      profile: 'gate' as const,
      seed: 'gate-deterministic-evidence',
      now: '2026-06-05T00:00:00.000Z'
    }
    const first = await runCyreneBenchmark({ ...options, outputDir: await outputDir() })
    const second = await runCyreneBenchmark({ ...options, outputDir: await outputDir() })

    for (const caseId of [
      'T16-REVIEW-HASH-REQUIRED',
      'T16-ROUTING-NAMESPACE',
      'T16-REL-SUPERSEDES-DIRECTION',
      'T16-REL-SIMILAR-NO-EXPANSION',
      'T16-REL-DERIVED-TRIAL-BLOCK',
      'T16-REL-TRANSFER-HINT-ONLY',
      'T16-REL-TRIAL-HINT-EXCLUSION',
      'T16-REL-EDGE-INVALIDATION',
      'T16-REL-FALLBACK-SCOPE-GUARD',
      'T16-REL-LASTUSED-HOTPATH'
    ] as const) {
      const firstEvidence = evidenceText(first.caseResults.find((item) => item.caseId === caseId))
      const secondEvidence = evidenceText(second.caseResults.find((item) => item.caseId === caseId))
      expect(firstEvidence).toBe(secondEvidence)
      expect(firstEvidence).not.toMatch(/runtimeMs=/)
    }
  }, 20_000)
})
