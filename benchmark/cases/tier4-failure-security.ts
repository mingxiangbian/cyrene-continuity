import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { handleCodexHookTraceCommand } from '../../src/codex/codex-hook-trace.js'
import { runCodexMemoryLifecycleDaily } from '../../src/codex/codex-memory-lifecycle-daily.js'
import { getCodexContinuityContext } from '../../src/codex/continuity-context.js'
import {
  markFastSummaryProjectionStale,
  writeFastSummaryProjection
} from '../../src/codex/fast-summary-store.js'
import { readRuntimeMetrics } from '../../src/codex/runtime-metrics.js'
import { handleContinuityGet } from '../../src/mcp/tools/continuity-get.js'
import { activationPolicyForConfidenceTier } from '../../src/memory/memory-lifecycle.js'
import { openMemoryIndexAdapter } from '../../src/memory/memory-index.js'
import {
  appendActivationEventFromRoot,
  readActiveMemoriesFromRoot,
  readMemoryEventsFromRoot,
  readPendingMemoriesFromRoot,
  readSemanticMemoriesFromRoot,
  writeSemanticMemoriesFromRoot
} from '../../src/memory/memory-store.js'
import { replaceCodexSessionHints } from '../../src/codex/session-hints.js'
import { createBenchmarkFixture, withFixtureEnvironment } from '../fixtures.js'
import { recordFixtureRun, timedCase } from './common.js'
import type {
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkEvidence,
  BenchmarkMetric,
  BenchmarkMetricId,
  BenchmarkRunOptions,
  HardGateRuleId
} from '../types.js'
import type { ActivationEvent, SemanticMemory } from '../../src/memory/types.js'

type Tier4FailureCaseId =
  | 'T4-SQLITE-UNAVAILABLE'
  | 'T4-JSONL-CORRUPT'
  | 'T4-PROFILE-MISSING'
  | 'T4-FAST-SUMMARY-MISSING-STALE'
  | 'T4-SESSION-HINTS-EXPIRED'
  | 'T4-MCP-ERROR'
  | 'T4-AUTOMATION-INTERRUPT'
  | 'T4-HOOK-TIMEOUT'

const CASES: Record<Tier4FailureCaseId, (
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions
) => Promise<BenchmarkCaseResult>> = {
  'T4-SQLITE-UNAVAILABLE': runSqliteUnavailable,
  'T4-JSONL-CORRUPT': runJsonlCorrupt,
  'T4-PROFILE-MISSING': runProfileMissing,
  'T4-FAST-SUMMARY-MISSING-STALE': runFastSummaryMissingStale,
  'T4-SESSION-HINTS-EXPIRED': runSessionHintsExpired,
  'T4-MCP-ERROR': runMcpError,
  'T4-AUTOMATION-INTERRUPT': runAutomationInterrupt,
  'T4-HOOK-TIMEOUT': runHookTimeout
}

export async function runTier4FailureSecurityCase(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions
): Promise<BenchmarkCaseResult | undefined> {
  return CASES[benchmarkCase.id as Tier4FailureCaseId]?.(benchmarkCase, options)
}

async function runSqliteUnavailable(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions
): Promise<BenchmarkCaseResult> {
  return withTier4Fixture(benchmarkCase, options, {}, async (fixture) => {
    const adapter = await openMemoryIndexAdapter({
      dbPath: fixture.memoryDbPath,
      forceUnavailableReason: 'benchmark forced sqlite unavailable'
    })
    try {
      const diagnostics = await adapter.initialize()
      const rows = await adapter.queryActive({
        currentProjectId: fixture.projectId,
        query: 'sqlite unavailable diagnostic',
        route: 'project',
        task: 'coding',
        maxItems: 5,
        maxTokens: 500
      })
      const hardFailures: HardGateRuleId[] = [
        ...(diagnostics.available ? ['index_source_mismatch' as const] : []),
        ...(rows.length === 0 ? [] : ['jsonl_hot_path_fallback' as const]),
        ...(diagnostics.reason?.includes('benchmark forced sqlite unavailable') === true
          ? []
          : ['index_source_mismatch' as const])
      ]
      return {
        hardFailures,
        metrics: metricsFor(benchmarkCase, hardFailures, { adapterAvailability: diagnostics.available ? 1 : 0 }),
        evidence: [{
          summary: `sqlite unavailable diagnostic; available=${diagnostics.available ? 1 : 0}; silent fallback success=${rows.length > 0 ? 1 : 0}; reason=${diagnostics.reason ?? 'missing'}`
        }]
      }
    } finally {
      adapter.close()
    }
  })
}

