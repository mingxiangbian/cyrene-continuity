# Cyrene Web UI Write Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `cyrene-continuity codex ui` 增加单项 pending memory 写操作：`Approve` / `Reject` / `Defer` / `Edit`。

**Architecture:** `src/codex/codex-ui-server.ts` 继续负责 HTTP/local-only 边界，并新增 per-server CSRF token。`src/codex/codex-ui-api.ts` 负责 write route dispatch 和 request validation，复用 `src/codex/memory-review.ts` 的 hash-checked review paths。`src/ui/static/app.js` 只做单项 Inbox selection、detail rail confirm、receipt/error feedback，不做 batch。

**Tech Stack:** Node 20 built-ins, TypeScript, existing Cyrene memory review helpers, plain HTML/CSS/JS, Vitest, Browser QA.

---

## File Structure

- Modify `src/codex/codex-ui-server.ts`: 生成 UI session token；`GET /api/session` 透传 token；所有 non-GET `/api/*` 在读取 body 前校验 `x-cyrene-ui-token`。
- Modify `src/codex/codex-ui-api.ts`: 增加 `/api/session` 和 `/api/memory/:id/(approve|reject|defer|edit)` routes；校验 body；将 memory-review result 映射为 HTTP status + receipt。
- Modify `src/codex/memory-review.ts`: 扩展 `editCodexPendingMemory()`，支持 `candidateKind` / `tags` / `scores` patch，同时保持 pending-only 和 validator check。
- Modify `src/ui/static/app.js`: 加 session token load、Inbox selection、detail rail action confirm、write fetch、receipt/error。
- Modify `src/ui/static/styles.css`: 加 selected row、detail action form、receipt/error 的 Soft UI 样式。
- Generated `src/codex/codex-ui-static.generated.ts`: 由 `node scripts/generate-ui-static.mjs` 生成。
- Generated `plugin/runtime/cyrene-continuity.mjs`: 由 `npm run build:plugin` 生成。
- Modify `tests/codex-ui-server.test.ts`: CSRF token、cross-site ordering、valid token body parse tests。
- Modify `tests/codex-ui-api.test.ts`: write route validation、approve/reject/defer/edit result tests。
- Modify `tests/codex-memory-review.test.ts`: edit patch 扩展测试。
- Modify `tests/codex-ui-assets.test.ts`: UI action/confirm/token strings 和 no-batch boundary tests。
- Modify `README.md`: 说明 Web UI v2 支持 hash-checked pending writes，不需要 API key。
- Modify `plugin/skills/cyrene-continuity/SKILL.md`: 更新 Web UI 使用边界。

---

### Task 1: Server Session Token And CSRF Gate

**Files:**
- Modify: `src/codex/codex-ui-server.ts`
- Modify: `src/codex/codex-ui-api.ts`
- Modify: `tests/codex-ui-server.test.ts`
- Modify: `tests/codex-ui-api.test.ts`

- [ ] **Step 1: Add failing API session test**

Append to `tests/codex-ui-api.test.ts`:

```ts
  it('returns the UI session token for same-origin UI bootstrap', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd } = await seedProject()

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'GET',
      pathname: '/api/session',
      uiToken: 'test-ui-token'
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      expect(result.body.data).toEqual({ token: 'test-ui-token' })
    }
  })
```

In the implementation step, extend `HandleCodexUiApiRequestInput` to include:

```ts
  uiToken?: string
```

- [ ] **Step 2: Add failing CSRF server tests**

In `tests/codex-ui-server.test.ts`, add helper:

```ts
async function fetchSessionToken(localServer: CodexUiServer): Promise<string> {
  const response = await fetch(`${localServer.url}/api/session`)
  const body = await readJson(response) as { ok: true; data: { token: string } }
  expect(response.status).toBe(200)
  expect(body.ok).toBe(true)
  expect(body.data.token).toMatch(/^[a-f0-9]{64}$/)
  return body.data.token
}
```

Add tests:

```ts
  it('serves a per-server UI session token', async () => {
    const localServer = await startTestServer()

    const token = await fetchSessionToken(localServer)

    expect(token).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects same-origin non-GET API requests without the UI token before body parsing', async () => {
    const localServer = await startTestServer()

    const response = await fetch(`${localServer.url}/api/memory/harvest-project/dry-run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad-json'
    })
    const body = await readJson(response)

    expect(response.status).toBe(403)
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'csrf_forbidden' }
    })
  })

  it('rejects same-origin non-GET API requests with the wrong UI token', async () => {
    const localServer = await startTestServer()

    const response = await fetch(`${localServer.url}/api/memory/harvest-project/dry-run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cyrene-ui-token': 'wrong-token'
      },
      body: '{}'
    })
    const body = await readJson(response)

    expect(response.status).toBe(403)
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'csrf_forbidden' }
    })
  })

  it('allows same-origin non-GET API requests with the UI token to reach body validation', async () => {
    const localServer = await startTestServer()
    const token = await fetchSessionToken(localServer)

    const response = await fetch(`${localServer.url}/api/memory/harvest-project/dry-run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cyrene-ui-token': token
      },
      body: '{bad-json'
    })
    const body = await readJson(response)

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'invalid_json' }
    })
  })
```

Update the existing malformed JSON test to include a valid token, or replace it with the valid-token body validation test above.

- [ ] **Step 3: Run tests to verify red**

Run:

```bash
npm test -- tests/codex-ui-api.test.ts tests/codex-ui-server.test.ts
```

Expected: FAIL because `/api/session`, `uiToken`, and CSRF checks do not exist.

- [ ] **Step 4: Implement API session route**

In `src/codex/codex-ui-api.ts`, extend `HandleCodexUiApiRequestInput`:

```ts
  uiToken?: string
```

Before the method guard, add:

```ts
    if (input.pathname === '/api/session') {
      if (input.method.toUpperCase() !== 'GET') {
        return methodNotAllowed()
      }
      return ok({ token: input.uiToken ?? '' })
    }
```

- [ ] **Step 5: Implement server token generation and CSRF guard**

In `src/codex/codex-ui-server.ts`, import crypto:

```ts
import { randomBytes } from 'node:crypto'
```

Extend `StartCodexUiServerInput` for deterministic tests:

```ts
  uiToken?: string
```

Add a server context:

```ts
interface CodexUiServerContext extends StartCodexUiServerInput {
  uiToken: string
}
```

In `listen()` create context before `createServer`:

```ts
    const context: CodexUiServerContext = {
      ...input,
      uiToken: input.uiToken ?? createUiToken()
    }
