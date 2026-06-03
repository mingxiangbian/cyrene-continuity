import type {
  ActivationPolicy,
  ConfidenceTier,
  SemanticMemory
} from './types.js'

const LOW_RISK_DOMAINS = new Set<string>(['project', 'procedural', 'system'])
const LOW_RISK_MODULES = new Set<string>(['project_semantic', 'procedural', 'system', 'global_policy'])
const NEGATIVE_EVENT_TYPES = new Set<string>(['corrected', 'violated'])

export function activationPolicyForConfidenceTier(tier: ConfidenceTier): ActivationPolicy {
  if (tier === 'trial') {
    return { allowedModes: ['workflow_hint'], maxRuntimeStrength: 'hint' }
  }
  if (tier === 'validated') {
    return { allowedModes: ['workflow_hint', 'plan_constraint', 'checklist_item'], maxRuntimeStrength: 'checklist' }
  }
  return { allowedModes: ['workflow_hint', 'plan_constraint', 'checklist_item'], maxRuntimeStrength: 'profile' }
}

export function validateSemanticMemoryLifecycle(memory: SemanticMemory): string[] {
  const findings: string[] = []
  if (memory.status !== 'active') {
    return findings
  }
  if (memory.confidenceTier === undefined) {
    findings.push('active memory is missing confidenceTier')
  }
  if (memory.activationPolicy === undefined) {
    findings.push('active memory is missing activationPolicy')
  }
  if (memory.scope === 'global' && memory.confidenceTier !== undefined && memory.confidenceTier !== 'global_core') {
    findings.push('global memory must use confidenceTier global_core')
  }
  if (memory.scope === 'project' && memory.confidenceTier === 'global_core') {
    findings.push('project memory cannot use confidenceTier global_core')
  }
  if (memory.confidenceTier === 'trial' && memory.activationPolicy?.allowedModes.some((mode) => mode !== 'workflow_hint')) {
    findings.push('trial memory can only allow workflow_hint activation')
  }
  if ((memory.confidenceTier === 'project_core' || memory.confidenceTier === 'global_core') && memory.evidence.length === 0) {
    findings.push('core memory requires evidence')
  }
  if (memory.confidenceTier === 'global_core' && !isLowRiskLifecycleMemory(memory)) {
    findings.push('global_core memory must be low risk')
  }
  return findings
}

export function isRuntimeActivatableSemanticMemory(memory: SemanticMemory): boolean {
  return memory.status === 'active' && validateSemanticMemoryLifecycle(memory).length === 0
}

export function isLowRiskLifecycleMemory(memory: SemanticMemory): boolean {
  const scores = memory.reviewState?.scores
  return (
    LOW_RISK_DOMAINS.has(memory.domain) &&
    LOW_RISK_MODULES.has(memory.module) &&
    (scores?.sensitivity ?? 0.2) <= 0.35 &&
    (scores?.safety ?? 0.9) >= 0.8
  )
}

export function isNegativeActivationEventType(event: string): boolean {
  return NEGATIVE_EVENT_TYPES.has(event)
}
