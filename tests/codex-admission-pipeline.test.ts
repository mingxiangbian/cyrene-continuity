import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCodexAdmissionPipeline } from '../src/codex/admission-pipeline.js'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import type { CyreneMemory } from '../src/memory/types.js'

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

describe('runCodexAdmissionPipeline', () => {
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
})
