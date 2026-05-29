import { execFile } from 'node:child_process'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot, ensureCodexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { appendCodexHookTrace } from '../src/codex/hook-trace-store.js'
import { collectProjectMemorySignals } from '../src/codex/project-memory-signals.js'
import { identifyCodexProject } from '../src/codex/project-id.js'

const execFileAsync = promisify(execFile)
const originalHome = process.env.HOME
const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function createGitRepo(prefix: string): Promise<string> {
  const repo = await createTempDir(prefix)
  await execFileAsync('git', ['init'], { cwd: repo })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo })
  return repo
}

describe('collectProjectMemorySignals', () => {
  it('collects changed-file signals from a git working tree', async () => {
    const home = await createTempDir('cyrene-project-signals-home-')
    vi.stubEnv('HOME', home)
    const repo = await createGitRepo('cyrene-project-signals-repo-')
    await writeFile(join(repo, 'tracked.ts'), 'export const value = 1\n', 'utf8')
    await execFileAsync('git', ['add', 'tracked.ts'], { cwd: repo })
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repo })
    await writeFile(join(repo, 'tracked.ts'), 'export const value = 2\n', 'utf8')
    await writeFile(join(repo, 'untracked.ts'), 'export const newValue = 1\n', 'utf8')

    const result = await collectProjectMemorySignals({ cwd: repo })

    expect(result.warnings).toEqual([])
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'git_changed_file',
          source: 'git',
          files: expect.arrayContaining(['tracked.ts', 'untracked.ts']),
          evidence: expect.stringContaining('tracked.ts')
        }),
        expect.objectContaining({
          kind: 'git_changed_file',
          source: 'git',
          summary: expect.stringContaining('diff stat'),
          evidence: expect.stringContaining('tracked.ts')
        })
      ])
    )
  })

  it('parses porcelain git status for renamed files with spaces', async () => {
    const home = await createTempDir('cyrene-project-signals-home-')
    vi.stubEnv('HOME', home)
    const repo = await createGitRepo('cyrene-project-signals-rename-')
    await writeFile(join(repo, 'old name.ts'), 'export const value = 1\n', 'utf8')
    await execFileAsync('git', ['add', 'old name.ts'], { cwd: repo })
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repo })
    await execFileAsync('git', ['mv', 'old name.ts', 'new name.ts'], { cwd: repo })

    const result = await collectProjectMemorySignals({ cwd: repo, mode: 'changed_files' })

    expect(result.warnings).toEqual([])
    expect(result.signals).toEqual([
      expect.objectContaining({
        kind: 'git_changed_file',
        source: 'git',
        files: ['new name.ts']
      })
    ])
  })

  it('falls back in a non-git project and still reads project files', async () => {
    const home = await createTempDir('cyrene-project-signals-home-')
    vi.stubEnv('HOME', home)
    const project = await createTempDir('cyrene-project-signals-nogit-')
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ name: 'sample-project', dependencies: { vitest: '^2.0.0' } }),
      'utf8'
    )
    await writeFile(join(project, 'AGENTS.md'), '# Rules\n\nDo not write active memory automatically.\n', 'utf8')

    const result = await collectProjectMemorySignals({ cwd: project })

    expect(result.warnings).toEqual([expect.stringContaining('git status unavailable')])
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'project_manifest',
          source: 'file',
          files: ['package.json'],
          summary: expect.stringContaining('sample-project')
        }),
        expect.objectContaining({
          kind: 'repository_policy',
          source: 'file',
          files: ['AGENTS.md'],
          evidence: expect.stringContaining('Do not write active memory automatically')
        })
      ])
    )
  })

  it('includes recent hook trace and review summary signals', async () => {
    const home = await createTempDir('cyrene-project-signals-home-')
    vi.stubEnv('HOME', home)
    const repo = await createGitRepo('cyrene-project-signals-recent-')
    const project = await identifyCodexProject(repo)
    await ensureCodexProjectMemoryRoot(project.projectId)
    await appendCodexHookTrace({
      cwd: repo,
      event: 'post_tool_use',
      summary: 'Edited collector source.',
      signals: ['project signal collection'],
      tool: { name: 'shell', touchedFiles: ['src/codex/project-memory-signals.ts'] },
      now: '2026-05-28T00:00:00.000Z'
    })
    await appendFile(
      join(codexProjectMemoryRoot(project.projectId), 'review-summaries.jsonl'),
      [
        '{malformed',
        JSON.stringify({
          id: 'summary-old',
          runId: 'run-old',
          createdAt: '2026-05-20T00:00:00.000Z',
          status: 'ok',
          summary: 'Old review summary.',
          redaction: { input: {}, output: {} },
          candidateIds: []
        }),
        JSON.stringify({
          id: 'summary-new',
          runId: 'run-new',
          createdAt: '2026-05-28T01:00:00.000Z',
          status: 'ok',
          summary: 'Review preserved candidateKind metadata.',
          redaction: { input: {}, output: {} },
          candidateIds: ['candidate-1']
        })
      ].join('\n') + '\n',
      'utf8'
    )

    const result = await collectProjectMemorySignals({
      cwd: repo,
      now: '2026-05-29T00:00:00.000Z'
    })

    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'hook_trace',
          source: 'tool_trace',
          summary: expect.stringContaining('Edited collector source'),
          files: ['src/codex/project-memory-signals.ts']
        }),
        expect.objectContaining({
          kind: 'review_summary',
          source: 'review_summary',
          summary: expect.stringContaining('Review preserved candidateKind metadata'),
          evidence: expect.stringContaining('candidate-1')
        })
      ])
    )
    expect(result.warnings).toEqual([expect.stringContaining('Malformed review summary line 1 skipped.')])
  })

  it('honors changed_files mode by focusing on git changed files', async () => {
    const home = await createTempDir('cyrene-project-signals-home-')
    vi.stubEnv('HOME', home)
    const repo = await createGitRepo('cyrene-project-signals-changed-')
    const project = await identifyCodexProject(repo)
    await writeFile(join(repo, 'README.md'), '# Project\n\nStable docs.\n', 'utf8')
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'changed-mode-project' }), 'utf8')
    await execFileAsync('git', ['add', 'README.md', 'package.json'], { cwd: repo })
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repo })
    await ensureCodexProjectMemoryRoot(project.projectId)
    await appendCodexHookTrace({
      cwd: repo,
      event: 'post_tool_use',
      summary: 'Edited unrelated source.',
      signals: ['unrelated signal'],
      tool: { name: 'shell', touchedFiles: ['unrelated.ts'] },
      now: '2026-05-28T00:00:00.000Z'
    })
    await appendFile(
      join(codexProjectMemoryRoot(project.projectId), 'review-summaries.jsonl'),
      JSON.stringify({
        id: 'summary-1',
        runId: 'run-1',
        createdAt: '2026-05-28T01:00:00.000Z',
        status: 'ok',
        summary: 'Unrelated review summary.',
        candidateIds: ['candidate-1']
      }) + '\n',
      'utf8'
    )
    await writeFile(join(repo, 'src.ts'), 'export const changed = true\n', 'utf8')

    const result = await collectProjectMemorySignals({ cwd: repo, mode: 'changed_files' })

    expect(result.signals).toEqual([
      expect.objectContaining({
        kind: 'git_changed_file',
        source: 'git',
        files: ['src.ts']
      })
    ])
    expect(result.signals).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'project_manifest' }),
        expect.objectContaining({ kind: 'documentation' }),
        expect.objectContaining({ kind: 'hook_trace' }),
        expect.objectContaining({ kind: 'review_summary' })
      ])
    )
  })
})
