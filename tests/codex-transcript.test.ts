import { describe, expect, it } from 'vitest'
import { parseTranscriptMessages, recentTranscriptMessages } from '../src/codex/transcript.js'

describe('Codex transcript parsing', () => {
  it('parses string and array text content from JSONL transcript lines', () => {
    const messages = parseTranscriptMessages(
      [
        JSON.stringify({ role: 'user', content: 'hello' }),
        JSON.stringify({ message: { role: 'assistant', content: [{ text: 'world' }] } }),
        'not json'
      ].join('\n')
    )

    expect(messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' }
    ])
  })

  it('parses Codex event transcript user and agent messages', () => {
    const messages = parseTranscriptMessages(
      [
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: '记住：项目总结要能进入 pending。' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: '收到。' } }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'developer',
            content: [{ type: 'input_text', text: 'internal instructions should not become transcript memory text' }]
          }
        })
      ].join('\n')
    )

    expect(messages).toEqual([
      { role: 'user', content: '记住：项目总结要能进入 pending。' },
      { role: 'assistant', content: '收到。' }
    ])
  })

  it('keeps only the most recent messages after parsing', () => {
    const messages = Array.from({ length: 45 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message-${index}`
    }))

    expect(recentTranscriptMessages(messages, 40)).toHaveLength(40)
    expect(recentTranscriptMessages(messages, 40)[0]?.content).toBe('message-5')
    expect(recentTranscriptMessages(messages, 40)[39]?.content).toBe('message-44')
  })

  it('returns no messages when the recent message limit is zero', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' }
    ]

    expect(recentTranscriptMessages(messages, 0)).toEqual([])
  })
})
