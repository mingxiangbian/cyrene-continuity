# Cyrene v3 PR3 Memory Review CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加 `codex memory review|approve|reject|edit|defer`，让用户能在 CLI 中完整审阅 pending memory，并让 CLI/MCP 共用 review hash、validator、policy gate。

**Architecture:** `src/codex/memory-review.ts` 继续作为唯一 review 决策层，新增 review metadata、`edit`、`defer` 共享函数；CLI 只负责参数解析和展示，MCP 只负责 schema/handler 转发。所有会改写 pending/active/tombstone 的路径都必须在 memory maintenance lock 内重新读取 candidate 并校验 review hash。

**Tech Stack:** TypeScript, Vitest, JSONL memory store, Codex CLI, MCP SDK, local plugin runtime build.

---

## Files

- Modify: `src/codex/memory-review.ts`
  - 增加 `candidateKind`、`recommendation`、`risk`、`sensitivity`、`evidenceCount`、`suggestedAction` 到 `CodexPendingMemorySummary`。
  - 新增 `editCodexPendingMemory` 和 `deferCodexPendingMemory`。
- Create: `src/codex/codex-memory-review-cli.ts`
  - 格式化 `codex memory review`。
  - 将 `approve/reject/edit/defer` CLI 调用转成共享 review 函数。
- Modify: `src/codex/codex-cli.ts`
  - 增加 `codex memory review`、`approve`、`reject`、`edit`、`defer` 路由和参数校验。
- Modify: `src/mcp/tools/memory-review.ts`
  - MCP handler 继续复用 `memory-review.ts`，并新增 `edit/defer` handler。
- Modify: `src/mcp/mcp-server.ts`
  - 注册 `cyrene_memory_edit` 和 `cyrene_memory_defer`。
- Modify: `tests/codex-memory-review.test.ts`
  - 覆盖 review summary metadata、edit/defer hash enforcement、validator rejection。
- Modify: `tests/codex-cli.test.ts`
  - 覆盖 CLI review 输出和 CLI actions。
- Modify: `tests/mcp-server.test.ts`
  - 覆盖 MCP edit/defer handler 和 tool exposure。
- Modify: `README.md`
  - 记录新的 review CLI 和 MCP tools。
- Generated: `plugin/runtime/cyrene-continuity.mjs`
  - 由 `npm run build:plugin` 生成。

---

### Task 1: Review Summary Metadata

**Files:**
- Modify: `src/codex/memory-review.ts`
- Test: `tests/codex-memory-review.test.ts`

- [ ] **Step 1: Write failing metadata test**

Add this test inside `describe('Codex pending memory review', () => { ... })`:

```ts
  it('summarizes pending review metadata for CLI display', async () => {
    const home = await createTempDir('cyrene-review-summary-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-summary-project-')
    const candidate = createPending({
      id: 'summary-promote',
      type: 'procedural_rule',
      seenCount: 2,
      evidence: [
        { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First independent evidence.' },
        { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second independent evidence.' }
      ]
    })
    await seedPending(cwd, [candidate])

    const result = await listCodexPendingMemories({ cwd })

    expect(result.pending[0]).toMatchObject({
      id: 'summary-promote',
      recommendation: 'promote',
      type: 'procedural_rule',
      scope: 'project',
      domain: 'procedural',
      candidateKind: 'workflow_rule',
      content: candidate.content,
      evidenceCount: 2,
      risk: 'low',
      sensitivity: 0.1,
      suggestedAction: `cyrene-continuity codex memory approve summary-promote --review-hash ${reviewHashForPendingMemory(candidate)}`
    })
  })
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/codex-memory-review.test.ts -t "summarizes pending review metadata for CLI display"
```

Expected: FAIL because `recommendation`, `candidateKind`, `evidenceCount`, `risk`, `sensitivity`, and `suggestedAction` are missing.

- [ ] **Step 3: Implement metadata**

In `src/codex/memory-review.ts`, import `evaluatePendingPromotion` and update the summary interface:

```ts
import {
  activateCandidate,
  evaluatePendingPromotion,
  validateMemoryCandidate
} from '../memory/memory-validator.js'

export type CodexMemoryCandidateKind =
  | 'project_fact'
  | 'project_decision'
  | 'user_instruction'
  | 'workflow_rule'
  | 'known_pitfall'
  | 'rejected_approach'
  | 'open_question'

export type CodexPendingMemoryRecommendation = 'promote' | 'reject' | 'defer'
export type CodexPendingMemoryRisk = 'low' | 'medium' | 'high'

export interface CodexPendingMemorySummary {
  id: string
  domain: PendingMemory['domain']
  type: PendingMemory['type']
  strength: PendingMemory['strength']
  scope: PendingMemory['scope']
  candidateKind: CodexMemoryCandidateKind
  recommendation: CodexPendingMemoryRecommendation
  suggestedAction: string
  risk: CodexPendingMemoryRisk
  sensitivity: number
  evidenceCount: number
  content: string
  normalizedKey: string
  source: PendingMemory['source']
  seenCount: number
  firstSeenAt: string
  lastSeenAt: string
  expiresAt?: string
  reviewHash: string
  evidenceSummary: string[]
  scores: PendingMemory['scores']
}
```

Replace `summarizePendingMemory` with metadata derivation that does not mutate files:

```ts
export function summarizePendingMemory(candidate: PendingMemory, now = new Date().toISOString()): CodexPendingMemorySummary {
  const reviewHash = reviewHashForPendingMemory(candidate)
  const recommendation = deriveRecommendation(candidate, now)
  return {
    id: candidate.id,
    domain: candidate.domain,
    type: candidate.type,
    strength: candidate.strength,
    scope: candidate.scope,
    candidateKind: deriveCandidateKind(candidate),
    recommendation,
    suggestedAction: suggestedReviewAction(candidate.id, reviewHash, recommendation),
    risk: deriveRisk(candidate),
    sensitivity: candidate.scores.sensitivity,
    evidenceCount: candidate.evidence.length,
    content: candidate.content,
    normalizedKey: candidate.normalizedKey,
    source: candidate.source,
    seenCount: candidate.seenCount,
    firstSeenAt: candidate.firstSeenAt,
    lastSeenAt: candidate.lastSeenAt,
    expiresAt: candidate.expiresAt,
    reviewHash,
    evidenceSummary: candidate.evidence
      .map((entry) => entry.summary ?? entry.quote ?? entry.runId ?? '')
      .filter((text) => text.trim() !== ''),
    scores: candidate.scores
  }
}

function deriveRecommendation(candidate: PendingMemory, now: string): CodexPendingMemoryRecommendation {
  if (candidate.expiresAt <= now) {
    return 'reject'
  }
  const promotion = evaluatePendingPromotion(candidate, now)
  return promotion.promotable ? 'promote' : 'defer'
}

function deriveCandidateKind(candidate: PendingMemory): CodexMemoryCandidateKind {
  const tagKind = candidate.tags.find((tag): tag is CodexMemoryCandidateKind =>
    tag === 'project_fact' ||
    tag === 'project_decision' ||
    tag === 'user_instruction' ||
    tag === 'workflow_rule' ||
    tag === 'known_pitfall' ||
    tag === 'rejected_approach' ||
    tag === 'open_question'
  )
  if (tagKind !== undefined) return tagKind
  if (candidate.type === 'project_fact') return 'project_fact'
  if (candidate.type === 'procedural_rule' || candidate.type === 'system_policy') return 'workflow_rule'
  if (
    candidate.type === 'user_preference' ||
    candidate.type === 'interaction_style' ||
    candidate.type === 'relationship_boundary' ||
    candidate.type === 'affective_pattern'
  ) return 'user_instruction'
  if (candidate.type === 'episode') return 'project_fact'
  return 'project_fact'
}

function deriveRisk(candidate: PendingMemory): CodexPendingMemoryRisk {
  if (candidate.scores.safety < 0.65 || candidate.scores.sensitivity > 0.6) return 'high'
  if (candidate.scores.safety < 0.8 || candidate.scores.sensitivity > 0.45) return 'medium'
  return 'low'
}

function suggestedReviewAction(
  candidateId: string,
  reviewHash: string,
  recommendation: CodexPendingMemoryRecommendation
): string {
  if (recommendation === 'promote') {
    return `cyrene-continuity codex memory approve ${candidateId} --review-hash ${reviewHash}`
  }
  if (recommendation === 'reject') {
    return `cyrene-continuity codex memory reject ${candidateId} --review-hash ${reviewHash}`
  }
  return `cyrene-continuity codex memory defer ${candidateId} --review-hash ${reviewHash}`
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/codex-memory-review.test.ts -t "summarizes pending review metadata for CLI display"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codex/memory-review.ts tests/codex-memory-review.test.ts
git commit -m "feat: add pending memory review metadata"
```

---

