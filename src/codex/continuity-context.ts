import { createHash } from 'node:crypto'
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
import type { IndexedActiveMemory, IndexedCandidateHintPool, IndexedPendingMemory, IndexedSimilarMemory, MemoryEdge as IndexedMemoryEdge, MemoryIndexDiagnostics } from '../memory/memory-index.js'
import { deriveMemoryPortability, openMemoryIndexAdapter } from '../memory/memory-index.js'
import { relationExpansionPolicy, resolveRelationExpansion } from '../memory/memory-relations.js'
import { selectSimilarProjects } from '../memory/project-similarity.js'
import {
  isMemoryEligibleForRetrieval,
  memoryRetrievalBudgetForTask,
  retrieveMemories
} from '../memory/memory-retriever.js'
import type { RetrievedMemory, RetrieveMemoriesInput } from '../memory/memory-retriever.js'
import { readActiveMemoriesFromRoot, readPendingMemoriesFromRoot, readSemanticMemoriesFromRoot } from '../memory/memory-store.js'
import { MEMORY_RELATION_TYPES } from '../memory/types.js'
import type { CyreneMemory, MemoryEdge as DurableMemoryEdge, MemoryRelationType, PendingMemory, SemanticMemory } from '../memory/types.js'
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
import { readCodexSessionHints, replaceCodexSessionHints, type CodexSessionHint } from './session-hints.js'
import {
  selectCandidateHints,
  type CandidateHint,
  type CandidateHintMemoryCandidate,
  type CandidateHintSelectionMetrics,
  type CandidateHintValidatedMemoryCandidate
} from './candidate-hints.js'

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
  candidateHintMetrics: CandidateHintSelectionMetrics
}

