# Cyrene Benchmark Report

Run ID: 06cf0c1deb5a7bdc
Profile: real-replay
Passed: true
Started: 2026-06-06T00:00:00.000Z
Completed: 2026-06-06T00:00:00.000Z

## Summary

- Total cases: 67
- Passed: 4
- Failed: 0
- Skipped with reason: 63
- Not supported without provider: 0

## Profile Caveat

- This profile is bounded by deterministic fixtures unless a provider-backed adapter is explicitly configured.

## Failed Cases

- None

## Skipped Cases

- T0-MODE-FAST: profile real-replay does not run this case
- T0-MODE-BALANCED: profile real-replay does not run this case
- T0-MODE-REVIEW: profile real-replay does not run this case
- T0-PENDING-BOUNDARY: profile real-replay does not run this case
- T0-SIMILAR-BOUNDARY: profile real-replay does not run this case
- T0-CROSS-PROJECT-ADVERSARIAL: profile real-replay does not run this case
- T0-CROSS-PROJECT-PROMPT-INJECTION: profile real-replay does not run this case
- T0-SESSION-HINTS: profile real-replay does not run this case
- T0-ACTIVATION-RETRIEVED: profile real-replay does not run this case
- T0-SQLITE-HOT-PATH: profile real-replay does not run this case
- T0-SURFACE-CONSISTENCY: profile real-replay does not run this case
- T1-FACT-EXTRACTION: profile real-replay does not run this case
- T1-MULTI-SESSION-REASONING: profile real-replay does not run this case
- T1-TEMPORAL-ORDER: profile real-replay does not run this case
- T1-KNOWLEDGE-UPDATE: profile real-replay does not run this case
- T1-CONFLICT-HANDLING: profile real-replay does not run this case
- T1-ADVERSARIAL-RETRIEVAL: profile real-replay does not run this case
- T1-ADVERSARIAL-MULTI-DISTRACTOR: profile real-replay does not run this case
- T1-ABSTAIN-NO-EVIDENCE: profile real-replay does not run this case
- T1-EVENT-SUMMARY: profile real-replay does not run this case
- T15-UPGRADE: profile real-replay does not run this case
- T15-REPLACE: profile real-replay does not run this case
- T15-MERGE: profile real-replay does not run this case
- T15-EXPIRE: profile real-replay does not run this case
- T15-SUPERSEDE-HASH: profile real-replay does not run this case
- T15-CONFLICT-SINGLE-INJECTION: profile real-replay does not run this case
- T15-ADVERSARIAL-CONFLICT: profile real-replay does not run this case
- T15-ADVERSARIAL-SUPERSEDE-STRONG-OLD: profile real-replay does not run this case
- T16-PROPOSE-IMPORTANT: profile real-replay does not run this case
- T16-PROPOSE-NOISE: profile real-replay does not run this case
- T16-PROPOSE-SENSITIVE: profile real-replay does not run this case
- T16-PROPOSE-ASSISTANT-INFERENCE: profile real-replay does not run this case
- T16-ROUTING-NAMESPACE: profile real-replay does not run this case
- T16-REVIEW-HASH-REQUIRED: profile real-replay does not run this case
- T16-REVIEW-STALE-HASH: profile real-replay does not run this case
- T16-REVIEW-REJECT-DEFER: profile real-replay does not run this case
- T16-REVIEW-EDIT-HASH: profile real-replay does not run this case
- T2-REMEMBER-TEST-COMMAND: profile real-replay does not run this case
- T2-AVOID-REJECTED-APPROACH: profile real-replay does not run this case
- T2-FOLLOW-WORKFLOW: profile real-replay does not run this case
- T2-UPDATED-RULE: profile real-replay does not run this case
- T2-CROSS-SESSION-FIX: profile real-replay does not run this case
- T2-REDUCE-REPEAT-MISTAKE: profile real-replay does not run this case
- T3-S-SCALE: profile real-replay does not run this case
- T3-M-SCALE: profile real-replay does not run this case
- T3-L-SCALE: profile real-replay does not run this case
- T3-XL-SCALE: profile real-replay does not run this case
- T3-RANKING: profile real-replay does not run this case
- T3-TOKEN-OVERHEAD: profile real-replay does not run this case
- T3-LATENCY: profile real-replay does not run this case
- T3-INDEX-HEALTH: profile real-replay does not run this case
- T4-SQLITE-UNAVAILABLE: profile real-replay does not run this case
- T4-JSONL-CORRUPT: profile real-replay does not run this case
- T4-PROFILE-MISSING: profile real-replay does not run this case
- T4-FAST-SUMMARY-MISSING-STALE: profile real-replay does not run this case
- T4-SESSION-HINTS-EXPIRED: profile real-replay does not run this case
- T4-MCP-ERROR: profile real-replay does not run this case
- T4-AUTOMATION-INTERRUPT: profile real-replay does not run this case
- T4-HOOK-LIGHTWEIGHT: profile real-replay does not run this case
- T4-HOOK-TIMEOUT: profile real-replay does not run this case
- T4-SECURITY-SECRETS: profile real-replay does not run this case
- T4-SECURITY-PROMPT-INJECTION: profile real-replay does not run this case
- T4-SECURITY-GLOBAL-WRITE: profile real-replay does not run this case

