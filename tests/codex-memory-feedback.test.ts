import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { contentHashForActiveMemory } from '../src/codex/active-memory-review.js'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import {
  appendActivationEventFailOpen,
  appendActivationEventsFailOpen,
  recordCodexMemoryFeedback
} from '../src/codex/memory-feedback.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import {
  appendTombstoneFromRoot,
  readActivationEventsFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot,
  writeSemanticMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type { CyreneMemory, PendingMemory, SemanticMemory } from '../src/memory/types.js'

const tempDirs: string[] = []
const originalHome = process.env.HOME

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function activeMemory(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'feedback-active-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Use the timeout pitfall while fixing tests.',
    normalizedKey: 'use-timeout-pitfall-while-fixing-tests',
    evidence: [{ runId: 'run-1', summary: 'Seed active memory.' }],
    source: 'review_event',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    tags: ['feedback'],
    ...overrides
  }
}

function pendingMemory(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    ...activeMemory(),
    id: 'feedback-pending-1',
    status: 'pending',
    useWhen: ['feedback pending'],
    doNotUseWhen: ['active only'],
    seenCount: 1,
    firstSeenAt: '2026-06-03T00:00:00.000Z',
    lastSeenAt: '2026-06-03T00:00:00.000Z',
    expiresAt: '2026-07-03T00:00:00.000Z',
    ...overrides
  }
}

function archivedSemanticMemory(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  return {
    id: 'feedback-archived-1',
    status: 'archived',
    module: 'procedural',
    kind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    content: 'Archived feedback memory must reject public feedback.',
    useWhen: ['feedback archived'],
    doNotUseWhen: ['active only'],
    evidence: [
      {
        id: 'evidence-archived',
        sourceKind: 'review_event',
        sourceRef: 'review:archived',
        whatHappened: 'Archived fixture.',
        whyImportant: 'Feedback boundary must be active-only.'
      }
    ],
    reviewPolicy: 'strict_auto_promote',
    supersedes: [],
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    ...overrides
  }
}

async function seedActiveProjectMemory(): Promise<{ cwd: string; memoryRoot: string; memory: CyreneMemory }> {
  const home = await createTempDir('cyrene-codex-memory-feedback-home-')
  process.env.HOME = home
  const cwd = await createTempDir('cyrene-codex-memory-feedback-project-')
  const identity = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(identity.projectId)
  const memory = activeMemory()
  await writeActiveMemoriesFromRoot(memoryRoot, [memory])
  return { cwd, memoryRoot, memory }
}

