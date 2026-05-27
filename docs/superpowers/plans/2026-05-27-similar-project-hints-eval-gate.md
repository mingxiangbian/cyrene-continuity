# Similar-Project Hints With Minimal Eval Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `cyrene_continuity_get` 返回安全的 `similarProjectHints`，并用最小 deterministic `eval gate` 防止跨项目 `local_only` fact、personal/relationship/affective memory、路径或 secret-like 内容泄漏。

**Architecture:** 保持 JSONL 为 source of truth，SQLite `memory.db` 为 runtime retrieval index，Markdown 只做人类 review/debug/projection。新增 project fingerprint、project similarity scoring、similar memory query、eval gate；`continuity-context` 只编排这些模块并返回 diagnostics，不把 similar hints 混入 legacy `memory.items`。

**Tech Stack:** TypeScript, Node.js ESM, `node:sqlite`, SQLite FTS5, Vitest, MCP SDK, existing Codex memory JSONL store.

---

## File Structure

- Create: `src/codex/project-fingerprint.ts`
  - 读取当前 repo 的低敏 fingerprint：package manager、languages、frameworks、dependency names、domain tags、hashed git root/remote。
- Create: `tests/codex-project-fingerprint.test.ts`
  - 验证 fingerprint 可重复、能识别 TypeScript/MCP/plugin 项目、不会暴露绝对路径或 raw remote。
- Modify: `src/memory/memory-index.ts`
  - 扩展 adapter schema、project metadata、project similarity、similar active memory query。
- Modify: `tests/memory-index.test.ts`
  - 覆盖 project metadata/similarity persistence、similar query policy。
- Create: `src/memory/project-similarity.ts`
  - 纯函数计算 deterministic project similarity 和 reason。
- Create: `tests/project-similarity.test.ts`
  - 覆盖 framework/dependency/language/domain overlap scoring。
- Create: `src/eval/eval-runner.ts`
  - deterministic eval gate：`cross_project_leak_eval`、`similar_hint_boundary_eval`。
- Create: `tests/eval-runner.test.ts`
  - 覆盖 leak、domain、path、remote、secret-like 内容和通过路径。
- Modify: `src/codex/codex-memory-index.ts`
  - 发现所有 readable project memory roots；提供 all-project roots 给 rebuild。
- Modify: `src/codex/continuity-context.ts`
  - 编排 fingerprint、similarity、similar query、eval gate，填充 `similarProjectHints` 和 diagnostics。
- Modify: `tests/codex-continuity-context.test.ts`
  - 覆盖 eligible similar hint、`local_only` 不泄漏、eval gate fail 返回空 hints。
- Create: `src/codex/codex-eval.ts`
  - CLI 使用的最小 eval summary。
- Modify: `src/codex/codex-cli.ts`
  - 增加 `codex eval run --check similar-hints`。
- Modify: `tests/codex-cli.test.ts`
  - 覆盖 CLI eval command。
- Modify: `README.md`
  - 记录 similar hints、eval command、边界。
- Generated: `plugin/runtime/cyrene-continuity.mjs`
  - 通过 `npm run build:plugin` 更新 bundle。

---

### Task 1: Project Fingerprint

**Files:**
- Create: `src/codex/project-fingerprint.ts`
- Create: `tests/codex-project-fingerprint.test.ts`

- [ ] **Step 1: Write failing project fingerprint tests**

Create `tests/codex-project-fingerprint.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCodexProjectFingerprint } from '../src/codex/project-fingerprint.js'
import { identifyCodexProject } from '../src/codex/project-id.js'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('Codex project fingerprint', () => {
  it('extracts low-sensitivity project signals without raw paths or remotes', async () => {
    const repo = await createTempDir('cyrene-fingerprint-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    await execFileAsync('git', ['remote', 'add', 'origin', 'git@github.com:example/private-plugin.git'], { cwd: repo })
    await writeFile(join(repo, 'package.json'), JSON.stringify({
      dependencies: {
        '@modelcontextprotocol/sdk': '^1.0.0',
        vite: '^6.0.0'
      },
      devDependencies: {
        typescript: '^5.0.0',
        vitest: '^2.0.0'
      }
    }), 'utf8')
    await writeFile(join(repo, 'package-lock.json'), '{}\n', 'utf8')
    await writeFile(join(repo, 'tsconfig.json'), '{}\n', 'utf8')
    await mkdir(join(repo, 'plugin'), { recursive: true })
    await writeFile(join(repo, 'plugin', '.mcp.json'), '{}\n', 'utf8')

    const identity = await identifyCodexProject(repo)
    const fingerprint = await buildCodexProjectFingerprint({ cwd: repo, project: identity })

    expect(fingerprint.projectId).toBe(identity.projectId)
    expect(fingerprint.displayName).toBe(identity.displayName)
    expect(fingerprint.packageManager).toBe('npm')
    expect(fingerprint.languages).toEqual(expect.arrayContaining(['typescript']))
    expect(fingerprint.frameworks).toEqual(expect.arrayContaining(['mcp', 'vite', 'vitest']))
    expect(fingerprint.dependencyNames).toEqual(expect.arrayContaining(['@modelcontextprotocol/sdk', 'typescript']))
    expect(fingerprint.domainTags).toEqual(expect.arrayContaining(['codex-plugin', 'mcp', 'typescript']))
    expect(fingerprint.rootHash).toMatch(/^[a-f0-9]{16}$/)
    expect(fingerprint.remoteHash).toMatch(/^[a-f0-9]{16}$/)
    expect(JSON.stringify(fingerprint)).not.toContain(repo)
    expect(JSON.stringify(fingerprint)).not.toContain('git@github.com')
  })

  it('returns a stable minimal fingerprint when package files are absent', async () => {
    const repo = await createTempDir('cyrene-fingerprint-empty-')
    const identity = await identifyCodexProject(repo)

    const fingerprint = await buildCodexProjectFingerprint({ cwd: repo, project: identity })

    expect(fingerprint.projectId).toBe(identity.projectId)
    expect(fingerprint.packageManager).toBe('unknown')
    expect(fingerprint.languages).toEqual([])
    expect(fingerprint.frameworks).toEqual([])
    expect(fingerprint.dependencyNames).toEqual([])
    expect(fingerprint.domainTags).toEqual([])
    expect(fingerprint.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
```

- [ ] **Step 2: Run RED for project fingerprint tests**

Run:

```bash
npx vitest run tests/codex-project-fingerprint.test.ts
```

Expected: FAIL because `src/codex/project-fingerprint.ts` does not exist.

- [ ] **Step 3: Implement project fingerprint module**

Create `src/codex/project-fingerprint.ts`:

```ts
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { CodexProjectIdentity } from './project-id.js'

export interface ProjectFingerprint {
  projectId: string
  displayName: string
  rootHash?: string
  remoteHash?: string
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'
  languages: string[]
  frameworks: string[]
  dependencyNames: string[]
  domainTags: string[]
  updatedAt: string
}

export async function buildCodexProjectFingerprint(input: {
  cwd: string
  project: CodexProjectIdentity
}): Promise<ProjectFingerprint> {
  const packageJson = await readPackageJson(input.cwd)
  const dependencyNames = packageJson === undefined ? [] : Object.keys({
    ...readObject(packageJson.dependencies),
    ...readObject(packageJson.devDependencies)
  }).sort()
  const packageManager = await detectPackageManager(input.cwd)
  const rootEntries = await safeReaddir(input.cwd)
  const languages = detectLanguages(rootEntries, dependencyNames)
  const frameworks = detectFrameworks(rootEntries, dependencyNames)
  const domainTags = detectDomainTags(rootEntries, frameworks, dependencyNames, languages)

  return {
    projectId: input.project.projectId,
    displayName: input.project.displayName,
    rootHash: input.project.gitRoot === undefined ? undefined : hashShort(input.project.gitRoot),
    remoteHash: input.project.gitRemoteHash,
    packageManager,
    languages,
    frameworks,
    dependencyNames,
    domainTags,
    updatedAt: new Date().toISOString()
  }
}

async function readPackageJson(cwd: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function readObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function detectPackageManager(cwd: string): Promise<ProjectFingerprint['packageManager']> {
  if (await exists(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await exists(join(cwd, 'yarn.lock'))) return 'yarn'
  if (await exists(join(cwd, 'bun.lockb')) || await exists(join(cwd, 'bun.lock'))) return 'bun'
  if (await exists(join(cwd, 'package-lock.json'))) return 'npm'
  return 'unknown'
}

async function safeReaddir(cwd: string): Promise<string[]> {
  try {
    return (await readdir(cwd)).sort()
  } catch {
    return []
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function detectLanguages(entries: string[], dependencyNames: string[]): string[] {
  return sortedUnique([
    entries.some((entry) => entry.endsWith('.ts') || entry === 'tsconfig.json') || dependencyNames.includes('typescript') ? 'typescript' : undefined,
    entries.some((entry) => entry.endsWith('.js')) ? 'javascript' : undefined
  ])
}

function detectFrameworks(entries: string[], dependencyNames: string[]): string[] {
  return sortedUnique([
    dependencyNames.includes('@modelcontextprotocol/sdk') ? 'mcp' : undefined,
    dependencyNames.includes('vite') || entries.includes('vite.config.ts') || entries.includes('vite.config.js') ? 'vite' : undefined,
    dependencyNames.includes('vitest') || entries.includes('vitest.config.ts') ? 'vitest' : undefined,
    dependencyNames.includes('tsx') ? 'tsx' : undefined
  ])
}

function detectDomainTags(
  entries: string[],
  frameworks: string[],
  dependencyNames: string[],
  languages: string[]
): string[] {
  return sortedUnique([
    entries.includes('plugin') || dependencyNames.includes('@modelcontextprotocol/sdk') ? 'codex-plugin' : undefined,
    frameworks.includes('mcp') ? 'mcp' : undefined,
    languages.includes('typescript') ? 'typescript' : undefined
  ])
}

function sortedUnique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => value !== undefined))).sort()
}

function hashShort(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
```

- [ ] **Step 4: Run GREEN for project fingerprint tests**

Run:

```bash
npx vitest run tests/codex-project-fingerprint.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/codex/project-fingerprint.ts tests/codex-project-fingerprint.test.ts
git commit -m "feat: add codex project fingerprint"
```

---

### Task 2: Memory Index Project Similarity Primitives

**Files:**
- Modify: `src/memory/memory-index.ts`
- Modify: `tests/memory-index.test.ts`

- [ ] **Step 1: Write failing memory index tests**

Append tests to `tests/memory-index.test.ts`:

```ts
  it('stores project metadata and project similarity rows across rebuilds', async () => {
    const root = await createTempDir('cyrene-memory-index-projects-')
    const projectRoot = join(root, 'projects', 'project-a', 'memory')
    await mkdir(projectRoot, { recursive: true })
    await writeJsonLines(join(projectRoot, 'index.jsonl'), [activeMemory({ id: 'project-a-memory' })])
    const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })

    await adapter.initialize()
    await adapter.upsertProjectMetadata({
      projectId: 'project-a',
      displayName: 'project-a',
      packageManager: 'npm',
      languages: ['typescript'],
      frameworks: ['mcp'],
      dependencyNames: ['@modelcontextprotocol/sdk'],
      domainTags: ['mcp'],
      updatedAt: '2026-05-27T00:00:00.000Z'
    })
    await adapter.upsertProjectMetadata({
      projectId: 'project-b',
      displayName: 'project-b',
      packageManager: 'npm',
      languages: ['typescript'],
      frameworks: ['mcp', 'vitest'],
      dependencyNames: ['@modelcontextprotocol/sdk', 'vitest'],
      domainTags: ['mcp'],
      updatedAt: '2026-05-27T00:00:00.000Z'
    })
    await adapter.upsertProjectSimilarity({
      sourceProjectId: 'project-a',
      targetProjectId: 'project-b',
      score: 0.83,
      reason: ['framework:mcp'],
      updatedAt: '2026-05-27T00:00:00.000Z'
    })
    await adapter.rebuildFromRoots({
      roots: [{ memoryRoot: projectRoot, projectId: 'project-a', scope: 'project' }]
    })

    await expect(adapter.listProjectMetadata()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ projectId: 'project-a', frameworks: ['mcp'] }),
      expect.objectContaining({ projectId: 'project-b', frameworks: ['mcp', 'vitest'] })
    ]))
    await expect(adapter.listProjectSimilarities('project-a')).resolves.toEqual([
      expect.objectContaining({
        sourceProjectId: 'project-a',
        targetProjectId: 'project-b',
        score: 0.83,
        reason: ['framework:mcp']
      })
    ])
  })

  it('queries only eligible similar-project active memories', async () => {
    const root = await createTempDir('cyrene-memory-index-similar-')
    const currentRoot = join(root, 'projects', 'project-a', 'memory')
    const similarRoot = join(root, 'projects', 'project-b', 'memory')
    await mkdir(currentRoot, { recursive: true })
    await mkdir(similarRoot, { recursive: true })
    await writeJsonLines(join(currentRoot, 'index.jsonl'), [
      activeMemory({
        id: 'current-similar',
        portability: 'similar_project',
        content: 'Current project similar-portable memory is not a similar hint.',
        normalizedKey: 'current-similar-memory'
      })
    ])
    await writeJsonLines(join(similarRoot, 'index.jsonl'), [
      activeMemory({
        id: 'similar-procedural',
        domain: 'procedural',
        type: 'procedural_rule',
        portability: 'similar_project',
        content: 'MCP plugin projects should keep generated runtime rebuilds explicit.',
        normalizedKey: 'mcp-plugin-runtime-rebuild',
        tags: ['mcp', 'plugin']
      }),
      activeMemory({
        id: 'similar-local',
        domain: 'procedural',
        type: 'procedural_rule',
        portability: 'local_only',
        content: 'Other project local-only detail must not appear.',
        normalizedKey: 'other-local-only'
      }),
      activeMemory({
        id: 'similar-personal',
        domain: 'personal',
        type: 'user_preference',
        portability: 'similar_project',
        content: 'Personal preference must not appear as a similar hint.',
        normalizedKey: 'personal-similar'
      })
    ])
    const adapter = await openMemoryIndexAdapter({ dbPath: join(root, 'memory.db') })
    await adapter.rebuildFromRoots({
      roots: [
        { memoryRoot: currentRoot, projectId: 'project-a', scope: 'project' },
        { memoryRoot: similarRoot, projectId: 'project-b', scope: 'project' }
      ]
    })

    const hints = await adapter.querySimilarActive({
      currentProjectId: 'project-a',
      query: 'mcp plugin runtime',
      targetProjects: [{ projectId: 'project-b', similarityScore: 0.75, displayName: 'project-b' }],
      maxItems: 10,
      maxTokens: 2_000
    })

    expect(hints.map((item) => item.memory.id)).toEqual(['similar-procedural'])
    expect(hints[0]).toMatchObject({
      portability: 'similar_project',
      homeProjectId: 'project-b',
      similarityScore: 0.75,
      sourceProjectName: 'project-b'
    })
  })
```