## Unsupported Cases

- None

## Capability Metrics

- None

## Boundary Safety Metrics

- None

## Efficiency Metrics

- None

## Task Utility Metrics

- taskSuccessRate: 1
- toolCallCount: 8
- noMemoryTaskSuccessRate: 0
- withMemoryTaskSuccessRate: 1
- repeatedMistakeReduction: 0.75
- userCorrectionReduction: 0.75
- toolCallReduction: 0.38461538461538464

## Metric Aggregation

- noMemoryTaskSuccessRate: group=taskUtility, strategy=min, samples=4, sources=T2-REAL-PROJECT-REPLAY, T2-REAL-UPDATED-WORKFLOW-REPLAY, T2-REAL-MULTI-FILE-FIX-REPLAY, T2-REAL-DOCS-ONLY-REPLAY
- repeatedMistakeReduction: group=taskUtility, strategy=min, samples=4, sources=T2-REAL-PROJECT-REPLAY, T2-REAL-UPDATED-WORKFLOW-REPLAY, T2-REAL-MULTI-FILE-FIX-REPLAY, T2-REAL-DOCS-ONLY-REPLAY
- taskSuccessRate: group=taskUtility, strategy=min, samples=4, sources=T2-REAL-PROJECT-REPLAY, T2-REAL-UPDATED-WORKFLOW-REPLAY, T2-REAL-MULTI-FILE-FIX-REPLAY, T2-REAL-DOCS-ONLY-REPLAY
- toolCallCount: group=taskUtility, strategy=max, samples=4, sources=T2-REAL-PROJECT-REPLAY, T2-REAL-UPDATED-WORKFLOW-REPLAY, T2-REAL-MULTI-FILE-FIX-REPLAY, T2-REAL-DOCS-ONLY-REPLAY
- toolCallReduction: group=taskUtility, strategy=min, samples=4, sources=T2-REAL-PROJECT-REPLAY, T2-REAL-UPDATED-WORKFLOW-REPLAY, T2-REAL-MULTI-FILE-FIX-REPLAY, T2-REAL-DOCS-ONLY-REPLAY
- userCorrectionReduction: group=taskUtility, strategy=min, samples=4, sources=T2-REAL-PROJECT-REPLAY, T2-REAL-UPDATED-WORKFLOW-REPLAY, T2-REAL-MULTI-FILE-FIX-REPLAY, T2-REAL-DOCS-ONLY-REPLAY
- withMemoryTaskSuccessRate: group=taskUtility, strategy=min, samples=4, sources=T2-REAL-PROJECT-REPLAY, T2-REAL-UPDATED-WORKFLOW-REPLAY, T2-REAL-MULTI-FILE-FIX-REPLAY, T2-REAL-DOCS-ONLY-REPLAY

## Case Metric Details

