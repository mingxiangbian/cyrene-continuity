# Cyrene Context Mode Lightweight Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the context-mode lightweight runtime spec so ordinary Cyrene continuity reads default to a fast, non-review hot path while review and automation paths retain full governance visibility.

**Architecture:** Add a single `ContextMode`/`RetrievalPolicy` contract and route `cyrene_continuity_get`, CLI, MCP, context-preview, summaries, session-hints, diagnostics, metrics, and docs through that policy. Keep JSONL as source of truth, SQLite/FTS as runtime hot path, pending as review-only, and similar-project hints as transferable session guidance.

**Tech Stack:** TypeScript ES2022, Vitest, Node.js 22+, existing Cyrene semantic JSONL store, existing SQLite/FTS memory index, existing CLI/MCP/plugin runtime build.

---

## File Map

- Create `src/codex/context-policy.ts`: owns `ContextMode`, `RetrievalPolicy`, defaults, env overrides, and explicit flag resolution.
- Create `src/codex/fast-summary-store.ts`: reads/writes `global_fast_summary.md` and `profile_fast_summary.md` projections with token caps.
- Create `src/codex/session-hints.ts`: replace/read/clear session-local similar-project hints.
- Create `src/codex/runtime-metrics.ts`: records lightweight runtime metric events for latency, fallback, stale index, and token overhead.
- Modify `src/codex/continuity-context.ts`: route all data fetching, projection, diagnostics, pending, similar hints, profile, summary, and activation event behavior through `RetrievalPolicy`.
- Modify `src/codex/memory-context-preview.ts`: accept mode/flags; default to fast visibility; use review mode for pending/tombstone/archive exclusions.
- Modify `src/mcp/tools/continuity-get.ts`: expose mode and include flags without exposing `cwd` in registered schema.
- Modify `src/codex/codex-cli.ts`: parse `--mode`, include flags, `--max-tokens`, and update help text.
- Modify `src/codex/codex-memory-lifecycle-daily.ts`: update fast summaries, index health, and metrics during daily automation.
- Modify `src/codex/codex-memory-lifecycle-weekly.ts`: update long-lived summary projections and ensure weekly does not migrate similar hints.
- Modify `src/codex/memory-automation.ts`: include summary/index/metric maintenance fields in automation result.
- Modify `plugin/skills/cyrene-continuity/SKILL.md`: remove ordinary pending interruption behavior and document mode boundaries.
- Modify `README.md`: document modes, CLI/MCP flags, summary/session-hints, review-only pending, and fallback behavior.
- Create `docs/superpowers/release-notes/2026-06-05-context-mode-lightweight-runtime.md`: note behavior changes for `pendingReview` and `retrieved` events.
- Tests:
  - Create `tests/codex-context-policy.test.ts`.
  - Create `tests/codex-fast-summary-store.test.ts`.
  - Create `tests/codex-session-hints.test.ts`.
  - Create `tests/codex-runtime-metrics.test.ts`.
  - Modify `tests/codex-continuity-context.test.ts`.
  - Modify `tests/codex-cli.test.ts`.
  - Modify `tests/mcp-server.test.ts`.
  - Modify `tests/codex-memory-lifecycle-daily.test.ts`.
  - Modify `tests/codex-memory-lifecycle-weekly.test.ts`.
  - Modify `tests/codex-memory-feedback.test.ts`.
  - Modify `tests/plugin-runtime.test.ts` if runtime text checks need new strings.

## Multi-Agent Ownership

Use workers only with disjoint write sets. Workers are not alone in the codebase; they must not revert edits by others and must adjust to already-merged changes.

- Runtime Worker: `src/codex/context-policy.ts`, `src/codex/continuity-context.ts`, `tests/codex-context-policy.test.ts`, `tests/codex-continuity-context.test.ts`.
- Projection Worker: `src/codex/fast-summary-store.ts`, `src/codex/session-hints.ts`, `src/codex/runtime-metrics.ts`, matching focused tests.
- Surface Worker: `src/mcp/tools/continuity-get.ts`, `src/codex/codex-cli.ts`, `src/codex/memory-context-preview.ts`, CLI/MCP tests.
- Automation Worker: daily/weekly lifecycle, `src/codex/memory-automation.ts`, automation tests.
- Docs Worker: `plugin/skills/cyrene-continuity/SKILL.md`, `README.md`, release notes, plugin rebuild validation.
- Coordinator: shared types, conflict resolution, final `npm test`, `npm run typecheck`, `npm run build:plugin`, plugin validation, and completion audit.

## Task 1: Context Policy Contract

**Files:**
- Create: `src/codex/context-policy.ts`
- Test: `tests/codex-context-policy.test.ts`

- [ ] **Step 1: Write failing policy tests**

Create `tests/codex-context-policy.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { buildRetrievalPolicy, parseContextMode, type ContextMode } from '../src/codex/context-policy.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('context policy', () => {
  it('defaults ordinary reads to fast mode without review side effects', () => {
    expect(buildRetrievalPolicy({})).toMatchObject({
      mode: 'fast',
      maxTokens: 800,
      includePendingDetails: false,
      includePendingNotice: false,
      includeDiagnostics: false,
      includeSimilarProjectHints: false,
      includeSessionHints: false,
      includeFullProfile: false,
      includeFastSummaries: true,
      recordRetrievedEvents: false,
      allowJsonlFallback: true,
      allowHotPathIndexRebuild: false
    })
  })

  it('uses balanced mode for explicit richer context without pending review visibility', () => {
    expect(buildRetrievalPolicy({ mode: 'balanced' })).toMatchObject({
      mode: 'balanced',
      maxTokens: 1200,
      includePendingDetails: false,
      includePendingNotice: false,
      includeDiagnostics: false,
      includeSimilarProjectHints: false,
      includeSessionHints: true,
      includeFullProfile: false,
      includeFastSummaries: false,
      recordRetrievedEvents: false
    })
  })

  it('uses review mode for pending, diagnostics, and review visibility', () => {
    expect(buildRetrievalPolicy({ mode: 'review' })).toMatchObject({
      mode: 'review',
      maxTokens: 4000,
      includePendingDetails: true,
      includePendingNotice: true,
      includeDiagnostics: true,
      includeSimilarProjectHints: true,
      includeSessionHints: true,
      includeFullProfile: true,
      includeFastSummaries: false,
      recordRetrievedEvents: false
    })
  })

  it('lets explicit flags override mode defaults', () => {
    expect(buildRetrievalPolicy({
      mode: 'fast',
      includeDiagnostics: true,
      includeSimilarProjectHints: true,
      recordRetrievedEvents: true,
      maxTokens: 333
    })).toMatchObject({
      mode: 'fast',
      maxTokens: 333,
      includeDiagnostics: true,
      includeSimilarProjectHints: true,
      recordRetrievedEvents: true
    })
  })

  it('lets env defaults fill missing explicit values', () => {
    vi.stubEnv('CYRENE_CONTEXT_MODE', 'balanced')
    vi.stubEnv('CYRENE_CONTEXT_INCLUDE_DIAGNOSTICS', 'true')
    vi.stubEnv('CYRENE_CONTEXT_MAX_TOKENS', '999')
    expect(buildRetrievalPolicy({})).toMatchObject({
      mode: 'balanced',
      includeDiagnostics: true,
      maxTokens: 999
    })
  })

  it.each(['fast', 'balanced', 'review'] as ContextMode[])('parses valid mode %s', (mode) => {
    expect(parseContextMode(mode)).toBe(mode)
  })

  it('rejects invalid modes', () => {
    expect(() => parseContextMode('deep')).toThrow(/Invalid context mode/)
  })
})
```

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/codex-context-policy.test.ts
```

Expected: FAIL because `src/codex/context-policy.ts` does not exist.

- [ ] **Step 3: Implement context policy module**

Create `src/codex/context-policy.ts`:

```ts
export const CONTEXT_MODES = ['fast', 'balanced', 'review'] as const
export type ContextMode = typeof CONTEXT_MODES[number]

