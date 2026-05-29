import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  codexGlobalRoot,
  codexProjectMemoryRoot,
  ensureCodexProjectMemoryRoot
} from '../src/codex/codex-memory-root.js'
import { readActiveMemoriesFromRoot, writeActiveMemoriesFromRoot } from '../src/memory/memory-store.js'
import type { CyreneMemory } from '../src/memory/types.js'

const originalHome = process.env.HOME
const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('Codex memory root', () => {
  it('stores Codex project memory under ~/.cyrene/codex/projects/<projectId>/memory', async () => {
    const home = await createTempDir('cyrene-codex-home-')
    process.env.HOME = home

    expect(codexGlobalRoot()).toBe(join(home, '.cyrene', 'codex'))
    expect(codexProjectMemoryRoot('project-1')).toBe(
      join(home, '.cyrene', 'codex', 'projects', 'project-1', 'memory')
    )

    const ensured = await ensureCodexProjectMemoryRoot('project-1')
    expect(ensured).toBe(await realpath(join(home, '.cyrene', 'codex', 'projects', 'project-1', 'memory')))
  })

  it('reads active memories from an explicit memory root', async () => {
    const root = await createTempDir('cyrene-codex-memory-root-')
    await writeFile(join(root, 'index.jsonl'), JSON.stringify(createMemory()) + '\n')

    await expect(readActiveMemoriesFromRoot(root)).resolves.toMatchObject([
      {
        id: 'memory-1',
        content: 'Codex memory is isolated.'
      }
    ])
  })

  it('refuses explicit memory roots that are symlinks', async () => {
    const parent = await createTempDir('cyrene-codex-memory-parent-')
    const outside = await createTempDir('cyrene-codex-memory-outside-')
    await mkdir(join(outside, 'memory'), { recursive: true })
    await symlink(join(outside, 'memory'), join(parent, 'memory'))

    await expect(readActiveMemoriesFromRoot(join(parent, 'memory'))).rejects.toThrow(/memory symlink/)
    await expect(readFile(join(outside, 'memory', 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to read active memories through symlinked memory data files', async () => {
    const root = await createTempDir('cyrene-codex-memory-root-')
    const outside = await createTempDir('cyrene-codex-memory-outside-')
    await writeFile(join(outside, 'index.jsonl'), JSON.stringify(createMemory()) + '\n')
    await symlink(join(outside, 'index.jsonl'), join(root, 'index.jsonl'))

    await expect(readActiveMemoriesFromRoot(root)).rejects.toThrow(/memory data file symlink/)
  })

  it('refuses to write active memories through symlinked memory data files', async () => {
    const root = await createTempDir('cyrene-codex-memory-root-')
    const outside = await createTempDir('cyrene-codex-memory-outside-')
    const outsideIndex = join(outside, 'index.jsonl')
    await writeFile(outsideIndex, 'outside target must stay unchanged\n')
    await symlink(outsideIndex, join(root, 'index.jsonl'))

    await expect(writeActiveMemoriesFromRoot(root, [createMemory()])).rejects.toThrow(/memory data file symlink/)
    await expect(readFile(outsideIndex, 'utf8')).resolves.toBe('outside target must stay unchanged\n')
  })

  it('refuses to create Codex memory under a symlinked project root', async () => {
    const home = await createTempDir('cyrene-codex-home-')
    process.env.HOME = home
    const outside = await createTempDir('cyrene-codex-project-outside-')
    await mkdir(join(home, '.cyrene', 'codex', 'projects'), { recursive: true })
    await symlink(outside, join(home, '.cyrene', 'codex', 'projects', 'project-1'))

    await expect(ensureCodexProjectMemoryRoot('project-1')).rejects.toThrow(/memory symlink/)
    await expect(lstat(join(outside, 'memory'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(outside, 'memory', 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(outside, 'memory', 'MEMORY.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

function createMemory(): CyreneMemory {
  return {
    id: 'memory-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Codex memory is isolated.',
    normalizedKey: 'codex-memory-isolated',
    evidence: [{ runId: 'run-1', summary: 'Test evidence.' }],
    source: 'assistant_observed',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.9,
      usefulness: 0.8,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    tags: []
  }
}
