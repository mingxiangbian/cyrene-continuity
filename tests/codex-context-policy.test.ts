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
      includeFullProfile: true,
      includeFastSummaries: false,
      recordRetrievedEvents: false
    })
  })

  it('uses review mode for pending and diagnostics without similar hints by default', () => {
    expect(buildRetrievalPolicy({ mode: 'review' })).toMatchObject({
      mode: 'review',
      maxTokens: 4000,
      includePendingDetails: true,
      includePendingNotice: true,
      includeDiagnostics: true,
      includeSimilarProjectHints: false,
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

  it('infers balanced mode for planning and architecture work', () => {
    expect(buildRetrievalPolicy({
      task: 'planning',
      userMessage: 'write an implementation plan for the runtime architecture'
    })).toMatchObject({
      mode: 'balanced',
      includeSessionHints: true,
      includeFullProfile: true,
      includePendingDetails: false,
      includeSimilarProjectHints: false
    })
  })

  it('infers review mode for pending memory review work', () => {
    expect(buildRetrievalPolicy({
      task: 'memory',
      userMessage: 'review pending memory candidates'
    })).toMatchObject({
      mode: 'review',
      includePendingDetails: true,
      includePendingNotice: true,
      includeDiagnostics: true,
      includeSimilarProjectHints: false
    })
  })

  it('keeps ordinary coding context in fast mode when no review signal exists', () => {
    expect(buildRetrievalPolicy({
      task: 'coding',
      userMessage: 'implement the button handler'
    })).toMatchObject({
      mode: 'fast',
      includeFastSummaries: true,
      includeFullProfile: false
    })
  })

  it('lets explicit and env modes override inferred mode', () => {
    vi.stubEnv('CYRENE_CONTEXT_MODE', 'fast')

    expect(buildRetrievalPolicy({
      task: 'planning',
      userMessage: 'write an implementation plan'
    })).toMatchObject({ mode: 'fast' })

    expect(buildRetrievalPolicy({
      mode: 'review',
      task: 'coding',
      userMessage: 'ordinary implementation'
    })).toMatchObject({ mode: 'review' })
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
