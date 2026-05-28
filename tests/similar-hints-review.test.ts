import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { codexMemoryDbPath } from '../src/codex/codex-memory-index.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import {
  explainSimilarHints,
  markSimilarHintTransferable,
  reviewHashForSimilarHintMemory
} from '../src/codex/similar-hints-review.js'
import { openMemoryIndexAdapter } from '../src/memory/memory-index.js'
import type { CyreneMemory, MemoryEvent } from '../src/memory/types.js'

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

function activeMemory(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'MCP plugin projects should rebuild generated runtime explicitly.',
    normalizedKey: 'mcp-plugin-runtime-rebuild',
    evidence: [{ runId: 'run-1', sourceKind: 'user_explicit', summary: 'User asked for this rule.' }],
    source: 'user_explicit',
    portability: 'local_only',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    tags: ['mcp'],
    ...overrides
  }
}

async function writeActive(memoryRoot: string, memories: CyreneMemory[]): Promise<void> {
  await mkdir(memoryRoot, { recursive: true })
  await writeFile(join(memoryRoot, 'index.jsonl'), memories.map((memory) => JSON.stringify(memory)).join('\n') + '\n')
}

function parseJsonLines<T>(content: string): T[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

describe('similar hint review tooling', () => {
  it('explain returns selected false with gate findings for disallowed memory', async () => {
    const home = await createTempDir('cyrene-similar-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-similar-project-')
    await identifyCodexProject(cwd)
    const similarRoot = codexProjectMemoryRoot('similar-project')
    await writeActive(similarRoot, [
      activeMemory({
        id: 'personal-memory',
        domain: 'personal',
        type: 'user_preference',
        portability: 'similar_project',
        content: 'Personal preference must not appear as a similar hint.'
      })
    ])

    const explanations = await explainSimilarHints({ cwd, memoryId: 'personal-memory' })

    expect(explanations[0]).toMatchObject({
      memoryId: 'personal-memory',
      selected: false
    })
    expect(JSON.stringify(explanations[0]?.gateFindings)).toContain('domain not allowed')
  })

  it('explain returns similarity metadata for a source project id', async () => {
    const home = await createTempDir('cyrene-similar-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-similar-project-')
    const current = await identifyCodexProject(cwd)
    const adapter = await openMemoryIndexAdapter({ dbPath: codexMemoryDbPath() })
    await adapter.upsertProjectMetadata({
      projectId: current.projectId,
      displayName: current.displayName,
      packageManager: 'npm',
      languages: ['typescript'],
      frameworks: ['mcp'],
      dependencyNames: ['@modelcontextprotocol/sdk'],
      domainTags: ['mcp'],
      updatedAt: '2026-05-27T00:00:00.000Z'
    })
    await adapter.upsertProjectMetadata({
      projectId: 'similar-project',
      displayName: 'Similar Project',
      packageManager: 'npm',
      languages: ['typescript'],
      frameworks: ['mcp', 'vitest'],
      dependencyNames: ['@modelcontextprotocol/sdk', 'vitest'],
      domainTags: ['mcp'],
      updatedAt: '2026-05-27T00:00:00.000Z'
    })
    await adapter.upsertProjectSimilarity({
      sourceProjectId: current.projectId,
      targetProjectId: 'similar-project',
      score: 0.83,
      reason: ['framework:mcp'],
      updatedAt: '2026-05-27T00:00:00.000Z'
    })
    adapter.close()

    const explanations = await explainSimilarHints({ cwd, sourceProjectId: 'similar-project' })

    expect(explanations[0]).toMatchObject({
      sourceProjectId: 'similar-project',
      sourceProjectName: 'Similar Project',
      similarityScore: 0.83,
      similarityReason: ['framework:mcp']
    })
  })

  it('mark-transferable rejects personal relationship and affective memories', async () => {
    const home = await createTempDir('cyrene-similar-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-similar-project-')
    const current = await identifyCodexProject(cwd)
    const memory = activeMemory({ id: 'personal-memory', domain: 'personal', type: 'user_preference' })
    const memoryRoot = codexProjectMemoryRoot(current.projectId)
    await writeActive(memoryRoot, [memory])

    const result = await markSimilarHintTransferable({
      cwd,
      memoryId: memory.id,
      reviewHash: reviewHashForSimilarHintMemory(memory)
    })

    expect(result).toMatchObject({
      action: 'blocked_by_gate',
      memoryId: memory.id
    })
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toContain('"portability":"local_only"')
  })

  it('mark-transferable requires a matching review hash', async () => {
    const home = await createTempDir('cyrene-similar-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-similar-project-')
    const current = await identifyCodexProject(cwd)
    const memory = activeMemory()
    const memoryRoot = codexProjectMemoryRoot(current.projectId)
    await writeActive(memoryRoot, [memory])

    const result = await markSimilarHintTransferable({
      cwd,
      memoryId: memory.id,
      reviewHash: 'stale'
    })

    expect(result).toMatchObject({
      action: 'conflict',
      memoryId: memory.id
    })
  })

  it('mark-transferable writes portability and an audit event', async () => {
    const home = await createTempDir('cyrene-similar-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-similar-project-')
    const current = await identifyCodexProject(cwd)
    const memory = activeMemory()
    const memoryRoot = codexProjectMemoryRoot(current.projectId)
    await writeActive(memoryRoot, [memory])

    const result = await markSimilarHintTransferable({
      cwd,
      memoryId: memory.id,
      reviewHash: reviewHashForSimilarHintMemory(memory),
      now: '2026-05-27T00:00:00.000Z'
    })

    expect(result).toEqual({ action: 'mark_transferable', memoryId: memory.id, portability: 'similar_project' })
    const active = parseJsonLines<CyreneMemory>(await readFile(join(memoryRoot, 'index.jsonl'), 'utf8'))
    expect(active[0]).toMatchObject({ id: memory.id, portability: 'similar_project' })
    const events = parseJsonLines<MemoryEvent>(await readFile(join(memoryRoot, 'events.jsonl'), 'utf8'))
    expect(events[0]).toMatchObject({ action: 'update', memoryId: memory.id })
  })
})
