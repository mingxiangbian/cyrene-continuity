# Cyrene v1.5 Effective Memory Lifecycle Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the v1.5 lifecycle behave as designed: clean Trial admission, bilingual retrieval, runtime isolation, Memory Automation naming, and fixture-backed quality gates.

**Architecture:** Keep the existing semantic JSONL store as the source of truth and build on the current v1.5 `confidenceTier` model. Add one shared tokenizer, tighten admission decisions, expose a `context-preview` command, move public automation naming away from Dream, and validate behavior with concrete examples before public docs/UI cleanup.

**Tech Stack:** TypeScript, Vitest, Node.js 22+, existing Cyrene JSONL memory store, existing CLI/MCP/UI modules.

---

## File Map

- Create `src/memory/tokenizer.ts`: shared tokenizer, alias expansion, normalized key helper.
- Modify `src/memory/memory-retriever.ts`: remove local tokenizer and use shared tokenizer.
- Modify `src/memory/memory-index.ts`: remove local tokenizer and use shared tokenizer.
- Modify `src/codex/memory-activation.ts`: remove local tokenizer and use shared tokenizer.
- Modify `src/codex/memory-propose.ts`: route normalized key generation through shared tokenizer.
- Modify `src/codex/admission-gate.ts`: source-of-truth/changelog drop-only semantics and tombstone reason boundaries.
- Modify `src/memory/types.ts`: add admission reasons and tombstone reason codes needed by the spec.
- Modify `src/codex/admission-pipeline.ts`: keep drop-only decisions from writing review routing artifacts.
- Create `src/codex/memory-context-preview.ts`: runtime isolation preview.
- Modify `src/codex/codex-cli.ts`: add `memory context-preview`; replace public `memory dream` with `memory automation`.
- Create or modify MCP automation tool under `src/mcp/tools/`: expose `cyrene_memory_automation_run`.
- Modify `src/mcp/mcp-server.ts`: register automation tool and remove Dream public registration.
- Modify `src/codex/codex-memory-lifecycle-daily.ts`: daily should not promote global pending candidates.
- Modify `src/codex/codex-memory-lifecycle-weekly.ts`: weekly owns global candidate review/core consolidation.
- Modify README, plugin skill, and UI/static text after behavior tests pass.
- Tests:
  - Create `tests/memory-tokenizer.test.ts`.
  - Modify `tests/memory-retriever.test.ts`.
  - Modify `tests/memory-index.test.ts`.
  - Modify `tests/codex-memory-activation.test.ts`.
  - Modify `tests/codex-admission-gate.test.ts`.
  - Modify `tests/codex-admission-pipeline.test.ts`.
  - Create `tests/codex-memory-context-preview.test.ts`.
  - Modify `tests/codex-memory-lifecycle-daily.test.ts`.
  - Modify `tests/codex-memory-lifecycle-weekly.test.ts`.
  - Modify `tests/codex-cli.test.ts`.
  - Modify `tests/mcp-server.test.ts`.
  - Add final quality gate assertions in `tests/memory-quality-contract.test.ts` or a focused new test file.

## Multi-Agent Ownership

Use workers only with disjoint write sets:

- Worker A, Tokenizer: `src/memory/tokenizer.ts`, tokenizer-related tests, import swaps in retriever/index/activation.
- Worker B, Admission: `src/codex/admission-gate.ts`, `src/memory/types.ts`, admission tests.
- Worker C, Runtime Preview: `src/codex/memory-context-preview.ts`, CLI hook for `context-preview`, context-preview tests.
- Worker D, Automation/API/docs: public Dream -> Memory Automation naming, MCP/CLI help, README/skill/UI text.

Main controller owns shared registries and final integration: `src/codex/codex-cli.ts`, `src/mcp/mcp-server.ts`, generated plugin runtime, full verification.

## Task 1: Shared Tokenizer

**Files:**
- Create: `src/memory/tokenizer.ts`
- Modify: `src/memory/memory-retriever.ts`
- Modify: `src/memory/memory-index.ts`
- Modify: `src/codex/memory-activation.ts`
- Modify: `src/codex/memory-propose.ts`
- Test: `tests/memory-tokenizer.test.ts`
- Test: `tests/memory-retriever.test.ts`
- Test: `tests/codex-memory-activation.test.ts`

