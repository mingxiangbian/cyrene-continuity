import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendEpisodeMemoryFromRoot,
  readEpisodeMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type { EpisodeMemory } from '../src/memory/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function episode(overrides: Partial<EpisodeMemory> = {}): EpisodeMemory {
  return {
    id: 'episode-1',
    projectId: 'project-1',
    title: 'Stop hook episode',
    summary: '用户讨论了 admission gate rollout。',
    actions: ['读取 v1.0.0 plan'],
    decisions: ['采用分阶段主干串行加阶段内并行'],
    failures: [],
    openQuestions: [],
    changedFiles: ['benchmark/fixtures/example.md'],
    commandsRun: ['npm run typecheck'],
    toolNames: ['exec_command'],
    sourceTraceIds: ['session-1:turn-1'],
    createdAt: '2026-05-31T00:00:00.000Z',
    ...overrides
  }
}

describe('Episode memory store', () => {
  it('appends and reads episode memories from a memory root', async () => {
    const root = await createTempDir('cyrene-episode-root-')

    await appendEpisodeMemoryFromRoot(root, episode())
    await appendEpisodeMemoryFromRoot(root, episode({ id: 'episode-2', title: 'Second episode' }))

    await expect(readEpisodeMemoriesFromRoot(root)).resolves.toEqual([
      episode(),
      episode({ id: 'episode-2', title: 'Second episode' })
    ])
    await expect(readFile(join(root, 'episodes.jsonl'), 'utf8')).resolves.toContain('"id":"episode-1"')
  })

  it('returns an empty list when episodes file is missing', async () => {
    const root = await createTempDir('cyrene-episode-empty-root-')

    await expect(readEpisodeMemoriesFromRoot(root)).resolves.toEqual([])
  })

  it('refuses to append episodes through a symlinked data file', async () => {
    const root = await createTempDir('cyrene-episode-root-')
    const outside = await createTempDir('cyrene-episode-outside-')
    const outsideEpisodes = join(outside, 'episodes.jsonl')
    await mkdir(dirname(join(root, 'episodes.jsonl')), { recursive: true })
    await writeFile(outsideEpisodes, 'outside target must stay unchanged\n')
    await symlink(outsideEpisodes, join(root, 'episodes.jsonl'))

    await expect(appendEpisodeMemoryFromRoot(root, episode())).rejects.toThrow(/memory data file symlink/)
    await expect(readFile(outsideEpisodes, 'utf8')).resolves.toBe('outside target must stay unchanged\n')
  })
})
