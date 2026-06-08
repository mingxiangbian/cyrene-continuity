# Cyrene Benchmark Results - 2026-06-06

This record captures the benchmark suite runs from 2026-06-06 Asia/Shanghai. It
includes the follow-up metric pass, a clean-git baseline rerun, and the
adversarial fixture verification added for retrieval, conflict handling, and
cross-project boundaries. It also records the post-commit clean gate/full rerun
and the real-project replay benchmark profile. The final expansion pass records
repo-archived report artifacts plus materialized S/M scale runtime evidence.

## Metadata

- Benchmark version: `1.0.0`
- Threshold version: `2026-06-06` for the real-project replay rerun;
  earlier metric/adversarial reports used `2026-06-05`
- Metric pass case catalog hash: `e1e12842c080bb3eb3ac6354ac6abb058787f49cbffaee86cd557be19b436988`
- Clean HEAD case catalog hash: `5ed2880982e940c4c8c2c6a83fd0f571a425f4b990ea39f317cfd69f8020f9cf`
- Current adversarial case catalog hash: `88d2e90484e01f2af7b9bcddaa0c4a58d5c013ce5f257241f86f8f0ea2a65725`
- Real replay case catalog hash: `d8664ca503a04aaa54bba2080ccceef99752d6af4d4d909334f0cc3391d61c09`
- Expanded artifact case catalog hash: `59658b414730ab004d3f8a50fba841a40b1e08f7ca08c4740f64269ced81c219`
- Spec: `benchmark/fixtures/benchmark-eval-system-design.md`
- Implementation plan:
  `creator-only historical implementation plan (not published)`
- Spec hash: `25332433ee74d0a5170ae1523cb3a2ff96da00ca08533e915604c0e969b20058`
- Git commit recorded by reports: `21b93b1b1fbbb4e1af53a667f9610f205b57c3c7`
- Runtime recorded by reports: Node `v25.9.0`, npm `11.12.1`, `darwin/arm64`
- Git dirty state recorded by reports: yes. Dirty files included this benchmark
  metric update plus pre-existing local changes in
  `plugin/runtime/cyrene-continuity.mjs`, `src/codex/context-policy.ts`,
  `src/codex/memory-context-preview.ts`, and
  `tests/codex-context-policy.test.ts`.

The adversarial fixture commit is
`827bcb856cbe60706621b9c8135111eb1f627a91`
(`test: add benchmark metrics and adversarial fixtures`).

The expanded artifact reports also recorded commit
`827bcb856cbe60706621b9c8135111eb1f627a91` with `git.dirty=true` because the
real-replay expansion, scale runtime update, repo artifact helper, CLI archive
flag, and unrelated pre-existing local changes were present in the working tree.

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

## Post-Commit Clean Adversarial Rerun

After committing the adversarial fixtures, gate and full were rerun from the
temporary clean worktree `.worktrees/clean-adversarial-827bcb8` at commit
`827bcb856cbe60706621b9c8135111eb1f627a91`. Both reports recorded
`git.dirty=false`, `trackedChanges=[]`, `hardFailures=0`, and
`thresholdBreaches=0`. The temporary worktree was removed after the run.

| Profile | Run ID | Passed | Total cases | Passed cases | Failed | Skipped | Unsupported | Report dir |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| gate | `bc6f94f5f76e92c6` | true | 60 | 23 | 0 | 37 | 0 | `/tmp/cyrene-benchmark-clean-adversarial-20260606-gate` |
| full | `56738768f7c74de8` | true | 60 | 56 | 0 | 4 | 0 | `/tmp/cyrene-benchmark-clean-adversarial-20260606-full` |

## Real Project Replay Profile

`real-replay` is an isolated deterministic profile for repo-grounded coding
task utility. The first case, `T2-REAL-PROJECT-REPLAY`, creates a temporary
cyrene-continuity-like fixture with `AGENTS.md`, `package.json`,
`src/codex/context-policy.ts`, `tests/codex-context-policy.test.ts`, and the
generated `plugin/runtime/cyrene-continuity.mjs` file. The replay requires the
agent to inspect source and project instructions, run the targeted test command,
run typecheck, and leave generated runtime unchanged.

