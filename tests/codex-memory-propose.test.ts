import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { proposeCodexMemoryCandidate } from '../src/codex/memory-propose.js'
import { identifyCodexProject } from '../src/codex/project-id.js'

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
})
