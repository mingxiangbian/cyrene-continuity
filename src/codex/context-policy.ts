export const CONTEXT_MODES = ['fast', 'balanced', 'review'] as const
export type ContextMode = typeof CONTEXT_MODES[number]
export type ContextPolicyTask = 'coding' | 'planning' | 'debugging' | 'conversation' | 'memory'

export interface RetrievalPolicyFlags {
  includePendingDetails?: boolean
  includePendingNotice?: boolean
  includeDiagnostics?: boolean
  includeSimilarProjectHints?: boolean
  includeSessionHints?: boolean
  includeFullProfile?: boolean
  includeFastSummaries?: boolean
  recordRetrievedEvents?: boolean
  allowJsonlFallback?: boolean
  maxTokens?: number
}

export interface RetrievalPolicy {
  mode: ContextMode
  maxTokens: number
  includePendingDetails: boolean
  includePendingNotice: boolean
  includeDiagnostics: boolean
  includeSimilarProjectHints: boolean
  includeSessionHints: boolean
  includeFullProfile: boolean
  includeFastSummaries: boolean
  recordRetrievedEvents: boolean
  allowJsonlFallback: boolean
  candidateHintBudget: number
  allowHotPathIndexRebuild: false
}

export interface BuildRetrievalPolicyInput extends RetrievalPolicyFlags {
  mode?: ContextMode | string
  task?: ContextPolicyTask
  userMessage?: string
  env?: NodeJS.ProcessEnv
}

const MODE_DEFAULTS: Record<ContextMode, RetrievalPolicy> = {
  fast: {
    mode: 'fast',
    maxTokens: 800,
    includePendingDetails: false,
    includePendingNotice: false,
    includeDiagnostics: false,
    includeSimilarProjectHints: false,
    includeSessionHints: false,
    includeFullProfile: false,
    includeFastSummaries: true,
    recordRetrievedEvents: false,
    allowJsonlFallback: false,
    candidateHintBudget: 0,
    allowHotPathIndexRebuild: false
  },
  balanced: {
    mode: 'balanced',
    maxTokens: 1200,
    includePendingDetails: false,
    includePendingNotice: false,
    includeDiagnostics: false,
    includeSimilarProjectHints: false,
    includeSessionHints: true,
    includeFullProfile: true,
    includeFastSummaries: false,
    recordRetrievedEvents: false,
    allowJsonlFallback: true,
    candidateHintBudget: 1,
    allowHotPathIndexRebuild: false
  },
  review: {
    mode: 'review',
    maxTokens: 4000,
    includePendingDetails: true,
    includePendingNotice: true,
    includeDiagnostics: true,
    includeSimilarProjectHints: false,
    includeSessionHints: true,
    includeFullProfile: true,
    includeFastSummaries: false,
    recordRetrievedEvents: false,
    allowJsonlFallback: true,
    candidateHintBudget: 3,
    allowHotPathIndexRebuild: false
  }
}

export function parseContextMode(value: string | undefined): ContextMode | undefined {
  if (value === undefined || value === '') {
    return undefined
  }
  if (value === 'fast' || value === 'balanced' || value === 'review') {
    return value
  }
  throw new Error(`Invalid context mode: ${value}. Expected fast, balanced, or review`)
}

export function buildRetrievalPolicy(input: BuildRetrievalPolicyInput): RetrievalPolicy {
  const env = input.env ?? process.env
  const envFlags = definedOnly(envPolicyFlags(env))
  const explicitFlags = definedOnly({
    maxTokens: input.maxTokens,
    includePendingDetails: input.includePendingDetails,
    includePendingNotice: input.includePendingNotice,
    includeDiagnostics: input.includeDiagnostics,
    includeSimilarProjectHints: input.includeSimilarProjectHints,
    includeSessionHints: input.includeSessionHints,
    includeFullProfile: input.includeFullProfile,
    includeFastSummaries: input.includeFastSummaries,
    recordRetrievedEvents: input.recordRetrievedEvents,
    allowJsonlFallback: input.allowJsonlFallback
  })
  const mode = parseContextMode(input.mode) ??
    parseContextMode(env.CYRENE_CONTEXT_MODE) ??
    inferContextMode({
      ...envFlags,
      ...explicitFlags,
      task: input.task,
      userMessage: input.userMessage
    }) ??
    'fast'
  return enforceModeGates({
    ...MODE_DEFAULTS[mode],
    ...envFlags,
    ...explicitFlags,
    mode,
    allowHotPathIndexRebuild: false
  })
}

