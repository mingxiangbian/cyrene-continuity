import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCodexAdmissionPipeline } from '../src/codex/admission-pipeline.js'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { proposeCodexMemoryCandidate } from '../src/codex/memory-propose.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { deleteCodexProjectMemory } from '../src/codex/project-registry.js'
import {
  readDistillationInputsFromRoot,
  readReviewDecisionsFromRoot,
  readRoutingDecisionsFromRoot
} from '../src/memory/memory-store.js'
import type { CyreneMemory, MemoryTombstone, PendingMemory } from '../src/memory/types.js'

vi.mock('../src/codex/memory-propose.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/codex/memory-propose.js')>()
  return {
    ...actual,
    proposeCodexMemoryCandidate: vi.fn(actual.proposeCodexMemoryCandidate)
  }
})

const originalHome = process.env.HOME
const tempDirs: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function activeMemory(normalizedKey: string): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Existing active memory.',
    normalizedKey,
    evidence: [{ summary: 'Existing evidence.' }],
    source: 'file',
    scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 },
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    tags: []
  }
}

function tombstone(normalizedKey: string): MemoryTombstone {
  return {
    id: 'tombstone-1',
    normalizedKey,
    domain: 'project',
    type: 'project_fact',
    scope: 'project',
    reason: 'archived',
    createdAt: '2026-05-01T00:00:00.000Z',
    expiresAt: '2026-06-01T00:00:00.000Z'
  }
}

function pendingMemory(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-existing',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Existing pending memory.',
    normalizedKey: 'merge-lineage-key',
    evidence: [{ summary: 'Existing pending evidence.' }],
    source: 'user_explicit',
    scores: { evidenceStrength: 0.75, stability: 0.7, usefulness: 0.7, safety: 0.9, sensitivity: 0.1 },
    seenCount: 1,
    firstSeenAt: '2026-05-01T00:00:00.000Z',
    lastSeenAt: '2026-05-01T00:00:00.000Z',
    expiresAt: '2026-06-01T00:00:00.000Z',
    tags: [],
    ...overrides
  }
}

function parseJsonLines<T>(value: string): T[] {
  return value.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as T)
}

