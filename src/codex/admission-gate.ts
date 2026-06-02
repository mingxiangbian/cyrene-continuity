import { randomUUID } from 'node:crypto'
import { evaluateActiveMemoryReadiness } from './active-memory-readiness.js'
import type {
  AdmissionDecision,
  AdmissionReason,
  AdmissionScores,
  CandidateDraft,
  CyreneMemory,
  MemoryTombstone,
  PendingMemory
} from '../memory/types.js'

export interface EvaluateCandidateAdmissionInput {
  draft: CandidateDraft
  pending: PendingMemory[]
  active: CyreneMemory[]
  tombstones: MemoryTombstone[]
  now?: string
}

const ONE_TIME_ACTION_PATTERN =
  /(?:使用|ran|run|checked|检查|修复|完成|准备|reviewed|looked at).*?(?:工具|tool|command|命令|问题|issue|review)/i
const NUMERIC_SNAPSHOT_PATTERN =
  /\d+.*?(?:tests?|测试|files?|文件|pending|候选|branch|分支|commits?|PRs?)/i
const TEMPORARY_STATUS_PATTERN = /(?:当前|现在|目前|today|本轮|这次|刚刚|准备|已完成|完成了)/i
const VAGUE_PATTERN = /(?:若干|一些|多个|相关|事情|问题|改进|优化|处理)/i
const PRESCRIPTIVE_PATTERN = /(?:must|should|need to|required|before|after|必须|需要|不得|不能|应该|应当|先|前)/i

export function evaluateCandidateAdmission(input: EvaluateCandidateAdmissionInput): AdmissionDecision {
  const now = input.now ?? new Date().toISOString()
  const reasons = reasonsForDraft(input.draft)
  const scores = scoresFor(input.draft, scoreOverridesForReasons(reasons))
  const admissionScore = admissionScoreFor(scores)
  if (reasons.includes('task_state')) {
    return decision(input.draft, 'task_state', reasons, scores, now)
  }

  const duplicateActive = findByNormalizedKey(input.active, input.draft.normalizedKey)
  if (isSourceOfTruthReferenceOnly(input.draft, reasons)) {
    return decision(input.draft, 'reference_only', ['source_of_truth_duplicate', ...reasons], scores, now, {
      ...(duplicateActive === undefined ? {} : { targetMemoryId: duplicateActive.id })
    })
  }

  if (duplicateActive !== undefined) {
    return decision(
      input.draft,
      'reject_duplicate',
      duplicateActiveReasons(input.draft),
      scoresFor(input.draft, { redundancy: 1 }),
      now,
      {
        targetMemoryId: duplicateActive.id
      }
    )
  }

  const tombstone = findActiveTombstone(input.tombstones, input.draft, now)
  if (tombstone !== undefined) {
    return decision(input.draft, 'auto_drop', ['conflicts_with_tombstone'], scoresFor(input.draft, { redundancy: 1 }), now, {
      targetMemoryId: tombstone.memoryId ?? tombstone.id
    })
  }

  const duplicatePending = findByNormalizedKey(input.pending, input.draft.normalizedKey)
  if (duplicatePending !== undefined) {
    return decision(
      input.draft,
      'merge_with_existing',
      ['duplicate_pending'],
      scoresFor(input.draft, { redundancy: 0.8 }),
      now,
      {
        targetMemoryId: duplicatePending.id
      }
    )
  }

  const action = actionFor(input.draft, reasons, admissionScore)
  return decision(input.draft, action, reasons, scores, now)
}

