# Cyrene Benchmark Results - 2026-06-06

This record captures the benchmark suite runs from 2026-06-06 Asia/Shanghai. It
includes the follow-up metric pass, a clean-git baseline rerun, and the
adversarial fixture verification added for retrieval, conflict handling, and
cross-project boundaries.

## Metadata

- Benchmark version: `1.0.0`
- Threshold version: `2026-06-05`
- Metric pass case catalog hash: `e1e12842c080bb3eb3ac6354ac6abb058787f49cbffaee86cd557be19b436988`
- Clean HEAD case catalog hash: `5ed2880982e940c4c8c2c6a83fd0f571a425f4b990ea39f317cfd69f8020f9cf`
- Current adversarial case catalog hash: `88d2e90484e01f2af7b9bcddaa0c4a58d5c013ce5f257241f86f8f0ea2a65725`
- Spec: `docs/superpowers/specs/2026-06-05-cyrene-benchmark-eval-system-design.md`
- Implementation plan:
  `docs/superpowers/plans/2026-06-05-cyrene-benchmark-eval-system-implementation-plan.md`
- Spec hash: `25332433ee74d0a5170ae1523cb3a2ff96da00ca08533e915604c0e969b20058`
- Git commit recorded by reports: `21b93b1b1fbbb4e1af53a667f9610f205b57c3c7`
- Runtime recorded by reports: Node `v25.9.0`, npm `11.12.1`, `darwin/arm64`
- Git dirty state recorded by reports: yes. Dirty files included this benchmark
  metric update plus pre-existing local changes in
  `plugin/runtime/cyrene-continuity.mjs`, `src/codex/context-policy.ts`,
  `src/codex/memory-context-preview.ts`, and
  `tests/codex-context-policy.test.ts`.

## Metric Profile Results

| Profile | Run ID | Passed | Passed cases | Failed | Skipped | Unsupported | Hard failures | Threshold breaches | Report dir |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| smoke | `b429047b4df2ec2e` | true | 4 | 0 | 53 | 0 | 0 | 0 | `/tmp/cyrene-benchmark-20260606-metrics-smoke` |
| gate | `2f5c1ecbbe80919a` | true | 22 | 0 | 35 | 0 | 0 | 0 | `/tmp/cyrene-benchmark-20260606-metrics-gate` |
| full | `7a5b981f2205272b` | true | 53 | 0 | 4 | 0 | 0 | 0 | `/tmp/cyrene-benchmark-20260606-metrics-full` |
| scale | `96a99803bd009341` | true | 8 | 0 | 49 | 0 | 0 | 0 | `/tmp/cyrene-benchmark-20260606-metrics-scale` |
| llm | `13028600e78bf7bf` | true | 5 | 0 | 51 | 1 | 0 | 0 | `/tmp/cyrene-benchmark-20260606-metrics-llm` |
| external | `3975a2c7ffe73b5b` | false | 0 | 0 | 56 | 1 | 0 | 0 | `/tmp/cyrene-benchmark-20260606-metrics-external` |

`external` is false because no external provider environment was configured.
The profile produced `notSupportedWithoutProvider=1`, `failed=0`, and
`hardFailures=0`; this is the expected adapter behavior until an external
provider such as `CYRENE_BENCHMARK_MEM0_PROVIDER` is configured.

## Clean Git State Rerun

The clean baseline was run from temporary worktree
`.worktrees/clean-benchmark-20260606` on commit
`21b93b1b1fbbb4e1af53a667f9610f205b57c3c7`. All reports recorded
`git.dirty=false`, `trackedChanges=[]`, `hardFailures=0`, and
`thresholdBreaches=0`. The temporary worktree and branch were removed after the
run.

