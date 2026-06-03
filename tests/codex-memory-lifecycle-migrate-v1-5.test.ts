import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleCodexCommand } from '../src/codex/codex-cli.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { runCodexMemoryLifecycleMigrateV15 } from '../src/codex/codex-memory-lifecycle-migrate-v1-5.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import {
  readMemoryEventsFromRoot,
  readPendingMemoriesFromRoot,
  readSemanticMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type { CyreneMemory, PendingMemory } from '../src/memory/types.js'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writeJsonLines(filePath: string, values: unknown[]): Promise<void> {
  await writeFile(filePath, values.map((value) => JSON.stringify(value)).join('\n') + '\n', 'utf8')
}

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Project memory lifecycle migrations should promote valuable low-risk pending workflow rules to trial memory.',
    normalizedKey: 'promote-low-risk-pending-to-trial',
    evidence: [{ summary: 'Task 2 migration plan requires project pending promotion.', sourceKind: 'file' }],
    source: 'file',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.85,
      usefulness: 0.85,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-06-02T00:00:00.000Z',
    lastSeenAt: '2026-06-02T00:00:00.000Z',
    expiresAt: '2026-07-02T00:00:00.000Z',
    candidateKind: 'workflow_rule',
    tags: ['workflow_rule'],
    ...overrides
  }
}

function createActive(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'global-procedural',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'global',
    status: 'active',
    content: 'Global procedural policy memory should only become global core when it is low risk and well evidenced.',
    normalizedKey: 'global-procedural-policy-core',
    evidence: [{ summary: 'Global policy evidence.', sourceKind: 'file' }],
    source: 'file',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    candidateKind: 'workflow_rule',
    tags: ['workflow_rule'],
    ...overrides
  }
}

async function captureStdout(task: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write
  let stdout = ''
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString()
    return true
  }) as typeof process.stdout.write
  try {
    await task()
    return stdout
  } finally {
    process.stdout.write = originalWrite
  }
}

