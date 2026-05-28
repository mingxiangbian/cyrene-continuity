import type { DreamProposedChange } from '../codex/dream-proposal.js'
import type { CyreneMemory, MemoryDomain, MemoryPortability, MemoryScope, PendingMemory } from '../memory/types.js'

export type EvalCheckName =
  | 'memory_routing_eval'
  | 'cross_project_leak_eval'
  | 'similar_hint_eval'
  | 'pending_usage_eval'
  | 'profile_pollution_eval'
  | 'affective_boundary_eval'

export const MINIMUM_EVAL_CHECKS: EvalCheckName[] = [
  'memory_routing_eval',
  'profile_pollution_eval',
  'affective_boundary_eval',
  'cross_project_leak_eval',
  'pending_usage_eval',
  'similar_hint_eval'
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

export interface ProfileApplyEvalCandidate {
  id: string
  content: string
  sourceMemoryIds: string[]
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

export function combineEvalGateResults(gates: EvalGateResult[]): EvalGateResult {
  return gate(gates.flatMap((item) => item.results))
}

function gate(results: EvalResult[]): EvalGateResult {
  const failedChecks = results
    .filter((result) => !result.passed && result.severity === 'error')
    .map((result) => result.name)

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
