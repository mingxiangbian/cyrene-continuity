import { createHash, randomUUID } from 'node:crypto'
import { createDefaultConfig } from '../config.js'
import {
  combineEvalGateResults,
  runV5AutoPromotionEvalGate,
  runV5GlobalAutoPromotionEvalGate,
  type EvalGateResult
} from '../eval/eval-runner.js'
import {
  activationPolicyForConfidenceTier,
  isLowRiskLifecycleMemory,
  isNegativeActivationEventType,
  validateSemanticMemoryLifecycle
} from '../memory/memory-lifecycle.js'
import {
  appendMemoryEventFromRoot,
  readActivationEventsFromRoot,
  readMemoryEventsFromRoot,
  readSemanticMemoriesFromRoot,
  writeSemanticMemoriesFromRoot
} from '../memory/memory-store.js'
import type {
  ActivationEvent,
  ConfidenceTier,
  MemoryEvent,
  MemorySource,
  SemanticMemory
} from '../memory/types.js'
import {
  codexGlobalMemoryRoot,
  codexProjectMemoryRoot,
  getReadableCodexProjectMemoryRoots
} from './codex-memory-root.js'
import {
  assertLifecycleProfileTargetSafe,
  writeLifecycleProfileFromCoreMemory
} from './memory-lifecycle-profile.js'
import { identifyCodexProject } from './project-id.js'

const PROJECT_PROMOTION_POLICY_ID = 'low_risk_project_memory_v1'
const PROJECT_LIFECYCLE_POLICY_ID = 'weekly_project_core_v1'
const GLOBAL_PROMOTION_POLICY_ID = 'review_derived_global_preference_v1'
const GLOBAL_LIFECYCLE_POLICY_ID = 'weekly_global_consolidation_v1'
const PROMOTION_DECISION = 'auto_promote'

const GLOBAL_DOMAINS = new Set(['procedural', 'system'])

export interface WeeklyProjectRootInput { projectId?: string; memoryRoot: string }
export interface WeeklyProjectRootResult {
  memoryRoot: string
  projectId?: string
  promotedValidatedToProjectCore: number
  recommendations: number
  invalidMemories: number
  evalFailures: number
  capExhausted: number
}
export interface WeeklyGlobalResult {
  memoryRoot: string
  promotedToGlobalCore: number
  recommendations: number
  invalidMemories: number
  evalFailures: number
  capExhausted: number
}
export interface WeeklyLifecycleResult {
  action: 'memory_lifecycle_weekly'
  dryRun: boolean
  projectRoots: WeeklyProjectRootResult[]
  global: WeeklyGlobalResult
}

export async function runCodexMemoryLifecycleWeekly(input: {
  cwd?: string
  projectRoots?: WeeklyProjectRootInput[]
  globalRoot?: string
  apply?: boolean
  now?: string
}): Promise<WeeklyLifecycleResult> {
  const cwd = input.cwd ?? process.cwd()
  const dryRun = input.apply !== true
  const now = input.now ?? new Date().toISOString()
  const config = createDefaultConfig(cwd)
  const projectRoots = input.projectRoots ?? await defaultProjectRoots(input.cwd)
  const projectResults: WeeklyProjectRootResult[] = []
  const projectCoreMemories: ProjectCoreMemory[] = []

  for (const root of projectRoots) {
    const project = await runProjectWeekly({
      root,
      dryRun,
      now,
      dailyCap: config.memoryAutoReviewProjectPromotePerDay
    })
    projectResults.push(project.result)
    projectCoreMemories.push(...project.coreMemories)
  }

  const global = await runGlobalWeekly({
    memoryRoot: input.globalRoot ?? codexGlobalMemoryRoot(),
    projectCoreMemories,
    dryRun,
    now,
    dailyCap: config.memoryAutoReviewGlobalPromotePerDay
  })

  return {
    action: 'memory_lifecycle_weekly',
    dryRun,
    projectRoots: projectResults,
    global
  }
}

interface ProjectCoreMemory {
  projectId?: string
  memoryRoot: string
  memory: SemanticMemory
}

