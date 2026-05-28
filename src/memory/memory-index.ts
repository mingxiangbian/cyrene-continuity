import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { estimateTokens } from '../token-counter.js'
import {
  assertEmbeddingSafeText,
  createEmbeddingProviderFromEnv,
  embeddingDiagnostics,
  recordEmbeddingCacheMisses,
  recordEmbeddingFallback,
  type EmbeddingDiagnostics,
  type EmbeddingProvider
} from './embedding-provider.js'
import { isMemoryEligibleForRetrieval } from './memory-retriever.js'
import type { RetrieveMemoriesInput } from './memory-retriever.js'
import {
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot
} from './memory-store.js'
import type { CyreneMemory, MemoryPortability, PendingMemory } from './types.js'

export interface MemoryIndexRoot {
  memoryRoot: string
  projectId: string | null
  scope: 'global' | 'project'
}

export interface MemoryIndexDiagnostics {
  available: boolean
  dbPath: string
  ftsTokenizer?: 'trigram' | 'unicode61'
  reason?: string
  embedding?: EmbeddingDiagnostics
}

export interface MemoryIndexRebuildInput {
  roots: MemoryIndexRoot[]
}

export interface MemoryIndexActiveQuery {
  currentProjectId: string
  query: string
  route: 'global' | 'project'
  task?: NonNullable<RetrieveMemoriesInput['task']>
  maxItems: number
  maxTokens: number
}

export interface MemoryIndexPendingQuery {
  currentProjectId: string
  query: string
  maxItems: number
  maxTokens: number
}

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

export interface IndexedActiveMemory {
  memory: CyreneMemory
  score: number
  portability: MemoryPortability
  homeProjectId: string | null
}

export interface IndexedPendingMemory {
  memory: PendingMemory
  score: number
  portability: MemoryPortability
  homeProjectId: string | null
  provisional: true
}

export interface IndexedSimilarMemory extends IndexedActiveMemory {
  homeProjectId: string
  similarityScore: number
  sourceProjectName?: string
}

export interface MemoryIndexAdapter {
  initialize(): Promise<MemoryIndexDiagnostics>
  rebuildFromRoots(input: MemoryIndexRebuildInput): Promise<MemoryIndexDiagnostics>
  syncRoot(root: MemoryIndexRoot): Promise<MemoryIndexDiagnostics>
  upsertProjectMetadata(metadata: ProjectMetadata): Promise<MemoryIndexDiagnostics>
  listProjectMetadata(): Promise<ProjectMetadata[]>
  upsertProjectSimilarity(similarity: ProjectSimilarity): Promise<MemoryIndexDiagnostics>
  listProjectSimilarities(sourceProjectId: string): Promise<ProjectSimilarity[]>
  queryActive(input: MemoryIndexActiveQuery): Promise<IndexedActiveMemory[]>
  queryPending(input: MemoryIndexPendingQuery): Promise<IndexedPendingMemory[]>
  querySimilarActive(input: MemoryIndexSimilarQuery): Promise<IndexedSimilarMemory[]>
  diagnostics(): MemoryIndexDiagnostics
  close(): void
}

export interface OpenMemoryIndexAdapterInput {
  dbPath: string
  forceUnavailableReason?: string
}

type FtsTokenizer = NonNullable<MemoryIndexDiagnostics['ftsTokenizer']>

interface DatabaseLike {
  close(): void
  exec(sql: string): void
  prepare(sql: string): StatementLike
}

interface StatementLike {
  all(...values: unknown[]): Record<string, unknown>[]
  get(...values: unknown[]): Record<string, unknown> | undefined
  run(...values: unknown[]): unknown
}

interface MemoryIndexRow {
  id: string
  status: 'active' | 'pending'
  scope: string
  domain: string
  type: string
  strength: string
  homeProjectId: string | null
  portability: MemoryPortability
  content: string
  normalizedKey: string
  tags: string[]
  scores: {
    evidenceStrength?: number
    safety?: number
    sensitivity?: number
    usefulness?: number
  }
  payload: CyreneMemory | PendingMemory
}

export async function openMemoryIndexAdapter(input: OpenMemoryIndexAdapterInput): Promise<MemoryIndexAdapter> {
  if (input.forceUnavailableReason !== undefined) {
    return new UnavailableMemoryIndexAdapter(input.dbPath, input.forceUnavailableReason)
  }

  try {
    return new SqliteMemoryIndexAdapter(input.dbPath, await loadSqliteDatabaseSync())
  } catch (error) {
    return new UnavailableMemoryIndexAdapter(input.dbPath, error instanceof Error ? error.message : String(error))
  }
}

