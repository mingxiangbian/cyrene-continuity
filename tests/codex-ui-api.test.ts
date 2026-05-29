import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { handleCodexUiApiRequest } from '../src/codex/codex-ui-api.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import type { CyreneMemory, PendingMemory } from '../src/memory/types.js'

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

async function seedProject(): Promise<{
  cwd: string
  memoryRoot: string
  pending: PendingMemory
  active: CyreneMemory
}> {
  const cwd = await createTempDir('cyrene-ui-project-')
  await writeFile(join(cwd, 'package.json'), '{"name":"cyrene-ui-api-test"}\n')

  const project = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(project.projectId)
  await mkdir(memoryRoot, { recursive: true })

  const active = createActive()
  const pending = createPending()
  await writeFile(join(memoryRoot, 'index.jsonl'), `${JSON.stringify(active)}\n`)
  await writeFile(join(memoryRoot, 'pending.jsonl'), `${JSON.stringify(pending)}\n`)
  await writeFile(
    join(memoryRoot, 'review-summaries.jsonl'),
    `${JSON.stringify(createReviewSummary())}\n`
  )
  await writeFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'Project profile text for UI.\n')
  await writeFile(
    join(memoryRoot, 'dream-state.json'),
    `${JSON.stringify({
      dreamDue: true,
      lastDreamAt: '2026-05-28T00:00:00.000Z',
      lastDreamStatus: 'success'
    })}\n`
  )

  return { cwd, memoryRoot, pending, active }
}

function createActive(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'active',
    content: 'Project Facts should be grouped for the UI.',
    normalizedKey: 'project-facts-grouped-for-ui',
    evidence: [{ summary: 'Seeded active memory.' }],
    source: 'file',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.8,
      usefulness: 0.85,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
    candidateKind: 'project_fact',
    tags: ['project_harvest', 'project_fact'],
    ...overrides
  }
}

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Keep memory review pending-only in the UI.',
    normalizedKey: 'ui-pending-only-review',
    evidence: [{ summary: 'Seeded pending memory.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-05-27T00:00:00.000Z',
    lastSeenAt: '2026-05-27T00:00:00.000Z',
    expiresAt: '2026-06-27T00:00:00.000Z',
    candidateKind: 'workflow_rule',
    tags: ['ui'],
    ...overrides
  }
}

function createReviewSummary() {
  return {
    id: 'summary-1',
    runId: 'run-1',
    createdAt: '2026-05-27T00:00:00.000Z',
    status: 'ok',
    summary: 'Reviewed pending memories.',
    redaction: { input: {}, output: {} },
    candidateIds: ['pending-1']
  }
}

