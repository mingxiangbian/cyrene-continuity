# Cyrene V3 PR1 Critical Policy And Data-Loss Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 v3 PR 1：Dream 只能推荐 promotion、不能自动写 active memory；`CYRENE_MEMORY_AUTO_PROMOTE` 变成 deprecated recommend-only 兼容项；legacy projection cleanup 只能删除带显式 generated header 的文件。

**Architecture:** 本 PR 保持现有 JSONL、MCP tool 和 CLI command 形状，不引入新的 review CLI。核心改动在 Dream proposal/apply 层：`deep-preview` 和 `deep-apply` 都可以生成 `recommend_promote` review artifact，但 `deep-apply` 不再执行 unapproved active promotion；active promotion 仍只能通过 `promoteCodexPendingMemory()` 的 reviewHash gate。Generated projection cleanup 增加明确 header helper，config/doctor/README/skill 统一改成 recommend-only wording。

**Tech Stack:** TypeScript, Node.js, Vitest, Commander CLI, MCP SDK, JSONL memory files, generated plugin runtime via `npm run build:plugin`.

---

## 范围

本 plan 只覆盖 spec 中的 PR 1：

- Remove/rewrite auto-promote wording。
- Make Dream recommend, not promote unapproved memory。
- Require approval + reviewHash for active promotion。
- Fix generated header deletion risk。
- Audit `memoryAutoPromoteEnabled` / `CYRENE_MEMORY_AUTO_PROMOTE`。

不实现 `codex memory status`、review CLI、project merge、profile patch flow 或 `continuity_get` query-only，这些属于后续 PR。

## 文件结构

- Modify `src/codex/dream-proposal.ts`  
  负责 proposal model。新增 `recommend_promote` proposed change；保留 `promote` proposed change 作为 eval gate 可识别的 forbidden/legacy automated operation，但 Dream builder 不再产出它。`applyPlan` 不再包含 promotion operation。

- Modify `src/codex/memory-dream.ts`  
  负责 Dream runtime。`deep-preview` 和 `deep-apply` 返回 `recommendedPromotions`；`deep-apply` 写 preview artifacts、apply reject/expire/keep-pending 和 maintenance，但不写 active promotion。

- Modify `src/codex/dream-artifacts.ts`  
  负责 human-readable report。把 promote 文案改为 recommended promotion，不提示用户运行 `deep-apply` 来自动 promote。

- Modify `src/eval/eval-runner.ts`  
  保留对 `promote` proposed change 的 gate 检查；确保 `recommend_promote` 不被当成 active mutation。

- Modify `src/config.ts`  
  把 `memoryAutoPromoteEnabled` 替换为 `memoryRecommendPromotionEnabled`，兼容读取旧 `CYRENE_MEMORY_AUTO_PROMOTE`，并暴露 `deprecatedMemoryAutoPromoteConfigured`。

- Modify `src/codex/codex-doctor.ts`  
  Doctor 输出 `promotion recommendations` 和 deprecated env warning，不再输出 `auto promote`。

- Modify `src/memory/memory-exporter.ts`  
  使用新的显式 generated header，保留旧 generated headers 为 legacy cleanup match；通过 helper 防止空 header 或 ambiguous header 触发删除。

- Modify `README.md`  
  更新 Dream 和 env wording，说明 `deep-apply` 不 promotion unapproved pending。

- Modify `plugin/skills/cyrene-continuity/SKILL.md`  
  删除 “Dream Deep auto-promote” 规则，替换为 recommended-for-review 规则。

- Modify `src/mcp/mcp-server.ts`  
  更新 `cyrene_memory_dream_run` tool description。

- Build-generated modify `plugin/runtime/cyrene-continuity.mjs`  
  最后一项 task 运行 `npm run build:plugin` 生成，不能手写编辑。

- Modify tests:
  - `tests/codex-memory-dream.test.ts`
  - `tests/codex-cli.test.ts`
  - `tests/codex-memory-review.test.ts`
  - `tests/mcp-server.test.ts`

---

### Task 1: Add Dream Recommendation-Only Regression Tests

**Files:**
- Modify: `tests/codex-memory-dream.test.ts`
- Modify: `tests/codex-cli.test.ts`

- [ ] **Step 1: Add an optional file helper in `tests/codex-memory-dream.test.ts`**

Add this helper after `parseJsonLines()`:

```ts
async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return ''
    }
    throw error
  }
}
```

- [ ] **Step 2: Replace the promote proposal test with recommend-only expectations**

In `tests/codex-memory-dream.test.ts`, replace the test named `builds a promote proposal for repeated independent procedural memory without writing active memory` with:

```ts
it('builds a recommended promotion proposal for repeated independent procedural memory without writing active memory', async () => {
  const home = await createTempDir('cyrene-dream-home-')
  vi.stubEnv('HOME', home)
  const cwd = await createTempDir('cyrene-dream-project-')
  const candidate = createPending({
    seenCount: 2,
    evidence: [
      { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
      { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
    ]
  })
  const memoryRoot = await seedProjectPending(cwd, [candidate])

  const proposal = await buildDreamProposalForRoot({ memoryRoot, now: '2026-05-26T00:00:00.000Z' })

  expect(proposal.summary).toMatchObject({ recommendedPromotions: 1, reject: 0, expire: 0, keepPending: 1 })
  expect(proposal.proposedChanges[0]).toMatchObject({
    action: 'recommend_promote',
    candidateId: candidate.id,
    recommendedMemoryId: candidate.id,
    normalizedKey: candidate.normalizedKey,
    distinctEvidenceCount: 2
  })
  expect(proposal.applyPlan).toEqual([
    expect.objectContaining({ action: 'keep_pending', candidate: expect.objectContaining({ id: candidate.id }) })
  ])
  await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
})
```

- [ ] **Step 3: Update the deep-preview test to report recommendation counts**

In the `deep-preview writes review artifacts without mutating memory source files or dream state` test, change result expectations to:

```ts
expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({
  stage: 'deep-preview',
  promoted: 0,
  recommendedPromotions: 1,
  rejected: 0,
  keptPending: 1
})
```

In the same test, change the proposed change assertion to:

```ts
expect(proposed.root.proposedChanges[0]).toMatchObject({ action: 'recommend_promote', candidateId: candidate.id })
```

Change the `diff` parsed type and assertions to:

```ts
const diff = JSON.parse(await readFile(join(memoryRoot, 'dream-preview', 'diff.json'), 'utf8')) as {
  recommendActiveMemoryIds: string[]
  removePendingCandidateIds: string[]
  keepPendingCandidateIds: string[]
}
expect(diff.recommendActiveMemoryIds).toEqual([candidate.id])
expect(diff.removePendingCandidateIds).toEqual([])
expect(diff.keepPendingCandidateIds).toEqual([candidate.id])
```

- [ ] **Step 4: Replace the deep-apply promotion test**

In `tests/codex-memory-dream.test.ts`, replace the test named `deep-apply promotes repeated independent procedural memory and writes model profile` with:

```ts
it('deep-apply recommends repeated independent procedural memory without promoting it', async () => {
  const home = await createTempDir('cyrene-dream-home-')
  vi.stubEnv('HOME', home)
  const cwd = await createTempDir('cyrene-dream-project-')
  const candidate = createPending({
    seenCount: 2,
    evidence: [
      { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
      { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
    ]
  })
  const memoryRoot = await seedProjectPending(cwd, [candidate])

  const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })

  expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({
    stage: 'deep-apply',
    promoted: 0,
    recommendedPromotions: 1,
    rejected: 0,
    keptPending: 1
  })
  expect(await readOptionalText(join(memoryRoot, 'index.jsonl'))).not.toContain(candidate.content)
  await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain(candidate.content)
  expect(await readOptionalText(join(memoryRoot, 'events.jsonl'))).not.toContain('"action":"promote"')
  await expect(readFile(join(memoryRoot, 'dream-preview', 'DREAM_REPORT.md'), 'utf8')).resolves.toContain('recommend_promote')
})
```

- [ ] **Step 5: Update remaining dream test expectations that assume `promoted` means recommendation**

In `tests/codex-memory-dream.test.ts`:

- In `deep-apply keeps insufficient evidence pending`, update the matched object to include `recommendedPromotions: 0`.
- In `deep-apply does not promote same-run duplicate evidence even with different evidence groups`, keep the active/pending assertions and add:

```ts
const result = await runCodexMemoryDream({ cwd, stage: 'deep-apply', now: '2026-05-26T00:00:00.000Z' })
expect(result.roots.find((root) => root.memoryRoot === memoryRoot)).toMatchObject({
  promoted: 0,
  recommendedPromotions: 0
})
```

If that test currently ignores the returned result, assign it to `const result` as shown.

- [ ] **Step 6: Update CLI dream tests**

In `tests/codex-cli.test.ts`, replace the test named `runs memory dream apply from the CLI` with:

```ts
it('runs memory dream apply from the CLI without promoting unapproved pending memory', async () => {
  const home = await createTempDir('cyrene-codex-cli-dream-home-')
  process.env.HOME = home
  const identity = await identifyCodexProject(process.cwd())
  const memoryRoot = codexProjectMemoryRoot(identity.projectId)
  await mkdir(memoryRoot, { recursive: true })
  await writeFile(join(memoryRoot, 'pending.jsonl'), `${JSON.stringify(createPending())}\n`)

  const result = await execFileAsync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'dream', '--stage', 'deep-apply'],
    { env: cliEnv(home) }
  )

  expect(result.stderr).toBe('')
  const parsed = JSON.parse(result.stdout) as {
    roots: Array<{ promoted: number; recommendedPromotions: number; keptPending: number }>
  }
  expect(parsed.roots.some((root) => root.promoted === 0 && root.recommendedPromotions === 1 && root.keptPending === 1)).toBe(true)
  await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.not.toContain('CLI dream promotes repeated pending memory.')
  await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain('CLI dream promotes repeated pending memory.')
})
```

In the `runs memory dream preview from the CLI without promoting pending memory` test, update the parsed type and assertion to:

```ts
const parsed = JSON.parse(result.stdout) as {
  roots: Array<{ stage: string; promoted: number; recommendedPromotions: number; keptPending: number }>
}
expect(parsed.roots.some((root) =>
  root.stage === 'deep-preview' &&
  root.promoted === 0 &&
  root.recommendedPromotions === 1 &&
  root.keptPending === 1
)).toBe(true)
```

- [ ] **Step 7: Run RED for Dream tests**

Run:

```bash
npx vitest run tests/codex-memory-dream.test.ts tests/codex-cli.test.ts -t "dream"
```

Expected: FAIL because `recommendedPromotions`, `recommend_promote`, and the new diff field are not implemented yet.

---

### Task 2: Implement Dream Recommendation-Only Apply

**Files:**
- Modify: `src/codex/dream-proposal.ts`
- Modify: `src/codex/memory-dream.ts`
- Modify: `src/codex/dream-artifacts.ts`
- Modify: `src/eval/eval-runner.ts`
- Test: `tests/codex-memory-dream.test.ts`
- Test: `tests/codex-cli.test.ts`

- [ ] **Step 1: Update Dream proposal types**

In `src/codex/dream-proposal.ts`, replace `DreamProposalSummary`, `DreamProposedChange`, `DreamApplyOperation`, and `DreamLogicalDiff` with:

```ts
export interface DreamProposalSummary {
  recommendedPromotions: number
  reject: number
  expire: number
  keepPending: number
  maintenanceWouldRun: boolean
}

export type DreamProposedChange =
  | {
      action: 'recommend_promote'
      candidateId: string
      recommendedMemoryId: string
      normalizedKey: string
      reason: string
      distinctEvidenceCount: number
    }
  | {
      action: 'promote'
      candidateId: string
      memoryId: string
      normalizedKey: string
      reason: string
      distinctEvidenceCount: number
    }
  | {
      action: 'reject'
      candidateId: string
      normalizedKey: string
      reason: string
      tombstoneReason: MemoryTombstone['reason']
    }
  | {
      action: 'keep_pending'
      candidateId: string
      normalizedKey: string
      reason: string
      distinctEvidenceCount: number
    }

export type DreamApplyOperation =
  | {
      action: 'reject'
      candidateId: string
      tombstone: MemoryTombstone
      reason: string
    }
  | {
      action: 'keep_pending'
      candidate: PendingMemory
      reason: string
    }

export interface DreamLogicalDiff {
  recommendActiveMemoryIds: string[]
  addActiveMemoryIds: string[]
  removePendingCandidateIds: string[]
  addTombstoneIds: string[]
  keepPendingCandidateIds: string[]
}
```

Keep the `promote` variant only so eval gate tests and future migration checks can identify forbidden automated promotion proposals. `buildDreamProposalForRoot()` must not create that variant.

- [ ] **Step 2: Update `buildDreamProposalForRoot()` summary and diff initialization**

In `buildDreamProposalForRoot()`, initialize `diff` and `summary` like this:

```ts
const diff: DreamLogicalDiff = {
  recommendActiveMemoryIds: [],
  addActiveMemoryIds: [],
  removePendingCandidateIds: [],
  addTombstoneIds: [],
  keepPendingCandidateIds: []
}
const summary: DreamProposalSummary = {
  recommendedPromotions: 0,
  reject: 0,
  expire: 0,
  keepPending: 0,
  maintenanceWouldRun: true
}
```

Keep `addActiveMemoryIds` for compatibility with legacy/future explicit approved apply operations, but PR 1 should leave it empty.

- [ ] **Step 3: Replace the promotable branch in `buildDreamProposalForRoot()`**

In `src/codex/dream-proposal.ts`, replace the branch that currently creates `action: 'promote'` with:

```ts
const recommendedMemory = decision.action === 'auto_write'
  ? decision.memory
  : decision.action === 'pending'
    ? activateCandidate(decision.candidate, input.now)
    : undefined
if (recommendedMemory === undefined) {
  proposedChanges.push({
    action: 'keep_pending',
    candidateId: candidate.id,
    normalizedKey: candidate.normalizedKey,
    reason: decision.reason,
    distinctEvidenceCount: evaluation.distinctEvidenceCount
  })
  applyPlan.push({ action: 'keep_pending', candidate, reason: decision.reason })
  diff.keepPendingCandidateIds.push(candidate.id)
  summary.keepPending += 1
  continue
}

proposedChanges.push({
  action: 'recommend_promote',
  candidateId: candidate.id,
  recommendedMemoryId: recommendedMemory.id,
  normalizedKey: candidate.normalizedKey,
  reason: evaluation.reason,
  distinctEvidenceCount: evaluation.distinctEvidenceCount
})
applyPlan.push({
  action: 'keep_pending',
  candidate,
  reason: `Recommended for manual review: ${evaluation.reason}`
})
diff.recommendActiveMemoryIds.push(recommendedMemory.id)
diff.keepPendingCandidateIds.push(candidate.id)
summary.recommendedPromotions += 1
summary.keepPending += 1
```

Do not update `active` in this branch. The proposal can recommend what would be promoted, but it must not model the recommendation as an active write.

- [ ] **Step 4: Update `CodexMemoryDreamResult` and stage returns**

In `src/codex/memory-dream.ts`, add `recommendedPromotions: number` to root result objects:

```ts
roots: Array<{
  memoryRoot: string
  stage: CodexMemoryDreamStage
  promoted: number
  recommendedPromotions: number
  rejected: number
  keptPending: number
  maintenance?: MemoryMaintenanceResult
  skipped?: string
}>
```

Every `light`, `rem`, skipped, failed, and maintenance-only return should include `recommendedPromotions: 0`.

`runDeepPreviewDreamRoot()` should return:

```ts
return {
  memoryRoot: proposal.memoryRoot,
  stage,
  promoted: 0,
  recommendedPromotions: proposal.summary.recommendedPromotions,
  rejected: proposal.summary.reject,
  keptPending: proposal.summary.keepPending
}
```

- [ ] **Step 5: Update REM audit wording**

In `runRemDreamRoot()`, change the `proposedAction` value for promotable candidates from `promote` to `recommend_promote`:

```ts
proposedAction: evaluation.promotable ? 'recommend_promote' : proposedActionForPending(candidate, evaluation.reason),
```

- [ ] **Step 6: Write preview artifacts during deep-apply and remove promotion application**

In `runDeepDreamRootLocked()`, after building the proposal, write preview artifacts before checking the eval gate:

```ts
const proposal = await buildDreamProposalForRoot({ memoryRoot, now })
await writeDreamPreviewArtifacts({ memoryRoot: proposal.memoryRoot, proposal })
if (!proposal.evalGate.passed) {
  const reason = `Dream apply blocked by eval gate: ${proposal.evalGate.failedChecks.join(', ')}`
  await writeDreamFailed(proposal.memoryRoot, now, new Error(reason))
  return {
    memoryRoot: proposal.memoryRoot,
    stage: 'deep-apply',
    promoted: 0,
    recommendedPromotions: proposal.summary.recommendedPromotions,
    rejected: 0,
    keptPending: (await readPendingMemoriesFromRoot(proposal.memoryRoot)).length,
    skipped: reason
  }
}
```

In the success return, use:

```ts
return {
  memoryRoot: proposal.memoryRoot,
  stage: 'deep-apply',
  promoted: applied.promoted,
  recommendedPromotions: proposal.summary.recommendedPromotions,
  rejected: applied.rejected,
  keptPending: maintenance.pendingCount,
  maintenance
}
```

- [ ] **Step 7: Replace `applyDreamProposal()` promotion handling**

In `src/codex/memory-dream.ts`, replace `applyDreamProposal()` with:

```ts
async function applyDreamProposal(
  memoryRoot: string,
  proposal: DreamRootProposal,
  now: string
): Promise<{ promoted: number; rejected: number }> {
  const pending = await readPendingMemoriesFromRoot(memoryRoot)
  const nextPending: PendingMemory[] = []
  const events: MemoryEvent[] = []
  const newTombstones: MemoryTombstone[] = []
  let rejected = 0
  let mutated = false

  for (const operation of proposal.applyPlan) {
    if (operation.action === 'keep_pending') {
      nextPending.push(operation.candidate)
      continue
    }

    newTombstones.push(operation.tombstone)
    events.push({
      id: randomUUID(),
      action: 'reject',
      at: now,
      reason: operation.reason,
      candidateId: operation.candidateId
    })
    rejected += 1
    mutated = true
  }

  if (mutated) {
    const retainedIds = new Set(nextPending.map((candidate) => candidate.id))
    for (const candidate of pending) {
      if (!retainedIds.has(candidate.id) && !proposal.diff.removePendingCandidateIds.includes(candidate.id)) {
        nextPending.push(candidate)
      }
    }
    await writePendingMemoriesFromRoot(memoryRoot, nextPending)
    for (const tombstone of newTombstones) {
      await appendTombstoneFromRoot(memoryRoot, tombstone)
    }
    for (const event of events) {
      await appendMemoryEventFromRoot(memoryRoot, event)
    }
  }

  return { promoted: 0, rejected }
}
```