async function loadSqliteDatabaseSync(): Promise<new (path: string) => DatabaseLike> {
  try {
    const sqlite = await import('node:sqlite') as unknown as { DatabaseSync: new (path: string) => DatabaseLike }
    return sqlite.DatabaseSync
  } catch (importError) {
    try {
      const require = createRequire(import.meta.url)
      const sqlite = require('node:sqlite') as { DatabaseSync: new (path: string) => DatabaseLike }
      return sqlite.DatabaseSync
    } catch {
      throw importError
    }
  }
}

export function deriveMemoryPortability(
  memory: Pick<CyreneMemory | PendingMemory, 'scope' | 'portability'>
): MemoryPortability {
  if (memory.portability !== undefined) return memory.portability
  return memory.scope === 'global' ? 'global' : 'local_only'
}

class UnavailableMemoryIndexAdapter implements MemoryIndexAdapter {
  constructor(private readonly dbPath: string, private readonly reason: string) {}

  async initialize(): Promise<MemoryIndexDiagnostics> {
    return this.diagnostics()
  }

  async rebuildFromRoots(_input: MemoryIndexRebuildInput): Promise<MemoryIndexDiagnostics> {
    return this.diagnostics()
  }

  async syncRoot(_root: MemoryIndexRoot): Promise<MemoryIndexDiagnostics> {
    return this.diagnostics()
  }

  async upsertProjectMetadata(_metadata: ProjectMetadata): Promise<MemoryIndexDiagnostics> {
    return this.diagnostics()
  }

  async listProjectMetadata(): Promise<ProjectMetadata[]> {
    return []
  }

  async upsertProjectSimilarity(_similarity: ProjectSimilarity): Promise<MemoryIndexDiagnostics> {
    return this.diagnostics()
  }

  async listProjectSimilarities(_sourceProjectId: string): Promise<ProjectSimilarity[]> {
    return []
  }

  async queryActive(_input: MemoryIndexActiveQuery): Promise<IndexedActiveMemory[]> {
    return []
  }

  async queryPending(_input: MemoryIndexPendingQuery): Promise<IndexedPendingMemory[]> {
    return []
  }

  async querySimilarActive(_input: MemoryIndexSimilarQuery): Promise<IndexedSimilarMemory[]> {
    return []
  }

  diagnostics(): MemoryIndexDiagnostics {
    return {
      available: false,
      dbPath: this.dbPath,
      reason: this.reason,
      embedding: { enabled: false, cacheHits: 0, cacheMisses: 0 }
    }
  }

  close(): void {}
}

class SqliteMemoryIndexAdapter implements MemoryIndexAdapter {
  private db: DatabaseLike | undefined
  private currentDiagnostics: MemoryIndexDiagnostics
  private initialized = false
  private readonly embeddingProvider: EmbeddingProvider = createEmbeddingProviderFromEnv()

  constructor(private readonly dbPath: string, private readonly DatabaseSync: new (path: string) => DatabaseLike) {
    this.currentDiagnostics = { available: true, dbPath, embedding: embeddingDiagnostics(this.embeddingProvider) }
  }

  async initialize(): Promise<MemoryIndexDiagnostics> {
    const db = await this.openDatabase()
    db.exec(`
      create table if not exists projects (
        project_id text primary key,
        root_hash text,
        remote_hash text,
        name text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists project_similarity (
        source_project_id text not null,
        target_project_id text not null,
        score real not null,
        reason_json text not null,
        updated_at text not null,
        primary key (source_project_id, target_project_id)
      );

      create table if not exists memories (
        id text primary key,
        memory_root text not null,
        scope text not null,
        domain text not null,
        type text not null,
        strength text not null,
        status text not null,
        home_project_id text,
        portability text not null,
        content text not null,
        normalized_key text not null,
        tags text not null,
        tags_json text not null,
        scores_json text not null,
        source text not null,
        profile_visibility text,
        payload_json text not null,
        first_seen_at text,
        last_seen_at text,
        created_at text not null,
        updated_at text not null,
        expires_at text
      );

      create table if not exists memory_evidence (
        id text primary key,
        memory_id text not null,
        source_kind text,
        project_id text,
        session_id text,
        run_id text,
        evidence_group_id text,
        quote_hash text,
        summary text,
        created_at text not null
      );

      create table if not exists memory_embeddings (
        memory_id text primary key,
        provider text not null,
        content_hash text not null,
        vector_json text not null,
        updated_at text not null
      );

      create table if not exists project_embeddings (
        project_id text primary key,
        provider text not null,
        content_hash text not null,
        vector_json text not null,
        updated_at text not null
      );
    `)
    this.ensureProjectColumns(db)
    if (!this.initialized) {
      this.currentDiagnostics = {
        available: true,
        dbPath: this.dbPath,
        ftsTokenizer: this.ensureFtsTable(db),
        embedding: embeddingDiagnostics(this.embeddingProvider)
      }
      this.initialized = true
    }
    return this.currentDiagnostics
  }

