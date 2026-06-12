import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDefaultConfig } from '../config.js'
import {
  activationPolicyForConfidenceTier,
  isLowRiskLifecycleMemory,
  validateSemanticMemoryLifecycle
} from '../memory/memory-lifecycle.js'
import {
  appendMemoryEventFromRoot,
  assertCanonicalJsonlHealthyForMutation,
  assertSafeMemoryDataFileTarget,
  isMemoryJsonlRepairRequiredError,
  readActivationEventsFromRoot,
  readMemoryEdgesFromRoot,
  readMemoryEventsFromRoot,
  transitionMemoryEdgeStatusFromRoot,
  writeSemanticMemoriesFromRoot
} from '../memory/memory-store.js'
import { withMemoryMaintenanceLockFromRoot } from '../memory/memory-maintenance.js'
import type {
  ActivationEvent,
  MemoryEdge,
  MemoryEvent,
  MemorySource,
  SemanticMemory,
  StructuredEvidence
} from '../memory/types.js'
import {
  runV5AutoPromotionEvalGate,
  runV5GlobalAutoPromotionEvalGate
} from '../eval/eval-runner.js'
import type { EvalGateResult, V5AutoPromotionEvalItem } from '../eval/eval-runner.js'
import {
  codexGlobalMemoryRoot,
  codexProjectMemoryRoot,
  getReadableCodexProjectMemoryRoots
} from './codex-memory-root.js'
import {
  checkCodexMemoryIndexHealth,
  refreshGlobalFastSummaryProjection
} from './fast-summary-maintenance.js'
import { identifyCodexProject } from './project-id.js'

const PROJECT_AUTO_PROMOTION_POLICY_ID = 'low_risk_project_memory_v1'
const GLOBAL_AUTO_PROMOTION_POLICY_ID = 'low_risk_global_procedural_v1'
const DAILY_TRIAL_VALIDATION_POLICY_ID = 'daily_trial_validation_v1'
const DAILY_EXPLICIT_GLOBAL_CORE_POLICY_ID = 'daily_explicit_global_core_v1'
const GLOBAL_AUTO_PROMOTION_DOMAINS = new Set(['procedural', 'system'])
const MEMORY_SOURCES = new Set<MemorySource>([
  'user_explicit',
  'user_implicit',
  'assistant_observed',
  'tool_trace',
  'file',
  'legacy_markdown',
  'review_event'
])
const SEMANTIC_MEMORIES_FILE = 'semantic_memories.jsonl'

export interface LifecycleRootInput { projectId?: string; memoryRoot: string }

export interface DailyLifecycleRootResult {
  scope: 'project' | 'global'
  projectId?: string
  memoryRoot: string
  promotedTrialToValidated: number
  promotedExplicitGlobalToCore: number
  recommendations: number
  staleTrials: number
  relationEdgesExpired: number
  relationEdgesValidated: number
  relationEdgesRejected: number
  invalidMemories: number
  needsMigration: number
  malformedJsonLines?: number
  evalFailures: number
  capExhausted: number
  fastSummaryUpdated: boolean
  indexHealthChecked: boolean
  runtimeMetricsRecorded: number
  skipped?: boolean
  reason?: string
}

export interface DailyLifecycleResult {
  action: 'memory_lifecycle_daily'
  dryRun: boolean
  roots: DailyLifecycleRootResult[]
}

interface LifecycleRootSpec extends LifecycleRootInput {
  scope: 'project' | 'global'
}

interface PromotionStats {
  applied: number
  corrected: number
  violated: number
  appliedEventIds: string[]
  correctedEventIds: string[]
  violatedEventIds: string[]
}

interface RootRunState {
  root: LifecycleRootSpec
  now: string
  dryRun: boolean
  result: DailyLifecycleRootResult
  events: MemoryEvent[]
  usedToday: number
  dailyCap: number
}

interface DailyLifecycleRunInput {
  dryRun: boolean
  now: string
  projectDailyCap: number
  globalDailyCap: number
}

