import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { startCodexUiServer, type CodexUiServer } from '../src/codex/codex-ui-server.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import type { CyreneMemory } from '../src/memory/types.js'

const originalHome = process.env.HOME
const tempDirs: string[] = []
let server: CodexUiServer | undefined

afterEach(async () => {
  if (server !== undefined) {
    await server.close()
    server = undefined
  }
  vi.unstubAllEnvs()
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function createProject(): Promise<string> {
  const cwd = await createTempDir('cyrene-ui-server-project-')
  await writeFile(join(cwd, 'package.json'), '{"name":"cyrene-ui-server-test"}\n')
  return cwd
}

async function startTestServer(): Promise<CodexUiServer> {
  const home = await createTempDir('cyrene-ui-server-home-')
  vi.stubEnv('HOME', home)
  const cwd = await createProject()
  server = await startCodexUiServer({ cwd, port: 0 })
  return server
}

async function readJson(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>
}

async function fetchSessionToken(localServer: CodexUiServer): Promise<string> {
  const response = await fetch(`${localServer.url}/api/session`)
  const body = await readJson(response) as { ok: true; data: { token: string } }
  expect(response.status).toBe(200)
  expect(body.ok).toBe(true)
  expect(body.data.token).toMatch(/^[a-f0-9]{64}$/)
  return body.data.token
}

function createActiveMemory(id: string, content: string, scope: CyreneMemory['scope']): CyreneMemory {
  return {
    id,
    domain: scope === 'global' ? 'procedural' : 'project',
    type: scope === 'global' ? 'procedural_rule' : 'project_fact',
    strength: 'hard',
    scope,
    status: 'active',
    content,
    normalizedKey: id,
    evidence: [{ runId: `${id}-run`, summary: `${id} seed.` }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
    tags: []
  }
}

async function seedActiveMemoryRoot(memoryRoot: string, memories: CyreneMemory[]): Promise<void> {
  await mkdir(memoryRoot, { recursive: true })
  await writeFile(join(memoryRoot, 'index.jsonl'), memories.map((memory) => JSON.stringify(memory)).join('\n') + '\n')
}

describe('startCodexUiServer', () => {
  it('starts on localhost with an assigned port and close handle', async () => {
    const localServer = await startTestServer()

    expect(localServer.host).toBe('127.0.0.1')
    expect(localServer.port).toBeGreaterThan(0)
    expect(localServer.url).toBe(`http://127.0.0.1:${localServer.port}`)
    expect(localServer.close).toEqual(expect.any(Function))
  })

  it('serves the bundled index HTML at /', async () => {
    const localServer = await startTestServer()

    const response = await fetch(`${localServer.url}/`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('cache-control')).toBe('no-store, no-cache')
    expect(body).toContain('Cyrene Memory Console')
  })

  it('serves API JSON with no-store caching', async () => {
    const localServer = await startTestServer()

    const response = await fetch(`${localServer.url}/api/status`)
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toMatchObject({ ok: true })
  })

  it('serves a per-server UI session token', async () => {
    const localServer = await startTestServer()

    const token = await fetchSessionToken(localServer)

    expect(token).toMatch(/^[a-f0-9]{64}$/)
  })

  it('returns plain text 404 for missing static routes', async () => {
    const localServer = await startTestServer()

    const response = await fetch(`${localServer.url}/missing.js`)
    const body = await response.text()

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(response.headers.get('cache-control')).toBe('no-store, no-cache')
    expect(body).toBe('Not found\n')
  })

  it('returns an empty favicon response without logging a browser 404', async () => {
    const localServer = await startTestServer()

    const response = await fetch(`${localServer.url}/favicon.ico`)
    const body = await response.text()

    expect(response.status).toBe(204)
    expect(response.headers.get('cache-control')).toBe('no-store, no-cache')
    expect(body).toBe('')
  })

  it('releases the listener when closed', async () => {
    const localServer = await startTestServer()
    const assignedPort = localServer.port
    await localServer.close()
    server = undefined

    const replacement = await startCodexUiServer({ cwd: await createProject(), port: assignedPort })
    expect(replacement.port).toBe(assignedPort)
    await replacement.close()
  })

  it('falls back from an occupied explicit nonzero port', async () => {
    const reserved = await startTestServer()
    const requestedPort = reserved.port
    let fallback: CodexUiServer | undefined

    try {
      fallback = await startCodexUiServer({ cwd: await createProject(), port: requestedPort })

      expect(fallback.host).toBe('127.0.0.1')
      expect(fallback.port).not.toBe(requestedPort)
      expect(fallback.port).toBeGreaterThan(requestedPort)
    } finally {
      if (fallback !== undefined) {
        await fallback.close()
      }
      await reserved.close()
      server = undefined
    }
  })

  it('returns structured JSON 404 for missing API routes', async () => {
    const localServer = await startTestServer()

    const response = await fetch(`${localServer.url}/api/missing`)
    const body = await readJson(response)

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'not_found' }
    })
  })

  it('returns structured JSON for malformed request JSON', async () => {
    const localServer = await startTestServer()
    const token = await fetchSessionToken(localServer)

    const response = await fetch(`${localServer.url}/api/memory/harvest-project/dry-run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cyrene-ui-token': token
      },
      body: '{bad-json'
    })
    const body = await readJson(response)

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'invalid_json' }
    })
  })

  it('rejects same-origin non-GET API requests without the UI token before body parsing', async () => {
    const localServer = await startTestServer()

    const response = await fetch(`${localServer.url}/api/memory/harvest-project/dry-run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad-json'
    })
    const body = await readJson(response)

    expect(response.status).toBe(403)
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'csrf_forbidden' }
    })
  })

  it('rejects same-origin non-GET API requests with the wrong UI token', async () => {
    const localServer = await startTestServer()

    const response = await fetch(`${localServer.url}/api/memory/harvest-project/dry-run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cyrene-ui-token': 'wrong-token'
      },
      body: '{}'
    })
    const body = await readJson(response)

    expect(response.status).toBe(403)
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'csrf_forbidden' }
    })
  })

  it('allows same-origin non-GET API requests with the UI token to reach body validation', async () => {
    const localServer = await startTestServer()
    const token = await fetchSessionToken(localServer)

    const response = await fetch(`${localServer.url}/api/memory/harvest-project/dry-run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cyrene-ui-token': token
      },
      body: '{bad-json'
    })
    const body = await readJson(response)

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'invalid_json' }
    })
  })

  it('rejects cross-site state-changing API requests before model calls', async () => {
    const home = await createTempDir('cyrene-ui-server-cross-site-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_BASE_URL', 'https://example.invalid/v1')
    vi.stubEnv('CYRENE_MODEL', 'test-model')
    const cwd = await createProject()
    let callCount = 0
    server = await startCodexUiServer({
      cwd,
      port: 0,
      callModel: async () => {
        callCount += 1
        return { content: '{"candidates":[]}', toolCalls: [] }
      }
    })

    const response = await fetch(`${server.url}/api/memory/harvest-project/dry-run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://example.invalid',
        'sec-fetch-site': 'cross-site'
      },
      body: '{}'
    })
    const body = await readJson(response)

    expect(response.status).toBe(403)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'cross_origin_forbidden' }
    })
    expect(callCount).toBe(0)
  })

  it('rejects cross-site non-GET API requests before route dispatch', async () => {
    const localServer = await startTestServer()

    for (const method of ['DELETE', 'OPTIONS']) {
      const response = await fetch(`${localServer.url}/api/status`, {
        method,
        headers: {
          origin: 'https://example.invalid',
          'sec-fetch-site': 'cross-site'
        }
      })
      const body = await readJson(response)

      expect(response.status).toBe(403)
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(body).toMatchObject({
        ok: false,
        error: { code: 'cross_origin_forbidden' }
      })
    }
  })

  it('returns structured JSON when request body exceeds 64 KiB', async () => {
    const localServer = await startTestServer()
    const token = await fetchSessionToken(localServer)

    const response = await fetch(`${localServer.url}/api/memory/harvest-project/dry-run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cyrene-ui-token': token
      },
      body: 'x'.repeat(65_537)
    })
    const body = await readJson(response)

    expect(response.status).toBe(413)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'request_body_too_large' }
    })
  })

  it('serves projects and scoped dashboard data without exposing API keys', async () => {
    const home = await createTempDir('cyrene-ui-server-scope-home-')
    vi.stubEnv('HOME', home)
    vi.stubEnv('CYRENE_BASE_URL', 'https://api.openai.com/v1')
    vi.stubEnv('CYRENE_MODEL', 'gpt-4.1-mini')
    vi.stubEnv('CYRENE_API_KEY', 'secret-key-value')
    const cwd = await createProject()
    const current = await identifyCodexProject(cwd)
    await seedActiveMemoryRoot(codexGlobalMemoryRoot(), [
      createActiveMemory('global-rule', 'Global memory applies across projects.', 'global')
    ])
    await seedActiveMemoryRoot(codexProjectMemoryRoot(current.projectId), [
      createActiveMemory('current-fact', 'Current project memory stays local.', 'project')
    ])
    await seedActiveMemoryRoot(codexProjectMemoryRoot('other-project'), [
      createActiveMemory('other-fact', 'Other project memory can be inspected.', 'project')
    ])
    await writeFile(
      join(home, '.cyrene', 'codex', 'projects', 'other-project', 'project.json'),
      '{"projectId":"other-project","aliases":["Other Project"]}\n'
    )
    server = await startCodexUiServer({ cwd, port: 0 })

    const projectsResponse = await fetch(`${server.url}/api/projects`)
    const projectsBody = await readJson(projectsResponse) as {
      ok: true
      data: { currentProjectId: string; projects: Array<{ projectId: string; displayName: string }>; global: { counts: { active: number } } }
    }
    expect(projectsResponse.status).toBe(200)
    expect(projectsBody.ok).toBe(true)
    expect(projectsBody.data.currentProjectId).toBe(current.projectId)
    expect(projectsBody.data.global.counts.active).toBe(1)
    expect(projectsBody.data.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectId: current.projectId, displayName: current.displayName }),
      expect.objectContaining({ projectId: 'other-project', displayName: 'Other Project' })
    ]))

    const globalDashboardResponse = await fetch(`${server.url}/api/dashboard?scope=global`)
    const globalDashboard = await readJson(globalDashboardResponse) as {
      ok: true
      data: {
        selection: { scope: string; label: string }
        active: { active: CyreneMemory[] }
        modelConfig: { configured: boolean; apiKeyConfigured: boolean; apiKeyPreview?: string }
      }
    }
    expect(globalDashboardResponse.status).toBe(200)
    expect(globalDashboard.data.selection).toMatchObject({ scope: 'global', label: 'Global' })
    expect(globalDashboard.data.active.active.map((memory) => memory.content)).toEqual(['Global memory applies across projects.'])
    expect(globalDashboard.data.modelConfig).toMatchObject({ configured: true, apiKeyConfigured: true })
    expect(JSON.stringify(globalDashboard.data.modelConfig)).not.toContain('secret-key-value')

    const otherDashboardResponse = await fetch(`${server.url}/api/dashboard?scope=project&projectId=other-project`)
    const otherDashboard = await readJson(otherDashboardResponse) as {
      ok: true
      data: { selection: { scope: string; projectId: string; label: string }; active: { active: CyreneMemory[] } }
    }
    expect(otherDashboardResponse.status).toBe(200)
    expect(otherDashboard.data.selection).toMatchObject({
      scope: 'project',
      projectId: 'other-project',
      label: 'Other Project'
    })
    expect(otherDashboard.data.active.active.map((memory) => memory.content)).toEqual(['Other project memory can be inspected.'])
  })
})
