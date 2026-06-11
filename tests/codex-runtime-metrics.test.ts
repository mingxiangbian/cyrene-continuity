import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendRuntimeMetric, readRuntimeMetrics } from '../src/codex/runtime-metrics.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('runtime metrics', () => {
  it('records runtime metric events without raw prompt text', async () => {
    const root = await createTempDir('cyrene-runtime-metrics-')
    await appendRuntimeMetric(root, {
      event: 'continuity_get',
      mode: 'fast',
      latencyMs: 17,
      sqliteLatencyMs: 4,
      similarLatencyMs: 0,
      pendingLatencyMs: 0,
      profileReadLatencyMs: 0,
      tokenOverhead: 311,
      jsonlFallback: false,
      indexStale: false,
      createdAt: '2026-06-05T00:00:00.000Z',
      rawPrompt: 'raw prompt text must not be persisted'
    } as never)

    const metrics = await readRuntimeMetrics(root)
    expect(metrics).toHaveLength(1)
    expect(JSON.stringify(metrics)).not.toContain('raw prompt')
    expect(metrics[0]).toMatchObject({ event: 'continuity_get', mode: 'fast', latencyMs: 17 })
  })

  it('records candidate hint aggregate metrics without raw memory text', async () => {
    const root = await createTempDir('cyrene-runtime-candidate-hints-')
    await appendRuntimeMetric(root, {
      event: 'continuity_get',
      mode: 'balanced',
      latencyMs: 23,
      candidateHintLatencyMs: 3,
      candidateHintEligibleCount: 4,
      candidateHintRelevantCount: 2,
      candidateHintSelectedCount: 1,
      candidateHintTimeoutCount: 0,
      candidateHintSuppressedByLatencyCount: 0,
      createdAt: '2026-06-05T00:00:00.000Z',
      rawMemoryText: 'candidate memory text must not be persisted'
    } as never)

    const metrics = await readRuntimeMetrics(root)
    expect(metrics).toHaveLength(1)
    expect(JSON.stringify(metrics)).not.toContain('candidate memory text')
    expect(metrics[0]).toMatchObject({
      event: 'continuity_get',
      mode: 'balanced',
      candidateHintLatencyMs: 3,
      candidateHintEligibleCount: 4,
      candidateHintRelevantCount: 2,
      candidateHintSelectedCount: 1,
      candidateHintTimeoutCount: 0,
      candidateHintSuppressedByLatencyCount: 0
    })
  })
})
