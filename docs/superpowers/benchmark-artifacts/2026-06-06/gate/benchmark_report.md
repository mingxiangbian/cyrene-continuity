# Cyrene Benchmark Report

Run ID: e99c2ecaa916b3a5
Profile: gate
Passed: true
Started: 2026-06-06T00:00:00.000Z
Completed: 2026-06-06T00:00:00.000Z

## Summary

- Total cases: 67
- Passed: 24
- Failed: 0
- Skipped with reason: 43
- Not supported without provider: 0

## Profile Caveat

- This profile is bounded by deterministic fixtures unless a provider-backed adapter is explicitly configured.

## Failed Cases

- None

## Skipped Cases

- T1-FACT-EXTRACTION: profile gate does not run this case
- T1-MULTI-SESSION-REASONING: profile gate does not run this case
- T1-TEMPORAL-ORDER: profile gate does not run this case
- T1-KNOWLEDGE-UPDATE: profile gate does not run this case
- T1-CONFLICT-HANDLING: profile gate does not run this case
- T1-ADVERSARIAL-RETRIEVAL: profile gate does not run this case
- T1-ADVERSARIAL-MULTI-DISTRACTOR: profile gate does not run this case
- T1-ABSTAIN-NO-EVIDENCE: profile gate does not run this case
- T1-EVENT-SUMMARY: profile gate does not run this case
- T15-UPGRADE: profile gate does not run this case
- T15-REPLACE: profile gate does not run this case
- T15-MERGE: profile gate does not run this case
- T15-EXPIRE: profile gate does not run this case
- T15-SUPERSEDE-HASH: profile gate does not run this case
- T15-CONFLICT-SINGLE-INJECTION: profile gate does not run this case
- T15-ADVERSARIAL-CONFLICT: profile gate does not run this case
- T15-ADVERSARIAL-SUPERSEDE-STRONG-OLD: profile gate does not run this case
- T2-REMEMBER-TEST-COMMAND: profile gate does not run this case
- T2-AVOID-REJECTED-APPROACH: profile gate does not run this case
- T2-FOLLOW-WORKFLOW: profile gate does not run this case
- T2-UPDATED-RULE: profile gate does not run this case
- T2-CROSS-SESSION-FIX: profile gate does not run this case
- T2-REDUCE-REPEAT-MISTAKE: profile gate does not run this case
- T2-REAL-PROJECT-REPLAY: profile gate does not run this case
- T2-REAL-UPDATED-WORKFLOW-REPLAY: profile gate does not run this case
- T2-REAL-MULTI-FILE-FIX-REPLAY: profile gate does not run this case
- T2-REAL-DOCS-ONLY-REPLAY: profile gate does not run this case
- T3-S-SCALE: profile gate does not run this case
- T3-M-SCALE: profile gate does not run this case
- T3-L-SCALE: profile gate does not run this case
- T3-XL-SCALE: profile gate does not run this case
- T3-RANKING: profile gate does not run this case
- T3-TOKEN-OVERHEAD: profile gate does not run this case
- T3-LATENCY: profile gate does not run this case
- T3-INDEX-HEALTH: profile gate does not run this case
- T4-SQLITE-UNAVAILABLE: profile gate does not run this case
- T4-JSONL-CORRUPT: profile gate does not run this case
- T4-PROFILE-MISSING: profile gate does not run this case
- T4-FAST-SUMMARY-MISSING-STALE: profile gate does not run this case
- T4-SESSION-HINTS-EXPIRED: profile gate does not run this case
- T4-MCP-ERROR: profile gate does not run this case
- T4-AUTOMATION-INTERRUPT: profile gate does not run this case
- T4-HOOK-TIMEOUT: profile gate does not run this case

## Unsupported Cases

- None

## Capability Metrics

- modeAccuracy: 1
- retrievedDefaultWriteRate: 0
- surfaceConsistencyRate: 1
- importantMemoryMissedRate: 0
- proposalPrecision: 1
- proposalRecall: 1
- pendingGeneratedCount: 1
- pendingCandidatesPerSession: 1
- pendingCandidatesPerDay: 1
- manualReviewCount: 2
- lifecyclePromotionAccuracy: 1
- approveCount: 0
- reviewFalsePositiveRate: 0
- stalePendingCount: 0
- rejectCount: 1
- deferCount: 1
- pendingReviewedCount: 2
- editCount: 1
- averageReviewTimeMs: 0
- postToolUseHeavyOperationCount: 0

