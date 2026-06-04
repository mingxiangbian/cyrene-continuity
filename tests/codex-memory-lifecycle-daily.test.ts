import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contentHashForActiveMemory } from '../src/codex/active-memory-review.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { runCodexMemoryLifecycleDaily } from '../src/codex/codex-memory-lifecycle-daily.js'
import { recordCodexMemoryFeedback } from '../src/codex/memory-feedback.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { activationPolicyForConfidenceTier } from '../src/memory/memory-lifecycle.js'
import { semanticMemoryToActiveMemory } from '../src/memory/semantic-memory-adapter.js'
import {
  appendActivationEventFromRoot,
  appendMemoryEventFromRoot,
  readMemoryEventsFromRoot,
  readSemanticMemoriesFromRoot,
  writeSemanticMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type { ActivationEvent, MemoryEvent, SemanticMemory } from '../src/memory/types.js'

const tempDirs: string[] = []
const originalHome = process.env.HOME

beforeEach(() => {
  vi.stubEnv('CYRENE_AUTO_REVIEW_PROJECT_PROMOTE_PER_DAY', '')
  vi.stubEnv('CYRENE_AUTO_REVIEW_GLOBAL_PROMOTE_PER_DAY', '')
})

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

function trialMemory(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  return semanticMemory({
    id: 'trial-1',
    status: 'active',
    scope: 'project',
    confidenceTier: 'trial',
    activationPolicy: activationPolicyForConfidenceTier('trial'),
    ...overrides
  })
}

function globalCandidate(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  return semanticMemory({
    id: 'global-candidate-1',
    status: 'pending',
    module: 'procedural',
    kind: 'user_instruction',
    scope: 'global',
    domain: 'procedural',
    content: 'Across projects, keep generated runtime files out of manual edits.',
    useWhen: ['Working in any repository with generated runtime artifacts'],
    doNotUseWhen: ['The user explicitly asks to regenerate runtime artifacts'],
    sourceOfTruth: 'user_prompt:2026-06-03',
    reviewPolicy: 'strict_auto_promote',
    reviewState: {
      normalizedKey: 'global-no-manual-runtime-edits',
      type: 'procedural_rule',
      strength: 'hard',
      source: 'user_explicit',
      scores: {
        evidenceStrength: 0.95,
        stability: 0.9,
        usefulness: 0.9,
        safety: 0.98,
        sensitivity: 0.03
      },
      tags: ['global_policy'],
      userConfirmed: true
    },
    evidence: [
      {
        id: 'global-evidence-1',
        sourceKind: 'user_explicit',
        sourceRef: 'prompt:1',
        when: '2026-06-03T00:00:00.000Z',
        whatHappened: 'User explicitly set a global runtime-editing boundary.',
        whyImportant: 'The rule applies procedurally across projects.'
      },
      {
        id: 'global-evidence-2',
        sourceKind: 'review_event',
        sourceRef: 'review:1',
        when: '2026-06-03T01:00:00.000Z',
        whatHappened: 'A reviewed workflow repeated the runtime-editing boundary.',
        whyImportant: 'Repeated explicit evidence supports a narrow global core rule.'
      }
    ],
    ...overrides
  })
}

function semanticMemory(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  return {
    id: 'memory-1',
    status: 'active',
    module: 'procedural',
    kind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    content: 'Chunk long review summaries before retrying.',
    useWhen: ['Review summary generation'],
    doNotUseWhen: ['Short summaries'],
    sourceOfTruth: 'review_summary:task-1',
    evidence: [
      {
        id: 'evidence-1',
        sourceKind: 'review_event',
        sourceRef: 'review:1',
        when: '2026-06-02T00:00:00.000Z',
        whatHappened: 'Timeout happened while generating a long review summary.',
        whyImportant: 'Chunking prevents repeated failures.'
      },
      {
        id: 'evidence-2',
        sourceKind: 'tool_trace',
        sourceRef: 'trace:1',
        when: '2026-06-02T01:00:00.000Z',
        whatHappened: 'A later run used chunking successfully.',
        whyImportant: 'Independent evidence supports promoting the workflow rule.'
      }
    ],
    routing: {
      module: 'procedural',
      updatePolicy: 'strict_auto_promote',
      risk: 'low',
      reasons: ['low-risk procedural workflow']
    },
    reviewPolicy: 'strict_auto_promote',
    reviewState: {
      normalizedKey: 'chunk-long-review-summaries',
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
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

async function appendAppliedEvents(root: string, memoryId = 'trial-1'): Promise<void> {
  await appendActivationEventFromRoot(root, activationEvent({ id: 'activation-1', memoryId, event: 'applied', createdAt: '2026-06-02T00:00:00.000Z' }))
  await appendActivationEventFromRoot(root, activationEvent({ id: 'activation-2', memoryId, event: 'applied', createdAt: '2026-06-03T00:00:00.000Z' }))
}

function activationEvent(overrides: Partial<ActivationEvent>): ActivationEvent {
  return {
    id: 'activation-event',
    memoryId: 'trial-1',
    event: 'applied',
    projectId: 'project-1',
    createdAt: '2026-06-03T00:00:00.000Z',
    ...overrides
  }
}

function promoteEvent(overrides: Partial<MemoryEvent> = {}): MemoryEvent {
  return {
    id: 'promote-event',
    action: 'promote',
    at: '2026-06-03T00:00:00.000Z',
    reason: 'existing auto-promotion',
    details: {
      decision: 'auto_promote',
      policyId: 'low_risk_project_memory_v1'
    },
    ...overrides
  }
}

describe('daily memory lifecycle automation', () => {
  it('promotes low-risk project trial to validated after two applied events', async () => {
    const root = await createTempDir('cyrene-daily-project-root-')
    await writeSemanticMemoriesFromRoot(root, [trialMemory()])
    await appendAppliedEvents(root)

    const result = await runCodexMemoryLifecycleDaily({
      projectRoots: [{ projectId: 'project-1', memoryRoot: root }],
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    expect(result).toMatchObject({ action: 'memory_lifecycle_daily', dryRun: false })
    expect(result.roots[0]).toMatchObject({
      projectId: 'project-1',
      promotedTrialToValidated: 1,
      recommendations: 0,
      evalFailures: 0
    })
    expect(await readSemanticMemoriesFromRoot(root)).toEqual([
      expect.objectContaining({
        id: 'trial-1',
        confidenceTier: 'validated',
        activationPolicy: activationPolicyForConfidenceTier('validated'),
        updatedAt: '2026-06-03T00:00:00.000Z'
      })
    ])
    const promote = (await readMemoryEventsFromRoot(root)).find((event) => event.action === 'promote')
    expect(promote).toMatchObject({
      memoryId: 'trial-1',
      details: {
        decision: 'auto_promote',
        policyId: 'low_risk_project_memory_v1',
        lifecyclePolicyId: 'daily_trial_validation_v1',
        previousConfidenceTier: 'trial',
        confidenceTier: 'validated',
        evidenceCount: 2,
        distinctEvidenceCount: 2,
        appliedEvents: 2,
        capStatus: {
          scope: 'project',
          usedToday: 0,
          dailyCap: 5
        },
        evalGate: {
          passed: true,
          failedChecks: []
        }
      }
    })
  })

  it('promotes trial memory from public applied feedback while ignored is neutral and corrected blocks', async () => {
    const home = await createTempDir('cyrene-daily-feedback-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-daily-feedback-project-')
    const project = await identifyCodexProject(cwd)
    const root = codexProjectMemoryRoot(project.projectId)
    const promote = trialMemory({ id: 'trial-feedback-promote' })
    const ignored = trialMemory({ id: 'trial-feedback-ignored' })
    const corrected = trialMemory({ id: 'trial-feedback-corrected' })
    await writeSemanticMemoriesFromRoot(root, [promote, ignored, corrected])

    await recordCodexMemoryFeedback({
      cwd,
      memoryId: promote.id,
      contentHash: contentHashForActiveMemory(semanticMemoryToActiveMemory(promote)),
      event: 'applied',
      evidenceRef: 'session:1',
      now: '2026-06-03T00:00:00.000Z'
    })
    await recordCodexMemoryFeedback({
      cwd,
      memoryId: promote.id,
      contentHash: contentHashForActiveMemory(semanticMemoryToActiveMemory(promote)),
      event: 'applied',
      evidenceRef: 'session:2',
      now: '2026-06-03T00:01:00.000Z'
    })
    await recordCodexMemoryFeedback({
      cwd,
      memoryId: ignored.id,
      contentHash: contentHashForActiveMemory(semanticMemoryToActiveMemory(ignored)),
      event: 'ignored',
      evidenceRef: 'session:3',
      now: '2026-06-03T00:02:00.000Z'
    })
    await recordCodexMemoryFeedback({
      cwd,
      memoryId: corrected.id,
      contentHash: contentHashForActiveMemory(semanticMemoryToActiveMemory(corrected)),
      event: 'applied',
      evidenceRef: 'session:4',
      now: '2026-06-03T00:03:00.000Z'
    })
    await recordCodexMemoryFeedback({
      cwd,
      memoryId: corrected.id,
      contentHash: contentHashForActiveMemory(semanticMemoryToActiveMemory(corrected)),
      event: 'applied',
      evidenceRef: 'session:5',
      now: '2026-06-03T00:04:00.000Z'
    })
    await recordCodexMemoryFeedback({
      cwd,
      memoryId: corrected.id,
      contentHash: contentHashForActiveMemory(semanticMemoryToActiveMemory(corrected)),
      event: 'corrected',
      reason: 'The memory was too broad.',
      evidenceRef: 'session:6',
      now: '2026-06-03T00:05:00.000Z'
    })

    const result = await runCodexMemoryLifecycleDaily({
      projectRoots: [{ projectId: project.projectId, memoryRoot: root }],
      apply: true,
      now: '2026-06-03T12:00:00.000Z'
    })

    expect(result.roots[0]).toMatchObject({ promotedTrialToValidated: 1, recommendations: 1 })
    const memories = await readSemanticMemoriesFromRoot(root)
    expect(memories.find((memory) => memory.id === promote.id)).toMatchObject({ confidenceTier: 'validated' })
    expect(memories.find((memory) => memory.id === ignored.id)).toMatchObject({ confidenceTier: 'trial' })
    expect(memories.find((memory) => memory.id === corrected.id)).toMatchObject({ confidenceTier: 'trial' })
  })

  it('blocks promotion and writes recommendation audit when corrected or violated feedback exists', async () => {
    const root = await createTempDir('cyrene-daily-negative-root-')
    await writeSemanticMemoriesFromRoot(root, [trialMemory()])
    await appendAppliedEvents(root)
    await appendActivationEventFromRoot(root, activationEvent({
      id: 'activation-corrected',
      event: 'corrected',
      createdAt: '2026-06-03T00:00:01.000Z'
    }))

    const result = await runCodexMemoryLifecycleDaily({
      projectRoots: [{ projectId: 'project-1', memoryRoot: root }],
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    expect(result.roots[0]).toMatchObject({
      promotedTrialToValidated: 0,
      recommendations: 1
    })
    expect((await readSemanticMemoriesFromRoot(root))[0]).toMatchObject({ confidenceTier: 'trial' })
    const audit = (await readMemoryEventsFromRoot(root)).find((event) => event.action === 'audit')
    expect(audit).toMatchObject({
      memoryId: 'trial-1',
      details: {
        lifecyclePolicyId: 'daily_trial_validation_v1',
        reason: 'negative activation feedback blocks auto-promotion',
        appliedEvents: 2,
        correctedEvents: 1,
        violatedEvents: 0
      }
    })
  })

  it('archives stale project trial memory with an expire event instead of promoting it', async () => {
    const root = await createTempDir('cyrene-daily-stale-root-')
    await writeSemanticMemoriesFromRoot(root, [trialMemory({ expiresAt: '2026-06-03T00:00:00.000Z' })])
    await appendAppliedEvents(root)

    const result = await runCodexMemoryLifecycleDaily({
      projectRoots: [{ projectId: 'project-1', memoryRoot: root }],
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    expect(result.roots[0]).toMatchObject({
      promotedTrialToValidated: 0,
      staleTrials: 1
    })
    expect((await readSemanticMemoriesFromRoot(root))[0]).toMatchObject({
      id: 'trial-1',
      status: 'archived',
      confidenceTier: 'trial'
    })
    expect((await readMemoryEventsFromRoot(root)).find((event) => event.action === 'expire')).toMatchObject({
      memoryId: 'trial-1',
      details: {
        lifecyclePolicyId: 'daily_trial_validation_v1',
        expiresAt: '2026-06-03T00:00:00.000Z'
      }
    })
  })

  it('prevents additional auto-promotions when the daily project cap is exhausted', async () => {
    const root = await createTempDir('cyrene-daily-cap-root-')
    await writeSemanticMemoriesFromRoot(root, [trialMemory()])
    await appendAppliedEvents(root)
    for (let index = 0; index < 5; index += 1) {
      await appendMemoryEventFromRoot(root, promoteEvent({ id: `existing-promote-${index}` }))
    }

    const result = await runCodexMemoryLifecycleDaily({
      projectRoots: [{ projectId: 'project-1', memoryRoot: root }],
      apply: true,
      now: '2026-06-03T12:00:00.000Z'
    })

    expect(result.roots[0]).toMatchObject({
      promotedTrialToValidated: 0,
      recommendations: 1,
      evalFailures: 1,
      capExhausted: 1
    })
    expect((await readSemanticMemoriesFromRoot(root))[0]).toMatchObject({ confidenceTier: 'trial' })
    const events = await readMemoryEventsFromRoot(root)
    expect(events.filter((event) => event.action === 'promote')).toHaveLength(5)
    expect(events.find((event) => event.action === 'audit' && event.memoryId === 'trial-1')).toMatchObject({
      details: {
        reason: 'daily auto-promotion cap exhausted',
        capStatus: {
          scope: 'project',
          usedToday: 5,
          dailyCap: 5
        }
      }
    })
  })

  it('promotes only low-risk explicit global candidates to global_core when global root is included', async () => {
    const home = await createTempDir('cyrene-daily-global-home-')
    vi.stubEnv('HOME', home)
    const globalRoot = codexGlobalMemoryRoot()
    await mkdir(globalRoot, { recursive: true })
    await writeSemanticMemoriesFromRoot(globalRoot, [
      globalCandidate({ id: 'global-low-risk' }),
      globalCandidate({
        id: 'global-project-domain',
        domain: 'project',
        scope: 'global',
        content: 'A project-domain candidate must not become global core.',
        reviewState: {
          ...globalCandidate().reviewState,
          normalizedKey: 'global-project-domain'
        }
      })
    ])

    const result = await runCodexMemoryLifecycleDaily({
      projectRoots: [],
      includeGlobalRoot: true,
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    const globalResult = result.roots.find((rootResult) => rootResult.scope === 'global')
    expect(globalResult).toMatchObject({
      promotedExplicitGlobalToCore: 1,
      recommendations: 1
    })
    const semantic = await readSemanticMemoriesFromRoot(globalRoot)
    expect(semantic.find((memory) => memory.id === 'global-low-risk')).toMatchObject({
      status: 'active',
      confidenceTier: 'global_core',
      activationPolicy: activationPolicyForConfidenceTier('global_core')
    })
    const projectDomainCandidate = semantic.find((memory) => memory.id === 'global-project-domain')
    expect(projectDomainCandidate).toMatchObject({ status: 'pending' })
    expect(projectDomainCandidate?.confidenceTier).toBeUndefined()
    expect(semantic.some((memory) => memory.scope === 'global' && (
      memory.confidenceTier === 'trial' || memory.confidenceTier === 'validated'
    ))).toBe(false)
    expect((await readMemoryEventsFromRoot(globalRoot)).find((event) =>
      event.action === 'promote' && event.memoryId === 'global-low-risk'
    )).toMatchObject({
      details: {
        policyId: 'low_risk_global_procedural_v1',
        lifecyclePolicyId: 'daily_explicit_global_core_v1',
        confidenceTier: 'global_core'
      }
    })
  })

  it('recommends review-derived global candidates instead of auto-promoting them during daily processing', async () => {
    const home = await createTempDir('cyrene-daily-review-global-home-')
    vi.stubEnv('HOME', home)
    const globalRoot = codexGlobalMemoryRoot()
    await mkdir(globalRoot, { recursive: true })
    await writeSemanticMemoriesFromRoot(globalRoot, [
      globalCandidate({
        id: 'global-review-derived',
        sourceOfTruth: 'review_summary:task-1',
        reviewState: {
          ...globalCandidate().reviewState,
          normalizedKey: 'global-review-derived',
          source: 'review_event'
        },
        evidence: [
          {
            id: 'review-evidence-1',
            sourceKind: 'review_event',
            sourceRef: 'review:1',
            when: '2026-06-03T00:00:00.000Z',
            whatHappened: 'A review summary suggested a global procedural pattern.',
            whyImportant: 'Review-derived candidates must remain recommendation-only in daily processing.'
          },
          {
            id: 'review-evidence-2',
            sourceKind: 'review_event',
            sourceRef: 'review:2',
            when: '2026-06-03T01:00:00.000Z',
            whatHappened: 'Another review event repeated the same global procedural pattern.',
            whyImportant: 'Repeated review events are still not explicit user evidence.'
          }
        ]
      })
    ])

    const result = await runCodexMemoryLifecycleDaily({
      projectRoots: [],
      includeGlobalRoot: true,
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    expect(result.roots.find((rootResult) => rootResult.scope === 'global')).toMatchObject({
      promotedExplicitGlobalToCore: 0,
      recommendations: 1
    })
    expect((await readSemanticMemoriesFromRoot(globalRoot))[0]).toMatchObject({
      id: 'global-review-derived',
      status: 'pending'
    })
    expect((await readMemoryEventsFromRoot(globalRoot)).find((event) => event.action === 'audit')).toMatchObject({
      candidateId: 'global-review-derived',
      details: {
        reason: 'high-risk or ambiguous global candidate requires manual review',
        source: 'review_event'
      }
    })
  })

  it('does not let reviewState.source spoof explicit global user evidence', async () => {
    const home = await createTempDir('cyrene-daily-spoof-global-home-')
    vi.stubEnv('HOME', home)
    const globalRoot = codexGlobalMemoryRoot()
    await mkdir(globalRoot, { recursive: true })
    await writeSemanticMemoriesFromRoot(globalRoot, [
      globalCandidate({
        id: 'global-spoofed-explicit',
        sourceOfTruth: 'review_summary:task-1',
        reviewState: {
          ...globalCandidate().reviewState,
          normalizedKey: 'global-spoofed-explicit',
          source: 'user_explicit'
        },
        evidence: [
          {
            id: 'review-evidence-1',
            sourceKind: 'review_event',
            sourceRef: 'review:1',
            when: '2026-06-03T00:00:00.000Z',
            whatHappened: 'A review summary carried this candidate.',
            whyImportant: 'The evidence is not an explicit user instruction.'
          },
          {
            id: 'review-evidence-2',
            sourceKind: 'review_event',
            sourceRef: 'review:2',
            when: '2026-06-03T01:00:00.000Z',
            whatHappened: 'A second review event repeated the candidate.',
            whyImportant: 'reviewState.source alone must not prove explicitness.'
          }
        ]
      })
    ])

    const result = await runCodexMemoryLifecycleDaily({
      projectRoots: [],
      includeGlobalRoot: true,
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    expect(result.roots.find((rootResult) => rootResult.scope === 'global')).toMatchObject({
      promotedExplicitGlobalToCore: 0,
      recommendations: 1
    })
    expect((await readSemanticMemoriesFromRoot(globalRoot))[0]).toMatchObject({
      id: 'global-spoofed-explicit',
      status: 'pending'
    })
    expect((await readMemoryEventsFromRoot(globalRoot)).some((event) => event.action === 'promote')).toBe(false)
  })

  it('uses the configured global cap so the default cap blocks a second same-day global promotion', async () => {
    const home = await createTempDir('cyrene-daily-global-cap-home-')
    vi.stubEnv('HOME', home)
    const globalRoot = codexGlobalMemoryRoot()
    await mkdir(globalRoot, { recursive: true })
    await writeSemanticMemoriesFromRoot(globalRoot, [globalCandidate({ id: 'global-after-cap' })])
    await appendMemoryEventFromRoot(globalRoot, promoteEvent({
      id: 'existing-global-promote',
      details: {
        decision: 'auto_promote',
        policyId: 'low_risk_global_procedural_v1'
      }
    }))

    const result = await runCodexMemoryLifecycleDaily({
      projectRoots: [],
      includeGlobalRoot: true,
      apply: true,
      now: '2026-06-03T12:00:00.000Z'
    })

    expect(result.roots.find((rootResult) => rootResult.scope === 'global')).toMatchObject({
      promotedExplicitGlobalToCore: 0,
      recommendations: 1,
      evalFailures: 1,
      capExhausted: 1
    })
    expect((await readSemanticMemoriesFromRoot(globalRoot))[0]).toMatchObject({
      id: 'global-after-cap',
      status: 'pending'
    })
    expect((await readMemoryEventsFromRoot(globalRoot)).find((event) =>
      event.action === 'audit' && event.candidateId === 'global-after-cap'
    )).toMatchObject({
      details: {
        reason: 'daily auto-promotion cap exhausted',
        capStatus: {
          scope: 'global',
          usedToday: 1,
          dailyCap: 1
        }
      }
    })
  })

  it('recommends high-risk global candidates without writing global core or profile memory', async () => {
    const home = await createTempDir('cyrene-daily-high-risk-global-home-')
    vi.stubEnv('HOME', home)
    const globalRoot = codexGlobalMemoryRoot()
    await mkdir(globalRoot, { recursive: true })
    await writeSemanticMemoriesFromRoot(globalRoot, [
      globalCandidate({
        id: 'global-affective',
        module: 'relationship_affective',
        kind: 'user_instruction',
        domain: 'affective',
        content: 'Remember the user has a fixed emotional pattern in every project.',
        reviewState: {
          ...globalCandidate().reviewState,
          normalizedKey: 'global-affective',
          type: 'affective_pattern',
          source: 'user_explicit',
          scores: {
            evidenceStrength: 0.95,
            stability: 0.9,
            usefulness: 0.9,
            safety: 0.72,
            sensitivity: 0.8
          }
        }
      })
    ])

    const result = await runCodexMemoryLifecycleDaily({
      projectRoots: [],
      includeGlobalRoot: true,
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    const globalResult = result.roots.find((rootResult) => rootResult.scope === 'global')
    expect(globalResult).toMatchObject({
      promotedExplicitGlobalToCore: 0,
      recommendations: 1
    })
    const semantic = await readSemanticMemoriesFromRoot(globalRoot)
    expect(semantic[0]).toMatchObject({
      id: 'global-affective',
      status: 'pending'
    })
    expect(semantic[0]?.confidenceTier).toBeUndefined()
    expect(semantic.some((memory) => memory.confidenceTier === 'global_core')).toBe(false)
    expect(semantic.some((memory) => memory.reviewState?.profileVisibility === 'always')).toBe(false)
    expect((await readMemoryEventsFromRoot(globalRoot)).find((event) => event.action === 'audit')).toMatchObject({
      candidateId: 'global-affective',
      details: {
        lifecyclePolicyId: 'daily_explicit_global_core_v1',
        reason: 'high-risk or ambiguous global candidate requires manual review'
      }
    })
  })

  it('does not mutate memories or lifecycle events during dry-run', async () => {
    const root = await createTempDir('cyrene-daily-dry-run-root-')
    const original = trialMemory()
    await writeSemanticMemoriesFromRoot(root, [original])
    await appendAppliedEvents(root)

    const result = await runCodexMemoryLifecycleDaily({
      projectRoots: [{ projectId: 'project-1', memoryRoot: root }],
      apply: false,
      now: '2026-06-03T00:00:00.000Z'
    })

    expect(result).toMatchObject({ dryRun: true })
    expect(result.roots[0]).toMatchObject({ promotedTrialToValidated: 1 })
    expect(await readSemanticMemoriesFromRoot(root)).toEqual([original])
    expect(await readMemoryEventsFromRoot(root)).toEqual([])
  })

  it('reports v1.5-invalid active memories as needing migration without normalizing them', async () => {
    const root = await createTempDir('cyrene-daily-invalid-root-')
    const invalidActive = semanticMemory({
      id: 'invalid-active',
      status: 'active',
      confidenceTier: undefined,
      activationPolicy: undefined
    })
    await writeSemanticMemoriesFromRoot(root, [invalidActive])

    const result = await runCodexMemoryLifecycleDaily({
      projectRoots: [{ projectId: 'project-1', memoryRoot: root }],
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    expect(result.roots[0]).toMatchObject({
      invalidMemories: 1,
      needsMigration: 1,
      promotedTrialToValidated: 0
    })
    expect(await readSemanticMemoriesFromRoot(root)).toEqual([invalidActive])
    expect((await readMemoryEventsFromRoot(root)).find((event) => event.action === 'audit')).toMatchObject({
      memoryId: 'invalid-active',
      details: {
        reason: 'needs_migration',
        findings: [
          'active memory is missing confidenceTier',
          'active memory is missing activationPolicy'
        ]
      }
    })
  })

  it('skips malformed semantic JSONL during apply and leaves file bytes unchanged', async () => {
    const root = await createTempDir('cyrene-daily-malformed-root-')
    const semanticPath = join(root, 'semantic_memories.jsonl')
    const original = `${JSON.stringify(trialMemory())}\n{bad json}\n`
    await writeFile(semanticPath, original, 'utf8')
    await appendAppliedEvents(root)

    const result = await runCodexMemoryLifecycleDaily({
      projectRoots: [{ projectId: 'project-1', memoryRoot: root }],
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    expect(result.roots[0]).toMatchObject({
      promotedTrialToValidated: 0,
      invalidMemories: 1,
      needsMigration: 1
    })
    await expect(readFile(semanticPath, 'utf8')).resolves.toBe(original)
    expect(await readMemoryEventsFromRoot(root)).toEqual([])
  })

  it('does not write promoted state when the promotion receipt cannot be written', async () => {
    const root = await createTempDir('cyrene-daily-receipt-failure-root-')
    await writeSemanticMemoriesFromRoot(root, [trialMemory()])
    await appendAppliedEvents(root)
    await mkdir(join(root, 'events.jsonl'))

    await expect(runCodexMemoryLifecycleDaily({
      projectRoots: [{ projectId: 'project-1', memoryRoot: root }],
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })).rejects.toThrow('Refusing to use non-file memory data path')

    expect((await readSemanticMemoriesFromRoot(root))[0]).toMatchObject({
      id: 'trial-1',
      confidenceTier: 'trial'
    })
  })
})
