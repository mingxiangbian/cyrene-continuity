import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot, ensureCodexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import {
  addCodexProjectAlias,
  deleteCodexProjectMemory,
  isCodexProjectMemoryDisabled,
  listCodexProjects,
  mergeCodexProjects
} from '../src/codex/project-registry.js'
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

  it('deletes project memory while keeping the project disabled for future capture', async () => {
    const home = await createTempDir('cyrene-project-tools-delete-home-')
    vi.stubEnv('HOME', home)
    const projectId = 'disabled-project'
    const memoryRoot = await ensureCodexProjectMemoryRoot(projectId)
    const tracedCwd = await createTempDir('cyrene-project-tools-disabled-repo-')
    await writeFile(join(tracedCwd, 'package.json'), '{"name":"disabled-repo"}\n')
    await writeFile(
      join(memoryRoot, 'hook-trace.jsonl'),
      `${JSON.stringify({
        id: 'trace-1',
        createdAt: '2026-05-29T00:00:00.000Z',
        event: 'stop',
        cwd: tracedCwd,
        summary: 'Stop hook received.',
        signals: []
      })}\n`
    )
    await writeActiveMemoriesFromRoot(memoryRoot, [createActive()])

    const result = await deleteCodexProjectMemory({
      projectId,
      reason: 'Do not capture memory for this repository.',
      now: '2026-05-29T00:00:00.000Z'
    })

    expect(result).toMatchObject({
      projectId,
      disabled: true,
      memoryDeleted: true
    })
    expect(await isCodexProjectMemoryDisabled(projectId)).toBe(true)
    await expect(readFile(join(memoryRoot, 'semantic_memories.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await listCodexProjects()).toEqual([
      expect.objectContaining({
        projectId,
        displayName: 'disabled-repo',
        disabled: true,
        disabledReason: 'Do not capture memory for this repository.',
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
    await writeActiveMemoriesFromRoot(fromRoot, [createActive({ id: 'from-active', content: 'From project memory.' })])
    await writeActiveMemoriesFromRoot(toRoot, [createActive({ id: 'to-active', content: 'To project memory.' })])
    await writeFile(join(fromRoot, 'MODEL_PROFILE.md'), '# Source Profile\n')

    const result = await mergeCodexProjects({ fromProjectId: 'from-project', toProjectId: 'to-project' })

    expect(result.mergedFiles).toContain('semantic_memories.jsonl')
    await expect(readActiveMemoriesFromRoot(toRoot)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ content: 'From project memory.' })])
    )
    await expect(readFile(join(toRoot, 'MODEL_PROFILE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('re-reads target JSONL after waiting for the project merge lock', async () => {
    const home = await createTempDir('cyrene-project-merge-lock-home-')
    vi.stubEnv('HOME', home)
    const fromRoot = await ensureCodexProjectMemoryRoot('from-project')
    const toRoot = await ensureCodexProjectMemoryRoot('to-project')
    const initialTarget = createActive({ id: 'to-active', content: 'Initial target memory.' })
    const concurrentTarget = createActive({ id: 'to-concurrent', content: 'Concurrent target memory.' })

    await writeActiveMemoriesFromRoot(fromRoot, [createActive({ id: 'from-active', content: 'From project memory.' })])
    await writeActiveMemoriesFromRoot(toRoot, [initialTarget])
    const lockDir = join(toRoot, '.maintenance.lock')
    await mkdir(lockDir)

    const mergePromise = mergeCodexProjects({ fromProjectId: 'from-project', toProjectId: 'to-project' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeActiveMemoriesFromRoot(toRoot, [initialTarget, concurrentTarget])
    await rm(lockDir, { recursive: true, force: true })

    const result = await mergePromise

    expect(result.mergedFiles).toContain('semantic_memories.jsonl')
    const merged = await readActiveMemoriesFromRoot(toRoot)
    expect(merged).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: 'Initial target memory.' }),
      expect.objectContaining({ content: 'Concurrent target memory.' }),
      expect.objectContaining({ content: 'From project memory.' })
    ]))
  })

  it('rejects source JSONL symlinks during project merge', async () => {
    const home = await createTempDir('cyrene-project-merge-source-symlink-home-')
    vi.stubEnv('HOME', home)
    const fromRoot = await ensureCodexProjectMemoryRoot('from-project')
    await ensureCodexProjectMemoryRoot('to-project')
    const outsideFile = join(home, 'source-semantic-memories.jsonl')
    await writeFile(outsideFile, `${JSON.stringify(createActive({ id: 'from-active', content: 'Symlinked source memory.' }))}\n`)
    await symlink(outsideFile, join(fromRoot, 'semantic_memories.jsonl'))

    await expect(mergeCodexProjects({ fromProjectId: 'from-project', toProjectId: 'to-project' })).rejects.toThrow(
      /Unsafe project merge source JSONL file/
    )
  })

  it('rejects target JSONL symlinks during project merge without writing through them', async () => {
    const home = await createTempDir('cyrene-project-merge-target-symlink-home-')
    vi.stubEnv('HOME', home)
    const fromRoot = await ensureCodexProjectMemoryRoot('from-project')
    const toRoot = await ensureCodexProjectMemoryRoot('to-project')
    const outsideFile = join(home, 'target-semantic-memories.jsonl')
    await writeActiveMemoriesFromRoot(fromRoot, [createActive({ id: 'from-active', content: 'From project memory.' })])
    await writeFile(outsideFile, `${JSON.stringify(createActive({ id: 'outside-active', content: 'Outside target memory.' }))}\n`)
    await symlink(outsideFile, join(toRoot, 'semantic_memories.jsonl'))

    await expect(mergeCodexProjects({ fromProjectId: 'from-project', toProjectId: 'to-project' })).rejects.toThrow(
      /Unsafe project merge target JSONL file/
    )
    await expect(readFile(outsideFile, 'utf8')).resolves.not.toContain('From project memory.')
  })

  it('rejects corrupted source canonical JSONL during project merge without mutating target or metadata', async () => {
    const home = await createTempDir('cyrene-project-merge-corrupt-source-home-')
    vi.stubEnv('HOME', home)
    const fromRoot = await ensureCodexProjectMemoryRoot('from-project')
    const toRoot = await ensureCodexProjectMemoryRoot('to-project')
    await writeActiveMemoriesFromRoot(fromRoot, [createActive({ id: 'from-active', content: 'From project memory.' })])
    await writeActiveMemoriesFromRoot(toRoot, [createActive({ id: 'to-active', content: 'To project memory.' })])
    const sourceSemanticPath = join(fromRoot, 'semantic_memories.jsonl')
    const targetSemanticPath = join(toRoot, 'semantic_memories.jsonl')
    const corruptedSource = `${await readFile(sourceSemanticPath, 'utf8')}{bad json}\n`
    const originalTarget = await readFile(targetSemanticPath, 'utf8')
    await writeFile(sourceSemanticPath, corruptedSource, 'utf8')

    await expect(mergeCodexProjects({ fromProjectId: 'from-project', toProjectId: 'to-project' })).rejects.toThrow(
      /repair_required/
    )

    await expect(readFile(targetSemanticPath, 'utf8')).resolves.toBe(originalTarget)
    await expect(readFile(targetSemanticPath, 'utf8')).resolves.not.toContain('From project memory.')
    await expect(readFile(targetSemanticPath, 'utf8')).resolves.not.toContain('{bad json}')
    await expect(readFile(join(dirname(fromRoot), 'project.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(dirname(toRoot), 'project.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects corrupted target canonical JSONL during project merge without rewriting target bytes', async () => {
    const home = await createTempDir('cyrene-project-merge-corrupt-target-home-')
    vi.stubEnv('HOME', home)
    const fromRoot = await ensureCodexProjectMemoryRoot('from-project')
    const toRoot = await ensureCodexProjectMemoryRoot('to-project')
    await writeActiveMemoriesFromRoot(fromRoot, [createActive({ id: 'from-active', content: 'From project memory.' })])
    await writeActiveMemoriesFromRoot(toRoot, [createActive({ id: 'to-active', content: 'To project memory.' })])
    const targetSemanticPath = join(toRoot, 'semantic_memories.jsonl')
    const corruptedTarget = `${await readFile(targetSemanticPath, 'utf8')}{bad json}\n`
    await writeFile(targetSemanticPath, corruptedTarget, 'utf8')

    await expect(mergeCodexProjects({ fromProjectId: 'from-project', toProjectId: 'to-project' })).rejects.toThrow(
      /repair_required/
    )

    await expect(readFile(targetSemanticPath, 'utf8')).resolves.toBe(corruptedTarget)
    await expect(readFile(join(dirname(fromRoot), 'project.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(dirname(toRoot), 'project.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('blocks cross-project migration of personal relationship or affective memory', async () => {
    const home = await createTempDir('cyrene-project-merge-gate-home-')
    vi.stubEnv('HOME', home)
    const fromRoot = await ensureCodexProjectMemoryRoot('from-project')
    await ensureCodexProjectMemoryRoot('to-project')
    await writeActiveMemoriesFromRoot(fromRoot, [
      createActive({ id: 'personal-memory', domain: 'personal', type: 'user_preference' }),
      createActive({ id: 'relationship-memory', domain: 'relationship', type: 'relationship_boundary' }),
      createActive({ id: 'affective-memory', domain: 'affective', type: 'affective_pattern' })
    ])

    await expect(mergeCodexProjects({
      fromProjectId: 'from-project',
      toProjectId: 'to-project'
    })).rejects.toThrow('Project merge blocked by eval gate: cross_project_leak_eval')
  })
})
