import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { codexMemoryDbPath } from '../src/codex/codex-memory-index.js'
import { writeFastSummaryProjection } from '../src/codex/fast-summary-store.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { activationPolicyForConfidenceTier } from '../src/memory/memory-lifecycle.js'
import { writeActiveMemoriesFromRoot, writePendingMemoriesFromRoot } from '../src/memory/memory-store.js'
import type { BenchmarkFixtureRunMetadata } from './types.js'
import type { ConfidenceTier, CyreneMemory, MemoryScope, PendingMemory } from '../src/memory/types.js'

const defaultProcessCwd = process.cwd()
let fixtureEnvironmentQueue: Promise<void> = Promise.resolve()

interface BenchmarkFixtureInputBase {
  caseId: string
  seed: string
  now: string
  activeMemories?: Array<Partial<CyreneMemory> & { id: string; content: string }>
  pendingMemories?: Array<Partial<PendingMemory> & { id: string; content: string }>
  globalProfile?: string
  projectProfile?: string
  fastSummary?: string
}

export type BenchmarkFixtureInput = BenchmarkFixtureInputBase & (
  | { preserveFixture?: false; preserveReason?: undefined }
  | { preserveFixture: true; preserveReason: string }
)

export interface BenchmarkFixture {
  caseId: string
  seed: string
  now: string
  timezone: 'UTC'
  home: string
  cwd: string
  projectId: string
  globalMemoryRoot: string
  projectMemoryRoot: string
  memoryDbPath: string
  metadata: BenchmarkFixtureRunMetadata
  cleanup(): Promise<void>
}

export function seededId(seed: string, label: string): string {
  return createHash('sha256').update(`${seed}:${label}`).digest('hex').slice(0, 16)
}

export async function withFixtureEnvironment<T>(fixture: BenchmarkFixture, fn: () => Promise<T>): Promise<T> {
  const release = await acquireFixtureEnvironmentLock()
  const previousHome = process.env.HOME
  const previousTz = process.env.TZ
  const previousCwd = process.cwd()
  process.env.HOME = fixture.home
  process.env.TZ = 'UTC'
  try {
    process.chdir(fixture.cwd)
    return await fn()
  } finally {
    restoreCwd(previousCwd)
    restoreEnvValue('HOME', previousHome)
    restoreEnvValue('TZ', previousTz)
    release()
  }
}

async function acquireFixtureEnvironmentLock(): Promise<() => void> {
  let release: () => void = () => {}
  const currentTurn = fixtureEnvironmentQueue
  const nextTurn = new Promise<void>((resolve) => {
    release = resolve
  })
  fixtureEnvironmentQueue = currentTurn.then(() => nextTurn, () => nextTurn)
  await currentTurn.catch(() => undefined)
  return release
}

