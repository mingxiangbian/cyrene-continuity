import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendCodexReviewSummary } from '../src/codex/review-summary-store.js'

const originalHome = process.env.HOME
const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('Codex review summary store', () => {
  it('appends review summaries as JSONL under the Codex memory root', async () => {
    const home = await createTempDir('cyrene-review-summary-home-')
    vi.stubEnv('HOME', home)
    const memoryRoot = await createTempDir('cyrene-review-summary-root-')

    await appendCodexReviewSummary(memoryRoot, {
      id: 'summary-1',
      runId: 'session:turn',
      createdAt: '2026-05-26T00:00:00.000Z',
      status: 'ok',
      summary: '用户确认 C-B 使用 cheap model。',
      redaction: { input: {}, output: {} },
      model: { useCase: 'memory_extraction', model: 'cheap-model' },
      candidateIds: []
    })

    const raw = await readFile(join(memoryRoot, 'review-summaries.jsonl'), 'utf8')
    expect(raw).toContain('"id":"summary-1"')
    expect(raw).toContain('"candidateIds":[]')
  })

  it('refuses to append review summaries through a symlinked data file', async () => {
    const home = await createTempDir('cyrene-review-summary-home-')
    vi.stubEnv('HOME', home)
    const memoryRoot = await createTempDir('cyrene-review-summary-root-')
    const outside = await createTempDir('cyrene-review-summary-outside-')
    const outsideSummaries = join(outside, 'review-summaries.jsonl')
    await writeFile(outsideSummaries, 'outside target must stay unchanged\n')
    await symlink(outsideSummaries, join(memoryRoot, 'review-summaries.jsonl'))

    await expect(
      appendCodexReviewSummary(memoryRoot, {
        id: 'summary-symlink',
        runId: 'session:turn',
        createdAt: '2026-05-26T00:00:00.000Z',
        status: 'ok',
        summary: 'Should not write through a symlink.',
        redaction: { input: {}, output: {} },
        candidateIds: []
      })
    ).rejects.toThrow(/memory data file symlink/)
    await expect(readFile(outsideSummaries, 'utf8')).resolves.toBe('outside target must stay unchanged\n')
  })
})
