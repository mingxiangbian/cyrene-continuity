import { buildContinuitySnapshot } from '../affect/affect-runtime.js'
import type { PrincipledDissentPolicy } from '../affect/types.js'
import { createDefaultConfig } from '../config.js'
import {
  combineEvalGateResults,
  runMemoryRoutingEvalGate,
  runSimilarHintsEvalGate
} from '../eval/eval-runner.js'
import type {
  EvalGateResult,
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
import { readActiveMemoriesFromRoot, readPendingMemoriesFromRoot, readSemanticMemoriesFromRoot } from '../memory/memory-store.js'
import type { CyreneMemory, PendingMemory, SemanticMemory } from '../memory/types.js'
import { estimateTokens } from '../token-counter.js'
import { codexMemoryDbPath, codexMemoryIndexRoots } from './codex-memory-index.js'
import {
  buildRetrievalPlan,
  explainRetrievalReasons,
  memoryKindForRetrieval,
  type RetrievalFacet,
  type RetrievalPlan
} from './retrieval-planner.js'
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
import { getCodexPendingReviewNotice } from './memory-review.js'
import { buildCodexProjectFingerprint } from './project-fingerprint.js'
import { identifyCodexProject } from './project-id.js'
import { appendActivationEventsFailOpen } from './memory-feedback.js'
import type { CodexPendingReviewNotice } from './memory-review.js'
import { buildMemoryActivations, type MemoryActivation } from './memory-activation.js'
import {
  buildRetrievalPolicy,
  type ContextMode,
  type RetrievalPolicy
} from './context-policy.js'
import { readFastSummaryProjection, type FastSummaryProjection } from './fast-summary-store.js'
import { appendRuntimeMetric, type RuntimeMetricEvent } from './runtime-metrics.js'
import { readCodexSessionHints, type CodexSessionHint } from './session-hints.js'

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
  explain: string[]
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
  explain: string[]
}