| Profile | Run ID | Passed | Total cases | Passed cases | Failed | Skipped | Unsupported | Report dir |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| real-replay | `1588d75736dabd54` | true | 61 | 1 | 0 | 60 | 0 | `/tmp/cyrene-benchmark-real-replay-20260606` |

| Case | Evidence | Metric result |
| --- | --- | --- |
| `T2-REAL-PROJECT-REPLAY` | `real project replay ok`, `fixture files verified`, `noMemory tools=13`, `withMemory tools=8` | `taskSuccessRate=1`, `noMemoryTaskSuccessRate=0`, `withMemoryTaskSuccessRate=1`, `repeatedMistakeReduction=0.75`, `userCorrectionReduction=0.75`, `toolCallReduction=0.38461538461538464` |

## Expanded Artifact Archive Rerun

The expanded rerun archives only `benchmark_report.json` and
`benchmark_report.md` into the repository under
`benchmark/reports/2026-06-06/<profile>/`. Temporary fixture
roots are not copied into the archive.

| Profile | Run ID | Passed | Total cases | Passed cases | Failed | Skipped | Unsupported | Archived report |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| gate | `e99c2ecaa916b3a5` | true | 67 | 24 | 0 | 43 | 0 | `benchmark/reports/2026-06-06/gate/benchmark_report.json` |
| full | `b69cc461c862d088` | true | 67 | 59 | 0 | 8 | 0 | `benchmark/reports/2026-06-06/full/benchmark_report.json` |
| scale | `5fffd288214e9caa` | true | 67 | 8 | 0 | 59 | 0 | `benchmark/reports/2026-06-06/scale/benchmark_report.json` |
| real-replay | `06cf0c1deb5a7bdc` | true | 67 | 4 | 0 | 63 | 0 | `benchmark/reports/2026-06-06/real-replay/benchmark_report.json` |

The archived reports were rerun after the metric semantics audit. The scale
reports now separate target counts from capped materialized fixture counts, use
`runtimeSourceIsMaterialized=0` for synthetic L/XL runtime, report
`jsonlRecordCount` and SQLite indexed counts separately, and keep
`indexStaleRate=0` unless stale evidence is observed. Hook timeout metrics are
split into `simulatedHook*` and `runtimeHook*`; current runtime hook timeout and
fail-open counts are both `0`. Token overhead now includes per-mode pending and
diagnostic token fields, with `contextShape=compact` in the evidence. Aggregate
metrics include `metricAggregation` provenance so repeated metric names are not
silently overwritten.

The expanded full/gate reports include the more toxic adversarial fixtures:

| Case | Evidence | Metric result |
| --- | --- | --- |
| `T0-CROSS-PROJECT-PROMPT-INJECTION` | `promptInjectionInjected=0`, `hintVisible=1`, `migration=0`, `profilePollution=0` | `crossProjectPollutionRate=0`, `similarHintMigrationRate=0`, `profilePollutionRate=0` |
| `T1-ADVERSARIAL-MULTI-DISTRACTOR` | `target retrieved=1`, `stalePendingAnswer=0`, `personalDistractorAnswer=0`, `globalDistractorAnswer=0`, `foreignDistractorAnswer=0` | `retrievalAccuracy=1`, `answerAccuracy=1`, `similarMemoryInterferenceRate=0` |
| `T15-ADVERSARIAL-SUPERSEDE-STRONG-OLD` | `strongOldRuleInjected=0`, `explicitSupersedeHonored=1`, `single resolved injection=1` | `conflictResolutionAccuracy=1`, `staleMemoryLeakageRate=0`, `duplicateActiveMemoryRate=0` |

The expanded real-replay profile now runs four repo-grounded cases:

| Case | Evidence | Metric result |
| --- | --- | --- |
| `T2-REAL-PROJECT-REPLAY` | `fixture files verified`, `noMemory tools=13`, `withMemory tools=8` | `taskSuccessRate=1`, `withMemoryTaskSuccessRate=1`, `repeatedMistakeReduction=0.75`, `userCorrectionReduction=0.75`, `toolCallReduction=0.38461538461538464` |
| `T2-REAL-UPDATED-WORKFLOW-REPLAY` | `updated workflow command applied`, `noMemory tools=12`, `withMemory tools=7` | `taskSuccessRate=1`, `withMemoryTaskSuccessRate=1`, `repeatedMistakeReduction=0.75`, `userCorrectionReduction=0.75`, `toolCallReduction=0.4166666666666667` |
| `T2-REAL-MULTI-FILE-FIX-REPLAY` | `source test and docs updated together`, `noMemory tools=14`, `withMemory tools=8` | `taskSuccessRate=1`, `withMemoryTaskSuccessRate=1`, `repeatedMistakeReduction=0.8`, `userCorrectionReduction=0.8`, `toolCallReduction=0.42857142857142855` |
| `T2-REAL-DOCS-ONLY-REPLAY` | `docs-only verification applied`, `noMemory tools=9`, `withMemory tools=4` | `taskSuccessRate=1`, `withMemoryTaskSuccessRate=1`, `repeatedMistakeReduction=1`, `userCorrectionReduction=1`, `toolCallReduction=0.5555555555555556` |

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
| Continuity latency, full | `continuityGetSampleCount=9`, `continuityGetP50Ms=20`, `continuityGetP95Ms=38`, `continuityGetP99Ms=38`, `continuityGetMinMs=17`, `continuityGetMeanMs=24`, `continuityGetMaxMs=38` |
| Fast latency, full | `continuityGetP50FastMs=18`, `continuityGetP95FastMs=20`, `continuityGetP99FastMs=20` |
| Balanced latency, full | `continuityGetP50BalancedMs=19`, `continuityGetP95BalancedMs=20`, `continuityGetP99BalancedMs=20` |
| Review latency, full | `continuityGetP50ReviewMs=35`, `continuityGetP95ReviewMs=38`, `continuityGetP99ReviewMs=38` |
| Read-path components | `profileReadLatencyMs=2`, `fastSummaryReadLatencyMs=1`, `sessionHintsReadLatencyMs=0`, `similarQueryLatencyMs=0`, `pendingQueryLatencyMs=0`, `diagnosticsAssemblyLatencyMs=1` |
| Hook components, full | `hookSampleCount=3`, `sessionStartHookP95Ms=39`, `userPromptSubmitHookP95Ms=21`, `postToolUseHookP95Ms=19`, `runtimeHookTimeoutCount=0`, `runtimeHookFailOpenCount=0` |
| Hook timeout simulation, full | `simulatedHookTimeoutCount=1`, `simulatedHookFailOpenCount=1`, `runtimeHookTimeoutCount=0`, `runtimeHookFailOpenCount=0` |
| Token breakdown | `fastTokenOverhead=586`, `balancedTokenOverhead=595`, `reviewTokenOverhead=946`, `fastPendingTokens=0`, `fastDiagnosticsTokens=0`, `balancedPendingTokens=0`, `balancedDiagnosticsTokens=0`, `reviewPendingTokens=64`, `reviewDiagnosticsTokens=230`, `balancedDiagnosticsVisible=0` |
| Context shape | `contextItemCount=1`, `memoryItemCount=1`, `profileSectionCount=1`, `sessionHintsCount=0`, `diagnosticsItemCount=7` |
| Size growth | `profileSizeGrowthBytes=40`, `fastSummarySizeGrowthBytes=26`, `sessionHintsSizeBytes=2` |
| Index/storage | `sqliteHitRate=1`, `sqliteHitRateFreshIndex=1`, `jsonlFallbackRateHotPath=0`, `indexStaleRate=0`, `indexRebuildTimeMs=24`, `dbRebuildTimeMs=24`, `memoryDbSizeBytes=77824`, `jsonlSizeBytes=1393` |

