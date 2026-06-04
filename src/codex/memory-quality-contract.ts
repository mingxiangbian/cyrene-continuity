export const REQUIRED_MEMORY_QUALITY_FIXTURE_IDS = [
  'one_time_action',
  'short_term_task_state',
  'numeric_snapshot',
  'raw_emotion_event',
  'durable_workflow_rule',
  'known_pitfall_with_mitigation',
  'explicit_user_instruction',
  'source_of_truth_rule_excerpt',
  'preference_relationship_affective',
  'contradicted_active_memory',
  'repeated_failure',
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
] as const

export type MemoryQualityFixtureId = typeof REQUIRED_MEMORY_QUALITY_FIXTURE_IDS[number]

export type MemoryQualityClassification =
  | 'episode_only'
  | 'task_state'
  | 'distillation_input'
  | 'manual_review_evidence'
  | 'semantic_candidate'
  | 'manual_review_candidate'
  | 'reflection_candidate'
  | 'project_trial'
  | 'validated_memory'
  | 'project_core'
  | 'global_core'
  | 'lifecycle_recommendation'

export type MemoryQualityModule =
  | 'episode'
  | 'task_state'
  | 'distillation'
  | 'project_semantic'
  | 'procedural'
  | 'preference'
  | 'relationship_affective'
  | 'reflection'
  | 'lifecycle'
  | 'global_core'
  | 'profile'

export type MemoryQualityPolicy =
  | 'no_memory_candidate'
  | 'no_active_write'
  | 'no_direct_pending'
  | 'manual_review'
  | 'pending_review'
  | 'strict_low_risk_path'
  | 'risk_based_review'
  | 'distill_then_pending_review'
  | 'manual_only'
  | 'review_first'
  | 'daily_trial_validation'
  | 'weekly_project_core'
  | 'weekly_global_consolidation'

export type MemoryQualityForbiddenOutcome =
  | 'pending'
  | 'active'
  | 'auto_active'
  | 'direct_pending'
  | 'direct_supersede'
  | 'direct_active_mutation'
  | 'durable_memory_raw'
  | 'raw_excerpt_active'
  | 'raw_emotion_active'
  | 'pitfall_without_mitigation'
  | 'silent_drop'
  | 'project_trial'
  | 'validated'
  | 'project_core'
  | 'global_core'
  | 'profile'
  | 'trial_checklist'
  | 'high_risk_core'
  | 'core_without_evidence'
  | 'project_detail_global_core'

export interface MemoryQualityFixture {
  id: MemoryQualityFixtureId
  inputSignal: string
  expectedClassification: MemoryQualityClassification
  expectedModule: MemoryQualityModule
  expectedPolicy: MemoryQualityPolicy
  expectedOutput: string
  mustNotOutcome: MemoryQualityForbiddenOutcome[]
  reviewNotes: string
  durableSignal: boolean
  highRisk: boolean
}

export interface MemoryQualityRubricSection {
  id:
    | 'capture'
    | 'non_pollution'
    | 'routing'
    | 'evidence'
    | 'use_boundaries'
    | 'semantic_prepare'
    | 'reviewability'
    | 'activation_safety'
    | 'reflection_safety'
  title: string
  checks: string[]
}

export const MEMORY_DELTA_REPORT_TITLE = 'Memory Delta Report'

export const MEMORY_DELTA_REPORT_REQUIRED_HEADINGS = [
  'Captured durable signals',
  'Generated candidates / distillation inputs / reflection candidates',
  'Episode-only or task-state signals',
  'No-memory decisions and reasons',
  'Pollution safeguards',
  'Recall safeguards',
  'Fixture coverage',
  'Open risks'
] as const

export type MemoryDeltaReportRequiredHeading = typeof MEMORY_DELTA_REPORT_REQUIRED_HEADINGS[number]

export const MEMORY_DELTA_REPORT_REQUIRED_FIELDS = [
  'Signals reviewed:',
  'Decision:',
  'Why no durable memory candidate:',
  'Why no durable signal was dropped:',
  'Why pending / active stayed clean:'
] as const

export type MemoryDeltaReportRequiredField = typeof MEMORY_DELTA_REPORT_REQUIRED_FIELDS[number]

