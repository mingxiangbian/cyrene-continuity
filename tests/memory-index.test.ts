import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deriveDeterministicMemoryEdges,
  openMemoryIndexAdapter,
  type MemoryIndexRoot
} from '../src/memory/memory-index.js'
import { assertEmbeddingSafeText } from '../src/memory/embedding-provider.js'
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

  it('creates embedding cache tables and reports disabled diagnostics by default', async () => {
    const root = await createTempDir('cyrene-memory-index-embedding-schema-')
    const dbPath = join(root, 'memory.db')
    const adapter = await openMemoryIndexAdapter({ dbPath })

    const diagnostics = await adapter.initialize()
    const require = createRequire(import.meta.url)
    const sqlite = require('node:sqlite') as { DatabaseSync: new (path: string) => { prepare(sql: string): { all(): Array<{ name: string }> }; close(): void } }
    const db = new sqlite.DatabaseSync(dbPath)
    const rows = db.prepare("select name from sqlite_master where type = 'table' and name like '%_embeddings' order by name").all()
    db.close()

    expect(rows.map((row) => row.name)).toEqual(['memory_embeddings', 'project_embeddings'])
    expect(diagnostics.embedding).toMatchObject({ enabled: false, cacheHits: 0, cacheMisses: 0 })
  })

  it('falls back to structured results when an enabled embedding provider fails', async () => {
    const previous = process.env.CYRENE_EMBEDDING_PROVIDER
    process.env.CYRENE_EMBEDDING_PROVIDER = 'fail'
    try {
      const root = await createTempDir('cyrene-memory-index-embedding-fallback-')
      const projectRoot = join(root, 'projects', 'project-a', 'memory')
      await mkdir(projectRoot, { recursive: true })
      await writeJsonLines(join(projectRoot, 'index.jsonl'), [activeMemory({ id: 'project-a-1' })])
      const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })
      await adapter.rebuildFromRoots({ roots: [{ memoryRoot: projectRoot, projectId: 'project-a', scope: 'project' }] })

      const results = await adapter.queryActive({
        currentProjectId: 'project-a',
        query: 'sqlite router',
        route: 'project',
        maxItems: 10,
        maxTokens: 2_000
      })

      expect(results.map((item) => item.memory.id)).toEqual(['project-a-1'])
      expect(adapter.diagnostics().embedding).toMatchObject({
        enabled: true,
        provider: 'fail',
        fallbackReason: expect.stringContaining('failed')
      })
    } finally {
      if (previous === undefined) {
        delete process.env.CYRENE_EMBEDDING_PROVIDER
      } else {
        process.env.CYRENE_EMBEDDING_PROVIDER = previous
      }
    }
  })

  it('rejects unsafe embedding payloads before provider calls', () => {
    expect(() => assertEmbeddingSafeText('Use /Users/phoenix/private/config.json.')).toThrow(/unsafe embedding text/)
    expect(() => assertEmbeddingSafeText('Clone git@github.com:secret/private.git.')).toThrow(/unsafe embedding text/)
    expect(() => assertEmbeddingSafeText('Token sk-123456789012345678901234567890123456789012345678.')).toThrow(/unsafe embedding text/)
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

  it('skips an oversized first result and returns later memories within the token budget', async () => {
    const root = await createTempDir('cyrene-memory-index-budget-skip-')
    const projectRoot = join(root, 'projects', 'project-a', 'memory')
    await mkdir(projectRoot, { recursive: true })
    await writeJsonLines(join(projectRoot, 'index.jsonl'), [
      activeMemory({
        id: 'project-a-oversized',
        content: 'Router '.repeat(80),
        normalizedKey: 'router-oversized-budget',
        scores: {
          evidenceStrength: 0.99,
          stability: 0.99,
          usefulness: 0.99,
          safety: 0.99,
          sensitivity: 0.01
        }
      }),
      activeMemory({
        id: 'project-a-small',
        content: 'Router small memory.',
        normalizedKey: 'router-small-budget',
        scores: {
          evidenceStrength: 0.5,
          stability: 0.5,
          usefulness: 0.5,
          safety: 0.9,
          sensitivity: 0.1
        }
      })
    ])

    const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })
    await adapter.rebuildFromRoots({
      roots: [{ memoryRoot: projectRoot, projectId: 'project-a', scope: 'project' }]
    })

    const result = await adapter.queryActive({
      currentProjectId: 'project-a',
      query: 'router',
      route: 'project',
      maxItems: 10,
      maxTokens: 6
    })

    expect(result.map((item) => item.memory.id)).toEqual(['project-a-small'])
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

  it('stores project metadata and project similarity rows across rebuilds', async () => {
    const root = await createTempDir('cyrene-memory-index-projects-')
    const projectRoot = join(root, 'projects', 'project-a', 'memory')
    await mkdir(projectRoot, { recursive: true })
    await writeJsonLines(join(projectRoot, 'index.jsonl'), [activeMemory({ id: 'project-a-memory' })])
    const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })

    await adapter.initialize()
    await adapter.upsertProjectMetadata({
      projectId: 'project-a',
      displayName: 'project-a',
      packageManager: 'npm',
      languages: ['typescript'],
      frameworks: ['mcp'],
      dependencyNames: ['@modelcontextprotocol/sdk'],
      domainTags: ['mcp'],
      updatedAt: '2026-05-27T00:00:00.000Z'
    })
    await adapter.upsertProjectMetadata({
      projectId: 'project-b',
      displayName: 'project-b',
      packageManager: 'npm',
      languages: ['typescript'],
      frameworks: ['mcp', 'vitest'],
      dependencyNames: ['@modelcontextprotocol/sdk', 'vitest'],
      domainTags: ['mcp'],
      updatedAt: '2026-05-27T00:00:00.000Z'
    })
    await adapter.upsertProjectSimilarity({
      sourceProjectId: 'project-a',
      targetProjectId: 'project-b',
      score: 0.83,
      reason: ['framework:mcp'],
      updatedAt: '2026-05-27T00:00:00.000Z'
    })
    await adapter.rebuildFromRoots({
      roots: [{ memoryRoot: projectRoot, projectId: 'project-a', scope: 'project' }]
    })

    await expect(adapter.listProjectMetadata()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ projectId: 'project-a', frameworks: ['mcp'] }),
      expect.objectContaining({ projectId: 'project-b', frameworks: ['mcp', 'vitest'] })
    ]))
    await expect(adapter.listProjectSimilarities('project-a')).resolves.toEqual([
      expect.objectContaining({
        sourceProjectId: 'project-a',
        targetProjectId: 'project-b',
        score: 0.83,
        reason: ['framework:mcp']
      })
    ])
  })

  it('queries only eligible similar-project active memories', async () => {
    const root = await createTempDir('cyrene-memory-index-similar-')
    const currentRoot = join(root, 'projects', 'project-a', 'memory')
    const similarRoot = join(root, 'projects', 'project-b', 'memory')
    await mkdir(currentRoot, { recursive: true })
    await mkdir(similarRoot, { recursive: true })
    await writeJsonLines(join(currentRoot, 'index.jsonl'), [
      activeMemory({
        id: 'current-similar',
        portability: 'similar_project',
        content: 'Current project similar-portable memory is not a similar hint.',
        normalizedKey: 'current-similar-memory'
      })
    ])
    await writeJsonLines(join(similarRoot, 'index.jsonl'), [
      activeMemory({
        id: 'similar-procedural',
        domain: 'procedural',
        type: 'procedural_rule',
        portability: 'similar_project',
        content: 'MCP plugin projects should keep generated runtime rebuilds explicit.',
        normalizedKey: 'mcp-plugin-runtime-rebuild',
        tags: ['mcp', 'plugin']
      }),
      activeMemory({
        id: 'similar-local',
        domain: 'procedural',
        type: 'procedural_rule',
        portability: 'local_only',
        content: 'Other project local-only detail must not appear.',
        normalizedKey: 'other-local-only'
      }),
      activeMemory({
        id: 'similar-personal',
        domain: 'personal',
        type: 'user_preference',
        portability: 'similar_project',
        content: 'Personal preference must not appear as a similar hint.',
        normalizedKey: 'personal-similar'
      })
    ])
    const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })
    await adapter.rebuildFromRoots({
      roots: [
        { memoryRoot: currentRoot, projectId: 'project-a', scope: 'project' },
        { memoryRoot: similarRoot, projectId: 'project-b', scope: 'project' }
      ]
    })

    const hints = await adapter.querySimilarActive({
      currentProjectId: 'project-a',
      query: 'mcp plugin runtime',
      targetProjects: [
        { projectId: 'project-a', similarityScore: 0.99, displayName: 'current' },
        { projectId: 'project-b', similarityScore: 0.75, displayName: 'project-b' }
      ],
      maxItems: 10,
      maxTokens: 2_000
    })

    expect(hints.map((item) => item.memory.id)).toEqual(['similar-procedural'])
    expect(hints[0]).toMatchObject({
      portability: 'similar_project',
      homeProjectId: 'project-b',
      similarityScore: 0.75,
      sourceProjectName: 'project-b'
    })
  })

  it('indexes duplicate memory ids across project roots without collisions', async () => {
    const root = await createTempDir('cyrene-memory-index-duplicate-ids-')
    const currentRoot = join(root, 'projects', 'project-a', 'memory')
    const similarRoot = join(root, 'projects', 'project-b', 'memory')
    await mkdir(currentRoot, { recursive: true })
    await mkdir(similarRoot, { recursive: true })
    await writeJsonLines(join(currentRoot, 'index.jsonl'), [
      activeMemory({
        id: 'shared-memory-id',
        content: 'Current project duplicate id memory stays local.',
        normalizedKey: 'current-duplicate-id-memory'
      })
    ])
    await writeJsonLines(join(similarRoot, 'index.jsonl'), [
      activeMemory({
        id: 'shared-memory-id',
        domain: 'procedural',
        type: 'procedural_rule',
        portability: 'similar_project',
        content: 'Similar project duplicate id guidance remains retrievable.',
        normalizedKey: 'similar-duplicate-id-guidance',
        tags: ['duplicate']
      })
    ])
    const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })

    await adapter.rebuildFromRoots({
      roots: [
        { memoryRoot: currentRoot, projectId: 'project-a', scope: 'project' },
        { memoryRoot: similarRoot, projectId: 'project-b', scope: 'project' }
      ]
    })

    const project = await adapter.queryActive({
      currentProjectId: 'project-a',
      query: 'current duplicate',
      route: 'project',
      maxItems: 10,
      maxTokens: 2_000
    })
    const similar = await adapter.querySimilarActive({
      currentProjectId: 'project-a',
      query: 'similar duplicate guidance',
      targetProjects: [{ projectId: 'project-b', similarityScore: 0.75, displayName: 'project-b' }],
      maxItems: 10,
      maxTokens: 2_000
    })

    expect(project.map((item) => item.memory.content)).toEqual(['Current project duplicate id memory stays local.'])
    expect(similar.map((item) => item.memory.content)).toEqual(['Similar project duplicate id guidance remains retrievable.'])
    expect(project[0]?.memory.id).toBe('shared-memory-id')
    expect(similar[0]?.memory.id).toBe('shared-memory-id')
    expect(similar[0]?.homeProjectId).toBe('project-b')
  })

  it('derives approved deterministic file memory edges from evidence trace refs', () => {
    const edges = deriveDeterministicMemoryEdges(activeMemory({
      id: 'memory-1',
      evidence: [{
        summary: 'Route implementation.',
        traceRefs: ['src/codex/codex-ui-api.ts', '../outside.ts', 'not-a-file-ref']
      }]
    }), '2026-05-30T00:00:00.000Z')

    expect(edges).toEqual([expect.objectContaining({
      fromId: 'memory-1',
      fromKind: 'memory',
      toId: 'src/codex/codex-ui-api.ts',
      toKind: 'file',
      edgeType: 'memory_mentions_file',
      weight: 1,
      source: 'deterministic',
      status: 'approved',
      createdAt: '2026-05-30T00:00:00.000Z'
    })])
  })

  it('stores memory edges and returns approved graph neighbors', async () => {
    const root = await createTempDir('cyrene-memory-index-edges-')
    const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })
    await adapter.initialize()

    await adapter.upsertMemoryEdge({
      id: 'edge-approved',
      fromId: 'memory-1',
      fromKind: 'memory',
      toId: 'src/codex/codex-ui-api.ts',
      toKind: 'file',
      edgeType: 'memory_mentions_file',
      weight: 1,
      source: 'deterministic',
      status: 'approved',
      createdAt: '2026-05-30T00:00:00.000Z'
    })
    await adapter.upsertMemoryEdge({
      id: 'edge-pending',
      fromId: 'memory-1',
      fromKind: 'memory',
      toId: 'src/codex/continuity-context.ts',
      toKind: 'file',
      edgeType: 'memory_mentions_file',
      weight: 0.5,
      source: 'model',
      status: 'pending',
      createdAt: '2026-05-30T00:00:00.000Z'
    })

    const edges = await adapter.queryMemoryEdges({ fromId: 'memory-1', status: 'approved' })

    expect(edges).toEqual([expect.objectContaining({
      id: 'edge-approved',
      edgeType: 'memory_mentions_file',
      toId: 'src/codex/codex-ui-api.ts',
      source: 'deterministic',
      status: 'approved'
    })])
  })

  it('keeps deterministic memory edges distinct for duplicate raw ids across roots', async () => {
    const root = await createTempDir('cyrene-memory-index-edge-duplicate-ids-')
    const currentRoot = join(root, 'projects', 'project-a', 'memory')
    const similarRoot = join(root, 'projects', 'project-b', 'memory')
    await mkdir(currentRoot, { recursive: true })
    await mkdir(similarRoot, { recursive: true })
    await writeJsonLines(join(currentRoot, 'index.jsonl'), [
      activeMemory({
        id: 'shared-memory-id',
        content: 'Current project duplicate id memory mentions the shared file.',
        normalizedKey: 'current-duplicate-edge-memory',
        evidence: [{ summary: 'Shared trace ref.', traceRefs: ['src/shared.ts'] }]
      })
    ])
    await writeJsonLines(join(similarRoot, 'index.jsonl'), [
      activeMemory({
        id: 'shared-memory-id',
        domain: 'procedural',
        type: 'procedural_rule',
        portability: 'similar_project',
        content: 'Similar project duplicate id memory mentions the same shared file.',
        normalizedKey: 'similar-duplicate-edge-memory',
        evidence: [{ summary: 'Shared trace ref.', traceRefs: ['src/shared.ts'] }]
      })
    ])
    const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })

    await adapter.rebuildFromRoots({
      roots: [
        { memoryRoot: currentRoot, projectId: 'project-a', scope: 'project' },
        { memoryRoot: similarRoot, projectId: 'project-b', scope: 'project' }
      ]
    })

    const edges = await adapter.queryMemoryEdges({ toId: 'src/shared.ts', status: 'approved' })

    expect(edges).toHaveLength(2)
    expect(new Set(edges.map((edge) => edge.id)).size).toBe(2)
    expect(new Set(edges.map((edge) => edge.fromId)).size).toBe(2)
    expect(edges.map((edge) => JSON.parse(edge.fromId))).toEqual(expect.arrayContaining([
      ['project', 'project-a', 'shared-memory-id'],
      ['project', 'project-b', 'shared-memory-id']
    ]))
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