## Scale Metrics

Scale profile passed all Tier 3 scale cases. S and M runtime metrics now use
measured materialized fixture runtime. L and XL remain synthetic first-version
targets and explicitly mark `runtimeSource=synthetic` in evidence.

| Scale area | Metric result |
| --- | --- |
| S | `runtimeSourceIsMaterialized=1`, `scaleSRuntimeMs=76`, `targetProjectCount=1`, `targetActiveMemoryCount=50`, `targetPendingMemoryCount=10`, `materializedActiveMemoryCount=50`, `materializedPendingMemoryCount=10`, `jsonlRecordCount=60` |
| M | `runtimeSourceIsMaterialized=1`, `scaleMRuntimeMs=223`, `targetProjectCount=5`, `targetActiveMemoryCount=500`, `targetPendingMemoryCount=100`, `materializedActiveMemoryCount=240`, `materializedPendingMemoryCount=100`, `jsonlRecordCount=340` |
| L | `runtimeSourceIsMaterialized=0`, `scaleLRuntimeMs=45000`, `targetProjectCount=20`, `targetActiveMemoryCount=5000`, `targetPendingMemoryCount=1000`, `materializedActiveMemoryCount=240`, `materializedPendingMemoryCount=240`, `indexStaleRate=0` |
| XL | `runtimeSourceIsMaterialized=0`, `scaleXLRuntimeMs=180000`, `benchmarkRuntimeMs=180000`, `targetProjectCount=100`, `targetActiveMemoryCount=50000`, `targetPendingMemoryCount=5000`, `materializedActiveMemoryCount=240`, `materializedPendingMemoryCount=240` |
| Storage | `memoryDbBytesPerMemory` ranges from `2646` to `4096` across scale size cases |
| Scale latency | `continuityGetP50Ms=18`, `continuityGetP95Ms=36`, `continuityGetP99Ms=56` |
| Scale hook | `sessionStartHookP95Ms=40`, `userPromptSubmitHookP95Ms=21`, `postToolUseHookP95Ms=22` |

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

# post-commit clean adversarial rerun
npx tsx src/main.ts codex benchmark run --profile gate --output-dir /tmp/cyrene-benchmark-clean-adversarial-20260606-gate
npx tsx src/main.ts codex benchmark run --profile full --output-dir /tmp/cyrene-benchmark-clean-adversarial-20260606-full

# real project replay
npx tsx src/main.ts codex benchmark run --profile real-replay --output-dir /tmp/cyrene-benchmark-real-replay-20260606

# expanded artifact archive rerun
# final archived reports used runCyreneBenchmark with fixed seed/clock;
# this is the equivalent CLI shape after adding the archive flag.
npx tsx src/main.ts codex benchmark run --profile gate --output-dir /tmp/cyrene-benchmark-20260606-expanded-gate --artifact-archive-dir benchmark/reports/2026-06-06
npx tsx src/main.ts codex benchmark run --profile full --output-dir /tmp/cyrene-benchmark-20260606-expanded-full --artifact-archive-dir benchmark/reports/2026-06-06
npx tsx src/main.ts codex benchmark run --profile scale --output-dir /tmp/cyrene-benchmark-20260606-expanded-scale --artifact-archive-dir benchmark/reports/2026-06-06
npx tsx src/main.ts codex benchmark run --profile real-replay --output-dir /tmp/cyrene-benchmark-20260606-expanded-real-replay --artifact-archive-dir benchmark/reports/2026-06-06
```

Each output directory contains `benchmark_report.json` and
`benchmark_report.md`, including the generated `Case Metric Details` section.
Expanded reports are also archived under
`benchmark/reports/2026-06-06/`.