interface ProjectPromotion {
  before: SemanticMemory
  after: SemanticMemory
  stats: ActivationStats
  usedToday: number
  dailyCap: number
  evalGate: EvalGateResult
}

interface Recommendation {
  memory: SemanticMemory
  reason: string
  lifecyclePolicyId: string
  evalGate?: EvalGateResult
}

async function runProjectWeekly(input: {
  root: WeeklyProjectRootInput
  dryRun: boolean
  now: string
  dailyCap: number
}): Promise<{ result: WeeklyProjectRootResult; coreMemories: ProjectCoreMemory[] }> {
  const [memories, activationEvents, memoryEvents] = await Promise.all([
    readSemanticMemoriesFromRoot(input.root.memoryRoot),
    readActivationEventsFromRoot(input.root.memoryRoot),
    readMemoryEventsFromRoot(input.root.memoryRoot)
  ])
  const next = [...memories]
  const promotions: ProjectPromotion[] = []
  const recommendations: Recommendation[] = []
  let invalidMemories = 0
  let evalFailures = 0
  let capExhausted = 0
  let usedToday = countAutoPromotionsForDay(memoryEvents, input.now)

  for (const [index, memory] of memories.entries()) {
    if (memory.status !== 'active') {
      continue
    }

    const validationFindings = validateSemanticMemoryLifecycle(memory)
    if (validationFindings.length > 0) {
      invalidMemories += 1
      recommendations.push({
        memory,
        reason: 'invalid/needs_migration',
        lifecyclePolicyId: PROJECT_LIFECYCLE_POLICY_ID
      })
      continue
    }

    if (memory.confidenceTier !== 'validated') {
      continue
    }

    const stats = activationStats(memory.id, activationEvents)
    const lowRisk = isLowRiskLifecycleMemory(memory)
    if (!lowRisk || stats.negative > 0) {
      recommendations.push({
        memory,
        reason: stats.negative > 0 ? 'negative activation feedback' : 'high-risk project memory',
        lifecyclePolicyId: PROJECT_LIFECYCLE_POLICY_ID
      })
      continue
    }

    if (stats.distinctAppliedContexts < 2) {
      continue
    }

    if (usedToday >= input.dailyCap) {
      capExhausted += 1
      recommendations.push({
        memory,
        reason: 'project promotion cap exhausted',
        lifecyclePolicyId: PROJECT_LIFECYCLE_POLICY_ID
      })
      continue
    }

    const evalGate = runV5AutoPromotionEvalGate([{
      candidateId: memory.id,
      domain: memory.domain,
      scope: 'project',
      source: sourceForMemory(memory),
      policyId: PROJECT_PROMOTION_POLICY_ID,
      decision: PROMOTION_DECISION,
      evidenceCount: memory.evidence.length,
      distinctEvidenceCount: stats.distinctAppliedContexts,
      usedToday,
      dailyCap: input.dailyCap
    }])

    if (!evalGate.passed) {
      evalFailures += 1
      recommendations.push({
        memory,
        reason: 'project promotion eval gate failed',
        lifecyclePolicyId: PROJECT_LIFECYCLE_POLICY_ID,
        evalGate
      })
      continue
    }

    const after = withConfidenceTier(memory, 'project_core', input.now)
    const promotedFindings = validateSemanticMemoryLifecycle(after)
    if (promotedFindings.length > 0) {
      invalidMemories += 1
      recommendations.push({
        memory,
        reason: 'invalid/needs_migration',
        lifecyclePolicyId: PROJECT_LIFECYCLE_POLICY_ID
      })
      continue
    }

    next[index] = after
    promotions.push({
      before: memory,
      after,
      stats,
      usedToday,
      dailyCap: input.dailyCap,
      evalGate
    })
    usedToday += 1
  }

  const coreMemories = next
    .filter((memory) => memory.status === 'active' && memory.confidenceTier === 'project_core')
    .map((memory) => ({
      projectId: input.root.projectId,
      memoryRoot: input.root.memoryRoot,
      memory
    }))

  if (!input.dryRun) {
    if (coreMemories.length > 0) {
      await assertLifecycleProfileTargetSafe(input.root.memoryRoot)
    }
    if (promotions.length > 0) {
      await writeSemanticMemoriesFromRoot(input.root.memoryRoot, next)
    }
    if (coreMemories.length > 0) {
      await writeLifecycleProfileFromCoreMemory({
        memoryRoot: input.root.memoryRoot,
        scope: 'project',
        memories: next
      })
    }
    for (const promotion of promotions) {
      await appendMemoryEventFromRoot(input.root.memoryRoot, projectPromotionEvent({
        root: input.root,
        promotion,
        now: input.now
      }))
    }
    for (const recommendation of recommendations) {
      await appendMemoryEventFromRoot(input.root.memoryRoot, recommendationEvent({
        root: input.root,
        recommendation,
        now: input.now,
        scope: 'project'
      }))
    }
  }

  return {
    result: {
      memoryRoot: input.root.memoryRoot,
      projectId: input.root.projectId,
      promotedValidatedToProjectCore: promotions.length,
      recommendations: recommendations.length,
      invalidMemories,
      evalFailures,
      capExhausted
    },
    coreMemories
  }
}

