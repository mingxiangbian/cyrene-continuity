# Cyrene Benchmark Report

Run ID: 5fffd288214e9caa
Profile: scale
Passed: true
Started: 2026-06-06T00:00:00.000Z
Completed: 2026-06-06T00:00:00.000Z

## Summary

- Total cases: 67
- Passed: 8
- Failed: 0
- Skipped with reason: 59
- Not supported without provider: 0

## Profile Caveat

- Scale L/XL results may combine target-scale synthetic runtime with capped materialized fixture storage; use case evidence before treating storage values as full target materialization.

## Failed Cases

- None

## Skipped Cases

- T0-MODE-FAST: profile scale does not run this case
- T0-MODE-BALANCED: profile scale does not run this case
- T0-MODE-REVIEW: profile scale does not run this case
- T0-PENDING-BOUNDARY: profile scale does not run this case
- T0-SIMILAR-BOUNDARY: profile scale does not run this case
- T0-CROSS-PROJECT-ADVERSARIAL: profile scale does not run this case
- T0-CROSS-PROJECT-PROMPT-INJECTION: profile scale does not run this case
- T0-SESSION-HINTS: profile scale does not run this case
- T0-ACTIVATION-RETRIEVED: profile scale does not run this case
- T0-SQLITE-HOT-PATH: profile scale does not run this case
- T0-SURFACE-CONSISTENCY: profile scale does not run this case
- T1-FACT-EXTRACTION: profile scale does not run this case
- T1-MULTI-SESSION-REASONING: profile scale does not run this case
- T1-TEMPORAL-ORDER: profile scale does not run this case
- T1-KNOWLEDGE-UPDATE: profile scale does not run this case
- T1-CONFLICT-HANDLING: profile scale does not run this case
- T1-ADVERSARIAL-RETRIEVAL: profile scale does not run this case
- T1-ADVERSARIAL-MULTI-DISTRACTOR: profile scale does not run this case
- T1-ABSTAIN-NO-EVIDENCE: profile scale does not run this case
- T1-EVENT-SUMMARY: profile scale does not run this case
- T15-UPGRADE: profile scale does not run this case
- T15-REPLACE: profile scale does not run this case
- T15-MERGE: profile scale does not run this case
- T15-EXPIRE: profile scale does not run this case
- T15-SUPERSEDE-HASH: profile scale does not run this case
- T15-CONFLICT-SINGLE-INJECTION: profile scale does not run this case
- T15-ADVERSARIAL-CONFLICT: profile scale does not run this case
- T15-ADVERSARIAL-SUPERSEDE-STRONG-OLD: profile scale does not run this case
- T16-PROPOSE-IMPORTANT: profile scale does not run this case
- T16-PROPOSE-NOISE: profile scale does not run this case
- T16-PROPOSE-SENSITIVE: profile scale does not run this case
- T16-PROPOSE-ASSISTANT-INFERENCE: profile scale does not run this case
- T16-ROUTING-NAMESPACE: profile scale does not run this case
- T16-REVIEW-HASH-REQUIRED: profile scale does not run this case
- T16-REVIEW-STALE-HASH: profile scale does not run this case
- T16-REVIEW-REJECT-DEFER: profile scale does not run this case
- T16-REVIEW-EDIT-HASH: profile scale does not run this case
- T2-REMEMBER-TEST-COMMAND: profile scale does not run this case
- T2-AVOID-REJECTED-APPROACH: profile scale does not run this case
- T2-FOLLOW-WORKFLOW: profile scale does not run this case
- T2-UPDATED-RULE: profile scale does not run this case
- T2-CROSS-SESSION-FIX: profile scale does not run this case
- T2-REDUCE-REPEAT-MISTAKE: profile scale does not run this case
- T2-REAL-PROJECT-REPLAY: profile scale does not run this case
- T2-REAL-UPDATED-WORKFLOW-REPLAY: profile scale does not run this case
- T2-REAL-MULTI-FILE-FIX-REPLAY: profile scale does not run this case
- T2-REAL-DOCS-ONLY-REPLAY: profile scale does not run this case
- T4-SQLITE-UNAVAILABLE: profile scale does not run this case
- T4-JSONL-CORRUPT: profile scale does not run this case
- T4-PROFILE-MISSING: profile scale does not run this case
- T4-FAST-SUMMARY-MISSING-STALE: profile scale does not run this case
- T4-SESSION-HINTS-EXPIRED: profile scale does not run this case
- T4-MCP-ERROR: profile scale does not run this case
- T4-AUTOMATION-INTERRUPT: profile scale does not run this case
- T4-HOOK-LIGHTWEIGHT: profile scale does not run this case
- T4-HOOK-TIMEOUT: profile scale does not run this case
- T4-SECURITY-SECRETS: profile scale does not run this case
- T4-SECURITY-PROMPT-INJECTION: profile scale does not run this case
- T4-SECURITY-GLOBAL-WRITE: profile scale does not run this case

