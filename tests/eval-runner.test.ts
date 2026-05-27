import { describe, expect, it } from 'vitest'
import { runSimilarHintsEvalGate, type SimilarHintEvalCandidate } from '../src/eval/eval-runner.js'

function candidate(overrides: Partial<SimilarHintEvalCandidate> = {}): SimilarHintEvalCandidate {
  return {
    id: 'hint-1',
    currentProjectId: 'current',
    homeProjectId: 'other',
    domain: 'procedural',
    portability: 'similar_project',
    scope: 'project',
    content: 'MCP plugin projects should rebuild generated runtime explicitly.',
    transferable: true,
    notCurrentProjectFact: true,
    ...overrides
  }
}

describe('similar hints eval gate', () => {
  it('passes safe transferable procedural hints', () => {
    const result = runSimilarHintsEvalGate([candidate()])

    expect(result.passed).toBe(true)
    expect(result.failedChecks).toEqual([])
    expect(result.results.every((check) => check.passed)).toBe(true)
  })

  it('fails cross-project leak candidates', () => {
    const result = runSimilarHintsEvalGate([
      candidate({ id: 'same-project', homeProjectId: 'current' }),
      candidate({ id: 'local-only', portability: 'local_only' }),
      candidate({ id: 'global', scope: 'global' }),
      candidate({ id: 'missing-home', homeProjectId: null })
    ])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('cross_project_leak_eval')
    expect(JSON.stringify(result.results)).toContain('same-project')
    expect(JSON.stringify(result.results)).toContain('local-only')
    expect(JSON.stringify(result.results)).toContain('global')
    expect(JSON.stringify(result.results)).toContain('missing-home')
  })

  it('fails boundary violations in domain and content', () => {
    const result = runSimilarHintsEvalGate([
      candidate({ id: 'personal', domain: 'personal' }),
      candidate({ id: 'relationship', domain: 'relationship' }),
      candidate({ id: 'affective', domain: 'affective' }),
      candidate({ id: 'path-users', content: 'Use /Users/phoenix/private/project/config.json.' }),
      candidate({ id: 'path-home', content: 'Use /home/agent/private/project/config.json.' }),
      candidate({ id: 'path-var', content: 'Use /var/tmp/private/project/config.json.' }),
      candidate({ id: 'path-etc', content: 'Use /etc/private/project/config.json.' }),
      candidate({ id: 'path-tmp', content: 'Use /tmp/private/project/config.json.' }),
      candidate({ id: 'remote-ssh', content: 'Clone git@github.com:secret/private.git.' }),
      candidate({ id: 'remote-https', content: 'Clone https://github.com/secret/private.git.' }),
      candidate({ id: 'secret-openai', content: 'Token sk-123456789012345678901234567890123456789012345678.' }),
      candidate({ id: 'secret-ghp', content: 'Token ghp_1234567890123456789012345678901234567890.' }),
      candidate({ id: 'secret-github-pat', content: 'Token github_pat_1234567890123456789012345678901234567890.' }),
      candidate({ id: 'secret-slack', content: 'Token xoxb-1234567890123456789012345678901234567890.' }),
      candidate({ id: 'flags', transferable: false, notCurrentProjectFact: false })
    ])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('similar_hint_boundary_eval')
    expect(JSON.stringify(result.results)).toContain('personal')
    expect(JSON.stringify(result.results)).toContain('relationship')
    expect(JSON.stringify(result.results)).toContain('affective')
    expect(JSON.stringify(result.results)).toContain('absolute path')
    expect(JSON.stringify(result.results)).toContain('raw remote')
    expect(JSON.stringify(result.results)).toContain('secret-like')
    expect(JSON.stringify(result.results)).toContain('missing similar hint flags')
  })

  it('fails wrapped paths, non-GitHub raw remotes, and review hashes', () => {
    const result = runSimilarHintsEvalGate([
      candidate({ id: 'wrapped-path', content: 'Use `/Users/phoenix/private/config.json`.' }),
      candidate({ id: 'gitlab-ssh', content: 'Clone git@gitlab.com:org/private.git.' }),
      candidate({ id: 'gitlab-https', content: 'Clone https://gitlab.com/org/private.git.' }),
      candidate({
        id: 'review-hash',
        content: 'reviewHash=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      })
    ])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('similar_hint_boundary_eval')
    expect(JSON.stringify(result.results)).toContain('wrapped-path')
    expect(JSON.stringify(result.results)).toContain('gitlab-ssh')
    expect(JSON.stringify(result.results)).toContain('gitlab-https')
    expect(JSON.stringify(result.results)).toContain('review-hash')
    expect(JSON.stringify(result.results)).toContain('absolute path')
    expect(JSON.stringify(result.results)).toContain('raw remote')
    expect(JSON.stringify(result.results)).toContain('secret-like')
  })
})