## Boundary Safety Metrics

- pendingLeakageRate: 0
- pendingMisuseRate: 0
- crossProjectPollutionRate: 0
- similarHintMigrationRate: 0
- profilePollutionRate: 0
- noiseProposalRate: 0
- temporaryStateProposalRate: 0
- sensitiveProposalRate: 0
- assistantInferenceAutoActiveRate: 0
- boundarySafetyRate: 1

## Efficiency Metrics

- fastTokenOverhead: 580
- continuityGetP95FastMs: 24
- balancedTokenOverhead: 601
- continuityGetP95BalancedMs: 20
- continuityGetP95ReviewMs: 37
- sqliteHitRateFreshIndex: 1
- jsonlFallbackRateHotPath: 0
- sqliteQueryP95Ms: 20
- sessionStartHookP50Ms: 36
- sessionStartHookP95Ms: 36
- sessionStartHookP99Ms: 36
- userPromptSubmitHookP50Ms: 18
- userPromptSubmitHookP95Ms: 18
- userPromptSubmitHookP99Ms: 18
- postToolUseHookP50Ms: 18
- postToolUseHookP95Ms: 18
- postToolUseHookP99Ms: 18
- ordinaryHookPendingReviewCount: 0

## Task Utility Metrics

- None

## Metric Aggregation

- boundarySafetyRate: group=boundarySafety, strategy=max, samples=3, sources=T4-SECURITY-SECRETS, T4-SECURITY-PROMPT-INJECTION, T4-SECURITY-GLOBAL-WRITE
- crossProjectPollutionRate: group=boundarySafety, strategy=max, samples=3, sources=T0-SIMILAR-BOUNDARY, T0-CROSS-PROJECT-ADVERSARIAL, T0-CROSS-PROJECT-PROMPT-INJECTION
- manualReviewCount: group=capability, strategy=max, samples=5, sources=T16-PROPOSE-ASSISTANT-INFERENCE, T16-REVIEW-HASH-REQUIRED, T16-REVIEW-STALE-HASH, T16-REVIEW-REJECT-DEFER, T16-REVIEW-EDIT-HASH
- modeAccuracy: group=capability, strategy=min, samples=3, sources=T0-MODE-FAST, T0-MODE-BALANCED, T0-MODE-REVIEW
- pendingGeneratedCount: group=capability, strategy=max, samples=3, sources=T16-PROPOSE-IMPORTANT, T16-PROPOSE-NOISE, T16-PROPOSE-ASSISTANT-INFERENCE
- pendingLeakageRate: group=boundarySafety, strategy=max, samples=2, sources=T0-MODE-BALANCED, T0-PENDING-BOUNDARY
- profilePollutionRate: group=boundarySafety, strategy=max, samples=3, sources=T0-CROSS-PROJECT-ADVERSARIAL, T0-CROSS-PROJECT-PROMPT-INJECTION, T0-SESSION-HINTS
- proposalPrecision: group=capability, strategy=min, samples=3, sources=T16-PROPOSE-IMPORTANT, T16-PROPOSE-NOISE, T16-PROPOSE-SENSITIVE
- reviewFalsePositiveRate: group=capability, strategy=max, samples=2, sources=T16-REVIEW-HASH-REQUIRED, T16-REVIEW-STALE-HASH
- similarHintMigrationRate: group=boundarySafety, strategy=max, samples=4, sources=T0-SIMILAR-BOUNDARY, T0-CROSS-PROJECT-ADVERSARIAL, T0-CROSS-PROJECT-PROMPT-INJECTION, T0-SESSION-HINTS
- stalePendingCount: group=capability, strategy=max, samples=2, sources=T16-REVIEW-STALE-HASH, T16-REVIEW-REJECT-DEFER

## Case Metric Details

