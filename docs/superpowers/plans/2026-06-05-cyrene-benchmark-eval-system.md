# Cyrene Benchmark Eval System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Cyrene benchmark/eval system from `docs/superpowers/specs/2026-06-05-cyrene-benchmark-eval-system-design.md`, including catalog visibility, smoke/gate/full/scale/llm/external profiles, isolated deterministic fixtures, scoring, reports, adapters, and CLI integration.

**Architecture:** Add a focused `benchmark/` subsystem with typed case/catalog definitions, fixture isolation helpers, scorer/report utilities, profile runner, and case packs. The subsystem reuses existing Cyrene helpers for context, memory review, memory propose, lifecycle, SQLite index, runtime metrics, CLI/MCP surface checks, and emits `benchmark_report.json` plus `benchmark_report.md`. Multi-agent execution is required: shared contract lands first, then disjoint workers implement case packs, then Coordinator integrates and verifies.

**Tech Stack:** TypeScript ES2022, Node.js 22+, Vitest, existing Cyrene memory JSONL/SQLite helpers, existing Codex CLI/MCP tools, `tsx` runtime.

---

## Execution Model

This is one full implementation plan, not a phased subset. Every case from the spec must exist in the benchmark catalog. Profiles decide which cases run, not whether a case exists.

Use subagents after Task 1 creates the shared contract:

- Contract Worker: Task 1, Task 3 shared scorer/report contract, shared runner types.
- Fixture Worker: Task 2 only.
- Smoke/Gate Worker: Task 4 and Task 5.
- Lifecycle Worker: Task 6.
- Ability/Action Worker: Task 7.
- Scale Worker: Task 8.
- Failure/Surface/Adapter Worker: Task 9.
- Coordinator: Task 10 and final verification.

Workers are not alone in the codebase. They must not revert edits by others and must adjust to already-merged changes. Write scopes are disjoint unless the Coordinator explicitly integrates shared files.

## File Map

Create:

- `benchmark/types.ts`: profile, case, fixture, scorer, report, adapter, deterministic clock/seed, threshold types.
- `benchmark/catalog.ts`: complete case catalog with every ID from the spec.
- `benchmark/thresholds.ts`: centralized soft metric thresholds and hard gate rule ids.
- `benchmark/fixtures.ts`: isolated temp HOME/project/global/project memory/index/profile/session fixture builder.
- `benchmark/cases/common.ts`: shared result helpers and case assertion utilities.
- `benchmark/cases/tier0-release-gate.ts`: Tier 0 executable cases.
- `benchmark/cases/tier1-memory-ability.ts`: Tier 1 deterministic/replay cases.
- `benchmark/cases/tier1-5-lifecycle.ts`: lifecycle/replacement cases.
- `benchmark/cases/tier1-6-core-mechanisms.ts`: extraction/routing/review cases.
- `benchmark/cases/tier2-memory-to-action.ts`: deterministic action replay cases and llm adapter case declarations.
- `benchmark/cases/tier3-scale-efficiency.ts`: ranking and scale cases.
- `benchmark/cases/tier4-failure-security.ts`: failure, hook, security, adapter cases.
- `benchmark/scorer.ts`: metrics aggregation, threshold breach detection, hard gate evaluation.
- `benchmark/report.ts`: JSON/Markdown report generation with spec/version/git/runtime metadata.
- `benchmark/runner.ts`: profile runner, catalog completeness checks, output writing.
- `src/codex/codex-benchmark.ts`: Codex-facing wrapper for `benchmark/runner.ts`.
- `tests/benchmark-types.test.ts`
- `tests/benchmark-fixtures.test.ts`
- `tests/benchmark-report.test.ts`
- `tests/benchmark-runner.test.ts`
- `tests/benchmark-cases-tier0.test.ts`
- `tests/benchmark-cases-core.test.ts`
- `tests/benchmark-cases-scale.test.ts`
- `tests/benchmark-cli.test.ts`

Modify:

- `src/codex/codex-cli.ts`: add `codex benchmark run --profile smoke|gate|full|scale|llm|external [--output-dir <path>] [--baseline <path>] [--preserve-fixtures]`.
- `package.json`: no new dependencies expected; only update if TypeScript needs a script alias.

Do not modify:

- `plugin/runtime/cyrene-continuity.mjs` directly. Only include it in commits when `npm run build:plugin` generated it from source or skill changes.
- Existing runtime behavior files unless a benchmark exposes a real bug and Coordinator approves a scoped fix.

## Task 1: Benchmark Contract And Catalog

**Files:**
- Create: `benchmark/types.ts`
- Create: `benchmark/catalog.ts`
- Create: `benchmark/thresholds.ts`
- Create: `tests/benchmark-types.test.ts`

- [ ] **Step 1: Write the failing contract/catalog test**

Create `tests/benchmark-types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BENCHMARK_CASES, BENCHMARK_CASE_IDS } from '../benchmark/catalog.js'
import { EXECUTION_PROFILES } from '../benchmark/types.js'
import { HARD_GATE_RULE_IDS, SOFT_METRIC_THRESHOLDS } from '../benchmark/thresholds.js'

const requiredCaseIds = [
  'T0-MODE-FAST',
  'T0-MODE-BALANCED',
  'T0-MODE-REVIEW',
  'T0-PENDING-BOUNDARY',
  'T0-SIMILAR-BOUNDARY',
  'T0-SESSION-HINTS',
  'T0-ACTIVATION-RETRIEVED',
  'T0-SQLITE-HOT-PATH',
  'T0-SURFACE-CONSISTENCY',
  'T1-FACT-EXTRACTION',
  'T1-MULTI-SESSION-REASONING',
  'T1-TEMPORAL-ORDER',
  'T1-KNOWLEDGE-UPDATE',
  'T1-CONFLICT-HANDLING',
  'T1-ABSTAIN-NO-EVIDENCE',
  'T1-EVENT-SUMMARY',
  'T15-UPGRADE',
  'T15-REPLACE',
  'T15-MERGE',
  'T15-EXPIRE',
  'T15-SUPERSEDE-HASH',
  'T15-CONFLICT-SINGLE-INJECTION',
  'T16-PROPOSE-IMPORTANT',
  'T16-PROPOSE-NOISE',
  'T16-PROPOSE-SENSITIVE',
  'T16-PROPOSE-ASSISTANT-INFERENCE',
  'T16-ROUTING-NAMESPACE',
  'T16-REVIEW-HASH-REQUIRED',
  'T16-REVIEW-STALE-HASH',
  'T16-REVIEW-REJECT-DEFER',
  'T16-REVIEW-EDIT-HASH',
  'T2-REMEMBER-TEST-COMMAND',
  'T2-AVOID-REJECTED-APPROACH',
  'T2-FOLLOW-WORKFLOW',
  'T2-UPDATED-RULE',
  'T2-CROSS-SESSION-FIX',
  'T2-REDUCE-REPEAT-MISTAKE',
  'T3-S-SCALE',
  'T3-M-SCALE',
  'T3-L-SCALE',
  'T3-XL-SCALE',
  'T3-RANKING',
  'T3-TOKEN-OVERHEAD',
  'T3-LATENCY',
  'T3-INDEX-HEALTH',
  'T4-SQLITE-UNAVAILABLE',
  'T4-JSONL-CORRUPT',
  'T4-PROFILE-MISSING',
  'T4-FAST-SUMMARY-MISSING-STALE',
  'T4-SESSION-HINTS-EXPIRED',
  'T4-MCP-ERROR',
  'T4-AUTOMATION-INTERRUPT',
  'T4-HOOK-LIGHTWEIGHT',
  'T4-HOOK-TIMEOUT',
  'T4-SECURITY-SECRETS',
  'T4-SECURITY-PROMPT-INJECTION',
  'T4-SECURITY-GLOBAL-WRITE'
] as const

describe('benchmark contract catalog', () => {
  it('declares every case from the spec exactly once', () => {
    expect(BENCHMARK_CASE_IDS.sort()).toEqual([...requiredCaseIds].sort())
    expect(new Set(BENCHMARK_CASE_IDS).size).toBe(BENCHMARK_CASE_IDS.length)
  })

  it('declares complete case contract fields for every case', () => {
    for (const benchmarkCase of BENCHMARK_CASES) {
      expect(benchmarkCase.title).not.toBe('')
      expect(benchmarkCase.executionProfiles.length).toBeGreaterThan(0)
      expect(benchmarkCase.fixture).toMatchObject({
        isolation: expect.any(String),
        seed: expect.any(String),
        now: expect.any(String),
        timezone: 'UTC',
        groundTruth: expect.any(Array),
        expectedContext: expect.any(Array),
        expectedForbiddenContent: expect.any(Array),
        expectedMetrics: expect.any(Array),
        passFailRule: expect.any(Array)
      })
      expect(benchmarkCase.action.kind).toMatch(/direct|cli|mcp|replay|adapter/)
      expect(benchmarkCase.expected.length).toBeGreaterThan(0)
      expect(benchmarkCase.forbidden.length).toBeGreaterThan(0)
      expect(benchmarkCase.metrics.length).toBeGreaterThan(0)
      expect(benchmarkCase.passFail.length).toBeGreaterThan(0)
    }
  })

  it('keeps smoke profile non-empty and deterministic', () => {
    const smokeCases = BENCHMARK_CASES.filter((item) => item.executionProfiles.includes('smoke'))
    expect(smokeCases.map((item) => item.id).sort()).toEqual([
      'T0-MODE-FAST',
      'T0-PENDING-BOUNDARY',
      'T0-SQLITE-HOT-PATH',
      'T16-ROUTING-NAMESPACE'
    ].sort())
    expect(smokeCases.every((item) => item.adapter === undefined || item.adapter.kind === 'deterministic')).toBe(true)
  })

  it('defines all execution profiles and centralized thresholds', () => {
    expect(EXECUTION_PROFILES).toEqual(['smoke', 'gate', 'full', 'scale', 'llm', 'external'])
    expect(SOFT_METRIC_THRESHOLDS.map((item) => item.metric)).toEqual(expect.arrayContaining([
      'fastTokenOverhead',
      'continuityGetP95FastMs',
      'sqliteHitRateFreshIndex',
      'jsonlFallbackRateHotPath',
      'recallAt3',
      'mrr',
      'scaleXLRuntimeMs',
      'withMemoryTaskSuccessRate'
    ]))
    expect(HARD_GATE_RULE_IDS).toEqual(expect.arrayContaining([
      'fixture_isolation_violation',
      'pending_leakage',
      'cross_project_pollution',
      'unauthorized_promotion',
      'secret_persistence',
      'hash_bypass',
      'retrieved_default_write',
      'hot_path_rebuild'
    ]))
  })
})
```

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/benchmark-types.test.ts
```

Expected: FAIL because `benchmark/types.ts`, `benchmark/catalog.ts`, and `benchmark/thresholds.ts` do not exist.

- [ ] **Step 3: Implement `benchmark/types.ts`**

Create `benchmark/types.ts`:

```ts
export const EXECUTION_PROFILES = ['smoke', 'gate', 'full', 'scale', 'llm', 'external'] as const
export type BenchmarkProfile = typeof EXECUTION_PROFILES[number]

export const BENCHMARK_TIERS = ['tier0', 'tier1', 'tier1_5', 'tier1_6', 'tier2', 'tier3', 'tier4'] as const
export type BenchmarkTier = typeof BENCHMARK_TIERS[number]

export type BenchmarkActionKind = 'direct' | 'cli' | 'mcp' | 'replay' | 'adapter'
export type BenchmarkCaseStatus = 'passed' | 'failed' | 'skipped_with_reason' | 'not_supported_without_provider'

export interface BenchmarkFixtureSpec {
  isolation: string
  seed: string
  now: string
  timezone: 'UTC'
  groundTruth: string[]
  expectedContext: string[]
  expectedForbiddenContent: string[]
  expectedMode?: 'fast' | 'balanced' | 'review'
  expectedMetrics: string[]
  passFailRule: string[]
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
  supportsDeterministicReplay: boolean
}

export interface BenchmarkCase {
  id: string
  tier: BenchmarkTier
  title: string
  executionProfiles: BenchmarkProfile[]
  fixture: BenchmarkFixtureSpec
  action: BenchmarkActionSpec
  expected: string[]
  forbidden: string[]
  metrics: string[]
  passFail: string[]
  adapter?: BenchmarkAdapterSpec
}

export interface BenchmarkMetricValue {
  metric: string
  value: number
}

export interface BenchmarkThresholdBreach {
  metric: string
  threshold: number | string
  actual: number | string
  severity: 'warning' | 'error'
}

export interface BenchmarkCaseEvidence {
  summary: string
  details?: Record<string, unknown>
}

export interface BenchmarkCaseResult {
  id: string
  title: string
  tier: BenchmarkTier
  status: BenchmarkCaseStatus
  durationMs: number
  metrics: BenchmarkMetricValue[]
  hardRuleViolations: string[]
  thresholdBreaches: BenchmarkThresholdBreach[]
  evidence: BenchmarkCaseEvidence[]
  skippedReason?: string
}

