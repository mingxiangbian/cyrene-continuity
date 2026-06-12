import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonText } from '../src/mcp/mcp-json.js'
import { createCyreneMcpServer } from '../src/mcp/mcp-server.js'
import { handleMemoryPropose } from '../src/mcp/tools/memory-propose.js'
import {
  handleActiveMemoryArchive,
  handleMemoryDefer,
  handleMemoryEdit,
  handleMemoryPendingGet,
  handleMemoryPendingList,
  handleMemoryPromote,
  handleMemoryReject
} from '../src/mcp/tools/memory-review.js'
import { handleMemoryAutomationRun } from '../src/mcp/tools/memory-automation.js'
import { handleMemoryFeedback, memoryFeedbackInputSchema } from '../src/mcp/tools/memory-feedback.js'
import { handleMemoryProfileGet } from '../src/mcp/tools/memory-dream.js'
import { handleMemoryHarvestProject, memoryHarvestProjectInputSchema } from '../src/mcp/tools/memory-harvest-project.js'
import { contentHashForActiveMemory } from '../src/codex/active-memory-review.js'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { readActivationEventsFromRoot, readActiveMemoriesFromRoot, writeActiveMemoriesFromRoot } from '../src/memory/memory-store.js'
import type { CyreneMemory } from '../src/memory/types.js'

const execFileAsync = promisify(execFile)
const PLUGIN_BUILD_TEST_TIMEOUT_MS = 20_000
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

function cliEnv(): Record<string, string> {
  const { FORCE_COLOR: _forceColor, NO_COLOR: _noColor, ...env } = process.env
  return Object.fromEntries(
    Object.entries({ ...env, CYRENE_MEMORY_AUTO_EXTRACT: '0' }).filter((entry): entry is [string, string] => {
      return entry[1] !== undefined
    })
  )
}