type StrictSemanticReadResult =
  | { ok: true; records: SemanticMemory[] }
  | { ok: false; malformedJsonLines: number; reason: string }

export async function runCodexMemoryLifecycleDaily(input: {
  cwd?: string
  allProjects?: boolean
  projectRoots?: LifecycleRootInput[]
  includeGlobalRoot?: boolean
  apply?: boolean
  now?: string
}): Promise<DailyLifecycleResult> {
  const dryRun = input.apply !== true
  const now = input.now ?? new Date().toISOString()
  const config = createDefaultConfig(input.cwd ?? process.cwd())
  const roots: LifecycleRootSpec[] = (input.projectRoots ?? await defaultProjectRoots(
    input.allProjects === true ? undefined : input.cwd
  )).map((root) => ({
    ...root,
    scope: 'project'
  }))

  if (input.includeGlobalRoot === true) {
    roots.push({ scope: 'global', memoryRoot: codexGlobalMemoryRoot() })
  }

  const results: DailyLifecycleRootResult[] = []
  for (const root of roots) {
    results.push(await runDailyForRoot(root, {
      dryRun,
      now,
      projectDailyCap: config.memoryAutoReviewProjectPromotePerDay,
      globalDailyCap: config.memoryAutoReviewGlobalPromotePerDay
    }))
  }

  return {
    action: 'memory_lifecycle_daily',
    dryRun,
    roots: results
  }
}

async function runDailyForRoot(
  root: LifecycleRootSpec,
  input: DailyLifecycleRunInput
): Promise<DailyLifecycleRootResult> {
  if (input.dryRun) {
    return runDailyForReadableRoot(root, input)
  }
  return withMemoryMaintenanceLockFromRoot(root.memoryRoot, (lockedMemoryRoot) =>
    runDailyForReadableRoot({ ...root, memoryRoot: lockedMemoryRoot }, input)
  )
}

async function runDailyForReadableRoot(
  root: LifecycleRootSpec,
  input: DailyLifecycleRunInput
): Promise<DailyLifecycleRootResult> {
  const repairRequiredLines = await repairRequiredMalformedJsonLinesForApply(root.memoryRoot, input.dryRun)
  if (repairRequiredLines !== null) {
    return repairRequiredRootResult(root, repairRequiredLines)
  }

  const semanticRead = await readSemanticMemoriesStrictFromRoot(root.memoryRoot)
  if (!semanticRead.ok) {
    return input.dryRun ? malformedRootResult(root, semanticRead) : repairRequiredRootResult(root, semanticRead.malformedJsonLines)
  }
  const [memories, activationEvents, memoryEvents, relationEdges] = await Promise.all([
    Promise.resolve(semanticRead.records),
    readActivationEventsFromRoot(root.memoryRoot),
    readMemoryEventsFromRoot(root.memoryRoot),
    readMemoryEdgesFromRoot(root.memoryRoot)
  ])
  const state: RootRunState = {
    root,
    now: input.now,
    dryRun: input.dryRun,
    result: baseRootResult(root),
    events: [],
    usedToday: countSameDayAutoPromotions(memoryEvents, input.now),
    dailyCap: root.scope === 'project' ? input.projectDailyCap : input.globalDailyCap
  }
  state.result.indexHealthChecked = await checkCodexMemoryIndexHealth([root.memoryRoot])
  const next: SemanticMemory[] = []

  for (const memory of memories) {
    const activeInvalidFindings = memory.status === 'active' ? validateSemanticMemoryLifecycle(memory) : []
    if (activeInvalidFindings.length > 0) {
      state.result.invalidMemories += 1
      state.result.needsMigration += 1
      state.events.push(needsMigrationEvent(state, memory, activeInvalidFindings))
      next.push(memory)
      continue
    }

    if (root.scope === 'project') {
      next.push(processProjectMemory(state, memory, activationEvents))
    } else {
      next.push(processGlobalMemory(state, memory))
    }
  }

  const relationTransitions = relationEdgeMaintenanceTransitions(next, relationEdges)
  for (const transition of relationTransitions) {
    countRelationTransition(state.result, transition.status)
  }

  const changed = memories.some((memory, index) => memory !== next[index])
  if (!input.dryRun) {
    for (const event of state.events) {
      await appendMemoryEventFromRoot(root.memoryRoot, event)
    }
    if (changed) {
      await writeSemanticMemoriesFromRoot(root.memoryRoot, next)
    }
    if (root.scope === 'global') {
      await refreshGlobalFastSummaryProjection({
        memoryRoot: root.memoryRoot,
        memories: next,
        generatedAt: input.now
      })
      state.result.fastSummaryUpdated = true
    }
    for (const transition of relationTransitions) {
      await transitionMemoryEdgeStatusFromRoot(root.memoryRoot, {
        id: transition.edge.id,
        status: transition.status,
        now: input.now,
        reason: transition.reason
      })
    }
  }

  return state.result
}

