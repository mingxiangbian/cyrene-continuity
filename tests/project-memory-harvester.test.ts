import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import {
  runCodexProjectMemoryHarvest,
  type CodexProjectMemoryHarvestResult
} from '../src/codex/project-memory-harvester.js'
import { previewHashForPayload, type ProjectHarvestPreviewArtifact } from '../src/codex/project-memory-harvest-preview.js'
import { collectProjectMemorySignals, type ProjectMemorySignal } from '../src/codex/project-memory-signals.js'
import { deleteCodexProjectMemory } from '../src/codex/project-registry.js'
import { createDefaultConfig, type AppConfig } from '../src/config.js'
import type { CallModelInput, ModelResponse } from '../src/llm-client.js'
import { activationPolicyForConfidenceTier } from '../src/memory/memory-lifecycle.js'
import { readSemanticMemoriesFromRoot, writeActiveMemoriesFromRoot } from '../src/memory/memory-store.js'
import type { CyreneMemory } from '../src/memory/types.js'

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
      summary: 'repository policy: preserve v1.5 trial admission and manual review queue boundaries',
      evidence: 'Strict low-risk project memory may enter trial; high-risk or ambiguous memory stays in manual review.'
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
  return readFile(join(codexProjectMemoryRoot(identity.projectId), 'review_queue.jsonl'), 'utf8')
}

async function projectMemoryRoot(cwd: string): Promise<string> {
  const identity = await identifyCodexProject(cwd)
  return codexProjectMemoryRoot(identity.projectId)
}

