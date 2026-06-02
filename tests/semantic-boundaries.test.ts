import { describe, expect, it } from 'vitest'
import { deriveSemanticBoundaries } from '../src/codex/semantic-boundaries.js'

const WORKFLOW_INPUT =
  '拒绝 pending memory 的流程：按照 Cyrene review 流程，逐条进行哈希校验，确认后执行拒绝操作。操作后需验证 pending 列表为空。'

const PITFALL_INPUT =
  'pending review 哈希因 semantic projection 改写导致假冲突。修复方案：调整优先从 pending.jsonl 直接读取 pending review，而非依赖缓存推导。'

function expectNoGenericBoundaryText(result: ReturnType<typeof deriveSemanticBoundaries>): void {
  const text = [...result.useWhen, ...result.doNotUseWhen, ...result.reasons].join('\n')
  expect(text).not.toMatch(/Future task matches/i)
  expect(text).not.toMatch(/<key>/i)
}

describe('deriveSemanticBoundaries', () => {
  it('derives concrete boundaries for pending-memory rejection workflows', () => {
    const result = deriveSemanticBoundaries({
      content: WORKFLOW_INPUT,
      candidateKind: 'workflow_rule',
      domain: 'procedural'
    })

    expect(result).toEqual({
      useWhen: [
        'Rejecting pending memory candidates in the Cyrene review flow.',
        'Changing pending-memory review actions that depend on review-hash validation.',
        'Verifying pending queue state after reject/defer/promote mutations.'
      ],
      doNotUseWhen: [
        'The task does not mutate pending memory review state.',
        'The review hash is unavailable or was not read from the current pending record.',
        'The task concerns active memory edits rather than pending candidate review.'
      ],
      reasons: [
        'The content defines a reusable workflow rather than a one-time rejection event.',
        'It names the required pre-mutation and post-mutation checks: review-hash validation and queue verification.'
      ]
    })
    expectNoGenericBoundaryText(result)
  })

  it('derives concrete boundaries for pending-review hash false-conflict pitfalls', () => {
    const result = deriveSemanticBoundaries({
      content: PITFALL_INPUT,
      candidateKind: 'known_pitfall',
      domain: 'procedural'
    })

    expect(result).toEqual({
      useWhen: [
        'Diagnosing review-hash conflicts for pending memory candidates.',
        'Reading or validating pending review records.',
        'Changing semantic projection or cache code that feeds pending review state.'
      ],
      doNotUseWhen: [
        'The hash comes from an active memory record rather than pending review.',
        'The code already reads the current pending.jsonl record as the canonical source.',
        'The task is unrelated to pending review hashes, semantic projection, or cache-derived review data.'
      ],
      reasons: [
        'The content describes a known pitfall with a mitigation.',
        'It identifies semantic projection and cache-derived data as false-conflict sources and pending.jsonl as the canonical data source.'
      ]
    })
    expectNoGenericBoundaryText(result)
  })

  it('uses deterministic fallback boundaries without generic key wording', () => {
    const result = deriveSemanticBoundaries({
      content: 'Core memory pipeline changes must preserve review-hash validation.',
      candidateKind: 'workflow_rule',
      domain: 'procedural'
    })

    expect(result.useWhen).toEqual([
      'Applying the workflow rule described in this memory.',
      'Changing the process or code path named by the memory content.'
    ])
    expect(result.doNotUseWhen).toEqual([
      'The task is outside the process or code path named by the memory content.',
      'Current source files or explicit user instructions contradict the memory.'
    ])
    expect(result.reasons).toEqual([
      'The candidate kind is workflow_rule, so boundaries emphasize when to apply the procedure and when to ignore it.'
    ])
    expectNoGenericBoundaryText(result)
  })
})