- [ ] **Step 2: Run RED for memory index tests**

Run:

```bash
npx vitest run tests/memory-index.test.ts
```

Expected: FAIL because `upsertProjectMetadata`, `upsertProjectSimilarity`, `listProjectMetadata`, `listProjectSimilarities`, and `querySimilarActive` are not implemented.

- [ ] **Step 3: Extend memory index types and adapter interface**

Modify `src/memory/memory-index.ts` near existing interfaces:

```ts
export interface ProjectMetadata {
  projectId: string
  displayName: string
  rootHash?: string
  remoteHash?: string
  packageManager: string
  languages: string[]
  frameworks: string[]
  dependencyNames: string[]
  domainTags: string[]
  updatedAt: string
}

export interface ProjectSimilarity {
  sourceProjectId: string
  targetProjectId: string
  score: number
  reason: string[]
  updatedAt: string
}

export interface MemoryIndexSimilarTargetProject {
  projectId: string
  similarityScore: number
  displayName?: string
}

export interface MemoryIndexSimilarQuery {
  currentProjectId: string
  query: string
  targetProjects: MemoryIndexSimilarTargetProject[]
  task?: NonNullable<RetrieveMemoriesInput['task']>
  maxItems: number
  maxTokens: number
}

export interface IndexedSimilarMemory extends IndexedActiveMemory {
  homeProjectId: string
  similarityScore: number
  sourceProjectName?: string
}
```

Add these methods to `MemoryIndexAdapter`:

```ts
  upsertProjectMetadata(metadata: ProjectMetadata): Promise<MemoryIndexDiagnostics>
  listProjectMetadata(): Promise<ProjectMetadata[]>
  upsertProjectSimilarity(similarity: ProjectSimilarity): Promise<MemoryIndexDiagnostics>
  listProjectSimilarities(sourceProjectId: string): Promise<ProjectSimilarity[]>
  querySimilarActive(input: MemoryIndexSimilarQuery): Promise<IndexedSimilarMemory[]>
```

- [ ] **Step 4: Implement schema migration and unavailable adapter no-ops**

In `SqliteMemoryIndexAdapter.initialize()`, add compatible columns and table creation after the existing `projects` table:

```ts
      create table if not exists project_similarity (
        source_project_id text not null,
        target_project_id text not null,
        score real not null,
        reason_json text not null,
        updated_at text not null,
        primary key (source_project_id, target_project_id)
      );
```

Then run column migrations with a helper:

```ts
    this.ensureProjectColumns(db)
```

Add helper:

```ts
  private ensureProjectColumns(db: DatabaseLike): void {
    for (const [name, sql] of [
      ['display_name', 'alter table projects add column display_name text'],
      ['package_manager', 'alter table projects add column package_manager text'],
      ['languages_json', 'alter table projects add column languages_json text'],
      ['frameworks_json', 'alter table projects add column frameworks_json text'],
      ['dependency_names_json', 'alter table projects add column dependency_names_json text'],
      ['dependency_fingerprint', 'alter table projects add column dependency_fingerprint text'],
      ['domain_tags_json', 'alter table projects add column domain_tags_json text']
    ] as const) {
      try {
        db.exec(sql)
      } catch (error) {
        if (!String(error).includes('duplicate column name')) {
          throw error
        }
      }
    }
  }
```

Implement unavailable adapter methods as safe no-ops returning `[]` or diagnostics.

- [ ] **Step 5: Implement project metadata and similarity methods**

Add to `SqliteMemoryIndexAdapter`:

```ts
  async upsertProjectMetadata(metadata: ProjectMetadata): Promise<MemoryIndexDiagnostics> {
    const diagnostics = await this.initialize()
    const db = this.requireDatabase()
    const now = new Date().toISOString()
    db.prepare(`
      insert into projects (
        project_id,
        root_hash,
        remote_hash,
        name,
        display_name,
        package_manager,
        languages_json,
        frameworks_json,
        dependency_names_json,
        dependency_fingerprint,
        domain_tags_json,
        created_at,
        updated_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(project_id) do update set
        root_hash = excluded.root_hash,
        remote_hash = excluded.remote_hash,
        name = excluded.name,
        display_name = excluded.display_name,
        package_manager = excluded.package_manager,
        languages_json = excluded.languages_json,
        frameworks_json = excluded.frameworks_json,
        dependency_names_json = excluded.dependency_names_json,
        dependency_fingerprint = excluded.dependency_fingerprint,
        domain_tags_json = excluded.domain_tags_json,
        updated_at = excluded.updated_at
    `).run(
      metadata.projectId,
      metadata.rootHash ?? null,
      metadata.remoteHash ?? null,
      metadata.displayName,
      metadata.displayName,
      metadata.packageManager,
      JSON.stringify(metadata.languages),
      JSON.stringify(metadata.frameworks),
      JSON.stringify(metadata.dependencyNames),
      dependencyFingerprint(metadata.dependencyNames),
      JSON.stringify(metadata.domainTags),
      metadata.updatedAt || now,
      metadata.updatedAt || now
    )
    return diagnostics
  }

  async listProjectMetadata(): Promise<ProjectMetadata[]> {
    await this.initialize()
    return this.requireDatabase().prepare(`
      select project_id, root_hash, remote_hash, name, display_name, package_manager,
        languages_json, frameworks_json, dependency_names_json, domain_tags_json, updated_at
      from projects
    `).all().map(projectMetadataFromRecord)
  }

  async upsertProjectSimilarity(similarity: ProjectSimilarity): Promise<MemoryIndexDiagnostics> {
    const diagnostics = await this.initialize()
    this.requireDatabase().prepare(`
      insert into project_similarity (source_project_id, target_project_id, score, reason_json, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(source_project_id, target_project_id) do update set
        score = excluded.score,
        reason_json = excluded.reason_json,
        updated_at = excluded.updated_at
    `).run(
      similarity.sourceProjectId,
      similarity.targetProjectId,
      similarity.score,
      JSON.stringify(similarity.reason),
      similarity.updatedAt
    )
    return diagnostics
  }

  async listProjectSimilarities(sourceProjectId: string): Promise<ProjectSimilarity[]> {
    await this.initialize()
    return this.requireDatabase().prepare(`
      select source_project_id, target_project_id, score, reason_json, updated_at
      from project_similarity
      where source_project_id = ?
      order by score desc, target_project_id asc
    `).all(sourceProjectId).map(projectSimilarityFromRecord)
  }
```

Add helpers outside the class:

```ts
function dependencyFingerprint(dependencyNames: string[]): string {
  return dependencyNames.slice().sort().join('\n')
}

function projectMetadataFromRecord(row: Record<string, unknown>): ProjectMetadata {
  return {
    projectId: readString(row.project_id, 'project_id'),
    displayName: typeof row.display_name === 'string'
      ? row.display_name
      : typeof row.name === 'string'
        ? row.name
        : readString(row.project_id, 'project_id'),
    rootHash: typeof row.root_hash === 'string' ? row.root_hash : undefined,
    remoteHash: typeof row.remote_hash === 'string' ? row.remote_hash : undefined,
    packageManager: typeof row.package_manager === 'string' ? row.package_manager : 'unknown',
    languages: parseStringArray(row.languages_json),
    frameworks: parseStringArray(row.frameworks_json),
    dependencyNames: parseStringArray(row.dependency_names_json),
    domainTags: parseStringArray(row.domain_tags_json),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date(0).toISOString()
  }
}

function projectSimilarityFromRecord(row: Record<string, unknown>): ProjectSimilarity {
  return {
    sourceProjectId: readString(row.source_project_id, 'source_project_id'),
    targetProjectId: readString(row.target_project_id, 'target_project_id'),
    score: Number(row.score),
    reason: parseStringArray(row.reason_json),
    updatedAt: readString(row.updated_at, 'updated_at')
  }
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string' || value === '') return []
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}
```

- [ ] **Step 6: Implement similar active query**

Add `querySimilarActive()` to `SqliteMemoryIndexAdapter`:

```ts
  async querySimilarActive(input: MemoryIndexSimilarQuery): Promise<IndexedSimilarMemory[]> {
    await this.initialize()
    if (input.targetProjects.length === 0) return []
    const targetById = new Map(input.targetProjects.map((project) => [project.projectId, project]))
    const structuredRows = this.querySimilarStructuredRows({
      currentProjectId: input.currentProjectId,
      targetProjectIds: Array.from(targetById.keys())
    })
    const ftsMatches = this.queryFtsIds(input.query, 'active')
    const task = input.task
    const eligibleRows = task === undefined
      ? structuredRows
      : structuredRows.filter((row) => isMemoryEligibleForRetrieval(
        row.payload as CyreneMemory,
        {
          cwd: '',
          userCyreneDir: '',
          query: input.query,
          task,
          maxItems: input.maxItems,
          maxTokens: input.maxTokens
        },
        task
      ))
    return selectWithinBudget(
      eligibleRows
        .map((row) => {
          const target = targetById.get(row.homeProjectId ?? '')
          return target === undefined ? undefined : {
            memory: row.payload as CyreneMemory,
            score: scoreRow(row, input.query, ftsMatches) + target.similarityScore * 0.2,
            portability: row.portability,
            homeProjectId: target.projectId,
            similarityScore: target.similarityScore,
            sourceProjectName: target.displayName
          }
        })
        .filter((item): item is IndexedSimilarMemory => item !== undefined)
        .filter((item) => input.query.trim() === '' || item.score > 0)
        .sort(compareIndexedItems),
      input.maxItems,
      input.maxTokens
    )
  }
```

Add private helper:

```ts
  private querySimilarStructuredRows(input: {
    currentProjectId: string
    targetProjectIds: string[]
  }): MemoryIndexRow[] {
    if (input.targetProjectIds.length === 0) return []
    const placeholders = input.targetProjectIds.map(() => '?').join(', ')
    const rows = this.requireDatabase().prepare(`
      select
        id, status, scope, domain, type, strength, home_project_id, portability,
        content, normalized_key, tags_json, scores_json, payload_json
      from memories
      where status = 'active'
        and home_project_id is not null
        and home_project_id != ?
        and home_project_id in (${placeholders})
        and portability in ('similar_project', 'project_family')
        and domain in ('project', 'procedural', 'system')
    `).all(input.currentProjectId, ...input.targetProjectIds)
    return rows.map(rowFromRecord)
  }
```

- [ ] **Step 7: Preserve project metadata during rebuild**

Modify `rebuildFromRoots()` so it does not delete `projects` or `project_similarity`:

```ts
    db.exec('delete from memory_evidence; delete from memories;')
```

Keep the existing per-root project upsert in `syncRoot()`, but make it not overwrite richer metadata:

```ts
      db.prepare(`
        insert into projects (project_id, name, display_name, created_at, updated_at)
        values (?, ?, ?, ?, ?)
        on conflict(project_id) do update set updated_at = excluded.updated_at
      `).run(root.projectId, root.projectId, root.projectId, now, now)
```

- [ ] **Step 8: Run GREEN for memory index tests**

Run:

```bash
npx vitest run tests/memory-index.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add src/memory/memory-index.ts tests/memory-index.test.ts
git commit -m "feat: add project similarity memory index primitives"
```

---

### Task 3: Project Similarity Scoring

**Files:**
- Create: `src/memory/project-similarity.ts`
- Create: `tests/project-similarity.test.ts`

- [ ] **Step 1: Write failing similarity scoring tests**

Create `tests/project-similarity.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { scoreProjectSimilarity, selectSimilarProjects } from '../src/memory/project-similarity.js'
import type { ProjectMetadata } from '../src/memory/memory-index.js'

function project(overrides: Partial<ProjectMetadata>): ProjectMetadata {
  return {
    projectId: 'project-a',
    displayName: 'project-a',
    packageManager: 'npm',
    languages: ['typescript'],
    frameworks: ['mcp', 'vitest'],
    dependencyNames: ['@modelcontextprotocol/sdk', 'typescript', 'vitest'],
    domainTags: ['mcp', 'codex-plugin'],
    updatedAt: '2026-05-27T00:00:00.000Z',
    ...overrides
  }
}

describe('project similarity scoring', () => {
  it('scores deterministic overlap and reports reasons', () => {
    const result = scoreProjectSimilarity(
      project({ projectId: 'source' }),
      project({
        projectId: 'target',
        frameworks: ['mcp'],
        dependencyNames: ['@modelcontextprotocol/sdk', 'zod'],
        domainTags: ['mcp']
      })
    )

    expect(result.targetProjectId).toBe('target')
    expect(result.score).toBeGreaterThan(0.4)
    expect(result.reason).toEqual(expect.arrayContaining([
      'package_manager:npm',
      'framework:mcp',
      'language:typescript',
      'domain:mcp'
    ]))
  })

  it('selects non-current projects above threshold by score', () => {
    const source = project({ projectId: 'source' })
    const selected = selectSimilarProjects({
      source,
      candidates: [
        project({ projectId: 'source' }),
        project({ projectId: 'close', frameworks: ['mcp'], dependencyNames: ['@modelcontextprotocol/sdk'], domainTags: ['mcp'] }),
        project({ projectId: 'far', packageManager: 'pnpm', languages: ['python'], frameworks: [], dependencyNames: [], domainTags: [] })
      ],
      minScore: 0.2,
      maxProjects: 3,
      now: '2026-05-27T00:00:00.000Z'
    })

    expect(selected.map((item) => item.targetProjectId)).toEqual(['close'])
    expect(selected[0]?.sourceProjectId).toBe('source')
  })
})
```

- [ ] **Step 2: Run RED for similarity scoring tests**

Run:

```bash
npx vitest run tests/project-similarity.test.ts
```

Expected: FAIL because `src/memory/project-similarity.ts` does not exist.

- [ ] **Step 3: Implement scoring module**

Create `src/memory/project-similarity.ts`:

```ts
import type { ProjectMetadata, ProjectSimilarity } from './memory-index.js'

export interface ProjectSimilarityScore extends ProjectSimilarity {}

export function scoreProjectSimilarity(source: ProjectMetadata, target: ProjectMetadata): ProjectSimilarityScore {
  const reason: string[] = []
  let score = 0

  if (source.packageManager !== 'unknown' && source.packageManager === target.packageManager) {
    score += 0.12
    reason.push(`package_manager:${source.packageManager}`)
  }
  score += overlapScore('language', source.languages, target.languages, 0.18, reason)
  score += overlapScore('framework', source.frameworks, target.frameworks, 0.28, reason)
  score += overlapScore('dependency', source.dependencyNames, target.dependencyNames, 0.26, reason)
  score += overlapScore('domain', source.domainTags, target.domainTags, 0.16, reason)

  return {
    sourceProjectId: source.projectId,
    targetProjectId: target.projectId,
    score: Math.min(1, Number(score.toFixed(4))),
    reason,
    updatedAt: new Date().toISOString()
  }
}

export function selectSimilarProjects(input: {
  source: ProjectMetadata
  candidates: ProjectMetadata[]
  minScore: number
  maxProjects: number
  now: string
}): ProjectSimilarityScore[] {
  return input.candidates
    .filter((candidate) => candidate.projectId !== input.source.projectId)
    .map((candidate) => ({
      ...scoreProjectSimilarity(input.source, candidate),
      updatedAt: input.now
    }))
    .filter((score) => score.score >= input.minScore)
    .sort((left, right) => {
      const scoreDiff = right.score - left.score
      if (scoreDiff !== 0) return scoreDiff
      return left.targetProjectId.localeCompare(right.targetProjectId)
    })
    .slice(0, input.maxProjects)
}

function overlapScore(
  label: string,
  sourceValues: string[],
  targetValues: string[],
  weight: number,
  reason: string[]
): number {
  const sourceSet = new Set(sourceValues)
  const targetSet = new Set(targetValues)
  const matches = Array.from(sourceSet).filter((value) => targetSet.has(value)).sort()
  for (const value of matches.slice(0, 5)) {
    reason.push(`${label}:${value}`)
  }
  const denominator = Math.max(sourceSet.size, targetSet.size, 1)
  return (matches.length / denominator) * weight
}
```

- [ ] **Step 4: Run GREEN for similarity scoring tests**

Run:

```bash
npx vitest run tests/project-similarity.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/memory/project-similarity.ts tests/project-similarity.test.ts
git commit -m "feat: score codex project similarity"
```

---

### Task 4: Minimal Eval Gate

**Files:**
- Create: `src/eval/eval-runner.ts`
- Create: `tests/eval-runner.test.ts`

- [ ] **Step 1: Write failing eval gate tests**

Create `tests/eval-runner.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { runSimilarHintsEvalGate, type SimilarHintEvalCandidate } from '../src/eval/eval-runner.js'

function candidate(overrides: Partial<SimilarHintEvalCandidate> = {}): SimilarHintEvalCandidate {
  return {
    id: 'hint-1',
    currentProjectId: 'current',
    homeProjectId: 'other',
    domain: 'procedural',
    portability: 'similar_project',
    scope: 'project',
    content: 'MCP plugin projects should rebuild generated runtime explicitly.',
    transferable: true,
    notCurrentProjectFact: true,
    ...overrides
  }
}

describe('similar hints eval gate', () => {
  it('passes safe transferable procedural hints', () => {
    const result = runSimilarHintsEvalGate([candidate()])

    expect(result.passed).toBe(true)
    expect(result.failedChecks).toEqual([])
    expect(result.results.every((check) => check.passed)).toBe(true)
  })

  it('fails cross-project leak candidates', () => {
    const result = runSimilarHintsEvalGate([
      candidate({ id: 'same-project', homeProjectId: 'current' }),
      candidate({ id: 'local-only', portability: 'local_only' }),
      candidate({ id: 'global', scope: 'global', homeProjectId: null })
    ])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('cross_project_leak_eval')
    expect(JSON.stringify(result.results)).toContain('same-project')
    expect(JSON.stringify(result.results)).toContain('local-only')
    expect(JSON.stringify(result.results)).toContain('global')
  })

  it('fails boundary violations in domain and content', () => {
    const result = runSimilarHintsEvalGate([
      candidate({ id: 'personal', domain: 'personal' }),
      candidate({ id: 'path', content: 'Use /Users/phoenix/private/project/config.json.' }),
      candidate({ id: 'remote', content: 'Clone git@github.com:secret/private.git.' }),
      candidate({ id: 'secret', content: 'Token sk-123456789012345678901234567890123456789012345678.' }),
      candidate({ id: 'flags', transferable: false, notCurrentProjectFact: false })
    ])

    expect(result.passed).toBe(false)
    expect(result.failedChecks).toContain('similar_hint_boundary_eval')
    expect(JSON.stringify(result.results)).toContain('personal')
    expect(JSON.stringify(result.results)).toContain('absolute path')
    expect(JSON.stringify(result.results)).toContain('raw remote')
    expect(JSON.stringify(result.results)).toContain('secret-like')
    expect(JSON.stringify(result.results)).toContain('missing similar hint flags')
  })
})
```

- [ ] **Step 2: Run RED for eval gate tests**

Run:

```bash
npx vitest run tests/eval-runner.test.ts
```

Expected: FAIL because `src/eval/eval-runner.ts` does not exist.

- [ ] **Step 3: Implement deterministic eval runner**

Create `src/eval/eval-runner.ts`:

```ts
import type { MemoryDomain, MemoryPortability, MemoryScope } from '../memory/types.js'

export type EvalCheckName =
  | 'cross_project_leak_eval'
  | 'similar_hint_boundary_eval'

export interface EvalFinding {
  memoryId?: string
  reason: string
}

export interface EvalResult {
  name: EvalCheckName
  passed: boolean
  severity: 'info' | 'warning' | 'error'
  findings: EvalFinding[]
}

export interface SimilarHintEvalCandidate {
  id: string
  currentProjectId: string
  homeProjectId: string | null
  domain: MemoryDomain
  portability: MemoryPortability
  scope: MemoryScope
  content: string
  transferable: boolean
  notCurrentProjectFact: boolean
}

export interface EvalGateResult {
  passed: boolean
  failedChecks: EvalCheckName[]
  results: EvalResult[]
}

export function runSimilarHintsEvalGate(candidates: SimilarHintEvalCandidate[]): EvalGateResult {
  const results = [
    runCrossProjectLeakEval(candidates),
    runSimilarHintBoundaryEval(candidates)
  ]
  const failedChecks = results
    .filter((result) => !result.passed && result.severity === 'error')
    .map((result) => result.name)
  return {
    passed: failedChecks.length === 0,
    failedChecks,
    results
  }
}

function runCrossProjectLeakEval(candidates: SimilarHintEvalCandidate[]): EvalResult {
  const findings: EvalFinding[] = []
  for (const candidate of candidates) {
    if (candidate.homeProjectId === null) {
      findings.push({ memoryId: candidate.id, reason: 'candidate missing homeProjectId' })
    } else if (candidate.homeProjectId === candidate.currentProjectId) {
      findings.push({ memoryId: candidate.id, reason: 'candidate comes from current project' })
    }
    if (candidate.portability === 'local_only') {
      findings.push({ memoryId: candidate.id, reason: 'local_only memory cannot become a similar hint' })
    }
    if (candidate.scope === 'global') {
      findings.push({ memoryId: candidate.id, reason: 'global memory belongs in globalMemory, not similarProjectHints' })
    }
  }
  return {
    name: 'cross_project_leak_eval',
    passed: findings.length === 0,
    severity: findings.length === 0 ? 'info' : 'error',
    findings
  }
}

function runSimilarHintBoundaryEval(candidates: SimilarHintEvalCandidate[]): EvalResult {
  const findings: EvalFinding[] = []
  for (const candidate of candidates) {
    if (candidate.domain === 'personal' || candidate.domain === 'relationship' || candidate.domain === 'affective') {
      findings.push({ memoryId: candidate.id, reason: `domain not allowed for similar hint: ${candidate.domain}` })
    }
    if (containsAbsolutePath(candidate.content)) {
      findings.push({ memoryId: candidate.id, reason: 'content contains absolute path' })
    }
    if (containsRawRemote(candidate.content)) {
      findings.push({ memoryId: candidate.id, reason: 'content contains raw remote' })
    }
    if (containsSecretLikeValue(candidate.content)) {
      findings.push({ memoryId: candidate.id, reason: 'content contains secret-like value' })
    }
    if (!candidate.transferable || !candidate.notCurrentProjectFact) {
      findings.push({ memoryId: candidate.id, reason: 'missing similar hint flags' })
    }
  }
  return {
    name: 'similar_hint_boundary_eval',
    passed: findings.length === 0,
    severity: findings.length === 0 ? 'info' : 'error',
    findings
  }
}

function containsAbsolutePath(content: string): boolean {
  return /(^|\s)\/(?:Users|home|var|etc|tmp)\/[^\s]+/.test(content)
}

function containsRawRemote(content: string): boolean {
  return /(git@github\.com:[^\s]+|https:\/\/github\.com\/[^\s]+)/.test(content)
}

function containsSecretLikeValue(content: string): boolean {
  return /\b(?:sk|ghp|github_pat|xoxb)-[A-Za-z0-9_\-]{24,}\b/.test(content)
}
```

- [ ] **Step 4: Run GREEN for eval gate tests**

Run:

```bash
npx vitest run tests/eval-runner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/eval/eval-runner.ts tests/eval-runner.test.ts
git commit -m "feat: add similar hints eval gate"
```

---

### Task 5: Continuity Context Integration

**Files:**
- Modify: `src/codex/codex-memory-index.ts`
- Modify: `src/codex/continuity-context.ts`
- Modify: `tests/codex-continuity-context.test.ts`

- [ ] **Step 1: Write failing continuity integration tests**

Append tests to `tests/codex-continuity-context.test.ts`:

```ts
  it('returns eligible similar-project hints without mixing them into active memory', async () => {
    const home = await createTempDir('cyrene-codex-continuity-similar-home-')
    process.env.HOME = home
    const currentRepo = await createTempDir('cyrene-codex-current-similar-repo-')
    const otherRepo = await createTempDir('cyrene-codex-other-similar-repo-')
    await writeFile(join(currentRepo, 'package.json'), JSON.stringify({
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      devDependencies: { typescript: '^5.0.0', vitest: '^2.0.0' }
    }), 'utf8')
    await writeFile(join(currentRepo, 'package-lock.json'), '{}\n', 'utf8')
    await writeFile(join(otherRepo, 'package.json'), JSON.stringify({
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      devDependencies: { typescript: '^5.0.0', vitest: '^2.0.0' }
    }), 'utf8')
    await writeFile(join(otherRepo, 'package-lock.json'), '{}\n', 'utf8')
    const current = await identifyCodexProject(currentRepo)
    const other = await identifyCodexProject(otherRepo)
    const currentRoot = codexProjectMemoryRoot(current.projectId)
    const otherRoot = codexProjectMemoryRoot(other.projectId)
    await mkdir(currentRoot, { recursive: true })
    await mkdir(otherRoot, { recursive: true })
    await writeFile(join(currentRoot, 'index.jsonl'), JSON.stringify(createMemory({
      id: 'current-project-fact',
      content: 'Current project exact fact stays in project memory.',
      normalizedKey: 'current-project-fact'
    })) + '\n')
    await writeFile(join(otherRoot, 'index.jsonl'), [
      JSON.stringify(createMemory({
        id: 'portable-similar-hint',
        domain: 'procedural',
        type: 'procedural_rule',
        portability: 'similar_project',
        content: 'MCP plugin projects should keep generated runtime rebuilds explicit.',
        normalizedKey: 'mcp-plugin-runtime-rebuild',
        tags: ['mcp', 'plugin']
      })),
      JSON.stringify(createMemory({
        id: 'other-local-only',
        domain: 'procedural',
        type: 'procedural_rule',
        portability: 'local_only',
        content: 'Other project local-only detail must not appear.',
        normalizedKey: 'other-local-only'
      }))
    ].join('\n') + '\n')

    await getCodexContinuityContext({
      cwd: otherRepo,
      userMessage: 'Index this MCP plugin project.',
      task: 'planning'
    })
    const context = await getCodexContinuityContext({
      cwd: currentRepo,
      userMessage: 'For this MCP plugin runtime rebuild, what transferable guidance applies?',
      task: 'planning'
    })

    expect(context.similarProjectHints).toEqual([
      expect.objectContaining({
        id: 'portable-similar-hint',
        sourceProjectId: other.projectId,
        sourceProjectName: other.displayName,
        portability: 'similar_project',
        transferable: true,
        notCurrentProjectFact: true
      })
    ])
    expect(context.memory.items.map((item) => item.id)).toContain('current-project-fact')
    expect(context.memory.items.map((item) => item.id)).not.toContain('portable-similar-hint')
    expect(JSON.stringify(context)).not.toContain('other-local-only')
    expect(context.diagnostics?.projectSimilarity?.selectedProjects).toBeGreaterThanOrEqual(1)
    expect(context.diagnostics?.evalGate?.passed).toBe(true)
  })

  it('returns empty similar-project hints when eval gate detects unsafe content', async () => {
    const home = await createTempDir('cyrene-codex-continuity-similar-unsafe-home-')
    process.env.HOME = home
    const currentRepo = await createTempDir('cyrene-codex-current-unsafe-repo-')
    const otherRepo = await createTempDir('cyrene-codex-other-unsafe-repo-')
    await writeFile(join(currentRepo, 'package.json'), JSON.stringify({
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      devDependencies: { typescript: '^5.0.0' }
    }), 'utf8')
    await writeFile(join(otherRepo, 'package.json'), JSON.stringify({
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      devDependencies: { typescript: '^5.0.0' }
    }), 'utf8')
    const current = await identifyCodexProject(currentRepo)
    const other = await identifyCodexProject(otherRepo)
    const otherRoot = codexProjectMemoryRoot(other.projectId)
    await mkdir(codexProjectMemoryRoot(current.projectId), { recursive: true })
    await mkdir(otherRoot, { recursive: true })
    await writeFile(join(otherRoot, 'index.jsonl'), JSON.stringify(createMemory({
      id: 'unsafe-similar-hint',
      domain: 'procedural',
      type: 'procedural_rule',
      portability: 'similar_project',
      content: 'Use /Users/phoenix/private/project/config.json for this plugin.',
      normalizedKey: 'unsafe-path-similar-hint',
      tags: ['mcp']
    })) + '\n')

    await getCodexContinuityContext({
      cwd: otherRepo,
      userMessage: 'Index this MCP plugin project.',
      task: 'planning'
    })
    const context = await getCodexContinuityContext({
      cwd: currentRepo,
      userMessage: 'What MCP plugin guidance applies?',
      task: 'planning'
    })

    expect(context.similarProjectHints).toEqual([])
    expect(context.diagnostics?.evalGate).toMatchObject({
      passed: false,
      failedChecks: ['similar_hint_boundary_eval']
    })
  })
```

- [ ] **Step 2: Run RED for continuity integration tests**

Run:

```bash
npx vitest run tests/codex-continuity-context.test.ts
```

Expected: FAIL because `similarProjectHints` is still always `[]`.

- [ ] **Step 3: Extend Codex memory index roots to include all projects**

Modify `src/codex/codex-memory-index.ts` imports:

```ts
import { basename, dirname, join } from 'node:path'
```

Update `codexMemoryIndexRoots()`:

```ts
export async function codexMemoryIndexRoots(projectId: string): Promise<MemoryIndexRoot[]> {
  const roots: MemoryIndexRoot[] = []
  const seen = new Set<string>()
  const addRoot = (root: MemoryIndexRoot): void => {
    if (seen.has(root.memoryRoot)) return
    seen.add(root.memoryRoot)
    roots.push(root)
  }

  const globalRoot = await getReadableCodexGlobalMemoryRoot()
  if (globalRoot !== null) {
    addRoot({ memoryRoot: globalRoot, projectId: null, scope: 'global' })
  }
  const projectRoot = await getReadableCodexProjectMemoryRoot(projectId)
  if (projectRoot !== null) {
    addRoot({ memoryRoot: projectRoot, projectId, scope: 'project' })
  }
  for (const memoryRoot of await getReadableCodexProjectMemoryRoots()) {
    addRoot({ memoryRoot, projectId: basename(dirname(memoryRoot)), scope: 'project' })
  }
  return roots
}
```

- [ ] **Step 4: Add similar hint types and diagnostics to continuity context**

Modify `src/codex/continuity-context.ts` imports:

```ts
import { runSimilarHintsEvalGate } from '../eval/eval-runner.js'
import type { IndexedActiveMemory, IndexedPendingMemory, IndexedSimilarMemory, MemoryIndexDiagnostics } from '../memory/memory-index.js'
import { selectSimilarProjects } from '../memory/project-similarity.js'
import { buildCodexProjectFingerprint } from './project-fingerprint.js'
```

Add digest interfaces near existing digest item types:

```ts
interface SimilarProjectHintDigestItem {
  id: string
  sourceProjectId: string
  sourceProjectName?: string
  domain: 'project' | 'procedural' | 'system'
  type: string
  strength: string
  portability: 'similar_project' | 'project_family'
  content: string
  score: number
  similarityScore: number
  transferable: true
  notCurrentProjectFact: true
  rationale: string
}

interface ProjectSimilarityDiagnostics {
  indexedProjects: number
  candidateProjects: number
  selectedProjects: number
  reason?: string
}

interface EvalGateDiagnostics {
  passed: boolean
  failedChecks: string[]
}
```

Change context type fields:

```ts
  similarProjectHints: SimilarProjectHintDigestItem[]
  diagnostics?: {
    memoryIndex?: {
      available: boolean
      reason?: string
      ftsTokenizer?: string
    }
    projectSimilarity?: ProjectSimilarityDiagnostics
    evalGate?: EvalGateDiagnostics
  }
```

- [ ] **Step 5: Query and gate similar hints inside routed memory retrieval**

Extend `RoutedMemoryResult`:

```ts
  similarProjectHints: IndexedSimilarMemory[]
  projectSimilarityDiagnostics: ProjectSimilarityDiagnostics
  evalGateDiagnostics: EvalGateDiagnostics
```

Modify `retrieveRoutedMemory()` signature to accept `cwd`:

```ts
async function retrieveRoutedMemory(input: {
  cwd: string
  projectId: string
  query: string
  task: CodexContinuityTask
  fallback: RetrieveMemoriesInput
}): Promise<RoutedMemoryResult> {
```

Inside the SQLite available branch, after `diagnostics.available`:

```ts
    const currentFingerprint = await buildCodexProjectFingerprint({
      cwd: input.cwd,
      project: await identifyCodexProject(input.cwd)
    })
    await adapter.upsertProjectMetadata(currentFingerprint)
    const metadata = await adapter.listProjectMetadata()
    const selectedSimilarities = selectSimilarProjects({
      source: currentFingerprint,
      candidates: metadata,
      minScore: 0.2,
      maxProjects: 5,
      now: new Date().toISOString()
    })
    for (const similarity of selectedSimilarities) {
      await adapter.upsertProjectSimilarity(similarity)
    }
    const targetNames = new Map(metadata.map((project) => [project.projectId, project.displayName]))
    const similarProjectHints = await adapter.querySimilarActive({
      currentProjectId: input.projectId,
      query: input.query,
      targetProjects: selectedSimilarities.map((similarity) => ({
        projectId: similarity.targetProjectId,
        similarityScore: similarity.score,
        displayName: targetNames.get(similarity.targetProjectId)
      })),
      task: input.task,
      maxItems: 6,
      maxTokens: 500
    })
    const evalGate = runSimilarHintsEvalGate(similarProjectHints.map((item) => ({
      id: item.memory.id,
      currentProjectId: input.projectId,
      homeProjectId: item.homeProjectId,
      domain: item.memory.domain,
      portability: item.portability,
      scope: item.memory.scope,
      content: item.memory.content,
      transferable: true,
      notCurrentProjectFact: true
    })))
    const safeSimilarProjectHints = evalGate.passed ? similarProjectHints : []
```

Return diagnostics:

```ts
      similarProjectHints: safeSimilarProjectHints,
      projectSimilarityDiagnostics: {
        indexedProjects: metadata.length,
        candidateProjects: Math.max(0, metadata.length - 1),
        selectedProjects: selectedSimilarities.length,
        reason: metadata.length <= 1 ? 'no_similar_projects_indexed' : undefined
      },
      evalGateDiagnostics: {
        passed: evalGate.passed,
        failedChecks: evalGate.failedChecks
      },
```

Fallback result should use:

```ts
    similarProjectHints: [],
    projectSimilarityDiagnostics: {
      indexedProjects: 0,
      candidateProjects: 0,
      selectedProjects: 0,
      reason: 'memory_index_unavailable'
    },
    evalGateDiagnostics: {
      passed: true,
      failedChecks: []
    },
```

- [ ] **Step 6: Return similar hints in digest**

Update call site:

```ts
  const routedMemory = await retrieveRoutedMemory({
    cwd: input.cwd,
    projectId: project.projectId,
    query: input.userMessage,
    task,
    fallback: legacyRetrievalInput
  })
```

Change returned field:

```ts
    similarProjectHints: routedMemory.similarProjectHints.map(toSimilarProjectHintDigestItem),
```

Extend diagnostics:

```ts
      projectSimilarity: routedMemory.projectSimilarityDiagnostics,
      evalGate: routedMemory.evalGateDiagnostics
```

Add converter:

```ts
function toSimilarProjectHintDigestItem(item: IndexedSimilarMemory): SimilarProjectHintDigestItem {
  return {
    id: item.memory.id,
    sourceProjectId: item.homeProjectId,
    sourceProjectName: item.sourceProjectName,
    domain: item.memory.domain as 'project' | 'procedural' | 'system',
    type: item.memory.type,
    strength: item.memory.strength,
    portability: item.portability as 'similar_project' | 'project_family',
    content: item.memory.content,
    score: item.score,
    similarityScore: item.similarityScore,
    transferable: true,
    notCurrentProjectFact: true,
    rationale: 'Transferable guidance from a similar indexed project; not a current project fact.'
  }
}
```

- [ ] **Step 7: Run GREEN for continuity integration tests**

Run:

```bash
npx vitest run tests/codex-continuity-context.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add src/codex/codex-memory-index.ts src/codex/continuity-context.ts tests/codex-continuity-context.test.ts
git commit -m "feat: return safe similar project hints"
```

---

### Task 6: CLI Eval Command And Documentation

**Files:**
- Create: `src/codex/codex-eval.ts`
- Modify: `src/codex/codex-cli.ts`
- Modify: `tests/codex-cli.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write failing CLI eval test**

Append to `tests/codex-cli.test.ts`:

```ts
  it('runs the similar hints eval check from the Codex CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-eval-home-')
    const repo = await createTempDir('cyrene-codex-cli-eval-repo-')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'eval', 'run', '--check', 'similar-hints'],
      { cwd: repo, env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as {
      check: string
      passed: boolean
      failedChecks: string[]
      similarProjectHints: number
    }
    expect(parsed).toEqual({
      check: 'similar-hints',
      passed: true,
      failedChecks: [],
      similarProjectHints: 0
    })
  })
