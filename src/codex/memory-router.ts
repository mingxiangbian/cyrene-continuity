import type {
  AdmissionDecision,
  CandidateDraft,
  MemoryModule,
  ReviewDecision,
  RoutedMemoryTarget,
  SemanticMemory,
  StructuredEvidence
} from '../memory/types.js'

export function routeCandidateDraft(input: {
  draft: CandidateDraft
  admission: AdmissionDecision
}): RoutedMemoryTarget {
  const module = moduleForDraft(input.draft, input.admission)
  const risk = riskForDraft(input.draft, input.admission)
  const updatePolicy = updatePolicyForRoute(input.draft, input.admission, module, risk)
  return {
    module,
    updatePolicy,
    risk,
    reasons: routingReasons(input.draft, input.admission, module, risk, updatePolicy)
  }
}

export function semanticCandidateFromDraft(input: {
  draft: CandidateDraft
  admission: AdmissionDecision
  route: RoutedMemoryTarget
  now: string
}): SemanticMemory {
  const normalizedKey = input.draft.normalizedKey ?? input.draft.id
  return {
    id: `semantic-${input.draft.id}`,
    status: 'candidate',
    module: input.route.module,
    kind: input.draft.candidateKind,
    scope: input.draft.scope,
    domain: input.draft.domain,
    content: input.draft.content,
    useWhen: [`Future task matches ${normalizedKey}`],
    doNotUseWhen: [
      input.draft.sourceOfTruth === undefined
        ? 'The evidence no longer supports this memory'
        : `The source of truth no longer says ${input.draft.sourceOfTruth}`
    ],
    ...(input.draft.sourceOfTruth === undefined ? {} : { sourceOfTruth: input.draft.sourceOfTruth }),
    evidence: structuredEvidenceForDraft(input.draft, input.admission, input.now),
    routing: input.route,
    reviewPolicy: input.route.updatePolicy,
    reviewState: {
      ...(input.draft.normalizedKey === undefined ? {} : { normalizedKey: input.draft.normalizedKey }),
      admittedBy: 'admission_gate_v1',
      admissionScore: input.admission.admissionScore,
      admissionReasons: input.admission.reasons,
      sourceEpisodeIds: input.draft.sourceEpisodeIds,
      sourceDraftIds: [input.draft.id]
    },
    supersedes: [],
    createdAt: input.now,
    updatedAt: input.now
  }
}

export function reviewDecisionForRoute(input: {
  semanticMemoryId: string
  route: RoutedMemoryTarget
  reviewHash?: string
  now: string
}): ReviewDecision {
  return {
    id: `review-${input.semanticMemoryId}`,
    semanticMemoryId: input.semanticMemoryId,
    policy: input.route.updatePolicy,
    ...(input.reviewHash === undefined ? {} : { reviewHash: input.reviewHash }),
    reasons: [...input.route.reasons],
    createdAt: input.now
  }
}

function moduleForDraft(draft: CandidateDraft, admission: AdmissionDecision): MemoryModule {
  if (admission.action === 'task_state' || draft.taskState !== undefined) return 'task_state'
  if (draft.domain === 'system') return draft.scope === 'global' ? 'global_policy' : 'system'
  if (draft.domain === 'personal') return 'preference'
  if (draft.domain === 'relationship' || draft.domain === 'affective') return 'relationship_affective'
  if (draft.candidateKind === 'workflow_rule' || draft.domain === 'procedural') return 'procedural'
  if (draft.candidateKind === 'user_instruction') return 'preference'
  return 'project_semantic'
}

function riskForDraft(draft: CandidateDraft, admission: AdmissionDecision): RoutedMemoryTarget['risk'] {
  if (draft.domain === 'personal' || draft.domain === 'relationship' || draft.domain === 'affective') return 'high'
  if (admission.scores.sensitivity > 0.6) return 'high'
  if (admission.scores.sensitivity > 0.35 || admission.scores.evidenceStrength < 0.55) return 'medium'
  return 'low'
}

function updatePolicyForRoute(
  draft: CandidateDraft,
  admission: AdmissionDecision,
  module: MemoryModule,
  risk: RoutedMemoryTarget['risk']
): RoutedMemoryTarget['updatePolicy'] {
  if (admission.action === 'reference_only') return 'drop'
  if (admission.action === 'task_state') return 'defer'
  if (admission.action === 'auto_drop' || admission.action === 'reject_duplicate') return 'drop'
  if (admission.action === 'auto_defer' || admission.action === 'episode_only') return 'defer'
  if (risk === 'high' || isManualOnlyModule(module)) return 'manual_only'
  if (draft.scope === 'session') return 'defer'
  if (canEnterStrictAutoPromoteGate(draft, admission, module, risk)) return 'strict_auto_promote'
  return 'pending_review'
}

function routingReasons(
  draft: CandidateDraft,
  admission: AdmissionDecision,
  module: MemoryModule,
  risk: RoutedMemoryTarget['risk'],
  updatePolicy: RoutedMemoryTarget['updatePolicy']
): string[] {
  const reasons = [`candidate kind ${draft.candidateKind} maps to ${module} module`]
  if (admission.action === 'reference_only') {
    reasons.push('source-of-truth duplicate is reference-only')
    return reasons
  }
  if (admission.action === 'task_state') {
    reasons.push('task state is deferred outside active memory review')
    return reasons
  }
  if (risk === 'high') {
    reasons.push('high sensitivity or protected domain requires manual review')
    return reasons
  }
  if (draft.scope === 'session') {
    reasons.push('session scoped memory is deferred')
    return reasons
  }
  if (updatePolicy === 'manual_only') {
    reasons.push('protected memory module requires manual review')
    return reasons
  }
  if (updatePolicy === 'strict_auto_promote') {
    reasons.push('trusted low-risk project/procedural memory may enter v5 auto-promotion gate')
    return reasons
  }
  reasons.push('project/procedural memory requires review before activation')
  return reasons
}

function isManualOnlyModule(module: MemoryModule): boolean {
  return (
    module === 'relationship_affective' ||
    module === 'global_policy' ||
    module === 'preference' ||
    module === 'principle_candidate'
  )
}

function canEnterStrictAutoPromoteGate(
  draft: CandidateDraft,
  admission: AdmissionDecision,
  module: MemoryModule,
  risk: RoutedMemoryTarget['risk']
): boolean {
  if (admission.action !== 'admit_to_pending') return false
  if (risk !== 'low') return false
  if (draft.sourceKind !== 'file' && draft.sourceKind !== 'tool_trace' && draft.sourceKind !== 'user_explicit') return false
  if (module === 'project_semantic' || module === 'procedural') return true
  return module === 'system' && draft.scope === 'project'
}

function structuredEvidenceForDraft(
  draft: CandidateDraft,
  admission: AdmissionDecision,
  now: string
): StructuredEvidence[] {
  const refs = draft.evidenceRefs.length > 0 ? draft.evidenceRefs : [draft.sourceOfTruth ?? draft.id]
  return refs.map((sourceRef, index) => ({
    id: `evidence-${draft.id}-${index}`,
    sourceKind: draft.sourceKind,
    sourceRef,
    when: now,
    whatHappened: draft.content,
    whyImportant: `Candidate was admitted as ${draft.candidateKind} with reasons: ${admission.reasons.join(', ')}`
  }))
}