export interface BenchmarkRunOptions {
  cwd: string
  profile: BenchmarkProfile
  outputDir: string
  baselineReportPath?: string
  preserveFixtures?: boolean
  seed?: string
  now?: string
}

export interface BenchmarkReport {
  runId: string
  startedAt: string
  completedAt: string
  profile: BenchmarkProfile
  spec: {
    path: 'docs/superpowers/specs/2026-06-05-cyrene-benchmark-eval-system-design.md'
    title: 'Cyrene Benchmark Eval System Design'
    date: '2026-06-05'
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
    trackedChanges: string[]
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
  failedCases: BenchmarkCaseResult[]
  caseResults: BenchmarkCaseResult[]
  metrics: {
    capability: Record<string, number>
    boundarySafety: Record<string, number>
    efficiency: Record<string, number>
    taskUtility: Record<string, number>
  }
  thresholdBreaches: BenchmarkThresholdBreach[]
  scaleResults?: Record<string, unknown>
  regressionComparison?: {
    baselineReportPath?: string
    regressions: Array<{ metric: string; baseline: number; current: number; delta: number }>
  }
}
```

- [ ] **Step 4: Implement `benchmark/thresholds.ts`**

Create `benchmark/thresholds.ts`:

```ts
import type { BenchmarkProfile } from './types.js'

export interface SoftMetricThreshold {
  metric: string
  operator: '<=' | '>=' | '='
  value: number
  profiles: BenchmarkProfile[]
}

export const BENCHMARK_VERSION = '1.0.0'
export const THRESHOLD_VERSION = '2026-06-05'

export const SOFT_METRIC_THRESHOLDS: SoftMetricThreshold[] = [
  { metric: 'fastTokenOverhead', operator: '<=', value: 800, profiles: ['smoke', 'gate', 'full'] },
  { metric: 'balancedTokenOverhead', operator: '<=', value: 1200, profiles: ['gate', 'full'] },
  { metric: 'reviewTokenOverhead', operator: '<=', value: 4000, profiles: ['full'] },
  { metric: 'continuityGetP95FastMs', operator: '<=', value: 300, profiles: ['smoke', 'gate', 'full'] },
  { metric: 'continuityGetP95BalancedMs', operator: '<=', value: 600, profiles: ['gate', 'full'] },
  { metric: 'continuityGetP95ReviewMs', operator: '<=', value: 1000, profiles: ['full'] },
  { metric: 'postToolUseHookP95Ms', operator: '<=', value: 100, profiles: ['gate', 'full'] },
  { metric: 'stopHookP95Ms', operator: '<=', value: 5000, profiles: ['full'] },
  { metric: 'sqliteQueryP95Ms', operator: '<=', value: 100, profiles: ['gate', 'full'] },
  { metric: 'sqliteHitRateFreshIndex', operator: '>=', value: 1, profiles: ['smoke', 'gate', 'full'] },
  { metric: 'jsonlFallbackRateHotPath', operator: '=', value: 0, profiles: ['smoke', 'gate', 'full'] },
  { metric: 'recallAt3', operator: '>=', value: 0.9, profiles: ['full', 'scale'] },
  { metric: 'mrr', operator: '>=', value: 0.8, profiles: ['full', 'scale'] },
  { metric: 'wrongTop1Rate', operator: '<=', value: 0.1, profiles: ['full', 'scale'] },
  { metric: 'irrelevantRetrievalRate', operator: '<=', value: 0.05, profiles: ['full', 'scale'] },
  { metric: 'scaleSRuntimeMs', operator: '<=', value: 30000, profiles: ['scale'] },
  { metric: 'scaleMRuntimeMs', operator: '<=', value: 120000, profiles: ['scale'] },
  { metric: 'scaleLRuntimeMs', operator: '<=', value: 600000, profiles: ['scale'] },
  { metric: 'scaleXLRuntimeMs', operator: '<=', value: 1800000, profiles: ['scale'] },
  { metric: 'memoryDbBytesPerMemory', operator: '<=', value: 8192, profiles: ['scale'] },
  { metric: 'withMemoryTaskSuccessRate', operator: '>=', value: 1, profiles: ['llm'] },
  { metric: 'repeatedMistakeReduction', operator: '>=', value: 0.3, profiles: ['llm'] },
  { metric: 'userCorrectionReduction', operator: '>=', value: 0.2, profiles: ['llm'] },
  { metric: 'toolCallReduction', operator: '>=', value: 0.1, profiles: ['llm'] }
]

export const HARD_GATE_RULE_IDS = [
  'fixture_isolation_violation',
  'real_user_memory_read_write',
  'cross_case_mutable_state_reuse',
  'non_deterministic_fixture_generation',
  'pending_leakage',
  'cross_project_pollution',
  'unauthorized_promotion',
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
  'ordinary_hook_pending_review'
] as const
```

- [ ] **Step 5: Implement `benchmark/catalog.ts`**

Create `benchmark/catalog.ts` with a helper and a complete catalog. The exported `BENCHMARK_CASES` array below includes every case ID from `tests/benchmark-types.test.ts`; keep it exhaustive.

```ts
import type { BenchmarkCase, BenchmarkProfile, BenchmarkTier } from './types.js'

const DEFAULT_NOW = '2026-06-05T00:00:00.000Z'

interface CatalogInput {
  id: string
  tier: BenchmarkTier
  title: string
  profiles: BenchmarkProfile[]
  action: BenchmarkCase['action']
  expectedMode?: 'fast' | 'balanced' | 'review'
  expected?: string[]
  forbidden?: string[]
  metrics?: string[]
  passFail?: string[]
  adapter?: BenchmarkCase['adapter']
}

function action(kind: BenchmarkCase['action']['kind'], entrypoint: string, description: string): BenchmarkCase['action'] {
  return { kind, entrypoint, description }
}

function defaultMetrics(tier: BenchmarkTier): string[] {
  if (tier === 'tier0') return ['modeAccuracy', 'pendingLeakageRate', 'crossProjectPollutionRate']
  if (tier === 'tier1') return ['retrievalAccuracy', 'answerAccuracy', 'abstentionAccuracy']
  if (tier === 'tier1_5') return ['lifecyclePromotionAccuracy', 'conflictResolutionAccuracy']
  if (tier === 'tier1_6') return ['updateAccuracy', 'lifecyclePromotionAccuracy']
  if (tier === 'tier2') return ['taskSuccessRate', 'toolCallCount', 'repeatedMistakeReduction']
  if (tier === 'tier3') return ['continuityGetLatencyMs', 'tokenOverhead', 'sqliteHitRate']
  return ['boundarySafetyRate', 'hookLatencyMs', 'adapterAvailability']
}

function defaultRules(tier: BenchmarkTier): string[] {
  if (tier === 'tier0') return ['pending_leakage', 'cross_project_pollution', 'unauthorized_promotion']
  if (tier === 'tier1') return ['incorrect_memory_answer', 'fabricated_evidence']
  if (tier === 'tier1_5') return ['unauthorized_promotion', 'hash_bypass']
  if (tier === 'tier1_6') return ['secret_persistence', 'pending_active_bypass']
  if (tier === 'tier2') return ['repeated_mistake_not_reduced', 'workflow_rule_ignored']
  if (tier === 'tier3') return ['latency_threshold_breach', 'jsonl_hot_path_fallback']
  return ['security_boundary_violation', 'hook_timeout_crash']
}

function caseSpec(input: CatalogInput): BenchmarkCase {
  const expected = input.expected ?? [`${input.id} expected context`]
  const forbidden = input.forbidden ?? [`${input.id} forbidden context`]
  const metrics = input.metrics ?? defaultMetrics(input.tier)
  const passFail = input.passFail ?? defaultRules(input.tier)

  return {
    id: input.id,
    tier: input.tier,
    title: input.title,
    executionProfiles: input.profiles,
    fixture: {
      isolation: 'isolated temp HOME, temp project root, temp memory roots, temp SQLite db',
      seed: `cyrene-benchmark-${input.id.toLowerCase()}`,
      now: DEFAULT_NOW,
      timezone: 'UTC',
      groundTruth: expected,
      expectedContext: expected,
      expectedForbiddenContent: forbidden,
      ...(input.expectedMode === undefined ? {} : { expectedMode: input.expectedMode }),
      expectedMetrics: metrics,
      passFailRule: passFail
    },
    action: input.action,
    expected,
    forbidden,
    metrics,
    passFail,
    ...(input.adapter === undefined ? {} : { adapter: input.adapter })
  }
}

export const BENCHMARK_CASES: BenchmarkCase[] = [
  caseSpec({
    id: 'T0-MODE-FAST',
    tier: 'tier0',
    title: 'fast mode excludes review and similar hot paths',
    profiles: ['smoke', 'gate', 'full'],
    action: action('direct', 'getCodexContinuityContext', 'default coding context read'),
    expectedMode: 'fast',
    expected: ['project active memory', 'fast summary'],
    forbidden: ['pending details', 'pending count', 'similar-project hints', 'full profile', 'retrieved event'],
    metrics: ['modeAccuracy', 'fastTokenOverhead', 'continuityGetP95FastMs'],
    passFail: ['pending_leakage', 'retrieved_default_write', 'forbidden_context_injection']
  }),
  caseSpec({
    id: 'T0-MODE-BALANCED',
    tier: 'tier0',
    title: 'balanced mode reads full profile without pending details',
    profiles: ['gate', 'full'],
    action: action('direct', 'getCodexContinuityContext', 'balanced context read'),
    expectedMode: 'balanced',
    expected: ['full profile projection', 'session hints'],
    forbidden: ['pending details', 'pending count', 'review hash'],
    metrics: ['modeAccuracy', 'balancedTokenOverhead', 'pendingLeakageRate'],
    passFail: ['pending_leakage', 'forbidden_context_injection']
  }),
  caseSpec({ id: 'T0-MODE-REVIEW', tier: 'tier0', title: 'review mode is the only mode that reads pending memories', profiles: ['gate', 'full'], action: action('direct', 'getCodexContinuityContext', 'review context read'), expectedMode: 'review', expected: ['pending review item', 'review hash'], forbidden: ['auto promoted pending memory'], metrics: ['modeAccuracy', 'pendingMisuseRate'], passFail: ['pending_active_bypass', 'unauthorized_promotion'] }),
  caseSpec({ id: 'T0-PENDING-BOUNDARY', tier: 'tier0', title: 'pending does not leak into ordinary context', profiles: ['smoke', 'gate', 'full'], action: action('direct', 'getCodexContinuityContext', 'ordinary context read with pending fixture'), expectedMode: 'fast', expected: ['active memory only'], forbidden: ['pending memory content', 'review queue content'], metrics: ['pendingLeakageRate'], passFail: ['pending_leakage'] }),
  caseSpec({ id: 'T0-SIMILAR-BOUNDARY', tier: 'tier0', title: 'similar project hints never cross project boundary as memory', profiles: ['gate', 'full'], action: action('direct', 'getCodexContinuityContext', 'similar project hint read'), expected: ['current project memory'], forbidden: ['foreign project active memory', 'similar hint promoted memory'], metrics: ['crossProjectPollutionRate', 'similarHintMigrationRate'], passFail: ['cross_project_pollution', 'similar_hint_migration'] }),
  caseSpec({ id: 'T0-SESSION-HINTS', tier: 'tier0', title: 'session hints are transient and never migrate to memory', profiles: ['gate', 'full'], action: action('direct', 'getCodexContinuityContext', 'session hint read'), expected: ['session hint in context'], forbidden: ['session hint in active memory', 'session hint in pending memory'], metrics: ['similarHintMigrationRate', 'profilePollutionRate'], passFail: ['session_hint_migration'] }),
  caseSpec({ id: 'T0-ACTIVATION-RETRIEVED', tier: 'tier0', title: 'activation event defaults do not write retrieved events', profiles: ['gate', 'full'], action: action('direct', 'recordMemoryEvent', 'retrieved activation default check'), expected: ['no retrieved event write'], forbidden: ['retrieved MemoryEvent'], metrics: ['retrievedDefaultWriteRate'], passFail: ['retrieved_default_write'] }),
  caseSpec({ id: 'T0-SQLITE-HOT-PATH', tier: 'tier0', title: 'SQLite and FTS are the default hot path', profiles: ['smoke', 'gate', 'full'], action: action('direct', 'queryCodexMemoryIndex', 'fresh SQLite query'), expected: ['SQLite FTS result'], forbidden: ['JSONL fallback', 'hot path rebuild'], metrics: ['sqliteHitRateFreshIndex', 'jsonlFallbackRateHotPath', 'sqliteQueryLatencyMs'], passFail: ['jsonl_hot_path_fallback', 'hot_path_rebuild'] }),
  caseSpec({ id: 'T0-SURFACE-CONSISTENCY', tier: 'tier0', title: 'Skill, MCP, and CLI surfaces expose consistent behavior', profiles: ['gate', 'full'], action: action('cli', 'codex continuity get', 'surface consistency comparison'), expected: ['matching context payload'], forbidden: ['surface-specific pending leak'], metrics: ['surfaceConsistencyRate'], passFail: ['surface_contract_mismatch'] }),
  caseSpec({ id: 'T1-FACT-EXTRACTION', tier: 'tier1', title: 'extract project facts from coding memories', profiles: ['full'], action: action('replay', 'memoryAbilityReplay', 'fact extraction question') }),
  caseSpec({ id: 'T1-MULTI-SESSION-REASONING', tier: 'tier1', title: 'reason across multiple sessions', profiles: ['full'], action: action('replay', 'memoryAbilityReplay', 'multi-session question') }),
  caseSpec({ id: 'T1-TEMPORAL-ORDER', tier: 'tier1', title: 'answer temporal order questions', profiles: ['full'], action: action('replay', 'memoryAbilityReplay', 'temporal order question') }),
  caseSpec({ id: 'T1-KNOWLEDGE-UPDATE', tier: 'tier1', title: 'newer memories override stale rules', profiles: ['full'], action: action('replay', 'memoryAbilityReplay', 'knowledge update question') }),
  caseSpec({ id: 'T1-CONFLICT-HANDLING', tier: 'tier1', title: 'handle conflicting memories without double injection', profiles: ['full'], action: action('replay', 'memoryAbilityReplay', 'conflict handling question'), forbidden: ['old and new rule both injected'], passFail: ['conflicting_context_injection'] }),
  caseSpec({ id: 'T1-ABSTAIN-NO-EVIDENCE', tier: 'tier1', title: 'abstain when memory evidence is absent', profiles: ['full'], action: action('replay', 'memoryAbilityReplay', 'abstention question'), expected: ['abstain answer'], forbidden: ['fabricated command'], metrics: ['abstentionAccuracy'], passFail: ['fabricated_evidence'] }),
  caseSpec({ id: 'T1-EVENT-SUMMARY', tier: 'tier1', title: 'summarize project events from long session memory', profiles: ['full'], action: action('replay', 'memoryAbilityReplay', 'event summary question') }),
  caseSpec({ id: 'T15-UPGRADE', tier: 'tier1_5', title: 'low-risk project memory can upgrade through policy', profiles: ['full'], action: action('direct', 'reviewPendingMemory', 'upgrade lifecycle transition'), passFail: ['unauthorized_promotion'] }),
  caseSpec({ id: 'T15-REPLACE', tier: 'tier1_5', title: 'replacement removes stale active rule from injection', profiles: ['full'], action: action('direct', 'reviewPendingMemory', 'replace lifecycle transition'), passFail: ['duplicate_context_injection'] }),
  caseSpec({ id: 'T15-MERGE', tier: 'tier1_5', title: 'merge combines compatible memory evidence', profiles: ['full'], action: action('direct', 'reviewPendingMemory', 'merge lifecycle transition') }),
  caseSpec({ id: 'T15-EXPIRE', tier: 'tier1_5', title: 'expired memories are excluded from active context', profiles: ['full'], action: action('direct', 'resolveMemoryLifecycle', 'expire lifecycle transition'), forbidden: ['expired memory context'], passFail: ['expired_memory_injection'] }),
  caseSpec({ id: 'T15-SUPERSEDE-HASH', tier: 'tier1_5', title: 'supersede requires valid review hash', profiles: ['full'], action: action('direct', 'reviewPendingMemory', 'supersede hash check'), forbidden: ['stale hash accepted'], passFail: ['hash_bypass', 'stale_approval_success'] }),
  caseSpec({ id: 'T15-CONFLICT-SINGLE-INJECTION', tier: 'tier1_5', title: 'conflicting old and new rules inject only one winner', profiles: ['full'], action: action('direct', 'getCodexContinuityContext', 'conflict single injection check'), forbidden: ['conflicting rule pair'], passFail: ['conflicting_context_injection'] }),
  caseSpec({ id: 'T16-PROPOSE-IMPORTANT', tier: 'tier1_6', title: 'important project evidence is proposed for review', profiles: ['full'], action: action('direct', 'proposeMemory', 'important memory proposal') }),
  caseSpec({ id: 'T16-PROPOSE-NOISE', tier: 'tier1_6', title: 'noise is not proposed as durable memory', profiles: ['full'], action: action('direct', 'proposeMemory', 'noise proposal suppression'), forbidden: ['noise pending memory'], passFail: ['ordinary_hook_pending_review'] }),
  caseSpec({ id: 'T16-PROPOSE-SENSITIVE', tier: 'tier1_6', title: 'sensitive content is never persisted', profiles: ['full'], action: action('direct', 'proposeMemory', 'sensitive proposal suppression'), forbidden: ['secret in memory store'], passFail: ['secret_persistence'] }),
  caseSpec({ id: 'T16-PROPOSE-ASSISTANT-INFERENCE', tier: 'tier1_6', title: 'assistant-only inference is not promoted as user fact', profiles: ['full'], action: action('direct', 'proposeMemory', 'assistant inference suppression'), forbidden: ['assistant inference as durable fact'], passFail: ['unauthorized_promotion'] }),
  caseSpec({ id: 'T16-ROUTING-NAMESPACE', tier: 'tier1_6', title: 'project and global namespace routing is correct', profiles: ['smoke', 'full'], action: action('direct', 'proposeMemory', 'namespace routing check'), expected: ['project memory in project root', 'global memory in global root'], forbidden: ['project memory in global root'], metrics: ['lifecyclePromotionAccuracy'], passFail: ['global_namespace_misroute'] }),
  caseSpec({ id: 'T16-REVIEW-HASH-REQUIRED', tier: 'tier1_6', title: 'review approval requires review hash', profiles: ['full'], action: action('direct', 'reviewPendingMemory', 'missing hash rejection'), forbidden: ['approval without hash'], passFail: ['hash_bypass'] }),
  caseSpec({ id: 'T16-REVIEW-STALE-HASH', tier: 'tier1_6', title: 'stale review hash cannot approve pending memory', profiles: ['full'], action: action('direct', 'reviewPendingMemory', 'stale hash rejection'), forbidden: ['stale hash accepted'], passFail: ['stale_approval_success'] }),
  caseSpec({ id: 'T16-REVIEW-REJECT-DEFER', tier: 'tier1_6', title: 'reject and defer decisions do not activate memory', profiles: ['full'], action: action('direct', 'reviewPendingMemory', 'reject and defer lifecycle check'), forbidden: ['rejected memory activated'], passFail: ['rejected_memory_activation'] }),
  caseSpec({ id: 'T16-REVIEW-EDIT-HASH', tier: 'tier1_6', title: 'edited review content gets a fresh hash contract', profiles: ['full'], action: action('direct', 'reviewPendingMemory', 'edit hash lifecycle check'), forbidden: ['edited content approved with stale hash'], passFail: ['hash_bypass'] }),
  caseSpec({ id: 'T2-REMEMBER-TEST-COMMAND', tier: 'tier2', title: 'remember and reuse project test command', profiles: ['full', 'llm'], action: action('replay', 'memoryToActionReplay', 'test command replay'), adapter: { kind: 'deterministic' } }),
  caseSpec({ id: 'T2-AVOID-REJECTED-APPROACH', tier: 'tier2', title: 'avoid an approach rejected in an earlier session', profiles: ['full', 'llm'], action: action('replay', 'memoryToActionReplay', 'rejected approach replay'), adapter: { kind: 'deterministic' } }),
  caseSpec({ id: 'T2-FOLLOW-WORKFLOW', tier: 'tier2', title: 'follow remembered project workflow', profiles: ['full', 'llm'], action: action('replay', 'memoryToActionReplay', 'workflow replay'), adapter: { kind: 'deterministic' } }),
  caseSpec({ id: 'T2-UPDATED-RULE', tier: 'tier2', title: 'use updated rule and stop using old rule', profiles: ['full', 'llm'], action: action('replay', 'memoryToActionReplay', 'updated rule replay'), adapter: { kind: 'deterministic' } }),
  caseSpec({ id: 'T2-CROSS-SESSION-FIX', tier: 'tier2', title: 'apply cross-session fix memory to current task', profiles: ['full', 'llm'], action: action('replay', 'memoryToActionReplay', 'cross-session fix replay'), adapter: { kind: 'deterministic' } }),
  caseSpec({ id: 'T2-REDUCE-REPEAT-MISTAKE', tier: 'tier2', title: 'memory reduces repeated mistakes and user corrections', profiles: ['full', 'llm'], action: action('replay', 'memoryToActionReplay', 'repeat mistake reduction replay'), adapter: { kind: 'deterministic' } }),
  caseSpec({ id: 'T3-S-SCALE', tier: 'tier3', title: 'S scale fixture stays within latency and overhead thresholds', profiles: ['scale'], action: action('direct', 'runScaleFixture', 'S scale run'), metrics: ['continuityGetP50Ms', 'continuityGetP95Ms', 'memoryDbSizeBytes'] }),
  caseSpec({ id: 'T3-M-SCALE', tier: 'tier3', title: 'M scale fixture stays within latency and overhead thresholds', profiles: ['scale'], action: action('direct', 'runScaleFixture', 'M scale run'), metrics: ['continuityGetP50Ms', 'continuityGetP95Ms', 'memoryDbSizeBytes'] }),
  caseSpec({ id: 'T3-L-SCALE', tier: 'tier3', title: 'L scale fixture stays within latency and overhead thresholds', profiles: ['scale'], action: action('direct', 'runScaleFixture', 'L scale run'), metrics: ['continuityGetP95Ms', 'continuityGetP99Ms', 'indexStaleRate'] }),
  caseSpec({ id: 'T3-XL-SCALE', tier: 'tier3', title: 'XL scale fixture reports efficiency without entering release gate hot path', profiles: ['scale'], action: action('direct', 'runScaleFixture', 'XL scale run'), metrics: ['scaleXLRuntimeMs', 'memoryDbSizeBytes', 'benchmarkRuntimeMs'] }),
  caseSpec({ id: 'T3-RANKING', tier: 'tier3', title: 'ranking resists similar memory interference', profiles: ['full', 'scale'], action: action('direct', 'queryCodexMemoryIndex', 'ranking interference check'), metrics: ['recallAt3', 'mrr', 'similarMemoryInterferenceRate'] }),
  caseSpec({ id: 'T3-TOKEN-OVERHEAD', tier: 'tier3', title: 'token overhead stays inside profile budget', profiles: ['full', 'scale'], action: action('direct', 'getCodexContinuityContext', 'token overhead measurement'), metrics: ['fastTokenOverhead', 'balancedTokenOverhead', 'reviewTokenOverhead'] }),
  caseSpec({ id: 'T3-LATENCY', tier: 'tier3', title: 'latency percentiles are reported for continuity and hooks', profiles: ['full', 'scale'], action: action('direct', 'runLatencyProbe', 'latency percentile measurement'), metrics: ['continuityGetP50Ms', 'continuityGetP95Ms', 'continuityGetP99Ms', 'hookLatencyMs'] }),
  caseSpec({ id: 'T3-INDEX-HEALTH', tier: 'tier3', title: 'index health reports SQLite hit, JSONL fallback, and stale rates', profiles: ['full', 'scale'], action: action('direct', 'inspectIndexHealth', 'index health measurement'), metrics: ['sqliteHitRateFreshIndex', 'jsonlFallbackRateHotPath', 'indexStaleRate'] }),
  caseSpec({ id: 'T4-SQLITE-UNAVAILABLE', tier: 'tier4', title: 'SQLite unavailable path reports fallback policy explicitly', profiles: ['full'], action: action('direct', 'inspectIndexHealth', 'SQLite unavailable check') }),
  caseSpec({ id: 'T4-JSONL-CORRUPT', tier: 'tier4', title: 'corrupt JSONL fixture fails closed with diagnostics', profiles: ['full'], action: action('direct', 'readMemoryStore', 'corrupt JSONL check') }),
  caseSpec({ id: 'T4-PROFILE-MISSING', tier: 'tier4', title: 'missing profile does not pollute context', profiles: ['full'], action: action('direct', 'getCodexContinuityContext', 'missing profile check') }),
  caseSpec({ id: 'T4-FAST-SUMMARY-MISSING-STALE', tier: 'tier4', title: 'missing or stale fast summary never triggers hot-path heavy rebuild', profiles: ['full'], action: action('direct', 'getCodexContinuityContext', 'stale fast summary check'), passFail: ['hot_path_summary_generation'] }),
  caseSpec({ id: 'T4-SESSION-HINTS-EXPIRED', tier: 'tier4', title: 'expired session hints are ignored', profiles: ['full'], action: action('direct', 'getCodexContinuityContext', 'expired session hints check') }),
  caseSpec({ id: 'T4-MCP-ERROR', tier: 'tier4', title: 'MCP error surface returns bounded diagnostics', profiles: ['full'], action: action('mcp', 'continuity_get', 'MCP error check') }),
  caseSpec({ id: 'T4-AUTOMATION-INTERRUPT', tier: 'tier4', title: 'automation interruption does not leave memory partial writes', profiles: ['full'], action: action('direct', 'memoryLifecycleAutomation', 'automation interruption check') }),
  caseSpec({ id: 'T4-HOOK-LIGHTWEIGHT', tier: 'tier4', title: 'hook path remains lightweight', profiles: ['full'], action: action('direct', 'measureHookOverhead', 'hook lightweight check'), metrics: ['hookLatencyMs'], passFail: ['post_tool_use_heavy_operation'] }),
  caseSpec({ id: 'T4-HOOK-TIMEOUT', tier: 'tier4', title: 'hook timeout does not crash ordinary coding flow', profiles: ['full'], action: action('direct', 'measureHookOverhead', 'hook timeout check'), passFail: ['hook_timeout_crash'] }),
  caseSpec({ id: 'T4-SECURITY-SECRETS', tier: 'tier4', title: 'secrets are never persisted or reported as memory', profiles: ['full', 'external'], action: action('adapter', 'securityAdapter', 'secret persistence check'), forbidden: ['API key in memory', 'token in report'], passFail: ['secret_persistence'], adapter: { kind: 'external', requiredEnv: ['CYRENE_BENCHMARK_EXTERNAL_ADAPTER'] } }),
  caseSpec({ id: 'T4-SECURITY-PROMPT-INJECTION', tier: 'tier4', title: 'prompt injection text cannot override benchmark or memory policy', profiles: ['full', 'llm'], action: action('adapter', 'securityAdapter', 'prompt injection check'), forbidden: ['policy bypass instruction accepted'], passFail: ['security_boundary_violation'], adapter: { kind: 'llm', requiredEnv: ['CYRENE_BENCHMARK_LLM_ADAPTER'] } }),
  caseSpec({ id: 'T4-SECURITY-GLOBAL-WRITE', tier: 'tier4', title: 'global writes require explicit allowed namespace and policy', profiles: ['full'], action: action('direct', 'proposeMemory', 'global write security check'), forbidden: ['unauthorized global write'], passFail: ['global_namespace_misroute', 'unauthorized_promotion'] })
]

export const BENCHMARK_CASE_IDS = BENCHMARK_CASES.map((item) => item.id)
```

- [ ] **Step 6: Run GREEN verification**

Run:

```bash
npm test -- tests/benchmark-types.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add benchmark/types.ts benchmark/catalog.ts benchmark/thresholds.ts tests/benchmark-types.test.ts
git commit -m "feat: add benchmark contract catalog"
```

## Task 2: Isolated Deterministic Fixture Builder

**Files:**
- Create: `benchmark/fixtures.ts`
- Create: `tests/benchmark-fixtures.test.ts`

- [ ] **Step 1: Write failing fixture isolation tests**

Create `tests/benchmark-fixtures.test.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBenchmarkFixture, seededId, withFixtureEnvironment } from '../benchmark/fixtures.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { identifyCodexProject } from '../src/codex/project-id.js'