interface GlobalCandidate {
  memory: SemanticMemory
  sources: ProjectCoreMemory[]
  distinctEvidenceCount: number
  usedToday: number
  dailyCap: number
  evalGate: EvalGateResult
}

async function runGlobalWeekly(input: {
  memoryRoot: string
  projectCoreMemories: ProjectCoreMemory[]
  dryRun: boolean
  now: string
  dailyCap: number
}): Promise<WeeklyGlobalResult> {
  const [existing, memoryEvents] = await Promise.all([
    readSemanticMemoriesFromRoot(input.memoryRoot),
    readMemoryEventsFromRoot(input.memoryRoot)
  ])
  const existingContent = new Set(
    existing
      .filter((memory) => memory.status === 'active' && memory.confidenceTier === 'global_core')
      .map((memory) => normalizeContent(memory.content))
  )
  const recommendations: Recommendation[] = []
  let invalidMemories = 0
  let evalFailures = 0
  let capExhausted = 0
  let usedToday = countAutoPromotionsForDay(memoryEvents, input.now)
  const eligibleProjectCoreMemories: ProjectCoreMemory[] = []

  for (const source of input.projectCoreMemories) {
    const ineligible = globalSourceIneligibilityReason(source)
    if (ineligible === null) {
      eligibleProjectCoreMemories.push(source)
      continue
    }
    if (ineligible === 'invalid/needs_migration') {
      invalidMemories += 1
    }
    recommendations.push({
      memory: source.memory,
      reason: ineligible,
      lifecyclePolicyId: GLOBAL_LIFECYCLE_POLICY_ID
    })
  }

  const candidateGroups = globalCandidateGroups(eligibleProjectCoreMemories)
  const candidates: GlobalCandidate[] = []

  for (const group of candidateGroups) {
    const base = group.sources[0]?.memory
    if (base === undefined) {
      continue
    }
    if (existingContent.has(normalizeContent(base.content))) {
      continue
    }

    if (usedToday >= input.dailyCap) {
      capExhausted += 1
      recommendations.push({
        memory: base,
        reason: 'global promotion cap exhausted',
        lifecyclePolicyId: GLOBAL_LIFECYCLE_POLICY_ID
      })
      continue
    }

    const distinctEvidenceCount = distinctGlobalEvidenceCount(group.sources)
    const candidate = globalCoreMemoryFromProjectCore(group.sources, input.now)
    const validationFindings = validateSemanticMemoryLifecycle(candidate)
    if (validationFindings.length > 0) {
      invalidMemories += 1
      recommendations.push({
        memory: base,
        reason: 'invalid/needs_migration',
        lifecyclePolicyId: GLOBAL_LIFECYCLE_POLICY_ID
      })
      continue
    }

    const evalItem = {
      candidateId: candidate.id,
      domain: candidate.domain,
      scope: 'global',
      source: 'review_event',
      policyId: GLOBAL_PROMOTION_POLICY_ID,
      decision: PROMOTION_DECISION,
      evidenceCount: group.sources.length,
      distinctEvidenceCount,
      usedToday,
      dailyCap: input.dailyCap
    }
    const evalGate = combineEvalGateResults([
      runV5AutoPromotionEvalGate([evalItem]),
      runV5GlobalAutoPromotionEvalGate([evalItem])
    ])

    if (!evalGate.passed) {
      evalFailures += 1
      recommendations.push({
        memory: base,
        reason: 'global promotion eval gate failed',
        lifecyclePolicyId: GLOBAL_LIFECYCLE_POLICY_ID,
        evalGate
      })
      continue
    }

    candidates.push({
      memory: candidate,
      sources: group.sources,
      distinctEvidenceCount,
      usedToday,
      dailyCap: input.dailyCap,
      evalGate
    })
    existingContent.add(normalizeContent(candidate.content))
    usedToday += 1
  }

  const next = [...existing, ...candidates.map((candidate) => candidate.memory)]
  const hasGlobalProfileContent = next.some((memory) =>
    memory.status === 'active' &&
    memory.confidenceTier === 'global_core' &&
    isLowRiskLifecycleMemory(memory) &&
    validateSemanticMemoryLifecycle(memory).length === 0
  )

  if (!input.dryRun) {
    if (hasGlobalProfileContent) {
      await assertLifecycleProfileTargetSafe(input.memoryRoot)
    }
    if (candidates.length > 0) {
      await writeSemanticMemoriesFromRoot(input.memoryRoot, next)
    }
    if (hasGlobalProfileContent) {
      await writeLifecycleProfileFromCoreMemory({
        memoryRoot: input.memoryRoot,
        scope: 'global',
        memories: next
      })
    }
    for (const candidate of candidates) {
      await appendMemoryEventFromRoot(input.memoryRoot, globalPromotionEvent({
        memoryRoot: input.memoryRoot,
        candidate,
        now: input.now
      }))
    }
    for (const recommendation of recommendations) {
      await appendMemoryEventFromRoot(input.memoryRoot, recommendationEvent({
        root: { memoryRoot: input.memoryRoot },
        recommendation,
        now: input.now,
        scope: 'global'
      }))
    }
  }

  return {
    memoryRoot: input.memoryRoot,
    promotedToGlobalCore: candidates.length,
    recommendations: recommendations.length,
    invalidMemories,
    evalFailures,
    capExhausted
  }
}

