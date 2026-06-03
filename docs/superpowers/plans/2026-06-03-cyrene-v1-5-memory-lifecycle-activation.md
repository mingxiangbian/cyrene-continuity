# Cyrene v1.5 Memory Lifecycle Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 v1.5 memory lifecycle：project `trial -> validated -> project_core`、global `global_core only`、runtime activation、usage feedback、daily/weekly automation、migration cleanup 和 memory output quality gate。

**Architecture:** 先冻结 v1.5 contracts 和 validators，再让 migration、activation、feedback 三条独立 track 并行推进；daily/weekly automation 基于 usage events 和 lifecycle validators 收敛；最后用 fixture/eval gate 验证最终生成的 memory/profile/activation 质量。JSONL 仍是 source of truth，SQLite/index/profile 仍是派生物。

**Tech Stack:** TypeScript, Node.js 22, Vitest, JSONL store, Codex CLI, Cyrene memory roots, existing `memory-store` / `continuity-context` / `memory-quality-contract` patterns.

---

## Spec And Execution Contract

Spec source:

- `docs/superpowers/specs/2026-06-03-cyrene-v1-5-memory-lifecycle-activation-design.md`

Execution waves:

```txt
Wave 1:
  Task 1 contracts / validators

Wave 2, parallel after Task 1:
  Task 2 migration / normalization
  Task 3 activation layer
  Task 4 usage feedback events

Wave 3, parallel after Task 4 helpers exist:
  Task 5 daily trial validation module/tests, no CLI edits
  Task 6 weekly core + global consolidation module/tests, no CLI edits
  Coordinator Step A lifecycle automation CLI integration, after Tasks 5 and 6

Wave 4:
  Task 7 memory output quality gate
```

Subagent rules:

- Do not dispatch multiple workers to the same files at the same time.
- Each worker must edit only its owned files.
- Shared CLI route changes are coordinator-owned, except Task 2's isolated `migrate-v1-5` route.
- If a blocker requires a shared import or CLI registration, the worker must report `NEEDS_CONTEXT` instead of editing the shared file.
- Workers are not alone in the codebase; they must not revert changes from other workers and must adapt to merged contract changes.
- Every task ends with tests and a commit.
- After each task: spec compliance review first, code quality review second.

Global verification after all tasks:

```bash
npm run typecheck
npm test
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

## File Structure

Contracts:

- Modify `src/memory/types.ts`: add v1.5 lifecycle constants, types, optional runtime lifecycle fields, and extended activation event fields.
- Create `src/memory/memory-lifecycle.ts`: pure validation and policy helpers for tier/scope/risk/activation.
- Test `tests/memory-lifecycle.test.ts`.

Migration / normalization:

- Create `src/codex/codex-memory-lifecycle-migrate-v1-5.ts`: dry-run/apply migration over global/current/all project roots.
- Modify `src/codex/codex-cli.ts`: add `memory lifecycle migrate-v1-5`.
- Test `tests/codex-memory-lifecycle-migrate-v1-5.test.ts`.

Activation:

- Create `src/codex/memory-activation.ts`: deterministic trigger matching and activation output.
- Modify `src/codex/continuity-context.ts`: add `activation.workflowHints`, `activation.planConstraints`, `activation.checklistItems`.
- Test `tests/codex-memory-activation.test.ts` and extend `tests/codex-continuity-context.test.ts`.

Feedback:

- Modify `src/codex/memory-feedback.ts`: add single-event helper, `activationId`, `reason`, and explicit usage events.
- Test `tests/codex-memory-feedback.test.ts`.

Automation:

- Create `src/codex/codex-memory-lifecycle-daily.ts`: `trial -> validated`, explicit global instruction handling, stale trial cleanup, recommendations.
- Create `src/codex/codex-memory-lifecycle-weekly.ts`: `validated -> project_core`, global consolidation, profile regeneration.
- Create `src/codex/memory-lifecycle-profile.ts`: render project/global profile from core memory.
- Coordinator-only modify `src/codex/codex-cli.ts`: add `memory lifecycle daily` and `memory lifecycle weekly`.
- Coordinator-only modify `tests/codex-cli.test.ts`: add usage and route smoke tests for automation commands.
- Worker tests: `tests/codex-memory-lifecycle-daily.test.ts`, `tests/codex-memory-lifecycle-weekly.test.ts`.

Quality gate:

- Modify `src/codex/memory-quality-contract.ts`: add v1.5 fixture ids, classifications, forbidden outcomes, and validators.
- Test `tests/memory-quality-contract.test.ts`.
- Modify `src/eval/eval-runner.ts` only if release eval needs a named v1.5 check.
- Test `tests/codex-eval.test.ts` if eval changes.

Plugin runtime:

- Rebuild at the end with `npm run build:plugin`.
- Do not edit `plugin/runtime/cyrene-continuity.mjs` directly.

## Task 1: v1.5 Contracts And Validators

**Parallelism:** Wave 1, must complete before other implementation workers.

**Files:**

- Modify: `src/memory/types.ts`
- Create: `src/memory/memory-lifecycle.ts`
- Test: `tests/memory-lifecycle.test.ts`
- Modify as needed for compile fixtures: `tests/semantic-memory-v2-store.test.ts`

- [ ] **Step 1: Write failing contract tests**

Create `tests/memory-lifecycle.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  activationPolicyForConfidenceTier,
  isRuntimeActivatableSemanticMemory,
  isLowRiskLifecycleMemory,
  validateSemanticMemoryLifecycle
} from '../src/memory/memory-lifecycle.js'
import type { SemanticMemory } from '../src/memory/types.js'

function semanticMemory(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  return {
    id: 'memory-1',
    status: 'active',
    module: 'procedural',
    kind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    content: 'Run runtime verification before declaring implementation complete.',
    useWhen: ['Finishing implementation work'],
    doNotUseWhen: ['Documentation-only review without completion claim'],
    evidence: [{
      id: 'evidence-1',
      sourceKind: 'review_event',
      sourceRef: 'review:1',
      when: '2026-06-03T00:00:00.000Z',
      whatHappened: 'Completion was previously declared before user-visible verification.',
      whyImportant: 'The rule changes future agent behavior.'
    }],
    reviewPolicy: 'pending_review',
    supersedes: [],
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    confidenceTier: 'trial',
    activationPolicy: activationPolicyForConfidenceTier('trial'),
    ...overrides
  }
}

