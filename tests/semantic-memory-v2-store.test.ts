import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendActivationEventFromRoot,
  appendDistillationInputFromRoot,
  appendReflectionCandidateFromRoot,
  appendReviewDecisionFromRoot,
  appendRoutingDecisionFromRoot,
  migrateMemoryRootToSemanticV2FromRoot,
  readActiveMemoriesFromRoot,
  readActivationEventsFromRoot,
  readDistillationInputsFromRoot,
  readMemoryEventsFromRoot,
  readPendingMemoriesFromRoot,
  readReflectionCandidatesFromRoot,
  readReviewDecisionsFromRoot,
  readRoutingDecisionsFromRoot,
  readSemanticMemoriesFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot,
  writeSemanticMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type {
  ActivationEvent,
  CyreneMemory,
  DistillationInput,
  MemoryEvent,
  PendingMemory,
  ReflectionCandidate,
  ReviewDecision,
  RoutingDecision,
  SemanticMemory
} from '../src/memory/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function semanticMemory(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  return {
    id: 'semantic-1',
    status: 'pending',
    module: 'project_semantic',
    kind: 'known_pitfall',
    scope: 'project',
    domain: 'procedural',
    content: 'Readiness parsing should cover Chinese implementation-pattern phrases.',
    useWhen: ['Changing active-readiness heuristics'],
    doNotUseWhen: ['The task is unrelated to readiness/admission'],
    sourceOfTruth: 'review_summary:2026-06-01T03:06:00.281Z',
    evidence: [
      {
        id: 'evidence-1',
        sourceKind: 'review_summary',
        sourceRef: 'review_summary:2026-06-01T03:06:00.281Z',
        when: '2026-06-01T03:06:00.281Z',
        whatHappened: 'Readiness missed Chinese implementation-pattern phrases.',
        whyImportant: 'Raw implementation notes could be marked active-ready.',
        result: 'Heuristic was updated.'
      }
    ],
    reviewPolicy: 'pending_review',
    supersedes: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function activeMemory(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Active memory must migrate into semantic memory v2.',
    normalizedKey: 'active-memory-migrate-semantic-v2',
    evidence: [{ summary: 'Legacy active evidence.', sourceKind: 'file' }],
    source: 'file',
    scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 },
    createdAt: '2026-05-31T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
    tags: ['project_decision'],
    candidateKind: 'project_decision',
    ...overrides
  }
}

function pendingMemory(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Pending memory must be stored as SemanticMemory status pending.',
    normalizedKey: 'pending-memory-semantic-v2',
    evidence: [{ summary: 'Legacy pending evidence.', sourceKind: 'review_event' }],
    source: 'review_event',
    scores: { evidenceStrength: 0.8, stability: 0.75, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 },
    seenCount: 1,
    firstSeenAt: '2026-05-31T00:00:00.000Z',
    lastSeenAt: '2026-05-31T00:00:00.000Z',
    expiresAt: '2026-06-30T00:00:00.000Z',
    tags: ['workflow_rule'],
    candidateKind: 'workflow_rule',
    ...overrides
  }
}

