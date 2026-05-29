import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { handleCodexHookTraceCommand } from '../src/codex/codex-hook-trace.js'
import { readRecentCodexHookTrace } from '../src/codex/hook-trace-store.js'
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

async function runHookCommand(route: string, input: string, home: string): Promise<{ code: number | null; stderr: string; stdout: string }> {
  const child = spawn(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'hook', route],
    { cwd: process.cwd(), env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] }
  )
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { stdout += chunk })
  child.stderr.on('data', (chunk: string) => { stderr += chunk })
  child.stdin.end(input)

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  return { code, stderr, stdout }
}

describe('Codex lifecycle hook trace command', () => {
  it('writes concise trace records for non-Stop lifecycle hook payloads', async () => {
    const home = await createTempDir('cyrene-hook-trace-command-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-hook-trace-command-project-')

    const output = await handleCodexHookTraceCommand('post_tool_use', JSON.stringify({
      cwd,
      session_id: 'session-1',
      turn_id: 'turn-1',
      tool: {
        name: 'shell',
        id: 'tool-1',
        command: 'npm test -- tests/example.test.ts',
        output: 'tests passed',
        touched_files: ['tests/example.test.ts']
      }
    }))

    expect(JSON.parse(output)).toEqual({ continue: true, suppressOutput: true })
    const trace = await readRecentCodexHookTrace({ cwd })
    expect(trace.records).toHaveLength(1)
    expect(trace.records[0]).toMatchObject({
      event: 'post_tool_use',
      sessionId: 'session-1',
      turnId: 'turn-1',
      summary: 'Tool used: shell',
      tool: {
        name: 'shell',
        useId: 'tool-1',
        commandSummary: 'npm test -- tests/example.test.ts',
        outputSummary: 'tests passed',
        touchedFiles: ['tests/example.test.ts']
      }
    })
  })

  it('fail-opens with suppressed output when stdin is invalid JSON', async () => {
    const output = await handleCodexHookTraceCommand('session_start', '{bad json')

    expect(output).toBe(`${JSON.stringify({ continue: true, suppressOutput: true })}\n`)
  })

  it('captures documented PostToolUse payload fields', async () => {
    const home = await createTempDir('cyrene-hook-trace-post-tool-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-hook-trace-post-tool-project-')

    const output = await handleCodexHookTraceCommand('post_tool_use', JSON.stringify({
      cwd,
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: 'passed'
    }))

    expect(JSON.parse(output)).toEqual({ continue: true, suppressOutput: true })
    const trace = await readRecentCodexHookTrace({ cwd })
    expect(trace.records).toHaveLength(1)
    expect(trace.records[0]).toMatchObject({
      event: 'post_tool_use',
      summary: 'Tool used: Bash',
      signals: ['command=npm test', 'output=passed'],
      tool: {
        name: 'Bash',
        commandSummary: 'npm test',
        outputSummary: 'passed'
      }
    })
  })

  it('CLI recognizes all non-Stop lifecycle hook routes', async () => {
    const home = await createTempDir('cyrene-hook-trace-cli-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-hook-trace-cli-project-')

    for (const route of ['session-start', 'user-prompt-submit', 'post-tool-use']) {
      const result = await runHookCommand(route, JSON.stringify({
        cwd,
        session_id: 'session-cli',
        turn_id: route,
        prompt: 'Please inspect the project hooks.',
        tool_name: 'shell',
        tool_use_id: `tool-${route}`,
        command: 'git status --short',
        output: 'clean'
      }), home)

      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      expect(JSON.parse(result.stdout)).toEqual({ continue: true, suppressOutput: true })
    }

    const trace = await readRecentCodexHookTrace({ cwd })
    expect(trace.records.map((record) => record.event)).toEqual([
      'session_start',
      'user_prompt_submit',
      'post_tool_use'
    ])
  })

  it('plugin hooks config declares all four lifecycle hook commands', async () => {
    const parsed = JSON.parse(await readFile(join(process.cwd(), 'plugin', 'hooks', 'hooks.json'), 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
    }

    expect(Object.keys(parsed.hooks).sort()).toEqual(['PostToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit'])
    expect(parsed.hooks.SessionStart[0]?.hooks[0]?.command).toBe('sh -lc \'exec "$HOME/.cyrene/codex/bin/cyrene-continuity" codex hook session-start\'')
    expect(parsed.hooks.UserPromptSubmit[0]?.hooks[0]?.command).toBe('sh -lc \'exec "$HOME/.cyrene/codex/bin/cyrene-continuity" codex hook user-prompt-submit\'')
    expect(parsed.hooks.PostToolUse[0]?.hooks[0]?.command).toBe('sh -lc \'exec "$HOME/.cyrene/codex/bin/cyrene-continuity" codex hook post-tool-use\'')
    expect(parsed.hooks.Stop[0]?.hooks[0]?.command).toBe('sh -lc \'exec "$HOME/.cyrene/codex/bin/cyrene-continuity" codex hook stop\'')
  })

  it('writes hook-trace.jsonl under the identified project memory root', async () => {
    const home = await createTempDir('cyrene-hook-trace-file-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-hook-trace-file-project-')

    await handleCodexHookTraceCommand('user_prompt_submit', JSON.stringify({ cwd, text: 'Short user request.' }))

    const project = await identifyCodexProject(cwd)
    await expect(readFile(join(codexProjectMemoryRoot(project.projectId), 'hook-trace.jsonl'), 'utf8')).resolves.toContain(
      '"event":"user_prompt_submit"'
    )
  })
})
