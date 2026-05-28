import { createHash } from 'node:crypto'
import { deriveMemoryCandidateKind } from './candidate-kind.js'
import type {
  CyreneMemory,
  MemoryDecision,
  MemoryProfileVisibility,
  MemoryTombstone,
  PendingMemory
} from './types.js'

export interface ValidateMemoryCandidateInput {
  candidate: PendingMemory
  existingMemories: CyreneMemory[]
  tombstones: MemoryTombstone[]
  now?: string
}

export interface PendingPromotionPolicyResult {
  promotable: boolean
  reason: string
  distinctEvidenceCount: number
}

export function validateMemoryCandidate(input: ValidateMemoryCandidateInput): MemoryDecision {
  const now = input.now ?? new Date().toISOString()
  const candidate = normalizeCandidate(input.candidate)
  const tombstone = input.tombstones.find((entry) => isActiveTombstoneMatch(entry, candidate, now))
  if (tombstone !== undefined) {
    return reject(candidate, now, `Memory was previously ${tombstone.reason}`)
  }

  if (deriveMemoryCandidateKind(candidate) === 'open_question') {
    return reject(candidate, now, 'Open question memory candidates cannot become active')
  }

  if (!hasValidEvidence(candidate)) {
    return reject(candidate, now, 'Memory candidate is missing auditable evidence')
  }

  if (candidate.type === 'episode' || candidate.strength === 'session' || candidate.scope === 'session') {
    if (candidate.expiresAt === undefined) {
      return reject(candidate, now, 'Session or episodic memory requires expiresAt')
    }
  }

  if (isDiagnosticAffectiveClaim(candidate.content)) {
    return reject(candidate, now, 'Affective memory cannot contain diagnostic claims')
  }

  if (candidate.domain === 'affective' && (candidate.strength === 'hard' || candidate.scope === 'global')) {
    return reject(candidate, now, 'Affective memory cannot auto-write as hard/global in Phase 3')
  }

  if (candidate.scores.evidenceStrength < 0.55 || candidate.scores.safety < 0.65) {
    return reject(candidate, now, 'Memory candidate is below minimum evidence or safety threshold')
  }

  if (hasAssistantDerivedEvidence(candidate)) {
    return {
      action: 'pending',
      reason: 'Memory candidate is based on assistant output and requires user confirmation',
      candidate
    }
  }

  if (isTentativeOrRecentPersonalMemory(candidate)) {
    return {
      action: 'pending',
      reason: 'Tentative or recent personal memory requires repeated evidence',
      candidate: { ...candidate, strength: 'soft' }
    }
  }

  if (isMemoryRecallQuestion(candidate)) {
    return {
      action: 'pending',
      reason: 'Memory recall questions require confirmation before creating new rules',
      candidate
    }
  }

  if (!isAutoWritable(candidate)) {
    return {
      action: 'pending',
      reason: 'Memory candidate requires more evidence or confirmation',
      candidate
    }
  }

  return {
    action: 'auto_write',
    reason: 'Memory candidate passed domain policy',
    memory: activateCandidate(candidate, now)
  }
}

export function activateCandidate(candidate: PendingMemory, now: string): CyreneMemory {
  const candidateKind = deriveMemoryCandidateKind(candidate)
  return {
    id: candidate.id,
    domain: candidate.domain,
    type: candidate.type,
    strength: candidate.strength,
    scope: candidate.scope === 'session' ? 'project' : candidate.scope,
    status: 'active',
    content: candidate.content,
    normalizedKey: candidate.normalizedKey,
    evidence: candidate.evidence,
    source: candidate.source,
    scores: candidate.scores,
    createdAt: candidate.firstSeenAt || now,
    updatedAt: now,
    expiresAt: candidate.expiresAt,
    userConfirmed: candidate.userConfirmed,
    candidateKind,
    tags: candidate.tags,
    ...(candidate.profileVisibility === undefined ? {} : { profileVisibility: candidate.profileVisibility }),
    ...(candidate.conflictsWith === undefined ? {} : { supersedes: candidate.conflictsWith })
  }
}

export function isPromotablePending(candidate: PendingMemory): boolean {
  return evaluatePendingPromotion(candidate, new Date().toISOString()).promotable
}

