import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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
  readSemanticMemoriesFromRoot,
  writeSemanticMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type { CyreneMemory, PendingMemory, SemanticMemory } from '../src/memory/types.js'

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

function createSemanticPending(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  return {
    id: 'semantic-pending-1',
    status: 'pending',
    module: 'procedural',
    kind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    content: 'Semantic pending workflow rules should be normalized into explicit trial memory during v1.5 migration.',
    useWhen: ['Planning memory lifecycle migration work'],
    doNotUseWhen: ['The task is unrelated to memory lifecycle behavior'],
    sourceOfTruth: 'semantic-pending-fixture',
    evidence: [
      {
        id: 'semantic-pending-evidence-1',
        sourceKind: 'file',
        sourceRef: 'semantic_memories.jsonl',
        when: '2026-06-02T00:00:00.000Z',
        whatHappened: 'Semantic pending memory existed before v1.5 migration.',
        whyImportant: 'Pending memory must not remain implicit after migration.'
      }
    ],
    reviewPolicy: 'pending_review',
    reviewState: {
      normalizedKey: 'semantic-pending-fixture',
      type: 'procedural_rule',
      strength: 'soft',
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
      tags: ['workflow_rule']
    },
    supersedes: [],
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...overrides
  }
}

function createSemanticActive(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  return createSemanticPending({
    id: 'semantic-active-1',
    status: 'active',
    content: 'Semantic active workflow rules without lifecycle fields should be classified during v1.5 migration.',
    reviewPolicy: 'strict_auto_promote',
    reviewState: {
      normalizedKey: 'semantic-active-fixture',
      type: 'procedural_rule',
      strength: 'soft',
      source: 'file',
      scores: {
        evidenceStrength: 0.9,
        stability: 0.85,
        usefulness: 0.85,
        safety: 0.95,
        sensitivity: 0.1
      },
      tags: ['workflow_rule']
    },
    ...overrides
  })
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
    expect(events.find((event) =>
      event.memoryId === 'project-low-value-active' &&
      event.reason === 'v1.5 migration dropped low-value memory'
    )).toMatchObject({
      action: 'audit',
      details: {
        id: 'project-low-value-active',
        sourceStatus: 'active',
        normalizedKey: 'project-low-value-active',
        dropReason: 'low-value memory'
      }
    })
  })

  it('lets active memory win when legacy pending has the same id', async () => {
    const home = await createTempDir('cyrene-v15-migrate-duplicate-id-home-')
    vi.stubEnv('HOME', home)
    const repo = await createTempDir('cyrene-v15-migrate-duplicate-id-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    const project = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeJsonLines(join(memoryRoot, 'index.jsonl'), [
      createActive({
        id: 'dup-memory',
        scope: 'project',
        normalizedKey: 'dup-memory-active',
        content: 'Duplicate ids must preserve the active project memory when a stale pending row has the same id.'
      })
    ])
    await writeJsonLines(join(memoryRoot, 'pending.jsonl'), [
      createPending({
        id: 'dup-memory',
        content: 'FYI.',
        normalizedKey: 'dup-memory-stale-pending',
        scores: {
          evidenceStrength: 0.2,
          stability: 0.3,
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
      convertedPendingToTrial: 0,
      droppedPending: 1,
      droppedActive: 0
    })
    expect((projectResult?.convertedActiveToValidated ?? 0) + (projectResult?.convertedActiveToCore ?? 0)).toBe(1)
    const semantic = await readSemanticMemoriesFromRoot(memoryRoot)
    expect(semantic.find((memory) => memory.id === 'dup-memory')).toMatchObject({
      id: 'dup-memory',
      status: 'active'
    })
    expect(['validated', 'project_core']).toContain(semantic.find((memory) => memory.id === 'dup-memory')?.confidenceTier)
  })

  it('normalizes semantic-only project pending and drops low-value semantic pending', async () => {
    const home = await createTempDir('cyrene-v15-migrate-semantic-pending-home-')
    vi.stubEnv('HOME', home)
    const repo = await createTempDir('cyrene-v15-migrate-semantic-pending-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    const project = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeSemanticMemoriesFromRoot(memoryRoot, [
      createSemanticPending({ id: 'semantic-pending-trial' }),
      createSemanticPending({
        id: 'semantic-pending-low-value',
        content: 'FYI.',
        reviewState: {
          normalizedKey: 'semantic-pending-low-value',
          type: 'procedural_rule',
          strength: 'soft',
          source: 'file',
          scores: {
            evidenceStrength: 0.2,
            stability: 0.6,
            usefulness: 0.1,
            safety: 0.95,
            sensitivity: 0.1
          },
          seenCount: 1,
          firstSeenAt: '2026-06-02T00:00:00.000Z',
          lastSeenAt: '2026-06-02T00:00:00.000Z',
          tags: ['workflow_rule']
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
      semanticPendingBefore: 2,
      convertedPendingToTrial: 1,
      droppedPending: 1
    })
    const semantic = await readSemanticMemoriesFromRoot(memoryRoot)
    expect(semantic.find((memory) => memory.id === 'semantic-pending-trial')).toMatchObject({
      id: 'semantic-pending-trial',
      status: 'active',
      confidenceTier: 'trial',
      activationPolicy: {
        allowedModes: ['workflow_hint'],
        maxRuntimeStrength: 'hint'
      }
    })
    expect(semantic.find((memory) => memory.id === 'semantic-pending-low-value')).toBeUndefined()
    expect(semantic.filter((memory) => memory.status === 'pending')).toEqual([])
    const events = await readMemoryEventsFromRoot(memoryRoot)
    const completion = events.find((event) => event.reason === 'completed v1.5 memory lifecycle migration')
    expect(completion?.details).toMatchObject({ semanticPendingBefore: 2 })
  })

  it('classifies semantic-only active memory and retains full review packages for recommendations', async () => {
    const home = await createTempDir('cyrene-v15-migrate-semantic-active-home-')
    vi.stubEnv('HOME', home)
    const repo = await createTempDir('cyrene-v15-migrate-semantic-active-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    const project = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    await mkdir(memoryRoot, { recursive: true })
    const highRisk = createSemanticActive({
      id: 'semantic-active-high-risk',
      module: 'relationship_affective',
      kind: 'user_instruction',
      domain: 'affective',
      content: 'High-risk semantic active memory should be removed from activation and retained in a full manual review package.',
      sourceOfTruth: 'semantic-active-high-risk-source',
      evidence: [
        {
          id: 'semantic-active-high-risk-evidence',
          sourceKind: 'file',
          sourceRef: 'semantic_memories.jsonl',
          when: '2026-06-02T00:00:00.000Z',
          whatHappened: 'A high-risk semantic active memory existed without lifecycle fields.',
          whyImportant: 'Manual review needs the complete source record.'
        }
      ],
      reviewState: {
        normalizedKey: 'semantic-active-high-risk',
        type: 'affective_pattern',
        strength: 'soft',
        source: 'file',
        scores: {
          evidenceStrength: 0.9,
          stability: 0.8,
          usefulness: 0.8,
          safety: 0.7,
          sensitivity: 0.85
        },
        tags: ['affective', 'manual_review']
      }
    })
    await writeSemanticMemoriesFromRoot(memoryRoot, [
      createSemanticActive({ id: 'semantic-active-validated' }),
      highRisk
    ])

    const result = await runCodexMemoryLifecycleMigrateV15({
      cwd: repo,
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    const projectResult = result.roots.find((root) => root.scope === 'project' && root.projectId === project.projectId)
    expect(projectResult).toMatchObject({
      semanticActiveBefore: 2,
      convertedActiveToValidated: 1,
      convertedActiveToCore: 0,
      recommendations: 1
    })
    const semantic = await readSemanticMemoriesFromRoot(memoryRoot)
    expect(semantic.find((memory) => memory.id === 'semantic-active-validated')).toMatchObject({
      id: 'semantic-active-validated',
      status: 'active',
      confidenceTier: 'validated',
      activationPolicy: {
        allowedModes: ['workflow_hint', 'plan_constraint', 'checklist_item'],
        maxRuntimeStrength: 'checklist'
      }
    })
    expect(semantic.find((memory) => memory.id === 'semantic-active-high-risk')).toBeUndefined()
    expect(semantic.filter((memory) =>
      memory.status === 'active' &&
      (memory.confidenceTier === undefined || memory.activationPolicy === undefined)
    )).toEqual([])
    const events = await readMemoryEventsFromRoot(memoryRoot)
    const recommendation = events.find((event) => event.memoryId === 'semantic-active-high-risk')
    expect(recommendation?.details).toMatchObject({
      reviewPackage: {
        source: 'semantic_memory',
        sourceStatus: 'active',
        content: highRisk.content,
        evidence: highRisk.evidence,
        reviewState: highRisk.reviewState,
        scores: highRisk.reviewState?.scores,
        normalizedKey: 'semantic-active-high-risk',
        tags: ['affective', 'manual_review'],
        originalRecord: {
          id: 'semantic-active-high-risk',
          status: 'active',
          sourceOfTruth: 'semantic-active-high-risk-source'
        }
      }
    })
  })

  it('blocks apply without mutating roots that contain malformed legacy JSONL', async () => {
    const home = await createTempDir('cyrene-v15-migrate-malformed-home-')
    vi.stubEnv('HOME', home)
    const repo = await createTempDir('cyrene-v15-migrate-malformed-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    const project = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    await mkdir(memoryRoot, { recursive: true })
    const pendingPath = join(memoryRoot, 'pending.jsonl')
    const originalPending = `${JSON.stringify(createPending({ id: 'pending-before-malformed' }))}\n{bad json}\n`
    await writeFile(pendingPath, originalPending, 'utf8')

    const result = await runCodexMemoryLifecycleMigrateV15({
      cwd: repo,
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    const projectResult = result.roots.find((root) => root.scope === 'project' && root.projectId === project.projectId)
    expect(projectResult).toMatchObject({
      skipped: true,
      reason: expect.stringContaining('malformed JSONL'),
      malformedJsonLines: 1
    })
    await expect(readFile(pendingPath, 'utf8')).resolves.toBe(originalPending)
    await expect(readFile(join(memoryRoot, 'semantic_memories.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('blocks apply without mutating roots that contain malformed semantic JSONL', async () => {
    const home = await createTempDir('cyrene-v15-migrate-malformed-semantic-home-')
    vi.stubEnv('HOME', home)
    const repo = await createTempDir('cyrene-v15-migrate-malformed-semantic-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    const project = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    await mkdir(memoryRoot, { recursive: true })
    const semanticPath = join(memoryRoot, 'semantic_memories.jsonl')
    const pendingPath = join(memoryRoot, 'pending.jsonl')
    const indexPath = join(memoryRoot, 'index.jsonl')
    const originalSemantic = `${JSON.stringify(createSemanticPending({ id: 'semantic-before-malformed' }))}\n{bad json}\n`
    const originalPending = `${JSON.stringify(createPending({ id: 'pending-before-semantic-malformed' }))}\n`
    const originalIndex = `${JSON.stringify(createActive({ id: 'active-before-semantic-malformed', scope: 'project' }))}\n`
    await writeFile(semanticPath, originalSemantic, 'utf8')
    await writeFile(pendingPath, originalPending, 'utf8')
    await writeFile(indexPath, originalIndex, 'utf8')

    const result = await runCodexMemoryLifecycleMigrateV15({
      cwd: repo,
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    const projectResult = result.roots.find((root) => root.scope === 'project' && root.projectId === project.projectId)
    expect(projectResult).toMatchObject({
      skipped: true,
      reason: expect.stringContaining('malformed JSONL'),
      malformedJsonLines: 1
    })
    await expect(readFile(semanticPath, 'utf8')).resolves.toBe(originalSemantic)
    await expect(readFile(pendingPath, 'utf8')).resolves.toBe(originalPending)
    await expect(readFile(indexPath, 'utf8')).resolves.toBe(originalIndex)
  })

  it('does not rewrite memory files when recommendation event append fails', async () => {
    const home = await createTempDir('cyrene-v15-migrate-event-failure-home-')
    vi.stubEnv('HOME', home)
    const repo = await createTempDir('cyrene-v15-migrate-event-failure-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    const project = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    await mkdir(memoryRoot, { recursive: true })
    const indexPath = join(memoryRoot, 'index.jsonl')
    const originalIndex = `${JSON.stringify(createActive({
      id: 'event-failure-high-risk',
      scope: 'project',
      domain: 'affective',
      type: 'affective_pattern',
      content: 'High-risk memory must keep its source files intact if the review receipt cannot be persisted.',
      normalizedKey: 'event-failure-high-risk',
      scores: {
        evidenceStrength: 0.9,
        stability: 0.8,
        usefulness: 0.8,
        safety: 0.7,
        sensitivity: 0.85
      },
      tags: ['affective']
    }))}\n`
    await writeFile(indexPath, originalIndex, 'utf8')
    await symlink(join(home, 'outside-events.jsonl'), join(memoryRoot, 'events.jsonl'))

    await expect(runCodexMemoryLifecycleMigrateV15({
      cwd: repo,
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })).rejects.toThrow(/memory data file symlink/)

    await expect(readFile(indexPath, 'utf8')).resolves.toBe(originalIndex)
    await expect(readFile(join(memoryRoot, 'semantic_memories.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports all-projects registry listing failures without skipping current roots', async () => {
    const home = await createTempDir('cyrene-v15-migrate-registry-failure-home-')
    vi.stubEnv('HOME', home)
    const repo = await createTempDir('cyrene-v15-migrate-registry-failure-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    const project = await identifyCodexProject(repo)
    await mkdir(codexGlobalMemoryRoot(), { recursive: true })
    await mkdir(codexProjectMemoryRoot(project.projectId), { recursive: true })
    const badProjectRoot = join(home, '.cyrene', 'codex', 'projects', 'bad-registry-entry')
    await mkdir(badProjectRoot, { recursive: true })
    await writeFile(join(badProjectRoot, 'project.json'), '{bad json}\n', 'utf8')

    const result = await runCodexMemoryLifecycleMigrateV15({
      cwd: repo,
      allProjects: true,
      apply: false,
      now: '2026-06-03T00:00:00.000Z'
    })

    expect(result.roots.find((root) => root.scope === 'global')?.skipped).not.toBe(true)
    expect(result.roots.find((root) => root.scope === 'project' && root.projectId === project.projectId)?.skipped).not.toBe(true)
    expect(result.roots.find((root) =>
      root.scope === 'project' &&
      root.skipped === true &&
      root.reason?.includes('project registry listing failed') === true
    )).toBeDefined()
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