```

- [ ] **Step 2: Run RED for CLI eval test**

Run:

```bash
npx vitest run tests/codex-cli.test.ts -t "runs the similar hints eval check"
```

Expected: FAIL because `codex eval run --check similar-hints` is not implemented.

- [ ] **Step 3: Implement CLI eval summary**

Create `src/codex/codex-eval.ts`:

```ts
import { getCodexContinuityContext } from './continuity-context.js'

export interface CodexSimilarHintsEvalSummary {
  check: 'similar-hints'
  passed: boolean
  failedChecks: string[]
  similarProjectHints: number
}

export async function runCodexSimilarHintsEval(input: { cwd: string }): Promise<CodexSimilarHintsEvalSummary> {
  const context = await getCodexContinuityContext({
    cwd: input.cwd,
    userMessage: 'Run similar-project hints boundary eval.',
    task: 'memory'
  })
  return {
    check: 'similar-hints',
    passed: context.diagnostics?.evalGate?.passed ?? true,
    failedChecks: context.diagnostics?.evalGate?.failedChecks ?? [],
    similarProjectHints: context.similarProjectHints.length
  }
}
```

Modify `src/codex/codex-cli.ts` import:

```ts
import { runCodexSimilarHintsEval } from './codex-eval.js'
```

Add command before memory commands:

```ts
  if (command === 'eval' && input.args[1] === 'run' && input.args[2] === '--check' && input.args[3] === 'similar-hints') {
    process.stdout.write(`${JSON.stringify(await runCodexSimilarHintsEval({ cwd: input.cwd }), null, 2)}\n`)
    return
  }
