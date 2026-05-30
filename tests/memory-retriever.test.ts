import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { retrieveMemories } from '../src/memory/memory-retriever.js'
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