function reasonsForDraft(draft: CandidateDraft): AdmissionReason[] {
  const reasons: AdmissionReason[] = []
  const durableGuidance = isDurablePrescriptiveGuidance(draft)
  const readiness = evaluateActiveMemoryReadiness(draft)
  if (draft.candidateKind === 'user_instruction' || draft.sourceKind === 'user_explicit') {
    reasons.push('explicit_user_instruction')
  }
  if (draft.candidateKind === 'workflow_rule') {
    reasons.push('valuable_workflow_rule')
  }
  if (draft.candidateKind === 'project_decision') {
    reasons.push('valuable_project_decision')
  }
  if (draft.candidateKind === 'known_pitfall') {
    reasons.push('valuable_known_pitfall')
  }
  if (draft.candidateKind === 'rejected_approach') {
    reasons.push('valuable_rejected_approach')
  }
  if (!durableGuidance && ONE_TIME_ACTION_PATTERN.test(draft.content)) {
    reasons.push('one_time_action', 'low_future_usefulness')
  }
  if (NUMERIC_SNAPSHOT_PATTERN.test(draft.content)) {
    reasons.push('stale_numeric_snapshot', 'low_actionability')
  }
  if (TEMPORARY_STATUS_PATTERN.test(draft.content)) {
    reasons.push('temporary_status')
  }
  if (draft.taskState !== undefined) {
    reasons.push('task_state')
  }
  if (!durableGuidance && (draft.content.length < 24 || VAGUE_PATTERN.test(draft.content))) {
    reasons.push('too_vague')
  }
  if (!readiness.ready) {
    reasons.push(...readiness.reasons)
  }
  return Array.from(new Set(reasons))
}

function duplicateActiveReasons(draft: CandidateDraft): AdmissionReason[] {
  return draft.sourceOfTruth === undefined
    ? ['duplicate_active']
    : ['duplicate_active', 'source_of_truth_duplicate']
}

function isDurablePrescriptiveGuidance(draft: CandidateDraft): boolean {
  const durableKind =
    draft.candidateKind === 'workflow_rule' ||
    draft.candidateKind === 'known_pitfall' ||
    draft.candidateKind === 'rejected_approach' ||
    draft.candidateKind === 'user_instruction'
  return durableKind && PRESCRIPTIVE_PATTERN.test(draft.content)
}

function scoreOverridesForReasons(reasons: AdmissionReason[]): Partial<AdmissionScores> {
  const noisy = reasons.some(
    (reason) =>
      reason === 'one_time_action' ||
      reason === 'temporary_status' ||
      reason === 'stale_numeric_snapshot' ||
      reason === 'low_future_usefulness' ||
      reason === 'low_actionability' ||
      reason === 'too_vague' ||
      reason === 'implementation_note' ||
      reason === 'raw_file_rule_excerpt' ||
      reason === 'overbroad_workflow_rule' ||
      reason === 'needs_active_memory_rewrite'
  )
  const valuable = reasons.some(
    (reason) =>
      reason === 'valuable_project_decision' ||
      reason === 'valuable_workflow_rule' ||
      reason === 'valuable_known_pitfall' ||
      reason === 'valuable_rejected_approach' ||
      reason === 'explicit_user_instruction'
  )
  if (valuable && !noisy) {
    return {
      futureUsefulness: 0.85,
      actionability: 0.85,
      stability: 0.8,
      specificity: 0.75,
      evidenceStrength: 0.75,
      repeatPotential: 0.7,
      expiryRisk: 0.1,
      redundancy: 0.0,
      sensitivity: 0.1
    }
  }
  if (reasons.includes('stale_numeric_snapshot')) {
    return {
      futureUsefulness: 0.35,
      actionability: 0.25,
      stability: 0.35,
      specificity: 0.65,
      evidenceStrength: 0.7,
      repeatPotential: 0.55,
      expiryRisk: 0.85,
      redundancy: 0.1,
      sensitivity: 0.1
    }
  }
  if (noisy) {
    return {
      futureUsefulness: 0.2,
      actionability: 0.2,
      stability: 0.25,
      specificity: 0.35,
      evidenceStrength: 0.6,
      repeatPotential: 0.2,
      expiryRisk: 0.7,
      redundancy: 0.1,
      sensitivity: 0.1
    }
  }
  return {}
}

