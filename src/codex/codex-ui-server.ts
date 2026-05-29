import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { handleCodexUiApiRequest, type CodexUiApiResponse } from './codex-ui-api.js'
import { getCodexUiStaticAsset } from './codex-ui-static.js'
import type { CallModelInput, ModelResponse } from '../llm-client.js'

export interface CodexUiServer {
  host: '127.0.0.1'
  port: number
  url: string
  close(): Promise<void>
}

export interface StartCodexUiServerInput {
  cwd: string
  port?: number
  uiToken?: string
  callModel?: (input: CallModelInput) => Promise<ModelResponse>
}

interface CodexUiServerContext extends StartCodexUiServerInput {
  uiToken: string
}

const HOST = '127.0.0.1'
const DEFAULT_PORT = 47833
const FOLLOWING_PORT_ATTEMPTS = 20
const MAX_BODY_BYTES = 65_536
const STATIC_CACHE_CONTROL = 'no-store, no-cache'

export async function startCodexUiServer(input: StartCodexUiServerInput): Promise<CodexUiServer> {
  if (input.port === 0) {
    return listen(input, input.port)
  }
  return listenWithFallback(input, input.port ?? DEFAULT_PORT)
}

async function listenWithFallback(input: StartCodexUiServerInput, requestedPort: number): Promise<CodexUiServer> {
  let lastError: unknown
  for (let offset = 0; offset <= FOLLOWING_PORT_ATTEMPTS; offset += 1) {
    const port = requestedPort + offset
    try {
      return await listen(input, port)
    } catch (error) {
      if (!isAddressInUseError(error)) throw error
      lastError = error
    }
  }
  throw lastError
}

function listen(input: StartCodexUiServerInput, port: number): Promise<CodexUiServer> {
  return new Promise((resolve, reject) => {
    const context: CodexUiServerContext = {
      ...input,
      uiToken: input.uiToken ?? createUiToken()
    }
    const server = createServer((request, response) => {
      handleRequest(context, request, response).catch((error: unknown) => {
        handleUnhandledRequestError(request, response, error)
      })
    })

    const onError = (error: Error) => {
      server.close()
      reject(error)
    }

    server.once('error', onError)
    server.listen(port, HOST, () => {
      server.off('error', onError)
      const address = server.address()
      if (!isAddressInfo(address)) {
        server.close()
        reject(new Error('Codex UI server did not bind to a TCP port.'))
        return
      }
      resolve(createCodexUiServer(server, address.port))
    })
  })
}