export interface RetrievalPolicyFlags {
  includePendingDetails?: boolean
  includePendingNotice?: boolean
  includeDiagnostics?: boolean
  includeSimilarProjectHints?: boolean
  includeSessionHints?: boolean
  includeFullProfile?: boolean
  includeFastSummaries?: boolean
  recordRetrievedEvents?: boolean
  allowJsonlFallback?: boolean
  maxTokens?: number
}

export interface RetrievalPolicy {
  mode: ContextMode
  maxTokens: number
  includePendingDetails: boolean
  includePendingNotice: boolean
  includeDiagnostics: boolean
  includeSimilarProjectHints: boolean
  includeSessionHints: boolean
  includeFullProfile: boolean
  includeFastSummaries: boolean
  recordRetrievedEvents: boolean
  allowJsonlFallback: boolean
  allowHotPathIndexRebuild: false
}

export interface BuildRetrievalPolicyInput extends RetrievalPolicyFlags {
  mode?: ContextMode | string
  env?: NodeJS.ProcessEnv
}

const MODE_DEFAULTS: Record<ContextMode, RetrievalPolicy> = {
  fast: {
    mode: 'fast',
    maxTokens: 800,
    includePendingDetails: false,
    includePendingNotice: false,
    includeDiagnostics: false,
    includeSimilarProjectHints: false,
    includeSessionHints: false,
    includeFullProfile: false,
    includeFastSummaries: true,
    recordRetrievedEvents: false,
    allowJsonlFallback: true,
    allowHotPathIndexRebuild: false
  },
  balanced: {
    mode: 'balanced',
    maxTokens: 1200,
    includePendingDetails: false,
    includePendingNotice: false,
    includeDiagnostics: false,
    includeSimilarProjectHints: false,
    includeSessionHints: true,
    includeFullProfile: false,
    includeFastSummaries: false,
    recordRetrievedEvents: false,
    allowJsonlFallback: true,
    allowHotPathIndexRebuild: false
  },
  review: {
    mode: 'review',
    maxTokens: 4000,
    includePendingDetails: true,
    includePendingNotice: true,
    includeDiagnostics: true,
    includeSimilarProjectHints: true,
    includeSessionHints: true,
    includeFullProfile: true,
    includeFastSummaries: false,
    recordRetrievedEvents: false,
    allowJsonlFallback: true,
    allowHotPathIndexRebuild: false
  }
}

export function parseContextMode(value: string | undefined): ContextMode | undefined {
  if (value === undefined || value === '') return undefined
  if (value === 'fast' || value === 'balanced' || value === 'review') return value
  throw new Error(`Invalid context mode: ${value}. Expected fast, balanced, or review`)
}

export function buildRetrievalPolicy(input: BuildRetrievalPolicyInput): RetrievalPolicy {
  const env = input.env ?? process.env
  const mode = parseContextMode(input.mode) ?? parseContextMode(env.CYRENE_CONTEXT_MODE) ?? 'fast'
  const envFlags = envPolicyFlags(env)
  const merged = {
    ...MODE_DEFAULTS[mode],
    ...definedOnly(envFlags),
    ...definedOnly({
      maxTokens: input.maxTokens,
      includePendingDetails: input.includePendingDetails,
      includePendingNotice: input.includePendingNotice,
      includeDiagnostics: input.includeDiagnostics,
      includeSimilarProjectHints: input.includeSimilarProjectHints,
      includeSessionHints: input.includeSessionHints,
      includeFullProfile: input.includeFullProfile,
      includeFastSummaries: input.includeFastSummaries,
      recordRetrievedEvents: input.recordRetrievedEvents,
      allowJsonlFallback: input.allowJsonlFallback
    }),
    mode,
    allowHotPathIndexRebuild: false as const
  }
  return merged
}

function envPolicyFlags(env: NodeJS.ProcessEnv): RetrievalPolicyFlags {
  return {
    maxTokens: parsePositiveInteger(env.CYRENE_CONTEXT_MAX_TOKENS),
    includePendingDetails: parseBoolean(env.CYRENE_CONTEXT_INCLUDE_PENDING_DETAILS),
    includePendingNotice: parseBoolean(env.CYRENE_CONTEXT_INCLUDE_PENDING_NOTICE),
    includeDiagnostics: parseBoolean(env.CYRENE_CONTEXT_INCLUDE_DIAGNOSTICS),
    includeSimilarProjectHints: parseBoolean(env.CYRENE_CONTEXT_INCLUDE_SIMILAR_PROJECT_HINTS),
    includeSessionHints: parseBoolean(env.CYRENE_CONTEXT_INCLUDE_SESSION_HINTS),
    includeFullProfile: parseBoolean(env.CYRENE_CONTEXT_INCLUDE_FULL_PROFILE),
    includeFastSummaries: parseBoolean(env.CYRENE_CONTEXT_INCLUDE_FAST_SUMMARIES),
    recordRetrievedEvents: parseBoolean(env.CYRENE_CONTEXT_RECORD_RETRIEVED_EVENTS),
    allowJsonlFallback: parseBoolean(env.CYRENE_CONTEXT_ALLOW_JSONL_FALLBACK)
  }
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  throw new Error(`Invalid boolean environment value: ${value}`)
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed > 0) return parsed
  throw new Error(`Invalid positive integer environment value: ${value}`)
}

function definedOnly<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}
```

- [ ] **Step 4: Run policy tests**

Run:

```bash
npm test -- tests/codex-context-policy.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit policy contract**

Run:

```bash
git add src/codex/context-policy.ts tests/codex-context-policy.test.ts
git commit -m "feat: add context retrieval policy"
```

Expected: commit succeeds.

## Task 2: Fast Summary, Session Hints, And Runtime Metrics Stores

