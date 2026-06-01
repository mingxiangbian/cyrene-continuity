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
  readActivationEventsFromRoot,
  readDistillationInputsFromRoot,
  readReflectionCandidatesFromRoot,
  readReviewDecisionsFromRoot,
  readRoutingDecisionsFromRoot,
  readSemanticMemoriesFromRoot,
  writeSemanticMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type {
  ActivationEvent,
  DistillationInput,
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