- T2-REAL-PROJECT-REPLAY: taskSuccessRate: 1, toolCallCount: 8, noMemoryTaskSuccessRate: 0, withMemoryTaskSuccessRate: 1, repeatedMistakeReduction: 0.75, userCorrectionReduction: 0.75, toolCallReduction: 0.38461538461538464
- T2-REAL-UPDATED-WORKFLOW-REPLAY: taskSuccessRate: 1, toolCallCount: 7, noMemoryTaskSuccessRate: 0, withMemoryTaskSuccessRate: 1, repeatedMistakeReduction: 0.75, userCorrectionReduction: 0.75, toolCallReduction: 0.4166666666666667
- T2-REAL-MULTI-FILE-FIX-REPLAY: taskSuccessRate: 1, toolCallCount: 8, noMemoryTaskSuccessRate: 0, withMemoryTaskSuccessRate: 1, repeatedMistakeReduction: 0.8, userCorrectionReduction: 0.8, toolCallReduction: 0.42857142857142855
- T2-REAL-DOCS-ONLY-REPLAY: taskSuccessRate: 1, toolCallCount: 4, noMemoryTaskSuccessRate: 0, withMemoryTaskSuccessRate: 1, repeatedMistakeReduction: 1, userCorrectionReduction: 1, toolCallReduction: 0.5555555555555556

## Scale Results

- None

## Regression Comparison

- None

## Fixture Runs

- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-2QTq5k: cleanup=cleaned, preserve=false, seed=stats-fix-real-replay-seed:T2-REAL-PROJECT-REPLAY, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-2QTq5k/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-2QTq5k/cyrene-benchmark-project-da3695e6d8ed74f4
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-YnKWqJ: cleanup=cleaned, preserve=false, seed=stats-fix-real-replay-seed:T2-REAL-UPDATED-WORKFLOW-REPLAY, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-YnKWqJ/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-YnKWqJ/cyrene-benchmark-project-9e8cf58e57363371
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Dlz3mr: cleanup=cleaned, preserve=false, seed=stats-fix-real-replay-seed:T2-REAL-MULTI-FILE-FIX-REPLAY, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Dlz3mr/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-Dlz3mr/cyrene-benchmark-project-59c7d5f7d9b00e8c
- /var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-afrfC9: cleanup=cleaned, preserve=false, seed=stats-fix-real-replay-seed:T2-REAL-DOCS-ONLY-REPLAY, clock=2026-06-06T00:00:00.000Z, timezone=UTC, home=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-afrfC9/home, cwd=/var/folders/fc/xsmmw4_54gb1tl6lwrc_nh640000gn/T/cyrene-benchmark-afrfC9/cyrene-benchmark-project-453546e658d61dae

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