interface SessionHintDigestItem {
  id: string
  sourceProjectId: string
  sourceProjectName?: string
  content: string
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

interface SimilarRetrievalResult {
  similarProjectHints: IndexedSimilarMemory[]
  similarHintGate: EvalGateResult
  projectSimilarityDiagnostics: ProjectSimilarityDiagnostics
}

type MemoryIndexAdapter = Awaited<ReturnType<typeof openMemoryIndexAdapter>>
type RetrievalSource = 'sqlite' | 'jsonl'
type RetrievalRoute = 'global' | 'project' | 'pending' | 'similar_project'
type RetrievalExcludedReason = 'pending_review_required' | 'domain_excluded' | 'tombstoned' | 'below_score_threshold'

export interface RetrievalExcludedMemory {
  id: string
  scope: string
  content: string
  reason: RetrievalExcludedReason
  score?: number
}

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

interface RoutedMemoryRuntimeMetrics {
  pendingLatencyMs: number
  similarLatencyMs: number
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
  sessionHints: SessionHintDigestItem[]
  activation: {
    workflowHints: MemoryActivation[]
    planConstraints: MemoryActivation[]
    checklistItems: MemoryActivation[]
  }
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
    retrievalPlan?: {
      taskIntent: string[]
      memoryKinds: string[]
      requiredFacets: RetrievalFacet[]
      optionalFacets: RetrievalFacet[]
    }
    retrievalExcluded?: RetrievalExcludedMemory[]
    contextPolicy?: {
      mode: ContextMode
      maxTokens: number
    }
  }
  profile: {
    global?: string
    project?: string
    content: string
  }
  pendingReview: Partial<CodexPendingReviewNotice>
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
  recordActivationEvents?: boolean
  recordRetrievedEvents?: boolean
  mode?: ContextMode
  includeSimilarProjectHints?: boolean
  includePendingDetails?: boolean
  includePendingNotice?: boolean
  includeDiagnostics?: boolean
  includeSessionHints?: boolean
  includeFullProfile?: boolean
  includeFastSummaries?: boolean
  sessionId?: string
  allowJsonlFallback?: boolean
  maxTokens?: number
}): Promise<CodexContinuityContext> {
  const startedAt = Date.now()
  const project = await identifyCodexProject(input.cwd)
  const config = createDefaultConfig(input.cwd)
  const task = input.task ?? 'coding'
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
    allowJsonlFallback: input.allowJsonlFallback,
    recordRetrievedEvents: input.recordRetrievedEvents ?? input.recordActivationEvents
  })
  const globalMemoryRoot = codexGlobalMemoryRoot()
  const projectMemoryRoot = codexProjectMemoryRoot(project.projectId)
  const budget = memoryRetrievalBudgetForTask(task)
  const retrievalPlan = buildRetrievalPlan({ query: input.userMessage, task })
  const legacyRetrievalInput: RetrieveMemoriesInput = {
      cwd: input.cwd,
      userCyreneDir: config.userCyreneDir,
      memoryRoots: [globalMemoryRoot, projectMemoryRoot],
      extraMemories: policy.mode === 'fast' ? [] : await readLegacyGlobalCodexMemories(project.projectId),
      query: input.userMessage,
      task,
      maxItems: budget.maxItems,
      maxTokens: Math.min(budget.maxTokens, policy.maxTokens)
  }
  let profileReadLatencyMs = 0
  const [pendingReview, [fastSummary, globalProfile, projectProfile], sessionHints] = await Promise.all([
    policy.includePendingNotice ? getCodexPendingReviewNotice({ cwd: input.cwd }) : Promise.resolve({}),
    measureAsync(async () => Promise.all([
      policy.includeFastSummaries ? readFastSummaryProjection(globalMemoryRoot) : Promise.resolve(emptyFastSummaryProjection()),
      policy.includeFullProfile ? readGlobalCodexProfileIfExists() : Promise.resolve(undefined),
      policy.includeFullProfile ? readProjectCodexProfileIfExists(project.projectId) : Promise.resolve(undefined)
    ]), (latencyMs) => {
      profileReadLatencyMs = latencyMs
    }),
    policy.includeSessionHints && input.sessionId !== undefined
      ? readCodexSessionHints(projectMemoryRoot, { sessionId: input.sessionId, projectId: project.projectId })
      : Promise.resolve([])
  ])
  const routedMemoryStart = Date.now()
  const routedMemory = await retrieveRoutedMemory({
    cwd: input.cwd,
    projectId: project.projectId,
    query: input.userMessage,
    task,
    retrievalPlan,
    fallback: legacyRetrievalInput,
    policy
  })
  const routedMemoryLatencyMs = elapsedSince(routedMemoryStart)
  const modelVisibleGlobalMemory = routedMemory.globalMemory.filter(isModelVisibleRoutedMemory)
  const modelVisibleProjectMemory = routedMemory.projectMemory.filter(isModelVisibleRoutedMemory)
  const canonicalGlobalMemorySignatures = modelVisibleGlobalMemory.some((item) => !('homeProjectId' in item))
    ? await readCanonicalGlobalMemorySignaturesFailOpen(globalMemoryRoot)
    : new Set<string>()
  const [projectActivationMemories, globalActivationMemories] = await Promise.all([
    runtimeActivationMemoriesForRoute(projectMemoryRoot, modelVisibleProjectMemory),
    runtimeActivationMemoriesForRoute(globalMemoryRoot, modelVisibleGlobalMemory)
  ])
  const activation = buildMemoryActivations({
    query: input.userMessage,
    globalMemories: globalActivationMemories,
    projectMemories: projectActivationMemories
  })
  if (policy.recordRetrievedEvents) {
    await Promise.all([
      appendActivationEventsFailOpen({
        memoryRoot: globalMemoryRoot,
        memoryIds: canonicalGlobalActivationMemoryIds(modelVisibleGlobalMemory, canonicalGlobalMemorySignatures),
        projectId: project.projectId,
        query: input.userMessage,
        event: 'retrieved'
      }),
      appendActivationEventsFailOpen({
        memoryRoot: projectMemoryRoot,
        memoryIds: modelVisibleProjectMemory.map((item) => item.memory.id),
        projectId: project.projectId,
        query: input.userMessage,
        event: 'retrieved'
      })
    ])
  }
  const activeMemory = [...modelVisibleGlobalMemory, ...modelVisibleProjectMemory]
  const retrievalExcluded = policy.includePendingDetails
    ? routedMemory.pendingHypotheses.map(toPendingRetrievalExcludedMemory)
    : []
  const profileContent = policy.includeFullProfile
    ? [globalProfile, projectProfile].filter(Boolean).join('\n\n')
    : [fastSummary.globalFastSummary, fastSummary.profileFastSummary].filter(Boolean).join('\n\n')
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

  const context: CodexContinuityContext = {
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
    globalMemory: modelVisibleGlobalMemory.map((item) => toRoutedMemoryDigestItem(item, {
      exactProject: false,
      retrievalPlan,
      edgeTypes: routedMemory.graphEdgeTypesByMemoryKey.get(memoryGraphKeyForRoutedItem(item, project.projectId)) ?? []
    })),
    projectMemory: modelVisibleProjectMemory.map((item) => toRoutedMemoryDigestItem(item, {
      exactProject: true,
      retrievalPlan,
      edgeTypes: routedMemory.graphEdgeTypesByMemoryKey.get(memoryGraphKeyForRoutedItem(item, project.projectId)) ?? []
    })),
    pendingHypotheses: policy.includePendingDetails
      ? routedMemory.pendingHypotheses.map(toPendingHypothesisDigestItem)
      : [],
    similarProjectHints: routedMemory.similarProjectHints.map((item) => toSimilarProjectHintDigestItem(item, {
      retrievalPlan,
      edgeTypes: routedMemory.graphEdgeTypesByMemoryKey.get(memoryGraphKeyForRoutedItem(item, project.projectId)) ?? []
    })),
    sessionHints: sessionHints.map(toSessionHintDigestItem),
    activation,
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
    reviewReminders: policy.includePendingNotice ? formatReviewReminders(pendingReview) : [],
    diagnostics: policy.includeDiagnostics
      ? {
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
          ...(routedMemory.diagnostics.embedding === undefined ? {} : { embedding: routedMemory.diagnostics.embedding }),
          retrievalPlan: {
            taskIntent: retrievalPlan.taskIntent,
            memoryKinds: retrievalPlan.memoryKinds,
            requiredFacets: retrievalPlan.requiredFacets,
            optionalFacets: retrievalPlan.optionalFacets
          },
          contextPolicy: {
            mode: policy.mode,
            maxTokens: policy.maxTokens
          },
          ...(retrievalExcluded.length === 0 ? {} : { retrievalExcluded })
        }
      : undefined,
    profile: {
      global: globalProfile ?? nonEmptyString(fastSummary.globalFastSummary),
      project: projectProfile ?? nonEmptyString(fastSummary.profileFastSummary),
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
  await appendContinuityRuntimeMetricFailOpen(projectMemoryRoot, {
    event: 'continuity_get',
    mode: policy.mode,
    latencyMs: elapsedSince(startedAt),
    sqliteLatencyMs: routedMemoryLatencyMs,
    similarLatencyMs: routedMemory.runtimeMetrics.similarLatencyMs,
    pendingLatencyMs: routedMemory.runtimeMetrics.pendingLatencyMs,
    profileReadLatencyMs,
    tokenOverhead: estimateContinuityContextTokens(context),
    jsonlFallback: routedMemory.diagnostics.source === 'jsonl',
    indexStale: routedMemory.diagnostics.freshness === 'stale',
    createdAt: new Date().toISOString()
  })
  return context
}

async function runtimeActivationMemoriesForRoute(
  memoryRoot: string,
  routedMemory: Array<IndexedActiveMemory | RetrievedMemory>
): Promise<Array<SemanticMemory | CyreneMemory>> {
  const projectedMemories = routedMemory.map((item) => item.memory)
  const projectedById = new Map(projectedMemories.map((memory) => [memory.id, memory]))
  if (projectedById.size === 0) {
    return []
  }
  const semanticById = new Map(
    (await readSemanticMemoriesFromRoot(memoryRoot))
      .filter((memory) => memory.status === 'active' && projectedById.get(memory.id)?.content === memory.content)
      .map((memory) => [memory.id, memory])
  )
  return projectedMemories.map((memory) => semanticById.get(memory.id) ?? memory)
}

interface RoutedMemoryResult {
  globalMemory: Array<IndexedActiveMemory | RetrievedMemory>
  projectMemory: Array<IndexedActiveMemory | RetrievedMemory>
  pendingHypotheses: IndexedPendingMemory[]
  similarProjectHints: IndexedSimilarMemory[]
  graphEdgeTypesByMemoryKey: Map<string, string[]>
  diagnostics: RetrievalDiagnostics
  projectSimilarityDiagnostics: ProjectSimilarityDiagnostics
  evalGateDiagnostics: EvalGateDiagnostics
  runtimeMetrics: RoutedMemoryRuntimeMetrics
}

async function retrieveRoutedMemory(input: {
  cwd: string
  projectId: string
  query: string
  task: CodexContinuityTask
  retrievalPlan: RetrievalPlan
  fallback: RetrieveMemoriesInput
  policy: RetrievalPolicy
}): Promise<RoutedMemoryResult> {
  const roots = await codexMemoryIndexRoots(input.projectId)
  const indexStatus = await readCodexMemoryIndexStatus(roots.map((root) => root.memoryRoot))
  if (!isQueryableIndexStatus(indexStatus)) {
    return fallbackRoutedMemory(input.fallback, jsonlRetrievalDiagnostics(indexStatus, input.policy), input.projectId, input.policy)
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
        }, input.policy, diagnostics),
        input.projectId,
        input.policy
      )
    }
    let similarLatencyMs = 0
    const similarRetrieval = input.policy.includeSimilarProjectHints
      ? await measureAsync(() => retrieveSimilarProjectHints({
          cwd: input.cwd,
          projectId: input.projectId,
          query: input.query,
          task: input.task,
          adapter
        }), (latencyMs) => {
          similarLatencyMs = latencyMs
        })
      : emptySimilarRetrieval('similar_project_hints_disabled')
    let pendingLatencyMs = 0
    const pendingQuery = input.policy.includePendingDetails
      ? measureAsync(() => adapter.queryPending({
          currentProjectId: input.projectId,
          query: input.query,
          maxItems: 6,
          maxTokens: 400
        }), (latencyMs) => {
          pendingLatencyMs = latencyMs
        })
      : Promise.resolve([])
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
      pendingQuery
    ])
    const memoryRoutingGate = runMemoryRoutingEvalGate({
      currentProjectId: input.projectId,
      globalMemory: globalMemory.map(toMemoryRoutingActiveItem),
      projectMemory: projectMemory.map(toMemoryRoutingActiveItem),
      pendingHypotheses: pendingHypotheses.map(toMemoryRoutingPendingItem),
      similarProjectHints: similarRetrieval.similarProjectHints.map(toMemoryRoutingSimilarHintItem)
    })
    const evalGate = combineEvalGateResults([similarRetrieval.similarHintGate, memoryRoutingGate])
    const safeSimilarProjectHints = evalGate.passed ? similarRetrieval.similarProjectHints : []
    const eligibleGlobalMemory = globalMemory.filter(({ memory }) => (
      isMemoryEligibleForRetrieval(memory, input.fallback, input.task) &&
      !input.retrievalPlan.excludeDomains.includes(memory.domain)
    ))
    const eligibleProjectMemory = projectMemory.filter(({ memory }) => (
      isMemoryEligibleForRetrieval(memory, input.fallback, input.task) &&
      !input.retrievalPlan.excludeDomains.includes(memory.domain)
    ))
    const graphEdgeTypesByMemoryKey = input.retrievalPlan.includeGraphNeighbors
      ? await queryGraphEdgeTypes(adapter, [
        ...eligibleGlobalMemory,
        ...eligibleProjectMemory,
        ...safeSimilarProjectHints
      ], input.projectId)
      : new Map<string, string[]>()
    return {
      globalMemory: eligibleGlobalMemory,
      projectMemory: eligibleProjectMemory,
      pendingHypotheses,
      similarProjectHints: safeSimilarProjectHints,
      graphEdgeTypesByMemoryKey,
      diagnostics: sqliteRetrievalDiagnostics(indexStatus, diagnostics, input.policy),
      projectSimilarityDiagnostics: similarRetrieval.projectSimilarityDiagnostics,
      evalGateDiagnostics: {
        passed: evalGate.passed,
        failedChecks: evalGate.failedChecks
      },
      runtimeMetrics: {
        pendingLatencyMs,
        similarLatencyMs
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
      }, input.policy),
      input.projectId,
      input.policy
    )
  } finally {
    adapter.close()
  }
}

