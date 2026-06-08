# Cyrene Benchmark Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展 Cyrene benchmark，增加真实项目 replay 覆盖、更强 adversarial fixture、repo 内 report artifacts 归档，并把 scale runtime 从 synthetic 逐步迁移到真实 materialized runtime。

**Architecture:** 保持现有 `benchmark/catalog.ts` + tier runner + scorer/report 的结构。新增 case 走 deterministic replay，不引入 external provider；scale runtime 先对 S/M 使用真实测量，L/XL 继续保留 synthetic 并在 evidence 中显式标记。

**Tech Stack:** TypeScript, Vitest, existing Cyrene benchmark runner, SQLite/FTS memory index, Markdown report artifacts.

---

### Task 1: 扩展 `real-replay` cases

**Files:**
- Modify: `benchmark/catalog.ts`
- Modify: `benchmark/cases/tier2-memory-to-action.ts`
- Modify: `tests/benchmark-cases-real-replay.test.ts`
- Modify: `tests/benchmark-types.test.ts`

- [ ] **Step 1: Write failing tests**

在 `tests/benchmark-cases-real-replay.test.ts` 中把 `real-replay` 断言从 1 个 case 扩展为 4 个 case：

```ts
const expectedRealReplayCases = [
  'T2-REAL-PROJECT-REPLAY',
  'T2-REAL-UPDATED-WORKFLOW-REPLAY',
  'T2-REAL-MULTI-FILE-FIX-REPLAY',
  'T2-REAL-DOCS-ONLY-REPLAY'
] as const
```

断言：
- `report.summary.passed === expectedRealReplayCases.length`
- `report.summary.skippedWithReason === report.summary.totalCases - expectedRealReplayCases.length`
- 每个 case 不包含 `catalog contract executed`
- 每个 case 至少有 `taskSuccessRate=1`
- 每个 case 的 `fixtureRuns` 都是 `cleanupStatus='cleaned'`

在 `tests/benchmark-types.test.ts` 中加入 3 个新增 case id。

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/benchmark-cases-real-replay.test.ts tests/benchmark-types.test.ts
```

Expected: FAIL，缺少新增 case id 或 profile summary 仍为 1 个 passed case。

- [ ] **Step 3: Implement minimal cases**

在 `benchmark/catalog.ts` 添加：
- `T2-REAL-UPDATED-WORKFLOW-REPLAY`
- `T2-REAL-MULTI-FILE-FIX-REPLAY`
- `T2-REAL-DOCS-ONLY-REPLAY`

三者都使用 `profiles: ['real-replay']`、`adapter: { kind: 'deterministic' }`，并声明 task utility metrics。

在 `benchmark/cases/tier2-memory-to-action.ts` 的 `Tier2CaseId` 与 `replayCaseFor()` 中加入三套 deterministic fixture：
- updated workflow：旧命令被新规则覆盖。
- multi-file fix：source/test/docs 三文件路径，禁止重复旧失败方案。
- docs-only：只允许 `git diff --check`，禁止无意义 typecheck/full test。

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/benchmark-cases-real-replay.test.ts tests/benchmark-types.test.ts
```

Expected: PASS。

---

### Task 2: 增加更毒的 adversarial fixtures

**Files:**
- Modify: `benchmark/catalog.ts`
- Modify: `benchmark/cases/tier0-release-gate.ts`
- Modify: `benchmark/cases/tier1-memory-ability.ts`
- Modify: `benchmark/cases/tier1-5-lifecycle.ts`
- Modify: `tests/benchmark-cases-tier0.test.ts`
- Modify: `tests/benchmark-cases-ability-action.test.ts`
- Modify: `tests/benchmark-cases-lifecycle.test.ts`
- Modify: `tests/benchmark-types.test.ts`

- [ ] **Step 1: Write failing tests**

新增 case ids：
- `T0-CROSS-PROJECT-PROMPT-INJECTION`
- `T1-ADVERSARIAL-MULTI-DISTRACTOR`
- `T15-ADVERSARIAL-SUPERSEDE-STRONG-OLD`

