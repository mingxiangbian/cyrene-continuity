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
  artifactPaths?: {
    jsonPath: string
    markdownPath: string
  }
}

export async function runCodexBenchmark(input: {
  cwd: string
  profile: BenchmarkProfile
  outputDir?: string
  artifactArchiveDir?: string
  baselineReportPath?: string
  preserveFixtures?: boolean
}): Promise<CodexBenchmarkRunResult> {
  const outputDir = input.outputDir ?? join(input.cwd, 'benchmark-results')
  const report = await runCyreneBenchmark({
    cwd: input.cwd,
    profile: input.profile,
    outputDir,
    artifactArchiveDir: input.artifactArchiveDir,
    baselineReportPath: input.baselineReportPath,
    preserveFixtures: input.preserveFixtures
  })
  const artifactPaths = input.artifactArchiveDir === undefined
    ? undefined
    : {
        jsonPath: join(input.artifactArchiveDir, input.profile, 'benchmark_report.json'),
        markdownPath: join(input.artifactArchiveDir, input.profile, 'benchmark_report.md')
      }
  return {
    profile: report.profile,
    passed: report.passed,
    summary: report.summary,
    reportPaths: {
      jsonPath: join(outputDir, 'benchmark_report.json'),
      markdownPath: join(outputDir, 'benchmark_report.md')
    },
    ...(artifactPaths === undefined ? {} : { artifactPaths })
  }
}
