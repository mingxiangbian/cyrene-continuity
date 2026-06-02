import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { proposeCodexMemoryCandidate } from '../src/codex/memory-propose.js'
import { runCodexAdmissionPipeline } from '../src/codex/admission-pipeline.js'
import type { PendingMemory } from '../src/memory/types.js'

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

function parseJsonLines<T>(content: string): T[] {
  return content.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as T)
}

describe('Codex memory v1.4 pending creation shaping', () => {
  it('shapes pending-memory rejection workflows before pending write', async () => {
    const home = await createTempDir('cyrene-v14-shaping-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-v14-shaping-project-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        scope: 'project',
        source: 'review_event',
        candidateKind: 'workflow_rule',
        content: '拒绝 pending memory 的流程：按照 Cyrene review 流程，逐条进行哈希校验，确认后执行拒绝操作。操作后需验证 pending 列表为空。',
        normalizedKey: 'pending-memory-rejection-review-hash',
        evidence: [{ summary: 'Review flow recorded pending rejection hash checks.', evidenceGroupId: 'review-1' }],
        scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.05 },
        tags: ['workflow_rule']
      },
      now: '2026-06-02T00:00:00.000Z',
      allowAutoPromote: false
    })

    const pending = parseJsonLines<PendingMemory>(await readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8'))
    expect(pending).toHaveLength(1)
    expect(pending[0]?.content).toBe(
      'Pending-memory rejection workflows must validate each candidate review hash before mutation and verify the queue state after rejection.'
    )
    expect(pending[0]?.candidateKind).toBe('workflow_rule')
  })

  it('does not materialize distillation admissions as pending during shaping', async () => {
    const home = await createTempDir('cyrene-v14-no-materialize-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-v14-no-materialize-project-')

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'review_summary',
      candidate: {
        domain: 'project',
        type: 'project_fact',
        scope: 'project',
        source: 'review_event',
        candidateKind: 'project_decision',
        content: 'v1 admission gate 核心实现采用 subagent-driven 执行方案，并创建隔离工作区。',
        normalizedKey: 'v1-admission-gate-subagent-worktree',
        evidence: [{ summary: 'Review summary recorded implementation detail.', evidenceGroupId: 'summary-1' }],
        scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.05 },
        tags: ['project_decision']
      },
      now: '2026-06-02T00:00:00.000Z'
    })

    expect(result.action).toBe('admit_to_distillation')
    await expect(readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
