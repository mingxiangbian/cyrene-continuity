import { describe, expect, it } from 'vitest'
import { buildMemoryActivations } from '../src/codex/memory-activation.js'
import { activationPolicyForConfidenceTier } from '../src/memory/memory-lifecycle.js'
import type { CyreneMemory, SemanticMemory } from '../src/memory/types.js'

describe('buildMemoryActivations', () => {
  it('activates matching trial memory only as a workflow hint', () => {
    const output = buildMemoryActivations({
      query: 'runtime validator workflow',
      projectMemories: [
        createSemanticMemory({
          id: 'trial-memory',
          confidenceTier: 'trial',
          activationPolicy: activationPolicyForConfidenceTier('trial'),
          content: 'Runtime validator changes should start as workflow guidance.'
        })
      ],
      globalMemories: []
    })

    expect(output.workflowHints).toEqual([
      expect.objectContaining({
        memoryId: 'trial-memory',
        confidenceTier: 'trial',
        activationMode: 'workflow_hint',
        source: 'project',
        text: 'Runtime validator changes should start as workflow guidance.'
      })
    ])
    expect(output.planConstraints).toEqual([])
    expect(output.checklistItems).toEqual([])
  })

  it('activates matching validated memory as constraints and checklist items', () => {
    const output = buildMemoryActivations({
      query: 'runtime validator workflow',
      projectMemories: [
        createSemanticMemory({
          id: 'validated-memory',
          confidenceTier: 'validated',
          activationPolicy: activationPolicyForConfidenceTier('validated'),
          content: 'Runtime validator changes require lifecycle checks.'
        })
      ],
      globalMemories: []
    })

    expect(output.workflowHints).toEqual([])
    expect(output.planConstraints).toEqual([
      expect.objectContaining({
        memoryId: 'validated-memory',
        confidenceTier: 'validated',
        activationMode: 'plan_constraint',
        text: 'Plan constraint: Runtime validator changes require lifecycle checks.'
      })
    ])
    expect(output.checklistItems).toEqual([
      expect.objectContaining({
        memoryId: 'validated-memory',
        confidenceTier: 'validated',
        activationMode: 'checklist_item',
        text: 'Verify: Runtime validator changes require lifecycle checks.'
      })
    ])
  })

  it('ignores legacy active memory without v1.5 lifecycle fields', () => {
    const output = buildMemoryActivations({
      query: 'legacy validator workflow',
      projectMemories: [
        createLegacyMemory({
          id: 'legacy-memory',
          content: 'Legacy validator workflow memory must not activate.'
        })
      ],
      globalMemories: []
    })

    expect(output).toEqual(emptyOutput())
  })

  it('does not activate on common generic token overlap', () => {
    const output = buildMemoryActivations({
      query: 'write the test plan',
      projectMemories: [
        createSemanticMemory({
          id: 'generic-memory',
          confidenceTier: 'validated',
          activationPolicy: activationPolicyForConfidenceTier('validated'),
          content: 'The plan should include test notes.',
          useWhen: ['Writing a plan or test outline.']
        })
      ],
      globalMemories: []
    })

    expect(output).toEqual(emptyOutput())
  })

  it('suppresses activation when doNotUseWhen matches the query strongly', () => {
    const output = buildMemoryActivations({
      query: 'documentation-only runtime validator review',
      projectMemories: [
        createSemanticMemory({
          id: 'suppressed-memory',
          confidenceTier: 'validated',
          activationPolicy: activationPolicyForConfidenceTier('validated'),
          content: 'Runtime validator changes require lifecycle checks.',
          useWhen: ['Changing runtime validator behavior.'],
          doNotUseWhen: ['Documentation-only runtime validator review']
        })
      ],
      globalMemories: []
    })

    expect(output).toEqual(emptyOutput())
  })

  it('ignores invalid high-risk global_core memory and lifecycle policy drift', () => {
    const output = buildMemoryActivations({
      query: 'global validator workflow',
      projectMemories: [],
      globalMemories: [
        createSemanticMemory({
          id: 'high-risk-global-core',
          scope: 'global',
          domain: 'personal',
          module: 'preference',
          confidenceTier: 'global_core',
          activationPolicy: activationPolicyForConfidenceTier('global_core'),
          content: 'Global validator workflow should not activate from high-risk memory.',
          routing: {
            module: 'preference',
            updatePolicy: 'manual_only',
            risk: 'high',
            reasons: ['high sensitivity']
          },
          reviewState: {
            scores: {
              evidenceStrength: 0.9,
              stability: 0.9,
              usefulness: 0.9,
              safety: 0.7,
              sensitivity: 0.8
            }
          }
        }),
        createSemanticMemory({
          id: 'policy-drift-global-core',
          scope: 'global',
          confidenceTier: 'global_core',
          activationPolicy: activationPolicyForConfidenceTier('trial'),
          content: 'Global validator workflow should not activate with policy drift.'
        })
      ]
    })

    expect(output).toEqual(emptyOutput())
  })

  it('activates English technical memory from Chinese query aliases', () => {
    const output = buildMemoryActivations({
      query: '多智能体审查 仓库更新验证',
      projectMemories: [
        createSemanticMemory({
          id: 'multi-agent-review-memory',
          confidenceTier: 'trial',
          activationPolicy: activationPolicyForConfidenceTier('trial'),
          content: 'Use multi-agent review before high-risk repo update verification.',
          useWhen: ['multi-agent review for repo update verification']
        })
      ],
      globalMemories: []
    })

    expect(output.workflowHints).toEqual([
      expect.objectContaining({
        memoryId: 'multi-agent-review-memory',
        activationMode: 'workflow_hint'
      })
    ])
    expect(output.planConstraints).toEqual([])
    expect(output.checklistItems).toEqual([])
  })
})

function createSemanticMemory(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  return {
    id: 'semantic-memory',
    status: 'active',
    module: 'project_semantic',
    kind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    content: 'Runtime validator workflow guidance.',
    useWhen: ['Changing runtime activation validator behavior'],
    doNotUseWhen: ['The task is unrelated to runtime activation'],
    sourceOfTruth: 'test',
    evidence: [
      {
        id: 'evidence-1',
        sourceKind: 'file',
        sourceRef: 'test',
        when: '2026-06-01T00:00:00.000Z',
        whatHappened: 'Runtime activation behavior was validated.',
        whyImportant: 'The memory can guide future runtime activation work.'
      }
    ],
    routing: {
      module: 'project_semantic',
      updatePolicy: 'strict_auto_promote',
      risk: 'low',
      reasons: ['test memory']
    },
    reviewPolicy: 'strict_auto_promote',
    reviewState: {
      scores: {
        evidenceStrength: 0.9,
        stability: 0.9,
        usefulness: 0.9,
        safety: 0.95,
        sensitivity: 0.1
      }
    },
    confidenceTier: 'trial',
    activationPolicy: activationPolicyForConfidenceTier('trial'),
    supersedes: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }
}

function createLegacyMemory(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'legacy-memory',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Legacy active memory.',
    normalizedKey: 'legacy-active-memory',
    evidence: [{ runId: 'run-1', summary: 'Legacy memory.' }],
    source: 'file',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    tags: ['legacy'],
    ...overrides
  }
}

function emptyOutput() {
  return {
    workflowHints: [],
    planConstraints: [],
    checklistItems: []
  }
}