- SKIPPED_WITH_REASON T0-MODE-FAST: fast mode excludes review and similar hot paths - profile real-replay does not run this case
- SKIPPED_WITH_REASON T0-MODE-BALANCED: balanced mode reads full profile without pending details - profile real-replay does not run this case
- SKIPPED_WITH_REASON T0-MODE-REVIEW: review mode is the only mode that reads pending memories - profile real-replay does not run this case
- SKIPPED_WITH_REASON T0-PENDING-BOUNDARY: pending does not leak into ordinary context - profile real-replay does not run this case
- SKIPPED_WITH_REASON T0-SIMILAR-BOUNDARY: similar project hints never cross project boundary as memory - profile real-replay does not run this case
- SKIPPED_WITH_REASON T0-CROSS-PROJECT-ADVERSARIAL: adversarial similar project memory stays hint-only - profile real-replay does not run this case
- SKIPPED_WITH_REASON T0-CROSS-PROJECT-PROMPT-INJECTION: foreign prompt-injection memory stays non-current-project hint only - profile real-replay does not run this case
- SKIPPED_WITH_REASON T0-SESSION-HINTS: session hints are transient and never migrate to memory - profile real-replay does not run this case
- SKIPPED_WITH_REASON T0-ACTIVATION-RETRIEVED: activation event defaults do not write retrieved events - profile real-replay does not run this case
- SKIPPED_WITH_REASON T0-SQLITE-HOT-PATH: SQLite and FTS are the default hot path - profile real-replay does not run this case
- SKIPPED_WITH_REASON T0-SURFACE-CONSISTENCY: Skill, MCP, and CLI surfaces expose consistent behavior - profile real-replay does not run this case
- SKIPPED_WITH_REASON T1-FACT-EXTRACTION: extract project facts from coding memories - profile real-replay does not run this case
- SKIPPED_WITH_REASON T1-MULTI-SESSION-REASONING: reason across multiple sessions - profile real-replay does not run this case
- SKIPPED_WITH_REASON T1-TEMPORAL-ORDER: answer temporal order questions - profile real-replay does not run this case
- SKIPPED_WITH_REASON T1-KNOWLEDGE-UPDATE: newer memories override stale rules - profile real-replay does not run this case
- SKIPPED_WITH_REASON T1-CONFLICT-HANDLING: handle conflicting memories without double injection - profile real-replay does not run this case
- SKIPPED_WITH_REASON T1-ADVERSARIAL-RETRIEVAL: retrieve target memory over adversarial distractors - profile real-replay does not run this case
- SKIPPED_WITH_REASON T1-ADVERSARIAL-MULTI-DISTRACTOR: answer target memory while rejecting stale pending personal global and foreign distractors - profile real-replay does not run this case
- SKIPPED_WITH_REASON T1-ABSTAIN-NO-EVIDENCE: abstain when memory evidence is absent - profile real-replay does not run this case
- SKIPPED_WITH_REASON T1-EVENT-SUMMARY: summarize project events from long session memory - profile real-replay does not run this case
- SKIPPED_WITH_REASON T15-UPGRADE: low-risk project memory can upgrade through policy - profile real-replay does not run this case
- SKIPPED_WITH_REASON T15-REPLACE: replacement removes stale active rule from injection - profile real-replay does not run this case
- SKIPPED_WITH_REASON T15-MERGE: merge combines compatible memory evidence - profile real-replay does not run this case
- SKIPPED_WITH_REASON T15-EXPIRE: expired memories are excluded from active context - profile real-replay does not run this case
- SKIPPED_WITH_REASON T15-SUPERSEDE-HASH: supersede requires valid review hash - profile real-replay does not run this case
- SKIPPED_WITH_REASON T15-CONFLICT-SINGLE-INJECTION: conflicting old and new rules inject only one winner - profile real-replay does not run this case
- SKIPPED_WITH_REASON T15-ADVERSARIAL-CONFLICT: adversarial normalized-key conflict requires explicit supersede - profile real-replay does not run this case
- SKIPPED_WITH_REASON T15-ADVERSARIAL-SUPERSEDE-STRONG-OLD: explicit supersede beats a strong stale adversarial rule - profile real-replay does not run this case
- SKIPPED_WITH_REASON T16-PROPOSE-IMPORTANT: important project evidence is proposed for review - profile real-replay does not run this case
- SKIPPED_WITH_REASON T16-PROPOSE-NOISE: noise is not proposed as durable memory - profile real-replay does not run this case
- SKIPPED_WITH_REASON T16-PROPOSE-SENSITIVE: sensitive content is never persisted - profile real-replay does not run this case
- SKIPPED_WITH_REASON T16-PROPOSE-ASSISTANT-INFERENCE: assistant-only inference is not promoted as user fact - profile real-replay does not run this case
- SKIPPED_WITH_REASON T16-ROUTING-NAMESPACE: project and global namespace routing is correct - profile real-replay does not run this case
- SKIPPED_WITH_REASON T16-REVIEW-HASH-REQUIRED: review approval requires review hash - profile real-replay does not run this case
- SKIPPED_WITH_REASON T16-REVIEW-STALE-HASH: stale review hash cannot approve pending memory - profile real-replay does not run this case
- SKIPPED_WITH_REASON T16-REVIEW-REJECT-DEFER: reject and defer decisions do not activate memory - profile real-replay does not run this case
- SKIPPED_WITH_REASON T16-REVIEW-EDIT-HASH: edited review content gets a fresh hash contract - profile real-replay does not run this case
- SKIPPED_WITH_REASON T2-REMEMBER-TEST-COMMAND: remember and reuse project test command - profile real-replay does not run this case
- SKIPPED_WITH_REASON T2-AVOID-REJECTED-APPROACH: avoid an approach rejected in an earlier session - profile real-replay does not run this case
- SKIPPED_WITH_REASON T2-FOLLOW-WORKFLOW: follow remembered project workflow - profile real-replay does not run this case
- SKIPPED_WITH_REASON T2-UPDATED-RULE: use updated rule and stop using old rule - profile real-replay does not run this case
- SKIPPED_WITH_REASON T2-CROSS-SESSION-FIX: apply cross-session fix memory to current task - profile real-replay does not run this case
- SKIPPED_WITH_REASON T2-REDUCE-REPEAT-MISTAKE: memory reduces repeated mistakes and user corrections - profile real-replay does not run this case
- PASSED T2-REAL-PROJECT-REPLAY: real project replay validates coding task utility on repo-grounded fixture - real project replay ok; fixture files verified; repeated mistake reduction=0.75; corrections reduction=0.75; tool call reduction=0.38; noMemory tools=13; withMemory tools=8
- PASSED T2-REAL-UPDATED-WORKFLOW-REPLAY: real project replay stops using superseded workflow command - real project replay ok; fixture files verified; updated workflow command applied; repeated mistake reduction=0.75; corrections reduction=0.75; tool call reduction=0.42; noMemory tools=12; withMemory tools=7
- PASSED T2-REAL-MULTI-FILE-FIX-REPLAY: real project replay applies prior multi-file fix path - real project replay ok; fixture files verified; source test and docs updated together; repeated mistake reduction=0.80; corrections reduction=0.80; tool call reduction=0.43; noMemory tools=14; withMemory tools=8
- PASSED T2-REAL-DOCS-ONLY-REPLAY: real project replay keeps docs-only work on docs verification path - real project replay ok; fixture files verified; docs-only verification applied; repeated mistake reduction=1.00; corrections reduction=1.00; tool call reduction=0.56; noMemory tools=9; withMemory tools=4
- SKIPPED_WITH_REASON T3-S-SCALE: S scale fixture stays within latency and overhead thresholds - profile real-replay does not run this case
- SKIPPED_WITH_REASON T3-M-SCALE: M scale fixture stays within latency and overhead thresholds - profile real-replay does not run this case
- SKIPPED_WITH_REASON T3-L-SCALE: L scale fixture stays within latency and overhead thresholds - profile real-replay does not run this case
- SKIPPED_WITH_REASON T3-XL-SCALE: XL scale fixture reports efficiency without entering release gate hot path - profile real-replay does not run this case
- SKIPPED_WITH_REASON T3-RANKING: ranking resists similar memory interference - profile real-replay does not run this case
- SKIPPED_WITH_REASON T3-TOKEN-OVERHEAD: token overhead stays inside profile budget - profile real-replay does not run this case
- SKIPPED_WITH_REASON T3-LATENCY: latency percentiles are reported for continuity and hooks - profile real-replay does not run this case
- SKIPPED_WITH_REASON T3-INDEX-HEALTH: index health reports SQLite hit, JSONL fallback, and stale rates - profile real-replay does not run this case
- SKIPPED_WITH_REASON T4-SQLITE-UNAVAILABLE: SQLite unavailable path reports fallback policy explicitly - profile real-replay does not run this case
- SKIPPED_WITH_REASON T4-JSONL-CORRUPT: corrupt JSONL fixture fails closed with diagnostics - profile real-replay does not run this case
- SKIPPED_WITH_REASON T4-PROFILE-MISSING: missing profile does not pollute context - profile real-replay does not run this case
- SKIPPED_WITH_REASON T4-FAST-SUMMARY-MISSING-STALE: missing or stale fast summary never triggers hot-path heavy rebuild - profile real-replay does not run this case
- SKIPPED_WITH_REASON T4-SESSION-HINTS-EXPIRED: expired session hints are ignored - profile real-replay does not run this case
- SKIPPED_WITH_REASON T4-MCP-ERROR: MCP error surface returns bounded diagnostics - profile real-replay does not run this case
- SKIPPED_WITH_REASON T4-AUTOMATION-INTERRUPT: automation interruption does not leave memory partial writes - profile real-replay does not run this case
- SKIPPED_WITH_REASON T4-HOOK-LIGHTWEIGHT: non-Stop lifecycle hook path remains lightweight - profile real-replay does not run this case
- SKIPPED_WITH_REASON T4-HOOK-TIMEOUT: hook timeout does not crash ordinary coding flow - profile real-replay does not run this case
- SKIPPED_WITH_REASON T4-SECURITY-SECRETS: secrets are never persisted or reported as memory - profile real-replay does not run this case
- SKIPPED_WITH_REASON T4-SECURITY-PROMPT-INJECTION: prompt injection text cannot override benchmark or memory policy - profile real-replay does not run this case
- SKIPPED_WITH_REASON T4-SECURITY-GLOBAL-WRITE: global writes require explicit allowed namespace and policy - profile real-replay does not run this case