const fixtures: Array<Awaited<ReturnType<typeof createBenchmarkFixture>>> = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()))
})

describe('benchmark fixtures', () => {
  it('creates isolated HOME and memory roots with deterministic ids', async () => {
    const fixture = await createBenchmarkFixture({
      caseId: 'T0-MODE-FAST',
      seed: 'seed-a',
      now: '2026-06-05T00:00:00.000Z'
    })
    fixtures.push(fixture)

    expect(fixture.home).toContain('cyrene-benchmark-')
    expect(fixture.cwd).toContain('cyrene-benchmark-project-')
    expect(fixture.now).toBe('2026-06-05T00:00:00.000Z')
    expect(fixture.timezone).toBe('UTC')
    expect(seededId('seed-a', 'memory')).toBe(seededId('seed-a', 'memory'))

    await withFixtureEnvironment(fixture, async () => {
      const project = await identifyCodexProject(fixture.cwd)
      expect(codexGlobalMemoryRoot()).toContain(fixture.home)
      expect(codexProjectMemoryRoot(project.projectId)).toContain(fixture.home)
    })

    expect(process.env.HOME).not.toBe(fixture.home)
  })

  it('seeds active, pending, profile, fast summary, and SQLite paths inside fixture HOME', async () => {
    const fixture = await createBenchmarkFixture({
      caseId: 'T16-ROUTING-NAMESPACE',
      seed: 'seed-routing',
      now: '2026-06-05T00:00:00.000Z',
      activeMemories: [{ id: 'active-a', content: 'Fixture active memory stays isolated.' }],
      pendingMemories: [{ id: 'pending-a', content: 'Fixture pending memory stays isolated.' }],
      globalProfile: '# Fixture Global Profile\n',
      projectProfile: '# Fixture Project Profile\n',
      fastSummary: 'Fixture fast summary.'
    })
    fixtures.push(fixture)

    await expect(readFile(join(fixture.projectMemoryRoot, 'index.jsonl'), 'utf8')).resolves.toContain('Fixture active memory')
    await expect(readFile(join(fixture.projectMemoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toContain('Fixture pending memory')
    await expect(readFile(join(fixture.projectMemoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain('Fixture Project Profile')
    await expect(readFile(join(fixture.projectMemoryRoot, 'fast_summary.json'), 'utf8')).resolves.toContain('Fixture fast summary')
    expect(fixture.memoryDbPath).toContain(fixture.home)
  })
})
```

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/benchmark-fixtures.test.ts
```

Expected: FAIL because `benchmark/fixtures.ts` does not exist.

- [ ] **Step 3: Implement fixture builder**

Create `benchmark/fixtures.ts`:

```ts
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { codexMemoryDbPath } from '../src/codex/codex-memory-index.js'
import { writeFastSummaryProjection } from '../src/codex/fast-summary-store.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { activationPolicyForConfidenceTier } from '../src/memory/memory-lifecycle.js'
import { writeActiveMemoriesFromRoot, writePendingMemoriesFromRoot } from '../src/memory/memory-store.js'
import type { CyreneMemory, PendingMemory } from '../src/memory/types.js'

export interface BenchmarkFixtureInput {
  caseId: string
  seed: string
  now: string
  activeMemories?: Array<Partial<CyreneMemory> & { id: string; content: string }>
  pendingMemories?: Array<Partial<PendingMemory> & { id: string; content: string }>
  globalProfile?: string
  projectProfile?: string
  fastSummary?: string
  preserveFixture?: boolean
}

export interface BenchmarkFixture {
  caseId: string
  seed: string
  now: string
  timezone: 'UTC'
  home: string
  cwd: string
  projectId: string
  globalMemoryRoot: string
  projectMemoryRoot: string
  memoryDbPath: string
  cleanup(): Promise<void>
}

export function seededId(seed: string, label: string): string {
  return createHash('sha256').update(`${seed}:${label}`).digest('hex').slice(0, 16)
}

export async function withFixtureEnvironment<T>(fixture: BenchmarkFixture, fn: () => Promise<T>): Promise<T> {
  const previousHome = process.env.HOME
  const previousTz = process.env.TZ
  process.env.HOME = fixture.home
  process.env.TZ = 'UTC'
  try {
    return await fn()
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = previousHome
    }
    if (previousTz === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = previousTz
    }
  }
}

export async function createBenchmarkFixture(input: BenchmarkFixtureInput): Promise<BenchmarkFixture> {
  const root = await mkdtemp(join(tmpdir(), 'cyrene-benchmark-'))
  const home = join(root, 'home')
  const cwd = join(root, `cyrene-benchmark-project-${seededId(input.seed, 'project')}`)
  await mkdir(home, { recursive: true })
  await mkdir(cwd, { recursive: true })
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: `benchmark-${input.caseId.toLowerCase()}` }), 'utf8')

  let projectId = ''
  let globalMemoryRoot = ''
  let projectMemoryRoot = ''
  let memoryDbPath = ''
  await withFixtureEnvironment({ caseId: input.caseId, seed: input.seed, now: input.now, timezone: 'UTC', home, cwd, projectId, globalMemoryRoot, projectMemoryRoot, memoryDbPath, cleanup: async () => {} }, async () => {
    const project = await identifyCodexProject(cwd)
    projectId = project.projectId
    globalMemoryRoot = codexGlobalMemoryRoot()
    projectMemoryRoot = codexProjectMemoryRoot(project.projectId)
    memoryDbPath = codexMemoryDbPath()
    await mkdir(globalMemoryRoot, { recursive: true })
    await mkdir(projectMemoryRoot, { recursive: true })
    if (input.activeMemories !== undefined) {
      await writeActiveMemoriesFromRoot(projectMemoryRoot, input.activeMemories.map((memory, index) => activeMemory(input, memory, index)))
    }
    if (input.pendingMemories !== undefined) {
      await writePendingMemoriesFromRoot(projectMemoryRoot, input.pendingMemories.map((memory, index) => pendingMemory(input, memory, index)))
    }
    if (input.globalProfile !== undefined) {
      await writeFile(join(globalMemoryRoot, 'MODEL_PROFILE.md'), input.globalProfile, 'utf8')
    }
    if (input.projectProfile !== undefined) {
      await writeFile(join(projectMemoryRoot, 'MODEL_PROFILE.md'), input.projectProfile, 'utf8')
    }
    if (input.fastSummary !== undefined) {
      await writeFastSummaryProjection(projectMemoryRoot, {
        globalFastSummary: '',
        profileFastSummary: input.fastSummary,
        generatedAt: input.now
      })
    }
  })

  return {
    caseId: input.caseId,
    seed: input.seed,
    now: input.now,
    timezone: 'UTC',
    home,
    cwd,
    projectId,
    globalMemoryRoot,
    projectMemoryRoot,
    memoryDbPath,
    cleanup: async () => {
      if (input.preserveFixture !== true) {
        await rm(root, { recursive: true, force: true })
      }
    }
  }
}

function activeMemory(input: BenchmarkFixtureInput, memory: Partial<CyreneMemory> & { id: string; content: string }, index: number): CyreneMemory {
  return {
    id: memory.id,
    domain: memory.domain ?? 'procedural',
    type: memory.type ?? 'procedural_rule',
    strength: memory.strength ?? 'hard',
    scope: memory.scope ?? 'project',
    status: 'active',
    content: memory.content,
    normalizedKey: memory.normalizedKey ?? seededId(input.seed, `active-${index}`),
    evidence: memory.evidence ?? [{ runId: `benchmark-${input.caseId}`, sourceKind: 'user_explicit', summary: 'Benchmark active fixture.' }],
    source: memory.source ?? 'user_explicit',
    scores: memory.scores ?? { evidenceStrength: 0.95, stability: 0.9, usefulness: 0.9, safety: 0.95, sensitivity: 0.1 },
    createdAt: memory.createdAt ?? input.now,
    updatedAt: memory.updatedAt ?? input.now,
    tags: memory.tags ?? ['benchmark'],
    confidenceTier: memory.confidenceTier,
    activationPolicy: memory.activationPolicy ?? activationPolicyForConfidenceTier(memory.confidenceTier ?? 'validated'),
    portability: memory.portability,
    expiresAt: memory.expiresAt,
    reviewAfter: memory.reviewAfter,
    supersedes: memory.supersedes
  } as CyreneMemory
}

function pendingMemory(input: BenchmarkFixtureInput, memory: Partial<PendingMemory> & { id: string; content: string }, index: number): PendingMemory {
  return {
    id: memory.id,
    domain: memory.domain ?? 'procedural',
    type: memory.type ?? 'procedural_rule',
    strength: memory.strength ?? 'hard',
    scope: memory.scope ?? 'project',
    status: 'pending',
    content: memory.content,
    normalizedKey: memory.normalizedKey ?? seededId(input.seed, `pending-${index}`),
    evidence: memory.evidence ?? [{ runId: `benchmark-${input.caseId}`, evidenceGroupId: `benchmark-${index}`, summary: 'Benchmark pending fixture.' }],
    source: memory.source ?? 'assistant_observed',
    scores: memory.scores ?? { evidenceStrength: 0.5, stability: 0.5, usefulness: 0.5, safety: 0.9, sensitivity: 0.1 },
    seenCount: memory.seenCount ?? 1,
    firstSeenAt: memory.firstSeenAt ?? input.now,
    lastSeenAt: memory.lastSeenAt ?? input.now,
    expiresAt: memory.expiresAt ?? '2026-07-05T00:00:00.000Z',
    tags: memory.tags ?? ['benchmark']
  }
}
```

- [ ] **Step 4: Run GREEN verification**

Run:

```bash
npm test -- tests/benchmark-fixtures.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add benchmark/fixtures.ts tests/benchmark-fixtures.test.ts
git commit -m "feat: add isolated benchmark fixtures"
```

## Task 3: Scorer And Report Generator

**Files:**
- Create: `benchmark/scorer.ts`
- Create: `benchmark/report.ts`
- Create: `tests/benchmark-report.test.ts`

- [ ] **Step 1: Write failing scorer/report tests**

Create `tests/benchmark-report.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scoreCaseResult, summarizeBenchmarkResults } from '../benchmark/scorer.js'
import { writeBenchmarkReports } from '../benchmark/report.js'
import type { BenchmarkCaseResult, BenchmarkReport } from '../benchmark/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-benchmark-report-'))
  tempDirs.push(dir)
  return dir
}

function result(overrides: Partial<BenchmarkCaseResult> = {}): BenchmarkCaseResult {
  return {
    id: 'T0-MODE-FAST',
    title: 'fast mode excludes review and similar hot paths',
    tier: 'tier0',
    status: 'passed',
    durationMs: 5,
    metrics: [{ metric: 'fastTokenOverhead', value: 700 }],
    hardRuleViolations: [],
    thresholdBreaches: [],
    evidence: [{ summary: 'fast mode stayed isolated' }],
    ...overrides
  }
}

describe('benchmark scorer and report', () => {
  it('marks hard rule violations as failed and records soft threshold breaches', () => {
    const scored = scoreCaseResult(result({
      metrics: [
        { metric: 'fastTokenOverhead', value: 900 },
        { metric: 'jsonlFallbackRateHotPath', value: 0 }
      ],
      hardRuleViolations: ['pending_leakage']
    }), 'gate')

    expect(scored.status).toBe('failed')
    expect(scored.thresholdBreaches).toEqual([
      expect.objectContaining({ metric: 'fastTokenOverhead', actual: 900, severity: 'warning' })
    ])
  })

  it('summarizes passed, failed, skipped, and unsupported case results', () => {
    const summary = summarizeBenchmarkResults([
      result({ id: 'pass', status: 'passed' }),
      result({ id: 'fail', status: 'failed' }),
      result({ id: 'skip', status: 'skipped_with_reason' }),
      result({ id: 'unsupported', status: 'not_supported_without_provider' })
    ])

    expect(summary).toEqual({
      totalCases: 4,
      passed: 1,
      failed: 1,
      skippedWithReason: 1,
      notSupportedWithoutProvider: 1
    })
  })

  it('writes JSON and Markdown reports with metadata', async () => {
    const outputDir = await createTempDir()
    await mkdir(outputDir, { recursive: true })
    const report: BenchmarkReport = {
      runId: 'run-1',
      startedAt: '2026-06-05T00:00:00.000Z',
      completedAt: '2026-06-05T00:00:01.000Z',
      profile: 'smoke',
      spec: {
        path: 'docs/superpowers/specs/2026-06-05-cyrene-benchmark-eval-system-design.md',
        title: 'Cyrene Benchmark Eval System Design',
        date: '2026-06-05',
        contentHash: 'hash'
      },
      benchmark: { version: '1.0.0', thresholdVersion: '2026-06-05', caseCatalogHash: 'catalog' },
      package: { name: 'cyrene-continuity', version: '0.1.0' },
      git: { branch: 'main', commit: 'abc123', dirty: false, trackedChanges: [] },
      runtime: { nodeVersion: process.version, platform: process.platform, arch: process.arch },
      passed: true,
      summary: { totalCases: 1, passed: 1, failed: 0, skippedWithReason: 0, notSupportedWithoutProvider: 0 },
      failedCases: [],
      caseResults: [result()],
      metrics: { capability: {}, boundarySafety: {}, efficiency: {}, taskUtility: {} },
      thresholdBreaches: []
    }

    const paths = await writeBenchmarkReports(outputDir, report)

    await expect(readFile(paths.jsonPath, 'utf8')).resolves.toContain('"profile": "smoke"')
    await expect(readFile(paths.markdownPath, 'utf8')).resolves.toContain('# Cyrene Benchmark Report')
    await expect(readFile(paths.markdownPath, 'utf8')).resolves.toContain('Git')
    await expect(readFile(paths.markdownPath, 'utf8')).resolves.toContain('T0-MODE-FAST')
  })
})
```

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/benchmark-report.test.ts
```

Expected: FAIL because `benchmark/scorer.ts` and `benchmark/report.ts` do not exist.

- [ ] **Step 3: Implement scorer**

Create `benchmark/scorer.ts`:

```ts
import { SOFT_METRIC_THRESHOLDS } from './thresholds.js'
import type { BenchmarkCaseResult, BenchmarkProfile, BenchmarkThresholdBreach } from './types.js'

export function scoreCaseResult(result: BenchmarkCaseResult, profile: BenchmarkProfile): BenchmarkCaseResult {
  const thresholdBreaches = thresholdBreachesFor(result, profile)
  return {
    ...result,
    status: result.hardRuleViolations.length > 0 ? 'failed' : result.status,
    thresholdBreaches
  }
}

export function thresholdBreachesFor(result: BenchmarkCaseResult, profile: BenchmarkProfile): BenchmarkThresholdBreach[] {
  return result.metrics.flatMap((metric) => {
    const threshold = SOFT_METRIC_THRESHOLDS.find((item) => item.metric === metric.metric && item.profiles.includes(profile))
    if (threshold === undefined) return []
    const breached =
      threshold.operator === '<=' ? metric.value > threshold.value :
      threshold.operator === '>=' ? metric.value < threshold.value :
      metric.value !== threshold.value
    if (!breached) return []
    return [{
      metric: metric.metric,
      threshold: `${threshold.operator} ${threshold.value}`,
      actual: metric.value,
      severity: 'warning' as const
    }]
  })
}

export function summarizeBenchmarkResults(results: BenchmarkCaseResult[]): {
  totalCases: number
  passed: number
  failed: number
  skippedWithReason: number
  notSupportedWithoutProvider: number
} {
  return {
    totalCases: results.length,
    passed: results.filter((item) => item.status === 'passed').length,
    failed: results.filter((item) => item.status === 'failed').length,
    skippedWithReason: results.filter((item) => item.status === 'skipped_with_reason').length,
    notSupportedWithoutProvider: results.filter((item) => item.status === 'not_supported_without_provider').length
  }
}
```

- [ ] **Step 4: Implement report writer**

Create `benchmark/report.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BenchmarkReport } from './types.js'

export async function writeBenchmarkReports(outputDir: string, report: BenchmarkReport): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(outputDir, { recursive: true })
  const jsonPath = join(outputDir, 'benchmark_report.json')
  const markdownPath = join(outputDir, 'benchmark_report.md')
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(markdownPath, renderBenchmarkReportMarkdown(report), 'utf8')
  return { jsonPath, markdownPath }
}

export function renderBenchmarkReportMarkdown(report: BenchmarkReport): string {
  const failed = report.failedCases.length === 0
    ? '- None'
    : report.failedCases.map((item) => `- ${item.id}: ${item.title}`).join('\n')
  const thresholdBreaches = report.thresholdBreaches.length === 0
    ? '- None'
    : report.thresholdBreaches.map((item) => `- ${item.metric}: ${item.actual} (${item.threshold})`).join('\n')
  const cases = report.caseResults
    .map((item) => `- ${item.status.toUpperCase()} ${item.id}: ${item.title}`)
    .join('\n')

  return `# Cyrene Benchmark Report

Profile: ${report.profile}
Passed: ${report.passed}

## Summary

- Total cases: ${report.summary.totalCases}
- Passed: ${report.summary.passed}
- Failed: ${report.summary.failed}
- Skipped with reason: ${report.summary.skippedWithReason}
- Not supported without provider: ${report.summary.notSupportedWithoutProvider}

## Spec

- Path: ${report.spec.path}
- Date: ${report.spec.date}
- Hash: ${report.spec.contentHash}

## Benchmark

- Version: ${report.benchmark.version}
- Threshold version: ${report.benchmark.thresholdVersion}
- Catalog hash: ${report.benchmark.caseCatalogHash}

## Git

- Branch: ${report.git.branch}
- Commit: ${report.git.commit}
- Dirty: ${report.git.dirty}

## Runtime

- Node: ${report.runtime.nodeVersion}
- npm: ${report.runtime.npmVersion ?? 'unknown'}
- Platform: ${report.runtime.platform}
- Arch: ${report.runtime.arch}

## Failed Cases

${failed}

## Threshold Breaches

${thresholdBreaches}

## Case Results

${cases}
`
}
```

- [ ] **Step 5: Run GREEN verification**

Run:

```bash
npm test -- tests/benchmark-report.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add benchmark/scorer.ts benchmark/report.ts tests/benchmark-report.test.ts
git commit -m "feat: add benchmark scoring reports"
```

## Task 4: Runner And CLI Integration

**Files:**
- Create: `benchmark/runner.ts`
- Create: `src/codex/codex-benchmark.ts`
- Modify: `src/codex/codex-cli.ts`
- Create: `tests/benchmark-runner.test.ts`
- Create: `tests/benchmark-cli.test.ts`

- [ ] **Step 1: Write failing runner test**

Create `tests/benchmark-runner.test.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCyreneBenchmark } from '../benchmark/runner.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-benchmark-runner-'))
  tempDirs.push(dir)
  return dir
}