export function distinctEvidenceCount(candidate: PendingMemory): number {
  const keys = new Set<string>()
  const seenRunIds = new Set<string>()
  for (const entry of candidate.evidence) {
    const evidenceGroupId = cleanEvidencePart(entry.evidenceGroupId)
    const sessionId = cleanEvidencePart(entry.sessionId)
    const runId = cleanEvidencePart(entry.runId)
    const summary = cleanEvidencePart(entry.summary)
    const quote = cleanEvidencePart(entry.quote)
    if (evidenceGroupId === undefined && sessionId === undefined && runId === undefined && summary === undefined && quote === undefined) {
      continue
    }
    if (runId !== undefined) {
      if (seenRunIds.has(runId)) {
        continue
      }
      seenRunIds.add(runId)
    }
    const summaryQuote = `${entry.summary ?? ''}|${entry.quote ?? ''}`
    const hash = createHash('sha256').update(summaryQuote).digest('hex')
    keys.add(evidenceGroupId ?? sessionId ?? runId ?? hash)
  }
  return keys.size
}

export function deriveProfileVisibility(
  memory: Pick<
    PendingMemory,
    'domain' | 'type' | 'strength' | 'source' | 'scores' | 'content' | 'userConfirmed' | 'profileVisibility'
  >
): MemoryProfileVisibility {
  if (memory.profileVisibility !== undefined) {
    return memory.profileVisibility
  }
  if (containsRestrictedProfileDetail(memory.content)) {
    return 'never'
  }
  if (
    (memory.domain === 'procedural' || memory.domain === 'project' || memory.domain === 'system') &&
    memory.strength === 'hard' &&
    memory.scores.safety >= 0.8
  ) {
    return 'always'
  }
  if (
    (memory.domain === 'personal' || memory.domain === 'relationship' || memory.domain === 'affective') &&
    memory.scores.safety >= 0.85 &&
    memory.scores.sensitivity <= 0.45
  ) {
    return 'safe_summary'
  }
  return 'retrieval_only'
}

export function evaluatePendingPromotion(candidate: PendingMemory, now?: string): PendingPromotionPolicyResult {
  const count = distinctEvidenceCount(candidate)
  const threshold = promotionThreshold(candidate)
  const hasDurableInstruction = hasDirectMemoryInstruction(candidate)
  const canBypassEvidenceCount = candidate.userConfirmed === true && hasDurableInstruction
  if (!hasValidEvidence(candidate)) {
    return pendingResult('Memory candidate is missing auditable evidence', count)
  }
  if (candidate.promoteAfter !== undefined && now !== undefined && candidate.promoteAfter > now) {
    return pendingResult('Memory candidate promoteAfter has not elapsed', count)
  }
  if (assistantDerivedRequiresConfirmation(candidate)) {
    return pendingResult('Memory candidate is based on assistant output and requires user confirmation', count)
  }
  if (isLowValuePromotionNoise(candidate)) {
    return pendingResult('Memory candidate is low-value confirmation or transient status noise', count)
  }
  if (isDiagnosticAffectiveClaim(candidate.content)) {
    return pendingResult('Memory candidate contains a diagnostic affective claim', count)
  }
  if (candidate.seenCount < threshold.seenCount && !canBypassEvidenceCount) {
    return pendingResult(`Memory candidate seenCount is below ${threshold.seenCount}`, count)
  }
  if (count < threshold.distinctEvidenceCount && !canBypassEvidenceCount) {
    return pendingResult(`Memory candidate needs ${threshold.distinctEvidenceCount} distinct evidence groups`, count)
  }
  if (
    candidate.scores.evidenceStrength < threshold.evidenceStrength ||
    candidate.scores.stability < threshold.stability ||
    candidate.scores.usefulness < threshold.usefulness ||
    candidate.scores.safety < threshold.safety ||
    candidate.scores.sensitivity > threshold.sensitivity
  ) {
    return pendingResult('Memory candidate is below promotion score thresholds', count)
  }
  return {
    promotable: true,
    reason: 'Memory candidate passed pending promotion policy',
    distinctEvidenceCount: count
  }
}

function normalizeCandidate(candidate: PendingMemory): PendingMemory {
  if (candidate.type === 'episode') {
    return { ...candidate, domain: 'personal', strength: 'session', scope: 'session' }
  }
  if (candidate.domain === 'personal' && candidate.source !== 'user_explicit' && candidate.userConfirmed !== true) {
    return { ...candidate, strength: 'soft' }
  }
  if (candidate.domain === 'relationship' && candidate.source !== 'user_explicit' && candidate.userConfirmed !== true) {
    return { ...candidate, strength: 'soft' }
  }
  if (candidate.domain === 'affective') {
    return {
      ...candidate,
      strength: candidate.strength === 'hard' ? 'soft' : candidate.strength,
      scope: 'session'
    }
  }
  return candidate
}

