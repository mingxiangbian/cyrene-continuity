import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRetrievalPolicy, parseContextMode, type ContextMode } from '../src/codex/context-policy.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('context policy', () => {
  it('defaults ordinary reads to fast mode without review side effects', () => {
    expect(buildRetrievalPolicy({})).toMatchObject({
      mode: 'fast',
      maxTokens: 800,
      includePendingDetails: false,
      includePendingNotice: false,
      includeDiagnostics: false,
      includeSimilarProjectHints: false,
      includeSessionHints: false,
      includeFullProfile: false,
      includeFastSummaries: true,
      recordRetrievedEvents: false,
      allowJsonlFallback: true,
      allowHotPathIndexRebuild: false
    })
  })

  it('uses balanced mode for explicit richer context without pending review visibility', () => {
    expect(buildRetrievalPolicy({ mode: 'balanced' })).toMatchObject({
      mode: 'balanced',
      maxTokens: 1200,
      includePendingDetails: false,
      includePendingNotice: false,
      includeDiagnostics: false,
      includeSimilarProjectHints: false,
      includeSessionHints: true,
      includeFullProfile: false,
      includeFastSummaries: false,
      recordRetrievedEvents: false
    })
  })

  it('uses review mode for pending, diagnostics, and review visibility', () => {
    expect(buildRetrievalPolicy({ mode: 'review' })).toMatchObject({
      mode: 'review',
      maxTokens: 4000,
      includePendingDetails: true,
      includePendingNotice: true,
      includeDiagnostics: true,
      includeSimilarProjectHints: true,
      includeSessionHints: true,
      includeFullProfile: true,
      includeFastSummaries: false,
      recordRetrievedEvents: false
    })
  })

  it('lets explicit flags override mode defaults', () => {
    expect(buildRetrievalPolicy({
      mode: 'fast',
      includeDiagnostics: true,
      includeSimilarProjectHints: true,
      recordRetrievedEvents: true,
      maxTokens: 333
    })).toMatchObject({
      mode: 'fast',
      maxTokens: 333,
      includeDiagnostics: true,
      includeSimilarProjectHints: true,
      recordRetrievedEvents: true
    })
  })

  it('lets env defaults fill missing explicit values', () => {
    vi.stubEnv('CYRENE_CONTEXT_MODE', 'balanced')
    vi.stubEnv('CYRENE_CONTEXT_INCLUDE_DIAGNOSTICS', 'true')
    vi.stubEnv('CYRENE_CONTEXT_MAX_TOKENS', '999')

    expect(buildRetrievalPolicy({})).toMatchObject({
      mode: 'balanced',
      includeDiagnostics: true,
      maxTokens: 999
    })
  })

  it.each(['fast', 'balanced', 'review'] as ContextMode[])('parses valid mode %s', (mode) => {
    expect(parseContextMode(mode)).toBe(mode)
  })

  it('rejects invalid modes', () => {
    expect(() => parseContextMode('deep')).toThrow(/Invalid context mode/)
  })
})
