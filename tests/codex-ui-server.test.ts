import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startCodexUiServer, type CodexUiServer } from '../src/codex/codex-ui-server.js'

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

  it('returns plain text 404 for missing static routes', async () => {
    const localServer = await startTestServer()

    const response = await fetch(`${localServer.url}/missing.js`)
    const body = await response.text()

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(body).toBe('Not found\n')
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

    const response = await fetch(`${localServer.url}/api/memory/harvest-project/dry-run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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

  it('returns structured JSON when request body exceeds 64 KiB', async () => {
    const localServer = await startTestServer()

    const response = await fetch(`${localServer.url}/api/memory/harvest-project/dry-run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
})