function enforceModeGates(policy: RetrievalPolicy): RetrievalPolicy {
  if (policy.mode === 'review') {
    return policy
  }
  return {
    ...policy,
    includePendingDetails: false,
    includePendingNotice: false,
    ...(policy.mode === 'fast' ? { allowJsonlFallback: false } : {})
  }
}

export function inferContextMode(input: Pick<BuildRetrievalPolicyInput, 'task' | 'userMessage'> & RetrievalPolicyFlags): ContextMode | undefined {
  if (
    input.includePendingDetails === true ||
    input.includePendingNotice === true
  ) {
    return 'review'
  }

  const message = normalizeMessage(input.userMessage)
  if (hasReviewSignal(message)) {
    return 'review'
  }
  if (input.task === 'memory') {
    return 'review'
  }
  if (input.includeDiagnostics === true || input.includeSimilarProjectHints === true) {
    return 'balanced'
  }
  if (hasBalancedSignal(message)) {
    return 'balanced'
  }
  if (input.task === 'planning' || input.task === 'debugging') {
    return 'balanced'
  }
  return undefined
}

function envPolicyFlags(env: NodeJS.ProcessEnv): RetrievalPolicyFlags {
  return {
    maxTokens: parsePositiveInteger(env.CYRENE_CONTEXT_MAX_TOKENS),
    includePendingDetails: parseBoolean(env.CYRENE_CONTEXT_INCLUDE_PENDING_DETAILS),
    includePendingNotice: parseBoolean(env.CYRENE_CONTEXT_INCLUDE_PENDING_NOTICE),
    includeDiagnostics: parseBoolean(env.CYRENE_CONTEXT_INCLUDE_DIAGNOSTICS),
    includeSimilarProjectHints: parseBoolean(env.CYRENE_CONTEXT_INCLUDE_SIMILAR_PROJECT_HINTS),
    includeSessionHints: parseBoolean(env.CYRENE_CONTEXT_INCLUDE_SESSION_HINTS),
    includeFullProfile: parseBoolean(env.CYRENE_CONTEXT_INCLUDE_FULL_PROFILE),
    includeFastSummaries: parseBoolean(env.CYRENE_CONTEXT_INCLUDE_FAST_SUMMARIES),
    recordRetrievedEvents: parseBoolean(env.CYRENE_CONTEXT_RECORD_RETRIEVED_EVENTS),
    allowJsonlFallback: parseBoolean(env.CYRENE_CONTEXT_ALLOW_JSONL_FALLBACK)
  }
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') {
    return undefined
  }
  if (value === 'true' || value === '1') {
    return true
  }
  if (value === 'false' || value === '0') {
    return false
  }
  throw new Error(`Invalid boolean environment value: ${value}`)
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined
  }
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }
  throw new Error(`Invalid positive integer environment value: ${value}`)
}

function normalizeMessage(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function hasReviewSignal(message: string): boolean {
  return /(?:pending (?:memory|candidate|review)|review pending|pending review|review queue|memory review|review memory|approve|reject|defer|review-hash|automation|profile apply|profile candidate|审核|审批|待审核|记忆评审|记忆审核|自动化|应用 profile|应用档案)/i.test(message)
}

function hasBalancedSignal(message: string): boolean {
  return /(?:plan|planning|implementation plan|spec|architecture|design|roadmap|code review|review this|debug|debugging|root cause|similar project|project start|new project|计划|规划|方案|规格|架构|设计|路线图|代码评审|排查|调试|类似项目|相似项目|新项目)/i.test(message)
}

function definedOnly<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}