  async rebuildFromRoots(input: MemoryIndexRebuildInput): Promise<MemoryIndexDiagnostics> {
    const diagnostics = await this.initialize()
    const db = this.requireDatabase()
    db.exec('delete from memory_evidence; delete from memories;')
    for (const root of input.roots) {
      await this.syncRootRecords(root)
    }
    this.rebuildFts()
    return diagnostics
  }

  async syncRoot(root: MemoryIndexRoot): Promise<MemoryIndexDiagnostics> {
    const diagnostics = await this.syncRootRecords(root)
    this.rebuildFts()
    return diagnostics
  }

  private async syncRootRecords(root: MemoryIndexRoot): Promise<MemoryIndexDiagnostics> {
    const diagnostics = await this.initialize()
    const db = this.requireDatabase()
    db.prepare('delete from memory_evidence where memory_id in (select id from memories where memory_root = ?)').run(root.memoryRoot)
    db.prepare('delete from memories where memory_root = ?').run(root.memoryRoot)

    if (root.projectId !== null) {
      const now = new Date().toISOString()
      db.prepare(`
        insert into projects (project_id, name, display_name, created_at, updated_at)
        values (?, ?, ?, ?, ?)
        on conflict(project_id) do update set updated_at = excluded.updated_at
      `).run(root.projectId, root.projectId, root.projectId, now, now)
    }

    const [active, pending] = await Promise.all([
      readActiveMemoriesFromRoot(root.memoryRoot),
      readPendingMemoriesFromRoot(root.memoryRoot)
    ])
    for (const memory of active) {
      this.insertMemory(root, memory)
    }
    for (const memory of pending) {
      this.insertMemory(root, memory)
    }
    return diagnostics
  }