export async function createBenchmarkFixture(input: BenchmarkFixtureInput): Promise<BenchmarkFixture> {
  if (
    input.preserveFixture === true &&
    (typeof input.preserveReason !== 'string' || input.preserveReason.trim() === '')
  ) {
    throw new Error('Benchmark fixture preservation requires a non-empty preserveReason.')
  }

  const root = await mkdtemp(join(tmpdir(), 'cyrene-benchmark-'))
  const home = join(root, 'home')
  const cwd = join(root, `cyrene-benchmark-project-${seededId(input.seed, 'project')}`)
  await mkdir(home, { recursive: true })
  await mkdir(cwd, { recursive: true })
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: `benchmark-${input.caseId.toLowerCase()}` }), 'utf8')
  await writeDeterministicGitIdentity(cwd, input)

  let projectId = ''
  let globalMemoryRoot = ''
  let projectMemoryRoot = ''
  let memoryDbPath = ''
  const fixtureShell: BenchmarkFixture = {
    caseId: input.caseId,
    seed: input.seed,
    now: input.now,
    timezone: 'UTC',
    home,
    cwd,
    projectId,
    globalMemoryRoot,
    projectMemoryRoot,
    memoryDbPath,
    metadata: {
      root,
      home,
      cwd,
      seed: input.seed,
      clock: input.now,
      timezone: 'UTC',
      cleanupStatus: 'pending',
      preserveFixture: input.preserveFixture === true,
      ...(input.preserveReason === undefined ? {} : { preserveReason: input.preserveReason })
    },
    cleanup: async () => {}
  }

  await withFixtureEnvironment(fixtureShell, async () => {
    const project = await identifyCodexProject(cwd)
    projectId = project.projectId
    globalMemoryRoot = codexGlobalMemoryRoot()
    projectMemoryRoot = codexProjectMemoryRoot(project.projectId)
    memoryDbPath = codexMemoryDbPath()
    await mkdir(globalMemoryRoot, { recursive: true })
    await mkdir(projectMemoryRoot, { recursive: true })
    if (input.activeMemories !== undefined) {
      const active = input.activeMemories.map((memory, index) => activeMemory(input, memory, index))
      await writeActiveMemoriesFromRoot(projectMemoryRoot, active.filter((memory) => memory.scope !== 'global'))
      await writeActiveMemoriesFromRoot(globalMemoryRoot, active.filter((memory) => memory.scope === 'global'))
    }
    if (input.pendingMemories !== undefined) {
      const pending = input.pendingMemories.map((memory, index) => pendingMemory(input, memory, index))
      await writePendingMemoriesFromRoot(projectMemoryRoot, pending.filter((memory) => memory.scope !== 'global'))
      await writePendingMemoriesFromRoot(globalMemoryRoot, pending.filter((memory) => memory.scope === 'global'))
    }
    if (input.globalProfile !== undefined) {
      await writeFile(join(globalMemoryRoot, 'MODEL_PROFILE.md'), input.globalProfile, 'utf8')
    }
    if (input.projectProfile !== undefined) {
      await writeFile(join(projectMemoryRoot, 'MODEL_PROFILE.md'), input.projectProfile, 'utf8')
    }
    if (input.fastSummary !== undefined) {
      await writeFastSummaryProjection(projectMemoryRoot, {
        globalFastSummary: '',
        profileFastSummary: input.fastSummary,
        generatedAt: input.now
      })
    }
  })

  const metadata: BenchmarkFixtureRunMetadata = {
    root,
    home,
    cwd,
    seed: input.seed,
    clock: input.now,
    timezone: 'UTC',
    cleanupStatus: 'pending',
    preserveFixture: input.preserveFixture === true,
    ...(input.preserveReason === undefined ? {} : { preserveReason: input.preserveReason })
  }
  const fixture: BenchmarkFixture = {
    caseId: input.caseId,
    seed: input.seed,
    now: input.now,
    timezone: 'UTC',
    home,
    cwd,
    projectId,
    globalMemoryRoot,
    projectMemoryRoot,
    memoryDbPath,
    metadata,
    cleanup: async () => {
      if (input.preserveFixture === true) {
        metadata.cleanupStatus = 'preserved'
        return
      }
      try {
        await rm(root, { recursive: true, force: true })
        metadata.cleanupStatus = 'cleaned'
      } catch (error) {
        metadata.cleanupStatus = 'failed'
        throw error
      }
    }
  }
  return fixture
}

function activeMemory(input: BenchmarkFixtureInput, memory: Partial<CyreneMemory> & { id: string; content: string }, index: number): CyreneMemory {
  const scope = memory.scope ?? 'project'
  const confidenceTier = memory.confidenceTier ?? confidenceTierForScope(scope)
  return {
    id: memory.id,
    domain: memory.domain ?? 'procedural',
    type: memory.type ?? 'procedural_rule',
    strength: memory.strength ?? 'hard',
    scope,
    status: 'active',
    content: memory.content,
    normalizedKey: memory.normalizedKey ?? seededId(input.seed, `active-${index}`),
    evidence: memory.evidence ?? [{ runId: `benchmark-${input.caseId}`, sourceKind: 'user_explicit', summary: 'Benchmark active fixture.' }],
    source: memory.source ?? 'user_explicit',
    scores: memory.scores ?? { evidenceStrength: 0.95, stability: 0.9, usefulness: 0.9, safety: 0.95, sensitivity: 0.1 },
    createdAt: memory.createdAt ?? input.now,
    updatedAt: memory.updatedAt ?? input.now,
    tags: memory.tags ?? ['benchmark'],
    confidenceTier,
    activationPolicy: memory.activationPolicy ?? activationPolicyForConfidenceTier(confidenceTier),
    portability: memory.portability ?? portabilityForScope(scope),
    ...(memory.sourceOfTruth === undefined ? {} : { sourceOfTruth: memory.sourceOfTruth }),
    ...(memory.expiresAt === undefined ? {} : { expiresAt: memory.expiresAt }),
    ...(memory.profileVisibility === undefined ? {} : { profileVisibility: memory.profileVisibility }),
    ...(memory.userConfirmed === undefined ? {} : { userConfirmed: memory.userConfirmed }),
    ...(memory.candidateKind === undefined ? {} : { candidateKind: memory.candidateKind }),
    ...(memory.normalizedKeyConflictResolution === undefined
      ? {}
      : { normalizedKeyConflictResolution: memory.normalizedKeyConflictResolution }),
    ...(memory.supersedes === undefined ? {} : { supersedes: memory.supersedes })
  }
}