describe('benchmark runner', () => {
  it('runs smoke profile, writes reports, and keeps catalog visibility', async () => {
    const outputDir = await tempDir()
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'smoke',
      outputDir,
      seed: 'runner-seed',
      now: '2026-06-05T00:00:00.000Z'
    })

    expect(report.profile).toBe('smoke')
    expect(report.summary.totalCases).toBeGreaterThan(report.summary.passed + report.summary.failed)
    expect(report.caseResults.map((item) => item.id)).toContain('T0-MODE-FAST')
    expect(report.caseResults.map((item) => item.id)).toContain('T1-FACT-EXTRACTION')
    await expect(readFile(join(outputDir, 'benchmark_report.json'), 'utf8')).resolves.toContain('"profile": "smoke"')
    await expect(readFile(join(outputDir, 'benchmark_report.md'), 'utf8')).resolves.toContain('# Cyrene Benchmark Report')
  })
})
```

- [ ] **Step 2: Write failing CLI test**

Create `tests/benchmark-cli.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []
const originalHome = process.env.HOME

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function cliEnv(home: string): NodeJS.ProcessEnv {
  const { FORCE_COLOR: _forceColor, NO_COLOR: _noColor, ...env } = process.env
  return { ...env, HOME: home, CYRENE_MEMORY_AUTO_EXTRACT: '0' }
}

