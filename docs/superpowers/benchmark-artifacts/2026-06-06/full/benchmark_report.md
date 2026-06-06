# Cyrene Benchmark Report

Run ID: b69cc461c862d088
Profile: full
Passed: true
Started: 2026-06-06T00:00:00.000Z
Completed: 2026-06-06T00:00:00.000Z

## Summary

- Total cases: 67
- Passed: 59
- Failed: 0
- Skipped with reason: 8
- Not supported without provider: 0

## Profile Caveat

- Scale L/XL results may combine target-scale synthetic runtime with capped materialized fixture storage; use case evidence before treating storage values as full target materialization.

## Failed Cases

- None

## Skipped Cases

- T2-REAL-PROJECT-REPLAY: profile full does not run this case
- T2-REAL-UPDATED-WORKFLOW-REPLAY: profile full does not run this case
- T2-REAL-MULTI-FILE-FIX-REPLAY: profile full does not run this case
- T2-REAL-DOCS-ONLY-REPLAY: profile full does not run this case
- T3-S-SCALE: profile full does not run this case
- T3-M-SCALE: profile full does not run this case
- T3-L-SCALE: profile full does not run this case
- T3-XL-SCALE: profile full does not run this case

## Unsupported Cases

- None

## Capability Metrics

- modeAccuracy: 1
- retrievedDefaultWriteRate: 0
- surfaceConsistencyRate: 1
- retrievalAccuracy: 1
- answerAccuracy: 1
- abstentionAccuracy: 1
- similarMemoryInterferenceRate: 0
- promotionAccuracy: 1
- lifecyclePromotionAccuracy: 1
- dailyPromotedCount: 1
- replacementAccuracy: 1
- duplicateActiveMemoryRate: 0
- pendingReviewedCount: 2
- approveCount: 1
- mergeAccuracy: 1
- duplicatePendingRate: 0
- conflictResolutionAccuracy: 1
- rollbackSuccessRate: 1
- stalePendingCount: 0
- summaryStalePropagationAccuracy: 1
- importantMemoryMissedRate: 0
- proposalPrecision: 1
- proposalRecall: 1
- pendingGeneratedCount: 1
- pendingCandidatesPerSession: 1
- pendingCandidatesPerDay: 1
- manualReviewCount: 2
- reviewFalsePositiveRate: 0
- rejectCount: 1
- deferCount: 1
- editCount: 1
- averageReviewTimeMs: 0
- recallAt1: 1
- recallAt3: 1
- recallAt5: 1
- mrr: 1
- top1Accuracy: 1
- wrongTop1Rate: 0
- irrelevantRetrievalRate: 0
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
- continuityGetMeanMs: 24
- postToolUseHeavyOperationCount: 0
- hotPathRebuildCount: 0
- adapterAvailability: 1
- weeklyCoreCandidateCount: 1
- dryRunWriteCount: 0
- repeatedPromotionCount: 0

## Boundary Safety Metrics

- pendingLeakageRate: 0
- pendingMisuseRate: 0
- crossProjectPollutionRate: 0
- similarHintMigrationRate: 0
- profilePollutionRate: 0
- staleMemoryLeakageRate: 0
- noiseProposalRate: 0
- temporaryStateProposalRate: 0
- sensitiveProposalRate: 0
- assistantInferenceAutoActiveRate: 0
- boundarySafetyRate: 1

## Efficiency Metrics

- fastTokenOverhead: 586
- continuityGetP95FastMs: 22
- balancedTokenOverhead: 601
- continuityGetP95BalancedMs: 23
- continuityGetP95ReviewMs: 43
- sqliteHitRateFreshIndex: 1
- jsonlFallbackRateHotPath: 0
- sqliteQueryP95Ms: 19
- activationEventGrowth: 1
- auditLogGrowth: 1
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
- continuityGetP50Ms: 19
- continuityGetP95Ms: 35
- continuityGetP99Ms: 35
- continuityGetP50FastMs: 18
- continuityGetP99FastMs: 19
- continuityGetP50BalancedMs: 18
- continuityGetP99BalancedMs: 23
- continuityGetP50ReviewMs: 33
- continuityGetP99ReviewMs: 35
- profileReadLatencyMs: 2
- fastSummaryReadLatencyMs: 0
- sessionHintsReadLatencyMs: 0
- similarQueryLatencyMs: 0
- pendingQueryLatencyMs: 0
- diagnosticsAssemblyLatencyMs: 1
- hookLatencyMs: 39
- sessionStartHookP50Ms: 39
- sessionStartHookP95Ms: 39
- sessionStartHookP99Ms: 39
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
- indexStaleRate: 0
- indexRebuildTimeMs: 22
- dbRebuildTimeMs: 22
- memoryDbSizeBytes: 77824
- jsonlSizeBytes: 1393
- indexSourceMismatchCount: 0
- undetectedStaleIndexCount: 0
- dailyAutomationRuntimeMs: 1
- weeklyAutomationRuntimeMs: 2
- duplicateAutomationOutputCount: 0
- automationInterruptRecoveryTimeMs: 1
- simulatedHookTimeoutCount: 1
- simulatedHookFailOpenCount: 1

## Task Utility Metrics

- taskSuccessRate: 1
- toolCallCount: 6
- repeatedMistakeReduction: 0.75
- noMemoryTaskSuccessRate: 0
- withMemoryTaskSuccessRate: 1
- userCorrectionReduction: 0.6
- toolCallReduction: 0.4

## Metric Aggregation

