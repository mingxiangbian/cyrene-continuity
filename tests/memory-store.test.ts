import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type { CyreneMemory, PendingMemory } from '../src/memory/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('memory store JSONL reads', () => {
  it('does not read legacy index.jsonl as runtime lifecycle memory', async () => {
    const memoryRoot = await createTempDir('cyrene-memory-store-root-')
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(
      join(memoryRoot, 'index.jsonl'),
      [
        JSON.stringify(createMemory({ id: 'valid-before' })),
        '{not-json',
        JSON.stringify({ ok: true }),
        JSON.stringify(createMemory({ id: 'valid-after' }))
      ].join('\n') + '\n',
      'utf8'
    )

    const active = await readActiveMemoriesFromRoot(memoryRoot)

    expect(active).toEqual([])
  })

  it('writes lifecycle memory only to semantic_memories.jsonl', async () => {
    const memoryRoot = await createTempDir('cyrene-memory-store-root-')

    await writeActiveMemoriesFromRoot(memoryRoot, [createMemory()])

    await expect(readFile(join(memoryRoot, 'semantic_memories.jsonl'), 'utf8')).resolves.toContain('memory-1')
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes review queue memory to review_queue.jsonl without pending.jsonl projection', async () => {
    const memoryRoot = await createTempDir('cyrene-memory-store-root-')

    await writePendingMemoriesFromRoot(memoryRoot, [createPending()])

    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toContain('review-1')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readPendingMemoriesFromRoot(memoryRoot)).resolves.toMatchObject([{ id: 'review-1' }])
  })
})

function createMemory(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'memory-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'JSONL memory.',
    normalizedKey: 'jsonl-memory',
    evidence: [{ runId: 'run-1', summary: 'Seed memory.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.9,
      usefulness: 0.8,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
    tags: ['jsonl'],
    ...overrides
  }
}

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'review-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Review queue memory.',
    normalizedKey: 'review-queue-memory',
    evidence: [{ runId: 'run-1', summary: 'Seed review queue memory.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.7,
      stability: 0.7,
      usefulness: 0.7,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-05-29T00:00:00.000Z',
    lastSeenAt: '2026-05-29T00:00:00.000Z',
    expiresAt: '2026-06-29T00:00:00.000Z',
    tags: ['review'],
    ...overrides
  }
}
