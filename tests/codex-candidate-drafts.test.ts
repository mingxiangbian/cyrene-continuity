import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendCandidateDraftFromRoot,
  readCandidateDraftsFromRoot
} from '../src/memory/memory-store.js'
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
})
