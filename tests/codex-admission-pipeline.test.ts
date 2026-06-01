import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCodexAdmissionPipeline } from '../src/codex/admission-pipeline.js'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { deleteCodexProjectMemory } from '../src/codex/project-registry.js'
import { readDistillationInputsFromRoot } from '../src/memory/memory-store.js'
import type { CyreneMemory, MemoryTombstone, PendingMemory } from '../src/memory/types.js'

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
    expect(pending).toContain('"sourceEpisodeIds":["episode-1"]')
    expect(pending).toContain('"sourceDraftIds"')
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