describe('runCodexAdmissionPipeline', () => {
  it('does not create project memory files for disabled projects', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-disabled-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-disabled-project-')
    const identity = await identifyCodexProject(cwd)
    await deleteCodexProjectMemory({ projectId: identity.projectId, reason: 'No project memory here.' })
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'review_summary',
      candidate: {
        domain: 'project',
        type: 'project_fact',
        candidateKind: 'project_fact',
        content: 'Disabled project memory should not capture this candidate.',
        evidence: [{ summary: 'Disabled project evidence.' }]
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('auto_drop')
    await expect(lstat(memoryRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'candidate_drafts.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'admission_decisions.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes draft and admission records without pending for numeric snapshots', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-project-')

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'file',
      candidate: {
        domain: 'project',
        type: 'project_fact',
        candidateKind: 'project_fact',
        content: '项目包含 44 个测试文件，广泛覆盖 active memory、CLI、distill、MCP、memory index 等模块。',
        evidence: [{ summary: 'test signal', sourceKind: 'file' }],
        source: 'file'
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('admit_to_distillation')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await expect(readFile(join(memoryRoot, 'candidate_drafts.jsonl'), 'utf8')).resolves.toContain('44 个测试文件')
    await expect(readFile(join(memoryRoot, 'admission_decisions.jsonl'), 'utf8')).resolves.toContain('stale_numeric_snapshot')
    await expect(readDistillationInputsFromRoot(memoryRoot)).resolves.toMatchObject([
      {
        candidateKind: 'project_fact',
        scope: 'project',
        domain: 'project',
        rawContents: ['项目包含 44 个测试文件，广泛覆盖 active memory、CLI、distill、MCP、memory index 等模块。'],
        admissionDecisionIds: [result.admission.id],
        sourceDraftIds: [result.admission.draftId]
      }
    ])
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes admitted pending memory with admission lineage metadata', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-admit-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-admit-project-')

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'review_summary',
      sourceEpisodeIds: ['episode-1'],
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        candidateKind: 'workflow_rule',
        content: 'Core memory pipeline changes must preserve review-hash validation.',
        normalizedKey: 'preserve-review-hash',
        evidence: [{ summary: 'User confirmed review hash policy.', sourceKind: 'user_explicit' }],
        source: 'user_explicit',
        scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 }
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')
    const pending = await readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain('"admittedBy":"admission_gate_v1"')
    expect(pending).toContain('"admissionAction":"admit_to_pending"')
    expect(pending).toContain('"sourceEpisodeIds":["episode-1"]')
    expect(pending).toContain('"sourceDraftIds"')
  })

  it('writes routing and review decisions for admitted pending source-of-truth candidates', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-routing-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-routing-project-')

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'file',
      sourceEpisodeIds: ['episode-1'],
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        candidateKind: 'workflow_rule',
        content: 'For non-trivial code changes, repository edits must remain surgical and trace directly to the requested task.',
        normalizedKey: 'agents-md-surgical-edits',
        sourceOfTruth: 'AGENTS.md',
        evidence: [{ summary: 'AGENTS.md', sourceKind: 'file' }],
        source: 'file',
        scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 }
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')

    const routing = await readRoutingDecisionsFromRoot(result.memoryRoot)
    expect(routing).toHaveLength(1)
    expect(routing[0]).toMatchObject({
      id: `routing-${result.admission.id}`,
      semanticMemoryId: `semantic-${result.admission.draftId}`,
      target: {
        module: 'procedural',
        updatePolicy: 'strict_auto_promote',
        risk: 'low'
      },
      createdAt: result.admission.createdAt
    })

    const review = await readReviewDecisionsFromRoot(result.memoryRoot)
    expect(review).toHaveLength(1)
    expect(review[0]).toMatchObject({
      id: `review-semantic-${result.admission.draftId}`,
      semanticMemoryId: `semantic-${result.admission.draftId}`,
      policy: 'strict_auto_promote',
      createdAt: result.admission.createdAt
    })
    expect(review[0]?.reasons).toEqual(routing[0]?.target.reasons)
  })

  it('keeps source-of-truth raw excerpts reference-only without pending or distillation writes', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-reference-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-reference-project-')

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'file',
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        candidateKind: 'workflow_rule',
        content: 'AGENTS.md 中规定：所有修改必须直接追溯到指定的 issue 或 task，进行精确的手术式更改。',
        normalizedKey: 'agents-md-all-edits-surgical',
        sourceOfTruth: 'AGENTS.md',
        evidence: [{ summary: 'AGENTS.md', sourceKind: 'file' }],
        source: 'file'
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('reference_only')
    const routing = await readRoutingDecisionsFromRoot(result.memoryRoot)
    expect(routing[0]?.target).toMatchObject({
      module: 'procedural',
      updatePolicy: 'drop',
      risk: 'low'
    })
    await expect(readDistillationInputsFromRoot(result.memoryRoot)).resolves.toEqual([])
    await expect(readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not infer reference-only source boundaries from evidence summaries', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-summary-boundary-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-summary-boundary-project-')

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'file',
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        candidateKind: 'workflow_rule',
        content: 'AGENTS.md 中规定：所有修改必须直接追溯到指定的 issue 或 task，进行精确的手术式更改。',
        normalizedKey: 'agents-md-summary-only-boundary',
        evidence: [{ summary: 'AGENTS.md', sourceKind: 'file' }],
        source: 'file'
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('admit_to_distillation')
    expect(result.admission.reasons).toContain('raw_file_rule_excerpt')
    expect(result.admission.reasons).not.toContain('source_of_truth_duplicate')
  })

  it('routes task state sidecars without pending writes', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-task-state-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-task-state-project-')

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'review_summary',
      candidate: {
        domain: 'project',
        type: 'project_fact',
        candidateKind: 'project_fact',
        content: 'This branch review is currently in progress.',
        normalizedKey: 'branch-review-progress',
        evidence: [{ summary: 'Review summary records in-progress state.' }],
        taskState: {
          kind: 'implementation_progress',
          summary: 'Branch review is in progress.'
        }
      } as unknown as Parameters<typeof runCodexAdmissionPipeline>[0]['candidate'],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('task_state')
    const routing = await readRoutingDecisionsFromRoot(result.memoryRoot)
    expect(routing[0]?.target).toMatchObject({
      module: 'task_state',
      updatePolicy: 'defer'
    })
    await expect(readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('passes router update policy into proposal auto-promotion gating', async () => {
    const proposeSpy = vi.mocked(proposeCodexMemoryCandidate)
    const home = await createTempDir('cyrene-admission-pipeline-policy-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-policy-project-')

    await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'user_explicit',
      allowAutoPromote: true,
      candidate: {
        domain: 'relationship',
        type: 'relationship_boundary',
        strength: 'hard',
        scope: 'project',
        candidateKind: 'user_instruction',
        content: 'Do not infer relationship or affective memory without explicit user approval.',
        normalizedKey: 'manual-only-relationship-memory',
        source: 'user_explicit',
        evidence: [{ summary: 'User explicitly set a relationship memory boundary.', sourceKind: 'user_explicit' }],
        scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.8, safety: 0.9, sensitivity: 0.7 }
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'file',
      allowAutoPromote: true,
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        strength: 'hard',
        scope: 'project',
        candidateKind: 'workflow_rule',
        content: 'Memory routing changes must preserve review-hash validation because active writes require v5 policy gates.',
        normalizedKey: 'strict-routing-review-hash-policy',
        source: 'file',
        evidence: [{ summary: 'AGENTS.md documents the review-hash memory policy.', sourceKind: 'file' }],
        scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.05 }
      },
      now: '2026-05-31T00:10:00.000Z'
    })

    const manualCall = proposeSpy.mock.calls.find(
      ([call]) => call.candidate.normalizedKey === 'manual-only-relationship-memory'
    )
    const strictCall = proposeSpy.mock.calls.find(
      ([call]) => call.candidate.normalizedKey === 'strict-routing-review-hash-policy'
    )
    expect(manualCall?.[0].allowAutoPromote).toBe(false)
    expect(strictCall?.[0].allowAutoPromote).toBe(true)
  })

  it('does not write routing or review decisions when proposal rejects admitted candidates', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-proposal-reject-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-proposal-reject-project-')

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'user_explicit',
      recordRejectedCandidate: false,
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        candidateKind: 'user_instruction',
        content: 'Repository memory changes must stay surgical and trace directly to the requested task.',
        normalizedKey: 'user-instruction-surgical-memory-changes',
        evidence: []
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('reject')
    expect(result.admission.action).toBe('admit_to_pending')
    await expect(readRoutingDecisionsFromRoot(result.memoryRoot)).resolves.toEqual([])
    await expect(readReviewDecisionsFromRoot(result.memoryRoot)).resolves.toEqual([])
  })

  it('merges admission lineage into existing pending memory', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-merge-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-merge-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), `${JSON.stringify(pendingMemory({
      sourceEpisodeIds: ['episode-old'],
      sourceDraftIds: ['draft-old']
    }))}\n`)

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'review_summary',
      sourceEpisodeIds: ['episode-new'],
      allowAutoPromote: false,
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        candidateKind: 'workflow_rule',
        content: 'Memory admission changes must preserve pending lineage across merges.',
        normalizedKey: 'merge-lineage-key',
        evidence: [{ summary: 'New pending evidence.', sourceKind: 'review_event' }],
        source: 'user_explicit',
        scores: { evidenceStrength: 0.8, stability: 0.75, usefulness: 0.75, safety: 0.9, sensitivity: 0.1 }
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')
    if (!('result' in result)) {
      throw new Error(`Expected proposed result, got ${result.action}`)
    }
    if (result.result.action !== 'pending') {
      throw new Error(`Expected pending result, got ${result.result.action}`)
    }
    expect(result.result.candidateId).toBe('pending-existing')
    expect(result.result.review.id).toBe('pending-existing')

    const pending = parseJsonLines<PendingMemory>(await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8'))
      .filter((item) => item.normalizedKey === 'merge-lineage-key')
    expect(pending).toHaveLength(1)
    expect(pending[0]?.id).toBe('pending-existing')
    expect(pending[0]?.sourceEpisodeIds).toEqual(expect.arrayContaining(['episode-old', 'episode-new']))
    expect(pending[0]?.sourceDraftIds).toEqual(expect.arrayContaining(['draft-old']))
    expect(pending[0]?.sourceDraftIds?.some((id) => id !== 'draft-old')).toBe(true)
  })

  it('does not write pending for duplicate active memory', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-duplicate-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-duplicate-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'index.jsonl'), `${JSON.stringify(activeMemory('duplicate-key'))}\n`)

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'review_summary',
      candidate: {
        domain: 'project',
        type: 'project_fact',
        candidateKind: 'project_fact',
        content: 'Duplicate active memory.',
        normalizedKey: 'duplicate-key',
        evidence: [{ summary: 'Duplicate evidence.' }]
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('reject_duplicate')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not infer source-of-truth duplicate reasons from evidence summaries', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-summary-duplicate-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-summary-duplicate-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'index.jsonl'), `${JSON.stringify(activeMemory('duplicate-summary-key'))}\n`)

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'file',
      candidate: {
        domain: 'project',
        type: 'project_fact',
        candidateKind: 'project_fact',
        content: 'Duplicate active memory.',
        normalizedKey: 'duplicate-summary-key',
        evidence: [{ summary: 'AGENTS.md', sourceKind: 'file' }],
        source: 'file'
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('reject_duplicate')
    expect(result.admission.reasons).toContain('duplicate_active')
    expect(result.admission.reasons).not.toContain('source_of_truth_duplicate')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects duplicate active memory using derived normalized keys', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-derived-duplicate-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-derived-duplicate-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'index.jsonl'), `${JSON.stringify(activeMemory('project-project-fact-duplicate-active-memory'))}\n`)

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'review_summary',
      candidate: {
        domain: 'project',
        type: 'project_fact',
        candidateKind: 'project_fact',
        content: 'Duplicate active memory',
        evidence: [{ summary: 'Duplicate evidence.' }]
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('reject_duplicate')
    expect(result.admission.reasons).toContain('duplicate_active')
    const drafts = await readFile(join(memoryRoot, 'candidate_drafts.jsonl'), 'utf8')
    expect(drafts).toContain('"normalizedKey":"project-project-fact-duplicate-active-memory"')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('drops tombstoned memory using derived normalized keys', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-derived-tombstone-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-derived-tombstone-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'tombstones.jsonl'), `${JSON.stringify(tombstone('project-project-fact-archived-memory'))}\n`)

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'review_summary',
      candidate: {
        domain: 'project',
        type: 'project_fact',
        candidateKind: 'project_fact',
        content: 'Archived memory',
        evidence: [{ summary: 'Archived evidence.' }]
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('auto_drop')
    expect(result.admission.reasons).toContain('conflicts_with_tombstone')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
