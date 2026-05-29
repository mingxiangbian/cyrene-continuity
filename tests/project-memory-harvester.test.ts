import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import {
  runCodexProjectMemoryHarvest,
  type CodexProjectMemoryHarvestResult
} from '../src/codex/project-memory-harvester.js'
import { collectProjectMemorySignals, type ProjectMemorySignal } from '../src/codex/project-memory-signals.js'
import { deleteCodexProjectMemory } from '../src/codex/project-registry.js'
import { createDefaultConfig, type AppConfig } from '../src/config.js'
import type { CallModelInput, ModelResponse } from '../src/llm-client.js'

vi.mock('../src/codex/project-memory-signals.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/codex/project-memory-signals.js')>()
  return {
    ...actual,
    collectProjectMemorySignals: vi.fn()
  }
})

const originalHome = process.env.HOME
const tempDirs: string[] = []
const collectSignals = vi.mocked(collectProjectMemorySignals)

afterEach(async () => {
  vi.unstubAllEnvs()
  process.env.HOME = originalHome
  collectSignals.mockReset()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createConfig(cwd: string, modelOverrides: Partial<AppConfig['model']> = {}): AppConfig {
  const config = createDefaultConfig(cwd)
  return {
    ...config,
    cwd,
    memoryCwd: cwd,
    model: {
      ...config.model,
      baseUrl: 'https://example.test',
      model: 'strong',
      apiKey: 'test-key',
      temperature: 0,
      strongModel: 'strong',
      cheapModel: 'cheap',
      ...modelOverrides
    },
    userCyreneDir: join(cwd, '.cyrene')
  }
}

function modelResponse(content: string): ModelResponse {
  return { content, toolCalls: [] }
}

function sampleSignals(): ProjectMemorySignal[] {
  return [
    {
      kind: 'repository_policy',
      source: 'file',
      files: ['AGENTS.md'],
      summary: 'repository policy: preserve pending-only memory review model',
      evidence: 'Do not imply automatic promotion or active-memory writes without explicit approval.'
    },
    {
      kind: 'hook_trace',
      source: 'tool_trace',
      files: ['src/codex/project-memory-signals.ts'],
      summary: 'hook trace post_tool_use: Edited project memory signal collector.',
      evidence: 'event=post_tool_use; tool=shell; signals=project memory signal collection'
    }
  ]
}

async function readPending(cwd: string): Promise<string> {
  const identity = await identifyCodexProject(cwd)
  return readFile(join(codexProjectMemoryRoot(identity.projectId), 'pending.jsonl'), 'utf8')
}

describe('runCodexProjectMemoryHarvest', () => {
  it('returns needs_model_config when baseUrl or model route is missing and does not call model', async () => {
    const home = await createTempDir('cyrene-harvester-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })
    const callModel = vi.fn(async () => modelResponse('{"candidates":[]}'))

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd, { baseUrl: '', model: '', strongModel: '', cheapModel: '' }),
      callModel
    })

    expect(result).toMatchObject({
      action: 'needs_model_config',
      signals: sampleSignals(),
      warnings: []
    })
    expect(callModel).not.toHaveBeenCalled()
  })

  it('does not collect signals or write candidates when project memory is disabled', async () => {
    const home = await createTempDir('cyrene-harvester-disabled-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-disabled-project-')
    const identity = await identifyCodexProject(cwd)
    await deleteCodexProjectMemory({ projectId: identity.projectId, reason: 'No project memory here.' })
    const callModel = vi.fn(async () => modelResponse('{"candidates":[]}'))

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel
    })

    expect(result).toMatchObject({
      action: 'noop',
      reason: 'Project memory is disabled for this project.'
    })
    expect(collectSignals).not.toHaveBeenCalled()
    expect(callModel).not.toHaveBeenCalled()
    await expect(readPending(cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('returns needs_model_config when base model is missing even if route models are configured', async () => {
    const home = await createTempDir('cyrene-harvester-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })
    const callModel = vi.fn(async () => modelResponse('{"candidates":[]}'))

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd, { model: '', strongModel: 'strong', cheapModel: 'cheap' }),
      callModel
    })

    expect(result).toMatchObject({
      action: 'needs_model_config',
      signals: sampleSignals(),
      warnings: []
    })
    expect(callModel).not.toHaveBeenCalled()
  })

  it('returns needs_model_config when a hosted endpoint is missing an API key', async () => {
    const home = await createTempDir('cyrene-harvester-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })
    const callModel = vi.fn(async () => modelResponse('{"candidates":[]}'))

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd, { baseUrl: 'https://api.deepseek.com', apiKey: undefined }),
      callModel
    })

    expect(result).toMatchObject({
      action: 'needs_model_config',
      signals: sampleSignals(),
      warnings: []
    })
    if (result.action !== 'needs_model_config') {
      throw new Error(`Expected needs_model_config, got ${result.action}`)
    }
    expect(result.reason).toContain('CYRENE_API_KEY')
    expect(callModel).not.toHaveBeenCalled()
  })

  it('returns preview candidates in dry-run mode and does not create pending memory', async () => {
    const home = await createTempDir('cyrene-harvester-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      dryRun: true,
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'workflow_rule',
            content: 'Repository changes must preserve the pending-only memory review model.',
            signalIndexes: [1],
            scope: 'global',
            source: 'user_explicit',
            evidence: [{ summary: 'Model evidence should be replaced by signal evidence.' }]
          }]
        }))
    })

    expect(result.action).toBe('preview')
    if (result.action !== 'preview') throw new Error(`Expected preview, got ${result.action}`)
    expect(result.candidates).toEqual([
      expect.objectContaining({
        candidateKind: 'workflow_rule',
        domain: 'procedural',
        type: 'procedural_rule',
        scope: 'project',
        source: 'file',
        tags: expect.arrayContaining(['project_harvest', 'workflow_rule'])
      })
    ])
    await expect(readPending(cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes sanitized project pending memory in normal mode', async () => {
    const home = await createTempDir('cyrene-harvester-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidate_kind: 'project_decision',
            content: 'Cyrene project memory proposals must remain pending until explicit review approval.',
            signalIndexes: [1],
            domain: 'project',
            type: 'project_fact',
            scope: 'global',
            source: 'user_implicit'
          }]
        })),
      now: '2026-05-29T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')
    if (result.action !== 'pending') throw new Error(`Expected pending, got ${result.action}`)
    expect(result.candidateIds).toHaveLength(1)
    const [record] = (await readPending(cwd)).trim().split('\n').map((line) => JSON.parse(line) as {
      scope: string
      domain: string
      type: string
      candidateKind?: string
      candidate_kind?: string
      source: string
      evidence: Array<{ sourceKind?: string; summary?: string }>
      tags: string[]
    })
    expect(record).toMatchObject({
      scope: 'project',
      domain: 'project',
      type: 'project_fact',
      candidateKind: 'project_decision',
      source: 'file',
      tags: expect.arrayContaining(['project_harvest', 'project_decision'])
    })
    expect(record.candidate_kind).toBeUndefined()
    expect(record.evidence[0]).toEqual(expect.objectContaining({
      sourceKind: 'file',
      summary: expect.stringContaining('repository_policy')
    }))
  })

  it('filters invalid candidate kinds and prevents personal or global model output from leaking through', async () => {
    const home = await createTempDir('cyrene-harvester-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      dryRun: true,
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [
            {
              candidateKind: 'user_instruction',
              content: 'User-style memories are outside this project harvester.'
            },
            {
              candidateKind: 'known_pitfall',
              content: 'Generated runtime files should not be edited directly for plugin behavior changes.',
              signalIndexes: [1],
              scope: 'global',
              source: 'user_implicit'
            }
          ]
        }))
    })

    expect(result.action).toBe('preview')
    if (result.action !== 'preview') throw new Error(`Expected preview, got ${result.action}`)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toEqual(expect.objectContaining({
      candidateKind: 'known_pitfall',
      domain: 'procedural',
      type: 'procedural_rule',
      scope: 'project',
      source: 'file'
    }))
  })

  it('uses only evidence from valid candidate signalIndexes', async () => {
    const home = await createTempDir('cyrene-harvester-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      dryRun: true,
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'workflow_rule',
            content: 'Project memory signal collection changes should be supported by tool trace evidence.',
            signalIndexes: [2]
          }]
        }))
    })

    expect(result.action).toBe('preview')
    if (result.action !== 'preview') throw new Error(`Expected preview, got ${result.action}`)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.evidence).toHaveLength(1)
    expect(result.candidates[0]?.evidence[0]).toEqual(expect.objectContaining({
      sourceKind: 'tool_trace',
      summary: expect.stringContaining('hook_trace')
    }))
    expect(result.candidates[0]?.evidence[0]?.summary).not.toContain('repository_policy')
  })

  it('rejects candidates without valid signalIndexes when multiple signals were collected', async () => {
    const home = await createTempDir('cyrene-harvester-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      dryRun: true,
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'workflow_rule',
            content: 'Repository changes must preserve the pending-only memory review model.',
            signalIndexes: [99]
          }]
        }))
    })

    expect(result.action).toBe('preview')
    if (result.action !== 'preview') throw new Error(`Expected preview, got ${result.action}`)
    expect(result.candidates).toEqual([])
  })

  it('falls back to the sole collected signal when signalIndexes are absent', async () => {
    const home = await createTempDir('cyrene-harvester-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals().slice(0, 1), warnings: [] })

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      dryRun: true,
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'workflow_rule',
            content: 'Repository changes must preserve the pending-only memory review model.'
          }]
        }))
    })

    expect(result.action).toBe('preview')
    if (result.action !== 'preview') throw new Error(`Expected preview, got ${result.action}`)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.evidence).toHaveLength(1)
    expect(result.candidates[0]?.evidence[0]?.summary).toContain('repository_policy')
  })

  it('rejects personal or sensitive project harvest candidates', async () => {
    const home = await createTempDir('cyrene-harvester-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      dryRun: true,
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [
            {
              candidateKind: 'workflow_rule',
              content: 'The user private family context should not become project memory.',
              signalIndexes: [1]
            },
            {
              candidateKind: 'workflow_rule',
              content: 'Bearer token handling is not valid project memory content here.',
              signalIndexes: [1]
            },
            {
              candidateKind: 'workflow_rule',
              content: 'Project memory harvester output should stay pending-only.',
              signalIndexes: [1],
              tags: ['api_key']
            },
            {
              candidateKind: 'workflow_rule',
              content: 'Project memory harvester output should stay pending-only.',
              signalIndexes: [1],
              domain: 'personal'
            },
            {
              candidateKind: 'workflow_rule',
              content: 'Project memory harvester output should stay pending-only.',
              signalIndexes: [1],
              domain: 'relationship'
            },
            {
              candidateKind: 'workflow_rule',
              content: 'Project memory harvester output should stay pending-only.',
              signalIndexes: [1],
              domain: 'affective'
            },
            {
              candidateKind: 'workflow_rule',
              content: 'Project memory harvester output should stay pending-only until review.',
              signalIndexes: [1]
            }
          ]
        }))
    })

    expect(result.action).toBe('preview')
    if (result.action !== 'preview') throw new Error(`Expected preview, got ${result.action}`)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.content).toBe('Project memory harvester output should stay pending-only until review.')
  })

  it('does not preserve model-supplied normalizedKey', async () => {
    const home = await createTempDir('cyrene-harvester-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'workflow_rule',
            content: 'Project memory harvester output should derive normalized keys from sanitized content.',
            signalIndexes: [1],
            normalizedKey: 'model-supplied-normalized-key'
          }]
        })),
      now: '2026-05-29T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')
    if (result.action !== 'pending') throw new Error(`Expected pending, got ${result.action}`)
    const [record] = (await readPending(cwd)).trim().split('\n').map((line) => JSON.parse(line) as {
      normalizedKey: string
    })
    expect(record.normalizedKey).not.toBe('model-supplied-normalized-key')
  })

  it('includes allowed project candidate kinds and collected signals in the prompt', async () => {
    const home = await createTempDir('cyrene-harvester-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: ['review summaries unavailable'] })
    let prompt = ''

    const result: CodexProjectMemoryHarvestResult = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async (input: CallModelInput) => {
        expect(input.useCase).toBe('memory_extraction')
        expect(input.tools).toEqual([])
        prompt = input.messages[0]?.content ?? ''
        return modelResponse(JSON.stringify({ candidates: [] }))
      },
      now: '2026-05-29T00:00:00.000Z'
    })

    expect(result.action).toBe('noop')
    for (const kind of [
      'project_fact',
      'project_decision',
      'workflow_rule',
      'known_pitfall',
      'rejected_approach',
      'open_question'
    ]) {
      expect(prompt).toContain(kind)
    }
    expect(prompt).toContain('Write generated memory summaries, candidate content, and evidence summaries in Chinese by default.')
    expect(prompt).toContain('Keep English proper nouns and technical terms such as file paths, commands, APIs, libraries, model names, field names, and identifiers in English.')
    expect(prompt).toContain('repository_policy')
    expect(prompt).toContain('preserve pending-only memory review model')
    expect(prompt).toContain('hook_trace')
    expect(prompt).toContain('project memory signal collection')
  })
})
