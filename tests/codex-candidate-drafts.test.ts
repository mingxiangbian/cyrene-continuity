import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendCandidateDraftFromRoot,
  readCandidateDraftsFromRoot
} from '../src/memory/memory-store.js'
import { toCandidateDraft } from '../src/codex/candidate-drafts.js'
import type { CandidateDraft } from '../src/memory/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function draft(overrides: Partial<CandidateDraft> = {}): CandidateDraft {
  return {
    id: 'draft-1',
    content: 'Project memory changes should preserve review-hash validation.',
    candidateKind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    sourceKind: 'review_summary',
    sourceEpisodeIds: ['episode-1'],
    evidenceRefs: ['summary-1'],
    normalizedKey: 'project-memory-review-hash',
    tags: ['codex-review-summary'],
    createdAt: '2026-05-31T00:00:00.000Z',
    ...overrides
  }
}

describe('Candidate draft store', () => {
  it('appends and reads candidate drafts from a memory root', async () => {
    const root = await createTempDir('cyrene-draft-root-')

    await appendCandidateDraftFromRoot(root, draft())
    await appendCandidateDraftFromRoot(root, draft({ id: 'draft-2', content: 'Second draft.' }))

    await expect(readCandidateDraftsFromRoot(root)).resolves.toEqual([
      draft(),
      draft({ id: 'draft-2', content: 'Second draft.' })
    ])
    await expect(readFile(join(root, 'candidate_drafts.jsonl'), 'utf8')).resolves.toContain('"id":"draft-1"')
  })

  it('returns empty list when draft file is missing', async () => {
    const root = await createTempDir('cyrene-draft-empty-root-')

    await expect(readCandidateDraftsFromRoot(root)).resolves.toEqual([])
  })

  it('preserves explicit source-of-truth boundaries on candidate drafts', () => {
    const candidateDraft = toCandidateDraft({
      projectId: 'project-1',
      sourceKind: 'file',
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        candidateKind: 'workflow_rule',
        content: 'Repository workflow rules should remain grounded in AGENTS.md.',
        sourceOfTruth: 'AGENTS.md',
        evidence: [{ summary: 'AGENTS.md documents repository workflow rules.', sourceKind: 'file' }]
      },
      now: '2026-06-02T00:00:00.000Z'
    })

    expect(candidateDraft.sourceOfTruth).toBe('AGENTS.md')
  })

  it('does not infer source-of-truth boundaries from evidence summary or quote text', () => {
    const candidateDraft = toCandidateDraft({
      projectId: 'project-1',
      sourceKind: 'file',
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        candidateKind: 'workflow_rule',
        content: 'Repository workflow rules should remain grounded in source files.',
        evidence: [
          {
            summary: 'AGENTS.md documents repository workflow rules.',
            quote: 'AGENTS.md 中规定：所有修改必须直接追溯到指定的 issue 或 task。'
          }
        ]
      },
      now: '2026-06-02T00:00:00.000Z'
    })

    expect(candidateDraft.sourceOfTruth).toBeUndefined()
  })

  it('does not infer source-of-truth boundaries from hash-only evidence groups', () => {
    const candidateDraft = toCandidateDraft({
      projectId: 'project-1',
      sourceKind: 'review_summary',
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        candidateKind: 'workflow_rule',
        content: 'Pending review hash conflicts should be diagnosed from pending.jsonl.',
        evidence: [
          {
            sourceKind: 'file',
            evidenceGroupId: 'acf8f8be4fb2e829a8188ed9dd3a6b8449daf93638b3c96a148136ae144da527',
            summary: 'Review summary recorded a pending hash conflict.'
          }
        ]
      },
      now: '2026-06-02T00:00:00.000Z'
    })

    expect(candidateDraft.sourceOfTruth).toBeUndefined()
    expect(candidateDraft.evidenceRefs).toEqual([
      'acf8f8be4fb2e829a8188ed9dd3a6b8449daf93638b3c96a148136ae144da527'
    ])
  })

  it('can infer source-of-truth boundaries from explicit evidence trace refs', () => {
    const candidateDraft = toCandidateDraft({
      projectId: 'project-1',
      sourceKind: 'file',
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        candidateKind: 'workflow_rule',
        content: 'Repository workflow rules should remain grounded in source files.',
        evidence: [{ traceRefs: ['AGENTS.md'], summary: 'Source trace for repository workflow rules.' }]
      },
      now: '2026-06-02T00:00:00.000Z'
    })

    expect(candidateDraft.sourceOfTruth).toBe('AGENTS.md')
  })
})
