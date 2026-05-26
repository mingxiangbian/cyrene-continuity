import { describe, expect, it } from 'vitest'
import { redactReviewText } from '../src/codex/review-redaction.js'

describe('Codex review redaction', () => {
  it('redacts common secrets and personal identifiers with counts', () => {
    const input = [
      'OPENAI_API_KEY=sk-abc1234567890abcdef1234567890',
      'Authorization: Bearer verylongbearertoken1234567890',
      'email me at user@example.com',
      'call +1 415 555 1212',
      'random token 0123456789abcdef0123456789abcdef',
      '-----BEGIN PRIVATE KEY-----',
      'secret',
      '-----END PRIVATE KEY-----'
    ].join('\n')

    const result = redactReviewText(input)

    expect(result.text).not.toContain('sk-abc')
    expect(result.text).not.toContain('verylongbearer')
    expect(result.text).not.toContain('user@example.com')
    expect(result.text).not.toContain('415 555 1212')
    expect(result.text).not.toContain('0123456789abcdef0123456789abcdef')
    expect(result.text).not.toContain('BEGIN PRIVATE KEY')
    expect(result.text).toContain('[REDACTED_SECRET]')
    expect(result.text).toContain('[REDACTED_EMAIL]')
    expect(result.counts.secret).toBeGreaterThanOrEqual(2)
    expect(result.counts.email).toBe(1)
    expect(result.counts.phone).toBe(1)
    expect(result.counts.privateKey).toBe(1)
  })

  it('merges redaction counts', () => {
    expect(redactReviewText('a@example.com b@example.com').counts.email).toBe(2)
  })

  it('classifies long numeric hex tokens as secrets', () => {
    const result = redactReviewText('12345678901234567890123456789012')

    expect(result.text).toContain('[REDACTED_SECRET]')
    expect(result.counts.secret).toBe(1)
    expect(result.counts.phone ?? 0).toBe(0)
  })

  it('does not redact ISO-like timestamps as phone numbers', () => {
    const result = redactReviewText('created at 2026-05-26 14:04:45')

    expect(result.text).toBe('created at 2026-05-26 14:04:45')
    expect(result.counts.phone ?? 0).toBe(0)
  })
})