function processProjectMemory(
  state: RootRunState,
  memory: SemanticMemory,
  activationEvents: ActivationEvent[]
): SemanticMemory {
  if (memory.status !== 'active' || memory.scope !== 'project' || memory.confidenceTier !== 'trial') {
    return memory
  }

  if (memory.expiresAt !== undefined && memory.expiresAt <= state.now) {
    state.result.staleTrials += 1
    state.events.push(expireTrialEvent(state, memory))
    return {
      ...memory,
      status: 'archived',
      updatedAt: state.now
    }
  }

  const stats = activationStats(memory.id, activationEvents)
  if (stats.corrected > 0 || stats.violated > 0) {
    addProjectRecommendation(
      state,
      memory,
      'negative activation feedback blocks auto-promotion',
      stats,
      undefined
    )
    return memory
  }

  if (!isLowRiskLifecycleMemory(memory)) {
    addProjectRecommendation(
      state,
      memory,
      'high-risk trial memory requires manual review',
      stats,
      undefined
    )
    return memory
  }

  if (hasSourceOfTruthConflict(memory)) {
    addProjectRecommendation(
      state,
      memory,
      'source-of-truth conflict blocks auto-promotion',
      stats,
      undefined
    )
    return memory
  }

  if (stats.applied < 2) {
    return memory
  }

  const evidenceCount = memory.evidence.length
  const distinctEvidenceCount = distinctStructuredEvidenceCount(memory.evidence)
  const evalItem = autoPromotionEvalItem({
    memory,
    scope: 'project',
    policyId: PROJECT_AUTO_PROMOTION_POLICY_ID,
    usedToday: state.usedToday,
    dailyCap: state.dailyCap,
    evidenceCount,
    distinctEvidenceCount
  })
  const evalGate = runV5AutoPromotionEvalGate([evalItem])
  if (!evalGate.passed) {
    state.result.evalFailures += 1
    if (isCapExhaustedEvalFailure(evalGate)) {
      state.result.capExhausted += 1
    }
    addProjectRecommendation(
      state,
      memory,
      isCapExhaustedEvalFailure(evalGate) ? 'daily auto-promotion cap exhausted' : 'eval gate blocked auto-promotion',
      stats,
      evalGate
    )
    return memory
  }

  state.result.promotedTrialToValidated += 1
  state.events.push(promoteTrialEvent(state, memory, stats, evidenceCount, distinctEvidenceCount, evalGate))
  state.usedToday += 1
  return {
    ...memory,
    confidenceTier: 'validated',
    activationPolicy: activationPolicyForConfidenceTier('validated'),
    updatedAt: state.now
  }
}

