import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readActiveMemoriesFromRoot,
  readMemoryEdgesFromRoot,
  readMemoryEventsFromRoot,
  readPendingMemoriesFromRoot,
  transitionMemoryEdgeStatusFromRoot,
  upsertMemoryEdgeFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type { CyreneMemory, MemoryEdge, PendingMemory } from '../src/memory/types.js'

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

  it('stores memory relation edges as durable JSONL records', async () => {
    const memoryRoot = await createTempDir('cyrene-memory-store-root-')
    const edge = createMemoryEdge({
      id: 'edge-replacement-old',
      fromMemoryId: 'replacement',
      toMemoryId: 'old',
      relationType: 'supersedes',
      status: 'validated',
      origin: 'operation',
      evidenceKind: 'review_hash'
    })

    await upsertMemoryEdgeFromRoot(memoryRoot, edge)

    await expect(readMemoryEdgesFromRoot(memoryRoot)).resolves.toEqual([edge])
    await expect(readFile(join(memoryRoot, 'memory_edges.jsonl'), 'utf8')).resolves.toContain('edge-replacement-old')
  })

  it('marks a validated relation rejected and records an invalidation receipt', async () => {
    const memoryRoot = await createTempDir('cyrene-memory-store-root-')
    await upsertMemoryEdgeFromRoot(memoryRoot, createMemoryEdge({ id: 'edge-bad', status: 'validated' }))

    await transitionMemoryEdgeStatusFromRoot(memoryRoot, {
      id: 'edge-bad',
      status: 'rejected',
      now: '2026-06-07T00:00:00.000Z',
      reason: 'relation_edge_invalidated',
      details: { reviewer: 'benchmark' }
    })

    expect((await readMemoryEdgesFromRoot(memoryRoot))[0]).toMatchObject({
      id: 'edge-bad',
      status: 'rejected',
      updatedAt: '2026-06-07T00:00:00.000Z'
    })
    expect(await readMemoryEventsFromRoot(memoryRoot)).toEqual([
      expect.objectContaining({
        action: 'audit',
        reason: 'relation_edge_invalidated',
        memoryId: 'edge-bad',
        details: expect.objectContaining({
          fromMemoryId: 'memory-from',
          toMemoryId: 'memory-to',
          previousStatus: 'validated',
          nextStatus: 'rejected'
        })
      })
    ])
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

function createMemoryEdge(overrides: Partial<MemoryEdge> = {}): MemoryEdge {
  return {
    id: 'edge-1',
    fromMemoryId: 'memory-from',
    toMemoryId: 'memory-to',
    fromScope: 'project',
    toScope: 'project',
    fromProjectId: 'project-1',
    toProjectId: 'project-1',
    relationType: 'supports',
    status: 'trial',
    confidence: 0.8,
    origin: 'deterministic',
    reason: 'test relation',
    evidenceId: 'evidence-1',
    evidenceKind: 'normalized_key',
    createdAt: '2026-06-07T00:00:00.000Z',
    updatedAt: '2026-06-07T00:00:00.000Z',
    ...overrides
  }
}
