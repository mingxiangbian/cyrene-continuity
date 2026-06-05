import { createBenchmarkFixture, withFixtureEnvironment } from '../fixtures.js'
import { recordFixtureRun } from './common.js'
import { memoryReviewDecisionInputSchema } from '../../src/mcp/tools/memory-review.js'
import { proposeCodexMemoryCandidate } from '../../src/codex/memory-propose.js'
import {
  deferCodexPendingMemory,
  editCodexPendingMemory,
  promoteCodexPendingMemory,
  rejectCodexPendingMemory,
  reviewHashForPendingMemory
} from '../../src/codex/memory-review.js'
import {
  readActiveMemoriesFromRoot,
  readMemoryEventsFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot
} from '../../src/memory/memory-store.js'
import type {
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkEvidence,
  BenchmarkMetric,
  BenchmarkRunOptions,
  HardGateRuleId
} from '../types.js'
import type { PendingMemory } from '../../src/memory/types.js'

type Tier16CaseId =
  | 'T16-PROPOSE-IMPORTANT'
  | 'T16-PROPOSE-NOISE'
  | 'T16-PROPOSE-SENSITIVE'
  | 'T16-PROPOSE-ASSISTANT-INFERENCE'
  | 'T16-ROUTING-NAMESPACE'
  | 'T16-REVIEW-HASH-REQUIRED'
  | 'T16-REVIEW-STALE-HASH'
  | 'T16-REVIEW-REJECT-DEFER'
  | 'T16-REVIEW-EDIT-HASH'

type CaseAssertion = (input: {
  benchmarkCase: BenchmarkCase
  options: BenchmarkRunOptions
  now: string
  seed: string
}) => Promise<readonly BenchmarkEvidence[]>

const CASES: Record<Tier16CaseId, { hardFailure: HardGateRuleId; run: CaseAssertion }> = {
  'T16-PROPOSE-IMPORTANT': { hardFailure: 'unauthorized_promotion', run: runProposeImportant },
  'T16-PROPOSE-NOISE': { hardFailure: 'ordinary_hook_pending_review', run: runProposeNoise },
  'T16-PROPOSE-SENSITIVE': { hardFailure: 'secret_persistence', run: runProposeSensitive },
  'T16-PROPOSE-ASSISTANT-INFERENCE': { hardFailure: 'unauthorized_promotion', run: runProposeAssistantInference },
  'T16-ROUTING-NAMESPACE': { hardFailure: 'wrong_namespace_routing', run: runRoutingNamespace },
  'T16-REVIEW-HASH-REQUIRED': { hardFailure: 'hash_bypass', run: runReviewHashRequired },
  'T16-REVIEW-STALE-HASH': { hardFailure: 'stale_approval_success', run: runReviewStaleHash },
  'T16-REVIEW-REJECT-DEFER': { hardFailure: 'rejected_memory_activation', run: runReviewRejectDefer },
  'T16-REVIEW-EDIT-HASH': { hardFailure: 'hash_bypass', run: runReviewEditHash }
}

export async function runTier16Case(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions
): Promise<BenchmarkCaseResult | undefined> {
  const handler = CASES[benchmarkCase.id as Tier16CaseId]
  if (handler === undefined) return undefined

  const now = options.now ?? benchmarkCase.fixture.now
  const seed = `${options.seed ?? benchmarkCase.fixture.seed}:${benchmarkCase.id}`
  try {
    const evidence = await handler.run({ benchmarkCase, options, now, seed })
    return caseResult(benchmarkCase, true, [], evidence)
  } catch (error) {
    return caseResult(benchmarkCase, false, [handler.hardFailure], [
      { summary: `${benchmarkCase.id} failed`, detail: errorMessage(error) }
    ])
  }
}

async function runProposeImportant(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withEmptyFixture(input, async (fixture) => {
    const content = 'Benchmark cases for memory review hashes must stay covered by deterministic gate tests.'
    const result = await proposeCodexMemoryCandidate({
      cwd: fixture.cwd,
      now: input.now,
      allowAutoPromote: false,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        candidateKind: 'workflow_rule',
        strength: 'hard',
        content,
        normalizedKey: 'benchmark-review-hash-gate-coverage',
        sourceOfTruth: 'benchmark spec',
        source: 'file',
        evidence: [{ runId: 'tier16-important', sourceKind: 'file', summary: 'Benchmark spec requires T16 review-hash coverage.' }],
        scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.05 },
        tags: ['benchmark']
      }
    })
    assert(result.result.action === 'pending', `expected pending important proposal, got ${result.result.action}`)
    const pending = await readPendingMemoriesFromRoot(fixture.projectMemoryRoot)
    assert(pending.length === 1 && pending[0]?.content.includes(content), 'important proposal was not written to project review queue')
    assert((await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'important proposal bypassed review')
    return [{ summary: 'important project rule candidate proposed for review' }]
  })
}

