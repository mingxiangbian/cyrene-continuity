import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultConfig } from '../src/config.js'
import { callModel, type ModelToolCall } from '../src/llm-client.js'

afterEach(() => {
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
})
