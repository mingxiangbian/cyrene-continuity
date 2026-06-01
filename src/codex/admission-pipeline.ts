import { evaluateCandidateAdmission } from './admission-gate.js'
import { toCandidateDraft } from './candidate-drafts.js'
import { codexProjectMemoryRoot, ensureCodexGlobalMemoryRoot, ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import { proposeCodexMemoryCandidate, type CodexMemoryCandidateInput, type CodexMemoryProposeResult } from './memory-propose.js'
import { identifyCodexProject } from './project-id.js'
import { isCodexProjectMemoryDisabled } from './project-registry.js'
import {
  appendAdmissionDecisionFromRoot,
  appendCandidateDraftFromRoot,
  appendDistillationInputFromRoot,
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot
} from '../memory/memory-store.js'
import type { AdmissionDecision, CandidateDraft, CandidateDraftSourceKind, DistillationInput } from '../memory/types.js'

export type CodexAdmissionPipelineResult =
  | (CodexMemoryProposeResult & { action: 'pending' | 'auto_promote' | 'reject'; admission: AdmissionDecision })
  | {
      project: { projectId: string; displayName: string }
      memoryRoot: string
      action: AdmissionDecision['action']
      admission: AdmissionDecision
      reason: string
    }

export interface RunCodexAdmissionPipelineInput {
  cwd: string
  candidate: CodexMemoryCandidateInput
  sourceKind: CandidateDraftSourceKind
  sourceEpisodeIds?: string[]
  evidenceRefs?: string[]
  now?: string
  recordRejectedCandidate?: boolean
  allowAutoPromote?: boolean
}

export async function runCodexAdmissionPipeline(
  input: RunCodexAdmissionPipelineInput
): Promise<CodexAdmissionPipelineResult> {
  const project = await identifyCodexProject(input.cwd)
  if (input.candidate.scope !== 'global' && await isCodexProjectMemoryDisabled(project.projectId)) {
    return {
      project: { projectId: project.projectId, displayName: project.displayName },
      memoryRoot: codexProjectMemoryRoot(project.projectId),
      action: 'auto_drop',
      admission: disabledAdmission(input),
      reason: 'Project memory is disabled for this project.'
    }
  }

  const memoryRoot = input.candidate.scope === 'global'
    ? await ensureCodexGlobalMemoryRoot()
    : await ensureCodexProjectMemoryRoot(project.projectId)

  const draft = toCandidateDraft({
    projectId: project.projectId,
    candidate: input.candidate,
    sourceKind: input.sourceKind,
    sourceEpisodeIds: input.sourceEpisodeIds,
    evidenceRefs: input.evidenceRefs,
    now: input.now
  })
  await appendCandidateDraftFromRoot(memoryRoot, draft)

  const [pending, active, tombstones] = await Promise.all([
    readPendingMemoriesFromRoot(memoryRoot),
    readActiveMemoriesFromRoot(memoryRoot),
    readTombstonesFromRoot(memoryRoot)
  ])
  const admission = evaluateCandidateAdmission({ draft, pending, active, tombstones, now: input.now })
  await appendAdmissionDecisionFromRoot(memoryRoot, admission)

  if (admission.action === 'admit_to_distillation') {
    await appendDistillationInputFromRoot(memoryRoot, distillationInputFromAdmission(draft, admission))
  }

  if (admission.action !== 'admit_to_pending' && admission.action !== 'merge_with_existing') {
    return {
      project: { projectId: project.projectId, displayName: project.displayName },
      memoryRoot,
      action: admission.action,
      admission,
      reason: `Admission gate decided ${admission.action}: ${admission.reasons.join(', ')}`
    }
  }

  const proposed = await proposeCodexMemoryCandidate({
    cwd: input.cwd,
    candidate: {
      ...input.candidate,
      admittedBy: 'admission_gate_v1',
      admissionScore: admission.admissionScore,
      admissionReasons: admission.reasons,
      sourceEpisodeIds: input.sourceEpisodeIds,
      sourceDraftIds: [draft.id]
    },
    now: input.now,
    recordRejectedCandidate: input.recordRejectedCandidate,
    allowAutoPromote: input.allowAutoPromote
  })

  return {
    ...proposed,
    action: proposed.result.action,
    admission
  }
}

function distillationInputFromAdmission(draft: CandidateDraft, admission: AdmissionDecision): DistillationInput {
  return {
    id: `distillation-${admission.id}`,
    sourceDraftIds: [draft.id],
    sourceEpisodeIds: draft.sourceEpisodeIds,
    sourceSemanticMemoryIds: admission.targetMemoryId === undefined ? [] : [admission.targetMemoryId],
    admissionDecisionIds: [admission.id],
    ...(draft.normalizedKey === undefined ? {} : { normalizedKey: draft.normalizedKey }),
    candidateKind: draft.candidateKind,
    scope: draft.scope,
    domain: draft.domain,
    sourceKinds: [draft.sourceKind],
    rawContents: [draft.content],
    evidenceRefs: draft.evidenceRefs,
    createdAt: admission.createdAt
  }
}

function disabledAdmission(input: RunCodexAdmissionPipelineInput): AdmissionDecision {
  return {
    id: 'admission-disabled-project',
    draftId: 'draft-disabled-project',
    action: 'auto_drop',
    admissionScore: 0,
    reasons: ['low_future_usefulness'],
    scores: {
      futureUsefulness: 0,
      actionability: 0,
      stability: 0,
      specificity: 0,
      evidenceStrength: 0,
      repeatPotential: 0,
      expiryRisk: 1,
      redundancy: 0,
      sensitivity: 0
    },
    createdAt: input.now ?? new Date().toISOString()
  }
}