describe('Codex memory feedback', () => {
  it('records explicit applied events with activationId and reason', async () => {
    const root = await createTempDir('cyrene-codex-memory-feedback-')

    await appendActivationEventFailOpen({
      memoryRoot: root,
      memoryId: 'memory-1',
      projectId: 'project-1',
      query: 'runtime verification',
      event: 'applied',
      activationId: 'activation-1',
      reason: 'Checklist item was completed before final response.',
      evidenceRef: 'test:1',
      now: '2026-06-03T00:00:00.000Z'
    })

    const events = await readActivationEventsFromRoot(root)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      memoryId: 'memory-1',
      projectId: 'project-1',
      event: 'applied',
      activationId: 'activation-1',
      reason: 'Checklist item was completed before final response.',
      evidenceRef: 'test:1',
      createdAt: '2026-06-03T00:00:00.000Z'
    })
    expect(events[0]?.queryHash).toMatch(/^[a-f0-9]{16}$/)
  })

  it('keeps batched retrieved event behavior', async () => {
    const root = await createTempDir('cyrene-codex-memory-feedback-batch-')

    await appendActivationEventsFailOpen({
      memoryRoot: root,
      memoryIds: ['memory-2', 'memory-1', 'memory-1'],
      projectId: 'project-1',
      query: 'query',
      event: 'retrieved',
      now: '2026-06-03T00:00:00.000Z'
    })

    const events = await readActivationEventsFromRoot(root)
    expect(events.map((event) => event.memoryId)).toEqual(['memory-1', 'memory-2'])
    expect(events.map((event) => event.event)).toEqual(['retrieved', 'retrieved'])
  })

  it('records explicit corrected events with reason', async () => {
    const root = await createTempDir('cyrene-codex-memory-feedback-negative-')

    await appendActivationEventFailOpen({
      memoryRoot: root,
      memoryId: 'memory-1',
      projectId: 'project-1',
      event: 'corrected',
      reason: 'User corrected the promoted memory guidance.',
      now: '2026-06-03T00:00:00.000Z'
    })

    await expect(readActivationEventsFromRoot(root)).resolves.toEqual([
      expect.objectContaining({
        memoryId: 'memory-1',
        event: 'corrected',
        reason: 'User corrected the promoted memory guidance.'
      })
    ])
  })

  it('records applied feedback with content hash and query hash only', async () => {
    const { cwd, memoryRoot, memory } = await seedActiveProjectMemory()

    const result = await recordCodexMemoryFeedback({
      cwd,
      memoryId: memory.id,
      contentHash: contentHashForActiveMemory(memory),
      event: 'applied',
      query: 'Use the timeout pitfall while fixing tests.',
      now: '2026-06-04T00:00:00.000Z'
    })

    expect(result.result.action).toBe('recorded')
    const events = await readActivationEventsFromRoot(memoryRoot)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ memoryId: memory.id, event: 'applied' })
    expect(JSON.stringify(events)).not.toContain('Use the timeout pitfall')
    expect(events[0]?.queryHash).toMatch(/^[a-f0-9]{16}$/)
    expect((events[0] as { idempotencyKey?: string } | undefined)?.idempotencyKey).toMatch(/^[a-f0-9]{16}$/)
  })

  it('records candidate hint feedback with activation id, content hash, project id, and query hash', async () => {
    const { cwd, memoryRoot, memory } = await seedActiveProjectMemory()
    const project = await identifyCodexProject(cwd)
    const contentHash = contentHashForActiveMemory(memory)

    const result = await recordCodexMemoryFeedback({
      cwd,
      memoryId: memory.id,
      contentHash,
      event: 'applied',
      activationId: 'candidate-hint:feedback-active-1',
      query: 'Candidate hint feedback should bind to the shown workflow hint.',
      now: '2026-06-04T00:00:00.000Z'
    })

    expect(result.result).toMatchObject({
      action: 'recorded',
      memoryId: memory.id,
      event: 'applied',
      queryHash: expect.stringMatching(/^[a-f0-9]{16}$/)
    })
    const events = await readActivationEventsFromRoot(memoryRoot)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      memoryId: memory.id,
      projectId: project.projectId,
      event: 'applied',
      activationId: 'candidate-hint:feedback-active-1',
      contentHash,
      queryHash: expect.stringMatching(/^[a-f0-9]{16}$/)
    })
    expect(JSON.stringify(events)).not.toContain('Candidate hint feedback should bind')
  })

  it('does not record batched applied feedback from candidate hint memory ids alone', async () => {
    const root = await createTempDir('cyrene-codex-memory-feedback-candidate-blind-')

    await appendActivationEventsFailOpen({
      memoryRoot: root,
      memoryIds: ['candidate-hint-memory-1'],
      projectId: 'project-1',
      query: 'Candidate hint trial memory was detected.',
      event: 'applied',
      now: '2026-06-04T00:00:00.000Z'
    })

    expect(await readActivationEventsFromRoot(root)).toEqual([])
  })

  it.each(['corrected', 'violated'] as const)('rejects %s feedback without reason', async (event) => {
    const { cwd, memoryRoot, memory } = await seedActiveProjectMemory()

    const result = await recordCodexMemoryFeedback({
      cwd,
      memoryId: memory.id,
      contentHash: contentHashForActiveMemory(memory),
      event,
      now: '2026-06-04T00:00:00.000Z'
    })

    expect(result.result).toEqual({ action: 'invalid_request', reason: `${event} feedback requires reason` })
    expect(await readActivationEventsFromRoot(memoryRoot)).toEqual([])
  })

  it('rejects applied feedback without query or evidenceRef', async () => {
    const { cwd, memoryRoot, memory } = await seedActiveProjectMemory()

    const result = await recordCodexMemoryFeedback({
      cwd,
      memoryId: memory.id,
      contentHash: contentHashForActiveMemory(memory),
      event: 'applied',
      now: '2026-06-04T00:00:00.000Z'
    })

    expect(result.result).toEqual({
      action: 'invalid_request',
      reason: 'applied feedback requires query or evidenceRef'
    })
    expect(await readActivationEventsFromRoot(memoryRoot)).toEqual([])
  })

  it('rejects non-public feedback events at the record boundary', async () => {
    const { cwd, memoryRoot, memory } = await seedActiveProjectMemory()

    const result = await recordCodexMemoryFeedback({
      cwd,
      memoryId: memory.id,
      contentHash: contentHashForActiveMemory(memory),
      event: 'retrieved',
      query: 'Use the timeout pitfall while fixing tests.',
      now: '2026-06-04T00:00:00.000Z'
    } as unknown as Parameters<typeof recordCodexMemoryFeedback>[0])

    expect(result.result).toEqual({
      action: 'invalid_request',
      reason: 'event must be applied, ignored, corrected, or violated'
    })
    expect(await readActivationEventsFromRoot(memoryRoot)).toEqual([])
  })

  it('returns conflict and writes no event when content hash is stale', async () => {
    const { cwd, memoryRoot, memory } = await seedActiveProjectMemory()

    const result = await recordCodexMemoryFeedback({
      cwd,
      memoryId: memory.id,
      contentHash: 'stale-hash',
      event: 'applied',
      query: 'Use the timeout pitfall while fixing tests.',
      now: '2026-06-04T00:00:00.000Z'
    })

    expect(result.result).toEqual({ action: 'conflict', reason: 'Active memory changed since review' })
    expect(await readActivationEventsFromRoot(memoryRoot)).toEqual([])
  })

  it('rejects pending archived tombstoned and missing memories', async () => {
    const home = await createTempDir('cyrene-codex-memory-feedback-boundary-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-codex-memory-feedback-boundary-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const pending = pendingMemory()
    const archived = archivedSemanticMemory()
    await writePendingMemoriesFromRoot(memoryRoot, [pending])
    await writeSemanticMemoriesFromRoot(memoryRoot, [pending as unknown as SemanticMemory, archived])
    await appendTombstoneFromRoot(memoryRoot, {
      id: 'feedback-tombstone-1',
      memoryId: 'feedback-tombstoned-1',
      normalizedKey: 'feedback-tombstoned',
      domain: 'procedural',
      type: 'procedural_rule',
      scope: 'project',
      reason: 'deleted',
      createdAt: '2026-06-03T00:00:00.000Z'
    })

    for (const memoryId of [pending.id, archived.id, 'feedback-tombstoned-1', 'missing-memory']) {
      const result = await recordCodexMemoryFeedback({
        cwd,
        memoryId,
        contentHash: 'hash',
        event: 'ignored',
        now: '2026-06-04T00:00:00.000Z'
      })
      expect(result.result.action).toBe('not_found')
    }
    expect(await readActivationEventsFromRoot(memoryRoot)).toEqual([])
  })

  it('deduplicates feedback by caller idempotency key and derived context', async () => {
    const { cwd, memoryRoot, memory } = await seedActiveProjectMemory()
    const contentHash = contentHashForActiveMemory(memory)

    const first = await recordCodexMemoryFeedback({
      cwd,
      memoryId: memory.id,
      contentHash,
      event: 'applied',
      query: 'Use the timeout pitfall while fixing tests.',
      idempotencyKey: 'feedback-key-1',
      now: '2026-06-04T00:00:00.000Z'
    })
    const duplicateKey = await recordCodexMemoryFeedback({
      cwd,
      memoryId: memory.id,
      contentHash,
      event: 'applied',
      query: 'A different query must not append when caller key matches.',
      idempotencyKey: 'feedback-key-1',
      now: '2026-06-04T00:01:00.000Z'
    })
    const duplicateContext = await recordCodexMemoryFeedback({
      cwd,
      memoryId: memory.id,
      contentHash,
      event: 'applied',
      query: 'Use the timeout pitfall while fixing tests.',
      now: '2026-06-04T00:02:00.000Z'
    })

    expect(first.result.action).toBe('recorded')
    expect(duplicateKey.result).toMatchObject({
      action: 'duplicate',
      memoryId: memory.id,
      event: 'applied',
      idempotencyKey: 'feedback-key-1'
    })
    expect(duplicateContext.result.action).toBe('duplicate')
    expect(await readActivationEventsFromRoot(memoryRoot)).toHaveLength(1)
  })
})
