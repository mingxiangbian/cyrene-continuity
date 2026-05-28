import { buildContinuitySnapshot } from '../affect/affect-runtime.js'
import type { PrincipledDissentPolicy } from '../affect/types.js'
import { createDefaultConfig } from '../config.js'
import {
  combineEvalGateResults,
  runMemoryRoutingEvalGate,
  runSimilarHintsEvalGate
} from '../eval/eval-runner.js'
import type {
  MemoryRoutingActiveItem,
  MemoryRoutingPendingItem,
  MemoryRoutingSimilarHintItem
} from '../eval/eval-runner.js'
import { readModelProfileFromRootIfExists } from '../memory/model-profile.js'
import type { IndexedActiveMemory, IndexedPendingMemory, IndexedSimilarMemory, MemoryIndexDiagnostics } from '../memory/memory-index.js'
import { deriveMemoryPortability, openMemoryIndexAdapter } from '../memory/memory-index.js'
import { selectSimilarProjects } from '../memory/project-similarity.js'
import {
  isMemoryEligibleForRetrieval,
  memoryRetrievalBudgetForTask,
  retrieveMemories
} from '../memory/memory-retriever.js'
import type { RetrievedMemory, RetrieveMemoriesInput } from '../memory/memory-retriever.js'
import { readActiveMemoriesFromRoot, readPendingMemoriesFromRoot } from '../memory/memory-store.js'
import type { CyreneMemory, PendingMemory } from '../memory/types.js'
import { estimateTokens } from '../token-counter.js'
import { codexMemoryDbPath, codexMemoryIndexRoots } from './codex-memory-index.js'
import type {
  CodexMemoryFallbackMode,
  CodexMemoryIndexFreshness,
  CodexMemoryIndexStatus
} from './codex-memory-index-status.js'
import { readCodexMemoryIndexStatus } from './codex-memory-index-status.js'
import {
  codexGlobalMemoryRoot,
  codexProjectMemoryRoot,
  getReadableCodexGlobalMemoryRoot,
  getReadableCodexProjectMemoryRoot,
  getReadableCodexProjectMemoryRoots
} from './codex-memory-root.js'
import { markCodexMemoryDreamDue, readCodexMemoryDreamState } from './memory-dream-state.js'
import { getCodexPendingReviewNotice } from './memory-review.js'
import { buildCodexProjectFingerprint } from './project-fingerprint.js'
import { identifyCodexProject } from './project-id.js'
import type { CodexPendingReviewNotice } from './memory-review.js'

type CodexContinuityTask = NonNullable<RetrieveMemoriesInput['task']>

interface RoutedMemoryDigestItem {
  id: string
  domain: string
  type: string
  strength: string
  scope: string
  portability: string
  status: 'active'
  content: string
  score: number
}

interface PendingHypothesisDigestItem {
  id: string
  domain: string
  type: string
  strength: string
  scope: string
  portability: string
  status: 'pending'
  content: string
  provisional: true
  score: number
}

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

type RetrievalSource = 'sqlite' | 'jsonl'
type RetrievalRoute = 'global' | 'project' | 'pending' | 'similar_project'

interface RetrievalDiagnostics extends MemoryIndexDiagnostics {
  source: RetrievalSource
  routes: RetrievalRoute[]
  fallbackMode: CodexMemoryFallbackMode
  freshness: CodexMemoryIndexFreshness
  lastSyncAt?: string
  sourceLatestAt?: string
  staleReason?: string
}

interface ReviewReminder {
  kind: 'pending_review'
  candidateId: string
  content: string
}