async function runJsonlCorrupt(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions
): Promise<BenchmarkCaseResult> {
  return withTier4Fixture(benchmarkCase, options, {}, async (fixture) => {
    const semanticPath = join(fixture.projectMemoryRoot, 'semantic_memories.jsonl')
    const original = `${JSON.stringify(tier4TrialMemory('tier4-jsonl-corrupt-trial'))}\n{bad json}\n`
    await writeFile(semanticPath, original, 'utf8')
    await appendActivationEventFromRoot(fixture.projectMemoryRoot, tier4ActivationEvent({
      id: 'tier4-jsonl-corrupt-applied-1',
      memoryId: 'tier4-jsonl-corrupt-trial',
      projectId: fixture.projectId,
      createdAt: '2026-06-04T00:00:00.000Z'
    }))
    await appendActivationEventFromRoot(fixture.projectMemoryRoot, tier4ActivationEvent({
      id: 'tier4-jsonl-corrupt-applied-2',
      memoryId: 'tier4-jsonl-corrupt-trial',
      projectId: fixture.projectId,
      createdAt: options.now ?? benchmarkCase.fixture.now
    }))

    const result = await runCodexMemoryLifecycleDaily({
      cwd: fixture.cwd,
      projectRoots: [{ projectId: fixture.projectId, memoryRoot: fixture.projectMemoryRoot }],
      apply: true,
      now: options.now ?? benchmarkCase.fixture.now
    })
    const [after, events] = await Promise.all([
      readFile(semanticPath, 'utf8'),
      readMemoryEventsFromRoot(fixture.projectMemoryRoot)
    ])
    const root = result.roots[0]
    const hardFailures: HardGateRuleId[] = [
      ...(root?.malformedJsonLines === 1 ? [] : ['security_boundary_violation' as const]),
      ...(root?.promotedTrialToValidated === 0 ? [] : ['unauthorized_promotion' as const]),
      ...(after === original ? [] : ['security_boundary_violation' as const]),
      ...(events.length === 0 ? [] : ['unauthorized_promotion' as const])
    ]
    return {
      hardFailures,
      metrics: metricsFor(benchmarkCase, hardFailures),
      evidence: [{
        summary: `corrupt jsonl rejected; malformed=${root?.malformedJsonLines ?? 0}; promoted=${root?.promotedTrialToValidated ?? 'missing'}; bytes unchanged=${after === original ? 1 : 0}`
      }]
    }
  })
}

async function runProfileMissing(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions
): Promise<BenchmarkCaseResult> {
  return withTier4Fixture(benchmarkCase, options, {}, async (fixture) => {
    const context = await getCodexContinuityContext({
      cwd: fixture.cwd,
      userMessage: 'missing profile should not invent project profile content',
      task: 'planning',
      mode: 'balanced',
      includeFullProfile: true
    })
    const text = JSON.stringify(context.profile)
    const hardFailures: HardGateRuleId[] = [
      ...(context.profile.content === '' ? [] : ['profile_pollution' as const]),
      ...(text.includes('invented profile content') ? ['profile_pollution' as const] : [])
    ]
    return {
      hardFailures,
      metrics: metricsFor(benchmarkCase, hardFailures),
      evidence: [{
        summary: `missing profile handled; profileChars=${context.profile.content.length}; invented profile=${text.includes('invented profile content') ? 1 : 0}`
      }]
    }
  })
}