function processGlobalMemory(state: RootRunState, memory: SemanticMemory): SemanticMemory {
  if (memory.status !== 'pending' || memory.scope !== 'global') {
    return memory
  }

  if (!isExplicitLowRiskGlobalCandidate(memory)) {
    addGlobalRecommendation(state, memory, 'high-risk or ambiguous global candidate requires manual review', undefined)
    return memory
  }

  const evidenceCount = memory.evidence.length
  const distinctEvidenceCount = distinctStructuredEvidenceCount(memory.evidence)
  const evalItem = autoPromotionEvalItem({
    memory,
    scope: 'global',
    policyId: GLOBAL_AUTO_PROMOTION_POLICY_ID,
    usedToday: state.usedToday,
    dailyCap: state.dailyCap,
    evidenceCount,
    distinctEvidenceCount
  })
  const policyGate = runV5AutoPromotionEvalGate([evalItem])
  const globalGate = runV5GlobalAutoPromotionEvalGate([evalItem])
  const evalGate = combineEvalGates(policyGate, globalGate)
  const promoted = {
    ...memory,
    status: 'active',
    confidenceTier: 'global_core',
    activationPolicy: activationPolicyForConfidenceTier('global_core'),
    updatedAt: state.now
  } satisfies SemanticMemory
  const lifecycleFindings = validateSemanticMemoryLifecycle(promoted)
  if (!evalGate.passed || lifecycleFindings.length > 0) {
    state.result.evalFailures += evalGate.passed ? 0 : 1
    if (isCapExhaustedEvalFailure(evalGate)) {
      state.result.capExhausted += 1
    }
    addGlobalRecommendation(
      state,
      memory,
      lifecycleFindings.length > 0
        ? 'candidate would create invalid global_core memory'
        : isCapExhaustedEvalFailure(evalGate)
          ? 'daily auto-promotion cap exhausted'
          : 'eval gate blocked global auto-promotion',
      evalGate,
      lifecycleFindings
    )
    return memory
  }

  state.result.promotedExplicitGlobalToCore += 1
  state.events.push(promoteGlobalEvent(state, promoted, evidenceCount, distinctEvidenceCount, evalGate))
  state.usedToday += 1
  return promoted
}

async function defaultProjectRoots(cwd: string | undefined): Promise<LifecycleRootInput[]> {
  if (cwd !== undefined) {
    const project = await identifyCodexProject(cwd)
    return [{ projectId: project.projectId, memoryRoot: codexProjectMemoryRoot(project.projectId) }]
  }
  return (await getReadableCodexProjectMemoryRoots()).map((memoryRoot) => ({ memoryRoot }))
}

function baseRootResult(root: LifecycleRootSpec): DailyLifecycleRootResult {
  return {
    scope: root.scope,
    ...(root.projectId === undefined ? {} : { projectId: root.projectId }),
    memoryRoot: root.memoryRoot,
    promotedTrialToValidated: 0,
    promotedExplicitGlobalToCore: 0,
    recommendations: 0,
    staleTrials: 0,
    relationEdgesExpired: 0,
    relationEdgesValidated: 0,
    relationEdgesRejected: 0,
    invalidMemories: 0,
    needsMigration: 0,
    evalFailures: 0,
    capExhausted: 0,
    fastSummaryUpdated: false,
    indexHealthChecked: false,
    runtimeMetricsRecorded: 0
  }
}

function malformedRootResult(
  root: LifecycleRootSpec,
  readResult: Extract<StrictSemanticReadResult, { ok: false }>
): DailyLifecycleRootResult {
  return {
    ...baseRootResult(root),
    invalidMemories: readResult.malformedJsonLines,
    needsMigration: readResult.malformedJsonLines,
    malformedJsonLines: readResult.malformedJsonLines,
    skipped: true,
    reason: readResult.reason
  }
}

function repairRequiredRootResult(root: LifecycleRootSpec, malformedJsonLines: number): DailyLifecycleRootResult {
  return malformedRootResult(root, { ok: false, malformedJsonLines, reason: 'repair_required' })
}

async function repairRequiredMalformedJsonLinesForApply(memoryRoot: string, dryRun: boolean): Promise<number | null> {
  if (dryRun) {
    return null
  }
  try {
    await assertCanonicalJsonlHealthyForMutation(memoryRoot)
    return null
  } catch (error) {
    if (isMemoryJsonlRepairRequiredError(error)) {
      return error.malformedLineCount + error.skippedFileCount
    }
    if (isJsonlScanPathSafetyError(error)) {
      return null
    }
    throw error
  }
}