function scoresFor(draft: CandidateDraft, overrides: Partial<AdmissionScores> = {}): AdmissionScores {
  return {
    futureUsefulness: 0.55,
    actionability: 0.5,
    stability: 0.55,
    specificity: draft.content.length >= 48 ? 0.65 : 0.45,
    evidenceStrength: draft.evidenceRefs.length > 0 ? 0.7 : 0.3,
    repeatPotential: draft.candidateKind === 'workflow_rule' || draft.candidateKind === 'known_pitfall' ? 0.7 : 0.45,
    expiryRisk: 0.35,
    redundancy: 0,
    sensitivity: draft.domain === 'personal' || draft.domain === 'relationship' || draft.domain === 'affective' ? 0.7 : 0.1,
    ...overrides
  }
}

function admissionScoreFor(scores: AdmissionScores): number {
  return clamp(
    scores.futureUsefulness * 0.25 +
      scores.actionability * 0.2 +
      scores.stability * 0.15 +
      scores.specificity * 0.15 +
      scores.evidenceStrength * 0.15 +
      scores.repeatPotential * 0.1 -
      scores.expiryRisk * 0.25 -
      scores.redundancy * 0.2 -
      scores.sensitivity * 0.1
  )
}

function actionFor(draft: CandidateDraft, reasons: AdmissionReason[], score: number): AdmissionDecision['action'] {
  if (reasons.includes('task_state')) return 'task_state'
  if (reasons.includes('explicit_user_instruction')) return 'admit_to_pending'
  if (reasons.includes('needs_active_memory_rewrite')) return 'admit_to_distillation'
  if (
    reasons.includes('valuable_workflow_rule') ||
    reasons.includes('valuable_known_pitfall') ||
    reasons.includes('valuable_rejected_approach') ||
    reasons.includes('valuable_project_decision')
  ) {
    return score >= 0.5 ? 'admit_to_pending' : 'admit_to_distillation'
  }
  if (reasons.includes('stale_numeric_snapshot')) return 'admit_to_distillation'
  if (reasons.includes('one_time_action') || reasons.includes('temporary_status')) return 'episode_only'
  if (score < 0.35) return 'auto_drop'
  if (score < 0.5) return 'episode_only'
  if (score < 0.65) return 'admit_to_distillation'
  return draft.candidateKind === 'project_fact' ? 'admit_to_distillation' : 'admit_to_pending'
}

function isSourceOfTruthReferenceOnly(draft: CandidateDraft, reasons: AdmissionReason[]): boolean {
  if (draft.sourceOfTruth === undefined || draft.sourceOfTruth.trim() === '') {
    return false
  }
  if (!reasons.includes('raw_file_rule_excerpt')) {
    return false
  }
  return !hasOperationalInterpretationSignal(draft.content)
}

function hasOperationalInterpretationSignal(content: string): boolean {
  return /because|exception|applies when|mitigation|\buse\b|non-trivial|keep each|避免|例外|适用|边界|改写|使用|非琐碎|非平凡/i.test(content)
}

function decision(
  draft: CandidateDraft,
  action: AdmissionDecision['action'],
  reasons: AdmissionReason[],
  scores: AdmissionScores,
  now: string,
  extras: Partial<Pick<AdmissionDecision, 'targetMemoryId' | 'targetClusterId'>> = {}
): AdmissionDecision {
  return {
    id: randomUUID(),
    draftId: draft.id,
    action,
    admissionScore: admissionScoreFor(scores),
    reasons,
    scores,
    createdAt: now,
    ...extras
  }
}

function findByNormalizedKey<T extends { normalizedKey: string; id: string }>(
  items: T[],
  normalizedKey: string | undefined
): T | undefined {
  return normalizedKey === undefined ? undefined : items.find((item) => item.normalizedKey === normalizedKey)
}

function findActiveTombstone(tombstones: MemoryTombstone[], draft: CandidateDraft, now: string): MemoryTombstone | undefined {
  return tombstones.find(
    (entry) => entry.normalizedKey === draft.normalizedKey && (entry.expiresAt === undefined || entry.expiresAt > now)
  )
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))))
}