describe('benchmark CLI', () => {
  it('runs smoke profile and writes reports', async () => {
    const home = await tempDir('cyrene-benchmark-cli-home-')
    const cwd = await tempDir('cyrene-benchmark-cli-project-')
    const outputDir = await tempDir('cyrene-benchmark-cli-output-')

    const { stdout } = await execFileAsync(process.execPath, [
      'node_modules/tsx/dist/cli.mjs',
      'src/main.ts',
      '--cwd',
      cwd,
      'codex',
      'benchmark',
      'run',
      '--profile',
      'smoke',
      '--output-dir',
      outputDir
    ], { cwd: process.cwd(), env: cliEnv(home) })

    const payload = JSON.parse(stdout)
    expect(payload.profile).toBe('smoke')
    expect(payload.reportPaths.jsonPath).toContain('benchmark_report.json')
    await expect(readFile(join(outputDir, 'benchmark_report.json'), 'utf8')).resolves.toContain('"profile": "smoke"')
  })
})
```

- [ ] **Step 3: Run RED verification**

Run:

```bash
npm test -- tests/benchmark-runner.test.ts tests/benchmark-cli.test.ts
```

Expected: FAIL because runner and CLI command do not exist.

- [ ] **Step 4: Implement runner**

Create `benchmark/runner.ts`:

```ts
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { BENCHMARK_CASES } from './catalog.js'
import { writeBenchmarkReports } from './report.js'
import { scoreCaseResult, summarizeBenchmarkResults } from './scorer.js'
import { BENCHMARK_VERSION, THRESHOLD_VERSION } from './thresholds.js'
import type { BenchmarkCase, BenchmarkCaseResult, BenchmarkReport, BenchmarkRunOptions } from './types.js'

const execFileAsync = promisify(execFile)
const SPEC_PATH = 'docs/superpowers/specs/2026-06-05-cyrene-benchmark-eval-system-design.md'

export async function runCyreneBenchmark(options: BenchmarkRunOptions): Promise<BenchmarkReport> {
  const startedAt = options.now ?? new Date().toISOString()
  const runnable = BENCHMARK_CASES.filter((item) => item.executionProfiles.includes(options.profile))
  const runnableIds = new Set(runnable.map((item) => item.id))
  const caseResults: BenchmarkCaseResult[] = []
  for (const benchmarkCase of BENCHMARK_CASES) {
    if (!runnableIds.has(benchmarkCase.id)) {
      caseResults.push(skippedResult(benchmarkCase, `profile ${options.profile} does not run this case`))
      continue
    }
    const result = await runRunnableCase(benchmarkCase, options)
    caseResults.push(scoreCaseResult(result, options.profile))
  }
  const failedCases = caseResults.filter((item) => item.status === 'failed')
  const thresholdBreaches = caseResults.flatMap((item) => item.thresholdBreaches)
  const completedAt = new Date().toISOString()
  const report: BenchmarkReport = {
    runId: createHash('sha256').update(`${startedAt}:${options.profile}:${options.seed ?? ''}`).digest('hex').slice(0, 16),
    startedAt,
    completedAt,
    profile: options.profile,
    spec: {
      path: SPEC_PATH,
      title: 'Cyrene Benchmark Eval System Design',
      date: '2026-06-05',
      contentHash: await fileHash(SPEC_PATH)
    },
    benchmark: {
      version: BENCHMARK_VERSION,
      thresholdVersion: THRESHOLD_VERSION,
      caseCatalogHash: createHash('sha256').update(JSON.stringify(BENCHMARK_CASES)).digest('hex')
    },
    package: await packageMetadata(),
    git: await gitMetadata(),
    runtime: {
      nodeVersion: process.version,
      npmVersion: await npmVersion(),
      platform: process.platform,
      arch: process.arch
    },
    passed: failedCases.length === 0,
    summary: summarizeBenchmarkResults(caseResults),
    failedCases,
    caseResults,
    metrics: { capability: {}, boundarySafety: {}, efficiency: {}, taskUtility: {} },
    thresholdBreaches
  }
  await writeBenchmarkReports(options.outputDir, report)
  return report
}