  async upsertProjectMetadata(metadata: ProjectMetadata): Promise<MemoryIndexDiagnostics> {
    const diagnostics = await this.initialize()
    const db = this.requireDatabase()
    const now = new Date().toISOString()
    const timestamp = metadata.updatedAt || now
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
      timestamp,
      timestamp
    )
    return diagnostics
  }

  async listProjectMetadata(): Promise<ProjectMetadata[]> {
    await this.initialize()
    return this.requireDatabase().prepare(`
      select
        project_id,
        root_hash,
        remote_hash,
        name,
        display_name,
        package_manager,
        languages_json,
        frameworks_json,
        dependency_names_json,
        domain_tags_json,
        updated_at
      from projects
      order by project_id asc
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

  async queryActive(input: MemoryIndexActiveQuery): Promise<IndexedActiveMemory[]> {
    await this.initialize()
    const structuredRows = this.queryStructuredRows({
      status: 'active',
      currentProjectId: input.currentProjectId,
      route: input.route
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
    const items = eligibleRows
      .map((row) => ({
        memory: row.payload as CyreneMemory,
        score: scoreRow(row, input.query, ftsMatches),
        portability: row.portability,
        homeProjectId: row.homeProjectId
      }))
      .filter((item) => input.query.trim() === '' || item.score > 0)
      .sort(compareIndexedItems)
    return selectWithinBudget(
      await this.rerankWithEmbeddings(items, input.query),
      input.maxItems,
      input.maxTokens
    )
  }

  async queryPending(input: MemoryIndexPendingQuery): Promise<IndexedPendingMemory[]> {
    await this.initialize()
    const structuredRows = this.queryStructuredRows({
      status: 'pending',
      currentProjectId: input.currentProjectId,
      route: 'pending'
    })
    const ftsMatches = this.queryFtsIds(input.query, 'pending')
    return selectWithinBudget(
      structuredRows
        .map((row) => ({
          memory: row.payload as PendingMemory,
          score: scoreRow(row, input.query, ftsMatches),
          portability: row.portability,
          homeProjectId: row.homeProjectId,
          provisional: true as const
        }))
        .filter((item) => input.query.trim() === '' || item.score > 0)
        .sort(compareIndexedItems),
      input.maxItems,
      input.maxTokens
    )
  }

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
    const items: IndexedSimilarMemory[] = []
    for (const row of eligibleRows) {
      const target = targetById.get(row.homeProjectId ?? '')
      if (target === undefined) continue
      items.push({
        memory: row.payload as CyreneMemory,
        score: scoreRow(row, input.query, ftsMatches) + target.similarityScore * 0.2,
        portability: row.portability,
        homeProjectId: target.projectId,
        similarityScore: target.similarityScore,
        ...(target.displayName === undefined ? {} : { sourceProjectName: target.displayName })
      })
    }
    return selectWithinBudget(
      await this.rerankWithEmbeddings(
        items
          .filter((item) => input.query.trim() === '' || item.score > 0)
          .sort(compareIndexedItems),
        input.query
      ),
      input.maxItems,
      input.maxTokens
    )
  }

  diagnostics(): MemoryIndexDiagnostics {
    return this.currentDiagnostics
  }

  close(): void {
    if (this.db !== undefined) {
      this.db.close()
      this.db = undefined
    }
  }

  private async openDatabase(): Promise<DatabaseLike> {
    if (this.db !== undefined) {
      return this.db
    }
    await mkdir(dirname(this.dbPath), { recursive: true })
    this.db = new this.DatabaseSync(this.dbPath)
    return this.db
  }

  private requireDatabase(): DatabaseLike {
    if (this.db === undefined) {
      throw new Error('Memory index database is not initialized.')
    }
    return this.db
  }

  private ensureFtsTable(db: DatabaseLike): FtsTokenizer {
    try {
      db.exec(`
        create virtual table if not exists memories_fts
        using fts5(content, normalized_key, tags, tokenize='trigram', content='memories', content_rowid='rowid');
      `)
      return 'trigram'
    } catch {
      db.exec('drop table if exists memories_fts;')
      db.exec(`
        create virtual table if not exists memories_fts
        using fts5(content, normalized_key, tags, tokenize='unicode61', content='memories', content_rowid='rowid');
      `)
      return 'unicode61'
    }
  }

  private ensureProjectColumns(db: DatabaseLike): void {
    for (const sql of [
      'alter table projects add column display_name text',
      'alter table projects add column package_manager text',
      'alter table projects add column languages_json text',
      'alter table projects add column frameworks_json text',
      'alter table projects add column dependency_names_json text',
      'alter table projects add column dependency_fingerprint text',
      'alter table projects add column domain_tags_json text'
    ]) {
      try {
        db.exec(sql)
      } catch (error) {
        if (!String(error).includes('duplicate column name')) {
          throw error
        }
      }
    }
  }

  private async rerankWithEmbeddings<T extends { memory: CyreneMemory | PendingMemory; score: number }>(
    items: T[],
    query: string
  ): Promise<T[]> {
    if (!this.embeddingProvider.diagnostics.enabled || items.length === 0) {
      return items
    }
    try {
      assertEmbeddingSafeText(query)
      for (const item of items) {
        assertEmbeddingSafeText(item.memory.content)
      }
      recordEmbeddingCacheMisses(this.embeddingProvider, items.length + 1)
      await this.embeddingProvider.embedTexts([query, ...items.map((item) => item.memory.content)])
      this.refreshEmbeddingDiagnostics()
      return items
    } catch (error) {
      recordEmbeddingFallback(this.embeddingProvider, error instanceof Error ? error.message : String(error))
      this.refreshEmbeddingDiagnostics()
      return items
    }
  }

  private refreshEmbeddingDiagnostics(): void {
    this.currentDiagnostics = {
      ...this.currentDiagnostics,
      embedding: embeddingDiagnostics(this.embeddingProvider)
    }
  }

  private insertMemory(root: MemoryIndexRoot, memory: CyreneMemory | PendingMemory): void {
    const db = this.requireDatabase()
    const indexId = memoryIndexId(root, memory.id)
    const portability = deriveMemoryPortability(memory)
    const homeProjectId = root.scope === 'global' ? null : root.projectId
    const tags = memory.tags.join(' ')
    const now = new Date().toISOString()
    db.prepare(`
      insert into memories (
        id,
        memory_root,
        scope,
        domain,
        type,
        strength,
        status,
        home_project_id,
        portability,
        content,
        normalized_key,
        tags,
        tags_json,
        scores_json,
        source,
        profile_visibility,
        payload_json,
        first_seen_at,
        last_seen_at,
        created_at,
        updated_at,
        expires_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        memory_root = excluded.memory_root,
        scope = excluded.scope,
        domain = excluded.domain,
        type = excluded.type,
        strength = excluded.strength,
        status = excluded.status,
        home_project_id = excluded.home_project_id,
        portability = excluded.portability,
        content = excluded.content,
        normalized_key = excluded.normalized_key,
        tags = excluded.tags,
        tags_json = excluded.tags_json,
        scores_json = excluded.scores_json,
        source = excluded.source,
        profile_visibility = excluded.profile_visibility,
        payload_json = excluded.payload_json,
        first_seen_at = excluded.first_seen_at,
        last_seen_at = excluded.last_seen_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `).run(
      indexId,
      root.memoryRoot,
      memory.scope,
      memory.domain,
      memory.type,
      memory.strength,
      memory.status,
      homeProjectId,
      portability,
      memory.content,
      memory.normalizedKey,
      tags,
      JSON.stringify(memory.tags),
      JSON.stringify(memory.scores),
      memory.source,
      memory.profileVisibility ?? null,
      JSON.stringify(memory),
      'firstSeenAt' in memory ? memory.firstSeenAt : memory.createdAt,
      'lastSeenAt' in memory ? memory.lastSeenAt : memory.updatedAt,
      'createdAt' in memory ? memory.createdAt : memory.firstSeenAt,
      'updatedAt' in memory ? memory.updatedAt : now,
      memory.expiresAt ?? null
    )

    for (const [index, evidence] of memory.evidence.entries()) {
      db.prepare(`
        insert into memory_evidence (
          id,
          memory_id,
          source_kind,
          project_id,
          session_id,
          run_id,
          evidence_group_id,
          quote_hash,
          summary,
          created_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `${indexId}:${index}`,
        indexId,
        evidence.sourceKind ?? memory.source,
        homeProjectId,
        evidence.sessionId ?? null,
        evidence.runId ?? null,
        evidence.evidenceGroupId ?? null,
        evidence.quoteHash ?? null,
        evidence.summary ?? null,
        now
      )
    }
  }

  private rebuildFts(): void {
    this.requireDatabase().prepare("insert into memories_fts(memories_fts) values ('rebuild')").run()
  }

  private queryStructuredRows(input: {
    status: 'active' | 'pending'
    currentProjectId: string
    route: 'global' | 'project' | 'pending'
  }): MemoryIndexRow[] {
    const db = this.requireDatabase()
    const conditions = ['status = ?']
    const values: unknown[] = [input.status]
    if (input.route === 'global') {
      conditions.push("scope = 'global'", "portability = 'global'")
    } else if (input.route === 'project') {
      conditions.push('home_project_id = ?', "portability = 'local_only'")
      values.push(input.currentProjectId)
    } else {
      conditions.push("(scope = 'global' or home_project_id = ?)")
      values.push(input.currentProjectId)
    }
    const rows = db.prepare(`
      select
        id,
        status,
        scope,
        domain,
        type,
        strength,
        home_project_id,
        portability,
        content,
        normalized_key,
        tags_json,
        scores_json,
        payload_json
      from memories
      where ${conditions.join(' and ')}
    `).all(...values)
    return rows.map(rowFromRecord)
  }

  private querySimilarStructuredRows(input: {
    currentProjectId: string
    targetProjectIds: string[]
  }): MemoryIndexRow[] {
    if (input.targetProjectIds.length === 0) return []
    const placeholders = input.targetProjectIds.map(() => '?').join(', ')
    const rows = this.requireDatabase().prepare(`
      select
        id,
        status,
        scope,
        domain,
        type,
        strength,
        home_project_id,
        portability,
        content,
        normalized_key,
        tags_json,
        scores_json,
        payload_json
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

  private queryFtsIds(query: string, status: 'active' | 'pending'): Set<string> {
    if (query.trim() === '') {
      return new Set()
    }
    const expression = ftsExpression(query)
    if (expression === '') {
      return new Set()
    }
    try {
      const rows = this.requireDatabase().prepare(`
        select m.id
        from memories_fts
        join memories m on m.rowid = memories_fts.rowid
        where memories_fts match ? and m.status = ?
      `).all(expression, status)
      return new Set(rows.map((row) => typeof row.id === 'string' ? row.id : '').filter(Boolean))
    } catch {
      return new Set()
    }
  }
}

function memoryIndexId(root: MemoryIndexRoot, memoryId: string): string {
  return JSON.stringify([root.scope, root.projectId, memoryId])
}

function dependencyFingerprint(dependencyNames: string[]): string {
  return dependencyNames.slice().sort().join('\n')
}

function projectMetadataFromRecord(row: Record<string, unknown>): ProjectMetadata {
  const projectId = readString(row.project_id, 'project_id')
  return {
    projectId,
    displayName: typeof row.display_name === 'string'
      ? row.display_name
      : typeof row.name === 'string'
        ? row.name
        : projectId,
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

function rowFromRecord(row: Record<string, unknown>): MemoryIndexRow {
  const payload = JSON.parse(readString(row.payload_json, 'payload_json')) as CyreneMemory | PendingMemory
  return {
    id: readString(row.id, 'id'),
    status: readString(row.status, 'status') as 'active' | 'pending',
    scope: readString(row.scope, 'scope'),
    domain: readString(row.domain, 'domain'),
    type: readString(row.type, 'type'),
    strength: readString(row.strength, 'strength'),
    homeProjectId: row.home_project_id === null ? null : readString(row.home_project_id, 'home_project_id'),
    portability: readString(row.portability, 'portability') as MemoryPortability,
    content: readString(row.content, 'content'),
    normalizedKey: readString(row.normalized_key, 'normalized_key'),
    tags: JSON.parse(readString(row.tags_json, 'tags_json')) as string[],
    scores: JSON.parse(readString(row.scores_json, 'scores_json')) as MemoryIndexRow['scores'],
    payload
  }
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Memory index row field is not a string: ${field}`)
  }
  return value
}

