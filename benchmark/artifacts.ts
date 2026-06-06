import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BenchmarkProfile } from './types.js'

export interface ArchiveBenchmarkReportsInput {
  outputDir: string
  artifactRoot: string
  profile: BenchmarkProfile | string
}

export async function archiveBenchmarkReports(
  input: ArchiveBenchmarkReportsInput
): Promise<{ jsonPath: string; markdownPath: string }> {
  const profile = safeProfileSegment(input.profile)
  const targetDir = join(input.artifactRoot, profile)
  const jsonPath = join(targetDir, 'benchmark_report.json')
  const markdownPath = join(targetDir, 'benchmark_report.md')
  const [json, markdown] = await Promise.all([
    readFile(join(input.outputDir, 'benchmark_report.json'), 'utf8'),
    readFile(join(input.outputDir, 'benchmark_report.md'), 'utf8')
  ])

  await mkdir(targetDir, { recursive: true })
  await Promise.all([
    writeFile(jsonPath, sanitizeBenchmarkArtifact(json), 'utf8'),
    writeFile(markdownPath, sanitizeBenchmarkArtifact(markdown), 'utf8')
  ])

  return { jsonPath, markdownPath }
}

function safeProfileSegment(profile: BenchmarkProfile | string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(profile)) {
    throw new Error(`Unsafe benchmark artifact profile segment: ${profile}`)
  }
  return profile
}

function sanitizeBenchmarkArtifact(content: string): string {
  return content
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED_SECRET]')
    .replace(/\bghp_[A-Za-z0-9_]+\b/g, '[REDACTED_SECRET]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, '[REDACTED_SECRET]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_SECRET]')
}
