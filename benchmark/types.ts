export const EXECUTION_PROFILES = ['smoke', 'gate', 'full', 'scale', 'real-replay', 'llm', 'external'] as const
export type BenchmarkProfile = typeof EXECUTION_PROFILES[number]

export const BENCHMARK_TIERS = ['tier0', 'tier1', 'tier1_5', 'tier1_6', 'tier2', 'tier3', 'tier4'] as const
export type BenchmarkTier = typeof BENCHMARK_TIERS[number]

export const BENCHMARK_METRIC_IDS = [
  'abstentionAccuracy',
  'adapterAvailability',
  'answerAccuracy',
  'balancedTokenOverhead',
  'balancedDiagnosticsTokens',
  'balancedPendingTokens',
  'benchmarkRuntimeMs',
  'boundarySafetyRate',
  'continuityGetLatencyMs',
  'continuityGetMaxMs',
  'continuityGetMeanMs',
  'continuityGetMinMs',
  'continuityGetP50BalancedMs',
  'continuityGetP50FastMs',
  'continuityGetP50Ms',
  'continuityGetP95BalancedMs',
  'continuityGetP95FastMs',
  'continuityGetP95Ms',
  'continuityGetP95ReviewMs',
  'continuityGetP50ReviewMs',
  'continuityGetP99BalancedMs',
  'continuityGetP99FastMs',
  'continuityGetP99Ms',
  'continuityGetP99ReviewMs',
  'continuityGetSampleCount',
  'contextItemCount',
  'crossProjectPollutionRate',
  'fastTokenOverhead',
  'conflictResolutionAccuracy',
  'activeMemoryGrowthPerRun',
  'activationEventGrowth',
  'approveCount',
  'assistantInferenceAutoActiveRate',
  'auditLogGrowth',
  'averageReviewTimeMs',
  'automationInterruptRecoveryTimeMs',
  'dailyAutomationRuntimeMs',
  'dailyPromotedCount',
  'dbRebuildTimeMs',
  'deferCount',
  'diagnosticsAssemblyLatencyMs',
  'diagnosticsItemCount',
  'diagnosticsTokens',
  'dryRunWriteCount',
  'duplicateActiveMemoryRate',
  'duplicateAutomationOutputCount',
  'duplicatePendingRate',
  'editCount',
  'fastSummaryReadLatencyMs',
  'fastSummarySizeGrowthBytes',
  'fastSummaryTokens',
  'fastDiagnosticsTokens',
  'fastPendingTokens',
  'feedbackEventGrowth',
  'fullProfileTokens',
  'globalProfileTokens',
  'hookFailOpenCount',
  'hookLatencyMs',
  'hookSampleCount',
  'hookTimeoutCount',
  'hotPathRebuildCount',
  'importantMemoryMissedRate',
  'indexRebuildTimeMs',
  'indexSourceMismatchCount',
  'indexStaleRate',
  'irrelevantRetrievalRate',
  'jsonlSizeBytes',
  'jsonlRecordCount',
  'jsonlFallbackRateHotPath',
  'lifecyclePromotionAccuracy',
  'manualReviewCount',
  'memoryDbBytesPerMemory',
  'memoryDbSizeBytes',
  'memoryItemCount',
  'materializedActiveMemoryCount',
  'materializedPendingMemoryCount',
  'materializedProjectCount',
  'mergeAccuracy',
  'modeAccuracy',
  'mrr',
  'newMemoryRetrievalRate',
  'noMemoryTaskSuccessRate',
  'noiseProposalRate',
  'oldMemoryRetrievalRate',
  'ordinaryHookPendingReviewCount',
  'pendingCandidatesPerDay',
  'pendingCandidatesPerSession',
  'pendingGeneratedCount',
  'pendingLeakageRate',
  'pendingMisuseRate',
  'pendingGrowthPerRun',
  'pendingQueryLatencyMs',
  'pendingReviewedCount',
  'pendingTokens',
  'runtimeHookFailOpenCount',
  'runtimeHookTimeoutCount',
  'runtimeSourceIsMaterialized',
  'postToolUseHeavyOperationCount',
  'postToolUseHookP50Ms',
  'postToolUseHookP95Ms',
  'postToolUseHookP99Ms',
  'profileReadLatencyMs',
  'profilePollutionRate',
  'profileSectionCount',
  'profileSizeGrowthBytes',
  'projectMemoryTokens',
  'promotionAccuracy',
  'proposalPrecision',
  'proposalRecall',
  'recallAt1',
  'recallAt3',
  'recallAt5',
  'rejectCount',
  'rejectedCandidateRecurrenceRate',
  'repeatedMistakeReduction',
  'repeatedPromotionCount',
  'replacementAccuracy',
  'retrievalAccuracy',
  'retrievedDefaultWriteRate',
  'reviewTokenOverhead',
  'reviewDiagnosticsTokens',
  'reviewPendingTokens',
  'reviewFalsePositiveRate',
  'rollbackSuccessRate',
  'scaleLRuntimeMs',
  'scaleMRuntimeMs',
  'scaleSRuntimeMs',
  'scaleXLRuntimeMs',
  'sensitiveProposalRate',
  'sessionHintsCount',
  'sessionHintsReadLatencyMs',
  'sessionHintsSizeBytes',
  'sessionHintsTokens',
  'sessionStartHookP50Ms',
  'sessionStartHookP95Ms',
  'sessionStartHookP99Ms',
  'similarHintMigrationRate',
  'similarHintsTokens',
  'similarMemoryInterferenceRate',
  'similarQueryLatencyMs',
  'simulatedHookFailOpenCount',
  'simulatedHookTimeoutCount',
  'sqliteIndexedActiveCount',
  'sqliteIndexedPendingCount',
  'sqliteHitRate',
  'sqliteHitRateFreshIndex',
  'sqliteQueryP95Ms',
  'staleMemoryLeakageRate',
  'staleMemoryRetrievalRate',
  'stalePendingCount',
  'stopHookP50Ms',
  'stopHookP95Ms',
  'stopHookP99Ms',
  'summaryStalePropagationAccuracy',
  'surfaceConsistencyRate',
  'taskSuccessRate',
  'targetActiveMemoryCount',
  'targetPendingMemoryCount',
  'targetProjectCount',
  'temporaryStateProposalRate',
  'top1Accuracy',
  'tokenOverhead',
  'toolCallCount',
  'toolCallReduction',
  'undetectedStaleIndexCount',
  'updateAccuracy',
  'userCorrectionReduction',
  'userPromptSubmitHookP50Ms',
  'userPromptSubmitHookP95Ms',
  'userPromptSubmitHookP99Ms',
  'weeklyAutomationRuntimeMs',
  'weeklyCoreCandidateCount',
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
export type BenchmarkPassFailRuleId = HardGateRuleId | BenchmarkMetricId

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
  passFailRule: readonly BenchmarkPassFailRuleId[]
}