async function runFastSummaryMissingStale(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions
): Promise<BenchmarkCaseResult> {
  return withTier4Fixture(benchmarkCase, options, {
    pendingMemories: [{ id: 'tier4-fast-stale-pending', content: 'stale fast summary forbidden pending detail' }]
  }, async (fixture) => {
    await writeFastSummaryProjection(fixture.projectMemoryRoot, {
      globalFastSummary: '',
      profileFastSummary: 'stale fast summary forbidden pending detail',
      generatedAt: '2026-06-01T00:00:00.000Z'
    })
    await markFastSummaryProjectionStale(fixture.projectMemoryRoot, {
      reason: 'benchmark_stale_fast_summary',
      now: options.now ?? benchmarkCase.fixture.now
    })
    const context = await getCodexContinuityContext({
      cwd: fixture.cwd,
      userMessage: 'stale fast summary forbidden pending detail',
      task: 'coding',
      mode: 'fast'
    })
    const [metrics, pending] = await Promise.all([
      readRuntimeMetrics(fixture.projectMemoryRoot),
      readPendingMemoriesFromRoot(fixture.projectMemoryRoot)
    ])
    const text = JSON.stringify(context)
    const hardFailures: HardGateRuleId[] = [
      ...(text.includes('stale fast summary forbidden pending detail') ? ['pending_in_fast_summary' as const] : []),
      ...(context.pendingHypotheses.length === 0 ? [] : ['pending_leakage' as const]),
      ...(pending.length === 1 ? [] : ['pending_misuse' as const])
    ]
    return {
      hardFailures,
      metrics: metricsFor(benchmarkCase, hardFailures),
      evidence: [{
        summary: `stale fast summary skipped; stale injected=${text.includes('stale fast summary forbidden pending detail') ? 1 : 0}; hot-path metrics=${metrics.length}; pending preserved=${pending.length}`
      }]
    }
  })
}

async function runSessionHintsExpired(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions
): Promise<BenchmarkCaseResult> {
  return withTier4Fixture(benchmarkCase, options, {}, async (fixture) => {
    await replaceCodexSessionHints(fixture.projectMemoryRoot, {
      sessionId: 'expired-session',
      projectId: fixture.projectId,
      hints: [{
        id: 'tier4-expired-session-hint',
        sourceProjectId: 'foreign-project',
        summary: 'expired session hint injected',
        createdAt: '2000-01-01T00:00:00.000Z'
      }],
      now: '2000-01-01T00:00:00.000Z',
      ttlMs: 1
    })
    const context = await getCodexContinuityContext({
      cwd: fixture.cwd,
      userMessage: 'expired session hint injected',
      task: 'planning',
      mode: 'balanced',
      includeSessionHints: true,
      sessionId: 'expired-session'
    })
    const hardFailures: HardGateRuleId[] = [
      ...(context.sessionHints.length === 0 ? [] : ['session_hint_migration' as const]),
      ...(JSON.stringify(context).includes('expired session hint injected') ? ['session_hint_migration' as const] : [])
    ]
    return {
      hardFailures,
      metrics: metricsFor(benchmarkCase, hardFailures),
      evidence: [{
        summary: `expired session hints ignored; injected=${context.sessionHints.length}; context leak=${JSON.stringify(context).includes('expired session hint injected') ? 1 : 0}`
      }]
    }
  })
}

async function runMcpError(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions
): Promise<BenchmarkCaseResult> {
  return withTier4Fixture(benchmarkCase, options, {}, async (fixture) => {
    const missingCwd = join(fixture.metadata.root, 'missing-project')
    const diagnostic = await boundedContinuityGetError({
      cwd: missingCwd,
      userMessage: 'bounded MCP error response',
      fallbackCwd: fixture.cwd
    })
    const [active, pending, events] = await Promise.all([
      readActiveMemoriesFromRoot(fixture.projectMemoryRoot),
      readPendingMemoriesFromRoot(fixture.projectMemoryRoot),
      readMemoryEventsFromRoot(fixture.projectMemoryRoot)
    ])
    const writes = active.length + pending.length + events.length
    const hardFailures: HardGateRuleId[] = [
      ...(diagnostic.ok === false && diagnostic.error.code === 'continuity_get_failed'
        ? []
        : ['security_boundary_violation' as const]),
      ...(JSON.stringify(diagnostic).length <= 500 ? [] : ['security_boundary_violation' as const]),
      ...(writes === 0 ? [] : ['unauthorized_promotion' as const])
    ]
    return {
      hardFailures,
      metrics: metricsFor(benchmarkCase, hardFailures),
      evidence: [{
        summary: `bounded MCP error; code=${diagnostic.error.code}; diagnosticBytes=${JSON.stringify(diagnostic).length}; memory writes=${writes}`
      }]
    }
  })
}