```

Use `context` when calling `handleRequest()`:

```ts
      handleRequest(context, request, response).catch((error: unknown) => {
```

Change `handleRequest()` and `handleApiRequest()` input type to `CodexUiServerContext`.

Before `readJsonBody()` in `handleApiRequest()`:

```ts
    if (isNonGetMethod(method) && !hasValidUiToken(request, input.uiToken)) {
      writeJson(response, 403, failure('csrf_forbidden', 'Missing or invalid Cyrene UI session token.'))
      return
    }
```

Keep the existing cross-origin check before this CSRF check.

Pass token into API:

```ts
      uiToken: input.uiToken,
```

Add helpers:

```ts
function createUiToken(): string {
  return randomBytes(32).toString('hex')
}

function hasValidUiToken(request: IncomingMessage, expectedToken: string): boolean {
  return singleHeaderValue(request.headers['x-cyrene-ui-token']) === expectedToken
}
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test -- tests/codex-ui-api.test.ts tests/codex-ui-server.test.ts
npm run typecheck
git diff --check
```

Expected: all pass.

Commit:

```bash
git add src/codex/codex-ui-api.ts src/codex/codex-ui-server.ts tests/codex-ui-api.test.ts tests/codex-ui-server.test.ts
git commit -m "feat: add codex ui session token"
```

---

### Task 2: Hash-Checked Write API Routes

**Files:**
- Modify: `src/codex/codex-ui-api.ts`
- Modify: `src/codex/memory-review.ts`
- Modify: `tests/codex-ui-api.test.ts`
- Modify: `tests/codex-memory-review.test.ts`

- [ ] **Step 1: Add failing memory-review edit patch test**

Append to `tests/codex-memory-review.test.ts`:

```ts
  it('edits pending candidate kind, tags, and scores while keeping it pending', async () => {
    const home = await createTempDir('cyrene-review-edit-kind-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-review-edit-kind-project-')
    const candidate = createPending({ tags: ['old'], candidateKind: 'workflow_rule' })
    const memoryRoot = await seedPending(cwd, [candidate])

    const result = await editCodexPendingMemory({
      cwd,
      id: candidate.id,
      reviewHash: reviewHashForPendingMemory(candidate),
      content: 'Updated pending memory content for project decisions.',
      candidateKind: 'project_decision',
      tags: ['project_decision', 'reviewed'],
      scores: { usefulness: 0.82 },
      reason: 'User edited candidate metadata.',
      now: '2026-05-25T02:00:00.000Z'
    })

    expect(result.result.action).toBe('edit')
    const pending = parseJsonLines<PendingMemory>(await readFile(join(memoryRoot, 'pending.jsonl'), 'utf8'))
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      id: candidate.id,
      status: 'pending',
      content: 'Updated pending memory content for project decisions.',
      candidateKind: 'project_decision',
      tags: ['project_decision', 'reviewed'],
      scores: expect.objectContaining({ usefulness: 0.82 }),
      lastSeenAt: '2026-05-25T02:00:00.000Z'
    })
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
```

- [ ] **Step 2: Add failing UI API write route tests**

Append to `tests/codex-ui-api.test.ts`:

```ts
  it('rejects write routes when reviewHash is missing', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, pending } = await seedProject()

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: `/api/memory/${pending.id}/approve`,
      body: {}
    })

    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' }
    })
  })

  it('maps stale review hashes to a 409 response', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, pending } = await seedProject()

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: `/api/memory/${pending.id}/approve`,
      body: { reviewHash: 'stale' }
    })

    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({
      ok: false,
      error: { code: 'review_hash_mismatch' }
    })
  })

  it('requires reasons for reject and defer write routes', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, pending } = await seedProject()
    const reviewHash = (await handleCodexUiApiRequest({
      cwd,
      method: 'GET',
      pathname: '/api/memory/pending'
    })).body

    if (!reviewHash.ok) throw new Error('expected pending list')
    const hash = (reviewHash.data as { pending: Array<{ reviewHash: string }> }).pending[0].reviewHash

    for (const action of ['reject', 'defer']) {
      const result = await handleCodexUiApiRequest({
        cwd,
        method: 'POST',
        pathname: `/api/memory/${pending.id}/${action}`,
        body: { reviewHash: hash }
      })

      expect(result.status).toBe(400)
      expect(result.body).toMatchObject({
        ok: false,
        error: { code: 'invalid_request' }
      })
    }
  })

  it('approves pending memory through the Web UI write route', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, pending, memoryRoot } = await seedProject()
    const hash = (await pendingHash(cwd))

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: `/api/memory/${pending.id}/approve`,
      body: { reviewHash: hash }
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      expect(result.body.data).toMatchObject({
        receipt: {
          action: 'approve',
          id: pending.id,
          reviewHash: hash
        }
      })
    }
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toContain(pending.content)
  })

  it('edits pending memory through the Web UI write route without promoting it', async () => {
    const home = await createTempDir('cyrene-ui-home-')
    vi.stubEnv('HOME', home)
    const { cwd, pending, memoryRoot } = await seedProject()
    const hash = await pendingHash(cwd)

    const result = await handleCodexUiApiRequest({
      cwd,
      method: 'POST',
      pathname: `/api/memory/${pending.id}/edit`,
      body: {
        reviewHash: hash,
        changeNote: 'User clarified the candidate.',
        patch: {
          content: 'Keep Web UI write actions hash-checked and pending-only.',
          candidateKind: 'workflow_rule',
          tags: ['web_ui', 'reviewed'],
          scores: { usefulness: 0.88 }
        }
      }
    })

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    if (result.body.ok) {
      expect(result.body.data).toMatchObject({
        receipt: { action: 'edit', id: pending.id },
        candidate: expect.objectContaining({
          id: pending.id,
          status: 'pending',
          content: 'Keep Web UI write actions hash-checked and pending-only.',
          tags: ['web_ui', 'reviewed']
        })
      })
    }
    await expect(readFile(join(memoryRoot, 'pending.jsonl'), 'utf8')).resolves.toContain('Keep Web UI write actions hash-checked')
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).resolves.toContain('Project Facts should be grouped for the UI.')
  })