- abstentionAccuracy: group=capability, strategy=min, samples=7, sources=T1-FACT-EXTRACTION, T1-MULTI-SESSION-REASONING, T1-TEMPORAL-ORDER, T1-KNOWLEDGE-UPDATE, T1-CONFLICT-HANDLING, T1-ABSTAIN-NO-EVIDENCE, T1-EVENT-SUMMARY
- adapterAvailability: group=capability, strategy=max, samples=6, sources=T4-SQLITE-UNAVAILABLE, T4-JSONL-CORRUPT, T4-PROFILE-MISSING, T4-FAST-SUMMARY-MISSING-STALE, T4-SESSION-HINTS-EXPIRED, T4-MCP-ERROR
- answerAccuracy: group=capability, strategy=min, samples=8, sources=T1-FACT-EXTRACTION, T1-MULTI-SESSION-REASONING, T1-TEMPORAL-ORDER, T1-KNOWLEDGE-UPDATE, T1-CONFLICT-HANDLING, T1-ADVERSARIAL-RETRIEVAL, T1-ADVERSARIAL-MULTI-DISTRACTOR, T1-EVENT-SUMMARY
- approveCount: group=capability, strategy=max, samples=2, sources=T15-REPLACE, T16-REVIEW-HASH-REQUIRED
- balancedTokenOverhead: group=efficiency, strategy=max, samples=2, sources=T0-MODE-BALANCED, T3-TOKEN-OVERHEAD
- boundarySafetyRate: group=boundarySafety, strategy=max, samples=9, sources=T4-SQLITE-UNAVAILABLE, T4-JSONL-CORRUPT, T4-PROFILE-MISSING, T4-FAST-SUMMARY-MISSING-STALE, T4-SESSION-HINTS-EXPIRED, T4-MCP-ERROR, T4-SECURITY-SECRETS, T4-SECURITY-PROMPT-INJECTION, T4-SECURITY-GLOBAL-WRITE
- conflictResolutionAccuracy: group=capability, strategy=min, samples=5, sources=T15-MERGE, T15-SUPERSEDE-HASH, T15-CONFLICT-SINGLE-INJECTION, T15-ADVERSARIAL-CONFLICT, T15-ADVERSARIAL-SUPERSEDE-STRONG-OLD
- continuityGetP95BalancedMs: group=efficiency, strategy=max, samples=2, sources=T0-MODE-BALANCED, T3-LATENCY
- continuityGetP95FastMs: group=efficiency, strategy=max, samples=2, sources=T0-MODE-FAST, T3-LATENCY
- continuityGetP95ReviewMs: group=efficiency, strategy=max, samples=2, sources=T0-MODE-REVIEW, T3-LATENCY
- crossProjectPollutionRate: group=boundarySafety, strategy=max, samples=3, sources=T0-SIMILAR-BOUNDARY, T0-CROSS-PROJECT-ADVERSARIAL, T0-CROSS-PROJECT-PROMPT-INJECTION
- dailyPromotedCount: group=capability, strategy=max, samples=2, sources=T15-UPGRADE, T4-AUTOMATION-INTERRUPT
- duplicateActiveMemoryRate: group=capability, strategy=max, samples=4, sources=T15-REPLACE, T15-MERGE, T15-ADVERSARIAL-CONFLICT, T15-ADVERSARIAL-SUPERSEDE-STRONG-OLD
- fastTokenOverhead: group=efficiency, strategy=max, samples=2, sources=T0-MODE-FAST, T3-TOKEN-OVERHEAD
- jsonlFallbackRateHotPath: group=efficiency, strategy=max, samples=2, sources=T0-SQLITE-HOT-PATH, T3-INDEX-HEALTH
- lifecyclePromotionAccuracy: group=capability, strategy=min, samples=2, sources=T15-UPGRADE, T16-ROUTING-NAMESPACE
- manualReviewCount: group=capability, strategy=max, samples=5, sources=T16-PROPOSE-ASSISTANT-INFERENCE, T16-REVIEW-HASH-REQUIRED, T16-REVIEW-STALE-HASH, T16-REVIEW-REJECT-DEFER, T16-REVIEW-EDIT-HASH
- modeAccuracy: group=capability, strategy=min, samples=3, sources=T0-MODE-FAST, T0-MODE-BALANCED, T0-MODE-REVIEW
- ordinaryHookPendingReviewCount: group=efficiency, strategy=max, samples=2, sources=T3-LATENCY, T4-HOOK-LIGHTWEIGHT
- pendingGeneratedCount: group=capability, strategy=max, samples=4, sources=T16-PROPOSE-IMPORTANT, T16-PROPOSE-NOISE, T16-PROPOSE-ASSISTANT-INFERENCE, T4-AUTOMATION-INTERRUPT
- pendingLeakageRate: group=boundarySafety, strategy=max, samples=2, sources=T0-MODE-BALANCED, T0-PENDING-BOUNDARY
- pendingReviewedCount: group=capability, strategy=max, samples=3, sources=T15-REPLACE, T16-REVIEW-REJECT-DEFER, T4-AUTOMATION-INTERRUPT
- postToolUseHeavyOperationCount: group=capability, strategy=max, samples=2, sources=T3-LATENCY, T4-HOOK-LIGHTWEIGHT
- postToolUseHookP50Ms: group=efficiency, strategy=max, samples=2, sources=T3-LATENCY, T4-HOOK-LIGHTWEIGHT
- postToolUseHookP95Ms: group=efficiency, strategy=max, samples=8, sources=T3-LATENCY, T4-SQLITE-UNAVAILABLE, T4-JSONL-CORRUPT, T4-PROFILE-MISSING, T4-FAST-SUMMARY-MISSING-STALE, T4-SESSION-HINTS-EXPIRED, T4-MCP-ERROR, T4-HOOK-LIGHTWEIGHT
- postToolUseHookP99Ms: group=efficiency, strategy=max, samples=2, sources=T3-LATENCY, T4-HOOK-LIGHTWEIGHT
- profilePollutionRate: group=boundarySafety, strategy=max, samples=3, sources=T0-CROSS-PROJECT-ADVERSARIAL, T0-CROSS-PROJECT-PROMPT-INJECTION, T0-SESSION-HINTS
- proposalPrecision: group=capability, strategy=min, samples=3, sources=T16-PROPOSE-IMPORTANT, T16-PROPOSE-NOISE, T16-PROPOSE-SENSITIVE
- repeatedMistakeReduction: group=taskUtility, strategy=min, samples=6, sources=T2-REMEMBER-TEST-COMMAND, T2-AVOID-REJECTED-APPROACH, T2-FOLLOW-WORKFLOW, T2-UPDATED-RULE, T2-CROSS-SESSION-FIX, T2-REDUCE-REPEAT-MISTAKE
- retrievalAccuracy: group=capability, strategy=min, samples=8, sources=T1-FACT-EXTRACTION, T1-MULTI-SESSION-REASONING, T1-TEMPORAL-ORDER, T1-KNOWLEDGE-UPDATE, T1-CONFLICT-HANDLING, T1-ADVERSARIAL-RETRIEVAL, T1-ADVERSARIAL-MULTI-DISTRACTOR, T1-EVENT-SUMMARY
- reviewFalsePositiveRate: group=capability, strategy=max, samples=2, sources=T16-REVIEW-HASH-REQUIRED, T16-REVIEW-STALE-HASH
- rollbackSuccessRate: group=capability, strategy=min, samples=2, sources=T15-EXPIRE, T15-SUPERSEDE-HASH
- runtimeHookFailOpenCount: group=efficiency, strategy=max, samples=2, sources=T3-LATENCY, T4-HOOK-TIMEOUT
- runtimeHookTimeoutCount: group=efficiency, strategy=max, samples=2, sources=T3-LATENCY, T4-HOOK-TIMEOUT
- sessionStartHookP50Ms: group=efficiency, strategy=max, samples=2, sources=T3-LATENCY, T4-HOOK-LIGHTWEIGHT
- sessionStartHookP95Ms: group=efficiency, strategy=max, samples=2, sources=T3-LATENCY, T4-HOOK-LIGHTWEIGHT
- sessionStartHookP99Ms: group=efficiency, strategy=max, samples=2, sources=T3-LATENCY, T4-HOOK-LIGHTWEIGHT
- similarHintMigrationRate: group=boundarySafety, strategy=max, samples=4, sources=T0-SIMILAR-BOUNDARY, T0-CROSS-PROJECT-ADVERSARIAL, T0-CROSS-PROJECT-PROMPT-INJECTION, T0-SESSION-HINTS
- similarMemoryInterferenceRate: group=capability, strategy=max, samples=3, sources=T1-ADVERSARIAL-RETRIEVAL, T1-ADVERSARIAL-MULTI-DISTRACTOR, T3-RANKING
- sqliteHitRateFreshIndex: group=efficiency, strategy=min, samples=2, sources=T0-SQLITE-HOT-PATH, T3-INDEX-HEALTH
- staleMemoryLeakageRate: group=boundarySafety, strategy=max, samples=5, sources=T15-REPLACE, T15-EXPIRE, T15-CONFLICT-SINGLE-INJECTION, T15-ADVERSARIAL-CONFLICT, T15-ADVERSARIAL-SUPERSEDE-STRONG-OLD
- stalePendingCount: group=capability, strategy=max, samples=3, sources=T15-SUPERSEDE-HASH, T16-REVIEW-STALE-HASH, T16-REVIEW-REJECT-DEFER
- stopHookP50Ms: group=efficiency, strategy=max, samples=2, sources=T3-LATENCY, T4-HOOK-TIMEOUT
- stopHookP95Ms: group=efficiency, strategy=max, samples=2, sources=T3-LATENCY, T4-HOOK-TIMEOUT
- stopHookP99Ms: group=efficiency, strategy=max, samples=2, sources=T3-LATENCY, T4-HOOK-TIMEOUT
- taskSuccessRate: group=taskUtility, strategy=min, samples=6, sources=T2-REMEMBER-TEST-COMMAND, T2-AVOID-REJECTED-APPROACH, T2-FOLLOW-WORKFLOW, T2-UPDATED-RULE, T2-CROSS-SESSION-FIX, T2-REDUCE-REPEAT-MISTAKE
- toolCallCount: group=taskUtility, strategy=max, samples=6, sources=T2-REMEMBER-TEST-COMMAND, T2-AVOID-REJECTED-APPROACH, T2-FOLLOW-WORKFLOW, T2-UPDATED-RULE, T2-CROSS-SESSION-FIX, T2-REDUCE-REPEAT-MISTAKE
- userPromptSubmitHookP50Ms: group=efficiency, strategy=max, samples=2, sources=T3-LATENCY, T4-HOOK-LIGHTWEIGHT
- userPromptSubmitHookP95Ms: group=efficiency, strategy=max, samples=2, sources=T3-LATENCY, T4-HOOK-LIGHTWEIGHT
- userPromptSubmitHookP99Ms: group=efficiency, strategy=max, samples=2, sources=T3-LATENCY, T4-HOOK-LIGHTWEIGHT

