import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { proposeCodexMemoryCandidate } from '../src/codex/memory-propose.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { activationPolicyForConfidenceTier } from '../src/memory/memory-lifecycle.js'
import { pendingMemoryToSemanticMemory } from '../src/memory/semantic-memory-adapter.js'
import { readMemoryEventsFromRoot, readSemanticMemoriesFromRoot } from '../src/memory/memory-store.js'
import type { MemoryEvent, PendingMemory, SemanticMemory } from '../src/memory/types.js'

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

function parseJsonLines<T>(value: string): T[] {
  return value.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as T)
}

describe('Codex memory propose', () => {
  it('writes low-risk project candidates to trial memory instead of pending review', async () => {
    const home = await createTempDir('cyrene-codex-propose-trial-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-trial-project-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      now: '2026-06-03T00:00:00.000Z',
      candidate: {
        domain: 'project',
        type: 'project_fact',
        candidateKind: 'project_decision',
        content: 'Project lifecycle automation runs daily validation and weekly core consolidation.',
        normalizedKey: 'project-lifecycle-automation-schedule',
        source: 'user_explicit',
        evidence: [{ runId: 'run-trial', summary: 'User confirmed the lifecycle automation boundary.' }],
        scores: { evidenceStrength: 0.75, stability: 0.7, usefulness: 0.7, safety: 0.9, sensitivity: 0.1 },
        tags: ['lifecycle']
      }
    })

    expect(result.result.action).toBe('trial')
    const semantic = await readSemanticMemoriesFromRoot(result.memoryRoot)
    expect(semantic).toEqual([
      expect.objectContaining<Partial<SemanticMemory>>({
        status: 'active',
        confidenceTier: 'trial',
        activationPolicy: activationPolicyForConfidenceTier('trial'),
        content: 'Project lifecycle automation runs daily validation and weekly core consolidation.',
        reviewPolicy: 'strict_auto_promote'
      })
    ])
    await expect(readFile(join(result.memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toBe('')
    const events = await readMemoryEventsFromRoot(result.memoryRoot)
    expect(events).toEqual([
      expect.objectContaining({
        action: 'create',
        memoryId: semantic[0]?.id,
        details: expect.objectContaining({
          decision: 'admit_to_trial',
          confidenceTier: 'trial'
        })
      })
    ])
  })

  it('writes high-risk personal candidates to pending review', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-project-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'personal',
        type: 'interaction_style',
        content: 'User may prefer compact project updates during long coding tasks.',
        source: 'user_implicit',
        evidence: [{ runId: 'run-1', summary: 'Assistant inferred a communication preference from recent interaction.' }],
        tags: ['preference']
      }
    })

    expect(result.result.action).toBe('pending')
    const pending = await readFile(join(result.memoryRoot, 'review_queue.jsonl'), 'utf8')
    expect(pending).toContain('User may prefer compact project updates during long coding tasks.')
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
        source: 'assistant_observed',
        evidence: [{ runId: 'run-dream', summary: 'Assistant observed that a dream pass may be useful after pending memory.' }]
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
    const pending = await readFile(join(globalMemoryRoot, 'review_queue.jsonl'), 'utf8')
    expect(pending).toContain('Specs and plans default to Chinese in all projects.')

    const identity = await identifyCodexProject(cwd)
    await expect(readFile(join(codexProjectMemoryRoot(identity.projectId), 'review_queue.jsonl'), 'utf8')).rejects.toMatchObject({
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
        domain: 'personal',
        type: 'user_preference',
        content,
        source: 'user_implicit',
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

  it('preserves explicit source-of-truth boundaries on pending memory projections', async () => {
    const home = await createTempDir('cyrene-codex-propose-source-pending-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-source-pending-project-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      allowAutoPromote: false,
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        candidateKind: 'workflow_rule',
        content: 'Repository workflow rules should remain grounded in AGENTS.md.',
        normalizedKey: 'repo-workflow-source-boundary',
        sourceOfTruth: 'AGENTS.md',
        source: 'file',
        evidence: [{ summary: 'AGENTS.md documents repository workflow rules.', sourceKind: 'file' }]
      }
    })

    expect(result.result.action).toBe('pending')
    const pending = parseJsonLines<PendingMemory>(await readFile(join(result.memoryRoot, 'review_queue.jsonl'), 'utf8'))
    expect(pending[0]?.sourceOfTruth).toBe('AGENTS.md')
    expect(pendingMemoryToSemanticMemory(pending[0] as PendingMemory).sourceOfTruth).toBe('AGENTS.md')
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

  it('admits auto-writable high-confidence project candidates to trial instead of pending', async () => {
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
        content: 'Cyrene v1.5 low-risk project proposals enter trial memory.',
        normalizedKey: 'cyrene-v15-project-proposals-enter-trial',
        source: 'user_explicit',
        evidence: [{ runId: 'run-2', summary: 'User confirmed v1.5 trial admission policy.' }],
        scores: {
          evidenceStrength: 0.95,
          stability: 0.95,
          usefulness: 0.9,
          safety: 0.95,
          sensitivity: 0.1
        }
      }
    })

    expect(result.result.action).toBe('trial')
    const semantic = await readSemanticMemoriesFromRoot(result.memoryRoot)
    expect(semantic[0]).toMatchObject({
      content: 'Cyrene v1.5 low-risk project proposals enter trial memory.',
      confidenceTier: 'trial',
      activationPolicy: activationPolicyForConfidenceTier('trial')
    })
    await expect(readFile(join(result.memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toBe('')
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

    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('merges duplicate pending candidates', async () => {
    const home = await createTempDir('cyrene-codex-propose-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'review_queue.jsonl'), `${JSON.stringify(budgetPending('codex-review-queue-proposals', {
      domain: 'procedural',
      type: 'procedural_rule',
      content: 'Use manual review queue proposals for Codex high-risk memory.',
      source: 'user_explicit',
      evidence: [{ runId: 'run-1', summary: 'First observation.' }],
      scores: { evidenceStrength: 0.75, stability: 0.7, usefulness: 0.7, safety: 0.9, sensitivity: 0.1 },
      tags: ['codex'],
      candidateKind: 'workflow_rule'
    }))}\n`)
    const candidate = {
      domain: 'procedural' as const,
      type: 'procedural_rule' as const,
      content: 'Use manual review queue proposals for Codex high-risk memory.',
      normalizedKey: 'codex-review-queue-proposals',
      source: 'user_explicit' as const,
      evidence: [{ runId: 'run-1', summary: 'First observation.' }],
      tags: ['codex']
    }

    await proposeCodexMemoryCandidate({
      cwd,
      allowAutoPromote: false,
      candidate: {
        ...candidate,
        sourceOfTruth: 'AGENTS.md',
        evidence: [{ runId: 'run-2', summary: 'Second observation.' }],
        tags: ['memory']
      }
    })

    const pending = await readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')
    const pendingRecords = parseJsonLines<PendingMemory>(pending)
    expect(pending).toContain('"seenCount":2')
    expect(pendingRecords[0]?.sourceOfTruth).toBe('AGENTS.md')
    expect(pending).toContain('First observation.')
    expect(pending).toContain('Second observation.')
    expect(pending).toContain('"codex"')
    expect(pending).toContain('"memory"')
  })

  it('deduplicates repeated evidence when merging duplicate pending candidates', async () => {
    const home = await createTempDir('cyrene-codex-propose-dedupe-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-propose-dedupe-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'review_queue.jsonl'), `${JSON.stringify(budgetPending('dedupe-pending-evidence', {
      content: 'Pending evidence for the same review summary should stay unique.',
      normalizedKey: 'dedupe-pending-evidence',
      source: 'file',
      sourceOfTruth: 'review_summary:summary-1',
      evidence: [{
        evidenceGroupId: 'evidence-group-1',
        sourceKind: 'file',
        traceRefs: ['review_summary:summary-1'],
        summary: 'Review summary recorded the same pending evidence.'
      }]
    }))}\n`)

    await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        content: 'Pending evidence for the same review summary should stay unique.',
        normalizedKey: 'dedupe-pending-evidence',
        source: 'file',
        sourceOfTruth: 'review_summary:summary-1',
        evidence: [{
          evidenceGroupId: 'evidence-group-1',
          sourceKind: 'file',
          traceRefs: ['review_summary:summary-1'],
          summary: 'Review summary recorded the same pending evidence.'
        }]
      }
    })

    const pending = parseJsonLines<PendingMemory>(await readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8'))
    expect(pending[0]?.seenCount).toBe(2)
    expect(pending[0]?.evidence).toHaveLength(1)
    expect(pending[0]?.evidence[0]?.evidenceGroupId).toBe('evidence-group-1')
  })

  it('rejects repeated low-risk project candidates after trial admission instead of creating pending review', async () => {
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
      sourceDraftIds: ['draft-1'],
      sourceEpisodeIds: ['episode-1'],
      tags: ['project_harvest']
    }

    const first = await proposeCodexMemoryCandidate({ cwd, candidate, now: '2026-05-30T00:00:00.000Z' })
    expect(first.result.action).toBe('trial')

    const second = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        ...candidate,
        evidence: [{ summary: 'Tool trace rebuilt memory.db.', evidenceGroupId: 'tool-1', sourceKind: 'tool_trace' as const }],
        sourceDraftIds: ['draft-2'],
        sourceEpisodeIds: ['episode-2']
      },
      now: '2026-05-30T01:00:00.000Z'
    })

    expect(second.result.action).toBe('reject')
    if (second.result.action !== 'reject') throw new Error(`Expected reject, got ${second.result.action}`)
    expect(second.result.reason).toContain('normalizedKey conflict with active memory')
    await expect(readFile(join(second.memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toBe('')
    const events = (await readFile(join(second.memoryRoot, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as MemoryEvent)
    expect(events.some((event) => event.action === 'pending')).toBe(false)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'create', details: expect.objectContaining({ decision: 'admit_to_trial' }) }),
      expect.objectContaining({ action: 'reject', reason: 'normalizedKey conflict with active memory' })
    ]))
  })

  it('preserves explicit source-of-truth boundaries when low-risk memory enters trial', async () => {
    const home = await createTempDir('cyrene-propose-auto-promote-source-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-propose-auto-promote-source-project-')
    const candidate = {
      domain: 'project' as const,
      type: 'project_fact' as const,
      scope: 'project' as const,
      source: 'file' as const,
      sourceOfTruth: 'AGENTS.md',
      candidateKind: 'project_fact' as const,
      content: 'Project uses SQLite FTS for memory retrieval.',
      normalizedKey: 'project-sqlite-fts-retrieval-source-boundary',
      evidence: [{ summary: 'AGENTS.md documents SQLite FTS.', evidenceGroupId: 'file-1', sourceKind: 'file' as const }],
      scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.05 },
      tags: ['project_harvest']
    }

    const admitted = await proposeCodexMemoryCandidate({ cwd, candidate, now: '2026-05-30T00:00:00.000Z' })

    expect(admitted.result.action).toBe('trial')
    const semantic = await readSemanticMemoriesFromRoot(admitted.memoryRoot)
    expect(semantic[0]?.sourceOfTruth).toBe('AGENTS.md')
    expect(semantic[0]?.confidenceTier).toBe('trial')
  })

  it('keeps otherwise trial-eligible candidates with missing source boundary in pending review', async () => {
    const home = await createTempDir('cyrene-propose-missing-boundary-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-propose-missing-boundary-project-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        strength: 'hard',
        scope: 'project',
        source: 'file',
        candidateKind: 'project_fact',
        content: 'Project source-boundary gates require auditable file or trace references.',
        normalizedKey: 'project-source-boundary-gates',
        evidence: [{ summary: 'A summary without a source ref is not enough for trial admission.' }],
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
    if (result.result.action !== 'pending') throw new Error(`Expected pending, got ${result.result.action}`)
    expect(result.result.reason).toContain('source boundary')
    await expect(readFile(join(result.memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('admits trial candidates with evidence trace source boundaries', async () => {
    const home = await createTempDir('cyrene-propose-evidence-boundary-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-propose-evidence-boundary-project-')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        strength: 'hard',
        scope: 'project',
        source: 'tool_trace',
        candidateKind: 'project_fact',
        content: 'Focused duplicate gate tests cover cross-root collisions.',
        normalizedKey: 'duplicate-gate-cross-root-tests',
        evidence: [{
          evidenceGroupId: 'duplicate-gates-test',
          sourceKind: 'tool_trace',
          traceRefs: ['tests/codex-memory-triage.test.ts'],
          summary: 'Focused test covers cross-root duplicate behavior.'
        }],
        scores: {
          evidenceStrength: 0.95,
          stability: 0.95,
          usefulness: 0.9,
          safety: 0.95,
          sensitivity: 0.1
        }
      }
    })

    expect(result.result.action).toBe('trial')
    const semantic = await readSemanticMemoriesFromRoot(result.memoryRoot)
    expect(semantic[0]?.evidence[0]).toMatchObject({
      sourceKind: 'tool_trace',
      sourceRef: 'duplicate-gates-test'
    })
  })

  it('does not auto-promote repeated implementation notes before rewrite', async () => {
    const home = await createTempDir('cyrene-propose-auto-promote-rewrite-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-propose-auto-promote-rewrite-project-')
    const candidate = {
      domain: 'project' as const,
      type: 'project_fact' as const,
      scope: 'project' as const,
      source: 'file' as const,
      candidateKind: 'project_fact' as const,
      content: 'v1 admission gate 核心实现采用 subagent-driven 执行方案，并创建隔离工作区。',
      normalizedKey: 'v1-admission-gate-subagent-worktree',
      evidence: [{ summary: 'Review summary recorded v1 implementation flow.', evidenceGroupId: 'file-1', sourceKind: 'file' as const }],
      scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.05 },
      tags: ['project_harvest', 'project_fact']
    }

    const first = await proposeCodexMemoryCandidate({ cwd, candidate, now: '2026-05-30T00:00:00.000Z' })
    expect(first.result.action).toBe('pending')

    const second = await proposeCodexMemoryCandidate({
      cwd,
      candidate: {
        ...candidate,
        evidence: [{ summary: 'Tool trace recorded isolated worktree execution.', evidenceGroupId: 'tool-1', sourceKind: 'tool_trace' as const }]
      },
      now: '2026-05-30T01:00:00.000Z'
    })

    expect(second.result.action).toBe('pending')
    if (second.result.action !== 'pending') throw new Error(`Expected pending, got ${second.result.action}`)
    expect(second.result.reason).toContain('Active-readiness requires rewrite before auto-promotion')
    const pending = await readFile(join(second.memoryRoot, 'review_queue.jsonl'), 'utf8')
    expect(pending).toContain(candidate.content)
    expect(pending).toContain('"seenCount":2')
    await expect(readFile(join(second.memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('evicts the weakest pending candidate before writing a stronger incoming candidate over budget', async () => {
    const home = await createTempDir('cyrene-propose-budget-evict-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_PENDING_MAX_ITEMS_PROJECT', '2')
    const cwd = await createTempDir('cyrene-propose-budget-evict-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'review_queue.jsonl'), [
      JSON.stringify(budgetPending('weak')),
      JSON.stringify(budgetPending('protected', { source: 'user_explicit', candidateKind: 'user_instruction' }))
    ].join('\n') + '\n')

    const result = await proposeCodexMemoryCandidate({
      cwd,
      allowAutoPromote: false,
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
    const pending = await readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')
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
    await writeFile(join(memoryRoot, 'review_queue.jsonl'), [
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
    const pending = await readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')
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
    const outsidePending = join(outside, 'review_queue.jsonl')
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(outsidePending, 'outside target must stay unchanged\n')
    await symlink(outsidePending, join(memoryRoot, 'review_queue.jsonl'))

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
