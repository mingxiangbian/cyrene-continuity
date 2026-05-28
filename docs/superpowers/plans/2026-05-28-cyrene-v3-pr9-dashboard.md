# Cyrene Continuity v3 PR9 Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `cyrene-continuity codex memory dashboard`，让用户用一条命令看到 memory pipeline 的可审查状态、待处理项和风险 warning。

**Architecture:** 新增只读 `src/codex/codex-memory-dashboard.ts`，复用 `readCodexMemoryStatus()`、`summarizePendingMemory()` 和 JSONL store readers。Dashboard 不做 repair、rebuild、approve、reject 或任何 mutation，只格式化 active/pending/tombstone/review/dream/index/config 状态。

**Tech Stack:** TypeScript、Node fs/promises、Vitest、现有 JSONL memory store、现有 Codex CLI routing。

---

## 文件结构

- Create: `src/codex/codex-memory-dashboard.ts`
  - 读取当前 project/global memory roots。
  - 汇总 active、pending、tombstones、review summaries、Dream state、warnings。
  - 输出稳定 text dashboard。
- Modify: `src/codex/codex-cli.ts`
  - 增加 `codex memory dashboard` route。
  - 更新 usage。
- Modify: `tests/codex-cli.test.ts`
  - CLI regression：dashboard 输出 core sections 和 warning。
- Modify after build: `plugin/runtime/cyrene-continuity.mjs`
  - `npm run build:plugin` 生成。

## Task 1: 写 dashboard CLI 失败测试

**Files:**

- Modify: `tests/codex-cli.test.ts`

- [ ] **Step 1: Add failing CLI test**

在 memory status / doctor 测试附近加入：

```ts
it('prints a memory dashboard with review, dream, top memory, and warnings', async () => {
  const home = await createTempDir('cyrene-codex-cli-dashboard-home-')
  process.env.HOME = home
  const repo = await createTempDir('cyrene-codex-cli-dashboard-repo-')
  const identity = await identifyCodexProject(repo)
  const memoryRoot = codexProjectMemoryRoot(identity.projectId)
  await mkdir(memoryRoot, { recursive: true })
  await mkdir(codexProjectMemoryRoot('legacy-project-id'), { recursive: true })
  await writeFile(join(home, '.codex', 'config.toml'), [
    '[mcp_servers."cyrene-continuity"]',
    ...currentRepoMcpConfigLines(),
    'enabled = true',
    '',
    '[mcp_servers.agentmemory]',
    'command = "npx"',
    'args = ["-y", "@agentmemory/mcp"]',
    'enabled = true'
  ].join('\n'))
  await writeFile(join(memoryRoot, 'index.jsonl'), `${JSON.stringify(createActive({
    id: 'dashboard-active-1',
    content: 'Dashboard should surface the strongest project memory.',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.99,
      safety: 0.95,
      sensitivity: 0.1
    }
  }))}\n`)
  await writeFile(join(memoryRoot, 'pending.jsonl'), `${JSON.stringify(createPending({
    id: 'dashboard-pending-1',
    content: 'Dashboard should show pending review.',
    lastSeenAt: '2026-05-28T00:00:00.000Z'
  }))}\n`)
  await writeFile(join(memoryRoot, 'tombstones.jsonl'), `${JSON.stringify({
    id: 'dashboard-tombstone-1',
    memoryId: 'dashboard-rejected-1',
    normalizedKey: 'dashboard-rejected',
    domain: 'procedural',
    type: 'procedural_rule',
    scope: 'project',
    reason: 'rejected',
    createdAt: '2026-05-28T00:00:00.000Z'
  })}\n`)
  await writeFile(join(memoryRoot, 'review-summaries.jsonl'), `${JSON.stringify({
    id: 'dashboard-summary-1',
    runId: 'session:turn',
    createdAt: '2000-01-01T00:00:00.000Z',
    status: 'ok',
    summary: 'Dashboard review summary.',
    redaction: { input: {}, output: {} },
    candidateIds: ['dashboard-pending-1']
  })}\n`)
  await writeFile(join(memoryRoot, 'dream-state.json'), `${JSON.stringify({
    dreamDue: true,
    lastDreamAt: '2026-05-27T00:00:00.000Z',
    nextDreamDueAt: '2026-05-28T00:00:00.000Z',
    lastDreamStatus: 'success'
  })}\n`)

  const result = await execFileAsync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'dashboard'],
    { env: cliEnv(home) }
  )

  expect(result.stderr).toBe('')
  expect(result.stdout).toContain('Cyrene Memory Dashboard')
  expect(result.stdout).toContain('active memories: 1')
  expect(result.stdout).toContain('pending memories: 1')
  expect(result.stdout).toContain('rejected/tombstoned: 1')
  expect(result.stdout).toContain('top active project memories:')
  expect(result.stdout).toContain('Dashboard should surface the strongest project memory.')
  expect(result.stdout).toContain('pending review:')
  expect(result.stdout).toContain('dashboard-pending-1')
  expect(result.stdout).toContain('review summaries:')
  expect(result.stdout).toContain('Dashboard review summary.')
  expect(result.stdout).toContain('last dream: 2026-05-27T00:00:00.000Z')
  expect(result.stdout).toContain('next dream due: 2026-05-28T00:00:00.000Z')
  expect(result.stdout).toContain('warnings:')
  expect(result.stdout).toContain('Stop Hook stale')
  expect(result.stdout).toContain('profile missing')
  expect(result.stdout).toContain('SQLite stale')
  expect(result.stdout).toContain('projectId split')
  expect(result.stdout).toContain('Codex memory enabled')
  expect(result.stdout).toContain('agentmemory enabled')
})
```

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/codex-cli.test.ts -t "memory dashboard"
```

Expected: FAIL because `codex memory dashboard` is not routed.

## Task 2: 实现只读 dashboard formatter

**Files:**

- Create: `src/codex/codex-memory-dashboard.ts`

- [ ] **Step 1: Add dashboard data readers**

实现并导出：

```ts
export async function formatCodexMemoryDashboard(input: { cwd: string; configPath?: string; now?: string }): Promise<string>
```

最小读取集合：

- `readCodexMemoryStatus({ cwd })`
- project root active memories：`readActiveMemoriesFromRoot(projectRoot)`
- project/global pending memories：`readPendingMemoriesFromRoot(root)` 后用 `summarizePendingMemory()`
- project tombstones：`readTombstonesFromRoot(projectRoot)`
- project `review-summaries.jsonl`
- project `dream-state.json`
- Codex config：默认 `~/.codex/config.toml`，支持测试传入 `configPath`

- [ ] **Step 2: Add warning rules**

Warnings 必须包含这些稳定 label：

```txt
Stop Hook stale
profile missing
SQLite stale
projectId split
Codex memory enabled
agentmemory enabled
```

触发规则：

- `Stop Hook stale`：没有 last stop hook run，或 last run 早于 `now - 24h`。
- `profile missing`：project `MODEL_PROFILE.md` 不存在。
- `SQLite stale`：`status.index.freshness === 'stale' || status.index.freshness === 'unavailable'`。
- `projectId split`：`status.project.idDiagnostic` 不是 `current project root only`，且 known project roots > 1。
- `Codex memory enabled`：Codex config 中存在 enabled `cyrene` 或 `cyrene-continuity` MCP。
- `agentmemory enabled`：Codex config 中存在 enabled `agentmemory` MCP。

- [ ] **Step 3: Format dashboard output**

Output shape:

```txt
Cyrene Memory Dashboard