async function runProposeNoise(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withEmptyFixture(input, async (fixture) => {
    const result = await proposeCodexMemoryCandidate({
      cwd: fixture.cwd,
      now: input.now,
      recordRejectedCandidate: false,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        content: 'npm test passed once in this benchmark fixture.',
        normalizedKey: 'one-time-test-result-noise',
        source: 'tool_trace',
        evidence: [{ runId: 'tier16-noise', sourceKind: 'tool_trace', summary: 'One-time test passed.' }],
        scores: { evidenceStrength: 0.4, stability: 0.2, usefulness: 0.2, safety: 0.9, sensitivity: 0.05 }
      }
    })
    assert(result.result.action === 'reject', `expected rejected noise proposal, got ${result.result.action}`)
    assert((await readPendingMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'noise was written to pending memory')
    assert((await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'noise was activated')
    return [{ summary: 'noise filtered decision; pending noise=0' }]
  })
}

async function runProposeSensitive(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withEmptyFixture(input, async (fixture) => {
    const secret = 'api_key=sk_benchmark_secret_1234567890abcdef'
    const result = await proposeCodexMemoryCandidate({
      cwd: fixture.cwd,
      now: input.now,
      recordRejectedCandidate: false,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        content: `Never persist this credential: ${secret}`,
        normalizedKey: 'sensitive-secret-fixture',
        source: 'tool_trace',
        evidence: [{ runId: 'tier16-sensitive', sourceKind: 'tool_trace', summary: 'Tool output contained a credential-like value.' }],
        scores: { evidenceStrength: 0.8, stability: 0.8, usefulness: 0.1, safety: 0.4, sensitivity: 0.95 }
      }
    })
    assert(result.result.action === 'reject', `expected rejected sensitive proposal, got ${result.result.action}`)
    const memoryText = await rootMemoryText(fixture.projectMemoryRoot)
    assert(!memoryText.includes(secret), 'secret-like content persisted in memory store')
    return [{ summary: 'sensitive content rejected; secret persistence=0' }]
  })
}

async function runProposeAssistantInference(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withEmptyFixture(input, async (fixture) => {
    const content = 'User prefers terse benchmark updates because they accepted an assistant suggestion without correction.'
    const result = await proposeCodexMemoryCandidate({
      cwd: fixture.cwd,
      now: input.now,
      allowAutoPromote: false,
      candidate: {
        domain: 'personal',
        type: 'interaction_style',
        content,
        normalizedKey: 'assistant-inferred-terse-updates',
        source: 'assistant_observed',
        evidence: [{ runId: 'tier16-assistant-inference', sourceKind: 'assistant_observed', summary: 'Assistant suggested terse updates and it was accepted without correction.' }],
        scores: { evidenceStrength: 0.8, stability: 0.7, usefulness: 0.7, safety: 0.9, sensitivity: 0.3 }
      }
    })
    assert(result.result.action === 'pending', `expected assistant inference to remain pending, got ${result.result.action}`)
    assert((await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'assistant inference was activated')
    return [{ summary: 'assistant inference deferred for review; active inference=0' }]
  })
}

async function runRoutingNamespace(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withEmptyFixture(input, async (fixture) => {
    const projectContent = 'Project namespace benchmark memory belongs only in the project root.'
    const globalContent = 'Global namespace benchmark memory belongs only in the global root.'
    const projectResult = await proposeCodexMemoryCandidate({
      cwd: fixture.cwd,
      now: input.now,
      allowAutoPromote: false,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        candidateKind: 'workflow_rule',
        scope: 'project',
        content: projectContent,
        normalizedKey: 'tier16-project-routing',
        source: 'file',
        evidence: [{ runId: 'tier16-project-routing', sourceKind: 'file', summary: 'Project-scoped benchmark evidence.' }],
        scores: { evidenceStrength: 0.8, stability: 0.75, usefulness: 0.7, safety: 0.95, sensitivity: 0.05 }
      }
    })
    const globalResult = await proposeCodexMemoryCandidate({
      cwd: fixture.cwd,
      now: input.now,
      allowAutoPromote: false,
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        candidateKind: 'workflow_rule',
        scope: 'global',
        content: globalContent,
        normalizedKey: 'tier16-global-routing',
        source: 'user_explicit',
        evidence: [{ runId: 'tier16-global-routing', sourceKind: 'user_explicit', summary: 'Global-scoped benchmark evidence.' }],
        scores: { evidenceStrength: 0.8, stability: 0.75, usefulness: 0.7, safety: 0.95, sensitivity: 0.05 }
      }
    })
    assert(projectResult.result.action === 'pending', `expected project routing proposal to stay pending, got ${projectResult.result.action}`)
    assert(globalResult.result.action === 'pending', `expected global routing proposal to stay pending, got ${globalResult.result.action}`)
    const projectText = await rootMemoryText(fixture.projectMemoryRoot)
    const globalText = await rootMemoryText(fixture.globalMemoryRoot)
    assert(projectText.includes(projectContent), 'project memory missing from project root')
    assert(!projectText.includes(globalContent), 'global memory leaked into project root')
    assert(globalText.includes(globalContent), 'global memory missing from global root')
    assert(!globalText.includes(projectContent), 'project memory leaked into global root')
    return [{ summary: 'namespace routing ok; project and global roots isolated' }]
  })
}

