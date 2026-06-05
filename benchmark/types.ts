export const EXECUTION_PROFILES = ['smoke', 'gate', 'full', 'scale', 'llm', 'external'] as const
export type BenchmarkProfile = typeof EXECUTION_PROFILES[number]

export const BENCHMARK_TIERS = ['tier0', 'tier1', 'tier1_5', 'tier1_6', 'tier2', 'tier3', 'tier4'] as const
export type BenchmarkTier = typeof BENCHMARK_TIERS[number]

export const BENCHMARK_METRIC_IDS = [
  'abstentionAccuracy',
  'adapterAvailability',
  'answerAccuracy',
  'balancedTokenOverhead',
  'benchmarkRuntimeMs',
  'boundarySafetyRate',
  'continuityGetLatencyMs',
  'continuityGetP50Ms',
  'continuityGetP95BalancedMs',
  'continuityGetP95FastMs',
  'continuityGetP95Ms',
  'continuityGetP95ReviewMs',
  'continuityGetP99Ms',
  'crossProjectPollutionRate',
  'fastTokenOverhead',
  'conflictResolutionAccuracy',
  'hookLatencyMs',
  'indexStaleRate',
  'irrelevantRetrievalRate',
  'jsonlFallbackRateHotPath',
  'lifecyclePromotionAccuracy',
  'memoryDbBytesPerMemory',
  'memoryDbSizeBytes',
  'modeAccuracy',
  'mrr',
  'pendingLeakageRate',
  'pendingMisuseRate',
  'postToolUseHookP95Ms',
  'profilePollutionRate',
  'recallAt3',
  'repeatedMistakeReduction',
  'retrievalAccuracy',
  'retrievedDefaultWriteRate',
  'reviewTokenOverhead',
  'scaleLRuntimeMs',
  'scaleMRuntimeMs',
  'scaleSRuntimeMs',
  'scaleXLRuntimeMs',
  'similarHintMigrationRate',
  'similarMemoryInterferenceRate',
  'sqliteHitRate',
  'sqliteHitRateFreshIndex',
  'sqliteQueryP95Ms',
  'stopHookP95Ms',
  'surfaceConsistencyRate',
  'taskSuccessRate',
  'tokenOverhead',
  'toolCallCount',
  'toolCallReduction',
  'updateAccuracy',
  'userCorrectionReduction',
  'withMemoryTaskSuccessRate',
  'wrongTop1Rate'
] as const
export type BenchmarkMetricId = typeof BENCHMARK_METRIC_IDS[number]

export const HARD_GATE_RULE_IDS = [
  'fixture_isolation_violation',
  'real_user_memory_read_write',
  'cross_case_mutable_state_reuse',
  'non_deterministic_fixture_generation',
  'pending_leakage',
  'pending_misuse',
  'cross_project_pollution',
  'unauthorized_promotion',
  'similar_hint_migration',
  'session_hint_migration',
  'profile_pollution',
  'secret_persistence',
  'prompt_injection_memory_write',
  'wrong_namespace_routing',
  'pending_active_bypass',
  'hash_bypass',
  'stale_approval_success',
  'rejected_memory_activation',
  'forbidden_context_injection',
  'duplicate_context_injection',
  'conflicting_context_injection',
  'retrieved_default_write',
  'hot_path_summary_generation',
  'pending_in_fast_summary',
  'similar_hint_in_fast_summary',
  'index_source_mismatch',
  'undetected_stale_index',
  'hot_path_rebuild',
  'post_tool_use_heavy_operation',
  'hook_timeout_crash',
  'ordinary_hook_pending_review',
  'jsonl_hot_path_fallback',
  'surface_contract_mismatch',
  'expired_memory_injection',
  'incorrect_memory_answer',
  'fabricated_evidence',
  'repeated_mistake_not_reduced',
  'workflow_rule_ignored',
  'latency_threshold_breach',
  'security_boundary_violation'
] as const
export type HardGateRuleId = typeof HARD_GATE_RULE_IDS[number]

export type BenchmarkActionKind = 'direct' | 'cli' | 'mcp' | 'replay' | 'adapter'
export type BenchmarkCaseStatus = 'passed' | 'failed' | 'skipped_with_reason' | 'not_supported_without_provider'

export interface BenchmarkFixtureSpec {
  isolation: string
  seed: string
  now: string
  timezone: 'UTC'
  groundTruth: readonly string[]
  expectedContext: readonly string[]
  expectedForbiddenContent: readonly string[]
  expectedMode?: 'fast' | 'balanced' | 'review'
  expectedMetrics: readonly BenchmarkMetricId[]
  passFailRule: readonly HardGateRuleId[]
}

export interface BenchmarkActionSpec {
  kind: BenchmarkActionKind
  entrypoint: string
  description: string
}

export interface BenchmarkAdapterSpec {
  kind: 'deterministic' | 'llm' | 'external'
  provider?: string
  requiredEnv?: string[]
  requiredCommands?: string[]
  supportsDeterministicReplay?: boolean
}

export interface BenchmarkCase {
  id: string
  tier: BenchmarkTier
  title: string
  executionProfiles: readonly BenchmarkProfile[]
  fixture: BenchmarkFixtureSpec
  action: BenchmarkActionSpec
  expected: readonly string[]
  forbidden: readonly string[]
  metrics: readonly BenchmarkMetricId[]
  passFail: readonly HardGateRuleId[]
  adapter?: BenchmarkAdapterSpec
}

export interface BenchmarkMetric {
  name: BenchmarkMetricId
  value: number
  unit?: string
}

export interface BenchmarkEvidence {
  summary: string
  detail?: unknown
}

export interface BenchmarkCaseResult {
  caseId: string
  title: string
  tier: BenchmarkTier
  status: BenchmarkCaseStatus
  passed: boolean
  hardFailures: readonly HardGateRuleId[]
  metrics: readonly BenchmarkMetric[]
  evidence: readonly BenchmarkEvidence[]
  skippedReason?: string
  thresholdBreaches: readonly BenchmarkThresholdBreach[]
}

export interface BenchmarkThreshold {
  metric: BenchmarkMetricId
  operator: '<=' | '>=' | '='
  value: number
  profiles: readonly BenchmarkProfile[]
}

export interface BenchmarkThresholdBreach {
  caseId: string
  metric: BenchmarkMetricId
  actual: number
  threshold: string
}

export interface BenchmarkReport {
  runId: string
  startedAt: string
  finishedAt: string
  profile: BenchmarkProfile
  passed: boolean
  summary: {
    total: number
    passed: number
    failed: number
    skipped: number
    notSupported: number
  }
  metadata: {
    specPath: string
    specHash: string
    benchmarkVersion: string
    thresholdVersion: string
    packageVersion: string
    nodeVersion: string
    platform: string
    arch: string
    gitBranch: string
    gitCommit: string
    gitDirty: boolean
  }
  cases: readonly BenchmarkCaseResult[]
  hardFailures: readonly HardGateRuleId[]
  thresholdBreaches: readonly BenchmarkThresholdBreach[]
}
