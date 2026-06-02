import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCodexMemoryPrepare } from '../src/codex/codex-memory-prepare.js'
import {
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readSemanticRewriteReceiptsFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type { CyreneMemory, PendingMemory } from '../src/memory/types.js'

const NOW = '2026-06-02T00:00:00.000Z'
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'v1 admission gate 核心实现采用 subagent-driven 执行方案，并创建隔离工作区。',
    normalizedKey: 'v1-admission-gate-subagent-worktree',
    sourceOfTruth: 'review_summary:task-1',
    evidence: [{ summary: 'Implementation summary.', evidenceGroupId: 'evidence-1' }],
    source: 'review_event',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.85,
      usefulness: 0.85,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-06-01T00:00:00.000Z',
    lastSeenAt: '2026-06-01T00:00:00.000Z',
    expiresAt: '2026-07-01T00:00:00.000Z',
    candidateKind: 'project_decision',
    tags: ['project_decision'],
    ...overrides
  }
}

function createActive(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Use review-hash validation before pending memory promotion.',
    normalizedKey: 'review-hash-validation-before-promotion',
    evidence: [{ summary: 'Active memory evidence.', evidenceGroupId: 'active-evidence-1' }],
    source: 'review_event',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
    candidateKind: 'workflow_rule',
    tags: ['workflow_rule'],
    ...overrides
  }
}

describe('runCodexMemoryPrepare', () => {
  it('returns prepared records in dry-run without writing pending or receipts', async () => {
    const memoryRoot = await createTempDir('cyrene-memory-prepare-dry-run-')
    await writePendingMemoriesFromRoot(memoryRoot, [createPending()])
    const beforePendingFile = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')

    const result = await runCodexMemoryPrepare({ memoryRoot, dryRun: true, now: NOW })

    expect(result.dryRun).toBe(true)
    expect(result.results).toHaveLength(1)
    expect(result.results[0]?.action).toBe('replace_content')
    expect(result.nextPending[0]?.content).toBe(
      'Admission-gate memory work should coordinate independent tasks through subagent-driven execution in an isolated worktree.'
    )
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toBe(beforePendingFile)
    await expect(readSemanticRewriteReceiptsFromRoot(memoryRoot)).resolves.toEqual([])
  })

  it('applies pending rewrites and receipts without changing active memory', async () => {
    const memoryRoot = await createTempDir('cyrene-memory-prepare-apply-')
    const active = createActive()
    await writeActiveMemoriesFromRoot(memoryRoot, [active])
    await writePendingMemoriesFromRoot(memoryRoot, [createPending()])
    const activeBefore = await readActiveMemoriesFromRoot(memoryRoot)

    const result = await runCodexMemoryPrepare({ memoryRoot, dryRun: false, now: NOW })

    expect(result.dryRun).toBe(false)
    expect(result.activeBeforeCount).toBe(1)
    expect(result.activeAfterCount).toBe(1)
    await expect(readActiveMemoriesFromRoot(memoryRoot)).resolves.toEqual(activeBefore)
    const pendingAfter = await readPendingMemoriesFromRoot(memoryRoot)
    expect(pendingAfter[0]?.content).toBe(
      'Admission-gate memory work should coordinate independent tasks through subagent-driven execution in an isolated worktree.'
    )
    const receipts = await readSemanticRewriteReceiptsFromRoot(memoryRoot)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({
      pendingMemoryId: 'pending-1',
      action: 'replace_content',
      changedFields: ['content'],
      createdAt: NOW
    })
  })
})
