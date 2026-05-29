import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatCodexDoctor } from '../src/codex/codex-doctor.js'
import { formatCodexMemoryDashboard } from '../src/codex/codex-memory-dashboard.js'
import { readCodexMemoryStatus } from '../src/codex/codex-memory-status.js'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { readDreamReport, writeDreamPreviewArtifacts } from '../src/codex/dream-artifacts.js'
import type { DreamRootProposal } from '../src/codex/dream-proposal.js'
import { readCodexMemoryDreamState, writeCodexMemoryDreamState } from '../src/codex/memory-dream-state.js'
import { runCodexProfileReflection } from '../src/codex/profile-candidates.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import {
  createMemorySnapshot,
  listMemorySnapshots,
  restoreMemorySnapshot
} from '../src/memory/memory-snapshot.js'
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

function createDreamProposal(memoryRoot: string): DreamRootProposal {
  return {
    memoryRoot,
    proposedChanges: [],
    applyPlan: [],
    diff: {
      addActiveMemoryIds: [],
      recommendActiveMemoryIds: [],
      removePendingCandidateIds: [],
      addTombstoneIds: [],
      keepPendingCandidateIds: []
    },
    summary: {
      recommendedPromotions: 0,
      reject: 0,
      expire: 0,
      keepPending: 0,
      maintenanceWouldRun: true
    },
    evalGate: {
      passed: true,
      failedChecks: [],
      results: []
    }
  }
}

describe('memory data symlink guards', () => {
  it('rejects symlinked profile candidate data files', async () => {
    const home = await createTempDir('cyrene-data-symlink-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-data-symlink-project-')
    const memoryRoot = await seedProjectActive(cwd, [createActive()])
    const outside = join(home, 'outside-profile-candidates.jsonl')
    await writeFile(outside, '{"id":"outside-profile"}\n')
    await symlink(outside, join(memoryRoot, 'profile_candidates.jsonl'))

    await expect(
      runCodexProfileReflection({ cwd, source: 'daily-interview', now: '2026-05-26T00:00:00.000Z' })
    ).rejects.toThrow(/symlink/)
    await expect(readFile(outside, 'utf8')).resolves.toBe('{"id":"outside-profile"}\n')
  })

  it('rejects symlinked dream state data files on read and write', async () => {
    const home = await createTempDir('cyrene-data-symlink-home-')
    vi.stubEnv('HOME', home)
    const memoryRoot = join(home, '.cyrene', 'codex', 'projects', 'dream-state', 'memory')
    await mkdir(memoryRoot, { recursive: true })
    const outside = join(home, 'outside-dream-state.json')
    await writeFile(outside, '{"dreamDue":true}\n')
    await symlink(outside, join(memoryRoot, 'dream-state.json'))

    await expect(readCodexMemoryDreamState(memoryRoot)).rejects.toThrow(/symlink/)
    await expect(writeCodexMemoryDreamState(memoryRoot, { dreamDue: false })).rejects.toThrow(/symlink/)
    await expect(readFile(outside, 'utf8')).resolves.toBe('{"dreamDue":true}\n')
  })

  it('rejects symlinked dream preview artifact files', async () => {
    const home = await createTempDir('cyrene-data-symlink-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-data-symlink-project-')
    const project = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    const previewDir = join(memoryRoot, 'dream-preview')
    await mkdir(previewDir, { recursive: true })
    const outsideReport = join(home, 'outside-dream-report.md')
    await writeFile(outsideReport, '# Outside dream report\n')
    await symlink(outsideReport, join(previewDir, 'DREAM_REPORT.md'))

    await expect(readDreamReport({ cwd, root: 'project' })).rejects.toThrow(/symlink/)
    await expect(writeDreamPreviewArtifacts({ memoryRoot, proposal: createDreamProposal(memoryRoot) })).rejects.toThrow(
      /symlink/
    )
    await expect(readFile(outsideReport, 'utf8')).resolves.toBe('# Outside dream report\n')
  })

  it('rejects symlinked memory snapshot files', async () => {
    const cwd = await createTempDir('cyrene-data-symlink-snapshot-project-')
    const summary = await createMemorySnapshot(cwd, 'initial')
    const snapshotPath = join(cwd, '.cyrene', 'memory', 'snapshots', `${summary.id}.json`)
    const outside = join(cwd, 'outside-snapshot.json')
    await rm(snapshotPath)
    await writeFile(outside, `${JSON.stringify({
      version: 1,
      id: summary.id,
      createdAt: summary.createdAt,
      reason: 'outside',
      active: [],
      pending: [],
      tombstones: []
    })}\n`)
    await symlink(outside, snapshotPath)

    await expect(listMemorySnapshots(cwd)).rejects.toThrow(/symlink/)
    await expect(restoreMemorySnapshot({ cwd, snapshotId: summary.id, dryRun: true })).rejects.toThrow(/symlink/)
    await expect(readFile(outside, 'utf8')).resolves.toContain('"reason":"outside"')
  })

  it('does not surface symlinked status, dashboard, or doctor data file contents', async () => {
    const home = await createTempDir('cyrene-data-symlink-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-data-symlink-project-')
    const project = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    await mkdir(memoryRoot, { recursive: true })
    const outsideProfile = join(home, 'outside-profile-candidates.jsonl')
    const outsideSummary = join(home, 'outside-review-summaries.jsonl')
    await writeFile(outsideProfile, '{"status":"pending","content":"outside profile secret"}\n')
    await writeFile(outsideSummary, '{"createdAt":"2026-05-26T00:00:00.000Z","status":"ok","summary":"outside summary secret"}\n')
    await symlink(outsideProfile, join(memoryRoot, 'profile_candidates.jsonl'))
    await symlink(outsideSummary, join(memoryRoot, 'review-summaries.jsonl'))

    const status = await readCodexMemoryStatus({ cwd })
    expect(status.stopHook.sessionSummaries).toBe('unreadable')
    expect(status.roots.project.counts.reason).toMatch(/symlink/)
    expect(JSON.stringify(status)).not.toContain('outside summary secret')
    expect(JSON.stringify(status)).not.toContain('outside profile secret')

    const dashboard = await formatCodexMemoryDashboard({
      cwd,
      configPath: join(home, 'missing-config.toml'),
      now: '2026-05-26T00:00:00.000Z'
    })
    expect(dashboard).not.toContain('outside summary secret')
    expect(dashboard).not.toContain('outside profile secret')

    const doctor = await formatCodexDoctor({
      cwd,
      configPath: join(home, 'missing-config.toml')
    })
    expect(doctor).toContain('profile candidates: unreadable')
    expect(doctor).toContain('session summaries: unreadable')
    expect(doctor).not.toContain('outside summary secret')
    expect(doctor).not.toContain('outside profile secret')
  })
})
