import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readFastSummaryProjection,
  writeFastSummaryProjection
} from '../src/codex/fast-summary-store.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('fast summary store', () => {
  it('writes and reads capped global/profile fast summaries', async () => {
    const root = await createTempDir('cyrene-fast-summary-')
    await writeFastSummaryProjection(root, {
      globalFastSummary: 'Use surgical changes. '.repeat(80),
      profileFastSummary: 'Prefer concise engineering Chinese. '.repeat(80),
      generatedAt: '2026-06-05T00:00:00.000Z'
    })

    const projection = await readFastSummaryProjection(root)
    expect(projection.generatedAt).toBe('2026-06-05T00:00:00.000Z')
    expect(projection.globalFastSummary.length).toBeLessThanOrEqual(900)
    expect(projection.profileFastSummary.length).toBeLessThanOrEqual(700)
  })

  it('returns empty summaries when projection files are absent', async () => {
    const root = await createTempDir('cyrene-fast-summary-empty-')
    await expect(readFastSummaryProjection(root)).resolves.toEqual({
      globalFastSummary: '',
      profileFastSummary: '',
      generatedAt: undefined
    })
  })
})
