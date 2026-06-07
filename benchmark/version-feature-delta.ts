import type {
  BenchmarkCaseResult,
  BenchmarkMetric,
  BenchmarkTier,
  BenchmarkVersionFeatureDelta,
  BenchmarkVersionFeatureSummary
} from './types.js'

const VERSION_DEFINITIONS: ReadonlyArray<{
  version: BenchmarkVersionFeatureSummary['version']
  tier: Extract<BenchmarkTier, 'tier1_5' | 'tier1_6'>
  functionalFocus: string
  capabilityAreas: readonly string[]
  representativeCases: readonly string[]
  keyMetrics: readonly BenchmarkMetric['name'][]
}> = [
  {
    version: 'v1.5',
    tier: 'tier1_5',
    functionalFocus: 'Memory lifecycle and review safety',
    capabilityAreas: [
      'low-risk upgrade policy',
      'replace / merge / expire lifecycle transitions',
      'review-hash protected supersede',
      'conflict and stale-memory suppression',
      'adversarial lifecycle conflict handling'
    ],
    representativeCases: [
      'T15-UPGRADE',
      'T15-REPLACE',
      'T15-MERGE',
      'T15-SUPERSEDE-HASH',
      'T15-ADVERSARIAL-CONFLICT'
    ],
    keyMetrics: [
      'promotionAccuracy',
      'replacementAccuracy',
      'mergeAccuracy',
      'conflictResolutionAccuracy',
      'staleMemoryLeakageRate',
      'duplicateActiveMemoryRate',
      'lifecyclePromotionAccuracy'
    ]
  },
  {
    version: 'v1.6',
    tier: 'tier1_6',
    functionalFocus: 'Memory proposal, routing, review, and relation-model safety',
    capabilityAreas: [
      'important / noise / sensitive proposal filtering',
      'project and global namespace routing',
      'review hash, reject, defer, and edit contracts',
      'relation expansion rules for supersedes / similar / derived / transfer',
      'JSONL fallback scope guard and relation hot-path read-only behavior'
    ],
    representativeCases: [
      'T16-PROPOSE-IMPORTANT',
      'T16-PROPOSE-SENSITIVE',
      'T16-ROUTING-NAMESPACE',
      'T16-REVIEW-HASH-REQUIRED',
      'T16-REL-SUPERSEDES-DIRECTION',
      'T16-REL-FALLBACK-SCOPE-GUARD'
    ],
    keyMetrics: [
      'proposalPrecision',
      'proposalRecall',
      'importantMemoryMissedRate',
      'noiseProposalRate',
      'sensitiveProposalRate',
      'assistantInferenceAutoActiveRate',
      'lifecyclePromotionAccuracy',
      'replacementAccuracy',
      'staleMemoryLeakageRate',
      'crossProjectPollutionRate',
      'similarHintMigrationRate',
      'retrievedDefaultWriteRate',
      'pendingLeakageRate'
    ]
  }
]

export function buildVersionFeatureDelta(
  caseResults: readonly BenchmarkCaseResult[]
): BenchmarkVersionFeatureDelta {
  return {
    note: 'Functional comparison derived from benchmark tier coverage, not a commit-to-commit A/B run.',
    generatedFromTiers: ['tier1_5', 'tier1_6'],
    versions: VERSION_DEFINITIONS.map((definition) => summarizeVersion(definition, caseResults)),
    functionalDifferences: [
      {
        area: 'Memory admission',
        v1_5: 'Validates controlled promotion from pending/trial memory into active memory.',
        v1_6: 'Adds proposal filtering so important evidence is proposed while noise, sensitive content, and assistant-only inference are blocked.'
      },
      {
        area: 'Review integrity',
        v1_5: 'Protects supersede and lifecycle changes with review-hash validation.',
        v1_6: 'Extends review contracts to missing/stale hashes plus reject, defer, and edited-candidate hash refresh behavior.'
      },
      {
        area: 'Memory updates',
        v1_5: 'Checks replace, merge, expire, rollback, and stale active-memory suppression.',
        v1_6: 'Adds relation-driven replacement, relation edge invalidation, and relation expansion constraints.'
      },
      {
        area: 'Boundary safety',
        v1_5: 'Ensures conflicting old/new lifecycle memories do not both enter context.',
        v1_6: 'Adds namespace routing, relation scope guards, transfer hint-only behavior, and trial/pending relation exclusion.'
      },
      {
        area: 'Runtime side effects',
        v1_5: 'Tracks lifecycle receipts, audit growth, and activation-event growth for review actions.',
        v1_6: 'Checks relation expansion stays read-only on hot paths and does not write retrieved/lastUsed state by default.'
      }
    ]
  }
}

function summarizeVersion(
  definition: typeof VERSION_DEFINITIONS[number],
  caseResults: readonly BenchmarkCaseResult[]
): BenchmarkVersionFeatureSummary {
  const results = caseResults.filter((item) => item.tier === definition.tier)
  const executed = results.filter((item) => item.status === 'passed' || item.status === 'failed')
  const passed = results.filter((item) => item.status === 'passed').length
  const failed = results.filter((item) => item.status === 'failed').length
  const skippedWithReason = results.filter((item) => item.status === 'skipped_with_reason').length
  const notSupportedWithoutProvider = results.filter((item) => item.status === 'not_supported_without_provider').length

  return {
    version: definition.version,
    tier: definition.tier,
    functionalFocus: definition.functionalFocus,
    capabilityAreas: definition.capabilityAreas,
    caseCount: results.length,
    executedCaseCount: executed.length,
    passed,
    failed,
    skippedWithReason,
    notSupportedWithoutProvider,
    passRate: executed.length === 0 ? null : roundMetric(passed / executed.length),
    representativeCases: definition.representativeCases,
    keyMetrics: keyMetricSummary(results, definition.keyMetrics)
  }
}

function keyMetricSummary(
  results: readonly BenchmarkCaseResult[],
  metricNames: readonly BenchmarkMetric['name'][]
): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const metricName of metricNames) {
    const values = results.flatMap((result) =>
      result.metrics
        .filter((metric) => metric.name === metricName)
        .map((metric) => metric.value)
    )
    if (values.length > 0) {
      summary[metricName] = roundMetric(aggregateMetric(metricName, values))
    }
  }
  return summary
}

function aggregateMetric(metricName: BenchmarkMetric['name'], values: readonly number[]): number {
  if (values.length === 0) return 0
  const normalized = metricName.toLowerCase()
  if (
    normalized.includes('accuracy') ||
    normalized.includes('precision') ||
    normalized.includes('recall') ||
    normalized.includes('success')
  ) {
    return Math.min(...values)
  }
  return Math.max(...values)
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4))
}