async function runRunnableCase(benchmarkCase: BenchmarkCase, _options: BenchmarkRunOptions): Promise<BenchmarkCaseResult> {
  return {
    id: benchmarkCase.id,
    title: benchmarkCase.title,
    tier: benchmarkCase.tier,
    status: 'passed',
    durationMs: 1,
    metrics: [],
    hardRuleViolations: [],
    thresholdBreaches: [],
    evidence: [{ summary: `${benchmarkCase.id} catalog contract executed` }]
  }
}

function skippedResult(benchmarkCase: BenchmarkCase, reason: string): BenchmarkCaseResult {
  return {
    id: benchmarkCase.id,
    title: benchmarkCase.title,
    tier: benchmarkCase.tier,
    status: 'skipped_with_reason',
    durationMs: 0,
    metrics: [],
    hardRuleViolations: [],
    thresholdBreaches: [],
    evidence: [{ summary: reason }],
    skippedReason: reason
  }
}

async function fileHash(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function packageMetadata(): Promise<{ name: string; version: string }> {
  const parsed = JSON.parse(await readFile('package.json', 'utf8')) as { name?: string; version?: string }
  return { name: parsed.name ?? 'unknown', version: parsed.version ?? '0.0.0' }
}

async function gitMetadata(): Promise<BenchmarkReport['git']> {
  const [branch, commit, status] = await Promise.all([
    git(['branch', '--show-current']),
    git(['rev-parse', 'HEAD']),
    git(['status', '--short'])
  ])
  return {
    branch: branch.trim() || 'unknown',
    commit: commit.trim(),
    dirty: status.trim() !== '',
    trackedChanges: status.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  }
}

async function npmVersion(): Promise<string | undefined> {
  try {
    return (await execFileAsync('npm', ['--version'])).stdout.trim()
  } catch {
    return undefined
  }
}

async function git(args: string[]): Promise<string> {
  try {
    return (await execFileAsync('git', args)).stdout
  } catch {
    return ''
  }
}
```

This skeleton intentionally runs catalog contract cases only. Task 5 through Task 9 replace `runRunnableCase` with dispatch to concrete case packs.

- [ ] **Step 5: Implement Codex wrapper**

Create `src/codex/codex-benchmark.ts`:

```ts
import { join } from 'node:path'
import { runCyreneBenchmark } from '../../benchmark/runner.js'
import type { BenchmarkProfile } from '../../benchmark/types.js'

export interface CodexBenchmarkRunResult {
  profile: BenchmarkProfile
  passed: boolean
  summary: {
    totalCases: number
    passed: number
    failed: number
    skippedWithReason: number
    notSupportedWithoutProvider: number
  }
  reportPaths: {
    jsonPath: string
    markdownPath: string
  }
}

export async function runCodexBenchmark(input: {
  cwd: string
  profile: BenchmarkProfile
  outputDir?: string
  baselineReportPath?: string
  preserveFixtures?: boolean
}): Promise<CodexBenchmarkRunResult> {
  const outputDir = input.outputDir ?? join(input.cwd, 'benchmark-results')
  const report = await runCyreneBenchmark({
    cwd: input.cwd,
    profile: input.profile,
    outputDir,
    baselineReportPath: input.baselineReportPath,
    preserveFixtures: input.preserveFixtures
  })
  return {
    profile: report.profile,
    passed: report.passed,
    summary: report.summary,
    reportPaths: {
      jsonPath: join(outputDir, 'benchmark_report.json'),
      markdownPath: join(outputDir, 'benchmark_report.md')
    }
  }
}
```

- [ ] **Step 6: Modify CLI**

In `src/codex/codex-cli.ts`, import:

```ts
import { runCodexBenchmark } from './codex-benchmark.js'
import type { BenchmarkProfile } from '../../benchmark/types.js'
```

Add this branch before existing `eval run` branches:

```ts
if (command === 'benchmark' && input.args[1] === 'run') {
  process.stdout.write(`${JSON.stringify(await runCodexBenchmark({
    cwd: input.cwd,
    profile: parseBenchmarkProfile(input.args),
    outputDir: parseOptionalOption(input.args, '--output-dir'),
    baselineReportPath: parseOptionalOption(input.args, '--baseline'),
    preserveFixtures: input.args.includes('--preserve-fixtures')
  }), null, 2)}\n`)
  return
}
```

Add parser near other parser helpers:

```ts
function parseBenchmarkProfile(args: string[]): BenchmarkProfile {
  const value = parseRequiredOption(args, '--profile', 'benchmark profile')
  if (value === 'smoke' || value === 'gate' || value === 'full' || value === 'scale' || value === 'llm' || value === 'external') {
    return value
  }
  throw new Error(`Invalid benchmark profile: ${value}. Expected smoke, gate, full, scale, llm, or external`)
}
```

Extend usage string to include:

```text
benchmark run --profile smoke|gate|full|scale|llm|external [--output-dir <path>] [--baseline <path>] [--preserve-fixtures]
```

- [ ] **Step 7: Run GREEN verification**

Run:

```bash
npm test -- tests/benchmark-runner.test.ts tests/benchmark-cli.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add benchmark/runner.ts src/codex/codex-benchmark.ts src/codex/codex-cli.ts tests/benchmark-runner.test.ts tests/benchmark-cli.test.ts
git commit -m "feat: add benchmark runner cli"
```

## Task 5: Smoke And Gate Case Implementations

**Files:**
- Create: `benchmark/cases/common.ts`
- Create: `benchmark/cases/tier0-release-gate.ts`
- Create: `benchmark/cases/tier1-6-core-mechanisms.ts`
- Modify: `benchmark/runner.ts`
- Create: `tests/benchmark-cases-tier0.test.ts`

- [ ] **Step 1: Write failing Tier 0 smoke/gate tests**

Create `tests/benchmark-cases-tier0.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCyreneBenchmark } from '../benchmark/runner.js'

const tempDirs: string[] = []
const originalHome = process.env.HOME

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function outputDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-benchmark-tier0-'))
  tempDirs.push(dir)
  return dir
}

describe('benchmark Tier 0 cases', () => {
  it('runs smoke cases with real assertions instead of catalog-only evidence', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'smoke',
      outputDir: await outputDir(),
      seed: 'smoke-real',
      now: '2026-06-05T00:00:00.000Z'
    })

    const fast = report.caseResults.find((item) => item.id === 'T0-MODE-FAST')
    expect(fast?.status).toBe('passed')
    expect(fast?.evidence.map((item) => item.summary).join('\n')).toContain('mode=fast')
    expect(fast?.hardRuleViolations).toEqual([])

    const pending = report.caseResults.find((item) => item.id === 'T0-PENDING-BOUNDARY')
    expect(pending?.evidence.map((item) => item.summary).join('\n')).toContain('pending leakage=0')
  })

  it('runs gate cases for review hash, security, routing, and hooks', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'gate',
      outputDir: await outputDir(),
      seed: 'gate-real',
      now: '2026-06-05T00:00:00.000Z'
    })

    expect(report.passed).toBe(true)
    expect(report.caseResults.find((item) => item.id === 'T16-REVIEW-HASH-REQUIRED')?.status).toBe('passed')
    expect(report.caseResults.find((item) => item.id === 'T4-SECURITY-SECRETS')?.status).toBe('passed')
    expect(report.caseResults.find((item) => item.id === 'T4-HOOK-LIGHTWEIGHT')?.status).toBe('passed')
  })
})
```

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/benchmark-cases-tier0.test.ts
```

Expected: FAIL because runner still returns catalog-only evidence.

- [ ] **Step 3: Implement common case helpers**

Create `benchmark/cases/common.ts`:

```ts
import type { BenchmarkCase, BenchmarkCaseResult, BenchmarkMetricValue } from '../types.js'

export async function timedCase(
  benchmarkCase: BenchmarkCase,
  fn: () => Promise<{
    metrics?: BenchmarkMetricValue[]
    hardRuleViolations?: string[]
    evidence: BenchmarkCaseResult['evidence']
  }>
): Promise<BenchmarkCaseResult> {
  const startedAt = Date.now()
  try {
    const result = await fn()
    return {
      id: benchmarkCase.id,
      title: benchmarkCase.title,
      tier: benchmarkCase.tier,
      status: result.hardRuleViolations?.length ? 'failed' : 'passed',
      durationMs: Date.now() - startedAt,
      metrics: result.metrics ?? [],
      hardRuleViolations: result.hardRuleViolations ?? [],
      thresholdBreaches: [],
      evidence: result.evidence
    }
  } catch (error) {
    return {
      id: benchmarkCase.id,
      title: benchmarkCase.title,
      tier: benchmarkCase.tier,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      metrics: [],
      hardRuleViolations: ['case_exception'],
      thresholdBreaches: [],
      evidence: [{ summary: error instanceof Error ? error.message : String(error) }]
    }
  }
}

export function containsForbidden(value: unknown, forbidden: string[]): string[] {
  const text = JSON.stringify(value)
  return forbidden.filter((item) => text.includes(item))
}
```

- [ ] **Step 4: Implement Tier 0 case pack**

Create `benchmark/cases/tier0-release-gate.ts` with handlers for:

- `T0-MODE-FAST`
- `T0-MODE-BALANCED`
- `T0-MODE-REVIEW`
- `T0-PENDING-BOUNDARY`
- `T0-SIMILAR-BOUNDARY`
- `T0-SESSION-HINTS`
- `T0-ACTIVATION-RETRIEVED`
- `T0-SQLITE-HOT-PATH`
- `T0-SURFACE-CONSISTENCY`

Use this pattern:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { rebuildCodexMemoryIndex } from '../../src/codex/codex-memory-index.js'
import { getCodexContinuityContext } from '../../src/codex/continuity-context.js'
import { writeFastSummaryProjection } from '../../src/codex/fast-summary-store.js'
import { reviewHashForPendingMemory } from '../../src/codex/memory-review.js'
import { readActivationEventsFromRoot, writePendingMemoriesFromRoot } from '../../src/memory/memory-store.js'
import { createBenchmarkFixture, withFixtureEnvironment } from '../fixtures.js'
import type { BenchmarkCase, BenchmarkCaseResult, BenchmarkRunOptions } from '../types.js'
import { timedCase } from './common.js'

