import { mkdir, mkdtemp, readFile, readdir, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { buildDreamProposalForRoot } from '../src/codex/dream-proposal.js'
import { runCodexMemoryDream, testOnlyDreamLock, testOnlyDreamRuntime } from '../src/codex/memory-dream.js'
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

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return ''
    }
    throw error
  }
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
          proposedAction: 'recommend_promote'
        })
      })
    )
  })

  it('rem re-reads pending after waiting for the maintenance lock', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_MEMORY_MAINTENANCE_LOCK_TIMEOUT_MS', '1000')
    const cwd = await createTempDir('cyrene-dream-project-')
    const first = createPending()
    const second = createPending({
      seenCount: 2,
      evidence: [
        { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
        { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
      ]
    })
    const memoryRoot = await seedProjectPending(cwd, [first])
    const lockDir = join(memoryRoot, '.maintenance.lock')
    await mkdir(lockDir)

    let settled = false
    const dream = runCodexMemoryDream({ cwd, stage: 'rem', now: '2026-05-26T00:00:00.000Z' })
      .finally(() => {
        settled = true
      })

    await delay(50)
    expect(settled).toBe(false)

    await writeFile(join(memoryRoot, 'pending.jsonl'), `${JSON.stringify(second)}\n`)
    await rm(lockDir, { recursive: true, force: true })
    await dream

    const events = parseJsonLines<MemoryEvent>(await readFile(join(memoryRoot, 'events.jsonl'), 'utf8'))
    expect(events).toContainEqual(
      expect.objectContaining({
        action: 'audit',
        details: expect.objectContaining({
          stage: 'rem',
          candidateId: second.id,
          distinctEvidenceCount: 2,
          proposedAction: 'recommend_promote'
        })
      })
    )
  })

  it('builds a recommended promotion proposal for repeated independent procedural memory without writing active memory', async () => {
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

    const proposal = await buildDreamProposalForRoot({ memoryRoot, now: '2026-05-26T00:00:00.000Z' })

    expect(proposal.summary).toMatchObject({ recommendedPromotions: 1, reject: 0, expire: 0, keepPending: 1 })
    expect(proposal.proposedChanges[0]).toMatchObject({
      action: 'recommend_promote',
      candidateId: candidate.id,
      recommendedMemoryId: candidate.id,
      normalizedKey: candidate.normalizedKey,
      distinctEvidenceCount: 2
    })
    expect(proposal.applyPlan).toEqual([
      expect.objectContaining({ action: 'keep_pending', candidate: expect.objectContaining({ id: candidate.id }) })
    ])
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  })

  it('builds an empty proposal for a missing root without creating it', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const parent = await createTempDir('cyrene-dream-missing-root-parent-')
    const missingRoot = join(parent, 'missing', 'memory')

    const proposal = await buildDreamProposalForRoot({ memoryRoot: missingRoot, now: '2026-05-26T00:00:00.000Z' })

    expect(proposal.memoryRoot).toBe(missingRoot)
    expect(proposal.summary).toMatchObject({ recommendedPromotions: 0, reject: 0, expire: 0, keepPending: 0 })
    await expect(readdir(join(parent, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('builds an expired rejection proposal without writing tombstones', async () => {
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

    const proposal = await buildDreamProposalForRoot({ memoryRoot, now: '2026-05-26T00:00:00.000Z' })

    expect(proposal.summary).toMatchObject({ recommendedPromotions: 0, reject: 1, expire: 1, keepPending: 0 })
    expect(proposal.proposedChanges[0]).toMatchObject({
      action: 'reject',
      candidateId: candidate.id,
      normalizedKey: candidate.normalizedKey,
      tombstoneReason: 'expired'
    })
    await expect(readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('deep-preview writes review artifacts without mutating memory source files or dream state', async () => {
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
    const pendingBefore = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-preview', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({
      stage: 'deep-preview',
      promoted: 0,
      recommendedPromotions: 1,
      rejected: 0,
      keptPending: 1
    })
    await expect(readFile(join(memoryRoot, 'dream-preview', 'DREAM_REPORT.md'), 'utf8')).resolves.toContain(candidate.normalizedKey)
    const proposed = JSON.parse(await readFile(join(memoryRoot, 'dream-preview', 'proposed_changes.json'), 'utf8')) as {
      root: { proposedChanges: Array<{ action: string; candidateId: string }> }
    }
    expect(proposed.root.proposedChanges[0]).toMatchObject({ action: 'recommend_promote', candidateId: candidate.id })
    const diff = JSON.parse(await readFile(join(memoryRoot, 'dream-preview', 'diff.json'), 'utf8')) as {
      addActiveMemoryIds: string[]
      recommendActiveMemoryIds: string[]
      removePendingCandidateIds: string[]
      keepPendingCandidateIds: string[]
    }
    expect(diff.addActiveMemoryIds).toEqual([])
    expect(diff.recommendActiveMemoryIds).toEqual([candidate.id])
    expect(diff.removePendingCandidateIds).toEqual([])
    expect(diff.keepPendingCandidateIds).toEqual([candidate.id])
    const evalResults = JSON.parse(await readFile(join(memoryRoot, 'dream-preview', 'eval_results.json'), 'utf8')) as { passed: boolean }
    expect(evalResults.passed).toBe(true)
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'dream-state.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toBe(pendingBefore)
  })

  it('deep-preview records eval gate failures without rejecting diagnostic affective pending memory', async () => {
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
      ]
    })
    const memoryRoot = await seedProjectPending(cwd, [candidate])

    await runCodexMemoryDream({ cwd, stage: 'deep-preview', now: '2026-05-26T00:00:00.000Z' })

    const evalResults = JSON.parse(await readFile(join(memoryRoot, 'dream-preview', 'eval_results.json'), 'utf8')) as {
      passed: boolean
      failedChecks: string[]
    }
    expect(evalResults.passed).toBe(false)
    expect(evalResults.failedChecks).toContain('affective_boundary_eval')
    await expect(readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  })

  it('deep-apply recommends repeated independent procedural memory without promoting it', async () => {
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

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({
      stage: 'deep-apply',
      promoted: 0,
      recommendedPromotions: 1,
      rejected: 0,
      keptPending: 1
    })
    await expect(readOptionalText(join(memoryRoot, 'index.jsonl'))).resolves.not.toContain(candidate.content)
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
    await expect(readOptionalText(join(memoryRoot, 'events.jsonl'))).resolves.not.toContain('"action":"promote"')
    await expect(readFile(join(memoryRoot, 'dream-preview', 'DREAM_REPORT.md'), 'utf8')).resolves.toContain('recommend_promote')
    await expect(readdir(join(memoryRoot, 'snapshots'))).resolves.toHaveLength(1)
  })

  it('deep-apply keeps recommended candidates retrievable when maintenance trims pending', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_MEMORY_PENDING_MAX_ITEMS', '1')
    const cwd = await createTempDir('cyrene-dream-project-')
    const recommended = createPending({
      id: 'recommended-pending',
      content: 'Recommended memory should remain retrievable after deep apply.',
      normalizedKey: 'recommended-memory-remains-retrievable',
      seenCount: 2,
      lastSeenAt: '2026-05-24T00:00:00.000Z',
      evidence: [
        { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
        { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
      ]
    })
    const newer = createPending({
      id: 'newer-pending',
      content: 'Newer unrecommended memory may be trimmed first.',
      normalizedKey: 'newer-unrecommended-memory',
      lastSeenAt: '2026-05-26T00:00:00.000Z'
    })
    const memoryRoot = await seedProjectPending(cwd, [recommended, newer])

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({
      promoted: 0,
      recommendedPromotions: 1,
      keptPending: 1
    })
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(recommended.content)
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.not.toContain(newer.content)
  })

  it('deep-apply keeps promotable pending memory when promotion recommendations are disabled', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_MEMORY_RECOMMEND_PROMOTION', '0')
    const cwd = await createTempDir('cyrene-dream-project-')
    const candidate = createPending({
      seenCount: 2,
      evidence: [
        { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
        { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
      ]
    })
    const memoryRoot = await seedProjectPending(cwd, [candidate])

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({
      promoted: 0,
      recommendedPromotions: 0,
      keptPending: 1
    })
    const proposed = JSON.parse(await readFile(join(memoryRoot, 'dream-preview', 'proposed_changes.json'), 'utf8')) as {
      root: { proposedChanges: Array<{ action: string; reason: string }> }
    }
    expect(proposed.root.proposedChanges[0]).toMatchObject({
      action: 'keep_pending',
      reason: 'Promotion recommendations are disabled by configuration'
    })
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  })

  it('deep-apply keeps insufficient evidence pending', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const candidate = createPending()
    const memoryRoot = await seedProjectPending(cwd, [candidate])

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 0, recommendedPromotions: 0, keptPending: 1 })
    await expect(readOptionalText(join(memoryRoot, 'index.jsonl'))).resolves.toBe('')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  })

  it('deep-apply does not promote same-run duplicate evidence even with different evidence groups', async () => {
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

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 0, recommendedPromotions: 0 })
    await expect(readOptionalText(join(memoryRoot, 'index.jsonl'))).resolves.toBe('')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  })

  it('deep-apply keeps assistant-derived candidates pending instead of promoting them', async () => {
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

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 0, recommendedPromotions: 0, rejected: 0, keptPending: 1 })
    await expect(readOptionalText(join(memoryRoot, 'index.jsonl'))).resolves.toBe('')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  })

  it('deep-apply blocks diagnostic affective claims without mutating memory source files', async () => {
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

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({
      stage: 'deep-apply',
      promoted: 0,
      recommendedPromotions: 0,
      rejected: 0,
      keptPending: 1,
      skipped: expect.stringContaining('eval gate')
    })
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
    await expect(readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readCodexMemoryDreamState(memoryRoot)).resolves.toMatchObject({
      dreamDue: true,
      lastDreamStatus: 'failed',
      lastDreamError: expect.stringContaining('eval gate')
    })
  })

  it('deep-apply removes low-safety pending candidates instead of keeping them forever', async () => {
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

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 0, recommendedPromotions: 0, rejected: 1, keptPending: 0 })
    expect((await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).trim()).toBe('')
    const tombstones = parseJsonLines<MemoryTombstone>(await readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8'))
    expect(tombstones[0]).toMatchObject({ normalizedKey: candidate.normalizedKey, reason: 'rejected' })
  })

  it('dream apply retains current pending candidates missing from a stale reject proposal', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const rejected = createPending({
      id: 'reject-pending',
      content: 'Low safety pending memory should be rejected.',
      normalizedKey: 'reject-pending-memory',
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
    const kept = createPending({
      id: 'kept-pending',
      content: 'Insufficient evidence pending memory should remain.',
      normalizedKey: 'kept-pending-memory'
    })
    const addedAfterProposal = createPending({
      id: 'added-after-proposal',
      content: 'Pending memory added after proposal should remain.',
      normalizedKey: 'added-after-proposal-memory'
    })
    const memoryRoot = await seedProjectPending(cwd, [rejected, kept])
    const proposal = await buildDreamProposalForRoot({ memoryRoot, now: '2026-05-26T00:00:00.000Z' })
    await writeFile(
      join(memoryRoot, 'pending.jsonl'),
      [rejected, kept, addedAfterProposal].map((item) => JSON.stringify(item)).join('\n') + '\n'
    )

    await testOnlyDreamRuntime.applyProposal(memoryRoot, proposal, '2026-05-26T00:00:00.000Z')

    const pendingText = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pendingText).not.toContain(rejected.content)
    expect(pendingText).toContain(kept.content)
    expect(pendingText).toContain(addedAfterProposal.content)
  })

  it('deep-apply expires stale pending candidates instead of promoting them', async () => {
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

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 0, recommendedPromotions: 0, rejected: 1, keptPending: 0 })
    await expect(readOptionalText(join(memoryRoot, 'index.jsonl'))).resolves.toBe('')
    expect((await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).trim()).toBe('')
    const tombstones = parseJsonLines<MemoryTombstone>(await readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8'))
    expect(tombstones[0]).toMatchObject({ normalizedKey: candidate.normalizedKey, reason: 'expired' })
  })

  it('deep-apply runs maintenance and renders profile even when pending does not mutate', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const expired = createActive({
      expiresAt: '2026-05-25T00:00:00.000Z'
    })
    const memoryRoot = await seedProjectActive(cwd, [expired])

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({
      promoted: 0,
      recommendedPromotions: 0,
      rejected: 0,
      maintenance: expect.objectContaining({ expired: 1, activeCount: 0 })
    })
    expect(await readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).toBe('')
    const tombstones = parseJsonLines<MemoryTombstone>(await readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8'))
    expect(tombstones[0]).toMatchObject({ normalizedKey: expired.normalizedKey, reason: 'expired' })
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain('# Cyrene Model Profile')
  })

  it('deep-apply records failed dream state when acquiring a writable root lock errors', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-dream-project-')
    const memoryRoot = await seedProjectPending(cwd, [createPending()])
    await writeFile(join(memoryRoot, '.locks'), 'not a directory')

    await expect(runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })).rejects.toThrow(/dream locks path/)

    await expect(readCodexMemoryDreamState(memoryRoot)).resolves.toMatchObject({
      dreamDue: true,
      lastDreamStatus: 'failed',
      lastDreamAt: '2026-05-26T00:00:00.000Z'
    })
  })

  it('deep-apply skips a root when a non-expired dream lock exists', async () => {
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

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:01:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)?.skipped).toMatch(/dream lock/)
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('deep-apply replaces a stale dream lock without owner metadata', async () => {
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
    const lockDir = join(memoryRoot, '.locks', 'dream.lock')
    await mkdir(lockDir, { recursive: true })
    const oldTime = new Date('2026-05-25T00:00:00.000Z')
    await utimes(lockDir, oldTime, oldTime)

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 0, recommendedPromotions: 1 })
    await expect(readFile(join(lockDir, 'owner.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('deep-apply replaces a stale dream lock', async () => {
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

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 0, recommendedPromotions: 1 })
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

  it('skips dream roots when memory dream is disabled', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_MEMORY_DREAM_ENABLED', '0')
    const cwd = await createTempDir('cyrene-dream-project-')
    const candidate = createPending({
      seenCount: 2,
      evidence: [
        { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
        { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
      ]
    })
    const memoryRoot = await seedProjectPending(cwd, [candidate])
    const pendingBefore = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({
      promoted: 0,
      recommendedPromotions: 0,
      rejected: 0,
      keptPending: 1,
      skipped: expect.stringContaining('disabled')
    })
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toBe(pendingBefore)
    await expect(readFile(join(memoryRoot, 'dream-state.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'dream-preview', 'DREAM_REPORT.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('bounds deep dream maintenance waits by the dream runtime budget', async () => {
    const home = await createTempDir('cyrene-dream-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_MEMORY_MAINTENANCE_LOCK_TIMEOUT_MS', '80')
    vi.stubEnv('CYRENE_MEMORY_DREAM_MAX_RUNTIME_MS', '20')
    const cwd = await createTempDir('cyrene-dream-project-')
    const memoryRoot = await seedProjectPending(cwd, [createPending()])
    const lockDir = join(memoryRoot, '.maintenance.lock')
    await mkdir(lockDir)
    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({
      promoted: 0,
      recommendedPromotions: 0,
      rejected: 0,
      keptPending: 1,
      skipped: expect.stringContaining('runtime budget')
    })
    await expect(readdir(lockDir)).resolves.toEqual([])
  })

  it('deep-apply recommends global-scope pending memory from the global root', async () => {
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

    const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

    expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({ promoted: 0, recommendedPromotions: 1 })
    await expect(readOptionalText(join(memoryRoot, 'index.jsonl'))).resolves.not.toContain(candidate.content)
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  })
})