| Profile | Run ID | Passed | Total cases | Passed cases | Failed | Skipped | Unsupported | Report dir |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| smoke | `ee31ec743f3d2536` | true | 57 | 4 | 0 | 53 | 0 | `/tmp/cyrene-benchmark-clean-20260606-smoke` |
| gate | `6f1604b9379b9fea` | true | 57 | 22 | 0 | 35 | 0 | `/tmp/cyrene-benchmark-clean-20260606-gate` |
| full | `e014e34f84db01e6` | true | 57 | 53 | 0 | 4 | 0 | `/tmp/cyrene-benchmark-clean-20260606-full` |
| scale | `38d9a517aab07784` | true | 57 | 8 | 0 | 49 | 0 | `/tmp/cyrene-benchmark-clean-20260606-scale` |

## Adversarial Fixture Verification

The current working-tree verification includes three new cases:
`T0-CROSS-PROJECT-ADVERSARIAL`, `T1-ADVERSARIAL-RETRIEVAL`, and
`T15-ADVERSARIAL-CONFLICT`. These reports are intentionally dirty because they
include the new fixture code plus the pre-existing local changes listed in the
report metadata.

| Profile | Run ID | Passed | Total cases | Passed cases | Failed | Skipped | Hard failures | Threshold breaches | Report dir |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| gate | `37517b9d8c301a1d` | true | 60 | 23 | 0 | 37 | 0 | 0 | `/tmp/cyrene-benchmark-20260606-adversarial-gate` |
| full | `1e3fc7bb93e9d0e8` | true | 60 | 56 | 0 | 4 | 0 | 0 | `/tmp/cyrene-benchmark-20260606-adversarial-full` |

| Case | Evidence | Metric result |
| --- | --- | --- |
| `T0-CROSS-PROJECT-ADVERSARIAL` | `current=1`, `foreign active in memory=0`, `hintVisible=1`, `migration=0` | `crossProjectPollutionRate=0`, `similarHintMigrationRate=0`, `profilePollutionRate=0` |
| `T1-ADVERSARIAL-RETRIEVAL` | `target retrieved=1`, `stale/pending/personal/global distractors=0` | `retrievalAccuracy=1`, `answerAccuracy=1`, `similarMemoryInterferenceRate=0` |
| `T15-ADVERSARIAL-CONFLICT` | `explicit resolution required=1`, `stale prompt injection=0`, `single resolved injection=1` | `conflictResolutionAccuracy=1`, `staleMemoryLeakageRate=0`, `duplicateActiveMemoryRate=0` |

## Release Gate Snapshot

| Check | Metric result |
| --- | --- |
| Fast mode stays light | `fastTokenOverhead=580`, `continuityGetP95FastMs=38` in gate |
| Balanced reads profile without pending leakage | `balancedTokenOverhead=601`, `continuityGetP95BalancedMs=48`, `pendingLeakageRate=0` |
| Review is the pending path | `continuityGetP95ReviewMs=119`, `pendingMisuseRate=0` |
| Pending boundary | `pendingLeakageRate=0` |
| Similar/session/profile boundaries | `crossProjectPollutionRate=0`, `similarHintMigrationRate=0`, `profilePollutionRate=0` |
| Retrieved event default | `retrievedDefaultWriteRate=0` |
| SQLite hot path | `sqliteHitRateFreshIndex=1`, `jsonlFallbackRateHotPath=0`, `sqliteQueryP95Ms=24` |
| Skill/MCP/CLI consistency | `surfaceConsistencyRate=1` |
| Lightweight hook | `postToolUseHookP95Ms=18`, `postToolUseHeavyOperationCount=0`, `ordinaryHookPendingReviewCount=0` |

## Capability And Boundary Metrics

Full profile capability metrics passed with `retrievalAccuracy=1`,
`answerAccuracy=1`, `abstentionAccuracy=1`, `conflictResolutionAccuracy=1`,
`updateAccuracy=1`, and no hard failures.