function isQueryableIndexStatus(status: CodexMemoryIndexStatus): boolean {
  return status.available && (status.freshness === 'fresh' || (status.freshness === 'empty' && status.lastSyncAt !== undefined))
}

function isModelVisibleRoutedMemory(item: IndexedActiveMemory | RetrievedMemory): boolean {
  return item.memory.confidenceTier !== 'trial'
}

function emptyFastSummaryProjection(): FastSummaryProjection {
  return {
    globalFastSummary: '',
    profileFastSummary: '',
    generatedAt: undefined
  }
}

function nonEmptyString(value: string): string | undefined {
  return value.trim() === '' ? undefined : value
}

async function measureAsync<T>(operation: () => Promise<T>, recordLatency: (latencyMs: number) => void): Promise<T> {
  const startedAt = Date.now()
  try {
    return await operation()
  } finally {
    recordLatency(elapsedSince(startedAt))
  }
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

async function appendContinuityRuntimeMetricFailOpen(
  memoryRoot: string,
  metric: RuntimeMetricEvent
): Promise<void> {
  try {
    await appendRuntimeMetric(memoryRoot, metric)
  } catch {
    // Runtime metrics must never block continuity context.
  }
}

function estimateContinuityContextTokens(context: CodexContinuityContext): number {
  return estimateTokens(JSON.stringify({
    globalMemory: context.globalMemory,
    projectMemory: context.projectMemory,
    pendingHypotheses: context.pendingHypotheses,
    similarProjectHints: context.similarProjectHints,
    sessionHints: context.sessionHints,
    activation: context.activation,
    profile: context.profile,
    reviewReminders: context.reviewReminders,
    diagnostics: context.diagnostics
  }))
}

async function fallbackRoutedMemory(
  input: RetrieveMemoriesInput,
  diagnostics: RetrievalDiagnostics,
  projectId: string,
  policy: RetrievalPolicy
): Promise<RoutedMemoryResult> {
  if (!policy.allowJsonlFallback) {
    return emptyRoutedMemory(jsonlFallbackDisabledDiagnostics(diagnostics, policy), 'jsonl_fallback_disabled')
  }
  const memories = await retrieveMemories(input)
  let pendingLatencyMs = 0
  const pendingHypotheses = policy.includePendingDetails
    ? await measureAsync(() => readFallbackPendingHypotheses(input, projectId), (latencyMs) => {
        pendingLatencyMs = latencyMs
      })
    : []
  return {
    globalMemory: memories.filter(({ memory }) => memory.scope === 'global'),
    projectMemory: memories.filter(({ memory }) => memory.scope !== 'global'),
    pendingHypotheses,
    similarProjectHints: [],
    graphEdgeTypesByMemoryKey: new Map(),
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
    },
    runtimeMetrics: {
      pendingLatencyMs,
      similarLatencyMs: 0
    }
  }
}