## Unsupported Cases

- None

## Capability Metrics

- recallAt1: 1
- recallAt3: 1
- recallAt5: 1
- mrr: 1
- top1Accuracy: 1
- wrongTop1Rate: 0
- irrelevantRetrievalRate: 0
- similarMemoryInterferenceRate: 0
- staleMemoryRetrievalRate: 0
- oldMemoryRetrievalRate: 0
- newMemoryRetrievalRate: 1
- contextItemCount: 1
- memoryItemCount: 1
- profileSectionCount: 1
- sessionHintsCount: 0
- diagnosticsItemCount: 7
- continuityGetMinMs: 17
- continuityGetMaxMs: 35
- continuityGetMeanMs: 23
- postToolUseHeavyOperationCount: 0
- hotPathRebuildCount: 0

## Boundary Safety Metrics

- None

## Efficiency Metrics

- continuityGetP50Ms: 18
- continuityGetP95Ms: 35
- memoryDbSizeBytes: 1273856
- memoryDbBytesPerMemory: 4096
- scaleSRuntimeMs: 77
- targetProjectCount: 100
- targetActiveMemoryCount: 50000
- targetPendingMemoryCount: 5000
- materializedProjectCount: 1
- materializedActiveMemoryCount: 240
- materializedPendingMemoryCount: 240
- runtimeSourceIsMaterialized: 1
- jsonlSizeBytes: 854930
- jsonlRecordCount: 480
- sqliteIndexedActiveCount: 240
- sqliteIndexedPendingCount: 240
- scaleMRuntimeMs: 216
- continuityGetP99Ms: 56
- indexStaleRate: 0
- scaleLRuntimeMs: 45000
- scaleXLRuntimeMs: 180000
- benchmarkRuntimeMs: 180000
- fastTokenOverhead: 586
- balancedTokenOverhead: 595
- reviewTokenOverhead: 946
- fastPendingTokens: 0
- fastDiagnosticsTokens: 0
- balancedPendingTokens: 0
- balancedDiagnosticsTokens: 0
- reviewPendingTokens: 64
- reviewDiagnosticsTokens: 230
- projectMemoryTokens: 77
- globalProfileTokens: 1
- fastSummaryTokens: 7
- fullProfileTokens: 11
- sessionHintsTokens: 1
- similarHintsTokens: 1
- pendingTokens: 64
- diagnosticsTokens: 230
- profileSizeGrowthBytes: 40
- fastSummarySizeGrowthBytes: 26
- sessionHintsSizeBytes: 2
- continuityGetSampleCount: 9
- hookSampleCount: 3
- continuityGetP50FastMs: 18
- continuityGetP95FastMs: 18
- continuityGetP99FastMs: 18
- continuityGetP50BalancedMs: 18
- continuityGetP95BalancedMs: 18
- continuityGetP99BalancedMs: 18
- continuityGetP50ReviewMs: 35
- continuityGetP95ReviewMs: 35
- continuityGetP99ReviewMs: 35
- profileReadLatencyMs: 1
- fastSummaryReadLatencyMs: 1
- sessionHintsReadLatencyMs: 0
- similarQueryLatencyMs: 0
- pendingQueryLatencyMs: 0
- diagnosticsAssemblyLatencyMs: 1
- hookLatencyMs: 38
- sessionStartHookP50Ms: 38
- sessionStartHookP95Ms: 38
- sessionStartHookP99Ms: 38
- userPromptSubmitHookP50Ms: 20
- userPromptSubmitHookP95Ms: 20
- userPromptSubmitHookP99Ms: 20
- postToolUseHookP50Ms: 20
- postToolUseHookP95Ms: 20
- postToolUseHookP99Ms: 20
- stopHookP50Ms: 0
- stopHookP95Ms: 0
- stopHookP99Ms: 0
- runtimeHookTimeoutCount: 0
- runtimeHookFailOpenCount: 0
- ordinaryHookPendingReviewCount: 0
- sqliteHitRate: 1
- sqliteHitRateFreshIndex: 1
- jsonlFallbackRateHotPath: 0
- indexRebuildTimeMs: 24
- dbRebuildTimeMs: 24
- indexSourceMismatchCount: 0
- undetectedStaleIndexCount: 0

