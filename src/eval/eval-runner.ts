import type { DreamProposedChange } from '../codex/dream-proposal.js'
import type { CyreneMemory, MemoryDomain, MemoryPortability, MemoryScope, PendingMemory } from '../memory/types.js'

export type EvalCheckName =
  | 'memory_routing_eval'
  | 'cross_project_leak_eval'
  | 'similar_hint_eval'
  | 'pending_usage_eval'
  | 'profile_pollution_eval'
  | 'affective_boundary_eval'
  | 'auto_promotion_policy_eval'
  | 'global_auto_promotion_eval'
  | 'active_lifecycle_eval'
  | 'pending_budget_eval'
  | 'memory_edge_eval'
  | 'retrieval_explain_eval'

export const MINIMUM_EVAL_CHECKS: EvalCheckName[] = [
  'memory_routing_eval',
  'profile_pollution_eval',
  'affective_boundary_eval',
  'cross_project_leak_eval',
  'pending_usage_eval',
  'similar_hint_eval',
  'auto_promotion_policy_eval',
  'global_auto_promotion_eval',
  'active_lifecycle_eval',
  'pending_budget_eval',
  'memory_edge_eval',
  'retrieval_explain_eval'
]

export interface EvalFinding {
  memoryId?: string
  reason: string
}

export interface EvalResult {
  name: EvalCheckName
  passed: boolean
  severity: 'info' | 'warning' | 'error'
  findings: EvalFinding[]
}

export interface SimilarHintEvalCandidate {
  id: string
  currentProjectId: string
  homeProjectId: string | null
  domain: MemoryDomain
  portability: MemoryPortability
  scope: MemoryScope
  content: string
  transferable: boolean
  notCurrentProjectFact: boolean
}

export interface MemoryRoutingActiveItem {
  id: string
  status: 'active' | 'pending'
  scope: MemoryScope
  homeProjectId: string | null
}

export interface MemoryRoutingPendingItem {
  id: string
  status: 'active' | 'pending'
  provisional?: boolean
}

export interface MemoryRoutingSimilarHintItem {
  id: string
  status: 'active' | 'pending'
  domain: MemoryDomain
  homeProjectId: string | null
  notCurrentProjectFact: boolean
}

export interface MemoryRoutingEvalInput {
  currentProjectId: string
  globalMemory: MemoryRoutingActiveItem[]
  projectMemory: MemoryRoutingActiveItem[]
  pendingHypotheses: MemoryRoutingPendingItem[]
  similarProjectHints: MemoryRoutingSimilarHintItem[]
}

export interface MemoryMigrationEvalInput {
  fromProjectId: string
  toProjectId: string
  activeMemories: Array<Pick<CyreneMemory, 'id' | 'domain'>>
}

export interface V5AutoPromotionEvalItem {
  candidateId: string
  domain: string
  scope: string
  source: string
  policyId: string
  decision: string
  evidenceCount?: number
  distinctEvidenceCount?: number
  dailyCap?: number
  usedToday?: number
}

export interface V5ActiveLifecycleEvalItem {
  memoryId: string
  action: string
  contentHashChecked: boolean
  linkedCandidate?: boolean
  normalizedKeyConflict?: boolean
}

export interface V5PendingBudgetEvalItem {
  scope: 'project' | 'global'
  pendingCount: number
  maxPending: number
  evictionApplied: boolean
  evictedLowestRank?: boolean
}

export interface V5RetrievalExplainEvalItem {
  memoryId: string
  usedInRetrieval: boolean
  explainReasons?: string[]
}

export interface ProfileApplyEvalCandidate {
  id: string
  content: string
  sourceMemoryIds: string[]
  approvedSourceMemoryIds?: string[]
}

export interface EvalGateResult {
  passed: boolean
  failedChecks: EvalCheckName[]
  results: EvalResult[]
}

export function runSimilarHintsEvalGate(candidates: SimilarHintEvalCandidate[]): EvalGateResult {
  return gate([
    runCrossProjectLeakEval(candidates),
    runSimilarHintEval(candidates)
  ])
}

export function runMemoryRoutingEvalGate(input: MemoryRoutingEvalInput): EvalGateResult {
  return gate([runMemoryRoutingEval(input)])
}

export function runMemoryMigrationEvalGate(input: MemoryMigrationEvalInput): EvalGateResult {
  return gate([runCrossProjectMigrationLeakEval(input)])
}