**Files:**
- Create: `src/codex/fast-summary-store.ts`
- Create: `src/codex/session-hints.ts`
- Create: `src/codex/runtime-metrics.ts`
- Test: `tests/codex-fast-summary-store.test.ts`
- Test: `tests/codex-session-hints.test.ts`
- Test: `tests/codex-runtime-metrics.test.ts`

- [ ] **Step 1: Write failing projection store tests**

Create `tests/codex-fast-summary-store.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readFastSummaryProjection,
  writeFastSummaryProjection
} from '../src/codex/fast-summary-store.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('fast summary store', () => {
  it('writes and reads capped global/profile fast summaries', async () => {
    const root = await createTempDir('cyrene-fast-summary-')
    await writeFastSummaryProjection(root, {
      globalFastSummary: 'Use surgical changes. '.repeat(80),
      profileFastSummary: 'Prefer concise engineering Chinese. '.repeat(80),
      generatedAt: '2026-06-05T00:00:00.000Z'
    })

    const projection = await readFastSummaryProjection(root)
    expect(projection.generatedAt).toBe('2026-06-05T00:00:00.000Z')
    expect(projection.globalFastSummary.length).toBeLessThanOrEqual(900)
    expect(projection.profileFastSummary.length).toBeLessThanOrEqual(700)
  })

  it('returns empty summaries when projection files are absent', async () => {
    const root = await createTempDir('cyrene-fast-summary-empty-')
    await expect(readFastSummaryProjection(root)).resolves.toEqual({
      globalFastSummary: '',
      profileFastSummary: '',
      generatedAt: undefined
    })
  })
})
```

Create `tests/codex-session-hints.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearCodexSessionHints,
  readCodexSessionHints,
  replaceCodexSessionHints
} from '../src/codex/session-hints.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('session hints', () => {
  it('replaces hints instead of appending', async () => {
    const root = await createTempDir('cyrene-session-hints-')
    await replaceCodexSessionHints(root, {
      sessionId: 's1',
      projectId: 'p1',
      hints: [{ id: 'h1', sourceProjectId: 'p2', summary: 'First hint.', createdAt: '2026-06-05T00:00:00.000Z' }],
      now: '2026-06-05T00:00:00.000Z'
    })
    await replaceCodexSessionHints(root, {
      sessionId: 's1',
      projectId: 'p1',
      hints: [{ id: 'h2', sourceProjectId: 'p3', summary: 'Second hint.', createdAt: '2026-06-05T01:00:00.000Z' }],
      now: '2026-06-05T01:00:00.000Z'
    })

    const hints = await readCodexSessionHints(root, {
      sessionId: 's1',
      projectId: 'p1',
      now: '2026-06-05T01:00:00.000Z'
    })
    expect(hints.map((hint) => hint.id)).toEqual(['h2'])
  })

  it('clears hints on project switch', async () => {
    const root = await createTempDir('cyrene-session-hints-clear-')
    await replaceCodexSessionHints(root, {
      sessionId: 's1',
      projectId: 'p1',
      hints: [{ id: 'h1', sourceProjectId: 'p2', summary: 'Hint.', createdAt: '2026-06-05T00:00:00.000Z' }],
      now: '2026-06-05T00:00:00.000Z'
    })
    await clearCodexSessionHints(root)
    await expect(readCodexSessionHints(root, {
      sessionId: 's1',
      projectId: 'p1',
      now: '2026-06-05T00:00:00.000Z'
    })).resolves.toEqual([])
  })
})
```

Create `tests/codex-runtime-metrics.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendRuntimeMetric, readRuntimeMetrics } from '../src/codex/runtime-metrics.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('runtime metrics', () => {
  it('records runtime metric events without raw prompt text', async () => {
    const root = await createTempDir('cyrene-runtime-metrics-')
    await appendRuntimeMetric(root, {
      event: 'continuity_get',
      mode: 'fast',
      latencyMs: 17,
      sqliteLatencyMs: 4,
      similarLatencyMs: 0,
      pendingLatencyMs: 0,
      profileReadLatencyMs: 0,
      tokenOverhead: 311,
      jsonlFallback: false,
      indexStale: false,
      createdAt: '2026-06-05T00:00:00.000Z'
    })

    const metrics = await readRuntimeMetrics(root)
    expect(metrics).toHaveLength(1)
    expect(JSON.stringify(metrics)).not.toContain('raw prompt')
    expect(metrics[0]).toMatchObject({ event: 'continuity_get', mode: 'fast', latencyMs: 17 })
  })
})
```

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/codex-fast-summary-store.test.ts tests/codex-session-hints.test.ts tests/codex-runtime-metrics.test.ts
```

Expected: FAIL because the three modules do not exist.

- [ ] **Step 3: Implement fast summary store**

Create `src/codex/fast-summary-store.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSafeMemoryDataFileTarget } from '../memory/memory-store.js'

const GLOBAL_FAST_SUMMARY_FILE = 'global_fast_summary.md'
const PROFILE_FAST_SUMMARY_FILE = 'profile_fast_summary.md'
const FAST_SUMMARY_META_FILE = 'fast_summary_meta.json'
const GLOBAL_CHAR_LIMIT = 900
const PROFILE_CHAR_LIMIT = 700

export interface FastSummaryProjection {
  globalFastSummary: string
  profileFastSummary: string
  generatedAt?: string
}

export async function readFastSummaryProjection(memoryRoot: string): Promise<FastSummaryProjection> {
  const [globalFastSummary, profileFastSummary, generatedAt] = await Promise.all([
    readOptionalSafeText(join(memoryRoot, GLOBAL_FAST_SUMMARY_FILE)),
    readOptionalSafeText(join(memoryRoot, PROFILE_FAST_SUMMARY_FILE)),
    readGeneratedAt(join(memoryRoot, FAST_SUMMARY_META_FILE))
  ])
  return { globalFastSummary, profileFastSummary, generatedAt }
}

export async function writeFastSummaryProjection(memoryRoot: string, projection: FastSummaryProjection): Promise<void> {
  await mkdir(memoryRoot, { recursive: true })
  const globalPath = join(memoryRoot, GLOBAL_FAST_SUMMARY_FILE)
  const profilePath = join(memoryRoot, PROFILE_FAST_SUMMARY_FILE)
  const metaPath = join(memoryRoot, FAST_SUMMARY_META_FILE)
  await Promise.all([
    assertSafeMemoryDataFileTarget(globalPath),
    assertSafeMemoryDataFileTarget(profilePath),
    assertSafeMemoryDataFileTarget(metaPath)
  ])
  await Promise.all([
    writeFile(globalPath, `${capText(projection.globalFastSummary, GLOBAL_CHAR_LIMIT)}\n`, 'utf8'),
    writeFile(profilePath, `${capText(projection.profileFastSummary, PROFILE_CHAR_LIMIT)}\n`, 'utf8'),
    writeFile(metaPath, `${JSON.stringify({ generatedAt: projection.generatedAt ?? new Date().toISOString() })}\n`, 'utf8')
  ])
}