export const MEMORY_QUALITY_FIXTURES: MemoryQualityFixture[] = [
  {
    id: 'one_time_action',
    inputSignal: 'Agent used a repository review tool once to inspect a PR.',
    expectedClassification: 'episode_only',
    expectedModule: 'episode',
    expectedPolicy: 'no_memory_candidate',
    expectedOutput: 'Record as episode evidence only when useful for traceability.',
    mustNotOutcome: ['pending', 'active', 'direct_pending'],
    reviewNotes: 'One-off actions do not improve future behavior unless distilled into a durable workflow rule.',
    durableSignal: false,
    highRisk: false
  },
  {
    id: 'short_term_task_state',
    inputSignal: 'Inbox review card still needs a UI-only change in the current task.',
    expectedClassification: 'task_state',
    expectedModule: 'task_state',
    expectedPolicy: 'no_active_write',
    expectedOutput: 'Keep as task state or episode evidence until it becomes a reusable review rule.',
    mustNotOutcome: ['active', 'pending', 'direct_pending', 'durable_memory_raw'],
    reviewNotes: 'Task state can expire quickly; only its reusable principle should become memory.',
    durableSignal: false,
    highRisk: false
  },
  {
    id: 'numeric_snapshot',
    inputSignal: 'The repo currently has 44 test files and 21 pending review items.',
    expectedClassification: 'episode_only',
    expectedModule: 'episode',
    expectedPolicy: 'no_direct_pending',
    expectedOutput: 'Record only as episode/debug evidence, or send to distillation if it reveals a durable pattern.',
    mustNotOutcome: ['active', 'pending', 'direct_pending'],
    reviewNotes: 'Numeric snapshots are usually stale by the next session.',
    durableSignal: false,
    highRisk: false
  },
  {
    id: 'raw_emotion_event',
    inputSignal: 'User was unhappy that completion was declared before runtime behavior was verified.',
    expectedClassification: 'manual_review_evidence',
    expectedModule: 'episode',
    expectedPolicy: 'manual_review',
    expectedOutput: 'Use as evidence for a workflow rule about verifying acceptance criteria before completion claims.',
    mustNotOutcome: [
      'active',
      'pending',
      'direct_pending',
      'raw_emotion_active',
      'auto_active',
      'silent_drop',
      'project_core',
      'global_core',
      'profile'
    ],
    reviewNotes: 'The durable memory is the workflow rule, not the emotion event itself.',
    durableSignal: false,
    highRisk: true
  },
  {
    id: 'durable_workflow_rule',
    inputSignal: 'Do not declare implementation complete until user-facing behavior and acceptance criteria are verified.',
    expectedClassification: 'semantic_candidate',
    expectedModule: 'procedural',
    expectedPolicy: 'pending_review',
    expectedOutput: 'Create a procedural/project workflow candidate with use boundaries and evidence.',
    mustNotOutcome: ['silent_drop'],
    reviewNotes: 'This is reusable future behavior and should be captured even if it stays pending.',
    durableSignal: true,
    highRisk: false
  },
  {
    id: 'known_pitfall_with_mitigation',
    inputSignal: 'Review-summary generation can timeout; long summaries should be chunked, retried, or recorded as failed summaries.',
    expectedClassification: 'semantic_candidate',
    expectedModule: 'project_semantic',
    expectedPolicy: 'pending_review',
    expectedOutput: 'Create a known-pitfall candidate that includes mitigation.',
    mustNotOutcome: ['pitfall_without_mitigation', 'silent_drop'],
    reviewNotes: 'A pitfall without mitigation is only an incident note.',
    durableSignal: true,
    highRisk: false
  },
  {
    id: 'explicit_user_instruction',
    inputSignal: 'User says future specs and plans should be written in Chinese.',
    expectedClassification: 'semantic_candidate',
    expectedModule: 'procedural',
    expectedPolicy: 'risk_based_review',
    expectedOutput: 'Create a candidate with explicit user evidence and scope/risk classification.',
    mustNotOutcome: ['silent_drop'],
    reviewNotes: 'Explicit user instructions must be captured; risk determines review path.',
    durableSignal: true,
    highRisk: false
  },
  {
    id: 'source_of_truth_rule_excerpt',
    inputSignal: 'AGENTS.md says changes must be surgical and trace directly to the requested issue or task.',
    expectedClassification: 'distillation_input',
    expectedModule: 'distillation',
    expectedPolicy: 'distill_then_pending_review',
    expectedOutput: 'Distill the source excerpt into a reusable workflow candidate with source boundary.',
    mustNotOutcome: ['raw_excerpt_active', 'silent_drop'],
    reviewNotes: 'Raw excerpts should not become active memory without semantic rewrite.',
    durableSignal: true,
    highRisk: false
  },
  {
    id: 'preference_relationship_affective',
    inputSignal: 'A candidate infers a user preference or relationship/affective pattern from assistant observation.',
    expectedClassification: 'manual_review_candidate',
    expectedModule: 'relationship_affective',
    expectedPolicy: 'manual_only',
    expectedOutput: 'Preserve evidence for explicit manual review or keep as episode evidence.',
    mustNotOutcome: ['auto_active', 'silent_drop', 'project_core', 'global_core', 'profile'],
    reviewNotes: 'High-risk memory must not be automatic, but durable signals should remain reviewable.',
    durableSignal: true,
    highRisk: true
  },
  {
    id: 'contradicted_active_memory',
    inputSignal: 'Tool evidence shows an active memory is stale or contradicted.',
    expectedClassification: 'reflection_candidate',
    expectedModule: 'reflection',
    expectedPolicy: 'review_first',
    expectedOutput: 'Create a reflection candidate for rewrite/deprecate/supersede review.',
    mustNotOutcome: ['direct_supersede', 'direct_active_mutation', 'silent_drop'],
    reviewNotes: 'Reflection can recommend active changes, but review tools must apply them.',
    durableSignal: true,
    highRisk: false
  },
  {
    id: 'repeated_failure',
    inputSignal: 'The same memory quality mistake appears across multiple review summaries.',
    expectedClassification: 'semantic_candidate',
    expectedModule: 'project_semantic',
    expectedPolicy: 'pending_review',
    expectedOutput: 'Create a known-pitfall or workflow-rule candidate with repeated evidence and mitigation.',
    mustNotOutcome: ['silent_drop', 'pitfall_without_mitigation'],
    reviewNotes: 'Repeated failures are durable signals and should not disappear into episode-only traces.',
    durableSignal: true,
    highRisk: false
  },
  {
    id: 'old_review_summary_noise',
    inputSignal: 'review summary ok: merged branch, deleted local branch, and exported report_materials/ plus REPORT_ROADMAP.md',
    expectedClassification: 'episode_only',
    expectedModule: 'episode',
    expectedPolicy: 'no_memory_candidate',
    expectedOutput: 'Drop or archive as audit noise during v1.5 migration.',
    mustNotOutcome: ['project_trial', 'active', 'pending', 'direct_pending', 'profile'],
    reviewNotes: 'Review-summary status text is not future-facing memory.',
    durableSignal: false,
    highRisk: false
  },
  {
    id: 'valuable_old_pending_workflow_rule',
    inputSignal: 'Review-summary generation should chunk long summaries before retrying.',
    expectedClassification: 'project_trial',
    expectedModule: 'lifecycle',
    expectedPolicy: 'risk_based_review',
    expectedOutput: 'Convert valuable old pending workflow memory into project trial with workflow_hint activation only.',
    mustNotOutcome: ['active', 'profile', 'trial_checklist', 'silent_drop'],
    reviewNotes: 'Trial is active runtime tier but not pending review and not hard checklist.',
    durableSignal: true,
    highRisk: false
  },
  {
    id: 'trial_applied_twice',
    inputSignal: 'Project trial memory has two explicit applied usage events and no negative feedback.',
    expectedClassification: 'validated_memory',
    expectedModule: 'lifecycle',
    expectedPolicy: 'daily_trial_validation',
    expectedOutput: 'Promote project trial to validated with MemoryEvent receipt.',
    mustNotOutcome: ['global_core', 'profile', 'silent_drop'],
    reviewNotes: 'Validated can generate constraints/checklists but remains project-scoped.',
    durableSignal: true,
    highRisk: false
  },
  {
    id: 'trial_with_corrected_event',
    inputSignal: 'Project trial memory has applied events plus a corrected event.',
    expectedClassification: 'lifecycle_recommendation',
    expectedModule: 'lifecycle',
    expectedPolicy: 'review_first',
    expectedOutput: 'Do not validate; generate review recommendation with negative feedback evidence.',
    mustNotOutcome: ['validated', 'project_core', 'global_core', 'silent_drop'],
    reviewNotes: 'Negative feedback blocks promotion until resolved.',
    durableSignal: true,
    highRisk: false
  },
  {
    id: 'validated_distinct_sessions',
    inputSignal: 'Validated memory has applied events across two distinct sessions.',
    expectedClassification: 'project_core',
    expectedModule: 'lifecycle',
    expectedPolicy: 'weekly_project_core',
    expectedOutput: 'Promote validated project memory to project_core and include it in project profile if low risk.',
    mustNotOutcome: ['global_core', 'silent_drop'],
    reviewNotes: 'Project core remains project scoped until global consolidation finds cross-project evidence.',
    durableSignal: true,
    highRisk: false
  },
  {
    id: 'validated_with_violated_event',
    inputSignal: 'Validated memory has a violated event after activation.',
    expectedClassification: 'lifecycle_recommendation',
    expectedModule: 'lifecycle',
    expectedPolicy: 'review_first',
    expectedOutput: 'Do not promote to project_core; generate correction/deprecation recommendation.',
    mustNotOutcome: ['project_core', 'global_core', 'profile', 'silent_drop'],
    reviewNotes: 'Violation means the rule may be unclear, stale, or not enforced.',
    durableSignal: true,
    highRisk: false
  },
  {
    id: 'repeated_project_core_global_candidate',
    inputSignal: 'The same low-risk project_core workflow rule appears across multiple projects.',
    expectedClassification: 'global_core',
    expectedModule: 'global_core',
    expectedPolicy: 'weekly_global_consolidation',
    expectedOutput: 'Create low-risk procedural/system global_core with cross-project evidence.',
    mustNotOutcome: ['project_detail_global_core', 'high_risk_core', 'silent_drop'],
    reviewNotes: 'Global core must remove project-specific implementation detail.',
    durableSignal: true,
    highRisk: false
  },
  {
    id: 'explicit_all_projects_instruction',
    inputSignal: 'User says all projects should write specs and plans in Chinese by default.',
    expectedClassification: 'global_core',
    expectedModule: 'global_core',
    expectedPolicy: 'strict_low_risk_path',
    expectedOutput: 'Create low-risk explicit global_core with receipt.',
    mustNotOutcome: ['silent_drop', 'project_detail_global_core'],
    reviewNotes: 'Explicit global instruction can bypass project trial when low risk.',
    durableSignal: true,
    highRisk: false
  },
  {
    id: 'affective_inferred_pattern_v1_5',
    inputSignal: 'Assistant infers an affective pattern from user tone across tasks.',
    expectedClassification: 'lifecycle_recommendation',
    expectedModule: 'relationship_affective',
    expectedPolicy: 'manual_only',
    expectedOutput: 'Generate high-risk recommendation only; do not write core/profile.',
    mustNotOutcome: ['global_core', 'project_core', 'profile', 'auto_active', 'silent_drop'],
    reviewNotes: 'Affective inference must remain manual review evidence.',
    durableSignal: true,
    highRisk: true
  },
  {
    id: 'project_specific_global_candidate',
    inputSignal: 'Project core says this repository must run plugin validation after SKILL.md changes.',
    expectedClassification: 'lifecycle_recommendation',
    expectedModule: 'lifecycle',
    expectedPolicy: 'review_first',
    expectedOutput: 'Keep project-specific detail out of global_core; recommend only if generalized safely.',
    mustNotOutcome: ['global_core', 'project_detail_global_core', 'silent_drop'],
    reviewNotes: 'Cross-project consolidation must not leak repo-specific commands into global policy.',
    durableSignal: true,
    highRisk: false
  },
  {
    id: 'core_profile_generation',
    inputSignal: 'Profile generation runs after project_core/global_core promotion.',
    expectedClassification: 'project_core',
    expectedModule: 'profile',
    expectedPolicy: 'risk_based_review',
    expectedOutput: 'Generated profile contains only core memory and excludes trial/validated/high-risk recommendations.',
    mustNotOutcome: ['trial_checklist', 'high_risk_core', 'core_without_evidence', 'silent_drop'],
    reviewNotes: 'Profile output is a release gate, not just a formatting artifact.',
    durableSignal: true,
    highRisk: false
  }
]

