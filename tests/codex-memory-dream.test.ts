import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { runCodexMemoryDream, testOnlyDreamLock } from '../src/codex/memory-dream.js'
import { readCodexMemoryDreamState } from '../src/codex/memory-dream-state.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
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

async function seedProjectPending(cwd: string, pending: PendingMemory[]): Promise<string> {
  const identity = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(identity.projectId)
  await mkdir(memoryRoot, { recursive: true })
  await writeFile(join(memoryRoot, 'pending.jsonl'), pending.map((item) => JSON.stringify(item)).join('\n') + '\n')
  return realpath(memoryRoot)
}

async function seedProjectActive(cwd: string, active: CyreneMemory[]): Promise<string> {
  const identity = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(identity.projectId)
  await mkdir(memoryRoot, { recursive: true })
  await writeFile(join(memoryRoot, 'index.jsonl'), active.map((item) => JSON.stringify(item)).join('\n') + '\n')
  return realpath(memoryRoot)
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
    content: 'Use Chinese for Cyrene specs and plans.',
    normalizedKey: 'cyrene-spec-plan-language',
    evidence: [
      {
        runId: 'run-1',
        sessionId: 'session-1',
        evidenceGroupId: 'group-1',
        sourceKind: 'user_explicit',
        summary: 'User asked for Chinese specs and plans.'
      }
    ],
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

function createActive(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Use Chinese for Cyrene specs and plans.',
    normalizedKey: 'cyrene-spec-plan-language',
    evidence: [{ runId: 'run-1', sourceKind: 'user_explicit', summary: 'User asked for Chinese specs and plans.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    tags: ['codex'],
    ...overrides
  }
}

describe('Codex memory dream runtime', () => {
  it('reads missing dream state without creating the memory root', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const missingRoot = join(home, '.cyrene', 'codex', 'projects', 'missing', 'memory')

    await expect(readCodexMemoryDreamState(missingRoot)).resolves.toEqual({ dreamDue: false })

    await expect(readdir(missingRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('light merges duplicate pending candidates without writing active memory', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const first = createPending()
    const second = createPending({
      id: 'pending-2',
      evidence: [{ runId: 'run-2', sessionId: 'session-2', evidenceGroupId: 'group-2', summary: 'Second evidence.' }],
      lastSeenAt: '2026-05-25T01:00:00.000Z'
    })
    const memoryRoot = await seedProjectPending(cwd, [first, second])

    const result = await runCodexMemoryDream({ cwd, stage: 'light', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({
      stage: 'light',
      promoted: 0,
      rejected: 0
    })
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const pending = parseJsonLines<PendingMemory>(await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8'))
    expect(pending).toHaveLength(1)
    expect(pending[0]?.seenCount).toBe(2)
    const events = parseJsonLines<MemoryEvent>(await readFile(join(memoryRoot, 'events.jsonl'), 'utf8'))
    expect(events).toContainEqual(expect.objectContaining({ action: 'audit', details: expect.objectContaining({ stage: 'light' }) }))
  })

  it('light re-reads pending after waiting for the maintenance lock', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_MEMORY_MAINTENANCE_LOCK_TIMEOUT_MS', '1000')
    const cwd = await createTempDir('cyrene-dream-project-')
    const first = createPending()
    const second = createPending({
      id: 'pending-2',
      evidence: [{ runId: 'run-2', sessionId: 'session-2', evidenceGroupId: 'group-2', summary: 'Second evidence.' }],
      lastSeenAt: '2026-05-25T01:00:00.000Z'
    })
    const memoryRoot = await seedProjectPending(cwd, [first])
    const lockDir = join(memoryRoot, '.maintenance.lock')
    await mkdir(lockDir)

    let settled = false
    const dream = runCodexMemoryDream({ cwd, stage: 'light', now: '2026-05-26T00:00:00.000Z' })
      .finally(() => {
        settled = true
      })

    await delay(50)
    expect(settled).toBe(false)

    await writeFile(join(memoryRoot, 'pending.jsonl'), [first, second].map((item) => JSON.stringify(item)).join('\n') + '\n')
    await rm(lockDir, { recursive: true, force: true })
    await dream

    const pending = parseJsonLines<PendingMemory>(await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8'))
    expect(pending).toHaveLength(1)
    expect(pending[0]?.seenCount).toBe(2)
    expect(pending[0]?.evidence.map((item) => item.runId)).toEqual(['run-1', 'run-2'])
  })

  it('rem computes distinct evidence and proposed action without writing active memory', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const candidate = createPending({
      seenCount: 2,
      evidence: [
        { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
        { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
      ]
    })
    const memoryRoot = await seedProjectPending(cwd, [candidate])

    await runCodexMemoryDream({ cwd, stage: 'rem', now: '2026-05-26T00:00:00.000Z' })

    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const events = parseJsonLines<MemoryEvent>(await readFile(join(memoryRoot, 'events.jsonl'), 'utf8'))
    expect(events).toContainEqual(
      expect.objectContaining({
        action: 'audit',
        details: expect.objectContaining({
          stage: 'rem',
          candidateId: candidate.id,
          distinctEvidenceCount: 2,
          proposedAction: 'promote'
        })
      })
    )
  })

  it('deep promotes repeated independent procedural memory and writes model profile', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const candidate = createPending({
      seenCount: 2,
      evidence: [
        { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
        { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
      ]
    })
    const memoryRoot = await seedProjectPending(cwd, [candidate])

    const result = await runCodexMemoryDream({ cwd, stage: 'deep', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 1, rejected: 0 })
    const active = parseJsonLines<CyreneMemory>(await readFile(join(memoryRoot, 'index.jsonl'), 'utf8'))
    expect(active[0]).toMatchObject({ id: candidate.id, status: 'active', content: candidate.content })
    expect((await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).trim()).toBe('')
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain(candidate.content)
    await expect(readdir(join(memoryRoot, 'snapshots'))).resolves.toHaveLength(1)
  })

  it('deep keeps insufficient evidence pending', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const candidate = createPending()
    const memoryRoot = await seedProjectPending(cwd, [candidate])

    const result = await runCodexMemoryDream({ cwd, stage: 'deep', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 0, keptPending: 1 })
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toBe('')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  })

  it('deep does not promote same-run duplicate evidence even with different evidence groups', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const candidate = createPending({
      seenCount: 2,
      evidence: [
        { runId: 'same-run', sessionId: 'same-session', evidenceGroupId: 'group-1', summary: 'First.' },
        { runId: 'same-run', sessionId: 'same-session', evidenceGroupId: 'group-2', summary: 'Duplicate.' }
      ]
    })
    const memoryRoot = await seedProjectPending(cwd, [candidate])

    await runCodexMemoryDream({ cwd, stage: 'deep', now: '2026-05-26T00:00:00.000Z' })

    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toBe('')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  })

  it('deep keeps assistant-derived candidates pending instead of promoting them', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const candidate = createPending({
      source: 'assistant_observed',
      seenCount: 2,
      evidence: [
        { runId: 'run-1', sessionId: 'session-1', evidenceGroupId: 'group-1', sourceKind: 'assistant_observed', summary: 'First.' },
        { runId: 'run-2', sessionId: 'session-2', evidenceGroupId: 'group-2', sourceKind: 'assistant_observed', summary: 'Second.' }
      ]
    })
    const memoryRoot = await seedProjectPending(cwd, [candidate])

    const result = await runCodexMemoryDream({ cwd, stage: 'deep', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 0, rejected: 0, keptPending: 1 })
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toBe('')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  })

  it('deep rejects diagnostic affective claims and writes a tombstone', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const candidate = createPending({
      id: 'pending-affective',
      domain: 'affective',
      type: 'affective_pattern',
      strength: 'soft',
      scope: 'session',
      content: 'The user is unstable and emotionally dependent.',
      normalizedKey: 'diagnostic-affective-claim',
      seenCount: 3,
      evidence: [
        { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
        { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' },
        { runId: 'run-3', evidenceGroupId: 'group-3', summary: 'Third.' }
      ],
      scores: {
        evidenceStrength: 0.95,
        stability: 0.9,
        usefulness: 0.9,
        safety: 0.95,
        sensitivity: 0.1
      }
    })
    const memoryRoot = await seedProjectPending(cwd, [candidate])

    const result = await runCodexMemoryDream({ cwd, stage: 'deep', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 0, rejected: 1 })
    expect((await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).trim()).toBe('')
    const tombstones = parseJsonLines<MemoryTombstone>(await readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8'))
    expect(tombstones[0]).toMatchObject({ normalizedKey: candidate.normalizedKey, reason: 'rejected' })
  })

  it('deep removes low-safety pending candidates instead of keeping them forever', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const candidate = createPending({
      seenCount: 2,
      scores: {
        evidenceStrength: 0.95,
        stability: 0.9,
        usefulness: 0.9,
        safety: 0.55,
        sensitivity: 0.1
      },
      evidence: [
        { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
        { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
      ]
    })
    const memoryRoot = await seedProjectPending(cwd, [candidate])

    const result = await runCodexMemoryDream({ cwd, stage: 'deep', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 0, rejected: 1, keptPending: 0 })
    expect((await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).trim()).toBe('')
    const tombstones = parseJsonLines<MemoryTombstone>(await readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8'))
    expect(tombstones[0]).toMatchObject({ normalizedKey: candidate.normalizedKey, reason: 'rejected' })
  })

  it('deep expires stale pending candidates instead of promoting them', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const candidate = createPending({
      seenCount: 2,
      expiresAt: '2026-05-25T00:00:00.000Z',
      evidence: [
        { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
        { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
      ]
    })
    const memoryRoot = await seedProjectPending(cwd, [candidate])

    const result = await runCodexMemoryDream({ cwd, stage: 'deep', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 0, rejected: 1, keptPending: 0 })
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toBe('')
    expect((await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).trim()).toBe('')
    const tombstones = parseJsonLines<MemoryTombstone>(await readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8'))
    expect(tombstones[0]).toMatchObject({ normalizedKey: candidate.normalizedKey, reason: 'expired' })
  })

  it('deep runs maintenance and renders profile even when pending does not mutate', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const expired = createActive({
      expiresAt: '2026-05-25T00:00:00.000Z'
    })
    const memoryRoot = await seedProjectActive(cwd, [expired])

    const result = await runCodexMemoryDream({ cwd, stage: 'deep', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({
      promoted: 0,
      rejected: 0,
      maintenance: expect.objectContaining({ expired: 1, activeCount: 0 })
    })
    expect(await readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).toBe('')
    const tombstones = parseJsonLines<MemoryTombstone>(await readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8'))
    expect(tombstones[0]).toMatchObject({ normalizedKey: expired.normalizedKey, reason: 'expired' })
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain('# Cyrene Model Profile')
  })

  it('deep records failed dream state when acquiring a writable root lock errors', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const memoryRoot = await seedProjectPending(cwd, [createPending()])
    await writeFile(join(memoryRoot, '.locks'), 'not a directory')

    await expect(runCodexMemoryDream({ cwd, stage: 'deep', now: '2026-05-26T00:00:00.000Z' })).rejects.toThrow(/dream locks path/)

    await expect(readCodexMemoryDreamState(memoryRoot)).resolves.toMatchObject({
      dreamDue: true,
      lastDreamStatus: 'failed',
      lastDreamAt: '2026-05-26T00:00:00.000Z'
    })
  })

  it('deep skips a root when a non-expired dream lock exists', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const candidate = createPending({
      seenCount: 2,
      evidence: [
        { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
        { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
      ]
    })
    const memoryRoot = await seedProjectPending(cwd, [candidate])
    await mkdir(join(memoryRoot, '.locks', 'dream.lock'), { recursive: true })
    await writeFile(join(memoryRoot, '.locks', 'dream.lock', 'owner.json'), JSON.stringify({ acquiredAt: '2026-05-26T00:00:00.000Z' }))

    const result = await runCodexMemoryDream({ cwd, stage: 'deep', now: '2026-05-26T00:01:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)?.skipped).toMatch(/dream lock/)
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('deep replaces a stale dream lock', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const candidate = createPending({
      seenCount: 2,
      evidence: [
        { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
        { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
      ]
    })
    const memoryRoot = await seedProjectPending(cwd, [candidate])
    await mkdir(join(memoryRoot, '.locks', 'dream.lock'), { recursive: true })
    await writeFile(join(memoryRoot, '.locks', 'dream.lock', 'owner.json'), JSON.stringify({ acquiredAt: '2026-05-25T00:00:00.000Z' }))

    const result = await runCodexMemoryDream({ cwd, stage: 'deep', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 1 })
    await expect(readFile(join(memoryRoot, '.locks', 'dream.lock', 'owner.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not release a dream lock after the owner token changes', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const memoryRoot = await seedProjectPending(cwd, [])

    const lock = await testOnlyDreamLock.acquire(memoryRoot, '2026-05-26T00:00:00.000Z', 60_000)
    expect(lock.acquired).toBe(true)
    if (!lock.acquired) {
      return
    }
    const ownerPath = join(memoryRoot, '.locks', 'dream.lock', 'owner.json')
    await writeFile(ownerPath, JSON.stringify({ acquiredAt: '2026-05-26T00:00:01.000Z', pid: 999, token: 'other-owner' }))

    await testOnlyDreamLock.release(lock)

    await expect(readFile(ownerPath, 'utf8')).resolves.toContain('other-owner')
  })

  it('deep promotes global-scope pending memory from the global root', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const candidate = createPending({
      scope: 'global',
      content: 'All projects should write Cyrene specs and plans in Chinese.',
      seenCount: 2,
      evidence: [
        { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
        { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
      ]
    })
    const memoryRoot = await seedGlobalPending([candidate])

    const result = await runCodexMemoryDream({ cwd, stage: 'deep', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 1 })
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  })
})