## Case Metric Details

- T0-MODE-FAST: modeAccuracy: 1, fastTokenOverhead: 580, continuityGetP95FastMs: 22
- T0-MODE-BALANCED: modeAccuracy: 1, balancedTokenOverhead: 601, continuityGetP95BalancedMs: 22, pendingLeakageRate: 0
- T0-MODE-REVIEW: modeAccuracy: 1, pendingMisuseRate: 0, continuityGetP95ReviewMs: 43
- T0-PENDING-BOUNDARY: pendingLeakageRate: 0
- T0-SIMILAR-BOUNDARY: crossProjectPollutionRate: 0, similarHintMigrationRate: 0
- T0-CROSS-PROJECT-ADVERSARIAL: crossProjectPollutionRate: 0, similarHintMigrationRate: 0, profilePollutionRate: 0
- T0-CROSS-PROJECT-PROMPT-INJECTION: crossProjectPollutionRate: 0, similarHintMigrationRate: 0, profilePollutionRate: 0
- T0-SESSION-HINTS: similarHintMigrationRate: 0, profilePollutionRate: 0
- T0-ACTIVATION-RETRIEVED: retrievedDefaultWriteRate: 0
- T0-SQLITE-HOT-PATH: sqliteHitRateFreshIndex: 1, jsonlFallbackRateHotPath: 0, sqliteQueryP95Ms: 19
- T0-SURFACE-CONSISTENCY: surfaceConsistencyRate: 1
- T1-FACT-EXTRACTION: retrievalAccuracy: 1, answerAccuracy: 1, abstentionAccuracy: 1
- T1-MULTI-SESSION-REASONING: retrievalAccuracy: 1, answerAccuracy: 1, abstentionAccuracy: 1
- T1-TEMPORAL-ORDER: retrievalAccuracy: 1, answerAccuracy: 1, abstentionAccuracy: 1
- T1-KNOWLEDGE-UPDATE: retrievalAccuracy: 1, answerAccuracy: 1, abstentionAccuracy: 1
- T1-CONFLICT-HANDLING: retrievalAccuracy: 1, answerAccuracy: 1, abstentionAccuracy: 1
- T1-ADVERSARIAL-RETRIEVAL: retrievalAccuracy: 1, answerAccuracy: 1, similarMemoryInterferenceRate: 0
- T1-ADVERSARIAL-MULTI-DISTRACTOR: retrievalAccuracy: 1, answerAccuracy: 1, similarMemoryInterferenceRate: 0
- T1-ABSTAIN-NO-EVIDENCE: abstentionAccuracy: 1
- T1-EVENT-SUMMARY: retrievalAccuracy: 1, answerAccuracy: 1, abstentionAccuracy: 1
- T15-UPGRADE: promotionAccuracy: 1, lifecyclePromotionAccuracy: 1, dailyPromotedCount: 1, activationEventGrowth: 1, auditLogGrowth: 1
- T15-REPLACE: replacementAccuracy: 1, staleMemoryLeakageRate: 0, duplicateActiveMemoryRate: 0, pendingReviewedCount: 1, approveCount: 1
- T15-MERGE: mergeAccuracy: 1, duplicateActiveMemoryRate: 0, duplicatePendingRate: 0, conflictResolutionAccuracy: 1
- T15-EXPIRE: staleMemoryLeakageRate: 0, rollbackSuccessRate: 1
- T15-SUPERSEDE-HASH: conflictResolutionAccuracy: 1, rollbackSuccessRate: 1, stalePendingCount: 0
- T15-CONFLICT-SINGLE-INJECTION: conflictResolutionAccuracy: 1, summaryStalePropagationAccuracy: 1, staleMemoryLeakageRate: 0
- T15-ADVERSARIAL-CONFLICT: conflictResolutionAccuracy: 1, staleMemoryLeakageRate: 0, duplicateActiveMemoryRate: 0
- T15-ADVERSARIAL-SUPERSEDE-STRONG-OLD: conflictResolutionAccuracy: 1, staleMemoryLeakageRate: 0, duplicateActiveMemoryRate: 0
- T16-PROPOSE-IMPORTANT: importantMemoryMissedRate: 0, proposalPrecision: 1, proposalRecall: 1, pendingGeneratedCount: 1, pendingCandidatesPerSession: 1, pendingCandidatesPerDay: 1
- T16-PROPOSE-NOISE: noiseProposalRate: 0, temporaryStateProposalRate: 0, proposalPrecision: 1, pendingGeneratedCount: 0
- T16-PROPOSE-SENSITIVE: sensitiveProposalRate: 0, proposalPrecision: 1
- T16-PROPOSE-ASSISTANT-INFERENCE: assistantInferenceAutoActiveRate: 0, manualReviewCount: 1, pendingGeneratedCount: 1
- T16-ROUTING-NAMESPACE: lifecyclePromotionAccuracy: 1
- T16-REVIEW-HASH-REQUIRED: manualReviewCount: 1, approveCount: 0, reviewFalsePositiveRate: 0
- T16-REVIEW-STALE-HASH: manualReviewCount: 1, stalePendingCount: 0, reviewFalsePositiveRate: 0
- T16-REVIEW-REJECT-DEFER: manualReviewCount: 2, rejectCount: 1, deferCount: 1, pendingReviewedCount: 2, stalePendingCount: 0
- T16-REVIEW-EDIT-HASH: manualReviewCount: 1, editCount: 1, averageReviewTimeMs: 0
- T2-REMEMBER-TEST-COMMAND: taskSuccessRate: 1, toolCallCount: 2, repeatedMistakeReduction: 1
- T2-AVOID-REJECTED-APPROACH: taskSuccessRate: 1, toolCallCount: 3, repeatedMistakeReduction: 1
- T2-FOLLOW-WORKFLOW: taskSuccessRate: 1, toolCallCount: 4, repeatedMistakeReduction: 1
- T2-UPDATED-RULE: taskSuccessRate: 1, toolCallCount: 3, repeatedMistakeReduction: 1
- T2-CROSS-SESSION-FIX: taskSuccessRate: 1, toolCallCount: 4, repeatedMistakeReduction: 1
- T2-REDUCE-REPEAT-MISTAKE: taskSuccessRate: 1, toolCallCount: 6, noMemoryTaskSuccessRate: 0, withMemoryTaskSuccessRate: 1, repeatedMistakeReduction: 0.75, userCorrectionReduction: 0.6, toolCallReduction: 0.4
- T3-RANKING: recallAt1: 1, recallAt3: 1, recallAt5: 1, mrr: 1, top1Accuracy: 1, wrongTop1Rate: 0, irrelevantRetrievalRate: 0, similarMemoryInterferenceRate: 0, staleMemoryRetrievalRate: 0, oldMemoryRetrievalRate: 0, newMemoryRetrievalRate: 1
- T3-TOKEN-OVERHEAD: fastTokenOverhead: 586, balancedTokenOverhead: 595, reviewTokenOverhead: 946, fastPendingTokens: 0, fastDiagnosticsTokens: 0, balancedPendingTokens: 0, balancedDiagnosticsTokens: 0, reviewPendingTokens: 64, reviewDiagnosticsTokens: 230, projectMemoryTokens: 77, globalProfileTokens: 1, fastSummaryTokens: 7, fullProfileTokens: 11, sessionHintsTokens: 1, similarHintsTokens: 1, pendingTokens: 64, diagnosticsTokens: 230, contextItemCount: 1, memoryItemCount: 1, profileSectionCount: 1, sessionHintsCount: 0, diagnosticsItemCount: 7, profileSizeGrowthBytes: 40, fastSummarySizeGrowthBytes: 26, sessionHintsSizeBytes: 2
- T3-LATENCY: continuityGetSampleCount: 9, hookSampleCount: 3, continuityGetMinMs: 17, continuityGetMaxMs: 35, continuityGetMeanMs: 24, continuityGetP50Ms: 19, continuityGetP95Ms: 35, continuityGetP99Ms: 35, continuityGetP50FastMs: 18, continuityGetP95FastMs: 19, continuityGetP99FastMs: 19, continuityGetP50BalancedMs: 18, continuityGetP95BalancedMs: 23, continuityGetP99BalancedMs: 23, continuityGetP50ReviewMs: 33, continuityGetP95ReviewMs: 35, continuityGetP99ReviewMs: 35, profileReadLatencyMs: 2, fastSummaryReadLatencyMs: 0, sessionHintsReadLatencyMs: 0, similarQueryLatencyMs: 0, pendingQueryLatencyMs: 0, diagnosticsAssemblyLatencyMs: 1, hookLatencyMs: 39, sessionStartHookP50Ms: 39, sessionStartHookP95Ms: 39, sessionStartHookP99Ms: 39, userPromptSubmitHookP50Ms: 20, userPromptSubmitHookP95Ms: 20, userPromptSubmitHookP99Ms: 20, postToolUseHookP50Ms: 20, postToolUseHookP95Ms: 20, postToolUseHookP99Ms: 20, stopHookP50Ms: 0, stopHookP95Ms: 0, stopHookP99Ms: 0, runtimeHookTimeoutCount: 0, runtimeHookFailOpenCount: 0, postToolUseHeavyOperationCount: 0, ordinaryHookPendingReviewCount: 0
- T3-INDEX-HEALTH: sqliteHitRate: 1, sqliteHitRateFreshIndex: 1, jsonlFallbackRateHotPath: 0, indexStaleRate: 0, indexRebuildTimeMs: 22, dbRebuildTimeMs: 22, memoryDbSizeBytes: 77824, jsonlSizeBytes: 1393, indexSourceMismatchCount: 0, hotPathRebuildCount: 0, undetectedStaleIndexCount: 0
- T4-SQLITE-UNAVAILABLE: boundarySafetyRate: 1, postToolUseHookP95Ms: 0, adapterAvailability: 0
- T4-JSONL-CORRUPT: boundarySafetyRate: 1, postToolUseHookP95Ms: 0, adapterAvailability: 1
- T4-PROFILE-MISSING: boundarySafetyRate: 1, postToolUseHookP95Ms: 0, adapterAvailability: 1
- T4-FAST-SUMMARY-MISSING-STALE: boundarySafetyRate: 1, postToolUseHookP95Ms: 0, adapterAvailability: 1
- T4-SESSION-HINTS-EXPIRED: boundarySafetyRate: 1, postToolUseHookP95Ms: 0, adapterAvailability: 1
- T4-MCP-ERROR: boundarySafetyRate: 1, postToolUseHookP95Ms: 0, adapterAvailability: 1
- T4-AUTOMATION-INTERRUPT: dailyAutomationRuntimeMs: 1, weeklyAutomationRuntimeMs: 2, dailyPromotedCount: 1, weeklyCoreCandidateCount: 1, pendingReviewedCount: 0, pendingGeneratedCount: 0, duplicateAutomationOutputCount: 0, dryRunWriteCount: 0, repeatedPromotionCount: 0, automationInterruptRecoveryTimeMs: 1
- T4-HOOK-LIGHTWEIGHT: sessionStartHookP50Ms: 33, sessionStartHookP95Ms: 33, sessionStartHookP99Ms: 33, userPromptSubmitHookP50Ms: 17, userPromptSubmitHookP95Ms: 17, userPromptSubmitHookP99Ms: 17, postToolUseHookP50Ms: 17, postToolUseHookP95Ms: 17, postToolUseHookP99Ms: 17, postToolUseHeavyOperationCount: 0, ordinaryHookPendingReviewCount: 0
- T4-HOOK-TIMEOUT: stopHookP50Ms: 0, stopHookP95Ms: 0, stopHookP99Ms: 0, simulatedHookTimeoutCount: 1, simulatedHookFailOpenCount: 1, runtimeHookTimeoutCount: 0, runtimeHookFailOpenCount: 0
- T4-SECURITY-SECRETS: boundarySafetyRate: 1
- T4-SECURITY-PROMPT-INJECTION: boundarySafetyRate: 1
- T4-SECURITY-GLOBAL-WRITE: boundarySafetyRate: 1

