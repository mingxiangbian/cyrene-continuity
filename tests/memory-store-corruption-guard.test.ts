import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendCandidateDraftFromRoot,
  readSemanticMemoriesFromRoot,
  writeSemanticMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type { CandidateDraft, SemanticMemory } from '../src/memory/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function semanticMemory(): SemanticMemory {
  return {
    id: 'semantic-1',
    status: 'active',
    module: 'project_semantic',
    kind: 'project_fact',
    scope: 'project',
    domain: 'project',
    content: 'Canonical JSONL repair must be reviewed before writes.',
    useWhen: ['Checking JSONL repair behavior'],
    doNotUseWhen: ['The task is unrelated to memory storage'],
    sourceOfTruth: 'test:semantic',
    evidence: [
      {
        id: 'evidence-1',
        sourceKind: 'file',
        sourceRef: 'test:semantic',
        when: '2026-06-01T00:00:00.000Z',
        whatHappened: 'A valid semantic record remained readable from a partially corrupted file.',
        whyImportant: 'Diagnostic reads must preserve repair review context.',
        result: 'The valid record was returned without mutating bytes.'
      }
    ],
    reviewPolicy: 'strict_auto_promote',
    supersedes: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z'
  }
}

function candidateDraft(): CandidateDraft {
  return {
    id: 'draft-1',
    content: 'Do not append into a corrupted canonical JSONL root.',
    candidateKind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    sourceKind: 'review_summary',
    sourceEpisodeIds: ['episode-1'],
    evidenceRefs: ['summary-1'],
    normalizedKey: 'jsonl-corruption-append-guard',
    tags: ['test'],
    createdAt: '2026-06-01T00:00:00.000Z'
  }
}

async function writePartiallyCorruptedSemanticFile(root: string): Promise<string> {
  const content = `${JSON.stringify(semanticMemory())}\n{malformed semantic memory}\n`
  await writeFile(join(root, 'semantic_memories.jsonl'), content, 'utf8')
  return content
}

describe('memory store JSONL corruption guards', () => {
  it('reads valid semantic records from a partially corrupted file without changing bytes', async () => {
    const root = await createTempDir('cyrene-corrupt-read-root-')
    const before = await writePartiallyCorruptedSemanticFile(root)

    await expect(readSemanticMemoriesFromRoot(root)).resolves.toEqual([semanticMemory()])

    await expect(readFile(join(root, 'semantic_memories.jsonl'), 'utf8')).resolves.toBe(before)
  })

  it('rejects semantic rewrites when any canonical JSONL file is corrupted without changing bytes', async () => {
    const root = await createTempDir('cyrene-corrupt-rewrite-root-')
    const before = await writePartiallyCorruptedSemanticFile(root)

    await expect(writeSemanticMemoriesFromRoot(root, [])).rejects.toThrow(/repair_required/)

    await expect(readFile(join(root, 'semantic_memories.jsonl'), 'utf8')).resolves.toBe(before)
  })

  it('rejects append-only canonical writes when any canonical JSONL file is corrupted without changing bytes', async () => {
    const root = await createTempDir('cyrene-corrupt-append-root-')
    const before = await writePartiallyCorruptedSemanticFile(root)

    await expect(appendCandidateDraftFromRoot(root, candidateDraft())).rejects.toThrow(/repair_required/)

    await expect(readFile(join(root, 'semantic_memories.jsonl'), 'utf8')).resolves.toBe(before)
    await expect(readFile(join(root, 'candidate_drafts.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