## Task Utility Metrics

- None

## Metric Aggregation

- continuityGetP50Ms: group=efficiency, strategy=max, samples=3, sources=T3-S-SCALE, T3-M-SCALE, T3-LATENCY
- continuityGetP95Ms: group=efficiency, strategy=max, samples=4, sources=T3-S-SCALE, T3-M-SCALE, T3-L-SCALE, T3-LATENCY
- continuityGetP99Ms: group=efficiency, strategy=max, samples=2, sources=T3-L-SCALE, T3-LATENCY
- indexStaleRate: group=efficiency, strategy=max, samples=2, sources=T3-L-SCALE, T3-INDEX-HEALTH
- jsonlRecordCount: group=efficiency, strategy=max, samples=4, sources=T3-S-SCALE, T3-M-SCALE, T3-L-SCALE, T3-XL-SCALE
- jsonlSizeBytes: group=efficiency, strategy=max, samples=5, sources=T3-S-SCALE, T3-M-SCALE, T3-L-SCALE, T3-XL-SCALE, T3-INDEX-HEALTH
- materializedActiveMemoryCount: group=efficiency, strategy=max, samples=4, sources=T3-S-SCALE, T3-M-SCALE, T3-L-SCALE, T3-XL-SCALE
- materializedPendingMemoryCount: group=efficiency, strategy=max, samples=4, sources=T3-S-SCALE, T3-M-SCALE, T3-L-SCALE, T3-XL-SCALE
- materializedProjectCount: group=efficiency, strategy=max, samples=4, sources=T3-S-SCALE, T3-M-SCALE, T3-L-SCALE, T3-XL-SCALE
- memoryDbBytesPerMemory: group=efficiency, strategy=max, samples=4, sources=T3-S-SCALE, T3-M-SCALE, T3-L-SCALE, T3-XL-SCALE
- memoryDbSizeBytes: group=efficiency, strategy=max, samples=4, sources=T3-S-SCALE, T3-M-SCALE, T3-XL-SCALE, T3-INDEX-HEALTH
- runtimeSourceIsMaterialized: group=efficiency, strategy=max, samples=4, sources=T3-S-SCALE, T3-M-SCALE, T3-L-SCALE, T3-XL-SCALE
- sqliteIndexedActiveCount: group=efficiency, strategy=max, samples=4, sources=T3-S-SCALE, T3-M-SCALE, T3-L-SCALE, T3-XL-SCALE
- sqliteIndexedPendingCount: group=efficiency, strategy=max, samples=4, sources=T3-S-SCALE, T3-M-SCALE, T3-L-SCALE, T3-XL-SCALE
- targetActiveMemoryCount: group=efficiency, strategy=max, samples=4, sources=T3-S-SCALE, T3-M-SCALE, T3-L-SCALE, T3-XL-SCALE
- targetPendingMemoryCount: group=efficiency, strategy=max, samples=4, sources=T3-S-SCALE, T3-M-SCALE, T3-L-SCALE, T3-XL-SCALE
- targetProjectCount: group=efficiency, strategy=max, samples=4, sources=T3-S-SCALE, T3-M-SCALE, T3-L-SCALE, T3-XL-SCALE

## Case Metric Details