describe('Cyrene MCP server', () => {
  it('creates a named MCP server', () => {
    const server = createCyreneMcpServer({ cwd: process.cwd() })

    expect(server).toBeDefined()
  })

  it('formats JSON as MCP text content', () => {
    expect(jsonText({ ok: true })).toEqual({
      content: [
        {
          type: 'text',
          text: '{\n  "ok": true\n}'
        }
      ]
    })
  })

  it('handles memory propose as MCP JSON text', async () => {
    const home = await createTempDir('cyrene-mcp-memory-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-mcp-memory-project-')

    const result = await handleMemoryPropose(
      {
        cwd,
        candidate: {
          domain: 'procedural',
          type: 'procedural_rule',
          candidateKind: 'project_decision',
          content: 'Codex memory proposals stay pending.',
          evidence: [{ runId: 'mcp-run-1', summary: 'MCP test.' }]
        }
      },
      process.cwd()
    )

    expect(result.content[0]?.type).toBe('text')
    expect(result.content[0]?.text).toContain('"action": "pending"')
    expect(result.content[0]?.text).toContain('"candidateKind": "project_decision"')
  })

  it('handles pending memory review MCP actions', async () => {
    const home = await createTempDir('cyrene-mcp-memory-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-mcp-memory-review-project-')

    const proposed = await handleMemoryPropose(
      {
        cwd,
        candidate: {
          domain: 'project',
          type: 'project_fact',
          content: 'Pending memory review tools are exposed through MCP.',
          evidence: [{ runId: 'mcp-review-run-1', summary: 'MCP review test.' }]
        }
      },
      process.cwd()
    )
    const proposedJson = JSON.parse(proposed.content[0]?.text ?? '{}')
    const candidateId = proposedJson.result.candidateId
    const reviewHash = proposedJson.result.review.reviewHash

    const listJson = JSON.parse((await handleMemoryPendingList({ cwd }, process.cwd())).content[0]?.text ?? '{}')
    expect(listJson.total).toBe(1)

    const getJson = JSON.parse((await handleMemoryPendingGet({ cwd, id: candidateId }, process.cwd())).content[0]?.text ?? '{}')
    expect(getJson.result.action).toBe('get')

    const editJson = JSON.parse(
      (await handleMemoryEdit(
        {
          cwd,
          id: candidateId,
          reviewHash,
          content: 'Pending memory review edit tools are exposed through MCP.',
          reason: 'Covered by MCP edit test.'
        },
        process.cwd()
      )).content[0]?.text ?? '{}'
    )
    expect(editJson.result.action).toBe('edit')
    const editedReviewHash = editJson.result.reviewHash

    const deferJson = JSON.parse(
      (await handleMemoryDefer(
        { cwd, id: candidateId, reviewHash: editedReviewHash, days: 14, reason: 'Covered by MCP defer test.' },
        process.cwd()
      )).content[0]?.text ?? '{}'
    )
    expect(deferJson.result.action).toBe('defer')
    const deferredReviewHash = deferJson.result.reviewHash

    const rejectJson = JSON.parse(
      (await handleMemoryReject({ cwd, id: candidateId, reviewHash: deferredReviewHash, reason: 'Covered by MCP test.' }, process.cwd()))
        .content[0]?.text ?? '{}'
    )
    expect(rejectJson.result.action).toBe('reject')

    const promoteJson = JSON.parse(
      (await handleMemoryPromote({ cwd, id: candidateId, reviewHash, reason: 'Covered by MCP test.' }, process.cwd()))
        .content[0]?.text ?? '{}'
    )
    expect(promoteJson.result.action).toBe('not_found')
  })

  it('handles global pending memory review MCP actions on the global root', async () => {
    const home = await createTempDir('cyrene-mcp-global-review-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-mcp-global-review-project-')

    const proposed = await handleMemoryPropose(
      {
        cwd,
        candidate: {
          domain: 'procedural',
          type: 'procedural_rule',
          scope: 'global',
          strength: 'hard',
          content: 'Global pending MCP review must use the global memory root.',
          evidence: [{ runId: 'mcp-global-review-run-1', summary: 'MCP global review test.' }]
        }
      },
      process.cwd()
    )
    const proposedJson = JSON.parse(proposed.content[0]?.text ?? '{}')
    const candidateId = proposedJson.result.candidateId
    const reviewHash = proposedJson.result.review.reviewHash
    expect(String(proposedJson.memoryRoot)).toContain('/.cyrene/codex/global/memory')

    const listJson = JSON.parse((await handleMemoryPendingList({ cwd }, process.cwd())).content[0]?.text ?? '{}')
    expect(listJson.total).toBe(1)
    expect(listJson.pending[0].id).toBe(candidateId)

    const getJson = JSON.parse((await handleMemoryPendingGet({ cwd, id: candidateId }, process.cwd())).content[0]?.text ?? '{}')
    expect(getJson.result.action).toBe('get')
    expect(String(getJson.memoryRoot)).toContain('/.cyrene/codex/global/memory')

    const rejectJson = JSON.parse(
      (await handleMemoryReject({ cwd, id: candidateId, reviewHash, reason: 'Covered by MCP global test.' }, process.cwd()))
        .content[0]?.text ?? '{}'
    )
    expect(rejectJson.result.action).toBe('reject')
    expect(String(rejectJson.memoryRoot)).toContain('/.cyrene/codex/global/memory')
  })

  it('handles active memory archive over MCP', async () => {
    const home = await createTempDir('cyrene-mcp-active-archive-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-mcp-active-archive-project-')
    const project = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    const memory: CyreneMemory = {
      id: 'mcp-active-archive',
      domain: 'project',
      type: 'project_fact',
      strength: 'hard',
      scope: 'project',
      status: 'active',
      content: 'MCP can archive active memory.',
      normalizedKey: 'mcp-can-archive-active-memory',
      evidence: [{ summary: 'MCP active seed.' }],
      source: 'file',
      scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.9, safety: 0.95, sensitivity: 0.1 },
      createdAt: '2026-05-30T00:00:00.000Z',
      updatedAt: '2026-05-30T00:00:00.000Z',
      tags: []
    }
    await writeActiveMemoriesFromRoot(memoryRoot, [memory])

    const archiveJson = JSON.parse(
      (await handleActiveMemoryArchive({
        cwd,
        id: memory.id,
        contentHash: contentHashForActiveMemory(memory),
        reason: 'Covered by MCP active archive test.'
      }, process.cwd())).content[0]?.text ?? '{}'
    )

    expect(archiveJson.result.action).toBe('archive')
    await expect(readActiveMemoriesFromRoot(memoryRoot)).resolves.toEqual([])
  })

  it('handles active memory feedback with fallback cwd and no cwd schema', async () => {
    const home = await createTempDir('cyrene-mcp-memory-feedback-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-mcp-memory-feedback-project-')
    const project = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    const memory: CyreneMemory = {
      id: 'mcp-feedback-active',
      domain: 'procedural',
      type: 'procedural_rule',
      strength: 'hard',
      scope: 'project',
      status: 'active',
      content: 'MCP records public active memory feedback.',
      normalizedKey: 'mcp-records-public-active-memory-feedback',
      evidence: [{ runId: 'mcp-feedback-run-1', summary: 'MCP feedback seed.' }],
      source: 'review_event',
      scores: {
        evidenceStrength: 0.95,
        stability: 0.9,
        usefulness: 0.9,
        safety: 0.95,
        sensitivity: 0.1
      },
      createdAt: '2026-06-04T00:00:00.000Z',
      updatedAt: '2026-06-04T00:00:00.000Z',
      tags: []
    }
    await writeActiveMemoriesFromRoot(memoryRoot, [memory])
    const source = await readFile(new URL('../src/mcp/tools/memory-feedback.ts', import.meta.url), 'utf8')

    expect(memoryFeedbackInputSchema).not.toHaveProperty('cwd')
    expect(source).not.toContain('input.cwd')

    const feedbackJson = JSON.parse(
      (await handleMemoryFeedback({
        memoryId: memory.id,
        contentHash: contentHashForActiveMemory(memory),
        event: 'applied',
        query: 'MCP records public active memory feedback.'
      }, cwd)).content[0]?.text ?? '{}'
    )

    expect(feedbackJson.result.action).toBe('recorded')
    expect(feedbackJson).not.toHaveProperty('cwd')
    await expect(readActivationEventsFromRoot(memoryRoot)).resolves.toEqual([
      expect.objectContaining({
        memoryId: memory.id,
        event: 'applied',
        queryHash: expect.stringMatching(/^[a-f0-9]{16}$/)
      })
    ])
  })

  it('handles memory promote conflict resolution over MCP', async () => {
    const home = await createTempDir('cyrene-mcp-conflict-resolution-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-mcp-conflict-resolution-project-')
    const normalizedKey = 'mcp-conflict-resolution-key'

    const proposed = await handleMemoryPropose(
      {
        cwd,
        candidate: {
          domain: 'project',
          type: 'project_fact',
          strength: 'hard',
          normalizedKey,
          content: 'Pending MCP memory should be kept alongside an explicit conflict.',
          evidence: [{ runId: 'mcp-conflict-run-1', summary: 'MCP conflict resolution test.' }]
        }
      },
      process.cwd()
    )
    const proposedJson = JSON.parse(proposed.content[0]?.text ?? '{}')
    await writeActiveMemoriesFromRoot(proposedJson.memoryRoot, [
      {
        id: 'mcp-active-conflict',
        domain: 'project',
        type: 'project_fact',
        strength: 'hard',
        scope: 'project',
        status: 'active',
        content: 'Existing MCP active memory should remain.',
        normalizedKey,
        evidence: [{ runId: 'mcp-active-run-1', summary: 'MCP active seed.' }],
        source: 'user_explicit',
        scores: {
          evidenceStrength: 0.95,
          stability: 0.9,
          usefulness: 0.9,
          safety: 0.95,
          sensitivity: 0.1
        },
        createdAt: '2026-05-24T00:00:00.000Z',
        updatedAt: '2026-05-24T00:00:00.000Z',
        tags: []
      }
    ])

    const promoteJson = JSON.parse(
      (await handleMemoryPromote(
        {
          cwd,
          id: proposedJson.result.candidateId,
          reviewHash: proposedJson.result.review.reviewHash,
          conflictResolution: 'keep_both'
        },
        process.cwd()
      )).content[0]?.text ?? '{}'
    )

    expect(promoteJson.result.action).toBe('promote')
    await expect(readActiveMemoriesFromRoot(proposedJson.memoryRoot)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: 'Pending MCP memory should be kept alongside an explicit conflict.' })
      ])
    )
  })

  it('handles memory automation and profile MCP tools as JSON text', async () => {
    const home = await createTempDir('cyrene-mcp-memory-automation-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-mcp-memory-automation-project-')

    const dailyJson = JSON.parse((await handleMemoryAutomationRun({ cwd, job: 'daily' }, process.cwd())).content[0]?.text ?? '{}')
    expect(dailyJson).toMatchObject({ job: 'daily', action: 'memory_lifecycle_daily', dryRun: true })

    const weeklyJson = JSON.parse((await handleMemoryAutomationRun({ cwd, job: 'weekly' }, process.cwd())).content[0]?.text ?? '{}')
    expect(weeklyJson).toMatchObject({ job: 'weekly', action: 'memory_lifecycle_weekly', dryRun: true })

    const profileJson = JSON.parse((await handleMemoryProfileGet({ cwd }, process.cwd())).content[0]?.text ?? '{}')
    expect(profileJson.project).toBeDefined()
    expect(profileJson.content).toEqual(expect.any(String))
  })

  it('handles project memory harvest with fallback cwd and no cwd schema', async () => {
    const home = await createTempDir('cyrene-mcp-harvest-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_BASE_URL', '')
    vi.stubEnv('CYRENE_MODEL', '')
    const cwd = await createTempDir('cyrene-mcp-harvest-project-')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'harvest-mcp-test' }), 'utf8')
    const source = await readFile(new URL('../src/mcp/tools/memory-harvest-project.ts', import.meta.url), 'utf8')

    expect(memoryHarvestProjectInputSchema).not.toHaveProperty('cwd')
    expect(memoryHarvestProjectInputSchema).toHaveProperty('dryRun')
    expect(memoryHarvestProjectInputSchema).toHaveProperty('apply')
    expect(memoryHarvestProjectInputSchema).toHaveProperty('previewId')
    expect(memoryHarvestProjectInputSchema).toHaveProperty('previewHash')
    expect(source).not.toContain('input.cwd')

    const result = await handleMemoryHarvestProject({ dryRun: true }, cwd)
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { action?: string; signals?: Array<{ files?: string[] }> }

    expect(result.content[0]?.type).toBe('text')
    expect(parsed.action).toBe('needs_model_config')
    expect(parsed.signals?.some((signal) => signal.files?.includes('package.json'))).toBe(true)
  })

  it('returns preview_required for MCP project harvest dryRun false without apply credentials', async () => {
    const home = await createTempDir('cyrene-mcp-harvest-preview-required-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_BASE_URL', '')
    vi.stubEnv('CYRENE_MODEL', '')
    const cwd = await createTempDir('cyrene-mcp-harvest-preview-required-project-')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'harvest-mcp-preview-required-test' }), 'utf8')

    const result = await handleMemoryHarvestProject({ dryRun: false }, cwd)
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { action?: string; modelCallCount?: number; reason?: string }

    expect(parsed).toMatchObject({
      action: 'preview_required',
      modelCallCount: 0
    })
    expect(parsed.reason).toContain('apply')
  })

  it('rejects MCP project harvest apply with dryRun', async () => {
    const home = await createTempDir('cyrene-mcp-harvest-apply-dry-run-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-mcp-harvest-apply-dry-run-project-')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'harvest-mcp-apply-dry-run-test' }), 'utf8')

    await expect(handleMemoryHarvestProject({
      dryRun: true,
      apply: true,
      previewId: 'harvest-00000000-0000-4000-8000-000000000000',
      previewHash: 'a'.repeat(64)
    }, cwd)).rejects.toThrow('memory harvest-project accepts only one of apply or dryRun')
  })

  it('requires explicit user consent in memory review tool descriptions', async () => {
    const source = await readFile(new URL('../src/mcp/mcp-server.ts', import.meta.url), 'utf8')

    expect(source).toContain('promote only after explicit user approval')
    expect(source).toContain('reject only after explicit user rejection')
  })

  it('documents daily and weekly memory automation MCP schema', async () => {
    const source = await readFile(new URL('../src/mcp/tools/memory-automation.ts', import.meta.url), 'utf8')
    const serverSource = await readFile(new URL('../src/mcp/mcp-server.ts', import.meta.url), 'utf8')

    expect(source).toContain("z.enum(['daily', 'weekly'])")
    expect(serverSource).toContain('Run Cyrene memory lifecycle automation')
    expect(serverSource).not.toContain('cyrene_memory_dream_run')
  })

  it('documents registered active memory MCP tools in the README registry', async () => {
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')

    for (const toolName of [
      'cyrene_memory_active_archive',
      'cyrene_memory_active_tombstone',
      'cyrene_memory_active_propose_edit',
      'cyrene_memory_active_supersede'
    ]) {
      expect(readme).toContain(toolName)
    }
  })

  it('exposes Codex pending review tools through a fresh MCP server', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
    const client = new Client({ name: 'cyrene-mcp-test', version: '0.0.0' })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'mcp-server', '--stdio'],
      env: cliEnv()
    })

    await client.connect(transport)
    try {
      const result = await client.listTools()
      const names = result.tools.map((tool) => tool.name)
      expect(names).toContain('cyrene_memory_pending_list')
      expect(names).toContain('cyrene_memory_pending_get')
      expect(names).toContain('cyrene_memory_promote')
      expect(names).toContain('cyrene_memory_reject')
      expect(names).toContain('cyrene_memory_edit')
      expect(names).toContain('cyrene_memory_defer')
      expect(names).toContain('cyrene_memory_automation_run')
      expect(names).not.toContain('cyrene_memory_dream_run')
      expect(names).toContain('cyrene_memory_profile_get')
      expect(names).toContain('cyrene_memory_harvest_project')
      expect(names).toContain('cyrene_memory_feedback')
      const schemasByName = new Map(result.tools.map((tool) => [tool.name, tool.inputSchema as { properties?: Record<string, unknown> }]))
      for (const toolName of [
        'cyrene_continuity_get',
        'cyrene_memory_propose',
        'cyrene_memory_feedback',
        'cyrene_memory_pending_list',
        'cyrene_memory_pending_get',
        'cyrene_memory_promote',
        'cyrene_memory_reject',
        'cyrene_memory_edit',
        'cyrene_memory_defer',
        'cyrene_memory_automation_run',
        'cyrene_memory_profile_get',
        'cyrene_memory_harvest_project',
        'cyrene_project_identify'
      ]) {
        expect(schemasByName.get(toolName)?.properties ?? {}).not.toHaveProperty('cwd')
      }
      expect(schemasByName.get('cyrene_continuity_get')?.properties ?? {}).toMatchObject({
        userMessage: expect.any(Object),
        task: expect.any(Object),
        mode: expect.any(Object),
        includeSimilarProjectHints: expect.any(Object),
        includePendingDetails: expect.any(Object),
        includePendingNotice: expect.any(Object),
        includeDiagnostics: expect.any(Object),
        recordRetrievedEvents: expect.any(Object),
        allowJsonlFallback: expect.any(Object),
        maxTokens: expect.any(Object)
      })
    } finally {
      await client.close()
    }
  })

  it('returns continuity diagnostics over MCP without mutating the index', async () => {
    const home = await createTempDir('cyrene-mcp-continuity-readonly-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-mcp-continuity-readonly-project-')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
    const client = new Client({ name: 'cyrene-continuity-readonly-test', version: '0.0.0' })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'mcp-server', '--stdio'],
      env: cliEnv()
    })

    await client.connect(transport)
    try {
      const result = await client.callTool({
        name: 'cyrene_continuity_get',
        arguments: {
          cwd,
          userMessage: 'read continuity diagnostics',
          task: 'coding',
          mode: 'review',
          includeDiagnostics: true
        }
      })
      const content = result.content as Array<{ type: string; text?: string }>
      const text = content.find((item) => item.type === 'text')?.text ?? '{}'
      const parsed = JSON.parse(text) as {
        diagnostics?: {
          memoryIndex?: {
            source?: string
            fallbackMode?: string
            freshness?: string
            routes?: string[]
          }
        }
      }
      expect(parsed.diagnostics?.memoryIndex).toMatchObject({
        source: 'sqlite',
        fallbackMode: 'sqlite',
        freshness: 'empty',
        routes: ['global', 'project', 'pending']
      })
      await expect(readFile(join(home, '.cyrene', 'codex', 'memory.db'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await client.close()
    }
  })

  it('exposes MCP tools from the built plugin runtime', async () => {
    await execFileAsync('npm', ['run', 'build:plugin'], { env: cliEnv() })
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
    const client = new Client({ name: 'cyrene-plugin-mcp-test', version: '0.0.0' })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['plugin/runtime/cyrene-continuity.mjs', 'mcp-server', '--stdio'],
      env: cliEnv()
    })

    await client.connect(transport)
    try {
      const result = await client.listTools()
      const names = result.tools.map((tool) => tool.name)
      expect(names).toContain('cyrene_continuity_get')
      expect(names).toContain('cyrene_memory_pending_list')
      expect(names).toContain('cyrene_memory_edit')
      expect(names).toContain('cyrene_memory_defer')
      expect(names).toContain('cyrene_memory_automation_run')
      expect(names).not.toContain('cyrene_memory_dream_run')
      expect(names).toContain('cyrene_memory_profile_get')
      expect(names).toContain('cyrene_memory_feedback')
    } finally {
      await client.close()
    }
  }, PLUGIN_BUILD_TEST_TIMEOUT_MS)

  it('documents pending review behavior in the Codex continuity skill', async () => {
    const source = await readFile(
      new URL('../plugin/skills/cyrene-continuity/SKILL.md', import.meta.url),
      'utf8'
    )

    expect(source).toContain('cyrene_memory_pending_list')
    expect(source).toContain('cyrene_memory_pending_get')
    expect(source).toContain('cyrene_memory_promote')
    expect(source).toContain('cyrene_memory_reject')
    expect(source).toContain('cyrene_memory_edit')
    expect(source).toContain('cyrene_memory_defer')
    expect(source).toContain('cyrene_memory_profile_get')
    expect(source).toContain('cyrene_memory_automation_run')
    expect(source).not.toContain('cyrene_memory_dream_run')
    expect(source).not.toContain('Dream Deep')
    expect(source).toContain('recommend repeated independent evidence for review')
    expect(source).not.toContain(['auto', 'promote'].join('-'))
    expect(source).toContain('pending is a review queue')
    expect(source).toContain('fast and balanced mode must not show pending candidates')
    expect(source).toContain('review mode is required for pending candidate review')
    expect(source).toContain('similar-project hints are transferable guidance, not current-project facts')
    expect(source).toContain('session-hints are not memory migration')
    expect(source).toContain('activation events are not memory')
    expect(source).not.toContain('Do not wait for the user to ask to review them')
    expect(source).not.toContain('immediately call `cyrene_memory_pending_list`')
    expect(source).toContain('Manual review queue candidates are not trial, validated, or core continuity memory')
  })

  it('accepts mcp-server as a local CLI command without treating it as a prompt', async () => {
    try {
      await execFileAsync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'mcp-server', '--http'], {
        env: cliEnv()
      })
      throw new Error('CLI unexpectedly succeeded')
    } catch (error) {
      expect((error as { code?: number }).code).toBe(1)
      const stderr = String((error as { stderr?: string }).stderr ?? '')
      expect(stderr).toContain('Usage: cyrene-continuity mcp-server --stdio')
      expect(stderr).not.toContain('Prompt cannot be empty.')
    }
  })

  it('prints bridge usage for unknown top-level commands', async () => {
    try {
      await execFileAsync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'memory'], {
        env: cliEnv()
      })
      throw new Error('CLI unexpectedly succeeded')
    } catch (error) {
      expect((error as { code?: number }).code).toBe(1)
      const stderr = String((error as { stderr?: string }).stderr ?? '')
      expect(stderr).toContain('Usage: cyrene-continuity <mcp-server --stdio|codex ...>')
    }
  })
})