describe('handleCodexUiApiRequest', () => {
  it('returns dashboard data with pending memory and profile text', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()

    const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/dashboard' })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as {
        pending: { pending: Array<{ id: string }> }
        profile: { profile: string }
        signals: { signals: Array<{ kind: string; files?: string[] }> }
      }
      expect(data.pending.pending[0]).toMatchObject({ id: 'pending-1' })
      expect(data.profile.profile).toBe('Project profile text for UI.')
      expect(data.signals.signals).toContainEqual(expect.objectContaining({
        kind: 'project_manifest',
        files: ['package.json']
      }))
    }
  })

  it('returns an empty string when profile is missing', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    await unlink(join(memoryRoot, 'MODEL_PROFILE.md'))

    const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/profile' })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as { profile: string }
      expect(data.profile).toBe('')
    }
  })

  it('returns pending memories with review hashes', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()

    const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/memory/pending' })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as { pending: Array<{ id: string; reviewHash: string }> }
      expect(data.pending[0]).toMatchObject({ id: 'pending-1' })
      expect(data.pending[0].reviewHash).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('returns grouped project memory for all UI labels', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    await writeFile(
      join(memoryRoot, 'index.jsonl'),
      [
        createActive({ id: 'fact-by-type', candidateKind: undefined, type: 'project_fact', tags: [] }),
        createActive({ id: 'decision-1', candidateKind: 'project_decision', tags: [] }),
        createActive({ id: 'workflow-by-type', candidateKind: undefined, type: 'procedural_rule', tags: [] }),
        createActive({ id: 'pitfall-1', candidateKind: 'known_pitfall', tags: [] }),
        createActive({ id: 'rejected-1', candidateKind: 'rejected_approach', tags: [] }),
        createActive({ id: 'question-1', candidateKind: 'open_question', tags: [] }),
        createActive({ id: 'other-1', candidateKind: undefined, type: 'reference', tags: [] })
      ].map((item) => JSON.stringify(item)).join('\n') + '\n'
    )

    const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/project-memory' })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as { groups: Array<{ label: string; memories: Array<{ id: string }> }> }
      expect(groupIds(data.groups)).toEqual({
        'Project Facts': ['fact-by-type'],
        'Project Decisions': ['decision-1'],
        'Workflow Rules': ['workflow-by-type'],
        'Known Pitfalls': ['pitfall-1'],
        'Rejected Approaches': ['rejected-1'],
        'Open Questions': ['question-1'],
        'Other Project Memory': ['other-1']
      })
    }
  })

  it('keeps empty project memory groups for UI empty states', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    await writeFile(
      join(memoryRoot, 'index.jsonl'),
      `${JSON.stringify(createActive({ id: 'only-fact', candidateKind: 'project_fact', tags: [] }))}\n`
    )

    const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/project-memory' })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as { groups: Array<{ label: string; memories: Array<{ id: string }> }> }
      expect(groupIds(data.groups)).toEqual({
        'Project Facts': ['only-fact'],
        'Project Decisions': [],
        'Workflow Rules': [],
        'Known Pitfalls': [],
        'Rejected Approaches': [],
        'Open Questions': [],
        'Other Project Memory': []
      })
    }
  })

  it('forces project harvest dry-run to startup cwd and preserves pending memory', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_BASE_URL', '')
    vi.stubEnv('CYRENE_MODEL', '')
    vi.stubEnv('CYRENE_STRONG_MODEL', '')
    vi.stubEnv('CYRENE_CHEAP_MODEL', '')
    const { cwd, memoryRoot } = await seedProject()
    const pendingBefore = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    const callModel = vi.fn()

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: '/api/memory/harvest-project/dry-run',
      body: { dryRun: false, cwd: '/tmp/not-used' },
      callModel
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as { result: { action: string } }
      expect(data.result.action).toBe('needs_model_config')
    }
    expect(callModel).not.toHaveBeenCalled()
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toBe(pendingBefore)
  })

  it('returns structured method errors for non-GET read routes', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()

    const result = await handleCodexUiApiRequest({ cwd, method: 'POST', pathname: '/api/status' })

    expect(result).toEqual({
      status: 405,
      body: {
        ok: false,
        error: {
          code: 'method_not_allowed',
          message: 'Method not allowed.'
        }
      }
    })
  })

  it('returns structured not found errors for missing routes', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()

    const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/missing' })

    expect(result).toEqual({
      status: 404,
      body: {
        ok: false,
        error: {
          code: 'not_found',
          message: 'API route not found.'
        }
      }
    })
  })

  it('skips malformed review summary JSONL lines', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    await writeFile(
      join(memoryRoot, 'review-summaries.jsonl'),
      [
        JSON.stringify(createReviewSummary()),
        '{not-json',
        JSON.stringify({ ok: true }),
        JSON.stringify({ ...createReviewSummary(), id: 'summary-2', createdAt: '2026-05-28T00:00:00.000Z' })
      ].join('\n') + '\n'
    )

    const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/review-summaries' })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as { reviewSummaries: Array<{ id: string }> }
      expect(data.reviewSummaries.map((record) => record.id)).toEqual(['summary-2', 'summary-1'])
    }
  })
})

function groupIds(groups: Array<{ label: string; memories: Array<{ id: string }> }>): Record<string, string[]> {
  return Object.fromEntries(groups.map((group) => [group.label, group.memories.map((memory) => memory.id)]))
}
