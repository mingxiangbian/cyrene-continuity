import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
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
  it('returns the UI session token for same-origin UI bootstrap', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'GET',
      pathname: '/api/session',
      uiToken: 'test-ui-token'
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      expect(result.body.data).toEqual({ token: 'test-ui-token' })
    }
  })

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

  it('returns grouped global memory with personal, affective, and procedural labels', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()
    const memoryRoot = codexGlobalMemoryRoot()
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(
      join(memoryRoot, 'index.jsonl'),
      [
        createActive({
          id: 'preference-1',
          domain: 'personal',
          type: 'user_preference',
          scope: 'global',
          candidateKind: undefined,
          tags: []
        }),
        createActive({
          id: 'style-1',
          domain: 'personal',
          type: 'interaction_style',
          scope: 'global',
          candidateKind: undefined,
          tags: []
        }),
        createActive({
          id: 'affect-1',
          domain: 'affective',
          type: 'affective_pattern',
          scope: 'global',
          candidateKind: undefined,
          tags: []
        }),
        createActive({
          id: 'rule-1',
          domain: 'procedural',
          type: 'procedural_rule',
          scope: 'global',
          candidateKind: undefined,
          tags: []
        }),
        createActive({
          id: 'other-global-1',
          domain: 'relationship',
          type: 'reference',
          scope: 'global',
          candidateKind: undefined,
          tags: []
        })
      ].map((item) => JSON.stringify(item)).join('\n') + '\n'
    )

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'GET',
      pathname: '/api/project-memory',
      searchParams: new URLSearchParams('scope=global')
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as { groups: Array<{ label: string; memories: Array<{ id: string }> }> }
      expect(groupIds(data.groups)).toEqual({
        'User Preferences': ['preference-1'],
        'Interaction Style': ['style-1'],
        'Relationship Boundaries': [],
        'Affective Patterns': ['affect-1'],
        'Workflow Rules': ['rule-1'],
        'System Policies': [],
        References: ['other-global-1'],
        Episodes: [],
        'Project Facts': [],
        'Other Global Memory': []
      })
    }
  })

  it('infers unnamed project display names from hook-trace cwd metadata', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()
    const tracedCwd = await createTempDir('cyrene-ui-understand-anything-')
    await writeFile(join(tracedCwd, 'package.json'), '{"name":"Understand-Anything"}\n')
    const otherRoot = codexProjectMemoryRoot('bb1ebd2e94131f05')
    await mkdir(otherRoot, { recursive: true })
    await writeFile(
      join(otherRoot, 'hook-trace.jsonl'),
      `${JSON.stringify({
        id: 'trace-1',
        createdAt: '2026-05-29T00:00:00.000Z',
        event: 'stop',
        cwd: tracedCwd,
        summary: 'Stop hook received.',
        signals: []
      })}\n`
    )

    const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/projects' })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as { projects: Array<{ projectId: string; displayName: string }> }
      expect(data.projects).toContainEqual(expect.objectContaining({
        projectId: 'bb1ebd2e94131f05',
        displayName: 'Understand-Anything'
      }))
    }
  })

  it('deletes and disables project memory through the Web UI project route', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()
    const projectId = 'bb1ebd2e94131f05'
    const memoryRoot = codexProjectMemoryRoot(projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'index.jsonl'), `${JSON.stringify(createActive({ id: 'delete-me' }))}\n`)

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: `/api/projects/${projectId}/delete-memory`,
      body: { confirmProjectId: projectId, reason: 'Do not create project memory here.' },
      now: '2026-05-29T00:00:00.000Z'
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      expect(result.body.data).toMatchObject({
        receipt: {
          action: 'delete_project_memory',
          projectId,
          disabled: true,
          memoryDeleted: true
        }
      })
    }
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const projects = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/projects' })
    expect(projects.body.ok).toBe(true)
    if (projects.body.ok) {
      const data = projects.body.data as { projects: Array<{ projectId: string; disabled?: boolean }> }
      expect(data.projects).toContainEqual(expect.objectContaining({ projectId, disabled: true }))
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

  it('reports DeepSeek model config incomplete when the API key is missing', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_BASE_URL', 'https://api.deepseek.com')
    vi.stubEnv('CYRENE_MODEL', 'deepseek-v4-flash')
    vi.stubEnv('CYRENE_API_KEY', '')
    const { cwd } = await seedProject()

    const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/dashboard' })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as {
        modelConfig: { configured: boolean; apiKeyConfigured: boolean; missing: string[]; apiKeyPreview: string }
      }
      expect(data.modelConfig).toMatchObject({
        configured: false,
        apiKeyConfigured: false,
        apiKeyPreview: 'not set'
      })
      expect(data.modelConfig.missing).toContain('CYRENE_API_KEY')
    }
  })

  it('rejects write routes when reviewHash is missing', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, pending } = await seedProject()

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: `/api/memory/${pending.id}/approve`,
      body: {}
    })

    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' }
    })
  })

  it('maps stale review hashes to a 409 response', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, pending } = await seedProject()

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: `/api/memory/${pending.id}/approve`,
      body: { reviewHash: 'stale' }
    })

    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({
      ok: false,
      error: { code: 'review_hash_mismatch' }
    })
  })

  it('requires reasons for reject and defer write routes', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, pending } = await seedProject()
    const hash = await pendingHash(cwd)

    for (const action of ['reject', 'defer']) {
      const result = await handleCodexUiApiRequest({
        cwd,
        method: 'POST',
        pathname: `/api/memory/${pending.id}/${action}`,
        body: { reviewHash: hash }
      })

      expect(result.status).toBe(400)
      expect(result.body).toMatchObject({
        ok: false,
        error: { code: 'invalid_request' }
      })
    }
  })

  it('approves pending memory through the Web UI write route', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, pending, memoryRoot } = await seedProject()
    const hash = await pendingHash(cwd)

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: `/api/memory/${pending.id}/approve`,
      body: { reviewHash: hash }
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      expect(result.body.data).toMatchObject({
        receipt: {
          action: 'approve',
          id: pending.id,
          reviewHash: hash
        }
      })
    }
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toContain(pending.content)
  })

  it('edits pending memory through the Web UI write route without promoting it', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, pending, memoryRoot } = await seedProject()
    const hash = await pendingHash(cwd)

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: `/api/memory/${pending.id}/edit`,
      body: {
        reviewHash: hash,
        changeNote: 'User clarified the candidate.',
        patch: {
          content: 'Keep Web UI write actions hash-checked and pending-only.',
          candidateKind: 'workflow_rule',
          tags: ['web_ui', 'reviewed'],
          scores: { usefulness: 0.88 }
        }
      }
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      expect(result.body.data).toMatchObject({
        receipt: { action: 'edit', id: pending.id },
        candidate: expect.objectContaining({
          id: pending.id,
          status: 'pending',
          content: 'Keep Web UI write actions hash-checked and pending-only.',
          tags: ['web_ui', 'reviewed']
        })
      })
    }
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain('Keep Web UI write actions hash-checked')
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toContain('Project Facts should be grouped for the UI.')
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
      const data = result.body.data as { summaries: Array<{ id: string }>; reviewSummaries?: unknown }
      expect(data.summaries.map((record) => record.id)).toEqual(['summary-2', 'summary-1'])
      expect(data.reviewSummaries).toBeUndefined()
    }
  })
})

function groupIds(groups: Array<{ label: string; memories: Array<{ id: string }> }>): Record<string, string[]> {
  return Object.fromEntries(groups.map((group) => [group.label, group.memories.map((memory) => memory.id)]))
}

async function pendingHash(cwd: string): Promise<string> {
  const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/memory/pending' })
  if (!result.body.ok) throw new Error('expected pending list')
  const data = result.body.data as { pending: Array<{ reviewHash: string }> }
  return data.pending[0].reviewHash
}