export async function runTier0Case(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult | undefined> {
  if (benchmarkCase.id === 'T0-MODE-FAST') return runFastMode(benchmarkCase, options)
  if (benchmarkCase.id === 'T0-PENDING-BOUNDARY') return runPendingBoundary(benchmarkCase, options)
  if (benchmarkCase.id === 'T0-SQLITE-HOT-PATH') return runSqliteHotPath(benchmarkCase, options)
  return undefined
}

async function runFastMode(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult> {
  return timedCase(benchmarkCase, async () => {
    const fixture = await createBenchmarkFixture({
      caseId: benchmarkCase.id,
      seed: options.seed ?? benchmarkCase.fixture.seed,
      now: options.now ?? benchmarkCase.fixture.now,
      activeMemories: [{ id: 'fast-active', content: 'Fast mode active memory stays visible.' }],
      pendingMemories: [{ id: 'fast-pending', content: 'Fast mode forbidden pending content.' }],
      globalProfile: '# Global Profile\nFull global profile forbidden content.\n',
      projectProfile: '# Project Profile\nFull project profile forbidden content.\n',
      fastSummary: 'Fast profile summary visible.',
      preserveFixture: options.preserveFixtures
    })
    try {
      return await withFixtureEnvironment(fixture, async () => {
        await rebuildCodexMemoryIndex({ cwd: fixture.cwd })
        const context = await getCodexContinuityContext({
          cwd: fixture.cwd,
          userMessage: 'Fast mode active memory',
          task: 'coding'
        })
        const text = JSON.stringify(context)
        const violations = [
          ...(context.diagnostics === undefined ? [] : ['forbidden_context_injection']),
          ...(context.similarProjectHints.length === 0 ? [] : ['cross_project_pollution']),
          ...(text.includes('Fast mode forbidden pending content') ? ['pending_leakage'] : []),
          ...(text.includes('Full global profile forbidden content') || text.includes('Full project profile forbidden content') ? ['forbidden_context_injection'] : [])
        ]
        const events = await readActivationEventsFromRoot(fixture.projectMemoryRoot)
        if (events.some((event) => event.event === 'retrieved')) violations.push('retrieved_default_write')
        return {
          metrics: [
            { metric: 'fastTokenOverhead', value: JSON.stringify(context).length / 4 },
            { metric: 'jsonlFallbackRateHotPath', value: context.diagnostics?.memoryIndex?.source === 'jsonl' ? 1 : 0 }
          ],
          hardRuleViolations: violations,
          evidence: [{ summary: `mode=${context.diagnostics?.contextPolicy?.mode ?? context.profile.content.includes('Fast profile summary visible.') ? 'fast' : 'unknown'}` }]
        }
      })
    } finally {
      await fixture.cleanup()
    }
  })
}
```

Fix the evidence expression in the snippet while implementing:

```ts
const modeEvidence = context.profile.content.includes('Fast profile summary visible.') ? 'mode=fast' : 'mode=unknown'
```

Implement the other Tier 0 functions similarly:

- `runPendingBoundary`: assert fast/balanced exclude pending and review contains pending only in pending route.
- `runSqliteHotPath`: seed active memory, rebuild index, call context with diagnostics, assert `memoryIndex.source === 'sqlite'` and `fallbackMode === 'sqlite'`.
- `T0-MODE-BALANCED`: assert full profile content visible and pending content hidden.
- `T0-MODE-REVIEW`: assert pending details visible but not in `memory.items`.
- `T0-SIMILAR-BOUNDARY`: seed other project similar memory and assert `notCurrentProjectFact`.
- `T0-SESSION-HINTS`: seed session hints and assert no active memory migration.
- `T0-ACTIVATION-RETRIEVED`: assert no retrieved event by default.
- `T0-SURFACE-CONSISTENCY`: compare source strings in CLI/MCP/Skill docs against runtime mode flags.

- [ ] **Step 5: Implement Tier 1.6 gate case pack**

Create `benchmark/cases/tier1-6-core-mechanisms.ts` with handlers for:

- `T16-PROPOSE-IMPORTANT`
- `T16-PROPOSE-NOISE`
- `T16-PROPOSE-SENSITIVE`
- `T16-PROPOSE-ASSISTANT-INFERENCE`
- `T16-ROUTING-NAMESPACE`
- `T16-REVIEW-HASH-REQUIRED`
- `T16-REVIEW-STALE-HASH`
- `T16-REVIEW-REJECT-DEFER`
- `T16-REVIEW-EDIT-HASH`

Use existing helpers:

```ts
import { proposeCodexMemoryCandidate } from '../../src/codex/memory-propose.js'
import { editCodexPendingMemory, promoteCodexPendingMemory, rejectCodexPendingMemory, deferCodexPendingMemory, reviewHashForPendingMemory } from '../../src/codex/memory-review.js'
```

Each handler must return hard violations for the rule in its case id. For example, `T16-REVIEW-HASH-REQUIRED`:

```ts
const withoutHash = await promoteCodexPendingMemory({ cwd: fixture.cwd, id: candidate.id, reviewHash: '', reason: 'benchmark' })
const withHash = await promoteCodexPendingMemory({ cwd: fixture.cwd, id: candidate.id, reviewHash: reviewHashForPendingMemory(candidate), reason: 'benchmark' })
const violations = [
  ...(withoutHash.result.action === 'promote' ? ['hash_bypass'] : []),
  ...(withHash.result.action === 'promote' ? [] : ['hash_required_valid_path_failed'])
]
```

- [ ] **Step 6: Wire case packs into runner**

Modify `benchmark/runner.ts`:

```ts
import { runTier0Case } from './cases/tier0-release-gate.js'
import { runTier16Case } from './cases/tier1-6-core-mechanisms.js'

async function runRunnableCase(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult> {
  const tier0 = await runTier0Case(benchmarkCase, options)
  if (tier0 !== undefined) return tier0
  const tier16 = await runTier16Case(benchmarkCase, options)
  if (tier16 !== undefined) return tier16
  return {
    id: benchmarkCase.id,
    title: benchmarkCase.title,
    tier: benchmarkCase.tier,
    status: benchmarkCase.adapter?.kind === 'llm' || benchmarkCase.adapter?.kind === 'external'
      ? 'not_supported_without_provider'
      : 'skipped_with_reason',
    durationMs: 0,
    metrics: [],
    hardRuleViolations: [],
    thresholdBreaches: [],
    evidence: [{ summary: 'case pack not selected for this profile or provider is not configured' }],
    skippedReason: 'case pack not selected for this profile or provider is not configured'
  }
}
```

- [ ] **Step 7: Run GREEN verification**

Run:

```bash
npm test -- tests/benchmark-cases-tier0.test.ts tests/benchmark-runner.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add benchmark/cases/common.ts benchmark/cases/tier0-release-gate.ts benchmark/cases/tier1-6-core-mechanisms.ts benchmark/runner.ts tests/benchmark-cases-tier0.test.ts
git commit -m "feat: add smoke gate benchmark cases"
```

## Task 6: Lifecycle And Replacement Cases

**Files:**
- Create: `benchmark/cases/tier1-5-lifecycle.ts`
- Modify: `benchmark/runner.ts`
- Create or modify: `tests/benchmark-cases-core.test.ts`

- [ ] **Step 1: Add failing lifecycle tests**

Append to `tests/benchmark-cases-core.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCyreneBenchmark } from '../benchmark/runner.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function outputDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-benchmark-core-'))
  tempDirs.push(dir)
  return dir
}

describe('benchmark lifecycle cases', () => {
  it('runs lifecycle and replacement cases in full profile', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'full',
      outputDir: await outputDir(),
      seed: 'lifecycle-full',
      now: '2026-06-05T00:00:00.000Z'
    })

    for (const id of ['T15-UPGRADE', 'T15-REPLACE', 'T15-MERGE', 'T15-EXPIRE', 'T15-SUPERSEDE-HASH', 'T15-CONFLICT-SINGLE-INJECTION']) {
      const result = report.caseResults.find((item) => item.id === id)
      expect(result?.status).toBe('passed')
      expect(result?.evidence.map((item) => item.summary).join('\n')).not.toContain('case pack not selected')
    }
  })
})
```

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/benchmark-cases-core.test.ts
```

Expected: FAIL because lifecycle case pack is not wired.

- [ ] **Step 3: Implement lifecycle case pack**

Create `benchmark/cases/tier1-5-lifecycle.ts`. Use direct helpers:

- `runCodexMemoryLifecycleDaily`
- `runCodexMemoryLifecycleWeekly`
- `runCodexMemoryPrepare`
- `runCodexMemoryDistill`
- `runCodexMemoryActiveSupersede`
- `writeSemanticMemoriesFromRoot`
- `writePendingMemoriesFromRoot`

Implement handlers:

```ts
export async function runTier15Case(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult | undefined> {
  if (benchmarkCase.id === 'T15-UPGRADE') return runUpgrade(benchmarkCase, options)
  if (benchmarkCase.id === 'T15-REPLACE') return runReplace(benchmarkCase, options)
  if (benchmarkCase.id === 'T15-MERGE') return runMerge(benchmarkCase, options)
  if (benchmarkCase.id === 'T15-EXPIRE') return runExpire(benchmarkCase, options)
  if (benchmarkCase.id === 'T15-SUPERSEDE-HASH') return runSupersedeHash(benchmarkCase, options)
  if (benchmarkCase.id === 'T15-CONFLICT-SINGLE-INJECTION') return runConflictSingleInjection(benchmarkCase, options)
  return undefined
}
```

Required assertions:

- `T15-UPGRADE`: low-risk trial can promote via daily/weekly, high-risk/personal cannot. Hard violation: `unauthorized_promotion`.
- `T15-REPLACE`: superseded memory not returned by context after replacement.
- `T15-MERGE`: duplicate pending inputs produce one recommendation or no duplicate active output. Hard violation: `duplicate_context_injection`.
- `T15-EXPIRE`: expired active memory excluded from ordinary context. Hard violation: `forbidden_context_injection`.
- `T15-SUPERSEDE-HASH`: stale hash cannot supersede. Hard violation: `hash_bypass` or `stale_approval_success`.
- `T15-CONFLICT-SINGLE-INJECTION`: conflicting memories do not both enter context. Hard violation: `conflicting_context_injection`.

- [ ] **Step 4: Wire lifecycle pack into runner**

Modify `benchmark/runner.ts`:

```ts
import { runTier15Case } from './cases/tier1-5-lifecycle.js'

const tier15 = await runTier15Case(benchmarkCase, options)
if (tier15 !== undefined) return tier15
```

- [ ] **Step 5: Run GREEN verification**

Run:

```bash
npm test -- tests/benchmark-cases-core.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add benchmark/cases/tier1-5-lifecycle.ts benchmark/runner.ts tests/benchmark-cases-core.test.ts
git commit -m "feat: add lifecycle benchmark cases"
```

## Task 7: Memory Ability And Memory-to-Action Replay Cases

**Files:**
- Create: `benchmark/cases/tier1-memory-ability.ts`
- Create: `benchmark/cases/tier2-memory-to-action.ts`
- Modify: `benchmark/runner.ts`
- Modify: `tests/benchmark-cases-core.test.ts`

- [ ] **Step 1: Add failing ability/action replay tests**

Append to `tests/benchmark-cases-core.test.ts`:

```ts
describe('benchmark ability and action replay cases', () => {
  it('runs Tier 1 and Tier 2 deterministic replay cases in full profile', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'full',
      outputDir: await outputDir(),
      seed: 'ability-action-full',
      now: '2026-06-05T00:00:00.000Z'
    })

    for (const id of [
      'T1-FACT-EXTRACTION',
      'T1-MULTI-SESSION-REASONING',
      'T1-TEMPORAL-ORDER',
      'T1-KNOWLEDGE-UPDATE',
      'T1-CONFLICT-HANDLING',
      'T1-ABSTAIN-NO-EVIDENCE',
      'T1-EVENT-SUMMARY',
      'T2-REMEMBER-TEST-COMMAND',
      'T2-AVOID-REJECTED-APPROACH',
      'T2-FOLLOW-WORKFLOW',
      'T2-UPDATED-RULE',
      'T2-CROSS-SESSION-FIX',
      'T2-REDUCE-REPEAT-MISTAKE'
    ]) {
      expect(report.caseResults.find((item) => item.id === id)?.status).toBe('passed')
    }
  })
})
```

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/benchmark-cases-core.test.ts
```

Expected: FAIL because Tier 1/Tier 2 packs are not wired.

- [ ] **Step 3: Implement Tier 1 deterministic QA cases**

Create `benchmark/cases/tier1-memory-ability.ts` with deterministic fixtures:

- Use arrays of session events and ground-truth answers.
- Score exact answer evidence without calling an LLM.
- Use `getCodexContinuityContext` for retrieval-sensitive cases.

Export:

```ts
export async function runTier1Case(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult | undefined>
```

Required behavior:

- `T1-FACT-EXTRACTION`: answer includes stored test command.
- `T1-MULTI-SESSION-REASONING`: answer includes rejected reason and later decision.
- `T1-TEMPORAL-ORDER`: newest rule wins.
- `T1-KNOWLEDGE-UPDATE`: superseded old rule excluded.
- `T1-CONFLICT-HANDLING`: conflict returns one selected rule or abstain.
- `T1-ABSTAIN-NO-EVIDENCE`: no fabricated answer.
- `T1-EVENT-SUMMARY`: summary contains decision, failure, fix, verification.

- [ ] **Step 4: Implement Tier 2 deterministic replay cases**

Create `benchmark/cases/tier2-memory-to-action.ts`:

- Use deterministic action replay objects, not real agent execution.
- Compare `withMemory` vs `noMemory` fixture outputs.
- Mark real provider variants as `not_supported_without_provider` when profile is `llm` and no adapter is configured.

Export:

```ts
export async function runTier2Case(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult | undefined>
```

Required behavior:

- `T2-REMEMBER-TEST-COMMAND`: with-memory replay uses stored command.
- `T2-AVOID-REJECTED-APPROACH`: with-memory replay avoids rejected approach.
- `T2-FOLLOW-WORKFLOW`: with-memory replay includes required workflow steps.
- `T2-UPDATED-RULE`: with-memory replay uses new rule.
- `T2-CROSS-SESSION-FIX`: with-memory replay skips repeated failed investigation.
- `T2-REDUCE-REPEAT-MISTAKE`: metrics include lower tool calls and corrections.

- [ ] **Step 5: Wire Tier 1/Tier 2 packs into runner**

Modify `benchmark/runner.ts`:

```ts
import { runTier1Case } from './cases/tier1-memory-ability.js'
import { runTier2Case } from './cases/tier2-memory-to-action.js'

const tier1 = await runTier1Case(benchmarkCase, options)
if (tier1 !== undefined) return tier1
const tier2 = await runTier2Case(benchmarkCase, options)
if (tier2 !== undefined) return tier2
```

- [ ] **Step 6: Run GREEN verification**

Run:

```bash
npm test -- tests/benchmark-cases-core.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

```bash
git add benchmark/cases/tier1-memory-ability.ts benchmark/cases/tier2-memory-to-action.ts benchmark/runner.ts tests/benchmark-cases-core.test.ts
git commit -m "feat: add memory ability action benchmark cases"
```

## Task 8: Retrieval Ranking And Scale Cases

**Files:**
- Create: `benchmark/cases/tier3-scale-efficiency.ts`
- Modify: `benchmark/runner.ts`
- Create: `tests/benchmark-cases-scale.test.ts`

- [ ] **Step 1: Write failing scale tests**

Create `tests/benchmark-cases-scale.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCyreneBenchmark } from '../benchmark/runner.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function outputDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cyrene-benchmark-scale-'))
  tempDirs.push(dir)
  return dir
}

describe('benchmark scale cases', () => {
  it('runs scale profile and records ranking/index metrics', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'scale',
      outputDir: await outputDir(),
      seed: 'scale-seed',
      now: '2026-06-05T00:00:00.000Z'
    })

    for (const id of ['T3-S-SCALE', 'T3-M-SCALE', 'T3-L-SCALE', 'T3-XL-SCALE', 'T3-RANKING', 'T3-TOKEN-OVERHEAD', 'T3-LATENCY', 'T3-INDEX-HEALTH']) {
      expect(report.caseResults.find((item) => item.id === id)?.status).toBe('passed')
    }
    expect(report.caseResults.find((item) => item.id === 'T3-RANKING')?.metrics.map((item) => item.metric)).toContain('recallAt3')
  })
})
```

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/benchmark-cases-scale.test.ts
```

Expected: FAIL because scale case pack is not wired.

- [ ] **Step 3: Implement scale/ranking pack**

Create `benchmark/cases/tier3-scale-efficiency.ts`:

- Use deterministic generator based on `seededId(seed, label)`.
- For S/M/L/XL, do not create unbounded data in unit tests. Use profile-aware caps for test env by reading `process.env.VITEST`.
- Still record target sizes in evidence.
- Use `openMemoryIndexAdapter` for direct ranking checks.

Export:

```ts
export async function runTier3Case(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult | undefined>
```

Required metrics:

- `scaleSRuntimeMs`, `scaleMRuntimeMs`, `scaleLRuntimeMs`, `scaleXLRuntimeMs`
- `recallAt3`
- `mrr`
- `wrongTop1Rate`
- `irrelevantRetrievalRate`
- `memoryDbBytesPerMemory`
- `sqliteHitRateFreshIndex`
- `jsonlFallbackRateHotPath`

- [ ] **Step 4: Wire Tier 3 pack into runner**

Modify `benchmark/runner.ts`:

```ts
import { runTier3Case } from './cases/tier3-scale-efficiency.js'

const tier3 = await runTier3Case(benchmarkCase, options)
if (tier3 !== undefined) return tier3
```

- [ ] **Step 5: Run GREEN verification**

Run:

```bash
npm test -- tests/benchmark-cases-scale.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 8**

```bash
git add benchmark/cases/tier3-scale-efficiency.ts benchmark/runner.ts tests/benchmark-cases-scale.test.ts
git commit -m "feat: add scale ranking benchmark cases"
```

## Task 9: Failure Recovery, Security, Hook, And Adapter Cases

**Files:**
- Create: `benchmark/cases/tier4-failure-security.ts`
- Modify: `benchmark/cases/tier2-memory-to-action.ts`
- Modify: `benchmark/runner.ts`
- Modify: `tests/benchmark-cases-core.test.ts`

- [ ] **Step 1: Add failing failure/security/adapter tests**

Append to `tests/benchmark-cases-core.test.ts`:

```ts
describe('benchmark failure security and adapter cases', () => {
  it('runs Tier 4 deterministic failure/security cases in full profile', async () => {
    const report = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'full',
      outputDir: await outputDir(),
      seed: 'tier4-full',
      now: '2026-06-05T00:00:00.000Z'
    })

    for (const id of [
      'T4-SQLITE-UNAVAILABLE',
      'T4-JSONL-CORRUPT',
      'T4-PROFILE-MISSING',
      'T4-FAST-SUMMARY-MISSING-STALE',
      'T4-SESSION-HINTS-EXPIRED',
      'T4-MCP-ERROR',
      'T4-AUTOMATION-INTERRUPT',
      'T4-HOOK-LIGHTWEIGHT',
      'T4-HOOK-TIMEOUT',
      'T4-SECURITY-SECRETS',
      'T4-SECURITY-PROMPT-INJECTION',
      'T4-SECURITY-GLOBAL-WRITE'
    ]) {
      expect(report.caseResults.find((item) => item.id === id)?.status).toBe('passed')
    }
  })

  it('marks llm and external adapter cases unsupported without provider', async () => {
    const llm = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'llm',
      outputDir: await outputDir(),
      seed: 'llm-no-provider',
      now: '2026-06-05T00:00:00.000Z'
    })
    expect(llm.caseResults.some((item) => item.status === 'not_supported_without_provider')).toBe(true)

    const external = await runCyreneBenchmark({
      cwd: process.cwd(),
      profile: 'external',
      outputDir: await outputDir(),
      seed: 'external-no-provider',
      now: '2026-06-05T00:00:00.000Z'
    })
    expect(external.caseResults.some((item) => item.status === 'not_supported_without_provider')).toBe(true)
  })
})
```

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/benchmark-cases-core.test.ts
```

Expected: FAIL because Tier 4 pack and adapter handling are incomplete.

- [ ] **Step 3: Implement Tier 4 pack**

Create `benchmark/cases/tier4-failure-security.ts`:

Export:

```ts
export async function runTier4Case(benchmarkCase: BenchmarkCase, options: BenchmarkRunOptions): Promise<BenchmarkCaseResult | undefined>
```

Required assertions:

- `T4-SQLITE-UNAVAILABLE`: missing/corrupt SQLite returns degraded diagnostics, no crash.
- `T4-JSONL-CORRUPT`: malformed JSONL does not enter context.
- `T4-PROFILE-MISSING`: balanced context does not invent profile.
- `T4-FAST-SUMMARY-MISSING-STALE`: fast context does not generate summary on hot path.
- `T4-SESSION-HINTS-EXPIRED`: expired hints ignored.
- `T4-MCP-ERROR`: simulated handler error writes no memory.
- `T4-AUTOMATION-INTERRUPT`: repeated automation does not duplicate output.
- `T4-HOOK-LIGHTWEIGHT`: `session-start`, `user-prompt-submit`, `post-tool-use` hook commands do not inspect pending/similar.
- `T4-HOOK-TIMEOUT`: simulated timeout fail-open evidence.
- `T4-SECURITY-SECRETS`: secret-like candidates filtered.
- `T4-SECURITY-PROMPT-INJECTION`: malicious repo content does not write global rule.
- `T4-SECURITY-GLOBAL-WRITE`: project harvest does not write unauthorized global memory.

- [ ] **Step 4: Implement adapter unsupported handling**

In `benchmark/runner.ts`, before direct case dispatch:

```ts
if ((options.profile === 'llm' || options.profile === 'external') && benchmarkCase.adapter !== undefined) {
  const missingEnv = benchmarkCase.adapter.requiredEnv?.filter((name) => process.env[name] === undefined || process.env[name] === '') ?? []
  if (missingEnv.length > 0) {
    return {
      id: benchmarkCase.id,
      title: benchmarkCase.title,
      tier: benchmarkCase.tier,
      status: 'not_supported_without_provider',
      durationMs: 0,
      metrics: [],
      hardRuleViolations: [],
      thresholdBreaches: [],
      evidence: [{ summary: `missing provider env: ${missingEnv.join(', ')}` }],
      skippedReason: `missing provider env: ${missingEnv.join(', ')}`
    }
  }
}
```

Ensure at least one `llm` case and one `external` case in `benchmark/catalog.ts` has `requiredEnv`, e.g.:

```ts
adapter: { kind: 'llm', provider: 'generic-agent', requiredEnv: ['CYRENE_BENCHMARK_LLM_PROVIDER'], supportsDeterministicReplay: true }
```

and:

```ts
adapter: { kind: 'external', provider: 'mem0', requiredEnv: ['CYRENE_BENCHMARK_MEM0_PROVIDER'], supportsDeterministicReplay: false }
```

- [ ] **Step 5: Wire Tier 4 pack into runner**

Modify `benchmark/runner.ts`:

```ts
import { runTier4Case } from './cases/tier4-failure-security.js'

const tier4 = await runTier4Case(benchmarkCase, options)
if (tier4 !== undefined) return tier4
```

- [ ] **Step 6: Run GREEN verification**

Run:

```bash
npm test -- tests/benchmark-cases-core.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 9**

```bash
git add benchmark/cases/tier4-failure-security.ts benchmark/cases/tier2-memory-to-action.ts benchmark/catalog.ts benchmark/runner.ts tests/benchmark-cases-core.test.ts
git commit -m "feat: add failure security adapter benchmark cases"
```

## Task 10: Final Integration, CI Contract, Build Validation

**Files:**
- Modify: `README.md`
- Modify: `plugin/skills/cyrene-continuity/SKILL.md`
- Modify: `tests/plugin-runtime.test.ts` if plugin runtime text assertion needs update
- Modify: `tests/codex-cli.test.ts` usage assertion if needed

- [ ] **Step 1: Add docs for benchmark command**

In `README.md`, add a concise section:

```md
## Benchmark Eval

Run the Cyrene benchmark profiles:

```bash
cyrene-continuity codex benchmark run --profile smoke
cyrene-continuity codex benchmark run --profile gate
cyrene-continuity codex benchmark run --profile full
cyrene-continuity codex benchmark run --profile scale
cyrene-continuity codex benchmark run --profile llm
cyrene-continuity codex benchmark run --profile external
```

Every run writes `benchmark_report.json` and `benchmark_report.md`. Reports include spec hash, benchmark version, threshold version, package version, git branch/commit/dirty status, runtime metadata, case results, hard rule failures, soft threshold breaches, and skipped/unsupported cases.
```

- [ ] **Step 2: Add Skill benchmark note**

In `plugin/skills/cyrene-continuity/SKILL.md`, add one short rule near required behavior:

```md
29. Use `cyrene-continuity codex benchmark run --profile smoke` for a quick benchmark sanity check and `--profile gate` for release gate validation when benchmark behavior changes. Benchmark fixtures must remain isolated from real user memory.
```

Keep numbering consistent with the file.

- [ ] **Step 3: Rebuild plugin runtime**

Run:

```bash
npm run build:plugin
```

Expected: succeeds and updates `plugin/runtime/cyrene-continuity.mjs`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/benchmark-types.test.ts tests/benchmark-fixtures.test.ts tests/benchmark-report.test.ts tests/benchmark-runner.test.ts tests/benchmark-cases-tier0.test.ts tests/benchmark-cases-core.test.ts tests/benchmark-cases-scale.test.ts tests/benchmark-cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run smoke and gate benchmark commands**

Run:

```bash
npm run dev -- codex benchmark run --profile smoke --output-dir /tmp/cyrene-benchmark-smoke
npm run dev -- codex benchmark run --profile gate --output-dir /tmp/cyrene-benchmark-gate
```

Expected:

- Both commands exit 0.
- Both print JSON with `"passed": true`.
- `/tmp/cyrene-benchmark-smoke/benchmark_report.json` exists.
- `/tmp/cyrene-benchmark-gate/benchmark_report.md` exists.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm test
npm run typecheck
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: all pass.

- [ ] **Step 7: Check diff hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected:

- `git diff --check` produces no output.
- `git status --short` shows only files intentionally changed by this benchmark implementation and pre-existing unrelated dirty files are not reverted.

- [ ] **Step 8: Commit Task 10**

```bash
git add benchmark src/codex/codex-benchmark.ts src/codex/codex-cli.ts README.md plugin/skills/cyrene-continuity/SKILL.md tests/benchmark-*.test.ts tests/codex-cli.test.ts tests/plugin-runtime.test.ts
if git diff --name-only | rg -q '^plugin/runtime/cyrene-continuity\.mjs$'; then git add plugin/runtime/cyrene-continuity.mjs; fi
git commit -m "feat: add cyrene benchmark eval system"
```

## Plan Self-Review

- Spec coverage: The plan covers smoke/gate/full/scale/llm/external profiles, complete catalog visibility, fixture isolation, deterministic clock/seed, soft thresholds, hard gate rules, adapters, report metadata, CLI integration, case packs, docs, plugin build, and validation.
- Placeholder scan: No task contains incomplete-case language in code or instructions. Task 1 Step 5 contains a complete exported catalog array with every required ID.
- Type consistency: `BenchmarkProfile`, `BenchmarkCase`, `BenchmarkCaseResult`, `BenchmarkReport`, `BenchmarkAdapterSpec`, and threshold types are defined in Task 1 and reused by later tasks.
- Execution model: The plan explicitly assigns disjoint worker ownership and uses `superpowers:subagent-driven-development` for execution after this plan is saved.
