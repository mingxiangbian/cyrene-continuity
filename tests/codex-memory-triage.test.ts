import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { runCodexMemoryTriage } from '../src/codex/codex-memory-triage-cli.js'
import { rejectCodexPendingMemory, reviewHashForPendingMemory } from '../src/codex/memory-review.js'
import {
  MEMORY_BOUNDARY_FLAGS,
  buildCandidateClusters,
  evaluateAutoPromotionPolicy,
  rankPendingForEviction,
  triagePendingMemories
} from '../src/codex/memory-triage.js'
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

function pending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Project uses SQLite FTS for memory retrieval.',
    normalizedKey: 'project-sqlite-fts-retrieval',
    evidence: [
      { summary: 'README documents SQLite FTS.', evidenceGroupId: 'file-1', sourceKind: 'file' },
      { summary: 'Tool trace rebuilt memory.db.', evidenceGroupId: 'tool-1', sourceKind: 'tool_trace' }
    ],
    source: 'file',
    sourceOfTruth: 'AGENTS.md',
    scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.05 },
    seenCount: 2,
    firstSeenAt: '2026-05-30T00:00:00.000Z',
    lastSeenAt: '2026-05-30T00:00:00.000Z',
    expiresAt: '2026-06-30T00:00:00.000Z',
    candidateKind: 'project_fact',
    tags: ['project_harvest'],
    ...overrides
  }
}