function isJsonlScanPathSafetyError(error: unknown): boolean {
  return error instanceof Error &&
    (
      error.message.startsWith('Refusing to scan non-file JSONL path:') ||
      error.message.startsWith('Refusing to scan JSONL symlink:')
    )
}

interface RelationEdgeTransition {
  edge: MemoryEdge
  status: 'expired' | 'validated' | 'rejected'
  reason: string
}

function relationEdgeMaintenanceTransitions(memories: SemanticMemory[], edges: MemoryEdge[]): RelationEdgeTransition[] {
  const memoryIds = new Set(memories.map((memory) => memory.id))
  return edges.flatMap((edge): RelationEdgeTransition[] => {
    if ((edge.status !== 'validated' && edge.status !== 'trial') || (memoryIds.has(edge.fromMemoryId) && memoryIds.has(edge.toMemoryId))) {
      return []
    }
    return [{
      edge,
      status: 'expired',
      reason: 'v1.6 daily lifecycle expired orphan relation edge'
    }]
  })
}

function countRelationTransition(result: DailyLifecycleRootResult, status: RelationEdgeTransition['status']): void {
  if (status === 'expired') {
    result.relationEdgesExpired += 1
    return
  }
  if (status === 'validated') {
    result.relationEdgesValidated += 1
    return
  }
  result.relationEdgesRejected += 1
}

function activationStats(memoryId: string, events: ActivationEvent[]): PromotionStats {
  const applied = events.filter((event) => event.memoryId === memoryId && event.event === 'applied')
  const corrected = events.filter((event) => event.memoryId === memoryId && event.event === 'corrected')
  const violated = events.filter((event) => event.memoryId === memoryId && event.event === 'violated')
  return {
    applied: applied.length,
    corrected: corrected.length,
    violated: violated.length,
    appliedEventIds: applied.map((event) => event.id),
    correctedEventIds: corrected.map((event) => event.id),
    violatedEventIds: violated.map((event) => event.id)
  }
}

function autoPromotionEvalItem(input: {
  memory: SemanticMemory
  scope: 'project' | 'global'
  policyId: string
  usedToday: number
  dailyCap: number
  evidenceCount: number
  distinctEvidenceCount: number
}): V5AutoPromotionEvalItem {
  return {
    candidateId: input.memory.id,
    domain: input.memory.domain,
    scope: input.scope,
    source: sourceForEval(input.memory),
    policyId: input.policyId,
    decision: 'auto_promote',
    evidenceCount: input.evidenceCount,
    distinctEvidenceCount: input.distinctEvidenceCount,
    usedToday: input.usedToday,
    dailyCap: input.dailyCap
  }
}

function isExplicitLowRiskGlobalCandidate(memory: SemanticMemory): boolean {
  return (
    GLOBAL_AUTO_PROMOTION_DOMAINS.has(memory.domain) &&
    sourceForEval(memory) === 'user_explicit' &&
    hasExplicitUserEvidence(memory) &&
    isLowRiskLifecycleMemory(memory)
  )
}

function sourceForEval(memory: SemanticMemory): string {
  if (hasExplicitUserEvidence(memory)) {
    return 'user_explicit'
  }
  const evidenceSource = firstEvidenceSource(memory.evidence)
  if (evidenceSource !== undefined) {
    return evidenceSource
  }
  if (memory.reviewState?.source !== undefined) {
    return memory.reviewState.source
  }
  return 'unknown'
}

function hasExplicitUserEvidence(memory: SemanticMemory): boolean {
  return (
    memory.evidence.some((entry) => entry.sourceKind === 'user_explicit') ||
    memory.sourceOfTruth?.startsWith('user_prompt:') === true
  )
}

function firstEvidenceSource(evidence: StructuredEvidence[]): MemorySource | undefined {
  for (const entry of evidence) {
    if (MEMORY_SOURCES.has(entry.sourceKind as MemorySource)) {
      return entry.sourceKind as MemorySource
    }
  }
  return undefined
}

