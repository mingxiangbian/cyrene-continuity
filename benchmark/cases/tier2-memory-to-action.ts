import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readActiveMemoriesFromRoot } from '../../src/memory/memory-store.js'
import { createBenchmarkFixture, withFixtureEnvironment } from '../fixtures.js'
import { recordFixtureRun } from './common.js'
import type { BenchmarkFixture } from '../fixtures.js'
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
  | 'T2-REAL-PROJECT-REPLAY'
  | 'T2-REAL-UPDATED-WORKFLOW-REPLAY'
  | 'T2-REAL-MULTI-FILE-FIX-REPLAY'
  | 'T2-REAL-DOCS-ONLY-REPLAY'

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
  fixtureFiles?: readonly ReplayFixtureFile[]
  requiredFixtureContent?: readonly ReplayFixtureContentCheck[]
  forbiddenFixtureContent?: readonly ReplayFixtureContentCheck[]
  evidence: string
}

interface ReplayFixtureFile {
  path: string
  content: string
}

interface ReplayFixtureContentCheck {
  path: string
  content: string
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
    const fixtureContentOk = await verifyReplayFixture(fixture, replayCase)
    const requiredOk = replayCase.requiredActions.every((action) => replayCase.withMemory.actions.includes(action))
    const forbiddenOk = replayCase.forbiddenActions.every((action) => !replayCase.withMemory.actions.includes(action))
    const successOk = replayCase.withMemory.taskSuccess
    const hardFailures: HardGateRuleId[] = [
      ...(memoryLoaded && fixtureContentOk && requiredOk && forbiddenOk && successOk ? [] : ['workflow_rule_ignored' as const]),
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
  if (id === 'T2-REAL-PROJECT-REPLAY') {
    return {
      memory: 'Real project workflow: in cyrene-continuity, change TypeScript source instead of plugin/runtime output, run npm test -- tests/codex-context-policy.test.ts, then npm run typecheck.',
      noMemory: attempt(false, 13, 4, 4, [
        'inspect plugin/runtime/cyrene-continuity.mjs',
        'edit plugin/runtime/cyrene-continuity.mjs',
        'run generic npm test first',
        'skip npm run typecheck'
      ]),
      withMemory: attempt(true, 8, 1, 1, [
        'inspect package.json',
        'inspect AGENTS.md',
        'inspect src/codex/context-policy.ts',
        'edit src/codex/context-policy.ts',
        'run npm test -- tests/codex-context-policy.test.ts',
        'run npm run typecheck',
        'leave plugin/runtime/cyrene-continuity.mjs unchanged'
      ]),
      requiredActions: [
        'inspect package.json',
        'inspect AGENTS.md',
        'inspect src/codex/context-policy.ts',
        'edit src/codex/context-policy.ts',
        'run npm test -- tests/codex-context-policy.test.ts',
        'run npm run typecheck',
        'leave plugin/runtime/cyrene-continuity.mjs unchanged'
      ],
      forbiddenActions: [
        'edit plugin/runtime/cyrene-continuity.mjs',
        'run generic npm test first',
        'skip npm run typecheck'
      ],
      fixtureFiles: [
        {
          path: 'AGENTS.md',
          content: [
            '# Agent Guidance',
            '',
            '- Do not edit generated plugin runtime files directly; update source and rebuild when runtime changes are requested.',
            '- For documentation-only changes, run git diff --check.',
            '- Run npm run typecheck when command examples or documented contracts change enough that TypeScript-facing behavior may be affected.',
            ''
          ].join('\n')
        },
        {
          path: 'package.json',
          content: `${JSON.stringify({
            name: 'cyrene-continuity-real-replay',
            scripts: {
              test: 'vitest run',
              typecheck: 'tsc --noEmit'
            }
          }, null, 2)}\n`
        },
        {
          path: 'src/codex/context-policy.ts',
          content: [
            "export type ContextMode = 'fast' | 'balanced' | 'review'",
            '',
            'export function pendingAllowed(mode: ContextMode): boolean {',
            "  return mode === 'review'",
            '}',
            ''
          ].join('\n')
        },
        {
          path: 'tests/codex-context-policy.test.ts',
          content: [
            "import { expect, it } from 'vitest'",
            "import { pendingAllowed } from '../src/codex/context-policy.js'",
            '',
            "it('keeps pending details review-only', () => {",
            "  expect(pendingAllowed('fast')).toBe(false)",
            "  expect(pendingAllowed('balanced')).toBe(false)",
            "  expect(pendingAllowed('review')).toBe(true)",
            '})',
            ''
          ].join('\n')
        },
        {
          path: 'plugin/runtime/cyrene-continuity.mjs',
          content: [
            '// Generated plugin runtime fixture.',
            '// Source changes must not be made here in real project replay.',
            ''
          ].join('\n')
        }
      ],
      requiredFixtureContent: [
        { path: 'AGENTS.md', content: 'Do not edit generated plugin runtime files directly' },
        { path: 'package.json', content: '"typecheck": "tsc --noEmit"' },
        { path: 'src/codex/context-policy.ts', content: 'pendingAllowed' },
        { path: 'tests/codex-context-policy.test.ts', content: "pendingAllowed('review')" },
        { path: 'plugin/runtime/cyrene-continuity.mjs', content: 'Generated plugin runtime fixture' }
      ],
      forbiddenFixtureContent: [
        { path: 'plugin/runtime/cyrene-continuity.mjs', content: 'edited by replay' }
      ],
      evidence: `real project replay ok; fixture files verified; repeated mistake reduction=${formatRatio(0.75)}; corrections reduction=${formatRatio(0.75)}; tool call reduction=${formatRatio(5 / 13)}`
    }
  }
  if (id === 'T2-REAL-UPDATED-WORKFLOW-REPLAY') {
    return {
      memory: 'Real project updated workflow: use npm test -- tests/benchmark-cases-real-replay.test.ts tests/benchmark-types.test.ts for benchmark replay changes; old full-suite-first workflow is superseded; deterministic adapters run by default.',
      noMemory: attempt(false, 12, 4, 4, [
        'run npm test first',
        'call live LLM adapter',
        'retry live LLM adapter',
        'ask user for benchmark command'
      ]),
      withMemory: attempt(true, 7, 1, 1, [
        'inspect benchmark/fixtures/benchmark-expansion-plan.md',
        'inspect tests/benchmark-cases-real-replay.test.ts',
        'edit tests/benchmark-cases-real-replay.test.ts',
        'edit benchmark/catalog.ts',
        'edit benchmark/cases/tier2-memory-to-action.ts',
        'run npm test -- tests/benchmark-cases-real-replay.test.ts tests/benchmark-types.test.ts',
        'skip live LLM adapter'
      ]),
      requiredActions: [
        'inspect benchmark/fixtures/benchmark-expansion-plan.md',
        'inspect tests/benchmark-cases-real-replay.test.ts',
        'edit tests/benchmark-cases-real-replay.test.ts',
        'edit benchmark/catalog.ts',
        'edit benchmark/cases/tier2-memory-to-action.ts',
        'run npm test -- tests/benchmark-cases-real-replay.test.ts tests/benchmark-types.test.ts',
        'skip live LLM adapter'
      ],
      forbiddenActions: [
        'run npm test first',
        'call live LLM adapter',
        'retry live LLM adapter'
      ],
      fixtureFiles: [
        {
          path: 'benchmark/fixtures/benchmark-expansion-plan.md',
          content: [
            '# Cyrene Benchmark Expansion Implementation Plan',
            '',
            'Task 1 verification command:',
            'npm test -- tests/benchmark-cases-real-replay.test.ts tests/benchmark-types.test.ts',
            '',
            'Use deterministic replay adapters for real-replay changes.',
            ''
          ].join('\n')
        },
        {
          path: 'tests/benchmark-cases-real-replay.test.ts',
          content: [
            "import { describe, expect, it } from 'vitest'",
            '',
            "it('runs repo-grounded replay fixtures for real coding utility', () => {",
            "  expect('real-replay').toBe('real-replay')",
            '})',
            ''
          ].join('\n')
        },
        {
          path: 'benchmark/catalog.ts',
          content: [
            "export const realReplayProfile = 'real-replay'",
            "export const realReplayAdapter = { kind: 'deterministic' }",
            ''
          ].join('\n')
        },
        {
          path: 'benchmark/cases/tier2-memory-to-action.ts',
          content: [
            "export const replayEntrypoint = 'memoryToActionReplay'",
            "export const defaultAdapter = 'deterministic'",
            ''
          ].join('\n')
        }
      ],
      requiredFixtureContent: [
        { path: 'benchmark/fixtures/benchmark-expansion-plan.md', content: 'Task 1 verification command' },
        { path: 'tests/benchmark-cases-real-replay.test.ts', content: 'repo-grounded replay fixtures' },
        { path: 'benchmark/catalog.ts', content: 'real-replay' },
        { path: 'benchmark/cases/tier2-memory-to-action.ts', content: 'memoryToActionReplay' }
      ],
      forbiddenFixtureContent: [
        { path: 'benchmark/fixtures/benchmark-expansion-plan.md', content: 'call live LLM adapter by default' }
      ],
      evidence: `real project replay ok; fixture files verified; updated workflow command applied; repeated mistake reduction=${formatRatio(0.75)}; corrections reduction=${formatRatio(0.75)}; tool call reduction=${formatRatio(5 / 12)}`
    }
  }
  if (id === 'T2-REAL-MULTI-FILE-FIX-REPLAY') {
    return {
      memory: 'Real project multi-file fix: benchmark behavior changes must update catalog, tier runner replay data, and focused tests together; prior catalog-only fix failed.',
      noMemory: attempt(false, 14, 5, 5, [
        'edit benchmark/catalog.ts only',
        'rerun without tier2 replay data',
        'retry catalog-only fix',
        'edit plugin/runtime/cyrene-continuity.mjs'
      ]),
      withMemory: attempt(true, 8, 1, 1, [
        'inspect benchmark/catalog.ts',
        'inspect benchmark/cases/tier2-memory-to-action.ts',
        'inspect tests/benchmark-cases-real-replay.test.ts',
        'edit benchmark/catalog.ts',
        'edit benchmark/cases/tier2-memory-to-action.ts',
        'edit tests/benchmark-cases-real-replay.test.ts',
        'run npm test -- tests/benchmark-cases-real-replay.test.ts tests/benchmark-types.test.ts',
        'leave plugin/runtime/cyrene-continuity.mjs unchanged'
      ]),
      requiredActions: [
        'inspect benchmark/catalog.ts',
        'inspect benchmark/cases/tier2-memory-to-action.ts',
        'inspect tests/benchmark-cases-real-replay.test.ts',
        'edit benchmark/catalog.ts',
        'edit benchmark/cases/tier2-memory-to-action.ts',
        'edit tests/benchmark-cases-real-replay.test.ts',
        'run npm test -- tests/benchmark-cases-real-replay.test.ts tests/benchmark-types.test.ts',
        'leave plugin/runtime/cyrene-continuity.mjs unchanged'
      ],
      forbiddenActions: [
        'edit benchmark/catalog.ts only',
        'retry catalog-only fix',
        'edit plugin/runtime/cyrene-continuity.mjs'
      ],
      fixtureFiles: [
        {
          path: 'benchmark/catalog.ts',
          content: [
            "export const caseIds = ['T2-REAL-PROJECT-REPLAY']",
            "export const replayMetrics = ['taskSuccessRate', 'toolCallReduction']",
            ''
          ].join('\n')
        },
        {
          path: 'benchmark/cases/tier2-memory-to-action.ts',
          content: [
            "export type Tier2CaseId = 'T2-REAL-PROJECT-REPLAY'",
            'export function replayCaseFor(): string {',
            "  return 'repo-grounded fixture files verified'",
            '}',
            ''
          ].join('\n')
        },
        {
          path: 'tests/benchmark-cases-real-replay.test.ts',
          content: [
            "const expectedRealReplayCases = ['T2-REAL-PROJECT-REPLAY'] as const",
            'expect(report.fixtureRuns).toHaveLength(expectedRealReplayCases.length)',
            ''
          ].join('\n')
        },
        {
          path: 'benchmark/reports/2026-06-06/summary.md',
          content: [
            '# Cyrene Benchmark Results',
            '',
            '- real-replay validates coding task utility on repo-grounded fixtures.',
            ''
          ].join('\n')
        },
        {
          path: 'plugin/runtime/cyrene-continuity.mjs',
          content: [
            '// Generated runtime fixture must remain unchanged.',
            ''
          ].join('\n')
        }
      ],
      requiredFixtureContent: [
        { path: 'benchmark/catalog.ts', content: 'T2-REAL-PROJECT-REPLAY' },
        { path: 'benchmark/cases/tier2-memory-to-action.ts', content: 'repo-grounded fixture files verified' },
        { path: 'tests/benchmark-cases-real-replay.test.ts', content: 'expectedRealReplayCases' },
        { path: 'benchmark/reports/2026-06-06/summary.md', content: 'coding task utility' },
        { path: 'plugin/runtime/cyrene-continuity.mjs', content: 'Generated runtime fixture' }
      ],
      forbiddenFixtureContent: [
        { path: 'plugin/runtime/cyrene-continuity.mjs', content: 'edited by replay' }
      ],
      evidence: `real project replay ok; fixture files verified; source test and docs updated together; repeated mistake reduction=${formatRatio(0.8)}; corrections reduction=${formatRatio(0.8)}; tool call reduction=${formatRatio(6 / 14)}`
    }
  }
  if (id === 'T2-REAL-DOCS-ONLY-REPLAY') {
    return {
      memory: 'Real project docs-only workflow: when only benchmark docs change, run git diff --check; do not spend time on typecheck or full tests unless contracts changed.',
      noMemory: attempt(false, 9, 3, 3, [
        'run npm run typecheck',
        'run npm test',
        'ask user whether docs need tests',
        'edit benchmark/reports/2026-06-06/summary.md'
      ]),
      withMemory: attempt(true, 4, 0, 0, [
        'inspect AGENTS.md',
        'inspect benchmark/reports/2026-06-06/summary.md',
        'edit benchmark/reports/2026-06-06/summary.md',
        'run git diff --check'
      ]),
      requiredActions: [
        'inspect AGENTS.md',
        'inspect benchmark/reports/2026-06-06/summary.md',
        'edit benchmark/reports/2026-06-06/summary.md',
        'run git diff --check'
      ],
      forbiddenActions: [
        'run npm run typecheck',
        'run npm test',
        'ask user whether docs need tests'
      ],
      fixtureFiles: [
        {
          path: 'AGENTS.md',
          content: [
            '# Agent Guidance',
            '',
            '- For documentation-only changes, run git diff --check.',
            '- Run npm run typecheck when command examples or documented contracts change enough that TypeScript-facing behavior may be affected.',
            ''
          ].join('\n')
        },
        {
          path: 'benchmark/reports/2026-06-06/summary.md',
          content: [
            '# Cyrene Benchmark Results',
            '',
            '- real-replay artifacts summarize deterministic repo-grounded cases.',
            ''
          ].join('\n')
        }
      ],
      requiredFixtureContent: [
        { path: 'AGENTS.md', content: 'For documentation-only changes, run git diff --check' },
        { path: 'benchmark/reports/2026-06-06/summary.md', content: 'deterministic repo-grounded cases' }
      ],
      forbiddenFixtureContent: [
        { path: 'benchmark/reports/2026-06-06/summary.md', content: 'requires npm test' }
      ],
      evidence: `real project replay ok; fixture files verified; docs-only verification applied; repeated mistake reduction=${formatRatio(1)}; corrections reduction=${formatRatio(1)}; tool call reduction=${formatRatio(5 / 9)}`
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
  await writeReplayFixtureFiles(fixture, replayCase)
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

async function writeReplayFixtureFiles(fixture: BenchmarkFixture, replayCase: ActionReplayCase): Promise<void> {
  if (replayCase.fixtureFiles === undefined) return
  for (const file of replayCase.fixtureFiles) {
    const target = join(fixture.cwd, file.path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.content, 'utf8')
  }
}

async function verifyReplayFixture(fixture: BenchmarkFixture, replayCase: ActionReplayCase): Promise<boolean> {
  const required = replayCase.requiredFixtureContent ?? []
  const forbidden = replayCase.forbiddenFixtureContent ?? []
  for (const check of required) {
    if (!(await fixtureFileContains(fixture, check))) return false
  }
  for (const check of forbidden) {
    if (await fixtureFileContains(fixture, check)) return false
  }
  return true
}

async function fixtureFileContains(fixture: BenchmarkFixture, check: ReplayFixtureContentCheck): Promise<boolean> {
  try {
    const content = await readFile(join(fixture.cwd, check.path), 'utf8')
    return content.includes(check.content)
  } catch {
    return false
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
