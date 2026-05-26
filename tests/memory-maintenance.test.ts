import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runMemoryMaintenanceFromRoot, type MemoryMaintenanceBudget } from '../src/memory/memory-maintenance.js'
import type { CyreneMemory, MemoryEvent, MemoryTombstone, PendingMemory } from '../src/memory/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createMemoryRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-memory-maintenance-'))
  tempDirs.push(dir)
  return dir
}

async function seedMemoryRoot(input: {
  memoryRoot: string
  active?: CyreneMemory[]
  pending?: PendingMemory[]
  tombstones?: MemoryTombstone[]
}): Promise<void> {
  await mkdir(input.memoryRoot, { recursive: true })
  await writeJsonLines(join(input.memoryRoot, 'index.jsonl'), input.active ?? [])
  await writeJsonLines(join(input.memoryRoot, 'pending.jsonl'), input.pending ?? [])
  await writeJsonLines(join(input.memoryRoot, 'tombstones.jsonl'), input.tombstones ?? [])
}

async function writeJsonLines(filePath: string, values: unknown[]): Promise<void> {
  await writeFile(filePath, values.map((value) => JSON.stringify(value)).join('\n') + (values.length === 0 ? '' : '\n'))
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  return (await readFile(filePath, 'utf8'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

describe('root memory maintenance', () => {
  it('creates a snapshot before mutating expired active memories', async () => {
    const memoryRoot = await createMemoryRoot()
    const expired = createMemory({
      id: 'expired-1',
      content: 'Expired memory should still be present in the pre-maintenance snapshot.',
      expiresAt: '2026-05-25T00:00:00.000Z'
    })
    await seedMemoryRoot({ memoryRoot, active: [expired] })

    const result = await runMemoryMaintenanceFromRoot({
      memoryRoot,
      budget: createBudget(),
      now: '2026-05-26T00:00:00.000Z',
      reason: 'test maintenance'
    })

    const snapshotFiles = await readdir(join(memoryRoot, 'snapshots'))
    expect(snapshotFiles).toHaveLength(1)
    const snapshot = JSON.parse(await readFile(join(memoryRoot, 'snapshots', snapshotFiles[0] ?? ''), 'utf8')) as {
      active: CyreneMemory[]
    }
    expect(snapshot.active).toEqual([expired])
    expect(await readJsonLines<CyreneMemory>(join(memoryRoot, 'index.jsonl'))).toEqual([])
    expect(result).toMatchObject({ snapshotId: expect.stringMatching(/^memory-/), expired: 1, activeCount: 0 })
  })

  it('expires active memory and writes a tombstone and event', async () => {
    const memoryRoot = await createMemoryRoot()
    const expired = createMemory({
      id: 'expired-1',
      normalizedKey: 'expired-memory',
      expiresAt: '2026-05-25T00:00:00.000Z'
    })
    await seedMemoryRoot({ memoryRoot, active: [expired] })

    await runMemoryMaintenanceFromRoot({
      memoryRoot,
      budget: createBudget(),
      now: '2026-05-26T00:00:00.000Z'
    })

    expect(await readJsonLines<MemoryTombstone>(join(memoryRoot, 'tombstones.jsonl'))).toEqual([
      expect.objectContaining({
        memoryId: 'expired-1',
        normalizedKey: 'expired-memory',
        reason: 'expired'
      })
    ])
    expect(await readJsonLines<MemoryEvent>(join(memoryRoot, 'events.jsonl'))).toEqual([
      expect.objectContaining({ action: 'snapshot' }),
      expect.objectContaining({
        action: 'expire',
        memoryId: 'expired-1',
        reason: 'expired'
      })
    ])
  })

  it('serializes concurrent maintenance for the same root', async () => {
    const memoryRoot = await createMemoryRoot()
    const expired = createMemory({
      id: 'expired-1',
      normalizedKey: 'expired-memory',
      expiresAt: '2026-05-25T00:00:00.000Z'
    })
    await seedMemoryRoot({ memoryRoot, active: [expired] })

    await Promise.all([
      runMemoryMaintenanceFromRoot({
        memoryRoot,
        budget: createBudget(),
        now: '2026-05-26T00:00:00.000Z'
      }),
      runMemoryMaintenanceFromRoot({
        memoryRoot,
        budget: createBudget(),
        now: '2026-05-26T00:00:00.000Z'
      })
    ])

    expect(await readJsonLines<MemoryTombstone>(join(memoryRoot, 'tombstones.jsonl'))).toEqual([
      expect.objectContaining({ memoryId: 'expired-1', reason: 'expired' })
    ])
    const events = await readJsonLines<MemoryEvent>(join(memoryRoot, 'events.jsonl'))
    expect(events.filter((event) => event.action === 'expire')).toEqual([
      expect.objectContaining({ memoryId: 'expired-1', reason: 'expired' })
    ])
  })

  it('dedupes active memories by normalizedKey and keeps stronger newer evidence', async () => {
    const memoryRoot = await createMemoryRoot()
    const weaker = createMemory({
      id: 'weaker',
      normalizedKey: 'shared-key',
      scores: { ...defaultScores(), evidenceStrength: 0.6 },
      updatedAt: '2026-05-25T01:00:00.000Z',
      evidence: [{ runId: 'run-weaker', summary: 'Weaker evidence.' }],
      tags: ['old']
    })
    const stronger = createMemory({
      id: 'stronger',
      normalizedKey: 'shared-key',
      scores: { ...defaultScores(), evidenceStrength: 0.95 },
      updatedAt: '2026-05-25T00:00:00.000Z',
      evidence: [{ runId: 'run-stronger', summary: 'Stronger evidence.' }],
      tags: ['new'],
      supersedes: ['prior-memory']
    })
    await seedMemoryRoot({ memoryRoot, active: [weaker, stronger] })

    const result = await runMemoryMaintenanceFromRoot({
      memoryRoot,
      budget: createBudget(),
      now: '2026-05-26T00:00:00.000Z'
    })

    const active = await readJsonLines<CyreneMemory>(join(memoryRoot, 'index.jsonl'))
    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({
      id: 'stronger',
      tags: ['new', 'old'],
      supersedes: ['prior-memory', 'weaker']
    })
    expect(active[0]?.evidence.map((entry) => entry.summary)).toEqual(['Stronger evidence.', 'Weaker evidence.'])
    expect(result.deduped).toBe(1)
    expect(await readJsonLines<MemoryEvent>(join(memoryRoot, 'events.jsonl'))).toEqual([
      expect.objectContaining({ action: 'snapshot' }),
      expect.objectContaining({
        action: 'supersede',
        memoryId: 'weaker',
        reason: 'deduped'
      })
    ])
  })

  it('trims overlong content and evidence while keeping evidence shape valid', async () => {
    const memoryRoot = await createMemoryRoot()
    await seedMemoryRoot({
      memoryRoot,
      active: [
        createMemory({
          id: 'long',
          content: 'x'.repeat(30),
          evidence: [{ runId: 'run-long', quote: 'q'.repeat(20), summary: 's'.repeat(20) }]
        })
      ]
    })

    const result = await runMemoryMaintenanceFromRoot({
      memoryRoot,
      budget: createBudget({ singleMemoryContentMaxChars: 12, singleMemoryEvidenceMaxChars: 18 }),
      now: '2026-05-26T00:00:00.000Z'
    })

    const active = await readJsonLines<CyreneMemory>(join(memoryRoot, 'index.jsonl'))
    expect(active[0]?.content).toBe(`${'x'.repeat(9)}...`)
    expect(active[0]?.evidence).toEqual([
      expect.objectContaining({
        runId: 'run-long',
        quote: expect.stringMatching(/\.\.\.$/)
      })
    ])
    const evidenceTextLength = (active[0]?.evidence ?? []).reduce(
      (sum, entry) => sum + (entry.quote?.length ?? 0) + (entry.summary?.length ?? 0),
      0
    )
    expect(evidenceTextLength).toBeLessThanOrEqual(18)
    expect(result.trimmed).toBe(1)
  })

  it('archives low usefulness memories over item budget while preserving hard global procedural memories', async () => {
    const memoryRoot = await createMemoryRoot()
    const protectedMemory = createMemory({
      id: 'protected',
      normalizedKey: 'protected-memory',
      domain: 'procedural',
      type: 'procedural_rule',
      strength: 'hard',
      scope: 'global',
      scores: { ...defaultScores(), usefulness: 0.1, evidenceStrength: 0.1, safety: 0.1 }
    })
    const lowValue = createMemory({
      id: 'low-value',
      normalizedKey: 'low-value-memory',
      strength: 'soft',
      scope: 'project',
      scores: { ...defaultScores(), usefulness: 0.2, evidenceStrength: 0.2, safety: 0.2 }
    })
    const useful = createMemory({
      id: 'useful',
      normalizedKey: 'useful-memory',
      scores: { ...defaultScores(), usefulness: 0.9, evidenceStrength: 0.9, safety: 0.9 }
    })
    await seedMemoryRoot({ memoryRoot, active: [protectedMemory, lowValue, useful] })

    const result = await runMemoryMaintenanceFromRoot({
      memoryRoot,
      budget: createBudget({ activeMaxItems: 2 }),
      now: '2026-05-26T00:00:00.000Z'
    })

    const active = await readJsonLines<CyreneMemory>(join(memoryRoot, 'index.jsonl'))
    expect(active.map((memory) => memory.id).sort()).toEqual(['protected', 'useful'])
    expect(await readJsonLines<MemoryTombstone>(join(memoryRoot, 'tombstones.jsonl'))).toEqual([
      expect.objectContaining({ memoryId: 'low-value', reason: 'archived' })
    ])
    expect(result.archived).toBe(1)
  })

  it('limits pending memories by newest lastSeenAt', async () => {
    const memoryRoot = await createMemoryRoot()
    await seedMemoryRoot({
      memoryRoot,
      pending: [
        createPending({ id: 'oldest', lastSeenAt: '2026-05-25T00:00:00.000Z' }),
        createPending({ id: 'newest', lastSeenAt: '2026-05-25T02:00:00.000Z' }),
        createPending({ id: 'middle', lastSeenAt: '2026-05-25T01:00:00.000Z' })
      ]
    })

    const result = await runMemoryMaintenanceFromRoot({
      memoryRoot,
      budget: createBudget({ pendingMaxItems: 2 }),
      now: '2026-05-26T00:00:00.000Z'
    })

    const pending = await readJsonLines<PendingMemory>(join(memoryRoot, 'pending.jsonl'))
    expect(pending.map((candidate) => candidate.id)).toEqual(['newest', 'middle'])
    expect(result.pendingCount).toBe(2)
  })

  it('renders MODEL_PROFILE.md after maintenance', async () => {
    const memoryRoot = await createMemoryRoot()
    await seedMemoryRoot({
      memoryRoot,
      active: [createMemory({ content: 'Keep maintenance profile rendering deterministic.' })]
    })

    await runMemoryMaintenanceFromRoot({
      memoryRoot,
      budget: createBudget(),
      now: '2026-05-26T00:00:00.000Z'
    })

    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain(
      'Keep maintenance profile rendering deterministic.'
    )
  })
})

function createBudget(overrides: Partial<MemoryMaintenanceBudget> = {}): MemoryMaintenanceBudget {
  return {
    activeMaxItems: 100,
    activeContentMaxChars: 10_000,
    indexFileMaxChars: 50_000,
    singleMemoryContentMaxChars: 300,
    singleMemoryEvidenceMaxChars: 1_000,
    pendingMaxItems: 100,
    ...overrides
  }
}

function createMemory(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'memory-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Cyrene memory maintenance keeps the active index bounded.',
    normalizedKey: 'memory-maintenance-bounded-index',
    evidence: [{ runId: 'run-1', summary: 'Maintenance test evidence.' }],
    source: 'assistant_observed',
    scores: defaultScores(),
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    tags: [],
    ...overrides
  }
}

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Pending memory candidate.',
    normalizedKey: 'pending-memory-candidate',
    evidence: [{ runId: 'run-pending', summary: 'Pending evidence.' }],
    source: 'assistant_observed',
    scores: defaultScores(),
    seenCount: 1,
    firstSeenAt: '2026-05-25T00:00:00.000Z',
    lastSeenAt: '2026-05-25T00:00:00.000Z',
    expiresAt: '2026-06-25T00:00:00.000Z',
    tags: [],
    ...overrides
  }
}

function defaultScores(): CyreneMemory['scores'] {
  return {
    evidenceStrength: 0.9,
    stability: 0.9,
    usefulness: 0.8,
    safety: 0.95,
    sensitivity: 0.1
  }
}
