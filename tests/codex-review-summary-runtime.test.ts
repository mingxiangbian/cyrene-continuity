import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { buildCodexReviewSummaryPrompt, runCodexReviewSummary } from '../src/codex/review-summary-runtime.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { createDefaultConfig, type AppConfig } from '../src/config.js'
import type { CallModelInput, ModelResponse } from '../src/llm-client.js'

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

function createConfig(cwd: string): AppConfig {
  const config = createDefaultConfig(cwd)
  return {
    ...config,
    cwd,
    memoryCwd: cwd,
    model: {
      ...config.model,
      baseUrl: 'https://example.test',
      model: 'strong',
      apiKey: undefined,
      temperature: 0,
      strongModel: 'strong',
      cheapModel: 'cheap'
    },
    userCyreneDir: join(cwd, '.cyrene')
  }
}

function modelResponse(content: string): ModelResponse {
  return { content, toolCalls: [] }
}

async function readReviewSummaries(cwd: string): Promise<string> {
  const identity = await identifyCodexProject(cwd)
  return readFile(join(codexProjectMemoryRoot(identity.projectId), 'review-summaries.jsonl'), 'utf8')
}

describe('Codex review summary runtime', () => {
  it('asks generated memory text to use Chinese while preserving English terms', () => {
    const prompt = buildCodexReviewSummaryPrompt('User discussed API workflow and README.md.')

    expect(prompt).toContain('Write generated memory summaries, candidate content, and evidence summaries in Chinese by default.')
    expect(prompt).toContain('Keep English proper nouns and technical terms such as file paths, commands, APIs, libraries, model names, field names, and identifiers in English.')
  })

  it('writes a redacted summary without pending candidates', async () => {
    const home = await createTempDir('cyrene-review-runtime-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-runtime-project-')
    const config = createConfig(cwd)
    const callModel = vi.fn(async (input: CallModelInput) => {
      expect(input.useCase).toBe('memory_extraction')
      return modelResponse(JSON.stringify({ summary: '用户要求整理 review-safe summary。', candidates: [] }))
    })

    const result = await runCodexReviewSummary({
      cwd,
      sessionId: 's1',
      turnId: 't1',
      messages: [{ role: 'user', content: '请总结本轮 review。' }],
      config,
      callModel,
      now: '2026-05-26T00:00:00.000Z'
    })

    expect(result.action).toBe('summary')
    if (result.action !== 'summary') throw new Error(`Expected summary, got ${result.action}`)
    expect(result.candidateIds).toEqual([])
    const summaries = await readReviewSummaries(cwd)
    expect(summaries).toContain('用户要求整理 review-safe summary。')
    await expect(readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes pending candidates using memory schema enum values', async () => {
    const home = await createTempDir('cyrene-review-runtime-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-runtime-project-')
    const candidate = {
      domain: 'personal',
      type: 'interaction_style',
      strength: 'session',
      scope: 'session',
      content: '用户偏好简洁直接的协作风格。',
      normalizedKey: 'personal-interaction-style-direct',
      source: 'user_implicit',
      scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.9, safety: 0.95, sensitivity: 0.1 },
      evidence: [{ summary: '用户反复要求直接给出可执行状态。' }],
      tags: ['codex-review-summary']
    }

    const result = await runCodexReviewSummary({
      cwd,
      messages: [{ role: 'user', content: '请直接给出可执行状态。' }],
      config: createConfig(cwd),
      callModel: async () => modelResponse(JSON.stringify({ summary: '用户偏好直接协作风格。', candidates: [candidate] })),
      now: '2026-05-26T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')
    if (result.action !== 'pending') throw new Error(`Expected pending, got ${result.action}`)
    expect(result.candidateIds).toHaveLength(1)
    const pending = await readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain('用户偏好简洁直接的协作风格。')
    expect(pending).toContain('"domain":"personal"')
    expect(pending).toContain('"type":"interaction_style"')
    expect(pending).toContain('"scope":"session"')
    expect(pending).toContain('"source":"user_implicit"')
    const summaries = await readReviewSummaries(cwd)
    expect(summaries).toContain(result.candidateIds[0])
  })

  it('captures explicit global instructions through memory proposal policy', async () => {
    const home = await createTempDir('cyrene-review-runtime-global-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-runtime-global-project-')

    const result = await runCodexReviewSummary({
      cwd,
      messages: [{ role: 'user', content: '以后所有项目都默认先运行 git diff --check。' }],
      config: createConfig(cwd),
      callModel: async () => modelResponse(JSON.stringify({ summary: '用户给出全局 workflow 指令。', candidates: [] })),
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')
    if (result.action !== 'pending') throw new Error(`Expected pending, got ${result.action}`)
    expect(result.candidateIds).toHaveLength(1)
    const pending = await readFile(join(codexGlobalMemoryRoot(), 'pending.jsonl'), 'utf8')
    expect(pending).toContain('以后所有项目都默认先运行 git diff --check。')
    expect(pending).toContain('"source":"user_explicit"')
    expect(pending).toContain('"scope":"global"')
  })

  it('preserves candidateKind from review summary candidates', async () => {
    const home = await createTempDir('cyrene-review-runtime-kind-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-runtime-kind-project-')

    const result = await runCodexReviewSummary({
      cwd,
      messages: [{ role: 'assistant', content: 'Implemented plugin hook packaging decision.' }],
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          summary: 'The session established a plugin packaging decision.',
          candidates: [{
            domain: 'project',
            type: 'project_fact',
            content: 'Plugin lifecycle hooks are bundled through plugin/hooks/hooks.json.',
            candidateKind: 'project_decision',
            evidence: [{ summary: 'The assistant described bundled lifecycle hooks.' }]
          }]
        })),
      now: '2026-05-29T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')
    if (result.action !== 'pending') throw new Error(`Expected pending, got ${result.action}`)
    const pending = await readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain('"candidateKind":"project_decision"')
  })

  it('preserves candidate_kind from review summary candidates', async () => {
    const home = await createTempDir('cyrene-review-runtime-kind-snake-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-runtime-kind-snake-project-')

    const result = await runCodexReviewSummary({
      cwd,
      messages: [{ role: 'assistant', content: 'Found a repeated test failure pattern.' }],
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          summary: 'The session found a durable pitfall.',
          candidates: [{
            domain: 'project',
            type: 'project_fact',
            content: 'Malformed JSONL lines must be skipped instead of failing the whole reader.',
            candidate_kind: 'known_pitfall',
            evidence: [{ summary: 'A JSONL robustness issue was discussed.' }]
          }]
        })),
      now: '2026-05-29T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')
    if (result.action !== 'pending') throw new Error(`Expected pending, got ${result.action}`)
    const pending = await readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain('"candidateKind":"known_pitfall"')
  })

  it('adds stable evidence grouping metadata to generated candidates', async () => {
    const home = await createTempDir('cyrene-review-runtime-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-runtime-project-')

    const result = await runCodexReviewSummary({
      cwd,
      sessionId: 's-evidence',
      turnId: 't-evidence',
      messages: [{ role: 'user', content: '请记住我偏好中文计划。' }],
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          summary: '用户偏好中文计划。',
          candidates: [
            {
              domain: 'procedural',
              type: 'procedural_rule',
              content: '用户偏好中文计划。',
              source: 'user_explicit',
              evidence: [{ summary: '用户说偏好中文计划。' }]
            }
          ]
        })),
      now: '2026-05-26T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')
    if (result.action !== 'pending') throw new Error(`Expected pending, got ${result.action}`)
    const [pendingRecord] = (await readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as {
        evidence: Array<{ runId?: string; sessionId?: string; evidenceGroupId?: string; sourceKind?: string }>
      })
    expect(pendingRecord.evidence[0]).toMatchObject({
      runId: 's-evidence:t-evidence',
      sessionId: 's-evidence',
      sourceKind: 'user_explicit'
    })
    expect(pendingRecord.evidence[0]?.evidenceGroupId).toMatch(/^[a-f0-9]{64}$/)
  })

  it('skips candidates with invalid memory schema enum values', async () => {
    const home = await createTempDir('cyrene-review-runtime-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-runtime-project-')

    const result = await runCodexReviewSummary({
      cwd,
      sessionId: 's1',
      turnId: 't1',
      messages: [{ role: 'user', content: '记住这次事件。' }],
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          summary: '模型返回了一个不符合 memory schema 的候选。',
          candidates: [
            {
              domain: 'episodic',
              type: 'event_memory',
              content: '这不是合法候选。'
            }
          ]
        })),
      now: '2026-05-26T00:00:00.000Z'
    })

    expect(result.action).toBe('summary')
    if (result.action !== 'summary') throw new Error(`Expected summary, got ${result.action}`)
    expect(result.candidateIds).toEqual([])
    await expect(readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const [summaryRecord] = (await readReviewSummaries(cwd)).trim().split('\n').map((line) => JSON.parse(line) as { candidateIds: string[] })
    expect(summaryRecord.candidateIds).toEqual([])
  })

  it('redacts model output before writing summaries and candidates', async () => {
    const home = await createTempDir('cyrene-review-runtime-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-runtime-project-')

    const result = await runCodexReviewSummary({
      cwd,
      sessionId: 's1',
      turnId: 't1',
      messages: [{ role: 'user', content: '请总结。' }],
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          summary: '模型泄漏 sk-abc1234567890abcdef1234567890',
          candidates: [
            {
              domain: 'project',
              type: 'project_fact',
              content: '密钥是 sk-abc1234567890abcdef1234567890',
              evidence: [{
                runId: 'evil-sk-abc1234567890abcdef1234567890',
                summary: '看到了 sk-abc1234567890abcdef1234567890'
              }]
            }
          ]
        })),
      now: '2026-05-26T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')
    const summaries = await readReviewSummaries(cwd)
    expect(summaries).not.toContain('sk-abc')
    expect(summaries).toContain('[REDACTED_SECRET]')
    if (result.action === 'pending') {
      const pending = await readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')
      expect(pending).not.toContain('sk-abc')
      expect(pending).not.toContain('evil-sk')
      expect(pending).toContain('[REDACTED_SECRET]')
      const [pendingRecord] = pending.trim().split('\n').map((line) => JSON.parse(line) as {
        evidence: Array<{ runId: string }>
      })
      expect(pendingRecord.evidence[0]?.runId).toBe('s1:t1')
    }
  })

  it('redacts failed summary reason when the model leaks provider details', async () => {
    const home = await createTempDir('cyrene-review-runtime-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-runtime-project-')

    const result = await runCodexReviewSummary({
      cwd,
      sessionId: 's1',
      turnId: 't1',
      messages: [{ role: 'user', content: '请总结。' }],
      config: createConfig(cwd),
      callModel: async () => {
        throw new Error('provider leaked sk-abc1234567890abcdef1234567890')
      },
      now: '2026-05-26T00:00:00.000Z'
    })

    expect(result.action).toBe('summary_failed')
    if (result.action !== 'summary_failed') throw new Error(`Expected summary_failed, got ${result.action}`)
    expect(result.reason).not.toContain('sk-abc')
    expect(result.reason).toContain('[REDACTED_SECRET]')
    const summaries = await readReviewSummaries(cwd)
    expect(summaries).toContain('Codex review summary failed; no transcript content persisted.')
    expect(summaries).not.toContain('sk-abc')
    expect(summaries).toContain('[REDACTED_SECRET]')
    const [summaryRecord] = summaries.trim().split('\n').map((line) => JSON.parse(line) as {
      failureReason: string
      redaction: { output: Record<string, number> }
    })
    expect(summaryRecord.failureReason).toContain('[REDACTED_SECRET]')
    expect(summaryRecord.redaction.output.secret).toBeGreaterThan(0)
  })
})
