import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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

async function expectMemoryFileMissing(memoryRoot: string, fileName: string): Promise<void> {
  await expect(readFile(join(memoryRoot, fileName), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
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

  it('no-ops without extraction when memory auto extraction is disabled', async () => {
    const home = await createTempDir('cyrene-codex-stop-disabled-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_MEMORY_AUTO_EXTRACT', '0')
    const cwd = await createTempDir('cyrene-codex-stop-disabled-project-')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, JSON.stringify({ role: 'user', content: '以后默认 spec 和 plan 用中文写。' }) + '\n')
    const callModel = vi.fn(async () => {
      throw new Error('model should not be called when extraction is disabled')
    })

    const result = await handleCodexStopHookPayload(
      { cwd, session_id: 's-disabled', turn_id: 't-disabled', transcript_path: transcript },
      { callModel }
    )

    expect(result).toEqual({ action: 'noop', reason: 'Codex memory auto extraction is disabled.' })
    expect(callModel).not.toHaveBeenCalled()
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await expectMemoryFileMissing(memoryRoot, 'pending.jsonl')
    await expectMemoryFileMissing(memoryRoot, 'review-summaries.jsonl')
  })

  it('records visible failed summary when transcript read fails without blocking Codex', async () => {
    const home = await createTempDir('cyrene-codex-stop-failure-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-failure-project-')
    const transcript = join(cwd, 'transcript-dir')
    await mkdir(transcript)

    const result = await handleCodexStopHookPayload({
      cwd,
      session_id: 's-fail',
      turn_id: 't-fail',
      transcript_path: transcript
    })

    expect(result.action).toBe('summary_failed')
    expect(JSON.parse(formatCodexStopHookCommandOutput(result))).toEqual({ continue: true, suppressOutput: true })
    const identity = await identifyCodexProject(cwd)
    const summaries = await readFile(join(codexProjectMemoryRoot(identity.projectId), 'review-summaries.jsonl'), 'utf8')
    const [summary] = summaries.trim().split('\n').map((line) => JSON.parse(line) as {
      status: string
      sessionId?: string
      turnId?: string
      failureReason?: string
      summary?: string
    })
    expect(summary).toMatchObject({
      status: 'failed',
      sessionId: 's-fail',
      turnId: 't-fail',
      summary: 'Codex Stop hook failed; no transcript content persisted.'
    })
    expect(summary.failureReason).toContain('Transcript path is not a regular file.')
    await expectMemoryFileMissing(codexProjectMemoryRoot(identity.projectId), 'pending.jsonl')
  })

  it('rejects symlinked transcript files without reading the target content', async () => {
    const home = await createTempDir('cyrene-codex-stop-symlink-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-symlink-project-')
    const outside = await createTempDir('cyrene-codex-stop-symlink-outside-')
    const outsideTranscript = join(outside, 'transcript.jsonl')
    const transcript = join(cwd, 'transcript-link.jsonl')
    await writeFile(outsideTranscript, JSON.stringify({ role: 'user', content: '以后默认 spec 和 plan 用中文写。' }) + '\n')
    await symlink(outsideTranscript, transcript)

    const result = await handleCodexStopHookPayload({
      cwd,
      session_id: 's-symlink',
      turn_id: 't-symlink',
      transcript_path: transcript
    })

    expect(result.action).toBe('summary_failed')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await expectMemoryFileMissing(memoryRoot, 'pending.jsonl')
    await expect(readFile(join(memoryRoot, 'review-summaries.jsonl'), 'utf8')).resolves.toContain('Transcript path is a symlink.')
  })

  it('rejects oversized transcript files before extraction', async () => {
    const home = await createTempDir('cyrene-codex-stop-oversized-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-oversized-project-')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, Buffer.alloc(5 * 1024 * 1024 + 1, 'x'))

    const result = await handleCodexStopHookPayload({
      cwd,
      session_id: 's-oversized',
      turn_id: 't-oversized',
      transcript_path: transcript
    })

    expect(result.action).toBe('summary_failed')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await expectMemoryFileMissing(memoryRoot, 'pending.jsonl')
    await expect(readFile(join(memoryRoot, 'review-summaries.jsonl'), 'utf8')).resolves.toContain(
      'Transcript path exceeds the maximum readable size.'
    )
  })

  it('rejects absolute transcript files outside the project cwd and Codex home', async () => {
    const home = await createTempDir('cyrene-codex-stop-external-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-external-project-')
    const outside = await createTempDir('cyrene-codex-stop-external-transcript-')
    const transcript = join(outside, 'transcript.jsonl')
    await writeFile(transcript, JSON.stringify({ role: 'user', content: '以后默认 spec 和 plan 用中文写。' }) + '\n')
    const callModel = vi.fn(async () => {
      throw new Error('model should not be called for external transcript paths')
    })

    const result = await handleCodexStopHookPayload(
      { cwd, session_id: 's-external', turn_id: 't-external', transcript_path: transcript },
      { callModel }
    )

    expect(result.action).toBe('summary_failed')
    expect(callModel).not.toHaveBeenCalled()
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await expectMemoryFileMissing(memoryRoot, 'pending.jsonl')
    await expect(readFile(join(memoryRoot, 'review-summaries.jsonl'), 'utf8')).resolves.toContain(
      'Transcript path must be inside the project cwd or Codex home.'
    )
  })

  it('allows absolute transcript files under Codex home', async () => {
    const home = await createTempDir('cyrene-codex-stop-codex-home-')
    vi.stubEnv('HOME', home)
    const codexHome = join(home, '.codex')
    vi.stubEnv('CODEX_HOME', codexHome)
    const cwd = await createTempDir('cyrene-codex-stop-codex-home-project-')
    await mkdir(join(codexHome, 'sessions'), { recursive: true })
    const transcript = join(codexHome, 'sessions', 'transcript.jsonl')
    await writeFile(transcript, JSON.stringify({ role: 'user', content: '普通讨论' }) + '\n')

    const result = await handleCodexStopHookPayload(
      { cwd, session_id: 's-codex-home', turn_id: 't-codex-home', transcript_path: transcript },
      {
        callModel: async () => ({
          content: JSON.stringify({ summary: 'Codex home transcript was summarized.', candidates: [] }),
          toolCalls: []
        })
      }
    )

    expect(result.action).toBe('summary')
    const identity = await identifyCodexProject(cwd)
    await expect(readFile(join(codexProjectMemoryRoot(identity.projectId), 'review-summaries.jsonl'), 'utf8')).resolves.toContain(
      'Codex home transcript was summarized.'
    )
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
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await expect(readFile(join(memoryRoot, 'review-summaries.jsonl'), 'utf8')).resolves.toContain(
      'User asked to remember a sensitive self-description.'
    )
    await expectMemoryFileMissing(memoryRoot, 'pending.jsonl')
    await expectMemoryFileMissing(memoryRoot, 'index.jsonl')
    await expectMemoryFileMissing(memoryRoot, 'tombstones.jsonl')
    await expectMemoryFileMissing(memoryRoot, 'events.jsonl')
  })

  it('does not write tombstones or active memory when summary candidate is rejected by validator', async () => {
    const home = await createTempDir('cyrene-codex-stop-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-project-')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, JSON.stringify({ role: 'user', content: '普通协作总结。' }) + '\n')

    const result = await handleCodexStopHookPayload(
      { cwd, transcript_path: transcript, session_id: 's1', turn_id: 't-reject' },
      {
        callModel: async () => ({
          content: JSON.stringify({
            summary: 'Summary contains a rejected candidate.',
            candidates: [
              {
                domain: 'affective',
                type: 'affective_pattern',
                content: 'The user is emotionally dependent and unstable.',
                evidence: [{ summary: 'Unsafe diagnostic claim.' }]
              }
            ]
          }),
          toolCalls: []
        })
      }
    )

    expect(result.action).toBe('summary')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await expect(readFile(join(memoryRoot, 'review-summaries.jsonl'), 'utf8')).resolves.toContain(
      'Summary contains a rejected candidate.'
    )
    await expectMemoryFileMissing(memoryRoot, 'pending.jsonl')
    await expectMemoryFileMissing(memoryRoot, 'index.jsonl')
    await expectMemoryFileMissing(memoryRoot, 'tombstones.jsonl')
    await expectMemoryFileMissing(memoryRoot, 'events.jsonl')
  })

  it('writes review summary and pending candidate without mutating active memory or profile', async () => {
    const home = await createTempDir('cyrene-codex-stop-pipeline-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-pipeline-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'index.jsonl'), `${JSON.stringify({
      id: 'active-1',
      domain: 'project',
      type: 'project_fact',
      strength: 'hard',
      scope: 'project',
      status: 'active',
      content: 'Existing active memory must remain unchanged.',
      normalizedKey: 'existing-active-memory',
      evidence: [{ runId: 'active-run', summary: 'Existing active seed.' }],
      source: 'file',
      scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 },
      createdAt: '2026-05-28T00:00:00.000Z',
      updatedAt: '2026-05-28T00:00:00.000Z',
      tags: ['seed']
    })}\n`)
    await writeFile(join(memoryRoot, 'MODEL_PROFILE.md'), '# Existing Profile\n')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, [
      JSON.stringify({ role: 'user', content: '这个项目的 memory 审批要用 review hash。' }),
      JSON.stringify({ role: 'assistant', content: '确认。' })
    ].join('\n') + '\n')

    const result = await handleCodexStopHookPayload(
      { cwd, transcript_path: transcript, session_id: 's-pipeline', turn_id: 't-pipeline' },
      {
        callModel: async () => ({
          content: JSON.stringify({
            summary: '用户要求项目 memory 审批使用 review hash。',
            candidates: [
              {
                domain: 'procedural',
                type: 'procedural_rule',
                strength: 'hard',
                scope: 'project',
                source: 'user_explicit',
                content: '项目 memory 审批必须使用 review hash。',
                evidence: [{ summary: '用户要求项目 memory 审批使用 review hash。' }]
              }
            ]
          }),
          toolCalls: []
        })
      }
    )

    expect(result.action).toBe('pending')
    await expect(readFile(join(memoryRoot, 'review-summaries.jsonl'), 'utf8')).resolves.toContain(
      '用户要求项目 memory 审批使用 review hash。'
    )
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(
      '项目 memory 审批必须使用 review hash。'
    )
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toContain(
      'Existing active memory must remain unchanged.'
    )
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.not.toContain(
      '项目 memory 审批必须使用 review hash。'
    )
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toBe('# Existing Profile\n')
    await expectMemoryFileMissing(memoryRoot, 'tombstones.jsonl')
    await expect(readFile(join(memoryRoot, 'events.jsonl'), 'utf8')).resolves.toContain('"action":"pending"')
    await expect(readFile(join(memoryRoot, 'events.jsonl'), 'utf8')).resolves.not.toContain('"action":"promote"')
    await expect(readFile(join(memoryRoot, 'events.jsonl'), 'utf8')).resolves.not.toContain('"action":"reject"')
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