function withConfidenceTier(memory: SemanticMemory, confidenceTier: ConfidenceTier, now: string): SemanticMemory {
  return {
    ...memory,
    confidenceTier,
    activationPolicy: activationPolicyForConfidenceTier(confidenceTier),
    updatedAt: now
  }
}

interface ActivationStats {
  applied: number
  negative: number
  distinctAppliedContexts: number
  appliedContextKeys: string[]
  activationEventIds: string[]
}

function activationStats(memoryId: string, events: ActivationEvent[]): ActivationStats {
  const appliedContextKeys: string[] = []
  const activationEventIds: string[] = []
  let applied = 0
  let negative = 0

  for (const event of events) {
    if (event.memoryId !== memoryId) {
      continue
    }
    if (event.event === 'applied') {
      applied += 1
      activationEventIds.push(event.id)
      appliedContextKeys.push(event.evidenceRef ?? event.activationId ?? event.queryHash ?? event.createdAt)
    }
    if (isNegativeActivationEventType(event.event)) {
      negative += 1
    }
  }

  return {
    applied,
    negative,
    distinctAppliedContexts: new Set(appliedContextKeys).size,
    appliedContextKeys: Array.from(new Set(appliedContextKeys)),
    activationEventIds
  }
}

function sourceForMemory(memory: SemanticMemory): MemorySource {
  const source = memory.reviewState?.source ?? memory.evidence[0]?.sourceKind
  if (
    source === 'file' ||
    source === 'tool_trace' ||
    source === 'user_explicit' ||
    source === 'review_event' ||
    source === 'user_implicit' ||
    source === 'assistant_observed' ||
    source === 'legacy_markdown'
  ) {
    return source
  }
  return 'review_event'
}