- [ ] **Step 1: Write failing tokenizer tests**

Create `tests/memory-tokenizer.test.ts` with assertions for:

```ts
import { describe, expect, it } from 'vitest'
import { normalizeMemoryKey, tokenizeMemoryText, tokenOverlapScore } from '../src/memory/tokenizer.js'

describe('memory tokenizer', () => {
  it('expands Chinese memory terms into English technical aliases', () => {
    const tokens = tokenizeMemoryText('多智能体审查')
    expect(tokens).toEqual(expect.arrayContaining(['多智能体', '审查', 'multi-agent', 'multi_agent', 'multiagent', 'review', 'audit']))
  })

  it.each([
    ['多智能体审查', 'multi-agent review'],
    ['仓库更新验证', 'repo update verification'],
    ['上下文污染', 'context pollution']
  ])('matches bilingual memory query %s -> %s', (left, right) => {
    expect(tokenOverlapScore(left, right)).toBeGreaterThan(0)
    expect(tokenOverlapScore(left, right)).toBeGreaterThanOrEqual(0.5)
  })

  it('builds stable normalized keys with alias-aware tokens', () => {
    expect(normalizeMemoryKey('多智能体审查')).toContain('multi-agent')
    expect(normalizeMemoryKey('repo update verification')).toContain('repo')
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- tests/memory-tokenizer.test.ts
```

Expected: fail because `src/memory/tokenizer.ts` does not exist.

- [ ] **Step 3: Implement tokenizer**

Create `src/memory/tokenizer.ts` with:

- `MEMORY_TOKEN_ALIASES`.
- `tokenizeMemoryText(text: string): string[]`.
- `tokenOverlapScore(left: string | string[], right: string | string[]): number`.
- `normalizeMemoryKey(text: string): string`.
- English technical token preservation.
- CJK 2-gram / 3-gram generation.
- stop-word filtering compatible with existing activation behavior.

- [ ] **Step 4: Replace local tokenizers**

Replace the local `tokenize()` implementations in:

- `src/memory/memory-retriever.ts`
- `src/memory/memory-index.ts`
- `src/codex/memory-activation.ts`

Use shared functions without changing unrelated scoring behavior.

- [ ] **Step 5: Add integration tests**

Add retrieval test:

```ts
it('retrieves English technical memory from Chinese query aliases', async () => {
  // Seed content: "Use multi-agent review before high-risk repo updates."
  // Query: "多智能体审查 仓库更新验证"
  // Expected first result id: "multi-agent-review"
})
```

Add activation test:

```ts
it('activates English technical memory from Chinese query aliases', () => {
  // Memory content/useWhen includes "multi-agent review"
  // Query includes "多智能体审查"
  // Expected: activation appears in workflowHints or constraints by tier.
})
```

- [ ] **Step 6: Run focused verification**

Run:

```bash
npm test -- tests/memory-tokenizer.test.ts tests/memory-retriever.test.ts tests/codex-memory-activation.test.ts
npm run typecheck
```

Expected: all pass.

## Task 2: Admission Routing Drop/Tombstone Semantics

**Files:**
- Modify: `src/memory/types.ts`
- Modify: `src/codex/admission-gate.ts`
- Modify: `src/codex/admission-pipeline.ts`
- Test: `tests/codex-admission-gate.test.ts`
- Test: `tests/codex-admission-pipeline.test.ts`

- [ ] **Step 1: Write failing admission tests**

Add tests that assert:

```ts
it('drops source-of-truth excerpts without routing to reference memory', () => {
  const decision = evaluateCandidateAdmission({
    draft: draft({
      content: '仓库工作规则：必须进行直接针对请求问题的精确更改（surgical changes）。',
      sourceKind: 'file',
      sourceOfTruth: 'AGENTS.md',
      evidenceRefs: ['AGENTS.md']
    }),
    pending: [],
    active: [],
    tombstones: [],
    now: '2026-06-04T00:00:00.000Z'
  })
  expect(decision.action).toBe('auto_drop')
  expect(decision.reasons).toEqual(expect.arrayContaining(['source_of_truth_excerpt']))
  expect(decision.reasons).not.toContain('source_of_truth_duplicate')
})

it('drops implementation changelog without rewrite or tombstone', () => {
  const decision = evaluateCandidateAdmission({
    draft: draft({
      content: '更新了 CLI、UI、MCP 和测试以支持 trial/validated/core memory lifecycle。',
      candidateKind: 'project_decision',
      sourceKind: 'review_summary',
      normalizedKey: 'updated-cli-ui-mcp-tests-lifecycle'
    }),
    pending: [],
    active: [],
    tombstones: [],
    now: '2026-06-04T00:00:00.000Z'
  })
  expect(decision.action).toBe('auto_drop')
  expect(decision.reasons).toContain('implementation_changelog')
})
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/codex-admission-gate.test.ts
```

Expected: new tests fail because current behavior returns `reference_only` or distillation.

- [ ] **Step 3: Update types**

Update `ADMISSION_REASONS` with:

- `source_of_truth_excerpt`
- `implementation_changelog`
- `repeated_duplicate`
- `wrong_abstraction`
- `obsolete`
- `user_rejected`

Update `MemoryTombstone.reason` to include new reason codes without breaking existing legacy values.

- [ ] **Step 4: Update admission gate**

Implement priority order:

1. task state stays `task_state`.
2. source-of-truth excerpt -> `auto_drop` with `source_of_truth_excerpt`.
3. implementation changelog / migration log -> `auto_drop` with `implementation_changelog`.
4. active duplicate -> `reject_duplicate`.
5. tombstone match -> `auto_drop`.
6. pending duplicate -> `merge_with_existing`.
7. durable low-risk -> pending/trial path through existing proposal router.

- [ ] **Step 5: Update pipeline side effects**

For `auto_drop`, `reference_only` removal, and `task_state`, ensure pipeline records candidate/admission audit but does not write review queue entries, distillation inputs, or routing/review decisions as if it were a memory lane.

- [ ] **Step 6: Run focused verification**

Run:

```bash
npm test -- tests/codex-admission-gate.test.ts tests/codex-admission-pipeline.test.ts
npm run typecheck
```

Expected: all pass.

## Task 3: Runtime Context Preview

**Files:**
- Create: `src/codex/memory-context-preview.ts`
- Modify: `src/codex/codex-cli.ts`
- Test: `tests/codex-memory-context-preview.test.ts`
- Test: `tests/codex-cli.test.ts`

- [ ] **Step 1: Write failing context-preview tests**

Create fixture memories:

- active project `trial`
- active project `validated`
- active project `project_core`
- active global `global_core`
- pending project review queue
- pending global review queue
- archived memory
- tombstone

Assert output:

- Trial appears only in `workflowHints`.
- Validated/core/global_core may appear in constraints/checklist/profileCore.
- Pending review queue appears only in excluded items.
- Tombstone and archived appear only in excluded items.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/codex-memory-context-preview.test.ts
```

Expected: fail because command/module does not exist.

- [ ] **Step 3: Implement preview module**

`formatCodexMemoryContextPreview({ cwd, query? })` should:

- identify current project;
- read project/global semantic memories;
- read review queue and tombstones;
- call `buildMemoryActivations`;
- return JSON or stable text with `workflowHints`, `planConstraints`, `checklistItems`, `profileCore`, and excluded items.

- [ ] **Step 4: Add CLI command**

Add:

```txt
cyrene-continuity codex memory context-preview [--query <text>]
```

Update CLI usage text.

- [ ] **Step 5: Run focused verification**

Run:

```bash
npm test -- tests/codex-memory-context-preview.test.ts tests/codex-cli.test.ts
npm run typecheck
```

Expected: all pass.

## Task 4: Memory Automation Public Surface

**Files:**
- Modify: `src/codex/codex-cli.ts`
- Modify: `src/mcp/mcp-server.ts`
- Create or modify: `src/mcp/tools/memory-automation.ts`
- Modify or replace: `src/mcp/tools/memory-dream.ts`
- Modify: `src/codex/codex-memory-lifecycle-daily.ts`
- Modify: `src/codex/codex-memory-lifecycle-weekly.ts`
- Test: `tests/codex-cli.test.ts`
- Test: `tests/mcp-server.test.ts`
- Test: `tests/codex-memory-lifecycle-daily.test.ts`
- Test: `tests/codex-memory-lifecycle-weekly.test.ts`

- [ ] **Step 1: Write failing CLI/MCP tests**

Assert:

- `codex memory automation --job daily --dry-run` calls daily lifecycle.
- `codex memory automation --job weekly --dry-run` calls weekly lifecycle.
- `memory dream` is not listed in CLI usage.
- MCP registers `cyrene_memory_automation_run`.
- MCP does not register `cyrene_memory_dream_run` as a primary public tool.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/codex-cli.test.ts tests/mcp-server.test.ts
```

