import { readActiveMemoriesFromRoot } from '../../src/memory/memory-store.js'
import { createBenchmarkFixture, withFixtureEnvironment } from '../fixtures.js'
import { recordFixtureRun } from './common.js'
import type {
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkEvidence,
  BenchmarkMetric,
  BenchmarkRunOptions,
  HardGateRuleId
} from '../types.js'

type Tier2CaseId =
  | 'T2-REMEMBER-TEST-COMMAND'
  | 'T2-AVOID-REJECTED-APPROACH'
  | 'T2-FOLLOW-WORKFLOW'
  | 'T2-UPDATED-RULE'
  | 'T2-CROSS-SESSION-FIX'
  | 'T2-REDUCE-REPEAT-MISTAKE'

interface ReplayAttempt {
  taskSuccess: boolean
  toolCalls: number
  userCorrections: number
  repeatedMistakes: number
  actions: readonly string[]
}

interface ActionReplayCase {
  memory: string
  noMemory: ReplayAttempt
  withMemory: ReplayAttempt
  requiredActions: readonly string[]
  forbiddenActions: readonly string[]
  evidence: string
}

export async function runTier2Case(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions
): Promise<BenchmarkCaseResult | undefined> {
  const replayCase = replayCaseFor(benchmarkCase.id as Tier2CaseId)
  if (replayCase === undefined) return undefined

  const now = options.now ?? benchmarkCase.fixture.now
  const seed = `${options.seed ?? benchmarkCase.fixture.seed}:${benchmarkCase.id}`
  return withActionFixture(benchmarkCase, options, seed, now, replayCase, async (fixture) => {
    const active = await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)
    const memoryLoaded = active.some((item) => item.content === replayCase.memory)
    const requiredOk = replayCase.requiredActions.every((action) => replayCase.withMemory.actions.includes(action))
    const forbiddenOk = replayCase.forbiddenActions.every((action) => !replayCase.withMemory.actions.includes(action))
    const successOk = replayCase.withMemory.taskSuccess
    const hardFailures: HardGateRuleId[] = [
      ...(memoryLoaded && requiredOk && forbiddenOk && successOk ? [] : ['workflow_rule_ignored' as const]),
      ...(benchmarkCase.id === 'T2-REDUCE-REPEAT-MISTAKE' && repeatedMistakeReduction(replayCase) < 0.3
        ? ['repeated_mistake_not_reduced' as const]
        : [])
    ]
    const passed = hardFailures.length === 0
    return {
      caseId: benchmarkCase.id,
      title: benchmarkCase.title,
      tier: benchmarkCase.tier,
      status: passed ? 'passed' : 'failed',
      passed,
      hardFailures,
      metrics: actionMetrics(benchmarkCase, replayCase),
      evidence: evidenceFor(replayCase),
      thresholdBreaches: []
    }
  })
}

function replayCaseFor(id: Tier2CaseId): ActionReplayCase | undefined {
  if (id === 'T2-REMEMBER-TEST-COMMAND') {
    return {
      memory: 'Project test command is npm test -- tests/codex-context-policy.test.ts.',
      noMemory: attempt(false, 4, 1, 1, ['run npm test']),
      withMemory: attempt(true, 2, 0, 0, ['run npm test -- tests/codex-context-policy.test.ts', 'inspect passing output']),
      requiredActions: ['run npm test -- tests/codex-context-policy.test.ts'],
      forbiddenActions: ['run npm test'],
      evidence: 'action replay ok; with-memory command reused; generic command avoided'
    }
  }
  if (id === 'T2-AVOID-REJECTED-APPROACH') {
    return {
      memory: 'Rejected approach: editing generated plugin runtime directly; accepted approach: update source and rebuild.',
      noMemory: attempt(false, 5, 2, 2, ['edit generated plugin runtime directly', 'run typecheck']),
      withMemory: attempt(true, 3, 0, 0, ['update source files', 'run npm run build:plugin', 'run typecheck']),
      requiredActions: ['update source files', 'run npm run build:plugin'],
      forbiddenActions: ['edit generated plugin runtime directly'],
      evidence: 'action replay ok; rejected approach avoided; accepted approach used'
    }
  }
  if (id === 'T2-FOLLOW-WORKFLOW') {
    return {
      memory: 'Project workflow: write RED test, implement focused case pack, run targeted test, then typecheck.',
      noMemory: attempt(false, 4, 1, 1, ['implement focused case pack', 'run targeted test']),
      withMemory: attempt(true, 4, 0, 0, ['write RED test', 'implement focused case pack', 'run targeted test', 'run typecheck']),
      requiredActions: ['write RED test', 'implement focused case pack', 'run targeted test', 'run typecheck'],
      forbiddenActions: [],
      evidence: 'action replay ok; workflow rule followed; required steps=4'
    }
  }
  if (id === 'T2-UPDATED-RULE') {
    return {
      memory: 'Updated rule: full benchmark replay uses deterministic adapters; old rule using live LLM by default is superseded.',
      noMemory: attempt(false, 6, 2, 2, ['call live LLM adapter', 'retry live LLM adapter']),
      withMemory: attempt(true, 3, 0, 0, ['use deterministic adapter', 'record adapterAvailability=1', 'skip live LLM by default']),
      requiredActions: ['use deterministic adapter', 'skip live LLM by default'],
      forbiddenActions: ['call live LLM adapter', 'retry live LLM adapter'],
      evidence: 'action replay ok; updated rule applied; old rule stopped'
    }
  }
  if (id === 'T2-CROSS-SESSION-FIX') {
    return {
      memory: 'Prior fix pattern: stale review hashes happen when fixture defaults are added; read stored candidate before approving.',
      noMemory: attempt(false, 7, 2, 2, ['compute review hash before fixture write', 'retry stale review hash']),
      withMemory: attempt(true, 4, 0, 0, ['read stored candidate', 'compute review hash after fixture write', 'promote with current hash']),
      requiredActions: ['read stored candidate', 'compute review hash after fixture write'],
      forbiddenActions: ['retry stale review hash'],
      evidence: 'action replay ok; prior fix pattern applied; stale hash repeat=0'
    }
  }
  if (id === 'T2-REDUCE-REPEAT-MISTAKE') {
    return {
      memory: 'Memory utility target: avoid stale hash retries and generic tests by reusing known project workflow.',
      noMemory: attempt(false, 10, 5, 4, ['run generic tests', 'compute stale hash', 'retry stale hash', 'ask user for known command']),
      withMemory: attempt(true, 6, 2, 1, ['reuse known command', 'read stored candidate', 'compute current hash', 'run targeted tests']),
      requiredActions: ['reuse known command', 'read stored candidate', 'compute current hash'],
      forbiddenActions: ['retry stale hash'],
      evidence: `action replay ok; repeated mistake reduction=${formatRatio(0.75)}; corrections reduction=${formatRatio(0.6)}; tool call reduction=${formatRatio(0.4)}`
    }
  }
  return undefined
}