export const MEMORY_QUALITY_RUBRIC: MemoryQualityRubricSection[] = [
  {
    id: 'capture',
    title: 'Capture',
    checks: [
      'Explicit user instructions, durable workflow rules, known pitfalls, repeated failures, source-of-truth rules, and durable decisions are captured.',
      'No Memory Delta explains why no durable signal was dropped.'
    ]
  },
  {
    id: 'non_pollution',
    title: 'Non-Pollution',
    checks: [
      'Task state, transient status, numeric snapshots, raw emotion events, one-off actions, and raw implementation notes do not directly enter pending or active memory.'
    ]
  },
  {
    id: 'routing',
    title: 'Routing',
    checks: [
      'Episode, task state, distillation input, project semantic, procedural, preference, relationship/affective, and reflection candidates use the expected module and policy.'
    ]
  },
  {
    id: 'evidence',
    title: 'Evidence',
    checks: [
      'Candidates include source, episode or trace references, what happened, why it matters, result, and source boundaries where applicable.'
    ]
  },
  {
    id: 'use_boundaries',
    title: 'Use Boundaries',
    checks: [
      'Reviewable memory has useWhen and doNotUseWhen boundaries or a documented reason why the field is not yet available.'
    ]
  },
  {
    id: 'semantic_prepare',
    title: 'Semantic Prepare',
    checks: [
      'Candidates with needs_rewrite status are handled by explicit prepare or review actions before active promotion.',
      'Semantic prepare replaces content only for rewrite-eligible pending candidates, enriches boundaries without changing content, and leaves active memory unchanged.'
    ]
  },
  {
    id: 'reviewability',
    title: 'Reviewability',
    checks: [
      'A reviewer can decide approve, edit, reject, or defer without reading raw JSON.'
    ]
  },
  {
    id: 'activation_safety',
    title: 'Activation Safety',
    checks: [
      'Auto-promote and active mutation stay limited to low-risk, evidenced, receipt-backed paths.'
    ]
  },
  {
    id: 'reflection_safety',
    title: 'Reflection Safety',
    checks: [
      'Activation/reflection produces reviewable candidates and never directly mutates active memory.'
    ]
  }
]