export interface BenchmarkFixtureRunMetadata {
  root: string
  home: string
  cwd: string
  seed: string
  clock: string
  timezone: 'UTC'
  cleanupStatus: 'pending' | 'cleaned' | 'preserved' | 'failed'
  preserveFixture: boolean
  preserveReason?: string
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
  passFail: readonly BenchmarkPassFailRuleId[]
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
  value: number | BenchmarkMetricId
  profiles: readonly BenchmarkProfile[]
}

export interface BenchmarkThresholdBreach {
  caseId: string
  metric: BenchmarkMetricId
  actual: number
  threshold: string
  severity: 'warning' | 'error'
}

export interface BenchmarkReport {
  runId: string
  startedAt: string
  completedAt: string
  profile: BenchmarkProfile
  spec: {
    path: string
    title: string
    date: string
    contentHash: string
  }
  benchmark: {
    version: string
    thresholdVersion: string
    caseCatalogHash: string
  }
  package: {
    name: string
    version: string
  }
  git: {
    branch: string
    commit: string
    dirty: boolean
    trackedChanges: readonly string[]
  }
  runtime: {
    nodeVersion: string
    npmVersion?: string
    platform: string
    arch: string
  }
  passed: boolean
  summary: {
    totalCases: number
    passed: number
    failed: number
    skippedWithReason: number
    notSupportedWithoutProvider: number
  }
  failedCases: readonly BenchmarkCaseResult[]
  caseResults: readonly BenchmarkCaseResult[]
  metrics: {
    capability: Record<string, number>
    boundarySafety: Record<string, number>
    efficiency: Record<string, number>
    taskUtility: Record<string, number>
  }
  metricAggregation?: Record<string, {
    group: 'capability' | 'boundarySafety' | 'efficiency' | 'taskUtility'
    strategy: 'min' | 'max' | 'single'
    sampleCount: number
    sourceCaseIds: readonly string[]
  }>
  hardFailures: readonly HardGateRuleId[]
  thresholdBreaches: readonly BenchmarkThresholdBreach[]
  fixtureRuns?: readonly BenchmarkFixtureRunMetadata[]
  scaleResults?: Record<string, unknown>
  regressionComparison?: {
    baselineReportPath?: string
    regressions: ReadonlyArray<{ metric: string; baseline: number; current: number; delta: number }>
  }
}

export interface BenchmarkRunOptions {
  cwd: string
  profile: BenchmarkProfile
  outputDir: string
  artifactArchiveDir?: string
  seed?: string
  now?: string
  baselineReportPath?: string
  preserveFixtures?: boolean
  fixtureRuns?: BenchmarkFixtureRunMetadata[]
}
