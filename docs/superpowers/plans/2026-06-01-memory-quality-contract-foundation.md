# Memory Quality Contract Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `Memory Quality Contract` 落成可被 coordinator 和后续 subagent 复用的 repo artifact：typed fixture matrix、review rubric、Memory Delta Report 模板和基础测试。

**Architecture:** 本 plan 只实现 campaign 的 PR0 / PR1 foundation，不改 runtime memory mutation path。新增 `src/codex/memory-quality-contract.ts` 作为共享 contract source，测试覆盖 required fixtures、high-risk/manual-only、durable signal recall 和 no-pollution 约束，并增加一份面向 agent 的文档入口。

**Tech Stack:** TypeScript ES2022、Vitest、Markdown documentation、existing `npm run typecheck` / `npm test` workflow。

---

## Scope

实现范围：

- 新增 typed `MemoryQualityFixture`、rubric、Memory Delta Report 模板。
- 新增 fixture validation helper，帮助后续 tests/evals 复用。
- 新增 Vitest 覆盖 spec 中的第一批 fixture matrix。
- 新增 `docs/superpowers/memory-quality/README.md`，让后续 subagent 明确如何使用质量合同。

不做：

- 不修改 `runCodexAdmissionPipeline`、`memory-distill`、`memory-review`、Web UI、MCP tools。
- 不接入 runtime mutation gate。
- 不新增 CLI 命令。
- 不修改 generated plugin runtime。

成功标准：

- `npm test -- tests/memory-quality-contract.test.ts` 通过。
- `npm run typecheck` 通过。
- `git diff --check` 通过。
- 新增 artifact 能明确表达 precision + recall 双向质量合同。

## File Structure

- Create: `src/codex/memory-quality-contract.ts`
  - 定义 fixture/rubric/report template 类型。
  - 导出 required fixture ids、fixture matrix、review rubric 和 validation helper。
- Create: `tests/memory-quality-contract.test.ts`
  - 表驱动验证 fixture 覆盖、no-pollution、high-risk manual-only、durable signal recall 和 report template。
- Create: `docs/superpowers/memory-quality/README.md`
  - 面向 subagent/coordinator 的使用说明。
- Modify: none.

## Task 1: Add Failing Contract Tests

**Files:**
- Create: `tests/memory-quality-contract.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/memory-quality-contract.test.ts` with this content:

```ts
import { describe, expect, it } from 'vitest'
import {
  MEMORY_DELTA_REPORT_TEMPLATE,
  MEMORY_QUALITY_FIXTURES,
  MEMORY_QUALITY_RUBRIC,
  REQUIRED_MEMORY_QUALITY_FIXTURE_IDS,
  fixtureById,
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
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
npm test -- tests/memory-quality-contract.test.ts
```

Expected: FAIL with a module resolution error for `../src/codex/memory-quality-contract.js`.

## Task 2: Add Memory Quality Contract Source

**Files:**
- Create: `src/codex/memory-quality-contract.ts`
- Test: `tests/memory-quality-contract.test.ts`

- [ ] **Step 1: Add the contract implementation**

Create `src/codex/memory-quality-contract.ts` with this content:

```ts
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
  'repeated_failure'
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

export type MemoryQualityModule =
  | 'episode'
  | 'task_state'
  | 'distillation'
  | 'project_semantic'
  | 'procedural'
  | 'preference'
  | 'relationship_affective'
  | 'reflection'

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
    | 'reviewability'
    | 'activation_safety'
    | 'reflection_safety'
  title: string
  checks: string[]
}

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
    mustNotOutcome: ['active', 'pending', 'direct_pending', 'raw_emotion_active', 'auto_active', 'silent_drop'],
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
    mustNotOutcome: ['auto_active', 'silent_drop'],
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
    if (fixture.highRisk && !['manual_review', 'manual_only'].includes(fixture.expectedPolicy)) {
      errors.push(`high-risk fixture ${fixture.id} must use manual review policy`)
    }
    if (fixture.highRisk && !fixture.mustNotOutcome.includes('auto_active')) {
      errors.push(`high-risk fixture ${fixture.id} must forbid auto_active`)
    }
    if (fixture.highRisk && !fixture.mustNotOutcome.includes('silent_drop')) {
      errors.push(`high-risk fixture ${fixture.id} must forbid silent_drop`)
    }
  }

  return errors
}
```

- [ ] **Step 2: Run the focused tests**

Run:

```bash
npm test -- tests/memory-quality-contract.test.ts
```

Expected: PASS.

## Task 3: Add Agent-Facing Contract Documentation

**Files:**
- Create: `docs/superpowers/memory-quality/README.md`

- [ ] **Step 1: Add the coordinator/subagent usage doc**

Create `docs/superpowers/memory-quality/README.md` with this content:

```markdown
# Memory Quality Contract

This document is the agent-facing entry point for the memory quality campaign.
The source of truth for typed fixtures and rubric sections is
`src/codex/memory-quality-contract.ts`.

## Use This Before Agent Work

Every subagent working on Distillation, Router / ReviewPolicy, Review Surface,
Activation / Reflection, or quality harness tasks must include a Memory Delta
Report in its handoff.

## Quality Contract

High-quality memory work must satisfy both sides:

- High precision: low-value signals must not pollute pending or active memory.
- High recall: durable signals must not be silently dropped.

## Required Review Evidence

Coordinator review should check:

- Capture: durable signals were captured or explicitly explained.
- Non-pollution: task state, transient status, numeric snapshots, raw emotion events,
  one-off actions, and raw implementation notes did not directly enter pending or active memory.
- Routing: each signal went to the expected module and policy.
- Evidence: candidates include source, episode or trace references, and source boundaries.
- Use boundaries: reviewable memory includes when to use and when not to use it.
- Reviewability: humans can approve, edit, reject, or defer without raw JSON.
- Activation safety: active writes stay low-risk, evidenced, and receipt-backed.
- Reflection safety: reflection produces candidates, not direct active mutations.

## Memory Delta Report Template

```txt
# Memory Delta Report

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
```

## Verification

Run the foundation tests with:

```bash
npm test -- tests/memory-quality-contract.test.ts
```
```

- [ ] **Step 2: Verify documentation formatting**

Run:

```bash
git diff --check
```

Expected: PASS with no output.

## Task 4: Final Verification and Commit

**Files:**
- `src/codex/memory-quality-contract.ts`
- `tests/memory-quality-contract.test.ts`
- `docs/superpowers/memory-quality/README.md`
- `docs/superpowers/plans/2026-06-01-memory-quality-contract-foundation.md`

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/memory-quality-contract.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run diff check**

Run:

```bash
git diff --check
```

Expected: PASS with no output.

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add docs/superpowers/plans/2026-06-01-memory-quality-contract-foundation.md docs/superpowers/memory-quality/README.md src/codex/memory-quality-contract.ts tests/memory-quality-contract.test.ts
git commit -m "feat: add memory quality contract foundation"
```

Expected: commit succeeds.

## Self-Review

- Spec coverage: covers `Memory Quality Contract`, `Reviewer Rubric`, `Fixture Matrix`, `Memory Delta Report`, and coordinator/subagent usage. Later runtime tracks remain explicitly out of scope.
- Red-flag scan: no incomplete implementation sections are left for the implementing agent.
- Type consistency: fixture ids, classification names, policy names, and rubric ids match across tests and implementation.
