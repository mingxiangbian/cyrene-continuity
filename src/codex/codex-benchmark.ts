import { join } from 'node:path'
import { runCyreneBenchmark } from '../../benchmark/runner.js'
import type { BenchmarkProfile, BenchmarkReport } from '../../benchmark/types.js'

export interface CodexBenchmarkRunResult {
  profile: BenchmarkProfile
  passed: boolean
  summary: BenchmarkReport['summary']
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
