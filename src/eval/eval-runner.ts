import type { MemoryDomain, MemoryPortability, MemoryScope } from '../memory/types.js'

export type EvalCheckName =
  | 'cross_project_leak_eval'
  | 'similar_hint_boundary_eval'

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

export interface EvalGateResult {
  passed: boolean
  failedChecks: EvalCheckName[]
  results: EvalResult[]
}

export function runSimilarHintsEvalGate(candidates: SimilarHintEvalCandidate[]): EvalGateResult {
  const results = [
    runCrossProjectLeakEval(candidates),
    runSimilarHintBoundaryEval(candidates)
  ]
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

function runSimilarHintBoundaryEval(candidates: SimilarHintEvalCandidate[]): EvalResult {
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

  return result('similar_hint_boundary_eval', findings)
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
  return /(git@[A-Za-z0-9.-]+:[^\s`'")]+|https:\/\/[A-Za-z0-9.-]+\/[^\s`'")]+(?:\.git)?\b)/.test(content)
}

function containsSecretLikeValue(content: string): boolean {
  return /\b(?:(?:sk|ghp|github_pat|xoxb)[_-][A-Za-z0-9_-]{24,}|(?:reviewHash|candidateHash)(?:\s*[=:]\s*|\s+)[a-fA-F0-9]{64})\b/.test(content)
}
