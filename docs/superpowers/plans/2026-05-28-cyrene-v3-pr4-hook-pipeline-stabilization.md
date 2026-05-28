# Cyrene v3 PR4 Hook Pipeline Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 稳定 Codex Stop Hook pipeline：hook 自动写 review-safe session summary，summary extractor 能稳定产生 pending candidate，hook failure 可见，并保证 hook 不 promote/reject/update active memory 或 profile。

**Architecture:** `src/codex/codex-hook-stop.ts` 负责 Stop Hook fail-open orchestration；`src/codex/review-summary-runtime.ts` 负责 review-safe summary 和 candidate extraction；`src/codex/memory-propose.ts` 保持 MCP 默认行为，但为 hook 增加 pending-only reject side-effect mode。Status/doctor 只读取 `review-summaries.jsonl`，不执行修复或 mutation。

**Tech Stack:** TypeScript, Vitest, JSONL memory store, Codex Stop Hook, local plugin runtime build.

---

## Files

- Modify: `src/codex/codex-hook-stop.ts`
  - 捕获 payload pipeline 内部异常并写 failed review summary。
  - explicit durable fallback 调用 pending-only proposal，validator reject 不写 tombstone/event。
- Modify: `src/codex/review-summary-runtime.ts`
  - summary-generated candidates 使用 pending-only proposal。
- Modify: `src/codex/memory-propose.ts`
  - 增加 `recordRejectedCandidate?: boolean`，默认保持现有 MCP 行为；hook 传 `false`。
- Modify: `src/codex/codex-memory-status.ts`
  - `readLatestReviewSummary` 读取 latest failed summary 的 `failureReason` 并显示在 status/doctor。
- Modify: `tests/codex-hook-stop.test.ts`
  - 覆盖 failed summary persistence、summary candidate pending-only、explicit fallback pending-only。
- Modify: `tests/codex-cli.test.ts`
  - 覆盖 memory status / doctor 显示 failed hook reason。
- Modify: `README.md`
  - 补充 Stop Hook pending-only / fail-open / visible failure policy。
- Generated: `plugin/runtime/cyrene-continuity.mjs`
  - 由 `npm run build:plugin` 生成。

---

### Task 1: Persist Visible Stop Hook Failures

**Files:**
- Modify: `src/codex/codex-hook-stop.ts`
- Modify: `src/codex/codex-memory-status.ts`
- Test: `tests/codex-hook-stop.test.ts`
- Test: `tests/codex-cli.test.ts`

- [ ] **Step 1: Write failing hook failure test**

Add this test inside `describe('Codex Stop hook runtime', () => { ... })` in `tests/codex-hook-stop.test.ts`:

```ts
  it('records visible failed summary when transcript read fails without blocking Codex', async () => {
    const home = await createTempDir('cyrene-codex-stop-failure-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-failure-project-')
    const transcript = join(cwd, 'transcript-dir')
    await mkdir(transcript)

    const result = await handleCodexStopHookPayload({
      cwd,
      session_id: 's-fail',
      turn_id: 't-fail',
      transcript_path: transcript
    })

    expect(result.action).toBe('summary_failed')
    expect(JSON.parse(formatCodexStopHookCommandOutput(result))).toEqual({ continue: true, suppressOutput: true })
    const identity = await identifyCodexProject(cwd)
    const summaries = await readFile(join(codexProjectMemoryRoot(identity.projectId), 'review-summaries.jsonl'), 'utf8')
    const [summary] = summaries.trim().split('\n').map((line) => JSON.parse(line) as {
      status: string
      sessionId?: string
      turnId?: string
      failureReason?: string
      summary?: string
    })
    expect(summary).toMatchObject({
      status: 'failed',
      sessionId: 's-fail',
      turnId: 't-fail',
      summary: 'Codex Stop hook failed; no transcript content persisted.'
    })
    expect(summary.failureReason).toEqual(expect.any(String))
  })
```

- [ ] **Step 2: Write failing status reason test**

Add this test near other memory status / doctor tests in `tests/codex-cli.test.ts`:

```ts
  it('reports failed Stop hook summary reason in memory status and doctor', async () => {
    const home = await createTempDir('cyrene-codex-cli-stop-hook-failure-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-stop-hook-failure-repo-')
    const identity = await identifyCodexProject(repo)
    const currentMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(currentMemoryRoot, { recursive: true })
    await writeFile(join(currentMemoryRoot, 'review-summaries.jsonl'), `${JSON.stringify({
      id: 'summary-failed-1',
      runId: 'session:turn',
      sessionId: 'session',
      turnId: 'turn',
      createdAt: '2026-05-28T00:00:00.000Z',
      status: 'failed',
      summary: 'Codex Stop hook failed; no transcript content persisted.',
      redaction: { input: {}, output: {} },
      candidateIds: [],
      failureReason: 'Transcript path is unreadable.'
    })}\n`)

    const status = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'status'],
      { env: cliEnv(home) }
    )
    const doctor = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'doctor'],
      { env: cliEnv(home) }
    )

    expect(status.stdout).toContain('last stop hook run: 2026-05-28T00:00:00.000Z (failed)')
    expect(status.stdout).toContain('stop hook reason: Transcript path is unreadable.')
    expect(doctor.stdout).toContain('last stop hook run: 2026-05-28T00:00:00.000Z (failed)')
    expect(doctor.stdout).toContain('stop hook reason: Transcript path is unreadable.')
  })
```

- [ ] **Step 3: Verify RED**

Run:

```bash
npm test -- tests/codex-hook-stop.test.ts -t "records visible failed summary"
npm test -- tests/codex-cli.test.ts -t "reports failed Stop hook summary reason"
```

Expected:
- first command FAILS because `handleCodexStopHookPayload` currently throws before writing failed summary.
- second command FAILS because `readLatestReviewSummary` does not surface `failureReason`.

- [ ] **Step 4: Implement failed summary persistence**

In `src/codex/codex-hook-stop.ts`, add imports:

```ts
import { randomUUID } from 'node:crypto'
import { ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'
import { redactReviewText } from './review-redaction.js'
import { appendCodexReviewSummary } from './review-summary-store.js'
```

Wrap the existing `handleCodexStopHookPayload` body by moving it into `handleCodexStopHookPayloadUnsafe`:

```ts
export async function handleCodexStopHookPayload(
  payload: CodexStopHookPayload,
  deps: CodexStopHookDeps = {}
): Promise<CodexStopHookResult> {
  const cwd = asString(payload.cwd) ?? process.cwd()
  try {
    return await handleCodexStopHookPayloadUnsafe(payload, deps, cwd)
  } catch (error) {
    return recordStopHookFailureSummary(cwd, payload, error)
  }
}

async function handleCodexStopHookPayloadUnsafe(
  payload: CodexStopHookPayload,
  deps: CodexStopHookDeps,
  cwd: string
): Promise<CodexStopHookResult> {
  const transcriptPath = asString(payload.transcript_path) ?? asString(payload.transcriptPath)
  // existing body continues here, without redeclaring cwd
}
```

Add helper:

```ts
async function recordStopHookFailureSummary(
  cwd: string,
  payload: CodexStopHookPayload,
  error: unknown
): Promise<CodexStopHookResult> {
  try {
    const project = await identifyCodexProject(cwd)
    const memoryRoot = await ensureCodexProjectMemoryRoot(project.projectId)
    const summaryId = randomUUID()
    const sessionId = asString(payload.session_id)
    const turnId = asString(payload.turn_id)
    const runId = [sessionId, turnId].filter(Boolean).join(':') || summaryId
    const reason = redactReviewText(error instanceof Error ? error.message : String(error))
    const failureReason = reason.text.slice(0, 500)
    await appendCodexReviewSummary(memoryRoot, {
      id: summaryId,
      runId,
      sessionId,
      turnId,
      createdAt: new Date().toISOString(),
      status: 'failed',
      summary: 'Codex Stop hook failed; no transcript content persisted.',
      redaction: { input: {}, output: reason.counts },
      candidateIds: [],
      failureReason
    })
    return { action: 'summary_failed', summaryId, reason: failureReason }
  } catch {
    return { action: 'summary_failed', reason: 'Stop hook command failed.' }
  }
}
```

- [ ] **Step 5: Implement failed reason status display**

In `src/codex/codex-memory-status.ts`, update `readLatestReviewSummary` parsing:

```ts
  let latest: { createdAt: string; status: 'ok' | 'failed'; failureReason?: string } | undefined
  try {
    for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      const parsed = JSON.parse(line) as { createdAt?: unknown; status?: unknown; failureReason?: unknown }
      if (typeof parsed.createdAt !== 'string' || !isSummaryStatus(parsed.status)) {
        continue
      }
      if (latest === undefined || parsed.createdAt > latest.createdAt) {
        latest = {
          createdAt: parsed.createdAt,
          status: parsed.status,
          failureReason: typeof parsed.failureReason === 'string' ? parsed.failureReason : undefined
        }
      }
    }
  } catch (error) {
    return { status: 'unreadable', reason: errorMessage(error) }
  }
```

Return latest failed reason:

```ts
  return {
    status: 'present',
    lastRunAt: latest.createdAt,
    lastRunStatus: latest.status,
    reason: latest.status === 'failed' ? latest.failureReason : undefined
  }
```

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm test -- tests/codex-hook-stop.test.ts -t "records visible failed summary"
npm test -- tests/codex-cli.test.ts -t "reports failed Stop hook summary reason"
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/codex/codex-hook-stop.ts src/codex/codex-memory-status.ts tests/codex-hook-stop.test.ts tests/codex-cli.test.ts
git commit -m "fix: record visible stop hook failures"
```

---

### Task 2: Make Hook Candidate Extraction Pending-Only

**Files:**
- Modify: `src/codex/memory-propose.ts`
- Modify: `src/codex/review-summary-runtime.ts`
- Modify: `src/codex/codex-hook-stop.ts`
- Test: `tests/codex-hook-stop.test.ts`

- [ ] **Step 1: Write failing rejected-summary test**

Add this test in `tests/codex-hook-stop.test.ts`:

```ts
  it('does not write tombstones or active memory when summary candidate is rejected by validator', async () => {
    const home = await createTempDir('cyrene-codex-stop-summary-reject-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-summary-reject-project-')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, JSON.stringify({ role: 'user', content: '请总结这次协作。' }) + '\n')

    const result = await handleCodexStopHookPayload(
      { cwd, transcript_path: transcript, session_id: 's-summary-reject', turn_id: 't-summary-reject' },
      {
        callModel: async () => ({
          content: JSON.stringify({
            summary: '模型返回了不安全候选。',
            candidates: [
              {
                domain: 'affective',
                type: 'affective_pattern',
                content: 'The user is emotionally dependent and unstable.',
                evidence: [{ summary: 'Unsafe diagnostic claim.' }]
              }
            ]
          }),
          toolCalls: []
        })
      }
    )

    expect(result.action).toBe('summary')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
```

- [ ] **Step 2: Strengthen existing explicit fallback rejection test**

In `tests/codex-hook-stop.test.ts`, update `keeps review summary when explicit durable fallback is rejected`:

```ts
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(memoryRoot, 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
```

- [ ] **Step 3: Verify RED**

Run:

```bash
npm test -- tests/codex-hook-stop.test.ts -t "summary candidate is rejected|explicit durable fallback is rejected"
```

Expected: FAIL because rejected hook candidates currently write tombstones/events.

- [ ] **Step 4: Add pending-only reject option to memory proposal**

In `src/codex/memory-propose.ts`, extend `proposeCodexMemoryCandidate` input:

```ts
export async function proposeCodexMemoryCandidate(input: {
  cwd: string
  candidate: CodexMemoryCandidateInput
  now?: string
  recordRejectedCandidate?: boolean
}): Promise<CodexMemoryProposeResult> {
```

Update reject branch:

```ts
    if (decision.action === 'reject') {
      if (input.recordRejectedCandidate !== false) {
        await appendTombstoneFromRoot(lockedMemoryRoot, decision.tombstone)
        await appendMemoryEventFromRoot(lockedMemoryRoot, {
          id: randomUUID(),
          action: 'reject',
          at: now,
          reason: decision.reason,
          candidateId: decision.tombstone.id
        })
      }
      return {
        project: { projectId: project.projectId, displayName: project.displayName },
        result: { action: 'reject', reason: decision.reason },
        memoryRoot: lockedMemoryRoot
      }
    }
```

- [ ] **Step 5: Use pending-only mode from hook summary runtime**

In `src/codex/review-summary-runtime.ts`, update the `proposeCodexMemoryCandidate` call:

```ts
      const result = await proposeCodexMemoryCandidate({
        cwd: input.cwd,
        candidate: safeCandidate,
        now: input.now,
        recordRejectedCandidate: false
      })
```

- [ ] **Step 6: Use pending-only mode from explicit durable fallback**

In `src/codex/codex-hook-stop.ts`, update `proposeExplicitMemoryCandidate`:

```ts
  return proposeCodexMemoryCandidate({
    cwd,
    candidate: {
      // existing candidate fields
    },
    recordRejectedCandidate: false
  })
```

- [ ] **Step 7: Verify GREEN**

Run:

```bash
npm test -- tests/codex-hook-stop.test.ts -t "summary candidate is rejected|explicit durable fallback is rejected"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/codex/memory-propose.ts src/codex/review-summary-runtime.ts src/codex/codex-hook-stop.ts tests/codex-hook-stop.test.ts
git commit -m "fix: keep stop hook extraction pending only"
```

---

### Task 3: Add End-To-End Hook Pipeline Test And Docs

**Files:**
- Modify: `tests/codex-hook-stop.test.ts`
- Modify: `README.md`
- Generated: `plugin/runtime/cyrene-continuity.mjs`

- [ ] **Step 1: Write pipeline test**

Add this test in `tests/codex-hook-stop.test.ts`:

```ts
  it('writes review summary and pending candidate without mutating active memory or profile', async () => {
    const home = await createTempDir('cyrene-codex-stop-pipeline-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-pipeline-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'index.jsonl'), `${JSON.stringify({
      id: 'active-1',
      domain: 'project',
      type: 'project_fact',
      strength: 'hard',
      scope: 'project',
      status: 'active',
      content: 'Existing active memory must remain unchanged.',
      normalizedKey: 'existing-active-memory',
      evidence: [{ runId: 'active-run', summary: 'Existing active seed.' }],
      source: 'file',
      scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 },
      createdAt: '2026-05-28T00:00:00.000Z',
      updatedAt: '2026-05-28T00:00:00.000Z',
      tags: ['seed']
    })}\n`)
    await writeFile(join(memoryRoot, 'MODEL_PROFILE.md'), '# Existing Profile\n')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, [
      JSON.stringify({ role: 'user', content: '以后这个项目默认用 review hash 审批 memory。' }),
      JSON.stringify({ role: 'assistant', content: '确认。' })
    ].join('\n') + '\n')

    const result = await handleCodexStopHookPayload(
      { cwd, transcript_path: transcript, session_id: 's-pipeline', turn_id: 't-pipeline' },
      {
        callModel: async () => ({
          content: JSON.stringify({
            summary: '用户要求项目 memory 审批使用 review hash。',
            candidates: [
              {
                domain: 'procedural',
                type: 'procedural_rule',
                strength: 'hard',
                scope: 'project',
                source: 'user_explicit',
                content: '项目 memory 审批必须使用 review hash。',
                evidence: [{ summary: '用户要求项目 memory 审批使用 review hash。' }]
              }
            ]
          }),
          toolCalls: []
        })
      }
    )

    expect(result.action).toBe('pending')
    await expect(readFile(join(memoryRoot, 'review-summaries.jsonl'), 'utf8')).resolves.toContain('用户要求项目 memory 审批使用 review hash。')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain('项目 memory 审批必须使用 review hash。')
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toContain('Existing active memory must remain unchanged.')
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.not.toContain('项目 memory 审批必须使用 review hash。')
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toBe('# Existing Profile\n')
    await expect(readFile(join(memoryRoot, 'tombstones.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
```

- [ ] **Step 2: Verify test**

Run:

```bash
npm test -- tests/codex-hook-stop.test.ts -t "writes review summary and pending candidate without mutating active memory or profile"
```

Expected: PASS after Tasks 1-2. If it fails, fix only the hook pipeline behavior needed by this test.

- [ ] **Step 3: Update README**

In `README.md`, update the Stop Hook feature/policy text:

```md
The optional Codex Stop hook writes review-safe session summaries and may
propose pending candidates. It is fail-open for Codex sessions, records failed
summary runs in `review-summaries.jsonl`, and never promotes, rejects, or
updates active memory/profile files from hook execution.
```

- [ ] **Step 4: Rebuild plugin runtime**

Run:

```bash
npm run build:plugin
```

Expected: PASS and `plugin/runtime/cyrene-continuity.mjs` updates.

- [ ] **Step 5: Commit**

```bash
git add tests/codex-hook-stop.test.ts README.md plugin/runtime/cyrene-continuity.mjs
git commit -m "test: cover stop hook pending-only pipeline"
```

---

### Task 4: Full Verification

**Files:**
- No planned source edits unless verification exposes a PR4 bug.

- [ ] **Step 1: Run targeted tests**

```bash
npm test -- tests/codex-hook-stop.test.ts tests/codex-review-summary-runtime.test.ts tests/codex-cli.test.ts
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

- [ ] **Step 6: Commit generated runtime if needed**

```bash
git status --short
git add plugin/runtime/cyrene-continuity.mjs
git commit -m "chore: rebuild plugin runtime for hook pipeline"
```

Only run this commit if `plugin/runtime/cyrene-continuity.mjs` is dirty after verification and was not already committed in Task 3.

---

## Self-Review

- Spec coverage: Stop Hook 自动记录 session summary is covered by Tasks 1 and 3; summary extractor pending candidate is covered by Tasks 2 and 3; hook never promotes/rejects/updates active profile is covered by Tasks 2 and 3; pipeline tests are added in Tasks 1-3.
- Existing bug/problem coverage: rejected candidates from hook no longer create tombstones/reject events; hook internal failures are visible through `memory status` and `doctor` instead of being silently indistinguishable from success.
- Placeholder scan: no unfinished placeholder markers or undefined task references remain.
- Type consistency: new public option is `recordRejectedCandidate?: boolean`; failed summary record still uses existing `CodexReviewSummaryRecord`.
