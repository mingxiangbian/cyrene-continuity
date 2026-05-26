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
