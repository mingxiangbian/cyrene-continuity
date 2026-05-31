import type { MemoryCandidateKind, MemoryDomain, MemoryType } from '../memory/types.js'

export const ACTIVE_MEMORY_READINESS_REASONS = [
  'implementation_note',
  'raw_file_rule_excerpt',
  'overbroad_workflow_rule',
  'needs_active_memory_rewrite'
] as const

export type ActiveMemoryReadinessReason = typeof ACTIVE_MEMORY_READINESS_REASONS[number]

export interface ActiveMemoryReadinessInput {
  content: string
  candidateKind?: MemoryCandidateKind
  domain?: MemoryDomain
  type?: MemoryType
  tags?: string[]
}

export interface ActiveMemoryReadinessResult {
  ready: boolean
  reasons: ActiveMemoryReadinessReason[]
}

const VERSION_OR_SESSION_PATTERN = /(?:\bv\d+(?:\.\d+)*\b|本轮|这次|当前|目前|刚刚|today|this round|current)/i
const IMPLEMENTATION_NOTE_PATTERN =
  /(?:核心实现|实现采用|采用.+执行方案|创建隔离工作区|created.+worktree|used.+workflow|implementation used)/i
const FILE_RULE_EXCERPT_PATTERN =
  /\b(?:AGENTS\.md|README\.md|CONTRIBUTING\.md|package\.json|tsconfig\.json)\b.*(?:中规定|定义|要求|states?|says?|requires?)/i
const SOURCE_OF_TRUTH_PATTERN = /(?:source of truth|source-of-truth|source_of_truth|事实来源|权威来源)/i
const OVERBROAD_EDIT_RULE_PATTERN =
  /(?:所有|每次|all|every).{0,16}(?:修改|更改|edits?|changes?).{0,32}(?:issue|task|任务|手术|surgical|trace|追溯)/i
const NON_TRIVIAL_QUALIFIER_PATTERN = /(?:non-trivial|非琐碎|非平凡|非简单|代码\/架构|code or architecture)/i

export function evaluateActiveMemoryReadiness(input: ActiveMemoryReadinessInput): ActiveMemoryReadinessResult {
  const reasons: ActiveMemoryReadinessReason[] = []
  if (isImplementationNote(input)) {
    reasons.push('implementation_note')
  }
  if (isRawFileRuleExcerpt(input)) {
    reasons.push('raw_file_rule_excerpt')
  }
  if (isOverbroadWorkflowRule(input)) {
    reasons.push('overbroad_workflow_rule')
  }
  if (reasons.length > 0) {
    reasons.push('needs_active_memory_rewrite')
  }

  return {
    ready: reasons.length === 0,
    reasons: Array.from(new Set(reasons))
  }
}

function isImplementationNote(input: ActiveMemoryReadinessInput): boolean {
  const kind = input.candidateKind
  const projectLike = kind === 'project_fact' || kind === 'project_decision' || input.domain === 'project'
  return projectLike && VERSION_OR_SESSION_PATTERN.test(input.content) && IMPLEMENTATION_NOTE_PATTERN.test(input.content)
}

function isRawFileRuleExcerpt(input: ActiveMemoryReadinessInput): boolean {
  return FILE_RULE_EXCERPT_PATTERN.test(input.content) && !SOURCE_OF_TRUTH_PATTERN.test(input.content)
}

function isOverbroadWorkflowRule(input: ActiveMemoryReadinessInput): boolean {
  const workflowLike = input.candidateKind === 'workflow_rule' || input.type === 'procedural_rule'
  return workflowLike &&
    OVERBROAD_EDIT_RULE_PATTERN.test(input.content) &&
    !NON_TRIVIAL_QUALIFIER_PATTERN.test(input.content)
}
