import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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

  it('rejects dot-only project ids before touching project roots', async () => {
    const home = await createTempDir('cyrene-project-tools-dot-home-')
    vi.stubEnv('HOME', home)

    await expect(addCodexProjectAlias({ projectId: '.', alias: 'dot-project' })).rejects.toThrow('Invalid projectId: .')
    await expect(mergeCodexProjects({ fromProjectId: '..', toProjectId: 'target-project' })).rejects.toThrow(
      'Invalid projectId: ..'
    )
    await expect(readFile(join(home, '.cyrene', 'codex', 'projects', '.', 'memory', 'metadata.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
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

  it('re-reads target JSONL after waiting for the project merge lock', async () => {
    const home = await createTempDir('cyrene-project-merge-lock-home-')
    vi.stubEnv('HOME', home)
    const fromRoot = await ensureCodexProjectMemoryRoot('from-project')
    const toRoot = await ensureCodexProjectMemoryRoot('to-project')
    const initialTarget = createActive({ id: 'to-active', content: 'Initial target memory.' })
    const concurrentTarget = createActive({ id: 'to-concurrent', content: 'Concurrent target memory.' })

    await writeFile(
      join(fromRoot, 'index.jsonl'),
      `${JSON.stringify(createActive({ id: 'from-active', content: 'From project memory.' }))}\n`
    )
    await writeFile(join(toRoot, 'index.jsonl'), `${JSON.stringify(initialTarget)}\n`)
    const lockDir = join(toRoot, '.maintenance.lock')
    await mkdir(lockDir)

    const mergePromise = mergeCodexProjects({ fromProjectId: 'from-project', toProjectId: 'to-project' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeFile(join(toRoot, 'index.jsonl'), [initialTarget, concurrentTarget].map((memory) => JSON.stringify(memory)).join('\n') + '\n')
    await rm(lockDir, { recursive: true, force: true })

    const result = await mergePromise

    expect(result.mergedFiles).toContain('index.jsonl')
    const merged = await readFile(join(toRoot, 'index.jsonl'), 'utf8')
    expect(merged).toContain('Initial target memory.')
    expect(merged).toContain('Concurrent target memory.')
    expect(merged).toContain('From project memory.')
  })

  it('rejects source JSONL symlinks during project merge', async () => {
    const home = await createTempDir('cyrene-project-merge-source-symlink-home-')
    vi.stubEnv('HOME', home)
    const fromRoot = await ensureCodexProjectMemoryRoot('from-project')
    await ensureCodexProjectMemoryRoot('to-project')
    const outsideFile = join(home, 'source-index.jsonl')
    await writeFile(outsideFile, `${JSON.stringify(createActive({ id: 'from-active', content: 'Symlinked source memory.' }))}\n`)
    await symlink(outsideFile, join(fromRoot, 'index.jsonl'))

    await expect(mergeCodexProjects({ fromProjectId: 'from-project', toProjectId: 'to-project' })).rejects.toThrow(
      /Unsafe project merge source JSONL file/
    )
  })

  it('rejects target JSONL symlinks during project merge without writing through them', async () => {
    const home = await createTempDir('cyrene-project-merge-target-symlink-home-')
    vi.stubEnv('HOME', home)
    const fromRoot = await ensureCodexProjectMemoryRoot('from-project')
    const toRoot = await ensureCodexProjectMemoryRoot('to-project')
    const outsideFile = join(home, 'target-index.jsonl')
    await writeFile(
      join(fromRoot, 'index.jsonl'),
      `${JSON.stringify(createActive({ id: 'from-active', content: 'From project memory.' }))}\n`
    )
    await writeFile(outsideFile, `${JSON.stringify(createActive({ id: 'outside-active', content: 'Outside target memory.' }))}\n`)
    await symlink(outsideFile, join(toRoot, 'index.jsonl'))

    await expect(mergeCodexProjects({ fromProjectId: 'from-project', toProjectId: 'to-project' })).rejects.toThrow(
      /Unsafe project merge target JSONL file/
    )
    await expect(readFile(outsideFile, 'utf8')).resolves.not.toContain('From project memory.')
  })

  it('blocks cross-project migration of personal relationship or affective memory', async () => {
    const home = await createTempDir('cyrene-project-merge-gate-home-')
    vi.stubEnv('HOME', home)
    const fromRoot = await ensureCodexProjectMemoryRoot('from-project')
    await ensureCodexProjectMemoryRoot('to-project')
    await writeFile(
      join(fromRoot, 'index.jsonl'),
      [
        createActive({ id: 'personal-memory', domain: 'personal', type: 'user_preference' }),
        createActive({ id: 'relationship-memory', domain: 'relationship', type: 'relationship_boundary' }),
        createActive({ id: 'affective-memory', domain: 'affective', type: 'affective_pattern' })
      ].map((memory) => JSON.stringify(memory)).join('\n') + '\n'
    )

    await expect(mergeCodexProjects({
      fromProjectId: 'from-project',
      toProjectId: 'to-project'
    })).rejects.toThrow('Project merge blocked by eval gate: cross_project_leak_eval')
  })
})