function activeMemory(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'active-project-memory',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'soft',
    scope: 'project',
    status: 'active',
    content: 'Use npm test before completion.',
    normalizedKey: 'test-command',
    sourceOfTruth: 'AGENTS.md',
    evidence: [{ summary: 'Existing project workflow evidence.' }],
    source: 'file',
    scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    tags: [],
    ...overrides
  }
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

  it('returns a preview artifact by default and does not write memory or review queue', async () => {
    const home = await createTempDir('cyrene-harvester-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })
    const callModel = vi.fn(async () =>
      modelResponse(JSON.stringify({
        candidates: [{
          candidateKind: 'project_decision',
          content: 'Project harvest previews must be explicitly applied before admission.',
          signalIndexes: [1]
        }]
      }))
    )

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel,
      now: '2026-06-12T00:00:00.000Z'
    })

    expect(result.action).toBe('preview')
    if (result.action !== 'preview') throw new Error(`Expected preview, got ${result.action}`)
    expect(result.previewId).toEqual(expect.any(String))
    expect(result.previewHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.modelCallCount).toBe(1)
    expect(result.groups.map((group) => group.route)).toEqual([
      'trial_eligible',
      'review_required',
      'reject_recommended'
    ])
    expect(result.candidates).toEqual([
      expect.objectContaining({ route: 'trial_eligible', content: 'Project harvest previews must be explicitly applied before admission.' })
    ])
    const memoryRoot = await projectMemoryRoot(cwd)
    await expect(readFile(join(memoryRoot, 'harvest_previews', `${result.previewId}.json`), 'utf8')).resolves.toContain(result.previewHash)
    await expect(readFile(join(memoryRoot, 'semantic_memories.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readPending(cwd)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(callModel).toHaveBeenCalledTimes(1)
  })

  it('returns preview_required for explicit dryRun false without apply credentials and writes no memory', async () => {
    const home = await createTempDir('cyrene-harvester-preview-required-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-preview-required-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })
    const callModel = vi.fn(async () => modelResponse('{"candidates":[]}'))

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd, { baseUrl: '', model: '', strongModel: '', cheapModel: '' }),
      dryRun: false,
      callModel
    })

    expect(result.action).toBe('preview_required')
    expect(result).toMatchObject({ signals: sampleSignals(), warnings: [], modelCallCount: 0 })
    expect(callModel).not.toHaveBeenCalled()
    const memoryRoot = await projectMemoryRoot(cwd)
    await expect(readFile(join(memoryRoot, 'semantic_memories.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readPending(cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('caps displayed preview candidates and returns fixed route group order', async () => {
    const home = await createTempDir('cyrene-harvester-groups-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-groups-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })
    const modelCandidates = Array.from({ length: 14 }, (_value, index) => ({
      candidateKind: 'project_decision',
      content: index < 2
        ? 'Project harvest preview duplicate candidates should be rejected before apply.'
        : `Project harvest preview candidate ${index} should be displayed with a route.`,
      signalIndexes: [1]
    }))

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      dryRun: true,
      callModel: async () => modelResponse(JSON.stringify({ candidates: modelCandidates })),
      now: '2026-06-12T00:00:00.000Z'
    })

    expect(result.action).toBe('preview')
    if (result.action !== 'preview') throw new Error(`Expected preview, got ${result.action}`)
    expect(result.candidates.length).toBeLessThanOrEqual(12)
    expect(result.groups.map((group) => group.route)).toEqual([
      'trial_eligible',
      'review_required',
      'reject_recommended'
    ])
    expect(result.groups.find((group) => group.route === 'reject_recommended')?.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: 'reject_recommended',
          reason: expect.stringContaining('duplicate')
        })
      ])
    )
  })

  it('bounds generated project candidate content for reviewability', async () => {
    const home = await createTempDir('cyrene-harvester-bounds-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-bounds-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })
    const longContent = `Project memory generated candidate should preserve durable review policy context for maintainers. ${'context '.repeat(40)}`

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      dryRun: true,
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'workflow_rule',
            content: longContent,
            signalIndexes: [1]
          }]
        }))
    })

    expect(result.action).toBe('preview')
    if (result.action !== 'preview') throw new Error(`Expected preview, got ${result.action}`)
    expect(result.candidates[0]?.content).toHaveLength(240)
    expect(result.candidates[0]?.content).toMatch(/\.\.\.$/)
  })

  it('applies a matching preview without another LLM call and does not enqueue review-required candidates', async () => {
    const home = await createTempDir('cyrene-harvester-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })
    const callModel = vi.fn(async () =>
      modelResponse(JSON.stringify({
        candidates: [
          {
            candidate_kind: 'project_decision',
            content: 'Cyrene project memory proposals must remain pending until explicit review approval.',
            signalIndexes: [1],
            domain: 'project',
            type: 'project_fact',
            scope: 'global',
            source: 'user_implicit'
          },
          {
            candidateKind: 'workflow_rule',
            content: 'Repository changes must preserve v1.5 trial admission and manual review queue boundaries.',
            signalIndexes: [2]
          }
        ]
      }))
    )

    const preview = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel,
      now: '2026-05-29T00:00:00.000Z'
    })
    expect(preview.action).toBe('preview')
    if (preview.action !== 'preview') throw new Error(`Expected preview, got ${preview.action}`)

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () => {
        throw new Error('apply must not call the LLM')
      },
      apply: true,
      previewId: preview.previewId,
      previewHash: preview.previewHash,
      now: '2026-05-29T00:00:00.000Z'
    })

    expect(result.action).toBe('trial')
    if (result.action !== 'trial') throw new Error(`Expected trial, got ${result.action}`)
    expect(result.modelCallCount).toBe(0)
    expect(result.candidateIds).toHaveLength(1)
    expect(result.memoryIds).toHaveLength(1)
    const [record] = await readSemanticMemoriesFromRoot(result.memoryRoot)
    if (record === undefined) throw new Error('Expected trial semantic memory')
    expect(record).toMatchObject({
      status: 'active',
      confidenceTier: 'trial',
      activationPolicy: activationPolicyForConfidenceTier('trial')
    })
    expect(record).toMatchObject({
      scope: 'project',
      domain: 'project',
      kind: 'project_decision',
      sourceOfTruth: 'AGENTS.md',
      reviewState: expect.objectContaining({
        type: 'project_fact',
        source: 'file',
        tags: expect.arrayContaining(['project_harvest', 'project_decision'])
      })
    })
    expect(record.evidence[0]).toEqual(expect.objectContaining({
      sourceKind: 'file',
      whatHappened: expect.stringContaining('repository_policy')
    }))
    expect(record.evidence[0]?.id).toMatch(/^[a-f0-9]{64}$/)
    await expect(readPending(cwd)).resolves.not.toContain(
      'Repository changes must preserve v1.5 trial admission and manual review queue boundaries.'
    )
    expect(callModel).toHaveBeenCalledTimes(1)
  })

  it('rejects mismatched or expired preview apply without writing memory', async () => {
    const home = await createTempDir('cyrene-harvester-preview-guard-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-preview-guard-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const preview = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'workflow_rule',
            content: 'Project harvest preview apply requires matching preview hash.',
            signalIndexes: [1]
          }]
        })),
      now: '2026-06-12T00:00:00.000Z'
    })
    expect(preview.action).toBe('preview')
    if (preview.action !== 'preview') throw new Error(`Expected preview, got ${preview.action}`)

    const rejectModel = async () => {
      throw new Error('apply must not call the LLM')
    }
    const mismatched = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: rejectModel,
      apply: true,
      previewId: preview.previewId,
      previewHash: '0'.repeat(64),
      now: '2026-06-12T00:00:00.000Z'
    })
    const invalidId = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: rejectModel,
      apply: true,
      previewId: '../semantic_memories',
      previewHash: preview.previewHash,
      now: '2026-06-12T00:00:00.000Z'
    })
    const expired = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: rejectModel,
      apply: true,
      previewId: preview.previewId,
      previewHash: preview.previewHash,
      now: '2026-06-13T00:00:00.000Z'
    })

    expect(mismatched).toMatchObject({ action: 'preview_required', modelCallCount: 0 })
    expect(invalidId).toMatchObject({ action: 'preview_required', modelCallCount: 0 })
    expect(expired).toMatchObject({ action: 'preview_expired', modelCallCount: 0 })
    const memoryRoot = await projectMemoryRoot(cwd)
    await expect(readFile(join(memoryRoot, 'semantic_memories.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readPending(cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports a next action for preview artifacts from another project memory root', async () => {
    const home = await createTempDir('cyrene-harvester-preview-root-mismatch-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-preview-root-mismatch-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const preview = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'workflow_rule',
            content: 'Project harvest preview apply requires same project root.',
            signalIndexes: [1]
          }]
        })),
      now: '2026-06-12T00:00:00.000Z'
    })
    expect(preview.action).toBe('preview')
    if (preview.action !== 'preview') throw new Error(`Expected preview, got ${preview.action}`)
    const memoryRoot = await projectMemoryRoot(cwd)
    const previewPath = join(memoryRoot, 'harvest_previews', `${preview.previewId}.json`)
    const artifact = JSON.parse(await readFile(previewPath, 'utf8')) as ProjectHarvestPreviewArtifact
    artifact.projectId = 'different-project'
    artifact.memoryRoot = join(home, 'different-memory-root')
    const { previewHash: _oldHash, ...payload } = artifact
    artifact.previewHash = previewHashForPayload(payload)
    await writeFile(previewPath, `${JSON.stringify(artifact)}\n`, 'utf8')

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () => {
        throw new Error('apply must not call the LLM')
      },
      apply: true,
      previewId: preview.previewId,
      previewHash: artifact.previewHash,
      now: '2026-06-12T00:00:00.000Z'
    })

    expect(result).toMatchObject({ action: 'preview_required', modelCallCount: 0 })
    if (result.action !== 'preview_required') throw new Error(`Expected preview_required, got ${result.action}`)
    expect(result.reason).toContain('cyrene-continuity codex memory harvest-project')
    await expect(readFile(join(memoryRoot, 'semantic_memories.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readPending(cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects malformed preview expiry even when the preview hash is recomputed', async () => {
    const home = await createTempDir('cyrene-harvester-preview-malformed-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-preview-malformed-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const preview = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'workflow_rule',
            content: 'Project harvest preview expiry must fail closed.',
            signalIndexes: [1]
          }]
        })),
      now: '2026-06-12T00:00:00.000Z'
    })
    expect(preview.action).toBe('preview')
    if (preview.action !== 'preview') throw new Error(`Expected preview, got ${preview.action}`)
    const memoryRoot = await projectMemoryRoot(cwd)
    const previewPath = join(memoryRoot, 'harvest_previews', `${preview.previewId}.json`)
    const artifact = JSON.parse(await readFile(previewPath, 'utf8')) as Record<string, unknown>
    artifact.expiresAt = 'not-a-date'
    const { previewHash: _oldHash, ...payload } = artifact
    artifact.previewHash = previewHashForPayload(payload as Omit<ProjectHarvestPreviewArtifact, 'previewHash'>)
    await writeFile(previewPath, `${JSON.stringify(artifact)}\n`, 'utf8')

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () => {
        throw new Error('apply must not call the LLM')
      },
      apply: true,
      previewId: preview.previewId,
      previewHash: artifact.previewHash as string,
      now: '2026-06-12T00:00:00.000Z'
    })

    expect(result).toMatchObject({ action: 'preview_required', modelCallCount: 0 })
    await expect(readFile(join(memoryRoot, 'semantic_memories.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readPending(cwd)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('routes review-summary-only harvest candidates to review_required instead of trial_eligible', async () => {
    const home = await createTempDir('cyrene-harvester-review-summary-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-review-summary-project-')
    collectSignals.mockResolvedValue({
      signals: [{
        kind: 'review_summary',
        source: 'review_summary',
        sourceRef: 'review_summary:summary-1',
        summary: 'review summary captured an inferred project workflow'
      }],
      warnings: []
    })

    const preview = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'workflow_rule',
            content: 'Use npm test before completion.',
            signalIndexes: [1]
          }]
        })),
      now: '2026-06-12T00:00:00.000Z'
    })

    expect(preview.action).toBe('preview')
    if (preview.action !== 'preview') throw new Error(`Expected preview, got ${preview.action}`)
    expect(preview.groups.find((group) => group.route === 'trial_eligible')?.candidates).toEqual([])
    expect(preview.groups.find((group) => group.route === 'review_required')?.candidates).toEqual([
      expect.objectContaining({
        route: 'review_required',
        source: 'assistant_observed',
        reason: expect.stringContaining('assistant')
      })
    ])
  })

  it('routes same-boundary contradictory workflow commands to review_required', async () => {
    const home = await createTempDir('cyrene-harvester-hard-conflict-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-hard-conflict-project-')
    const memoryRoot = await projectMemoryRoot(cwd)
    await writeActiveMemoriesFromRoot(memoryRoot, [activeMemory({
      content: 'Use npm test before completion.',
      normalizedKey: 'test-command',
      sourceOfTruth: 'AGENTS.md'
    })])
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const preview = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'workflow_rule',
            content: 'Use pnpm test before completion.',
            signalIndexes: [1]
          }]
        })),
      now: '2026-06-12T00:00:00.000Z'
    })

    expect(preview.action).toBe('preview')
    if (preview.action !== 'preview') throw new Error(`Expected preview, got ${preview.action}`)
    expect(preview.groups.find((group) => group.route === 'trial_eligible')?.candidates).toEqual([])
    expect(preview.groups.find((group) => group.route === 'review_required')?.candidates).toEqual([
      expect.objectContaining({
        route: 'review_required',
        reason: expect.stringContaining('hard conflict')
      })
    ])
  })

  it('routes numeric project harvest snapshots to admission only after preview apply', async () => {
    const home = await createTempDir('cyrene-harvester-admission-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-admission-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const preview = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'project_fact',
            content: '项目包含 44 个测试文件，广泛覆盖 active memory、CLI、distill、MCP、memory index 等模块。',
            signalIndexes: [1]
          }]
        })),
      now: '2026-05-31T00:00:00.000Z'
    })
    expect(preview.action).toBe('preview')
    if (preview.action !== 'preview') throw new Error(`Expected preview, got ${preview.action}`)

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () => {
        throw new Error('apply must not call the LLM')
      },
      apply: true,
      previewId: preview.previewId,
      previewHash: preview.previewHash,
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('noop')
    if (result.action !== 'noop') throw new Error(`Expected noop, got ${result.action}`)
    expect(result.reason).toContain('No project memory candidates survived admission.')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await expect(readFile(join(memoryRoot, 'admission_decisions.jsonl'), 'utf8')).resolves.toContain('stale_numeric_snapshot')
    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('routes implementation notes to admission only after preview apply', async () => {
    const home = await createTempDir('cyrene-harvester-implementation-note-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-implementation-note-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const preview = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'project_decision',
            content: 'v1 admission gate 核心实现采用 subagent-driven 执行方案，并创建隔离工作区。',
            signalIndexes: [1]
          }]
        })),
      now: '2026-05-31T00:00:00.000Z'
    })
    expect(preview.action).toBe('preview')
    if (preview.action !== 'preview') throw new Error(`Expected preview, got ${preview.action}`)

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () => {
        throw new Error('apply must not call the LLM')
      },
      apply: true,
      previewId: preview.previewId,
      previewHash: preview.previewHash,
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('noop')
    if (result.action !== 'noop') throw new Error(`Expected noop, got ${result.action}`)
    expect(result.reason).toContain('No project memory candidates survived admission.')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await expect(readFile(join(memoryRoot, 'admission_decisions.jsonl'), 'utf8')).resolves.toContain('implementation_note')
    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes candidate drafts beside existing project harvest pending candidates only after preview apply', async () => {
    const home = await createTempDir('cyrene-harvester-draft-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-draft-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const preview = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'workflow_rule',
            content: 'Repository changes must preserve v1.5 trial admission and manual review queue boundaries.',
            signalIndexes: [1]
          }]
        })),
      now: '2026-05-31T00:00:00.000Z'
    })
    expect(preview.action).toBe('preview')
    if (preview.action !== 'preview') throw new Error(`Expected preview, got ${preview.action}`)

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () => {
        throw new Error('apply must not call the LLM')
      },
      apply: true,
      previewId: preview.previewId,
      previewHash: preview.previewHash,
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('trial')
    if (result.action !== 'trial') throw new Error(`Expected trial, got ${result.action}`)
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const drafts = await readFile(join(memoryRoot, 'candidate_drafts.jsonl'), 'utf8')
    expect(drafts).toContain('Repository changes must preserve v1.5 trial admission and manual review queue boundaries.')
    expect(drafts).toContain('"sourceKind":"file"')
    expect(drafts).toContain('"candidateKind":"workflow_rule"')
    const semantic = await readSemanticMemoriesFromRoot(memoryRoot)
    expect(semantic[0]).toMatchObject({
      content: 'Repository changes must preserve v1.5 trial admission and manual review queue boundaries.',
      confidenceTier: 'trial'
    })
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
            content: 'Repository changes must preserve v1.5 trial admission and manual review queue boundaries.',
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
            content: 'Repository changes must preserve v1.5 trial admission and manual review queue boundaries.'
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
              content: 'Project memory harvester output should stay in the manual review queue.',
              signalIndexes: [1],
              tags: ['api_key']
            },
            {
              candidateKind: 'workflow_rule',
              content: 'Project memory harvester output should stay in the manual review queue.',
              signalIndexes: [1],
              domain: 'personal'
            },
            {
              candidateKind: 'workflow_rule',
              content: 'Project memory harvester output should stay in the manual review queue.',
              signalIndexes: [1],
              domain: 'relationship'
            },
            {
              candidateKind: 'workflow_rule',
              content: 'Project memory harvester output should stay in the manual review queue.',
              signalIndexes: [1],
              domain: 'affective'
            },
            {
              candidateKind: 'workflow_rule',
              content: 'Project memory harvester output may enter trial only after low-risk gates pass.',
              signalIndexes: [1]
            }
          ]
        }))
    })

    expect(result.action).toBe('preview')
    if (result.action !== 'preview') throw new Error(`Expected preview, got ${result.action}`)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.content).toBe('Project memory harvester output may enter trial only after low-risk gates pass.')
  })

  it('does not preserve model-supplied normalizedKey when applying a preview', async () => {
    const home = await createTempDir('cyrene-harvester-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const preview = await runCodexProjectMemoryHarvest({
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
    expect(preview.action).toBe('preview')
    if (preview.action !== 'preview') throw new Error(`Expected preview, got ${preview.action}`)

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () => {
        throw new Error('apply must not call the LLM')
      },
      apply: true,
      previewId: preview.previewId,
      previewHash: preview.previewHash,
      now: '2026-05-29T00:00:00.000Z'
    })

    expect(result.action).toBe('trial')
    if (result.action !== 'trial') throw new Error(`Expected trial, got ${result.action}`)
    const [record] = await readSemanticMemoriesFromRoot(result.memoryRoot)
    expect(record?.reviewState?.normalizedKey).not.toBe('model-supplied-normalized-key')
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

    expect(result.action).toBe('preview')
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
    expect(prompt).toContain('Candidate content must be 240 characters or fewer.')
    expect(prompt).toContain('repository_policy')
    expect(prompt).toContain('preserve v1.5 trial admission and manual review queue boundaries')
    expect(prompt).toContain('hook_trace')
    expect(prompt).toContain('project memory signal collection')
  })
})
