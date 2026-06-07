import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { retrieveMemories } from '../src/memory/memory-retriever.js'
import { upsertMemoryEdgeFromRoot, writeActiveMemoriesFromRoot } from '../src/memory/memory-store.js'
import { createModelHintEdge, createOperationBackedEdge } from '../src/memory/memory-relations.js'
import type { CyreneMemory } from '../src/memory/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writeJsonLines(filePath: string, values: unknown[]): Promise<void> {
  if (filePath.endsWith('/index.jsonl')) {
    await writeActiveMemoriesFromRoot(filePath.slice(0, -'/index.jsonl'.length), values as CyreneMemory[])
    return
  }
  await writeFile(filePath, values.map((value) => JSON.stringify(value)).join('\n') + '\n', 'utf8')
}

describe('memory retriever', () => {
  it('uses retrieval planner facets to explain and rank JSONL memory', async () => {
    const memoryRoot = await createTempDir('cyrene-memory-retriever-planner-root-')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'index.jsonl'), [
      createMemory({
        id: 'project-fact',
        content: 'Active memory delete button Web UI bug details.',
        normalizedKey: 'active-memory-delete-button-web-ui-bug',
        type: 'project_fact',
        domain: 'project'
      }),
      createMemory({
        id: 'workflow-rule',
        content: 'Memory review UI delete button workflow safeguard.',
        normalizedKey: 'memory-review-ui-delete-button-workflow-safeguard',
        type: 'procedural_rule',
        domain: 'procedural',
        candidateKind: 'workflow_rule'
      })
    ])

    const result = await retrieveMemories({
      cwd: memoryRoot,
      userCyreneDir: memoryRoot,
      memoryRoot,
      query: 'active memory delete button does not work in Web UI',
      task: 'memory',
      maxItems: 10,
      maxTokens: 100
    })

    expect(result.map((item) => item.memory.id)).toEqual(['workflow-rule', 'project-fact'])
    expect(result[0]?.explain).toEqual(expect.arrayContaining([
      'exact_project',
      'memory_kind:workflow_rule',
      'task_intent:memory_review'
    ]))
  })

  it('skips an oversized first scored memory and returns later in-budget JSONL memory', async () => {
    const memoryRoot = await createTempDir('cyrene-memory-retriever-root-')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'index.jsonl'), [
      createMemory({
        id: 'oversized',
        content: 'router '.repeat(80),
        normalizedKey: 'router-oversized',
        scores: {
          evidenceStrength: 0.99,
          stability: 0.99,
          usefulness: 0.99,
          safety: 0.99,
          sensitivity: 0.01
        }
      }),
      createMemory({
        id: 'small',
        content: 'router small memory',
        normalizedKey: 'router-small',
        scores: {
          evidenceStrength: 0.5,
          stability: 0.5,
          usefulness: 0.5,
          safety: 0.9,
          sensitivity: 0.1
        }
      })
    ])

    const result = await retrieveMemories({
      cwd: memoryRoot,
      userCyreneDir: memoryRoot,
      memoryRoot,
      query: 'router',
      task: 'coding',
      maxItems: 10,
      maxTokens: 6
    })

    expect(result.map((item) => item.memory.id)).toEqual(['small'])
  })

  it('retrieves English technical memory from Chinese query aliases', async () => {
    const memoryRoot = await createTempDir('cyrene-memory-retriever-cjk-root-')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'index.jsonl'), [
      createMemory({
        id: 'irrelevant-high-score',
        content: 'Project dashboard layout prefers dense tabular views.',
        normalizedKey: 'project-dashboard-layout-dense-tables',
        scores: {
          evidenceStrength: 0.99,
          stability: 0.99,
          usefulness: 0.99,
          safety: 0.99,
          sensitivity: 0.01
        }
      }),
      createMemory({
        id: 'multi-agent-review',
        content: 'Use multi-agent review before high-risk repo update verification.',
        normalizedKey: 'multi-agent-review-repo-update-verification',
        type: 'procedural_rule',
        domain: 'procedural',
        candidateKind: 'workflow_rule',
        tags: ['multi-agent', 'review', 'repo']
      })
    ])

    const result = await retrieveMemories({
      cwd: memoryRoot,
      userCyreneDir: memoryRoot,
      memoryRoot,
      query: '多智能体审查 仓库更新验证',
      task: 'memory',
      maxItems: 10,
      maxTokens: 100
    })

    expect(result.map((item) => item.memory.id)).toEqual(expect.arrayContaining(['multi-agent-review']))
    expect(result[0]?.memory.id).toBe('multi-agent-review')
  })

  it('caps long-query relevance so full matches do not inflate JSONL scores', async () => {
    const memoryRoot = await createTempDir('cyrene-memory-retriever-score-cap-root-')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'index.jsonl'), [
      createMemory({
        id: 'long-full-match',
        type: 'reference',
        content: 'alpha beta gamma delta epsilon zeta eta theta iota kappa',
        normalizedKey: 'alpha-beta-gamma-delta-epsilon-zeta-eta-theta-iota-kappa',
        scores: {
          evidenceStrength: 0,
          stability: 0,
          usefulness: 0,
          safety: 0,
          sensitivity: 0
        },
        tags: []
      })
    ])

    const result = await retrieveMemories({
      cwd: memoryRoot,
      userCyreneDir: memoryRoot,
      memoryRoot,
      query: 'alpha beta gamma delta epsilon zeta eta theta iota kappa',
      task: 'memory',
      maxItems: 10,
      maxTokens: 100
    })

    expect(result[0]?.memory.id).toBe('long-full-match')
    expect(result[0]?.score).toBeCloseTo(0.6, 5)
  })

  it('expands validated supersedes relations in JSONL fallback retrieval', async () => {
    const memoryRoot = await createTempDir('cyrene-memory-retriever-relation-root-')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'index.jsonl'), [
      createMemory({
        id: 'old-jsonl-rule',
        content: 'Obsoletejsonlalpha relation rule should be replaced.',
        normalizedKey: 'obsoletejsonlalpha-relation-rule'
      }),
      createMemory({
        id: 'replacement-jsonl-rule',
        content: 'Replacement JSONL rule uses validated relation edges.',
        normalizedKey: 'replacement-jsonl-relation-rule'
      })
    ])
    await upsertMemoryEdgeFromRoot(memoryRoot, createOperationBackedEdge({
      fromMemoryId: 'replacement-jsonl-rule',
      toMemoryId: 'old-jsonl-rule',
      fromProjectId: 'project-a',
      toProjectId: 'project-a',
      relationType: 'supersedes',
      now: '2026-06-07T00:00:00.000Z',
      reason: 'review approved JSONL replacement',
      evidenceId: 'review-jsonl-edge-1',
      evidenceKind: 'review_hash'
    }))

    const result = await retrieveMemories({
      cwd: memoryRoot,
      userCyreneDir: memoryRoot,
      memoryRoot,
      query: 'obsoletejsonlalpha',
      task: 'memory',
      maxItems: 10,
      maxTokens: 100
    })

    expect(result.map((item) => item.memory.id)).toContain('replacement-jsonl-rule')
    expect(result.map((item) => item.memory.id)).not.toContain('old-jsonl-rule')
    expect(result.find((item) => item.memory.id === 'replacement-jsonl-rule')?.explain).toEqual(
      expect.arrayContaining(['edge:relation:supersedes'])
    )
  })

  it('does not expand trial model relation hints in JSONL fallback retrieval', async () => {
    const memoryRoot = await createTempDir('cyrene-memory-retriever-trial-relation-root-')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'index.jsonl'), [
      createMemory({
        id: 'seed-jsonl-rule',
        content: 'Seedjsonlalpha relation rule stays visible.',
        normalizedKey: 'seedjsonlalpha-relation-rule'
      }),
      createMemory({
        id: 'hint-jsonl-rule',
        content: 'Trial model hint relation rule must not enter runtime retrieval.',
        normalizedKey: 'hint-jsonl-relation-rule'
      })
    ])
    await upsertMemoryEdgeFromRoot(memoryRoot, createModelHintEdge({
      fromMemoryId: 'seed-jsonl-rule',
      toMemoryId: 'hint-jsonl-rule',
      fromProjectId: 'project-a',
      toProjectId: 'project-a',
      relationType: 'refines',
      now: '2026-06-07T00:00:00.000Z',
      reason: 'model hint only'
    }))

    const result = await retrieveMemories({
      cwd: memoryRoot,
      userCyreneDir: memoryRoot,
      memoryRoot,
      query: 'seedjsonlalpha',
      task: 'memory',
      maxItems: 1,
      maxTokens: 100
    })

    expect(result.map((item) => item.memory.id)).toEqual(['seed-jsonl-rule'])
    expect(JSON.stringify(result)).not.toContain('edge:relation:refines')
  })

  it('does not expand cross-scope relation edges in JSONL fallback retrieval', async () => {
    const memoryRoot = await createTempDir('cyrene-memory-retriever-cross-scope-relation-root-')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'index.jsonl'), [
      createMemory({
        id: 'project-jsonl-seed',
        content: 'Projectjsonlalpha relation seed should retrieve normally.',
        normalizedKey: 'projectjsonlalpha-relation-seed'
      }),
      createMemory({
        id: 'global-jsonl-target',
        content: 'Unrelated global relation target must not replace the local fallback seed.',
        normalizedKey: 'global-jsonl-relation-target',
        scope: 'global',
        confidenceTier: 'global_core'
      })
    ])
    await upsertMemoryEdgeFromRoot(memoryRoot, createOperationBackedEdge({
      fromMemoryId: 'global-jsonl-target',
      toMemoryId: 'project-jsonl-seed',
      fromScope: 'global',
      toScope: 'project',
      toProjectId: 'project-a',
      relationType: 'supersedes',
      now: '2026-06-07T00:00:00.000Z',
      reason: 'review approved cross-scope edge',
      evidenceId: 'review-jsonl-cross-scope-edge-1',
      evidenceKind: 'review_hash'
    }))

    const result = await retrieveMemories({
      cwd: memoryRoot,
      userCyreneDir: memoryRoot,
      memoryRoot,
      query: 'projectjsonlalpha',
      task: 'memory',
      maxItems: 1,
      maxTokens: 100
    })

    expect(result.map((item) => item.memory.id)).toEqual(['project-jsonl-seed'])
    expect(JSON.stringify(result)).not.toContain('edge:relation:supersedes')
  })
})

function createMemory(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'memory-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Router memory.',
    normalizedKey: 'router-memory',
    evidence: [{ runId: 'run-1', summary: 'Seed memory.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.9,
      usefulness: 0.8,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
    tags: ['router'],
    ...overrides
  }
}