function isAutoWritable(candidate: PendingMemory): boolean {
  if (
    candidate.scores.evidenceStrength < 0.8 ||
    candidate.scores.stability < 0.7 ||
    candidate.scores.usefulness < 0.6 ||
    candidate.scores.safety < 0.8 ||
    candidate.scores.sensitivity > 0.6
  ) {
    return false
  }

  if (candidate.domain === 'project') {
    return candidate.strength === 'hard'
  }
  if (candidate.domain === 'procedural') {
    return candidate.strength === 'hard' && candidate.scores.usefulness >= 0.75 && isTrustedAutoWriteSource(candidate)
  }
  if (candidate.domain === 'system') {
    return candidate.source === 'user_explicit' || candidate.source === 'tool_trace' || candidate.source === 'file'
  }
  if (candidate.domain === 'personal') {
    return candidate.strength === 'hard' && (candidate.source === 'user_explicit' || candidate.userConfirmed === true)
  }
  if (candidate.domain === 'relationship') {
    return candidate.strength === 'hard' && (candidate.source === 'user_explicit' || candidate.userConfirmed === true)
  }
  return false
}

function isTrustedAutoWriteSource(candidate: PendingMemory): boolean {
  return (
    candidate.userConfirmed === true ||
    candidate.source === 'user_explicit' ||
    candidate.source === 'tool_trace' ||
    candidate.source === 'file' ||
    candidate.source === 'legacy_markdown'
  )
}

function hasAssistantDerivedEvidence(candidate: PendingMemory): boolean {
  return assistantDerivedRequiresConfirmation(candidate)
}

function assistantDerivedRequiresConfirmation(candidate: PendingMemory): boolean {
  if (hasAssistantDerivedSilenceEvidence(candidate)) {
    return true
  }
  if (!hasAssistantDerivedSource(candidate)) {
    return false
  }
  return !hasExplicitUserConfirmationOrDirectInstruction(candidate)
}

function hasAssistantDerivedSource(candidate: PendingMemory): boolean {
  return (
    candidate.source === 'assistant_observed' ||
    candidate.evidence.some((entry) => entry.sourceKind === 'assistant_observed')
  )
}

function hasAssistantDerivedSilenceEvidence(candidate: PendingMemory): boolean {
  return candidate.evidence.some((entry) => {
    const text = `${entry.summary ?? ''} ${entry.quote ?? ''}`.toLowerCase()
    return (
      text.includes('assistant provided') ||
      text.includes('assistant proposed') ||
      text.includes('assistant offered') ||
      text.includes('assistant suggested') ||
      text.includes('accepted without correction') ||
      text.includes('did not reject') ||
      text.includes('without correction')
    )
  })
}

function hasExplicitUserConfirmationOrDirectInstruction(candidate: PendingMemory): boolean {
  return candidate.userConfirmed === true || hasDirectUserInstructionEvidence(candidate)
}

function isTentativeOrRecentPersonalMemory(candidate: PendingMemory): boolean {
  if (candidate.userConfirmed === true) {
    return false
  }
  if (candidate.domain !== 'personal' && candidate.domain !== 'relationship') {
    return false
  }
  if (candidate.type !== 'user_preference' && candidate.type !== 'interaction_style' && candidate.type !== 'relationship_boundary') {
    return false
  }

  return /最近|好像|可能|暂时|似乎|感觉|不确定|\blately\b|\brecently\b|\bmaybe\b|\bmight\b|\bseems?\b|\bfor now\b|\btentative\b|\btemporar(?:y|ily)\b/i.test(
    evidenceText(candidate)
  )
}

function isMemoryRecallQuestion(candidate: PendingMemory): boolean {
  if (candidate.userConfirmed === true || hasDirectMemoryInstruction(candidate)) {
    return false
  }

  return /你应该怎么|你会怎么|应该如何|会如何|还记得|记得.*吗|how should you|how would you|what should you|do you remember/i.test(
    evidenceText(candidate)
  )
}

function hasDirectMemoryInstruction(candidate: PendingMemory): boolean {
  return hasDirectMemoryInstructionText(`${candidate.content} ${evidenceText(candidate)}`)
}

