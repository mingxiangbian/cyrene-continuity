import { describe, expect, it } from 'vitest'
import { MEMORY_BOUNDARY_FLAGS } from '../src/codex/memory-triage.js'
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

function fixturesWithReplacement(replacement: MemoryQualityFixture): MemoryQualityFixture[] {
  return MEMORY_QUALITY_FIXTURES.map((fixture) => fixture.id === replacement.id ? replacement : fixture)
}

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
      'repeated_failure',
      'valuable_old_pending_workflow_rule',
      'trial_applied_twice',
      'trial_with_corrected_event',
      'validated_distinct_sessions',
      'validated_with_violated_event',
      'repeated_project_core_global_candidate',
      'explicit_all_projects_instruction',
      'affective_inferred_pattern_v1_5',
      'project_specific_global_candidate',
      'core_profile_generation'
    ])

    for (const fixture of durableFixtures) {
      expect(fixture.expectedOutput).not.toBe('no memory candidate')
      expect(fixture.mustNotOutcome).toContain('silent_drop')
    }
  })

  it('keeps high-risk fixtures on manual-review paths', () => {
    for (const id of ['raw_emotion_event', 'preference_relationship_affective', 'affective_inferred_pattern_v1_5'] as const) {
      const fixture = fixtureById(id)
      expect(fixture.highRisk).toBe(true)
      expect(['manual_review', 'manual_only']).toContain(fixture.expectedPolicy)
      expect(fixture.mustNotOutcome).toContain('auto_active')
      expect(fixture.mustNotOutcome).toContain('silent_drop')
      expect(fixture.mustNotOutcome).toContain('project_core')
      expect(fixture.mustNotOutcome).toContain('global_core')
      expect(fixture.mustNotOutcome).toContain('profile')
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

  it('covers v1.5 lifecycle output quality fixtures', () => {
    expect(MEMORY_QUALITY_FIXTURES.map((fixture) => fixture.id)).toEqual(expect.arrayContaining([
      'old_review_summary_noise',
      'valuable_old_pending_workflow_rule',
      'trial_applied_twice',
      'trial_with_corrected_event',
      'validated_distinct_sessions',
      'validated_with_violated_event',
      'repeated_project_core_global_candidate',
      'explicit_all_projects_instruction',
      'affective_inferred_pattern_v1_5',
      'project_specific_global_candidate',
      'core_profile_generation'
    ]))

    expect(fixtureById('old_review_summary_noise').mustNotOutcome).toEqual(expect.arrayContaining([
      'project_trial',
      'active',
      'profile'
    ]))
    expect(fixtureById('trial_applied_twice').expectedOutput).toContain('validated')
    expect(fixtureById('explicit_all_projects_instruction').expectedOutput).toContain('global_core')
    expect(fixtureById('affective_inferred_pattern_v1_5').expectedPolicy).toBe('manual_only')
    expect(fixtureById('project_specific_global_candidate').mustNotOutcome).toContain('global_core')
    expect(fixtureById('core_profile_generation').expectedOutput).toContain('profile contains only core memory')
  })

  it('reports v1.5 lifecycle fixture drift', () => {
    expect(validateMemoryQualityFixtures(fixturesWithReplacement({
      ...fixtureById('old_review_summary_noise'),
      mustNotOutcome: ['active', 'pending', 'direct_pending']
    }))).toEqual([
      'fixture old_review_summary_noise must forbid project_trial',
      'fixture old_review_summary_noise must forbid profile'
    ])

    expect(validateMemoryQualityFixtures(fixturesWithReplacement({
      ...fixtureById('trial_applied_twice'),
      expectedOutput: 'Promote project trial after repeated use.'
    }))).toEqual([
      'trial fixture trial_applied_twice expectedOutput must mention validated'
    ])

    expect(validateMemoryQualityFixtures(fixturesWithReplacement({
      ...fixtureById('trial_with_corrected_event'),
      expectedOutput: 'Do not validate; block promotion because negative feedback exists.'
    }))).toEqual([
      'trial fixture trial_with_corrected_event expectedOutput must mention recommendation'
    ])

    const globalCoreFixture = fixtureById('repeated_project_core_global_candidate')
    expect(validateMemoryQualityFixtures(fixturesWithReplacement({
      ...globalCoreFixture,
      mustNotOutcome: globalCoreFixture.mustNotOutcome.filter((outcome) => outcome !== 'project_detail_global_core')
    }))).toEqual([
      'global_core fixture repeated_project_core_global_candidate must forbid project_detail_global_core'
    ])

    expect(validateMemoryQualityFixtures(fixturesWithReplacement({
      ...fixtureById('affective_inferred_pattern_v1_5'),
      mustNotOutcome: ['auto_active', 'silent_drop']
    }))).toEqual([
      'high-risk fixture affective_inferred_pattern_v1_5 must forbid project_core',
      'high-risk fixture affective_inferred_pattern_v1_5 must forbid global_core',
      'high-risk fixture affective_inferred_pattern_v1_5 must forbid profile'
    ])

    expect(validateMemoryQualityFixtures(fixturesWithReplacement({
      ...fixtureById('core_profile_generation'),
      expectedOutput: 'Generated profile excludes trial and validated memory.'
    }))).toEqual([
      'fixture core_profile_generation expectedOutput must contain profile contains only core memory'
    ])
  })

  it('does not infer trial lifecycle wording requirements from id prefix alone', () => {
    const optionalTrialNoiseFixture: MemoryQualityFixture = {
      ...fixtureById('old_review_summary_noise'),
      id: 'trial_dropped_noise' as MemoryQualityFixture['id'],
      inputSignal: 'A project trial candidate is duplicate migration noise.',
      expectedOutput: 'Drop or archive as non-durable migration noise.'
    }

    expect(validateMemoryQualityFixtures([...MEMORY_QUALITY_FIXTURES, optionalTrialNoiseFixture])).toEqual([])
  })

  it('exports a coordinator rubric and memory delta report template', () => {
    expect(MEMORY_QUALITY_RUBRIC.map((section) => section.id)).toEqual([
      'capture',
      'non_pollution',
      'routing',
      'evidence',
      'use_boundaries',
      'semantic_prepare',
      'reviewability',
      'activation_safety',
      'reflection_safety'
    ])
    expect(MEMORY_QUALITY_RUBRIC.every((section) => section.checks.length > 0)).toBe(true)
    expect(MEMORY_QUALITY_RUBRIC.find((section) => section.id === 'semantic_prepare')?.checks.join(' ')).toContain(
      'needs_rewrite'
    )

    expect(MEMORY_DELTA_REPORT_TEMPLATE).toContain('Captured durable signals')
    expect(MEMORY_DELTA_REPORT_TEMPLATE).toContain('Why no durable signal was dropped')
    expect(MEMORY_DELTA_REPORT_TEMPLATE).toContain('Why pending / active stayed clean')
  })

  it('keeps duplicate and pollution gates explicit in the quality contract', () => {
    expect(MEMORY_BOUNDARY_FLAGS).toEqual([
      'scope_root_mismatch',
      'global_project_specific_source',
      'project_personal_domain',
      'missing_source_boundary',
      'cross_root_normalized_key_collision',
      'active_pending_collision',
      'same_key_mixed_metadata'
    ])
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
      'missing required fixture: old_review_summary_noise',
      'missing required fixture: valuable_old_pending_workflow_rule',
      'missing required fixture: trial_applied_twice',
      'missing required fixture: trial_with_corrected_event',
      'missing required fixture: validated_distinct_sessions',
      'missing required fixture: validated_with_violated_event',
      'missing required fixture: repeated_project_core_global_candidate',
      'missing required fixture: explicit_all_projects_instruction',
      'missing required fixture: affective_inferred_pattern_v1_5',
      'missing required fixture: project_specific_global_candidate',
      'missing required fixture: core_profile_generation',
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
    expect(validateMemoryQualityFixtures([invalid])).toContain('high-risk fixture raw_emotion_event must forbid project_core')
    expect(validateMemoryQualityFixtures([invalid])).toContain('high-risk fixture raw_emotion_event must forbid global_core')
    expect(validateMemoryQualityFixtures([invalid])).toContain('high-risk fixture raw_emotion_event must forbid profile')
  })
})