```

Update usage string:

```ts
  console.error('Usage: cyrene-continuity codex <doctor [--config <path>]|install --dev|install --plugin|install-hook --stop [--dry-run]|hook stop|eval run --check similar-hints|memory dream [--stage light|rem|deep]|memory db rebuild|memory maintenance|memory profile>')
```

- [ ] **Step 4: Update README**

In `README.md`, add to MCP/Data or Commands sections:

```markdown
npm run dev -- codex eval run --check similar-hints
```

Add a short section:

```markdown
## Similar-Project Hints

`cyrene_continuity_get` can return `similarProjectHints` when another indexed
project has explicitly portable `similar_project` or `project_family` memory.
Hints are transferable guidance, not current-project facts. `local_only`,
personal, relationship, and affective memories are excluded by policy and a
deterministic eval gate.
```

- [ ] **Step 5: Run GREEN for CLI eval test**

Run:

```bash
npx vitest run tests/codex-cli.test.ts -t "runs the similar hints eval check"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

Run:

```bash
git add src/codex/codex-eval.ts src/codex/codex-cli.ts tests/codex-cli.test.ts README.md
git commit -m "feat: add similar hints eval cli"
```

---

### Task 7: Full Verification And Runtime Bundle

**Files:**
- Modify: `plugin/runtime/cyrene-continuity.mjs`