function hasDirectUserInstructionEvidence(candidate: PendingMemory): boolean {
  if (!hasDirectMemoryInstruction(candidate)) {
    return false
  }
  if (candidate.source === 'user_explicit') {
    return true
  }
  return candidate.evidence.some((entry) =>
    entry.sourceKind === 'user_explicit' && hasDirectMemoryInstructionText(`${entry.summary ?? ''} ${entry.quote ?? ''}`)
  )
}

function hasDirectMemoryInstructionText(text: string): boolean {
  return /记住|请记住|以后默认|之后默认|以后你要|以后请|remember that|please remember|from now on|default to/i.test(text)
}

function evidenceText(candidate: PendingMemory): string {
  return candidate.evidence.map((entry) => `${entry.summary ?? ''} ${entry.quote ?? ''}`).join(' ')
}

function cleanEvidencePart(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

function pendingResult(reason: string, distinctEvidenceCount: number): PendingPromotionPolicyResult {
  return { promotable: false, reason, distinctEvidenceCount }
}

function promotionThreshold(candidate: PendingMemory): {
  seenCount: number
  distinctEvidenceCount: number
  evidenceStrength: number
  stability: number
  usefulness: number
  safety: number
  sensitivity: number
} {
  if (candidate.domain === 'personal' || candidate.domain === 'relationship') {
    return {
      seenCount: 3,
      distinctEvidenceCount: 3,
      evidenceStrength: 0.8,
      stability: 0.75,
      usefulness: 0.65,
      safety: 0.85,
      sensitivity: 0.45
    }
  }
  if (candidate.domain === 'affective') {
    return {
      seenCount: 3,
      distinctEvidenceCount: 3,
      evidenceStrength: 0.85,
      stability: 0.8,
      usefulness: 0.65,
      safety: 0.9,
      sensitivity: 0.3
    }
  }
  return {
    seenCount: 2,
    distinctEvidenceCount: 2,
    evidenceStrength: 0.75,
    stability: 0.7,
    usefulness: 0.6,
    safety: 0.8,
    sensitivity: 0.6
  }
}

function isLowValuePromotionNoise(candidate: PendingMemory): boolean {
  const content = candidate.content.trim()
  if (/^(ok|okay|确认|可以|继续)$/i.test(content)) {
    return true
  }

  const text = `${content} ${evidenceText(candidate)}`.toLowerCase()
  return (
    /\bran\s+npm\s+(test|run|install|ci)\b/.test(text) ||
    /\bread\s+(the\s+)?file\b/.test(text) ||
    /\bhook\s+returned\b/.test(text) ||
    /\bmerged\s+and\s+pushed\b/.test(text) ||
    /\bcurrent\s+branch\b/.test(text) ||
    /\bone[- ]time\s+(ci|test)\s+result\b/.test(text) ||
    /\b(ci|test)\s+(passed|failed)\b/.test(text)
  )
}

function containsRestrictedProfileDetail(content: string): boolean {
  return (
    isDiagnosticAffectiveClaim(content) ||
    /\b(secret|credential|password|passwd|api[_ -]?key|token|private key|ssh key|private raw detail)\b/i.test(content) ||
    /私密原文|原始私密|隐私原文|诊断/.test(content)
  )
}

function reject(candidate: PendingMemory, now: string, reason: string): MemoryDecision {
  return {
    action: 'reject',
    reason,
    tombstone: {
      id: `tombstone-${candidate.id}`,
      normalizedKey: candidate.normalizedKey,
      domain: candidate.domain,
      type: candidate.type,
      strength: candidate.strength,
      scope: candidate.scope,
      reason: 'rejected',
      createdAt: now,
      evidence: candidate.evidence
    }
  }
}

function hasValidEvidence(candidate: PendingMemory): boolean {
  return candidate.evidence.some((entry) =>
    (entry.runId !== undefined && entry.runId.trim() !== '') ||
    (entry.summary !== undefined && entry.summary.trim() !== '') ||
    (entry.quote !== undefined && entry.quote.trim() !== '')
  )
}

function isActiveTombstoneMatch(tombstone: MemoryTombstone, candidate: PendingMemory, now: string): boolean {
  return (
    tombstone.normalizedKey === candidate.normalizedKey &&
    (tombstone.expiresAt === undefined || tombstone.expiresAt > now)
  )
}

function isDiagnosticAffectiveClaim(content: string): boolean {
  return /\b(anxious|unstable|insecurity|insecure|dependent|dependency|fragile|needy)\b|焦虑|不稳定|缺乏安全感|情感依赖/.test(
    content.toLowerCase()
  )
}
