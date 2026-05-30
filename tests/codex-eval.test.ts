import { describe, expect, it } from 'vitest'
import { runCodexReleaseEval } from '../src/codex/codex-eval.js'

describe('Codex release eval', () => {
  it('runs every minimum gate instead of returning a static pass', async () => {
    const result = await runCodexReleaseEval()

    expect(result.passed).toBe(true)
    expect(result.failedChecks).toEqual([])
    expect(result.minimumChecks).toEqual(expect.arrayContaining([
      'auto_promotion_policy_eval',
      'global_auto_promotion_eval',
      'active_lifecycle_eval',
      'pending_budget_eval',
      'memory_edge_eval',
      'retrieval_explain_eval'
    ]))
    expect(result.results.map((item) => item.name).sort()).toEqual([...result.minimumChecks].sort())
    expect(result.results.every((item) => item.passed)).toBe(true)
  })
})
