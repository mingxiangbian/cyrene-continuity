# Cyrene v1 Admission Gate Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用多个可回滚 PR/commit 实现 `Episode -> CandidateDraft -> AdmissionDecision -> Pending` 核心入口门控，先阻止低价值候选进入 pending。

**Architecture:** `PR1-PR4` 串行实现核心 schema、JSONL store、Stop Hook episode、draft sidecar、admission dry-run 和 admission apply。现有 `proposeCodexMemoryCandidate` 保留为底层 pending writer；Stop Hook、review summary、project harvester 和 explicit instruction 在 PR4 改为走 admission pipeline。

**Tech Stack:** TypeScript ES2022、NodeNext、Vitest、JSONL memory store、Codex Stop Hook、Cyrene memory validator、existing v5 pending review / auto-promote policy。

---

## Scope

本 plan 只覆盖 v1.0.0 第一阶段核心交付：`PR1` 到 `PR4`。

`PR5` 的 CLI/MCP/API/UI、`PR6` 的 Distillation 2.0、`PR7+` 的 Activation/Reflection/Principle 不在本 plan 内实现。它们在本 plan 末尾作为交接条件列出，等核心数据契约稳定后再各自写独立 plan。

## File Structure

- Modify: `src/memory/types.ts`
  - 增加 `EpisodeMemory`、`CandidateDraft`、`AdmissionDecision`、`AdmissionReason`、`AdmissionAction` 类型。
  - 为 `PendingMemory` 增加 optional admission lineage 字段。
- Modify: `src/memory/memory-store.ts`
  - 增加 `episodes.jsonl`、`candidate_drafts.jsonl`、`admission_decisions.jsonl` 的 append/read helpers。
  - 复用现有 symlink safety、memory root safety、JSONL parsing pattern。
- Create: `src/codex/episode-memory.ts`
  - 从 Stop Hook payload、transcript messages、review/harvest result 中构造 review-safe `EpisodeMemory`。
  - 提供 fail-open append helper。
- Create: `src/codex/candidate-drafts.ts`
  - 从 `CodexMemoryCandidateInput` 生成 `CandidateDraft`。
  - 提供 review summary / harvester / explicit instruction 的 draft append helper。
- Create: `src/codex/admission-gate.ts`
  - 实现 deterministic admission scoring、reason、action。
  - 不写 pending，不写 active。
- Create: `src/codex/admission-pipeline.ts`
  - 串联 draft append、admission decision append、conditional pending write。
  - 只在 `admit_to_pending` / `merge_with_existing` 时调用 `proposeCodexMemoryCandidate`。
- Modify: `src/codex/codex-hook-stop.ts`
  - Stop Hook 写 episode。
  - PR4 后 explicit durable instruction 走 admission pipeline。
  - 保持 fail-open。
- Modify: `src/codex/review-summary-runtime.ts`
  - PR2 先 sidecar 写 draft 并保留旧 pending 行为。
  - PR4 改为走 admission pipeline。
- Modify: `src/codex/project-memory-harvester.ts`
  - PR2 先 sidecar 写 draft 并保留旧 pending 行为。
  - PR4 改为走 admission pipeline。
- Test: `tests/codex-episode-memory.test.ts`
- Test: `tests/codex-candidate-drafts.test.ts`
- Test: `tests/codex-admission-gate.test.ts`
- Test: `tests/codex-admission-pipeline.test.ts`
- Modify existing tests:
  - `tests/codex-hook-stop.test.ts`
  - `tests/codex-review-summary-runtime.test.ts`
  - `tests/project-memory-harvester.test.ts`
  - `tests/codex-memory-propose.test.ts`

## PR1: Episode Layer

### Task 1: Add EpisodeMemory Type And Store

**Files:**
- Modify: `src/memory/types.ts`
- Modify: `src/memory/memory-store.ts`
- Create: `tests/codex-episode-memory.test.ts`

- [ ] **Step 1: Write failing episode store tests**

Add this file:

```ts
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendEpisodeMemoryFromRoot,
  readEpisodeMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type { EpisodeMemory } from '../src/memory/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function episode(overrides: Partial<EpisodeMemory> = {}): EpisodeMemory {
  return {
    id: 'episode-1',
    projectId: 'project-1',
    title: 'Stop hook episode',
    summary: '用户讨论了 admission gate rollout。',
    actions: ['读取 v1.0.0 plan'],
    decisions: ['采用分阶段主干串行加阶段内并行'],
    failures: [],
    openQuestions: [],
    changedFiles: ['docs/superpowers/specs/example.md'],
    commandsRun: ['npm run typecheck'],
    toolNames: ['exec_command'],
    sourceTraceIds: ['session-1:turn-1'],
    createdAt: '2026-05-31T00:00:00.000Z',
    ...overrides
  }
}

describe('Episode memory store', () => {
  it('appends and reads episode memories from a memory root', async () => {
    const root = await createTempDir('cyrene-episode-root-')

    await appendEpisodeMemoryFromRoot(root, episode())
    await appendEpisodeMemoryFromRoot(root, episode({ id: 'episode-2', title: 'Second episode' }))

    await expect(readEpisodeMemoriesFromRoot(root)).resolves.toEqual([
      episode(),
      episode({ id: 'episode-2', title: 'Second episode' })
    ])
    await expect(readFile(join(root, 'episodes.jsonl'), 'utf8')).resolves.toContain('"id":"episode-1"')
  })

  it('returns an empty list when episodes file is missing', async () => {
    const root = await createTempDir('cyrene-episode-empty-root-')

    await expect(readEpisodeMemoriesFromRoot(root)).resolves.toEqual([])
  })

  it('refuses to append episodes through a symlinked data file', async () => {
    const root = await createTempDir('cyrene-episode-root-')
    const outside = await createTempDir('cyrene-episode-outside-')
    const outsideEpisodes = join(outside, 'episodes.jsonl')
    await mkdir(dirname(join(root, 'episodes.jsonl')), { recursive: true })
    await writeFile(outsideEpisodes, 'outside target must stay unchanged\n')
    await symlink(outsideEpisodes, join(root, 'episodes.jsonl'))

    await expect(appendEpisodeMemoryFromRoot(root, episode())).rejects.toThrow(/memory data file symlink/)
    await expect(readFile(outsideEpisodes, 'utf8')).resolves.toBe('outside target must stay unchanged\n')
  })
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- tests/codex-episode-memory.test.ts
```

Expected: FAIL because `EpisodeMemory`, `appendEpisodeMemoryFromRoot`, and `readEpisodeMemoriesFromRoot` do not exist.

- [ ] **Step 3: Add EpisodeMemory type**

In `src/memory/types.ts`, add this interface after `MemoryEvidence`:

```ts
export interface EpisodeMemory {
  id: string
  projectId: string
  title: string
  summary: string
  actions: string[]
  decisions: string[]
  failures: string[]
  openQuestions: string[]
  changedFiles?: string[]
  commandsRun?: string[]
  toolNames?: string[]
  sourceTraceIds: string[]
  createdAt: string
  expiresAt?: string
}
```

- [ ] **Step 4: Add episode JSONL helpers**

In `src/memory/memory-store.ts`, update the type import:

```ts
import type { CyreneMemory, EpisodeMemory, MemoryEvent, MemoryScores, MemoryTombstone, PendingMemory } from './types.js'
```

Add the file constant near the existing constants:

```ts
const EPISODES_FILE = 'episodes.jsonl'
```

Add these functions near the pending memory helpers:

```ts
export async function appendEpisodeMemoryFromRoot(memoryRoot: string, episode: EpisodeMemory): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, EPISODES_FILE), episode)
}

export async function readEpisodeMemoriesFromRoot(memoryRoot: string): Promise<EpisodeMemory[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<EpisodeMemory>(join(memoryRoot, EPISODES_FILE))
}
```

- [ ] **Step 5: Run the episode store test**

Run:

```bash
npm test -- tests/codex-episode-memory.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit PR1 store**

```bash
git add src/memory/types.ts src/memory/memory-store.ts tests/codex-episode-memory.test.ts
git commit -m "feat: add episode memory store"
```

### Task 2: Write Stop Hook Episodes Fail-Open

**Files:**
- Create: `src/codex/episode-memory.ts`
- Modify: `src/codex/codex-hook-stop.ts`
- Modify: `tests/codex-hook-stop.test.ts`
- Modify: `tests/codex-episode-memory.test.ts`

- [ ] **Step 1: Add failing Stop Hook episode tests**

Append these tests to `tests/codex-hook-stop.test.ts` inside the existing `describe('Codex Stop hook runtime', () => { ... })` block:

```ts
  it('writes an episode for parsed Stop hook transcripts without creating pending memory', async () => {
    const home = await createTempDir('cyrene-codex-stop-episode-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-episode-project-')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, JSON.stringify({ role: 'user', content: '普通讨论，不需要长期记忆。' }) + '\n')

    const result = await handleCodexStopHookPayload(
      { cwd, session_id: 's-episode', turn_id: 't-episode', transcript_path: transcript },
      {
        callModel: async () => ({
          content: JSON.stringify({ summary: '普通讨论，无长期记忆。', candidates: [] }),
          toolCalls: []
        })
      }
    )

    expect(result.action).toBe('summary')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const episodes = await readFile(join(memoryRoot, 'episodes.jsonl'), 'utf8')
    expect(episodes).toContain('"sessionId":"s-episode"')
    expect(episodes).toContain('Codex Stop hook wrote review summary.')
    await expectMemoryFileMissing(memoryRoot, 'pending.jsonl')
  })

  it('keeps Stop hook fail-open when episode write fails', async () => {
    const home = await createTempDir('cyrene-codex-stop-episode-fail-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-episode-fail-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(join(memoryRoot, 'episodes.jsonl'), { recursive: true })
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, JSON.stringify({ role: 'user', content: '普通讨论。' }) + '\n')

    const result = await handleCodexStopHookPayload(
      { cwd, session_id: 's-episode-fail', turn_id: 't-episode-fail', transcript_path: transcript },
      {
        callModel: async () => ({
          content: JSON.stringify({ summary: '普通讨论。', candidates: [] }),
          toolCalls: []
        })
      }
    )

    expect(result).toMatchObject({ action: 'summary' })
    await expect(readFile(join(memoryRoot, 'review-summaries.jsonl'), 'utf8')).resolves.toContain('普通讨论。')
  })
```

`tests/codex-hook-stop.test.ts` already imports `readFile`, `mkdir`, `writeFile`, `join`, `identifyCodexProject`, and `codexProjectMemoryRoot`; do not add duplicate imports.

- [ ] **Step 2: Run the failing Stop Hook episode tests**

Run:

```bash
npm test -- tests/codex-hook-stop.test.ts -t "writes an episode|episode write fails"
```

Expected: FAIL because Stop Hook does not write `episodes.jsonl`.

- [ ] **Step 3: Create episode builder**

Create `src/codex/episode-memory.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { appendEpisodeMemoryFromRoot } from '../memory/memory-store.js'
import type { EpisodeMemory } from '../memory/types.js'
import { ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import { redactReviewText } from './review-redaction.js'
import type { CodexStopHookPayload } from './codex-hook-stop.js'
import type { TranscriptMessage } from './transcript.js'

const SUMMARY_MAX_LENGTH = 500
const ITEM_MAX_LENGTH = 240

export interface StopHookEpisodeInput {
  cwd: string
  projectId: string
  payload: CodexStopHookPayload
  messages: TranscriptMessage[]
  summary: string
  actions?: string[]
  decisions?: string[]
  failures?: string[]
  openQuestions?: string[]
  toolNames?: string[]
  now?: string
}

export async function appendStopHookEpisodeFailOpen(input: StopHookEpisodeInput): Promise<EpisodeMemory | undefined> {
  try {
    const memoryRoot = await ensureCodexProjectMemoryRoot(input.projectId)
    const episode = buildStopHookEpisode(input)
    await appendEpisodeMemoryFromRoot(memoryRoot, episode)
    return episode
  } catch {
    return undefined
  }
}

export function buildStopHookEpisode(input: StopHookEpisodeInput): EpisodeMemory & { sessionId?: string; turnId?: string } {
  const sessionId = asString(input.payload.session_id)
  const turnId = asString(input.payload.turn_id)
  const sourceTraceIds = [sessionId, turnId].filter((value): value is string => value !== undefined)
  const title = firstNonemptyUserMessage(input.messages) ?? 'Codex Stop hook episode'

  return {
    id: randomUUID(),
    projectId: input.projectId,
    title: clean(title, ITEM_MAX_LENGTH),
    summary: clean(input.summary, SUMMARY_MAX_LENGTH),
    actions: cleanItems(input.actions ?? []),
    decisions: cleanItems(input.decisions ?? []),
    failures: cleanItems(input.failures ?? []),
    openQuestions: cleanItems(input.openQuestions ?? []),
    toolNames: cleanItems(input.toolNames ?? ['stop_hook']),
    sourceTraceIds: sourceTraceIds.length === 0 ? [input.projectId] : sourceTraceIds,
    createdAt: input.now ?? new Date().toISOString(),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(turnId === undefined ? {} : { turnId })
  }
}

function firstNonemptyUserMessage(messages: TranscriptMessage[]): string | undefined {
  return messages.find((message) => message.role === 'user' && message.content.trim() !== '')?.content
}

function cleanItems(values: string[]): string[] {
  return values.map((value) => clean(value, ITEM_MAX_LENGTH)).filter((value) => value !== '')
}

function clean(value: string, maxLength: number): string {
  return redactReviewText(value.replace(/\s+/g, ' ').trim()).text.slice(0, maxLength)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}
```

- [ ] **Step 4: Call episode writer from Stop Hook**

In `src/codex/codex-hook-stop.ts`, add the import:

```ts
import { appendStopHookEpisodeFailOpen } from './episode-memory.js'
```

After `const project = await identifyCodexProject(cwd)`, keep the disabled-project check as-is.

After `const review = await runReviewSummaryOrSkip({ ... })`, add one episode write that records the final Stop Hook outcome:

```ts
  await appendStopHookEpisodeFailOpen({
    cwd,
    projectId: project.projectId,
    payload,
    messages,
    summary: review.action === 'summary_failed'
      ? review.reason
      : review.action === 'pending'
        ? 'Codex Stop hook wrote review summary and proposed pending candidates.'
        : review.action === 'summary'
          ? 'Codex Stop hook wrote review summary.'
          : review.reason,
    actions: [
      'Parsed Codex Stop hook transcript.',
      review.action === 'pending' ? 'Proposed pending memory candidates.' : 'Wrote review-safe summary.'
    ],
    decisions: [],
    failures: review.action === 'summary_failed' ? [review.reason] : [],
    openQuestions: [],
    toolNames: ['stop_hook', 'review_summary']
  })
```

- [ ] **Step 5: Run targeted Stop Hook tests**

Run:

```bash
npm test -- tests/codex-hook-stop.test.ts -t "writes an episode|episode write fails|does not create project memory"
```

Expected: PASS.

- [ ] **Step 6: Run PR1 regression tests**

Run:

```bash
npm test -- tests/codex-episode-memory.test.ts tests/codex-hook-stop.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit PR1 Stop Hook episode**

```bash
git add src/codex/episode-memory.ts src/codex/codex-hook-stop.ts tests/codex-hook-stop.test.ts
git commit -m "feat: record stop hook episodes"
```

## PR2: Candidate Draft Layer

### Task 3: Add CandidateDraft Type And Store

**Files:**
- Modify: `src/memory/types.ts`
- Modify: `src/memory/memory-store.ts`
- Create: `tests/codex-candidate-drafts.test.ts`

- [ ] **Step 1: Write failing draft store tests**

Create `tests/codex-candidate-drafts.test.ts`:

```ts
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendCandidateDraftFromRoot,
  readCandidateDraftsFromRoot
} from '../src/memory/memory-store.js'
import type { CandidateDraft } from '../src/memory/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function draft(overrides: Partial<CandidateDraft> = {}): CandidateDraft {
  return {
    id: 'draft-1',
    content: 'Project memory changes should preserve review-hash validation.',
    candidateKind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    sourceKind: 'review_summary',
    sourceEpisodeIds: ['episode-1'],
    evidenceRefs: ['summary-1'],
    normalizedKey: 'project-memory-review-hash',
    tags: ['codex-review-summary'],
    createdAt: '2026-05-31T00:00:00.000Z',
    ...overrides
  }
}

describe('Candidate draft store', () => {
  it('appends and reads candidate drafts from a memory root', async () => {
    const root = await createTempDir('cyrene-draft-root-')

    await appendCandidateDraftFromRoot(root, draft())
    await appendCandidateDraftFromRoot(root, draft({ id: 'draft-2', content: 'Second draft.' }))

    await expect(readCandidateDraftsFromRoot(root)).resolves.toEqual([
      draft(),
      draft({ id: 'draft-2', content: 'Second draft.' })
    ])
    await expect(readFile(join(root, 'candidate_drafts.jsonl'), 'utf8')).resolves.toContain('"id":"draft-1"')
  })

  it('returns empty list when draft file is missing', async () => {
    const root = await createTempDir('cyrene-draft-empty-root-')

    await expect(readCandidateDraftsFromRoot(root)).resolves.toEqual([])
  })
})
```

- [ ] **Step 2: Run the failing draft store test**

Run:

```bash
npm test -- tests/codex-candidate-drafts.test.ts
```

Expected: FAIL because `CandidateDraft`, `appendCandidateDraftFromRoot`, and `readCandidateDraftsFromRoot` do not exist.

- [ ] **Step 3: Add CandidateDraft type**

In `src/memory/types.ts`, add this after `EpisodeMemory`:

```ts
export const CANDIDATE_DRAFT_SOURCE_KINDS = [
  'file',
  'tool_trace',
  'review_summary',
  'user_explicit',
  'assistant_observed',
  'daily_interview'
] as const
export type CandidateDraftSourceKind = typeof CANDIDATE_DRAFT_SOURCE_KINDS[number]

export interface CandidateDraft {
  id: string
  episodeId?: string
  content: string
  candidateKind: MemoryCandidateKind
  scope: MemoryScope
  domain: MemoryDomain
  sourceKind: CandidateDraftSourceKind
  sourceEpisodeIds: string[]
  evidenceRefs: string[]
  normalizedKey?: string
  tags: string[]
  createdAt: string
}
```

- [ ] **Step 4: Add draft JSONL helpers**

In `src/memory/memory-store.ts`, update the import:

```ts
import type { CandidateDraft, CyreneMemory, EpisodeMemory, MemoryEvent, MemoryScores, MemoryTombstone, PendingMemory } from './types.js'
```

Add the constant:

```ts
const CANDIDATE_DRAFTS_FILE = 'candidate_drafts.jsonl'
```

Add these functions near episode helpers:

```ts
export async function appendCandidateDraftFromRoot(memoryRoot: string, draft: CandidateDraft): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, CANDIDATE_DRAFTS_FILE), draft)
}

export async function readCandidateDraftsFromRoot(memoryRoot: string): Promise<CandidateDraft[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<CandidateDraft>(join(memoryRoot, CANDIDATE_DRAFTS_FILE))
}
```

- [ ] **Step 5: Run draft store tests**

Run:

```bash
npm test -- tests/codex-candidate-drafts.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit PR2 draft store**

```bash
git add src/memory/types.ts src/memory/memory-store.ts tests/codex-candidate-drafts.test.ts
git commit -m "feat: add candidate draft store"
```

### Task 4: Write Drafts Beside Existing Pending Paths

**Files:**
- Create: `src/codex/candidate-drafts.ts`
- Modify: `src/codex/review-summary-runtime.ts`
- Modify: `src/codex/project-memory-harvester.ts`
- Modify: `tests/codex-review-summary-runtime.test.ts`
- Modify: `tests/project-memory-harvester.test.ts`

- [ ] **Step 1: Add failing sidecar draft tests**

Append this test to `tests/codex-review-summary-runtime.test.ts`:

```ts
  it('writes candidate drafts beside existing pending review summary candidates', async () => {
    const home = await createTempDir('cyrene-review-runtime-draft-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-runtime-draft-project-')

    const result = await runCodexReviewSummary({
      cwd,
      sessionId: 's-draft',
      turnId: 't-draft',
      messages: [{ role: 'user', content: '这个项目的 memory 审批要用 review hash。' }],
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          summary: '用户要求项目 memory 审批使用 review hash。',
          candidates: [{
            domain: 'procedural',
            type: 'procedural_rule',
            candidateKind: 'workflow_rule',
            content: '项目 memory 审批必须使用 review hash。',
            source: 'user_explicit',
            evidence: [{ summary: '用户要求项目 memory 审批使用 review hash。' }]
          }]
        })),
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')
    if (result.action !== 'pending') throw new Error(`Expected pending, got ${result.action}`)
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const drafts = await readFile(join(memoryRoot, 'candidate_drafts.jsonl'), 'utf8')
    expect(drafts).toContain('项目 memory 审批必须使用 review hash。')
    expect(drafts).toContain('"sourceKind":"review_summary"')
    expect(drafts).toContain('"candidateKind":"workflow_rule"')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain('项目 memory 审批必须使用 review hash。')
  })
