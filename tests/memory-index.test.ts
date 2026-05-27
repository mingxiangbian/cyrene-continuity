import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  openMemoryIndexAdapter,
  type MemoryIndexRoot
} from '../src/memory/memory-index.js'
import type { CyreneMemory, PendingMemory } from '../src/memory/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function activeMemory(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'SQLite FTS router keeps project memory local.',
    normalizedKey: 'sqlite-router-project-local',
    evidence: [{ runId: 'run-1', summary: 'Seed active memory.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    tags: ['router'],
    ...overrides
  }
}

function pendingMemory(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Pending router hypothesis stays provisional.',
    normalizedKey: 'pending-router-hypothesis',
    evidence: [{ runId: 'run-pending', summary: 'Seed pending memory.' }],
    source: 'assistant_observed',
    scores: {
      evidenceStrength: 0.8,
      stability: 0.7,
      usefulness: 0.7,
      safety: 0.9,
      sensitivity: 0.2
    },
    seenCount: 1,
    firstSeenAt: '2026-05-25T00:00:00.000Z',
    lastSeenAt: '2026-05-25T00:00:00.000Z',
    expiresAt: '2026-06-24T00:00:00.000Z',
    tags: ['router'],
    ...overrides
  }
}

async function writeJsonLines(filePath: string, values: unknown[]): Promise<void> {
  await writeFile(filePath, values.map((value) => JSON.stringify(value)).join('\n') + '\n', 'utf8')
}