export function runProfileApplyEvalGate(candidate: ProfileApplyEvalCandidate): EvalGateResult {
  return gate([
    runProfileCandidatePollutionEval(candidate),
    runProfileCandidateAffectiveBoundaryEval(candidate)
  ])
}

export function runDreamApplyEvalGate(input: {
  proposedChanges: DreamProposedChange[]
  pending: PendingMemory[]
  profilePreview?: string
}): EvalGateResult {
  return gate([
    runPendingUsageEval(input.proposedChanges, input.pending),
    runProfilePollutionEval(input.proposedChanges, input.pending, input.profilePreview),
    runAffectiveBoundaryEval(input.proposedChanges, input.pending)
  ])
}

export function runV5AutoPromotionEvalGate(items: V5AutoPromotionEvalItem[]): EvalGateResult {
  const findings = items.flatMap((item) => {
    if (item.decision !== 'auto_promote') {
      return []
    }
    const itemFindings: EvalFinding[] = []
    if (['personal', 'relationship', 'affective'].includes(item.domain)) {
      itemFindings.push({ memoryId: item.candidateId, reason: 'high-risk domain cannot auto-promote' })
    }
    if (item.scope === 'global' && !['procedural', 'system'].includes(item.domain)) {
      itemFindings.push({ memoryId: item.candidateId, reason: 'global auto-promotion allows only procedural/system domains' })
    }
    if (item.scope === 'global' && !['user_explicit', 'review_event'].includes(item.source)) {
      itemFindings.push({ memoryId: item.candidateId, reason: `global auto-promotion cannot use source ${item.source}` })
    }
    if (item.scope === 'project' && !['file', 'tool_trace', 'user_explicit', 'review_event'].includes(item.source)) {
      itemFindings.push({ memoryId: item.candidateId, reason: `project auto-promotion cannot use source ${item.source}` })
    }
    if (item.scope === 'global' && !['low_risk_global_procedural_v1', 'review_derived_global_preference_v1'].includes(item.policyId)) {
      itemFindings.push({ memoryId: item.candidateId, reason: 'global auto-promotion used the wrong policy' })
    }
    if (item.scope === 'project' && item.policyId !== 'low_risk_project_memory_v1') {
      itemFindings.push({ memoryId: item.candidateId, reason: 'project auto-promotion used the wrong policy' })
    }
    if (item.dailyCap !== undefined && item.usedToday !== undefined && item.usedToday >= item.dailyCap) {
      itemFindings.push({ memoryId: item.candidateId, reason: 'daily auto-promotion cap exhausted' })
    }
    if (item.distinctEvidenceCount !== undefined && item.distinctEvidenceCount < 2) {
      itemFindings.push({ memoryId: item.candidateId, reason: 'auto-promotion requires repeated distinct evidence' })
    }
    return itemFindings
  })
  return gate([result('auto_promotion_policy_eval', findings)])
}

export function runV5GlobalAutoPromotionEvalGate(items: V5AutoPromotionEvalItem[]): EvalGateResult {
  const findings = items.flatMap((item) => {
    if (item.decision !== 'auto_promote' || item.scope !== 'global') {
      return []
    }
    const itemFindings: EvalFinding[] = []
    if (!['procedural', 'system'].includes(item.domain)) {
      itemFindings.push({ memoryId: item.candidateId, reason: 'global auto-promotion allows only procedural/system domains' })
    }
    if (!['user_explicit', 'review_event'].includes(item.source)) {
      itemFindings.push({ memoryId: item.candidateId, reason: `global auto-promotion cannot use source ${item.source}` })
    }
    if (item.dailyCap !== undefined && item.usedToday !== undefined && item.usedToday >= item.dailyCap) {
      itemFindings.push({ memoryId: item.candidateId, reason: 'global daily auto-promotion cap exhausted' })
    }
    if ((item.evidenceCount ?? 0) < 2 || (item.distinctEvidenceCount ?? 0) < 2) {
      itemFindings.push({ memoryId: item.candidateId, reason: 'global auto-promotion requires repeated evidence' })
    }
    return itemFindings
  })
  return gate([result('global_auto_promotion_eval', findings)])
}