function capText(value: string, limit: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned.length <= limit ? cleaned : cleaned.slice(0, limit).trimEnd()
}

async function readOptionalSafeText(filePath: string): Promise<string> {
  await assertSafeMemoryDataFileTarget(filePath)
  try {
    return (await readFile(filePath, 'utf8')).trim()
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) return ''
    throw error
  }
}

async function readGeneratedAt(filePath: string): Promise<string | undefined> {
  await assertSafeMemoryDataFileTarget(filePath)
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as { generatedAt?: unknown }
    return typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) return undefined
    throw error
  }
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
```

- [ ] **Step 4: Implement session hints and metrics modules**

Create `src/codex/session-hints.ts` with `replaceCodexSessionHints`, `readCodexSessionHints`, `clearCodexSessionHints`, file name `session_hints.json`, TTL default 8 hours, and project/session matching. Create `src/codex/runtime-metrics.ts` with JSONL file `runtime_metrics.jsonl`, `appendRuntimeMetric`, and `readRuntimeMetrics`.

Use this shape for session hints:

```ts
export interface CodexSessionHint {
  id: string
  sourceProjectId: string
  sourceProjectName?: string
  summary: string
  createdAt: string
}
```

Use this shape for metrics:

```ts
export interface RuntimeMetricEvent {
  event: 'continuity_get' | 'hook'
  mode?: 'fast' | 'balanced' | 'review'
  latencyMs: number
  sqliteLatencyMs?: number
  similarLatencyMs?: number
  pendingLatencyMs?: number
  profileReadLatencyMs?: number
  tokenOverhead?: number
  jsonlFallback?: boolean
  indexStale?: boolean
  hookEvent?: 'session_start' | 'user_prompt_submit' | 'post_tool_use' | 'stop'
  createdAt: string
}
```

- [ ] **Step 5: Run projection tests**

Run:

```bash
npm test -- tests/codex-fast-summary-store.test.ts tests/codex-session-hints.test.ts tests/codex-runtime-metrics.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit projection stores**

Run:

```bash
git add src/codex/fast-summary-store.ts src/codex/session-hints.ts src/codex/runtime-metrics.ts tests/codex-fast-summary-store.test.ts tests/codex-session-hints.test.ts tests/codex-runtime-metrics.test.ts
git commit -m "feat: add fast summary and session hint stores"
```

Expected: commit succeeds.

## Task 3: Runtime Context Policy Integration

**Files:**
- Modify: `src/codex/continuity-context.ts`
- Test: `tests/codex-continuity-context.test.ts`
- Test: `tests/codex-memory-feedback.test.ts`

- [ ] **Step 1: Write failing fast-mode tests**

In `tests/codex-continuity-context.test.ts`, add tests that assert default fast behavior:

```ts
it('defaults to fast mode without pending notice, similar hints, diagnostics, or retrieved events', async () => {
  const home = await createTempDir('cyrene-codex-continuity-fast-default-home-')
  process.env.HOME = home
  const currentRepo = await createTempDir('cyrene-codex-continuity-fast-current-')
  const otherRepo = await createTempDir('cyrene-codex-continuity-fast-other-')
  await writeFile(join(currentRepo, 'package.json'), JSON.stringify({ dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' } }), 'utf8')
  await writeFile(join(otherRepo, 'package.json'), JSON.stringify({ dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' } }), 'utf8')
  const current = await identifyCodexProject(currentRepo)
  const other = await identifyCodexProject(otherRepo)
  const currentRoot = codexProjectMemoryRoot(current.projectId)
  const otherRoot = codexProjectMemoryRoot(other.projectId)
  await mkdir(currentRoot, { recursive: true })
  await mkdir(otherRoot, { recursive: true })
  await writeFile(join(currentRoot, 'index.jsonl'), JSON.stringify(createMemory({
    id: 'fast-current-active',
    content: 'Fast current active context memory.',
    normalizedKey: 'fast-current-active'
  })) + '\n')
  await writeFile(join(currentRoot, 'review_queue.jsonl'), JSON.stringify(createPendingMemory()) + '\n')
  await writeFile(join(otherRoot, 'index.jsonl'), JSON.stringify(createMemory({
    id: 'fast-portable-similar',
    portability: 'similar_project',
    domain: 'procedural',
    content: 'Fast mode must not query similar project guidance.',
    normalizedKey: 'fast-portable-similar'
  })) + '\n')
  await rebuildCodexMemoryIndex({ cwd: otherRepo })
  await rebuildCodexMemoryIndex({ cwd: currentRepo })

  const context = await getCodexContinuityContext({
    cwd: currentRepo,
    userMessage: 'fast current active similar guidance',
    task: 'coding'
  })

  expect(context.projectMemory.map((item) => item.id)).toContain('fast-current-active')
  expect(context.similarProjectHints).toEqual([])
  expect(context.pendingHypotheses).toEqual([])
  expect(context.reviewReminders).toEqual([])
  expect(context.pendingReview).toEqual({})
  expect(context.diagnostics).toBeUndefined()
  expect(await readActivationEventsFromRoot(currentRoot)).toEqual([])
})
```

Add review-mode counterpart:

```ts
it('review mode returns pending notice, pending hypotheses, diagnostics, and similar hints', async () => {
  const home = await createTempDir('cyrene-codex-continuity-review-mode-home-')
  process.env.HOME = home
  const currentRepo = await createTempDir('cyrene-codex-continuity-review-current-')
  const otherRepo = await createTempDir('cyrene-codex-continuity-review-other-')
  await writeFile(join(currentRepo, 'package.json'), JSON.stringify({
    dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
    devDependencies: { typescript: '^5.0.0' }
  }), 'utf8')
  await writeFile(join(currentRepo, 'package-lock.json'), '{}\n', 'utf8')
  await writeFile(join(otherRepo, 'package.json'), JSON.stringify({
    dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
    devDependencies: { typescript: '^5.0.0' }
  }), 'utf8')
  await writeFile(join(otherRepo, 'package-lock.json'), '{}\n', 'utf8')
  const current = await identifyCodexProject(currentRepo)
  const other = await identifyCodexProject(otherRepo)
  const currentRoot = codexProjectMemoryRoot(current.projectId)
  const otherRoot = codexProjectMemoryRoot(other.projectId)
  await mkdir(currentRoot, { recursive: true })
  await mkdir(otherRoot, { recursive: true })
  await writeFile(join(currentRoot, 'index.jsonl'), JSON.stringify(createMemory({
    id: 'review-current-active',
    content: 'Review current active context memory.',
    normalizedKey: 'review-current-active'
  })) + '\n')
  await writeFile(join(currentRoot, 'review_queue.jsonl'), JSON.stringify({
    ...createPendingMemory(),
    id: 'review-pending-context',
    content: 'Review mode pending candidate can appear in review-only context.',
    normalizedKey: 'review-pending-context'
  }) + '\n')
  await writeFile(join(otherRoot, 'index.jsonl'), JSON.stringify(createMemory({
    id: 'review-portable-similar',
    portability: 'similar_project',
    domain: 'procedural',
    type: 'procedural_rule',
    content: 'Review mode can inspect transferable similar project guidance.',
    normalizedKey: 'review-portable-similar',
    tags: ['mcp', 'plugin']
  })) + '\n')
  await rebuildCodexMemoryIndex({ cwd: otherRepo })
  await rebuildCodexMemoryIndex({ cwd: currentRepo })

  const context = await getCodexContinuityContext({
    cwd: currentRepo,
    userMessage: 'review current active pending similar project guidance',
    task: 'memory',
    mode: 'review',
    includeSimilarProjectHints: true
  })

  expect(context.pendingReview).toMatchObject({
    count: 1,
    hasItems: true,
    newestCandidateId: 'review-pending-context'
  })
  expect(context.pendingHypotheses).toEqual([
    expect.objectContaining({ id: 'review-pending-context', provisional: true, status: 'pending' })
  ])
  expect(context.diagnostics?.memoryIndex).toBeDefined()
  expect(context.similarProjectHints).toEqual([
    expect.objectContaining({
      id: 'review-portable-similar',
      sourceProjectId: other.projectId,
      transferable: true,
      notCurrentProjectFact: true
    })
  ])
  expect(context.memory.items.map((item) => item.id)).not.toContain('review-pending-context')
  expect(context.memory.items.map((item) => item.id)).not.toContain('review-portable-similar')
})
```

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts
```

Expected: FAIL because `getCodexContinuityContext` does not accept mode and still returns pending/diagnostics by default.

- [ ] **Step 3: Extend public context input and output types**

In `src/codex/continuity-context.ts`:

- Import `buildRetrievalPolicy`, `ContextMode`, `RetrievalPolicy`, `RetrievalPolicyFlags`.
- Extend `getCodexContinuityContext(input)` with:

```ts
  mode?: ContextMode
  includeSimilarProjectHints?: boolean
  includePendingDetails?: boolean
  includePendingNotice?: boolean
  includeDiagnostics?: boolean
  includeSessionHints?: boolean
  includeFullProfile?: boolean
  includeFastSummaries?: boolean
  recordRetrievedEvents?: boolean
  maxTokens?: number
```

- Change `CodexPendingReviewNotice` use to allow safe empty shape by exporting:

```ts
type SafePendingReviewNotice = Partial<CodexPendingReviewNotice>
```

and use `pendingReview: SafePendingReviewNotice` in `CodexContinuityContext`.

- Add `mode` and `policy` to `diagnostics` only when `policy.includeDiagnostics` is true:

```ts
contextPolicy: {
  mode: policy.mode,
  maxTokens: policy.maxTokens
}
```

- Keep existing response fields but project fast/balanced to empty arrays or omitted diagnostics.

- [ ] **Step 4: Gate pending/profile/similar/diagnostics/activation writes by policy**

Use one policy instance:

```ts
const policy = buildRetrievalPolicy({
  mode: input.mode,
  maxTokens: input.maxTokens,
  includePendingDetails: input.includePendingDetails,
  includePendingNotice: input.includePendingNotice,
  includeDiagnostics: input.includeDiagnostics,
  includeSimilarProjectHints: input.includeSimilarProjectHints,
  includeSessionHints: input.includeSessionHints,
  includeFullProfile: input.includeFullProfile,
  includeFastSummaries: input.includeFastSummaries,
  recordRetrievedEvents: input.recordActivationEvents ?? input.recordRetrievedEvents
})
```

Fetch pending notice only when `policy.includePendingNotice` is true. Return `{}` otherwise.

Fetch full profiles only when `policy.includeFullProfile` is true. In fast mode read `readFastSummaryProjection(codexGlobalMemoryRoot())` and set `profile.content` to non-empty summaries only.

Write `retrieved` events only when `policy.recordRetrievedEvents` is true.

Return `diagnostics: undefined` unless `policy.includeDiagnostics` is true.

- [ ] **Step 5: Pass policy into routed retrieval**

Extend `retrieveRoutedMemory(input)` with `policy: RetrievalPolicy`.

Rules:

- SQLite active global/project queries run in all modes.
- `adapter.queryPending` runs only when `policy.includePendingDetails` is true.
- `adapter.querySimilarActive`, `adapter.listProjectMetadata`, `selectSimilarProjects`, and `runSimilarHintsEvalGate` run only when `policy.includeSimilarProjectHints` is true.
- `readFallbackPendingHypotheses` runs only when `policy.includePendingDetails` is true.
- `fallbackRoutedMemory` returns empty pending hypotheses when pending is disabled.
- `sqliteRetrievalDiagnostics` routes omit `pending` and `similar_project` when disabled.
- `jsonlRetrievalDiagnostics` routes omit `pending` when disabled.

- [ ] **Step 6: Run runtime verification**

Run:

```bash
npm test -- tests/codex-context-policy.test.ts tests/codex-continuity-context.test.ts tests/codex-memory-feedback.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit runtime integration**

Run:

```bash
git add src/codex/continuity-context.ts tests/codex-continuity-context.test.ts tests/codex-memory-feedback.test.ts
git commit -m "feat: gate continuity context by mode policy"
```

Expected: commit succeeds.

## Task 4: CLI, MCP, And Context Preview Surfaces

**Files:**
- Modify: `src/mcp/tools/continuity-get.ts`
- Modify: `src/codex/codex-cli.ts`
- Modify: `src/codex/memory-context-preview.ts`
- Test: `tests/mcp-server.test.ts`
- Test: `tests/codex-cli.test.ts`

- [ ] **Step 1: Write failing CLI/MCP tests**

In `tests/mcp-server.test.ts`, update the continuity tool test to call:

```ts
const result = await client.callTool({
  name: 'cyrene_continuity_get',
  arguments: {
    cwd,
    userMessage: 'read continuity diagnostics',
    task: 'coding',
    mode: 'review',
    includeDiagnostics: true
  }
})
```

Add schema assertions:

```ts
expect(schemasByName.get('cyrene_continuity_get')?.properties ?? {}).toMatchObject({
  userMessage: expect.any(Object),
  task: expect.any(Object),
  mode: expect.any(Object),
  includeSimilarProjectHints: expect.any(Object),
  includePendingDetails: expect.any(Object),
  includeDiagnostics: expect.any(Object),
  recordRetrievedEvents: expect.any(Object),
  maxTokens: expect.any(Object)
})
```

In `tests/codex-cli.test.ts`, change the context-preview pending exclusion test to pass `--mode review`. Add a new default fast preview test:

```ts
it('defaults context-preview to fast visibility without pending exclusions', async () => {
  // Seed one pending project candidate.
  // Run memory context-preview without --mode.
  // Expected: preview.input.mode === 'fast', exclusions.pendingReview has no count/items,
  // diagnostics.pendingReview is undefined, and no pending content leaks.
})
```

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/mcp-server.test.ts tests/codex-cli.test.ts
```

Expected: FAIL because schema and CLI flags are not implemented.

- [ ] **Step 3: Update MCP schema and handler**

In `src/mcp/tools/continuity-get.ts`, add:

```ts
const modeSchema = z.enum(['fast', 'balanced', 'review'])

export const continuityGetInputSchema = {
  userMessage: z.string(),
  task: taskSchema.optional(),
  mode: modeSchema.optional(),
  includeSimilarProjectHints: z.boolean().optional(),
  includePendingDetails: z.boolean().optional(),
  includePendingNotice: z.boolean().optional(),
  includeDiagnostics: z.boolean().optional(),
  recordRetrievedEvents: z.boolean().optional(),
  maxTokens: z.number().int().positive().optional()
}
```

Forward all fields to `getCodexContinuityContext`. Keep `cwd` accepted by `handleContinuityGet` for compatibility, but do not expose it in `continuityGetInputSchema`.

- [ ] **Step 4: Update CLI parsing**

In `src/codex/codex-cli.ts`:

- Import `ContextMode` and `parseContextMode`.
- Add `parseContextModeOption(args)`.
- Add `parseOptionalBooleanFlag(args, name)` that returns true when `--flag` is present and false when `--no-flag` is present.
- Add `parseContextMaxTokens(args)` using existing positive integer helper.
- Pass mode and flags into `runCodexMemoryContextPreview`.
- Update help text for `memory context-preview`:

```txt
memory context-preview --message <text> [--task coding|planning|debugging|conversation|memory] [--mode fast|balanced|review] [--include-similar-project-hints] [--include-pending-details] [--include-diagnostics] [--record-retrieved-events] [--max-tokens <n>]
```

- [ ] **Step 5: Update context-preview projection**

In `src/codex/memory-context-preview.ts`:

- Add `mode` and flags to input and `CodexMemoryContextPreview.input`.
- Call `getCodexContinuityContext` with those flags and `recordActivationEvents: false` unless explicit `recordRetrievedEvents` true.
- Only read pending/tombstone/archive exclusions when mode is `review` or `includePendingDetails`/`includeDiagnostics` is true.
- In fast/balanced, return:

```ts
exclusions: {
  pendingReview: {},
  tombstones: [],
  archived: []
}
```

and omit `diagnostics.pendingReview`.

- [ ] **Step 6: Run surface verification**

Run:

```bash
npm test -- tests/mcp-server.test.ts tests/codex-cli.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit CLI/MCP surfaces**

Run:

```bash
git add src/mcp/tools/continuity-get.ts src/codex/codex-cli.ts src/codex/memory-context-preview.ts tests/mcp-server.test.ts tests/codex-cli.test.ts
git commit -m "feat: expose context modes in CLI and MCP"
```

Expected: commit succeeds.

## Task 5: Session Hints And Similar-Project Boundary Integration

**Files:**
- Modify: `src/codex/continuity-context.ts`
- Modify: `src/codex/codex-hook-trace.ts`
- Modify: `src/codex/hook-trace-store.ts`
- Test: `tests/codex-continuity-context.test.ts`
- Test: `tests/codex-hook-trace.test.ts`
- Test: `tests/similar-hints-review.test.ts`

- [ ] **Step 1: Write failing session/similar boundary tests**

Add a continuity test:

```ts
it('balanced mode can project existing session hints without treating them as active memory', async () => {
  const home = await createTempDir('cyrene-codex-continuity-balanced-session-home-')
  process.env.HOME = home
  const repo = await createTempDir('cyrene-codex-continuity-balanced-session-repo-')
  const identity = await identifyCodexProject(repo)
  const root = codexProjectMemoryRoot(identity.projectId)
  await mkdir(root, { recursive: true })
  await replaceCodexSessionHints(root, {
    sessionId: 'session-1',
    projectId: identity.projectId,
    hints: [{ id: 'hint-1', sourceProjectId: 'other-project', summary: 'Transferable runtime rebuild guidance.', createdAt: '2026-06-05T00:00:00.000Z' }],
    now: '2026-06-05T00:00:00.000Z'
  })

  const context = await getCodexContinuityContext({
    cwd: repo,
    userMessage: 'runtime rebuild guidance',
    task: 'planning',
    mode: 'balanced',
    includeSessionHints: true,
    sessionId: 'session-1'
  })

  expect(context.similarProjectHints).toEqual([])
  expect(context.sessionHints).toEqual([
    expect.objectContaining({ id: 'hint-1', transferable: true, notCurrentProjectFact: true })
  ])
  expect(context.memory.items).toEqual([])
})
```

Add a hook trace test:

```ts
it('clears session hints when a new session starts', async () => {
  const home = await createTempDir('cyrene-hook-session-hints-home-')
  process.env.HOME = home
  const cwd = await createTempDir('cyrene-hook-session-hints-project-')
  const identity = await identifyCodexProject(cwd)
  const root = codexProjectMemoryRoot(identity.projectId)
  await mkdir(root, { recursive: true })
  await replaceCodexSessionHints(root, {
    sessionId: 's1',
    projectId: identity.projectId,
    hints: [{
      id: 'hint-before-session-start',
      sourceProjectId: 'other-project',
      summary: 'Session start must clear this hint.',
      createdAt: '2026-06-05T00:00:00.000Z'
    }],
    now: '2026-06-05T00:00:00.000Z'
  })

  await handleCodexHookTraceCommand('session_start', JSON.stringify({
    cwd,
    session_id: 's2'
  }))

  await expect(readCodexSessionHints(root, {
    sessionId: 's1',
    projectId: identity.projectId,
    now: '2026-06-05T00:01:00.000Z'
  })).resolves.toEqual([])
})
```

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts tests/codex-hook-trace.test.ts tests/similar-hints-review.test.ts
```

Expected: FAIL because `sessionHints` and session clearing are not integrated.

- [ ] **Step 3: Add session hints to continuity context**

In `src/codex/continuity-context.ts`:

- Import `readCodexSessionHints`.
- Add `sessionId?: string` input.
- Add `sessionHints` field to `CodexContinuityContext`:

```ts
sessionHints: Array<{
  id: string
  sourceProjectId: string
  sourceProjectName?: string
  content: string
  transferable: true
  notCurrentProjectFact: true
  rationale: string
}>
```

- Read hints only when `policy.includeSessionHints` and `input.sessionId` are both present.
- Do not pass session hints into activation, active memory, profile, or retrieved event logic.

- [ ] **Step 4: Clear hints on session start**

In `src/codex/codex-hook-trace.ts`, when event is `session_start`, identify the project root and call `clearCodexSessionHints(root)` after appending the trace. Hook failures still fail open.

- [ ] **Step 5: Run session/similar verification**

Run:

```bash
npm test -- tests/codex-session-hints.test.ts tests/codex-continuity-context.test.ts tests/codex-hook-trace.test.ts tests/similar-hints-review.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit session boundary integration**

