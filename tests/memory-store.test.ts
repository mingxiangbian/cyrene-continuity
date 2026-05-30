import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readActiveMemoriesFromRoot } from '../src/memory/memory-store.js'
import type { CyreneMemory } from '../src/memory/types.js'

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
  it('skips malformed JSONL lines while preserving valid active memories', async () => {
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

    expect(active.map((memory) => memory.id)).toEqual(['valid-before', 'valid-after'])
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
