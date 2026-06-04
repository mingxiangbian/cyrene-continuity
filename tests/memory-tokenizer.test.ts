import { describe, expect, it } from 'vitest'
import { normalizeMemoryKey, tokenizeMemoryText, tokenOverlapScore } from '../src/memory/tokenizer.js'

describe('memory tokenizer', () => {
  it('expands Chinese memory terms into English technical aliases', () => {
    const tokens = tokenizeMemoryText('多智能体审查')

    expect(tokens).toEqual(expect.arrayContaining([
      '多智能体',
      '审查',
      'multi-agent',
      'multi_agent',
      'multiagent',
      'review',
      'audit'
    ]))
  })

  it.each([
    ['多智能体审查', 'multi-agent review'],
    ['仓库更新验证', 'repo update verification'],
    ['上下文污染', 'context pollution']
  ])('matches bilingual memory query %s -> %s', (left, right) => {
    expect(tokenOverlapScore(left, right)).toBeGreaterThanOrEqual(0.5)
  })

  it('builds stable normalized keys with alias-aware tokens', () => {
    expect(normalizeMemoryKey('多智能体审查')).toContain('multi-agent')
    expect(normalizeMemoryKey('repo update verification')).toContain('repo')
  })
})