```

Add helper near `groupIds()`:

```ts
async function pendingHash(cwd: string): Promise<string> {
  const result = await handleCodexUiApiRequest({ cwd, method: 'GET', pathname: '/api/memory/pending' })
  if (!result.body.ok) throw new Error('expected pending list')
  const data = result.body.data as { pending: Array<{ reviewHash: string }> }
  return data.pending[0].reviewHash
}
```

- [ ] **Step 3: Run tests to verify red**

Run:

```bash
npm test -- tests/codex-memory-review.test.ts tests/codex-ui-api.test.ts
```

Expected: FAIL because edit patch fields and write routes do not exist.

- [ ] **Step 4: Extend `editCodexPendingMemory()` patch support**

In `src/codex/memory-review.ts`, import `MemoryScores` and `isMemoryCandidateKind`:

```ts
import { isMemoryCandidateKind } from '../memory/candidate-kind.js'
import type { MemoryScores } from '../memory/types.js'
```

Extend input:

```ts
  candidateKind?: MemoryCandidateKind
  tags?: string[]
  scores?: Partial<MemoryScores>
```

Build edited candidate like this:

```ts
    const editedCandidate: PendingMemory = {
      ...lockedCandidate,
      content: input.content,
      normalizedKey: input.normalizedKey ?? lockedCandidate.normalizedKey,
      ...(input.candidateKind === undefined ? {} : { candidateKind: input.candidateKind }),
      ...(input.tags === undefined ? {} : { tags: uniqueInOrder(input.tags) }),
      ...(input.scores === undefined ? {} : { scores: { ...lockedCandidate.scores, ...input.scores } }),
      lastSeenAt: now
    }
```

If adding `isMemoryCandidateKind` at this layer is redundant because TypeScript already narrows `candidateKind`, do not add runtime validation here; API validation handles untrusted input.

- [ ] **Step 5: Implement write route validation and dispatch**

In `src/codex/codex-ui-api.ts`, import review helpers:

```ts
import {
  deferCodexPendingMemory,
  editCodexPendingMemory,
  promoteCodexPendingMemory,
  rejectCodexPendingMemory
} from './memory-review.js'
import { isMemoryCandidateKind } from '../memory/candidate-kind.js'
import type { MemoryScores } from '../memory/types.js'
```

Before the general GET-only guard:

```ts
    const writeRoute = parseMemoryWriteRoute(input.pathname)
    if (writeRoute !== undefined) {
      if (input.method.toUpperCase() !== 'POST') return methodNotAllowed()
      return handleMemoryWriteRoute(input, writeRoute)
    }
```

Add helpers:

```ts
type MemoryWriteAction = 'approve' | 'reject' | 'defer' | 'edit'

interface MemoryWriteRoute {
  id: string
  action: MemoryWriteAction
}

function parseMemoryWriteRoute(pathname: string): MemoryWriteRoute | undefined {
  const match = /^\/api\/memory\/([^/]+)\/(approve|reject|defer|edit)$/.exec(pathname)
  if (match === null) return undefined
  return { id: decodeURIComponent(match[1]), action: match[2] as MemoryWriteAction }
}