function createCodexUiServer(server: Server, port: number): CodexUiServer {
  let closed = false
  return {
    host: HOST,
    port,
    url: `http://${HOST}:${port}`,
    close: () => new Promise<void>((resolve, reject) => {
      if (closed) {
        resolve()
        return
      }
      closed = true
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

function handleUnhandledRequestError(request: IncomingMessage, response: ServerResponse, error: unknown): void {
  if (response.headersSent || response.writableEnded) {
    response.destroy()
    return
  }

  const pathname = safeRequestPathname(request)
  if (pathname?.startsWith('/api/')) {
    writeJson(response, 500, failure('internal_error', errorMessage(error)))
    return
  }
  writePlain(response, 500, 'Internal server error\n')
}

async function handleRequest(
  input: CodexUiServerContext,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const url = requestUrl(request)
  if (url.pathname.startsWith('/api/')) {
    await handleApiRequest(input, request, response, url.pathname, url.searchParams)
    return
  }
  handleStaticRequest(response, url.pathname)
}

async function handleApiRequest(
  input: CodexUiServerContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  searchParams: URLSearchParams
): Promise<void> {
  try {
    const method = request.method ?? 'GET'
    if (isNonGetMethod(method) && isCrossOriginRequest(request)) {
      writeJson(response, 403, failure('cross_origin_forbidden', 'Cross-origin non-GET API requests are not allowed.'))
      return
    }
    if (isNonGetMethod(method) && !hasValidUiToken(request, input.uiToken)) {
      writeJson(response, 403, failure('csrf_forbidden', 'Missing or invalid Cyrene UI session token.'))
      return
    }
    const body = needsBody(method) ? await readJsonBody(request) : undefined
    const result = await handleCodexUiApiRequest({
      cwd: input.cwd,
      method,
      pathname,
      searchParams,
      body,
      uiToken: input.uiToken,
      callModel: input.callModel
    })
    writeJson(response, result.status, result.body)
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      writeJson(response, 413, failure('request_body_too_large', 'Request body exceeds 64 KiB.'))
      return
    }
    if (error instanceof InvalidJsonError) {
      writeJson(response, 400, failure('invalid_json', 'Request body must be valid JSON.'))
      return
    }
    writeJson(response, 500, failure('internal_error', errorMessage(error)))
  }
}

function handleStaticRequest(response: ServerResponse, pathname: string): void {
  try {
    if (pathname === '/favicon.ico') {
      writeNoContent(response)
      return
    }
    const asset = getCodexUiStaticAsset(pathname)
    if (asset === undefined) {
      writePlain(response, 404, 'Not found\n')
      return
    }
    response.writeHead(200, {
      'content-type': asset.contentType,
      'cache-control': STATIC_CACHE_CONTROL
    })
    response.end(asset.body)
  } catch (error) {
    writePlain(response, 500, `${errorMessage(error)}\n`)
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) {
      throw new RequestBodyTooLargeError()
    }
    chunks.push(buffer)
  }

  if (chunks.length === 0) return undefined
  const content = Buffer.concat(chunks).toString('utf8')
  if (content.trim() === '') return undefined

  try {
    return JSON.parse(content) as unknown
  } catch {
    throw new InvalidJsonError()
  }
}

function writeJson(response: ServerResponse, status: number, body: CodexUiApiResponse<unknown>): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  response.end(`${JSON.stringify(body, null, 2)}\n`)
}

function writePlain(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': STATIC_CACHE_CONTROL
  })
  response.end(body)
}

function writeNoContent(response: ServerResponse): void {
  response.writeHead(204, {
    'cache-control': STATIC_CACHE_CONTROL
  })
  response.end()
}

function requestPathname(request: IncomingMessage): string {
  return requestUrl(request).pathname
}

function requestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', `http://${HOST}`)
}

function safeRequestPathname(request: IncomingMessage): string | undefined {
  try {
    return requestPathname(request)
  } catch {
    return undefined
  }
}

function needsBody(method: string): boolean {
  return isStateChangingMethod(method)
}

function isStateChangingMethod(method: string): boolean {
  const upperMethod = method.toUpperCase()
  return upperMethod === 'POST' || upperMethod === 'PUT' || upperMethod === 'PATCH'
}

function isNonGetMethod(method: string): boolean {
  return method.toUpperCase() !== 'GET'
}

function isCrossOriginRequest(request: IncomingMessage): boolean {
  const fetchSite = singleHeaderValue(request.headers['sec-fetch-site'])?.toLowerCase()
  if (fetchSite === 'cross-site') return true

  const origin = singleHeaderValue(request.headers.origin)
  if (origin === undefined) return false

  const host = singleHeaderValue(request.headers.host)
  if (host === undefined) return true

  try {
    return new URL(origin).host !== host
  } catch {
    return true
  }
}

function createUiToken(): string {
  return randomBytes(32).toString('hex')
}

function hasValidUiToken(request: IncomingMessage, expectedToken: string): boolean {
  return singleHeaderValue(request.headers['x-cyrene-ui-token']) === expectedToken
}

function singleHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function failure(code: string, message: string): CodexUiApiResponse<never> {
  return { ok: false, error: { code, message } }
}

function isAddressInfo(address: ReturnType<Server['address']>): address is AddressInfo {
  return typeof address === 'object' && address !== null && 'port' in address
}

function isAddressInUseError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class InvalidJsonError extends Error {}
class RequestBodyTooLargeError extends Error {}
