import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { contentHashForActiveMemory } from '../src/codex/active-memory-review.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { runCodexMemoryLifecycleWeekly } from '../src/codex/codex-memory-lifecycle-weekly.js'
import { readFastSummaryProjection } from '../src/codex/fast-summary-store.js'
import { recordCodexMemoryFeedback } from '../src/codex/memory-feedback.js'
import { writeLifecycleProfileFromCoreMemory } from '../src/codex/memory-lifecycle-profile.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { activationPolicyForConfidenceTier } from '../src/memory/memory-lifecycle.js'
import { semanticMemoryToActiveMemory } from '../src/memory/semantic-memory-adapter.js'
import {
  appendActivationEventFromRoot,
  readMemoryEventsFromRoot,
  readSemanticMemoriesFromRoot,
  writeSemanticMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type { MemoryDomain, MemoryModule, SemanticMemory } from '../src/memory/types.js'

const tempDirs: string[] = []
const NOW = '2026-06-03T00:00:00.000Z'
const originalHome = process.env.HOME

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function semanticMemory(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  const confidenceTier = overrides.confidenceTier ?? 'validated'
  const scope = overrides.scope ?? 'project'
  const domain = overrides.domain ?? 'procedural'
  const module = overrides.module ?? moduleForDomain(domain)
  return {
    id: overrides.id ?? 'memory-1',
    status: 'active',
    module,
    kind: overrides.kind ?? 'workflow_rule',
    scope,
    domain,
    content: overrides.content ?? 'Run runtime verification before declaring implementation complete.',
    useWhen: overrides.useWhen ?? ['Completing implementation work'],
    doNotUseWhen: overrides.doNotUseWhen ?? ['Read-only review'],
    sourceOfTruth: overrides.sourceOfTruth,
    evidence: overrides.evidence ?? [
      {
        id: `evidence-${overrides.id ?? 'memory-1'}`,
        sourceKind: 'review_event',
        sourceRef: `review:${overrides.id ?? 'memory-1'}`,
        when: '2026-06-02T00:00:00.000Z',
        whatHappened: 'The workflow rule was applied.',
        whyImportant: 'It changes completion behavior.'
      }
    ],
    routing: overrides.routing ?? {
      module,
      updatePolicy: 'strict_auto_promote',
      risk: 'low',
      reasons: ['low-risk weekly fixture']
    },
    reviewPolicy: overrides.reviewPolicy ?? 'strict_auto_promote',
    reviewState: overrides.reviewState ?? {
      normalizedKey: normalizeKey(overrides.content ?? 'Run runtime verification before declaring implementation complete.'),
      type: domain === 'system' ? 'system_policy' : 'procedural_rule',
      strength: 'hard',
      source: 'review_event',
      portability: scope === 'global' ? 'global' : 'local_only',
      scores: {
        evidenceStrength: 0.9,
        stability: 0.9,
        usefulness: 0.8,
        safety: 0.95,
        sensitivity: 0.1
      },
      tags: ['workflow_rule']
    },
    confidenceTier,
    activationPolicy: activationPolicyForConfidenceTier(confidenceTier),
    supersedes: overrides.supersedes ?? [],
    expiresAt: overrides.expiresAt,
    reviewAfter: overrides.reviewAfter,
    createdAt: overrides.createdAt ?? '2026-06-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function moduleForDomain(domain: MemoryDomain): MemoryModule {
  if (domain === 'system') return 'system'
  if (domain === 'project') return 'project_semantic'
  if (domain === 'procedural') return 'procedural'
  return 'relationship_affective'
}

function normalizeKey(content: string): string {
  return content.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function appendAppliedContexts(memoryRoot: string, memoryId: string): Promise<void> {
  await appendActivationEventFromRoot(memoryRoot, {
    id: `${memoryId}-event-1`,
    memoryId,
    event: 'applied',
    projectId: 'project-1',
    evidenceRef: 'session:1',
    createdAt: '2026-06-02T00:00:00.000Z'
  })
  await appendActivationEventFromRoot(memoryRoot, {
    id: `${memoryId}-event-2`,
    memoryId,
    event: 'applied',
    projectId: 'project-1',
    activationId: 'activation:2',
    createdAt: NOW
  })
}

describe('weekly core and global consolidation job', () => {
  it('promotes validated project memory to project_core after two distinct applied contexts and writes promotion event', async () => {
    const root = await createTempDir('cyrene-weekly-project-root-')
    await writeSemanticMemoriesFromRoot(root, [semanticMemory({ id: 'validated-1' })])
    await appendAppliedContexts(root, 'validated-1')

    const result = await runCodexMemoryLifecycleWeekly({
      projectRoots: [{ projectId: 'project-1', memoryRoot: root }],
      apply: true,
      now: NOW
    })

    expect(result.projectRoots[0]).toMatchObject({ promotedValidatedToProjectCore: 1, recommendations: 0 })
    const memories = await readSemanticMemoriesFromRoot(root)
    expect(memories[0]).toMatchObject({
      id: 'validated-1',
      confidenceTier: 'project_core',
      activationPolicy: activationPolicyForConfidenceTier('project_core'),
      updatedAt: NOW
    })
    const events = await readMemoryEventsFromRoot(root)
    expect(events).toContainEqual(expect.objectContaining({
      action: 'promote',
      memoryId: 'validated-1',
      reason: 'v1.5 weekly promoted validated memory to project_core',
      details: expect.objectContaining({
        lifecyclePolicyId: 'weekly_project_core_v1',
        policyId: 'low_risk_project_memory_v1',
        distinctEvidenceCount: 2,
        evalGate: expect.objectContaining({ passed: true })
      })
    }))
  })

  it('counts distinct public applied feedback contexts and ignores duplicate feedback', async () => {
    const home = await createTempDir('cyrene-weekly-feedback-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-weekly-feedback-project-')
    const project = await identifyCodexProject(cwd)
    const root = codexProjectMemoryRoot(project.projectId)
    const memory = semanticMemory({ id: 'validated-feedback' })
    const contentHash = contentHashForActiveMemory(semanticMemoryToActiveMemory(memory))
    await writeSemanticMemoriesFromRoot(root, [memory])

    await recordCodexMemoryFeedback({
      cwd,
      memoryId: memory.id,
      contentHash,
      event: 'applied',
      evidenceRef: 'session:1',
      idempotencyKey: 'weekly-feedback-session-1',
      now: '2026-06-03T00:00:00.000Z'
    })
    const duplicate = await recordCodexMemoryFeedback({
      cwd,
      memoryId: memory.id,
      contentHash,
      event: 'applied',
      evidenceRef: 'session:2',
      idempotencyKey: 'weekly-feedback-session-1',
      now: '2026-06-03T00:01:00.000Z'
    })

    expect(duplicate.result.action).toBe('duplicate')
    const beforeSecondContext = await runCodexMemoryLifecycleWeekly({
      projectRoots: [{ projectId: project.projectId, memoryRoot: root }],
      apply: true,
      now: NOW
    })
    expect(beforeSecondContext.projectRoots[0]).toMatchObject({ promotedValidatedToProjectCore: 0 })
    expect((await readSemanticMemoriesFromRoot(root))[0]).toMatchObject({ confidenceTier: 'validated' })

    await recordCodexMemoryFeedback({
      cwd,
      memoryId: memory.id,
      contentHash,
      event: 'applied',
      evidenceRef: 'session:2',
      now: '2026-06-03T00:02:00.000Z'
    })

    const result = await runCodexMemoryLifecycleWeekly({
      projectRoots: [{ projectId: project.projectId, memoryRoot: root }],
      apply: true,
      now: NOW
    })

    expect(result.projectRoots[0]).toMatchObject({ promotedValidatedToProjectCore: 1 })
    const promote = (await readMemoryEventsFromRoot(root)).find((event) => event.action === 'promote')
    expect(promote).toMatchObject({
      details: expect.objectContaining({
        distinctEvidenceCount: 2
      })
    })
  })

  it('does not promote when corrected or violated feedback exists and emits recommendation audit', async () => {
    const root = await createTempDir('cyrene-weekly-negative-root-')
    await writeSemanticMemoriesFromRoot(root, [semanticMemory({ id: 'validated-negative' })])
    await appendAppliedContexts(root, 'validated-negative')
    await appendActivationEventFromRoot(root, {
      id: 'negative-event-1',
      memoryId: 'validated-negative',
      event: 'corrected',
      projectId: 'project-1',
      evidenceRef: 'session:3',
      createdAt: NOW
    })

    const result = await runCodexMemoryLifecycleWeekly({
      projectRoots: [{ projectId: 'project-1', memoryRoot: root }],
      apply: true,
      now: NOW
    })

    expect(result.projectRoots[0]).toMatchObject({ promotedValidatedToProjectCore: 0, recommendations: 1 })
    await expect(readSemanticMemoriesFromRoot(root)).resolves.toEqual([
      expect.objectContaining({ id: 'validated-negative', confidenceTier: 'validated' })
    ])
    const events = await readMemoryEventsFromRoot(root)
    expect(events).toContainEqual(expect.objectContaining({
      action: 'audit',
      memoryId: 'validated-negative',
      reason: 'v1.5 weekly recommended manual review for project memory',
      details: expect.objectContaining({
        lifecyclePolicyId: 'weekly_project_core_v1',
        reason: 'negative activation feedback'
      })
    }))
  })

  it('renders project MODEL_PROFILE.md from project_core only and excludes trial validated and high-risk memories', async () => {
    const root = await createTempDir('cyrene-weekly-profile-root-')
    const projectCore = semanticMemory({
      id: 'project-core',
      confidenceTier: 'project_core',
      content: 'Keep implementation changes scoped to owned files.'
    })
    const secretCore = semanticMemory({
      id: 'secret-core',
      confidenceTier: 'project_core',
      content: 'Never write provider token sk-abc1234567890abcdef1234567890 into generated profiles.'
    })
    const trial = semanticMemory({
      id: 'trial-memory',
      confidenceTier: 'trial',
      content: 'Trial memory must stay out of profile.'
    })
    const validated = semanticMemory({
      id: 'validated-memory',
      content: 'Validated memory must stay out of profile.'
    })
    const highRiskCore = semanticMemory({
      id: 'high-risk-core',
      confidenceTier: 'project_core',
      domain: 'personal',
      module: 'relationship_affective',
      content: 'Personal memory must stay out of profile.',
      reviewState: {
        scores: {
          evidenceStrength: 0.9,
          stability: 0.9,
          usefulness: 0.9,
          safety: 0.7,
          sensitivity: 0.9
        }
      }
    })

    const profile = await writeLifecycleProfileFromCoreMemory({
      memoryRoot: root,
      scope: 'project',
      memories: [trial, validated, highRiskCore, projectCore, secretCore]
    })

    expect(profile).toContain('Keep implementation changes scoped to owned files.')
    expect(profile).toContain('[REDACTED_SECRET]')
    expect(profile).not.toContain('sk-abc')
    expect(profile).not.toContain('Trial memory must stay out of profile.')
    expect(profile).not.toContain('Validated memory must stay out of profile.')
    expect(profile).not.toContain('Personal memory must stay out of profile.')
    await expect(readFile(join(root, 'MODEL_PROFILE.md'), 'utf8')).resolves.toBe(profile)
  })

  it('refreshes project fast summary after weekly project core profile regeneration', async () => {
    const root = await createTempDir('cyrene-weekly-project-fast-summary-root-')
    const projectCore = semanticMemory({
      id: 'project-core-fast-summary',
      confidenceTier: 'project_core',
      content: 'Project weekly fast summary uses regenerated project profile.'
    })
    await writeSemanticMemoriesFromRoot(root, [projectCore])

    const result = await runCodexMemoryLifecycleWeekly({
      projectRoots: [{ projectId: 'project-1', memoryRoot: root }],
      apply: true,
      now: NOW
    })

    expect(result.projectRoots[0]).toMatchObject({
      promotedValidatedToProjectCore: 0,
      fastSummaryUpdated: true
    })
    const summary = await readFastSummaryProjection(root)
    expect(summary.generatedAt).toBe(NOW)
    expect(summary.stale).toBe(false)
    expect(summary.profileFastSummary).toContain('Project weekly fast summary uses regenerated project profile.')
  })

  it('consolidates repeated low-risk project_core from two projects into one global_core and writes global profile and event', async () => {
    const projectA = await createTempDir('cyrene-weekly-project-a-')
    const projectB = await createTempDir('cyrene-weekly-project-b-')
    const globalRoot = await createTempDir('cyrene-weekly-global-')
    const content = 'Run runtime verification before declaring implementation complete.'
    await writeSemanticMemoriesFromRoot(projectA, [
      semanticMemory({ id: 'core-a', confidenceTier: 'project_core', content })
    ])
    await writeSemanticMemoriesFromRoot(projectB, [
      semanticMemory({ id: 'core-b', confidenceTier: 'project_core', content })
    ])

    const result = await runCodexMemoryLifecycleWeekly({
      projectRoots: [
        { projectId: 'project-a', memoryRoot: projectA },
        { projectId: 'project-b', memoryRoot: projectB }
      ],
      globalRoot,
      apply: true,
      now: NOW
    })

    expect(result.global).toMatchObject({ promotedToGlobalCore: 1, recommendations: 0 })
    const globalMemories = await readSemanticMemoriesFromRoot(globalRoot)
    expect(globalMemories).toEqual([
      expect.objectContaining({
        scope: 'global',
        domain: 'procedural',
        confidenceTier: 'global_core',
        content
      })
    ])
    await expect(readFile(join(globalRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain(content)
    const events = await readMemoryEventsFromRoot(globalRoot)
    expect(events).toContainEqual(expect.objectContaining({
      action: 'promote',
      memoryId: globalMemories[0]?.id,
      reason: 'v1.5 weekly consolidated project_core memory into global_core',
      details: expect.objectContaining({
        lifecyclePolicyId: 'weekly_global_consolidation_v1',
        policyId: 'review_derived_global_preference_v1',
        distinctEvidenceCount: 2,
        evalGate: expect.objectContaining({ passed: true })
      })
    }))
  })

  it('refreshes global fast summary without promoting pending or similar-project content', async () => {
    const home = await createTempDir('cyrene-weekly-fast-summary-home-')
    process.env.HOME = home
    const projectRoot = await createTempDir('cyrene-weekly-fast-summary-project-')
    const globalRoot = codexGlobalMemoryRoot()
    await writeSemanticMemoriesFromRoot(projectRoot, [])
    await writeSemanticMemoriesFromRoot(globalRoot, [
      semanticMemory({
        id: 'weekly-global-core',
        scope: 'global',
        confidenceTier: 'global_core',
        content: 'Use weekly fast summary refresh.'
      }),
      semanticMemory({
        id: 'weekly-similar-project-noise',
        scope: 'global',
        confidenceTier: 'global_core',
        content: 'Similar project candidate must not enter fast summary.'
      }),
      semanticMemory({
        id: 'weekly-pending-noise',
        status: 'pending',
        scope: 'global',
        confidenceTier: undefined,
        activationPolicy: undefined,
        content: 'PENDING weekly content must not enter fast summary.'
      })
    ])

    const result = await runCodexMemoryLifecycleWeekly({
      projectRoots: [{ projectId: 'project-1', memoryRoot: projectRoot }],
      apply: true,
      now: NOW
    })

    expect(result.global).toMatchObject({
      fastSummaryUpdated: true,
      indexHealthChecked: true,
      runtimeMetricsRecorded: 0
    })
    const summary = await readFastSummaryProjection(globalRoot)
    expect(summary.generatedAt).toBe(NOW)
    expect(summary.globalFastSummary).toContain('Use weekly fast summary refresh.')
    expect(summary.globalFastSummary).not.toContain('Similar project candidate')
    expect(summary.globalFastSummary).not.toContain('PENDING weekly content')
  })

  it('does not consolidate high-risk personal affective or project-specific content into global_core and produces recommendation only', async () => {
    const projectA = await createTempDir('cyrene-weekly-reject-global-a-')
    const projectB = await createTempDir('cyrene-weekly-reject-global-b-')
    const globalRoot = await createTempDir('cyrene-weekly-reject-global-')
    const personal = semanticMemory({
      id: 'personal-core-a',
      confidenceTier: 'project_core',
      domain: 'personal',
      module: 'relationship_affective',
      content: 'Remember the user private family detail for all projects.',
      reviewState: {
        scores: {
          evidenceStrength: 0.9,
          stability: 0.9,
          usefulness: 0.9,
          safety: 0.7,
          sensitivity: 0.9
        }
      }
    })
    const projectSpecific = semanticMemory({
      id: 'project-specific-core-b',
      confidenceTier: 'project_core',
      content: 'In /Users/phoenix/Assistant/cyrene-continuity, run npm run build:plugin after SKILL.md changes.'
    })
    await writeSemanticMemoriesFromRoot(projectA, [personal])
    await writeSemanticMemoriesFromRoot(projectB, [projectSpecific])

    const result = await runCodexMemoryLifecycleWeekly({
      projectRoots: [
        { projectId: 'project-a', memoryRoot: projectA },
        { projectId: 'project-b', memoryRoot: projectB }
      ],
      globalRoot,
      apply: true,
      now: NOW
    })

    expect(result.global).toMatchObject({ promotedToGlobalCore: 0, recommendations: 2 })
    await expect(readSemanticMemoriesFromRoot(globalRoot)).resolves.toEqual([])
    await expect(readFile(join(globalRoot, 'MODEL_PROFILE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const events = await readMemoryEventsFromRoot(globalRoot)
    expect(events.filter((event) => event.reason === 'v1.5 weekly recommended manual review for global consolidation')).toHaveLength(2)
  })

  it('dedupes existing equivalent global_core', async () => {
    const projectA = await createTempDir('cyrene-weekly-dedupe-a-')
    const projectB = await createTempDir('cyrene-weekly-dedupe-b-')
    const globalRoot = await createTempDir('cyrene-weekly-dedupe-global-')
    const content = 'Run runtime verification before declaring implementation complete.'
    const existingGlobal = semanticMemory({
      id: 'existing-global-core',
      scope: 'global',
      confidenceTier: 'global_core',
      content: '  RUN runtime verification before declaring implementation complete.  '
    })
    await writeSemanticMemoriesFromRoot(projectA, [
      semanticMemory({ id: 'core-a', confidenceTier: 'project_core', content })
    ])
    await writeSemanticMemoriesFromRoot(projectB, [
      semanticMemory({ id: 'core-b', confidenceTier: 'project_core', content })
    ])
    await writeSemanticMemoriesFromRoot(globalRoot, [existingGlobal])

    const result = await runCodexMemoryLifecycleWeekly({
      projectRoots: [
        { projectId: 'project-a', memoryRoot: projectA },
        { projectId: 'project-b', memoryRoot: projectB }
      ],
      globalRoot,
      apply: true,
      now: NOW
    })

    expect(result.global.promotedToGlobalCore).toBe(0)
    await expect(readSemanticMemoriesFromRoot(globalRoot)).resolves.toHaveLength(1)
    const events = await readMemoryEventsFromRoot(globalRoot)
    expect(events.some((event) => event.action === 'promote')).toBe(false)
  })

  it('emits an audit receipt when regenerating profile from existing core memory', async () => {
    const project = await createTempDir('cyrene-weekly-profile-receipt-project-')
    const globalRoot = await createTempDir('cyrene-weekly-profile-receipt-global-')
    await writeSemanticMemoriesFromRoot(project, [
      semanticMemory({
        id: 'existing-project-core',
        confidenceTier: 'project_core',
        content: 'Existing project core should regenerate the profile with an audit receipt.'
      })
    ])

    await runCodexMemoryLifecycleWeekly({
      projectRoots: [{ projectId: 'project-1', memoryRoot: project }],
      globalRoot,
      apply: true,
      now: NOW
    })

    await expect(readFile(join(project, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain(
      'Existing project core should regenerate the profile with an audit receipt.'
    )
    const events = await readMemoryEventsFromRoot(project)
    expect(events).toContainEqual(expect.objectContaining({
      action: 'audit',
      reason: 'v1.5 weekly regenerated core memory profile',
      details: expect.objectContaining({
        lifecyclePolicyId: 'weekly_project_core_v1',
        scope: 'project',
        coreMemoryCount: 1
      })
    }))
  })

  it('does not consolidate same-project duplicate project_core rows into global_core', async () => {
    const project = await createTempDir('cyrene-weekly-same-project-')
    const globalRoot = await createTempDir('cyrene-weekly-same-project-global-')
    const content = 'Run runtime verification before declaring implementation complete.'
    await writeSemanticMemoriesFromRoot(project, [
      semanticMemory({ id: 'core-a', confidenceTier: 'project_core', content }),
      semanticMemory({
        id: 'core-b',
        confidenceTier: 'project_core',
        content,
        evidence: [
          {
            id: 'evidence-core-b',
            sourceKind: 'review_event',
            sourceRef: 'review:core-b',
            whatHappened: 'The workflow rule was applied again in the same project.',
            whyImportant: 'Same-project repetition is not enough for global consolidation.'
          }
        ]
      })
    ])

    const result = await runCodexMemoryLifecycleWeekly({
      projectRoots: [{ projectId: 'same-project', memoryRoot: project }],
      globalRoot,
      apply: true,
      now: NOW
    })

    expect(result.global).toMatchObject({ promotedToGlobalCore: 0, recommendations: 0 })
    await expect(readSemanticMemoriesFromRoot(globalRoot)).resolves.toEqual([])
    await expect(readFile(join(globalRoot, 'MODEL_PROFILE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports existing invalid global active memory as needs_migration', async () => {
    const project = await createTempDir('cyrene-weekly-invalid-global-project-')
    const globalRoot = await createTempDir('cyrene-weekly-invalid-global-')
    await writeSemanticMemoriesFromRoot(project, [])
    await writeSemanticMemoriesFromRoot(globalRoot, [
      semanticMemory({
        id: 'invalid-global-validated',
        scope: 'global',
        confidenceTier: 'validated',
        content: 'Invalid global memory must be reported.'
      })
    ])

    const result = await runCodexMemoryLifecycleWeekly({
      projectRoots: [{ projectId: 'project-a', memoryRoot: project }],
      globalRoot,
      apply: true,
      now: NOW
    })

    expect(result.global).toMatchObject({ promotedToGlobalCore: 0, invalidMemories: 1, recommendations: 1 })
    await expect(readSemanticMemoriesFromRoot(globalRoot)).resolves.toEqual([
      expect.objectContaining({ id: 'invalid-global-validated', confidenceTier: 'validated' })
    ])
    const events = await readMemoryEventsFromRoot(globalRoot)
    expect(events).toContainEqual(expect.objectContaining({
      action: 'audit',
      memoryId: 'invalid-global-validated',
      reason: 'v1.5 weekly recommended manual review for global consolidation',
      details: expect.objectContaining({
        lifecyclePolicyId: 'weekly_global_consolidation_v1',
        reason: 'invalid/needs_migration'
      })
    }))
  })

  it('does not rewrite semantic memory or profile when promotion receipt cannot be appended', async () => {
    const root = await createTempDir('cyrene-weekly-receipt-failure-')
    await writeSemanticMemoriesFromRoot(root, [semanticMemory({ id: 'validated-1' })])
    await appendAppliedContexts(root, 'validated-1')
    await writeFile(join(root, 'MODEL_PROFILE.md'), 'existing profile\n', 'utf8')
    await mkdir(join(root, 'events.jsonl'))
    const beforeSemantic = await readFile(join(root, 'semantic_memories.jsonl'), 'utf8')

    await expect(runCodexMemoryLifecycleWeekly({
      projectRoots: [{ projectId: 'project-1', memoryRoot: root }],
      apply: true,
      now: NOW
    })).rejects.toThrow(/non-file memory data path/)

    await expect(readFile(join(root, 'semantic_memories.jsonl'), 'utf8')).resolves.toBe(beforeSemantic)
    await expect(readFile(join(root, 'MODEL_PROFILE.md'), 'utf8')).resolves.toBe('existing profile\n')
  })

  it('skips malformed semantic JSONL apply and leaves file bytes unchanged', async () => {
    const root = await createTempDir('cyrene-weekly-malformed-project-')
    const globalRoot = await createTempDir('cyrene-weekly-malformed-global-')
    const malformed = `${JSON.stringify(semanticMemory({ id: 'validated-1' }))}\n{not-json}\n`
    await writeFile(join(root, 'semantic_memories.jsonl'), malformed, 'utf8')
    await appendAppliedContexts(root, 'validated-1')

    const result = await runCodexMemoryLifecycleWeekly({
      projectRoots: [{ projectId: 'project-1', memoryRoot: root }],
      globalRoot,
      apply: true,
      now: NOW
    })

    expect(result.projectRoots[0]).toMatchObject({
      promotedValidatedToProjectCore: 0,
      invalidMemories: 1,
      recommendations: 1,
      malformedSemanticMemories: 1
    })
    await expect(readFile(join(root, 'semantic_memories.jsonl'), 'utf8')).resolves.toBe(malformed)
    await expect(readFile(join(root, 'MODEL_PROFILE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const events = await readMemoryEventsFromRoot(root)
    expect(events).toContainEqual(expect.objectContaining({
      action: 'audit',
      reason: 'v1.5 weekly recommended manual review for project memory',
      details: expect.objectContaining({ reason: 'malformed semantic_memories.jsonl' })
    }))
  })

  it('does not globalize repeated named project-specific command details', async () => {
    const projectA = await createTempDir('cyrene-weekly-project-command-a-')
    const projectB = await createTempDir('cyrene-weekly-project-command-b-')
    const globalRoot = await createTempDir('cyrene-weekly-project-command-global-')
    const content = 'For cyrene-continuity, run npm run build:plugin after SKILL.md changes.'
    await writeSemanticMemoriesFromRoot(projectA, [
      semanticMemory({ id: 'core-a', confidenceTier: 'project_core', content })
    ])
    await writeSemanticMemoriesFromRoot(projectB, [
      semanticMemory({ id: 'core-b', confidenceTier: 'project_core', content })
    ])

    const result = await runCodexMemoryLifecycleWeekly({
      projectRoots: [
        { projectId: 'project-a', memoryRoot: projectA },
        { projectId: 'project-b', memoryRoot: projectB }
      ],
      globalRoot,
      apply: true,
      now: NOW
    })

    expect(result.global).toMatchObject({ promotedToGlobalCore: 0, recommendations: 2 })
    await expect(readSemanticMemoriesFromRoot(globalRoot)).resolves.toEqual([])
    const events = await readMemoryEventsFromRoot(globalRoot)
    expect(events).toHaveLength(2)
    expect(events.every((event) => event.details?.reason === 'project-specific global candidate')).toBe(true)
  })

  it('dry-run leaves semantic files events and profile untouched', async () => {
    const root = await createTempDir('cyrene-weekly-dry-run-project-')
    const globalRoot = await createTempDir('cyrene-weekly-dry-run-global-')
    await writeSemanticMemoriesFromRoot(root, [semanticMemory({ id: 'validated-1' })])
    await appendAppliedContexts(root, 'validated-1')
    await writeFile(join(root, 'MODEL_PROFILE.md'), 'existing project profile\n', 'utf8')
    const beforeSemantic = await readFile(join(root, 'semantic_memories.jsonl'), 'utf8')
    const beforeEvents = await readFile(join(root, 'activation_events.jsonl'), 'utf8')

    const result = await runCodexMemoryLifecycleWeekly({
      projectRoots: [{ projectId: 'project-1', memoryRoot: root }],
      globalRoot,
      apply: false,
      now: NOW
    })

    expect(result.dryRun).toBe(true)
    expect(result.projectRoots[0]?.promotedValidatedToProjectCore).toBe(1)
    await expect(readFile(join(root, 'semantic_memories.jsonl'), 'utf8')).resolves.toBe(beforeSemantic)
    await expect(readFile(join(root, 'activation_events.jsonl'), 'utf8')).resolves.toBe(beforeEvents)
    await expect(readFile(join(root, 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(root, 'MODEL_PROFILE.md'), 'utf8')).resolves.toBe('existing project profile\n')
    await expect(readFile(join(globalRoot, 'semantic_memories.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(globalRoot, 'MODEL_PROFILE.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('profile writer refuses unsafe MODEL_PROFILE.md symlink and directory targets', async () => {
    const symlinkRoot = await createTempDir('cyrene-weekly-profile-symlink-')
    const outside = await createTempDir('cyrene-weekly-profile-outside-')
    const outsideTarget = join(outside, 'outside.md')
    await writeFile(outsideTarget, 'outside original\n', 'utf8')
    await symlink(outsideTarget, join(symlinkRoot, 'MODEL_PROFILE.md'))

    await expect(writeLifecycleProfileFromCoreMemory({
      memoryRoot: symlinkRoot,
      scope: 'project',
      memories: [semanticMemory({ confidenceTier: 'project_core' })]
    })).rejects.toThrow(/projection.*symlink/)
    await expect(readFile(outsideTarget, 'utf8')).resolves.toBe('outside original\n')

    const directoryRoot = await createTempDir('cyrene-weekly-profile-directory-')
    await mkdir(join(directoryRoot, 'MODEL_PROFILE.md'))
    await expect(writeLifecycleProfileFromCoreMemory({
      memoryRoot: directoryRoot,
      scope: 'project',
      memories: [semanticMemory({ confidenceTier: 'project_core' })]
    })).rejects.toThrow(/non-file memory projection path/)
  })
})
