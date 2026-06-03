import { describe, expect, it } from 'vitest'
import {
  activationPolicyForConfidenceTier,
  isNegativeActivationEventType,
  isRuntimeActivatableSemanticMemory,
  isLowRiskLifecycleMemory,
  validateSemanticMemoryLifecycle
} from '../src/memory/memory-lifecycle.js'
import type { SemanticMemory } from '../src/memory/types.js'

function semanticMemory(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  return {
    id: 'memory-1',
    status: 'active',
    module: 'procedural',
    kind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    content: 'Run runtime verification before declaring implementation complete.',
    useWhen: ['Finishing implementation work'],
    doNotUseWhen: ['Documentation-only review without completion claim'],
    evidence: [{
      id: 'evidence-1',
      sourceKind: 'review_event',
      sourceRef: 'review:1',
      when: '2026-06-03T00:00:00.000Z',
      whatHappened: 'Completion was previously declared before user-visible verification.',
      whyImportant: 'The rule changes future agent behavior.'
    }],
    reviewPolicy: 'pending_review',
    supersedes: [],
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    confidenceTier: 'trial',
    activationPolicy: activationPolicyForConfidenceTier('trial'),
    ...overrides
  }
}

describe('v1.5 semantic memory lifecycle contract', () => {
  it('allows project trial memory to activate only as workflow hints', () => {
    const memory = semanticMemory({ confidenceTier: 'trial', activationPolicy: activationPolicyForConfidenceTier('trial') })

    expect(validateSemanticMemoryLifecycle(memory)).toEqual([])
    expect(memory.activationPolicy?.allowedModes).toEqual(['workflow_hint'])
    expect(isRuntimeActivatableSemanticMemory(memory)).toBe(true)
  })

  it('allows validated and project_core project memory to create constraints and checklist items', () => {
    const validated = semanticMemory({
      confidenceTier: 'validated',
      activationPolicy: activationPolicyForConfidenceTier('validated')
    })
    const core = semanticMemory({
      confidenceTier: 'project_core',
      activationPolicy: activationPolicyForConfidenceTier('project_core')
    })

    expect(validated.activationPolicy?.allowedModes).toEqual(['workflow_hint', 'plan_constraint', 'checklist_item'])
    expect(core.activationPolicy?.maxRuntimeStrength).toBe('profile')
    expect(validateSemanticMemoryLifecycle(validated)).toEqual([])
    expect(validateSemanticMemoryLifecycle(core)).toEqual([])
  })

  it('maps global_core memory to profile-strength constraints and checklist items', () => {
    const policy = activationPolicyForConfidenceTier('global_core')

    expect(policy).toEqual({
      allowedModes: ['workflow_hint', 'plan_constraint', 'checklist_item'],
      maxRuntimeStrength: 'profile'
    })
  })

  it('rejects global trial and global validated combinations', () => {
    expect(validateSemanticMemoryLifecycle(semanticMemory({
      scope: 'global',
      confidenceTier: 'trial',
      activationPolicy: activationPolicyForConfidenceTier('trial')
    }))).toContain('global memory must use confidenceTier global_core')

    expect(validateSemanticMemoryLifecycle(semanticMemory({
      scope: 'global',
      confidenceTier: 'validated',
      activationPolicy: activationPolicyForConfidenceTier('validated')
    }))).toContain('global memory must use confidenceTier global_core')
  })

  it('rejects project memory using global_core confidence', () => {
    expect(validateSemanticMemoryLifecycle(semanticMemory({
      scope: 'project',
      confidenceTier: 'global_core',
      activationPolicy: activationPolicyForConfidenceTier('global_core')
    }))).toContain('project memory cannot use confidenceTier global_core')
  })

  it('rejects core memory without evidence', () => {
    expect(validateSemanticMemoryLifecycle(semanticMemory({
      confidenceTier: 'project_core',
      activationPolicy: activationPolicyForConfidenceTier('project_core'),
      evidence: []
    }))).toContain('core memory requires evidence')

    expect(validateSemanticMemoryLifecycle(semanticMemory({
      scope: 'global',
      confidenceTier: 'global_core',
      activationPolicy: activationPolicyForConfidenceTier('global_core'),
      evidence: []
    }))).toContain('core memory requires evidence')
  })

  it('rejects trial memory with non-workflow_hint activation modes', () => {
    expect(validateSemanticMemoryLifecycle(semanticMemory({
      confidenceTier: 'trial',
      activationPolicy: {
        allowedModes: ['workflow_hint', 'plan_constraint'],
        maxRuntimeStrength: 'hint'
      }
    }))).toContain('trial memory can only allow workflow_hint activation')
  })

  it('rejects high-risk global_core memory', () => {
    expect(validateSemanticMemoryLifecycle(semanticMemory({
      scope: 'global',
      confidenceTier: 'global_core',
      activationPolicy: activationPolicyForConfidenceTier('global_core'),
      routing: {
        module: 'procedural',
        updatePolicy: 'pending_review',
        risk: 'high',
        reasons: ['high-risk global memory requires explicit review']
      }
    }))).toContain('global_core memory must be low risk')
  })

  it('does not activate active memory that lacks explicit v1.5 tier or policy', () => {
    const memory = semanticMemory({ confidenceTier: undefined, activationPolicy: undefined })

    expect(validateSemanticMemoryLifecycle(memory)).toEqual(expect.arrayContaining([
      'active memory is missing confidenceTier',
      'active memory is missing activationPolicy'
    ]))
    expect(isRuntimeActivatableSemanticMemory(memory)).toBe(false)
  })

  it('classifies low-risk lifecycle memory conservatively', () => {
    expect(isLowRiskLifecycleMemory(semanticMemory())).toBe(true)
    expect(isLowRiskLifecycleMemory(semanticMemory({ domain: 'relationship', module: 'relationship_affective' }))).toBe(false)
    expect(isLowRiskLifecycleMemory(semanticMemory({
      routing: { module: 'procedural', updatePolicy: 'pending_review', risk: 'medium', reasons: [] }
    }))).toBe(false)
    expect(isLowRiskLifecycleMemory(semanticMemory({
      reviewState: { scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.8, safety: 0.9, sensitivity: 0.7 } }
    }))).toBe(false)
  })

  it('recognizes negative activation event types', () => {
    expect(isNegativeActivationEventType('corrected')).toBe(true)
    expect(isNegativeActivationEventType('violated')).toBe(true)
    expect(isNegativeActivationEventType('applied')).toBe(false)
  })
})
