import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCodexMemoryDistill } from '../src/codex/memory-distill.js'
import { writeActiveMemoriesFromRoot } from '../src/memory/memory-store.js'
import type {
  AdmissionDecision,
  CandidateDraft,
  CyreneMemory,
  DistillationInput,
  EpisodeMemory,
  PendingMemory,
  ReviewDecision,
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

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'p1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'Run release typecheck before publishing.',
    normalizedKey: 'release-typecheck',
    evidence: [{ runId: 'run-1', sourceKind: 'tool_trace', summary: 'Release typecheck passed.' }],
    source: 'tool_trace',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.8,
      usefulness: 0.8,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-05-30T00:00:00.000Z',
    lastSeenAt: '2026-05-30T00:00:00.000Z',
    expiresAt: '2026-06-29T00:00:00.000Z',
    tags: ['release'],
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
    content: 'Run release typecheck before publishing.',
    normalizedKey: 'release-typecheck',
    evidence: [{ runId: 'run-active', sourceKind: 'tool_trace', summary: 'Active release typecheck memory.' }],
    source: 'tool_trace',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.8,
      usefulness: 0.8,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
    tags: ['release'],
    ...overrides
  }
}

function createDistillationInput(overrides: Partial<DistillationInput> = {}): DistillationInput {
  return {
    id: 'distillation-input-1',
    sourceDraftIds: ['draft-1'],
    sourceEpisodeIds: ['episode-1'],
    sourceSemanticMemoryIds: ['semantic-source-1'],
    admissionDecisionIds: ['admission-1'],
    normalizedKey: 'review-hash-validation',
    candidateKind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    sourceKinds: ['review_summary'],
    rawContents: ['Preserve review-hash validation for ambiguous memory promotion.'],
    evidenceRefs: ['review:task-3'],
    sourceOfTruth: 'AGENTS.md memory review model',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function createCandidateDraft(overrides: Partial<CandidateDraft> = {}): CandidateDraft {
  return {
    id: 'draft-1',
    episodeId: 'episode-1',
    content: 'Quality Gate First: run the focused test before implementation and keep the broad check for completion.',
    candidateKind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    sourceKind: 'review_summary',
    sourceEpisodeIds: ['episode-1'],
    evidenceRefs: ['episode-1:summary'],
    normalizedKey: 'quality-gate-first',
    sourceOfTruth: 'Task 3 closure plan',
    tags: ['quality_gate'],
    createdAt: '2026-06-02T00:00:00.000Z',
    ...overrides
  }
}

function createAdmissionDecision(overrides: Partial<AdmissionDecision> = {}): AdmissionDecision {
  return {
    id: 'admission-1',
    draftId: 'draft-1',
    action: 'admit_to_distillation',
    admissionScore: 0.82,
    reasons: ['needs_active_memory_rewrite', 'valuable_workflow_rule'],
    scores: {
      futureUsefulness: 0.85,
      actionability: 0.8,
      stability: 0.75,
      specificity: 0.7,
      evidenceStrength: 0.8,
      repeatPotential: 0.75,
      expiryRisk: 0.1,
      redundancy: 0.2,
      sensitivity: 0.1
    },
    createdAt: '2026-06-02T00:01:00.000Z',
    ...overrides
  }
}

function createEpisode(overrides: Partial<EpisodeMemory> = {}): EpisodeMemory {
  return {
    id: 'episode-1',
    projectId: 'project-1',
    title: 'Quality gate first',
    summary: 'Worker B added distillation breadth coverage.',
    actions: ['Add breadth dry-run test.'],
    decisions: ['Keep dry-run apply unsupported.'],
    failures: [],
    openQuestions: [],
    sourceTraceIds: ['trace-1'],
    createdAt: '2026-06-02T00:00:30.000Z',
    ...overrides
  }
}

function createSemanticMemory(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  return {
    id: 'semantic-active-1',
    status: 'active',
    module: 'procedural',
    kind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    content: 'Keep unrelated active memory available to distillation.',
    useWhen: ['Unrelated workflow context is needed.'],
    doNotUseWhen: ['The task is unrelated.'],
    evidence: [],
    routing: {
      module: 'procedural',
      updatePolicy: 'pending_review',
      risk: 'low',
      reasons: ['existing active semantic memory']
    },
    reviewPolicy: 'pending_review',
    reviewState: {
      normalizedKey: 'unrelated-active-memory'
    },
    supersedes: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function createReviewDecision(overrides: Partial<ReviewDecision> = {}): ReviewDecision {
  return {
    id: 'review-1',
    semanticMemoryId: 'semantic-active-1',
    policy: 'pending_review',
    reasons: ['existing review decision'],
    createdAt: '2026-06-01T00:01:00.000Z',
    ...overrides
  }
}

async function writeJsonLines(filePath: string, values: unknown[]): Promise<string> {
  const content = values.map((item) => JSON.stringify(item)).join('\n') + '\n'
  await writeFile(filePath, content, 'utf8')
  return content
}

describe('Codex memory distillation dry run', () => {
  it('reads draft, admission, episode, semantic and event stores for orphan distillation previews', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-breadth-')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'candidate_drafts.jsonl'), [createCandidateDraft()])
    await writeJsonLines(join(memoryRoot, 'admission_decisions.jsonl'), [createAdmissionDecision()])
    await writeJsonLines(join(memoryRoot, 'episodes.jsonl'), [createEpisode()])
    await writeJsonLines(join(memoryRoot, 'semantic_memories.jsonl'), [createSemanticMemory()])
    await writeJsonLines(join(memoryRoot, 'events.jsonl'), [
      {
        id: 'event-1',
        action: 'audit',
        at: '2026-06-02T00:02:00.000Z',
        reason: 'distillation breadth audit event'
      }
    ])
    await writeJsonLines(join(memoryRoot, 'review_decisions.jsonl'), [createReviewDecision()])

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.summary.inputsRead).toMatchObject({
      drafts: 1,
      admissions: 1,
      distillationInputs: 0,
      episodes: 1,
      semanticMemories: 1,
      pendingMemories: 0,
      activeMemories: 1,
      legacyPending: 0,
      legacyActive: 1,
      memoryEvents: 1,
      reviewDecisions: 1
    })
    expect(result.summary).toMatchObject({
      pendingRead: 0,
      activeRead: 1,
      distillationInputsRead: 0,
      duplicateClusters: 0,
      candidates: 1
    })
    expect(result.candidates[0]).toMatchObject({
      id: 'distill-quality-gate-first',
      normalizedKey: 'quality-gate-first',
      content: 'Quality Gate First: run the focused test before implementation and keep the broad check for completion.',
      sourceIds: ['draft-1'],
      sourceAdmissionDecisionIds: ['admission-1'],
      evidenceRefs: ['episode-1:summary'],
      sourceOfTruth: 'Task 3 closure plan',
      semanticMemory: {
        id: 'semantic-draft-1',
        status: 'candidate',
        reviewState: {
          sourceDraftIds: ['draft-1'],
          sourceEpisodeIds: ['episode-1']
        },
        routing: {
          module: 'procedural',
          updatePolicy: 'pending_review',
          risk: 'low'
        }
      }
    })
  })

  it('includes v2 distillation inputs as structured semantic preview candidates', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-v2-inputs-')
    const distillationInputsPath = join(memoryRoot, 'distillation_inputs.jsonl')
    const semanticPath = join(memoryRoot, 'semantic_memories.jsonl')
    const pendingPath = join(memoryRoot, 'review_queue.jsonl')
    await mkdir(memoryRoot, { recursive: true })
    const distillationInputsBefore = await writeJsonLines(distillationInputsPath, [
      createDistillationInput({
        rawContents: [
          'Preserve review-hash validation.',
          'Preserve review-hash validation for ambiguous memory promotion.'
        ]
      }),
      createDistillationInput({
        id: 'distillation-input-2',
        sourceDraftIds: [],
        sourceEpisodeIds: ['episode-2'],
        sourceSemanticMemoryIds: ['semantic-source-2'],
        admissionDecisionIds: ['admission-2'],
        rawContents: ['Review hash checks still gate high-risk memory changes.'],
        evidenceRefs: ['review:task-3-b'],
        createdAt: '2026-06-01T01:00:00.000Z'
      })
    ])
    await writeFile(semanticPath, '', 'utf8')
    await writeFile(pendingPath, '', 'utf8')
    const semanticBefore = await readFile(semanticPath, 'utf8')
    const pendingBefore = await readFile(pendingPath, 'utf8')

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.summary).toMatchObject({
      pendingRead: 0,
      activeRead: 0,
      distillationInputsRead: 2,
      duplicateClusters: 0,
      candidates: 1
    })
    expect(result.summary.inputsRead).toMatchObject({
      drafts: 0,
      admissions: 0,
      distillationInputs: 2,
      episodes: 0,
      semanticMemories: 0,
      pendingMemories: 0,
      activeMemories: 0,
      legacyPending: 0,
      legacyActive: 0,
      memoryEvents: 0,
      reviewDecisions: 0
    })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      id: 'distill-review-hash-validation',
      normalizedKey: 'review-hash-validation',
      content: 'Preserve review-hash validation for ambiguous memory promotion.',
      sourceIds: ['draft-1', 'distillation-input-2'],
      rawContents: [
        'Preserve review-hash validation.',
        'Preserve review-hash validation for ambiguous memory promotion.',
        'Review hash checks still gate high-risk memory changes.'
      ],
      evidenceRefs: ['review:task-3', 'review:task-3-b'],
      sourceAdmissionDecisionIds: ['admission-1', 'admission-2'],
      sourceSemanticMemoryIds: ['semantic-source-1', 'semantic-source-2'],
      recommendedAction: 'needs_review',
      risk: 'low',
      sourceOfTruth: 'AGENTS.md memory review model',
      semanticMemory: {
        id: 'semantic-distill-review-hash-validation',
        status: 'candidate',
        module: 'procedural',
        kind: 'workflow_rule',
        reviewPolicy: 'pending_review',
        sourceOfTruth: 'AGENTS.md memory review model',
        evidence: [
          {
            id: 'evidence-distill-review-hash-validation-0',
            sourceKind: 'review_summary',
            sourceRef: 'review:task-3',
            whatHappened: 'Preserve review-hash validation for ambiguous memory promotion.'
          },
          {
            id: 'evidence-distill-review-hash-validation-1',
            sourceKind: 'review_summary',
            sourceRef: 'review:task-3-b',
            whatHappened: 'Preserve review-hash validation for ambiguous memory promotion.'
          }
        ],
        reviewState: {
          normalizedKey: 'review-hash-validation',
          sourceEpisodeIds: ['episode-1', 'episode-2'],
          sourceDraftIds: ['distill-review-hash-validation']
        },
        routing: {
          module: 'procedural',
          updatePolicy: 'pending_review',
          risk: 'low'
        }
      }
    })
    await expect(readFile(distillationInputsPath, 'utf8')).resolves.toBe(distillationInputsBefore)
    await expect(readFile(semanticPath, 'utf8')).resolves.toBe(semanticBefore)
    await expect(readFile(pendingPath, 'utf8')).resolves.toBe(pendingBefore)
  })

  it('includes singleton v2 distillation input as a structured semantic preview candidate without mutating stores', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-v2-singleton-')
    const distillationInputsPath = join(memoryRoot, 'distillation_inputs.jsonl')
    const semanticPath = join(memoryRoot, 'semantic_memories.jsonl')
    const pendingPath = join(memoryRoot, 'review_queue.jsonl')
    await mkdir(memoryRoot, { recursive: true })
    const distillationInputsBefore = await writeJsonLines(distillationInputsPath, [
      createDistillationInput({
        normalizedKey: 'workflow-agents-md-surgical-edits',
        sourceOfTruth: 'AGENTS.md',
        rawContents: ['For non-trivial code changes, edits must stay surgical. Source of truth: AGENTS.md.'],
        evidenceRefs: ['AGENTS.md']
      })
    ])
    await writeFile(semanticPath, '', 'utf8')
    await writeFile(pendingPath, '', 'utf8')
    const semanticBefore = await readFile(semanticPath, 'utf8')
    const pendingBefore = await readFile(pendingPath, 'utf8')

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      id: 'distill-workflow-agents-md-surgical-edits',
      normalizedKey: 'workflow-agents-md-surgical-edits',
      sourceOfTruth: 'AGENTS.md',
      recommendedAction: 'needs_review',
      risk: 'low',
      semanticMemory: {
        module: 'procedural',
        reviewPolicy: 'pending_review',
        sourceOfTruth: 'AGENTS.md',
        evidence: [
          expect.objectContaining({
            sourceKind: 'review_summary',
            sourceRef: 'AGENTS.md',
            whatHappened: 'For non-trivial code changes, edits must stay surgical. Source of truth: AGENTS.md.'
          })
        ]
      }
    })
    await expect(readFile(distillationInputsPath, 'utf8')).resolves.toBe(distillationInputsBefore)
    await expect(readFile(semanticPath, 'utf8')).resolves.toBe(semanticBefore)
    await expect(readFile(pendingPath, 'utf8')).resolves.toBe(pendingBefore)
  })

  it('shapes distillation input previews without materializing pending memory', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-shaped-preview-')
    const distillationInputsPath = join(memoryRoot, 'distillation_inputs.jsonl')
    const pendingPath = join(memoryRoot, 'review_queue.jsonl')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(distillationInputsPath, [
      createDistillationInput({
        normalizedKey: 'pending-review-hash-canonical-records',
        candidateKind: 'known_pitfall',
        rawContents: ['pending review 哈希因 semantic projection 改写导致假冲突。修复方案：调整优先从 review_queue.jsonl 直接读取 pending review，而非依赖缓存推导。'],
        evidenceRefs: ['review_queue.jsonl', 'semantic projection']
      })
    ])
    const pendingBefore = await writeJsonLines(pendingPath, [
      createPending({
        id: 'existing-pending',
        normalizedKey: 'existing-pending',
        content: 'Existing pending memory must not be changed by distillation dry-run.'
      })
    ])

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.summary.inputsRead.distillationInputs).toBeGreaterThan(0)
    expect(result.summary.pendingRead).toBe(1)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.semanticMemory?.content ?? result.candidates[0]?.content).toContain(
      'review_queue.jsonl records'
    )
    expect(result.candidates[0]?.semanticMemory?.useWhen).toContain(
      'Diagnosing review-hash conflicts for pending memory candidates.'
    )
    await expect(readFile(pendingPath, 'utf8')).resolves.toBe(pendingBefore)
  })

  it('does not duplicate draft previews already covered by v2 distillation input source drafts', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-covered-draft-')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'distillation_inputs.jsonl'), [
      createDistillationInput({
        sourceDraftIds: ['draft-1'],
        normalizedKey: 'quality-gate-first',
        rawContents: ['Explicit v2 distillation input should be the preview source.'],
        evidenceRefs: ['distillation-input:evidence'],
        sourceOfTruth: 'DistillationInput source of truth'
      })
    ])
    await writeJsonLines(join(memoryRoot, 'candidate_drafts.jsonl'), [
      createCandidateDraft({
        content: 'Covered orphan draft should not be emitted as another preview source.'
      })
    ])
    await writeJsonLines(join(memoryRoot, 'admission_decisions.jsonl'), [createAdmissionDecision()])
    await writeFile(join(memoryRoot, 'semantic_memories.jsonl'), '', 'utf8')

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      normalizedKey: 'quality-gate-first',
      rawContents: ['Explicit v2 distillation input should be the preview source.'],
      sourceOfTruth: 'DistillationInput source of truth',
      reasons: ['normalizedKey quality-gate-first has 1 v2 distillation input']
    })
  })

  it('clusters duplicate pending candidates into an auditable dry-run candidate without mutating stores', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-memory-')
    const pendingPath = join(memoryRoot, 'review_queue.jsonl')
    const semanticPath = join(memoryRoot, 'semantic_memories.jsonl')
    const tombstonesPath = join(memoryRoot, 'tombstones.jsonl')
    const eventsPath = join(memoryRoot, 'events.jsonl')
    const pending = [
      createPending(),
      createPending({
        id: 'p2',
        content: 'Run release typecheck before publishing so the release gate catches TypeScript regressions.',
        evidence: [{ runId: 'run-2', sourceKind: 'tool_trace', summary: 'Second release typecheck signal.' }],
        lastSeenAt: '2026-05-30T01:00:00.000Z'
      })
    ]
    await mkdir(memoryRoot, { recursive: true })
    const pendingBefore = await writeJsonLines(pendingPath, pending)
    await writeFile(semanticPath, '', 'utf8')
    await writeFile(tombstonesPath, '{"id":"t1","normalizedKey":"old","scope":"project","domain":"project","type":"project_fact","reason":"deleted","createdAt":"2026-05-01T00:00:00.000Z"}\n', 'utf8')
    await writeFile(eventsPath, '{"id":"e1","action":"audit","at":"2026-05-01T00:00:00.000Z","reason":"existing"}\n', 'utf8')
    const semanticBefore = await readFile(semanticPath, 'utf8')
    const tombstonesBefore = await readFile(tombstonesPath, 'utf8')
    const eventsBefore = await readFile(eventsPath, 'utf8')

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.mode).toBe('dry_run')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      id: 'distill-release-typecheck',
      normalizedKey: 'release-typecheck',
      content: 'Run release typecheck before publishing so the release gate catches TypeScript regressions.',
      sourceIds: ['p1', 'p2'],
      evidence: [
        { runId: 'run-1', sourceKind: 'tool_trace', summary: 'Release typecheck passed.' },
        { runId: 'run-2', sourceKind: 'tool_trace', summary: 'Second release typecheck signal.' }
      ],
      recommendedAction: 'merge_pending',
      risk: 'low',
      reasons: ['duplicate normalizedKey release-typecheck has 2 pending candidates']
    })
    await expect(readFile(pendingPath, 'utf8')).resolves.toBe(pendingBefore)
    await expect(readFile(semanticPath, 'utf8')).resolves.toBe(semanticBefore)
    await expect(readFile(tombstonesPath, 'utf8')).resolves.toBe(tombstonesBefore)
    await expect(readFile(eventsPath, 'utf8')).resolves.toBe(eventsBefore)
  })

  it('merges same-key pending duplicates and v2 distillation input into one candidate', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-same-key-merge-')
    const pendingPath = join(memoryRoot, 'review_queue.jsonl')
    const distillationInputsPath = join(memoryRoot, 'distillation_inputs.jsonl')
    const semanticPath = join(memoryRoot, 'semantic_memories.jsonl')
    await mkdir(memoryRoot, { recursive: true })
    const pendingBefore = await writeJsonLines(pendingPath, [
      createPending({
        id: 'p-same-1',
        normalizedKey: 'same-key',
        candidateKind: 'workflow_rule',
        domain: 'procedural',
        type: 'procedural_rule'
      }),
      createPending({
        id: 'p-same-2',
        normalizedKey: 'same-key',
        candidateKind: 'project_fact',
        domain: 'project',
        type: 'project_fact'
      })
    ])
    const distillationInputsBefore = await writeJsonLines(distillationInputsPath, [
      createDistillationInput({
        id: 'distillation-input-same',
        normalizedKey: 'same-key',
        sourceDraftIds: ['draft-same'],
        sourceOfTruth: 'AGENTS.md',
        rawContents: ['Same-key v2 distillation preview keeps structured memory data.'],
        evidenceRefs: ['AGENTS.md']
      })
    ])
    await writeFile(semanticPath, '', 'utf8')
    const semanticBefore = await readFile(semanticPath, 'utf8')

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.candidates.filter((candidate) => candidate.normalizedKey === 'same-key')).toHaveLength(1)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      id: 'distill-same-key',
      normalizedKey: 'same-key',
      sourceIds: ['draft-same', 'p-same-1', 'p-same-2'],
      sourceOfTruth: 'AGENTS.md',
      semanticMemory: expect.objectContaining({
        sourceOfTruth: 'AGENTS.md'
      }),
      risk: 'medium',
      recommendedAction: 'needs_review',
      reasons: expect.arrayContaining([
        'mixed pending metadata for duplicate normalizedKey same-key',
        'duplicate normalizedKey same-key has 2 pending candidates'
      ])
    })
    await expect(readFile(pendingPath, 'utf8')).resolves.toBe(pendingBefore)
    await expect(readFile(distillationInputsPath, 'utf8')).resolves.toBe(distillationInputsBefore)
    await expect(readFile(semanticPath, 'utf8')).resolves.toBe(semanticBefore)
  })

  it('merges same-key orphan admission semantic previews without dropping evidence lineage', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-orphan-merge-')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'candidate_drafts.jsonl'), [
      createCandidateDraft(),
      createCandidateDraft({
        id: 'draft-2',
        episodeId: 'episode-2',
        content: 'Quality Gate First: keep the focused test in front of broad verification.',
        sourceEpisodeIds: ['episode-2'],
        evidenceRefs: ['episode-2:summary']
      })
    ])
    await writeJsonLines(join(memoryRoot, 'admission_decisions.jsonl'), [
      createAdmissionDecision(),
      createAdmissionDecision({
        id: 'admission-2',
        draftId: 'draft-2',
        reasons: ['needs_active_memory_rewrite', 'valuable_project_decision']
      })
    ])
    await writeJsonLines(join(memoryRoot, 'episodes.jsonl'), [
      createEpisode(),
      createEpisode({
        id: 'episode-2',
        title: 'Quality gate follow-up',
        summary: 'A second worker produced the same distilled workflow signal.'
      })
    ])

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      id: 'distill-quality-gate-first',
      normalizedKey: 'quality-gate-first',
      sourceIds: ['draft-1', 'draft-2'],
      sourceAdmissionDecisionIds: ['admission-1', 'admission-2'],
      evidenceRefs: ['episode-1:summary', 'episode-2:summary'],
      sourceEpisodeIds: ['episode-1', 'episode-2'],
      semanticMemory: {
        reviewState: {
          sourceDraftIds: ['draft-1', 'draft-2'],
          sourceEpisodeIds: ['episode-1', 'episode-2'],
          admissionReasons: expect.arrayContaining(['valuable_project_decision', 'valuable_workflow_rule'])
        },
        evidence: expect.arrayContaining([
          expect.objectContaining({
            id: 'evidence-draft-1-0',
            sourceRef: 'episode-1:summary'
          }),
          expect.objectContaining({
            id: 'evidence-draft-2-0',
            sourceRef: 'episode-2:summary'
          })
        ])
      }
    })
  })

  it('keeps duplicate pending cluster behavior while reporting zero v2 distillation inputs', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-legacy-summary-')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'review_queue.jsonl'), [createPending(), createPending({ id: 'p2' })])
    await writeFile(join(memoryRoot, 'semantic_memories.jsonl'), '', 'utf8')

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.summary).toMatchObject({
      pendingRead: 2,
      activeRead: 0,
      distillationInputsRead: 0,
      duplicateClusters: 1,
      candidates: 1
    })
    expect(result.summary.inputsRead).toMatchObject({
      drafts: 0,
      admissions: 0,
      distillationInputs: 0,
      episodes: 0,
      semanticMemories: 0,
      pendingMemories: 2,
      activeMemories: 0,
      legacyPending: 2,
      legacyActive: 0,
      memoryEvents: 0,
      reviewDecisions: 0
    })
    expect(result.candidates[0]).toMatchObject({
      id: 'distill-release-typecheck',
      recommendedAction: 'merge_pending',
      risk: 'low'
    })
  })

  it('marks duplicate pending candidates as needs_review when active memory overlaps', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-active-overlap-')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'review_queue.jsonl'), [createPending(), createPending({ id: 'p2' })])
    await writeActiveMemoriesFromRoot(memoryRoot, [createActive()])

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.candidates[0]).toMatchObject({
      id: 'distill-release-typecheck',
      risk: 'high',
      recommendedAction: 'needs_review',
      reasons: expect.arrayContaining([
        'active memory already has normalizedKey release-typecheck',
        'duplicate normalizedKey release-typecheck has 2 pending candidates'
      ])
    })
  })

  it('marks high-risk pending domains as needs_review', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-high-risk-domain-')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'review_queue.jsonl'), [
      createPending({ domain: 'relationship' }),
      createPending({ id: 'p2', domain: 'relationship' })
    ])
    await writeFile(join(memoryRoot, 'semantic_memories.jsonl'), '', 'utf8')

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.candidates[0]).toMatchObject({
      id: 'distill-release-typecheck',
      risk: 'high',
      recommendedAction: 'needs_review',
      reasons: expect.arrayContaining([
        'high-risk pending domain relationship',
        'duplicate normalizedKey release-typecheck has 2 pending candidates'
      ])
    })
  })

  it('marks duplicate pending candidates with mixed metadata as needs_review', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-mixed-metadata-')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'review_queue.jsonl'), [
      createPending({
        candidateKind: 'workflow_rule',
        domain: 'procedural',
        type: 'procedural_rule'
      }),
      createPending({
        id: 'p2',
        candidateKind: 'project_fact',
        domain: 'project',
        type: 'project_fact'
      })
    ])
    await writeFile(join(memoryRoot, 'semantic_memories.jsonl'), '', 'utf8')

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.candidates[0]).toMatchObject({
      id: 'distill-release-typecheck',
      risk: 'medium',
      recommendedAction: 'needs_review',
      reasons: expect.arrayContaining([
        'mixed pending metadata for duplicate normalizedKey release-typecheck',
        'duplicate normalizedKey release-typecheck has 2 pending candidates'
      ])
    })
  })
})
