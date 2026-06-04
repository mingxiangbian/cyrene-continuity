import { describe, expect, it } from 'vitest'
import { candidateFromExplicitGlobalInstruction, candidateFromReviewPattern, candidatesFromReviewEvents } from '../src/codex/global-memory-capture.js'

describe('global memory capture', () => {
  it('creates global candidate from explicit global instruction', () => {
    const candidate = candidateFromExplicitGlobalInstruction({
      text: '以后所有项目都默认先运行 git diff --check。',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(candidate).toMatchObject({
      scope: 'global',
      source: 'user_explicit',
      candidateKind: 'user_instruction',
      domain: 'procedural',
      type: 'procedural_rule'
    })
    expect(candidate?.content).toContain('所有项目')
    expect(candidate?.sourceOfTruth).toBe('user_prompt:2026-05-30T00:00:00.000Z')
    expect(candidate?.evidence[0]?.traceRefs).toEqual(['user_prompt:2026-05-30T00:00:00.000Z'])
    expect(candidate?.evidence[0]?.evidenceGroupId).not.toBe(candidate?.sourceOfTruth)
  })

  it('does not create candidate from ordinary conversation', () => {
    expect(candidateFromExplicitGlobalInstruction({ text: '这个项目先跑测试。', now: '2026-05-30T00:00:00.000Z' })).toBeUndefined()
  })

  it('does not create global memory from automation prompts', () => {
    expect(candidateFromExplicitGlobalInstruction({
      text: [
        'Automation: Cyrene Memory Weekly Lifecycle',
        'Automation ID: cyrene-memory-automation-weekly',
        'Run Cyrene memory automation for global and project roots.',
        'Do not modify source files.'
      ].join('\n'),
      now: '2026-06-02T00:00:00.000Z'
    })).toBeUndefined()
  })

  it('does not create global memory from long context dumps even when they mention global memory', () => {
    expect(candidateFromExplicitGlobalInstruction({
      text: [
        '# Applications mentioned by the user:',
        '<appshot app="Google Chrome" bundle-identifier="com.google.Chrome" window-title="cyrene-continuity">',
        'container README text mentions global memory, all projects, and automation settings.',
        'link Description: cyrene_memory_automation_run Value: github.com/example/repo',
        '</appshot>',
        'The actual user request was to check why CI failed.'
      ].join('\n'),
      now: '2026-06-04T00:00:00.000Z'
    })).toBeUndefined()
  })

  it('does not create global memory from overlong global-looking prose', () => {
    expect(candidateFromExplicitGlobalInstruction({
      text: `以后所有项目都默认遵循这一大段说明：${'这是一段上下文说明，不是单条全局记忆指令。'.repeat(12)}`,
      now: '2026-06-04T00:00:00.000Z'
    })).toBeUndefined()
  })

  it('does not create global memory from diagnostic questions mentioning global review', () => {
    expect(candidateFromExplicitGlobalInstruction({
      text: 'global的review中有一个特别长的待审阅的memory，为何会出现这种情况？是bug吗？还是之前生成的？',
      now: '2026-06-04T00:00:00.000Z'
    })).toBeUndefined()
  })

  it('does not create global memory from implementation requests mentioning global memory', () => {
    expect(candidateFromExplicitGlobalInstruction({
      text: '加一个文字上限吧。这个质量门的作用是什么？为什么会出现现在这些待审阅的记忆，且都放在global中，检查一下这些memory是怎么进入global的',
      now: '2026-06-04T00:00:00.000Z'
    })).toBeUndefined()
  })

  it('does not turn personal preference wording into global procedural memory', () => {
    expect(candidateFromExplicitGlobalInstruction({
      text: 'I always prefer concise status updates.',
      now: '2026-05-30T00:00:00.000Z'
    })).toBeUndefined()
  })

  it('creates review-derived global candidate from repeated rejection pattern', () => {
    const candidate = candidateFromReviewPattern({
      patternId: 'reject-transient-test-status',
      action: 'reject',
      count: 5,
      reasonSamples: ['temporary status', 'not durable memory'],
      candidateKind: 'project_fact',
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(candidate).toMatchObject({
      scope: 'global',
      source: 'review_event',
      candidateKind: 'workflow_rule',
      domain: 'procedural'
    })
    expect(candidate?.content).toContain('一次性')
  })

  it('aggregates review events into review-derived global candidates', () => {
    const candidates = candidatesFromReviewEvents({
      events: [
        { id: 'event-1', action: 'reject', at: '2026-05-28T00:00:00.000Z', reason: 'temporary status', candidateId: 'a', details: { reviewPatternId: 'reject-transient-test-status', candidateKind: 'project_fact' } },
        { id: 'event-2', action: 'reject', at: '2026-05-29T00:00:00.000Z', reason: 'not durable memory', candidateId: 'b', details: { reviewPatternId: 'reject-transient-test-status', candidateKind: 'project_fact' } },
        { id: 'event-3', action: 'reject', at: '2026-05-30T00:00:00.000Z', reason: 'one-off command output', candidateId: 'c', details: { reviewPatternId: 'reject-transient-test-status', candidateKind: 'project_fact' } }
      ],
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ source: 'review_event', normalizedKey: 'review-derived-reject-transient-test-status' })
  })

  it('aggregates repeated approved project memory events without explicit pattern metadata', () => {
    const candidates = candidatesFromReviewEvents({
      events: [
        { id: 'event-1', action: 'promote', at: '2026-05-28T00:00:00.000Z', reason: 'approved durable project fact', candidateId: 'a', memoryId: 'memory-a', details: { candidateKind: 'project_fact' } },
        { id: 'event-2', action: 'promote', at: '2026-05-29T00:00:00.000Z', reason: 'approved another durable project fact', candidateId: 'b', memoryId: 'memory-b', details: { candidateKind: 'project_fact' } },
        { id: 'event-3', action: 'promote', at: '2026-05-30T00:00:00.000Z', reason: 'approved third durable project fact', candidateId: 'c', memoryId: 'memory-c', details: { candidateKind: 'project_fact' } }
      ],
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ source: 'review_event', normalizedKey: 'review-derived-approve-project_fact' })
  })

  it('aggregates edit review events stored as pending review actions', () => {
    const candidates = candidatesFromReviewEvents({
      events: [
        { id: 'event-1', action: 'pending', at: '2026-05-28T00:00:00.000Z', reason: 'edited vague wording', candidateId: 'a', details: { reviewAction: 'edit', reviewPatternId: 'edit-vague-workflow-rule', candidateKind: 'workflow_rule' } },
        { id: 'event-2', action: 'pending', at: '2026-05-29T00:00:00.000Z', reason: 'edited broad wording', candidateId: 'b', details: { reviewAction: 'edit', reviewPatternId: 'edit-vague-workflow-rule', candidateKind: 'workflow_rule' } },
        { id: 'event-3', action: 'pending', at: '2026-05-30T00:00:00.000Z', reason: 'edited unclear wording', candidateId: 'c', details: { reviewAction: 'edit', reviewPatternId: 'edit-vague-workflow-rule', candidateKind: 'workflow_rule' } }
      ],
      now: '2026-05-30T00:00:00.000Z'
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ source: 'review_event', normalizedKey: 'review-derived-edit-vague-workflow-rule' })
  })
})
