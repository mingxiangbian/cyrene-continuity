import { createHash } from 'node:crypto'
import type { CodexMemoryCandidateInput } from './memory-propose.js'
import type { MemoryEvent } from '../memory/types.js'

const GLOBAL_INSTRUCTION_PATTERN = /(以后所有项目|今后所有项目|所有项目|每个项目|all projects|every project|across projects|remember globally|(?:作为|写入|加入|保存到|记到).{0,8}全局记忆|全局(?:记住|保存|默认|规则|使用))/i
const PERSONAL_PREFERENCE_PATTERN = /\b(i|my|me)\b.*\b(prefer|like|feel|birthday|relationship)\b/i
const AUTOMATION_PROMPT_PATTERN = /^\s*Automation:|\n\s*Automation ID:/i
const QUESTION_OR_DIAGNOSTIC_PATTERN = /[？?]|为什么|为何|怎么|如何|检查一下|排查|bug|出现|是.+吗|why\b|how\b|what\b|debug\b/i
const EXPLICIT_GLOBAL_INSTRUCTION_MAX_LENGTH = 200
const EXPLICIT_GLOBAL_INSTRUCTION_MAX_LINES = 3
const STRUCTURED_CONTEXT_DUMP_PATTERNS = [
  /^#\s+Applications mentioned by the user:/im,
  /^#\s+Files mentioned by the user:/im,
  /^##\s+My request for Codex:/im,
  /<appshot\b/i,
  /<\/appshot>/i,
  /^<environment_context>/im,
  /^<INSTRUCTIONS>/im,
  /```/
]

export function candidateFromExplicitGlobalInstruction(input: {
  text: string
  now: string
}): CodexMemoryCandidateInput | undefined {
  const text = input.text.trim()
  if (AUTOMATION_PROMPT_PATTERN.test(text)) {
    return undefined
  }
  if (isLikelyStructuredContextDump(text) || text.length > EXPLICIT_GLOBAL_INSTRUCTION_MAX_LENGTH) {
    return undefined
  }
  if (!GLOBAL_INSTRUCTION_PATTERN.test(text) || QUESTION_OR_DIAGNOSTIC_PATTERN.test(text)) {
    return undefined
  }
  if (PERSONAL_PREFERENCE_PATTERN.test(text)) {
    return undefined
  }

  const sourceRef = `user_prompt:${input.now}`
  return {
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'global',
    source: 'user_explicit',
    candidateKind: 'user_instruction',
    content: text,
    normalizedKey: `global-instruction-${shortHash(text)}`,
    sourceOfTruth: sourceRef,
    evidence: [
      {
        summary: 'Explicit global instruction from user prompt.',
        sourceKind: 'user_explicit',
        traceRefs: [sourceRef],
        evidenceGroupId: shortHash(`global:${text}`)
      }
    ],
    scores: { evidenceStrength: 0.92, stability: 0.88, usefulness: 0.85, safety: 0.96, sensitivity: 0.05 },
    tags: ['global_capture', 'explicit_instruction'],
    userConfirmed: true
  }
}

function isLikelyStructuredContextDump(text: string): boolean {
  if (STRUCTURED_CONTEXT_DUMP_PATTERNS.some((pattern) => pattern.test(text))) {
    return true
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length > EXPLICIT_GLOBAL_INSTRUCTION_MAX_LINES) {
    return true
  }

  const markupTagCount = text.match(/<\/?[a-z][^>\n]{0,120}>/gi)?.length ?? 0
  if (markupTagCount >= 2) {
    return true
  }

  const metadataLabelCount = text.match(/\b(?:app|bundle-identifier|window-title|image|url|description|value|role|content|cwd|shell|workdir|container|button|link|text)\s*[:=]/gi)?.length ?? 0
  if (metadataLabelCount >= 4) {
    return true
  }

  const jsonLikeFieldCount = text.match(/["'][A-Za-z0-9_-]{3,}["']\s*:/g)?.length ?? 0
  return jsonLikeFieldCount >= 4
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