async function handleMemoryWriteRoute(
  input: HandleCodexUiApiRequestInput,
  route: MemoryWriteRoute
): Promise<CodexUiApiResult<unknown>> {
  const body = input.body
  if (!isRecord(body) || typeof body.reviewHash !== 'string' || body.reviewHash.trim() === '') {
    return failure(400, 'invalid_request', 'Write requests require reviewHash.')
  }
  const reviewHash = body.reviewHash
  const now = input.now

  if (route.action === 'approve') {
    return writeResultToApi(await promoteCodexPendingMemory({ cwd: input.cwd, id: route.id, reviewHash, now }), 'approve', reviewHash)
  }
  if (route.action === 'reject') {
    if (typeof body.reason !== 'string' || body.reason.trim() === '') {
      return failure(400, 'invalid_request', 'Reject requires a reason.')
    }
    return writeResultToApi(await rejectCodexPendingMemory({ cwd: input.cwd, id: route.id, reviewHash, reason: body.reason.trim(), now }), 'reject', reviewHash)
  }
  if (route.action === 'defer') {
    if (typeof body.reason !== 'string' || body.reason.trim() === '') {
      return failure(400, 'invalid_request', 'Defer requires a reason.')
    }
    const days = optionalPositiveInteger(body.days, 7)
    if (days === undefined) {
      return failure(400, 'invalid_request', 'Defer days must be a positive integer.')
    }
    return writeResultToApi(await deferCodexPendingMemory({ cwd: input.cwd, id: route.id, reviewHash, reason: body.reason.trim(), days, now }), 'defer', reviewHash)
  }

  if (typeof body.changeNote !== 'string' || body.changeNote.trim() === '') {
    return failure(400, 'invalid_request', 'Edit requires a change note.')
  }
  if (!isRecord(body.patch)) {
    return failure(400, 'invalid_request', 'Edit requires a patch object.')
  }
  const patch = parseEditPatch(body.patch)
  if ('error' in patch) return patch.error
  return writeResultToApi(await editCodexPendingMemory({
    cwd: input.cwd,
    id: route.id,
    reviewHash,
    reason: body.changeNote.trim(),
    now,
    ...patch.value
  }), 'edit', reviewHash)
}
```

Implement `writeResultToApi()` so:

- `action: 'not_found'` -> `404 not_found`
- `action: 'conflict'` -> `409 review_hash_mismatch`, include `latest`
- `action: 'normalized_key_conflict'` -> `409 normalized_key_conflict`, include `result`
- `action: 'rejected_by_validator'` -> `400 rejected_by_validator`, include `result`
- success actions -> `200 ok({ receipt, ... })`

Receipt:

```ts
function receipt(action: MemoryWriteAction, id: string, reviewHash: string, summary: string, now?: string) {
  return {
    action,
    id,
    reviewHash,
    createdAt: now ?? new Date().toISOString(),
    summary
  }
}
```

Implement edit patch parser:

```ts
interface EditPatch {
  content: string
  candidateKind?: MemoryCandidateKind
  tags?: string[]
  scores?: Partial<MemoryScores>
}

function parseEditPatch(value: Record<string, unknown>): { value: EditPatch } | { error: CodexUiApiResult<never> } {
  if (typeof value.content !== 'string' || value.content.trim() === '') {
    return { error: failure(400, 'invalid_request', 'Edit patch requires content.') }
  }
  const patch: EditPatch = { content: value.content.trim() }
  if (value.candidateKind !== undefined) {
    if (!isMemoryCandidateKind(value.candidateKind)) {
      return { error: failure(400, 'invalid_request', 'Edit patch candidateKind is invalid.') }
    }
    patch.candidateKind = value.candidateKind
  }
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || !value.tags.every((item) => typeof item === 'string')) {
      return { error: failure(400, 'invalid_request', 'Edit patch tags must be strings.') }
    }
    patch.tags = value.tags.map((item) => item.trim()).filter(Boolean)
  }
  if (value.scores !== undefined) {
    if (!isRecord(value.scores)) {
      return { error: failure(400, 'invalid_request', 'Edit patch scores must be an object.') }
    }
    const scores = parseScorePatch(value.scores)
    if ('error' in scores) return scores
    patch.scores = scores.value
  }
  return { value: patch }
}
```

Only accept these score fields: `evidenceStrength`, `stability`, `usefulness`, `safety`, `sensitivity`; each must be a number from `0` to `1`.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test -- tests/codex-memory-review.test.ts tests/codex-ui-api.test.ts
npm run typecheck
git diff --check
```

Expected: all pass.

Commit:

```bash
git add src/codex/codex-ui-api.ts src/codex/memory-review.ts tests/codex-ui-api.test.ts tests/codex-memory-review.test.ts
git commit -m "feat: add codex ui memory write api"
```

---

### Task 3: Detail Rail Write UI

**Files:**
- Modify: `src/ui/static/app.js`
- Modify: `src/ui/static/styles.css`
- Modify: `tests/codex-ui-assets.test.ts`
- Generated: `src/codex/codex-ui-static.generated.ts`
- Generated: `plugin/runtime/cyrene-continuity.mjs`