Run:

```bash
git add src/codex/continuity-context.ts src/codex/codex-hook-trace.ts src/codex/hook-trace-store.ts tests/codex-continuity-context.test.ts tests/codex-hook-trace.test.ts tests/similar-hints-review.test.ts
git commit -m "feat: keep similar hints session-local"
```

Expected: commit succeeds.

## Task 6: Daily/Weekly Automation Summary And Metrics Maintenance

**Files:**
- Modify: `src/codex/codex-memory-lifecycle-daily.ts`
- Modify: `src/codex/codex-memory-lifecycle-weekly.ts`
- Modify: `src/codex/memory-automation.ts`
- Test: `tests/codex-memory-lifecycle-daily.test.ts`
- Test: `tests/codex-memory-lifecycle-weekly.test.ts`

- [ ] **Step 1: Write failing automation tests**

In `tests/codex-memory-lifecycle-daily.test.ts`, add:

```ts
it('daily updates fast summaries from active memory and confirmed profile only', async () => {
  const home = await createTempDir('cyrene-daily-fast-summary-home-')
  process.env.HOME = home
  const cwd = await createTempDir('cyrene-daily-fast-summary-project-')
  const identity = await identifyCodexProject(cwd)
  const projectRoot = codexProjectMemoryRoot(identity.projectId)
  const globalRoot = codexGlobalMemoryRoot()
  await writeSemanticMemoriesFromRoot(globalRoot, [
    semanticMemory({
      id: 'global-core-fast-summary',
      scope: 'global',
      confidenceTier: 'global_core',
      domain: 'procedural',
      content: 'Use surgical changes across repositories.'
    }),
    semanticMemory({
      id: 'global-pending-noise',
      status: 'pending',
      scope: 'global',
      content: 'PENDING SHOULD NOT ENTER FAST SUMMARY'
    })
  ])
  await mkdir(globalRoot, { recursive: true })
  await writeFile(join(globalRoot, 'MODEL_PROFILE.md'), '# Profile\n\nPrefer concise engineering Chinese.\n')

  await runCodexMemoryLifecycleDaily({
    cwd,
    projectRoots: [{ projectId: identity.projectId, memoryRoot: projectRoot }],
    includeGlobalRoot: true,
    apply: true,
    now: '2026-06-05T00:00:00.000Z'
  })

  const summary = await readFastSummaryProjection(globalRoot)
  expect(summary.globalFastSummary).toContain('Use surgical changes across repositories.')
  expect(summary.globalFastSummary).not.toContain('PENDING SHOULD NOT ENTER FAST SUMMARY')
  expect(summary.profileFastSummary).toContain('Prefer concise engineering Chinese.')
})
```

In weekly tests, add an assertion that weekly refreshes summaries without promoting similar hints or pending high-risk content.

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/codex-memory-lifecycle-daily.test.ts tests/codex-memory-lifecycle-weekly.test.ts
```

Expected: FAIL because automation does not update fast summaries.

- [ ] **Step 3: Implement deterministic summary refresh**

In `src/codex/codex-memory-lifecycle-daily.ts`:

- Import `readModelProfileFromRootIfExists`, `readSemanticMemoriesFromRoot`, `writeFastSummaryProjection`.
- After root processing, refresh global fast summary once when `includeGlobalRoot` is true.
- Summary source rules:
  - Include only `status === 'active'`.
  - Include only `confidenceTier === 'global_core'` for global summary.
  - Include only domains `procedural` and `system`.
  - Exclude content containing `similar-project`, `similar project`, `pending`, `trial`, or `candidate` as standalone governance labels.
  - Profile summary comes from confirmed `MODEL_PROFILE.md`, capped by store.

Use deterministic formatting:

```ts
function buildGlobalFastSummary(memories: SemanticMemory[]): string {
  return memories
    .filter(isFastSummaryGlobalMemory)
    .slice(0, 8)
    .map((memory) => `- ${memory.content}`)
    .join('\n')
}
```

- [ ] **Step 4: Add metrics to automation result**

Extend daily/weekly root result with:

```ts
fastSummaryUpdated: boolean
indexHealthChecked: boolean
runtimeMetricsRecorded: number
```

Append a `continuity_get` or `hook` metric only when a real runtime event occurs; automation maintenance should record `indexStale` and `jsonlFallback` rates as maintenance metrics without raw prompt text.

- [ ] **Step 5: Run automation verification**

Run:

```bash
npm test -- tests/codex-fast-summary-store.test.ts tests/codex-memory-lifecycle-daily.test.ts tests/codex-memory-lifecycle-weekly.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit automation maintenance**

Run:

```bash
git add src/codex/codex-memory-lifecycle-daily.ts src/codex/codex-memory-lifecycle-weekly.ts src/codex/memory-automation.ts tests/codex-memory-lifecycle-daily.test.ts tests/codex-memory-lifecycle-weekly.test.ts
git commit -m "feat: refresh fast summaries in memory automation"
```

Expected: commit succeeds.

## Task 7: Runtime Metrics Integration

**Files:**
- Modify: `src/codex/continuity-context.ts`
- Modify: `src/codex/codex-hook-trace.ts`
- Test: `tests/codex-continuity-context.test.ts`
- Test: `tests/codex-hook-trace.test.ts`
- Test: `tests/codex-runtime-metrics.test.ts`

- [ ] **Step 1: Write failing metrics integration tests**

Add a continuity test:

```ts
it('records continuity latency and fallback metrics without raw prompt text', async () => {
  const home = await createTempDir('cyrene-continuity-metrics-home-')
  process.env.HOME = home
  const repo = await createTempDir('cyrene-continuity-metrics-repo-')
  const identity = await identifyCodexProject(repo)
  const root = codexProjectMemoryRoot(identity.projectId)
  await mkdir(root, { recursive: true })

  await getCodexContinuityContext({
    cwd: repo,
    userMessage: 'raw prompt text must not persist in metrics',
    task: 'coding'
  })

  const metrics = await readRuntimeMetrics(root)
  expect(metrics.some((metric) => metric.event === 'continuity_get')).toBe(true)
  expect(JSON.stringify(metrics)).not.toContain('raw prompt text must not persist')
})
```

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/codex-continuity-context.test.ts tests/codex-hook-trace.test.ts tests/codex-runtime-metrics.test.ts
```

Expected: FAIL because runtime metrics are not appended from continuity/hook paths.

- [ ] **Step 3: Record continuity metrics**

In `src/codex/continuity-context.ts`, measure:

- total `continuity_get` latency.
- SQLite route latency around `retrieveRoutedMemory`.
- pending query latency inside `retrieveRoutedMemory`.
- similar query latency inside `retrieveRoutedMemory`.
- profile read latency around profile/summary reads.
- token overhead using `estimateTokens(JSON.stringify(projected context sections))`.
- `jsonlFallback` when diagnostics source is `jsonl`.
- `indexStale` when diagnostics freshness is `stale`.

Append one metric to current project memory root via `appendRuntimeMetric`. Fail open on metric write errors.

- [ ] **Step 4: Record hook latency metrics**

In `src/codex/codex-hook-trace.ts`, measure handler latency and append a `hook` metric with `hookEvent`. Fail open.

- [ ] **Step 5: Run metrics verification**

Run:

```bash
npm test -- tests/codex-runtime-metrics.test.ts tests/codex-continuity-context.test.ts tests/codex-hook-trace.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit runtime metrics**

