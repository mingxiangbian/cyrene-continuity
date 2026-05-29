import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot, ensureCodexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { appendCodexHookTrace, readRecentCodexHookTrace } from '../src/codex/hook-trace-store.js'
import { identifyCodexProject } from '../src/codex/project-id.js'

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

describe('Codex hook trace store', () => {
  it('appends and reads recent hook trace records from the project memory root', async () => {
    const home = await createTempDir('cyrene-hook-trace-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-hook-trace-project-')
    const project = await identifyCodexProject(cwd)

    const appended = await appendCodexHookTrace({
      cwd,
      event: 'session_start',
      sessionId: 'session-1',
      turnId: 'turn-1',
      summary: 'Session started.',
      signals: ['active project'],
      now: '2026-05-29T00:00:00.000Z'
    })

    expect(appended).toMatchObject({
      createdAt: '2026-05-29T00:00:00.000Z',
      sessionId: 'session-1',
      turnId: 'turn-1',
      event: 'session_start',
      cwd: project.cwd,
      summary: 'Session started.',
      signals: ['active project']
    })
    expect(appended.id).toHaveLength(36)

    const tracePath = join(codexProjectMemoryRoot(project.projectId), 'hook-trace.jsonl')
    const raw = await readFile(tracePath, 'utf8')
    expect(raw).toContain('"event":"session_start"')

    await expect(readRecentCodexHookTrace({ cwd })).resolves.toMatchObject({
      records: [appended],
      warnings: []
    })
  })

  it('does not create the project memory root when reading missing traces', async () => {
    const home = await createTempDir('cyrene-hook-trace-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-hook-trace-project-')
    const project = await identifyCodexProject(cwd)

    await expect(readRecentCodexHookTrace({ cwd })).resolves.toEqual({
      records: [],
      warnings: []
    })
    await expect(lstat(codexProjectMemoryRoot(project.projectId))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('redacts secret-like content before writing trace records', async () => {
    const home = await createTempDir('cyrene-hook-trace-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-hook-trace-project-')
    const project = await identifyCodexProject(cwd)

    await appendCodexHookTrace({
      cwd,
      event: 'post_tool_use',
      summary: 'Used token sk-abcdefghijklmnopqrstuvwxyz.',
      signals: ['Bearer abcdefghijklmnopqrstuvwxyz'],
      tool: {
        name: 'shell',
        useId: 'tool-1',
        commandSummary: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz"',
        touchedFiles: ['src/index.ts'],
        outputSummary: 'failure included sk-abcdefghijklmnopqrstuvwxyz'
      },
      now: '2026-05-29T00:00:00.000Z'
    })

    const tracePath = join(codexProjectMemoryRoot(project.projectId), 'hook-trace.jsonl')
    const raw = await readFile(tracePath, 'utf8')
    expect(raw).toContain('[REDACTED_SECRET]')
    expect(raw).not.toContain('sk-abc')
  })

  it('skips malformed trace JSONL lines and returns warnings', async () => {
    const home = await createTempDir('cyrene-hook-trace-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-hook-trace-project-')
    const project = await identifyCodexProject(cwd)
    const tracePath = join(codexProjectMemoryRoot(project.projectId), 'hook-trace.jsonl')

    await appendCodexHookTrace({
      cwd,
      event: 'user_prompt_submit',
      summary: 'Prompt submitted.',
      now: '2026-05-29T00:00:00.000Z'
    })
    await writeFile(
      tracePath,
      [
        '{malformed',
        JSON.stringify({
          id: 'record-2',
          createdAt: '2026-05-29T00:01:00.000Z',
          event: 'stop',
          cwd,
          summary: 'Stopped.',
          signals: []
        })
      ].join('\n') + '\n',
      'utf8'
    )

    const result = await readRecentCodexHookTrace({ cwd })

    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.id).toBe('record-2')
    expect(result.warnings).toEqual([expect.stringContaining('Malformed hook trace line')])
  })

  it('skips valid JSON trace lines with invalid record shapes and returns warnings', async () => {
    const home = await createTempDir('cyrene-hook-trace-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-hook-trace-project-')
    const project = await identifyCodexProject(cwd)
    await ensureCodexProjectMemoryRoot(project.projectId)
    const tracePath = join(codexProjectMemoryRoot(project.projectId), 'hook-trace.jsonl')
    const validRecord = {
      id: 'record-1',
      createdAt: '2026-05-29T00:00:00.000Z',
      event: 'user_prompt_submit',
      cwd,
      summary: 'Prompt submitted.',
      signals: ['active project']
    }

    await writeFile(
      tracePath,
      [
        JSON.stringify({}),
        JSON.stringify({ id: 'bad', createdAt: null }),
        JSON.stringify({
          id: 'bad-timestamp',
          createdAt: 'zzzz',
          event: 'stop',
          cwd,
          summary: 'Bad timestamp.',
          signals: []
        }),
        JSON.stringify(validRecord)
      ].join('\n') + '\n',
      'utf8'
    )

    const result = await readRecentCodexHookTrace({ cwd })

    expect(result.records).toEqual([validRecord])
    expect(result.warnings).toHaveLength(3)
    expect(result.warnings).toEqual([
      expect.stringContaining('Malformed hook trace line'),
      expect.stringContaining('Malformed hook trace line'),
      expect.stringContaining('Malformed hook trace line')
    ])
  })

  it('limits recent trace records by count and age', async () => {
    const home = await createTempDir('cyrene-hook-trace-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-hook-trace-project-')

    await appendCodexHookTrace({
      cwd,
      event: 'session_start',
      summary: 'Old session.',
      now: '2026-05-20T00:00:00.000Z'
    })
    await appendCodexHookTrace({
      cwd,
      event: 'user_prompt_submit',
      summary: 'Recent prompt.',
      now: '2026-05-28T00:00:00.000Z'
    })
    await appendCodexHookTrace({
      cwd,
      event: 'stop',
      summary: 'Newest stop.',
      now: '2026-05-29T00:00:00.000Z'
    })

    const limited = await readRecentCodexHookTrace({ cwd, limit: 1 })
    expect(limited.records).toMatchObject([{ summary: 'Newest stop.' }])

    const empty = await readRecentCodexHookTrace({ cwd, limit: 0 })
    expect(empty.records).toEqual([])

    const negative = await readRecentCodexHookTrace({ cwd, limit: -1 })
    expect(negative.records).toEqual([])

    const recent = await readRecentCodexHookTrace({
      cwd,
      now: '2026-05-29T00:00:00.000Z',
      maxAgeDays: 7
    })
    expect(recent.records.map((record) => record.summary)).toEqual(['Recent prompt.', 'Newest stop.'])
  })

  it('sorts trace records by parsed timestamp instead of lexical timestamp order', async () => {
    const home = await createTempDir('cyrene-hook-trace-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-hook-trace-project-')

    await appendCodexHookTrace({
      cwd,
      event: 'session_start',
      summary: 'Chronologically older offset timestamp.',
      now: '2026-05-29T02:00:00+02:00'
    })
    await appendCodexHookTrace({
      cwd,
      event: 'stop',
      summary: 'Chronologically newer UTC timestamp.',
      now: '2026-05-29T01:00:00.000Z'
    })

    const limited = await readRecentCodexHookTrace({ cwd, limit: 1 })

    expect(limited.records).toMatchObject([{ summary: 'Chronologically newer UTC timestamp.' }])
  })
})
