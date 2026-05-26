import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
})