function scoreRow(row: MemoryIndexRow, query: string, ftsMatches: Set<string>): number {
  const tokens = tokenize(query)
  const relevance = tokens.length === 0 ? 0.2 : relevanceScore(row, tokens)
  const ftsBoost = ftsMatches.has(row.id) ? 0.2 : 0
  const safety = typeof row.scores.safety === 'number' ? row.scores.safety : 0.8
  const usefulness = typeof row.scores.usefulness === 'number' ? row.scores.usefulness : 0.7
  const evidence = typeof row.scores.evidenceStrength === 'number' ? row.scores.evidenceStrength : 0.7
  const sensitivity = typeof row.scores.sensitivity === 'number' ? row.scores.sensitivity : 0.2
  return relevance * 0.45 + usefulness * 0.2 + evidence * 0.15 + safety * 0.1 + ftsBoost - sensitivity * 0.1
}

function relevanceScore(row: MemoryIndexRow, queryTokens: string[]): number {
  const haystack = tokenize([
    row.content,
    row.normalizedKey,
    row.domain,
    row.type,
    row.strength,
    row.portability,
    ...row.tags
  ].join(' '))
  const matches = queryTokens.filter((token) => haystack.some((candidate) => candidate.includes(token)))
  return matches.length / queryTokens.length
}

function compareIndexedItems<T extends { score: number; memory: { id: string } }>(left: T, right: T): number {
  const scoreDiff = right.score - left.score
  if (scoreDiff !== 0) return scoreDiff
  return left.memory.id.localeCompare(right.memory.id)
}

function selectWithinBudget<T extends { memory: { content: string } }>(items: T[], maxItems: number, maxTokens: number): T[] {
  const selected: T[] = []
  let tokenCount = 0
  for (const item of items) {
    if (selected.length >= maxItems) {
      break
    }
    const itemTokens = estimateTokens(item.memory.content)
    if (itemTokens > maxTokens) {
      continue
    }
    if (tokenCount + itemTokens > maxTokens) {
      break
    }
    selected.push(item)
    tokenCount += itemTokens
  }
  return selected
}

function ftsExpression(text: string): string {
  return tokenize(text)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(' ')
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .match(/[a-z0-9_]+|[\u4e00-\u9fff]+/g) ?? []
}
