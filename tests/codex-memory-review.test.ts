import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import {
  getCodexPendingMemory,
  getCodexPendingReviewNotice,
  listCodexPendingMemories,
  promoteCodexPendingMemory,
  rejectCodexPendingMemory,
  reviewHashForPendingMemory
} from '../src/codex/memory-review.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { renderMemoryProjectionsFromRoot } from '../src/memory/memory-exporter.js'
import type { CyreneMemory, MemoryEvent, MemoryTombstone, PendingMemory } from '../src/memory/types.js'

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

async function seedPending(cwd: string, pending: PendingMemory[]): Promise<string> {
  const identity = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(identity.projectId)
  await mkdir(memoryRoot, { recursive: true })
  await writeFile(join(memoryRoot, 'pending.jsonl'), pending.map((item) => JSON.stringify(item)).join('\n') + '\n')
  return memoryRoot
}

async function seedGlobalPending(pending: PendingMemory[]): Promise<string> {
  const memoryRoot = codexGlobalMemoryRoot()
  await mkdir(memoryRoot, { recursive: true })
  await writeFile(join(memoryRoot, 'pending.jsonl'), pending.map((item) => JSON.stringify(item)).join('\n') + '\n')
  return realpath(memoryRoot)
}

function parseJsonLines<T>(content: string): T[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'Use Codex chat approval before promoting pending memory.',
    normalizedKey: 'codex-chat-approval-before-promote',
    evidence: [{ runId: 'run-1', summary: 'User confirmed Codex pending review workflow.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-05-25T00:00:00.000Z',
    lastSeenAt: '2026-05-25T00:00:00.000Z',
    expiresAt: '2026-06-24T00:00:00.000Z',
    tags: ['codex'],
    ...overrides
  }
}

describe('Codex pending memory review', () => {
  it('lists pending memories with review hashes and evidence summaries', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    await seedPending(cwd, [candidate])

    const result = await listCodexPendingMemories({ cwd })

    expect(result.total).toBe(1)
    expect(result.pending[0]).toMatchObject({
      id: 'pending-1',
      content: 'Use Codex chat approval before promoting pending memory.',
      evidenceSummary: ['User confirmed Codex pending review workflow.']
    })
    expect(result.pending[0]?.reviewHash).toBe(reviewHashForPendingMemory(candidate))
  })

  it('gets a pending memory by id with full candidate and review hash', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    await seedPending(cwd, [candidate])

    const result = await getCodexPendingMemory({ cwd, id: 'pending-1' })

    expect(result.result.action).toBe('get')
    if (result.result.action !== 'get') throw new Error('expected get')
    expect(result.result.candidate.content).toBe(candidate.content)
    expect(result.result.reviewHash).toBe(reviewHashForPendingMemory(candidate))
  })

  it('lists global pending memories when the current project has no pending file', async () => {
    const home = await createTempDir('cyrene-review-global-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-global-project-')
    const candidate = createPending({
      id: 'global-pending-1',
      scope: 'global',
      content: 'Global pending memory should be visible from any project.',
      lastSeenAt: '2026-05-25T02:00:00.000Z'
    })
    const globalRoot = await seedGlobalPending([candidate])

    const result = await listCodexPendingMemories({ cwd })

    expect(result.total).toBe(1)
    expect(result.memoryRoot).toBe(codexProjectMemoryRoot((await identifyCodexProject(cwd)).projectId))
    expect(result.pending[0]?.id).toBe(candidate.id)
    expect(await getCodexPendingMemory({ cwd, id: candidate.id })).toMatchObject({
      memoryRoot: globalRoot,
      result: { action: 'get' }
    })
  })

  it('lists global and project pending memories newest first', async () => {
    const home = await createTempDir('cyrene-review-global-project-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-global-project-')
    await seedGlobalPending([
      createPending({
        id: 'global-old',
        scope: 'global',
        content: 'Older global pending memory.',
        lastSeenAt: '2026-05-25T01:00:00.000Z'
      })
    ])
    await seedPending(cwd, [
      createPending({
        id: 'project-new',
        scope: 'project',
        content: 'Newer project pending memory.',
        lastSeenAt: '2026-05-25T03:00:00.000Z'
      })
    ])

    const result = await listCodexPendingMemories({ cwd })

    expect(result.total).toBe(2)
    expect(result.pending.map((item) => item.id)).toEqual(['project-new', 'global-old'])
  })

  it('promotes a global pending memory only in the global root', async () => {
    const home = await createTempDir('cyrene-review-promote-global-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-promote-global-project-')
    const candidate = createPending({
      id: 'global-promote',
      scope: 'global',
      content: 'Promoted global pending memory stays in global memory root.',
      normalizedKey: 'global-promote-root'
    })
    const globalRoot = await seedGlobalPending([candidate])
    const projectRoot = codexProjectMemoryRoot((await identifyCodexProject(cwd)).projectId)

    const result = await promoteCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      reason: 'User approved global memory.',
      now: '2026-05-25T04:00:00.000Z'
    })

    expect(result.result.action).toBe('promote')
    expect(result.memoryRoot).toBe(globalRoot)
    expect(await readFile(join(globalRoot, 'index.jsonl'), 'utf8')).toContain(candidate.content)
    await expect(readFile(join(projectRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a global pending memory only in the global root', async () => {
    const home = await createTempDir('cyrene-review-reject-global-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-reject-global-project-')
    const candidate = createPending({
      id: 'global-reject',
      scope: 'global',
      content: 'Rejected global pending memory writes global tombstone.',
      normalizedKey: 'global-reject-root'
    })
    const globalRoot = await seedGlobalPending([candidate])
    const projectRoot = codexProjectMemoryRoot((await identifyCodexProject(cwd)).projectId)

    const result = await rejectCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      reason: 'User rejected global memory.',
      now: '2026-05-25T05:00:00.000Z'
    })

    expect(result.result.action).toBe('reject')
    expect(result.memoryRoot).toBe(globalRoot)
    expect(await readFile(join(globalRoot, 'tombstones.jsonl'), 'utf8')).toContain(candidate.normalizedKey)
    await expect(readFile(join(projectRoot, 'tombstones.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('promotes a pending memory after hash confirmation', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await promoteCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      reason: 'User approved in Codex.',
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('promote')
    const index = await readFile(join(memoryRoot, 'index.jsonl'), 'utf8')
    expect(index).toContain(candidate.content)
    expect(index).toContain('"userConfirmed":true')
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending.trim()).toBe('')
    const events = await readFile(join(memoryRoot, 'events.jsonl'), 'utf8')
    expect(parseJsonLines<MemoryEvent>(events)).toEqual([
      expect.objectContaining({
        action: 'promote',
        candidateId: candidate.id,
        memoryId: candidate.id,
        reason: 'User approved in Codex.'
      }),
      expect.objectContaining({
        action: 'snapshot',
        reason: 'after manual memory promotion'
      })
    ])
    const projection = await readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')
    expect(projection).toContain(candidate.content)
    const snapshots = await readdir(join(memoryRoot, 'snapshots'))
    expect(snapshots).toHaveLength(1)
  })

  it('promotes affective pending memory using validator-normalized shape', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending({
      id: 'pending-affective',
      domain: 'affective',
      type: 'affective_pattern',
      strength: 'hard',
      scope: 'global',
      content: 'The user responds better when review notes stay concrete and task-focused.',
      normalizedKey: 'affective-concrete-review-notes',
      evidence: [{ runId: 'run-affect', summary: 'User explicitly preferred concrete task-focused review notes.' }],
      source: 'user_explicit',
      scores: {
        evidenceStrength: 0.95,
        stability: 0.9,
        usefulness: 0.85,
        safety: 0.95,
        sensitivity: 0.1
      }
    })
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await promoteCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      reason: 'User approved normalized affective memory.',
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('promote')
    if (result.result.action !== 'promote') throw new Error('expected promote')
    expect(result.result.memory).toMatchObject({
      id: candidate.id,
      domain: 'affective',
      strength: 'soft',
      scope: 'project',
      userConfirmed: true
    })
    const index = parseJsonLines<CyreneMemory>(await readFile(join(memoryRoot, 'index.jsonl'), 'utf8'))
    expect(index[0]).toMatchObject({
      id: candidate.id,
      strength: 'soft',
      scope: 'project',
      userConfirmed: true
    })
  })

  it('rejects a pending memory after hash confirmation and writes a tombstone', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await rejectCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      reason: 'User rejected in Codex.',
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('reject')
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending.trim()).toBe('')
    const tombstones = await readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8')
    expect(parseJsonLines<MemoryTombstone>(tombstones)).toEqual([
      expect.objectContaining({
        normalizedKey: candidate.normalizedKey,
        reason: 'rejected'
      })
    ])
    const events = await readFile(join(memoryRoot, 'events.jsonl'), 'utf8')
    expect(parseJsonLines<MemoryEvent>(events)).toEqual([
      expect.objectContaining({
        action: 'reject',
        candidateId: candidate.id,
        reason: 'User rejected in Codex.'
      })
    ])
  })

  it('returns conflict and does not mutate files when review hash is stale', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await promoteCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: 'stale',
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('conflict')
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain(candidate.content)
  })

  it('returns conflict when review-significant fields changed after hash review', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const reviewedCandidate = createPending()
    const staleReviewHash = reviewHashForPendingMemory(reviewedCandidate)
    const changedCandidate = createPending({
      strength: 'soft',
      scope: 'global'
    })
    const memoryRoot = await seedPending(cwd, [changedCandidate])

    const result = await promoteCodexPendingMemory({
      cwd,
      id: changedCandidate.id,
      reviewHash: staleReviewHash,
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('conflict')
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain(changedCandidate.content)
  })

  it('reject re-reads pending under lock before mutating stale reviewed candidates', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_MEMORY_MAINTENANCE_LOCK_TIMEOUT_MS', '1000')
    const cwd = await createTempDir('cyrene-review-project-')
    const reviewedCandidate = createPending()
    const changedCandidate = createPending({
      strength: 'soft',
      scope: 'global',
      content: 'Changed pending memory must survive stale reject.',
      normalizedKey: 'changed-pending-memory-must-survive'
    })
    const memoryRoot = await seedPending(cwd, [reviewedCandidate])
    const staleReviewHash = reviewHashForPendingMemory(reviewedCandidate)
    const lockPath = join(memoryRoot, '.maintenance.lock')
    await mkdir(lockPath)

    const pendingReject = rejectCodexPendingMemory({
      cwd,
      id: reviewedCandidate.id,
      reviewHash: staleReviewHash,
      now: '2026-05-25T01:00:00.000Z'
    })

    try {
      await delay(30)
      await writeFile(join(memoryRoot, 'pending.jsonl'), `${JSON.stringify(changedCandidate)}\n`, 'utf8')
      await rm(lockPath, { recursive: true, force: true })
      const result = await pendingReject

      expect(result.result.action).toBe('conflict')
      const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
      expect(pending).toContain(changedCandidate.content)
      await expect(readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(join(memoryRoot, 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(lockPath, { recursive: true, force: true })
    }
  })

  it('treats evidence grouping metadata as review-significant', () => {
    const candidate = createPending({
      evidence: [{ runId: 'run-1', summary: 'User confirmed.', evidenceGroupId: 'group-1' }]
    })
    const changed = createPending({
      evidence: [{ runId: 'run-1', summary: 'User confirmed.', evidenceGroupId: 'group-2' }]
    })

    expect(reviewHashForPendingMemory(changed)).not.toBe(reviewHashForPendingMemory(candidate))
  })

  it('blocks promote when validator rejects the candidate', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending({
      id: 'pending-unsafe',
      normalizedKey: 'unsafe-affective-diagnostic',
      domain: 'affective',
      type: 'affective_pattern',
      content: 'The user is emotionally dependent and unstable.'
    })
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await promoteCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('rejected_by_validator')
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain(candidate.content)
  })

  it('rejects rendering projections through a symlinked memory root', async () => {
    const parent = await createTempDir('cyrene-review-root-parent-')
    const outside = await createTempDir('cyrene-review-root-outside-')
    const memoryRoot = join(parent, 'memory')
    await symlink(outside, memoryRoot)

    await expect(renderMemoryProjectionsFromRoot(memoryRoot)).rejects.toThrow(/memory symlink/)
  })

  it('rejects rendering projections through a non-directory memory root', async () => {
    const parent = await createTempDir('cyrene-review-root-parent-')
    const memoryRoot = join(parent, 'memory')
    await writeFile(memoryRoot, 'not a directory', 'utf8')

    await expect(renderMemoryProjectionsFromRoot(memoryRoot)).rejects.toThrow(/non-directory memory path/)
  })

  it('does not write legacy projections through a symlinked projections directory', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const outside = await createTempDir('cyrene-review-projections-outside-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])
    await symlink(outside, join(memoryRoot, 'projections'))

    const result = await promoteCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('promote')
    await expect(readFile(join(outside, 'MEMORY.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain(candidate.content)
  })

  it('rejects promotion through a symlinked Codex project root before reading outside pending memory', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const identity = await identifyCodexProject(cwd)
    const outsideProject = await createTempDir('cyrene-review-project-root-outside-')
    const outsideMemory = join(outsideProject, 'memory')
    const candidate = createPending()
    await mkdir(outsideMemory, { recursive: true })
    await writeFile(join(outsideMemory, 'pending.jsonl'), `${JSON.stringify(candidate)}\n`, 'utf8')
    await mkdir(join(home, '.cyrene', 'codex', 'projects'), { recursive: true })
    await symlink(outsideProject, join(home, '.cyrene', 'codex', 'projects', identity.projectId))

    await expect(
      promoteCodexPendingMemory({
        cwd,
        id: candidate.id,
        reviewHash: reviewHashForPendingMemory(candidate),
        now: '2026-05-25T01:00:00.000Z'
      })
    ).rejects.toThrow(/memory symlink/)

    await expect(readFile(join(outsideMemory, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(outsideMemory, 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(outsideMemory, 'MODEL_PROFILE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('renders model profile when the legacy projections path is a file', async () => {
    const memoryRoot = await createTempDir('cyrene-review-memory-root-')
    await writeFile(join(memoryRoot, 'projections'), 'not a directory', 'utf8')

    await expect(renderMemoryProjectionsFromRoot(memoryRoot)).resolves.toBeUndefined()
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain('# Cyrene Model Profile')
  })

  it('promotes when the legacy projections path is a file', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])
    await writeFile(join(memoryRoot, 'projections'), 'not a directory', 'utf8')

    const result = await promoteCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      now: '2026-05-25T01:00:00.000Z'
    })

    expect(result.result.action).toBe('promote')
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toContain(candidate.content)
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain(candidate.content)
  })

  it('rejects rendering MODEL_PROFILE.md symlinks without changing outside files', async () => {
    const memoryRoot = await createTempDir('cyrene-review-memory-root-')
    const outside = await createTempDir('cyrene-review-projection-file-outside-')
    const outsideTarget = join(outside, 'outside.md')
    await writeFile(outsideTarget, 'outside original\n', 'utf8')
    await symlink(outsideTarget, join(memoryRoot, 'MODEL_PROFILE.md'))

    await expect(renderMemoryProjectionsFromRoot(memoryRoot)).rejects.toThrow(/projection.*symlink/)

    await expect(readFile(outsideTarget, 'utf8')).resolves.toBe('outside original\n')
  })

  it('rejects promotion before mutation when MODEL_PROFILE.md is a symlink', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const outside = await createTempDir('cyrene-review-promote-output-outside-')
    const outsideTarget = join(outside, 'outside.md')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])
    await writeFile(outsideTarget, 'outside original\n', 'utf8')
    await symlink(outsideTarget, join(memoryRoot, 'MODEL_PROFILE.md'))

    await expect(
      promoteCodexPendingMemory({
        cwd,
        id: candidate.id,
        reviewHash: reviewHashForPendingMemory(candidate),
        now: '2026-05-25T01:00:00.000Z'
      })
    ).rejects.toThrow(/projection.*symlink/)

    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(outsideTarget, 'utf8')).resolves.toBe('outside original\n')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  })

  it('rejects promotion before mutation when the snapshots directory is a symlink', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const outside = await createTempDir('cyrene-review-snapshots-outside-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])
    await symlink(outside, join(memoryRoot, 'snapshots'))

    await expect(
      promoteCodexPendingMemory({
        cwd,
        id: candidate.id,
        reviewHash: reviewHashForPendingMemory(candidate),
        now: '2026-05-25T01:00:00.000Z'
      })
    ).rejects.toThrow(/memory snapshots path/)

    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  })

  it('rejects promotion before mutation when the maintenance lock cannot be acquired', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])
    await mkdir(join(memoryRoot, '.maintenance.lock'))
    vi.stubEnv('CYRENE_MEMORY_MAINTENANCE_LOCK_TIMEOUT_MS', '1')

    await expect(
      promoteCodexPendingMemory({
        cwd,
        id: candidate.id,
        reviewHash: reviewHashForPendingMemory(candidate),
        now: '2026-05-25T01:00:00.000Z'
      })
    ).rejects.toThrow(/maintenance lock/)

    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  })

  it('rejects rendering MODEL_PROFILE.md targets that are directories', async () => {
    const memoryRoot = await createTempDir('cyrene-review-memory-root-')
    await mkdir(join(memoryRoot, 'MODEL_PROFILE.md'))

    await expect(renderMemoryProjectionsFromRoot(memoryRoot)).rejects.toThrow(/non-file memory projection path/)
  })

  it('rejects promotion before mutation when MODEL_PROFILE.md is a directory', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])
    await mkdir(join(memoryRoot, 'MODEL_PROFILE.md'))

    await expect(
      promoteCodexPendingMemory({
        cwd,
        id: candidate.id,
        reviewHash: reviewHashForPendingMemory(candidate),
        now: '2026-05-25T01:00:00.000Z'
      })
    ).rejects.toThrow(/non-file memory projection path/)

    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  })

  it('removes legacy generated projection files after rendering model profile', async () => {
    const memoryRoot = await createTempDir('cyrene-review-memory-root-')
    const generated = '<!-- Generated from index.jsonl. Do not edit manually. -->\n\nold\n'
    const oldGenerated = '<!-- Generated from .cyrene/memory/index.jsonl. Do not edit manually. -->\n\nold\n'
    await mkdir(join(memoryRoot, 'projections'))
    await writeFile(join(memoryRoot, 'MEMORY.md'), oldGenerated, 'utf8')
    await writeFile(join(memoryRoot, 'projections', 'MEMORY.md'), generated, 'utf8')
    await writeFile(join(memoryRoot, 'projections', 'PROJECT.md'), generated, 'utf8')
    await writeFile(join(memoryRoot, 'projections', 'PERSONAL.md'), generated, 'utf8')
    await writeFile(join(memoryRoot, 'projections', 'AFFECT.md'), generated, 'utf8')

    await renderMemoryProjectionsFromRoot(memoryRoot)

    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain('# Cyrene Model Profile')
    await expect(readFile(join(memoryRoot, 'MEMORY.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readdir(join(memoryRoot, 'projections'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('renders concurrently while cleaning up generated legacy projections', async () => {
    const memoryRoot = await createTempDir('cyrene-review-memory-root-')
    const generated = '<!-- Generated from index.jsonl. Do not edit manually. -->\n\nold\n'
    await mkdir(join(memoryRoot, 'projections'))
    await writeFile(join(memoryRoot, 'MEMORY.md'), generated, 'utf8')
    await writeFile(join(memoryRoot, 'projections', 'MEMORY.md'), generated, 'utf8')
    await writeFile(join(memoryRoot, 'projections', 'PROJECT.md'), generated, 'utf8')
    await writeFile(join(memoryRoot, 'projections', 'PERSONAL.md'), generated, 'utf8')
    await writeFile(join(memoryRoot, 'projections', 'AFFECT.md'), generated, 'utf8')

    await expect(Promise.all(
      Array.from({ length: 20 }, () => renderMemoryProjectionsFromRoot(memoryRoot))
    )).resolves.toHaveLength(20)

    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain('# Cyrene Model Profile')
  })

  it('treats legacy cleanup ENOENT after checks as already cleaned', async () => {
    const memoryRoot = await createTempDir('cyrene-review-memory-root-')
    const generated = '<!-- Generated from index.jsonl. Do not edit manually. -->\n\nold\n'
    const projectionsDir = join(memoryRoot, 'projections')
    await mkdir(projectionsDir)
    await writeFile(join(memoryRoot, 'MEMORY.md'), generated, 'utf8')
    await writeFile(join(projectionsDir, 'MEMORY.md'), generated, 'utf8')

    vi.resetModules()
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return {
        ...actual,
        readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) => {
          if (String(args[0]).endsWith('/projections/MEMORY.md')) {
            throw Object.assign(new Error('removed during cleanup'), { code: 'ENOENT' })
          }
          return actual.readFile(...args)
        }),
        readdir: vi.fn(async (...args: Parameters<typeof actual.readdir>) => {
          if (String(args[0]) === projectionsDir) {
            throw Object.assign(new Error('removed during cleanup'), { code: 'ENOENT' })
          }
          return actual.readdir(...args)
        })
      }
    })

    try {
      const exporter = await import('../src/memory/memory-exporter.js')
      await expect(exporter.renderMemoryProjectionsFromRoot(memoryRoot)).resolves.toBeUndefined()
      await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain('# Cyrene Model Profile')
    } finally {
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
    }
  })

  it('returns a compact pending review notice', async () => {
    const home = await createTempDir('cyrene-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-project-')
    const older = createPending({ id: 'pending-old', lastSeenAt: '2026-05-25T00:00:00.000Z' })
    const newer = createPending({
      id: 'pending-new',
      content: 'Newest pending Codex memory should be visible as a notice preview.',
      normalizedKey: 'newest-pending-codex-memory',
      lastSeenAt: '2026-05-25T02:00:00.000Z'
    })
    await seedPending(cwd, [older, newer])

    const notice = await getCodexPendingReviewNotice({ cwd })

    expect(notice).toMatchObject({
      count: 2,
      hasItems: true,
      newestCandidateId: 'pending-new',
      newestPreview: 'Newest pending Codex memory should be visible as a notice preview.'
    })
  })
})
