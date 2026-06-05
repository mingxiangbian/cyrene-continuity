import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearCodexSessionHints,
  readCodexSessionHints,
  replaceCodexSessionHints
} from '../src/codex/session-hints.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('session hints', () => {
  it('replaces hints instead of appending', async () => {
    const root = await createTempDir('cyrene-session-hints-')
    await replaceCodexSessionHints(root, {
      sessionId: 's1',
      projectId: 'p1',
      hints: [{ id: 'h1', sourceProjectId: 'p2', summary: 'First hint.', createdAt: '2026-06-05T00:00:00.000Z' }],
      now: '2026-06-05T00:00:00.000Z'
    })
    await replaceCodexSessionHints(root, {
      sessionId: 's1',
      projectId: 'p1',
      hints: [
        { id: 'h2', sourceProjectId: 'p3', summary: 'Second hint.', createdAt: '2026-06-05T01:00:00.000Z' }
      ],
      now: '2026-06-05T01:00:00.000Z'
    })

    const hints = await readCodexSessionHints(root, {
      sessionId: 's1',
      projectId: 'p1',
      now: '2026-06-05T01:00:00.000Z'
    })
    expect(hints.map((hint) => hint.id)).toEqual(['h2'])
  })

  it('clears hints on project switch', async () => {
    const root = await createTempDir('cyrene-session-hints-clear-')
    await replaceCodexSessionHints(root, {
      sessionId: 's1',
      projectId: 'p1',
      hints: [{ id: 'h1', sourceProjectId: 'p2', summary: 'Hint.', createdAt: '2026-06-05T00:00:00.000Z' }],
      now: '2026-06-05T00:00:00.000Z'
    })
    await clearCodexSessionHints(root)
    await expect(
      readCodexSessionHints(root, {
        sessionId: 's1',
        projectId: 'p1',
        now: '2026-06-05T00:00:00.000Z'
      })
    ).resolves.toEqual([])
  })

  it('returns no hints for a different session or project', async () => {
    const root = await createTempDir('cyrene-session-hints-match-')
    await replaceCodexSessionHints(root, {
      sessionId: 's1',
      projectId: 'p1',
      hints: [{ id: 'h1', sourceProjectId: 'p2', summary: 'Hint.', createdAt: '2026-06-05T00:00:00.000Z' }],
      now: '2026-06-05T00:00:00.000Z'
    })

    await expect(
      readCodexSessionHints(root, {
        sessionId: 's2',
        projectId: 'p1',
        now: '2026-06-05T00:00:00.000Z'
      })
    ).resolves.toEqual([])
    await expect(
      readCodexSessionHints(root, {
        sessionId: 's1',
        projectId: 'p2',
        now: '2026-06-05T00:00:00.000Z'
      })
    ).resolves.toEqual([])
  })

  it('expires hints after the default eight hour ttl', async () => {
    const root = await createTempDir('cyrene-session-hints-ttl-')
    await replaceCodexSessionHints(root, {
      sessionId: 's1',
      projectId: 'p1',
      hints: [{ id: 'h1', sourceProjectId: 'p2', summary: 'Hint.', createdAt: '2026-06-05T00:00:00.000Z' }],
      now: '2026-06-05T00:00:00.000Z'
    })

    await expect(
      readCodexSessionHints(root, {
        sessionId: 's1',
        projectId: 'p1',
        now: '2026-06-05T08:00:01.000Z'
      })
    ).resolves.toEqual([])
  })
})
