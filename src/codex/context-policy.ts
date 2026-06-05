export const CONTEXT_MODES = ['fast', 'balanced', 'review'] as const
export type ContextMode = typeof CONTEXT_MODES[number]

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
  allowHotPathIndexRebuild: false
}

export interface BuildRetrievalPolicyInput extends RetrievalPolicyFlags {
  mode?: ContextMode | string
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
    allowJsonlFallback: true,
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
    includeFullProfile: false,
    includeFastSummaries: false,
    recordRetrievedEvents: false,
    allowJsonlFallback: true,
    allowHotPathIndexRebuild: false
  },
  review: {
    mode: 'review',
    maxTokens: 4000,
    includePendingDetails: true,
    includePendingNotice: true,
    includeDiagnostics: true,
    includeSimilarProjectHints: true,
    includeSessionHints: true,
    includeFullProfile: true,
    includeFastSummaries: false,
    recordRetrievedEvents: false,
    allowJsonlFallback: true,
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
  const mode = parseContextMode(input.mode) ?? parseContextMode(env.CYRENE_CONTEXT_MODE) ?? 'fast'
  return {
    ...MODE_DEFAULTS[mode],
    ...definedOnly(envPolicyFlags(env)),
    ...definedOnly({
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
    }),
    mode,
    allowHotPathIndexRebuild: false
  }
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

function definedOnly<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}