function emptyRoutedMemory(diagnostics: RetrievalDiagnostics, reason: string): RoutedMemoryResult {
  return {
    globalMemory: [],
    projectMemory: [],
    pendingHypotheses: [],
    similarProjectHints: [],
    graphEdgeTypesByMemoryKey: new Map(),
    diagnostics,
    projectSimilarityDiagnostics: {
      indexedProjects: 0,
      candidateProjects: 0,
      selectedProjects: 0,
      reason
    },
    evalGateDiagnostics: {
      passed: true,
      failedChecks: []
    },
    runtimeMetrics: {
      pendingLatencyMs: 0,
      similarLatencyMs: 0
    }
  }
}

function jsonlFallbackDisabledDiagnostics(
  diagnostics: RetrievalDiagnostics,
  policy: RetrievalPolicy
): RetrievalDiagnostics {
  return {
    ...diagnostics,
    source: 'sqlite',
    routes: routesForPolicy('sqlite', policy),
    reason: diagnostics.reason ?? 'jsonl_fallback_disabled'
  }
}

function sqliteRetrievalDiagnostics(
  status: CodexMemoryIndexStatus,
  diagnostics: MemoryIndexDiagnostics,
  policy: RetrievalPolicy
): RetrievalDiagnostics {
  return retrievalDiagnosticsFromStatus(status, 'sqlite', routesForPolicy('sqlite', policy), diagnostics)
}