- T3-S-SCALE: continuityGetP50Ms: 14.5, continuityGetP95Ms: 29, memoryDbSizeBytes: 245760, memoryDbBytesPerMemory: 4096, scaleSRuntimeMs: 77, targetProjectCount: 1, targetActiveMemoryCount: 50, targetPendingMemoryCount: 10, materializedProjectCount: 1, materializedActiveMemoryCount: 50, materializedPendingMemoryCount: 10, runtimeSourceIsMaterialized: 1, jsonlSizeBytes: 92390, jsonlRecordCount: 60, sqliteIndexedActiveCount: 50, sqliteIndexedPendingCount: 10
- T3-M-SCALE: continuityGetP50Ms: 17, continuityGetP95Ms: 34, memoryDbSizeBytes: 978944, memoryDbBytesPerMemory: 2880, scaleMRuntimeMs: 216, targetProjectCount: 5, targetActiveMemoryCount: 500, targetPendingMemoryCount: 100, materializedProjectCount: 1, materializedActiveMemoryCount: 240, materializedPendingMemoryCount: 100, runtimeSourceIsMaterialized: 1, jsonlSizeBytes: 554470, jsonlRecordCount: 340, sqliteIndexedActiveCount: 240, sqliteIndexedPendingCount: 100
- T3-L-SCALE: continuityGetP95Ms: 34, continuityGetP99Ms: 56, indexStaleRate: 0, memoryDbBytesPerMemory: 2646, scaleLRuntimeMs: 45000, targetProjectCount: 20, targetActiveMemoryCount: 5000, targetPendingMemoryCount: 1000, materializedProjectCount: 1, materializedActiveMemoryCount: 240, materializedPendingMemoryCount: 240, runtimeSourceIsMaterialized: 0, jsonlSizeBytes: 850850, jsonlRecordCount: 480, sqliteIndexedActiveCount: 240, sqliteIndexedPendingCount: 240
- T3-XL-SCALE: scaleXLRuntimeMs: 180000, memoryDbSizeBytes: 1273856, memoryDbBytesPerMemory: 2654, benchmarkRuntimeMs: 180000, targetProjectCount: 100, targetActiveMemoryCount: 50000, targetPendingMemoryCount: 5000, materializedProjectCount: 1, materializedActiveMemoryCount: 240, materializedPendingMemoryCount: 240, runtimeSourceIsMaterialized: 0, jsonlSizeBytes: 854930, jsonlRecordCount: 480, sqliteIndexedActiveCount: 240, sqliteIndexedPendingCount: 240
- T3-RANKING: recallAt1: 1, recallAt3: 1, recallAt5: 1, mrr: 1, top1Accuracy: 1, wrongTop1Rate: 0, irrelevantRetrievalRate: 0, similarMemoryInterferenceRate: 0, staleMemoryRetrievalRate: 0, oldMemoryRetrievalRate: 0, newMemoryRetrievalRate: 1
- T3-TOKEN-OVERHEAD: fastTokenOverhead: 586, balancedTokenOverhead: 595, reviewTokenOverhead: 946, fastPendingTokens: 0, fastDiagnosticsTokens: 0, balancedPendingTokens: 0, balancedDiagnosticsTokens: 0, reviewPendingTokens: 64, reviewDiagnosticsTokens: 230, projectMemoryTokens: 77, globalProfileTokens: 1, fastSummaryTokens: 7, fullProfileTokens: 11, sessionHintsTokens: 1, similarHintsTokens: 1, pendingTokens: 64, diagnosticsTokens: 230, contextItemCount: 1, memoryItemCount: 1, profileSectionCount: 1, sessionHintsCount: 0, diagnosticsItemCount: 7, profileSizeGrowthBytes: 40, fastSummarySizeGrowthBytes: 26, sessionHintsSizeBytes: 2
- T3-LATENCY: continuityGetSampleCount: 9, hookSampleCount: 3, continuityGetMinMs: 17, continuityGetMaxMs: 35, continuityGetMeanMs: 23, continuityGetP50Ms: 18, continuityGetP95Ms: 35, continuityGetP99Ms: 35, continuityGetP50FastMs: 18, continuityGetP95FastMs: 18, continuityGetP99FastMs: 18, continuityGetP50BalancedMs: 18, continuityGetP95BalancedMs: 18, continuityGetP99BalancedMs: 18, continuityGetP50ReviewMs: 35, continuityGetP95ReviewMs: 35, continuityGetP99ReviewMs: 35, profileReadLatencyMs: 1, fastSummaryReadLatencyMs: 1, sessionHintsReadLatencyMs: 0, similarQueryLatencyMs: 0, pendingQueryLatencyMs: 0, diagnosticsAssemblyLatencyMs: 1, hookLatencyMs: 38, sessionStartHookP50Ms: 38, sessionStartHookP95Ms: 38, sessionStartHookP99Ms: 38, userPromptSubmitHookP50Ms: 20, userPromptSubmitHookP95Ms: 20, userPromptSubmitHookP99Ms: 20, postToolUseHookP50Ms: 20, postToolUseHookP95Ms: 20, postToolUseHookP99Ms: 20, stopHookP50Ms: 0, stopHookP95Ms: 0, stopHookP99Ms: 0, runtimeHookTimeoutCount: 0, runtimeHookFailOpenCount: 0, postToolUseHeavyOperationCount: 0, ordinaryHookPendingReviewCount: 0
- T3-INDEX-HEALTH: sqliteHitRate: 1, sqliteHitRateFreshIndex: 1, jsonlFallbackRateHotPath: 0, indexStaleRate: 0, indexRebuildTimeMs: 24, dbRebuildTimeMs: 24, memoryDbSizeBytes: 77824, jsonlSizeBytes: 1393, indexSourceMismatchCount: 0, hotPathRebuildCount: 0, undetectedStaleIndexCount: 0