export interface CodexContinuityContext {
  project: {
    projectId: string
    displayName: string
  }
  memory: {
    items: Array<{
      id: string
      domain: string
      type: string
      strength: string
      content: string
    }>
  }
  globalMemory: RoutedMemoryDigestItem[]
  projectMemory: RoutedMemoryDigestItem[]
  pendingHypotheses: PendingHypothesisDigestItem[]
  similarProjectHints: SimilarProjectHintDigestItem[]
  responseStrategy: {
    tone: string
    verbosity: string
    challengePolicy: string
    avoid: string[]
    rationale: string
  }
  reviewReminders: ReviewReminder[]
  diagnostics?: {
    memoryIndex?: {
      available: boolean
      reason?: string
      ftsTokenizer?: string
      source: RetrievalSource
      routes: RetrievalRoute[]
      fallbackMode: CodexMemoryFallbackMode
      freshness: CodexMemoryIndexFreshness
      lastSyncAt?: string
      sourceLatestAt?: string
      staleReason?: string
    }
    projectSimilarity?: ProjectSimilarityDiagnostics
    evalGate?: EvalGateDiagnostics
    embedding?: NonNullable<MemoryIndexDiagnostics['embedding']>
  }
  profile: {
    global?: string
    project?: string
    content: string
  }
  pendingReview: CodexPendingReviewNotice
  strategy: {
    tone: string
    verbosity: string
    challenge: string
    boundaryMode: string
    safetyMode: string
    shouldChallengeUser: boolean
    shouldAskClarifyingQuestion: boolean
    rationale: string
  }
  dissent: Pick<PrincipledDissentPolicy, 'shouldChallenge' | 'mode' | 'reason'>
}

export async function getCodexContinuityContext(input: {
  cwd: string
  userMessage: string
  task?: CodexContinuityTask
}): Promise<CodexContinuityContext> {
  const project = await identifyCodexProject(input.cwd)
  const config = createDefaultConfig(input.cwd)
  const task = input.task ?? 'coding'
  const globalMemoryRoot = codexGlobalMemoryRoot()
  const projectMemoryRoot = codexProjectMemoryRoot(project.projectId)
  const budget = memoryRetrievalBudgetForTask(task)
  await markProjectDreamDueIfOverdue(project.projectId, config)
  const legacyRetrievalInput: RetrieveMemoriesInput = {
      cwd: input.cwd,
      userCyreneDir: config.userCyreneDir,
      memoryRoots: [globalMemoryRoot, projectMemoryRoot],
      extraMemories: await readLegacyGlobalCodexMemories(project.projectId),
      query: input.userMessage,
      task,
      maxItems: budget.maxItems,
      maxTokens: budget.maxTokens
  }
  const [pendingReview, globalProfile, projectProfile] = await Promise.all([
    getCodexPendingReviewNotice({ cwd: input.cwd }),
    readGlobalCodexProfileIfExists(),
    readProjectCodexProfileIfExists(project.projectId)
  ])
  const routedMemory = await retrieveRoutedMemory({
    cwd: input.cwd,
    projectId: project.projectId,
    query: input.userMessage,
    task,
    fallback: legacyRetrievalInput
  })
  const activeMemory = [...routedMemory.globalMemory, ...routedMemory.projectMemory]
  const profileContent = [globalProfile, projectProfile].filter(Boolean).join('\n\n')
  const snapshot = await buildContinuitySnapshot({
    config: {
      ...config,
      memoryCwd: input.cwd
    },
    userMessage: input.userMessage,
    task,
    memories: activeMemory.map((item) => item.memory),
    generatedAt: new Date().toISOString()
  })

  return {
    project: {
      projectId: project.projectId,
      displayName: project.displayName
    },
    memory: {
      items: activeMemory.map(({ memory }) => ({
        id: memory.id,
        domain: memory.domain,
        type: memory.type,
        strength: memory.strength,
        content: memory.content
      }))
    },
    globalMemory: routedMemory.globalMemory.map(toRoutedMemoryDigestItem),
    projectMemory: routedMemory.projectMemory.map(toRoutedMemoryDigestItem),
    pendingHypotheses: routedMemory.pendingHypotheses.map(toPendingHypothesisDigestItem),
    similarProjectHints: routedMemory.similarProjectHints.map(toSimilarProjectHintDigestItem),
    responseStrategy: {
      tone: snapshot.strategy.tone,
      verbosity: snapshot.strategy.verbosity,
      challengePolicy: snapshot.strategy.challenge,
      avoid: [
        'claimed sentience',
        'psychological diagnosis',
        'romantic attachment',
        'emotional manipulation'
      ],
      rationale: snapshot.strategy.rationale
    },
    reviewReminders: formatReviewReminders(pendingReview),
    diagnostics: {
      memoryIndex: {
        available: routedMemory.diagnostics.available,
        reason: routedMemory.diagnostics.reason,
        ftsTokenizer: routedMemory.diagnostics.ftsTokenizer,
        source: routedMemory.diagnostics.source,
        routes: routedMemory.diagnostics.routes,
        fallbackMode: routedMemory.diagnostics.fallbackMode,
        freshness: routedMemory.diagnostics.freshness,
        lastSyncAt: routedMemory.diagnostics.lastSyncAt,
        sourceLatestAt: routedMemory.diagnostics.sourceLatestAt,
        staleReason: routedMemory.diagnostics.staleReason
      },
      projectSimilarity: routedMemory.projectSimilarityDiagnostics,
      evalGate: routedMemory.evalGateDiagnostics,
      ...(routedMemory.diagnostics.embedding === undefined ? {} : { embedding: routedMemory.diagnostics.embedding })
    },
    profile: {
      global: globalProfile,
      project: projectProfile,
      content: profileContent
    },
    pendingReview,
    strategy: {
      tone: snapshot.strategy.tone,
      verbosity: snapshot.strategy.verbosity,
      challenge: snapshot.strategy.challenge,
      boundaryMode: snapshot.strategy.boundaryMode,
      safetyMode: snapshot.strategy.safetyMode,
      shouldChallengeUser: snapshot.strategy.shouldChallengeUser,
      shouldAskClarifyingQuestion: snapshot.strategy.shouldAskClarifyingQuestion,
      rationale: snapshot.strategy.rationale
    },
    dissent: {
      shouldChallenge: snapshot.dissent.shouldChallenge,
      mode: snapshot.dissent.mode,
      reason: snapshot.dissent.reason
    }
  }
}

