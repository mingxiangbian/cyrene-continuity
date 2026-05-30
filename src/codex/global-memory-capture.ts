import { createHash } from 'node:crypto'
import type { CodexMemoryCandidateInput } from './memory-propose.js'
import type { MemoryEvent } from '../memory/types.js'

const GLOBAL_INSTRUCTION_PATTERN = /(以后所有项目|所有项目|每个项目|全局|all projects|every project|across projects|remember globally|global(?:ly)?)/i
const PERSONAL_PREFERENCE_PATTERN = /\b(i|my|me)\b.*\b(prefer|like|feel|birthday|relationship)\b/i

export function candidateFromExplicitGlobalInstruction(input: {
  text: string
  now: string
}): CodexMemoryCandidateInput | undefined {
  const text = input.text.trim()
  if (!GLOBAL_INSTRUCTION_PATTERN.test(text)) {
    return undefined
  }
  if (PERSONAL_PREFERENCE_PATTERN.test(text)) {
    return undefined
  }

  return {
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'global',
    source: 'user_explicit',
    candidateKind: 'user_instruction',
    content: text,
    normalizedKey: `global-instruction-${shortHash(text)}`,
    evidence: [
      {
        summary: 'Explicit global instruction from user prompt.',
        sourceKind: 'user_explicit',
        evidenceGroupId: shortHash(`global:${text}`)
      }
    ],
    scores: { evidenceStrength: 0.92, stability: 0.88, usefulness: 0.85, safety: 0.96, sensitivity: 0.05 },
    tags: ['global_capture', 'explicit_instruction'],
    userConfirmed: true
  }
}

export function candidateFromReviewPattern(input: {
  patternId: string
  action: 'reject' | 'edit' | 'approve'
  count: number
  reasonSamples: string[]
  candidateKind: string
  now: string
}): CodexMemoryCandidateInput | undefined {
  if (input.count < 3) {
    return undefined
  }

  const content = input.patternId.includes('transient')
    ? '全局 workflow rule：不要把一次性命令结果、临时测试状态或当前 branch 状态作为 durable memory。'
    : `全局 workflow rule：根据重复 ${input.action} review pattern ${input.patternId} 调整 memory 候选质量。`

  return {
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'soft',
    scope: 'global',
    source: 'review_event',
    candidateKind: 'workflow_rule',
    content,
    normalizedKey: `review-derived-${input.patternId}`,
    evidence: input.reasonSamples.slice(0, 5).map((summary, index) => ({
      summary,
      sourceKind: 'review_event',
      evidenceGroupId: `${input.patternId}-${index}`
    })),
    scores: { evidenceStrength: 0.9, stability: 0.86, usefulness: 0.82, safety: 0.97, sensitivity: 0.03 },
    tags: ['global_capture', 'review_derived']
  }
}

export function candidatesFromReviewEvents(input: {
  events: MemoryEvent[]
  now: string
}): CodexMemoryCandidateInput[] {
  const groups = new Map<string, {
    action: 'reject' | 'edit' | 'approve'
    reasonSamples: string[]
    candidateKind: string
    count: number
  }>()

  for (const event of input.events) {
    const action = reviewActionForEvent(event)
    const patternId = action === undefined ? undefined : reviewPatternIdForEvent(event, action)
    if (patternId === undefined || action === undefined) {
      continue
    }

    const current = groups.get(patternId) ?? { action, reasonSamples: [], candidateKind: 'project_fact', count: 0 }
    groups.set(patternId, {
      action: current.action,
      reasonSamples: [...current.reasonSamples, event.reason].slice(-5),
      candidateKind: typeof event.details?.candidateKind === 'string' ? event.details.candidateKind : current.candidateKind,
      count: current.count + 1
    })
  }

  return [...groups.entries()]
    .flatMap(([patternId, group]) =>
      candidateFromReviewPattern({
        patternId,
        action: group.action,
        count: group.count,
        reasonSamples: group.reasonSamples,
        candidateKind: group.candidateKind,
        now: input.now
      }) ?? []
    )
}

function reviewPatternIdForEvent(event: MemoryEvent, action: 'reject' | 'edit' | 'approve'): string | undefined {
  if (typeof event.details?.reviewPatternId === 'string') {
    return event.details.reviewPatternId
  }
  const candidateKind = typeof event.details?.candidateKind === 'string' ? event.details.candidateKind : undefined
  if (action === 'approve' && candidateKind !== undefined) {
    return `approve-${candidateKind}`
  }
  return undefined
}

function reviewActionForEvent(event: MemoryEvent): 'reject' | 'edit' | 'approve' | undefined {
  if (event.action === 'reject') {
    return 'reject'
  }
  if (event.action === 'update') {
    return 'edit'
  }
  if (event.action === 'pending' && event.details?.reviewAction === 'edit') {
    return 'edit'
  }
  if (event.action === 'promote') {
    return 'approve'
  }
  return undefined
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
