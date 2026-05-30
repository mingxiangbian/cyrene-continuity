import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export interface ModelConfig {
  baseUrl: string
  model: string
  apiKey?: string
  temperature: number
  strongModel: string
  cheapModel: string
}

export interface AppConfig {
  cwd: string
  memoryCwd: string
  model: ModelConfig
  userCyreneDir: string
  memoryAutoExtractEnabled: boolean
  memoryRecommendPromotionEnabled: boolean
  deprecatedMemoryAutoPromoteConfigured: boolean
  memoryAutoReviewProjectPromotePerDay: number
  memoryAutoReviewGlobalPromotePerDay: number
  memoryActiveMaxItems: number
  memoryActiveContentMaxChars: number
  memoryIndexFileMaxChars: number
  memorySingleContentMaxChars: number
  memorySingleEvidenceMaxChars: number
  memoryPendingMaxItems: number
  memoryPendingMaxItemsProject: number
  memoryPendingMaxItemsGlobal: number
  memoryPendingProtectedMaxAgeDays: number
  memoryProfileMaxChars: number
  memoryProfileAlwaysOnEnabled: boolean
  memoryMaintenanceSnapshotsMax: number
  memoryDreamEnabled: boolean
  memoryDreamIntervalHours: number
  memoryDreamCatchUpEnabled: boolean
  memoryDreamLockTtlMs: number
  memoryDreamMaxRuntimeMs: number
  memoryDreamModel?: string
  llmRequestTimeoutMs: number
  llmRetryMaxAttempts: number
  llmRetryBaseDelayMs: number
}

export function createDefaultConfig(cwd: string): AppConfig {
  const dotEnv = loadDotEnv(cwd)
  const baseUrl = envValue(dotEnv, 'CYRENE_BASE_URL') ?? ''
  const model = envValue(dotEnv, 'CYRENE_MODEL') ?? ''
  const strongModel = optionalEnvValue(dotEnv, 'CYRENE_STRONG_MODEL') ?? model
  const cheapModel = optionalEnvValue(dotEnv, 'CYRENE_CHEAP_MODEL') ?? strongModel
  return {
    cwd,
    memoryCwd: cwd,
    model: {
      baseUrl,
      model,
      apiKey: optionalEnvValue(dotEnv, 'CYRENE_API_KEY'),
      temperature: 0,
      strongModel,
      cheapModel
    },
    userCyreneDir: join(homedir(), '.cyrene'),
    memoryAutoExtractEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_MEMORY_AUTO_EXTRACT'), true),
    memoryRecommendPromotionEnabled: parseBooleanEnv(
      envValue(dotEnv, 'CYRENE_MEMORY_RECOMMEND_PROMOTION') ?? envValue(dotEnv, 'CYRENE_MEMORY_AUTO_PROMOTE'),
      true
    ),
    deprecatedMemoryAutoPromoteConfigured: envValue(dotEnv, 'CYRENE_MEMORY_AUTO_PROMOTE') !== undefined,
    memoryAutoReviewProjectPromotePerDay: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_AUTO_REVIEW_PROJECT_PROMOTE_PER_DAY'), 5),
    memoryAutoReviewGlobalPromotePerDay: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_AUTO_REVIEW_GLOBAL_PROMOTE_PER_DAY'), 1),
    memoryActiveMaxItems: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_ACTIVE_MAX_ITEMS'), 300),
    memoryActiveContentMaxChars: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_ACTIVE_CONTENT_MAX_CHARS'), 50000),
    memoryIndexFileMaxChars: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_INDEX_FILE_MAX_CHARS'), 250000),
    memorySingleContentMaxChars: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_SINGLE_CONTENT_MAX_CHARS'), 300),
    memorySingleEvidenceMaxChars: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_SINGLE_EVIDENCE_MAX_CHARS'), 1000),
    memoryPendingMaxItems: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_PENDING_MAX_ITEMS'), 100),
    memoryPendingMaxItemsProject: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_PENDING_MAX_ITEMS_PROJECT'), 200),
    memoryPendingMaxItemsGlobal: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_PENDING_MAX_ITEMS_GLOBAL'), 100),
    memoryPendingProtectedMaxAgeDays: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_PENDING_PROTECTED_MAX_AGE_DAYS'), 30),
    memoryProfileMaxChars: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_PROFILE_MAX_CHARS'), 6000),
    memoryProfileAlwaysOnEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_MEMORY_PROFILE_ALWAYS_ON'), true),
    memoryMaintenanceSnapshotsMax: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_MAINTENANCE_SNAPSHOTS_MAX'), 20),
    memoryDreamEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_MEMORY_DREAM_ENABLED'), true),
    memoryDreamIntervalHours: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_DREAM_INTERVAL_HOURS'), 24),
    memoryDreamCatchUpEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_MEMORY_DREAM_CATCH_UP'), true),
    memoryDreamLockTtlMs: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_DREAM_LOCK_TTL_MS'), 15 * 60 * 1000),
    memoryDreamMaxRuntimeMs: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_MEMORY_DREAM_MAX_RUNTIME_MS'), 60000),
    memoryDreamModel: optionalEnvValue(dotEnv, 'CYRENE_MEMORY_DREAM_MODEL'),
    llmRequestTimeoutMs: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_LLM_REQUEST_TIMEOUT_MS'), 180000),
    llmRetryMaxAttempts: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_LLM_RETRY_MAX_ATTEMPTS'), 3),
    llmRetryBaseDelayMs: parsePositiveIntEnv(envValue(dotEnv, 'CYRENE_LLM_RETRY_BASE_DELAY_MS'), 1000)
  }
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())
}

function parsePositiveIntEnv(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue
}

function loadDotEnv(cwd: string): Record<string, string> {
  let currentDir = resolve(cwd)
  while (true) {
    try {
      return parseDotEnv(readFileSync(join(currentDir, '.env'), 'utf8'))
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error
    }
    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) return {}
    currentDir = parentDir
  }
}

function parseDotEnv(raw: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed)
    if (match !== null) values[match[1]] = unquoteEnvValue(match[2].trim())
  }
  return values
}

function unquoteEnvValue(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function envValue(dotEnv: Record<string, string>, name: string): string | undefined {
  return process.env[name] ?? dotEnv[name]
}

function optionalEnvValue(dotEnv: Record<string, string>, name: string): string | undefined {
  const value = envValue(dotEnv, name)
  return value?.trim() === '' ? undefined : value
}