function jsonlRetrievalDiagnostics(
  status: CodexMemoryIndexStatus,
  policy: RetrievalPolicy,
  diagnostics: Partial<MemoryIndexDiagnostics> = {}
): RetrievalDiagnostics {
  return retrievalDiagnosticsFromStatus(status, 'jsonl', routesForPolicy('jsonl', policy), diagnostics)
}

async function retrieveSimilarProjectHints(input: {
  cwd: string
  projectId: string
  query: string
  task: CodexContinuityTask
  adapter: Pick<MemoryIndexAdapter, 'listProjectMetadata' | 'querySimilarActive'>
}): Promise<SimilarRetrievalResult> {
  const currentFingerprint = await buildCodexProjectFingerprint({
    cwd: input.cwd,
    project: await identifyCodexProject(input.cwd)
  })
  const metadata = await input.adapter.listProjectMetadata()
  const selectedSimilarities = selectSimilarProjects({
    source: currentFingerprint,
    candidates: metadata,
    minScore: 0.2,
    maxProjects: 5,
    now: new Date().toISOString()
  })
  const targetNames = new Map(metadata.map((project) => [project.projectId, project.displayName]))
  const similarProjectHints = await input.adapter.querySimilarActive({
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

  return {
    similarProjectHints,
    similarHintGate,
    projectSimilarityDiagnostics: {
      indexedProjects: metadata.length,
      candidateProjects: metadata.filter((project) => project.projectId !== input.projectId).length,
      selectedProjects: selectedSimilarities.length,
      reason: projectSimilarityReason(metadata.length, selectedSimilarities.length)
    }
  }
}

function emptySimilarRetrieval(reason: string): SimilarRetrievalResult {
  return {
    similarProjectHints: [],
    similarHintGate: {
      passed: true,
      failedChecks: [],
      results: []
    },
    projectSimilarityDiagnostics: {
      indexedProjects: 0,
      candidateProjects: 0,
      selectedProjects: 0,
      reason
    }
  }
}

function routesForPolicy(source: RetrievalSource, policy: RetrievalPolicy): RetrievalRoute[] {
  const routes: RetrievalRoute[] = ['global', 'project']
  if (policy.includePendingDetails) {
    routes.push('pending')
  }
  if (source === 'sqlite' && policy.includeSimilarProjectHints) {
    routes.push('similar_project')
  }
  return routes
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

async function readCanonicalGlobalMemorySignaturesFailOpen(globalMemoryRoot: string): Promise<Set<string>> {
  try {
    return new Set((await readActiveMemoriesFromRoot(globalMemoryRoot)).map(canonicalGlobalMemorySignature))
  } catch {
    return new Set()
  }
}

function isCanonicalGlobalRoutedMemory(
  item: IndexedActiveMemory | RetrievedMemory,
  canonicalGlobalMemorySignatures: Set<string>
): boolean {
  if ('homeProjectId' in item) {
    return item.homeProjectId === null
  }
  return canonicalGlobalMemorySignatures.has(canonicalGlobalMemorySignature(item.memory))
}

function canonicalGlobalActivationMemoryIds(
  items: Array<IndexedActiveMemory | RetrievedMemory>,
  canonicalGlobalMemorySignatures: Set<string>
): string[] {
  const nonCanonicalFallbackIds = new Set(
    items
      .filter((item): item is RetrievedMemory => !('homeProjectId' in item))
      .filter((item) => !canonicalGlobalMemorySignatures.has(canonicalGlobalMemorySignature(item.memory)))
      .map((item) => item.memory.id)
  )
  return items
    .filter((item) => (
      isCanonicalGlobalRoutedMemory(item, canonicalGlobalMemorySignatures) &&
      !(!('homeProjectId' in item) && nonCanonicalFallbackIds.has(item.memory.id))
    ))
    .map((item) => item.memory.id)
}

function canonicalGlobalMemorySignature(memory: CyreneMemory): string {
  return JSON.stringify([
    memory.id,
    memory.normalizedKey,
    memory.content,
    memory.domain,
    memory.type,
    memory.scope,
    memory.updatedAt
  ])
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

function toRoutedMemoryDigestItem(item: IndexedActiveMemory | RetrievedMemory, input: {
  exactProject: boolean
  retrievalPlan: RetrievalPlan
  edgeTypes: string[]
}): RoutedMemoryDigestItem {
  return {
    id: item.memory.id,
    domain: item.memory.domain,
    type: item.memory.type,
    strength: item.memory.strength,
    scope: item.memory.scope,
    portability: 'portability' in item ? item.portability : item.memory.scope === 'global' ? 'global' : 'local_only',
    status: item.memory.status,
    content: item.memory.content,
    score: item.score,
    explain: explainRetrievalReasons({
      exactProject: input.exactProject,
      globalPolicy: item.memory.scope === 'global',
      memoryKind: memoryKindForRetrieval(item.memory),
      taskIntent: input.retrievalPlan.taskIntent,
      edgeTypes: input.edgeTypes,
      score: item.score
    })
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

function toPendingRetrievalExcludedMemory(item: IndexedPendingMemory): RetrievalExcludedMemory {
  return {
    id: item.memory.id,
    scope: item.memory.scope,
    content: item.memory.content,
    reason: 'pending_review_required',
    score: item.score
  }
}

function toSimilarProjectHintDigestItem(item: IndexedSimilarMemory, input: {
  retrievalPlan: RetrievalPlan
  edgeTypes: string[]
}): SimilarProjectHintDigestItem {
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
    rationale: 'Transferable guidance from a similar indexed project; not a current project fact.',
    explain: explainRetrievalReasons({
      exactProject: false,
      memoryKind: memoryKindForRetrieval(item.memory),
      taskIntent: input.retrievalPlan.taskIntent,
      edgeTypes: input.edgeTypes,
      transferability: true,
      score: item.score
    })
  }
}

function toSessionHintDigestItem(hint: CodexSessionHint): SessionHintDigestItem {
  return {
    id: hint.id,
    sourceProjectId: hint.sourceProjectId,
    sourceProjectName: hint.sourceProjectName,
    content: hint.summary,
    transferable: true,
    notCurrentProjectFact: true,
    rationale: 'Session-local transferable guidance from a similar project; not a current project fact.'
  }
}

async function queryGraphEdgeTypes(
  adapter: Pick<Awaited<ReturnType<typeof openMemoryIndexAdapter>>, 'queryMemoryEdges'>,
  items: Array<IndexedActiveMemory | IndexedSimilarMemory>,
  currentProjectId: string
): Promise<Map<string, string[]>> {
  const entries = await Promise.all(items.map(async (item) => {
    const key = memoryGraphKeyForRoutedItem(item, currentProjectId)
    const edges = await adapter.queryMemoryEdges({ fromId: key, status: 'approved' })
    return [key, Array.from(new Set(edges.map((edge) => edge.edgeType)))] as const
  }))
  return new Map(entries.filter(([, edgeTypes]) => edgeTypes.length > 0))
}

function memoryGraphKeyForRoutedItem(item: IndexedActiveMemory | IndexedSimilarMemory | RetrievedMemory, currentProjectId: string): string {
  if ('homeProjectId' in item && item.homeProjectId !== null) {
    return indexedMemoryGraphKey('project', item.homeProjectId, item.memory.id)
  }
  if (item.memory.scope === 'global') {
    return indexedMemoryGraphKey('global', null, item.memory.id)
  }
  return indexedMemoryGraphKey('project', currentProjectId, item.memory.id)
}

function indexedMemoryGraphKey(scope: 'global' | 'project', projectId: string | null, memoryId: string): string {
  return JSON.stringify([scope, projectId, memoryId])
}

function formatReviewReminders(pendingReview: Partial<CodexPendingReviewNotice>): ReviewReminder[] {
  if (pendingReview.newestCandidateId === undefined || pendingReview.newestPreview === undefined) {
    return []
  }
  return [{
    kind: 'pending_review',
    candidateId: pendingReview.newestCandidateId,
    content: pendingReview.newestPreview
  }]
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
