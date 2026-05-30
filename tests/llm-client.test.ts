import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultConfig } from '../src/config.js'
import { callModel, type ModelToolCall } from '../src/llm-client.js'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('llm client', () => {
  it('preserves OpenAI-compatible tool fields in requests and responses', async () => {
    const toolCall: ModelToolCall = {
      id: 'call-1',
      type: 'function',
      function: {
        name: 'remember',
        arguments: '{"value":"ok"}'
      }
    }
    const tool = {
      type: 'function',
      function: {
        name: 'remember',
        parameters: {
          type: 'object',
          properties: {
            value: { type: 'string' }
          }
        }
      }
    }
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: 'ok',
              tool_calls: [toolCall]
            }
          }
        ]
      }))
    )
    vi.stubGlobal('fetch', fetchMock)

    const config = {
      ...createDefaultConfig(process.cwd()),
      model: {
        baseUrl: 'https://llm.example.test',
        model: 'strong',
        apiKey: 'test-key',
        temperature: 0,
        strongModel: 'strong',
        cheapModel: 'cheap'
      }
    }

    const result = await callModel({
      config,
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [toolCall]
        },
        {
          role: 'tool',
          content: '{"saved":true}',
          tool_call_id: 'call-1'
        }
      ],
      tools: [tool]
    })

    const request = fetchMock.mock.calls[0]?.[1]
    if (request === undefined) {
      throw new Error('fetch was not called with request options')
    }
    const body = JSON.parse(String(request.body)) as {
      messages: unknown[]
      tools: unknown[]
    }
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [toolCall]
      },
      {
        role: 'tool',
        content: '{"saved":true}',
        tool_call_id: 'call-1'
      }
    ])
    expect(body.tools).toEqual([tool])
    expect(result.toolCalls).toEqual([toolCall])
  })

  it('rejects hosted endpoints without an API key before fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const config = {
      ...createDefaultConfig(process.cwd()),
      model: {
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        temperature: 0,
        strongModel: 'deepseek-v4-pro',
        cheapModel: 'deepseek-v4-flash'
      }
    }

    await expect(callModel({
      config,
      messages: [{ role: 'user', content: 'Summarize.' }],
      tools: []
    })).rejects.toThrow('CYRENE_API_KEY')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries transient LLM failures before returning a successful response', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('server unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }]
      })))
    vi.stubGlobal('fetch', fetchMock)
    const config = {
      ...createDefaultConfig(process.cwd()),
      llmRetryMaxAttempts: 3,
      llmRetryBaseDelayMs: 25,
      model: {
        baseUrl: 'https://llm.example.test',
        model: 'strong',
        apiKey: 'test-key',
        temperature: 0,
        strongModel: 'strong',
        cheapModel: 'cheap'
      }
    }

    const promise = callModel({
      config,
      messages: [{ role: 'user', content: 'Summarize.' }],
      tools: []
    })
    await vi.advanceTimersByTimeAsync(25)
    await vi.advanceTimersByTimeAsync(50)

    await expect(promise).resolves.toMatchObject({ content: 'ok' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-transient LLM request failures', async () => {
    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    const config = {
      ...createDefaultConfig(process.cwd()),
      llmRetryMaxAttempts: 3,
      llmRetryBaseDelayMs: 1,
      model: {
        baseUrl: 'https://llm.example.test',
        model: 'strong',
        apiKey: 'test-key',
        temperature: 0,
        strongModel: 'strong',
        cheapModel: 'cheap'
      }
    }

    await expect(callModel({
      config,
      messages: [{ role: 'user', content: 'Summarize.' }],
      tools: []
    })).rejects.toThrow('HTTP 400')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