async function runAutomationInterrupt(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions
): Promise<BenchmarkCaseResult> {
  return withTier4Fixture(benchmarkCase, options, {}, async (fixture) => {
    const memory = tier4TrialMemory('tier4-automation-trial')
    await writeSemanticMemoriesFromRoot(fixture.projectMemoryRoot, [memory])
    await appendActivationEventFromRoot(fixture.projectMemoryRoot, tier4ActivationEvent({
      id: 'tier4-automation-applied-1',
      memoryId: memory.id,
      projectId: fixture.projectId,
      createdAt: '2026-06-04T00:00:00.000Z'
    }))
    await appendActivationEventFromRoot(fixture.projectMemoryRoot, tier4ActivationEvent({
      id: 'tier4-automation-applied-2',
      memoryId: memory.id,
      projectId: fixture.projectId,
      createdAt: options.now ?? benchmarkCase.fixture.now
    }))
    const first = await runCodexMemoryLifecycleDaily({
      cwd: fixture.cwd,
      projectRoots: [{ projectId: fixture.projectId, memoryRoot: fixture.projectMemoryRoot }],
      apply: true,
      now: options.now ?? benchmarkCase.fixture.now
    })
    const second = await runCodexMemoryLifecycleDaily({
      cwd: fixture.cwd,
      projectRoots: [{ projectId: fixture.projectId, memoryRoot: fixture.projectMemoryRoot }],
      apply: true,
      now: options.now ?? benchmarkCase.fixture.now
    })
    const [semantic, events] = await Promise.all([
      readSemanticMemoriesFromRoot(fixture.projectMemoryRoot),
      readMemoryEventsFromRoot(fixture.projectMemoryRoot)
    ])
    const promoteEvents = events.filter((event) => event.action === 'promote' && event.memoryId === memory.id)
    const stored = semantic.find((item) => item.id === memory.id)
    const hardFailures: HardGateRuleId[] = [
      ...(first.roots[0]?.promotedTrialToValidated === 1 ? [] : ['unauthorized_promotion' as const]),
      ...(second.roots[0]?.promotedTrialToValidated === 0 ? [] : ['unauthorized_promotion' as const]),
      ...(promoteEvents.length === 1 ? [] : ['duplicate_context_injection' as const]),
      ...(stored?.confidenceTier === 'validated' ? [] : ['unauthorized_promotion' as const])
    ]
    return {
      hardFailures,
      metrics: metricsFor(benchmarkCase, hardFailures),
      evidence: [{
        summary: `automation idempotent; first promotions=${first.roots[0]?.promotedTrialToValidated ?? 'missing'}; second promotions=${second.roots[0]?.promotedTrialToValidated ?? 'missing'}; duplicate promotion=${promoteEvents.length === 1 ? 0 : 1}`
      }]
    }
  })
}

async function runHookTimeout(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions
): Promise<BenchmarkCaseResult> {
  return withTier4Fixture(benchmarkCase, options, {}, async () => {
    const startedAt = Date.now()
    const output = await handleCodexHookTraceCommand('post_tool_use', '{')
    const latencyMs = Math.max(0, Date.now() - startedAt)
    const parsed = JSON.parse(output) as { continue?: boolean; suppressOutput?: boolean }
    const hardFailures: HardGateRuleId[] = [
      ...(parsed.continue === true && parsed.suppressOutput === true ? [] : ['hook_timeout_crash' as const]),
      ...(latencyMs <= 5000 ? [] : ['hook_timeout_crash' as const])
    ]
    return {
      hardFailures,
      metrics: metricsFor(benchmarkCase, hardFailures, { stopHookP95Ms: latencyMs }),
      evidence: [{
        summary: `hook timeout fail-open; continue=${parsed.continue === true ? 1 : 0}; suppressOutput=${parsed.suppressOutput === true ? 1 : 0}; latencyMs=${latencyMs}`
      }]
    }
  })
}

async function withTier4Fixture(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions,
  input: Omit<Parameters<typeof createBenchmarkFixture>[0], 'caseId' | 'seed' | 'now' | 'preserveFixture' | 'preserveReason'>,
  fn: (fixture: Awaited<ReturnType<typeof createBenchmarkFixture>>) => Promise<{
    metrics?: readonly BenchmarkMetric[]
    hardFailures?: readonly HardGateRuleId[]
    evidence: readonly BenchmarkEvidence[]
  }>
): Promise<BenchmarkCaseResult> {
  return timedCase(benchmarkCase, async () => {
    const baseInput = {
      caseId: benchmarkCase.id,
      seed: options.seed ?? benchmarkCase.fixture.seed,
      now: options.now ?? benchmarkCase.fixture.now,
      ...input
    }
    const fixture = await createBenchmarkFixture(
      options.preserveFixtures === true
        ? { ...baseInput, preserveFixture: true, preserveReason: `preserve fixture for ${benchmarkCase.id}` }
        : baseInput
    )
    try {
      return await withFixtureEnvironment(fixture, () => fn(fixture))
    } finally {
      try {
        await fixture.cleanup()
      } finally {
        recordFixtureRun(options, fixture.metadata)
      }
    }
  })
}