interface RoutedMemoryResult {
  globalMemory: Array<IndexedActiveMemory | RetrievedMemory>
  projectMemory: Array<IndexedActiveMemory | RetrievedMemory>
  pendingHypotheses: IndexedPendingMemory[]
  similarProjectHints: IndexedSimilarMemory[]
  diagnostics: RetrievalDiagnostics
  projectSimilarityDiagnostics: ProjectSimilarityDiagnostics
  evalGateDiagnostics: EvalGateDiagnostics
}

async function retrieveRoutedMemory(input: {
  cwd: string
  projectId: string
  query: string
  task: CodexContinuityTask
  fallback: RetrieveMemoriesInput
}): Promise<RoutedMemoryResult> {
  const roots = await codexMemoryIndexRoots(input.projectId)
  const indexStatus = await readCodexMemoryIndexStatus(roots.map((root) => root.memoryRoot))
  if (!isQueryableIndexStatus(indexStatus)) {
    return fallbackRoutedMemory(input.fallback, jsonlRetrievalDiagnostics(indexStatus), input.projectId)
  }

  const adapter = await openMemoryIndexAdapter({ dbPath: codexMemoryDbPath() })
  try {
    const diagnostics = adapter.diagnostics()
    if (!diagnostics.available) {
      return fallbackRoutedMemory(
        input.fallback,
        jsonlRetrievalDiagnostics({
          ...indexStatus,
          available: false,
          reason: diagnostics.reason,
          fallbackMode: 'jsonl',
          freshness: 'unavailable'
        }, diagnostics),
        input.projectId
      )
    }
    const currentFingerprint = await buildCodexProjectFingerprint({
      cwd: input.cwd,
      project: await identifyCodexProject(input.cwd)
    })
    const metadata = await adapter.listProjectMetadata()
    const selectedSimilarities = selectSimilarProjects({
      source: currentFingerprint,
      candidates: metadata,
      minScore: 0.2,
      maxProjects: 5,
      now: new Date().toISOString()
    })
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
    const similarHintGate = runSimilarHintsEvalGate(similarProjectHints.map((item) => ({
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
    const [globalMemory, projectMemory, pendingHypotheses] = await Promise.all([
      adapter.queryActive({
        currentProjectId: input.projectId,
        query: input.query,
        route: 'global',
        task: input.task,
        maxItems: 8,
        maxTokens: 500
      }),
      adapter.queryActive({
        currentProjectId: input.projectId,
        query: input.query,
        route: 'project',
        task: input.task,
        maxItems: 12,
        maxTokens: 900
      }),
      adapter.queryPending({
        currentProjectId: input.projectId,
        query: input.query,
        maxItems: 6,
        maxTokens: 400
      })
    ])
    const memoryRoutingGate = runMemoryRoutingEvalGate({
      currentProjectId: input.projectId,
      globalMemory: globalMemory.map(toMemoryRoutingActiveItem),
      projectMemory: projectMemory.map(toMemoryRoutingActiveItem),
      pendingHypotheses: pendingHypotheses.map(toMemoryRoutingPendingItem),
      similarProjectHints: similarProjectHints.map(toMemoryRoutingSimilarHintItem)
    })
    const evalGate = combineEvalGateResults([similarHintGate, memoryRoutingGate])
    const safeSimilarProjectHints = evalGate.passed ? similarProjectHints : []
    return {
      globalMemory: globalMemory.filter(({ memory }) => isMemoryEligibleForRetrieval(memory, input.fallback, input.task)),
      projectMemory: projectMemory.filter(({ memory }) => isMemoryEligibleForRetrieval(memory, input.fallback, input.task)),
      pendingHypotheses,
      similarProjectHints: safeSimilarProjectHints,
      diagnostics: sqliteRetrievalDiagnostics(indexStatus, diagnostics),
      projectSimilarityDiagnostics: {
        indexedProjects: metadata.length,
        candidateProjects: metadata.filter((project) => project.projectId !== input.projectId).length,
        selectedProjects: selectedSimilarities.length,
        reason: projectSimilarityReason(metadata.length, selectedSimilarities.length)
      },
      evalGateDiagnostics: {
        passed: evalGate.passed,
        failedChecks: evalGate.failedChecks
      }
    }
  } catch (error) {
    return fallbackRoutedMemory(
      input.fallback,
      jsonlRetrievalDiagnostics({
        ...indexStatus,
        available: false,
        reason: error instanceof Error ? error.message : String(error),
        fallbackMode: 'jsonl',
        freshness: 'unavailable'
      }),
      input.projectId
    )
  } finally {
    adapter.close()
  }
}

function isQueryableIndexStatus(status: CodexMemoryIndexStatus): boolean {
  return status.available && (status.freshness === 'fresh' || (status.freshness === 'empty' && status.lastSyncAt !== undefined))
}

async function fallbackRoutedMemory(
  input: RetrieveMemoriesInput,
  diagnostics: RetrievalDiagnostics,
  projectId: string
): Promise<RoutedMemoryResult> {
  const memories = await retrieveMemories(input)
  return {
    globalMemory: memories.filter(({ memory }) => memory.scope === 'global'),
    projectMemory: memories.filter(({ memory }) => memory.scope !== 'global'),
    pendingHypotheses: await readFallbackPendingHypotheses(input, projectId),
    similarProjectHints: [],
    diagnostics,
    projectSimilarityDiagnostics: {
      indexedProjects: 0,
      candidateProjects: 0,
      selectedProjects: 0,
      reason: diagnostics.freshness === 'stale' ? 'memory_index_stale' : 'memory_index_unavailable'
    },
    evalGateDiagnostics: {
      passed: true,
      failedChecks: []
    }
  }
}

function sqliteRetrievalDiagnostics(
  status: CodexMemoryIndexStatus,
  diagnostics: MemoryIndexDiagnostics
): RetrievalDiagnostics {
  return retrievalDiagnosticsFromStatus(status, 'sqlite', ['global', 'project', 'pending', 'similar_project'], diagnostics)
}

function jsonlRetrievalDiagnostics(
  status: CodexMemoryIndexStatus,
  diagnostics: Partial<MemoryIndexDiagnostics> = {}
): RetrievalDiagnostics {
  return retrievalDiagnosticsFromStatus(status, 'jsonl', ['global', 'project', 'pending'], diagnostics)
}

function retrievalDiagnosticsFromStatus(
  status: CodexMemoryIndexStatus,
  source: RetrievalSource,
  routes: RetrievalRoute[],
  diagnostics: Partial<MemoryIndexDiagnostics>
): RetrievalDiagnostics {
  const ftsTokenizer = diagnostics.ftsTokenizer ?? status.ftsTokenizer
  const reason = diagnostics.reason ?? status.reason
  const embedding = diagnostics.embedding ?? { enabled: false, cacheHits: 0, cacheMisses: 0 }
  return {
    available: diagnostics.available ?? status.available,
    dbPath: diagnostics.dbPath ?? status.dbPath,
    ...(ftsTokenizer === undefined ? {} : { ftsTokenizer }),
    ...(reason === undefined ? {} : { reason }),
    embedding,
    source,
    routes,
    fallbackMode: status.fallbackMode,
    freshness: status.freshness,
    ...(status.lastSyncAt === undefined ? {} : { lastSyncAt: status.lastSyncAt }),
    ...(status.sourceLatestAt === undefined ? {} : { sourceLatestAt: status.sourceLatestAt }),
    ...(status.staleReason === undefined ? {} : { staleReason: status.staleReason })
  }
}

async function readFallbackPendingHypotheses(input: RetrieveMemoriesInput, projectId: string): Promise<IndexedPendingMemory[]> {
  const roots = input.memoryRoots ?? (input.memoryRoot === undefined ? undefined : [input.memoryRoot])
  if (roots === undefined) {
    return []
  }
  const pending = (await Promise.all(roots.map((root) => readPendingMemoriesFromRoot(root)))).flat()
  return selectPendingWithinBudget(
    pending
      .map((memory) => ({
        memory,
        score: scorePendingMemory(memory, input.query),
        portability: deriveMemoryPortability(memory),
        homeProjectId: memory.scope === 'global' ? null : projectId,
        provisional: true as const
      }))
      .filter((item) => input.query.trim() === '' || item.score > 0)
      .sort(comparePendingHypotheses),
    6,
    400
  )
}

function scorePendingMemory(memory: PendingMemory, query: string): number {
  const tokens = tokenize(query)
  if (tokens.length === 0) {
    return 0.2
  }
  const haystack = tokenize([
    memory.content,
    memory.normalizedKey,
    memory.domain,
    memory.type,
    memory.strength,
    ...memory.tags
  ].join(' '))
  const matches = tokens.filter((token) => haystack.some((candidate) => candidate.includes(token)))
  return matches.length / tokens.length
}

function comparePendingHypotheses(left: IndexedPendingMemory, right: IndexedPendingMemory): number {
  const scoreDiff = right.score - left.score
  if (scoreDiff !== 0) {
    return scoreDiff
  }
  return left.memory.id.localeCompare(right.memory.id)
}

function toMemoryRoutingActiveItem(item: IndexedActiveMemory): MemoryRoutingActiveItem {
  return {
    id: item.memory.id,
    status: item.memory.status,
    scope: item.memory.scope,
    homeProjectId: item.homeProjectId
  }
}

function toMemoryRoutingPendingItem(item: IndexedPendingMemory): MemoryRoutingPendingItem {
  return {
    id: item.memory.id,
    status: item.memory.status,
    provisional: item.provisional
  }
}

function toMemoryRoutingSimilarHintItem(item: IndexedSimilarMemory): MemoryRoutingSimilarHintItem {
  return {
    id: item.memory.id,
    status: item.memory.status,
    domain: item.memory.domain,
    homeProjectId: item.homeProjectId,
    notCurrentProjectFact: true
  }
}

function selectPendingWithinBudget(items: IndexedPendingMemory[], maxItems: number, maxTokens: number): IndexedPendingMemory[] {
  const selected: IndexedPendingMemory[] = []
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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function toRoutedMemoryDigestItem(item: IndexedActiveMemory | RetrievedMemory): RoutedMemoryDigestItem {
  return {
    id: item.memory.id,
    domain: item.memory.domain,
    type: item.memory.type,
    strength: item.memory.strength,
    scope: item.memory.scope,
    portability: 'portability' in item ? item.portability : item.memory.scope === 'global' ? 'global' : 'local_only',
    status: item.memory.status,
    content: item.memory.content,
    score: item.score
  }
}

function toPendingHypothesisDigestItem(item: IndexedPendingMemory): PendingHypothesisDigestItem {
  return {
    id: item.memory.id,
    domain: item.memory.domain,
    type: item.memory.type,
    strength: item.memory.strength,
    scope: item.memory.scope,
    portability: item.portability,
    status: item.memory.status,
    content: item.memory.content,
    provisional: true,
    score: item.score
  }
}

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

function formatReviewReminders(pendingReview: CodexPendingReviewNotice): ReviewReminder[] {
  if (pendingReview.newestCandidateId === undefined || pendingReview.newestPreview === undefined) {
    return []
  }
  return [{
    kind: 'pending_review',
    candidateId: pendingReview.newestCandidateId,
    content: pendingReview.newestPreview
  }]
}

async function markProjectDreamDueIfOverdue(projectId: string, config: ReturnType<typeof createDefaultConfig>): Promise<void> {
  if (!config.memoryDreamCatchUpEnabled) {
    return
  }
  const root = await getReadableCodexProjectMemoryRoot(projectId)
  if (root === null) {
    return
  }

  try {
    const state = await readCodexMemoryDreamState(root)
    const now = new Date().toISOString()
    if (state.dreamDue !== true && state.nextDreamDueAt !== undefined && state.nextDreamDueAt <= now) {
      await markCodexMemoryDreamDue(root, now)
    }
  } catch {
    // Continuity reads must not fail just because dream scheduling metadata is unavailable.
  }
}

async function readGlobalCodexProfileIfExists(): Promise<string | undefined> {
  const root = await getReadableCodexGlobalMemoryRoot()
  if (root === null) {
    return undefined
  }
  return readModelProfileFromRootIfExists(root)
}

async function readProjectCodexProfileIfExists(projectId: string): Promise<string | undefined> {
  const root = await getReadableCodexProjectMemoryRoot(projectId)
  if (root === null) {
    return undefined
  }
  return readModelProfileFromRootIfExists(root)
}

async function readLegacyGlobalCodexMemories(currentProjectId: string): Promise<CyreneMemory[]> {
  const currentProjectMemoryRoot = codexProjectMemoryRoot(currentProjectId)
  let roots: string[]
  try {
    roots = await getReadableCodexProjectMemoryRoots()
  } catch {
    roots = []
  }
  const legacy = await Promise.all(
    roots
      .filter((root) => root !== currentProjectMemoryRoot)
      .map(async (root) => (await readActiveMemoriesFromRoot(root)).filter((memory) => memory.scope === 'global'))
  )
  return legacy.flat()
}

function projectSimilarityReason(indexedProjects: number, selectedProjects: number): string | undefined {
  if (indexedProjects <= 1) {
    return 'no_similar_projects_indexed'
  }
  if (selectedProjects === 0) {
    return 'no_similar_projects_selected'
  }
  return undefined
}