function jsonl<T>(text: string): T[] {
  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

describe('memory triage', () => {
  it('auto-drops transient command status noise', () => {
    const result = triagePendingMemories({
      pending: [
        pending({
          id: 'noise',
          content: 'Ran npm test today.',
          normalizedKey: 'ran-npm-test-today',
          evidence: [{ summary: 'temporary command result' }],
          seenCount: 1
        })
      ],
      active: [],
      tombstones: [],
      scope: 'project',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.decisions).toContainEqual(expect.objectContaining({ action: 'auto_drop', candidateId: 'noise' }))
  })

  it('does not auto-drop durable candidates merely because they mention today', () => {
    const result = triagePendingMemories({
      pending: [
        pending({
          id: 'durable-today',
          content: 'Today we decided to keep the memory review UI hash-checked.',
          normalizedKey: 'durable-today-review-decision',
          source: 'user_explicit',
          evidence: [{ summary: 'User stated a durable project decision today.', sourceKind: 'user_explicit' }],
          seenCount: 1
        })
      ],
      active: [],
      tombstones: [],
      scope: 'project',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.decisions).not.toContainEqual(expect.objectContaining({
      action: 'auto_drop',
      candidateId: 'durable-today'
    }))
  })

  it('clusters duplicate normalized keys', () => {
    const clusters = buildCandidateClusters([
      pending({ id: 'a', normalizedKey: 'same-key' }),
      pending({ id: 'b', normalizedKey: 'same-key', content: 'Project memory retrieval uses SQLite FTS.' })
    ])

    expect(clusters).toEqual([expect.objectContaining({ memberIds: ['a', 'b'], normalizedKey: 'same-key' })])
  })

  it('auto-merges only exact low-risk duplicates from the same root with compatible metadata', () => {
    const result = triagePendingMemories({
      memoryRoot: '/tmp/project-memory',
      pending: [
        pending({
          id: 'merge-a',
          normalizedKey: 'same-key',
          type: 'procedural_rule',
          candidateKind: 'workflow_rule',
          content: 'Run focused tests before declaring task completion.',
          evidence: [{ summary: 'AGENTS.md requires verification.', sourceKind: 'file', traceRefs: ['AGENTS.md'] }]
        }),
        pending({
          id: 'merge-b',
          normalizedKey: 'same-key',
          type: 'procedural_rule',
          candidateKind: 'workflow_rule',
          content: 'Run focused tests before declaring task completion.',
          evidence: [{ summary: 'Plan requires focused tests.', sourceKind: 'file', traceRefs: ['plan.md'] }]
        })
      ],
      active: [],
      tombstones: [],
      scope: 'project',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.decisions).toContainEqual(expect.objectContaining({
      action: 'auto_merge_allowed',
      candidateIds: ['merge-a', 'merge-b'],
      flags: []
    }))
  })

  it.each([
    [
      'different root',
      [
        pending({ id: 'a', normalizedKey: 'same-key', memoryRoot: '/tmp/root-a' } as Partial<PendingMemory>),
        pending({ id: 'b', normalizedKey: 'same-key', memoryRoot: '/tmp/root-b' } as Partial<PendingMemory>)
      ],
      'cross_root_normalized_key_collision'
    ],
    [
      'different sourceOfTruth',
      [
        pending({ id: 'a', normalizedKey: 'same-key', sourceOfTruth: 'AGENTS.md' }),
        pending({ id: 'b', normalizedKey: 'same-key', sourceOfTruth: 'README.md' })
      ],
      'same_key_mixed_metadata'
    ],
    [
      'high-risk personal domain',
      [
        pending({ id: 'a', normalizedKey: 'same-key', domain: 'personal', type: 'user_preference', source: 'user_implicit' }),
        pending({ id: 'b', normalizedKey: 'same-key', domain: 'personal', type: 'user_preference', source: 'user_implicit' })
      ],
      'project_personal_domain'
    ],
    [
      'mixed candidate kind',
      [
        pending({ id: 'a', normalizedKey: 'same-key', candidateKind: 'workflow_rule' }),
        pending({ id: 'b', normalizedKey: 'same-key', candidateKind: 'known_pitfall' })
      ],
      'same_key_mixed_metadata'
    ],
    [
      'missing source boundary',
      [
        pending({ id: 'a', normalizedKey: 'same-key', sourceOfTruth: undefined, evidence: [{ summary: 'plain evidence' }] }),
        pending({ id: 'b', normalizedKey: 'same-key', sourceOfTruth: undefined, evidence: [{ summary: 'plain evidence 2' }] })
      ],
      'missing_source_boundary'
    ]
  ])('recommends duplicate review for %s', (_name, candidates, flag) => {
    const result = triagePendingMemories({
      memoryRoot: '/tmp/project-memory',
      pending: candidates,
      active: [],
      tombstones: [],
      scope: 'project',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.decisions).toContainEqual(expect.objectContaining({
      action: 'manual_review_recommended',
      candidateIds: ['a', 'b'],
      flags: expect.arrayContaining([flag])
    }))
    expect(result.decisions).not.toContainEqual(expect.objectContaining({
      action: 'auto_merge_allowed',
      candidateIds: ['a', 'b']
    }))
  })

  it('recommends review instead of auto-merge when a pending duplicate overlaps active memory', () => {
    const result = triagePendingMemories({
      memoryRoot: '/tmp/project-memory',
      pending: [
        pending({ id: 'a', normalizedKey: 'same-key' }),
        pending({ id: 'b', normalizedKey: 'same-key' })
      ],
      active: [
        {
          ...pending({ id: 'active', normalizedKey: 'same-key', status: 'pending' }),
          status: 'active',
          createdAt: '2026-05-30T00:00:00.000Z',
          updatedAt: '2026-05-30T00:00:00.000Z'
        }
      ],
      tombstones: [],
      scope: 'project',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.decisions).toContainEqual(expect.objectContaining({
      action: 'manual_review_recommended',
      candidateIds: ['a', 'b'],
      flags: expect.arrayContaining(['active_pending_collision'])
    }))
  })

  it('exports the duplicate and pollution gate names as a stable contract', () => {
    expect(MEMORY_BOUNDARY_FLAGS).toEqual([
      'scope_root_mismatch',
      'global_project_specific_source',
      'project_personal_domain',
      'missing_source_boundary',
      'cross_root_normalized_key_collision',
      'active_pending_collision',
      'same_key_mixed_metadata'
    ])
  })

  it('recommends ordinary pending candidates for explicit review', () => {
    const result = triagePendingMemories({
      pending: [
        pending({
          id: 'ordinary',
          evidence: [{ summary: 'AGENTS.md documents project working rules.', sourceKind: 'file' }],
          scores: { evidenceStrength: 0.75, stability: 0.7, usefulness: 0.7, safety: 0.9, sensitivity: 0.2 },
          seenCount: 1
        })
      ],
      active: [],
      tombstones: [],
      scope: 'project',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.clusters).toEqual([])
    expect(result.decisions).toEqual([
      expect.objectContaining({
        action: 'recommend',
        candidateId: 'ordinary',
        reason: 'ranked pending candidate for explicit review'
      })
    ])
  })

  it('routes protected pending candidates to manual review', () => {
    const result = triagePendingMemories({
      pending: [
        pending({
          id: 'explicit',
          source: 'user_explicit',
          candidateKind: 'user_instruction',
          evidence: [{ summary: 'User explicitly requested a durable rule.', sourceKind: 'user_explicit' }]
        })
      ],
      active: [],
      tombstones: [],
      scope: 'project',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.decisions).toEqual([
      expect.objectContaining({
        action: 'manual_review',
        candidateId: 'explicit',
        reason: 'protected pending candidate requires explicit review'
      })
    ])
  })

  it('does not add review recommendations for cleanup decisions', () => {
    const result = triagePendingMemories({
      pending: [
        pending({
          id: 'noise',
          content: 'Ran npm test today.',
          normalizedKey: 'ran-npm-test-today',
          evidence: [{ summary: 'temporary command result' }],
          seenCount: 1
        })
      ],
      active: [],
      tombstones: [],
      scope: 'project',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.decisions).toEqual([
      expect.objectContaining({ action: 'auto_drop', candidateId: 'noise' })
    ])
  })

  it('caps review recommendations to keep triage output bounded', () => {
    const result = triagePendingMemories({
      pending: Array.from({ length: 25 }, (_, index) =>
        pending({
          id: `ordinary-${index}`,
          normalizedKey: `ordinary-${index}`,
          evidence: [{ summary: `ordinary pending candidate ${index}`, sourceKind: 'file' }],
          scores: { evidenceStrength: 0.75, stability: 0.7, usefulness: 0.7, safety: 0.9, sensitivity: 0.2 },
          seenCount: 1
        })
      ),
      active: [],
      tombstones: [],
      scope: 'project',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.decisions).toHaveLength(20)
    expect(result.decisions.every((decision) => decision.action === 'recommend')).toBe(true)
  })

  it('allows strict low-risk project auto-promotion', () => {
    const result = evaluateAutoPromotionPolicy({
      candidate: pending(),
      scope: 'project',
      active: [],
      tombstones: [],
      promotionsUsedToday: 0,
      projectDailyCap: 5,
      globalDailyCap: 1,
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result).toMatchObject({ allowed: true, policyId: 'low_risk_project_memory_v1' })
  })

  it('denies strict low-risk project auto-promotion after daily cap is reached', () => {
    const result = evaluateAutoPromotionPolicy({
      candidate: pending(),
      scope: 'project',
      active: [],
      tombstones: [],
      promotionsUsedToday: 5,
      projectDailyCap: 5,
      globalDailyCap: 1,
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result).toMatchObject({ allowed: false })
    expect(result.reason).toContain('daily auto-promotion cap')
  })

  it('denies assistant-observed-only auto-promotion', () => {
    const result = evaluateAutoPromotionPolicy({
      candidate: pending({ source: 'assistant_observed', evidence: [{ summary: 'Assistant observed this.' }] }),
      scope: 'project',
      active: [],
      tombstones: [],
      promotionsUsedToday: 0,
      projectDailyCap: 5,
      globalDailyCap: 1,
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result).toMatchObject({ allowed: false })
    expect(result.reason).toContain('assistant_observed')
  })

  it('ranks protected pending after evictable pending', () => {
    const ranked = rankPendingForEviction([
      pending({ id: 'weak', scores: { evidenceStrength: 0.3, stability: 0.3, usefulness: 0.2, safety: 0.9, sensitivity: 0.1 } }),
      pending({ id: 'explicit', source: 'user_explicit', candidateKind: 'user_instruction' })
    ], '2026-05-30T00:00:00.000Z')

    expect(ranked[0]).toMatchObject({ candidateId: 'weak', protected: false })
    expect(ranked[1]).toMatchObject({ candidateId: 'explicit', protected: true })
  })

  it('applies review-derived global candidates through memory proposal policy', async () => {
    const home = await createTempDir('cyrene-triage-global-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-triage-global-project-')
    const project = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'events.jsonl'), [
      { id: 'event-1', action: 'reject', at: '2026-05-28T00:00:00.000Z', reason: 'temporary status', candidateId: 'a', details: { reviewPatternId: 'reject-transient-test-status', candidateKind: 'project_fact' } },
      { id: 'event-2', action: 'reject', at: '2026-05-29T00:00:00.000Z', reason: 'not durable memory', candidateId: 'b', details: { reviewPatternId: 'reject-transient-test-status', candidateKind: 'project_fact' } },
      { id: 'event-3', action: 'reject', at: '2026-05-30T00:00:00.000Z', reason: 'one-off command output', candidateId: 'c', details: { reviewPatternId: 'reject-transient-test-status', candidateKind: 'project_fact' } }
    ].map((event) => JSON.stringify(event)).join('\n') + '\n')

    const output = await runCodexMemoryTriage({
      cwd,
      dryRun: false,
      apply: true,
      now: '2026-05-30T00:00:00.000Z'
    })

    const parsed = JSON.parse(output) as { reviewDerivedCandidateCount?: number }
    expect(parsed.reviewDerivedCandidateCount).toBe(1)
    await runCodexMemoryTriage({
      cwd,
      dryRun: false,
      apply: true,
      now: '2026-05-31T00:00:00.000Z'
    })
    const pending = await readFile(join(codexGlobalMemoryRoot(), 'review_queue.jsonl'), 'utf8')
    expect(pending).toContain('review-derived-reject-transient-test-status')
    expect(pending).toContain('"source":"review_event"')
    expect(pending).toContain('一次性命令结果')
    await expect(readFile(join(codexGlobalMemoryRoot(), 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('applies safe merge decisions from CLI apply', async () => {
    const home = await createTempDir('cyrene-triage-apply-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-triage-apply-project-')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'triage-apply-project' }))
    const project = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'review_queue.jsonl'), [
      pending({
        id: 'merge-a',
        normalizedKey: 'same-normalized-key',
        content: 'Project uses a shared normalized memory key.',
        evidence: [{ summary: 'first duplicate', sourceKind: 'file' }]
      }),
      pending({
        id: 'merge-b',
        normalizedKey: 'same-normalized-key',
        content: 'Project uses a shared normalized memory key.',
        evidence: [{ summary: 'second duplicate', sourceKind: 'file' }]
      })
    ].map((candidate) => JSON.stringify(candidate)).join('\n') + '\n')

    const output = await runCodexMemoryTriage({
      cwd,
      dryRun: false,
      apply: true,
      now: '2026-05-30T00:00:00.000Z'
    })

    const parsed = JSON.parse(output) as { applied?: { auto_drop: number; auto_defer: number; auto_merge: number } }
    expect(parsed.applied).toEqual({ auto_drop: 0, auto_defer: 0, auto_merge: 1 })
    const pendingCandidates = jsonl<PendingMemory>(await readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8'))
    const events = jsonl<MemoryEvent>(await readFile(join(memoryRoot, 'events.jsonl'), 'utf8'))
    expect(pendingCandidates.map((candidate) => candidate.id)).toEqual(['merge-a'])
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'pending',
        candidateId: 'merge-a',
        details: expect.objectContaining({ reviewAction: 'triage_auto_merge' })
      })
    ]))
    await expect(readFile(join(home, '.cyrene', 'codex', 'memory.db'))).resolves.toBeInstanceOf(Buffer)
  })

  it('records transient review pattern metadata when rejecting command status memory', async () => {
    const home = await createTempDir('cyrene-triage-review-event-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-triage-review-event-project-')
    const project = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    const candidate = pending({
      id: 'transient-review',
      content: 'Ran npm test today.',
      normalizedKey: 'ran-npm-test-today',
      evidence: [{ summary: 'temporary command result' }]
    })
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'review_queue.jsonl'), `${JSON.stringify(candidate)}\n`)

    await rejectCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      now: '2026-05-30T00:00:00.000Z'
    })

    const events = (await readFile(join(memoryRoot, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as MemoryEvent)
    expect(events[0]).toMatchObject({
      action: 'reject',
      candidateId: candidate.id,
      details: {
        reviewPatternId: 'reject-transient-test-status',
        candidateKind: 'project_fact'
      }
    })
  })
})