```

Append this test to `tests/project-memory-harvester.test.ts`:

```ts
  it('writes candidate drafts beside existing project harvest pending candidates', async () => {
    const home = await createTempDir('cyrene-harvester-draft-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-draft-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'workflow_rule',
            content: 'Repository changes must preserve the pending-only memory review model.',
            signalIndexes: [1]
          }]
        })),
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')
    if (result.action !== 'pending') throw new Error(`Expected pending, got ${result.action}`)
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const drafts = await readFile(join(memoryRoot, 'candidate_drafts.jsonl'), 'utf8')
    expect(drafts).toContain('Repository changes must preserve the pending-only memory review model.')
    expect(drafts).toContain('"sourceKind":"file"')
    expect(drafts).toContain('"candidateKind":"workflow_rule"')
  })
```

The current test files already import `readFile`, `codexProjectMemoryRoot`, and `identifyCodexProject`, so the tests above should not require new imports.

- [ ] **Step 2: Run failing sidecar tests**

Run:

```bash
npm test -- tests/codex-review-summary-runtime.test.ts -t "writes candidate drafts beside"
npm test -- tests/project-memory-harvester.test.ts -t "writes candidate drafts beside"
```

Expected: FAIL because no draft sidecar is written.

- [ ] **Step 3: Create candidate draft helper**

Create `src/codex/candidate-drafts.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { appendCandidateDraftFromRoot } from '../memory/memory-store.js'
import type {
  CandidateDraft,
  CandidateDraftSourceKind,
  MemoryCandidateKind,
  MemoryDomain,
  MemoryEvidence,
  MemoryScope
} from '../memory/types.js'
import { deriveMemoryCandidateKind } from '../memory/candidate-kind.js'
import { ensureCodexGlobalMemoryRoot, ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import type { CodexMemoryCandidateInput } from './memory-propose.js'

export interface CandidateDraftInput {
  projectId: string
  candidate: CodexMemoryCandidateInput
  sourceKind: CandidateDraftSourceKind
  sourceEpisodeIds?: string[]
  evidenceRefs?: string[]
  now?: string
}

export async function appendCodexCandidateDraftFailOpen(input: CandidateDraftInput): Promise<CandidateDraft | undefined> {
  try {
    const draft = toCandidateDraft(input)
    const root = draft.scope === 'global'
      ? await ensureCodexGlobalMemoryRoot()
      : await ensureCodexProjectMemoryRoot(input.projectId)
    await appendCandidateDraftFromRoot(root, draft)
    return draft
  } catch {
    return undefined
  }
}

export function toCandidateDraft(input: CandidateDraftInput): CandidateDraft {
  const candidateKind = deriveMemoryCandidateKind({
    candidateKind: input.candidate.candidateKind,
    candidate_kind: input.candidate.candidate_kind,
    tags: input.candidate.tags ?? [],
    type: input.candidate.type
  }) as MemoryCandidateKind
  const scope = input.candidate.scope ?? 'project'
  return {
    id: randomUUID(),
    content: input.candidate.content,
    candidateKind,
    scope,
    domain: input.candidate.domain as MemoryDomain,
    sourceKind: input.sourceKind,
    sourceEpisodeIds: input.sourceEpisodeIds ?? [],
    evidenceRefs: input.evidenceRefs ?? evidenceRefs(input.candidate.evidence),
    ...(input.candidate.normalizedKey === undefined ? {} : { normalizedKey: input.candidate.normalizedKey }),
    tags: input.candidate.tags ?? [],
    createdAt: input.now ?? new Date().toISOString()
  }
}

function evidenceRefs(evidence: MemoryEvidence[]): string[] {
  return evidence.flatMap((entry) => {
    const value = entry.evidenceGroupId ?? entry.runId ?? entry.sessionId ?? entry.taskHash ?? entry.summary ?? entry.quote
    return value === undefined ? [] : [value]
  })
}
```

- [ ] **Step 4: Write review summary sidecar draft**

In `src/codex/review-summary-runtime.ts`, add import:

```ts
import { appendCodexCandidateDraftFailOpen } from './candidate-drafts.js'
```

Inside the loop where `safeCandidate` is defined, before `proposeCodexMemoryCandidate`, add:

```ts
      await appendCodexCandidateDraftFailOpen({
        projectId: project.projectId,
        candidate: safeCandidate,
        sourceKind: 'review_summary',
        evidenceRefs: [summaryId],
        now: createdAt
      })
```

Inside the explicit global instruction loop, before proposing the global candidate, add:

```ts
      await appendCodexCandidateDraftFailOpen({
        projectId: project.projectId,
        candidate: globalCandidate,
        sourceKind: 'user_explicit',
        evidenceRefs: [summaryId],
        now: createdAt
      })
```

- [ ] **Step 5: Write project harvest sidecar draft**

In `src/codex/project-memory-harvester.ts`, add import:

```ts
import { appendCodexCandidateDraftFailOpen } from './candidate-drafts.js'
```

Inside the normal-mode loop before `proposeCodexMemoryCandidate`, add:

```ts
    await appendCodexCandidateDraftFailOpen({
      projectId: project.projectId,
      candidate,
      sourceKind: candidate.source === 'tool_trace'
        ? 'tool_trace'
        : candidate.source === 'user_explicit'
          ? 'user_explicit'
          : candidate.source === 'assistant_observed'
            ? 'assistant_observed'
            : 'file',
      now: input.now
    })
```

- [ ] **Step 6: Run PR2 sidecar tests**

Run:

```bash
npm test -- tests/codex-candidate-drafts.test.ts
npm test -- tests/codex-review-summary-runtime.test.ts -t "writes candidate drafts beside"
npm test -- tests/project-memory-harvester.test.ts -t "writes candidate drafts beside"
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit PR2 sidecar drafts**

```bash
git add src/codex/candidate-drafts.ts src/codex/review-summary-runtime.ts src/codex/project-memory-harvester.ts tests/codex-review-summary-runtime.test.ts tests/project-memory-harvester.test.ts
git commit -m "feat: capture candidate drafts beside pending writes"
```

## PR3: Admission Gate MVP

### Task 5: Add Admission Types, Store, And Pure Gate

**Files:**
- Modify: `src/memory/types.ts`
- Modify: `src/memory/memory-store.ts`
- Create: `src/codex/admission-gate.ts`
- Create: `tests/codex-admission-gate.test.ts`

- [ ] **Step 1: Write failing admission gate tests**

Create `tests/codex-admission-gate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { evaluateCandidateAdmission } from '../src/codex/admission-gate.js'
import type { CandidateDraft, CyreneMemory, MemoryTombstone, PendingMemory } from '../src/memory/types.js'

function draft(overrides: Partial<CandidateDraft> = {}): CandidateDraft {
  return {
    id: 'draft-1',
    content: 'Repository changes must preserve pending review.',
    candidateKind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    sourceKind: 'review_summary',
    sourceEpisodeIds: ['episode-1'],
    evidenceRefs: ['evidence-1'],
    normalizedKey: 'repository-preserve-pending-review',
    tags: ['test'],
    createdAt: '2026-05-31T00:00:00.000Z',
    ...overrides
  }
}

function active(normalizedKey: string): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Active memory.',
    normalizedKey,
    evidence: [{ summary: 'Active evidence.' }],
    source: 'file',
    scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 },
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    tags: []
  }
}

function pending(normalizedKey: string): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Pending memory.',
    normalizedKey,
    evidence: [{ summary: 'Pending evidence.' }],
    source: 'file',
    scores: { evidenceStrength: 0.8, stability: 0.7, usefulness: 0.7, safety: 0.9, sensitivity: 0.1 },
    seenCount: 1,
    firstSeenAt: '2026-05-01T00:00:00.000Z',
    lastSeenAt: '2026-05-01T00:00:00.000Z',
    expiresAt: '2026-06-01T00:00:00.000Z',
    tags: []
  }
}

function tombstone(normalizedKey: string): MemoryTombstone {
  return {
    id: 'tombstone-1',
    normalizedKey,
    domain: 'project',
    type: 'project_fact',
    scope: 'project',
    reason: 'rejected',
    createdAt: '2026-05-01T00:00:00.000Z',
    expiresAt: '2026-06-30T00:00:00.000Z'
  }
}

describe('evaluateCandidateAdmission', () => {
  it('keeps one-time action logs out of pending', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: '使用 repo-review-fix-coordinator 工具检查和修复代码审查发现的问题。',
        candidateKind: 'project_fact',
        normalizedKey: 'one-time-action'
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('episode_only')
    expect(decision.reasons).toContain('one_time_action')
    expect(decision.reasons).toContain('low_future_usefulness')
  })

  it('keeps stale numeric snapshots out of pending', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: '项目包含 44 个测试文件，广泛覆盖 active memory、CLI、distill、MCP、memory index 等模块。',
        candidateKind: 'project_fact',
        normalizedKey: 'test-count-snapshot'
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(['episode_only', 'admit_to_distillation']).toContain(decision.action)
    expect(decision.action).not.toBe('admit_to_pending')
    expect(decision.reasons).toContain('stale_numeric_snapshot')
  })

  it('admits durable workflow rules to pending', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: 'Core memory pipeline changes must preserve review-hash validation.',
        candidateKind: 'workflow_rule',
        normalizedKey: 'preserve-review-hash'
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('admit_to_pending')
    expect(decision.reasons).toContain('valuable_workflow_rule')
  })

  it('admits explicit user instructions to pending', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({
        content: '以后所有 spec 和 plan 默认用中文写。',
        candidateKind: 'user_instruction',
        sourceKind: 'user_explicit',
        normalizedKey: 'chinese-spec-plan'
      }),
      pending: [],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('admit_to_pending')
    expect(decision.reasons).toContain('explicit_user_instruction')
  })

  it('rejects duplicate active memory by normalizedKey', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({ normalizedKey: 'duplicate-key' }),
      pending: [],
      active: [active('duplicate-key')],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('reject_duplicate')
    expect(decision.reasons).toContain('duplicate_active')
    expect(decision.targetMemoryId).toBe('active-1')
  })

  it('merges duplicate pending memory by normalizedKey', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({ normalizedKey: 'duplicate-pending-key' }),
      pending: [pending('duplicate-pending-key')],
      active: [],
      tombstones: [],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('merge_with_existing')
    expect(decision.reasons).toContain('duplicate_pending')
    expect(decision.targetMemoryId).toBe('pending-1')
  })

  it('drops candidates that conflict with active tombstones', () => {
    const decision = evaluateCandidateAdmission({
      draft: draft({ normalizedKey: 'blocked-key' }),
      pending: [],
      active: [],
      tombstones: [tombstone('blocked-key')],
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(decision.action).toBe('auto_drop')
    expect(decision.reasons).toContain('conflicts_with_tombstone')
  })
})
```

- [ ] **Step 2: Run the failing admission tests**

Run:

```bash
npm test -- tests/codex-admission-gate.test.ts
```

Expected: FAIL because `admission-gate.ts` and admission types do not exist.

- [ ] **Step 3: Add admission types**

In `src/memory/types.ts`, add after `CandidateDraft`:

```ts
export const ADMISSION_ACTIONS = [
  'admit_to_pending',
  'admit_to_distillation',
  'episode_only',
  'auto_drop',
  'auto_defer',
  'merge_with_existing',
  'reject_duplicate'
] as const
export type AdmissionAction = typeof ADMISSION_ACTIONS[number]

export const ADMISSION_REASONS = [
  'one_time_action',
  'temporary_status',
  'stale_numeric_snapshot',
  'low_future_usefulness',
  'low_actionability',
  'too_vague',
  'duplicate_pending',
  'duplicate_active',
  'conflicts_with_tombstone',
  'valuable_project_decision',
  'valuable_workflow_rule',
  'valuable_known_pitfall',
  'valuable_rejected_approach',
  'explicit_user_instruction'
] as const
export type AdmissionReason = typeof ADMISSION_REASONS[number]

export interface AdmissionScores {
  futureUsefulness: number
  actionability: number
  stability: number
  specificity: number
  evidenceStrength: number
  repeatPotential: number
  expiryRisk: number
  redundancy: number
  sensitivity: number
}

export interface AdmissionDecision {
  id: string
  draftId: string
  action: AdmissionAction
  admissionScore: number
  reasons: AdmissionReason[]
  scores: AdmissionScores
  targetMemoryId?: string
  targetClusterId?: string
  createdAt: string
}
```

Extend `PendingMemory` with optional lineage fields:

```ts
  admittedBy?: 'admission_gate_v1'
  admissionScore?: number
  admissionReasons?: string[]
  sourceEpisodeIds?: string[]
  sourceDraftIds?: string[]
```

- [ ] **Step 4: Add admission decision store helpers**

In `src/memory/memory-store.ts`, update import:

```ts
import type { AdmissionDecision, CandidateDraft, CyreneMemory, EpisodeMemory, MemoryEvent, MemoryScores, MemoryTombstone, PendingMemory } from './types.js'
```

Add constant:

```ts
const ADMISSION_DECISIONS_FILE = 'admission_decisions.jsonl'
```

Add helpers:

```ts
export async function appendAdmissionDecisionFromRoot(memoryRoot: string, decision: AdmissionDecision): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, ADMISSION_DECISIONS_FILE), decision)
}

export async function readAdmissionDecisionsFromRoot(memoryRoot: string): Promise<AdmissionDecision[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<AdmissionDecision>(join(memoryRoot, ADMISSION_DECISIONS_FILE))
}
```

- [ ] **Step 5: Implement admission gate**

Create `src/codex/admission-gate.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type {
  AdmissionDecision,
  AdmissionReason,
  AdmissionScores,
  CandidateDraft,
  CyreneMemory,
  MemoryTombstone,
  PendingMemory
} from '../memory/types.js'

export interface EvaluateCandidateAdmissionInput {
  draft: CandidateDraft
  pending: PendingMemory[]
  active: CyreneMemory[]
  tombstones: MemoryTombstone[]
  now?: string
}

const ONE_TIME_ACTION_PATTERN = /\b(?:使用|ran|run|checked|检查|修复|完成|准备|reviewed|looked at)\b.*\b(?:工具|tool|command|命令|问题|issue|review)\b/i
const NUMERIC_SNAPSHOT_PATTERN = /\b\d+\b.*\b(?:tests?|测试|files?|文件|pending|候选|branch|分支|commits?|PRs?)\b/i
const TEMPORARY_STATUS_PATTERN = /\b(?:当前|现在|目前|today|本轮|这次|刚刚|准备|已完成|完成了)\b/i
const VAGUE_PATTERN = /\b(?:若干|一些|多个|相关|事情|问题|改进|优化|处理)\b/i

export function evaluateCandidateAdmission(input: EvaluateCandidateAdmissionInput): AdmissionDecision {
  const now = input.now ?? new Date().toISOString()
  const duplicateActive = findByNormalizedKey(input.active, input.draft.normalizedKey)
  if (duplicateActive !== undefined) {
    return decision(input.draft, 'reject_duplicate', ['duplicate_active'], scoresFor(input.draft, { redundancy: 1 }), now, {
      targetMemoryId: duplicateActive.id
    })
  }

  const duplicatePending = findByNormalizedKey(input.pending, input.draft.normalizedKey)
  if (duplicatePending !== undefined) {
    return decision(input.draft, 'merge_with_existing', ['duplicate_pending'], scoresFor(input.draft, { redundancy: 0.8 }), now, {
      targetMemoryId: duplicatePending.id
    })
  }

  const tombstone = findActiveTombstone(input.tombstones, input.draft, now)
  if (tombstone !== undefined) {
    return decision(input.draft, 'auto_drop', ['conflicts_with_tombstone'], scoresFor(input.draft, { redundancy: 1 }), now, {
      targetMemoryId: tombstone.memoryId ?? tombstone.id
    })
  }

  const reasons = reasonsForDraft(input.draft)
  const scores = scoresFor(input.draft, scoreOverridesForReasons(reasons))
  const admissionScore = admissionScoreFor(scores)
  const action = actionFor(input.draft, reasons, admissionScore)
  return decision(input.draft, action, reasons, scores, now)
}

function reasonsForDraft(draft: CandidateDraft): AdmissionReason[] {
  const reasons: AdmissionReason[] = []
  if (draft.candidateKind === 'user_instruction' || draft.sourceKind === 'user_explicit') {
    reasons.push('explicit_user_instruction')
  }
  if (draft.candidateKind === 'workflow_rule') {
    reasons.push('valuable_workflow_rule')
  }
  if (draft.candidateKind === 'project_decision') {
    reasons.push('valuable_project_decision')
  }
  if (draft.candidateKind === 'known_pitfall') {
    reasons.push('valuable_known_pitfall')
  }
  if (draft.candidateKind === 'rejected_approach') {
    reasons.push('valuable_rejected_approach')
  }
  if (ONE_TIME_ACTION_PATTERN.test(draft.content)) {
    reasons.push('one_time_action', 'low_future_usefulness')
  }
  if (NUMERIC_SNAPSHOT_PATTERN.test(draft.content)) {
    reasons.push('stale_numeric_snapshot', 'low_actionability')
  }
  if (TEMPORARY_STATUS_PATTERN.test(draft.content)) {
    reasons.push('temporary_status')
  }
  if (draft.content.length < 24 || VAGUE_PATTERN.test(draft.content)) {
    reasons.push('too_vague')
  }
  return Array.from(new Set(reasons))
}

function scoreOverridesForReasons(reasons: AdmissionReason[]): Partial<AdmissionScores> {
  const noisy = reasons.some((reason) =>
    reason === 'one_time_action' ||
    reason === 'temporary_status' ||
    reason === 'stale_numeric_snapshot' ||
    reason === 'low_future_usefulness' ||
    reason === 'low_actionability' ||
    reason === 'too_vague'
  )
  const valuable = reasons.some((reason) =>
    reason === 'valuable_project_decision' ||
    reason === 'valuable_workflow_rule' ||
    reason === 'valuable_known_pitfall' ||
    reason === 'valuable_rejected_approach' ||
    reason === 'explicit_user_instruction'
  )
  if (valuable && !noisy) {
    return {
      futureUsefulness: 0.85,
      actionability: 0.85,
      stability: 0.8,
      specificity: 0.75,
      evidenceStrength: 0.75,
      repeatPotential: 0.7,
      expiryRisk: 0.1,
      redundancy: 0.0,
      sensitivity: 0.1
    }
  }
  if (reasons.includes('stale_numeric_snapshot')) {
    return {
      futureUsefulness: 0.35,
      actionability: 0.25,
      stability: 0.35,
      specificity: 0.65,
      evidenceStrength: 0.7,
      repeatPotential: 0.55,
      expiryRisk: 0.85,
      redundancy: 0.1,
      sensitivity: 0.1
    }
  }
  if (noisy) {
    return {
      futureUsefulness: 0.2,
      actionability: 0.2,
      stability: 0.25,
      specificity: 0.35,
      evidenceStrength: 0.6,
      repeatPotential: 0.2,
      expiryRisk: 0.7,
      redundancy: 0.1,
      sensitivity: 0.1
    }
  }
  return {}
}

function scoresFor(draft: CandidateDraft, overrides: Partial<AdmissionScores> = {}): AdmissionScores {
  return {
    futureUsefulness: 0.55,
    actionability: 0.5,
    stability: 0.55,
    specificity: draft.content.length >= 48 ? 0.65 : 0.45,
    evidenceStrength: draft.evidenceRefs.length > 0 ? 0.7 : 0.3,
    repeatPotential: draft.candidateKind === 'workflow_rule' || draft.candidateKind === 'known_pitfall' ? 0.7 : 0.45,
    expiryRisk: 0.35,
    redundancy: 0,
    sensitivity: draft.domain === 'personal' || draft.domain === 'relationship' || draft.domain === 'affective' ? 0.7 : 0.1,
    ...overrides
  }
}

function admissionScoreFor(scores: AdmissionScores): number {
  return clamp(
    scores.futureUsefulness * 0.25 +
    scores.actionability * 0.2 +
    scores.stability * 0.15 +
    scores.specificity * 0.15 +
    scores.evidenceStrength * 0.15 +
    scores.repeatPotential * 0.1 -
    scores.expiryRisk * 0.25 -
    scores.redundancy * 0.2 -
    scores.sensitivity * 0.1
  )
}

function actionFor(draft: CandidateDraft, reasons: AdmissionReason[], score: number): AdmissionDecision['action'] {
  if (reasons.includes('explicit_user_instruction')) return 'admit_to_pending'
  if (reasons.includes('valuable_workflow_rule') || reasons.includes('valuable_known_pitfall') || reasons.includes('valuable_rejected_approach') || reasons.includes('valuable_project_decision')) {
    return score >= 0.5 ? 'admit_to_pending' : 'admit_to_distillation'
  }
  if (reasons.includes('stale_numeric_snapshot')) return 'admit_to_distillation'
  if (reasons.includes('one_time_action') || reasons.includes('temporary_status')) return 'episode_only'
  if (score < 0.35) return 'auto_drop'
  if (score < 0.5) return 'episode_only'
  if (score < 0.65) return 'admit_to_distillation'
  return draft.candidateKind === 'project_fact' ? 'admit_to_distillation' : 'admit_to_pending'
}

function decision(
  draft: CandidateDraft,
  action: AdmissionDecision['action'],
  reasons: AdmissionReason[],
  scores: AdmissionScores,
  now: string,
  extras: Partial<Pick<AdmissionDecision, 'targetMemoryId' | 'targetClusterId'>> = {}
): AdmissionDecision {
  return {
    id: randomUUID(),
    draftId: draft.id,
    action,
    admissionScore: admissionScoreFor(scores),
    reasons,
    scores,
    createdAt: now,
    ...extras
  }
}

function findByNormalizedKey<T extends { normalizedKey: string; id: string }>(items: T[], normalizedKey: string | undefined): T | undefined {
  return normalizedKey === undefined ? undefined : items.find((item) => item.normalizedKey === normalizedKey)
}

function findActiveTombstone(tombstones: MemoryTombstone[], draft: CandidateDraft, now: string): MemoryTombstone | undefined {
  return tombstones.find((entry) =>
    entry.normalizedKey === draft.normalizedKey &&
    (entry.expiresAt === undefined || entry.expiresAt > now)
  )
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))))
}
```

- [ ] **Step 6: Run admission tests**

Run:

```bash
npm test -- tests/codex-admission-gate.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit PR3 admission gate**

```bash
git add src/memory/types.ts src/memory/memory-store.ts src/codex/admission-gate.ts tests/codex-admission-gate.test.ts
git commit -m "feat: add candidate admission gate"
```

## PR4: Admission Apply

### Task 6: Add Admission Pipeline Without Replacing Callers

**Files:**
- Create: `src/codex/admission-pipeline.ts`
- Modify: `src/codex/memory-propose.ts`
- Create: `tests/codex-admission-pipeline.test.ts`

- [ ] **Step 1: Write failing admission pipeline tests**

Create `tests/codex-admission-pipeline.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCodexAdmissionPipeline } from '../src/codex/admission-pipeline.js'
import { codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import type { CyreneMemory } from '../src/memory/types.js'

const originalHome = process.env.HOME
const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function activeMemory(normalizedKey: string): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Existing active memory.',
    normalizedKey,
    evidence: [{ summary: 'Existing evidence.' }],
    source: 'file',
    scores: { evidenceStrength: 0.9, stability: 0.9, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 },
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    tags: []
  }
}