describe('v1.5 semantic memory lifecycle contract', () => {
  it('allows project trial memory to activate only as workflow hints', () => {
    const memory = semanticMemory({ confidenceTier: 'trial', activationPolicy: activationPolicyForConfidenceTier('trial') })

    expect(validateSemanticMemoryLifecycle(memory)).toEqual([])
    expect(memory.activationPolicy?.allowedModes).toEqual(['workflow_hint'])
    expect(isRuntimeActivatableSemanticMemory(memory)).toBe(true)
  })

  it('allows validated and project_core project memory to create constraints and checklist items', () => {
    const validated = semanticMemory({
      confidenceTier: 'validated',
      activationPolicy: activationPolicyForConfidenceTier('validated')
    })
    const core = semanticMemory({
      confidenceTier: 'project_core',
      activationPolicy: activationPolicyForConfidenceTier('project_core')
    })

    expect(validated.activationPolicy?.allowedModes).toEqual(['workflow_hint', 'plan_constraint', 'checklist_item'])
    expect(core.activationPolicy?.maxRuntimeStrength).toBe('profile')
    expect(validateSemanticMemoryLifecycle(validated)).toEqual([])
    expect(validateSemanticMemoryLifecycle(core)).toEqual([])
  })

  it('rejects global trial and global validated combinations', () => {
    expect(validateSemanticMemoryLifecycle(semanticMemory({
      scope: 'global',
      confidenceTier: 'trial',
      activationPolicy: activationPolicyForConfidenceTier('trial')
    }))).toContain('global memory must use confidenceTier global_core')

    expect(validateSemanticMemoryLifecycle(semanticMemory({
      scope: 'global',
      confidenceTier: 'validated',
      activationPolicy: activationPolicyForConfidenceTier('validated')
    }))).toContain('global memory must use confidenceTier global_core')
  })

  it('does not activate active memory that lacks explicit v1.5 tier or policy', () => {
    const memory = semanticMemory({ confidenceTier: undefined, activationPolicy: undefined })

    expect(validateSemanticMemoryLifecycle(memory)).toEqual(expect.arrayContaining([
      'active memory is missing confidenceTier',
      'active memory is missing activationPolicy'
    ]))
    expect(isRuntimeActivatableSemanticMemory(memory)).toBe(false)
  })

  it('classifies low-risk lifecycle memory conservatively', () => {
    expect(isLowRiskLifecycleMemory(semanticMemory())).toBe(true)
    expect(isLowRiskLifecycleMemory(semanticMemory({ domain: 'relationship', module: 'relationship_affective' }))).toBe(false)
    expect(isLowRiskLifecycleMemory(semanticMemory({
      reviewState: { scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.8, safety: 0.9, sensitivity: 0.7 } }
    }))).toBe(false)
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- tests/memory-lifecycle.test.ts
```

Expected: fail because `src/memory/memory-lifecycle.ts`, lifecycle types, and activation policies do not exist.

- [ ] **Step 3: Add lifecycle and activation event types**

Modify `src/memory/types.ts`:

```ts
export const PROJECT_CONFIDENCE_TIERS = ['trial', 'validated', 'project_core'] as const
export type ProjectConfidenceTier = typeof PROJECT_CONFIDENCE_TIERS[number]

export const GLOBAL_CONFIDENCE_TIERS = ['global_core'] as const
export type GlobalConfidenceTier = typeof GLOBAL_CONFIDENCE_TIERS[number]

export const CONFIDENCE_TIERS = [...PROJECT_CONFIDENCE_TIERS, ...GLOBAL_CONFIDENCE_TIERS] as const
export type ConfidenceTier = typeof CONFIDENCE_TIERS[number]

export const ACTIVATION_MODES = [
  'workflow_hint',
  'plan_constraint',
  'checklist_item',
  'workflow_selection'
] as const
export type ActivationMode = typeof ACTIVATION_MODES[number]

export const RUNTIME_ACTIVATION_STRENGTHS = ['hint', 'constraint', 'checklist', 'profile'] as const
export type RuntimeActivationStrength = typeof RUNTIME_ACTIVATION_STRENGTHS[number]

export interface ActivationPolicy {
  allowedModes: ActivationMode[]
  maxRuntimeStrength: RuntimeActivationStrength
}
```

Extend `ACTIVATION_EVENT_TYPES` to:

```ts
export const ACTIVATION_EVENT_TYPES = [
  'retrieved',
  'activated',
  'applied',
  'ignored',
  'corrected',
  'violated',
  'stale'
] as const
```

Extend `SemanticMemory` with optional fields so old JSONL can be read, while runtime validators reject missing fields:

```ts
  confidenceTier?: ConfidenceTier
  activationPolicy?: ActivationPolicy
```

Extend `ActivationEvent`:

```ts
  activationId?: string
  reason?: string
```

- [ ] **Step 4: Add validator helper implementation**

Create `src/memory/memory-lifecycle.ts`:

```ts
import type {
  ActivationPolicy,
  ConfidenceTier,
  SemanticMemory
} from './types.js'

const LOW_RISK_DOMAINS = new Set(['project', 'procedural', 'system'])
const LOW_RISK_MODULES = new Set(['project_semantic', 'procedural', 'system', 'global_policy'])
const NEGATIVE_EVENT_TYPES = new Set(['corrected', 'violated'])

export function activationPolicyForConfidenceTier(tier: ConfidenceTier): ActivationPolicy {
  if (tier === 'trial') {
    return { allowedModes: ['workflow_hint'], maxRuntimeStrength: 'hint' }
  }
  if (tier === 'validated') {
    return { allowedModes: ['workflow_hint', 'plan_constraint', 'checklist_item'], maxRuntimeStrength: 'checklist' }
  }
  return { allowedModes: ['workflow_hint', 'plan_constraint', 'checklist_item'], maxRuntimeStrength: 'profile' }
}

export function validateSemanticMemoryLifecycle(memory: SemanticMemory): string[] {
  const findings: string[] = []
  if (memory.status !== 'active') {
    return findings
  }
  if (memory.confidenceTier === undefined) {
    findings.push('active memory is missing confidenceTier')
  }
  if (memory.activationPolicy === undefined) {
    findings.push('active memory is missing activationPolicy')
  }
  if (memory.scope === 'global' && memory.confidenceTier !== undefined && memory.confidenceTier !== 'global_core') {
    findings.push('global memory must use confidenceTier global_core')
  }
  if (memory.scope === 'project' && memory.confidenceTier === 'global_core') {
    findings.push('project memory cannot use confidenceTier global_core')
  }
  if (memory.confidenceTier === 'trial' && memory.activationPolicy?.allowedModes.some((mode) => mode !== 'workflow_hint')) {
    findings.push('trial memory can only allow workflow_hint activation')
  }
  if ((memory.confidenceTier === 'project_core' || memory.confidenceTier === 'global_core') && memory.evidence.length === 0) {
    findings.push('core memory requires evidence')
  }
  if (memory.confidenceTier === 'global_core' && !isLowRiskLifecycleMemory(memory)) {
    findings.push('global_core memory must be low risk')
  }
  return findings
}

export function isRuntimeActivatableSemanticMemory(memory: SemanticMemory): boolean {
  return memory.status === 'active' && validateSemanticMemoryLifecycle(memory).length === 0
}

export function isLowRiskLifecycleMemory(memory: SemanticMemory): boolean {
  const scores = memory.reviewState?.scores
  return (
    LOW_RISK_DOMAINS.has(memory.domain) &&
    LOW_RISK_MODULES.has(memory.module) &&
    (scores?.sensitivity ?? 0.2) <= 0.35 &&
    (scores?.safety ?? 0.9) >= 0.8
  )
}

export function isNegativeActivationEventType(event: string): boolean {
  return NEGATIVE_EVENT_TYPES.has(event)
}
```

- [ ] **Step 5: Update semantic memory fixtures for v1.5 fields**

In `tests/semantic-memory-v2-store.test.ts`, import `activationPolicyForConfidenceTier` and update helper `semanticMemory()` with:

```ts
    confidenceTier: 'trial',
    activationPolicy: activationPolicyForConfidenceTier('trial'),
```

If other tests create `SemanticMemory` literals, add the same two fields with the correct tier for that test:

- `status: 'active', scope: 'project'` → `validated` unless the test is about core/profile.
- `status: 'active', scope: 'global'` → `global_core`.
- `status: 'pending'` / `status: 'candidate'` may omit lifecycle fields.

- [ ] **Step 6: Run task tests**

Run:

```bash
npm test -- tests/memory-lifecycle.test.ts tests/semantic-memory-v2-store.test.ts
```

Expected: pass.

- [ ] **Step 7: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass. Fix compile errors by adding explicit `confidenceTier` / `activationPolicy` only to active v1.5 semantic fixtures or code paths that intentionally produce active runtime memory.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/memory/types.ts src/memory/memory-lifecycle.ts tests/memory-lifecycle.test.ts tests/semantic-memory-v2-store.test.ts
git commit -m "feat: add v1.5 memory lifecycle contracts"
```

## Task 2: Migration And Normalization

**Parallelism:** Wave 2. Can run in parallel with Tasks 3 and 4 after Task 1. Owns migration files and CLI route.

**Files:**

- Create: `src/codex/codex-memory-lifecycle-migrate-v1-5.ts`
- Modify: `src/codex/codex-cli.ts`
- Test: `tests/codex-memory-lifecycle-migrate-v1-5.test.ts`

- [ ] **Step 1: Write failing migration tests**

Create `tests/codex-memory-lifecycle-migrate-v1-5.test.ts` with cases:

```ts
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { runCodexMemoryLifecycleMigrateV15 } from '../src/codex/codex-memory-lifecycle-migrate-v1-5.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { readMemoryEventsFromRoot, readPendingMemoriesFromRoot, readSemanticMemoriesFromRoot } from '../src/memory/memory-store.js'
import type { CyreneMemory, PendingMemory } from '../src/memory/types.js'

const execFileAsync = promisify(execFile)
const originalHome = process.env.HOME
const tempDirs: string[] = []

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function oldActive(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Run runtime verification before declaring implementation complete.',
    normalizedKey: 'runtime-verification-before-complete',
    evidence: [{ summary: 'User required runtime verification before completion.', sourceKind: 'review_event' }],
    source: 'review_event',
    scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    tags: ['workflow_rule'],
    candidateKind: 'workflow_rule',
    ...overrides
  }
}

function oldPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Review-summary generation should chunk long summaries before retrying.',
    normalizedKey: 'review-summary-chunk-retry',
    evidence: [{ summary: 'Repeated timeout had mitigation.', sourceKind: 'review_event' }],
    source: 'review_event',
    scores: { evidenceStrength: 0.8, stability: 0.75, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 },
    seenCount: 1,
    firstSeenAt: '2026-06-01T00:00:00.000Z',
    lastSeenAt: '2026-06-01T00:00:00.000Z',
    expiresAt: '2026-07-01T00:00:00.000Z',
    tags: ['workflow_rule'],
    candidateKind: 'workflow_rule',
    ...overrides
  }
}

describe('codex memory lifecycle migrate-v1-5', () => {
  it('converts valuable old pending into project trial and drops review_summary noise', async () => {
    const home = await createTempDir('cyrene-v15-migrate-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-v15-migrate-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    const project = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(project.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), [
      JSON.stringify(oldPending()),
      JSON.stringify(oldPending({
        id: 'pending-noise',
        content: 'review summary ok: merged branch and deleted local branch',
        normalizedKey: 'review-summary-noise',
        evidence: [{ summary: 'review_summary status=ok', sourceKind: 'review_event' }],
        scores: { evidenceStrength: 0.4, stability: 0.3, usefulness: 0.2, safety: 0.9, sensitivity: 0.1 }
      }))
    ].join('\n') + '\n')

    const result = await runCodexMemoryLifecycleMigrateV15({ cwd: repo, apply: true, now: '2026-06-03T00:00:00.000Z' })

    expect(result.roots[0].convertedPendingToTrial).toBe(1)
    expect(result.roots[0].droppedPending).toBe(1)
    await expect(readPendingMemoriesFromRoot(memoryRoot)).resolves.toEqual([])
    expect(await readSemanticMemoriesFromRoot(memoryRoot)).toEqual([
      expect.objectContaining({
        id: 'pending-1',
        status: 'active',
        confidenceTier: 'trial',
        activationPolicy: { allowedModes: ['workflow_hint'], maxRuntimeStrength: 'hint' }
      })
    ])
  })

  it('converts low-risk global active memory into global_core and recommends high-risk global memory', async () => {
    const home = await createTempDir('cyrene-v15-migrate-global-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-v15-migrate-global-repo-')
    await identifyCodexProject(repo)
    const memoryRoot = codexGlobalMemoryRoot()
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'index.jsonl'), [
      JSON.stringify(oldActive({ id: 'global-procedural', scope: 'global', normalizedKey: 'global-procedural' })),
      JSON.stringify(oldActive({
        id: 'global-affective',
        scope: 'global',
        domain: 'affective',
        type: 'affective_pattern',
        content: 'The user seems emotionally attached to the tool.',
        normalizedKey: 'global-affective',
        scores: { evidenceStrength: 0.7, stability: 0.6, usefulness: 0.5, safety: 0.85, sensitivity: 0.8 }
      }))
    ].join('\n') + '\n')

    const result = await runCodexMemoryLifecycleMigrateV15({ cwd: repo, apply: true, now: '2026-06-03T00:00:00.000Z' })

    expect(result.roots.find((root) => root.scope === 'global')).toMatchObject({
      convertedActiveToCore: 1,
      recommendations: 1
    })
    expect(await readSemanticMemoriesFromRoot(memoryRoot)).toEqual([
      expect.objectContaining({ id: 'global-procedural', confidenceTier: 'global_core' })
    ])
    expect((await readMemoryEventsFromRoot(memoryRoot)).map((event) => event.reason)).toContain(
      'v1.5 migration recommended manual review for high-risk memory'
    )
  })
})
```

- [ ] **Step 2: Run failing migration tests**

```bash
npm test -- tests/codex-memory-lifecycle-migrate-v1-5.test.ts
```

Expected: fail because migration module and CLI command do not exist.

- [ ] **Step 3: Implement migration module**

Create `src/codex/codex-memory-lifecycle-migrate-v1-5.ts` with:

```ts
import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import {
  activationPolicyForConfidenceTier,
  isLowRiskLifecycleMemory
} from '../memory/memory-lifecycle.js'
import {
  activeMemoryToSemanticMemory,
  pendingMemoryToSemanticMemory
} from '../memory/semantic-memory-adapter.js'
import {
  appendMemoryEventFromRoot,
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readSemanticMemoriesFromRoot,
  writePendingMemoriesFromRoot,
  writeSemanticMemoriesFromRoot
} from '../memory/memory-store.js'
import type { CyreneMemory, PendingMemory, SemanticMemory } from '../memory/types.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'
import { listCodexProjects } from './project-registry.js'

export interface CodexMemoryLifecycleMigrateV15RootResult {
  scope: 'global' | 'project'
  projectId?: string
  memoryRoot: string
  skipped?: boolean
  reason?: string
  convertedPendingToTrial: number
  droppedPending: number
  convertedActiveToValidated: number
  convertedActiveToProjectCore: number
  convertedActiveToCore: number
  droppedActive: number
  recommendations: number
}

export interface CodexMemoryLifecycleMigrateV15Result {
  action: 'migrate_memory_lifecycle_v1_5'
  dryRun: boolean
  roots: CodexMemoryLifecycleMigrateV15RootResult[]
}

export async function runCodexMemoryLifecycleMigrateV15(input: {
  cwd: string
  allProjects?: boolean
  apply?: boolean
  now?: string
}): Promise<CodexMemoryLifecycleMigrateV15Result> {
  const dryRun = input.apply !== true
  const now = input.now ?? new Date().toISOString()
  const project = await identifyCodexProject(input.cwd)
  const roots = new Map<string, { scope: 'global' | 'project'; projectId?: string; memoryRoot: string }>()
  roots.set('global', { scope: 'global', memoryRoot: codexGlobalMemoryRoot() })
  roots.set(`project:${project.projectId}`, { scope: 'project', projectId: project.projectId, memoryRoot: codexProjectMemoryRoot(project.projectId) })
  if (input.allProjects === true) {
    for (const entry of await listCodexProjects().catch(() => [])) {
      roots.set(`project:${entry.projectId}`, { scope: 'project', projectId: entry.projectId, memoryRoot: codexProjectMemoryRoot(entry.projectId) })
    }
  }

  const results: CodexMemoryLifecycleMigrateV15RootResult[] = []
  for (const root of roots.values()) {
    const readable = await readableMemoryRoot(root.memoryRoot)
    if (!readable.ok) {
      results.push(emptyRootResult(root, readable.reason))
      continue
    }
    results.push(await migrateRoot({ ...root, dryRun, now }))
  }
  return { action: 'migrate_memory_lifecycle_v1_5', dryRun, roots: results }
}

async function migrateRoot(input: {
  scope: 'global' | 'project'
  projectId?: string
  memoryRoot: string
  dryRun: boolean
  now: string
}): Promise<CodexMemoryLifecycleMigrateV15RootResult> {
  const [active, pending, existingSemantic] = await Promise.all([
    readActiveMemoriesFromRoot(input.memoryRoot),
    readPendingMemoriesFromRoot(input.memoryRoot),
    readSemanticMemoriesFromRoot(input.memoryRoot)
  ])
  const converted: SemanticMemory[] = []
  const events: Array<{ reason: string; memoryId?: string; details: Record<string, unknown> }> = []
  let convertedPendingToTrial = 0
  let droppedPending = 0
  let convertedActiveToValidated = 0
  let convertedActiveToProjectCore = 0
  let convertedActiveToCore = 0
  let droppedActive = 0
  let recommendations = 0

  for (const memory of active) {
    const semantic = activeMemoryToSemanticMemory(memory)
    if (input.scope === 'global') {
      if (isLowRiskLegacyMemory(memory)) {
        converted.push({
          ...semantic,
          scope: 'global',
          confidenceTier: 'global_core',
          activationPolicy: activationPolicyForConfidenceTier('global_core')
        })
        convertedActiveToCore += 1
      } else {
        recommendations += 1
        events.push({ reason: 'v1.5 migration recommended manual review for high-risk memory', memoryId: memory.id, details: { source: 'active', scope: 'global' } })
      }
      continue
    }
    if (isLowRiskLegacyMemory(memory)) {
      const tier = memory.strength === 'hard' && memory.scores.evidenceStrength >= 0.9 ? 'project_core' : 'validated'
      converted.push({
        ...semantic,
        confidenceTier: tier,
        activationPolicy: activationPolicyForConfidenceTier(tier)
      })
      if (tier === 'project_core') convertedActiveToProjectCore += 1
      else convertedActiveToValidated += 1
    } else if (isHighRiskLegacyMemory(memory)) {
      recommendations += 1
      events.push({ reason: 'v1.5 migration recommended manual review for high-risk memory', memoryId: memory.id, details: { source: 'active', scope: 'project' } })
    } else {
      droppedActive += 1
    }
  }

  for (const memory of pending) {
    if (input.scope === 'project' && isValuablePendingTrial(memory)) {
      const semantic = pendingMemoryToSemanticMemory(memory)
      converted.push({
        ...semantic,
        status: 'active',
        confidenceTier: 'trial',
        activationPolicy: activationPolicyForConfidenceTier('trial')
      })
      convertedPendingToTrial += 1
    } else if (isHighRiskPending(memory)) {
      recommendations += 1
      events.push({ reason: 'v1.5 migration recommended manual review for high-risk pending memory', memoryId: memory.id, details: { source: 'pending', scope: input.scope } })
    } else {
      droppedPending += 1
    }
  }

  if (!input.dryRun) {
    const preserved = existingSemantic.filter((memory) => memory.status !== 'active')
    await writeSemanticMemoriesFromRoot(input.memoryRoot, upsertById(preserved, converted))
    await writePendingMemoriesFromRoot(input.memoryRoot, [])
    for (const event of events) {
      await appendMemoryEventFromRoot(input.memoryRoot, {
        id: randomUUID(),
        action: 'audit',
        at: input.now,
        reason: event.reason,
        ...(event.memoryId === undefined ? {} : { memoryId: event.memoryId }),
        details: event.details
      })
    }
    await appendMemoryEventFromRoot(input.memoryRoot, {
      id: randomUUID(),
      action: 'audit',
      at: input.now,
      reason: 'v1.5 lifecycle migration completed',
      details: { convertedPendingToTrial, droppedPending, convertedActiveToValidated, convertedActiveToProjectCore, convertedActiveToCore, droppedActive, recommendations }
    })
  }

  return { scope: input.scope, projectId: input.projectId, memoryRoot: input.memoryRoot, convertedPendingToTrial, droppedPending, convertedActiveToValidated, convertedActiveToProjectCore, convertedActiveToCore, droppedActive, recommendations }
}

function isLowRiskLegacyMemory(memory: CyreneMemory): boolean {
  return ['project', 'procedural', 'system'].includes(memory.domain) &&
    memory.scores.safety >= 0.8 &&
    memory.scores.sensitivity <= 0.35 &&
    memory.evidence.length > 0
}

function isHighRiskLegacyMemory(memory: CyreneMemory): boolean {
  return ['personal', 'relationship', 'affective'].includes(memory.domain) || memory.scores.sensitivity > 0.35
}

function isValuablePendingTrial(memory: PendingMemory): boolean {
  return ['project', 'procedural', 'system'].includes(memory.domain) &&
    memory.evidence.length > 0 &&
    memory.scores.usefulness >= 0.6 &&
    memory.scores.evidenceStrength >= 0.65 &&
    !isReviewSummaryNoise(memory.content)
}

function isHighRiskPending(memory: PendingMemory): boolean {
  return ['personal', 'relationship', 'affective'].includes(memory.domain) || memory.scores.sensitivity > 0.35
}

function isReviewSummaryNoise(content: string): boolean {
  const text = content.toLowerCase()
  return text.includes('review summary ok') || text.includes('merged branch') || text.includes('deleted local branch')
}

function upsertById(current: SemanticMemory[], replacements: SemanticMemory[]): SemanticMemory[] {
  const next = [...current]
  for (const replacement of replacements) {
    const index = next.findIndex((memory) => memory.id === replacement.id)
    if (index < 0) next.push(replacement)
    else next[index] = replacement
  }
  return next
}

async function readableMemoryRoot(memoryRoot: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const stats = await lstat(memoryRoot)
    if (stats.isSymbolicLink()) return { ok: false, reason: 'memory root is a symlink' }
    if (!stats.isDirectory()) return { ok: false, reason: 'memory root is not a directory' }
    return { ok: true }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { ok: false, reason: 'memory root does not exist' }
    throw error
  }
}

function emptyRootResult(root: { scope: 'global' | 'project'; projectId?: string; memoryRoot: string }, reason: string): CodexMemoryLifecycleMigrateV15RootResult {
  return { ...root, skipped: true, reason, convertedPendingToTrial: 0, droppedPending: 0, convertedActiveToValidated: 0, convertedActiveToProjectCore: 0, convertedActiveToCore: 0, droppedActive: 0, recommendations: 0 }
}
```

- [ ] **Step 4: Register CLI command**

Modify `src/codex/codex-cli.ts` imports:

```ts
import { runCodexMemoryLifecycleMigrateV15 } from './codex-memory-lifecycle-migrate-v1-5.js'
```

Add before `memory status` route:

```ts
  if (command === 'memory' && input.args[1] === 'lifecycle' && input.args[2] === 'migrate-v1-5') {
    if (input.args.includes('--dry-run') && input.args.includes('--apply')) {
      throw new Error('memory lifecycle migrate-v1-5 accepts only one of --dry-run or --apply')
    }
    process.stdout.write(`${JSON.stringify(await runCodexMemoryLifecycleMigrateV15({
      cwd: input.cwd,
      allProjects: input.args.includes('--all-projects'),
      apply: input.args.includes('--apply')
    }), null, 2)}\n`)
    return
  }
```

Update usage string to include:

```txt
memory lifecycle migrate-v1-5 [--dry-run|--apply] [--all-projects]
```

- [ ] **Step 5: Run task tests**

```bash
npm test -- tests/codex-memory-lifecycle-migrate-v1-5.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/codex/codex-memory-lifecycle-migrate-v1-5.ts src/codex/codex-cli.ts tests/codex-memory-lifecycle-migrate-v1-5.test.ts
git commit -m "feat: add v1.5 memory lifecycle migration"
```

## Task 3: Runtime Memory Activation Layer

**Parallelism:** Wave 2. Can run in parallel with Tasks 2 and 4 after Task 1. Owns activation file and `continuity-context` output shape.

**Files:**

- Create: `src/codex/memory-activation.ts`
- Modify: `src/codex/continuity-context.ts`
- Test: `tests/codex-memory-activation.test.ts`
- Extend: `tests/codex-continuity-context.test.ts`

- [ ] **Step 1: Write failing activation unit tests**

Create `tests/codex-memory-activation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildMemoryActivations } from '../src/codex/memory-activation.js'
import { activationPolicyForConfidenceTier } from '../src/memory/memory-lifecycle.js'
import type { CyreneMemory, SemanticMemory } from '../src/memory/types.js'

function semanticMemory(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  return {
    id: 'memory-1',
    status: 'active',
    module: 'procedural',
    kind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    content: 'Run Playwright or runtime verification before declaring frontend work complete.',
    useWhen: ['Completing frontend implementation work'],
    doNotUseWhen: ['Docs-only edits'],
    evidence: [{ id: 'evidence-1', sourceKind: 'review_event', sourceRef: 'review:1', whatHappened: 'Verification was missed.', whyImportant: 'Future completion claims need runtime evidence.' }],
    reviewPolicy: 'pending_review',
    supersedes: [],
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    confidenceTier: 'trial',
    activationPolicy: activationPolicyForConfidenceTier('trial'),
    ...overrides
  }
}

function legacyActive(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'legacy-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Legacy active memory without v1.5 tier.',
    normalizedKey: 'legacy-active',
    evidence: [{ summary: 'Legacy evidence.', sourceKind: 'file' }],
    source: 'file',
    scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    tags: ['workflow_rule'],
    ...overrides
  }
}

describe('memory activation layer', () => {
  it('turns trial memory into workflow hints only', () => {
    const result = buildMemoryActivations({
      query: 'frontend implementation complete runtime verification',
      projectMemories: [semanticMemory()],
      globalMemories: []
    })

    expect(result.workflowHints).toHaveLength(1)
    expect(result.workflowHints[0]).toMatchObject({
      memoryId: 'memory-1',
      confidenceTier: 'trial',
      activationMode: 'workflow_hint',
      source: 'project'
    })
    expect(result.planConstraints).toEqual([])
    expect(result.checklistItems).toEqual([])
  })

  it('turns validated memory into constraints and checklist items', () => {
    const result = buildMemoryActivations({
      query: 'frontend implementation complete runtime verification',
      projectMemories: [semanticMemory({
        confidenceTier: 'validated',
        activationPolicy: activationPolicyForConfidenceTier('validated')
      })],
      globalMemories: []
    })

    expect(result.workflowHints).toHaveLength(0)
    expect(result.planConstraints.map((item) => item.memoryId)).toEqual(['memory-1'])
    expect(result.checklistItems.map((item) => item.memoryId)).toEqual(['memory-1'])
  })

  it('ignores legacy active memory without explicit v1.5 lifecycle fields', () => {
    const result = buildMemoryActivations({
      query: 'legacy active memory',
      projectMemories: [legacyActive()],
      globalMemories: []
    })

    expect(result.workflowHints).toEqual([])
    expect(result.planConstraints).toEqual([])
    expect(result.checklistItems).toEqual([])
  })
})
```

- [ ] **Step 2: Run failing activation tests**

```bash
npm test -- tests/codex-memory-activation.test.ts
```

Expected: fail because activation module does not exist.

- [ ] **Step 3: Implement activation builder**

Create `src/codex/memory-activation.ts`:

```ts
import { createHash } from 'node:crypto'
import {
  isRuntimeActivatableSemanticMemory
} from '../memory/memory-lifecycle.js'
import { activeMemoryToSemanticMemory } from '../memory/semantic-memory-adapter.js'
import type { ActivationMode, ConfidenceTier, CyreneMemory, SemanticMemory } from '../memory/types.js'

export interface MemoryActivation {
  id: string
  memoryId: string
  confidenceTier: ConfidenceTier
  activationMode: ActivationMode
  text: string
  triggerReason: string
  source: 'project' | 'global'
  risk: 'low' | 'medium' | 'high'
}

export interface MemoryActivationOutput {
  workflowHints: MemoryActivation[]
  planConstraints: MemoryActivation[]
  checklistItems: MemoryActivation[]
}

export function buildMemoryActivations(input: {
  query: string
  projectMemories: Array<SemanticMemory | CyreneMemory>
  globalMemories: Array<SemanticMemory | CyreneMemory>
  maxPerBucket?: number
}): MemoryActivationOutput {
  const maxPerBucket = input.maxPerBucket ?? 6
  const output: MemoryActivationOutput = { workflowHints: [], planConstraints: [], checklistItems: [] }
  for (const source of ['global', 'project'] as const) {
    const memories = source === 'global' ? input.globalMemories : input.projectMemories
    for (const memory of memories.map(toSemanticMemoryIfNeeded)) {
      if (!isRuntimeActivatableSemanticMemory(memory)) continue
      if (!matchesActivationTrigger(memory, input.query)) continue
      const tier = memory.confidenceTier
      if (tier === undefined || memory.activationPolicy === undefined) continue
      if (tier === 'trial') {
        pushLimited(output.workflowHints, activation(memory, 'workflow_hint', source), maxPerBucket)
        continue
      }
      if (memory.activationPolicy.allowedModes.includes('plan_constraint')) {
        pushLimited(output.planConstraints, activation(memory, 'plan_constraint', source), maxPerBucket)
      }
      if (memory.activationPolicy.allowedModes.includes('checklist_item')) {
        pushLimited(output.checklistItems, activation(memory, 'checklist_item', source), maxPerBucket)
      }
    }
  }
  return output
}

function toSemanticMemoryIfNeeded(memory: SemanticMemory | CyreneMemory): SemanticMemory {
  if ('module' in memory && 'kind' in memory) {
    return memory
  }
  return activeMemoryToSemanticMemory(memory)
}

function activation(memory: SemanticMemory, mode: ActivationMode, source: 'project' | 'global'): MemoryActivation {
  return {
    id: activationId(memory.id, mode, source),
    memoryId: memory.id,
    confidenceTier: memory.confidenceTier as ConfidenceTier,
    activationMode: mode,
    text: activationText(memory, mode),
    triggerReason: triggerReason(memory),
    source,
    risk: riskForMemory(memory)
  }
}

function activationText(memory: SemanticMemory, mode: ActivationMode): string {
  if (mode === 'workflow_hint') return memory.content
  if (mode === 'plan_constraint') return `Plan constraint: ${memory.content}`
  if (mode === 'checklist_item') return `Verify: ${memory.content}`
  return memory.content
}

function triggerReason(memory: SemanticMemory): string {
  const firstBoundary = memory.useWhen[0] ?? memory.content
  return `Matched memory content/useWhen: ${firstBoundary}`
}

function matchesActivationTrigger(memory: SemanticMemory, query: string): boolean {
  const queryTokens = new Set(tokens(query))
  if (queryTokens.size === 0) return false
  const haystack = tokens([memory.content, ...memory.useWhen].join(' '))
  return haystack.some((token) => queryTokens.has(token))
}

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9_\u4e00-\u9fff]+/u).map((token) => token.trim()).filter((token) => token.length >= 2)
}

function riskForMemory(memory: SemanticMemory): 'low' | 'medium' | 'high' {
  const sensitivity = memory.reviewState?.scores?.sensitivity ?? 0.2
  if (['personal', 'relationship', 'affective'].includes(memory.domain) || sensitivity > 0.6) return 'high'
  if (sensitivity > 0.35) return 'medium'
  return 'low'
}

function activationId(memoryId: string, mode: ActivationMode, source: string): string {
  return createHash('sha256').update(`${memoryId}:${mode}:${source}`).digest('hex').slice(0, 16)
}

function pushLimited<T>(items: T[], item: T, max: number): void {
  if (items.length < max) items.push(item)
}
```

- [ ] **Step 4: Add activation output to continuity context**

Modify `src/codex/continuity-context.ts`:

1. Import `buildMemoryActivations` and `MemoryActivation`.
2. Add to `CodexContinuityContext`:

```ts
  activation: {
    workflowHints: MemoryActivation[]
    planConstraints: MemoryActivation[]
    checklistItems: MemoryActivation[]
  }
```

3. After `const activeMemory = ...`, compute:

```ts
  const activation = buildMemoryActivations({
    query: input.userMessage,
    globalMemories: routedMemory.globalMemory.map((item) => item.memory),
    projectMemories: routedMemory.projectMemory.map((item) => item.memory)
  })
```

4. Include `activation` in returned object.

- [ ] **Step 5: Extend continuity integration test**

In `tests/codex-continuity-context.test.ts`, add a test that writes `semantic_memories.jsonl` with an active project `trial` and asserts:

```ts
expect(context.activation.workflowHints).toEqual([
  expect.objectContaining({ memoryId: 'trial-memory', activationMode: 'workflow_hint' })
])
expect(context.activation.planConstraints).toEqual([])
expect(context.activation.checklistItems).toEqual([])
```

Add a second memory with `validated` and assert constraints/checklist appear.

- [ ] **Step 6: Run task tests**

```bash
npm test -- tests/codex-memory-activation.test.ts tests/codex-continuity-context.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/codex/memory-activation.ts src/codex/continuity-context.ts tests/codex-memory-activation.test.ts tests/codex-continuity-context.test.ts
git commit -m "feat: activate v1.5 memory in continuity context"
```

## Task 4: Explicit Usage Feedback Events

**Parallelism:** Wave 2. Can run in parallel with Tasks 2 and 3 after Task 1. Owns feedback helpers.

**Files:**

- Modify: `src/codex/memory-feedback.ts`
- Test: `tests/codex-memory-feedback.test.ts`
- Extend if needed: `tests/semantic-memory-v2-store.test.ts`

- [ ] **Step 1: Write failing feedback tests**

Create `tests/codex-memory-feedback.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendActivationEventFailOpen,
  appendActivationEventsFailOpen
} from '../src/codex/memory-feedback.js'
import { readActivationEventsFromRoot } from '../src/memory/memory-store.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('memory feedback events', () => {
  it('records explicit applied events with activationId and reason', async () => {
    const root = await createTempDir('cyrene-feedback-root-')

    await appendActivationEventFailOpen({
      memoryRoot: root,
      memoryId: 'memory-1',
      projectId: 'project-1',
      query: 'runtime verification',
      event: 'applied',
      activationId: 'activation-1',
      reason: 'Checklist item was completed before final response.',
      evidenceRef: 'test:1',
      now: '2026-06-03T00:00:00.000Z'
    })

    expect(await readActivationEventsFromRoot(root)).toEqual([
      expect.objectContaining({
        memoryId: 'memory-1',
        event: 'applied',
        activationId: 'activation-1',
        reason: 'Checklist item was completed before final response.',
        evidenceRef: 'test:1'
      })
    ])
  })

  it('keeps batched retrieved event behavior', async () => {
    const root = await createTempDir('cyrene-feedback-batch-root-')

    await appendActivationEventsFailOpen({
      memoryRoot: root,
      memoryIds: ['memory-2', 'memory-1', 'memory-1'],
      projectId: 'project-1',
      query: 'query',
      event: 'retrieved',
      now: '2026-06-03T00:00:00.000Z'
    })

    expect((await readActivationEventsFromRoot(root)).map((event) => event.memoryId)).toEqual(['memory-1', 'memory-2'])
  })
})
```

- [ ] **Step 2: Run failing feedback tests**

```bash
npm test -- tests/codex-memory-feedback.test.ts
```

Expected: fail because `appendActivationEventFailOpen` and extended event fields do not exist.

- [ ] **Step 3: Implement explicit feedback helper**

Modify `src/codex/memory-feedback.ts`:

```ts
export async function appendActivationEventFailOpen(input: {
  memoryRoot: string
  memoryId: string
  projectId?: string
  query?: string
  event: ActivationEventType
  activationId?: string
  reason?: string
  evidenceRef?: string
  now?: string
}): Promise<void> {
  try {
    const createdAt = input.now ?? new Date().toISOString()
    const queryHash = input.query === undefined
      ? undefined
      : createHash('sha256').update(input.query).digest('hex').slice(0, 16)
    await appendActivationEventFromRoot(input.memoryRoot, {
      id: randomUUID(),
      memoryId: input.memoryId,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(queryHash === undefined ? {} : { queryHash }),
      event: input.event,
      ...(input.activationId === undefined ? {} : { activationId: input.activationId }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.evidenceRef === undefined ? {} : { evidenceRef: input.evidenceRef }),
      createdAt
    })
  } catch {
    // Continuity context and runtime feedback must not fail because advisory logging failed.
  }
}
```

Update `appendActivationEventsFailOpen` internals to call the single-event helper or include `activationId` / `reason` fields when provided.

- [ ] **Step 4: Run task tests**

```bash
npm test -- tests/codex-memory-feedback.test.ts tests/codex-continuity-context.test.ts tests/semantic-memory-v2-store.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/codex/memory-feedback.ts tests/codex-memory-feedback.test.ts tests/semantic-memory-v2-store.test.ts
git commit -m "feat: record explicit memory usage feedback"
```

## Task 5: Daily Trial Validation Automation

**Parallelism:** Wave 3. Depends on Task 1 and Task 4. Can run in parallel with Task 6 because this task must not edit `src/codex/codex-cli.ts`.

**Files:**

- Create: `src/codex/codex-memory-lifecycle-daily.ts`
- Test: `tests/codex-memory-lifecycle-daily.test.ts`
- Do not modify: `src/codex/codex-cli.ts`

- [ ] **Step 1: Write failing daily automation tests**

Create `tests/codex-memory-lifecycle-daily.test.ts` with:

```ts
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCodexMemoryLifecycleDaily } from '../src/codex/codex-memory-lifecycle-daily.js'
import { appendActivationEventFromRoot, readMemoryEventsFromRoot, readSemanticMemoriesFromRoot, writeSemanticMemoriesFromRoot } from '../src/memory/memory-store.js'
import { activationPolicyForConfidenceTier } from '../src/memory/memory-lifecycle.js'
import type { SemanticMemory } from '../src/memory/types.js'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function trialMemory(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  return {
    id: 'trial-1',
    status: 'active',
    module: 'procedural',
    kind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    content: 'Chunk long review summaries before retrying.',
    useWhen: ['Review summary generation'],
    doNotUseWhen: ['Short summaries'],
    evidence: [{ id: 'evidence-1', sourceKind: 'review_event', sourceRef: 'review:1', whatHappened: 'Timeout happened.', whyImportant: 'Chunking prevents repeated failures.' }],
    reviewPolicy: 'pending_review',
    supersedes: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    confidenceTier: 'trial',
    activationPolicy: activationPolicyForConfidenceTier('trial'),
    reviewState: { scores: { evidenceStrength: 0.85, stability: 0.8, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 } },
    ...overrides
  }
}

describe('daily trial validation job', () => {
  it('promotes low-risk project trial to validated after two applied events', async () => {
    const root = await createTempDir('cyrene-daily-root-')
    await mkdir(root, { recursive: true })
    await writeSemanticMemoriesFromRoot(root, [trialMemory()])
    await appendActivationEventFromRoot(root, { id: 'event-1', memoryId: 'trial-1', event: 'applied', projectId: 'project-1', createdAt: '2026-06-02T00:00:00.000Z' })
    await appendActivationEventFromRoot(root, { id: 'event-2', memoryId: 'trial-1', event: 'applied', projectId: 'project-1', createdAt: '2026-06-03T00:00:00.000Z' })

    const result = await runCodexMemoryLifecycleDaily({ projectRoots: [{ projectId: 'project-1', memoryRoot: root }], apply: true, now: '2026-06-03T00:00:00.000Z' })

    expect(result.roots[0]).toMatchObject({ promotedTrialToValidated: 1, recommendations: 0 })
    expect(await readSemanticMemoriesFromRoot(root)).toEqual([
      expect.objectContaining({
        id: 'trial-1',
        confidenceTier: 'validated',
        activationPolicy: { allowedModes: ['workflow_hint', 'plan_constraint', 'checklist_item'], maxRuntimeStrength: 'checklist' }
      })
    ])
    expect((await readMemoryEventsFromRoot(root)).map((event) => event.action)).toContain('promote')
  })

  it('blocks promotion when corrected or violated feedback exists', async () => {
    const root = await createTempDir('cyrene-daily-negative-root-')
    await writeSemanticMemoriesFromRoot(root, [trialMemory()])
    await appendActivationEventFromRoot(root, { id: 'event-1', memoryId: 'trial-1', event: 'applied', projectId: 'project-1', createdAt: '2026-06-02T00:00:00.000Z' })
    await appendActivationEventFromRoot(root, { id: 'event-2', memoryId: 'trial-1', event: 'applied', projectId: 'project-1', createdAt: '2026-06-03T00:00:00.000Z' })
    await appendActivationEventFromRoot(root, { id: 'event-3', memoryId: 'trial-1', event: 'corrected', projectId: 'project-1', createdAt: '2026-06-03T00:00:01.000Z' })

    const result = await runCodexMemoryLifecycleDaily({ projectRoots: [{ projectId: 'project-1', memoryRoot: root }], apply: true, now: '2026-06-03T00:00:00.000Z' })

    expect(result.roots[0]).toMatchObject({ promotedTrialToValidated: 0, recommendations: 1 })
    expect((await readSemanticMemoriesFromRoot(root))[0].confidenceTier).toBe('trial')
  })
})
```

- [ ] **Step 2: Run failing daily tests**

```bash
npm test -- tests/codex-memory-lifecycle-daily.test.ts
```

Expected: fail because daily module does not exist.

- [ ] **Step 3: Implement daily job**

Create `src/codex/codex-memory-lifecycle-daily.ts`:

```ts
import { randomUUID } from 'node:crypto'
import {
  activationPolicyForConfidenceTier,
  isLowRiskLifecycleMemory
} from '../memory/memory-lifecycle.js'
import {
  appendMemoryEventFromRoot,
  readActivationEventsFromRoot,
  readSemanticMemoriesFromRoot,
  writeSemanticMemoriesFromRoot
} from '../memory/memory-store.js'
import type { ActivationEvent, SemanticMemory } from '../memory/types.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot, getReadableCodexProjectMemoryRoots } from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'

export interface LifecycleRootInput { projectId?: string; memoryRoot: string }
export interface DailyLifecycleRootResult {
  memoryRoot: string
  projectId?: string
  promotedTrialToValidated: number
  recommendations: number
  staleTrials: number
}
export interface DailyLifecycleResult {
  action: 'memory_lifecycle_daily'
  dryRun: boolean
  roots: DailyLifecycleRootResult[]
}

export async function runCodexMemoryLifecycleDaily(input: {
  cwd?: string
  projectRoots?: LifecycleRootInput[]
  includeGlobalRoot?: boolean
  apply?: boolean
  now?: string
}): Promise<DailyLifecycleResult> {
  const dryRun = input.apply !== true
  const now = input.now ?? new Date().toISOString()
  const roots = input.projectRoots ?? await defaultProjectRoots(input.cwd)
  const results: DailyLifecycleRootResult[] = []
  for (const root of roots) results.push(await runDailyForRoot(root, dryRun, now))
  if (input.includeGlobalRoot === true) {
    results.push(await runDailyForRoot({ memoryRoot: codexGlobalMemoryRoot() }, dryRun, now))
  }
  return { action: 'memory_lifecycle_daily', dryRun, roots: results }
}

async function runDailyForRoot(root: LifecycleRootInput, dryRun: boolean, now: string): Promise<DailyLifecycleRootResult> {
  const [memories, events] = await Promise.all([
    readSemanticMemoriesFromRoot(root.memoryRoot),
    readActivationEventsFromRoot(root.memoryRoot)
  ])
  const next: SemanticMemory[] = []
  let promotedTrialToValidated = 0
  let recommendations = 0
  let staleTrials = 0
  for (const memory of memories) {
    if (memory.status !== 'active' || memory.confidenceTier !== 'trial') {
      next.push(memory)
      continue
    }
    if (memory.expiresAt !== undefined && memory.expiresAt <= now) {
      staleTrials += 1
      next.push(memory)
      continue
    }
    const stats = eventStats(memory.id, events)
    if (stats.negative > 0) {
      recommendations += 1
      next.push(memory)
      continue
    }
    if (isLowRiskLifecycleMemory(memory) && stats.applied >= 2) {
      promotedTrialToValidated += 1
      next.push({ ...memory, confidenceTier: 'validated', activationPolicy: activationPolicyForConfidenceTier('validated'), updatedAt: now })
      continue
    }
    next.push(memory)
  }
  if (!dryRun) {
    await writeSemanticMemoriesFromRoot(root.memoryRoot, next)
    for (let index = 0; index < promotedTrialToValidated; index += 1) {
      await appendMemoryEventFromRoot(root.memoryRoot, {
        id: randomUUID(),
        action: 'promote',
        at: now,
        reason: 'v1.5 daily trial validation promoted trial to validated',
        details: { policyId: 'daily_trial_validation_v1' }
      })
    }
    if (recommendations > 0) {
      await appendMemoryEventFromRoot(root.memoryRoot, {
        id: randomUUID(),
        action: 'audit',
        at: now,
        reason: 'v1.5 daily trial validation generated review recommendations',
        details: { recommendations }
      })
    }
  }
  return { memoryRoot: root.memoryRoot, projectId: root.projectId, promotedTrialToValidated, recommendations, staleTrials }
}

function eventStats(memoryId: string, events: ActivationEvent[]): { applied: number; negative: number } {
  const memoryEvents = events.filter((event) => event.memoryId === memoryId)
  return {
    applied: memoryEvents.filter((event) => event.event === 'applied').length,
    negative: memoryEvents.filter((event) => event.event === 'corrected' || event.event === 'violated').length
  }
}

async function defaultProjectRoots(cwd: string | undefined): Promise<LifecycleRootInput[]> {
  if (cwd !== undefined) {
    const project = await identifyCodexProject(cwd)
    return [{ projectId: project.projectId, memoryRoot: codexProjectMemoryRoot(project.projectId) }]
  }
  return (await getReadableCodexProjectMemoryRoots()).map((memoryRoot) => ({ memoryRoot }))
}
```

- [ ] **Step 4: Confirm coordinator integration surface**

Do not edit `src/codex/codex-cli.ts` in this task. Keep this exported function signature stable for Coordinator Step A:

```ts
export async function runCodexMemoryLifecycleDaily(input: {
  cwd?: string
  projectRoots?: LifecycleRootInput[]
  includeGlobalRoot?: boolean
  apply?: boolean
  now?: string
}): Promise<DailyLifecycleResult>
```

- [ ] **Step 5: Run task tests**

```bash
npm test -- tests/codex-memory-lifecycle-daily.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/codex/codex-memory-lifecycle-daily.ts tests/codex-memory-lifecycle-daily.test.ts
git commit -m "feat: add daily memory lifecycle validation"
```

## Task 6: Weekly Project Core And Global Consolidation

**Parallelism:** Wave 3. Depends on Task 1 and Task 4. Can run in parallel with Task 5 because this task must not edit `src/codex/codex-cli.ts`.

**Files:**

- Create: `src/codex/codex-memory-lifecycle-weekly.ts`
- Create: `src/codex/memory-lifecycle-profile.ts`
- Test: `tests/codex-memory-lifecycle-weekly.test.ts`
- Do not modify: `src/codex/codex-cli.ts`

- [ ] **Step 1: Write failing weekly tests**

Create `tests/codex-memory-lifecycle-weekly.test.ts` with assertions:

```ts
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCodexMemoryLifecycleWeekly } from '../src/codex/codex-memory-lifecycle-weekly.js'
import { activationPolicyForConfidenceTier } from '../src/memory/memory-lifecycle.js'
import { appendActivationEventFromRoot, readSemanticMemoriesFromRoot, writeSemanticMemoriesFromRoot } from '../src/memory/memory-store.js'
import type { SemanticMemory } from '../src/memory/types.js'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function validatedMemory(id: string, content = 'Run runtime verification before declaring implementation complete.'): SemanticMemory {
  return {
    id,
    status: 'active',
    module: 'procedural',
    kind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    content,
    useWhen: ['Completing implementation work'],
    doNotUseWhen: ['Read-only review'],
    evidence: [{ id: `evidence-${id}`, sourceKind: 'review_event', sourceRef: `review:${id}`, whatHappened: 'The rule was applied.', whyImportant: 'It changes completion behavior.' }],
    reviewPolicy: 'pending_review',
    supersedes: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    confidenceTier: 'validated',
    activationPolicy: activationPolicyForConfidenceTier('validated'),
    reviewState: { scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 } }
  }
}

describe('weekly core and global consolidation job', () => {
  it('promotes validated project memory to project_core and renders project profile', async () => {
    const root = await createTempDir('cyrene-weekly-project-root-')
    await writeSemanticMemoriesFromRoot(root, [validatedMemory('validated-1')])
    await appendActivationEventFromRoot(root, { id: 'event-1', memoryId: 'validated-1', event: 'applied', projectId: 'project-1', evidenceRef: 'session:1', createdAt: '2026-06-02T00:00:00.000Z' })
    await appendActivationEventFromRoot(root, { id: 'event-2', memoryId: 'validated-1', event: 'applied', projectId: 'project-1', evidenceRef: 'session:2', createdAt: '2026-06-03T00:00:00.000Z' })

    const result = await runCodexMemoryLifecycleWeekly({
      projectRoots: [{ projectId: 'project-1', memoryRoot: root }],
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    expect(result.projectRoots[0]).toMatchObject({ promotedValidatedToProjectCore: 1 })
    expect((await readSemanticMemoriesFromRoot(root))[0]).toMatchObject({ confidenceTier: 'project_core' })
    expect(await readFile(join(root, 'MODEL_PROFILE.md'), 'utf8')).toContain('Run runtime verification before declaring implementation complete.')
  })

  it('consolidates repeated project_core memory into global_core', async () => {
    const projectA = await createTempDir('cyrene-weekly-project-a-')
    const projectB = await createTempDir('cyrene-weekly-project-b-')
    const globalRoot = await createTempDir('cyrene-weekly-global-')
    await mkdir(globalRoot, { recursive: true })
    await writeSemanticMemoriesFromRoot(projectA, [{ ...validatedMemory('core-a'), confidenceTier: 'project_core', activationPolicy: activationPolicyForConfidenceTier('project_core') }])
    await writeSemanticMemoriesFromRoot(projectB, [{ ...validatedMemory('core-b'), confidenceTier: 'project_core', activationPolicy: activationPolicyForConfidenceTier('project_core') }])

    const result = await runCodexMemoryLifecycleWeekly({
      projectRoots: [{ projectId: 'a', memoryRoot: projectA }, { projectId: 'b', memoryRoot: projectB }],
      globalRoot,
      apply: true,
      now: '2026-06-03T00:00:00.000Z'
    })

    expect(result.global).toMatchObject({ promotedToGlobalCore: 1 })
    expect(await readSemanticMemoriesFromRoot(globalRoot)).toEqual([
      expect.objectContaining({ scope: 'global', confidenceTier: 'global_core' })
    ])
    expect(await readFile(join(globalRoot, 'MODEL_PROFILE.md'), 'utf8')).toContain('Run runtime verification before declaring implementation complete.')
  })
})
```

- [ ] **Step 2: Run failing weekly tests**

```bash
npm test -- tests/codex-memory-lifecycle-weekly.test.ts
```

Expected: fail because weekly/profile modules do not exist.

- [ ] **Step 3: Implement profile renderer**

Create `src/codex/memory-lifecycle-profile.ts`:

```ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SemanticMemory } from '../memory/types.js'

const MODEL_PROFILE_FILE = 'MODEL_PROFILE.md'

export async function writeLifecycleProfileFromCoreMemory(input: {
  memoryRoot: string
  scope: 'project' | 'global'
  memories: SemanticMemory[]
}): Promise<string> {
  const coreTier = input.scope === 'global' ? 'global_core' : 'project_core'
  const lines = [
    '<!-- Generated by Cyrene Continuity v1.5. Do not edit manually. -->',
    '',
    '# Cyrene Model Profile',
    '',
    '## Always Apply',
    ''
  ]
  const core = input.memories
    .filter((memory) => memory.status === 'active' && memory.confidenceTier === coreTier)
    .filter((memory) => ['project', 'procedural', 'system'].includes(memory.domain))
    .sort((left, right) => left.id.localeCompare(right.id))
  if (core.length === 0) {
    lines.push('- None.')
  } else {
    for (const memory of core) lines.push(`- ${memory.content}`)
  }
  lines.push('')
  const content = `${lines.join('\n')}\n`
  await writeFile(join(input.memoryRoot, MODEL_PROFILE_FILE), content, 'utf8')
  return content
}
```

- [ ] **Step 4: Implement weekly job**

Create `src/codex/codex-memory-lifecycle-weekly.ts` with:

```ts
import { createHash, randomUUID } from 'node:crypto'
import {
  activationPolicyForConfidenceTier,
  isLowRiskLifecycleMemory
} from '../memory/memory-lifecycle.js'
import {
  appendMemoryEventFromRoot,
  readActivationEventsFromRoot,
  readSemanticMemoriesFromRoot,
  writeSemanticMemoriesFromRoot
} from '../memory/memory-store.js'
import type { ActivationEvent, SemanticMemory } from '../memory/types.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot, getReadableCodexProjectMemoryRoots } from './codex-memory-root.js'
import { writeLifecycleProfileFromCoreMemory } from './memory-lifecycle-profile.js'
import { identifyCodexProject } from './project-id.js'

export interface WeeklyProjectRootInput { projectId?: string; memoryRoot: string }
export interface WeeklyProjectRootResult { memoryRoot: string; projectId?: string; promotedValidatedToProjectCore: number; recommendations: number }
export interface WeeklyGlobalResult { memoryRoot: string; promotedToGlobalCore: number; recommendations: number }
export interface WeeklyLifecycleResult { action: 'memory_lifecycle_weekly'; dryRun: boolean; projectRoots: WeeklyProjectRootResult[]; global: WeeklyGlobalResult }

export async function runCodexMemoryLifecycleWeekly(input: {
  cwd?: string
  projectRoots?: WeeklyProjectRootInput[]
  globalRoot?: string
  apply?: boolean
  now?: string
}): Promise<WeeklyLifecycleResult> {
  const dryRun = input.apply !== true
  const now = input.now ?? new Date().toISOString()
  const projectRoots = input.projectRoots ?? await defaultProjectRoots(input.cwd)
  const projectResults: WeeklyProjectRootResult[] = []
  const projectCoreMemories: Array<{ projectId?: string; memory: SemanticMemory }> = []
  for (const root of projectRoots) {
    const result = await runProjectWeekly(root, dryRun, now)
    projectResults.push(result.result)
    projectCoreMemories.push(...result.coreMemories.map((memory) => ({ projectId: root.projectId, memory })))
  }
  const global = await runGlobalWeekly(input.globalRoot ?? codexGlobalMemoryRoot(), projectCoreMemories, dryRun, now)
  return { action: 'memory_lifecycle_weekly', dryRun, projectRoots: projectResults, global }
}

async function runProjectWeekly(root: WeeklyProjectRootInput, dryRun: boolean, now: string): Promise<{ result: WeeklyProjectRootResult; coreMemories: SemanticMemory[] }> {
  const [memories, events] = await Promise.all([
    readSemanticMemoriesFromRoot(root.memoryRoot),
    readActivationEventsFromRoot(root.memoryRoot)
  ])
  const next = memories.map((memory) => {
    if (memory.status !== 'active' || memory.confidenceTier !== 'validated') return memory
    const stats = eventStats(memory.id, events)
    if (!isLowRiskLifecycleMemory(memory) || stats.distinctAppliedContexts < 2 || stats.negative > 0) return memory
    return { ...memory, confidenceTier: 'project_core' as const, activationPolicy: activationPolicyForConfidenceTier('project_core'), updatedAt: now }
  })
  const promotedValidatedToProjectCore = next.filter((memory, index) => memory.confidenceTier === 'project_core' && memories[index]?.confidenceTier === 'validated').length
  const recommendations = memories.filter((memory) => memory.confidenceTier === 'validated' && eventStats(memory.id, events).negative > 0).length
  if (!dryRun) {
    await writeSemanticMemoriesFromRoot(root.memoryRoot, next)
    await writeLifecycleProfileFromCoreMemory({ memoryRoot: root.memoryRoot, scope: 'project', memories: next })
    if (promotedValidatedToProjectCore > 0) {
      await appendMemoryEventFromRoot(root.memoryRoot, { id: randomUUID(), action: 'promote', at: now, reason: 'v1.5 weekly promoted validated memory to project_core', details: { policyId: 'weekly_project_core_v1', promotedValidatedToProjectCore } })
    }
  }
  return {
    result: { memoryRoot: root.memoryRoot, projectId: root.projectId, promotedValidatedToProjectCore, recommendations },
    coreMemories: next.filter((memory) => memory.status === 'active' && memory.confidenceTier === 'project_core')
  }
}

async function runGlobalWeekly(globalRoot: string, projectCoreMemories: Array<{ projectId?: string; memory: SemanticMemory }>, dryRun: boolean, now: string): Promise<WeeklyGlobalResult> {
  const existing = await readSemanticMemoriesFromRoot(globalRoot)
  const candidates = globalCandidates(projectCoreMemories, now)
  const next = upsertByContent(existing, candidates)
  const promotedToGlobalCore = next.length - existing.length
  if (!dryRun) {
    await writeSemanticMemoriesFromRoot(globalRoot, next)
    await writeLifecycleProfileFromCoreMemory({ memoryRoot: globalRoot, scope: 'global', memories: next })
    if (promotedToGlobalCore > 0) {
      await appendMemoryEventFromRoot(globalRoot, { id: randomUUID(), action: 'promote', at: now, reason: 'v1.5 weekly consolidated project_core memory into global_core', details: { policyId: 'weekly_global_core_v1', promotedToGlobalCore } })
    }
  }
  return { memoryRoot: globalRoot, promotedToGlobalCore, recommendations: 0 }
}

function globalCandidates(projectCoreMemories: Array<{ projectId?: string; memory: SemanticMemory }>, now: string): SemanticMemory[] {
  const groups = new Map<string, Array<{ projectId?: string; memory: SemanticMemory }>>()
  for (const item of projectCoreMemories) {
    if (!isLowRiskLifecycleMemory(item.memory)) continue
    const key = normalizeContent(item.memory.content)
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.values()]
    .filter((items) => new Set(items.map((item) => item.projectId ?? item.memory.id)).size >= 2)
    .map((items) => {
      const base = items[0].memory
      return {
        ...base,
        id: `global-${createHash('sha256').update(normalizeContent(base.content)).digest('hex').slice(0, 16)}`,
        scope: 'global',
        confidenceTier: 'global_core',
        activationPolicy: activationPolicyForConfidenceTier('global_core'),
        evidence: items.flatMap((item) => item.memory.evidence),
        createdAt: now,
        updatedAt: now
      }
    })
}

function eventStats(memoryId: string, events: ActivationEvent[]): { distinctAppliedContexts: number; negative: number } {
  const memoryEvents = events.filter((event) => event.memoryId === memoryId)
  return {
    distinctAppliedContexts: new Set(memoryEvents.filter((event) => event.event === 'applied').map((event) => event.evidenceRef ?? event.createdAt)).size,
    negative: memoryEvents.filter((event) => event.event === 'corrected' || event.event === 'violated').length
  }
}

function normalizeContent(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim()
}

function upsertByContent(existing: SemanticMemory[], candidates: SemanticMemory[]): SemanticMemory[] {
  const existingContent = new Set(existing.map((memory) => normalizeContent(memory.content)))
  return [...existing, ...candidates.filter((candidate) => !existingContent.has(normalizeContent(candidate.content)))]
}

async function defaultProjectRoots(cwd: string | undefined): Promise<WeeklyProjectRootInput[]> {
  if (cwd !== undefined) {
    const project = await identifyCodexProject(cwd)
    return [{ projectId: project.projectId, memoryRoot: codexProjectMemoryRoot(project.projectId) }]
  }
  return (await getReadableCodexProjectMemoryRoots()).map((memoryRoot) => ({ memoryRoot }))
}
```

- [ ] **Step 5: Confirm coordinator integration surface**

Do not edit `src/codex/codex-cli.ts` in this task. Keep this exported function signature stable for Coordinator Step A:

```ts
export async function runCodexMemoryLifecycleWeekly(input: {
  cwd?: string
  projectRoots?: WeeklyProjectRootInput[]
  globalRoot?: string
  apply?: boolean
  now?: string
}): Promise<WeeklyLifecycleResult>
```

- [ ] **Step 6: Run task tests**

```bash
npm test -- tests/codex-memory-lifecycle-weekly.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/codex/codex-memory-lifecycle-weekly.ts src/codex/memory-lifecycle-profile.ts tests/codex-memory-lifecycle-weekly.test.ts
git commit -m "feat: add weekly memory core consolidation"
```

## Coordinator Step A: Lifecycle Automation CLI Integration

**Parallelism:** Run in the controller session only, after Tasks 5 and 6 pass. Do not dispatch this as a parallel worker because it intentionally merges both automation routes into the shared CLI file.

**Files:**

- Modify: `src/codex/codex-cli.ts`
- Modify: `src/codex/codex-memory-lifecycle-daily.ts`
- Modify: `src/codex/codex-memory-lifecycle-weekly.ts`
- Modify: `tests/codex-cli.test.ts`

- [ ] **Step 1: Add failing CLI usage and route tests**

Extend the existing usage test in `tests/codex-cli.test.ts` with:

```ts
expect(stderr).toContain('memory lifecycle daily [--dry-run|--apply] [--all-projects]')
expect(stderr).toContain('memory lifecycle weekly [--dry-run|--apply] [--all-projects]')
```

Add a route smoke test near the existing `memory migrate-v2` CLI tests:

```ts
  it('runs v1.5 lifecycle automation commands from the CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-lifecycle-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-lifecycle-repo-')
    await identifyCodexProject(repo)

    const daily = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'lifecycle', 'daily', '--dry-run'],
      { env: cliEnv(home) }
    )
    const weekly = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'lifecycle', 'weekly', '--dry-run'],
      { env: cliEnv(home) }
    )

    expect(daily.stderr).toBe('')
    expect(JSON.parse(daily.stdout).action).toBe('memory_lifecycle_daily')
    expect(weekly.stderr).toBe('')
    expect(JSON.parse(weekly.stdout).action).toBe('memory_lifecycle_weekly')
  })
```

- [ ] **Step 2: Run failing CLI tests**

```bash
npm test -- tests/codex-cli.test.ts
```

Expected: fail because the usage text and lifecycle routes are not registered.

- [ ] **Step 3: Register both automation routes**

Modify `src/codex/codex-cli.ts` imports:

```ts
import { runCodexMemoryLifecycleDaily } from './codex-memory-lifecycle-daily.js'
import { runCodexMemoryLifecycleWeekly } from './codex-memory-lifecycle-weekly.js'
```

Add both routes before `memory status`:

```ts
  if (command === 'memory' && input.args[1] === 'lifecycle' && input.args[2] === 'daily') {
    if (input.args.includes('--dry-run') && input.args.includes('--apply')) {
      throw new Error('memory lifecycle daily accepts only one of --dry-run or --apply')
    }
    process.stdout.write(`${JSON.stringify(await runCodexMemoryLifecycleDaily({
      cwd: input.cwd,
      allProjects: input.args.includes('--all-projects'),
      includeGlobalRoot: true,
      apply: input.args.includes('--apply')
    }), null, 2)}\n`)
    return
  }

  if (command === 'memory' && input.args[1] === 'lifecycle' && input.args[2] === 'weekly') {
    if (input.args.includes('--dry-run') && input.args.includes('--apply')) {
      throw new Error('memory lifecycle weekly accepts only one of --dry-run or --apply')
    }
    process.stdout.write(`${JSON.stringify(await runCodexMemoryLifecycleWeekly({
      cwd: input.cwd,
      allProjects: input.args.includes('--all-projects'),
      apply: input.args.includes('--apply')
    }), null, 2)}\n`)
    return
  }
```

Update the usage string to include:

```txt
memory lifecycle daily [--dry-run|--apply] [--all-projects]|memory lifecycle weekly [--dry-run|--apply] [--all-projects]
```

- [ ] **Step 4: Run CLI and automation tests**

```bash
npm test -- tests/codex-cli.test.ts tests/codex-memory-lifecycle-daily.test.ts tests/codex-memory-lifecycle-weekly.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 5: Commit Coordinator Step A**

```bash
git add src/codex/codex-cli.ts tests/codex-cli.test.ts
git commit -m "feat: expose v1.5 memory lifecycle automation commands"
```

## Task 7: Memory Output Quality Gate

**Parallelism:** Wave 4. Runs after Tasks 2-6 because it validates generated outputs.

**Files:**

- Modify: `src/codex/memory-quality-contract.ts`
- Modify: `tests/memory-quality-contract.test.ts`
- Modify if release eval is wired: `src/eval/eval-runner.ts`, `tests/codex-eval.test.ts`

- [ ] **Step 1: Write failing quality gate tests**

Extend `tests/memory-quality-contract.test.ts`:

```ts
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

    expect(fixtureById('old_review_summary_noise').mustNotOutcome).toEqual(expect.arrayContaining(['project_trial', 'active', 'profile']))
    expect(fixtureById('trial_applied_twice').expectedOutput).toContain('validated')
    expect(fixtureById('explicit_all_projects_instruction').expectedOutput).toContain('global_core')
    expect(fixtureById('affective_inferred_pattern_v1_5').expectedPolicy).toBe('manual_only')
    expect(fixtureById('project_specific_global_candidate').mustNotOutcome).toContain('global_core')
    expect(fixtureById('core_profile_generation').expectedOutput).toContain('profile contains only core memory')
  })
```

- [ ] **Step 2: Run failing quality tests**

```bash
npm test -- tests/memory-quality-contract.test.ts
```

Expected: fail because new fixture ids and forbidden outcomes do not exist.

- [ ] **Step 3: Extend quality contract types**

Modify `src/codex/memory-quality-contract.ts`:

1. Add required fixture ids:

```ts
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
```

2. Extend `MemoryQualityClassification` with:

```ts
  | 'project_trial'
  | 'validated_memory'
  | 'project_core'
  | 'global_core'
  | 'lifecycle_recommendation'
```

3. Extend `MemoryQualityModule` with:

```ts
  | 'lifecycle'
  | 'global_core'
  | 'profile'
```

4. Extend `MemoryQualityPolicy` with:

```ts
  | 'daily_trial_validation'
  | 'weekly_project_core'
  | 'weekly_global_consolidation'
```

5. Extend `MemoryQualityForbiddenOutcome` with:

```ts
  | 'project_trial'
  | 'validated'
  | 'project_core'
  | 'global_core'
  | 'profile'
  | 'trial_checklist'
  | 'high_risk_core'
  | 'core_without_evidence'
  | 'project_detail_global_core'
```

- [ ] **Step 4: Add v1.5 fixtures**

Append fixtures matching the spec:

```ts
{
  id: 'old_review_summary_noise',
  inputSignal: 'review summary ok: merged branch and deleted local branch',
  expectedClassification: 'episode_only',
  expectedModule: 'episode',
  expectedPolicy: 'no_memory_candidate',
  expectedOutput: 'Drop or archive as audit noise during v1.5 migration.',
  mustNotOutcome: ['project_trial', 'active', 'profile'],
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
  mustNotOutcome: ['active', 'profile', 'trial_checklist'],
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
  mustNotOutcome: ['global_core', 'profile'],
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
  mustNotOutcome: ['validated', 'project_core', 'global_core'],
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
  mustNotOutcome: ['global_core'],
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
  mustNotOutcome: ['project_core', 'global_core', 'profile'],
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
  mustNotOutcome: ['project_detail_global_core', 'high_risk_core'],
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
  mustNotOutcome: ['silent_drop'],
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
  mustNotOutcome: ['global_core', 'project_core', 'profile', 'auto_active'],
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
  mustNotOutcome: ['global_core', 'project_detail_global_core'],
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
  mustNotOutcome: ['trial_checklist', 'high_risk_core', 'core_without_evidence'],
  reviewNotes: 'Profile output is a release gate, not just a formatting artifact.',
  durableSignal: true,
  highRisk: false
}
```

- [ ] **Step 5: Strengthen validator checks**

Update `validateMemoryQualityFixtures()` to require:

- `old_review_summary_noise` forbids `project_trial` and `profile`.
- `trial_*` fixtures mention `validated` or recommendation in expected output.
- `global_core` fixtures forbid `project_detail_global_core`.
- high-risk fixtures forbid `project_core`, `global_core`, and `profile`.
- `core_profile_generation` expected output contains `profile contains only core memory`.

- [ ] **Step 6: Run quality tests**

```bash
npm test -- tests/memory-quality-contract.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 7: Run full verification**

```bash
npm run typecheck
npm test
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: all pass.

- [ ] **Step 8: Commit Task 7**

```bash
git add src/codex/memory-quality-contract.ts tests/memory-quality-contract.test.ts src/eval/eval-runner.ts tests/codex-eval.test.ts plugin/runtime/cyrene-continuity.mjs
git commit -m "test: add v1.5 memory output quality gate"
```

Only include `src/eval/eval-runner.ts` and `tests/codex-eval.test.ts` if release eval changed. Include `plugin/runtime/cyrene-continuity.mjs` only after `npm run build:plugin` changes it.

## Final Integration Checklist

- [ ] Run:

```bash
git status --short
```

Expected: clean after all task commits.

- [ ] Run:

```bash
npm run typecheck
npm test
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: all pass.

- [ ] Inspect final diff:

```bash
git log --oneline --max-count=10
git diff main...HEAD --stat
```

Expected: changes match the 7 tasks and do not touch `REVIEW_REPORT.md`.

- [ ] Final code review:

Dispatch one reviewer subagent over the full branch with this scope:

```txt
Review the full v1.5 memory lifecycle activation implementation against:
- docs/superpowers/specs/2026-06-03-cyrene-v1-5-memory-lifecycle-activation-design.md
- docs/superpowers/plans/2026-06-03-cyrene-v1-5-memory-lifecycle-activation.md

Prioritize bugs, missing spec coverage, unsafe auto-promotion, global/project tier confusion, profile pollution, and missing tests.
Return findings with file/line references.
```