export const MEMORY_DELTA_REPORT_TEMPLATE = `# Memory Delta Report

## Captured durable signals

## Generated candidates / distillation inputs / reflection candidates

## Episode-only or task-state signals

## No-memory decisions and reasons

Signals reviewed:
Decision:
Why no durable memory candidate:
Why no durable signal was dropped:
Why pending / active stayed clean:

## Pollution safeguards

## Recall safeguards

## Fixture coverage

## Open risks
`

export function validateMemoryDeltaReport(report: string): string[] {
  const errors: string[] = []
  if (report.trim() === '') return ['memory delta report is empty']

  if (!hasMarkdownHeading(report, 1, MEMORY_DELTA_REPORT_TITLE)) {
    errors.push(`missing memory delta report title: ${MEMORY_DELTA_REPORT_TITLE}`)
  }

  for (const heading of MEMORY_DELTA_REPORT_REQUIRED_HEADINGS) {
    if (!hasMarkdownHeading(report, 2, heading)) {
      errors.push(`missing memory delta report heading: ${heading}`)
      continue
    }
    if (markdownSectionBody(report, 2, heading).trim() === '') {
      errors.push(`memory delta report section is empty: ${heading}`)
    }
  }

  const noMemorySectionRange = markdownSectionRange(report, 2, 'No-memory decisions and reasons')
  const noMemorySection = noMemorySectionRange?.body ?? ''
  for (const field of MEMORY_DELTA_REPORT_REQUIRED_FIELDS) {
    const fieldBody = markdownFieldBody(noMemorySection, field)
    if (fieldBody === undefined) {
      errors.push(`missing memory delta report field: ${field}`)
      continue
    }
    if (fieldBody.trim() === '') {
      errors.push(`memory delta report field is empty: ${field}`)
    }
    if (noMemorySectionRange !== undefined && markdownFieldAppearsOutsideRange(report, field, noMemorySectionRange)) {
      errors.push(`memory delta report field appears outside no-memory section: ${field}`)
    }
  }

  return errors
}

