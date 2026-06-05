import { SOFT_METRIC_THRESHOLDS } from './thresholds.js'
import type {
  BenchmarkCaseResult,
  BenchmarkMetric,
  BenchmarkMetricId,
  BenchmarkPassFailRuleId,
  BenchmarkProfile,
  BenchmarkReport,
  BenchmarkThreshold,
  BenchmarkThresholdBreach
} from './types.js'

export function scoreCaseResult(
  result: BenchmarkCaseResult,
  profile: BenchmarkProfile,
  passFailRules: readonly BenchmarkPassFailRuleId[] = []
): BenchmarkCaseResult {
  const thresholdBreaches = thresholdBreachesFor(result, profile, passFailRules)
  const hasHardThresholdBreach = thresholdBreaches.some((breach) => breach.severity === 'error')
  const status = result.hardFailures.length > 0 || hasHardThresholdBreach ? 'failed' : result.status
  return {
    ...result,
    status,
    passed: status === 'passed',
    thresholdBreaches
  }
}

export function thresholdBreachesFor(
  result: BenchmarkCaseResult,
  profile: BenchmarkProfile,
  passFailRules: readonly BenchmarkPassFailRuleId[] = []
): BenchmarkThresholdBreach[] {
  const metricsByName = new Map<BenchmarkMetricId, BenchmarkMetric>(result.metrics.map((metric) => [metric.name, metric]))
  return result.metrics.flatMap((metric) => {
    const threshold = SOFT_METRIC_THRESHOLDS.find((item) => {
      return item.metric === metric.name && item.profiles.includes(profile)
    })
    if (threshold === undefined) {
      return []
    }

    const expected = resolveThresholdValue(threshold, metricsByName)
    if (expected === undefined) {
      return []
    }

    const breached = isThresholdBreached(metric.value, threshold.operator, expected)

    if (!breached) {
      return []
    }

    return [{
      caseId: result.caseId,
      metric: metric.name,
      actual: metric.value,
      threshold: `${threshold.operator} ${formatThresholdValue(threshold.value)}`,
      severity: passFailRules.includes(metric.name) ? 'error' : 'warning'
    }]
  })
}

function resolveThresholdValue(
  threshold: BenchmarkThreshold,
  metricsByName: ReadonlyMap<BenchmarkMetricId, BenchmarkMetric>
): number | undefined {
  if (typeof threshold.value === 'number') {
    return threshold.value
  }
  return metricsByName.get(threshold.value)?.value
}

function isThresholdBreached(actual: number, operator: BenchmarkThreshold['operator'], expected: number): boolean {
  if (operator === '<=') {
    return actual > expected
  }
  if (operator === '>=') {
    return actual < expected
  }
  return actual !== expected
}

function formatThresholdValue(value: BenchmarkThreshold['value']): string {
  return typeof value === 'number' ? String(value) : value
}

export function summarizeBenchmarkResults(results: readonly BenchmarkCaseResult[]): BenchmarkReport['summary'] {
  return {
    totalCases: results.length,
    passed: results.filter((item) => item.status === 'passed').length,
    failed: results.filter((item) => item.status === 'failed').length,
    skippedWithReason: results.filter((item) => item.status === 'skipped_with_reason').length,
    notSupportedWithoutProvider: results.filter((item) => item.status === 'not_supported_without_provider').length
  }
}