## Scale Results

- None

## Regression Comparison

- None

## Fixture Runs

- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-H9qEJD: cleanup=cleaned, preserve=false, seed=stats-fix-scale-seed:T3-S-SCALE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-H9qEJD/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-H9qEJD/cyrene-benchmark-project-95738c144cb31612
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-qMg3RX: cleanup=cleaned, preserve=false, seed=stats-fix-scale-seed:T3-M-SCALE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-qMg3RX/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-qMg3RX/cyrene-benchmark-project-af95fa157638d0da
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-MJysko: cleanup=cleaned, preserve=false, seed=stats-fix-scale-seed:T3-L-SCALE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-MJysko/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-MJysko/cyrene-benchmark-project-115af94dee1fe920
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-AaP1ES: cleanup=cleaned, preserve=false, seed=stats-fix-scale-seed:T3-XL-SCALE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-AaP1ES/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-AaP1ES/cyrene-benchmark-project-476fde2ea006d64c
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-vrqKjs: cleanup=cleaned, preserve=false, seed=stats-fix-scale-seed:T3-RANKING, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-vrqKjs/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-vrqKjs/cyrene-benchmark-project-f2cec1552d0ccec3
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-nFU7KW: cleanup=cleaned, preserve=false, seed=stats-fix-scale-seed:T3-TOKEN-OVERHEAD, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-nFU7KW/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-nFU7KW/cyrene-benchmark-project-a7833d298312c3bd
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-70zpbS: cleanup=cleaned, preserve=false, seed=stats-fix-scale-seed:T3-LATENCY, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-70zpbS/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-70zpbS/cyrene-benchmark-project-5b6e7fa8e790c3b5
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-ZlUnW8: cleanup=cleaned, preserve=false, seed=stats-fix-scale-seed:T3-INDEX-HEALTH, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-ZlUnW8/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-ZlUnW8/cyrene-benchmark-project-76a178fb51beb4e7

## Spec

- Path: benchmark/fixtures/benchmark-eval-system-design.md
- Title: Cyrene Benchmark Eval System Design
- Date: 2026-06-05
- Hash: 5912abb3448b0df2a00f94a4f8499fe91d1d67c55fa4e118b288b64e13e7bfc9

## Benchmark

- Version: 1.0.0
- Threshold version: 2026-06-06
- Case catalog hash: 3f822e847b5de4abe84f466e695cf6b82a1a64fb70b87bfe4681ace13b8bc618

## Package

- Name: cyrene-continuity
- Version: 0.1.0

## Git