- T0-MODE-FAST: modeAccuracy: 1, fastTokenOverhead: 580, continuityGetP95FastMs: 24
- T0-MODE-BALANCED: modeAccuracy: 1, balancedTokenOverhead: 601, continuityGetP95BalancedMs: 20, pendingLeakageRate: 0
- T0-MODE-REVIEW: modeAccuracy: 1, pendingMisuseRate: 0, continuityGetP95ReviewMs: 37
- T0-PENDING-BOUNDARY: pendingLeakageRate: 0
- T0-SIMILAR-BOUNDARY: crossProjectPollutionRate: 0, similarHintMigrationRate: 0
- T0-CROSS-PROJECT-ADVERSARIAL: crossProjectPollutionRate: 0, similarHintMigrationRate: 0, profilePollutionRate: 0
- T0-CROSS-PROJECT-PROMPT-INJECTION: crossProjectPollutionRate: 0, similarHintMigrationRate: 0, profilePollutionRate: 0
- T0-SESSION-HINTS: similarHintMigrationRate: 0, profilePollutionRate: 0
- T0-ACTIVATION-RETRIEVED: retrievedDefaultWriteRate: 0
- T0-SQLITE-HOT-PATH: sqliteHitRateFreshIndex: 1, jsonlFallbackRateHotPath: 0, sqliteQueryP95Ms: 20
- T0-SURFACE-CONSISTENCY: surfaceConsistencyRate: 1
- T16-PROPOSE-IMPORTANT: importantMemoryMissedRate: 0, proposalPrecision: 1, proposalRecall: 1, pendingGeneratedCount: 1, pendingCandidatesPerSession: 1, pendingCandidatesPerDay: 1
- T16-PROPOSE-NOISE: noiseProposalRate: 0, temporaryStateProposalRate: 0, proposalPrecision: 1, pendingGeneratedCount: 0
- T16-PROPOSE-SENSITIVE: sensitiveProposalRate: 0, proposalPrecision: 1
- T16-PROPOSE-ASSISTANT-INFERENCE: assistantInferenceAutoActiveRate: 0, manualReviewCount: 1, pendingGeneratedCount: 1
- T16-ROUTING-NAMESPACE: lifecyclePromotionAccuracy: 1
- T16-REVIEW-HASH-REQUIRED: manualReviewCount: 1, approveCount: 0, reviewFalsePositiveRate: 0
- T16-REVIEW-STALE-HASH: manualReviewCount: 1, stalePendingCount: 0, reviewFalsePositiveRate: 0
- T16-REVIEW-REJECT-DEFER: manualReviewCount: 2, rejectCount: 1, deferCount: 1, pendingReviewedCount: 2, stalePendingCount: 0
- T16-REVIEW-EDIT-HASH: manualReviewCount: 1, editCount: 1, averageReviewTimeMs: 0
- T4-HOOK-LIGHTWEIGHT: sessionStartHookP50Ms: 36, sessionStartHookP95Ms: 36, sessionStartHookP99Ms: 36, userPromptSubmitHookP50Ms: 18, userPromptSubmitHookP95Ms: 18, userPromptSubmitHookP99Ms: 18, postToolUseHookP50Ms: 18, postToolUseHookP95Ms: 18, postToolUseHookP99Ms: 18, postToolUseHeavyOperationCount: 0, ordinaryHookPendingReviewCount: 0
- T4-SECURITY-SECRETS: boundarySafetyRate: 1
- T4-SECURITY-PROMPT-INJECTION: boundarySafetyRate: 1
- T4-SECURITY-GLOBAL-WRITE: boundarySafetyRate: 1

## Scale Results

- None

## Regression Comparison

- None

## Fixture Runs

- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-qMl5Oc: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-qMl5Oc/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-qMl5Oc/cyrene-benchmark-project-ab2a70a4654bc736
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-4jXvqk: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-4jXvqk/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-4jXvqk/cyrene-benchmark-project-ab2a70a4654bc736
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-5BH0E1: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-5BH0E1/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-5BH0E1/cyrene-benchmark-project-ab2a70a4654bc736
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-WCcE8L: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-WCcE8L/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-WCcE8L/cyrene-benchmark-project-ab2a70a4654bc736
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-TYTDNN: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-TYTDNN/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-TYTDNN/cyrene-benchmark-project-ab2a70a4654bc736
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-gm9CFm: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-gm9CFm/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-gm9CFm/cyrene-benchmark-project-ab2a70a4654bc736
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-IjlPFg: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-IjlPFg/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-IjlPFg/cyrene-benchmark-project-ab2a70a4654bc736
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-XlYlkj: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-XlYlkj/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-XlYlkj/cyrene-benchmark-project-ab2a70a4654bc736
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-6IpDoO: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-6IpDoO/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-6IpDoO/cyrene-benchmark-project-ab2a70a4654bc736
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-W3eJCy: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-W3eJCy/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-W3eJCy/cyrene-benchmark-project-ab2a70a4654bc736
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-pMxte3: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-pMxte3/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-pMxte3/cyrene-benchmark-project-ab2a70a4654bc736
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-swovYU: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed:T16-PROPOSE-IMPORTANT, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-swovYU/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-swovYU/cyrene-benchmark-project-731db66f684f2e4d
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-TdAQOH: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed:T16-PROPOSE-NOISE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-TdAQOH/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-TdAQOH/cyrene-benchmark-project-d657459135b61b45
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-G0PKdX: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed:T16-PROPOSE-SENSITIVE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-G0PKdX/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-G0PKdX/cyrene-benchmark-project-4152cf29d83de419
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-SPtwvu: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed:T16-PROPOSE-ASSISTANT-INFERENCE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-SPtwvu/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-SPtwvu/cyrene-benchmark-project-a08ecbf51d577b54
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-ajHQOz: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed:T16-ROUTING-NAMESPACE, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-ajHQOz/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-ajHQOz/cyrene-benchmark-project-a27671b433d4084c
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-T7csoi: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed:T16-REVIEW-HASH-REQUIRED, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-T7csoi/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-T7csoi/cyrene-benchmark-project-924be735410b59cc
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Yqaa57: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed:T16-REVIEW-STALE-HASH, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Yqaa57/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Yqaa57/cyrene-benchmark-project-acc11a831c7473e8
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-R5tJ6Z: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed:T16-REVIEW-REJECT-DEFER, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-R5tJ6Z/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-R5tJ6Z/cyrene-benchmark-project-b0211d7ce63971c7
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-TeZTZ8: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed:T16-REVIEW-EDIT-HASH, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-TeZTZ8/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-TeZTZ8/cyrene-benchmark-project-3671c99321cfa311
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-wcyRPI: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-wcyRPI/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-wcyRPI/cyrene-benchmark-project-ab2a70a4654bc736
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-6fpIHb: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-6fpIHb/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-6fpIHb/cyrene-benchmark-project-ab2a70a4654bc736
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-hRCKuH: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-hRCKuH/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-hRCKuH/cyrene-benchmark-project-ab2a70a4654bc736
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-6T54Gn: cleanup=cleaned, preserve=false, seed=stats-fix-gate-seed, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-6T54Gn/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-6T54Gn/cyrene-benchmark-project-ab2a70a4654bc736

## Spec