describe('memory SQLite index', () => {
  it('initializes memory.db and reports tokenizer diagnostics', async () => {
    const root = await createTempDir('cyrene-memory-index-init-')
    const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })

    const diagnostics = await adapter.initialize()

    expect(diagnostics.available).toBe(true)
    expect(diagnostics.dbPath).toBe(join(root, 'memory.db'))
    expect(['trigram', 'unicode61']).toContain(diagnostics.ftsTokenizer)
    expect(await readFile(join(root, 'memory.db'))).toBeInstanceOf(Buffer)
  })

  it('syncs active global, active project, and pending records with portability filters', async () => {
    const root = await createTempDir('cyrene-memory-index-sync-')
    const globalRoot = join(root, 'global', 'memory')
    const projectRoot = join(root, 'projects', 'project-a', 'memory')
    const otherProjectRoot = join(root, 'projects', 'project-b', 'memory')
    await mkdir(globalRoot, { recursive: true })
    await mkdir(projectRoot, { recursive: true })
    await mkdir(otherProjectRoot, { recursive: true })
    await writeJsonLines(join(globalRoot, 'index.jsonl'), [
      activeMemory({
        id: 'global-1',
        scope: 'global',
        domain: 'procedural',
        content: 'Global router guidance applies everywhere.',
        normalizedKey: 'global-router-guidance'
      }),
      activeMemory({
        id: 'global-2',
        scope: 'global',
        domain: 'procedural',
        portability: 'local_only',
        content: 'Global local-only router guidance must not enter the global route.',
        normalizedKey: 'global-local-only-router-guidance'
      })
    ])
    await writeJsonLines(join(projectRoot, 'index.jsonl'), [
      activeMemory({ id: 'project-a-1' }),
      activeMemory({
        id: 'project-a-2',
        portability: 'project_family',
        content: 'Project-family router memory waits for a later phase.',
        normalizedKey: 'project-family-router-later'
      })
    ])
    await writeJsonLines(join(otherProjectRoot, 'index.jsonl'), [
      activeMemory({
        id: 'project-b-1',
        content: 'Other project local memory must not leak.',
        normalizedKey: 'other-project-local'
      })
    ])
    await writeJsonLines(join(projectRoot, 'pending.jsonl'), [pendingMemory()])

    const roots: MemoryIndexRoot[] = [
      { memoryRoot: globalRoot, projectId: null, scope: 'global' },
      { memoryRoot: projectRoot, projectId: 'project-a', scope: 'project' },
      { memoryRoot: otherProjectRoot, projectId: 'project-b', scope: 'project' }
    ]
    const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })
    await adapter.rebuildFromRoots({ roots })

    const global = await adapter.queryActive({
      currentProjectId: 'project-a',
      query: 'router guidance',
      route: 'global',
      maxItems: 10,
      maxTokens: 2_000
    })
    const project = await adapter.queryActive({
      currentProjectId: 'project-a',
      query: 'project memory local',
      route: 'project',
      maxItems: 10,
      maxTokens: 2_000
    })
    const pending = await adapter.queryPending({
      currentProjectId: 'project-a',
      query: 'pending hypothesis',
      maxItems: 10,
      maxTokens: 2_000
    })

    expect(global.map((item) => item.memory.id)).toEqual(['global-1'])
    expect(global[0]?.portability).toBe('global')
    expect(project.map((item) => item.memory.id)).toEqual(['project-a-1'])
    expect(project.map((item) => item.memory.id)).not.toContain('project-a-2')
    expect(project.map((item) => item.memory.id)).not.toContain('project-b-1')
    expect(project[0]?.portability).toBe('local_only')
    expect(pending.map((item) => item.memory.id)).toEqual(['pending-1'])
    expect(pending[0]?.provisional).toBe(true)
  })

  it('returns global and current project pending hypotheses without portability filtering', async () => {
    const root = await createTempDir('cyrene-memory-index-pending-')
    const globalRoot = join(root, 'global', 'memory')
    const projectRoot = join(root, 'projects', 'project-a', 'memory')
    const otherProjectRoot = join(root, 'projects', 'project-b', 'memory')
    await mkdir(globalRoot, { recursive: true })
    await mkdir(projectRoot, { recursive: true })
    await mkdir(otherProjectRoot, { recursive: true })
    await writeJsonLines(join(globalRoot, 'pending.jsonl'), [
      pendingMemory({
        id: 'global-pending-1',
        scope: 'global',
        portability: 'local_only',
        content: 'Global pending router candidate remains provisional.',
        normalizedKey: 'global-pending-router-candidate'
      })
    ])
    await writeJsonLines(join(projectRoot, 'pending.jsonl'), [
      pendingMemory({
        id: 'project-pending-1',
        portability: 'project_family',
        content: 'Project pending router family candidate remains provisional.',
        normalizedKey: 'project-pending-router-family-candidate'
      })
    ])
    await writeJsonLines(join(otherProjectRoot, 'pending.jsonl'), [
      pendingMemory({
        id: 'other-project-pending-1',
        content: 'Other project pending router candidate must not leak.',
        normalizedKey: 'other-project-pending-router-candidate'
      })
    ])

    const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })
    await adapter.rebuildFromRoots({
      roots: [
        { memoryRoot: globalRoot, projectId: null, scope: 'global' },
        { memoryRoot: projectRoot, projectId: 'project-a', scope: 'project' },
        { memoryRoot: otherProjectRoot, projectId: 'project-b', scope: 'project' }
      ]
    })

    const pending = await adapter.queryPending({
      currentProjectId: 'project-a',
      query: 'pending router candidate',
      maxItems: 10,
      maxTokens: 2_000
    })

    expect(pending.map((item) => item.memory.id)).toEqual(['global-pending-1', 'project-pending-1'])
    expect(pending.every((item) => item.provisional)).toBe(true)
  })

  it('enforces maxTokens before selecting the first result', async () => {
    const root = await createTempDir('cyrene-memory-index-budget-')
    const projectRoot = join(root, 'projects', 'project-a', 'memory')
    await mkdir(projectRoot, { recursive: true })
    await writeJsonLines(join(projectRoot, 'index.jsonl'), [
      activeMemory({
        id: 'project-a-long',
        content: 'Router '.repeat(40),
        normalizedKey: 'router-long-budget'
      })
    ])

    const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })
    await adapter.rebuildFromRoots({
      roots: [{ memoryRoot: projectRoot, projectId: 'project-a', scope: 'project' }]
    })

    await expect(adapter.queryActive({
      currentProjectId: 'project-a',
      query: 'router',
      route: 'project',
      maxItems: 10,
      maxTokens: 1
    })).resolves.toEqual([])
  })

  it('keeps FTS scoring available across query initialization', async () => {
    const root = await createTempDir('cyrene-memory-index-fts-')
    const projectRoot = join(root, 'projects', 'project-a', 'memory')
    await mkdir(projectRoot, { recursive: true })
    await writeJsonLines(join(projectRoot, 'index.jsonl'), [
      activeMemory({
        id: 'project-a-a',
        content: 'Router score tie without FTS boost.',
        normalizedKey: 'router-score-tie'
      }),
      activeMemory({
        id: 'project-a-z',
        content: 'Router score tie with FTS boost.',
        normalizedKey: 'router-project-fact-indexed',
        tags: ['router', 'project_fact']
      })
    ])

    const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })
    await adapter.rebuildFromRoots({
      roots: [{ memoryRoot: projectRoot, projectId: 'project-a', scope: 'project' }]
    })

    const firstQuery = await adapter.queryActive({
      currentProjectId: 'project-a',
      query: 'project_fact router',
      route: 'project',
      maxItems: 10,
      maxTokens: 2_000
    })
    const secondQuery = await adapter.queryActive({
      currentProjectId: 'project-a',
      query: 'project_fact router',
      route: 'project',
      maxItems: 10,
      maxTokens: 2_000
    })

    expect(firstQuery.map((item) => item.memory.id)).toEqual(['project-a-z', 'project-a-a'])
    expect(secondQuery.map((item) => item.memory.id)).toEqual(['project-a-z', 'project-a-a'])
  })

  it('returns unavailable diagnostics when forced unavailable', async () => {
    const root = await createTempDir('cyrene-memory-index-disabled-')
    const adapter = await openMemoryIndexAdapter({
      dbPath: join(root, 'memory.db'),
      forceUnavailableReason: 'test forced fallback'
    })

    await expect(adapter.queryActive({
      currentProjectId: 'project-a',
      query: 'anything',
      route: 'global',
      maxItems: 10,
      maxTokens: 2_000
    })).resolves.toEqual([])
    expect(adapter.diagnostics()).toMatchObject({
      available: false,
      reason: 'test forced fallback'
    })
  })
})
