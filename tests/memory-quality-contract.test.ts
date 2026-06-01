import { describe, expect, it } from 'vitest'
import {
  MEMORY_DELTA_REPORT_TEMPLATE,
  MEMORY_QUALITY_FIXTURES,
  MEMORY_QUALITY_RUBRIC,
  REQUIRED_MEMORY_QUALITY_FIXTURE_IDS,
  fixtureById,
  validateMemoryDeltaReport,
  validateMemoryQualityFixtures,
  type MemoryQualityFixture
} from '../src/codex/memory-quality-contract.js'

describe('memory quality contract fixtures', () => {
  it('covers every required fixture category exactly once', () => {
    expect(MEMORY_QUALITY_FIXTURES.map((fixture) => fixture.id)).toEqual(REQUIRED_MEMORY_QUALITY_FIXTURE_IDS)
    expect(new Set(MEMORY_QUALITY_FIXTURES.map((fixture) => fixture.id)).size).toBe(MEMORY_QUALITY_FIXTURES.length)
    expect(validateMemoryQualityFixtures()).toEqual([])
  })

  it('keeps low-value signals out of pending and active memory', () => {
    for (const id of ['one_time_action', 'short_term_task_state', 'numeric_snapshot'] as const) {
      const fixture = fixtureById(id)
      expect(fixture.durableSignal).toBe(false)
      expect(fixture.mustNotOutcome).toContain('active')
      expect(fixture.mustNotOutcome).toContain('pending')
      expect(fixture.mustNotOutcome).toContain('direct_pending')
    }

    expect(fixtureById('one_time_action').mustNotOutcome).toContain('pending')
    expect(fixtureById('short_term_task_state').mustNotOutcome).toContain('durable_memory_raw')
    expect(fixtureById('numeric_snapshot').mustNotOutcome).toContain('direct_pending')
  })

  it('requires durable signals to produce a reviewable output instead of silent drop', () => {
    const durableFixtures = MEMORY_QUALITY_FIXTURES.filter((fixture) => fixture.durableSignal)

    expect(durableFixtures.map((fixture) => fixture.id)).toEqual([
      'durable_workflow_rule',
      'known_pitfall_with_mitigation',
      'explicit_user_instruction',
      'source_of_truth_rule_excerpt',
      'preference_relationship_affective',
      'contradicted_active_memory',
      'repeated_failure'
    ])

    for (const fixture of durableFixtures) {
      expect(fixture.expectedOutput).not.toBe('no memory candidate')
      expect(fixture.mustNotOutcome).toContain('silent_drop')
    }
  })

  it('keeps high-risk fixtures on manual-review paths', () => {
    for (const id of ['raw_emotion_event', 'preference_relationship_affective'] as const) {
      const fixture = fixtureById(id)
      expect(fixture.highRisk).toBe(true)
      expect(['manual_review', 'manual_only']).toContain(fixture.expectedPolicy)
      expect(fixture.mustNotOutcome).toContain('auto_active')
      expect(fixture.mustNotOutcome).toContain('silent_drop')
    }

    const rawEmotion = fixtureById('raw_emotion_event')
    expect(rawEmotion.mustNotOutcome).toEqual(expect.arrayContaining([
      'active',
      'pending',
      'direct_pending',
      'raw_emotion_active'
    ]))
  })

  it('keeps reflection candidates review-first', () => {
    const fixture = fixtureById('contradicted_active_memory')

    expect(fixture.expectedClassification).toBe('reflection_candidate')
    expect(fixture.expectedPolicy).toBe('review_first')
    expect(fixture.mustNotOutcome).toContain('direct_supersede')
    expect(fixture.mustNotOutcome).toContain('direct_active_mutation')
  })

  it('exports a coordinator rubric and memory delta report template', () => {
    expect(MEMORY_QUALITY_RUBRIC.map((section) => section.id)).toEqual([
      'capture',
      'non_pollution',
      'routing',
      'evidence',
      'use_boundaries',
      'reviewability',
      'activation_safety',
      'reflection_safety'
    ])
    expect(MEMORY_QUALITY_RUBRIC.every((section) => section.checks.length > 0)).toBe(true)

    expect(MEMORY_DELTA_REPORT_TEMPLATE).toContain('Captured durable signals')
    expect(MEMORY_DELTA_REPORT_TEMPLATE).toContain('Why no durable signal was dropped')
    expect(MEMORY_DELTA_REPORT_TEMPLATE).toContain('Why pending / active stayed clean')
  })

  it('validates memory delta report handoffs', () => {
    const handoffReport = `# Memory Delta Report

## Captured durable signals
- explicit_user_instruction: user asked for future specs and plans in Chinese.

## Generated candidates / distillation inputs / reflection candidates
- Candidate: procedural rule with explicit user evidence and project scope.

## Episode-only or task-state signals
- Current implementation checkpoint stayed as task state.

## No-memory decisions and reasons

Signals reviewed: explicit user instruction, current checkpoint state.
Decision: generate one procedural candidate and keep checkpoint state out of pending / active memory.
Why no durable memory candidate: Not applicable; the durable instruction produced a candidate.
Why no durable signal was dropped: the durable instruction is listed in generated candidates.
Why pending / active stayed clean: transient checkpoint state remained episode-only.

## Pollution safeguards
- Low-value task status was not promoted.

## Recall safeguards
- Explicit user instruction was captured.

## Fixture coverage
- Covers explicit_user_instruction and short_term_task_state.

## Open risks
- None.
`

    expect(validateMemoryDeltaReport(handoffReport)).toEqual([])
    expect(validateMemoryDeltaReport(MEMORY_DELTA_REPORT_TEMPLATE)).toEqual(expect.arrayContaining([
      'memory delta report section is empty: Captured durable signals',
      'memory delta report field is empty: Why no durable signal was dropped:'
    ]))
    expect(validateMemoryDeltaReport('')).toEqual(['memory delta report is empty'])

    const missingHeading = MEMORY_DELTA_REPORT_TEMPLATE.replace('## Fixture coverage\n', '')
    expect(validateMemoryDeltaReport(missingHeading)).toContain('missing memory delta report heading: Fixture coverage')

    const missingField = MEMORY_DELTA_REPORT_TEMPLATE.replace('Why no durable signal was dropped:\n', '')
    expect(validateMemoryDeltaReport(missingField)).toContain(
      'missing memory delta report field: Why no durable signal was dropped:'
    )

    const fieldOutsideNoMemorySection = handoffReport
      .replace('Why no durable signal was dropped: the durable instruction is listed in generated candidates.\n', '')
      .concat('\nWhy no durable signal was dropped: duplicated outside the required section.\n')
    expect(validateMemoryDeltaReport(fieldOutsideNoMemorySection)).toContain(
      'missing memory delta report field: Why no durable signal was dropped:'
    )

    const duplicatedOutsideNoMemorySection = handoffReport.concat(
      '\n## Additional notes\nWhy no durable signal was dropped: duplicated outside the required section.\n'
    )
    expect(validateMemoryDeltaReport(duplicatedOutsideNoMemorySection)).toContain(
      'memory delta report field appears outside no-memory section: Why no durable signal was dropped:'
    )
  })

  it('reports fixture contract drift', () => {
    const invalid: MemoryQualityFixture = {
      ...fixtureById('durable_workflow_rule'),
      id: 'durable_workflow_rule',
      expectedOutput: '',
      durableSignal: true,
      mustNotOutcome: ['active']
    }

    expect(validateMemoryQualityFixtures([invalid])).toEqual([
      'missing required fixture: one_time_action',
      'missing required fixture: short_term_task_state',
      'missing required fixture: numeric_snapshot',
      'missing required fixture: raw_emotion_event',
      'missing required fixture: known_pitfall_with_mitigation',
      'missing required fixture: explicit_user_instruction',
      'missing required fixture: source_of_truth_rule_excerpt',
      'missing required fixture: preference_relationship_affective',
      'missing required fixture: contradicted_active_memory',
      'missing required fixture: repeated_failure',
      'fixture durable_workflow_rule has empty expectedOutput',
      'durable fixture durable_workflow_rule must forbid silent_drop'
    ])
  })

  it('reports low-value fixture pollution drift', () => {
    const invalid: MemoryQualityFixture = {
      ...fixtureById('one_time_action'),
      mustNotOutcome: ['active']
    }

    expect(validateMemoryQualityFixtures([invalid])).toContain('low-value fixture one_time_action must forbid pending')
    expect(validateMemoryQualityFixtures([invalid])).toContain('low-value fixture one_time_action must forbid direct_pending')
  })

  it('reports manual-review evidence pollution drift', () => {
    const invalid: MemoryQualityFixture = {
      ...fixtureById('raw_emotion_event'),
      mustNotOutcome: ['auto_active', 'silent_drop']
    }

    expect(validateMemoryQualityFixtures([invalid])).toContain('manual-review evidence fixture raw_emotion_event must forbid active')
    expect(validateMemoryQualityFixtures([invalid])).toContain('manual-review evidence fixture raw_emotion_event must forbid pending')
    expect(validateMemoryQualityFixtures([invalid])).toContain('manual-review evidence fixture raw_emotion_event must forbid direct_pending')
  })
})