export function runV5ActiveLifecycleEvalGate(items: V5ActiveLifecycleEvalItem[]): EvalGateResult {
  const findings = items.flatMap((item) => {
    const itemFindings: EvalFinding[] = []
    if (!item.contentHashChecked) {
      itemFindings.push({ memoryId: item.memoryId, reason: 'active lifecycle mutation skipped content hash check' })
    }
    if (item.action === 'supersede' && item.linkedCandidate !== true) {
      itemFindings.push({ memoryId: item.memoryId, reason: 'supersede candidate is not linked to active memory' })
    }
    if (item.action === 'supersede' && item.normalizedKeyConflict === true) {
      itemFindings.push({ memoryId: item.memoryId, reason: 'supersede replacement has unresolved normalizedKey conflict' })
    }
    return itemFindings
  })
  return gate([result('active_lifecycle_eval', findings)])
}

export function runV5PendingBudgetEvalGate(items: V5PendingBudgetEvalItem[]): EvalGateResult {
  const findings = items.flatMap((item) => {
    if (item.pendingCount <= item.maxPending) {
      return []
    }
    if (item.evictionApplied && item.evictedLowestRank === true) {
      return []
    }
    return [{ reason: `${item.scope} pending budget exceeded without lowest-rank eviction` }]
  })
  return gate([result('pending_budget_eval', findings)])
}

export function runV5MemoryEdgeEvalGate(items: Array<{
  edgeId: string
  source: string
  status: string
  usedInRetrieval: boolean
}>): EvalGateResult {
  const findings = items
    .filter((item) => item.usedInRetrieval && item.source === 'model' && item.status !== 'approved')
    .map((item) => ({ memoryId: item.edgeId, reason: 'model semantic edge used before approval' }))
  return gate([result('memory_edge_eval', findings)])
}

export function runV5RetrievalExplainEvalGate(items: V5RetrievalExplainEvalItem[]): EvalGateResult {
  const findings = items
    .filter((item) => item.usedInRetrieval && (item.explainReasons === undefined || item.explainReasons.length === 0))
    .map((item) => ({ memoryId: item.memoryId, reason: 'retrieved memory lacks explain reasons' }))
  return gate([result('retrieval_explain_eval', findings)])
}

export function runV5ReleaseReadinessEvalGate(): EvalGateResult {
  return gate([
    ...runV5GlobalAutoPromotionEvalGate([{
      candidateId: 'release-global-auto',
      domain: 'procedural',
      scope: 'global',
      source: 'review_event',
      policyId: 'low_risk_global_procedural_v1',
      decision: 'auto_promote',
      evidenceCount: 3,
      distinctEvidenceCount: 3,
      usedToday: 0,
      dailyCap: 1
    }]).results,
    ...runV5ActiveLifecycleEvalGate([{
      memoryId: 'release-active-supersede',
      action: 'supersede',
      contentHashChecked: true,
      linkedCandidate: true,
      normalizedKeyConflict: false
    }]).results,
    ...runV5PendingBudgetEvalGate([{
      scope: 'project',
      pendingCount: 200,
      maxPending: 200,
      evictionApplied: false,
      evictedLowestRank: false
    }]).results,
    ...runV5RetrievalExplainEvalGate([{
      memoryId: 'release-retrieved-memory',
      usedInRetrieval: true,
      explainReasons: ['exact_project', 'memory_kind:workflow_rule']
    }]).results
  ])
}

export function combineEvalGateResults(gates: EvalGateResult[]): EvalGateResult {
  return gate(gates.flatMap((item) => item.results))
}

function gate(results: EvalResult[]): EvalGateResult {
  const failedChecks = Array.from(new Set(
    results
      .filter((result) => !result.passed && result.severity === 'error')
      .map((result) => result.name)
  ))

  return {
    passed: failedChecks.length === 0,
    failedChecks,
    results
  }
}

function runCrossProjectLeakEval(candidates: SimilarHintEvalCandidate[]): EvalResult {
  const findings: EvalFinding[] = []

  for (const candidate of candidates) {
    if (candidate.homeProjectId === null) {
      findings.push({ memoryId: candidate.id, reason: 'candidate missing homeProjectId' })
    } else if (candidate.homeProjectId === candidate.currentProjectId) {
      findings.push({ memoryId: candidate.id, reason: 'candidate comes from current project' })
    }
    if (candidate.portability === 'local_only') {
      findings.push({ memoryId: candidate.id, reason: 'local_only memory cannot become a similar hint' })
    }
    if (candidate.scope === 'global') {
      findings.push({ memoryId: candidate.id, reason: 'global memory belongs in globalMemory, not similarProjectHints' })
    }
  }

  return result('cross_project_leak_eval', findings)
}