### Task 2: Shared Edit And Defer Review Operations

**Files:**
- Modify: `src/codex/memory-review.ts`
- Test: `tests/codex-memory-review.test.ts`

- [ ] **Step 1: Write failing tests**

Add imports:

```ts
  deferCodexPendingMemory,
  editCodexPendingMemory,
```

Add these tests:

```ts
  it('edits pending memory only after hash confirmation and validator approval', async () => {
    const home = await createTempDir('cyrene-review-edit-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-edit-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await editCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      content: 'Use Codex chat approval and review hash before promoting pending memory.',
      reason: 'User edited candidate wording.',
      now: '2026-05-25T02:00:00.000Z'
    })

    expect(result.result.action).toBe('edit')
    const pending = parseJsonLines<PendingMemory>(await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8'))
    expect(pending[0]).toMatchObject({
      id: candidate.id,
      content: 'Use Codex chat approval and review hash before promoting pending memory.',
      lastSeenAt: '2026-05-25T02:00:00.000Z'
    })
    const events = parseJsonLines<MemoryEvent>(await readFile(join(memoryRoot, 'events.jsonl'), 'utf8'))
    expect(events).toEqual([
      expect.objectContaining({
        action: 'pending',
        candidateId: candidate.id,
        reason: 'User edited candidate wording.'
      })
    ])
  })

  it('defers pending memory only after hash confirmation', async () => {
    const home = await createTempDir('cyrene-review-defer-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-defer-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await deferCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      days: 14,
      reason: 'User deferred review.',
      now: '2026-05-25T02:00:00.000Z'
    })

    expect(result.result.action).toBe('defer')
    const pending = parseJsonLines<PendingMemory>(await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8'))
    expect(pending[0]).toMatchObject({
      id: candidate.id,
      promoteAfter: '2026-06-08T02:00:00.000Z'
    })
  })

  it('edit and defer return conflict when review hash is stale', async () => {
    const home = await createTempDir('cyrene-review-edit-conflict-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-edit-conflict-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])

    const edit = await editCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: 'stale',
      content: 'Changed content.'
    })
    const defer = await deferCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: 'stale'
    })

    expect(edit.result.action).toBe('conflict')
    expect(defer.result.action).toBe('conflict')
    expect(await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).toContain(candidate.content)
  })

  it('does not edit pending memory when validator rejects the edited candidate', async () => {
    const home = await createTempDir('cyrene-review-edit-reject-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-edit-reject-project-')
    const candidate = createPending()
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await editCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      content: 'The user is emotionally dependent and unstable.',
      now: '2026-05-25T02:00:00.000Z'
    })

    expect(result.result.action).toBe('rejected_by_validator')
    expect(await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).toContain(candidate.content)
  })
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/codex-memory-review.test.ts -t "edits pending memory|defers pending memory|edit and defer return conflict|does not edit pending memory"
```

Expected: FAIL because `editCodexPendingMemory` and `deferCodexPendingMemory` do not exist.

- [ ] **Step 3: Implement shared operations**

In `src/codex/memory-review.ts`, add result interfaces:

```ts
export interface CodexPendingMemoryEditResult {
  project: CodexPendingMemoryProject
  memoryRoot: string
  result:
    | { action: 'edit'; candidateId: string; candidate: PendingMemory; reviewHash: string }
    | { action: 'not_found'; candidateId: string; reason: string }
    | { action: 'conflict'; candidateId: string; reason: string; latest: CodexPendingMemorySummary }
    | { action: 'rejected_by_validator'; candidateId: string; reason: string; tombstone: MemoryTombstone }
}

export interface CodexPendingMemoryDeferResult {
  project: CodexPendingMemoryProject
  memoryRoot: string
  result:
    | { action: 'defer'; candidateId: string; candidate: PendingMemory; reviewHash: string }
    | { action: 'not_found'; candidateId: string; reason: string }
    | { action: 'conflict'; candidateId: string; reason: string; latest: CodexPendingMemorySummary }
}
```

Add these exported functions:

```ts
export async function editCodexPendingMemory(input: {
  cwd: string
  id: string
  reviewHash: string
  content: string
  normalizedKey?: string
  reason?: string
  now?: string
}): Promise<CodexPendingMemoryEditResult> {
  const now = input.now ?? new Date().toISOString()
  const { project, memoryRoot, candidate } = await findPendingCandidateInCodexRoots(input.cwd, input.id)
  if (candidate === undefined) {
    return { project, memoryRoot, result: { action: 'not_found', candidateId: input.id, reason: 'Pending memory candidate not found' } }
  }
  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const lockedPending = await readPendingMemoriesFromRoot(lockedMemoryRoot)
    const lockedCandidate = lockedPending.find((memoryCandidate) => memoryCandidate.id === candidate.id)
    if (lockedCandidate === undefined) {
      return { project, memoryRoot: lockedMemoryRoot, result: { action: 'not_found', candidateId: candidate.id, reason: 'Pending memory candidate not found' } }
    }
    const lockedReviewHash = reviewHashForPendingMemory(lockedCandidate)
    if (lockedReviewHash !== input.reviewHash) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'conflict',
          candidateId: candidate.id,
          reason: 'Pending memory candidate changed since review',
          latest: summarizePendingMemory(lockedCandidate)
        }
      }
    }
    const editedCandidate: PendingMemory = {
      ...lockedCandidate,
      content: input.content,
      normalizedKey: input.normalizedKey ?? lockedCandidate.normalizedKey,
      lastSeenAt: now
    }
    const [active, tombstones] = await Promise.all([
      readActiveMemoriesFromRoot(lockedMemoryRoot),
      readTombstonesFromRoot(lockedMemoryRoot)
    ])
    const decision = validateMemoryCandidate({ candidate: editedCandidate, existingMemories: active, tombstones, now })
    if (decision.action === 'reject') {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: { action: 'rejected_by_validator', candidateId: candidate.id, reason: decision.reason, tombstone: decision.tombstone }
      }
    }
    const nextPending = lockedPending.map((memoryCandidate) => memoryCandidate.id === candidate.id ? editedCandidate : memoryCandidate)
    await writePendingMemoriesFromRoot(lockedMemoryRoot, nextPending)
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'pending',
      at: now,
      reason: input.reason ?? 'Edited by Codex pending memory review',
      candidateId: editedCandidate.id,
      details: { reviewAction: 'edit' }
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })
    return {
      project,
      memoryRoot: lockedMemoryRoot,
      result: {
        action: 'edit',
        candidateId: editedCandidate.id,
        candidate: editedCandidate,
        reviewHash: reviewHashForPendingMemory(editedCandidate)
      }
    }
  })
}

export async function deferCodexPendingMemory(input: {
  cwd: string
  id: string
  reviewHash: string
  days?: number
  reason?: string
  now?: string
}): Promise<CodexPendingMemoryDeferResult> {
  const now = input.now ?? new Date().toISOString()
  const days = input.days ?? 7
  const { project, memoryRoot, candidate } = await findPendingCandidateInCodexRoots(input.cwd, input.id)
  if (candidate === undefined) {
    return { project, memoryRoot, result: { action: 'not_found', candidateId: input.id, reason: 'Pending memory candidate not found' } }
  }
  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const lockedPending = await readPendingMemoriesFromRoot(lockedMemoryRoot)
    const lockedCandidate = lockedPending.find((memoryCandidate) => memoryCandidate.id === candidate.id)
    if (lockedCandidate === undefined) {
      return { project, memoryRoot: lockedMemoryRoot, result: { action: 'not_found', candidateId: candidate.id, reason: 'Pending memory candidate not found' } }
    }
    const lockedReviewHash = reviewHashForPendingMemory(lockedCandidate)
    if (lockedReviewHash !== input.reviewHash) {
      return {
        project,
        memoryRoot: lockedMemoryRoot,
        result: {
          action: 'conflict',
          candidateId: candidate.id,
          reason: 'Pending memory candidate changed since review',
          latest: summarizePendingMemory(lockedCandidate)
        }
      }
    }
    const deferredCandidate: PendingMemory = {
      ...lockedCandidate,
      promoteAfter: addDays(now, days)
    }
    const nextPending = lockedPending.map((memoryCandidate) => memoryCandidate.id === candidate.id ? deferredCandidate : memoryCandidate)
    await writePendingMemoriesFromRoot(lockedMemoryRoot, nextPending)
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'pending',
      at: now,
      reason: input.reason ?? 'Deferred by Codex pending memory review',
      candidateId: deferredCandidate.id,
      details: { reviewAction: 'defer', days }
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })
    return {
      project,
      memoryRoot: lockedMemoryRoot,
      result: {
        action: 'defer',
        candidateId: deferredCandidate.id,
        candidate: deferredCandidate,
        reviewHash: reviewHashForPendingMemory(deferredCandidate)
      }
    }
  })
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/codex-memory-review.test.ts -t "edits pending memory|defers pending memory|edit and defer return conflict|does not edit pending memory"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codex/memory-review.ts tests/codex-memory-review.test.ts
git commit -m "feat: add editable pending memory review decisions"
```