- [ ] **Step 1: Add failing UI asset expectations**

Update `tests/codex-ui-assets.test.ts`:

- Rename test description from `v1 read-only labels` to `write-confirm review labels`.
- Replace `expect(js).toContain('Write actions disabled in v1')` with:

```ts
    expect(js).toContain('Write actions require confirmation and review hash')
```

- Remove `/api/memory/approve`, `/api/memory/reject`, `/api/memory/edit`, `/api/memory/defer` from the unsafe route list.
- Add expectations:

```ts
    expect(js).toContain('/api/session')
    expect(js).toContain('x-cyrene-ui-token')
    expect(js).toContain('selectedPendingId')
    expect(js).toContain('pendingAction')
    expect(js).toContain('renderPendingDetail')
    expect(js).toContain('Confirm approve')
    expect(js).toContain('Confirm reject')
    expect(js).toContain('Confirm defer')
    expect(js).toContain('Confirm edit')
    expect(js).toContain('changeNote')
    expect(js).toContain('reviewHash')
    expect(js).toContain('decision receipt')
    expect(js).not.toContain('Approve selected')
    expect(js).not.toContain('Reject selected')
```

Add CSS expectations:

```ts
    for (const className of ['.selectable-row', '.detail-actions', '.confirm-form', '.receipt-panel']) {
      expect(css).toContain(className)
    }
```

- [ ] **Step 2: Run UI asset test to verify red**

Run:

```bash
npm test -- tests/codex-ui-assets.test.ts
```

Expected: FAIL because UI still has read-only copy and no write flow.

- [ ] **Step 3: Add session and API fetch state**

In `src/ui/static/app.js`, replace constants/state:

```js
const WRITE_ACTION_COPY = 'Write actions require confirmation and review hash.'
const SESSION_ENDPOINT = '/api/session'
```

Extend `state`:

```js
  sessionToken: '',
  selectedPendingId: '',
  pendingAction: null,
  receipt: null,
  actionError: ''
```

Replace bootstrap:

```js
  render()
  loadApp()
```

Add:

```js
async function loadApp() {
  await loadSession()
  await loadDashboard()
}

async function loadSession() {
  const response = await fetch(SESSION_ENDPOINT, { headers: { accept: 'application/json' } })
  const payload = await response.json()
  if (!payload.ok) throw new Error(payload.error?.message || 'Session API returned an error.')
  state.sessionToken = payload.data?.token || ''
}

async function apiFetch(pathname, options = {}) {
  const method = options.method || 'GET'
  const headers = {
    accept: 'application/json',
    ...(options.headers || {})
  }
  if (method.toUpperCase() !== 'GET') {
    headers['content-type'] = 'application/json'
    headers['x-cyrene-ui-token'] = state.sessionToken
  }
  return fetch(pathname, { ...options, method, headers })
}
```

Use `apiFetch()` in `loadDashboard()` and `runHarvesterDryRun()`.

- [ ] **Step 4: Make Inbox rows selectable and remove inline disabled actions**

Change `renderCandidateRow(candidate)`:

```js
function renderCandidateRow(candidate) {
  const selected = state.selectedPendingId === candidate.id
  return `
    <article class="data-row candidate-row selectable-row ${selected ? 'selected' : ''}" data-pending-id="${escapeHtml(candidate.id)}">
      <div>
        <div class="row-title">${escapeHtml(candidate.content || candidate.id || 'Pending candidate')}</div>
        <div class="row-meta">
          ${escapeHtml(candidate.candidateKind || candidate.type || 'memory')}
          ${candidate.reviewHash ? ` · review ${escapeHtml(shortHash(candidate.reviewHash))}` : ''}
        </div>
      </div>
      ${statusChip(candidate.recommendation || 'review', candidate.risk || 'pending', candidate.risk === 'high' ? 'error' : 'warn')}
    </article>
  `
}
```

In `renderWorkspace()`, after dry-run binding:

```js
  workspace.querySelectorAll('[data-pending-id]').forEach((row) => {
    row.addEventListener('click', () => {
      state.selectedPendingId = row.dataset.pendingId || ''
      state.pendingAction = null
      state.receipt = null
      state.actionError = ''
      render()
    })
  })
```

