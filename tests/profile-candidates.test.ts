import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import {
  applyCodexProfileCandidate,
  reviewHashForProfileCandidate,
  runCodexProfileReflection,
  type ProfileCandidate
} from '../src/codex/profile-candidates.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import type { CyreneMemory } from '../src/memory/types.js'

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

async function seedProjectActive(cwd: string, active: CyreneMemory[]): Promise<string> {
  const identity = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(identity.projectId)
  await mkdir(memoryRoot, { recursive: true })
  await writeFile(join(memoryRoot, 'index.jsonl'), active.map((item) => JSON.stringify(item)).join('\n') + '\n')
  return realpath(memoryRoot)
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
    profileVisibility: 'always',
    ...overrides
  }
}

function createProfileCandidate(overrides: Partial<ProfileCandidate> = {}): ProfileCandidate {
  return {
    id: 'profile-candidate-1',
    scope: 'project',
    status: 'pending',
    source: 'daily_profile_reflection',
    proposedSection: 'Interaction Preferences',
    content: 'Prefer concise implementation summaries.',
    rationale: 'Derived from active memory marked profile-visible.',
    sourceMemoryIds: ['active-1'],
    evidenceSummary: 'User asked for concise implementation summaries.',
    createdAt: '2026-05-26T00:00:00.000Z',
    ...overrides
  }
}