Expected: fail because automation public command/tool does not exist yet.

- [ ] **Step 3: Implement automation command/tool**

Add CLI:

```txt
memory automation --job daily [--dry-run|--apply] [--all-projects]
memory automation --job weekly [--dry-run|--apply] [--all-projects]
```

Add MCP input:

```ts
{
  job: z.enum(['daily', 'weekly']),
  apply: z.boolean().optional(),
  allProjects: z.boolean().optional()
}
```

Return JSON from existing daily/weekly functions.

- [ ] **Step 4: Move global pending review out of daily**

Update daily so it does not promote global pending candidates. It may count/recommend them, but weekly owns global candidate review/core consolidation.

- [ ] **Step 5: Run focused verification**

Run:

```bash
npm test -- tests/codex-memory-lifecycle-daily.test.ts tests/codex-memory-lifecycle-weekly.test.ts tests/codex-cli.test.ts tests/mcp-server.test.ts
npm run typecheck
```

Expected: all pass.

## Task 5: UI, Docs, And Public Terminology Quality Gate

**Files:**
- Modify: `README.md`
- Modify: `plugin/skills/cyrene-continuity/SKILL.md`
- Modify: `src/codex/codex-ui-static.ts` or UI source if generated from TS string.
- Modify: `src/codex/codex-ui-api.ts` only if API labels still use lifecycle-old names.
- Test: `tests/codex-ui-static.test.ts`
- Test: `tests/codex-ui-api.test.ts`
- Test: `tests/memory-quality-contract.test.ts`

- [ ] **Step 1: Write failing public-term tests**

Add a public docs/UI scan that checks current public surfaces:

- README
- plugin skill
- CLI usage text if testable
- UI static HTML/JS text

Assert:

- no `cyrene_memory_dream_run`;
- no `memory dream` public command;
- no “Dream view”;
- no pending/active as lifecycle labels where Trial/Validated/Core/review_queue/global_core should appear.

Do not scan old historical specs/plans.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/memory-quality-contract.test.ts tests/codex-ui-static.test.ts tests/codex-ui-api.test.ts
```

Expected: fail while public docs/UI still mention old concepts.

- [ ] **Step 3: Update docs/UI text**

Update public text to:

- Memory Automation
- Trial / Validated / Core
- Review Queue
- Global Core
- Global Review Queue
- Archived / Tombstoned debug view

Keep historical specs/plans unchanged.

- [ ] **Step 4: Rebuild plugin**

Run:

```bash
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: both pass.

## Task 6: Final Release Gate

**Files:**
- All changed source/tests/docs.

- [ ] **Step 1: Run targeted tests**

Run the focused commands from Tasks 1-5.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
git diff --check
```

Expected: all pass.

- [ ] **Step 3: Review old-term scan output**

Confirm old Dream/pending/active references only remain in:

- historical specs/plans as background;
- internal file names only if renaming would create disproportionate churn and no public surface exposes them.

- [ ] **Step 4: Commit**

Commit with a message similar to:

```bash
git add docs/superpowers/specs/2026-06-04-cyrene-v1-5-effective-memory-lifecycle-redesign.md docs/superpowers/plans/2026-06-04-cyrene-v1-5-effective-memory-lifecycle-redesign.md src tests README.md plugin
git commit -m "feat: redesign effective memory lifecycle automation"
```