function pendingMemory(input: BenchmarkFixtureInput, memory: Partial<PendingMemory> & { id: string; content: string }, index: number): PendingMemory {
  const scope = memory.scope ?? 'project'
  return {
    id: memory.id,
    domain: memory.domain ?? 'procedural',
    type: memory.type ?? 'procedural_rule',
    strength: memory.strength ?? 'hard',
    scope,
    status: 'pending',
    content: memory.content,
    normalizedKey: memory.normalizedKey ?? seededId(input.seed, `pending-${index}`),
    evidence: memory.evidence ?? [{ runId: `benchmark-${input.caseId}`, evidenceGroupId: `benchmark-${index}`, summary: 'Benchmark pending fixture.' }],
    source: memory.source ?? 'assistant_observed',
    scores: memory.scores ?? { evidenceStrength: 0.5, stability: 0.5, usefulness: 0.5, safety: 0.9, sensitivity: 0.1 },
    seenCount: memory.seenCount ?? 1,
    firstSeenAt: memory.firstSeenAt ?? input.now,
    lastSeenAt: memory.lastSeenAt ?? input.now,
    expiresAt: memory.expiresAt ?? '2026-07-05T00:00:00.000Z',
    tags: memory.tags ?? ['benchmark'],
    portability: memory.portability ?? portabilityForScope(scope),
    ...(memory.useWhen === undefined ? {} : { useWhen: memory.useWhen }),
    ...(memory.doNotUseWhen === undefined ? {} : { doNotUseWhen: memory.doNotUseWhen }),
    ...(memory.sourceOfTruth === undefined ? {} : { sourceOfTruth: memory.sourceOfTruth }),
    ...(memory.promoteAfter === undefined ? {} : { promoteAfter: memory.promoteAfter }),
    ...(memory.admittedBy === undefined ? {} : { admittedBy: memory.admittedBy }),
    ...(memory.admissionAction === undefined ? {} : { admissionAction: memory.admissionAction }),
    ...(memory.admissionScore === undefined ? {} : { admissionScore: memory.admissionScore }),
    ...(memory.admissionReasons === undefined ? {} : { admissionReasons: memory.admissionReasons }),
    ...(memory.sourceEpisodeIds === undefined ? {} : { sourceEpisodeIds: memory.sourceEpisodeIds }),
    ...(memory.sourceDraftIds === undefined ? {} : { sourceDraftIds: memory.sourceDraftIds }),
    ...(memory.userConfirmed === undefined ? {} : { userConfirmed: memory.userConfirmed }),
    ...(memory.profileVisibility === undefined ? {} : { profileVisibility: memory.profileVisibility }),
    ...(memory.candidateKind === undefined ? {} : { candidateKind: memory.candidateKind }),
    ...(memory.conflictsWith === undefined ? {} : { conflictsWith: memory.conflictsWith })
  }
}

async function writeDeterministicGitIdentity(cwd: string, input: BenchmarkFixtureInput): Promise<void> {
  const gitRoot = join(cwd, '.git')
  await mkdir(join(gitRoot, 'refs', 'heads'), { recursive: true })
  await mkdir(join(gitRoot, 'objects'), { recursive: true })
  await writeFile(join(gitRoot, 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
  await writeFile(
    join(gitRoot, 'config'),
    `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = false
\tlogallrefupdates = true
[remote "origin"]
\turl = cyrene-benchmark://${seededId(input.seed, input.caseId)}
`,
    'utf8'
  )
}

function confidenceTierForScope(scope: MemoryScope): ConfidenceTier {
  return scope === 'global' ? 'global_core' : 'validated'
}

function portabilityForScope(scope: MemoryScope): CyreneMemory['portability'] {
  return scope === 'global' ? 'global' : 'local_only'
}

function restoreCwd(previousCwd: string): void {
  try {
    process.chdir(previousCwd)
  } catch {
    process.chdir(defaultProcessCwd)
  }
}

function restoreEnvValue(name: 'HOME' | 'TZ', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
