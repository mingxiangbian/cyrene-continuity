# Cyrene V3 PR10 Eval Gate Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展 eval runner，使 Dream apply、profile patch apply、memory migration、similar-project transfer 和 release gate 都经过可见、自动化的 eval gate。

**Architecture:** 将 eval check 统一收敛到 `src/eval/eval-runner.ts`，保持业务模块只负责组装输入和根据 gate 结果阻断 mutation。已有 Dream gate 保留，新增/统一 `memory_routing_eval`、`similar_hint_eval`、`profile_pollution_eval`、`affective_boundary_eval`、`cross_project_leak_eval`、`pending_usage_eval`。

**Tech Stack:** TypeScript, Vitest, JSONL memory store, Codex CLI。

---

### Task 1: 统一 eval runner 的 check 名称和 gate API

**Files:**
- Modify: `src/eval/eval-runner.ts`
- Test: `tests/eval-runner.test.ts`

- [ ] **Step 1: Write failing tests**

在 `tests/eval-runner.test.ts` 中新增/调整断言：

```ts
expect(result.failedChecks).toContain('similar_hint_eval')
expect(result.results.map((check) => check.name)).toEqual(expect.arrayContaining([
  'memory_routing_eval',
  'similar_hint_eval'
]))
```

新增 routing gate 测试：

```ts
it('fails memory_routing_eval when pending or similar hints are routed as confirmed facts', () => {
  const result = runMemoryRoutingEvalGate({
    currentProjectId: 'current',
    globalMemory: [{
      id: 'pending-in-active',
      status: 'pending',
      scope: 'project',
      homeProjectId: 'current'
    }],
    projectMemory: [],
    pendingHypotheses: [{
      id: 'pending-ok',
      status: 'pending',
      provisional: true
    }],
    similarProjectHints: [{
      id: 'hint-current-fact',
      status: 'active',
      domain: 'procedural',
      homeProjectId: 'other',
      notCurrentProjectFact: false
    }]
  })

  expect(result.passed).toBe(false)
  expect(result.failedChecks).toEqual(['memory_routing_eval'])
  expect(JSON.stringify(result.results)).toContain('pending-in-active')
  expect(JSON.stringify(result.results)).toContain('hint-current-fact')
})
```

新增 migration gate 测试：

```ts
it('fails cross_project_leak_eval for personal relationship or affective memory migration', () => {
  const result = runMemoryMigrationEvalGate({
    fromProjectId: 'legacy',
    toProjectId: 'current',
    activeMemories: [
      activeMemory({ id: 'personal', domain: 'personal', type: 'user_preference' }),
      activeMemory({ id: 'relationship', domain: 'relationship', type: 'relationship_boundary' }),
      activeMemory({ id: 'affective', domain: 'affective', type: 'affective_pattern' })
    ]
  })

  expect(result.passed).toBe(false)
  expect(result.failedChecks).toEqual(['cross_project_leak_eval'])
})
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- tests/eval-runner.test.ts -t "memory_routing_eval|cross_project_leak_eval|similar hints eval gate"
```

Expected: FAIL because `runMemoryRoutingEvalGate` / `runMemoryMigrationEvalGate` do not exist and existing similar hint check is named `similar_hint_boundary_eval`。

- [ ] **Step 3: Implement eval runner changes**

在 `src/eval/eval-runner.ts` 中：

```ts
export type EvalCheckName =
  | 'memory_routing_eval'
  | 'profile_pollution_eval'
  | 'affective_boundary_eval'
  | 'cross_project_leak_eval'
  | 'pending_usage_eval'
  | 'similar_hint_eval'
```

将 `runSimilarHintBoundaryEval()` 改为返回 `similar_hint_eval`。

新增：

```ts
export interface MemoryRoutingEvalInput {
  currentProjectId: string
  globalMemory: MemoryRoutingActiveItem[]
  projectMemory: MemoryRoutingActiveItem[]
  pendingHypotheses: MemoryRoutingPendingItem[]
  similarProjectHints: MemoryRoutingSimilarHintItem[]
}

export function runMemoryRoutingEvalGate(input: MemoryRoutingEvalInput): EvalGateResult {
  return gate([runMemoryRoutingEval(input)])
}

export function runMemoryMigrationEvalGate(input: MemoryMigrationEvalInput): EvalGateResult {
  return gate([runCrossProjectMigrationLeakEval(input)])
}
```

规则：
- `globalMemory` / `projectMemory` 只能包含 `status: 'active'`。
- `pendingHypotheses` 必须是 `status: 'pending'` 且 `provisional: true`。
- `similarProjectHints` 必须 `status: 'active'`、`homeProjectId !== currentProjectId`、`notCurrentProjectFact: true`。
- migration 中 `domain` 为 `personal` / `relationship` / `affective` 的 active memory 不能跨不同 `projectId` 迁移。

- [ ] **Step 4: Run GREEN**

Run:

```bash
npm test -- tests/eval-runner.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/eval/eval-runner.ts tests/eval-runner.test.ts
git commit -m "feat: expand eval gate checks"
```

### Task 2: Wire eval gates into apply/migration/release paths