const CANDIDATE_HINT_QUERY_MAX_ITEMS = 20

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
  candidateHints: CandidateHint[]
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
    task,
    userMessage: input.userMessage,
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
      extraMemories: policy.mode === 'fast' || !policy.allowJsonlFallback ? [] : await readLegacyGlobalCodexMemories(project.projectId),
      currentProjectId: project.projectId,
      query: input.userMessage,
      task,
      maxItems: budget.maxItems,
      maxTokens: Math.min(budget.maxTokens, policy.maxTokens)
  }
  let profileReadLatencyMs = 0
  const [pendingReview, [globalFastSummary, projectFastSummary, globalProfile, projectProfile], storedSessionHints] = await Promise.all([
    policy.includePendingNotice ? getCodexPendingReviewNotice({ cwd: input.cwd }) : Promise.resolve({}),
    measureAsync(async () => Promise.all([
      policy.includeFastSummaries ? readFastSummaryProjection(globalMemoryRoot) : Promise.resolve(emptyFastSummaryProjection()),
      policy.includeFastSummaries ? readFastSummaryProjection(projectMemoryRoot) : Promise.resolve(emptyFastSummaryProjection()),
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
  const visibleGlobalFastSummary = skipStaleFastSummary(globalFastSummary)
  const visibleProjectFastSummary = skipStaleFastSummary(projectFastSummary)
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
  const sessionHints = await resolveCodexSessionHints({
    cwd: input.cwd,
    projectId: project.projectId,
    projectMemoryRoot,
    query: input.userMessage,
    task,
    policy,
    sessionId: input.sessionId,
    existingSessionHints: storedSessionHints,
    activeMemoryCount: activeMemory.length
  })
  const retrievalExcluded = policy.includePendingDetails
    ? routedMemory.pendingHypotheses.map(toPendingRetrievalExcludedMemory)
    : []
  const profileContent = policy.includeFullProfile
    ? [globalProfile, projectProfile].filter(Boolean).join('\n\n')
    : [
        visibleGlobalFastSummary.globalFastSummary,
        visibleGlobalFastSummary.profileFastSummary,
        visibleProjectFastSummary.profileFastSummary
      ].filter(Boolean).join('\n\n')
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
    candidateHints: routedMemory.candidateHints,
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
      global: globalProfile ?? nonEmptyString(visibleGlobalFastSummary.globalFastSummary) ?? nonEmptyString(visibleGlobalFastSummary.profileFastSummary),
      project: projectProfile ?? nonEmptyString(visibleProjectFastSummary.profileFastSummary) ?? nonEmptyString(visibleGlobalFastSummary.profileFastSummary),
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
    ...routedMemory.runtimeMetrics.candidateHintMetrics,
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
  candidateHints: CandidateHint[]
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
    const candidateHintQuery = shouldQueryCandidateHints(input.policy, indexStatus, diagnostics)
      ? selectSqliteCandidateHints({
          adapter,
          projectId: input.projectId,
          query: input.query,
          task: input.task,
          policy: input.policy
        })
      : Promise.resolve(emptyCandidateHintSelection())
    const [globalMemory, projectMemory, pendingHypotheses, candidateHintSelection] = await Promise.all([
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
      pendingQuery,
      candidateHintQuery
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
    const relationExpandedMemory = await expandSqliteRelationMemory({
      adapter,
      currentProjectId: input.projectId,
      task: input.task,
      retrievalPlan: input.retrievalPlan,
      fallback: input.fallback,
      globalMemory: eligibleGlobalMemory,
      projectMemory: eligibleProjectMemory
    })
    const graphEdgeTypesByMemoryKey = mergeGraphEdgeTypeMaps(
      input.retrievalPlan.includeGraphNeighbors
        ? await queryGraphEdgeTypes(adapter, [
          ...relationExpandedMemory.globalMemory,
          ...relationExpandedMemory.projectMemory,
          ...safeSimilarProjectHints
        ], input.projectId)
        : new Map<string, string[]>(),
      relationExpandedMemory.relationEdgeTypesByMemoryKey
    )
    return {
      globalMemory: relationExpandedMemory.globalMemory,
      projectMemory: relationExpandedMemory.projectMemory,
      pendingHypotheses,
      similarProjectHints: safeSimilarProjectHints,
      candidateHints: candidateHintSelection.hints,
      graphEdgeTypesByMemoryKey,
      diagnostics: sqliteRetrievalDiagnostics(indexStatus, diagnostics, input.policy),
      projectSimilarityDiagnostics: similarRetrieval.projectSimilarityDiagnostics,
      evalGateDiagnostics: {
        passed: evalGate.passed,
        failedChecks: evalGate.failedChecks
      },
      runtimeMetrics: {
        pendingLatencyMs,
        similarLatencyMs,
        candidateHintMetrics: candidateHintSelection.metrics
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

function shouldQueryCandidateHints(
  policy: RetrievalPolicy,
  status: CodexMemoryIndexStatus,
  diagnostics: MemoryIndexDiagnostics
): boolean {
  return policy.candidateHintBudget > 0 && status.available && status.freshness === 'fresh' && diagnostics.available
}

async function selectSqliteCandidateHints(input: {
  adapter: Pick<MemoryIndexAdapter, 'queryCandidateHints'>
  projectId: string
  query: string
  task: CodexContinuityTask
  policy: RetrievalPolicy
}): Promise<{ hints: CandidateHint[]; metrics: CandidateHintSelectionMetrics }> {
  const startedAt = Date.now()
  if (input.policy.candidateHintBudget <= 0) {
    return emptyCandidateHintSelection()
  }
  try {
    const pool = await input.adapter.queryCandidateHints({
      currentProjectId: input.projectId,
      query: input.query,
      maxItems: CANDIDATE_HINT_QUERY_MAX_ITEMS
    })
    const candidates = candidateHintMemoryCandidates(pool, input.projectId)
    if (candidates.length === 0) {
      return {
        hints: [],
        metrics: {
          ...emptyCandidateHintMetrics(),
          candidateHintLatencyMs: elapsedSince(startedAt)
        }
      }
    }

    const result = selectCandidateHints({
      mode: input.policy.mode,
      query: input.query,
      projectId: input.projectId,
      task: input.task,
      candidates,
      validatedMemories: candidateHintValidatedMemoryCandidates(pool),
      maxItems: input.policy.candidateHintBudget
    })
    return {
      hints: result.hints.map(labelModelVisibleCandidateHint),
      metrics: {
        ...result.metrics,
        candidateHintLatencyMs: elapsedSince(startedAt)
      }
    }
  } catch {
    // Candidate hints must fail closed without changing ordinary continuity retrieval.
    return {
      hints: [],
      metrics: {
        ...emptyCandidateHintMetrics(),
        candidateHintLatencyMs: elapsedSince(startedAt)
      }
    }
  }
}

function candidateHintMemoryCandidates(
  pool: IndexedCandidateHintPool,
  projectId: string
): CandidateHintMemoryCandidate[] {
  return pool.candidates.map((item) => ({
    memory: item.memory,
    projectId: item.homeProjectId ?? projectId,
    sqliteRelevanceScore: item.score
  }))
}

function candidateHintValidatedMemoryCandidates(
  pool: IndexedCandidateHintPool
): CandidateHintValidatedMemoryCandidate[] {
  return pool.validatedMemories
    .filter((item) => isValidatedConflictMemory(item.memory))
    .map((item) => ({
      memory: item.memory,
      ...(item.homeProjectId === null ? {} : { projectId: item.homeProjectId })
    }))
}

function emptyCandidateHintSelection(): { hints: CandidateHint[]; metrics: CandidateHintSelectionMetrics } {
  return {
    hints: [],
    metrics: emptyCandidateHintMetrics()
  }
}

function emptyCandidateHintMetrics(): CandidateHintSelectionMetrics {
  return {
    candidateHintLatencyMs: 0,
    candidateHintEligibleCount: 0,
    candidateHintRelevantCount: 0,
    candidateHintSelectedCount: 0,
    candidateHintTimeoutCount: 0,
    candidateHintSuppressedByLatencyCount: 0
  }
}

function isValidatedConflictMemory(memory: SemanticMemory): boolean {
  return (
    memory.status === 'active' &&
    (
      memory.confidenceTier === 'validated' ||
      memory.confidenceTier === 'project_core' ||
      memory.confidenceTier === 'global_core'
    )
  )
}

function labelModelVisibleCandidateHint(hint: CandidateHint): CandidateHint {
  return {
    ...hint,
    text: `Candidate project workflow hint, not validated:\n- ${hint.text.trim()}`
  }
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

function skipStaleFastSummary(projection: FastSummaryProjection): FastSummaryProjection {
  return projection.stale === true ? emptyFastSummaryProjection() : projection
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
    candidateHints: context.candidateHints,
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
    candidateHints: [],
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
      similarLatencyMs: 0,
      candidateHintMetrics: emptyCandidateHintMetrics()
    }
  }
}

interface SqliteRelationExpansionResult {
  globalMemory: IndexedActiveMemory[]
  projectMemory: IndexedActiveMemory[]
  relationEdgeTypesByMemoryKey: Map<string, string[]>
}

async function expandSqliteRelationMemory(input: {
  adapter: Pick<MemoryIndexAdapter, 'queryActive' | 'queryMemoryEdges'>
  currentProjectId: string
  task: CodexContinuityTask
  retrievalPlan: RetrievalPlan
  fallback: RetrieveMemoriesInput
  globalMemory: IndexedActiveMemory[]
  projectMemory: IndexedActiveMemory[]
}): Promise<SqliteRelationExpansionResult> {
  const [global, project] = await Promise.all([
    expandSqliteRelationRoute({
      ...input,
      route: 'global',
      memory: input.globalMemory
    }),
    expandSqliteRelationRoute({
      ...input,
      route: 'project',
      memory: input.projectMemory
    })
  ])
  return {
    globalMemory: global.memory,
    projectMemory: project.memory,
    relationEdgeTypesByMemoryKey: mergeGraphEdgeTypeMaps(global.relationEdgeTypesByMemoryKey, project.relationEdgeTypesByMemoryKey)
  }
}

async function expandSqliteRelationRoute(input: {
  adapter: Pick<MemoryIndexAdapter, 'queryActive' | 'queryMemoryEdges'>
  currentProjectId: string
  task: CodexContinuityTask
  retrievalPlan: RetrievalPlan
  fallback: RetrieveMemoriesInput
  route: 'global' | 'project'
  memory: IndexedActiveMemory[]
}): Promise<{ memory: IndexedActiveMemory[]; relationEdgeTypesByMemoryKey: Map<string, string[]> }> {
  const byId = new Map(input.memory.map((item) => [item.memory.id, item]))
  const suppressed = new Set<string>()
  const relationEdgeTypesByMemoryKey = new Map<string, string[]>()
  let routeCandidates: Map<string, IndexedActiveMemory> | undefined

  const candidates = async (): Promise<Map<string, IndexedActiveMemory>> => {
    if (routeCandidates !== undefined) {
      return routeCandidates
    }
    const queried = await input.adapter.queryActive({
      currentProjectId: input.currentProjectId,
      query: '',
      route: input.route,
      task: input.task,
      maxItems: 100,
      maxTokens: 4_000
    })
    routeCandidates = new Map(
      queried
        .filter(({ memory }) => (
          isMemoryEligibleForRetrieval(memory, input.fallback, input.task) &&
          !input.retrievalPlan.excludeDomains.includes(memory.domain)
        ))
        .map((item) => [item.memory.id, item])
    )
    return routeCandidates
  }

  for (const seed of input.memory) {
    const seedKey = memoryGraphKeyForRoutedItem(seed, input.currentProjectId)
    const [outgoing, incoming] = await Promise.all([
      input.adapter.queryMemoryEdges({ fromId: seedKey, status: 'approved' }),
      input.adapter.queryMemoryEdges({ toId: seedKey, status: 'approved' })
    ])
    for (const edge of uniqueIndexedMemoryEdges([...outgoing, ...incoming])) {
      const durableEdge = durableRelationEdgeFromIndexedEdge(edge)
      if (durableEdge === undefined || !durableEdgeMatchesRoute(durableEdge, input.route, input.currentProjectId)) {
        continue
      }
      const resolution = resolveRelationExpansion({ seedMemoryId: seed.memory.id, edge: durableEdge })
      for (const memoryId of resolution.suppressMemoryIds) {
        suppressed.add(memoryId)
      }
      if (resolution.includeMemoryId === undefined) {
        continue
      }
      const related = byId.get(resolution.includeMemoryId) ?? (await candidates()).get(resolution.includeMemoryId)
      if (related === undefined) {
        continue
      }
      byId.set(related.memory.id, related)
      addGraphEdgeType(
        relationEdgeTypesByMemoryKey,
        memoryGraphKeyForRoutedItem(related, input.currentProjectId),
        `relation:${durableEdge.relationType}`
      )
    }
  }

  return {
    memory: [...byId.values()].filter((item) => !suppressed.has(item.memory.id)),
    relationEdgeTypesByMemoryKey
  }
}

function emptyRoutedMemory(diagnostics: RetrievalDiagnostics, reason: string): RoutedMemoryResult {
  return {
    globalMemory: [],
    projectMemory: [],
    pendingHypotheses: [],
    similarProjectHints: [],
    candidateHints: [],
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
      similarLatencyMs: 0,
      candidateHintMetrics: emptyCandidateHintMetrics()
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

async function resolveCodexSessionHints(input: {
  cwd: string
  projectId: string
  projectMemoryRoot: string
  query: string
  task: CodexContinuityTask
  policy: RetrievalPolicy
  sessionId?: string
  existingSessionHints: CodexSessionHint[]
  activeMemoryCount: number
}): Promise<CodexSessionHint[]> {
  if (
    !input.policy.includeSessionHints ||
    input.sessionId === undefined ||
    input.existingSessionHints.length > 0 ||
    !shouldGenerateCodexSessionHints(input)
  ) {
    return input.existingSessionHints
  }

  const generated = await generateCodexSessionHintsFailOpen(input)
  if (generated.length === 0) {
    return []
  }
  await replaceCodexSessionHints(input.projectMemoryRoot, {
    sessionId: input.sessionId,
    projectId: input.projectId,
    hints: generated,
    now: generated[0]?.createdAt
  })
  return generated
}

function shouldGenerateCodexSessionHints(input: {
  query: string
  task: CodexContinuityTask
  activeMemoryCount: number
}): boolean {
  if (input.task === 'planning' || input.task === 'debugging') {
    return true
  }
  if (input.activeMemoryCount === 0) {
    return true
  }
  return /(?:similar project|project start|new project|architecture|implementation plan|类似项目|相似项目|新项目|架构|计划|规划)/i.test(input.query)
}

async function generateCodexSessionHintsFailOpen(input: {
  cwd: string
  projectId: string
  query: string
  task: CodexContinuityTask
}): Promise<CodexSessionHint[]> {
  try {
    const roots = await codexMemoryIndexRoots(input.projectId)
    const indexStatus = await readCodexMemoryIndexStatus(roots.map((root) => root.memoryRoot))
    if (!isQueryableIndexStatus(indexStatus)) {
      return []
    }
    const adapter = await openMemoryIndexAdapter({ dbPath: codexMemoryDbPath() })
    try {
      if (!adapter.diagnostics().available) {
        return []
      }
      const similarRetrieval = await retrieveSimilarProjectHints({
        cwd: input.cwd,
        projectId: input.projectId,
        query: input.query,
        task: input.task,
        adapter
      })
      if (!similarRetrieval.similarHintGate.passed) {
        return []
      }
      const now = new Date().toISOString()
      return similarRetrieval.similarProjectHints.slice(0, 3).map((item) => ({
        id: stableSessionHintId(item),
        sourceProjectId: item.homeProjectId,
        ...(item.sourceProjectName === undefined ? {} : { sourceProjectName: item.sourceProjectName }),
        summary: capSessionHintSummary(item.memory.content),
        createdAt: now
      }))
    } finally {
      adapter.close()
    }
  } catch {
    return []
  }
}

function stableSessionHintId(item: IndexedSimilarMemory): string {
  return `session-hint-${createHash('sha256').update(JSON.stringify({
    sourceProjectId: item.homeProjectId,
    memoryId: item.memory.id,
    content: item.memory.content
  })).digest('hex').slice(0, 16)}`
}

function capSessionHintSummary(content: string): string {
  const cleaned = content.replace(/\s+/g, ' ').trim()
  return cleaned.length <= 500 ? cleaned : cleaned.slice(0, 500).trimEnd()
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
  const explain = explainRetrievalReasons({
    exactProject: input.exactProject,
    globalPolicy: item.memory.scope === 'global',
    memoryKind: memoryKindForRetrieval(item.memory),
    taskIntent: input.retrievalPlan.taskIntent,
    edgeTypes: input.edgeTypes,
    score: item.score
  })
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
    explain: mergeRuntimeExplain(explain, 'explain' in item ? item.explain : undefined)
  }
}

function mergeRuntimeExplain(base: string[], inherited: string[] | undefined): string[] {
  const relationReasons = (inherited ?? []).filter((reason) => reason.startsWith('edge:relation:'))
  return Array.from(new Set([...base, ...relationReasons]))
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
    return [key, Array.from(new Set(edges.map((edge) => edge.edgeType).filter(isRuntimeGraphEdgeType)))] as const
  }))
  return new Map(entries.filter(([, edgeTypes]) => edgeTypes.length > 0))
}

function isRuntimeGraphEdgeType(edgeType: string): boolean {
  const relationType = relationTypeFromEdgeType(edgeType)
  return relationType === undefined || relationExpansionPolicy(relationType).runtime
}

function uniqueIndexedMemoryEdges(edges: IndexedMemoryEdge[]): IndexedMemoryEdge[] {
  const seen = new Set<string>()
  const output: IndexedMemoryEdge[] = []
  for (const edge of edges) {
    if (seen.has(edge.id)) {
      continue
    }
    seen.add(edge.id)
    output.push(edge)
  }
  return output
}

function durableRelationEdgeFromIndexedEdge(edge: IndexedMemoryEdge): DurableMemoryEdge | undefined {
  const relationType = relationTypeFromEdgeType(edge.edgeType)
  if (relationType === undefined) {
    return undefined
  }
  const from = parseIndexedMemoryGraphKey(edge.fromId)
  const to = parseIndexedMemoryGraphKey(edge.toId)
  if (from === undefined || to === undefined) {
    return undefined
  }
  return {
    id: edge.id,
    fromMemoryId: from.memoryId,
    toMemoryId: to.memoryId,
    fromScope: from.scope,
    toScope: to.scope,
    ...(from.projectId === null ? {} : { fromProjectId: from.projectId }),
    ...(to.projectId === null ? {} : { toProjectId: to.projectId }),
    relationType,
    status: 'validated',
    confidence: edge.weight,
    origin: edge.source === 'model' ? 'model' : 'deterministic',
    reason: 'approved indexed relation edge',
    ...(edge.evidenceId === undefined ? {} : { evidenceId: edge.evidenceId }),
    createdAt: edge.createdAt,
    updatedAt: edge.approvedAt ?? edge.createdAt
  }
}

function relationTypeFromEdgeType(edgeType: string): MemoryRelationType | undefined {
  if (!edgeType.startsWith('relation:')) {
    return undefined
  }
  const relationType = edgeType.slice('relation:'.length)
  return isMemoryRelationType(relationType) ? relationType : undefined
}

function isMemoryRelationType(value: string): value is MemoryRelationType {
  return (MEMORY_RELATION_TYPES as readonly string[]).includes(value)
}

function durableEdgeMatchesRoute(edge: DurableMemoryEdge, route: 'global' | 'project', currentProjectId: string): boolean {
  if (edge.fromScope !== route || edge.toScope !== route) {
    return false
  }
  if (route === 'global') {
    return edge.fromProjectId === undefined && edge.toProjectId === undefined
  }
  return edge.fromProjectId === currentProjectId && edge.toProjectId === currentProjectId
}

interface ParsedMemoryGraphKey {
  scope: 'global' | 'project'
  projectId: string | null
  memoryId: string
}

function parseIndexedMemoryGraphKey(value: string): ParsedMemoryGraphKey | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 3) {
      return undefined
    }
    const [scope, projectId, memoryId] = parsed
    if ((scope !== 'global' && scope !== 'project') || typeof memoryId !== 'string') {
      return undefined
    }
    if (projectId !== null && typeof projectId !== 'string') {
      return undefined
    }
    return { scope, projectId, memoryId }
  } catch {
    return undefined
  }
}

function addGraphEdgeType(map: Map<string, string[]>, key: string, edgeType: string): void {
  map.set(key, Array.from(new Set([...(map.get(key) ?? []), edgeType])))
}

function mergeGraphEdgeTypeMaps(...maps: Array<Map<string, string[]>>): Map<string, string[]> {
  const merged = new Map<string, string[]>()
  for (const map of maps) {
    for (const [key, edgeTypes] of map) {
      for (const edgeType of edgeTypes) {
        addGraphEdgeType(merged, key, edgeType)
      }
    }
  }
  return merged
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
