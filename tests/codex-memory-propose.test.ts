import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { proposeCodexMemoryCandidate } from '../src/codex/memory-propose.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import type { MemoryEvent, PendingMemory } from '../src/memory/types.js'

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

function budgetPending(id: string, overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id,
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: `Budget pending ${id}`,
    normalizedKey: id,
    evidence: [{ summary: `Budget evidence ${id}` }],
    source: 'assistant_observed',
    scores: { evidenceStrength: 0.4, stability: 0.4, usefulness: 0.3, safety: 0.9, sensitivity: 0.1 },
    seenCount: 1,
    firstSeenAt: '2026-05-01T00:00:00.000Z',
    lastSeenAt: '2026-05-01T00:00:00.000Z',
    expiresAt: '2026-06-01T00:00:00.000Z',
    tags: [],
    ...overrides
  }
}

describe('Codex memory propose', () => {
  it('writes a valid candidate to Codex project pending memory', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-project-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        content: 'Specs and plans for this user should be written in Chinese.',
        source: 'user_explicit',
        evidence: [{ runId: 'run-1', quote: '以后 spec 和 plan 默认用中文写。' }],
        tags: ['language']
      }
    })

    expect(result.result.action).toBe('pending')
    const pending = await readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain('Specs and plans for this user should be written in Chinese.')
    expect(pending).toContain('"seenCount":1')
    await expect(readFile(join(result.memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('best-effort syncs the memory index after proposing pending memory', async () => {
    const home = await createTempDir('cyrene-codex-propose-index-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-index-repo-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        content: 'Pending proposal should be visible to router index sync.',
        normalizedKey: 'pending-proposal-router-index-sync',
        evidence: [{ runId: 'run-index', summary: 'Index sync test.' }]
      }
    })

    expect(result.result.action).toBe('pending')
    await expect(readFile(join(home, '.cyrene', 'codex', 'memory.db'))).resolves.toBeInstanceOf(Buffer)
  })

  it('marks the memory dream pass due after writing pending memory', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-project-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      now: '2026-05-26T00:00:00.000Z',
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        content: 'Dream pass should run after pending memory is proposed.',
        source: 'user_explicit',
        evidence: [{ runId: 'run-dream', quote: '记住：pending 后需要 dream pass。' }]
      }
    })

    const state = JSON.parse(await readFile(join(result.memoryRoot, 'dream-state.json'), 'utf8')) as {
      dreamDue: boolean
      nextDreamDueAt?: string
    }
    expect(state).toMatchObject({
      dreamDue: true,
      nextDreamDueAt: '2026-05-26T00:00:00.000Z'
    })
  })

  it('writes global-scope candidates to the Codex global pending memory root', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-project-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        strength: 'hard',
        scope: 'global',
        content: 'Specs and plans default to Chinese in all projects.',
        source: 'user_explicit',
        evidence: [{ runId: 'run-global', quote: '以后在所有项目里，所有 spec 和 plan 默认用中文写。' }],
        tags: ['language']
      }
    })

    const globalMemoryRoot = join(home, '.cyrene', 'codex', 'global', 'memory')
    expect(result.memoryRoot).toBe(await realpath(globalMemoryRoot))
    const pending = await readFile(join(globalMemoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain('Specs and plans default to Chinese in all projects.')

    const identity = await identifyCodexProject(cwd)
    await expect(readFile(join(codexProjectMemoryRoot(identity.projectId), 'pending.jsonl'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('returns review metadata for pending candidates', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-project-')
    const content = 'Codex pending memory review needs metadata.'
    const summary = 'User asked for review metadata.'

    const result = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        content,
        source: 'user_explicit',
        evidence: [{ runId: 'run-review', summary }]
      }
    })

    if (result.result.action !== 'pending') {
      throw new Error(`Expected pending result, got ${result.result.action}`)
    }
    expect(result.result.review).toBeDefined()
    expect(result.result.review.id).toBe(result.result.candidateId)
    expect(result.result.review.content).toBe(content)
    expect(result.result.review.evidenceSummary).toEqual([summary])
    expect(result.result.review.reviewHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects candidates without evidence', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-project-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        content: 'The project uses Codex MCP.',
        evidence: []
      }
    })

    expect(result.result.action).toBe('reject')
    const events = await readFile(join(result.memoryRoot, 'events.jsonl'), 'utf8')
    expect(events).toContain('"action":"reject"')
  })

  it('downgrades auto-writable high-confidence candidates to pending', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-project-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        strength: 'hard',
        scope: 'project',
        content: 'Cyrene Phase B memory proposals are pending-only.',
        normalizedKey: 'cyrene-phase-b-pending-only',
        source: 'user_explicit',
        evidence: [{ runId: 'run-2', summary: 'User confirmed Phase B pending-only policy.' }],
        scores: {
          evidenceStrength: 0.95,
          stability: 0.95,
          usefulness: 0.9,
          safety: 0.95,
          sensitivity: 0.1
        }
      }
    })

    expect(result.result.action).toBe('pending')
    await expect(readFile(join(result.memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not write pending memory when the maintenance lock cannot be acquired', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_MEMORY_MAINTENANCE_LOCK_TIMEOUT_MS', '1')
    const cwd = await createTempDir('cyrene-codex-propose-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await mkdir(join(memoryRoot, '.maintenance.lock'))

    await expect(
      proposeCodexMemoryCandidate({
        cwd,
        candidate: {
          domain: 'project',
          type: 'project_fact',
          content: 'Locked proposal should not write pending memory.',
          source: 'user_explicit',
          evidence: [{ runId: 'run-lock', summary: 'Lock coverage regression.' }]
        }
      })
    ).rejects.toThrow(/maintenance lock/)

    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('merges duplicate pending candidates', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-project-')
    const candidate = {
      domain: 'procedural' as const,
      type: 'procedural_rule' as const,
      content: 'Use pending-only memory proposals for Codex.',
      normalizedKey: 'codex-pending-only-proposals',
      source: 'user_explicit' as const,
      evidence: [{ runId: 'run-1', summary: 'First observation.' }],
      tags: ['codex']
    }

    await proposeCodexMemoryCandidate({ cwd, candidate })
    await proposeCodexMemoryCandidate({
      cwd,
      candidate: { ...candidate, evidence: [{ runId: 'run-2', summary: 'Second observation.' }], tags: ['memory'] }
    })

    const identity = await identifyCodexProject(cwd)
    const pending = await readFile(join(codexProjectMemoryRoot(identity.projectId), 'pending.jsonl'), 'utf8')
    expect(pending).toContain('"seenCount":2')
    expect(pending).toContain('First observation.')
    expect(pending).toContain('Second observation.')
    expect(pending).toContain('"codex"')
    expect(pending).toContain('"memory"')
  })

  it('auto-promotes repeated strict low-risk project candidates after merge', async () => {
    const home = await createTempDir('cyrene-propose-auto-promote-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-propose-auto-promote-project-')
    const candidate = {
      domain: 'project' as const,
      type: 'project_fact' as const,
      scope: 'project' as const,
      source: 'file' as const,
      candidateKind: 'project_fact' as const,
      content: 'Project uses SQLite FTS for memory retrieval.',
      normalizedKey: 'project-sqlite-fts-retrieval',
      evidence: [{ summary: 'README documents SQLite FTS.', evidenceGroupId: 'file-1', sourceKind: 'file' as const }],
      scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.05 },
      tags: ['project_harvest']
    }

    const first = await proposeCodexMemoryCandidate({ cwd, candidate, now: '2026-05-30T00:00:00.000Z' })
    expect(first.result.action).toBe('pending')

    const second = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        ...candidate,
        evidence: [{ summary: 'Tool trace rebuilt memory.db.', evidenceGroupId: 'tool-1', sourceKind: 'tool_trace' as const }]
      },
      now: '2026-05-30T01:00:00.000Z'
    })

    expect(second.result.action).toBe('auto_promote')
    const active = await readFile(join(second.memoryRoot, 'index.jsonl'), 'utf8')
    expect(active).toContain('Project uses SQLite FTS for memory retrieval.')
    await expect(readFile(join(second.memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toBe('')
    const events = (await readFile(join(second.memoryRoot, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as MemoryEvent)
    const promoteEvent = events.find((event) => event.action === 'promote')
    expect(promoteEvent?.details).toMatchObject({
      decision: 'auto_promote',
      policyId: 'low_risk_project_memory_v1',
      evidenceCount: 2,
      distinctEvidenceCount: 2,
      scoreSnapshot: candidate.scores,
      capStatus: {
        scope: 'project',
        usedToday: 0,
        dailyCap: 5
      },
      thresholds: expect.any(Object),
      evalGate: {
        passed: true,
        failedChecks: [],
        results: [expect.objectContaining({ name: 'auto_promotion_policy_eval', passed: true })]
      }
    })
  })

  it('evicts the weakest pending candidate before writing a stronger incoming candidate over budget', async () => {
    const home = await createTempDir('cyrene-propose-budget-evict-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_PENDING_MAX_ITEMS_PROJECT', '2')
    const cwd = await createTempDir('cyrene-propose-budget-evict-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), [
      JSON.stringify(budgetPending('weak')),
      JSON.stringify(budgetPending('protected', { source: 'user_explicit', candidateKind: 'user_instruction' }))
    ].join('\n') + '\n')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      now: '2026-05-30T00:00:00.000Z',
      candidate: {
        domain: 'project',
        type: 'project_fact',
        content: 'Incoming budget candidate has stronger evidence.',
        normalizedKey: 'incoming-budget-candidate',
        source: 'file',
        evidence: [{ summary: 'Incoming file evidence.', evidenceGroupId: 'file-incoming', sourceKind: 'file' }],
        scores: { evidenceStrength: 0.9, stability: 0.8, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 }
      }
    })

    expect(result.result.action).toBe('pending')
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain('incoming-budget-candidate')
    expect(pending).toContain('protected')
    expect(pending).not.toContain('weak')
    const events = await readFile(join(memoryRoot, 'events.jsonl'), 'utf8')
    expect(events).toContain('"decision":"budget_evict_pending"')
    expect(events).toContain('"candidateId":"weak"')
  })

  it('rejects an incoming pending candidate when it is lowest ranked over budget', async () => {
    const home = await createTempDir('cyrene-propose-budget-reject-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_PENDING_MAX_ITEMS_PROJECT', '2')
    const cwd = await createTempDir('cyrene-propose-budget-reject-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), [
      JSON.stringify(budgetPending('kept-file', { source: 'file', scores: { evidenceStrength: 0.7, stability: 0.7, usefulness: 0.65, safety: 0.95, sensitivity: 0.1 } })),
      JSON.stringify(budgetPending('kept-tool', { source: 'tool_trace', scores: { evidenceStrength: 0.65, stability: 0.65, usefulness: 0.6, safety: 0.95, sensitivity: 0.1 } }))
    ].join('\n') + '\n')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      now: '2026-05-30T00:00:00.000Z',
      candidate: {
        domain: 'project',
        type: 'project_fact',
        content: 'Incoming weak budget candidate.',
        normalizedKey: 'incoming-weak-budget-candidate',
        evidence: [{ summary: 'Weak assistant-observed budget evidence.' }]
      }
    })

    expect(result.result).toMatchObject({ action: 'reject' })
    expect(result.result.reason).toContain('incoming candidate is lowest-ranked under pending budget')
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain('kept-file')
    expect(pending).toContain('kept-tool')
    expect(pending).not.toContain('incoming-weak-budget-candidate')
  })

  it('refuses a symlinked Codex project memory root', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const outside = await createTempDir('cyrene-codex-propose-outside-')
    await mkdir(dirname(memoryRoot), { recursive: true })
    await symlink(outside, memoryRoot)

    await expect(
      proposeCodexMemoryCandidate({
        cwd,
        candidate: {
          domain: 'project',
          type: 'project_fact',
          content: 'Should not write through symlink.',
          evidence: [{ runId: 'run-3', summary: 'Symlink test.' }]
        }
      })
    ).rejects.toThrow(/memory symlink/)
  })

  it('refuses to merge pending memory through a symlinked pending data file', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const outside = await createTempDir('cyrene-codex-propose-outside-')
    const outsidePending = join(outside, 'pending.jsonl')
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(outsidePending, 'outside target must stay unchanged\n')
    await symlink(outsidePending, join(memoryRoot, 'pending.jsonl'))

    await expect(
      proposeCodexMemoryCandidate({
        cwd,
        candidate: {
          domain: 'project',
          type: 'project_fact',
          content: 'Should not write pending memory through a symlink.',
          evidence: [{ runId: 'run-pending-symlink', summary: 'Pending symlink test.' }]
        }
      })
    ).rejects.toThrow(/memory data file symlink/)
    await expect(readFile(outsidePending, 'utf8')).resolves.toBe('outside target must stay unchanged\n')
  })

  it('refuses to append memory events through a symlinked events data file', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const outside = await createTempDir('cyrene-codex-propose-outside-')
    const outsideEvents = join(outside, 'events.jsonl')
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(outsideEvents, 'outside target must stay unchanged\n')
    await symlink(outsideEvents, join(memoryRoot, 'events.jsonl'))

    await expect(
      proposeCodexMemoryCandidate({
        cwd,
        candidate: {
          domain: 'project',
          type: 'project_fact',
          content: 'Should not append memory events through a symlink.',
          evidence: [{ runId: 'run-events-symlink', summary: 'Events symlink test.' }]
        }
      })
    ).rejects.toThrow(/memory data file symlink/)
    await expect(readFile(outsideEvents, 'utf8')).resolves.toBe('outside target must stay unchanged\n')
  })
})