---

### Task 3: CLI Review Commands

**Files:**
- Create: `src/codex/codex-memory-review-cli.ts`
- Modify: `src/codex/codex-cli.ts`
- Test: `tests/codex-cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Add import:

```ts
import { reviewHashForPendingMemory } from '../src/codex/memory-review.js'
```

Add helper:

```ts
async function seedCliPending(cwd: string, candidate: PendingMemory): Promise<string> {
  const identity = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(identity.projectId)
  await mkdir(memoryRoot, { recursive: true })
  await writeFile(join(memoryRoot, 'pending.jsonl'), `${JSON.stringify(candidate)}\n`, 'utf8')
  return memoryRoot
}
```

Add tests:

```ts
  it('memory review lists pending candidates with review metadata', async () => {
    const home = await createTempDir('cyrene-codex-cli-review-home-')
    const cwd = await createTempDir('cyrene-codex-cli-review-project-')
    process.env.HOME = home
    const candidate = createPending()
    await seedCliPending(cwd, candidate)

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', cwd, 'codex', 'memory', 'review'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Cyrene Pending Memory Review')
    expect(result.stdout).toContain('id: cli-pending-1')
    expect(result.stdout).toContain('recommendation: promote')
    expect(result.stdout).toContain('candidate kind: workflow_rule')
    expect(result.stdout).toContain('evidence count: 2')
    expect(result.stdout).toContain(`review hash: ${reviewHashForPendingMemory(candidate)}`)
    expect(result.stdout).toContain(`suggested action: cyrene-continuity codex memory approve cli-pending-1 --review-hash ${reviewHashForPendingMemory(candidate)}`)
  })

  it('memory approve/reject/edit/defer route through hash-checked review functions', async () => {
    const home = await createTempDir('cyrene-codex-cli-review-actions-home-')
    const cwd = await createTempDir('cyrene-codex-cli-review-actions-project-')
    process.env.HOME = home
    const editCandidate = createPending({ id: 'cli-edit-1', normalizedKey: 'cli-edit-1' })
    const deferCandidate = createPending({ id: 'cli-defer-1', normalizedKey: 'cli-defer-1' })
    const rejectCandidate = createPending({ id: 'cli-reject-1', normalizedKey: 'cli-reject-1' })
    const approveCandidate = createPending({ id: 'cli-approve-1', normalizedKey: 'cli-approve-1' })
    const memoryRoot = await seedCliPending(cwd, [editCandidate, deferCandidate, rejectCandidate, approveCandidate])

    const edit = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', cwd, 'codex', 'memory', 'edit',
        'cli-edit-1', '--review-hash', reviewHashForPendingMemory(editCandidate), '--content', 'Edited CLI pending memory.'
      ],
      { env: cliEnv(home) }
    )
    expect(JSON.parse(edit.stdout).result.action).toBe('edit')

    const defer = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', cwd, 'codex', 'memory', 'defer',
        'cli-defer-1', '--review-hash', reviewHashForPendingMemory(deferCandidate), '--days', '14'
      ],
      { env: cliEnv(home) }
    )
    expect(JSON.parse(defer.stdout).result.action).toBe('defer')

    const reject = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', cwd, 'codex', 'memory', 'reject',
        'cli-reject-1', '--review-hash', reviewHashForPendingMemory(rejectCandidate)
      ],
      { env: cliEnv(home) }
    )
    expect(JSON.parse(reject.stdout).result.action).toBe('reject')

    const approve = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', cwd, 'codex', 'memory', 'approve',
        'cli-approve-1', '--review-hash', reviewHashForPendingMemory(approveCandidate)
      ],
      { env: cliEnv(home) }
    )
    expect(JSON.parse(approve.stdout).result.action).toBe('promote')

    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain('Edited CLI pending memory.')
    expect(pending).toContain('cli-defer-1')
    expect(pending).not.toContain('cli-reject-1')
    expect(pending).not.toContain('cli-approve-1')
  })