- [ ] **Step 5: Render detail rail selected candidate and confirm forms**

Replace the start of `renderDetailRail()` with:

```js
function renderDetailRail() {
  const selected = selectedPending()
  if (state.activeTab === 'inbox' && selected) {
    detailRail.innerHTML = renderPendingDetail(selected)
    bindDetailRailActions(selected)
    return
  }
  ...
}
```

Add helpers:

```js
function selectedPending() {
  return listPending().find((candidate) => candidate.id === state.selectedPendingId)
}

function renderPendingDetail(candidate) {
  if (state.receipt) return renderReceipt(candidate)
  if (state.pendingAction) return renderConfirmForm(candidate, state.pendingAction)
  return `
    <div class="rail-stack">
      <div class="soft-panel">
        <h3>Pending detail</h3>
        <p>${escapeHtml(candidate.content)}</p>
        <div class="soft-inset rail-item"><strong>reviewHash</strong><span>${escapeHtml(shortHash(candidate.reviewHash || ''))}</span></div>
        ${renderEvidence(candidate)}
      </div>
      <div class="soft-panel">
        <h3>Actions</h3>
        <p>${escapeHtml(WRITE_ACTION_COPY)}</p>
        <div class="detail-actions">
          ${['approve', 'reject', 'defer', 'edit'].map((action) => `
            <button class="soft-button compact" type="button" data-action="${action}">${escapeHtml(actionLabel(action))}</button>
          `).join('')}
        </div>
        ${state.actionError ? `<p class="notice error">${escapeHtml(state.actionError)}</p>` : ''}
      </div>
    </div>
  `
}
```

Implement:

- `renderEvidence(candidate)` from `candidate.evidenceSummary`.
- `actionLabel(action)` mapping to `Approve` / `Reject` / `Defer` / `Edit`.
- `renderConfirmForm(candidate, action)` with:
  - hidden action context text containing `Confirm approve`, `Confirm reject`, `Confirm defer`, `Confirm edit`;
  - reason textarea for reject/defer;
  - number input `name="days"` default `7` for defer;
  - content textarea, candidateKind input, tags input, usefulness input, and changeNote textarea for edit;
  - `Confirm` and `Cancel` buttons.
- `renderReceipt()` with class `receipt-panel` and text `decision receipt`.

- [ ] **Step 6: Bind confirm/cancel and write requests**

Add:

```js
function bindDetailRailActions(candidate) {
  detailRail.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      state.pendingAction = button.dataset.action || null
      state.receipt = null
      state.actionError = ''
      render()
    })
  })
  const cancel = detailRail.querySelector('[data-cancel-action]')
  if (cancel) {
    cancel.addEventListener('click', () => {
      state.pendingAction = null
      state.actionError = ''
      render()
    })
  }
  const form = detailRail.querySelector('[data-confirm-form]')
  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      submitPendingAction(candidate, new FormData(form))
    })
  }
}
```

Add `submitPendingAction(candidate, formData)`:

```js
async function submitPendingAction(candidate, formData) {
  const action = state.pendingAction
  if (!action) return
  const body = actionBody(action, candidate, formData)
  try {
    const response = await apiFetch(`/api/memory/${encodeURIComponent(candidate.id)}/${action}`, {
      method: 'POST',
      body: JSON.stringify(body)
    })
    const payload = await response.json()
    if (!payload.ok) throw new Error(payload.error?.message || 'Write action failed.')
    state.receipt = payload.data?.receipt || { action, id: candidate.id, reviewHash: candidate.reviewHash, summary: 'Action completed.' }
    state.pendingAction = null
    state.actionError = ''
    await loadDashboard()
    if (action === 'edit' && payload.data?.candidate) {
      state.selectedPendingId = payload.data.candidate.id
    } else {
      state.selectedPendingId = ''
    }
  } catch (error) {
    state.actionError = errorMessage(error)
    render()
  }
}
```

`actionBody()` must include `reviewHash` for all actions, `reason` for reject/defer, and `changeNote + patch` for edit.

- [ ] **Step 7: Add CSS states**

