import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import {
  filterExistingPendingCandidateIds,
  formatCodexStopHookCommandOutput,
  handleCodexStopHookPayload
} from '../src/codex/codex-hook-stop.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import type { PendingMemory } from '../src/memory/types.js'

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

function createPending(id: string): PendingMemory {
  return {
    id,
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'Confirmed pending memory must exist in the store before review.',
    normalizedKey: `confirmed-pending-${id}`,
    evidence: [{ runId: 'run-1', summary: 'Test pending candidate.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.9,
      usefulness: 0.8,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-05-26T00:00:00.000Z',
    lastSeenAt: '2026-05-26T00:00:00.000Z',
    expiresAt: '2026-06-25T00:00:00.000Z',
    tags: ['codex-hook']
  }
}

async function runStopHookCommand(input: string): Promise<{ code: number | null; stderr: string; stdout: string }> {
  const child = spawn(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'hook', 'stop'],
    { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] }
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

describe('Codex Stop hook runtime', () => {
  it('no-ops when transcript is missing', async () => {
    const home = await createTempDir('cyrene-codex-stop-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-project-')

    const result = await handleCodexStopHookPayload({ cwd, session_id: 's1', turn_id: 't1' })

    expect(result.action).toBe('noop')
    const identity = await identifyCodexProject(cwd)
    await expect(readFile(join(codexProjectMemoryRoot(identity.projectId), 'pending.jsonl'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('writes pending memory for explicit durable user instruction', async () => {
    const home = await createTempDir('cyrene-codex-stop-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-project-')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(
      transcript,
      [
        JSON.stringify({ role: 'user', content: '以后默认 Cyrene 的 spec 和 plan 用中文写。' }),
        JSON.stringify({ role: 'assistant', content: '已确认。' })
      ].join('\n') + '\n'
    )

    const result = await handleCodexStopHookPayload({
      cwd,
      session_id: 's1',
      turn_id: 't1',
      transcript_path: transcript,
      last_assistant_message: '已确认。'
    })

    expect(result.action).toBe('pending')
    const identity = await identifyCodexProject(cwd)
    const pending = await readFile(join(codexProjectMemoryRoot(identity.projectId), 'pending.jsonl'), 'utf8')
    expect(pending).toContain('以后默认 Cyrene 的 spec 和 plan 用中文写。')
    const [pendingRecord] = pending.trim().split('\n').map((line) => JSON.parse(line) as {
      evidence: Array<{ sessionId?: string; evidenceGroupId?: string; sourceKind?: string }>
    })
    expect(pendingRecord.evidence[0]).toMatchObject({
      sessionId: 's1',
      sourceKind: 'user_explicit'
    })
    expect(pendingRecord.evidence[0]?.evidenceGroupId).toMatch(/^[a-f0-9]{64}$/)
    await expect(readFile(join(codexProjectMemoryRoot(identity.projectId), 'index.jsonl'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('writes all-project explicit durable instructions to global pending memory', async () => {
    const home = await createTempDir('cyrene-codex-stop-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-project-')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(
      transcript,
      [
        JSON.stringify({ role: 'user', content: '记住：以后在所有项目里，所有 spec 和 plan 默认用中文写。' }),
        JSON.stringify({ role: 'assistant', content: '已记录为全局规则。' })
      ].join('\n') + '\n'
    )

    const result = await handleCodexStopHookPayload({
      cwd,
      session_id: 's-global',
      turn_id: 't-global',
      transcript_path: transcript
    })

    expect(result.action).toBe('pending')
    const globalPending = await readFile(join(home, '.cyrene', 'codex', 'global', 'memory', 'pending.jsonl'), 'utf8')
    expect(globalPending).toContain('"scope":"global"')
    expect(globalPending).toContain('以后在所有项目里，所有 spec 和 plan 默认用中文写。')

    const identity = await identifyCodexProject(cwd)
    await expect(readFile(join(codexProjectMemoryRoot(identity.projectId), 'pending.jsonl'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('keeps command output valid while internal runtime writes review summaries', async () => {
    const home = await createTempDir('cyrene-codex-stop-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-project-')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, JSON.stringify({ role: 'user', content: '普通讨论' }) + '\n')

    const result = await handleCodexStopHookPayload(
      { cwd, transcript_path: transcript, session_id: 's1', turn_id: 't1' },
      {
        callModel: async () => ({
          content: JSON.stringify({ summary: '普通讨论，无长期记忆。', candidates: [] }),
          toolCalls: []
        })
      }
    )

    expect(result.action).toBe('summary')
    const output = formatCodexStopHookCommandOutput(result)
    expect(JSON.parse(output)).toEqual({ continue: true, suppressOutput: true })
  })

  it('keeps review summary when explicit durable fallback is rejected', async () => {
    const home = await createTempDir('cyrene-codex-stop-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-project-')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, JSON.stringify({ role: 'user', content: 'Please remember that I am anxious.' }) + '\n')

    const result = await handleCodexStopHookPayload(
      { cwd, transcript_path: transcript, session_id: 's1', turn_id: 't1' },
      {
        callModel: async () => ({
          content: JSON.stringify({ summary: 'User asked to remember a sensitive self-description.', candidates: [] }),
          toolCalls: []
        })
      }
    )

    expect(result.action).toBe('summary')
  })

  it('still proposes explicit durable memory when review summary model fails', async () => {
    const home = await createTempDir('cyrene-codex-stop-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-project-')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, JSON.stringify({ role: 'user', content: '以后默认 spec 和 plan 用中文写。' }) + '\n')

    const result = await handleCodexStopHookPayload(
      { cwd, transcript_path: transcript, session_id: 's1', turn_id: 't2' },
      {
        callModel: async () => {
          throw new Error('model unavailable')
        }
      }
    )

    expect(result.action).toBe('pending')
  })

  it('keeps pending proposal fail-open when the dream due marker fails', async () => {
    const home = await createTempDir('cyrene-codex-stop-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(join(memoryRoot, 'dream-state.json'), { recursive: true })
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, JSON.stringify({ role: 'user', content: '以后默认 spec 和 plan 用中文写。' }) + '\n')

    const result = await handleCodexStopHookPayload(
      { cwd, transcript_path: transcript, session_id: 's1', turn_id: 't-dream-fail' },
      {
        callModel: async () => {
          throw new Error('model unavailable')
        }
      }
    )

    expect(result.action).toBe('pending')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain('以后默认 spec 和 plan 用中文写。')
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(formatCodexStopHookCommandOutput(result))).toEqual({ continue: true, suppressOutput: true })
  })

  it('does not return pending when proposed candidate ids are not confirmed in pending storage', async () => {
    const home = await createTempDir('cyrene-codex-stop-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-project-')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, JSON.stringify({ role: 'user', content: '请总结这次协作。' }) + '\n')

    const result = await handleCodexStopHookPayload(
      { cwd, transcript_path: transcript, session_id: 's1', turn_id: 't3' },
      {
        callModel: async () => ({
          content: JSON.stringify({
            summary: '用户希望总结协作。',
            candidates: [
              {
                domain: 'project',
                type: 'project_fact',
                content: 'This candidate should be confirmed before review.'
              }
            ]
          }),
          toolCalls: []
        }),
        confirmPendingCandidateIds: async () => []
      }
    )

    expect(result).toMatchObject({
      action: 'summary',
      reason: 'Codex review summary written; pending candidates were not confirmed in memory storage.'
    })
  })

  it('filters pending candidate ids through the actual pending storage', async () => {
    const home = await createTempDir('cyrene-codex-stop-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), `${JSON.stringify(createPending('pending-1'))}\n`)

    await expect(filterExistingPendingCandidateIds(cwd, ['pending-1', 'missing-1', 'pending-1'])).resolves.toEqual([
      'pending-1'
    ])
  })

  it('formats command output as valid Codex Stop hook JSON', () => {
    const output = formatCodexStopHookCommandOutput({
      action: 'noop',
      reason: 'No explicit durable user instruction found.'
    })
    const parsed = JSON.parse(output) as Record<string, unknown>

    expect(parsed).toEqual({
      continue: true,
      suppressOutput: true
    })
    expect(output).toMatch(/\n$/)
    expect(parsed).not.toHaveProperty('action')
  })

  it('keeps command output fail-open when stdin is invalid JSON', async () => {
    const result = await runStopHookCommand('{bad json')

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    expect(parsed).toEqual({
      continue: true,
      suppressOutput: true
    })
    expect(parsed).not.toHaveProperty('action')
  })
})