Ranking and similar-memory interference were measured in Tier 3:
`recallAt1=1`, `recallAt3=1`, `recallAt5=1`, `mrr=1`, `top1Accuracy=1`,
`wrongTop1Rate=0`, `irrelevantRetrievalRate=0`,
`similarMemoryInterferenceRate=0`, `staleMemoryRetrievalRate=0`,
`oldMemoryRetrievalRate=0`, and `newMemoryRetrievalRate=1`.

Proposal/review burden metrics were added to Tier 1.6:
`importantMemoryMissedRate=0`, `proposalPrecision=1`, `proposalRecall=1`,
`noiseProposalRate=0`,
`temporaryStateProposalRate=0`, `sensitiveProposalRate=0`,
`assistantInferenceAutoActiveRate=0`, `manualReviewCount=2` for reject/defer,
`rejectCount=1`, `deferCount=1`, `editCount=1`, and `stalePendingCount=0`.

## Lifecycle And Automation Metrics

Lifecycle cases now report promotion, replacement, merge, rollback, and stale
propagation metrics:

| Case | Metric result |
| --- | --- |
| `T15-UPGRADE` | `promotionAccuracy=1`, `lifecyclePromotionAccuracy=1`, `dailyPromotedCount=1`, `activationEventGrowth=1`, `auditLogGrowth=1` |
| `T15-REPLACE` | `replacementAccuracy=1`, `staleMemoryLeakageRate=0`, `duplicateActiveMemoryRate=0`, `pendingReviewedCount=1`, `approveCount=1` |
| `T15-MERGE` | `mergeAccuracy=1`, `duplicateActiveMemoryRate=0`, `duplicatePendingRate=0`, `conflictResolutionAccuracy=1` |
| `T15-CONFLICT-SINGLE-INJECTION` | `conflictResolutionAccuracy=1`, `summaryStalePropagationAccuracy=1`, `staleMemoryLeakageRate=0` |
| `T4-AUTOMATION-INTERRUPT` | `dailyAutomationRuntimeMs=1`, `weeklyAutomationRuntimeMs=1`, `dailyPromotedCount=1`, `weeklyCoreCandidateCount=1`, `duplicateAutomationOutputCount=0`, `dryRunWriteCount=0`, `repeatedPromotionCount=0`, `automationInterruptRecoveryTimeMs=1` |

## Efficiency Metrics

Tier 3 now measures per-mode continuity latency, hook latency, token/context
breakdown, index health, and storage size from real fixture runs.

| Area | Metric result |
| --- | --- |
| Continuity latency, full | `continuityGetP50Ms=18`, `continuityGetP95Ms=34`, `continuityGetP99Ms=34` |
| Fast latency, full | `continuityGetP50FastMs=18`, `continuityGetP95FastMs=18`, `continuityGetP99FastMs=18` |
| Balanced latency, full | `continuityGetP50BalancedMs=18`, `continuityGetP95BalancedMs=18`, `continuityGetP99BalancedMs=18` |
| Review latency, full | `continuityGetP50ReviewMs=34`, `continuityGetP95ReviewMs=34`, `continuityGetP99ReviewMs=34` |
| Read-path components | `profileReadLatencyMs=1`, `fastSummaryReadLatencyMs=0`, `sessionHintsReadLatencyMs=0`, `similarQueryLatencyMs=0`, `pendingQueryLatencyMs=0`, `diagnosticsAssemblyLatencyMs=1` |
| Hook components, full | `sessionStartHookP95Ms=35`, `userPromptSubmitHookP95Ms=17`, `postToolUseHookP95Ms=17`, `hookTimeoutCount=1`, `hookFailOpenCount=1` |
| Token breakdown | `fastTokenOverhead=586`, `balancedTokenOverhead=781`, `reviewTokenOverhead=946`, `projectMemoryTokens=77`, `pendingTokens=64`, `diagnosticsTokens=230` |
| Context shape | `contextItemCount=1`, `memoryItemCount=1`, `profileSectionCount=1`, `sessionHintsCount=0`, `diagnosticsItemCount=7` |
| Size growth | `profileSizeGrowthBytes=40`, `fastSummarySizeGrowthBytes=26`, `sessionHintsSizeBytes=2` |
| Index/storage | `sqliteHitRate=1`, `sqliteHitRateFreshIndex=1`, `jsonlFallbackRateHotPath=0`, `indexStaleRate=0`, `indexRebuildTimeMs=24`, `dbRebuildTimeMs=24`, `memoryDbSizeBytes=77824`, `jsonlSizeBytes=1393` |