- Branch: main
- Commit: 827bcb856cbe60706621b9c8135111eb1f627a91
- Dirty: true
- Tracked changes: M benchmark/cases/tier0-release-gate.ts, M benchmark/cases/tier1-5-lifecycle.ts, M benchmark/cases/tier1-memory-ability.ts, M benchmark/cases/tier2-memory-to-action.ts, M benchmark/cases/tier3-scale-efficiency.ts, M benchmark/cases/tier4-failure-security.ts, M benchmark/catalog.ts, M benchmark/report.ts, M benchmark/runner.ts, M benchmark/thresholds.ts, M benchmark/types.ts, M benchmark/reports/2026-06-06/summary.md, M benchmark/fixtures/benchmark-eval-system-design.md, M plugin/runtime/cyrene-continuity.mjs, M src/codex/codex-benchmark.ts, M src/codex/codex-cli.ts, M src/codex/context-policy.ts, M src/codex/memory-context-preview.ts, M tests/benchmark-cases-ability-action.test.ts, M tests/benchmark-cases-failure-security.test.ts, M tests/benchmark-cases-lifecycle.test.ts, M tests/benchmark-cases-scale.test.ts, M tests/benchmark-cases-tier0.test.ts, M tests/benchmark-cli.test.ts, M tests/benchmark-report.test.ts, M tests/benchmark-runner.test.ts, M tests/benchmark-types.test.ts, M tests/codex-context-policy.test.ts, ?? benchmark/artifacts.ts, ?? benchmark/reports/, ?? benchmark/fixtures/benchmark-expansion-plan.md, ?? tests/benchmark-cases-real-replay.test.ts

## Runtime

- Node: v25.9.0
- npm: 11.12.1
- Platform: darwin
- Arch: arm64

## Hard Failures

- None

## Threshold Breaches

- None

## Case Results