```

Adjust `seedCliPending` signature to accept a single item or list:

```ts
async function seedCliPending(cwd: string, pending: PendingMemory | PendingMemory[]): Promise<string> {
  const identity = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(identity.projectId)
  const values = Array.isArray(pending) ? pending : [pending]
  await mkdir(memoryRoot, { recursive: true })
  await writeFile(join(memoryRoot, 'pending.jsonl'), values.map((item) => JSON.stringify(item)).join('\n') + '\n', 'utf8')
  return memoryRoot
}
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/codex-cli.test.ts -t "memory review lists|memory approve/reject/edit/defer"
```

Expected: FAIL because CLI commands are not routed.

- [ ] **Step 3: Implement CLI formatter and routes**

Create `src/codex/codex-memory-review-cli.ts`:

```ts
import {
  deferCodexPendingMemory,
  editCodexPendingMemory,
  listCodexPendingMemories,
  promoteCodexPendingMemory,
  rejectCodexPendingMemory
} from './memory-review.js'

export async function formatCodexMemoryReview(input: { cwd: string; limit?: number }): Promise<string> {
  const result = await listCodexPendingMemories(input)
  const lines = [
    'Cyrene Pending Memory Review',
    `project: ${result.project.displayName} (${result.project.projectId})`,
    `memory root: ${result.memoryRoot}`,
    `pending: ${result.pending.length}/${result.total}`,
    ''
  ]
  if (result.pending.length === 0) {
    lines.push('No pending memory candidates.')
    return `${lines.join('\n')}\n`
  }
  for (const item of result.pending) {
    lines.push(
      `- id: ${item.id}`,
      `  recommendation: ${item.recommendation}`,
      `  type: ${item.type}`,
      `  scope: ${item.scope}`,
      `  domain: ${item.domain}`,
      `  candidate kind: ${item.candidateKind}`,
      `  content: ${item.content}`,
      `  evidence count: ${item.evidenceCount}`,
      `  risk: ${item.risk}`,
      `  sensitivity: ${item.sensitivity}`,
      `  review hash: ${item.reviewHash}`,
      `  suggested action: ${item.suggestedAction}`
    )
  }
  return `${lines.join('\n')}\n`
}

export async function runCodexMemoryApprove(input: { cwd: string; id: string; reviewHash: string; reason?: string }): Promise<string> {
  return `${JSON.stringify(await promoteCodexPendingMemory(input), null, 2)}\n`
}

export async function runCodexMemoryReject(input: { cwd: string; id: string; reviewHash: string; reason?: string }): Promise<string> {
  return `${JSON.stringify(await rejectCodexPendingMemory(input), null, 2)}\n`
}

export async function runCodexMemoryEdit(input: {
  cwd: string
  id: string
  reviewHash: string
  content: string
  normalizedKey?: string
  reason?: string
}): Promise<string> {
  return `${JSON.stringify(await editCodexPendingMemory(input), null, 2)}\n`
}

export async function runCodexMemoryDefer(input: {
  cwd: string
  id: string
  reviewHash: string
  days?: number
  reason?: string
}): Promise<string> {
  return `${JSON.stringify(await deferCodexPendingMemory(input), null, 2)}\n`
}
```

In `src/codex/codex-cli.ts`, import these functions:

```ts
import {
  formatCodexMemoryReview,
  runCodexMemoryApprove,
  runCodexMemoryDefer,
  runCodexMemoryEdit,
  runCodexMemoryReject
} from './codex-memory-review-cli.js'
```

Add route handling before `memory dream`:

```ts
  if (command === 'memory' && input.args[1] === 'review') {
    process.stdout.write(await formatCodexMemoryReview({
      cwd: input.cwd,
      limit: parseOptionalPositiveInteger(input.args, '--limit')
    }))
    return
  }

  if (command === 'memory' && input.args[1] === 'approve') {
    process.stdout.write(await runCodexMemoryApprove({
      cwd: input.cwd,
      id: parseRequiredPositional(input.args, 2, 'pending memory id'),
      reviewHash: parseRequiredOption(input.args, '--review-hash', 'pending review hash'),
      reason: parseOptionalOption(input.args, '--reason')
    }))
    return
  }

  if (command === 'memory' && input.args[1] === 'reject') {
    process.stdout.write(await runCodexMemoryReject({
      cwd: input.cwd,
      id: parseRequiredPositional(input.args, 2, 'pending memory id'),
      reviewHash: parseRequiredOption(input.args, '--review-hash', 'pending review hash'),
      reason: parseOptionalOption(input.args, '--reason')
    }))
    return
  }

  if (command === 'memory' && input.args[1] === 'edit') {
    process.stdout.write(await runCodexMemoryEdit({
      cwd: input.cwd,
      id: parseRequiredPositional(input.args, 2, 'pending memory id'),
      reviewHash: parseRequiredOption(input.args, '--review-hash', 'pending review hash'),
      content: parseRequiredOption(input.args, '--content', 'pending memory content'),
      normalizedKey: parseOptionalOption(input.args, '--normalized-key'),
      reason: parseOptionalOption(input.args, '--reason')
    }))
    return
  }

  if (command === 'memory' && input.args[1] === 'defer') {
    process.stdout.write(await runCodexMemoryDefer({
      cwd: input.cwd,
      id: parseRequiredPositional(input.args, 2, 'pending memory id'),
      reviewHash: parseRequiredOption(input.args, '--review-hash', 'pending review hash'),
      days: parseOptionalPositiveInteger(input.args, '--days'),
      reason: parseOptionalOption(input.args, '--reason')
    }))
    return
  }
