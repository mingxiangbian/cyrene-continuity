import { describe, expect, it } from 'vitest'
import { shapePendingCandidateContent } from '../src/codex/semantic-content-builder.js'

const WORKFLOW_INPUT =
  '拒绝 pending memory 的流程：按照 Cyrene review 流程，逐条进行哈希校验，确认后执行拒绝操作。操作后需验证 pending 列表为空。'
const WORKFLOW_OUTPUT =
  'Pending-memory rejection workflows must validate each candidate review hash before mutation and verify the queue state after rejection.'

const PITFALL_INPUT =
  'pending review 哈希因 semantic projection 改写导致假冲突。修复方案：调整优先从 pending.jsonl 直接读取 pending review，而非依赖缓存推导。'
const PITFALL_OUTPUT =
  'Pending-review hashes must be read from canonical pending.jsonl records rather than semantic projection or cache-derived data; projection rewrites can cause false review-hash conflicts.'

function expectNoGenericBoundaryText(result: ReturnType<typeof shapePendingCandidateContent>): void {
  const text = [...result.useWhen, ...result.doNotUseWhen, ...result.reasons].join('\n')
  expect(text).not.toMatch(/Future task matches/i)
  expect(text).not.toMatch(/<key>/i)
}

describe('shapePendingCandidateContent', () => {
  it('rewrites the pending-memory rejection workflow fixture exactly', () => {
    const result = shapePendingCandidateContent({
      content: WORKFLOW_INPUT,
      candidateKind: 'workflow_rule',
      domain: 'procedural'
    })

    expect(result.content).toBe(WORKFLOW_OUTPUT)
    expect(result.changed).toBe(true)
    expect(result.useWhen).toContain('Rejecting pending memory candidates in the Cyrene review flow.')
    expect(result.reasons).toContain(
      'The content defines a reusable workflow rather than a one-time rejection event.'
    )
    expectNoGenericBoundaryText(result)
  })

  it('rewrites the pending-review hash pitfall fixture exactly', () => {
    const result = shapePendingCandidateContent({
      content: PITFALL_INPUT,
      candidateKind: 'known_pitfall',
      domain: 'procedural'
    })

    expect(result.content).toBe(PITFALL_OUTPUT)
    expect(result.changed).toBe(true)
    expect(result.useWhen).toContain('Diagnosing review-hash conflicts for pending memory candidates.')
    expect(result.reasons).toContain('The content describes a known pitfall with a mitigation.')
    expectNoGenericBoundaryText(result)
  })

  it('keeps unknown content unchanged while deriving boundaries', () => {
    const content = 'Core memory pipeline changes must preserve review-hash validation.'

    const result = shapePendingCandidateContent({
      content,
      candidateKind: 'workflow_rule',
      domain: 'procedural'
    })

    expect(result.content).toBe(content)
    expect(result.changed).toBe(false)
    expect(result.useWhen).toEqual([
      'Applying the workflow rule described in this memory.',
      'Changing the process or code path named by the memory content.'
    ])
    expect(result.doNotUseWhen).toHaveLength(2)
    expect(result.reasons).toHaveLength(1)
    expectNoGenericBoundaryText(result)
  })
})