function runSimilarHintEval(candidates: SimilarHintEvalCandidate[]): EvalResult {
  const findings: EvalFinding[] = []

  for (const candidate of candidates) {
    if (isDisallowedSimilarHintDomain(candidate.domain)) {
      findings.push({ memoryId: candidate.id, reason: `domain not allowed for similar hint: ${candidate.domain}` })
    }
    if (containsAbsolutePath(candidate.content)) {
      findings.push({ memoryId: candidate.id, reason: 'content contains absolute path' })
    }
    if (containsRawRemote(candidate.content)) {
      findings.push({ memoryId: candidate.id, reason: 'content contains raw remote' })
    }
    if (containsSecretLikeValue(candidate.content)) {
      findings.push({ memoryId: candidate.id, reason: 'content contains secret-like value' })
    }
    if (!candidate.transferable || !candidate.notCurrentProjectFact) {
      findings.push({ memoryId: candidate.id, reason: 'missing similar hint flags' })
    }
  }

  return result('similar_hint_eval', findings)
}

function runMemoryRoutingEval(input: MemoryRoutingEvalInput): EvalResult {
  const findings: EvalFinding[] = []

  for (const item of input.globalMemory) {
    if (item.status !== 'active') {
      findings.push({ memoryId: item.id, reason: 'globalMemory contains non-active memory' })
    }
    if (item.scope !== 'global') {
      findings.push({ memoryId: item.id, reason: 'globalMemory contains non-global memory' })
    }
    if (item.homeProjectId !== null) {
      findings.push({ memoryId: item.id, reason: 'globalMemory contains project-local memory' })
    }
  }

  for (const item of input.projectMemory) {
    if (item.status !== 'active') {
      findings.push({ memoryId: item.id, reason: 'projectMemory contains non-active memory' })
    }
    if (item.scope === 'global') {
      findings.push({ memoryId: item.id, reason: 'projectMemory contains global memory' })
    }
    if (item.homeProjectId !== input.currentProjectId) {
      findings.push({ memoryId: item.id, reason: 'projectMemory contains memory from another projectId' })
    }
  }

  for (const item of input.pendingHypotheses) {
    if (item.status !== 'pending') {
      findings.push({ memoryId: item.id, reason: 'pendingHypotheses contains confirmed memory' })
    }
    if (item.provisional !== true) {
      findings.push({ memoryId: item.id, reason: 'pendingHypotheses item is not marked provisional' })
    }
  }

  for (const item of input.similarProjectHints) {
    if (item.status !== 'active') {
      findings.push({ memoryId: item.id, reason: 'similarProjectHints contains non-active memory' })
    }
    if (item.homeProjectId === null || item.homeProjectId === input.currentProjectId) {
      findings.push({ memoryId: item.id, reason: 'similarProjectHints contains current-project memory' })
    }
    if (!item.notCurrentProjectFact) {
      findings.push({ memoryId: item.id, reason: 'similarProjectHints item is not marked as non-current-project fact' })
    }
  }

  return result('memory_routing_eval', findings)
}

function runCrossProjectMigrationLeakEval(input: MemoryMigrationEvalInput): EvalResult {
  const findings: EvalFinding[] = []
  if (input.fromProjectId === input.toProjectId) {
    return result('cross_project_leak_eval', findings)
  }

  for (const memory of input.activeMemories) {
    if (isDisallowedSimilarHintDomain(memory.domain)) {
      findings.push({
        memoryId: memory.id,
        reason: `domain cannot migrate across projectIds: ${memory.domain}`
      })
    }
  }

  return result('cross_project_leak_eval', findings)
}

function runProfileCandidatePollutionEval(candidate: ProfileApplyEvalCandidate): EvalResult {
  const findings: EvalFinding[] = []
  if (candidate.sourceMemoryIds.length === 0) {
    findings.push({ memoryId: candidate.id, reason: 'profile candidate has no approved source memory' })
  }
  if (candidate.approvedSourceMemoryIds !== undefined) {
    const approved = new Set(candidate.approvedSourceMemoryIds)
    for (const sourceMemoryId of candidate.sourceMemoryIds) {
      if (!approved.has(sourceMemoryId)) {
        findings.push({ memoryId: candidate.id, reason: `missing approved source memory: ${sourceMemoryId}` })
      }
    }
  }
  return result('profile_pollution_eval', findings)
}