测试要求：
- foreign prompt-injection memory 只能作为 non-current-project hint，不得进入 current project memory。
- stale pending、personal、global distractor 不得成为 answer evidence。
- 强势旧规则不能覆盖 explicit supersede/hash 的新规则。

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/benchmark-cases-tier0.test.ts tests/benchmark-cases-ability-action.test.ts tests/benchmark-cases-lifecycle.test.ts tests/benchmark-types.test.ts
```

Expected: FAIL，缺少新增 adversarial case。

- [ ] **Step 3: Implement fixtures**

按现有 tier helper 写 deterministic fixture，不引入 LLM/provider。Evidence summary 必须包含明确数值：
- `promptInjectionInjected=0`
- `foreignDistractorAnswer=0`
- `strongOldRuleInjected=0`
- `explicitSupersedeHonored=1`

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/benchmark-cases-tier0.test.ts tests/benchmark-cases-ability-action.test.ts tests/benchmark-cases-lifecycle.test.ts tests/benchmark-types.test.ts
```

Expected: PASS。

---

### Task 3: 归档 report artifacts 到 repo

**Files:**
- Create: `benchmark/artifacts.ts`
- Modify: `benchmark/report.ts`
- Modify: `benchmark/runner.ts`
- Modify: `tests/benchmark-runner.test.ts`
- Modify: `tests/benchmark-report.test.ts`
- Create/Modify: `benchmark/reports/2026-06-06/...`
- Modify: `benchmark/reports/2026-06-06/summary.md`

- [ ] **Step 1: Write failing tests**

测试 `runCyreneBenchmark()` 仍写 `outputDir`，同时当传入 repo artifact target 时，生成：

```text
benchmark/reports/2026-06-06/<profile>/benchmark_report.json
benchmark/reports/2026-06-06/<profile>/benchmark_report.md
```

归档内容不得包含 preserved temp fixture content 或 secrets。

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/benchmark-runner.test.ts tests/benchmark-report.test.ts
```

Expected: FAIL，archive API 或 artifact files 尚不存在。

- [ ] **Step 3: Implement archive helper**

新增 `benchmark/artifacts.ts`：
- `archiveBenchmarkReports(input)` 复制 `benchmark_report.json` 和 `benchmark_report.md` 到 repo artifact directory。
- profile 子目录固定为 profile 名称。
- 只归档 report，不归档 temp fixture root。

在 runner 或 CLI 中保持默认不自动归档；测试可直接调用 helper。实际本轮执行后手动归档关键 reports。

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/benchmark-runner.test.ts tests/benchmark-report.test.ts
```

Expected: PASS。

---

### Task 4: Scale S/M runtime 切换为真实 materialized runtime

**Files:**
- Modify: `benchmark/cases/tier3-scale-efficiency.ts`
- Modify: `tests/benchmark-cases-scale.test.ts`
- Modify: `benchmark/reports/2026-06-06/summary.md`

- [ ] **Step 1: Write failing tests**

在 `tests/benchmark-cases-scale.test.ts` 断言：
- `T3-S-SCALE` 和 `T3-M-SCALE` evidence 包含 `runtimeSource=materialized`
- `scaleSRuntimeMs` 和 `scaleMRuntimeMs` 来自 measured runtime，且大于 0。
- `T3-L-SCALE` 和 `T3-XL-SCALE` evidence 包含 `runtimeSource=synthetic`

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/benchmark-cases-scale.test.ts
```

Expected: FAIL，当前 evidence 没有 runtime source，S/M runtime 仍固定 synthetic。

- [ ] **Step 3: Implement measured runtime**

在 `runScaleCase()` 中记录：

```ts
const startedAt = Date.now()
// fixture write + index rebuild + size reads
const materializedRuntimeMs = Math.max(1, Date.now() - startedAt)
```

`scaleMetrics()` 对 S/M 使用 `materializedRuntimeMs`，对 L/XL 保留 `target.runtimeMs`。Evidence 标记 `runtimeSource=materialized` 或 `runtimeSource=synthetic`。

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/benchmark-cases-scale.test.ts
```

Expected: PASS。

---

### Final Verification

- [ ] Run `npm test -- tests/benchmark-*.test.ts`
- [ ] Run `npm run typecheck`
- [ ] Run `git diff --check`
- [ ] Run benchmark profiles:

```bash
npx tsx src/main.ts codex benchmark run --profile gate --output-dir /tmp/cyrene-benchmark-20260606-expanded-gate
npx tsx src/main.ts codex benchmark run --profile full --output-dir /tmp/cyrene-benchmark-20260606-expanded-full
npx tsx src/main.ts codex benchmark run --profile scale --output-dir /tmp/cyrene-benchmark-20260606-expanded-scale
npx tsx src/main.ts codex benchmark run --profile real-replay --output-dir /tmp/cyrene-benchmark-20260606-expanded-real-replay
```

- [ ] Archive key report artifacts under `benchmark/reports/2026-06-06/`
- [ ] Run full `npm test`