export function fixtureById(id: MemoryQualityFixtureId): MemoryQualityFixture {
  const fixture = MEMORY_QUALITY_FIXTURES.find((item) => item.id === id)
  if (fixture === undefined) {
    throw new Error(`Unknown memory quality fixture: ${id}`)
  }
  return fixture
}

export function validateMemoryQualityFixtures(fixtures: MemoryQualityFixture[] = MEMORY_QUALITY_FIXTURES): string[] {
  const errors: string[] = []
  const seen = new Set<MemoryQualityFixtureId>()

  for (const fixture of fixtures) {
    if (seen.has(fixture.id)) {
      errors.push(`duplicate fixture id: ${fixture.id}`)
    }
    seen.add(fixture.id)
  }

  for (const requiredId of REQUIRED_MEMORY_QUALITY_FIXTURE_IDS) {
    if (!seen.has(requiredId)) {
      errors.push(`missing required fixture: ${requiredId}`)
    }
  }

  for (const fixture of fixtures) {
    if (fixture.inputSignal.trim() === '') errors.push(`fixture ${fixture.id} has empty inputSignal`)
    if (fixture.expectedOutput.trim() === '') errors.push(`fixture ${fixture.id} has empty expectedOutput`)
    if (fixture.reviewNotes.trim() === '') errors.push(`fixture ${fixture.id} has empty reviewNotes`)
    if (fixture.mustNotOutcome.length === 0) errors.push(`fixture ${fixture.id} has no forbidden outcomes`)

    if (['episode_only', 'task_state'].includes(fixture.expectedClassification)) {
      if (!fixture.mustNotOutcome.includes('active')) {
        errors.push(`low-value fixture ${fixture.id} must forbid active`)
      }
      if (!fixture.mustNotOutcome.includes('pending')) {
        errors.push(`low-value fixture ${fixture.id} must forbid pending`)
      }
      if (!fixture.mustNotOutcome.includes('direct_pending')) {
        errors.push(`low-value fixture ${fixture.id} must forbid direct_pending`)
      }
    }
    if (fixture.expectedClassification === 'manual_review_evidence') {
      if (!fixture.mustNotOutcome.includes('active')) {
        errors.push(`manual-review evidence fixture ${fixture.id} must forbid active`)
      }
      if (!fixture.mustNotOutcome.includes('pending')) {
        errors.push(`manual-review evidence fixture ${fixture.id} must forbid pending`)
      }
      if (!fixture.mustNotOutcome.includes('direct_pending')) {
        errors.push(`manual-review evidence fixture ${fixture.id} must forbid direct_pending`)
      }
    }
    if (fixture.durableSignal && fixture.expectedPolicy === 'no_memory_candidate') {
      errors.push(`durable fixture ${fixture.id} cannot use no_memory_candidate policy`)
    }
    if (fixture.durableSignal && !fixture.mustNotOutcome.includes('silent_drop')) {
      errors.push(`durable fixture ${fixture.id} must forbid silent_drop`)
    }
    if (fixture.id === 'old_review_summary_noise') {
      if (!fixture.mustNotOutcome.includes('project_trial')) {
        errors.push('fixture old_review_summary_noise must forbid project_trial')
      }
      if (!fixture.mustNotOutcome.includes('profile')) {
        errors.push('fixture old_review_summary_noise must forbid profile')
      }
    }
    if (fixture.id === 'trial_applied_twice') {
      const expectedOutput = fixture.expectedOutput.toLowerCase()
      if (!expectedOutput.includes('validated')) {
        errors.push('trial fixture trial_applied_twice expectedOutput must mention validated')
      }
    }
    if (fixture.id === 'trial_with_corrected_event') {
      const expectedOutput = fixture.expectedOutput.toLowerCase()
      if (!expectedOutput.includes('recommendation')) {
        errors.push('trial fixture trial_with_corrected_event expectedOutput must mention recommendation')
      }
    }
    if (fixture.expectedClassification === 'global_core' && !fixture.mustNotOutcome.includes('project_detail_global_core')) {
      errors.push(`global_core fixture ${fixture.id} must forbid project_detail_global_core`)
    }
    if (fixture.highRisk && !['manual_review', 'manual_only'].includes(fixture.expectedPolicy)) {
      errors.push(`high-risk fixture ${fixture.id} must use manual review policy`)
    }
    if (fixture.highRisk && !fixture.mustNotOutcome.includes('auto_active')) {
      errors.push(`high-risk fixture ${fixture.id} must forbid auto_active`)
    }
    if (fixture.highRisk && !fixture.mustNotOutcome.includes('silent_drop')) {
      errors.push(`high-risk fixture ${fixture.id} must forbid silent_drop`)
    }
    if (fixture.highRisk) {
      for (const outcome of ['project_core', 'global_core', 'profile'] as const) {
        if (!fixture.mustNotOutcome.includes(outcome)) {
          errors.push(`high-risk fixture ${fixture.id} must forbid ${outcome}`)
        }
      }
    }
    if (
      fixture.id === 'core_profile_generation'
      && !fixture.expectedOutput.includes('profile contains only core memory')
    ) {
      errors.push('fixture core_profile_generation expectedOutput must contain profile contains only core memory')
    }
  }

  return errors
}

