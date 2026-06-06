import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []
const originalHome = process.env.HOME

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function cliEnv(home: string): NodeJS.ProcessEnv {
  const { FORCE_COLOR: _forceColor, NO_COLOR: _noColor, ...env } = process.env
  return { ...env, HOME: home, CYRENE_MEMORY_AUTO_EXTRACT: '0' }
}

describe('benchmark CLI', () => {
  it('runs smoke profile and writes reports', async () => {
    const home = await tempDir('cyrene-benchmark-cli-home-')
    const cwd = await tempDir('cyrene-benchmark-cli-project-')
    const outputDir = await tempDir('cyrene-benchmark-cli-output-')

    const { stderr, stdout } = await execFileAsync(process.execPath, [
      'node_modules/tsx/dist/cli.mjs',
      'src/main.ts',
      '--cwd',
      cwd,
      'codex',
      'benchmark',
      'run',
      '--profile',
      'smoke',
      '--output-dir',
      outputDir
    ], { cwd: process.cwd(), env: cliEnv(home) })

    const payload = JSON.parse(stdout) as {
      profile: string
      passed: boolean
      reportPaths: { jsonPath: string; markdownPath: string }
    }
    expect(stderr).toBe('')
    expect(payload.profile).toBe('smoke')
    expect(payload.passed).toBe(true)
    expect(payload.reportPaths.jsonPath).toContain('benchmark_report.json')
    expect(payload.reportPaths.markdownPath).toContain('benchmark_report.md')
    await expect(readFile(join(outputDir, 'benchmark_report.json'), 'utf8')).resolves.toContain('"profile": "smoke"')
  })

  it('archives reports from the CLI when artifact archive dir is provided', async () => {
    const home = await tempDir('cyrene-benchmark-cli-archive-home-')
    const cwd = await tempDir('cyrene-benchmark-cli-archive-project-')
    const outputDir = await tempDir('cyrene-benchmark-cli-archive-output-')
    const artifactRoot = await tempDir('cyrene-benchmark-cli-archive-artifacts-')

    const { stderr, stdout } = await execFileAsync(process.execPath, [
      'node_modules/tsx/dist/cli.mjs',
      'src/main.ts',
      '--cwd',
      cwd,
      'codex',
      'benchmark',
      'run',
      '--profile',
      'smoke',
      '--output-dir',
      outputDir,
      '--artifact-archive-dir',
      artifactRoot
    ], { cwd: process.cwd(), env: cliEnv(home) })

    const payload = JSON.parse(stdout) as {
      profile: string
      passed: boolean
      artifactPaths: { jsonPath: string; markdownPath: string }
    }
    expect(stderr).toBe('')
    expect(payload.profile).toBe('smoke')
    expect(payload.passed).toBe(true)
    expect(payload.artifactPaths.jsonPath).toBe(join(artifactRoot, 'smoke', 'benchmark_report.json'))
    expect(payload.artifactPaths.markdownPath).toBe(join(artifactRoot, 'smoke', 'benchmark_report.md'))
    await expect(readFile(join(artifactRoot, 'smoke', 'benchmark_report.json'), 'utf8')).resolves.toContain('"profile": "smoke"')
    await expect(readFile(join(artifactRoot, 'smoke', 'benchmark_report.md'), 'utf8')).resolves.toContain('# Cyrene Benchmark Report')
  })

  it('runs real-replay profile from the CLI', async () => {
    const home = await tempDir('cyrene-benchmark-cli-real-home-')
    const cwd = await tempDir('cyrene-benchmark-cli-real-project-')
    const outputDir = await tempDir('cyrene-benchmark-cli-real-output-')

    const { stderr, stdout } = await execFileAsync(process.execPath, [
      'node_modules/tsx/dist/cli.mjs',
      'src/main.ts',
      '--cwd',
      cwd,
      'codex',
      'benchmark',
      'run',
      '--profile',
      'real-replay',
      '--output-dir',
      outputDir
    ], { cwd: process.cwd(), env: cliEnv(home) })

    const payload = JSON.parse(stdout) as {
      profile: string
      passed: boolean
      reportPaths: { jsonPath: string; markdownPath: string }
    }
    expect(stderr).toBe('')
    expect(payload.profile).toBe('real-replay')
    expect(payload.passed).toBe(true)
    await expect(readFile(join(outputDir, 'benchmark_report.json'), 'utf8')).resolves.toContain('"caseId": "T2-REAL-PROJECT-REPLAY"')
  })
})