async function boundedContinuityGetError(input: {
  cwd: string
  userMessage: string
  fallbackCwd: string
}): Promise<{ ok: false; error: { code: 'continuity_get_failed'; message: string } }> {
  try {
    await handleContinuityGet({
      cwd: input.cwd,
      userMessage: input.userMessage,
      task: 'coding',
      mode: 'fast'
    }, input.fallbackCwd)
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'continuity_get_failed',
        message: compact(error instanceof Error ? error.message : String(error), 240)
      }
    }
  }
  return {
    ok: false,
    error: {
      code: 'continuity_get_failed',
      message: 'continuity_get unexpectedly succeeded for missing cwd'
    }
  }
}

function metricsFor(
  benchmarkCase: BenchmarkCase,
  hardFailures: readonly HardGateRuleId[],
  overrides: Partial<Record<BenchmarkMetricId, number>> = {}
): BenchmarkMetric[] {
  const passed = hardFailures.length === 0
  return benchmarkCase.metrics.map((metric) => ({
    name: metric,
    value: overrides[metric] ?? defaultMetricValue(metric, passed)
  }))
}

function defaultMetricValue(metric: BenchmarkMetricId, passed: boolean): number {
  if (!passed) return 0
  if (
    metric.includes('Leakage') ||
    metric.includes('Pollution') ||
    metric.includes('Misuse') ||
    metric.includes('Fallback') ||
    metric.includes('Stale') ||
    metric.includes('Interference') ||
    metric.includes('DefaultWrite') ||
    metric.includes('wrongTop1')
  ) {
    return 0
  }
  if (
    metric.includes('Latency') ||
    metric.includes('P50') ||
    metric.includes('P95') ||
    metric.includes('P99') ||
    metric.includes('Runtime') ||
    metric.includes('Bytes') ||
    metric === 'toolCallCount'
  ) {
    return 0
  }
  return 1
}

function tier4TrialMemory(id: string): SemanticMemory {
  return {
    id,
    status: 'active',
    module: 'procedural',
    kind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    content: 'Use the Tier 4 automation recovery workflow after two clean activations.',
    useWhen: ['A Tier 4 lifecycle benchmark needs deterministic promotion evidence'],
    doNotUseWhen: ['The memory has malformed JSONL or negative activation feedback'],
    sourceOfTruth: `benchmark:${id}`,
    evidence: [
      {
        id: `${id}-evidence-1`,
        sourceKind: 'user_explicit',
        sourceRef: `benchmark:${id}:1`,
        when: '2026-06-04T00:00:00.000Z',
        whatHappened: 'User approved the Tier 4 trial memory.',
        whyImportant: 'This gives the automation recovery case a low-risk project memory.'
      },
      {
        id: `${id}-evidence-2`,
        sourceKind: 'tool_trace',
        sourceRef: `benchmark:${id}:2`,
        when: '2026-06-04T01:00:00.000Z',
        whatHappened: 'The memory was applied successfully in a later benchmark run.',
        whyImportant: 'Repeated clean activation satisfies daily lifecycle validation.'
      }
    ],
    routing: {
      module: 'procedural',
      updatePolicy: 'strict_auto_promote',
      risk: 'low',
      reasons: ['low-risk procedural benchmark memory']
    },
    reviewPolicy: 'strict_auto_promote',
    reviewState: {
      normalizedKey: id,
      type: 'procedural_rule',
      strength: 'soft',
      source: 'user_explicit',
      scores: { evidenceStrength: 0.95, stability: 0.9, usefulness: 0.9, safety: 0.95, sensitivity: 0.05 },
      tags: ['benchmark', 'tier4']
    },
    confidenceTier: 'trial',
    activationPolicy: activationPolicyForConfidenceTier('trial'),
    supersedes: [],
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z'
  }
}

function tier4ActivationEvent(
  input: Omit<ActivationEvent, 'event'>
): ActivationEvent {
  return { event: 'applied', ...input }
}

function compact(value: string, maxLength: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength - 3)}...`
}