function distillationInput(overrides: Partial<DistillationInput> = {}): DistillationInput {
  return {
    id: 'distillation-input-1',
    sourceDraftIds: ['draft-1'],
    sourceEpisodeIds: ['episode-1'],
    sourceSemanticMemoryIds: ['semantic-active-1'],
    admissionDecisionIds: ['admission-1'],
    normalizedKey: 'readiness-chinese-implementation-pattern',
    candidateKind: 'known_pitfall',
    scope: 'project',
    domain: 'procedural',
    sourceKinds: ['review_summary'],
    rawContents: ['实现 active memory readiness gate，防止未压缩候选直接进入 active memory'],
    evidenceRefs: ['review_summary:2026-06-01T03:06:00.281Z'],
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function routingDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    id: 'routing-1',
    semanticMemoryId: 'semantic-1',
    target: {
      module: 'project_semantic',
      updatePolicy: 'pending_review',
      risk: 'low',
      reasons: ['project-scoped pitfall requires review before active memory']
    },
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function reviewDecision(overrides: Partial<ReviewDecision> = {}): ReviewDecision {
  return {
    id: 'review-1',
    semanticMemoryId: 'semantic-1',
    policy: 'pending_review',
    reviewHash: 'review-hash-1',
    reasons: ['visible evidence required before approval'],
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function activationEvent(overrides: Partial<ActivationEvent> = {}): ActivationEvent {
  return {
    id: 'activation-1',
    memoryId: 'semantic-active-1',
    projectId: 'project-1',
    queryHash: 'query-hash-1',
    event: 'retrieved',
    evidenceRef: 'turn:1',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function reflectionCandidate(overrides: Partial<ReflectionCandidate> = {}): ReflectionCandidate {
  return {
    id: 'reflection-1',
    sourceActivationEventIds: ['activation-1'],
    proposedAction: 'rewrite',
    candidate: semanticMemory({ id: 'semantic-reflection-1', status: 'candidate' }),
    reasons: ['memory was contradicted by tool evidence'],
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

describe('Semantic memory v2 store', () => {
  it('writes and reads semantic memories from the v2 store', async () => {
    const root = await createTempDir('cyrene-semantic-root-')

    await writeSemanticMemoriesFromRoot(root, [
      semanticMemory(),
      semanticMemory({ id: 'semantic-2', status: 'active', content: 'Second memory.' })
    ])

    await expect(readSemanticMemoriesFromRoot(root)).resolves.toEqual([
      semanticMemory(),
      semanticMemory({ id: 'semantic-2', status: 'active', content: 'Second memory.' })
    ])
    await expect(readFile(join(root, 'semantic_memories.jsonl'), 'utf8')).resolves.toContain('"id":"semantic-1"')
  })

  it('uses semantic memories as the source for active and pending compatibility reads', async () => {
    const root = await createTempDir('cyrene-v2-source-root-')

    await writeActiveMemoriesFromRoot(root, [activeMemory()])
    await writePendingMemoriesFromRoot(root, [pendingMemory()])

    const semantic = await readSemanticMemoriesFromRoot(root)
    expect(semantic.map((memory) => [memory.id, memory.status])).toEqual([
      ['active-1', 'active'],
      ['pending-1', 'pending']
    ])
    expect(semantic.find((memory) => memory.id === 'pending-1')).toMatchObject({
      status: 'pending',
      module: 'procedural',
      kind: 'workflow_rule',
      content: 'Pending memory must be stored as SemanticMemory status pending.'
    })
    await expect(readActiveMemoriesFromRoot(root)).resolves.toMatchObject([
      { id: 'active-1', normalizedKey: 'active-memory-migrate-semantic-v2' }
    ])
    await expect(readPendingMemoriesFromRoot(root)).resolves.toMatchObject([
      { id: 'pending-1', normalizedKey: 'pending-memory-semantic-v2' }
    ])
  })

  it('keeps legacy pending records canonical when semantic projection also exists', async () => {
    const root = await createTempDir('cyrene-v2-pending-canonical-root-')
    const pending = pendingMemory({
      evidence: [
        {
          runId: 'review-run-1',
          evidenceGroupId: 'legacy-group-1',
          summary: 'Exact legacy pending evidence.',
          sourceKind: 'review_event'
        }
      ]
    })

    await writePendingMemoriesFromRoot(root, [pending])

    await expect(readSemanticMemoriesFromRoot(root)).resolves.toHaveLength(1)
    await expect(readPendingMemoriesFromRoot(root)).resolves.toEqual([pending])
  })

  it('uses semantic sourceOfTruth as compatibility normalizedKey when reviewState has no normalizedKey', async () => {
    const root = await createTempDir('cyrene-v2-source-key-root-')

    await writeSemanticMemoriesFromRoot(root, [
      semanticMemory({
        id: 'active-source-key',
        status: 'active',
        sourceOfTruth: 'AGENTS.md',
        reviewPolicy: 'strict_auto_promote',
        reviewState: {
          type: 'procedural_rule',
          strength: 'hard',
          source: 'file',
          scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 },
          tags: ['workflow_rule']
        }
      }),
      semanticMemory({
        id: 'pending-source-key',
        status: 'pending',
        sourceOfTruth: 'AGENTS.md',
        reviewState: {
          type: 'procedural_rule',
          strength: 'soft',
          source: 'file',
          scores: { evidenceStrength: 0.8, stability: 0.75, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 },
          seenCount: 1,
          firstSeenAt: '2026-06-01T00:00:00.000Z',
          lastSeenAt: '2026-06-01T00:00:00.000Z',
          tags: ['workflow_rule']
        }
      })
    ])

    await expect(readActiveMemoriesFromRoot(root)).resolves.toMatchObject([
      { id: 'active-source-key', normalizedKey: 'AGENTS.md', sourceOfTruth: 'AGENTS.md' }
    ])
    await expect(readPendingMemoriesFromRoot(root)).resolves.toMatchObject([
      { id: 'pending-source-key', normalizedKey: 'AGENTS.md', sourceOfTruth: 'AGENTS.md' }
    ])
  })

  it('migrates legacy active memory and resets legacy pending memory with audit events', async () => {
    const root = await createTempDir('cyrene-v2-migration-root-')
    await writeFile(join(root, 'index.jsonl'), `${JSON.stringify(activeMemory())}\n`)
    await writeFile(join(root, 'pending.jsonl'), `${JSON.stringify(pendingMemory())}\n`)

    const result = await migrateMemoryRootToSemanticV2FromRoot(root, {
      now: '2026-06-01T00:00:00.000Z'
    })

    expect(result).toMatchObject({ migratedActive: 1, droppedLegacyPending: 1 })
    await expect(readSemanticMemoriesFromRoot(root)).resolves.toMatchObject([
      {
        id: 'active-1',
        status: 'active',
        module: 'project_semantic',
        kind: 'project_decision',
        content: 'Active memory must migrate into semantic memory v2.'
      }
    ])
    await expect(readPendingMemoriesFromRoot(root)).resolves.toEqual([])
    await expect(readFile(join(root, 'pending.jsonl'), 'utf8')).resolves.toBe('')
    const events = await readMemoryEventsFromRoot(root)
    expect(events.map((event: MemoryEvent) => event.action)).toEqual(['audit', 'audit'])
    expect(events.map((event) => event.details)).toEqual([
      expect.objectContaining({ migratedActive: 1 }),
      expect.objectContaining({ droppedLegacyPending: 1 })
    ])
  })

  it('appends and reads v2 sidecar records from memory root', async () => {
    const root = await createTempDir('cyrene-v2-sidecar-root-')

    await appendDistillationInputFromRoot(root, distillationInput())
    await appendRoutingDecisionFromRoot(root, routingDecision())
    await appendReviewDecisionFromRoot(root, reviewDecision())
    await appendActivationEventFromRoot(root, activationEvent())
    await appendReflectionCandidateFromRoot(root, reflectionCandidate())

    await expect(readDistillationInputsFromRoot(root)).resolves.toEqual([distillationInput()])
    await expect(readRoutingDecisionsFromRoot(root)).resolves.toEqual([routingDecision()])
    await expect(readReviewDecisionsFromRoot(root)).resolves.toEqual([reviewDecision()])
    await expect(readActivationEventsFromRoot(root)).resolves.toEqual([activationEvent()])
    await expect(readReflectionCandidatesFromRoot(root)).resolves.toEqual([reflectionCandidate()])
  })

  it('returns empty lists when v2 files are missing', async () => {
    const root = await createTempDir('cyrene-v2-empty-root-')

    await expect(readSemanticMemoriesFromRoot(root)).resolves.toEqual([])
    await expect(readDistillationInputsFromRoot(root)).resolves.toEqual([])
    await expect(readRoutingDecisionsFromRoot(root)).resolves.toEqual([])
    await expect(readReviewDecisionsFromRoot(root)).resolves.toEqual([])
    await expect(readActivationEventsFromRoot(root)).resolves.toEqual([])
    await expect(readReflectionCandidatesFromRoot(root)).resolves.toEqual([])
  })

  it('refuses to write semantic memories through a symlinked data file', async () => {
    const root = await createTempDir('cyrene-v2-symlink-root-')
    const outside = await createTempDir('cyrene-v2-symlink-outside-')
    const outsideSemanticMemories = join(outside, 'semantic_memories.jsonl')
    await mkdir(dirname(join(root, 'semantic_memories.jsonl')), { recursive: true })
    await writeFile(outsideSemanticMemories, 'outside target must stay unchanged\n')
    await symlink(outsideSemanticMemories, join(root, 'semantic_memories.jsonl'))

    await expect(writeSemanticMemoriesFromRoot(root, [semanticMemory()])).rejects.toThrow(/memory data file symlink/)
    await expect(readFile(outsideSemanticMemories, 'utf8')).resolves.toBe('outside target must stay unchanged\n')
  })
})