## Scale Results

- None

## Regression Comparison

- None

## Fixture Runs

- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-fv2FwV: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-fv2FwV/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-fv2FwV/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-RWOM3E: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-RWOM3E/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-RWOM3E/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-seUDF8: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-seUDF8/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-seUDF8/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-JNzqc3: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-JNzqc3/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-JNzqc3/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-yosI6X: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-yosI6X/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-yosI6X/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-4whKtc: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-4whKtc/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-4whKtc/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Q45CUu: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Q45CUu/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Q45CUu/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-1r3mEt: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-1r3mEt/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-1r3mEt/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-rEwpzH: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-rEwpzH/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-rEwpzH/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-W4QPdH: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-W4QPdH/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-W4QPdH/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-AJo20c: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-AJo20c/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-AJo20c/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-UbQaJN: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T1-FACT-EXTRACTION, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-UbQaJN/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-UbQaJN/cyrene-benchmark-project-d22a0eb951654a42
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-v9uClh: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T1-MULTI-SESSION-REASONING, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-v9uClh/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-v9uClh/cyrene-benchmark-project-d56de0ac9e5637d7
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-nZJJX6: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T1-TEMPORAL-ORDER, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-nZJJX6/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-nZJJX6/cyrene-benchmark-project-1c14c7d462855115
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-ZiisZI: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T1-KNOWLEDGE-UPDATE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-ZiisZI/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-ZiisZI/cyrene-benchmark-project-72a20bba15ed42b9
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-3OohhZ: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T1-CONFLICT-HANDLING, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-3OohhZ/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-3OohhZ/cyrene-benchmark-project-8b8196986331c6fa
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-7Naasm: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T1-ADVERSARIAL-RETRIEVAL, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-7Naasm/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-7Naasm/cyrene-benchmark-project-75f6fad62bfbbc08
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-e4Nm8o: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T1-ADVERSARIAL-MULTI-DISTRACTOR, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-e4Nm8o/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-e4Nm8o/cyrene-benchmark-project-8738ba75f567b841
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Ylw8Ez: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T1-ABSTAIN-NO-EVIDENCE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Ylw8Ez/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Ylw8Ez/cyrene-benchmark-project-c6a981c384022294
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-CnZnaC: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T1-EVENT-SUMMARY, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-CnZnaC/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-CnZnaC/cyrene-benchmark-project-dafe4c58984e0ab1
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-rcS0Le: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T15-UPGRADE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-rcS0Le/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-rcS0Le/cyrene-benchmark-project-8301ba3ba2889dd7
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-e4UozW: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T15-REPLACE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-e4UozW/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-e4UozW/cyrene-benchmark-project-7de2d07d4083c707
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-jluuXW: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T15-MERGE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-jluuXW/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-jluuXW/cyrene-benchmark-project-dbf69a7712e508ca
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-P6tzUm: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T15-EXPIRE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-P6tzUm/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-P6tzUm/cyrene-benchmark-project-e6514277b3df3ced
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-NCJCa0: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T15-SUPERSEDE-HASH, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-NCJCa0/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-NCJCa0/cyrene-benchmark-project-3ad9e5c15b7dc183
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-UMbXW0: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T15-CONFLICT-SINGLE-INJECTION, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-UMbXW0/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-UMbXW0/cyrene-benchmark-project-94db43e921f1387f
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-oT06dE: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T15-ADVERSARIAL-CONFLICT, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-oT06dE/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-oT06dE/cyrene-benchmark-project-a7836c741c119671
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-4U5ocg: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T15-ADVERSARIAL-SUPERSEDE-STRONG-OLD, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-4U5ocg/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-4U5ocg/cyrene-benchmark-project-b91f64157a4c513a
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-eCQJTK: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T16-PROPOSE-IMPORTANT, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-eCQJTK/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-eCQJTK/cyrene-benchmark-project-6fe7bcd3eb74e748
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-GemXBT: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T16-PROPOSE-NOISE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-GemXBT/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-GemXBT/cyrene-benchmark-project-9d50d1076c0ad966
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Wi4cDw: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T16-PROPOSE-SENSITIVE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Wi4cDw/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Wi4cDw/cyrene-benchmark-project-efbee26558ba1337
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-02rjEK: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T16-PROPOSE-ASSISTANT-INFERENCE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-02rjEK/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-02rjEK/cyrene-benchmark-project-87eb87b9db3e93a5
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-f5lyL3: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T16-ROUTING-NAMESPACE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-f5lyL3/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-f5lyL3/cyrene-benchmark-project-28197982727db3fd
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-AF3iIn: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T16-REVIEW-HASH-REQUIRED, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-AF3iIn/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-AF3iIn/cyrene-benchmark-project-ddb6d5dcd6743fd9
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-uIbBxD: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T16-REVIEW-STALE-HASH, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-uIbBxD/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-uIbBxD/cyrene-benchmark-project-8b81a6b9b183afd8
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-9XXvZP: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T16-REVIEW-REJECT-DEFER, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-9XXvZP/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-9XXvZP/cyrene-benchmark-project-6197d4fbdfd5fa2a
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-qEvdwt: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T16-REVIEW-EDIT-HASH, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-qEvdwt/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-qEvdwt/cyrene-benchmark-project-caf70f731aa86938
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-M2Sd3Y: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T2-REMEMBER-TEST-COMMAND, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-M2Sd3Y/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-M2Sd3Y/cyrene-benchmark-project-d65dd985950a7ea7
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-ebVSwT: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T2-AVOID-REJECTED-APPROACH, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-ebVSwT/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-ebVSwT/cyrene-benchmark-project-594bc4ed733c7e0d
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-OGVx8p: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T2-FOLLOW-WORKFLOW, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-OGVx8p/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-OGVx8p/cyrene-benchmark-project-d16bf8198c1502e4
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-OuA7tW: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T2-UPDATED-RULE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-OuA7tW/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-OuA7tW/cyrene-benchmark-project-feb9784a9b637c06
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-AL8wvu: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T2-CROSS-SESSION-FIX, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-AL8wvu/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-AL8wvu/cyrene-benchmark-project-4b8707f587411f9b
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Evmyv9: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T2-REDUCE-REPEAT-MISTAKE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Evmyv9/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Evmyv9/cyrene-benchmark-project-24f79383707dce18
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-tB1TJ2: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T3-RANKING, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-tB1TJ2/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-tB1TJ2/cyrene-benchmark-project-3807cd2c63322332
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-WZjIFY: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T3-TOKEN-OVERHEAD, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-WZjIFY/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-WZjIFY/cyrene-benchmark-project-18a75d3b938c145c
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-tSy6Pw: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T3-LATENCY, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-tSy6Pw/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-tSy6Pw/cyrene-benchmark-project-44da67a2f694e6c8
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-m46Z5A: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed:T3-INDEX-HEALTH, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-m46Z5A/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-m46Z5A/cyrene-benchmark-project-097d08988cfa6a3f
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-BaiBUA: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-BaiBUA/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-BaiBUA/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-rfJYrs: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-rfJYrs/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-rfJYrs/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-ZemvHx: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-ZemvHx/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-ZemvHx/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Ki0Kuf: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Ki0Kuf/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Ki0Kuf/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-v7YZ18: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-v7YZ18/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-v7YZ18/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Axdkvn: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Axdkvn/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Axdkvn/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-NSbalJ: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-NSbalJ/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-NSbalJ/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-qcNHnk: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-qcNHnk/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-qcNHnk/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-aApffH: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-aApffH/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-aApffH/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-RsVwoR: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-RsVwoR/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-RsVwoR/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-I2PjcL: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-I2PjcL/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-I2PjcL/cyrene-benchmark-project-473c22ab72791535
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-k2JKXr: cleanup=cleaned, preserve=false, seed=stats-fix-full-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-k2JKXr/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-k2JKXr/cyrene-benchmark-project-473c22ab72791535

