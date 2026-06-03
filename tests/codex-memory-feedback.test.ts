import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendActivationEventFailOpen,
  appendActivationEventsFailOpen
} from '../src/codex/memory-feedback.js'
import { readActivationEventsFromRoot } from '../src/memory/memory-store.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
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
})