- SKIPPED_WITH_REASON T0-MODE-FAST: fast mode excludes review and similar hot paths - profile scale does not run this case
- SKIPPED_WITH_REASON T0-MODE-BALANCED: balanced mode reads full profile without pending details - profile scale does not run this case
- SKIPPED_WITH_REASON T0-MODE-REVIEW: review mode is the only mode that reads pending memories - profile scale does not run this case
- SKIPPED_WITH_REASON T0-PENDING-BOUNDARY: pending does not leak into ordinary context - profile scale does not run this case
- SKIPPED_WITH_REASON T0-SIMILAR-BOUNDARY: similar project hints never cross project boundary as memory - profile scale does not run this case
- SKIPPED_WITH_REASON T0-CROSS-PROJECT-ADVERSARIAL: adversarial similar project memory stays hint-only - profile scale does not run this case
- SKIPPED_WITH_REASON T0-CROSS-PROJECT-PROMPT-INJECTION: foreign prompt-injection memory stays non-current-project hint only - profile scale does not run this case
- SKIPPED_WITH_REASON T0-SESSION-HINTS: session hints are transient and never migrate to memory - profile scale does not run this case
- SKIPPED_WITH_REASON T0-ACTIVATION-RETRIEVED: activation event defaults do not write retrieved events - profile scale does not run this case
- SKIPPED_WITH_REASON T0-SQLITE-HOT-PATH: SQLite and FTS are the default hot path - profile scale does not run this case
- SKIPPED_WITH_REASON T0-SURFACE-CONSISTENCY: Skill, MCP, and CLI surfaces expose consistent behavior - profile scale does not run this case
- SKIPPED_WITH_REASON T1-FACT-EXTRACTION: extract project facts from coding memories - profile scale does not run this case
- SKIPPED_WITH_REASON T1-MULTI-SESSION-REASONING: reason across multiple sessions - profile scale does not run this case
- SKIPPED_WITH_REASON T1-TEMPORAL-ORDER: answer temporal order questions - profile scale does not run this case
- SKIPPED_WITH_REASON T1-KNOWLEDGE-UPDATE: newer memories override stale rules - profile scale does not run this case
- SKIPPED_WITH_REASON T1-CONFLICT-HANDLING: handle conflicting memories without double injection - profile scale does not run this case
- SKIPPED_WITH_REASON T1-ADVERSARIAL-RETRIEVAL: retrieve target memory over adversarial distractors - profile scale does not run this case
- SKIPPED_WITH_REASON T1-ADVERSARIAL-MULTI-DISTRACTOR: answer target memory while rejecting stale pending personal global and foreign distractors - profile scale does not run this case
- SKIPPED_WITH_REASON T1-ABSTAIN-NO-EVIDENCE: abstain when memory evidence is absent - profile scale does not run this case
- SKIPPED_WITH_REASON T1-EVENT-SUMMARY: summarize project events from long session memory - profile scale does not run this case
- SKIPPED_WITH_REASON T15-UPGRADE: low-risk project memory can upgrade through policy - profile scale does not run this case
- SKIPPED_WITH_REASON T15-REPLACE: replacement removes stale active rule from injection - profile scale does not run this case
- SKIPPED_WITH_REASON T15-MERGE: merge combines compatible memory evidence - profile scale does not run this case
- SKIPPED_WITH_REASON T15-EXPIRE: expired memories are excluded from active context - profile scale does not run this case
- SKIPPED_WITH_REASON T15-SUPERSEDE-HASH: supersede requires valid review hash - profile scale does not run this case
- SKIPPED_WITH_REASON T15-CONFLICT-SINGLE-INJECTION: conflicting old and new rules inject only one winner - profile scale does not run this case
- SKIPPED_WITH_REASON T15-ADVERSARIAL-CONFLICT: adversarial normalized-key conflict requires explicit supersede - profile scale does not run this case
- SKIPPED_WITH_REASON T15-ADVERSARIAL-SUPERSEDE-STRONG-OLD: explicit supersede beats a strong stale adversarial rule - profile scale does not run this case
- SKIPPED_WITH_REASON T16-PROPOSE-IMPORTANT: important project evidence is proposed for review - profile scale does not run this case
- SKIPPED_WITH_REASON T16-PROPOSE-NOISE: noise is not proposed as durable memory - profile scale does not run this case
- SKIPPED_WITH_REASON T16-PROPOSE-SENSITIVE: sensitive content is never persisted - profile scale does not run this case
- SKIPPED_WITH_REASON T16-PROPOSE-ASSISTANT-INFERENCE: assistant-only inference is not promoted as user fact - profile scale does not run this case
- SKIPPED_WITH_REASON T16-ROUTING-NAMESPACE: project and global namespace routing is correct - profile scale does not run this case
- SKIPPED_WITH_REASON T16-REVIEW-HASH-REQUIRED: review approval requires review hash - profile scale does not run this case
- SKIPPED_WITH_REASON T16-REVIEW-STALE-HASH: stale review hash cannot approve pending memory - profile scale does not run this case
- SKIPPED_WITH_REASON T16-REVIEW-REJECT-DEFER: reject and defer decisions do not activate memory - profile scale does not run this case
- SKIPPED_WITH_REASON T16-REVIEW-EDIT-HASH: edited review content gets a fresh hash contract - profile scale does not run this case
- SKIPPED_WITH_REASON T2-REMEMBER-TEST-COMMAND: remember and reuse project test command - profile scale does not run this case
- SKIPPED_WITH_REASON T2-AVOID-REJECTED-APPROACH: avoid an approach rejected in an earlier session - profile scale does not run this case
- SKIPPED_WITH_REASON T2-FOLLOW-WORKFLOW: follow remembered project workflow - profile scale does not run this case
- SKIPPED_WITH_REASON T2-UPDATED-RULE: use updated rule and stop using old rule - profile scale does not run this case
- SKIPPED_WITH_REASON T2-CROSS-SESSION-FIX: apply cross-session fix memory to current task - profile scale does not run this case
- SKIPPED_WITH_REASON T2-REDUCE-REPEAT-MISTAKE: memory reduces repeated mistakes and user corrections - profile scale does not run this case
- SKIPPED_WITH_REASON T2-REAL-PROJECT-REPLAY: real project replay validates coding task utility on repo-grounded fixture - profile scale does not run this case
- SKIPPED_WITH_REASON T2-REAL-UPDATED-WORKFLOW-REPLAY: real project replay stops using superseded workflow command - profile scale does not run this case
- SKIPPED_WITH_REASON T2-REAL-MULTI-FILE-FIX-REPLAY: real project replay applies prior multi-file fix path - profile scale does not run this case
- SKIPPED_WITH_REASON T2-REAL-DOCS-ONLY-REPLAY: real project replay keeps docs-only work on docs verification path - profile scale does not run this case
- PASSED T3-S-SCALE: S scale fixture stays within latency and overhead thresholds - scale S ok; runtimeSource=materialized; storageSource=full-target-materialized-fixture; runtimeMs=77; target projects=1; target active=50; target pending=10; materialized projects=1; materialized active=50; materialized pending=10; sqlite=1
- PASSED T3-M-SCALE: M scale fixture stays within latency and overhead thresholds - scale M ok; runtimeSource=materialized; storageSource=capped-materialized-fixture; runtimeMs=216; target projects=5; target active=500; target pending=100; materialized projects=1; materialized active=240; materialized pending=100; sqlite=1
- PASSED T3-L-SCALE: L scale fixture stays within latency and overhead thresholds - scale L ok; runtimeSource=synthetic; storageSource=capped-materialized-fixture; runtimeMs=45000; target projects=20; target active=5000; target pending=1000; materialized projects=1; materialized active=240; materialized pending=240; sqlite=1
- PASSED T3-XL-SCALE: XL scale fixture reports efficiency without entering release gate hot path - scale XL ok; runtimeSource=synthetic; storageSource=capped-materialized-fixture; runtimeMs=180000; target projects=100; target active=50000; target pending=5000; materialized projects=1; materialized active=240; materialized pending=240; sqlite=1
- PASSED T3-RANKING: ranking resists similar memory interference - ranking ok; recallAt3=1; mrr=1; wrongTop1=0; top=ranking-target
- PASSED T3-TOKEN-OVERHEAD: token overhead stays inside profile budget - profile token overhead recorded; contextShape=compact; balancedDiagnosticsVisible=0; fast/balanced/review bounded
- PASSED T3-LATENCY: latency percentiles are reported for continuity and hooks - latency p50/p95/p99 recorded; hook latency recorded; componentZeroMeans=not_executed_or_below_timer_resolution
- PASSED T3-INDEX-HEALTH: index health reports SQLite hit, JSONL fallback, and stale rates - index health ok; sqlite hit rate=1; jsonl fallback=0; stale rate=0
- SKIPPED_WITH_REASON T4-SQLITE-UNAVAILABLE: SQLite unavailable path reports fallback policy explicitly - profile scale does not run this case
- SKIPPED_WITH_REASON T4-JSONL-CORRUPT: corrupt JSONL fixture fails closed with diagnostics - profile scale does not run this case
- SKIPPED_WITH_REASON T4-PROFILE-MISSING: missing profile does not pollute context - profile scale does not run this case
- SKIPPED_WITH_REASON T4-FAST-SUMMARY-MISSING-STALE: missing or stale fast summary never triggers hot-path heavy rebuild - profile scale does not run this case
- SKIPPED_WITH_REASON T4-SESSION-HINTS-EXPIRED: expired session hints are ignored - profile scale does not run this case
- SKIPPED_WITH_REASON T4-MCP-ERROR: MCP error surface returns bounded diagnostics - profile scale does not run this case
- SKIPPED_WITH_REASON T4-AUTOMATION-INTERRUPT: automation interruption does not leave memory partial writes - profile scale does not run this case
- SKIPPED_WITH_REASON T4-HOOK-LIGHTWEIGHT: non-Stop lifecycle hook path remains lightweight - profile scale does not run this case
- SKIPPED_WITH_REASON T4-HOOK-TIMEOUT: hook timeout does not crash ordinary coding flow - profile scale does not run this case
- SKIPPED_WITH_REASON T4-SECURITY-SECRETS: secrets are never persisted or reported as memory - profile scale does not run this case
- SKIPPED_WITH_REASON T4-SECURITY-PROMPT-INJECTION: prompt injection text cannot override benchmark or memory policy - profile scale does not run this case
- SKIPPED_WITH_REASON T4-SECURITY-GLOBAL-WRITE: global writes require explicit allowed namespace and policy - profile scale does not run this case
