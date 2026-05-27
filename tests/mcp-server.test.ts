import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonText } from '../src/mcp/mcp-json.js'
import { createCyreneMcpServer } from '../src/mcp/mcp-server.js'
import { handleMemoryPropose } from '../src/mcp/tools/memory-propose.js'
import {
  handleMemoryPendingGet,
  handleMemoryPendingList,
  handleMemoryPromote,
  handleMemoryReject
} from '../src/mcp/tools/memory-review.js'
import { handleMemoryDreamRun, handleMemoryProfileGet } from '../src/mcp/tools/memory-dream.js'

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
          content: 'Codex memory proposals stay pending.',
          evidence: [{ runId: 'mcp-run-1', summary: 'MCP test.' }]
        }
      },
      process.cwd()
    )

    expect(result.content[0]?.type).toBe('text')
    expect(result.content[0]?.text).toContain('"action": "pending"')
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

    const rejectJson = JSON.parse(
      (await handleMemoryReject({ cwd, id: candidateId, reviewHash, reason: 'Covered by MCP test.' }, process.cwd()))
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

  it('handles memory dream and profile MCP tools as JSON text', async () => {
    const home = await createTempDir('cyrene-mcp-memory-dream-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-mcp-memory-dream-project-')

    const dreamJson = JSON.parse((await handleMemoryDreamRun({ cwd, stage: 'light' }, process.cwd())).content[0]?.text ?? '{}')
    expect(dreamJson.roots[0]).toMatchObject({ stage: 'light' })

    const profileJson = JSON.parse((await handleMemoryProfileGet({ cwd }, process.cwd())).content[0]?.text ?? '{}')
    expect(profileJson.project).toBeDefined()
    expect(profileJson.content).toEqual(expect.any(String))
  })

  it('requires explicit user consent in memory review tool descriptions', async () => {
    const source = await readFile(new URL('../src/mcp/mcp-server.ts', import.meta.url), 'utf8')

    expect(source).toContain('promote only after explicit user approval')
    expect(source).toContain('reject only after explicit user rejection')
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
      expect(names).toContain('cyrene_memory_dream_run')
      expect(names).toContain('cyrene_memory_profile_get')
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
      expect(names).toContain('cyrene_memory_dream_run')
      expect(names).toContain('cyrene_memory_profile_get')
    } finally {
      await client.close()
    }
  })

  it('documents pending review behavior in the Codex continuity skill', async () => {
    const source = await readFile(
      new URL('../plugin/skills/cyrene-continuity/SKILL.md', import.meta.url),
      'utf8'
    )

    expect(source).toContain('cyrene_memory_pending_list')
    expect(source).toContain('cyrene_memory_pending_get')
    expect(source).toContain('cyrene_memory_promote')
    expect(source).toContain('cyrene_memory_reject')
    expect(source).toContain('cyrene_memory_profile_get')
    expect(source).toContain('cyrene_memory_dream_run')
    expect(source).toContain('Dream Deep')
    expect(source).toContain('show pending candidates as review candidates')
    expect(source).toContain('Do not wait for the user to ask to review them')
    expect(source).toContain('Only present candidates that are confirmed by pending list/get')
    expect(source).toContain('Pending memory candidates are not active continuity memory')
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