describe('runCodexAdmissionPipeline', () => {
  it('writes draft and admission records without pending for numeric snapshots', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-project-')

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'file',
      candidate: {
        domain: 'project',
        type: 'project_fact',
        candidateKind: 'project_fact',
        content: '项目包含 44 个测试文件，广泛覆盖 active memory、CLI、distill、MCP、memory index 等模块。',
        evidence: [{ summary: 'test signal', sourceKind: 'file' }],
        source: 'file'
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('admit_to_distillation')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await expect(readFile(join(memoryRoot, 'candidate_drafts.jsonl'), 'utf8')).resolves.toContain('44 个测试文件')
    await expect(readFile(join(memoryRoot, 'admission_decisions.jsonl'), 'utf8')).resolves.toContain('stale_numeric_snapshot')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes admitted pending memory with admission lineage metadata', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-admit-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-admit-project-')

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'review_summary',
      sourceEpisodeIds: ['episode-1'],
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        candidateKind: 'workflow_rule',
        content: 'Core memory pipeline changes must preserve review-hash validation.',
        normalizedKey: 'preserve-review-hash',
        evidence: [{ summary: 'User confirmed review hash policy.', sourceKind: 'user_explicit' }],
        source: 'user_explicit',
        scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.1 }
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('pending')
    const pending = await readFile(join(result.memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain('"admittedBy":"admission_gate_v1"')
    expect(pending).toContain('"sourceEpisodeIds":["episode-1"]')
    expect(pending).toContain('"sourceDraftIds"')
  })

  it('does not write pending for duplicate active memory', async () => {
    const home = await createTempDir('cyrene-admission-pipeline-duplicate-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-admission-pipeline-duplicate-project-')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'index.jsonl'), `${JSON.stringify(activeMemory('duplicate-key'))}\n`)

    const result = await runCodexAdmissionPipeline({
      cwd,
      sourceKind: 'review_summary',
      candidate: {
        domain: 'project',
        type: 'project_fact',
        candidateKind: 'project_fact',
        content: 'Duplicate active memory.',
        normalizedKey: 'duplicate-key',
        evidence: [{ summary: 'Duplicate evidence.' }]
      },
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('reject_duplicate')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
```

- [ ] **Step 2: Run failing admission pipeline tests**

Run:

```bash
npm test -- tests/codex-admission-pipeline.test.ts
```

Expected: FAIL because `admission-pipeline.ts` does not exist and pending lineage input is not supported.

- [ ] **Step 3: Extend CodexMemoryCandidateInput and PendingMemory conversion**

In `src/codex/memory-propose.ts`, extend `CodexMemoryCandidateInput`:

```ts
  admittedBy?: 'admission_gate_v1'
  admissionScore?: number
  admissionReasons?: string[]
  sourceEpisodeIds?: string[]
  sourceDraftIds?: string[]
```

In `toPendingMemory`, add these optional fields to the returned object:

```ts
    ...(input.admittedBy === undefined ? {} : { admittedBy: input.admittedBy }),
    ...(input.admissionScore === undefined ? {} : { admissionScore: input.admissionScore }),
    ...(input.admissionReasons === undefined ? {} : { admissionReasons: input.admissionReasons }),
    ...(input.sourceEpisodeIds === undefined ? {} : { sourceEpisodeIds: input.sourceEpisodeIds }),
    ...(input.sourceDraftIds === undefined ? {} : { sourceDraftIds: input.sourceDraftIds }),
```

In `src/memory/memory-store.ts`, update `mergePendingMemory` to preserve lineage:

```ts
    admittedBy: existing.admittedBy ?? candidate.admittedBy,
    admissionScore: Math.max(existing.admissionScore ?? 0, candidate.admissionScore ?? 0) || undefined,
    admissionReasons: uniqueOptional([...(existing.admissionReasons ?? []), ...(candidate.admissionReasons ?? [])]),
    sourceEpisodeIds: uniqueOptional([...(existing.sourceEpisodeIds ?? []), ...(candidate.sourceEpisodeIds ?? [])]),
    sourceDraftIds: uniqueOptional([...(existing.sourceDraftIds ?? []), ...(candidate.sourceDraftIds ?? [])]),
```

- [ ] **Step 4: Implement admission pipeline**

Create `src/codex/admission-pipeline.ts`:

```ts
import { codexProjectMemoryRoot, ensureCodexGlobalMemoryRoot, ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import { toCandidateDraft } from './candidate-drafts.js'
import { evaluateCandidateAdmission } from './admission-gate.js'
import { proposeCodexMemoryCandidate, type CodexMemoryCandidateInput, type CodexMemoryProposeResult } from './memory-propose.js'
import { identifyCodexProject } from './project-id.js'
import { isCodexProjectMemoryDisabled } from './project-registry.js'
import {
  appendAdmissionDecisionFromRoot,
  appendCandidateDraftFromRoot,
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot
} from '../memory/memory-store.js'
import type { AdmissionDecision, CandidateDraftSourceKind } from '../memory/types.js'

export type CodexAdmissionPipelineResult =
  | (CodexMemoryProposeResult & { action: 'pending' | 'auto_promote' | 'reject'; admission: AdmissionDecision })
  | {
      project: { projectId: string; displayName: string }
      memoryRoot: string
      action: AdmissionDecision['action']
      admission: AdmissionDecision
      reason: string
    }

export interface RunCodexAdmissionPipelineInput {
  cwd: string
  candidate: CodexMemoryCandidateInput
  sourceKind: CandidateDraftSourceKind
  sourceEpisodeIds?: string[]
  evidenceRefs?: string[]
  now?: string
  recordRejectedCandidate?: boolean
  allowAutoPromote?: boolean
}

export async function runCodexAdmissionPipeline(input: RunCodexAdmissionPipelineInput): Promise<CodexAdmissionPipelineResult> {
  const project = await identifyCodexProject(input.cwd)
  const memoryRoot = input.candidate.scope === 'global'
    ? await ensureCodexGlobalMemoryRoot()
    : await ensureCodexProjectMemoryRoot(project.projectId)

  if (input.candidate.scope !== 'global' && await isCodexProjectMemoryDisabled(project.projectId)) {
    return {
      project: { projectId: project.projectId, displayName: project.displayName },
      memoryRoot: codexProjectMemoryRoot(project.projectId),
      action: 'auto_drop',
      admission: disabledAdmission(input),
      reason: 'Project memory is disabled for this project.'
    }
  }

  const draft = toCandidateDraft({
    projectId: project.projectId,
    candidate: input.candidate,
    sourceKind: input.sourceKind,
    sourceEpisodeIds: input.sourceEpisodeIds,
    evidenceRefs: input.evidenceRefs,
    now: input.now
  })
  await appendCandidateDraftFromRoot(memoryRoot, draft)

  const [pending, active, tombstones] = await Promise.all([
    readPendingMemoriesFromRoot(memoryRoot),
    readActiveMemoriesFromRoot(memoryRoot),
    readTombstonesFromRoot(memoryRoot)
  ])
  const admission = evaluateCandidateAdmission({ draft, pending, active, tombstones, now: input.now })
  await appendAdmissionDecisionFromRoot(memoryRoot, admission)

  if (admission.action !== 'admit_to_pending' && admission.action !== 'merge_with_existing') {
    return {
      project: { projectId: project.projectId, displayName: project.displayName },
      memoryRoot,
      action: admission.action,
      admission,
      reason: `Admission gate decided ${admission.action}: ${admission.reasons.join(', ')}`
    }
  }

  const proposed = await proposeCodexMemoryCandidate({
    cwd: input.cwd,
    candidate: {
      ...input.candidate,
      admittedBy: 'admission_gate_v1',
      admissionScore: admission.admissionScore,
      admissionReasons: admission.reasons,
      sourceEpisodeIds: input.sourceEpisodeIds,
      sourceDraftIds: [draft.id]
    },
    now: input.now,
    recordRejectedCandidate: input.recordRejectedCandidate,
    allowAutoPromote: input.allowAutoPromote
  })

  return {
    ...proposed,
    action: proposed.result.action,
    admission
  }
}

function disabledAdmission(input: RunCodexAdmissionPipelineInput): AdmissionDecision {
  return {
    id: 'admission-disabled-project',
    draftId: 'draft-disabled-project',
    action: 'auto_drop',
    admissionScore: 0,
    reasons: ['low_future_usefulness'],
    scores: {
      futureUsefulness: 0,
      actionability: 0,
      stability: 0,
      specificity: 0,
      evidenceStrength: 0,
      repeatPotential: 0,
      expiryRisk: 1,
      redundancy: 0,
      sensitivity: 0
    },
    createdAt: input.now ?? new Date().toISOString()
  }
}
```

- [ ] **Step 5: Run admission pipeline tests**

Run:

```bash
npm test -- tests/codex-admission-pipeline.test.ts
npm test -- tests/codex-memory-propose.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit pipeline**

```bash
git add src/codex/admission-pipeline.ts src/codex/memory-propose.ts src/memory/memory-store.ts tests/codex-admission-pipeline.test.ts
git commit -m "feat: add admission pipeline"
```

### Task 7: Route Review Summary, Harvester, And Explicit Instruction Through Admission

**Files:**
- Modify: `src/codex/review-summary-runtime.ts`
- Modify: `src/codex/project-memory-harvester.ts`
- Modify: `src/codex/codex-hook-stop.ts`
- Modify: `tests/codex-review-summary-runtime.test.ts`
- Modify: `tests/project-memory-harvester.test.ts`
- Modify: `tests/codex-hook-stop.test.ts`

- [ ] **Step 1: Add failing caller integration tests**

In `tests/codex-review-summary-runtime.test.ts`, add:

```ts
  it('routes low-value review summary candidates to admission without pending write', async () => {
    const home = await createTempDir('cyrene-review-runtime-admission-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-runtime-admission-project-')

    const result = await runCodexReviewSummary({
      cwd,
      messages: [{ role: 'assistant', content: 'Used repo-review-fix-coordinator to inspect findings.' }],
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          summary: 'Assistant used a review tool.',
          candidates: [{
            domain: 'project',
            type: 'project_fact',
            candidateKind: 'project_fact',
            content: '使用 repo-review-fix-coordinator 工具检查和修复代码审查发现的问题。',
            evidence: [{ summary: 'Assistant used review tool.' }]
          }]
        })),
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('summary')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await expect(readFile(join(memoryRoot, 'admission_decisions.jsonl'), 'utf8')).resolves.toContain('one_time_action')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
```

In `tests/project-memory-harvester.test.ts`, add:

```ts
  it('routes numeric project harvest snapshots to admission without pending write', async () => {
    const home = await createTempDir('cyrene-harvester-admission-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-harvester-admission-project-')
    collectSignals.mockResolvedValue({ signals: sampleSignals(), warnings: [] })

    const result = await runCodexProjectMemoryHarvest({
      cwd,
      config: createConfig(cwd),
      callModel: async () =>
        modelResponse(JSON.stringify({
          candidates: [{
            candidateKind: 'project_fact',
            content: '项目包含 44 个测试文件，广泛覆盖 active memory、CLI、distill、MCP、memory index 等模块。',
            signalIndexes: [1]
          }]
        })),
      now: '2026-05-31T00:00:00.000Z'
    })

    expect(result.action).toBe('noop')
    expect(result.reason).toContain('No project memory candidates survived admission.')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await expect(readFile(join(memoryRoot, 'admission_decisions.jsonl'), 'utf8')).resolves.toContain('stale_numeric_snapshot')
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
```

In `tests/codex-hook-stop.test.ts`, add:

```ts
  it('routes explicit durable instruction through admission metadata', async () => {
    const home = await createTempDir('cyrene-codex-stop-admission-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-codex-stop-admission-project-')
    const transcript = join(cwd, 'transcript.jsonl')
    await writeFile(transcript, JSON.stringify({ role: 'user', content: '以后默认 Cyrene 的 spec 和 plan 用中文写。' }) + '\n')

    const result = await handleCodexStopHookPayload(
      { cwd, transcript_path: transcript, session_id: 's-admission', turn_id: 't-admission' },
      {
        callModel: async () => ({
          content: JSON.stringify({ summary: '用户给出项目 workflow 指令。', candidates: [] }),
          toolCalls: []
        })
      }
    )

    expect(result.action).toBe('pending')
    const identity = await identifyCodexProject(cwd)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const pending = await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')
    expect(pending).toContain('"admittedBy":"admission_gate_v1"')
    expect(pending).toContain('"explicit_user_instruction"')
    await expect(readFile(join(memoryRoot, 'admission_decisions.jsonl'), 'utf8')).resolves.toContain('explicit_user_instruction')
  })
```

- [ ] **Step 2: Run failing caller tests**

Run:

```bash
npm test -- tests/codex-review-summary-runtime.test.ts -t "routes low-value"
npm test -- tests/project-memory-harvester.test.ts -t "routes numeric"
npm test -- tests/codex-hook-stop.test.ts -t "routes explicit durable instruction"
```

Expected: FAIL because callers still write pending directly or without admission metadata.

- [ ] **Step 3: Replace review summary pending calls**

In `src/codex/review-summary-runtime.ts`, replace import:

```ts
import { type CodexMemoryCandidateInput, proposeCodexMemoryCandidate } from './memory-propose.js'
```

with:

```ts
import { type CodexMemoryCandidateInput } from './memory-propose.js'
import { runCodexAdmissionPipeline } from './admission-pipeline.js'
```

Remove the PR2 sidecar `appendCodexCandidateDraftFailOpen` calls in this file.

Replace each `proposeCodexMemoryCandidate({ ... })` call with:

```ts
      const result = await runCodexAdmissionPipeline({
        cwd: input.cwd,
        candidate: safeCandidate,
        sourceKind: 'review_summary',
        evidenceRefs: [summaryId],
        now: input.now,
        recordRejectedCandidate: false
      })
      if (result.action === 'pending') {
        candidateIds.push(result.result.candidateId)
      }
```

For `globalCandidate`, use:

```ts
      const result = await runCodexAdmissionPipeline({
        cwd: input.cwd,
        candidate: globalCandidate,
        sourceKind: 'user_explicit',
        evidenceRefs: [summaryId],
        now: input.now,
        recordRejectedCandidate: false,
        allowAutoPromote: false
      })
      if (result.action === 'pending') {
        candidateIds.push(result.result.candidateId)
      }
```

- [ ] **Step 4: Replace project harvester pending calls**

In `src/codex/project-memory-harvester.ts`, replace:

```ts
import { type CodexMemoryCandidateInput, proposeCodexMemoryCandidate } from './memory-propose.js'
```

with:

```ts
import { type CodexMemoryCandidateInput } from './memory-propose.js'
import { runCodexAdmissionPipeline } from './admission-pipeline.js'
```

Remove PR2 sidecar draft call in this file.

Replace the normal-mode propose loop with:

```ts
  for (const candidate of candidates) {
    const result = await runCodexAdmissionPipeline({
      cwd: input.cwd,
      candidate,
      sourceKind: candidate.source === 'tool_trace'
        ? 'tool_trace'
        : candidate.source === 'assistant_observed'
          ? 'assistant_observed'
          : 'file',
      now: input.now,
      recordRejectedCandidate: false
    })
    memoryRoot = result.memoryRoot
    if (result.action === 'pending') {
      candidateIds.push(result.result.candidateId)
    }
  }
```

Change the no-survivors reason to:

```ts
    return { action: 'noop', reason: 'No project memory candidates survived admission.', signals, warnings }
```

- [ ] **Step 5: Replace explicit durable instruction pending call**

In `src/codex/codex-hook-stop.ts`, import:

```ts
import { runCodexAdmissionPipeline } from './admission-pipeline.js'
```

In `proposeExplicitMemoryCandidate`, replace `proposeCodexMemoryCandidate({ ... })` with:

```ts
  return runCodexAdmissionPipeline({
    cwd,
    candidate,
    sourceKind: 'user_explicit',
    sourceEpisodeIds: [],
    now: undefined,
    recordRejectedCandidate: false,
    allowAutoPromote: false
  })
```

Update the consumer in `handleCodexStopHookPayloadUnsafe` from `explicitResult?.result.action` to the admission pipeline result shape:

```ts
  const explicitPending = explicitResult?.action === 'pending' ? explicitResult.result : undefined
```

- [ ] **Step 6: Run caller integration tests**

Run:

```bash
npm test -- tests/codex-review-summary-runtime.test.ts -t "routes low-value|writes pending candidates|captures explicit global|preserves candidateKind"
npm test -- tests/project-memory-harvester.test.ts -t "routes numeric|writes sanitized project pending|does not preserve model-supplied normalizedKey"
npm test -- tests/codex-hook-stop.test.ts -t "routes explicit durable instruction|writes pending memory for explicit durable|appends stop trace"
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Run full PR4 regression suite**

Run:

```bash
npm test -- tests/codex-admission-gate.test.ts tests/codex-admission-pipeline.test.ts tests/codex-review-summary-runtime.test.ts tests/project-memory-harvester.test.ts tests/codex-hook-stop.test.ts tests/codex-memory-propose.test.ts tests/codex-memory-promotion-policy.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit PR4 admission apply**

```bash
git add src/codex/review-summary-runtime.ts src/codex/project-memory-harvester.ts src/codex/codex-hook-stop.ts tests/codex-review-summary-runtime.test.ts tests/project-memory-harvester.test.ts tests/codex-hook-stop.test.ts
git commit -m "feat: gate memory candidates before pending"
```

## Release Verification For PR1-PR4

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run plugin build only if skill/runtime source changed**

If `plugin/skills/cyrene-continuity/SKILL.md` changes during execution, run:

```bash
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: both commands PASS.

- [ ] **Step 4: Confirm no generated runtime drift unless intentionally rebuilt**

```bash
git status --short
```

Expected: only intentional source/test/doc changes are present.

## PR5+ Handoff

Write a separate plan after PR1-PR4 are merged.

PR5 can use multi-agent because schema and core pipeline are stable:

- CLI/MCP/API agent: add `memory episodes list/show` and `memory admission dry-run/explain/stats`.
- UI agent: add Episode and Admission read-only views.
- Docs/runtime agent: update skill/README copy and rebuild plugin runtime if needed.
- Test agent: add CLI/MCP/API/UI parity and regression fixtures.

PR6 gets a separate Distillation 2.0 plan. PR7+ gets separate Activation/Reflection/Principle plans.

## Self-Review Notes

- Spec coverage: PR1 covers Episode; PR2 covers CandidateDraft; PR3 covers AdmissionDecision dry-run/pure gate; PR4 covers admission apply before pending. PR5+ surface area is intentionally deferred to separate plans.
- Scope check: this plan does not implement UI, MCP tools, Distillation 2.0, Activation, Reflection, or Principle.
- Type consistency: `EpisodeMemory`, `CandidateDraft`, `AdmissionDecision`, `AdmissionReason`, and pending lineage fields use the same names as the approved spec.