interface GlobalCandidateGroup {
  key: string
  sources: ProjectCoreMemory[]
}

function globalCandidateGroups(projectCoreMemories: ProjectCoreMemory[]): GlobalCandidateGroup[] {
  const groups = new Map<string, ProjectCoreMemory[]>()
  for (const source of projectCoreMemories) {
    const key = normalizeContent(source.memory.content)
    groups.set(key, [...(groups.get(key) ?? []), source])
  }

  return Array.from(groups.entries())
    .map(([key, sources]) => ({ key, sources }))
    .filter((group) =>
      distinctProjectCount(group.sources) >= 2 ||
      distinctGlobalEvidenceCount(group.sources) >= 2
    )
}

function globalSourceIneligibilityReason(source: ProjectCoreMemory): string | null {
  const memory = source.memory
  const findings = validateSemanticMemoryLifecycle(memory)
  if (findings.length > 0) {
    return 'invalid/needs_migration'
  }
  if (!isLowRiskLifecycleMemory(memory)) {
    return 'high-risk project_core memory'
  }
  if (!GLOBAL_DOMAINS.has(memory.domain)) {
    return 'not procedural/system global content'
  }
  if (containsProjectSpecificDetail(memory.content)) {
    return 'project-specific global candidate'
  }
  return null
}

function globalCoreMemoryFromProjectCore(sources: ProjectCoreMemory[], now: string): SemanticMemory {
  const base = sources[0]?.memory
  if (base === undefined) {
    throw new Error('Cannot build global_core memory without project_core sources')
  }
  const normalized = normalizeContent(base.content)
  return {
    ...base,
    id: `global-${createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`,
    module: base.domain === 'system' ? 'system' : 'global_policy',
    scope: 'global',
    confidenceTier: 'global_core',
    activationPolicy: activationPolicyForConfidenceTier('global_core'),
    evidence: sources.map((source, index) => ({
      id: `weekly-global-${index + 1}-${source.memory.id}`,
      sourceKind: 'review_event',
      sourceRef: `weekly:${source.projectId ?? source.memoryRoot}:${source.memory.id}`,
      when: now,
      whatHappened: `Project core memory ${source.memory.id} repeated this global candidate.`,
      whyImportant: 'Repeated low-risk project_core content can be consolidated into global_core.',
      result: `sourceProject=${source.projectId ?? 'unknown'}`
    })),
    routing: {
      module: base.domain === 'system' ? 'system' : 'global_policy',
      updatePolicy: 'strict_auto_promote',
      risk: 'low',
      reasons: ['weekly_global_consolidation']
    },
    reviewPolicy: 'strict_auto_promote',
    reviewState: {
      ...base.reviewState,
      source: 'review_event',
      portability: 'global',
      scores: base.reviewState?.scores,
      tags: Array.from(new Set([...(base.reviewState?.tags ?? []), 'global_core', 'weekly_global_consolidation']))
    },
    createdAt: now,
    updatedAt: now
  }
}

function distinctProjectCount(sources: ProjectCoreMemory[]): number {
  return new Set(sources.map((source) => source.projectId ?? source.memoryRoot)).size
}

function distinctGlobalEvidenceCount(sources: ProjectCoreMemory[]): number {
  const keys = sources.flatMap((source) => {
    const evidenceKeys = source.memory.evidence.map((evidence) =>
      evidence.sourceRef || evidence.id || JSON.stringify(evidence)
    )
    return evidenceKeys.length > 0 ? evidenceKeys : [source.memory.id]
  })
  return new Set(keys).size
}