describe('Codex memory lifecycle v1.5 migration', () => {
  it('converts valuable old pending into project trial and drops review_summary noise', async () => {
    const home = await createTempDir('cyrene-v15-migrate-home-')
    vi.stubEnv('HOME', home)
    const repo = await createTempDir('cyrene-v15-migrate-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    const project = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'pending.jsonl'), [
      createPending({ id: 'pending-1' }),
      createPending({
        id: 'review-summary-noise',
        content: 'review summary ok: merged branch and deleted local branch after verification.',
        normalizedKey: 'review-summary-ok-merged-branch',
        evidence: [{ summary: 'merged branch; deleted local branch', sourceKind: 'review_event' }],
        source: 'review_event',
        scores: {
          evidenceStrength: 0.2,
          stability: 0.2,
          usefulness: 0.1,
          safety: 0.95,
          sensitivity: 0.05
        },
        candidateKind: 'project_fact',
        tags: ['review_summary']
      })
    ])

    const result = await runCodexMemoryLifecycleMigrateV15({
      cwd: repo,
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    const projectResult = result.roots.find((root) => root.scope === 'project' && root.projectId === project.projectId)
    expect(projectResult).toMatchObject({ convertedPendingToTrial: 1, droppedPending: 1 })
    await expect(readPendingMemoriesFromRoot(memoryRoot)).resolves.toEqual([])
    const semantic = await readSemanticMemoriesFromRoot(memoryRoot)
    expect(semantic.find((memory) => memory.id === 'pending-1')).toMatchObject({
      id: 'pending-1',
      status: 'active',
      confidenceTier: 'trial',
      activationPolicy: {
        allowedModes: ['workflow_hint'],
        maxRuntimeStrength: 'hint'
      }
    })
    expect(semantic.find((memory) => memory.id === 'review-summary-noise')).toBeUndefined()
  })

  it('converts low-risk global active memory into global_core and recommends high-risk global memory', async () => {
    const home = await createTempDir('cyrene-v15-migrate-global-home-')
    vi.stubEnv('HOME', home)
    const repo = await createTempDir('cyrene-v15-migrate-global-repo-')
    const globalRoot = codexGlobalMemoryRoot()
    await mkdir(globalRoot, { recursive: true })
    await writeJsonLines(join(globalRoot, 'index.jsonl'), [
      createActive({ id: 'global-procedural' }),
      createActive({
        id: 'global-affective',
        domain: 'affective',
        type: 'affective_pattern',
        content: 'Affective global memory should require manual review instead of automatic activation.',
        normalizedKey: 'global-affective-manual-review',
        scores: {
          evidenceStrength: 0.9,
          stability: 0.8,
          usefulness: 0.8,
          safety: 0.7,
          sensitivity: 0.85
        },
        candidateKind: 'user_instruction',
        tags: ['affective']
      })
    ])

    const result = await runCodexMemoryLifecycleMigrateV15({
      cwd: repo,
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    const globalResult = result.roots.find((root) => root.scope === 'global')
    expect(globalResult).toMatchObject({ convertedActiveToCore: 1, recommendations: 1 })
    const semantic = await readSemanticMemoriesFromRoot(globalRoot)
    expect(semantic.find((memory) => memory.id === 'global-procedural')).toMatchObject({
      id: 'global-procedural',
      status: 'active',
      confidenceTier: 'global_core'
    })
    expect(semantic.find((memory) => memory.id === 'global-affective')).toBeUndefined()
    const events = await readMemoryEventsFromRoot(globalRoot)
    expect(events.map((event) => event.reason)).toContain(
      'v1.5 migration recommended manual review for high-risk memory'
    )
  })

  it('drops low-value project active memory without recommending manual review', async () => {
    const home = await createTempDir('cyrene-v15-migrate-low-value-active-home-')
    vi.stubEnv('HOME', home)
    const repo = await createTempDir('cyrene-v15-migrate-low-value-active-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    const project = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'index.jsonl'), [
      createActive({
        id: 'project-low-value-active',
        scope: 'project',
        content: 'FYI.',
        normalizedKey: 'project-low-value-active',
        scores: {
          evidenceStrength: 0.2,
          stability: 0.6,
          usefulness: 0.1,
          safety: 0.95,
          sensitivity: 0.1
        }
      })
    ])

    const result = await runCodexMemoryLifecycleMigrateV15({
      cwd: repo,
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    const projectResult = result.roots.find((root) => root.scope === 'project' && root.projectId === project.projectId)
    expect(projectResult).toMatchObject({
      droppedActive: 1,
      recommendations: 0,
      convertedActiveToValidated: 0,
      convertedActiveToCore: 0
    })
    const semantic = await readSemanticMemoriesFromRoot(memoryRoot)
    expect(semantic.find((memory) => memory.id === 'project-low-value-active')).toBeUndefined()
    const events = await readMemoryEventsFromRoot(memoryRoot)
    expect(events.find((event) =>
      event.memoryId === 'project-low-value-active' &&
      event.reason === 'v1.5 migration recommended manual review for high-risk memory'
    )).toBeUndefined()
  })

  it('outputs JSON for the CLI dry-run route', async () => {
    const home = await createTempDir('cyrene-v15-migrate-cli-home-')
    vi.stubEnv('HOME', home)
    const repo = await createTempDir('cyrene-v15-migrate-cli-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })

    const stdout = await captureStdout(() =>
      handleCodexCommand({
        cwd: repo,
        args: ['memory', 'lifecycle', 'migrate-v1-5', '--dry-run']
      })
    )

    const parsed = JSON.parse(stdout) as { action?: string; dryRun?: boolean }
    expect(parsed.action).toBe('migrate_memory_lifecycle_v1_5')
    expect(parsed.dryRun).toBe(true)
  })
})
