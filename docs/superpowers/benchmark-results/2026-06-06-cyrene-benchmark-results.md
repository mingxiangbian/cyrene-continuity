# Cyrene Benchmark Results - 2026-06-06

This record captures the benchmark suite run from the current local checkout on
2026-06-06 Asia/Shanghai.

## Metadata

- Benchmark version: `1.0.0`
- Threshold version: `2026-06-05`
- Case catalog hash: `5ed2880982e940c4c8c2c6a83fd0f571a425f4b990ea39f317cfd69f8020f9cf`
- Spec: `docs/superpowers/specs/2026-06-05-cyrene-benchmark-eval-system-design.md`
- Implementation plan:
  `docs/superpowers/plans/2026-06-05-cyrene-benchmark-eval-system-implementation-plan.md`
- Spec hash: `25332433ee74d0a5170ae1523cb3a2ff96da00ca08533e915604c0e969b20058`
- Git commit recorded by reports: `27e96343ecfcc9a82044359f5b04e7bb640335df`
- Git dirty state recorded by reports: yes. Dirty files were pre-existing local changes:
  `plugin/runtime/cyrene-continuity.mjs`, `src/codex/context-policy.ts`,
  `src/codex/memory-context-preview.ts`, and
  `tests/codex-context-policy.test.ts`.

## Profile Results

| Profile | Run ID | Passed | Passed cases | Failed | Skipped | Unsupported | Hard failures | Threshold breaches | Report dir |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| smoke | `359ff81327673165` | true | 4 | 0 | 53 | 0 | 0 | 0 | `/tmp/cyrene-benchmark-20260606-smoke` |
| gate | `51161b4b71620a2c` | true | 22 | 0 | 35 | 0 | 0 | 0 | `/tmp/cyrene-benchmark-20260606-gate` |
| full | `72097cb114930dfd` | true | 53 | 0 | 4 | 0 | 0 | 0 | `/tmp/cyrene-benchmark-20260606-full` |
| scale | `fa365c05527ac533` | true | 8 | 0 | 49 | 0 | 0 | 0 | `/tmp/cyrene-benchmark-20260606-scale` |
| llm | `be239788c9103d9f` | true | 5 | 0 | 51 | 1 | 0 | 0 | `/tmp/cyrene-benchmark-20260606-llm` |
| external | `31508f7e6a63d183` | false | 0 | 0 | 56 | 1 | 0 | 0 | `/tmp/cyrene-benchmark-20260606-external` |

`external` is false because no external provider environment was configured.
The profile produced `notSupportedWithoutProvider=1`, `failed=0`, and
`hardFailures=0`; this is the expected adapter behavior until an external
provider such as `CYRENE_BENCHMARK_MEM0_PROVIDER` is configured.

## Commands

```bash
npm run dev -- codex benchmark run --profile smoke --output-dir /tmp/cyrene-benchmark-20260606-smoke
npm run dev -- codex benchmark run --profile gate --output-dir /tmp/cyrene-benchmark-20260606-gate
npm run dev -- codex benchmark run --profile full --output-dir /tmp/cyrene-benchmark-20260606-full
npm run dev -- codex benchmark run --profile scale --output-dir /tmp/cyrene-benchmark-20260606-scale
npm run dev -- codex benchmark run --profile llm --output-dir /tmp/cyrene-benchmark-20260606-llm
npm run dev -- codex benchmark run --profile external --output-dir /tmp/cyrene-benchmark-20260606-external
```

Each output directory contains `benchmark_report.json` and
`benchmark_report.md`.