## Spec

- Path: docs/superpowers/specs/2026-06-05-cyrene-benchmark-eval-system-design.md
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
- Tracked changes: M benchmark/cases/tier0-release-gate.ts, M benchmark/cases/tier1-5-lifecycle.ts, M benchmark/cases/tier1-memory-ability.ts, M benchmark/cases/tier2-memory-to-action.ts, M benchmark/cases/tier3-scale-efficiency.ts, M benchmark/cases/tier4-failure-security.ts, M benchmark/catalog.ts, M benchmark/report.ts, M benchmark/runner.ts, M benchmark/thresholds.ts, M benchmark/types.ts, M docs/superpowers/benchmark-results/2026-06-06-cyrene-benchmark-results.md, M docs/superpowers/specs/2026-06-05-cyrene-benchmark-eval-system-design.md, M plugin/runtime/cyrene-continuity.mjs, M src/codex/codex-benchmark.ts, M src/codex/codex-cli.ts, M src/codex/context-policy.ts, M src/codex/memory-context-preview.ts, M tests/benchmark-cases-ability-action.test.ts, M tests/benchmark-cases-failure-security.test.ts, M tests/benchmark-cases-lifecycle.test.ts, M tests/benchmark-cases-scale.test.ts, M tests/benchmark-cases-tier0.test.ts, M tests/benchmark-cli.test.ts, M tests/benchmark-report.test.ts, M tests/benchmark-runner.test.ts, M tests/benchmark-types.test.ts, M tests/codex-context-policy.test.ts, ?? benchmark/artifacts.ts, ?? docs/superpowers/benchmark-artifacts/, ?? docs/superpowers/plans/2026-06-06-cyrene-benchmark-expansion-plan.md, ?? tests/benchmark-cases-real-replay.test.ts

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

