import { createHash } from 'node:crypto'
import { activationPolicyForConfidenceTier } from '../../src/memory/memory-lifecycle.js'
import type { CyreneMemory, MemoryScope } from '../../src/memory/types.js'
import type {
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkFixtureRunMetadata,
  BenchmarkMetric,
  BenchmarkRunOptions,
  HardGateRuleId
} from '../types.js'

export async function timedCase(
  benchmarkCase: BenchmarkCase,
  fn: () => Promise<{
    metrics?: readonly BenchmarkMetric[]
    hardFailures?: readonly HardGateRuleId[]
    evidence: BenchmarkCaseResult['evidence']
  }>
): Promise<BenchmarkCaseResult> {
  try {
    const result = await fn()
    const hardFailures = [...(result.hardFailures ?? [])]
    const status = hardFailures.length === 0 ? 'passed' : 'failed'
    return {
      caseId: benchmarkCase.id,
      title: benchmarkCase.title,
      tier: benchmarkCase.tier,
      status,
      passed: status === 'passed',
      hardFailures,
      metrics: [...(result.metrics ?? [])],
      evidence: result.evidence,
      thresholdBreaches: []
    }
  } catch (error) {
    return {
      caseId: benchmarkCase.id,
      title: benchmarkCase.title,
      tier: benchmarkCase.tier,
      status: 'failed',
      passed: false,
      hardFailures: ['fixture_isolation_violation'],
      metrics: [],
      evidence: [{ summary: error instanceof Error ? error.message : String(error) }],
      thresholdBreaches: []
    }
  }
}

export function forbiddenHits(value: unknown, forbidden: readonly string[]): string[] {
  const text = JSON.stringify(value)
  return forbidden.filter((item) => text.includes(item))
}

export function fixturePreservation(
  options: BenchmarkRunOptions,
  caseId: string
): { preserveFixture?: false; preserveReason?: undefined } | { preserveFixture: true; preserveReason: string } {
  if (options.preserveFixtures === true) {
    return { preserveFixture: true, preserveReason: `preserve fixture for ${caseId}` }
  }
  return {}
}

export function recordFixtureRun(options: BenchmarkRunOptions, metadata: BenchmarkFixtureRunMetadata): void {
  options.fixtureRuns?.push({ ...metadata })
}

export function benchmarkActiveMemory(input: {
  id: string
  content: string
  now: string
  scope?: MemoryScope
  normalizedKey?: string
  portability?: CyreneMemory['portability']
  tags?: string[]
}): CyreneMemory {
  const scope = input.scope ?? 'project'
  const confidenceTier = scope === 'global' ? 'global_core' : 'validated'
  return {
    id: input.id,
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope,
    status: 'active',
    content: input.content,
    normalizedKey: input.normalizedKey ?? stableId(`${input.id}:${input.content}`),
    evidence: [{ runId: 'benchmark', sourceKind: 'user_explicit', summary: 'Benchmark active memory.' }],
    source: 'user_explicit',
    scores: { evidenceStrength: 0.95, stability: 0.9, usefulness: 0.9, safety: 0.95, sensitivity: 0.1 },
    createdAt: input.now,
    updatedAt: input.now,
    tags: input.tags ?? ['benchmark'],
    confidenceTier,
    activationPolicy: activationPolicyForConfidenceTier(confidenceTier),
    portability: input.portability ?? (scope === 'global' ? 'global' : 'local_only')
  }
}

export function approxTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4)
}

function stableId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
