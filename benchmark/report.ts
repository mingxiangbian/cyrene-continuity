import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BenchmarkReport } from './types.js'

export async function writeBenchmarkReports(
  outputDir: string,
  report: BenchmarkReport
): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(outputDir, { recursive: true })
  const jsonPath = join(outputDir, 'benchmark_report.json')
  const markdownPath = join(outputDir, 'benchmark_report.md')
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(markdownPath, renderBenchmarkReportMarkdown(report), 'utf8')
  return { jsonPath, markdownPath }
}

export function renderBenchmarkReportMarkdown(report: BenchmarkReport): string {
  const hardFailures = report.hardFailures.length === 0
    ? '- None'
    : report.hardFailures.map((item) => `- ${inlineMarkdownText(item)}`).join('\n')
  const failedCases = report.failedCases.length === 0
    ? '- None'
    : report.failedCases.map((item) => `- ${item.caseId}: ${inlineMarkdownText(item.title)}`).join('\n')
  const thresholdBreaches = report.thresholdBreaches.length === 0
    ? '- None'
    : report.thresholdBreaches
      .map((item) => `- ${item.severity.toUpperCase()} ${item.caseId} ${item.metric}: ${item.actual} (${item.threshold})`)
      .join('\n')
  const profileCaveat = renderProfileCaveat(report)
  const metricAggregation = renderMetricAggregation(report)
  const skippedCases = report.caseResults.filter((item) => item.status === 'skipped_with_reason')
  const unsupportedCases = report.caseResults.filter((item) => item.status === 'not_supported_without_provider')
  const caseMetricDetails = report.caseResults
    .filter((item) => item.metrics.length > 0)
    .map((item) => {
      const metrics = item.metrics.map((metric) => `${metric.name}: ${metric.value}${metric.unit ?? ''}`).join(', ')
      return `- ${item.caseId}: ${metrics}`
    })
    .join('\n')
  const fixtureRuns = report.fixtureRuns === undefined || report.fixtureRuns.length === 0
    ? '- None'
    : report.fixtureRuns.map((fixture) => {
      const preserveReason = fixture.preserveReason === undefined ? '' : `, reason=${inlineMarkdownText(fixture.preserveReason)}`
      return `- ${inlineMarkdownText(fixture.root)}: cleanup=${fixture.cleanupStatus}, preserve=${fixture.preserveFixture}${preserveReason}, seed=${inlineMarkdownText(fixture.seed)}, clock=${fixture.clock}, timezone=${fixture.timezone}, home=${inlineMarkdownText(fixture.home)}, cwd=${inlineMarkdownText(fixture.cwd)}`
    }).join('\n')
  const cases = report.caseResults.length === 0
    ? '- None'
    : report.caseResults.map((item) => {
      const evidence = item.evidence.map((evidenceItem) => evidenceItem.summary).join('; ')
      return `- ${item.status.toUpperCase()} ${item.caseId}: ${inlineMarkdownText(item.title)}${evidence === '' ? '' : ` - ${inlineMarkdownText(evidence)}`}`
    }).join('\n')

  return `# Cyrene Benchmark Report

Run ID: ${report.runId}
Profile: ${report.profile}
Passed: ${report.passed}
Started: ${report.startedAt}
Completed: ${report.completedAt}

## Summary

- Total cases: ${report.summary.totalCases}
- Passed: ${report.summary.passed}
- Failed: ${report.summary.failed}
- Skipped with reason: ${report.summary.skippedWithReason}
- Not supported without provider: ${report.summary.notSupportedWithoutProvider}

## Profile Caveat

${profileCaveat}

## Failed Cases

${failedCases}

## Skipped Cases

${skippedCases.length === 0 ? '- None' : skippedCases.map((item) => `- ${item.caseId}: ${inlineMarkdownText(item.skippedReason ?? 'skipped')}`).join('\n')}

## Unsupported Cases

${unsupportedCases.length === 0 ? '- None' : unsupportedCases.map((item) => `- ${item.caseId}: ${inlineMarkdownText(item.skippedReason ?? 'provider not configured')}`).join('\n')}

## Capability Metrics

${renderMetricGroup(report.metrics.capability)}

## Boundary Safety Metrics

${renderMetricGroup(report.metrics.boundarySafety)}

## Efficiency Metrics

${renderMetricGroup(report.metrics.efficiency)}

## Task Utility Metrics

${renderMetricGroup(report.metrics.taskUtility)}

## Metric Aggregation

${metricAggregation}

## Case Metric Details

${caseMetricDetails === '' ? '- None' : caseMetricDetails}

## Scale Results

${renderObjectSection(report.scaleResults)}

## Regression Comparison

${renderObjectSection(report.regressionComparison)}

## Fixture Runs

${fixtureRuns}

## Spec

- Path: ${report.spec.path}
- Title: ${report.spec.title}
- Date: ${report.spec.date}
- Hash: ${report.spec.contentHash}

## Benchmark

- Version: ${report.benchmark.version}
- Threshold version: ${report.benchmark.thresholdVersion}
- Case catalog hash: ${report.benchmark.caseCatalogHash}

## Package

- Name: ${report.package.name}
- Version: ${report.package.version}

## Git

- Branch: ${report.git.branch}
- Commit: ${report.git.commit}
- Dirty: ${report.git.dirty}
- Tracked changes: ${report.git.trackedChanges.length === 0 ? 'none' : report.git.trackedChanges.join(', ')}

## Runtime

- Node: ${report.runtime.nodeVersion}
- npm: ${report.runtime.npmVersion ?? 'unknown'}
- Platform: ${report.runtime.platform}
- Arch: ${report.runtime.arch}

## Hard Failures

${hardFailures}

## Threshold Breaches

${thresholdBreaches}

## Case Results

${cases}
`
}