- PASSED T0-MODE-FAST: fast mode excludes review and similar hot paths - mode=fast; pending leakage=0; similar hints=0; full profile read=0; retrieved default writes=0
- PASSED T0-MODE-BALANCED: balanced mode reads full profile without pending details - mode=balanced; full profile read=1; pending leakage=0
- PASSED T0-MODE-REVIEW: review mode is the only mode that reads pending memories - mode=review; pending details visible; pending active injection=0
- PASSED T0-PENDING-BOUNDARY: pending does not leak into ordinary context - pending leakage=0; review pending visibility=1
- PASSED T0-SIMILAR-BOUNDARY: similar project hints never cross project boundary as memory - similar boundary ok; hints=1; foreign active in memory=0; hintVisible=1
- PASSED T0-CROSS-PROJECT-ADVERSARIAL: adversarial similar project memory stays hint-only - adversarial cross-project boundary ok; current=1; foreign active in memory=0; hintVisible=1; migration=0
- PASSED T0-CROSS-PROJECT-PROMPT-INJECTION: foreign prompt-injection memory stays non-current-project hint only - cross-project prompt injection boundary ok; current=1; promptInjectionInjected=0; hintVisible=1; migration=0; profilePollution=0
- PASSED T0-SESSION-HINTS: session hints are transient and never migrate to memory - session hints transient; active migration=0; pending migration=0
- PASSED T0-ACTIVATION-RETRIEVED: activation event defaults do not write retrieved events - retrieved default writes=0
- PASSED T0-SQLITE-HOT-PATH: SQLite and FTS are the default hot path - source=sqlite; fallback=sqlite; retrieved=1; SQLite/FTS hot path ok
- PASSED T0-SURFACE-CONSISTENCY: Skill, MCP, and CLI surfaces expose consistent behavior - policy surface=1; context-preview surface=1; MCP surface=1; skill surface=1; fast/balanced/review contracts aligned
- PASSED T1-FACT-EXTRACTION: extract project facts from coding memories - fact extraction ok; adopted command=npm test -- tests/codex-context-policy.test.ts; retrieval=1
- PASSED T1-MULTI-SESSION-REASONING: reason across multiple sessions - multi-session reasoning ok; rejected reason=generated runtime; later decision=use context policy fixture
- PASSED T1-TEMPORAL-ORDER: answer temporal order questions - temporal reasoning ok; newest rule wins; stale rule excluded
- PASSED T1-KNOWLEDGE-UPDATE: newer memories override stale rules - knowledge update ok; superseded rule excluded; replacement rule=npm run typecheck
- PASSED T1-CONFLICT-HANDLING: handle conflicting memories without double injection - conflict handling ok; single selected rule; conflicting pair injection=0
- PASSED T1-ADVERSARIAL-RETRIEVAL: retrieve target memory over adversarial distractors - adversarial retrieval ok; target retrieved=1; stale/pending/personal/global distractors=0
- PASSED T1-ADVERSARIAL-MULTI-DISTRACTOR: answer target memory while rejecting stale pending personal global and foreign distractors - adversarial multi-distractor ok; target retrieved=1; stalePendingAnswer=0; personalDistractorAnswer=0; globalDistractorAnswer=0; foreignDistractorAnswer=0
- PASSED T1-ABSTAIN-NO-EVIDENCE: abstain when memory evidence is absent - abstention ok; abstain=1; fabricated evidence=0
- PASSED T1-EVENT-SUMMARY: summarize project events from long session memory - event summary ok; summary includes decision/failure/fix/verification
- PASSED T15-UPGRADE: low-risk project memory can upgrade through policy - upgrade lifecycle ok; promotion receipt=promote; promotedTrialToValidated=1; lifecyclePolicy=daily_trial_validation_v1
- PASSED T15-REPLACE: replacement removes stale active rule from injection - replace lifecycle ok; active supersede=supersede; stale active injection=0
- PASSED T15-MERGE: merge combines compatible memory evidence - merge lifecycle ok; deduped=1; supersede tombstone=1
- PASSED T15-EXPIRE: expired memories are excluded from active context - expire lifecycle ok; expired=1; active injection=0
- PASSED T15-SUPERSEDE-HASH: supersede requires valid review hash - stale supersede hash rejected; active writes=0; pending retained=1
- PASSED T15-CONFLICT-SINGLE-INJECTION: conflicting old and new rules inject only one winner - conflict lifecycle ok; single injection=1; stale winner injection=0
- PASSED T15-ADVERSARIAL-CONFLICT: adversarial normalized-key conflict requires explicit supersede - adversarial conflict lifecycle ok; explicit resolution required=1; stale prompt injection=0; single resolved injection=1
- PASSED T15-ADVERSARIAL-SUPERSEDE-STRONG-OLD: explicit supersede beats a strong stale adversarial rule - adversarial strong-old supersede lifecycle ok; strongOldRuleInjected=0; explicitSupersedeHonored=1; single resolved injection=1
- PASSED T16-PROPOSE-IMPORTANT: important project evidence is proposed for review - important project rule candidate proposed for review
- PASSED T16-PROPOSE-NOISE: noise is not proposed as durable memory - noise filtered decision; pending noise=0
- PASSED T16-PROPOSE-SENSITIVE: sensitive content is never persisted - sensitive content rejected; secret persistence=0
- PASSED T16-PROPOSE-ASSISTANT-INFERENCE: assistant-only inference is not promoted as user fact - assistant inference deferred for review; active inference=0
- PASSED T16-ROUTING-NAMESPACE: project and global namespace routing is correct - namespace routing ok; project and global roots isolated
- PASSED T16-REVIEW-HASH-REQUIRED: review approval requires review hash - review hash required; missing reviewHash rejected
- PASSED T16-REVIEW-STALE-HASH: stale review hash cannot approve pending memory - stale hash rejected; active writes=0
- PASSED T16-REVIEW-REJECT-DEFER: reject and defer decisions do not activate memory - reject and defer stay inactive; active writes=0
- PASSED T16-REVIEW-EDIT-HASH: edited review content gets a fresh hash contract - edited candidate receives new hash; stale edit hash rejected
- PASSED T2-REMEMBER-TEST-COMMAND: remember and reuse project test command - action replay ok; with-memory command reused; generic command avoided; noMemory tools=4; withMemory tools=2
- PASSED T2-AVOID-REJECTED-APPROACH: avoid an approach rejected in an earlier session - action replay ok; rejected approach avoided; accepted approach used; noMemory tools=5; withMemory tools=3
- PASSED T2-FOLLOW-WORKFLOW: follow remembered project workflow - action replay ok; workflow rule followed; required steps=4; noMemory tools=4; withMemory tools=4
- PASSED T2-UPDATED-RULE: use updated rule and stop using old rule - action replay ok; updated rule applied; old rule stopped; noMemory tools=6; withMemory tools=3
- PASSED T2-CROSS-SESSION-FIX: apply cross-session fix memory to current task - action replay ok; prior fix pattern applied; stale hash repeat=0; noMemory tools=7; withMemory tools=4
- PASSED T2-REDUCE-REPEAT-MISTAKE: memory reduces repeated mistakes and user corrections - action replay ok; repeated mistake reduction=0.75; corrections reduction=0.60; tool call reduction=0.40; noMemory tools=10; withMemory tools=6
- SKIPPED_WITH_REASON T2-REAL-PROJECT-REPLAY: real project replay validates coding task utility on repo-grounded fixture - profile full does not run this case
- SKIPPED_WITH_REASON T2-REAL-UPDATED-WORKFLOW-REPLAY: real project replay stops using superseded workflow command - profile full does not run this case
- SKIPPED_WITH_REASON T2-REAL-MULTI-FILE-FIX-REPLAY: real project replay applies prior multi-file fix path - profile full does not run this case
- SKIPPED_WITH_REASON T2-REAL-DOCS-ONLY-REPLAY: real project replay keeps docs-only work on docs verification path - profile full does not run this case
- SKIPPED_WITH_REASON T3-S-SCALE: S scale fixture stays within latency and overhead thresholds - profile full does not run this case
- SKIPPED_WITH_REASON T3-M-SCALE: M scale fixture stays within latency and overhead thresholds - profile full does not run this case
- SKIPPED_WITH_REASON T3-L-SCALE: L scale fixture stays within latency and overhead thresholds - profile full does not run this case
- SKIPPED_WITH_REASON T3-XL-SCALE: XL scale fixture reports efficiency without entering release gate hot path - profile full does not run this case
- PASSED T3-RANKING: ranking resists similar memory interference - ranking ok; recallAt3=1; mrr=1; wrongTop1=0; top=ranking-target
- PASSED T3-TOKEN-OVERHEAD: token overhead stays inside profile budget - profile token overhead recorded; contextShape=compact; balancedDiagnosticsVisible=0; fast/balanced/review bounded
- PASSED T3-LATENCY: latency percentiles are reported for continuity and hooks - latency p50/p95/p99 recorded; hook latency recorded; componentZeroMeans=not_executed_or_below_timer_resolution
- PASSED T3-INDEX-HEALTH: index health reports SQLite hit, JSONL fallback, and stale rates - index health ok; sqlite hit rate=1; jsonl fallback=0; stale rate=0
- PASSED T4-SQLITE-UNAVAILABLE: SQLite unavailable path reports fallback policy explicitly - sqlite unavailable diagnostic; available=0; silent fallback success=0; reason=benchmark forced sqlite unavailable
- PASSED T4-JSONL-CORRUPT: corrupt JSONL fixture fails closed with diagnostics - corrupt jsonl rejected; malformed=1; promoted=0; bytes unchanged=1
- PASSED T4-PROFILE-MISSING: missing profile does not pollute context - missing profile handled; profileChars=0; invented profile=0
- PASSED T4-FAST-SUMMARY-MISSING-STALE: missing or stale fast summary never triggers hot-path heavy rebuild - stale fast summary skipped; stale injected=0; hot-path metrics=1; pending preserved=1
- PASSED T4-SESSION-HINTS-EXPIRED: expired session hints are ignored - expired session hints ignored; injected=0; context leak=0
- PASSED T4-MCP-ERROR: MCP error surface returns bounded diagnostics - bounded MCP error; code=continuity_get_failed; diagnosticBytes=200; memory writes=0
- PASSED T4-AUTOMATION-INTERRUPT: automation interruption does not leave memory partial writes - automation idempotent; automationFixtureScale=toy; first promotions=1; second promotions=0; weekly dry-run candidates=1; dry-run writes=0; duplicate promotion=0
- PASSED T4-HOOK-LIGHTWEIGHT: non-Stop lifecycle hook path remains lightweight - non-Stop hook lightweight; hook events=3; hook metric=post_tool_use; continuity metrics=0; ordinary pending review=0
- PASSED T4-HOOK-TIMEOUT: hook timeout does not crash ordinary coding flow - hook timeout fail-open; timeoutSource=simulated_invalid_payload; runtimeHookTimeout=0; continue=1; suppressOutput=1; latencyMs=0
- PASSED T4-SECURITY-SECRETS: secrets are never persisted or reported as memory - secret persistence=0; propose action=reject
- PASSED T4-SECURITY-PROMPT-INJECTION: prompt injection text cannot override benchmark or memory policy - prompt injection rejected by propose path; active writes=0
- PASSED T4-SECURITY-GLOBAL-WRITE: global writes require explicit allowed namespace and policy - unauthorized global write=0; propose action=reject
