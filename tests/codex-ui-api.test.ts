import { mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises'
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
    content: 'Memory review Web UI route button facts should be grouped for the UI.',
    normalizedKey: 'memory-review-web-ui-route-button-facts-grouped',
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

  it('returns Retrieval Explain planner diagnostics for the Web UI panel', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()

    const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/dashboard' })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as {
        diagnostics?: {
          retrievalPlan?: {
            taskIntent: string[]
            memoryKinds: string[]
            requiredFacets: string[]
            optionalFacets: string[]
          }
          retrievalExplain?: {
            projectMemory?: Array<{ id: string; explain: string[] }>
          }
        }
      }
      expect(data.diagnostics?.retrievalPlan).toMatchObject({
        taskIntent: expect.arrayContaining(['memory_review', 'ui']),
        memoryKinds: expect.arrayContaining(['workflow_rule']),
        requiredFacets: expect.arrayContaining(['exact_project', 'memory_kind', 'evidence']),
        optionalFacets: expect.arrayContaining(['graph_edges', 'recency'])
      })
      expect(data.diagnostics?.retrievalExplain?.projectMemory).toEqual([
        expect.objectContaining({
          id: 'active-1',
          explain: expect.arrayContaining(['exact_project'])
        })
      ])
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
          id: 'instruction-rule-1',
          domain: 'procedural',
          type: 'procedural_rule',
          scope: 'global',
          candidateKind: 'user_instruction',
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
        'Workflow Rules': ['instruction-rule-1', 'rule-1'],
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

  it('keeps Web UI project harvest dry-run only when model extraction returns candidates', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_BASE_URL', 'https://example.invalid/v1')
    vi.stubEnv('CYRENE_MODEL', 'test-model')
    vi.stubEnv('CYRENE_API_KEY', 'test-key')
    const { cwd, memoryRoot } = await seedProject()
    const pendingBefore = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    const callModel = vi.fn(async () => ({
      content: JSON.stringify({
        candidates: [{
          candidateKind: 'project_fact',
          content: 'The Web UI project harvester must not write pending candidates directly.',
          signalIndexes: [1]
        }]
      }),
      toolCalls: []
    }))

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
      const data = result.body.data as { result: { action: string; candidates?: Array<{ content: string }> } }
      expect(data.result.action).toBe('preview')
      expect(data.result.candidates?.[0]?.content).toBe(
        'The Web UI project harvester must not write pending candidates directly.'
      )
    }
    expect(callModel).toHaveBeenCalledTimes(1)
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toBe(pendingBefore)
  })

  it('runs triage dry-run without mutating pending memory', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    await writeFile(
      join(memoryRoot, 'pending.jsonl'),
      [
        createPending({
          id: 'triage-noise',
          content: 'Ran npm test today.',
          normalizedKey: 'ran-npm-test-today',
          evidence: [{ summary: 'temporary command result' }],
          seenCount: 1
        }),
        createPending({
          id: 'triage-review',
          domain: 'project',
          type: 'project_fact',
          content: 'Project memory triage should show ordinary pending candidates for review.',
          normalizedKey: 'project-memory-triage-review-recommendations',
          evidence: [{ summary: 'ordinary pending candidate', sourceKind: 'file' }],
          source: 'file',
          candidateKind: 'project_fact',
          scores: { evidenceStrength: 0.75, stability: 0.7, usefulness: 0.7, safety: 0.9, sensitivity: 0.2 },
          seenCount: 1
        })
      ].map((item) => JSON.stringify(item)).join('\n') + '\n'
    )
    const pendingBefore = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: '/api/memory/triage/dry-run',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as { action: string; decisions: Array<{ action: string; candidateId?: string }> }
      expect(data.action).toBe('dry_run')
      expect(data.decisions).toContainEqual(expect.objectContaining({ action: 'auto_drop', candidateId: 'triage-noise' }))
      expect(data.decisions).toContainEqual(expect.objectContaining({ action: 'recommend', candidateId: 'triage-review' }))
    }
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toBe(pendingBefore)
  })

  it('applies safe triage decisions and leaves review-only candidates pending', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    const weak = createPending({
      id: 'triage-weak',
      content: 'Maybe the UI should mention an unconfirmed idea.',
      normalizedKey: 'triage-weak-idea',
      source: 'assistant_observed',
      evidence: [{ summary: 'weak single observation' }],
      scores: { evidenceStrength: 0.4, stability: 0.5, usefulness: 0.4, safety: 0.95, sensitivity: 0.1 },
      seenCount: 1
    })
    const duplicateA = createPending({
      id: 'triage-duplicate-a',
      content: 'Duplicate triage memory should be merged.',
      normalizedKey: 'triage-duplicate-memory',
      evidence: [{ summary: 'first duplicate evidence', evidenceGroupId: 'a' }],
      tags: ['first']
    })
    const duplicateB = createPending({
      id: 'triage-duplicate-b',
      content: 'Duplicate triage memory should be merged with the first.',
      normalizedKey: 'triage-duplicate-memory',
      evidence: [{ summary: 'second duplicate evidence', evidenceGroupId: 'b' }],
      tags: ['second']
    })
    await writeFile(
      join(memoryRoot, 'pending.jsonl'),
      [
        createPending({
          id: 'triage-noise',
          content: 'Ran npm test today.',
          normalizedKey: 'ran-npm-test-today',
          evidence: [{ summary: 'temporary command result' }],
          seenCount: 1
        }),
        weak,
        duplicateB,
        duplicateA
      ].map((item) => JSON.stringify(item)).join('\n') + '\n'
    )
    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: '/api/memory/triage/apply',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      expect(result.body.data).toMatchObject({
        action: 'apply',
        applied: {
          auto_drop: 1,
          auto_defer: 1,
          auto_merge: 1
        }
      })
    }
    const pendingAfter = (await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PendingMemory)
    expect(pendingAfter.map((item) => item.id).sort()).toEqual(['triage-duplicate-a', 'triage-weak'])
    expect(pendingAfter.find((item) => item.id === 'triage-weak')?.promoteAfter).toBe('2026-06-13T00:00:00.000Z')
    expect(pendingAfter.find((item) => item.id === 'triage-duplicate-a')?.seenCount).toBe(2)
    await expect(readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8')).resolves.toContain('triage-noise')
  })

  it('runs triage dry-run for the selected global scope', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    const globalRoot = codexGlobalMemoryRoot()
    await mkdir(globalRoot, { recursive: true })
    await writeFile(join(globalRoot, 'pending.jsonl'), `${JSON.stringify(createPending({
      id: 'global-triage-noise',
      scope: 'global',
      domain: 'procedural',
      content: 'Ran npm test today.',
      normalizedKey: 'global-ran-npm-test-today',
      evidence: [{ summary: 'temporary command result' }]
    }))}\n`)
    const projectBefore = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: '/api/memory/triage/dry-run',
      searchParams: new URLSearchParams('scope=global'),
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as {
        selection: { scope: string }
        memoryRoot: string
        decisions: Array<{ action: string; candidateId?: string }>
      }
      expect(data.selection.scope).toBe('global')
      expect(data.memoryRoot).toBe(await realpath(globalRoot))
      expect(data.decisions).toContainEqual(expect.objectContaining({
        action: 'auto_drop',
        candidateId: 'global-triage-noise'
      }))
    }
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toBe(projectBefore)
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

  it('allows reject and defer without reasons through the Web UI write routes', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)

    for (const action of ['reject', 'defer']) {
      const { cwd, pending } = await seedProject()
      const hash = await pendingHash(cwd)
      const result = await handleCodexUiApiRequest({
        cwd,
        method: 'POST',
        pathname: `/api/memory/${pending.id}/${action}`,
        body: { reviewHash: hash }
      })

      expect(result.status).toBe(200)
      expect(result.body.ok).toBe(true)
      if (result.body.ok) {
        expect(result.body.data).toMatchObject({
          receipt: {
            action,
            id: pending.id,
            reviewHash: hash
          }
        })
      }
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

  it('archives active memory through hash-checked UI API', async () => {
    const home = await createTempDir('cyrene-ui-active-archive-home-')
    vi.stubEnv('HOME', home)
    const { cwd, active, memoryRoot } = await seedProject()
    const { contentHashForActiveMemory } = await import('../src/codex/active-memory-review.js')

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: `/api/active-memory/${active.id}/archive`,
      body: { contentHash: contentHashForActiveMemory(active), reason: 'Stale UI memory.' },
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      expect(result.body.data).toMatchObject({
        receipt: {
          action: 'archive_active_memory',
          id: active.id
        }
      })
    }
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toBe('')
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
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toContain('Memory review Web UI route button facts should be grouped for the UI.')
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

  it('returns 400 for malformed active memory propose-edit payloads', async () => {
    const home = await createTempDir('cyrene-ui-active-malformed-home-')
    vi.stubEnv('HOME', home)
    const { cwd, active } = await seedProject()
    const { contentHashForActiveMemory } = await import('../src/codex/active-memory-review.js')

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: `/api/active-memory/${active.id}/propose-edit`,
      body: { contentHash: contentHashForActiveMemory(active), reason: 'Edit without replacement content.' },
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.status).toBe(400)
    expect(result.body.ok).toBe(false)
    if (!result.body.ok) {
      expect(result.body.error.code).toBe('invalid_request')
    }
  })

  it('requires confirmText before tombstoning high-risk active memory through the UI API', async () => {
    const home = await createTempDir('cyrene-ui-high-risk-active-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    const active = createActive({
      id: 'ui-high-risk-active',
      domain: 'personal',
      type: 'user_preference',
      content: 'High-risk UI memory requires explicit destructive confirmation.',
      normalizedKey: 'ui-high-risk-active-memory'
    })
    await writeFile(join(memoryRoot, 'index.jsonl'), `${JSON.stringify(active)}\n`)
    const { contentHashForActiveMemory } = await import('../src/codex/active-memory-review.js')

    const blocked = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: `/api/active-memory/${active.id}/tombstone`,
      body: { contentHash: contentHashForActiveMemory(active), reason: 'Remove high-risk active memory.' },
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(blocked.status).toBe(400)
    expect(blocked.body.ok).toBe(false)
    if (!blocked.body.ok) {
      expect(blocked.body.error.code).toBe('confirmation_required')
    }

    const confirmed = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: `/api/active-memory/${active.id}/tombstone`,
      body: {
        contentHash: contentHashForActiveMemory(active),
        reason: 'Remove high-risk active memory.',
        confirmText: active.id
      },
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(confirmed.status).toBe(200)
    expect(confirmed.body.ok).toBe(true)
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