async function runReviewHashRequired(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withReviewFixture(input, [pendingReviewCandidate('hash-required')], async (fixture) => {
    const parsed = memoryReviewDecisionInputSchema.reviewHash.safeParse(undefined)
    assert(!parsed.success, 'review decision schema accepted missing reviewHash')
    const result = await promoteCodexPendingMemory({
      cwd: fixture.cwd,
      id: 'hash-required',
      reviewHash: '',
      now: input.now
    })
    assert(result.result.action === 'conflict', `missing/empty hash should not promote, got ${result.result.action}`)
    assert((await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'approval without hash activated memory')
    assert((await readPendingMemoriesFromRoot(fixture.projectMemoryRoot)).some((item) => item.id === 'hash-required'), 'pending candidate disappeared after missing hash check')
    return [{ summary: 'review hash required; missing reviewHash rejected' }]
  })
}

async function runReviewStaleHash(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withReviewFixture(input, [pendingReviewCandidate('stale-hash')], async (fixture) => {
    const result = await promoteCodexPendingMemory({
      cwd: fixture.cwd,
      id: 'stale-hash',
      reviewHash: '0'.repeat(64),
      now: input.now
    })
    assert(result.result.action === 'conflict', `expected stale hash conflict, got ${result.result.action}`)
    assert((await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'stale hash activated memory')
    assert((await readPendingMemoriesFromRoot(fixture.projectMemoryRoot)).some((item) => item.id === 'stale-hash'), 'stale hash removed pending candidate')
    return [{ summary: 'stale hash rejected; active writes=0' }]
  })
}

async function runReviewRejectDefer(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withReviewFixture(input, [
    pendingReviewCandidate('reject-candidate', { normalizedKey: 'tier16-reject-candidate' }),
    pendingReviewCandidate('defer-candidate', { normalizedKey: 'tier16-defer-candidate' })
  ], async (fixture) => {
    const pending = await readPendingMemoriesFromRoot(fixture.projectMemoryRoot)
    const rejectCandidate = requiredPending(pending, 'reject-candidate')
    const deferCandidate = requiredPending(pending, 'defer-candidate')
    const reject = await rejectCodexPendingMemory({
      cwd: fixture.cwd,
      id: rejectCandidate.id,
      reviewHash: reviewHashForPendingMemory(rejectCandidate),
      reason: 'T16 reject benchmark',
      now: input.now
    })
    const defer = await deferCodexPendingMemory({
      cwd: fixture.cwd,
      id: deferCandidate.id,
      reviewHash: reviewHashForPendingMemory(deferCandidate),
      days: 3,
      reason: 'T16 defer benchmark',
      now: input.now
    })
    assert(reject.result.action === 'reject', `expected reject action, got ${reject.result.action}`)
    assert(defer.result.action === 'defer', `expected defer action, got ${defer.result.action}`)
    const afterPending = await readPendingMemoriesFromRoot(fixture.projectMemoryRoot)
    assert(!afterPending.some((item) => item.id === rejectCandidate.id), 'rejected candidate stayed pending')
    assert(afterPending.some((item) => item.id === deferCandidate.id && item.promoteAfter === addDays(input.now, 3)), 'deferred candidate missing promoteAfter')
    assert((await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'reject/defer activated memory')
    return [{ summary: 'reject and defer stay inactive; active writes=0' }]
  })
}

async function runReviewEditHash(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withReviewFixture(input, [pendingReviewCandidate('edit-hash')], async (fixture) => {
    const original = requiredPending(await readPendingMemoriesFromRoot(fixture.projectMemoryRoot), 'edit-hash')
    const oldHash = reviewHashForPendingMemory(original)
    const edit = await editCodexPendingMemory({
      cwd: fixture.cwd,
      id: original.id,
      reviewHash: oldHash,
      content: 'Use the current review hash when approving edited pending memory candidates.',
      normalizedKey: original.normalizedKey,
      reason: 'T16 edit benchmark',
      now: input.now
    })
    assert(edit.result.action === 'edit', `expected edit action, got ${edit.result.action}`)
    assert(edit.result.reviewHash !== oldHash, 'edited candidate kept the old review hash')
    const stalePromote = await promoteCodexPendingMemory({
      cwd: fixture.cwd,
      id: original.id,
      reviewHash: oldHash,
      now: input.now
    })
    assert(stalePromote.result.action === 'conflict', `old edit hash should conflict, got ${stalePromote.result.action}`)
    assert((await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'stale edited hash activated memory')
    return [{ summary: 'edited candidate receives new hash; stale edit hash rejected' }]
  })
}

async function withEmptyFixture(
  input: Parameters<CaseAssertion>[0],
  run: (fixture: Awaited<ReturnType<typeof createBenchmarkFixture>>) => Promise<readonly BenchmarkEvidence[]>
): Promise<readonly BenchmarkEvidence[]> {
  return withFixture(input, [], run)
}

async function withReviewFixture(
  input: Parameters<CaseAssertion>[0],
  pendingMemories: Array<Partial<PendingMemory> & { id: string; content: string }>,
  run: (fixture: Awaited<ReturnType<typeof createBenchmarkFixture>>) => Promise<readonly BenchmarkEvidence[]>
): Promise<readonly BenchmarkEvidence[]> {
  return withFixture(input, pendingMemories, run)
}

async function withFixture(
  input: Parameters<CaseAssertion>[0],
  pendingMemories: Array<Partial<PendingMemory> & { id: string; content: string }>,
  run: (fixture: Awaited<ReturnType<typeof createBenchmarkFixture>>) => Promise<readonly BenchmarkEvidence[]>
): Promise<readonly BenchmarkEvidence[]> {
  const baseInput = {
    caseId: input.benchmarkCase.id,
    seed: input.seed,
    now: input.now,
    pendingMemories
  }
  const fixture = await createBenchmarkFixture(
    input.options.preserveFixtures === true
      ? {
          ...baseInput,
          preserveFixture: true,
          preserveReason: `${input.benchmarkCase.id} preserved because --preserve-fixtures was set`
        }
      : baseInput
  )
  try {
    return await withFixtureEnvironment(fixture, async () => run(fixture))
  } finally {
    try {
      await fixture.cleanup()
    } finally {
      recordFixtureRun(input.options, fixture.metadata)
    }
  }
}

function pendingReviewCandidate(
  id: string,
  overrides: Partial<PendingMemory> = {}
): Partial<PendingMemory> & { id: string; content: string } {
  return {
    id,
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    content: 'Use Codex chat approval and review hash before promoting pending memory.',
    normalizedKey: id,
    evidence: [{ runId: `run-${id}`, summary: 'User confirmed Codex pending review workflow.' }],
    source: 'user_explicit',
    scores: { evidenceStrength: 0.95, stability: 0.9, usefulness: 0.9, safety: 0.95, sensitivity: 0.1 },
    tags: ['benchmark'],
    candidateKind: 'workflow_rule',
    ...overrides
  }
}

function requiredPending(pending: readonly PendingMemory[], id: string): PendingMemory {
  const candidate = pending.find((item) => item.id === id)
  assert(candidate !== undefined, `missing pending candidate ${id}`)
  return candidate
}

async function rootMemoryText(memoryRoot: string): Promise<string> {
  const [active, pending, tombstones, events] = await Promise.all([
    readActiveMemoriesFromRoot(memoryRoot),
    readPendingMemoriesFromRoot(memoryRoot),
    readTombstonesFromRoot(memoryRoot),
    readMemoryEventsFromRoot(memoryRoot)
  ])
  return JSON.stringify({ active, pending, tombstones, events })
}

function caseResult(
  benchmarkCase: BenchmarkCase,
  passed: boolean,
  hardFailures: readonly HardGateRuleId[],
  evidence: readonly BenchmarkEvidence[]
): BenchmarkCaseResult {
  return {
    caseId: benchmarkCase.id,
    title: benchmarkCase.title,
    tier: benchmarkCase.tier,
    status: passed ? 'passed' : 'failed',
    passed,
    hardFailures,
    metrics: defaultMetrics(benchmarkCase, passed),
    evidence,
    thresholdBreaches: []
  }
}

function defaultMetrics(benchmarkCase: BenchmarkCase, passed: boolean): BenchmarkMetric[] {
  return benchmarkCase.metrics.map((metric) => ({ name: metric, value: defaultMetricValue(metric, passed) }))
}

function defaultMetricValue(metric: BenchmarkMetric['name'], passed: boolean): number {
  if (!passed) {
    return metric.includes('Leakage') ||
      metric.includes('Pollution') ||
      metric.includes('Misuse') ||
      metric.includes('Fallback') ||
      metric.includes('Stale') ||
      metric.includes('Interference') ||
      metric.includes('DefaultWrite') ||
      metric.includes('wrongTop1')
      ? 1
      : 0
  }
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
  if (metric.endsWith('Rate') || metric.endsWith('Accuracy') || metric === 'mrr' || metric === 'recallAt3') {
    return 1
  }
  return 0
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}