function distinctStructuredEvidenceCount(evidence: StructuredEvidence[]): number {
  const keys = new Set<string>()
  for (const entry of evidence) {
    const explicitKey = firstPresent(entry.id, entry.sourceRef, entry.whatHappened)
    const key = explicitKey ?? createHash('sha256')
      .update(`${entry.sourceKind ?? ''}|${entry.when ?? ''}|${entry.whatHappened}|${entry.whyImportant}`)
      .digest('hex')
    keys.add(key)
  }
  return keys.size
}

function firstPresent(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== '')
}

function hasSourceOfTruthConflict(memory: SemanticMemory): boolean {
  return (
    (memory.reviewState?.conflictsWith?.length ?? 0) > 0 &&
    memory.reviewState?.normalizedKeyConflictResolution !== 'keep_both'
  )
}

function countSameDayAutoPromotions(events: MemoryEvent[], now: string): number {
  const day = now.slice(0, 10)
  return events.filter((event) =>
    event.action === 'promote' &&
    event.at.slice(0, 10) === day &&
    event.details?.decision === 'auto_promote'
  ).length
}

function isCapExhaustedEvalFailure(evalGate: EvalGateResult): boolean {
  return evalGate.results.some((result) =>
    result.findings.some((finding) => finding.reason.includes('daily auto-promotion cap exhausted'))
  )
}

function combineEvalGates(left: EvalGateResult, right: EvalGateResult): EvalGateResult {
  return {
    passed: left.passed && right.passed,
    failedChecks: Array.from(new Set([...left.failedChecks, ...right.failedChecks])),
    results: [...left.results, ...right.results]
  }
}

function addProjectRecommendation(
  state: RootRunState,
  memory: SemanticMemory,
  reason: string,
  stats: PromotionStats,
  evalGate: EvalGateResult | undefined
): void {
  state.result.recommendations += 1
  state.events.push({
    id: randomUUID(),
    action: 'audit',
    at: state.now,
    reason: 'v1.5 daily lifecycle recommended manual review for project trial memory',
    memoryId: memory.id,
    details: {
      lifecyclePolicyId: DAILY_TRIAL_VALIDATION_POLICY_ID,
      reason,
      appliedEvents: stats.applied,
      correctedEvents: stats.corrected,
      violatedEvents: stats.violated,
      activationEventIds: {
        applied: stats.appliedEventIds,
        corrected: stats.correctedEventIds,
        violated: stats.violatedEventIds
      },
      capStatus: {
        scope: 'project',
        usedToday: state.usedToday,
        dailyCap: state.dailyCap
      },
      ...(evalGate === undefined ? {} : { evalGate })
    }
  })
}

function addGlobalRecommendation(
  state: RootRunState,
  memory: SemanticMemory,
  reason: string,
  evalGate: EvalGateResult | undefined,
  lifecycleFindings: string[] = []
): void {
  state.result.recommendations += 1
  state.events.push({
    id: randomUUID(),
    action: 'audit',
    at: state.now,
    reason: 'v1.5 daily lifecycle recommended manual review for global memory candidate',
    candidateId: memory.id,
    details: {
      lifecyclePolicyId: DAILY_EXPLICIT_GLOBAL_CORE_POLICY_ID,
      reason,
      domain: memory.domain,
      module: memory.module,
      source: sourceForEval(memory),
      contentPreview: memory.content.slice(0, 160),
      capStatus: {
        scope: 'global',
        usedToday: state.usedToday,
        dailyCap: state.dailyCap
      },
      ...(lifecycleFindings.length === 0 ? {} : { lifecycleFindings }),
      ...(evalGate === undefined ? {} : { evalGate })
    }
  })
}

