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
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-benchmark-ability-action-'))
  tempDirs.push(dir)
  return dir
}

function evidenceText(result: { evidence: ReadonlyArray<{ summary: string }> } | undefined): string {
  return result?.evidence.map((item) => item.summary).join('\n') ?? ''
}

describe('benchmark Tier 1 and Tier 2 replay cases', () => {
  it('runs deterministic memory ability and memory-to-action cases in full profile', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'full',
      outputDir: await outputDir(),
      seed: 'ability-action-full',
      now: '2026-06-05T00:00:00.000Z'
    })

    expect(report.passed).toBe(true)
    for (const [caseId, expectedEvidence] of [
      ['T1-FACT-EXTRACTION', 'adopted command=npm test -- tests/codex-context-policy.test.ts'],
      ['T1-MULTI-SESSION-REASONING', 'later decision=use context policy fixture'],
      ['T1-TEMPORAL-ORDER', 'newest rule wins'],
      ['T1-KNOWLEDGE-UPDATE', 'superseded rule excluded'],
      ['T1-CONFLICT-HANDLING', 'single selected rule'],
      ['T1-ABSTAIN-NO-EVIDENCE', 'abstain=1'],
      ['T1-EVENT-SUMMARY', 'summary includes decision/failure/fix/verification'],
      ['T2-REMEMBER-TEST-COMMAND', 'with-memory command reused'],
      ['T2-AVOID-REJECTED-APPROACH', 'rejected approach avoided'],
      ['T2-FOLLOW-WORKFLOW', 'workflow rule followed'],
      ['T2-UPDATED-RULE', 'updated rule applied'],
      ['T2-CROSS-SESSION-FIX', 'prior fix pattern applied'],
      ['T2-REDUCE-REPEAT-MISTAKE', 'repeated mistake reduction=']
    ] as const) {
      const result = report.caseResults.find((item) => item.caseId === caseId)
      expect(result?.status).toBe('passed')
      expect(evidenceText(result)).toContain(expectedEvidence)
      expect(evidenceText(result)).not.toContain('catalog contract executed')
      expect(result?.hardFailures).toEqual([])
    }
  })
})