## Scale Metrics

Scale profile passed all Tier 3 scale cases. Deterministic scale runtime targets
remain synthetic first-version values, while DB and JSONL size now come from the
materialized fixture.

| Scale area | Metric result |
| --- | --- |
| S | `scaleSRuntimeMs=1200`, `activeMemoryGrowthPerRun=240`, `pendingGrowthPerRun=240`, `jsonlSizeBytes=1393` |
| M | `scaleMRuntimeMs=7500` |
| L | `scaleLRuntimeMs=45000` |
| XL | `scaleXLRuntimeMs=180000`, `benchmarkRuntimeMs=180000` |
| Storage | `memoryDbSizeBytes=77824`, `memoryDbBytesPerMemory=2654`, `jsonlSizeBytes=1393` |
| Scale latency | `continuityGetP50Ms=24`, `continuityGetP95Ms=45`, `continuityGetP99Ms=45` |
| Scale hook | `sessionStartHookP95Ms=41`, `userPromptSubmitHookP95Ms=22`, `postToolUseHookP95Ms=25` |

## Task Utility Metrics

Full profile task-utility cases passed with `taskSuccessRate=1`,
`toolCallCount=6`, `repeatedMistakeReduction=0.75`,
`noMemoryTaskSuccessRate=0`, `withMemoryTaskSuccessRate=1`,
`userCorrectionReduction=0.6`, and `toolCallReduction=0.4`.

LLM profile deterministic adapter cases passed with `taskSuccessRate=1`,
`toolCallCount=4`, and `repeatedMistakeReduction=1`. One LLM adapter case was
reported as `notSupportedWithoutProvider=1` because provider env was absent.

## Commands

```bash
npx tsx src/main.ts codex benchmark run --profile smoke --output-dir /tmp/cyrene-benchmark-20260606-metrics-smoke
npx tsx src/main.ts codex benchmark run --profile gate --output-dir /tmp/cyrene-benchmark-20260606-metrics-gate
npx tsx src/main.ts codex benchmark run --profile full --output-dir /tmp/cyrene-benchmark-20260606-metrics-full
npx tsx src/main.ts codex benchmark run --profile scale --output-dir /tmp/cyrene-benchmark-20260606-metrics-scale
npx tsx src/main.ts codex benchmark run --profile llm --output-dir /tmp/cyrene-benchmark-20260606-metrics-llm
npx tsx src/main.ts codex benchmark run --profile external --output-dir /tmp/cyrene-benchmark-20260606-metrics-external

# clean worktree baseline
npx tsx src/main.ts codex benchmark run --profile smoke --output-dir /tmp/cyrene-benchmark-clean-20260606-smoke
npx tsx src/main.ts codex benchmark run --profile gate --output-dir /tmp/cyrene-benchmark-clean-20260606-gate
npx tsx src/main.ts codex benchmark run --profile full --output-dir /tmp/cyrene-benchmark-clean-20260606-full
npx tsx src/main.ts codex benchmark run --profile scale --output-dir /tmp/cyrene-benchmark-clean-20260606-scale

# adversarial fixture verification
npx tsx src/main.ts codex benchmark run --profile gate --output-dir /tmp/cyrene-benchmark-20260606-adversarial-gate
npx tsx src/main.ts codex benchmark run --profile full --output-dir /tmp/cyrene-benchmark-20260606-adversarial-full
```

Each output directory contains `benchmark_report.json` and
`benchmark_report.md`, including the generated `Case Metric Details` section.