function renderMetricGroup(metrics: Record<string, number>): string {
  const entries = Object.entries(metrics)
  if (entries.length === 0) {
    return '- None'
  }
  return entries.map(([name, value]) => `- ${name}: ${value}`).join('\n')
}

function renderMetricAggregation(report: BenchmarkReport): string {
  const entries = Object.entries(report.metricAggregation ?? {})
    .filter(([, aggregation]) => aggregation.sampleCount > 1)
    .sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) {
    return '- None'
  }
  return entries
    .map(([name, aggregation]) => {
      const sources = aggregation.sourceCaseIds.map((caseId) => inlineMarkdownText(caseId)).join(', ')
      return `- ${name}: group=${aggregation.group}, strategy=${aggregation.strategy}, samples=${aggregation.sampleCount}, sources=${sources}`
    })
    .join('\n')
}

function renderProfileCaveat(report: BenchmarkReport): string {
  const caveats: string[] = []
  if (report.profile === 'llm') {
    caveats.push('`llm` profile reports configured adapter coverage only; unsupported provider cases are not completed live LLM comparisons.')
  } else if (report.profile === 'external') {
    caveats.push('`external` profile requires configured external adapters; unsupported cases are adapter availability gaps, not competitive results.')
  }
  if (report.profile === 'scale' || report.profile === 'full') {
    caveats.push('Scale L/XL results may combine target-scale synthetic runtime with capped materialized fixture storage; use case evidence before treating storage values as full target materialization.')
  }
  if (caveats.length === 0) {
    caveats.push('This profile is bounded by deterministic fixtures unless a provider-backed adapter is explicitly configured.')
  }
  return caveats.map((item) => `- ${item}`).join('\n')
}

function renderObjectSection(value: unknown): string {
  if (value === undefined) {
    return '- None'
  }
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
}

function inlineMarkdownText(value: string): string {
  return value.replace(/```/g, "'''").replace(/\s+/g, ' ').trim()
}