- Path: docs/superpowers/specs/2026-06-05-cyrene-benchmark-eval-system-design.md
- Title: Cyrene Benchmark Eval System Design
- Date: 2026-06-05
- Hash: 25332433ee74d0a5170ae1523cb3a2ff96da00ca08533e915604c0e969b20058

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
- Tracked changes: M benchmark/cases/tier0-release-gate.ts, M benchmark/cases/tier1-5-lifecycle.ts, M benchmark/cases/tier1-memory-ability.ts, M benchmark/cases/tier2-memory-to-action.ts, M benchmark/cases/tier3-scale-efficiency.ts, M benchmark/cases/tier4-failure-security.ts, M benchmark/catalog.ts, M benchmark/report.ts, M benchmark/runner.ts, M benchmark/thresholds.ts, M benchmark/types.ts, M docs/superpowers/benchmark-results/2026-06-06-cyrene-benchmark-results.md, M plugin/runtime/cyrene-continuity.mjs, M src/codex/codex-benchmark.ts, M src/codex/codex-cli.ts, M src/codex/context-policy.ts, M src/codex/memory-context-preview.ts, M tests/benchmark-cases-ability-action.test.ts, M tests/benchmark-cases-failure-security.test.ts, M tests/benchmark-cases-lifecycle.test.ts, M tests/benchmark-cases-scale.test.ts, M tests/benchmark-cases-tier0.test.ts, M tests/benchmark-cli.test.ts, M tests/benchmark-report.test.ts, M tests/benchmark-runner.test.ts, M tests/benchmark-types.test.ts, M tests/codex-context-policy.test.ts, ?? benchmark/artifacts.ts, ?? docs/superpowers/benchmark-artifacts/, ?? docs/superpowers/plans/2026-06-06-cyrene-benchmark-expansion-plan.md, ?? tests/benchmark-cases-real-replay.test.ts

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
- SKIPPED_WITH_REASON T1-FACT-EXTRACTION: extract project facts from coding memories - profile gate does not run this case
- SKIPPED_WITH_REASON T1-MULTI-SESSION-REASONING: reason across multiple sessions - profile gate does not run this case
- SKIPPED_WITH_REASON T1-TEMPORAL-ORDER: answer temporal order questions - profile gate does not run this case
- SKIPPED_WITH_REASON T1-KNOWLEDGE-UPDATE: newer memories override stale rules - profile gate does not run this case
- SKIPPED_WITH_REASON T1-CONFLICT-HANDLING: handle conflicting memories without double injection - profile gate does not run this case
- SKIPPED_WITH_REASON T1-ADVERSARIAL-RETRIEVAL: retrieve target memory over adversarial distractors - profile gate does not run this case
- SKIPPED_WITH_REASON T1-ADVERSARIAL-MULTI-DISTRACTOR: answer target memory while rejecting stale pending personal global and foreign distractors - profile gate does not run this case
- SKIPPED_WITH_REASON T1-ABSTAIN-NO-EVIDENCE: abstain when memory evidence is absent - profile gate does not run this case
- SKIPPED_WITH_REASON T1-EVENT-SUMMARY: summarize project events from long session memory - profile gate does not run this case
- SKIPPED_WITH_REASON T15-UPGRADE: low-risk project memory can upgrade through policy - profile gate does not run this case
- SKIPPED_WITH_REASON T15-REPLACE: replacement removes stale active rule from injection - profile gate does not run this case
- SKIPPED_WITH_REASON T15-MERGE: merge combines compatible memory evidence - profile gate does not run this case
- SKIPPED_WITH_REASON T15-EXPIRE: expired memories are excluded from active context - profile gate does not run this case
- SKIPPED_WITH_REASON T15-SUPERSEDE-HASH: supersede requires valid review hash - profile gate does not run this case
- SKIPPED_WITH_REASON T15-CONFLICT-SINGLE-INJECTION: conflicting old and new rules inject only one winner - profile gate does not run this case
- SKIPPED_WITH_REASON T15-ADVERSARIAL-CONFLICT: adversarial normalized-key conflict requires explicit supersede - profile gate does not run this case
- SKIPPED_WITH_REASON T15-ADVERSARIAL-SUPERSEDE-STRONG-OLD: explicit supersede beats a strong stale adversarial rule - profile gate does not run this case
- PASSED T16-PROPOSE-IMPORTANT: important project evidence is proposed for review - important project rule candidate proposed for review
- PASSED T16-PROPOSE-NOISE: noise is not proposed as durable memory - noise filtered decision; pending noise=0
- PASSED T16-PROPOSE-SENSITIVE: sensitive content is never persisted - sensitive content rejected; secret persistence=0
- PASSED T16-PROPOSE-ASSISTANT-INFERENCE: assistant-only inference is not promoted as user fact - assistant inference deferred for review; active inference=0
- PASSED T16-ROUTING-NAMESPACE: project and global namespace routing is correct - namespace routing ok; project and global roots isolated
- PASSED T16-REVIEW-HASH-REQUIRED: review approval requires review hash - review hash required; missing reviewHash rejected
- PASSED T16-REVIEW-STALE-HASH: stale review hash cannot approve pending memory - stale hash rejected; active writes=0
- PASSED T16-REVIEW-REJECT-DEFER: reject and defer decisions do not activate memory - reject and defer stay inactive; active writes=0
- PASSED T16-REVIEW-EDIT-HASH: edited review content gets a fresh hash contract - edited candidate receives new hash; stale edit hash rejected
- SKIPPED_WITH_REASON T2-REMEMBER-TEST-COMMAND: remember and reuse project test command - profile gate does not run this case
- SKIPPED_WITH_REASON T2-AVOID-REJECTED-APPROACH: avoid an approach rejected in an earlier session - profile gate does not run this case
- SKIPPED_WITH_REASON T2-FOLLOW-WORKFLOW: follow remembered project workflow - profile gate does not run this case
- SKIPPED_WITH_REASON T2-UPDATED-RULE: use updated rule and stop using old rule - profile gate does not run this case
- SKIPPED_WITH_REASON T2-CROSS-SESSION-FIX: apply cross-session fix memory to current task - profile gate does not run this case
- SKIPPED_WITH_REASON T2-REDUCE-REPEAT-MISTAKE: memory reduces repeated mistakes and user corrections - profile gate does not run this case
- SKIPPED_WITH_REASON T2-REAL-PROJECT-REPLAY: real project replay validates coding task utility on repo-grounded fixture - profile gate does not run this case
- SKIPPED_WITH_REASON T2-REAL-UPDATED-WORKFLOW-REPLAY: real project replay stops using superseded workflow command - profile gate does not run this case
- SKIPPED_WITH_REASON T2-REAL-MULTI-FILE-FIX-REPLAY: real project replay applies prior multi-file fix path - profile gate does not run this case
- SKIPPED_WITH_REASON T2-REAL-DOCS-ONLY-REPLAY: real project replay keeps docs-only work on docs verification path - profile gate does not run this case
- SKIPPED_WITH_REASON T3-S-SCALE: S scale fixture stays within latency and overhead thresholds - profile gate does not run this case
- SKIPPED_WITH_REASON T3-M-SCALE: M scale fixture stays within latency and overhead thresholds - profile gate does not run this case
- SKIPPED_WITH_REASON T3-L-SCALE: L scale fixture stays within latency and overhead thresholds - profile gate does not run this case
- SKIPPED_WITH_REASON T3-XL-SCALE: XL scale fixture reports efficiency without entering release gate hot path - profile gate does not run this case
- SKIPPED_WITH_REASON T3-RANKING: ranking resists similar memory interference - profile gate does not run this case
- SKIPPED_WITH_REASON T3-TOKEN-OVERHEAD: token overhead stays inside profile budget - profile gate does not run this case
- SKIPPED_WITH_REASON T3-LATENCY: latency percentiles are reported for continuity and hooks - profile gate does not run this case
- SKIPPED_WITH_REASON T3-INDEX-HEALTH: index health reports SQLite hit, JSONL fallback, and stale rates - profile gate does not run this case
- SKIPPED_WITH_REASON T4-SQLITE-UNAVAILABLE: SQLite unavailable path reports fallback policy explicitly - profile gate does not run this case
- SKIPPED_WITH_REASON T4-JSONL-CORRUPT: corrupt JSONL fixture fails closed with diagnostics - profile gate does not run this case
- SKIPPED_WITH_REASON T4-PROFILE-MISSING: missing profile does not pollute context - profile gate does not run this case
- SKIPPED_WITH_REASON T4-FAST-SUMMARY-MISSING-STALE: missing or stale fast summary never triggers hot-path heavy rebuild - profile gate does not run this case
- SKIPPED_WITH_REASON T4-SESSION-HINTS-EXPIRED: expired session hints are ignored - profile gate does not run this case
- SKIPPED_WITH_REASON T4-MCP-ERROR: MCP error surface returns bounded diagnostics - profile gate does not run this case
- SKIPPED_WITH_REASON T4-AUTOMATION-INTERRUPT: automation interruption does not leave memory partial writes - profile gate does not run this case
- PASSED T4-HOOK-LIGHTWEIGHT: non-Stop lifecycle hook path remains lightweight - non-Stop hook lightweight; hook events=3; hook metric=post_tool_use; continuity metrics=0; ordinary pending review=0
- SKIPPED_WITH_REASON T4-HOOK-TIMEOUT: hook timeout does not crash ordinary coding flow - profile gate does not run this case
- PASSED T4-SECURITY-SECRETS: secrets are never persisted or reported as memory - secret persistence=0; propose action=reject
- PASSED T4-SECURITY-PROMPT-INJECTION: prompt injection text cannot override benchmark or memory policy - prompt injection rejected by propose path; active writes=0
- PASSED T4-SECURITY-GLOBAL-WRITE: global writes require explicit allowed namespace and policy - unauthorized global write=0; propose action=reject