function promoteTrialEvent(
  state: RootRunState,
  memory: SemanticMemory,
  stats: PromotionStats,
  evidenceCount: number,
  distinctEvidenceCount: number,
  evalGate: EvalGateResult
): MemoryEvent {
  return {
    id: randomUUID(),
    action: 'promote',
    at: state.now,
    reason: 'v1.5 daily trial validation promoted project trial to validated',
    memoryId: memory.id,
    details: {
      decision: 'auto_promote',
      policyId: PROJECT_AUTO_PROMOTION_POLICY_ID,
      lifecyclePolicyId: DAILY_TRIAL_VALIDATION_POLICY_ID,
      previousConfidenceTier: 'trial',
      confidenceTier: 'validated',
      evidenceCount,
      distinctEvidenceCount,
      appliedEvents: stats.applied,
      correctedEvents: stats.corrected,
      violatedEvents: stats.violated,
      activationEventIds: {
        applied: stats.appliedEventIds,
        corrected: stats.correctedEventIds,
        violated: stats.violatedEventIds
      },
      capStatus: {
        scope: 'project',
        usedToday: state.usedToday,
        dailyCap: state.dailyCap
      },
      evalGate
    }
  }
}

function promoteGlobalEvent(
  state: RootRunState,
  memory: SemanticMemory,
  evidenceCount: number,
  distinctEvidenceCount: number,
  evalGate: EvalGateResult
): MemoryEvent {
  return {
    id: randomUUID(),
    action: 'promote',
    at: state.now,
    reason: 'v1.5 daily lifecycle promoted explicit global instruction to global_core',
    memoryId: memory.id,
    candidateId: memory.id,
    details: {
      decision: 'auto_promote',
      policyId: GLOBAL_AUTO_PROMOTION_POLICY_ID,
      lifecyclePolicyId: DAILY_EXPLICIT_GLOBAL_CORE_POLICY_ID,
      confidenceTier: 'global_core',
      evidenceCount,
      distinctEvidenceCount,
      capStatus: {
        scope: 'global',
        usedToday: state.usedToday,
        dailyCap: state.dailyCap
      },
      evalGate
    }
  }
}

async function readSemanticMemoriesStrictFromRoot(memoryRoot: string): Promise<StrictSemanticReadResult> {
  const filePath = join(memoryRoot, SEMANTIC_MEMORIES_FILE)
  let content: string
  try {
    await assertSafeMemoryDataFileTarget(filePath)
    content = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return { ok: true, records: [] }
    }
    throw error
  }

  const records: SemanticMemory[] = []
  let malformedJsonLines = 0
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }
    try {
      records.push(JSON.parse(trimmed) as SemanticMemory)
    } catch {
      malformedJsonLines += 1
    }
  }

  if (malformedJsonLines > 0) {
    return {
      ok: false,
      malformedJsonLines,
      reason: 'semantic memory store contains malformed JSONL'
    }
  }
  return { ok: true, records }
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function expireTrialEvent(state: RootRunState, memory: SemanticMemory): MemoryEvent {
  return {
    id: randomUUID(),
    action: 'expire',
    at: state.now,
    reason: 'v1.5 daily lifecycle expired stale project trial memory',
    memoryId: memory.id,
    details: {
      lifecyclePolicyId: DAILY_TRIAL_VALIDATION_POLICY_ID,
      previousStatus: memory.status,
      status: 'archived',
      confidenceTier: memory.confidenceTier,
      expiresAt: memory.expiresAt
    }
  }
}

function needsMigrationEvent(state: RootRunState, memory: SemanticMemory, findings: string[]): MemoryEvent {
  return {
    id: randomUUID(),
    action: 'audit',
    at: state.now,
    reason: 'v1.5 daily lifecycle found invalid active memory',
    memoryId: memory.id,
    details: {
      lifecyclePolicyId: state.root.scope === 'global'
        ? DAILY_EXPLICIT_GLOBAL_CORE_POLICY_ID
        : DAILY_TRIAL_VALIDATION_POLICY_ID,
      reason: 'needs_migration',
      findings,
      scope: memory.scope,
      status: memory.status,
      confidenceTier: memory.confidenceTier
    }
  }
}