function runProfileCandidateAffectiveBoundaryEval(candidate: ProfileApplyEvalCandidate): EvalResult {
  const findings: EvalFinding[] = []
  if (containsDiagnosticAffectiveClaim(candidate.content)) {
    findings.push({ memoryId: candidate.id, reason: 'profile candidate contains diagnostic affective content' })
  }
  return result('affective_boundary_eval', findings)
}

function runPendingUsageEval(proposedChanges: DreamProposedChange[], pending: PendingMemory[]): EvalResult {
  const findings: EvalFinding[] = []

  for (const change of proposedChanges) {
    if (change.action !== 'promote') {
      continue
    }
    const candidate = pending.find((item) => item.id === change.candidateId)
    if (candidate === undefined) {
      findings.push({ memoryId: change.memoryId, reason: `promoted candidate is missing from pending set: ${change.candidateId}` })
      continue
    }
    if (candidate.source === 'assistant_observed' || candidate.evidence.some((entry) => entry.sourceKind === 'assistant_observed')) {
      findings.push({ memoryId: change.memoryId, reason: 'assistant_observed pending candidate cannot be promoted by dream apply' })
    }
    if (candidate.evidence.length === 0) {
      findings.push({ memoryId: change.memoryId, reason: 'promoted pending candidate has no auditable evidence' })
    }
  }

  return result('pending_usage_eval', findings)
}

function runProfilePollutionEval(
  proposedChanges: DreamProposedChange[],
  pending: PendingMemory[],
  profilePreview?: string
): EvalResult {
  const findings: EvalFinding[] = []
  if (profilePreview === undefined || profilePreview === '') {
    return result('profile_pollution_eval', findings)
  }

  const promotedCandidateIds = new Set(
    proposedChanges
      .filter((change) => change.action === 'promote')
      .map((change) => change.candidateId)
  )
  for (const candidate of pending) {
    if (!promotedCandidateIds.has(candidate.id) && profilePreview.includes(candidate.content)) {
      findings.push({ memoryId: candidate.id, reason: 'profile preview contains pending-only content' })
    }
  }

  return result('profile_pollution_eval', findings)
}

function runAffectiveBoundaryEval(proposedChanges: DreamProposedChange[], pending: PendingMemory[]): EvalResult {
  const findings: EvalFinding[] = []
  const changedCandidateIds = new Set(proposedChanges.map((change) => change.candidateId))

  for (const candidate of pending) {
    if (!changedCandidateIds.has(candidate.id)) {
      continue
    }
    if ((candidate.domain === 'affective' || candidate.domain === 'relationship') && containsDiagnosticAffectiveClaim(candidate.content)) {
      findings.push({ memoryId: candidate.id, reason: 'diagnostic affective claim cannot be applied by dream' })
    }
  }

  return result('affective_boundary_eval', findings)
}

function result(name: EvalCheckName, findings: EvalFinding[]): EvalResult {
  return {
    name,
    passed: findings.length === 0,
    severity: findings.length === 0 ? 'info' : 'error',
    findings
  }
}

function isDisallowedSimilarHintDomain(domain: MemoryDomain): boolean {
  return domain === 'personal' || domain === 'relationship' || domain === 'affective'
}

function containsAbsolutePath(content: string): boolean {
  const unixPath = /(^|[\s`'"([{<:=,;])\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-][^\s`'")\]}>]*/
  const windowsPath = /(^|[\s`'"([{<:=,;])[A-Za-z]:\\(?:[^\\\s`'")\]}>]+\\)+[^\\\s`'")\]}>]+/

  return unixPath.test(content) || windowsPath.test(content)
}

function containsRawRemote(content: string): boolean {
  return /(git@[A-Za-z0-9.-]+:[^\s`'")]+|(?:https?|git|ssh):\/\/(?:git@)?[A-Za-z0-9.-]+\/[^\s`'")]+(?:\.git)?\b)/.test(content)
}

function containsSecretLikeValue(content: string): boolean {
  return /\b(?:(?:sk|ghp|github_pat|xoxb)[_-][A-Za-z0-9_-]{24,}|(?:reviewHash|candidateHash)(?:\s*[=:]\s*|\s+)[a-fA-F0-9]{64})\b/.test(content)
}

function containsDiagnosticAffectiveClaim(content: string): boolean {
  return /\b(?:unstable|emotionally dependent|dependent|narciss(?:ist|istic)?|borderline|trauma bonded|attachment disorder|diagnos(?:e|is|tic))\b/i.test(content)
}
