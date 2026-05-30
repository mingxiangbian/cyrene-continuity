import type { AppConfig } from './config.js'

export type ModelUseCase = 'chat' | 'planning' | 'coding' | 'summarization' | 'memory_extraction' | 'affect_analysis' | 'reflection'
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ModelToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatMessage {
  role: ChatRole
  content: string
  tool_call_id?: string
  tool_calls?: ModelToolCall[]
}

export interface CallModelInput {
  config: AppConfig
  messages: ChatMessage[]
  tools: unknown[]
  useCase?: ModelUseCase
  signal?: AbortSignal
}

export interface ModelResponse {
  content: string
  toolCalls: ModelToolCall[]
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: ModelToolCall[]
    }
  }>
}

export async function callModel(input: CallModelInput): Promise<ModelResponse> {
  const model = modelForUseCase(input.config, input.useCase ?? 'chat')
  validateModelConfig(input.config, model)
  const attempts = input.config.llmRetryMaxAttempts
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${input.config.model.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: requestHeaders(input.config),
        signal: mergeAbortSignals(AbortSignal.timeout(input.config.llmRequestTimeoutMs), input.signal),
        body: JSON.stringify({
          model,
          messages: input.messages.map(formatRequestMessage),
          ...(input.tools.length > 0 ? { tools: input.tools } : {}),
          temperature: input.config.model.temperature
        })
      })
      if (!response.ok) {
        const body = await response.text()
        if (attempt < attempts && isRetryableStatus(response.status)) {
          await waitForRetry(input.config.llmRetryBaseDelayMs, attempt, input.signal)
          continue
        }
        throw new Error(`LLM request failed with HTTP ${response.status}: ${body}`)
      }
      const data = await response.json() as ChatCompletionResponse
      const message = data.choices?.[0]?.message
      return {
        content: message?.content ?? '',
        toolCalls: message?.tool_calls ?? []
      }
    } catch (error) {
      if (attempt < attempts && isRetryableFetchError(error)) {
        await waitForRetry(input.config.llmRetryBaseDelayMs, attempt, input.signal)
        continue
      }
      throw error
    }
  }
  throw new Error('LLM request failed without returning a response.')
}

function formatRequestMessage(message: ChatMessage): ChatMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.tool_call_id === undefined ? {} : { tool_call_id: message.tool_call_id }),
    ...(message.tool_calls === undefined ? {} : { tool_calls: message.tool_calls })
  }
}

function modelForUseCase(config: AppConfig, useCase: ModelUseCase): string {
  return ['summarization', 'memory_extraction', 'affect_analysis'].includes(useCase)
    ? config.model.cheapModel || config.model.strongModel || config.model.model
    : config.model.strongModel || config.model.model
}

function requestHeaders(config: AppConfig): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (config.model.apiKey?.trim()) headers.authorization = `Bearer ${config.model.apiKey}`
  return headers
}

function validateModelConfig(config: AppConfig, routeModel: string): void {
  const missing: string[] = []
  if (config.model.baseUrl.trim() === '') missing.push('CYRENE_BASE_URL')
  if (config.model.model.trim() === '' || routeModel.trim() === '') missing.push('CYRENE_MODEL')
  if (modelBaseUrlRequiresApiKey(config.model.baseUrl) && !config.model.apiKey?.trim()) {
    missing.push('CYRENE_API_KEY')
  }
  if (missing.length > 0) throw new Error(`Model config is incomplete: set ${missing.join(' and ')}.`)
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function isRetryableFetchError(error: unknown): boolean {
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return false
  }
  return error instanceof TypeError
}

async function waitForRetry(baseDelayMs: number, attempt: number, signal?: AbortSignal): Promise<void> {
  const delayMs = baseDelayMs * 2 ** (attempt - 1)
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timeout)
      cleanup()
      reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    }
    if (signal !== undefined) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

export function modelBaseUrlRequiresApiKey(baseUrl: string): boolean {
  const trimmed = baseUrl.trim()
  if (trimmed === '') return false
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return !['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(host)
  } catch {
    return false
  }
}

function mergeAbortSignals(timeoutSignal: AbortSignal, inputSignal?: AbortSignal): AbortSignal {
  return inputSignal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, inputSignal])
}
