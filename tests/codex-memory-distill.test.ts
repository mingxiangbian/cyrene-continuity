import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCodexMemoryDistill } from '../src/codex/memory-distill.js'
import type { PendingMemory } from '../src/memory/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'p1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'Run release typecheck before publishing.',
    normalizedKey: 'release-typecheck',
    evidence: [{ runId: 'run-1', sourceKind: 'tool_trace', summary: 'Release typecheck passed.' }],
    source: 'tool_trace',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.8,
      usefulness: 0.8,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-05-30T00:00:00.000Z',
    lastSeenAt: '2026-05-30T00:00:00.000Z',
    expiresAt: '2026-06-29T00:00:00.000Z',
    tags: ['release'],
    ...overrides
  }
}

describe('Codex memory distillation dry run', () => {
  it('clusters duplicate pending candidates without mutating pending memory', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-memory-')
    const pendingPath = join(memoryRoot, 'pending.jsonl')
    const pending = [
      createPending(),
      createPending({
        id: 'p2',
        evidence: [{ runId: 'run-2', sourceKind: 'tool_trace', summary: 'Second release typecheck signal.' }],
        lastSeenAt: '2026-05-30T01:00:00.000Z'
      })
    ]
    const pendingBefore = pending.map((item) => JSON.stringify(item)).join('\n') + '\n'
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(pendingPath, pendingBefore, 'utf8')
    await writeFile(join(memoryRoot, 'index.jsonl'), '', 'utf8')

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.mode).toBe('dry_run')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      normalizedKey: 'release-typecheck',
      sourceIds: ['p1', 'p2'],
      recommendedAction: 'merge_pending',
      risk: 'low'
    })
    await expect(readFile(pendingPath, 'utf8')).resolves.toBe(pendingBefore)
  })
})
