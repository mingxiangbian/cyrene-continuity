import { mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rebuildCodexMemoryIndex } from '../src/codex/codex-memory-index.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { handleCodexUiApiRequest } from '../src/codex/codex-ui-api.js'
import { reviewHashForPendingMemory } from '../src/codex/memory-review.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { activationPolicyForConfidenceTier } from '../src/memory/memory-lifecycle.js'
import {
  appendSemanticRewriteReceiptFromRoot,
  readActiveMemoriesFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot,
  writeSemanticMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type { CyreneMemory, PendingMemory, SemanticMemory } from '../src/memory/types.js'

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
  await writeActiveMemoriesFromRoot(memoryRoot, [active])
  await writePendingMemoriesFromRoot(memoryRoot, [pending])
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
    evidence: [{ runId: 'active-seed-run', summary: 'Seeded active memory.', sourceKind: 'file' }],
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
    content: 'Keep memory review queue hash-checked in the UI.',
    normalizedKey: 'ui-review-queue-hash-check',
    evidence: [{ runId: 'ui-seed-run', summary: 'Seeded pending memory.', sourceKind: 'user_explicit' }],
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

function createSemanticMemory(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  return {
    id: 'semantic-1',
    status: 'active',
    module: 'procedural',
    kind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    content: 'Lifecycle memory should be grouped by confidence tier.',
    useWhen: ['Reviewing lifecycle memory in the Web UI.'],
    doNotUseWhen: ['The task is unrelated to memory review.'],
    sourceOfTruth: 'test:semantic-memory',
    evidence: [{
      id: 'semantic-evidence-1',
      sourceKind: 'review_event',
      sourceRef: 'test:semantic-memory',
      when: '2026-06-03T00:00:00.000Z',
      whatHappened: 'Seeded lifecycle memory for the UI.',
      whyImportant: 'The UI should expose v1.5 confidence tiers.'
    }],
    reviewPolicy: 'strict_auto_promote',
    reviewState: {
      normalizedKey: 'semantic-memory-ui-tier',
      type: 'procedural_rule',
      strength: 'soft',
      source: 'review_event',
      scores: {
        evidenceStrength: 0.9,
        stability: 0.85,
        usefulness: 0.85,
        safety: 0.96,
        sensitivity: 0.08
      },
      tags: ['workflow_rule']
    },
    supersedes: [],
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    ...overrides
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
    const { cwd, memoryRoot } = await seedProject()
    const expectedMemoryRoot = await realpath(memoryRoot)

    const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/dashboard' })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as {
        pending: {
          pending: Array<{
            id: string
            semanticMemory?: {
              module?: string
              reviewPolicy?: string
              sourceOfTruth?: string
              evidence?: unknown[]
            }
          }>
        }
        profile: { profile: string }
        active: {
          active: Array<{
            id: string
            origin?: { rootScope: string; memoryRoot: string; projectId?: string; selectionScope: string; declaredScope?: string }
            sourceBoundary?: {
              status: string
              sourceOfTruth?: string
              sourceKind?: string
              evidenceRefs?: string[]
            }
            pollutionFlags?: string[]
          }>
        }
        automation: { automation: { due?: boolean; status?: string } }
        signals: { signals: Array<{ kind: string; files?: string[] }> }
      }
      expect(data.pending.pending[0]).toMatchObject({ id: 'pending-1' })
      expect(data.pending.pending[0]).toMatchObject({
        origin: {
          rootScope: 'project',
          memoryRoot: expectedMemoryRoot,
          projectId: expect.any(String),
          selectionScope: 'project',
          declaredScope: 'project'
        },
        sourceBoundary: {
          status: 'explicit',
          sourceOfTruth: 'ui-seed-run',
          sourceKind: 'user_explicit',
          evidenceRefs: ['ui-seed-run']
        },
        pollutionFlags: []
      })
      expect(data.active.active[0]).toMatchObject({
        id: 'active-1',
        origin: {
          rootScope: 'project',
          memoryRoot: expectedMemoryRoot,
          projectId: expect.any(String),
          selectionScope: 'project',
          declaredScope: 'project'
        },
        sourceBoundary: {
          status: 'evidence_trace',
          sourceKind: 'file',
          evidenceRefs: ['active-seed-run']
        },
        pollutionFlags: []
      })
      expect(data.pending.pending[0]?.semanticMemory).toMatchObject({
        module: expect.any(String),
        reviewPolicy: expect.any(String),
        sourceOfTruth: expect.any(String),
        evidence: expect.any(Array)
      })
      expect(data.profile.profile).toBe('Project profile text for UI.')
      expect(data.automation.automation).toMatchObject({
        due: true,
        status: 'success'
      })
      expect(JSON.stringify(data.automation.automation)).not.toContain('dream')
      expect(data.signals.signals).toContainEqual(expect.objectContaining({
        kind: 'project_manifest',
        files: ['package.json']
      }))
    }
  })

  it('serves automation state from the public automation route', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()

    const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/automation' })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as {
        automation: { due?: boolean; status?: string; lastRunAt?: string }
      }
      expect(data.automation).toMatchObject({
        due: true,
        lastRunAt: '2026-05-28T00:00:00.000Z',
        status: 'success'
      })
      expect(JSON.stringify(data.automation)).not.toContain('dream')
    }
  })

  it('returns item-level origin for all-scope project and global memory', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    const globalRoot = codexGlobalMemoryRoot()
    await mkdir(globalRoot, { recursive: true })
    const expectedMemoryRoot = await realpath(memoryRoot)
    const expectedGlobalRoot = await realpath(globalRoot)
    await writeActiveMemoriesFromRoot(globalRoot, [
      createActive({
        id: 'global-active-1',
        scope: 'global',
        domain: 'procedural',
        source: 'tool_trace',
        normalizedKey: 'global-active-memory',
        confidenceTier: 'global_core',
        activationPolicy: activationPolicyForConfidenceTier('global_core')
      })
    ])
    await writePendingMemoriesFromRoot(globalRoot, [
      createPending({
        id: 'global-pending-1',
        scope: 'global',
        source: 'tool_trace',
        normalizedKey: 'global-pending-memory'
      })
    ])

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'GET',
      pathname: '/api/dashboard',
      searchParams: new URLSearchParams('scope=all')
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as {
        pending: { pending: Array<{ id: string; origin?: { rootScope: string; memoryRoot: string; projectId?: string; selectionScope: string } }> }
        active: { active: Array<{ id: string; origin?: { rootScope: string; memoryRoot: string; projectId?: string; selectionScope: string } }> }
        projectMemory: { groups: Array<{ label: string; memories: Array<{ id: string }> }> }
      }
      expect(data.pending.pending).toContainEqual(expect.objectContaining({
        id: 'pending-1',
        origin: expect.objectContaining({ rootScope: 'project', memoryRoot: expectedMemoryRoot, selectionScope: 'all' })
      }))
      expect(data.pending.pending).toContainEqual(expect.objectContaining({
        id: 'global-pending-1',
        origin: expect.objectContaining({ rootScope: 'global', memoryRoot: expectedGlobalRoot, selectionScope: 'all' })
      }))
      expect(data.active.active).toContainEqual(expect.objectContaining({
        id: 'active-1',
        origin: expect.objectContaining({ rootScope: 'project', memoryRoot: expectedMemoryRoot, selectionScope: 'all' })
      }))
      expect(data.active.active).toContainEqual(expect.objectContaining({
        id: 'global-active-1',
        origin: expect.objectContaining({ rootScope: 'global', memoryRoot: expectedGlobalRoot, selectionScope: 'all' })
      }))
      expect(data.active.active.find((memory) => memory.id === 'global-active-1')?.origin?.projectId).toBeUndefined()
      expect(groupIds(data.projectMemory.groups)).toMatchObject({
        Trial: [],
        Validated: [],
        'Project Core': [],
        'Global Core': ['global-active-1']
      })
    }
  })

  it('reports source-boundary gaps and pollution flags at item level', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    const globalRoot = codexGlobalMemoryRoot()
    await mkdir(globalRoot, { recursive: true })
    await writeActiveMemoriesFromRoot(memoryRoot, [
      createActive({
        id: 'source-only-active',
        evidence: [],
        source: 'file',
        normalizedKey: 'source-only-active'
      })
    ])
    await writeActiveMemoriesFromRoot(globalRoot, [
      createActive({
        id: 'project-memory-in-global-root',
        scope: 'project',
        domain: 'project',
        evidence: [],
        source: 'file',
        normalizedKey: 'project-memory-in-global-root'
      })
    ])

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'GET',
      pathname: '/api/memory/active',
      searchParams: new URLSearchParams('scope=all')
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as {
        active: Array<{
          id: string
          origin?: { rootScope: string; declaredScope?: string }
          sourceBoundary?: { status: string; sourceKind?: string; evidenceRefs?: string[] }
          pollutionFlags?: string[]
        }>
      }
      expect(data.active.find((memory) => memory.id === 'source-only-active')).toMatchObject({
        sourceBoundary: {
          status: 'fallback_normalized_key',
          sourceKind: 'file',
          evidenceRefs: []
        },
        pollutionFlags: ['missing_source_boundary']
      })
      expect(data.active.find((memory) => memory.id === 'project-memory-in-global-root')).toMatchObject({
        origin: { rootScope: 'global', declaredScope: 'project' },
        pollutionFlags: expect.arrayContaining(['scope_root_mismatch', 'global_project_specific_source'])
      })
    }
  })

  it('returns Retrieval Explain planner diagnostics for the Web UI panel', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()
    await rebuildCodexMemoryIndex({ cwd })

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
      const data = result.body.data as {
        pending: Array<{
          id: string
          reviewHash: string
          readiness: { status: string; reasons: Array<{ code: string; text: string }> }
          semanticMemory: { status: string; module: string; kind: string; content: string; reviewPolicy: string; sourceOfTruth: string; useWhen: string[]; evidence: unknown[] }
          episodeEvidence: { when: string; whatHappened: string }
          proposedSemanticMemory: { type: string; useWhen: string[] }
        }>
      }
      expect(data.pending[0]).toMatchObject({ id: 'pending-1' })
      expect(data.pending[0].reviewHash).toMatch(/^[a-f0-9]{64}$/)
      expect(data.pending[0].readiness.status).toBe('ready')
      expect(data.pending[0].readiness.reasons.length).toBeGreaterThan(0)
      expect(data.pending[0].readiness.reasons.every((reason) => reason.text.length <= 120)).toBe(true)
      expect(data.pending[0].semanticMemory).toMatchObject({
        status: 'pending',
        module: 'procedural',
        kind: 'workflow_rule',
        reviewPolicy: expect.any(String),
        sourceOfTruth: expect.any(String),
        evidence: expect.any(Array),
        content: 'Keep memory review queue hash-checked in the UI.'
      })
      expect(data.pending[0].semanticMemory.useWhen.length).toBeGreaterThan(0)
      expect(data.pending[0].semanticMemory.evidence.length).toBeGreaterThan(0)
      expect(data.pending[0].episodeEvidence.whatHappened).not.toBe('')
      expect(data.pending[0].proposedSemanticMemory.useWhen.length).toBeGreaterThan(0)
    }
  })

  it('returns pending memory semantic rewrite receipt status', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot, pending } = await seedProject()
    await appendSemanticRewriteReceiptFromRoot(memoryRoot, {
      id: 'receipt-1',
      pendingMemoryId: pending.id,
      action: 'replace_content',
      method: 'deterministic',
      oldReviewHash: 'old-review-hash',
      newReviewHash: 'new-review-hash',
      originalContentHash: 'old-content-hash',
      rewrittenContentHash: 'new-content-hash',
      changedFields: ['content'],
      eligibilityReasons: ['implementation_note'],
      validatorReasons: ['rewritten_content_is_active_ready'],
      sourceOfTruth: 'review_summary:ui',
      createdAt: '2026-06-02T00:00:00.000Z'
    })

    const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/memory/pending' })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as {
        pending: Array<{
          semanticRewrite?: {
            status: string
            receipt?: {
              action: string
              method: string
              oldReviewHash?: string
              newReviewHash?: string
              changedFields: string[]
              eligibilityReasons: string[]
              validatorReasons: string[]
              originalContentHash: string
            }
          }
        }>
      }
      expect(data.pending[0]?.semanticRewrite).toMatchObject({
        status: 'prepared',
        receipt: {
          action: 'replace_content',
          method: 'deterministic',
          oldReviewHash: 'old-review-hash',
          newReviewHash: 'new-review-hash',
          changedFields: ['content'],
          eligibilityReasons: ['implementation_note'],
          validatorReasons: ['rewritten_content_is_active_ready'],
          originalContentHash: 'old-content-hash'
        }
      })
    }
  })

  it('batch rejects selected pending memories through the Web UI API', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    const first = createPending({ id: 'pending-a', normalizedKey: 'pending-a' })
    const second = createPending({ id: 'pending-b', normalizedKey: 'pending-b' })
    await writePendingMemoriesFromRoot(memoryRoot, [first, second])

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: '/api/memory/pending/reject-batch',
      body: {
        reason: 'Bulk cleanup.',
        candidates: [
          { id: first.id, reviewHash: reviewHashForPendingMemory(first) },
          { id: second.id, reviewHash: reviewHashForPendingMemory(second) }
        ]
      },
      now: '2026-06-02T00:00:00.000Z'
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      expect(result.body.data).toMatchObject({
        receipt: {
          action: 'reject_batch',
          rejectedCount: 2,
          failedCount: 0
        },
        results: [
          { id: 'pending-a', action: 'reject' },
          { id: 'pending-b', action: 'reject' }
        ]
      })
    }
    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toBe('')
    const events = await readFile(join(memoryRoot, 'events.jsonl'), 'utf8')
    expect(events).toContain('"candidateId":"pending-a"')
    expect(events).toContain('"candidateId":"pending-b"')
  })

  it('keeps hash-conflicted candidates when batch rejecting pending memories', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    const first = createPending({ id: 'pending-a', normalizedKey: 'pending-a' })
    const second = createPending({ id: 'pending-b', normalizedKey: 'pending-b' })
    await writePendingMemoriesFromRoot(memoryRoot, [first, second])

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: '/api/memory/pending/reject-batch',
      body: {
        candidates: [
          { id: first.id, reviewHash: reviewHashForPendingMemory(first) },
          { id: second.id, reviewHash: 'wrong-review-hash' }
        ]
      },
      now: '2026-06-02T00:00:00.000Z'
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      expect(result.body.data).toMatchObject({
        receipt: {
          action: 'reject_batch',
          rejectedCount: 1,
          failedCount: 1
        },
        results: [
          { id: 'pending-a', action: 'reject' },
          { id: 'pending-b', action: 'conflict' }
        ]
      })
    }
    const pendingAfter = await readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')
    expect(pendingAfter).not.toContain('pending-a')
    expect(pendingAfter).toContain('pending-b')
  })

  it('batch rejects only the selected project root when a global pending id collides', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    const globalRoot = codexGlobalMemoryRoot()
    const projectPending = createPending({
      id: 'shared-pending-id',
      normalizedKey: 'project-shared-pending-id',
      content: 'Project-scoped candidate should be rejected.'
    })
    const globalPending = createPending({
      id: 'shared-pending-id',
      normalizedKey: 'global-shared-pending-id',
      content: 'Global-scoped candidate must remain pending.',
      scope: 'global'
    })
    await mkdir(globalRoot, { recursive: true })
    await writePendingMemoriesFromRoot(memoryRoot, [projectPending])
    await writePendingMemoriesFromRoot(globalRoot, [globalPending])

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: '/api/memory/pending/reject-batch',
      searchParams: new URLSearchParams('scope=project'),
      body: {
        candidates: [{ id: projectPending.id, reviewHash: reviewHashForPendingMemory(projectPending) }]
      },
      now: '2026-06-02T00:00:00.000Z'
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      expect(result.body.data).toMatchObject({
        receipt: {
          action: 'reject_batch',
          rejectedCount: 1,
          failedCount: 0
        },
        results: [{ id: 'shared-pending-id', action: 'reject' }]
      })
    }
    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toBe('')
    await expect(readFile(join(globalRoot, 'review_queue.jsonl'), 'utf8')).resolves.toContain('Global-scoped candidate must remain pending.')
  })

  it('rejects all-scope batch pending reject because the route mutates one memory root', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, pending } = await seedProject()

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: '/api/memory/pending/reject-batch',
      searchParams: new URLSearchParams('scope=all'),
      body: {
        candidates: [{ id: pending.id, reviewHash: reviewHashForPendingMemory(pending) }]
      }
    })

    expect(result.status).toBe(400)
    expect(result.body.ok).toBe(false)
    if (!result.body.ok) {
      expect(result.body.error.message).toContain('scope=all')
    }
  })

  it('returns project lifecycle memory grouped by confidence tier', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    await writeSemanticMemoriesFromRoot(memoryRoot, [
      createSemanticMemory({
        id: 'trial-1',
        confidenceTier: 'trial',
        activationPolicy: activationPolicyForConfidenceTier('trial')
      }),
      createSemanticMemory({
        id: 'validated-1',
        confidenceTier: 'validated',
        activationPolicy: activationPolicyForConfidenceTier('validated')
      }),
      createSemanticMemory({
        id: 'core-1',
        confidenceTier: 'project_core',
        activationPolicy: activationPolicyForConfidenceTier('project_core')
      }),
      createSemanticMemory({ id: 'untiered-1' })
    ])

    const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/project-memory' })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as { groups: Array<{ label: string; memories: Array<{ id: string }> }> }
      expect(groupIds(data.groups)).toEqual({
        Trial: ['trial-1'],
        Validated: ['validated-1'],
        'Project Core': ['core-1']
      })
    }
  })

  it('returns global lifecycle memory grouped as global core only', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()
    const memoryRoot = codexGlobalMemoryRoot()
    await writeSemanticMemoriesFromRoot(memoryRoot, [
      createSemanticMemory({
        id: 'global-core-1',
        scope: 'global',
        confidenceTier: 'global_core',
        activationPolicy: activationPolicyForConfidenceTier('global_core')
      }),
      createSemanticMemory({ id: 'global-untiered-1', scope: 'global' })
    ])

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
        'Global Core': ['global-core-1']
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

  it('omits orphan project roots without identity metadata from the project dropdown', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()
    const currentProject = await identifyCodexProject(cwd)
    const orphanProjectId = 'orphan-project-without-identity'
    const orphanRoot = codexProjectMemoryRoot(orphanProjectId)
    await mkdir(orphanRoot, { recursive: true })
    await writeSemanticMemoriesFromRoot(orphanRoot, [
      createSemanticMemory({
        id: 'orphan-active-1',
        content: 'Orphan active memory should not appear as an unlabeled project.'
      })
    ])

    const projects = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/projects' })

    expect(projects.status).toBe(200)
    expect(projects.body.ok).toBe(true)
    if (projects.body.ok) {
      const data = projects.body.data as { projects: Array<{ projectId: string; displayName: string }> }
      expect(data.projects).not.toContainEqual(expect.objectContaining({ projectId: orphanProjectId }))
      expect(data.projects).toContainEqual(expect.objectContaining({ projectId: currentProject.projectId }))
      expect(JSON.stringify(data.projects)).not.toContain('Unlabeled project')
    }

    const dashboard = await handleCodexUiApiRequest({
      cwd,
      method: 'GET',
      pathname: '/api/dashboard',
      searchParams: new URLSearchParams(`projectId=${orphanProjectId}`)
    })

    expect(dashboard.status).toBe(200)
    expect(dashboard.body.ok).toBe(true)
    if (dashboard.body.ok) {
      const data = dashboard.body.data as { selection: { projectId: string; label: string } }
      expect(data.selection.projectId).toBe(currentProject.projectId)
      expect(data.selection.label).not.toContain('Unlabeled project')
    }
  })

  it('deletes and disables project memory through the Web UI project route', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()
    const projectId = 'bb1ebd2e94131f05'
    const memoryRoot = codexProjectMemoryRoot(projectId)
    await writeActiveMemoriesFromRoot(memoryRoot, [createActive({ id: 'delete-me' })])

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
    await expect(readFile(join(memoryRoot, 'semantic_memories.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const projects = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/projects' })
    expect(projects.body.ok).toBe(true)
    if (projects.body.ok) {
      const data = projects.body.data as { projects: Array<{ projectId: string; disabled?: boolean }> }
      expect(data.projects).not.toContainEqual(expect.objectContaining({ projectId }))
    }
  })

  it('omits untiered lifecycle memory from UI groups', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    await writeActiveMemoriesFromRoot(memoryRoot, [createActive({ id: 'only-fact', candidateKind: 'project_fact', tags: [] })])

    const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/project-memory' })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as { groups: Array<{ label: string; memories: Array<{ id: string }> }> }
      expect(groupIds(data.groups)).toEqual({
        Trial: [],
        Validated: [],
        'Project Core': []
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
    const pendingBefore = await readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')
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
    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toBe(pendingBefore)
  })

  it('keeps Web UI project harvest dry-run only when model extraction returns candidates', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_BASE_URL', 'https://example.invalid/v1')
    vi.stubEnv('CYRENE_MODEL', 'test-model')
    vi.stubEnv('CYRENE_API_KEY', 'test-key')
    const { cwd, memoryRoot } = await seedProject()
    const pendingBefore = await readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')
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
    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toBe(pendingBefore)
  })

  it('runs memory distillation dry-run for duplicate pending entries', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    await writeFile(
      join(memoryRoot, 'review_queue.jsonl'),
      [
        createPending({
          id: 'distill-duplicate-a',
          content: 'Duplicate distillation memory should be merged.',
          normalizedKey: 'duplicate-distillation-memory',
          evidence: [{ summary: 'first duplicate evidence' }]
        }),
        createPending({
          id: 'distill-duplicate-b',
          content: 'Duplicate distillation memory should be merged with the longer candidate.',
          normalizedKey: 'duplicate-distillation-memory',
          evidence: [{ summary: 'second duplicate evidence' }]
        })
      ].map((item) => JSON.stringify(item)).join('\n') + '\n'
    )

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: '/api/memory/distill/dry-run'
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as {
        mode: string
        candidates: Array<{ recommendedAction: string }>
      }
      expect(data.mode).toBe('dry_run')
      expect(data.candidates[0]?.recommendedAction).toBe('merge_pending')
    }
  })

  it('runs memory distillation dry-run against the selected global scope', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    await writeFile(
      join(memoryRoot, 'review_queue.jsonl'),
      [
        createPending({
          id: 'project-distill-a',
          content: 'Project-only distillation memory should stay project scoped.',
          normalizedKey: 'project-only-distill',
          evidence: [{ summary: 'first project duplicate' }]
        }),
        createPending({
          id: 'project-distill-b',
          content: 'Project-only distillation memory should not appear in global scope.',
          normalizedKey: 'project-only-distill',
          evidence: [{ summary: 'second project duplicate' }]
        })
      ].map((item) => JSON.stringify(item)).join('\n') + '\n'
    )
    const globalRoot = codexGlobalMemoryRoot()
    await mkdir(globalRoot, { recursive: true })
    await writeFile(
      join(globalRoot, 'review_queue.jsonl'),
      [
        createPending({
          id: 'global-distill-a',
          scope: 'global',
          content: 'Global distillation memory should appear for global scope.',
          normalizedKey: 'global-distill',
          evidence: [{ summary: 'first global duplicate' }]
        }),
        createPending({
          id: 'global-distill-b',
          scope: 'global',
          content: 'Global distillation memory should appear for selected global scope.',
          normalizedKey: 'global-distill',
          evidence: [{ summary: 'second global duplicate' }]
        })
      ].map((item) => JSON.stringify(item)).join('\n') + '\n'
    )

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: '/api/memory/distill/dry-run',
      searchParams: new URLSearchParams('scope=global')
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as { candidates: Array<{ normalizedKey: string }> }
      const normalizedKeys = data.candidates.map((candidate) => candidate.normalizedKey)
      expect(normalizedKeys).toContain('global-distill')
      expect(normalizedKeys).not.toContain('project-only-distill')
    }
  })

  it('rejects all-scope memory distillation because the route operates on one memory root', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: '/api/memory/distill/dry-run',
      searchParams: new URLSearchParams('scope=all')
    })

    expect(result.status).toBe(400)
    expect(result.body.ok).toBe(false)
    if (!result.body.ok) {
      expect(result.body.error.message).toContain('scope=all')
    }
  })

  it('runs triage dry-run without mutating pending memory', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    await writeFile(
      join(memoryRoot, 'review_queue.jsonl'),
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
    const pendingBefore = await readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')

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
    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toBe(pendingBefore)
  })

  it('runs all-scope memory triage dry-run across project and global roots', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    const globalRoot = codexGlobalMemoryRoot()
    await mkdir(globalRoot, { recursive: true })
    await writePendingMemoriesFromRoot(memoryRoot, [
      createPending({
        id: 'project-cross-root-duplicate',
        normalizedKey: 'cross-root-duplicate-memory',
        sourceOfTruth: 'review_summary:project',
        evidence: [{ runId: 'project-run', summary: 'Project duplicate.', sourceKind: 'review_event' }]
      })
    ])
    await writePendingMemoriesFromRoot(globalRoot, [
      createPending({
        id: 'global-cross-root-duplicate',
        scope: 'global',
        domain: 'procedural',
        normalizedKey: 'cross-root-duplicate-memory',
        source: 'review_event',
        sourceOfTruth: 'review_summary:global',
        evidence: [{ runId: 'global-run', summary: 'Global duplicate.', sourceKind: 'review_event' }]
      })
    ])
    const projectBefore = await readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')
    const globalBefore = await readFile(join(globalRoot, 'review_queue.jsonl'), 'utf8')

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: '/api/memory/triage/dry-run',
      searchParams: new URLSearchParams('scope=all'),
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as {
        selection: { scope: string; memoryRoots: string[] }
        decisions: Array<{ action: string; candidateIds?: string[]; flags?: string[] }>
      }
      expect(data.selection.scope).toBe('all')
      expect(data.selection.memoryRoots).toEqual(expect.arrayContaining([
        await realpath(globalRoot),
        await realpath(memoryRoot)
      ]))
      expect(data.decisions).toContainEqual(expect.objectContaining({
        action: 'manual_review_recommended',
        candidateIds: ['global-cross-root-duplicate', 'project-cross-root-duplicate'],
        flags: expect.arrayContaining(['cross_root_normalized_key_collision'])
      }))
    }
    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toBe(projectBefore)
    await expect(readFile(join(globalRoot, 'review_queue.jsonl'), 'utf8')).resolves.toBe(globalBefore)
  })

  it('runs memory prepare dry-run without mutating pending memory', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot } = await seedProject()
    await writePendingMemoriesFromRoot(memoryRoot, [createPending({
      id: 'prepare-implementation-note',
      domain: 'project',
      type: 'project_fact',
      content: 'v1 admission gate 核心实现采用 subagent-driven 执行方案，并创建隔离工作区。',
      normalizedKey: 'v1-admission-gate-subagent-worktree',
      candidateKind: 'project_decision',
      sourceOfTruth: 'review_summary:task-1',
      tags: ['project_decision']
    })])
    const pendingBefore = await readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: '/api/memory/prepare/dry-run',
      now: '2026-06-02T00:00:00.000Z'
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as { dryRun: boolean; results: Array<{ action: string }> }
      expect(data.dryRun).toBe(true)
      expect(data.results).toContainEqual(expect.objectContaining({ action: 'replace_content' }))
    }
    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toBe(pendingBefore)
  })

  it('applies memory prepare to pending only and records receipts', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, memoryRoot, active } = await seedProject()
    await writePendingMemoriesFromRoot(memoryRoot, [createPending({
      id: 'prepare-implementation-note',
      domain: 'project',
      type: 'project_fact',
      content: 'v1 admission gate 核心实现采用 subagent-driven 执行方案，并创建隔离工作区。',
      normalizedKey: 'v1-admission-gate-subagent-worktree',
      candidateKind: 'project_decision',
      sourceOfTruth: 'review_summary:task-1',
      tags: ['project_decision']
    })])

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: '/api/memory/prepare/apply',
      now: '2026-06-02T00:00:00.000Z'
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      const data = result.body.data as { dryRun: boolean; activeBeforeCount: number; activeAfterCount: number; receipts: Array<{ action: string }> }
      expect(data.dryRun).toBe(false)
      expect(data.activeBeforeCount).toBe(1)
      expect(data.activeAfterCount).toBe(1)
      expect(data.receipts).toContainEqual(expect.objectContaining({ action: 'replace_content' }))
    }
    await expect(readActiveMemoriesFromRoot(memoryRoot)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ content: active.content })])
    )
    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toContain(
      'Admission-gate memory work should coordinate independent tasks through subagent-driven execution in an isolated worktree.'
    )
    await expect(readFile(join(memoryRoot, 'semantic_rewrite_receipts.jsonl'), 'utf8')).resolves.toContain('replace_content')
  })

  it('rejects all-scope memory prepare because the route operates on one memory root', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: '/api/memory/prepare/dry-run',
      searchParams: new URLSearchParams('scope=all')
    })

    expect(result.status).toBe(400)
    expect(result.body.ok).toBe(false)
    if (!result.body.ok) {
      expect(result.body.error.message).toContain('scope=all')
    }
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
      join(memoryRoot, 'review_queue.jsonl'),
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
    const pendingAfter = (await readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8'))
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
    await writePendingMemoriesFromRoot(globalRoot, [createPending({
      id: 'global-triage-noise',
      scope: 'global',
      domain: 'procedural',
      content: 'Ran npm test today.',
      normalizedKey: 'global-ran-npm-test-today',
      evidence: [{ summary: 'temporary command result' }]
    })])
    const projectBefore = await readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')

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
    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toBe(projectBefore)
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

  it('surfaces needs_rewrite when approval lacks explicit source boundary or evidence trace', async () => {
    const home = await createTempDir('cyrene-ui-needs-rewrite-home-')
    vi.stubEnv('HOME', home)
    const { cwd, pending, memoryRoot } = await seedProject()
    const weakPending = createPending({
      id: pending.id,
      evidence: [{ summary: 'A summary without a source trace.', sourceKind: 'file' }],
      sourceOfTruth: undefined
    })
    await writePendingMemoriesFromRoot(memoryRoot, [weakPending])
    const hash = await pendingHash(cwd)

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: `/api/memory/${weakPending.id}/approve`,
      body: { reviewHash: hash }
    })

    expect(result.status).toBe(400)
    expect(result.body.ok).toBe(false)
    if (!result.body.ok) {
      expect(result.body.error).toMatchObject({
        code: 'needs_rewrite',
        details: {
          result: {
            action: 'needs_rewrite',
            candidateId: weakPending.id,
            readiness: expect.objectContaining({
              status: 'needs_rewrite',
              reasons: expect.arrayContaining(['missing_source_of_truth'])
            }),
            reviewHash: hash
          }
        }
      })
    }
    await expect(readActiveMemoriesFromRoot(memoryRoot)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: 'Memory review Web UI route button facts should be grouped for the UI.' })
      ])
    )
    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toContain(weakPending.content)
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
    await expect(readActiveMemoriesFromRoot(memoryRoot)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ content: pending.content })])
    )
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
    await expect(readActiveMemoriesFromRoot(memoryRoot)).resolves.toEqual([])
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
          content: 'Keep Web UI write actions hash-checked for review queue candidates.',
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
          content: 'Keep Web UI write actions hash-checked for review queue candidates.',
          tags: ['web_ui', 'reviewed']
        })
      })
    }
    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toContain('Keep Web UI write actions hash-checked')
    await expect(readActiveMemoriesFromRoot(memoryRoot)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: 'Memory review Web UI route button facts should be grouped for the UI.' })
      ])
    )
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
    await writeActiveMemoriesFromRoot(memoryRoot, [active])
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
