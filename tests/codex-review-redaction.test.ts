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

  it('redacts common provider tokens and JSON-style secret fields', () => {
    const awsAccessKey = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('')
    const githubToken = ['ghp_', 'abcdefghijklmnopqrstuvwxyz', '1234567890'].join('')
    const githubFineGrainedToken = ['github_pat_', 'abcdefghijklmnopqrstuvwxyz_', '1234567890'].join('')
    const slackToken = ['xo', 'xb-', '123456789012-', 'abcdefghijklmnop'].join('')
    const googleToken = ['AI', 'za', 'abcdefghijklmnopqrstuvwxyz', '1234567890'].join('')
    const stripeToken = ['sk_', 'live_', '1234567890', 'abcdefghijklmnop'].join('')
    const jwtToken = [
      'eyJhbGciOiJIUzI1NiJ9',
      'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
      'abcdefghijklmnop'
    ].join('.')
    const input = [
      `AWS_ACCESS_KEY_ID=${awsAccessKey}`,
      `github token ${githubToken}`,
      `fine grained ${githubFineGrainedToken}`,
      `slack ${slackToken}`,
      `google ${googleToken}`,
      `stripe ${stripeToken}`,
      'config {"client_secret":"supersecretvalue123"}',
      `jwt ${jwtToken}`
    ].join('\n')

    const result = redactReviewText(input)

    expect(result.text).not.toContain(awsAccessKey)
    expect(result.text).not.toContain(githubToken)
    expect(result.text).not.toContain(githubFineGrainedToken)
    expect(result.text).not.toContain(slackToken)
    expect(result.text).not.toContain(googleToken)
    expect(result.text).not.toContain(stripeToken)
    expect(result.text).not.toContain('supersecretvalue123')
    expect(result.text).not.toContain(jwtToken)
    expect(result.counts.secret).toBeGreaterThanOrEqual(8)
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