```

Add parser helpers:

```ts
function parseRequiredPositional(args: string[], index: number, label: string): string {
  const value = args[index]
  if (value === undefined || value === '' || value.startsWith('--')) {
    throw new Error(`Invalid ${label}: missing value`)
  }
  return value
}

function parseOptionalPositiveInteger(args: string[], option: string): number | undefined {
  const value = parseOptionalOption(args, option)
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${option}: expected positive integer`)
  }
  return parsed
}
```

Update usage text to include:

```txt
memory review [--limit <n>]|memory approve <id> --review-hash <hash>|memory reject <id> --review-hash <hash>|memory edit <id> --review-hash <hash> --content <text>|memory defer <id> --review-hash <hash> [--days <n>]
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/codex-cli.test.ts -t "memory review lists|memory approve/reject/edit/defer"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codex/codex-memory-review-cli.ts src/codex/codex-cli.ts tests/codex-cli.test.ts
git commit -m "feat: expose memory review commands in codex cli"
```

---

### Task 4: MCP Edit/Defer Parity And Docs

**Files:**
- Modify: `src/mcp/tools/memory-review.ts`
- Modify: `src/mcp/mcp-server.ts`
- Modify: `tests/mcp-server.test.ts`
- Modify: `README.md`
- Generated: `plugin/runtime/cyrene-continuity.mjs`

- [ ] **Step 1: Write failing MCP test**

Update imports in `tests/mcp-server.test.ts`:

```ts
  handleMemoryDefer,
  handleMemoryEdit,
```

Extend the pending review test after `getJson`:

```ts
    const editJson = JSON.parse(
      (await handleMemoryEdit(
        {
          cwd,
          id: candidateId,
          reviewHash,
          content: 'Pending memory review edit tools are exposed through MCP.',
          reason: 'Covered by MCP edit test.'
        },
        process.cwd()
      )).content[0]?.text ?? '{}'
    )
    expect(editJson.result.action).toBe('edit')
    const editedReviewHash = editJson.result.reviewHash

    const deferJson = JSON.parse(
      (await handleMemoryDefer(
        { cwd, id: candidateId, reviewHash: editedReviewHash, days: 14, reason: 'Covered by MCP defer test.' },
        process.cwd()
      )).content[0]?.text ?? '{}'
    )
    expect(deferJson.result.action).toBe('defer')
```

Update tool exposure assertion:

```ts
      expect(names).toContain('cyrene_memory_edit')
      expect(names).toContain('cyrene_memory_defer')
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/mcp-server.test.ts -t "pending memory review MCP actions|fresh MCP server"
```

Expected: FAIL because handlers and tools do not exist.

- [ ] **Step 3: Implement MCP parity**

In `src/mcp/tools/memory-review.ts`, import shared functions:

```ts
  deferCodexPendingMemory,
  editCodexPendingMemory,
```

Add schemas:

```ts
export const memoryReviewEditInputSchema = {
  cwd: z.string().optional(),
  id: z.string(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string().min(1),
  normalizedKey: z.string().optional(),
  reason: z.string().optional()
}

export const memoryReviewDeferInputSchema = {
  cwd: z.string().optional(),
  id: z.string(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  days: z.number().int().positive().optional(),
  reason: z.string().optional()
}
```

Add handlers:

```ts
export async function handleMemoryEdit(
  input: { cwd?: string; id: string; reviewHash: string; content: string; normalizedKey?: string; reason?: string },
  fallbackCwd: string
) {
  const result = await editCodexPendingMemory({
    cwd: input.cwd ?? fallbackCwd,
    id: input.id,
    reviewHash: input.reviewHash,
    content: input.content,
    normalizedKey: input.normalizedKey,
    reason: input.reason
  })
  return jsonText(result)
}

export async function handleMemoryDefer(
  input: { cwd?: string; id: string; reviewHash: string; days?: number; reason?: string },
  fallbackCwd: string
) {
  const result = await deferCodexPendingMemory({
    cwd: input.cwd ?? fallbackCwd,
    id: input.id,
    reviewHash: input.reviewHash,
    days: input.days,
    reason: input.reason
  })
  return jsonText(result)
}
```

In `src/mcp/mcp-server.ts`, import the handlers/schemas and register tools:

```ts
  handleMemoryDefer,
  handleMemoryEdit,
  memoryReviewDeferInputSchema,
  memoryReviewEditInputSchema,
```

```ts
  server.registerTool(
    'cyrene_memory_edit',
    {
      description:
        'Edit a pending Cyrene memory candidate only after hash-checked Codex review; the edited candidate stays pending.',
      inputSchema: memoryReviewEditInputSchema
    },
    async (input) => handleMemoryEdit(input, options.cwd)
  )

  server.registerTool(
    'cyrene_memory_defer',
    {
      description:
        'Defer a pending Cyrene memory candidate only after hash-checked Codex review; this never promotes active memory.',
      inputSchema: memoryReviewDeferInputSchema
    },
    async (input) => handleMemoryDefer(input, options.cwd)
  )
```

- [ ] **Step 4: Update README**

Add MCP bullets:

```md
- `cyrene_memory_edit`: edit a pending candidate after review-hash validation;
  the edited candidate remains pending.
- `cyrene_memory_defer`: defer a pending candidate after review-hash
  validation; this never promotes active memory.
```

Add commands:

```bash
npm run dev -- codex memory review
npm run dev -- codex memory approve <candidateId> --review-hash <hash>
npm run dev -- codex memory reject <candidateId> --review-hash <hash>
npm run dev -- codex memory edit <candidateId> --review-hash <hash> --content <text>
npm run dev -- codex memory defer <candidateId> --review-hash <hash> --days 7
```

Update Review Policy:

```md
Pending memory candidates are not active memory. Promotion requires explicit
user approval and a matching review hash. `codex memory review` shows the
candidate metadata needed for approval, rejection, edit, or deferral.
```

- [ ] **Step 5: Verify MCP/docs and build runtime**

Run:

```bash
npm test -- tests/mcp-server.test.ts -t "pending memory review MCP actions|fresh MCP server"
npm run build:plugin
```

Expected: both PASS. `plugin/runtime/cyrene-continuity.mjs` is updated.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/memory-review.ts src/mcp/mcp-server.ts tests/mcp-server.test.ts README.md plugin/runtime/cyrene-continuity.mjs
git commit -m "feat: add memory review mcp edit defer parity"
```

---

### Task 5: Full Verification

**Files:**
- No planned source edits unless verification exposes a PR3 bug.

- [ ] **Step 1: Run targeted review tests**

```bash
npm test -- tests/codex-memory-review.test.ts tests/codex-cli.test.ts tests/mcp-server.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Build plugin runtime**

```bash
npm run build:plugin
```

Expected: PASS.

- [ ] **Step 5: Validate plugin package**

```bash
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: validation succeeds.

- [ ] **Step 6: Final commit if verification changed generated runtime**

```bash
git status --short
git add plugin/runtime/cyrene-continuity.mjs
git commit -m "chore: rebuild plugin runtime for memory review cli"
```

Only run this commit if `plugin/runtime/cyrene-continuity.mjs` is dirty after verification and was not already committed in Task 4.

---

## Self-Review

- Spec coverage: PR3 CLI commands are covered by Task 3; shared review hash/validator/policy gate is covered by Tasks 1-2 and MCP parity in Task 4; required pending item display fields are covered by Task 1 and CLI test in Task 3.
- Bug/problem coverage: existing PR1/PR2 safety fixes are preserved; PR3 explicitly adds tests for stale review hash conflict, validator rejection, and shared CLI/MCP behavior so current review bugs cannot bypass policy.
- Placeholder scan: no unfinished placeholder markers or undefined task references remain.
- Type consistency: public names are `editCodexPendingMemory`, `deferCodexPendingMemory`, `formatCodexMemoryReview`, `runCodexMemoryApprove`, `runCodexMemoryReject`, `runCodexMemoryEdit`, and `runCodexMemoryDefer`.