After this replacement, remove the unused import `readActiveMemoriesFromRoot` and remove the local `upsertActiveMemory()` helper if it is only used by deleted promotion code.

- [ ] **Step 8: Update Dream report rendering**

In `src/codex/dream-artifacts.ts`, change summary lines to:

```ts
`- recommendedPromotions: ${input.proposal.summary.recommendedPromotions}`,
`- reject: ${input.proposal.summary.reject}`,
`- expire: ${input.proposal.summary.expire}`,
`- keepPending: ${input.proposal.summary.keepPending}`,
```

In proposed change rendering, add a `recommend_promote` branch before the reject branch:

```ts
if (change.action === 'recommend_promote') {
  lines.push(`- recommend_promote ${change.normalizedKey} (${change.candidateId}) -> ${change.recommendedMemoryId}: ${change.reason}`)
} else if (change.action === 'promote') {
  lines.push(`- promote ${change.normalizedKey} (${change.candidateId}) -> ${change.memoryId}: ${change.reason}`)
} else if (change.action === 'reject') {
  lines.push(`- reject ${change.normalizedKey} (${change.candidateId}) as ${change.tombstoneReason}: ${change.reason}`)
} else {
  lines.push(`- keep_pending ${change.normalizedKey} (${change.candidateId}): ${change.reason}`)
}
```

Replace the apply instruction with:

```ts
lines.push(
  '',
  '## Apply',
  '',
  'Use `cyrene_memory_pending_list` / `cyrene_memory_pending_get` and explicit `cyrene_memory_promote` approval to promote recommended candidates. `deep-apply` does not promote unapproved pending memory.'
)
```

- [ ] **Step 9: Confirm eval gate handles recommendation changes as non-mutation**

In `src/eval/eval-runner.ts`, leave `runPendingUsageEval()` filtering on `change.action !== 'promote'`. Add one test to `tests/eval-runner.test.ts` under `describe('dream apply eval gate')`:

```ts
it('treats recommend_promote as review material instead of an active mutation', () => {
  const candidate = pending({ source: 'assistant_observed' })

  const result = runDreamApplyEvalGate({
    pending: [candidate],
    proposedChanges: [{
      action: 'recommend_promote',
      candidateId: candidate.id,
      recommendedMemoryId: candidate.id,
      normalizedKey: candidate.normalizedKey,
      reason: 'recommend only',
      distinctEvidenceCount: 1
    }]
  })

  expect(result.failedChecks).not.toContain('pending_usage_eval')
})
```

- [ ] **Step 10: Run GREEN for Dream recommendation tests**

Run:

```bash
npx vitest run tests/codex-memory-dream.test.ts tests/codex-cli.test.ts tests/eval-runner.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit Task 2**

```bash
git add src/codex/dream-proposal.ts src/codex/memory-dream.ts src/codex/dream-artifacts.ts src/eval/eval-runner.ts tests/codex-memory-dream.test.ts tests/codex-cli.test.ts tests/eval-runner.test.ts
git commit -m "fix: make dream promotion review-only"
```

---

### Task 3: Replace Auto-Promote Config With Recommend-Only Config

**Files:**
- Modify: `src/config.ts`
- Modify: `src/codex/codex-doctor.ts`
- Modify: `tests/codex-cli.test.ts`

- [ ] **Step 1: Add doctor regression expectations**

In `tests/codex-cli.test.ts`, update `doctor reports memory profile and dream state without blocking readiness`:

Replace:

```ts
expect(result.stdout).toContain('auto promote: enabled')
```

with:

```ts
expect(result.stdout).toContain('promotion recommendations: enabled')
expect(result.stdout).not.toContain('auto promote:')
```

Add this new test after the migration doctor test:

```ts
it('doctor reports deprecated auto promote env as recommend-only compatibility', async () => {
  const home = await createTempDir('cyrene-codex-cli-auto-promote-home-')

  const result = await execFileAsync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor'],
    { env: { ...cliEnv(home), CYRENE_MEMORY_AUTO_PROMOTE: '1' } }
  )

  expect(result.stderr).toBe('')
  expect(result.stdout).toContain('promotion recommendations: enabled')
  expect(result.stdout).toContain('deprecated CYRENE_MEMORY_AUTO_PROMOTE: set')
  expect(result.stdout).toContain('advisory: CYRENE_MEMORY_AUTO_PROMOTE is deprecated; use CYRENE_MEMORY_RECOMMEND_PROMOTION')
  expect(result.stdout).not.toContain('auto promote: enabled')
})
```

- [ ] **Step 2: Run RED for doctor config tests**

Run:

```bash
npx vitest run tests/codex-cli.test.ts -t "doctor"
```

Expected: FAIL because doctor still prints `auto promote`.

- [ ] **Step 3: Update `AppConfig`**

In `src/config.ts`, replace:

```ts
memoryAutoPromoteEnabled: boolean
```

with:

```ts
memoryRecommendPromotionEnabled: boolean
deprecatedMemoryAutoPromoteConfigured: boolean
```

In `createDefaultConfig()`, replace:

```ts
memoryAutoPromoteEnabled: parseBooleanEnv(envValue(dotEnv, 'CYRENE_MEMORY_AUTO_PROMOTE'), true),
```

with:

```ts
memoryRecommendPromotionEnabled: parseBooleanEnv(
  envValue(dotEnv, 'CYRENE_MEMORY_RECOMMEND_PROMOTION') ?? envValue(dotEnv, 'CYRENE_MEMORY_AUTO_PROMOTE'),
  true
),
deprecatedMemoryAutoPromoteConfigured: envValue(dotEnv, 'CYRENE_MEMORY_AUTO_PROMOTE') !== undefined,
```

This preserves compatibility but the value now controls recommendation generation only.

- [ ] **Step 4: Use recommendation config in Dream proposal building**

In `src/codex/dream-proposal.ts`, update `buildDreamProposalForRoot()` signature:

```ts
export async function buildDreamProposalForRoot(input: {
  memoryRoot: string
  now: string
  recommendPromotionEnabled?: boolean
}): Promise<DreamRootProposal> {
```

Before the promotable branch creates `recommend_promote`, add:

```ts
if (input.recommendPromotionEnabled === false) {
  proposedChanges.push({
    action: 'keep_pending',
    candidateId: candidate.id,
    normalizedKey: candidate.normalizedKey,
    reason: 'Promotion recommendations are disabled by configuration',
    distinctEvidenceCount: evaluation.distinctEvidenceCount
  })
  applyPlan.push({ action: 'keep_pending', candidate, reason: 'Promotion recommendations are disabled by configuration' })
  diff.keepPendingCandidateIds.push(candidate.id)
  summary.keepPending += 1
  continue
}
```

In `src/codex/memory-dream.ts`, pass config into preview/apply proposal calls:

```ts
results.push(await runDeepPreviewDreamRoot(memoryRoot, stage, now, config.memoryRecommendPromotionEnabled))
```

Update `runDeepPreviewDreamRoot()` signature:

```ts
async function runDeepPreviewDreamRoot(
  memoryRoot: string,
  stage: CodexMemoryDreamStage,
  now: string,
  recommendPromotionEnabled: boolean
): Promise<CodexMemoryDreamResult['roots'][number]> {
```

Inside it:

```ts
const proposal = await buildDreamProposalForRoot({ memoryRoot, now, recommendPromotionEnabled })
```

Update `runDeepDreamRootLocked()` signature to accept `recommendPromotionEnabled: boolean`, pass `config.memoryRecommendPromotionEnabled` from `runDeepDreamRoot()`, and build the proposal with:

```ts
const proposal = await buildDreamProposalForRoot({ memoryRoot, now, recommendPromotionEnabled })
```

- [ ] **Step 5: Update doctor output**

In `src/codex/codex-doctor.ts`, replace:

```ts
`  auto promote: ${config.memoryAutoPromoteEnabled ? 'enabled' : 'disabled'}`
```

with:

```ts
`  promotion recommendations: ${config.memoryRecommendPromotionEnabled ? 'enabled' : 'disabled'}`,
`  deprecated CYRENE_MEMORY_AUTO_PROMOTE: ${config.deprecatedMemoryAutoPromoteConfigured ? 'set' : 'unset'}`,
config.deprecatedMemoryAutoPromoteConfigured
  ? '  advisory: CYRENE_MEMORY_AUTO_PROMOTE is deprecated; use CYRENE_MEMORY_RECOMMEND_PROMOTION'
  : undefined
```

- [ ] **Step 6: Rename all source references**

Run:

```bash
rg -n "memoryAutoPromoteEnabled|auto promote:|CYRENE_MEMORY_AUTO_PROMOTE" src tests README.md plugin
```

Expected after code changes: only deliberate deprecated references to `CYRENE_MEMORY_AUTO_PROMOTE` remain in `src/config.ts`, `src/codex/codex-doctor.ts`, tests, README, and plugin runtime after build.

- [ ] **Step 7: Run GREEN for config tests**

Run:

```bash
npx vitest run tests/codex-cli.test.ts tests/codex-memory-dream.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/config.ts src/codex/codex-doctor.ts src/codex/dream-proposal.ts src/codex/memory-dream.ts tests/codex-cli.test.ts tests/codex-memory-dream.test.ts
git commit -m "fix: deprecate auto promote config"
```

---

### Task 4: Harden Generated Projection Cleanup

**Files:**
- Modify: `src/memory/memory-exporter.ts`
- Modify: `tests/codex-memory-review.test.ts`

- [ ] **Step 1: Add regression tests for user-authored legacy projection files**

In `tests/codex-memory-review.test.ts`, after `removes legacy generated projection files after rendering model profile`, add:

```ts
it('does not remove user-authored legacy MEMORY.md without an explicit generated header', async () => {
  const memoryRoot = await createTempDir('cyrene-review-memory-root-')
  await mkdir(join(memoryRoot, 'projections'))
  await writeFile(join(memoryRoot, 'MEMORY.md'), '# User Memory\n\nThis file is user authored.\n', 'utf8')
  await writeFile(join(memoryRoot, 'projections', 'PROJECT.md'), '# User Project\n\nKeep this file.\n', 'utf8')

  await renderMemoryProjectionsFromRoot(memoryRoot)

  await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain('# Cyrene Model Profile')
  await expect(readFile(join(memoryRoot, 'MEMORY.md'), 'utf8')).resolves.toBe('# User Memory\n\nThis file is user authored.\n')
  await expect(readFile(join(memoryRoot, 'projections', 'PROJECT.md'), 'utf8')).resolves.toBe('# User Project\n\nKeep this file.\n')
})

it('removes legacy files with the new Cyrene generated projection header', async () => {
  const memoryRoot = await createTempDir('cyrene-review-memory-root-')
  const generated = '<!-- Generated by Cyrene Continuity. Do not edit manually. -->\n\nold\n'
  await mkdir(join(memoryRoot, 'projections'))
  await writeFile(join(memoryRoot, 'MEMORY.md'), generated, 'utf8')
  await writeFile(join(memoryRoot, 'projections', 'MEMORY.md'), generated, 'utf8')

  await renderMemoryProjectionsFromRoot(memoryRoot)

  await expect(readFile(join(memoryRoot, 'MEMORY.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(readdir(join(memoryRoot, 'projections'))).rejects.toMatchObject({ code: 'ENOENT' })
})
```

- [ ] **Step 2: Run RED for projection cleanup tests**

Run:

```bash
npx vitest run tests/codex-memory-review.test.ts -t "legacy"
```

Expected: FAIL for the new generated header removal test because `src/memory/memory-exporter.ts` does not recognize the new header yet.

- [ ] **Step 3: Replace header constants and add explicit helper**

In `src/memory/memory-exporter.ts`, replace:

```ts
const GENERATED_HEADER = '<!-- Generated from index.jsonl. Do not edit manually. -->'
const OLD_GENERATED_HEADER = '<!-- Generated from .cyrene/memory/index.jsonl. Do not edit manually. -->'
```

with:

```ts
const GENERATED_HEADER = '<!-- Generated by Cyrene Continuity. Do not edit manually. -->'
const LEGACY_GENERATED_HEADERS = [
  '<!-- Generated from index.jsonl. Do not edit manually. -->',
  '<!-- Generated from .cyrene/memory/index.jsonl. Do not edit manually. -->'
] as const
const GENERATED_PROJECTION_HEADERS = [GENERATED_HEADER, ...LEGACY_GENERATED_HEADERS] as const
```

Add this helper near `isFileErrorCode()`:

```ts
function hasGeneratedProjectionHeader(content: string): boolean {
  return GENERATED_PROJECTION_HEADERS.some((header) => header.trim() !== '' && content.startsWith(header))
}
```

- [ ] **Step 4: Use the helper in cleanup**

In `removeLegacyGeneratedProjectionFile()`, replace:

```ts
if (!content.startsWith(GENERATED_HEADER) && !content.startsWith(OLD_GENERATED_HEADER)) {
  return
}
```

with:

```ts
if (!hasGeneratedProjectionHeader(content)) {
  return
}
```

`formatModelProfile()` already uses `GENERATED_HEADER`, so new `MODEL_PROFILE.md` output will adopt the safer explicit header.

- [ ] **Step 5: Run GREEN for projection cleanup tests**

Run:

```bash
npx vitest run tests/codex-memory-review.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/memory/memory-exporter.ts tests/codex-memory-review.test.ts
git commit -m "fix: guard generated projection cleanup"
```

---

### Task 5: Update Public Wording, MCP Descriptions, And Runtime Bundle

**Files:**
- Modify: `README.md`
- Modify: `plugin/skills/cyrene-continuity/SKILL.md`
- Modify: `src/mcp/mcp-server.ts`
- Modify: `tests/mcp-server.test.ts`
- Generated modify: `plugin/runtime/cyrene-continuity.mjs`

- [ ] **Step 1: Update skill behavior**

In `plugin/skills/cyrene-continuity/SKILL.md`, replace item 18:

```md
18. Repeated independent evidence may auto-promote only after the scheduled `Dream Deep` pass; do not treat a new pending candidate as active before then.
```

with:

```md
18. Repeated independent evidence may make a pending candidate recommended-for-review during Dream maintenance, but it must not become active memory without explicit user approval and review-hash validation.
```

- [ ] **Step 2: Update README Dream wording**

In `README.md`, replace the paragraph:

```md
`deep-preview` is the default safe dream stage. It writes review artifacts under
`dream-preview/` and does not promote, reject, or tombstone memory. `deep-apply`
recomputes the proposal, runs the deterministic eval gate, and only mutates
memory when the gate passes.
```

with:

```md
`deep-preview` is the default safe dream stage. It writes review artifacts under
`dream-preview/` and does not promote, reject, or tombstone memory. `deep-apply`
recomputes the proposal, runs the deterministic eval gate, applies safe
reject/expire operations, runs maintenance, and writes review artifacts, but it
does not promote unapproved pending memory. Promotion still requires explicit
user approval through the review-hash gated pending review tools.
```

Add this paragraph after the embedding paragraph:

```md
`CYRENE_MEMORY_AUTO_PROMOTE` is deprecated. Use
`CYRENE_MEMORY_RECOMMEND_PROMOTION` to control Dream promotion recommendations;
neither setting can bypass explicit approval and review-hash validation for
active memory promotion.
```

- [ ] **Step 3: Update MCP Dream tool description**

In `src/mcp/mcp-server.ts`, change the `cyrene_memory_dream_run` description to:

```ts
'Run a Cyrene Codex memory dream pass. Use deep-preview for read-only proposed changes and deep-apply for gated maintenance; Dream recommends promotion but does not promote unapproved pending memory.'
```

- [ ] **Step 4: Update MCP/server wording tests**

In `tests/mcp-server.test.ts`, update `documents strict dream preview and apply MCP schema`:

```ts
expect(serverSource).toContain('Dream recommends promotion but does not promote unapproved pending memory')
```

In `documents pending review behavior in the Codex continuity skill`, replace:

```ts
expect(source).toContain('Dream Deep')
```

with:

```ts
expect(source).toContain('recommended-for-review')
expect(source).not.toContain('auto-promote')
```

- [ ] **Step 5: Run wording tests**

Run:

```bash
npx vitest run tests/mcp-server.test.ts
```

Expected: PASS.

- [ ] **Step 6: Build plugin runtime**

Run:

```bash
npm run build:plugin
```

Expected: exits 0 and rewrites `plugin/runtime/cyrene-continuity.mjs`.

- [ ] **Step 7: Verify generated runtime picked up policy changes**

Run:

```bash
rg -n "auto-promote|auto promote:|memoryAutoPromoteEnabled|Repeated independent evidence may auto-promote" README.md plugin src tests
```

Expected: no matches.

Run:

```bash
rg -n "CYRENE_MEMORY_AUTO_PROMOTE|CYRENE_MEMORY_RECOMMEND_PROMOTION|recommended-for-review|recommend_promote" README.md plugin src tests
```

Expected: matches only for deprecated config compatibility, new recommend config, skill wording, and Dream recommendation action.

- [ ] **Step 8: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: all commands pass.

- [ ] **Step 9: Commit Task 5**

```bash
git add README.md plugin/skills/cyrene-continuity/SKILL.md src/mcp/mcp-server.ts tests/mcp-server.test.ts plugin/runtime/cyrene-continuity.mjs
git commit -m "docs: clarify dream promotion review policy"
```

---

## Final Verification

After all tasks:

```bash
git status --short
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected:

- `git status --short` is clean after commits.
- All tests pass.
- Typecheck passes.
- Plugin runtime is current.
- Plugin validator passes.

Manual policy checks:

```bash
rg -n "auto-promote|auto promote:|memoryAutoPromoteEnabled|Repeated independent evidence may auto-promote" README.md plugin src tests
rg -n "action: 'promote'|action === 'promote'|action: \"promote\"" src/codex src/eval tests
```

Expected:

- First command has no output.
- Second command only shows manual pending review promotion, eval gate detection for forbidden/legacy promote proposed changes, and tests that explicitly validate those gates.
