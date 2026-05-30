import { describe, expect, it } from 'vitest'
import { runCodexReleaseEval } from '../src/codex/codex-eval.js'

describe('Codex release eval', () => {
  it('runs every minimum gate instead of returning a static pass', async () => {
    const result = await runCodexReleaseEval()

    expect(result.passed).toBe(true)
    expect(result.failedChecks).toEqual([])
    expect(result.results.map((item) => item.name).sort()).toEqual([...result.minimumChecks].sort())
    expect(result.results.every((item) => item.passed)).toBe(true)
  })
})
