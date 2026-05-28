import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot, ensureCodexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import {
  addCodexProjectAlias,
  listCodexProjects,
  mergeCodexProjects
} from '../src/codex/project-registry.js'
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

function createActive(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'project-tools-active-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Project tools active memory.',
    normalizedKey: 'project-tools-active-memory',
    evidence: [{ runId: 'run-project-tools', summary: 'Seed active memory.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.85,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-28T00:00:00.000Z',
    tags: ['project-tools'],
    ...overrides
  }
}

describe('Codex project tools', () => {
  it('adds aliases to project metadata and lists known project roots', async () => {
    const home = await createTempDir('cyrene-project-tools-home-')
    vi.stubEnv('HOME', home)
    const projectId = 'old-project-id'

    await addCodexProjectAlias({ projectId, alias: 'repo-renamed' })

    const projects = await listCodexProjects()
    expect(projects).toEqual([
      expect.objectContaining({
        projectId,
        aliases: ['repo-renamed'],
        counts: expect.objectContaining({ active: 0, pending: 0, tombstones: 0 })
      })
    ])
  })

  it('explicitly merges memory JSONL from one project to another without copying model profile', async () => {
    const home = await createTempDir('cyrene-project-merge-home-')
    vi.stubEnv('HOME', home)
    const fromRoot = await ensureCodexProjectMemoryRoot('from-project')
    const toRoot = await ensureCodexProjectMemoryRoot('to-project')
    await mkdir(codexProjectMemoryRoot('from-project'), { recursive: true })
    await writeFile(
      join(fromRoot, 'index.jsonl'),
      `${JSON.stringify(createActive({ id: 'from-active', content: 'From project memory.' }))}\n`
    )
    await writeFile(
      join(toRoot, 'index.jsonl'),
      `${JSON.stringify(createActive({ id: 'to-active', content: 'To project memory.' }))}\n`
    )
    await writeFile(join(fromRoot, 'MODEL_PROFILE.md'), '# Source Profile\n')

    const result = await mergeCodexProjects({ fromProjectId: 'from-project', toProjectId: 'to-project' })

    expect(result.mergedFiles).toContain('index.jsonl')
    await expect(readFile(join(toRoot, 'index.jsonl'), 'utf8')).resolves.toContain('From project memory.')
    await expect(readFile(join(toRoot, 'MODEL_PROFILE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