project:
  projectId: <id>
  displayName: <name>

counts:
  active memories: <n>
  pending memories: <n>
  rejected/tombstoned: <n>
  profile candidates: <n>

top active project memories:
- <id> [<domain>/<type>] usefulness=<score> <content>

pending review:
- <id> recommendation=<recommendation> risk=<risk> reviewHash=<hash>
  <content>

review summaries:
- <createdAt> (<status>) candidates=<ids>
  <summary>

dream:
  last dream: <iso|never>
  next dream due: <iso|unknown>
  dream due: yes|no

warnings:
- <label>: <reason>
```

- [ ] **Step 4: Run GREEN**

```bash
npm test -- tests/codex-cli.test.ts -t "memory dashboard"
```

Expected: PASS.

## Task 3: Wire CLI route and usage

**Files:**

- Modify: `src/codex/codex-cli.ts`
- Test: `tests/codex-cli.test.ts`

- [ ] **Step 1: Import and route**

Add:

```ts
import { formatCodexMemoryDashboard } from './codex-memory-dashboard.js'
```

Route:

```ts
if (command === 'memory' && input.args[1] === 'dashboard') {
  process.stdout.write(await formatCodexMemoryDashboard({ cwd: input.cwd }))
  return
}
```

- [ ] **Step 2: Update usage**

Usage string must include:

```txt
memory dashboard
```

- [ ] **Step 3: Verify CLI test**

```bash
npm test -- tests/codex-cli.test.ts -t "memory dashboard"
```

Expected: PASS.

## Task 4: Full verification and commit

- [ ] **Step 1: Run full verification**

```bash
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
git diff --check
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-28-cyrene-v3-pr9-dashboard.md src/codex/codex-memory-dashboard.ts src/codex/codex-cli.ts tests/codex-cli.test.ts plugin/runtime/cyrene-continuity.mjs
git commit -m "feat: add codex memory dashboard"
```

## 自检

- PR9 scope 覆盖：`memory dashboard` command、counts、active/pending/tombstone、review summaries、last/next Dream、warnings。
- 不实现 dashboard UI，不改 approve/reject/rebuild 行为。
- Dashboard 只读，不调用 rebuild/sync/maintenance。
- Warning 文案使用稳定 label，方便测试和用户扫描。