function containsProjectSpecificDetail(content: string): boolean {
  const normalized = content.toLowerCase()
  return (
    /(^|[\s`'"([{<:=,;])\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-][^\s`'")\]}>]*/.test(content) ||
    /(^|[\s`'"([{<:=,;])[A-Za-z]:\\(?:[^\\\s`'")\]}>]+\\)+[^\\\s`'")\]}>]+/.test(content) ||
    /\b(this|current)\s+(repo|repository|project|workspace)\b/.test(normalized)
  )
}

function projectPromotionEvent(input: {
  root: WeeklyProjectRootInput
  promotion: ProjectPromotion
  now: string
}): MemoryEvent {
  return {
    id: randomUUID(),
    action: 'promote',
    at: input.now,
    reason: 'v1.5 weekly promoted validated memory to project_core',
    memoryId: input.promotion.after.id,
    details: {
      decision: PROMOTION_DECISION,
      lifecyclePolicyId: PROJECT_LIFECYCLE_POLICY_ID,
      policyId: PROJECT_PROMOTION_POLICY_ID,
      projectId: input.root.projectId,
      previousConfidenceTier: input.promotion.before.confidenceTier,
      confidenceTier: input.promotion.after.confidenceTier,
      evidenceCount: input.promotion.after.evidence.length,
      distinctEvidenceCount: input.promotion.stats.distinctAppliedContexts,
      activationEventIds: input.promotion.stats.activationEventIds,
      appliedContextKeys: input.promotion.stats.appliedContextKeys,
      capStatus: {
        usedToday: input.promotion.usedToday,
        dailyCap: input.promotion.dailyCap
      },
      evalGate: input.promotion.evalGate
    }
  }
}

function globalPromotionEvent(input: {
  memoryRoot: string
  candidate: GlobalCandidate
  now: string
}): MemoryEvent {
  return {
    id: randomUUID(),
    action: 'promote',
    at: input.now,
    reason: 'v1.5 weekly consolidated project_core memory into global_core',
    memoryId: input.candidate.memory.id,
    details: {
      decision: PROMOTION_DECISION,
      lifecyclePolicyId: GLOBAL_LIFECYCLE_POLICY_ID,
      policyId: GLOBAL_PROMOTION_POLICY_ID,
      sourceMemoryIds: input.candidate.sources.map((source) => source.memory.id),
      sourceProjectIds: input.candidate.sources.map((source) => source.projectId ?? null),
      sourceMemoryRoots: input.candidate.sources.map((source) => source.memoryRoot),
      evidenceCount: input.candidate.sources.length,
      distinctEvidenceCount: input.candidate.distinctEvidenceCount,
      capStatus: {
        usedToday: input.candidate.usedToday,
        dailyCap: input.candidate.dailyCap
      },
      memoryRoot: input.memoryRoot,
      evalGate: input.candidate.evalGate
    }
  }
}

function recommendationEvent(input: {
  root: WeeklyProjectRootInput
  recommendation: Recommendation
  now: string
  scope: 'project' | 'global'
}): MemoryEvent {
  return {
    id: randomUUID(),
    action: 'audit',
    at: input.now,
    reason: input.scope === 'global'
      ? 'v1.5 weekly recommended manual review for global consolidation'
      : 'v1.5 weekly recommended manual review for project memory',
    memoryId: input.recommendation.memory.id,
    details: {
      lifecyclePolicyId: input.recommendation.lifecyclePolicyId,
      scope: input.scope,
      projectId: input.root.projectId,
      reason: input.recommendation.reason,
      contentPreview: input.recommendation.memory.content.slice(0, 160),
      confidenceTier: input.recommendation.memory.confidenceTier,
      domain: input.recommendation.memory.domain,
      module: input.recommendation.memory.module,
      evalGate: input.recommendation.evalGate
    }
  }
}

function countAutoPromotionsForDay(events: MemoryEvent[], now: string): number {
  const day = now.slice(0, 10)
  return events.filter((event) =>
    event.action === 'promote' &&
    event.at.slice(0, 10) === day &&
    event.details?.decision === PROMOTION_DECISION
  ).length
}

function normalizeContent(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim()
}

async function defaultProjectRoots(cwd: string | undefined): Promise<WeeklyProjectRootInput[]> {
  if (cwd !== undefined) {
    const project = await identifyCodexProject(cwd)
    return [{ projectId: project.projectId, memoryRoot: codexProjectMemoryRoot(project.projectId) }]
  }
  return (await getReadableCodexProjectMemoryRoots()).map((memoryRoot) => ({ memoryRoot }))
}