Run:

```bash
git add src/codex/continuity-context.ts src/codex/codex-hook-trace.ts tests/codex-continuity-context.test.ts tests/codex-hook-trace.test.ts tests/codex-runtime-metrics.test.ts
git commit -m "feat: record continuity runtime metrics"
```

Expected: commit succeeds.

## Task 8: Skill, README, Release Notes, And Plugin Runtime

**Files:**
- Modify: `plugin/skills/cyrene-continuity/SKILL.md`
- Modify: `README.md`
- Create: `docs/superpowers/release-notes/2026-06-05-context-mode-lightweight-runtime.md`
- Generated by build: `plugin/runtime/cyrene-continuity.mjs`
- Test: `tests/mcp-server.test.ts`
- Test: `tests/plugin-runtime.test.ts`

- [ ] **Step 1: Write failing docs/skill assertions**

In `tests/mcp-server.test.ts`, change the Skill test assertions:

```ts
expect(source).toContain('pending is a review queue')
expect(source).toContain('fast and balanced mode must not show pending candidates')
expect(source).toContain('review mode is required for pending candidate review')
expect(source).toContain('similar-project hints are transferable guidance, not current-project facts')
expect(source).toContain('session-hints are not memory migration')
expect(source).toContain('activation events are not memory')
expect(source).not.toContain('Do not wait for the user to ask to review them')
expect(source).not.toContain('immediately call `cyrene_memory_pending_list`')
```

- [ ] **Step 2: Run RED verification**

Run:

```bash
npm test -- tests/mcp-server.test.ts tests/plugin-runtime.test.ts
```

Expected: FAIL because Skill still documents immediate pending review.

- [ ] **Step 3: Update Skill**

Modify `plugin/skills/cyrene-continuity/SKILL.md`:

- Keep explicit review tools and hash-checked approve/reject/edit/defer rules.
- Replace current rule 12 with:

```md
12. Treat pending as a review queue, not active memory. Fast and balanced mode must not show pending candidates, pending counts, pending notices, or pending content. Review mode is required for pending candidate review, daily/weekly automation, UI review, and explicit user requests to review memory.
```

- Add:

```md
Similar-project hints are transferable guidance, not current-project facts. Session-hints are not memory migration and must not be promoted without current-project evidence or explicit review.

Activation events are not memory. `retrieved` is disabled by default; record `applied`, `ignored`, `corrected`, `violated`, or `stale` only when the memory is actually used or explicitly evaluated.
```

- [ ] **Step 4: Update README and release notes**

Add README sections for:

- `fast`, `balanced`, `review` mode.
- CLI/MCP parameters.
- `context-preview --mode review`.
- pending review no longer interrupts ordinary requests.
- `retrieved` no longer records by default.
- fast summary and session-hints boundaries.

Create release note:

```md
# Context Mode Lightweight Runtime

Date: 2026-06-05

- `cyrene_continuity_get` now defaults to `mode=fast`.
- Fast and balanced modes no longer expose pending review count, notice, or content.
- Similar-project hints are disabled in fast mode and explicit/policy-gated elsewhere.
- `retrieved` activation events are disabled by default.
- Use `mode=review` or `memory context-preview --mode review` for pending review diagnostics.
```

- [ ] **Step 5: Rebuild and validate plugin**

Run:

```bash
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: both commands PASS.

- [ ] **Step 6: Run docs/runtime tests**

Run:

```bash
npm test -- tests/mcp-server.test.ts tests/plugin-runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit docs and plugin runtime**

Run:

```bash
git add plugin/skills/cyrene-continuity/SKILL.md README.md docs/superpowers/release-notes/2026-06-05-context-mode-lightweight-runtime.md plugin/runtime/cyrene-continuity.mjs tests/mcp-server.test.ts tests/plugin-runtime.test.ts
git commit -m "docs: document context mode runtime behavior"
```

Expected: commit succeeds.

## Task 9: Final Verification And Spec Completion Audit

**Files:**
- Modify only files needed to fix verification failures found in this task.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Rebuild plugin runtime**

Run:

```bash
npm run build:plugin
```

Expected: PASS and `plugin/runtime/cyrene-continuity.mjs` matches source.

- [ ] **Step 4: Validate plugin**

Run:

```bash
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: PASS.

- [ ] **Step 5: Run release evals**

Run:

```bash
npm run dev -- codex eval run --check similar-hints
npm run dev -- codex eval run --check release
```

Expected: both commands return JSON with passing eval gates and no failed checks.

- [ ] **Step 6: Check repository diff hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` returns no output. `git status --short` shows only intentional tracked changes before the final commit, or clean after the final commit.

- [ ] **Step 7: Audit against spec acceptance criteria**

For each item in `docs/superpowers/specs/2026-06-05-cyrene-context-mode-lightweight-runtime-design.md`, record evidence from tests, docs, source, CLI/MCP schemas, plugin validation, and eval output. The audit must prove:

- Default ordinary coding mode is `fast`.
- Fast does not read pending, return pending notice/count, query similar hints, or write `retrieved`.
- Balanced does not return pending notice/count and uses session/similar hints only through policy.
- Review is the only mode that displays pending candidates.
- Daily/weekly automation handles pending review summaries and fast summary refresh.
- Similar hints never auto-migrate to current project memory.
- Session hints do not enter memory.
- SQLite/FTS remains the hot path and JSONL fallback is monitored.
- Skill no longer interrupts ordinary work for pending review.
- Metrics cover continuity, SQLite, similar, pending, profile, fallback, stale index, and hook latency.

- [ ] **Step 8: Commit final integration fixes**

If Step 1-7 required changes, commit them:

```bash
git status --short
git add src tests plugin README.md docs
git commit -m "test: verify context mode runtime completion"
```

Expected: commit succeeds or there are no changes to commit.

- [ ] **Step 9: Report completion evidence**

Summarize:

- final branch name.
- commits created.
- verification commands and status.
- spec acceptance audit result.
- remaining risks, if any.