**Files:**
- Modify: `src/codex/continuity-context.ts`
- Modify: `src/codex/profile-candidates.ts`
- Modify: `src/codex/project-registry.ts`
- Modify: `src/codex/codex-eval.ts`
- Modify: `src/codex/codex-cli.ts`
- Test: `tests/codex-continuity-context.test.ts`
- Test: `tests/profile-candidates.test.ts`
- Test: `tests/codex-project-tools.test.ts`
- Test: `tests/codex-cli.test.ts`

- [ ] **Step 1: Write failing integration tests**

Update existing `similar_hint_boundary_eval` expectations to `similar_hint_eval`。

Add project merge blocked test in `tests/codex-project-tools.test.ts`：

```ts
await writeJsonLines(join(codexProjectMemoryRoot('from-project'), 'index.jsonl'), [
  activeMemory({ id: 'personal-memory', domain: 'personal', type: 'user_preference' })
])

await expect(mergeCodexProjects({
  fromProjectId: 'from-project',
  toProjectId: 'to-project'
})).rejects.toThrow('Project merge blocked by eval gate: cross_project_leak_eval')
```

Add CLI release eval test in `tests/codex-cli.test.ts`：

```ts
const result = await execFileAsync(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'eval', 'run', '--check', 'release'],
  { env: cliEnv(home) }
)
const parsed = JSON.parse(result.stdout)
expect(parsed.minimumChecks).toEqual([
  'memory_routing_eval',
  'profile_pollution_eval',
  'affective_boundary_eval',
  'cross_project_leak_eval',
  'pending_usage_eval',
  'similar_hint_eval'
])
expect(parsed.passed).toBe(true)
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts tests/profile-candidates.test.ts tests/codex-project-tools.test.ts tests/codex-cli.test.ts -t "eval|merge|similar|profile"
```

Expected: FAIL because release check route and migration gate are not wired。

- [ ] **Step 3: Wire continuity retrieval gate**

In `src/codex/continuity-context.ts`:

```ts
const memoryRoutingGate = runMemoryRoutingEvalGate({
  currentProjectId: input.projectId,
  globalMemory: globalMemory.map(toRoutingActiveItem),
  projectMemory: projectMemory.map(toRoutingActiveItem),
  pendingHypotheses: pendingHypotheses.map(toRoutingPendingItem),
  similarProjectHints: similarProjectHints.map(toRoutingSimilarHintItem)
})
const evalGate = combineEvalGateResults([similarHintGate, memoryRoutingGate])
const safeSimilarProjectHints = evalGate.passed ? similarProjectHints : []
```

Diagnostics must include both failed check names when either gate fails。

- [ ] **Step 4: Wire profile apply gate**

In `src/codex/profile-candidates.ts`, replace local `evaluateProfileApplyGate()` with centralized `runProfileApplyEvalGate()` from `src/eval/eval-runner.ts`。

Blocked result keeps existing shape:

```ts
{
  action: 'blocked_by_gate',
  candidateId,
  failedChecks: gate.failedChecks,
  reason: `Profile apply blocked by eval gate: ${gate.failedChecks.join(', ')}`
}
```

- [ ] **Step 5: Wire project merge migration gate**

In `src/codex/project-registry.ts`, before copying JSONL files:

```ts
const active = await readActiveMemoriesFromRoot(fromMemoryRoot)
const gate = runMemoryMigrationEvalGate({ fromProjectId, toProjectId, activeMemories: active })
if (!gate.passed) {
  throw new Error(`Project merge blocked by eval gate: ${gate.failedChecks.join(', ')}`)
}
```

- [ ] **Step 6: Wire release eval CLI**

In `src/codex/codex-eval.ts`, add `runCodexReleaseEval()` returning:

```ts
{
  check: 'release',
  passed: true,
  failedChecks: [],
  minimumChecks: [
    'memory_routing_eval',
    'profile_pollution_eval',
    'affective_boundary_eval',
    'cross_project_leak_eval',
    'pending_usage_eval',
    'similar_hint_eval'
  ]
}
```

In `src/codex/codex-cli.ts`, accept:

```bash
cyrene-continuity codex eval run --check release
```

- [ ] **Step 7: Run GREEN**

Run:

```bash
npm test -- tests/eval-runner.test.ts tests/codex-continuity-context.test.ts tests/profile-candidates.test.ts tests/codex-project-tools.test.ts tests/codex-cli.test.ts
```

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add src/eval/eval-runner.ts src/codex/continuity-context.ts src/codex/profile-candidates.ts src/codex/project-registry.ts src/codex/codex-eval.ts src/codex/codex-cli.ts tests/eval-runner.test.ts tests/codex-continuity-context.test.ts tests/profile-candidates.test.ts tests/codex-project-tools.test.ts tests/codex-cli.test.ts
git commit -m "feat: wire expanded eval gates"
```

### Task 3: Release verification

**Files:**
- Modify: `plugin/runtime/cyrene-continuity.mjs`

- [ ] **Step 1: Build plugin runtime**

```bash
npm run build:plugin
```

Expected: exit 0 and updated `plugin/runtime/cyrene-continuity.mjs` if source changed。

- [ ] **Step 2: Run release gates**

```bash
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
git diff --check
```

Expected: all exit 0。

- [ ] **Step 3: Commit runtime if changed**

```bash
git add plugin/runtime/cyrene-continuity.mjs
git commit -m "build: update plugin runtime for eval gates"
```

Skip commit if `git status --short` has no runtime diff。
