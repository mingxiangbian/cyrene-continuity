import { createHash } from 'node:crypto'
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
  readMemoryEdgesFromRoot,
  readPendingMemoriesFromRoot
} from './memory-store.js'
import { activeMemoryToSemanticMemory } from './semantic-memory-adapter.js'
import { tokenizeMemoryText } from './tokenizer.js'
import type { CyreneMemory, MemoryEdge as DurableMemoryEdge, MemoryPortability, PendingMemory, SemanticMemory } from './types.js'

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

export interface MemoryEdge {
  id: string
  fromId: string
  fromKind: string
  toId: string
  toKind: string
  edgeType: string
  weight: number
  source: 'deterministic' | 'model'
  status: 'approved' | 'pending' | 'rejected'
  evidenceId?: string
  createdAt: string
  approvedAt?: string
}

export interface MemoryEdgeQuery {
  fromId?: string
  toId?: string
  status?: MemoryEdge['status']
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

export interface MemoryIndexCandidateHintQuery {
  currentProjectId: string
  query: string
  maxItems: number
  maxConflictItems?: number
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

export interface IndexedCandidateHintMemory {
  memory: SemanticMemory
  score: number
  homeProjectId: string | null
}

export interface IndexedCandidateHintPool {
  candidates: IndexedCandidateHintMemory[]
  validatedMemories: IndexedCandidateHintMemory[]
}

export interface MemoryIndexAdapter {
  initialize(): Promise<MemoryIndexDiagnostics>
  rebuildFromRoots(input: MemoryIndexRebuildInput): Promise<MemoryIndexDiagnostics>
  syncRoot(root: MemoryIndexRoot): Promise<MemoryIndexDiagnostics>
  upsertProjectMetadata(metadata: ProjectMetadata): Promise<MemoryIndexDiagnostics>
  listProjectMetadata(): Promise<ProjectMetadata[]>
  upsertProjectSimilarity(similarity: ProjectSimilarity): Promise<MemoryIndexDiagnostics>
  listProjectSimilarities(sourceProjectId: string): Promise<ProjectSimilarity[]>
  upsertMemoryEdge(edge: MemoryEdge): Promise<MemoryIndexDiagnostics>
  queryMemoryEdges(input: MemoryEdgeQuery): Promise<MemoryEdge[]>
  queryActive(input: MemoryIndexActiveQuery): Promise<IndexedActiveMemory[]>
  queryPending(input: MemoryIndexPendingQuery): Promise<IndexedPendingMemory[]>
  querySimilarActive(input: MemoryIndexSimilarQuery): Promise<IndexedSimilarMemory[]>
  queryCandidateHints(input: MemoryIndexCandidateHintQuery): Promise<IndexedCandidateHintPool>
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
  updatedAt: string
  expiresAt?: string
  scores: {
    evidenceStrength?: number
    safety?: number
    sensitivity?: number
    usefulness?: number
  }
  payload: CyreneMemory | PendingMemory
}

const QUERY_ACTIVE_SCORE = {
  relevanceExact: 100,
  relevanceToken: 20,
  scopeProject: 30,
  scopeGlobal: 20,
  strengthHard: 20,
  strengthMedium: 12,
  strengthSoft: 5,
  confidenceCore: 15,
  confidenceValidated: 10,
  confidenceTrial: -100,
  recencyFresh: 5,
  conflictPenalty: 80,
  stalePenalty: 20
} as const

const RAW_MEMORY_ID_FALLBACK_LIMIT = 50
const RECENCY_FRESH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

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

export function deriveDeterministicMemoryEdges(memory: CyreneMemory | PendingMemory, now: string): MemoryEdge[] {
  const refs = new Set(memory.evidence.flatMap((entry) => entry.traceRefs ?? []))
  return Array.from(refs)
    .filter(isSafeFileTraceRef)
    .map((ref) => ({
      id: `edge-${memory.id}-${hashText(ref, 12)}`,
      fromId: memory.id,
      fromKind: 'memory',
      toId: ref,
      toKind: 'file',
      edgeType: 'memory_mentions_file',
      weight: 1,
      source: 'deterministic',
      status: 'approved',
      createdAt: now
    }))
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

  async upsertMemoryEdge(_edge: MemoryEdge): Promise<MemoryIndexDiagnostics> {
    return this.diagnostics()
  }

  async queryMemoryEdges(_input: MemoryEdgeQuery): Promise<MemoryEdge[]> {
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

  async queryCandidateHints(_input: MemoryIndexCandidateHintQuery): Promise<IndexedCandidateHintPool> {
    return { candidates: [], validatedMemories: [] }
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

      create table if not exists memory_edges (
        id text primary key,
        from_id text not null,
        from_kind text not null,
        to_id text not null,
        to_kind text not null,
        edge_type text not null,
        weight real not null,
        source text not null,
        status text not null,
        evidence_id text,
        created_at text not null,
        approved_at text
      );

      create index if not exists idx_memories_candidate_hints
      on memories(status, scope, home_project_id, portability, domain, updated_at);

      create index if not exists idx_memories_normalized_key
      on memories(status, normalized_key, scope, home_project_id);

      create index if not exists idx_memory_edges_from_status
      on memory_edges(from_id, status);

      create index if not exists idx_memory_edges_to_status
      on memory_edges(to_id, status);

      create index if not exists idx_memory_edges_type_status
      on memory_edges(edge_type, status);
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
    db.exec('delete from memory_edges; delete from memory_evidence; delete from memories;')
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
    db.prepare('delete from memory_edges where from_id in (select id from memories where memory_root = ?)').run(root.memoryRoot)
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

    const [active, pending, durableEdges] = await Promise.all([
      readActiveMemoriesFromRoot(root.memoryRoot),
      readPendingMemoriesFromRoot(root.memoryRoot),
      readMemoryEdgesFromRoot(root.memoryRoot)
    ])
    const indexedAt = new Date().toISOString()
    const indexedMemoryIds = new Set<string>()
    for (const memory of active) {
      const indexId = this.insertMemory(root, memory)
      indexedMemoryIds.add(indexId)
      for (const edge of deriveIndexedDeterministicMemoryEdges(indexId, memory, indexedAt)) {
        this.upsertMemoryEdgeRecord(edge)
      }
    }
    for (const memory of pending) {
      const indexId = this.insertMemory(root, memory)
      indexedMemoryIds.add(indexId)
      for (const edge of deriveIndexedDeterministicMemoryEdges(indexId, memory, indexedAt)) {
        this.upsertMemoryEdgeRecord(edge)
      }
    }
    for (const edge of deriveIndexedDurableMemoryEdges(root, durableEdges, indexedMemoryIds)) {
      this.upsertMemoryEdgeRecord(edge)
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

  async upsertMemoryEdge(edge: MemoryEdge): Promise<MemoryIndexDiagnostics> {
    const diagnostics = await this.initialize()
    this.upsertMemoryEdgeRecord(edge)
    return diagnostics
  }

  async queryMemoryEdges(input: MemoryEdgeQuery): Promise<MemoryEdge[]> {
    await this.initialize()
    const directEdges = this.queryMemoryEdgesByIndexedIds(input)
    if (directEdges.length > 0 || input.fromId === undefined || isIndexedMemoryId(input.fromId)) {
      return directEdges
    }
    const indexedFromIds = this.resolveIndexedMemoryIdsFromPublicId(input.fromId)
    if (indexedFromIds.length === 0) {
      return []
    }
    return this.queryMemoryEdgesByIndexedIds({ ...input, fromId: undefined }, indexedFromIds)
  }

  private queryMemoryEdgesByIndexedIds(input: MemoryEdgeQuery, indexedFromIds?: string[]): MemoryEdge[] {
    const conditions: string[] = []
    const values: unknown[] = []
    if (indexedFromIds !== undefined) {
      conditions.push(`from_id in (${indexedFromIds.map(() => '?').join(', ')})`)
      values.push(...indexedFromIds)
    } else if (input.fromId !== undefined) {
      conditions.push('from_id = ?')
      values.push(input.fromId)
    }
    if (input.toId !== undefined) {
      conditions.push('to_id = ?')
      values.push(input.toId)
    }
    if (input.status !== undefined) {
      conditions.push('status = ?')
      values.push(input.status)
    }
    const where = conditions.length === 0 ? '' : `where ${conditions.join(' and ')}`
    return this.requireDatabase().prepare(`
      select
        id,
        from_id,
        from_kind,
        to_id,
        to_kind,
        edge_type,
        weight,
        source,
        status,
        evidence_id,
        created_at,
        approved_at
      from memory_edges
      ${where}
      order by created_at asc, id asc
    `).all(...values)
      .map(memoryEdgeFromRecord)
  }

  private resolveIndexedMemoryIdsFromPublicId(publicId: string): string[] {
    try {
      return this.requireDatabase().prepare(`
        select id
        from memories
        where json_extract(payload_json, '$.id') = ?
        order by updated_at desc, id asc
        limit ?
      `).all(publicId, RAW_MEMORY_ID_FALLBACK_LIMIT)
        .map((row) => typeof row.id === 'string' ? row.id : '')
        .filter(Boolean)
    } catch {
      return []
    }
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

  async queryCandidateHints(input: MemoryIndexCandidateHintQuery): Promise<IndexedCandidateHintPool> {
    await this.initialize()
    const maxItems = Math.max(0, Math.floor(input.maxItems))
    if (maxItems === 0) {
      return { candidates: [], validatedMemories: [] }
    }
    const ftsMatches = this.queryFtsIds(input.query, 'active')
    const candidateRows = this.queryCandidateHintRows(input, ftsMatches, maxItems)
    const candidates = candidateRows.map((row) => indexedCandidateHintFromRow(row, input.query, ftsMatches))
    const conflictKeys = new Set(candidates
      .map((item) => item.memory.reviewState?.normalizedKey)
      .filter((key): key is string => typeof key === 'string' && key.trim() !== '')
    )
    const validatedRows = this.queryCandidateHintConflictRows(
      input.currentProjectId,
      conflictKeys,
      input.maxConflictItems ?? 200
    )
    return {
      candidates,
      validatedMemories: validatedRows.map((row) => indexedCandidateHintFromRow(row, input.query, ftsMatches))
    }
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

  private insertMemory(root: MemoryIndexRoot, memory: CyreneMemory | PendingMemory): string {
    const db = this.requireDatabase()
    const indexId = memoryIndexId(root, memory.id)
    const portability = deriveMemoryPortability(memory)
    const homeProjectId = root.scope === 'global' ? null : root.projectId
    const tags = memoryIndexTagsText(memory)
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
    return indexId
  }

  private upsertMemoryEdgeRecord(edge: MemoryEdge): void {
    this.requireDatabase().prepare(`
      insert into memory_edges (
        id,
        from_id,
        from_kind,
        to_id,
        to_kind,
        edge_type,
        weight,
        source,
        status,
        evidence_id,
        created_at,
        approved_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        from_id = excluded.from_id,
        from_kind = excluded.from_kind,
        to_id = excluded.to_id,
        to_kind = excluded.to_kind,
        edge_type = excluded.edge_type,
        weight = excluded.weight,
        source = excluded.source,
        status = excluded.status,
        evidence_id = excluded.evidence_id,
        approved_at = excluded.approved_at
    `).run(
      edge.id,
      edge.fromId,
      edge.fromKind,
      edge.toId,
      edge.toKind,
      edge.edgeType,
      edge.weight,
      edge.source,
      edge.status,
      edge.evidenceId ?? null,
      edge.createdAt,
      edge.approvedAt ?? null
    )
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
        updated_at,
        expires_at,
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
        updated_at,
        expires_at,
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

  private queryCandidateHintRows(
    input: MemoryIndexCandidateHintQuery,
    ftsMatches: Set<string>,
    maxItems: number
  ): MemoryIndexRow[] {
    const matchedIds = Array.from(ftsMatches).slice(0, maxItems * 4)
    const ftsRows = matchedIds.length === 0
      ? []
      : this.queryCandidateHintRowsWithExtraConditions(
        input.currentProjectId,
        [`id in (${matchedIds.map(() => '?').join(', ')})`],
        matchedIds,
        maxItems
      )
    const remaining = maxItems - ftsRows.length
    if (remaining <= 0) {
      return ftsRows
    }
    const excludeIds = ftsRows.map((row) => row.id)
    const recentRows = this.queryCandidateHintRowsWithExtraConditions(
      input.currentProjectId,
      excludeIds.length === 0 ? [] : [`id not in (${excludeIds.map(() => '?').join(', ')})`],
      excludeIds,
      remaining
    )
    return [...ftsRows, ...recentRows]
  }

  private queryCandidateHintRowsWithExtraConditions(
    currentProjectId: string,
    extraConditions: string[],
    extraValues: unknown[],
    limit: number
  ): MemoryIndexRow[] {
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
        updated_at,
        expires_at,
        payload_json
      from memories
      where status = 'active'
        and scope = 'project'
        and home_project_id = ?
        and portability = 'local_only'
        and domain in ('project', 'procedural', 'system')
        and payload_json like '%"confidenceTier":"trial"%'
        and payload_json like '%workflow_hint%'
        ${extraConditions.length === 0 ? '' : `and ${extraConditions.join(' and ')}`}
      order by updated_at desc, created_at desc, id asc
      limit ?
    `).all(currentProjectId, ...extraValues, limit)
    return rows.map(rowFromRecord)
  }

  private queryCandidateHintConflictRows(
    currentProjectId: string,
    normalizedKeys: Set<string>,
    maxItems: number
  ): MemoryIndexRow[] {
    const keys = Array.from(normalizedKeys)
    const limit = Math.max(0, Math.floor(maxItems))
    if (keys.length === 0 || limit === 0) {
      return []
    }
    const placeholders = keys.map(() => '?').join(', ')
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
        updated_at,
        expires_at,
        payload_json
      from memories
      where status = 'active'
        and normalized_key in (${placeholders})
        and (
          (scope = 'project' and home_project_id = ? and portability = 'local_only') or
          (scope = 'global' and portability = 'global')
        )
        and (
          payload_json like '%"confidenceTier":"validated"%' or
          payload_json like '%"confidenceTier":"project_core"%' or
          payload_json like '%"confidenceTier":"global_core"%'
        )
      order by updated_at desc, created_at desc, id asc
      limit ?
    `).all(...keys, currentProjectId, limit)
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

function deriveIndexedDeterministicMemoryEdges(
  indexId: string,
  memory: CyreneMemory | PendingMemory,
  now: string
): MemoryEdge[] {
  return deriveDeterministicMemoryEdges(memory, now).map((edge) => ({
    ...edge,
    id: `edge-${hashText(`${indexId}\0${edge.toId}`, 24)}`,
    fromId: indexId,
    status: memory.status === 'active' ? 'approved' : 'pending'
  }))
}

function deriveIndexedDurableMemoryEdges(
  root: MemoryIndexRoot,
  edges: DurableMemoryEdge[],
  indexedMemoryIds: Set<string>
): MemoryEdge[] {
  return edges.flatMap((edge) => {
    if (!durableEdgeBelongsToRoot(root, edge)) {
      return []
    }
    const fromId = memoryIndexId(root, edge.fromMemoryId)
    const toId = memoryIndexId(root, edge.toMemoryId)
    if (!indexedMemoryIds.has(fromId) || !indexedMemoryIds.has(toId)) {
      return []
    }
    return [{
      id: edge.id,
      fromId,
      fromKind: 'memory',
      toId,
      toKind: 'memory',
      edgeType: `relation:${edge.relationType}`,
      weight: edge.confidence,
      source: edge.origin === 'model' ? 'model' : 'deterministic',
      status: indexedDurableEdgeStatus(edge.status),
      ...(edge.evidenceId !== undefined ? { evidenceId: edge.evidenceId } : {}),
      createdAt: edge.createdAt,
      ...(edge.status === 'validated' ? { approvedAt: edge.updatedAt } : {})
    }]
  })
}

function durableEdgeBelongsToRoot(root: MemoryIndexRoot, edge: DurableMemoryEdge): boolean {
  if (edge.fromScope !== root.scope || edge.toScope !== root.scope) {
    return false
  }
  if (root.scope === 'project') {
    return edge.fromProjectId === root.projectId && edge.toProjectId === root.projectId
  }
  return edge.fromProjectId === undefined && edge.toProjectId === undefined
}

function indexedDurableEdgeStatus(status: DurableMemoryEdge['status']): MemoryEdge['status'] {
  switch (status) {
    case 'validated':
      return 'approved'
    case 'trial':
      return 'pending'
    case 'expired':
    case 'rejected':
    case 'superseded':
      return 'rejected'
  }
}

function indexedMemoryIdPayload(fromId: string): string | undefined {
  try {
    const value = JSON.parse(fromId) as unknown
    if (!Array.isArray(value) || typeof value[2] !== 'string') {
      return undefined
    }
    return value[2]
  } catch {
    return undefined
  }
}

function isIndexedMemoryId(value: string): boolean {
  return indexedMemoryIdPayload(value) !== undefined
}

function memoryEdgeFromRecord(row: Record<string, unknown>): MemoryEdge {
  return {
    id: readString(row.id, 'id'),
    fromId: readString(row.from_id, 'from_id'),
    fromKind: readString(row.from_kind, 'from_kind'),
    toId: readString(row.to_id, 'to_id'),
    toKind: readString(row.to_kind, 'to_kind'),
    edgeType: readString(row.edge_type, 'edge_type'),
    weight: Number(row.weight),
    source: readString(row.source, 'source') as MemoryEdge['source'],
    status: readString(row.status, 'status') as MemoryEdge['status'],
    evidenceId: row.evidence_id === null ? undefined : readString(row.evidence_id, 'evidence_id'),
    createdAt: readString(row.created_at, 'created_at'),
    approvedAt: row.approved_at === null ? undefined : readString(row.approved_at, 'approved_at')
  }
}

function isSafeFileTraceRef(ref: string): boolean {
  return /^[\w./-]+\.[\w]+$/.test(ref) && !ref.includes('..')
}

function hashText(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
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
    updatedAt: readString(row.updated_at, 'updated_at'),
    expiresAt: row.expires_at === null ? undefined : readString(row.expires_at, 'expires_at'),
    scores: JSON.parse(readString(row.scores_json, 'scores_json')) as MemoryIndexRow['scores'],
    payload
  }
}

function indexedCandidateHintFromRow(
  row: MemoryIndexRow,
  query: string,
  ftsMatches: Set<string>
): IndexedCandidateHintMemory {
  return {
    memory: activeMemoryToSemanticMemory(row.payload as CyreneMemory),
    score: scoreRow(row, query, ftsMatches),
    homeProjectId: row.homeProjectId
  }
}

function memoryIndexTagsText(memory: CyreneMemory | PendingMemory): string {
  return [
    ...memory.tags,
    ...(memory.useWhen ?? []),
    ...(memory.doNotUseWhen ?? [])
  ].join(' ')
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Memory index row field is not a string: ${field}`)
  }
  return value
}

function scoreRow(row: MemoryIndexRow, query: string, ftsMatches: Set<string>): number {
  const tokens = tokenizeMemoryText(query)
  const relevance = relevanceScore(row, tokens, query)
  const confidenceTier = (row.payload as { confidenceTier?: string }).confidenceTier
  let score = relevance
  score += row.scope === 'global' ? QUERY_ACTIVE_SCORE.scopeGlobal : QUERY_ACTIVE_SCORE.scopeProject
  score += strengthScore(row.strength)
  score += confidenceScore(confidenceTier)
  score += ftsMatches.has(row.id) ? QUERY_ACTIVE_SCORE.relevanceToken : 0
  score += isRecentlyUpdated(row.updatedAt) ? QUERY_ACTIVE_SCORE.recencyFresh : 0
  score -= isStale(row.expiresAt) ? QUERY_ACTIVE_SCORE.stalePenalty : 0
  score -= hasConflictInstruction(row, tokens) ? QUERY_ACTIVE_SCORE.conflictPenalty : 0
  return score
}

function relevanceScore(row: MemoryIndexRow, queryTokens: string[], query: string): number {
  if (queryTokens.length === 0) return QUERY_ACTIVE_SCORE.relevanceToken
  const text = searchableRowText(row)
  const normalizedQuery = query.trim().toLowerCase()
  const exact = normalizedQuery !== '' && text.includes(normalizedQuery)
    ? QUERY_ACTIVE_SCORE.relevanceExact
    : 0
  const matches = matchedTokenCount(text, queryTokens)
  return exact + Math.min(matches, 8) * QUERY_ACTIVE_SCORE.relevanceToken
}

function searchableRowText(row: MemoryIndexRow): string {
  return [
    row.content,
    row.normalizedKey,
    row.domain,
    row.type,
    row.strength,
    row.portability,
    ...row.tags
  ].join(' ').toLowerCase()
}

function matchedTokenCount(text: string, queryTokens: string[]): number {
  const haystack = tokenizeMemoryText([
    text
  ].join(' '))
  return queryTokens.filter((token) => haystack.some((candidate) => candidate.includes(token))).length
}

function strengthScore(strength: string): number {
  if (strength === 'hard') return QUERY_ACTIVE_SCORE.strengthHard
  if (strength === 'soft') return QUERY_ACTIVE_SCORE.strengthSoft
  return QUERY_ACTIVE_SCORE.strengthMedium
}

function confidenceScore(confidenceTier: string | undefined): number {
  switch (confidenceTier) {
    case 'global_core':
    case 'project_core':
      return QUERY_ACTIVE_SCORE.confidenceCore
    case 'validated':
      return QUERY_ACTIVE_SCORE.confidenceValidated
    case 'trial':
      return QUERY_ACTIVE_SCORE.confidenceTrial
    default:
      return 0
  }
}

function hasConflictInstruction(row: MemoryIndexRow, queryTokens: string[]): boolean {
  if (queryTokens.length === 0) return false
  const text = searchableRowText(row)
  const hasNegation = /\b(do not|don't|never|avoid|skip|must not|without)\b/.test(text)
  if (!hasNegation) return false
  return matchedTokenCount(text, queryTokens) >= Math.min(3, queryTokens.length)
}

function isRecentlyUpdated(updatedAt: string): boolean {
  const timestamp = Date.parse(updatedAt)
  if (!Number.isFinite(timestamp)) return false
  return Date.now() - timestamp <= RECENCY_FRESH_WINDOW_MS
}

function isStale(expiresAt: string | undefined): boolean {
  if (expiresAt === undefined) return false
  const timestamp = Date.parse(expiresAt)
  if (!Number.isFinite(timestamp)) return false
  return timestamp <= Date.now()
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
  return basicFtsTokens(text)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(' ')
}

function basicFtsTokens(text: string): string[] {
  return text
    .toLowerCase()
    .match(/[a-z0-9_]+|[\u4e00-\u9fff]+/g) ?? []
}