In `src/ui/static/styles.css`, add:

```css
.selectable-row {
  cursor: pointer;
}

.selectable-row.selected {
  box-shadow: var(--shadow-pressed);
  border-color: color-mix(in srgb, var(--coral) 45%, transparent);
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.confirm-form {
  display: grid;
  gap: 10px;
}

.confirm-form label {
  display: grid;
  gap: 6px;
  color: var(--body);
  font-size: 0.86rem;
}

.confirm-form textarea,
.confirm-form input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface-inset);
  color: var(--ink);
  padding: 10px 12px;
  box-shadow: var(--shadow-pressed);
  font: inherit;
}

.receipt-panel {
  border-color: color-mix(in srgb, var(--teal) 42%, transparent);
}
```

Use existing tokens if actual variable names differ.

- [ ] **Step 8: Regenerate static assets and runtime**

Run:

```bash
node scripts/generate-ui-static.mjs
npm run build:plugin
```

- [ ] **Step 9: Run tests and commit**

Run:

```bash
npm test -- tests/codex-ui-assets.test.ts tests/codex-ui-static.test.ts tests/plugin-runtime.test.ts
npm run typecheck
git diff --check
```

Expected: all pass.

Commit:

```bash
git add src/ui/static/app.js src/ui/static/styles.css src/codex/codex-ui-static.generated.ts plugin/runtime/cyrene-continuity.mjs tests/codex-ui-assets.test.ts
git commit -m "feat: add codex ui pending write controls"
```

---

### Task 4: Documentation And End-To-End Verification

**Files:**
- Modify: `README.md`
- Modify: `plugin/skills/cyrene-continuity/SKILL.md`
- Generated: `plugin/runtime/cyrene-continuity.mjs` if skill changes require rebuild

- [ ] **Step 1: Update docs**

In `README.md`, update the `codex ui` section to state:

```txt
The local Web UI supports hash-checked single-candidate pending review actions: approve, reject, defer, and edit. Every write action requires the current review hash and an in-session UI token. Reject/defer require a reason; edit requires a change note. The UI does not batch approve, does not apply dream/profile changes, and does not require model API configuration for reviewing existing pending candidates.
```

In `plugin/skills/cyrene-continuity/SKILL.md`, update the Web UI guidance:

```txt
Use `cyrene-continuity codex ui` when the user wants local visual review of the memory pipeline or hash-checked single-candidate pending memory actions. The UI can approve/reject/defer/edit pending candidates, but it must not imply batch review, dream apply, profile apply, or active-memory edits.
```

- [ ] **Step 2: Rebuild plugin runtime after skill doc update**

Run:

```bash
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected: plugin validation passes.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm run typecheck
git diff --check
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected:

- all tests pass;
- typecheck exits 0;
- diff check exits 0;
- plugin validation passes.

- [ ] **Step 4: Browser QA**

Start the UI against a temp HOME/temp project with one seeded pending candidate. Use Browser to verify:

- `/api/session` loads and no console errors appear.
- Inbox row can be selected.
- Detail rail shows review hash and evidence.
- `Approve` enters confirm state and does not submit on first click.
- `Cancel` exits confirm state.
- `Reject` / `Defer` show required reason field.
- `Edit` shows content + change note fields.
- Mobile viewport has no body horizontal overflow.

Use a temp HOME/project so real memory is not mutated.

- [ ] **Step 5: Commit docs/final verification changes**

Commit:

```bash
git add README.md plugin/skills/cyrene-continuity/SKILL.md plugin/runtime/cyrene-continuity.mjs
git commit -m "docs: document codex ui write actions"
```

If no docs changed after rebuild, skip commit and report why.

---

## Self-Review

Spec coverage:

- Single-candidate `Approve` / `Reject` / `Defer` / `Edit`: Task 2 and Task 3.
- All actions require confirmation: Task 3.
- Reason/change note requirements: Task 2 and Task 3.
- CSRF + same-origin + reviewHash: Task 1 and Task 2.
- Pending-only edit: Task 2.
- Receipt and queue refresh: Task 3.
- No batch/dream/profile apply: Task 3 asset tests and Task 4 docs.

No intentional placeholders remain. Exact commands and file paths are included for each task.
