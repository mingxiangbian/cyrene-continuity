import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSafeMemoryDataFileTarget } from '../memory/memory-store.js'

const RUNTIME_METRICS_FILE = 'runtime_metrics.jsonl'
const RUNTIME_METRIC_EVENTS = new Set<string>(['continuity_get', 'hook'])
const CONTEXT_MODES = new Set<string>(['fast', 'balanced', 'review'])
const HOOK_EVENTS = new Set<string>(['session_start', 'user_prompt_submit', 'post_tool_use', 'stop'])

export interface RuntimeMetricEvent {
  event: 'continuity_get' | 'hook'
  mode?: 'fast' | 'balanced' | 'review'
  latencyMs: number
  sqliteLatencyMs?: number
  similarLatencyMs?: number
  pendingLatencyMs?: number
  profileReadLatencyMs?: number
  candidateHintLatencyMs?: number
  candidateHintEligibleCount?: number
  candidateHintRelevantCount?: number
  candidateHintSelectedCount?: number
  candidateHintTimeoutCount?: number
  candidateHintSuppressedByLatencyCount?: number
  tokenOverhead?: number
  jsonlFallback?: boolean
  indexStale?: boolean
  hookEvent?: 'session_start' | 'user_prompt_submit' | 'post_tool_use' | 'stop'
  createdAt: string
}

export async function appendRuntimeMetric(memoryRoot: string, metric: RuntimeMetricEvent): Promise<void> {
  await mkdir(memoryRoot, { recursive: true })
  const targetPath = join(memoryRoot, RUNTIME_METRICS_FILE)
  await assertSafeMemoryDataFileTarget(targetPath)
  await appendFile(targetPath, `${JSON.stringify(runtimeMetricRecord(metric))}\n`, 'utf8')
}

export async function readRuntimeMetrics(memoryRoot: string): Promise<RuntimeMetricEvent[]> {
  const targetPath = join(memoryRoot, RUNTIME_METRICS_FILE)
  await assertSafeMemoryDataFileTarget(targetPath)

  let content: string
  try {
    content = await readFile(targetPath, 'utf8')
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) return []
    throw error
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown
        return isRuntimeMetricEvent(parsed) ? [parsed] : []
      } catch {
        return []
      }
    })
}

function runtimeMetricRecord(metric: RuntimeMetricEvent): RuntimeMetricEvent {
  return {
    event: metric.event,
    ...(metric.mode === undefined ? {} : { mode: metric.mode }),
    latencyMs: metric.latencyMs,
    ...(metric.sqliteLatencyMs === undefined ? {} : { sqliteLatencyMs: metric.sqliteLatencyMs }),
    ...(metric.similarLatencyMs === undefined ? {} : { similarLatencyMs: metric.similarLatencyMs }),
    ...(metric.pendingLatencyMs === undefined ? {} : { pendingLatencyMs: metric.pendingLatencyMs }),
    ...(metric.profileReadLatencyMs === undefined ? {} : { profileReadLatencyMs: metric.profileReadLatencyMs }),
    ...(metric.candidateHintLatencyMs === undefined ? {} : { candidateHintLatencyMs: metric.candidateHintLatencyMs }),
    ...(metric.candidateHintEligibleCount === undefined ? {} : { candidateHintEligibleCount: metric.candidateHintEligibleCount }),
    ...(metric.candidateHintRelevantCount === undefined ? {} : { candidateHintRelevantCount: metric.candidateHintRelevantCount }),
    ...(metric.candidateHintSelectedCount === undefined ? {} : { candidateHintSelectedCount: metric.candidateHintSelectedCount }),
    ...(metric.candidateHintTimeoutCount === undefined ? {} : { candidateHintTimeoutCount: metric.candidateHintTimeoutCount }),
    ...(metric.candidateHintSuppressedByLatencyCount === undefined
      ? {}
      : { candidateHintSuppressedByLatencyCount: metric.candidateHintSuppressedByLatencyCount }),
    ...(metric.tokenOverhead === undefined ? {} : { tokenOverhead: metric.tokenOverhead }),
    ...(metric.jsonlFallback === undefined ? {} : { jsonlFallback: metric.jsonlFallback }),
    ...(metric.indexStale === undefined ? {} : { indexStale: metric.indexStale }),
    ...(metric.hookEvent === undefined ? {} : { hookEvent: metric.hookEvent }),
    createdAt: metric.createdAt
  }
}

function isRuntimeMetricEvent(value: unknown): value is RuntimeMetricEvent {
  if (!isPlainRecord(value)) {
    return false
  }

  return (
    typeof value.event === 'string' &&
    RUNTIME_METRIC_EVENTS.has(value.event) &&
    isOptionalContextMode(value.mode) &&
    typeof value.latencyMs === 'number' &&
    isOptionalNumber(value.sqliteLatencyMs) &&
    isOptionalNumber(value.similarLatencyMs) &&
    isOptionalNumber(value.pendingLatencyMs) &&
    isOptionalNumber(value.profileReadLatencyMs) &&
    isOptionalNumber(value.candidateHintLatencyMs) &&
    isOptionalNumber(value.candidateHintEligibleCount) &&
    isOptionalNumber(value.candidateHintRelevantCount) &&
    isOptionalNumber(value.candidateHintSelectedCount) &&
    isOptionalNumber(value.candidateHintTimeoutCount) &&
    isOptionalNumber(value.candidateHintSuppressedByLatencyCount) &&
    isOptionalNumber(value.tokenOverhead) &&
    isOptionalBoolean(value.jsonlFallback) &&
    isOptionalBoolean(value.indexStale) &&
    isOptionalHookEvent(value.hookEvent) &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt))
  )
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOptionalContextMode(value: unknown): value is RuntimeMetricEvent['mode'] {
  return value === undefined || (typeof value === 'string' && CONTEXT_MODES.has(value))
}

function isOptionalHookEvent(value: unknown): value is RuntimeMetricEvent['hookEvent'] {
  return value === undefined || (typeof value === 'string' && HOOK_EVENTS.has(value))
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === 'number'
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean'
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