function hasMarkdownHeading(report: string, level: 1 | 2, heading: string): boolean {
  const marker = '#'.repeat(level)
  const pattern = new RegExp(`^${escapeRegExp(marker)}\\s+${escapeRegExp(heading)}\\s*$`, 'm')
  return pattern.test(report)
}

function markdownSectionBody(report: string, level: 1 | 2, heading: string): string {
  return markdownSectionRange(report, level, heading)?.body ?? ''
}

function markdownSectionRange(
  report: string,
  level: 1 | 2,
  heading: string
): { body: string, end: number, start: number } | undefined {
  const marker = '#'.repeat(level)
  const pattern = new RegExp(`^${escapeRegExp(marker)}\\s+${escapeRegExp(heading)}\\s*$`, 'm')
  const match = pattern.exec(report)
  if (match === null) return undefined

  const bodyStart = match.index + match[0].length
  const afterHeading = report.slice(bodyStart)
  const boundary = new RegExp(`^#{1,${level}}\\s+`, 'm')
  const nextHeading = boundary.exec(afterHeading)
  const bodyEnd = nextHeading === null ? report.length : bodyStart + nextHeading.index
  return {
    body: report.slice(bodyStart, bodyEnd),
    end: bodyEnd,
    start: match.index
  }
}

function markdownFieldBody(report: string, field: MemoryDeltaReportRequiredField): string | undefined {
  const pattern = new RegExp(`^${escapeRegExp(field)}(?<inline>.*)$`, 'm')
  const match = pattern.exec(report)
  if (match === null) return undefined

  const inline = match.groups?.inline ?? ''
  if (inline.trim() !== '') return inline

  const afterField = report.slice(match.index + match[0].length)
  const boundaries = [
    ...MEMORY_DELTA_REPORT_REQUIRED_FIELDS.map((requiredField) => new RegExp(`^${escapeRegExp(requiredField)}`, 'm')),
    /^#/m
  ]
  const nextBoundaryIndex = boundaries
    .map((boundary) => boundary.exec(afterField)?.index)
    .filter((index): index is number => index !== undefined)
    .sort((left, right) => left - right)[0]

  return nextBoundaryIndex === undefined ? afterField : afterField.slice(0, nextBoundaryIndex)
}

function markdownFieldAppearsOutsideRange(
  report: string,
  field: MemoryDeltaReportRequiredField,
  range: { end: number, start: number }
): boolean {
  const pattern = new RegExp(`^${escapeRegExp(field)}`, 'gm')
  for (let match = pattern.exec(report); match !== null; match = pattern.exec(report)) {
    if (match.index < range.start || match.index >= range.end) return true
  }
  return false
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