function parseJsonLines<T>(content: string): T[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

describe('Codex profile candidates', () => {
  it('reflect creates profile candidates and does not write MODEL_PROFILE.md', async () => {
    const home = await createTempDir('cyrene-profile-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-profile-project-')
    const memoryRoot = await seedProjectActive(cwd, [createActive()])

    const result = await runCodexProfileReflection({ cwd, source: 'daily-interview', now: '2026-05-26T00:00:00.000Z' })

    expect(result.memoryRoot).toBe(memoryRoot)
    expect(result.openQuestions).toEqual([])
    expect(result.conflictNotes).toEqual([])
    expect(result.candidates[0]).toMatchObject({
      status: 'pending',
      content: 'Use Chinese for Cyrene specs and plans.',
      reviewHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    const stored = parseJsonLines<ProfileCandidate>(await readFile(join(memoryRoot, 'profile_candidates.jsonl'), 'utf8'))
    expect(stored[0]).toMatchObject({ id: result.candidates[0]?.id, status: 'pending' })
    const pending = await readFile(join(memoryRoot, 'MODEL_PROFILE.pending.md'), 'utf8')
    expect(pending).toContain(result.candidates[0]?.id)
    expect(pending).toContain('Always Apply')
    expect(pending).toContain(result.candidates[0]?.reviewHash)
    expect(pending).toContain('active-1')
    expect(pending).toContain('User asked for Chinese specs and plans.')
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('apply requires a matching review hash', async () => {
    const home = await createTempDir('cyrene-profile-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-profile-project-')
    const memoryRoot = await seedProjectActive(cwd, [createActive()])
    const reflection = await runCodexProfileReflection({ cwd, source: 'daily-interview', now: '2026-05-26T00:00:00.000Z' })
    const candidateId = reflection.candidates[0]?.id ?? ''

    const result = await applyCodexProfileCandidate({
      cwd,
      candidateId,
      reviewHash: 'stale',
      now: '2026-05-26T00:00:01.000Z'
    })

    expect(result.result).toMatchObject({ action: 'conflict', candidateId })
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('apply gate fail does not write profile', async () => {
    const home = await createTempDir('cyrene-profile-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-profile-project-')
    const memoryRoot = await seedProjectActive(cwd, [])
    const candidate = createProfileCandidate({
      content: 'The user is unstable and emotionally dependent.',
      evidenceSummary: 'Unsafe diagnostic affective claim.'
    })
    await writeFile(join(memoryRoot, 'profile_candidates.jsonl'), `${JSON.stringify(candidate)}\n`)

    const result = await applyCodexProfileCandidate({
      cwd,
      candidateId: candidate.id,
      reviewHash: reviewHashForProfileCandidate(candidate),
      now: '2026-05-26T00:00:01.000Z'
    })

    expect(result.result).toMatchObject({
      action: 'blocked_by_gate',
      candidateId: candidate.id,
      failedChecks: ['affective_boundary_eval']
    })
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const stored = parseJsonLines<ProfileCandidate>(await readFile(join(memoryRoot, 'profile_candidates.jsonl'), 'utf8'))
    expect(stored[0]).toMatchObject({ status: 'pending' })
  })

  it('apply gate fail does not write profile when the candidate has no approved source memory', async () => {
    const home = await createTempDir('cyrene-profile-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-profile-project-')
    const memoryRoot = await seedProjectActive(cwd, [])
    const candidate = createProfileCandidate({
      sourceMemoryIds: [],
      evidenceSummary: ''
    })
    await writeFile(join(memoryRoot, 'profile_candidates.jsonl'), `${JSON.stringify(candidate)}\n`)

    const result = await applyCodexProfileCandidate({
      cwd,
      candidateId: candidate.id,
      reviewHash: reviewHashForProfileCandidate(candidate),
      now: '2026-05-26T00:00:01.000Z'
    })

    expect(result.result).toMatchObject({
      action: 'blocked_by_gate',
      candidateId: candidate.id,
      failedChecks: ['profile_pollution_eval']
    })
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('apply gate pass returns a profile diff and renders from structured memory', async () => {
    const home = await createTempDir('cyrene-profile-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-profile-project-')
    const memoryRoot = await seedProjectActive(cwd, [createActive()])
    const reflection = await runCodexProfileReflection({ cwd, source: 'daily-interview', now: '2026-05-26T00:00:00.000Z' })
    const candidate = reflection.candidates[0]
    expect(candidate).toBeDefined()

    const result = await applyCodexProfileCandidate({
      cwd,
      candidateId: candidate?.id ?? '',
      reviewHash: candidate?.reviewHash ?? '',
      now: '2026-05-26T00:00:01.000Z'
    })

    expect(result.result).toMatchObject({
      action: 'apply',
      candidateId: candidate?.id,
      diff: {
        candidateId: candidate?.id,
        section: 'Always Apply',
        before: '',
        after: expect.stringContaining('Use Chinese for Cyrene specs and plans.'),
        addedLines: expect.arrayContaining([expect.stringContaining('Use Chinese for Cyrene specs and plans.')]),
        removedLines: []
      }
    })
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain('Use Chinese for Cyrene specs and plans.')
    const stored = parseJsonLines<ProfileCandidate>(await readFile(join(memoryRoot, 'profile_candidates.jsonl'), 'utf8'))
    expect(stored[0]).toMatchObject({ status: 'applied', appliedMemoryId: expect.any(String) })
    const active = parseJsonLines<CyreneMemory>(await readFile(join(memoryRoot, 'index.jsonl'), 'utf8'))
    expect(active.find((item) => item.id === stored[0]?.appliedMemoryId)).toMatchObject({
      domain: 'system',
      type: 'system_policy',
      evidence: [expect.objectContaining({
        runId: candidate?.id,
        summary: candidate?.evidenceSummary,
        traceRefs: expect.arrayContaining(['active-1']),
        taskHash: candidate?.reviewHash,
        evidenceGroupId: 'Always Apply'
      })]
    })
    const events = parseJsonLines<{ action: string; details?: Record<string, unknown> }>(
      await readFile(join(memoryRoot, 'events.jsonl'), 'utf8')
    )
    expect(events).toContainEqual(expect.objectContaining({
      action: 'promote',
      details: expect.objectContaining({
        reviewHash: candidate?.reviewHash,
        sourceMemoryIds: ['active-1'],
        evidenceSummary: candidate?.evidenceSummary,
        proposedSection: 'Always Apply'
      })
    }))
  })

  it('apply maps profile candidate sections to active memory domain and type', async () => {
    const home = await createTempDir('cyrene-profile-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-profile-project-')
    const memoryRoot = await seedProjectActive(cwd, [])
    const candidates = [
      createProfileCandidate({
        id: 'profile-project',
        proposedSection: 'Project Context',
        content: 'Use the local SQLite cache for symbol lookup.',
        sourceMemoryIds: ['source-project']
      }),
      createProfileCandidate({
        id: 'profile-interaction',
        proposedSection: 'Interaction Preferences',
        content: 'Prefer direct status updates.',
        sourceMemoryIds: ['source-interaction']
      }),
      createProfileCandidate({
        id: 'profile-response',
        proposedSection: 'Response Policy',
        content: 'Mention verification commands in final responses.',
        sourceMemoryIds: ['source-response']
      }),
      createProfileCandidate({
        id: 'profile-always',
        proposedSection: 'Always Apply',
        content: 'Never commit without explicit user approval.',
        sourceMemoryIds: ['source-always']
      })
    ]
    await writeFile(join(memoryRoot, 'profile_candidates.jsonl'), candidates.map((candidate) => JSON.stringify(candidate)).join('\n') + '\n')

    for (const candidate of candidates) {
      await applyCodexProfileCandidate({
        cwd,
        candidateId: candidate.id,
        reviewHash: reviewHashForProfileCandidate(candidate),
        now: '2026-05-26T00:00:01.000Z'
      })
    }

    const active = parseJsonLines<CyreneMemory>(await readFile(join(memoryRoot, 'index.jsonl'), 'utf8'))
    expect(active.find((item) => item.id === 'profile-memory-profile-project')).toMatchObject({
      domain: 'project',
      type: 'project_fact'
    })
    expect(active.find((item) => item.id === 'profile-memory-profile-interaction')).toMatchObject({
      domain: 'personal',
      type: 'interaction_style'
    })
    expect(active.find((item) => item.id === 'profile-memory-profile-response')).toMatchObject({
      domain: 'procedural',
      type: 'procedural_rule'
    })
    expect(active.find((item) => item.id === 'profile-memory-profile-always')).toMatchObject({
      domain: 'system',
      type: 'system_policy'
    })
    const stableProfile = await readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')
    expect(stableProfile).toMatch(/## Project Context[\s\S]*Use the local SQLite cache for symbol lookup\./)
    expect(stableProfile).toMatch(/## Interaction Preferences[\s\S]*Prefer direct status updates\./)
    expect(stableProfile).toMatch(/## Response Policy[\s\S]*Mention verification commands in final responses\./)
    expect(stableProfile).toMatch(/## Always Apply[\s\S]*Never commit without explicit user approval\./)
  })
})