- [ ] **Step 1: Run focused feature tests**

Run:

```bash
npx vitest run tests/codex-project-fingerprint.test.ts tests/project-similarity.test.ts tests/eval-runner.test.ts tests/memory-index.test.ts tests/codex-continuity-context.test.ts tests/codex-cli.test.ts
```

Expected: all listed test files PASS.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

Expected:

- `npm test`: all tests pass.
- `npm run typecheck`: exit 0.
- `npm run build:plugin`: updates `plugin/runtime/cyrene-continuity.mjs`.
- plugin validator exits 0.

- [ ] **Step 3: Smoke test MCP continuity get**

Run:

```bash
node --input-type=module - <<'EOF'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const client = new Client({ name: 'cyrene-similar-hints-smoke', version: '0.0.0' })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['plugin/runtime/cyrene-continuity.mjs', 'mcp-server', '--stdio'],
  env: process.env
})

await client.connect(transport)
try {
  const result = await client.callTool({
    name: 'cyrene_continuity_get',
    arguments: {
      cwd: process.cwd(),
      userMessage: 'Check similar-project hints and eval gate diagnostics.',
      task: 'planning'
    }
  })
  const text = result.content?.find((part) => part.type === 'text')?.text
  const context = JSON.parse(text)
  console.log(JSON.stringify({
    hasSimilarProjectHints: Array.isArray(context.similarProjectHints),
    similarProjectHints: context.similarProjectHints?.length,
    diagnostics: context.diagnostics
  }, null, 2))
} finally {
  await client.close()
}
EOF
```

Expected: JSON includes `"hasSimilarProjectHints": true` and non-fatal diagnostics. `similarProjectHints` may be `0` if no eligible similar memory exists locally.

- [ ] **Step 4: Commit runtime bundle**

Run:

```bash
git add plugin/runtime/cyrene-continuity.mjs
git commit -m "build: update cyrene plugin runtime"
```

If `plugin/runtime/cyrene-continuity.mjs` has no diff after `npm run build:plugin`, skip this commit and record that the bundle was unchanged.

- [ ] **Step 5: Final status check**

Run:

```bash
git status --porcelain=v1 -b
git log --oneline --decorate --max-count=10
```

Expected: clean worktree on `codex/similar-project-hints-eval-gate`, with task commits present.