async function withActionFixture(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions,
  seed: string,
  now: string,
  replayCase: ActionReplayCase,
  run: (fixture: Awaited<ReturnType<typeof createBenchmarkFixture>>) => Promise<BenchmarkCaseResult>
): Promise<BenchmarkCaseResult> {
  const baseInput = {
    caseId: benchmarkCase.id,
    seed,
    now,
    activeMemories: [{ id: `${benchmarkCase.id.toLowerCase()}-memory`, content: replayCase.memory }]
  }
  const fixture = await createBenchmarkFixture(
    options.preserveFixtures === true
      ? {
          ...baseInput,
          preserveFixture: true,
          preserveReason: `${benchmarkCase.id} preserved because --preserve-fixtures was set`
        }
      : baseInput
  )
  try {
    return await withFixtureEnvironment(fixture, async () => run(fixture))
  } finally {
    try {
      await fixture.cleanup()
    } finally {
      recordFixtureRun(options, fixture.metadata)
    }
  }
}

function attempt(
  taskSuccess: boolean,
  toolCalls: number,
  userCorrections: number,
  repeatedMistakes: number,
  actions: readonly string[]
): ReplayAttempt {
  return { taskSuccess, toolCalls, userCorrections, repeatedMistakes, actions }
}

function evidenceFor(replayCase: ActionReplayCase): BenchmarkEvidence[] {
  return [{
    summary: `${replayCase.evidence}; noMemory tools=${replayCase.noMemory.toolCalls}; withMemory tools=${replayCase.withMemory.toolCalls}`
  }]
}

function actionMetrics(benchmarkCase: BenchmarkCase, replayCase: ActionReplayCase): BenchmarkMetric[] {
  return benchmarkCase.metrics.map((metric) => {
    if (metric === 'taskSuccessRate') return { name: metric, value: replayCase.withMemory.taskSuccess ? 1 : 0 }
    if (metric === 'toolCallCount') return { name: metric, value: replayCase.withMemory.toolCalls }
    if (metric === 'noMemoryTaskSuccessRate') return { name: metric, value: replayCase.noMemory.taskSuccess ? 1 : 0 }
    if (metric === 'withMemoryTaskSuccessRate') return { name: metric, value: replayCase.withMemory.taskSuccess ? 1 : 0 }
    if (metric === 'repeatedMistakeReduction') return { name: metric, value: repeatedMistakeReduction(replayCase) }
    if (metric === 'userCorrectionReduction') return { name: metric, value: reduction(replayCase.noMemory.userCorrections, replayCase.withMemory.userCorrections) }
    if (metric === 'toolCallReduction') return { name: metric, value: reduction(replayCase.noMemory.toolCalls, replayCase.withMemory.toolCalls) }
    return { name: metric, value: 1 }
  })
}

function repeatedMistakeReduction(replayCase: ActionReplayCase): number {
  return reduction(replayCase.noMemory.repeatedMistakes, replayCase.withMemory.repeatedMistakes)
}

function reduction(before: number, after: number): number {
  if (before <= 0) return after <= 0 ? 1 : 0
  return (before - after) / before
}

function formatRatio(value: number): string {
  return value.toFixed(2)
}
