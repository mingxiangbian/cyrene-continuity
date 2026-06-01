import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCodexMemoryDistill } from '../src/codex/memory-distill.js'
import type { CyreneMemory, DistillationInput, PendingMemory } from '../src/memory/types.js'

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

async function writeJsonLines(filePath: string, values: unknown[]): Promise<string> {
  const content = values.map((item) => JSON.stringify(item)).join('\n') + '\n'
  await writeFile(filePath, content, 'utf8')
  return content
}

describe('Codex memory distillation dry run', () => {
  it('includes v2 distillation inputs as structured semantic preview candidates', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-v2-inputs-')
    const distillationInputsPath = join(memoryRoot, 'distillation_inputs.jsonl')
    const indexPath = join(memoryRoot, 'index.jsonl')
    const pendingPath = join(memoryRoot, 'pending.jsonl')
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
    await writeFile(indexPath, '', 'utf8')
    await writeFile(pendingPath, '', 'utf8')
    const indexBefore = await readFile(indexPath, 'utf8')
    const pendingBefore = await readFile(pendingPath, 'utf8')

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.summary).toEqual({
      pendingRead: 0,
      activeRead: 0,
      distillationInputsRead: 2,
      duplicateClusters: 0,
      candidates: 1
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
    await expect(readFile(indexPath, 'utf8')).resolves.toBe(indexBefore)
    await expect(readFile(pendingPath, 'utf8')).resolves.toBe(pendingBefore)
  })

  it('clusters duplicate pending candidates into an auditable dry-run candidate without mutating stores', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-memory-')
    const pendingPath = join(memoryRoot, 'pending.jsonl')
    const indexPath = join(memoryRoot, 'index.jsonl')
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
    await writeFile(indexPath, '', 'utf8')
    await writeFile(tombstonesPath, '{"id":"t1","normalizedKey":"old","scope":"project","domain":"project","type":"project_fact","reason":"deleted","createdAt":"2026-05-01T00:00:00.000Z"}\n', 'utf8')
    await writeFile(eventsPath, '{"id":"e1","action":"audit","at":"2026-05-01T00:00:00.000Z","reason":"existing"}\n', 'utf8')
    const indexBefore = await readFile(indexPath, 'utf8')
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
    await expect(readFile(indexPath, 'utf8')).resolves.toBe(indexBefore)
    await expect(readFile(tombstonesPath, 'utf8')).resolves.toBe(tombstonesBefore)
    await expect(readFile(eventsPath, 'utf8')).resolves.toBe(eventsBefore)
  })

  it('keeps duplicate pending cluster behavior while reporting zero v2 distillation inputs', async () => {
    const memoryRoot = await createTempDir('cyrene-distill-legacy-summary-')
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'pending.jsonl'), [createPending(), createPending({ id: 'p2' })])
    await writeFile(join(memoryRoot, 'index.jsonl'), '', 'utf8')

    const result = await runCodexMemoryDistill({ memoryRoot, dryRun: true })

    expect(result.summary).toEqual({
      pendingRead: 2,
      activeRead: 0,
      distillationInputsRead: 0,
      duplicateClusters: 1,
      candidates: 1
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
    await writeJsonLines(join(memoryRoot, 'pending.jsonl'), [createPending(), createPending({ id: 'p2' })])
    await writeJsonLines(join(memoryRoot, 'index.jsonl'), [createActive()])

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
    await writeJsonLines(join(memoryRoot, 'pending.jsonl'), [
      createPending({ domain: 'relationship' }),
      createPending({ id: 'p2', domain: 'relationship' })
    ])
    await writeFile(join(memoryRoot, 'index.jsonl'), '', 'utf8')

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
    await writeJsonLines(join(memoryRoot, 'pending.jsonl'), [
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
    await writeFile(join(memoryRoot, 'index.jsonl'), '', 'utf8')

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
