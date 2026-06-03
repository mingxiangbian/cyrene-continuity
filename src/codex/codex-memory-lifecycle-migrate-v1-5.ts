import { randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  activationPolicyForConfidenceTier,
  validateSemanticMemoryLifecycle
} from '../memory/memory-lifecycle.js'
import {
  activeMemoryToSemanticMemory,
  pendingMemoryToSemanticMemory,
  semanticMemoryToActiveMemory,
  semanticMemoryToPendingMemory
} from '../memory/semantic-memory-adapter.js'
import {
  appendMemoryEventFromRoot,
  assertSafeMemoryDataFileTarget,
  writeSemanticMemoriesFromRoot
} from '../memory/memory-store.js'
import { withMemoryMaintenanceLockFromRoot } from '../memory/memory-maintenance.js'
import {
  ACTIVATION_MODES,
  ADMISSION_ACTIONS,
  CONFIDENCE_TIERS,
  MEMORY_CANDIDATE_KINDS,
  MEMORY_DOMAINS,
  MEMORY_MODULES,
  MEMORY_SCOPES,
  MEMORY_SOURCES,
  MEMORY_STRENGTHS,
  MEMORY_TYPES,
  RUNTIME_ACTIVATION_STRENGTHS,
  SEMANTIC_MEMORY_STATUSES,
  UPDATE_POLICIES
} from '../memory/types.js'
import type {
  ActivationPolicy,
  ConfidenceTier,
  CyreneMemory,
  MemoryDomain,
  MemoryEvent,
  MemoryScores,
  PendingMemory,
  SemanticMemory
} from '../memory/types.js'
import {
  codexGlobalMemoryRoot,
  codexProjectMemoryRoot
} from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'
import { listCodexProjects } from './project-registry.js'

const LEGACY_INDEX_FILE = 'index.jsonl'
const LEGACY_PENDING_FILE = 'pending.jsonl'
const SEMANTIC_MEMORIES_FILE = 'semantic_memories.jsonl'
const REVIEW_QUEUE_FILE = 'review_queue.jsonl'
const HIGH_RISK_DOMAINS = new Set<MemoryDomain>(['personal', 'relationship', 'affective'])
const LOW_RISK_DOMAINS = new Set<MemoryDomain>(['project', 'procedural', 'system'])
const REVIEW_SUMMARY_NOISE_PHRASES = [
  'review summary ok',
  'merged branch',
  'deleted local branch'
]
const MEMORY_PORTABILITIES = ['local_only', 'project_family', 'similar_project', 'global'] as const
const MEMORY_PROFILE_VISIBILITIES = ['always', 'safe_summary', 'retrieval_only', 'never'] as const
const ROUTING_RISKS = ['low', 'medium', 'high'] as const
const ADMITTED_BY_VALUES = ['admission_gate_v1'] as const
const NORMALIZED_KEY_CONFLICT_RESOLUTIONS = ['keep_both'] as const

export interface CodexMemoryLifecycleMigrateV15Input {
  cwd: string
  allProjects?: boolean
  apply?: boolean
  now?: string
}

export interface CodexMemoryLifecycleMigrateV15RootResult {
  scope: 'global' | 'project'
  projectId?: string
  memoryRoot: string
  skipped?: boolean
  reason?: string
  legacyActiveBefore: number
  legacyPendingBefore: number
  semanticBefore: number
  semanticActiveBefore: number
  semanticPendingBefore: number
  semanticAfter: number
  malformedJsonLines: number
  convertedPendingToTrial: number
  convertedActiveToValidated: number
  convertedActiveToCore: number
  droppedPending: number
  droppedActive: number
  recommendations: number
  duplicateRecordsDropped: number
}

export interface CodexMemoryLifecycleMigrateV15Result {
  action: 'migrate_memory_lifecycle_v1_5'
  dryRun: boolean
  roots: CodexMemoryLifecycleMigrateV15RootResult[]
}

interface MemoryRootSpec {
  scope: 'global' | 'project'
  projectId?: string
  memoryRoot: string
}

interface Recommendation {
  id: string
  sourceStatus: 'active' | 'pending'
  domain: string
  type: string
  normalizedKey: string
  content: string
  reason: string
  reviewPackage: RecommendationReviewPackage
}

interface RecommendationReviewPackage {
  source: 'legacy_index' | 'legacy_pending' | 'semantic_memory'
  sourceStatus: 'active' | 'pending'
  domain: string
  type: string
  normalizedKey: string
  content: string
  evidence: unknown[]
  scores?: MemoryScores
  reviewState?: SemanticMemory['reviewState']
  tags: string[]
  originalRecord: CyreneMemory | PendingMemory | SemanticMemory
}

interface JsonLinesReadResult<T> {
  records: T[]
  malformedLines: number
}

interface DropAudit {
  id: string
  source: RecommendationReviewPackage['source']
  sourceStatus: 'active' | 'pending'
  domain: string
  type: string
  normalizedKey: string
  content: string
  dropReason: string
  originalRecord: CyreneMemory | PendingMemory | SemanticMemory
}

export async function runCodexMemoryLifecycleMigrateV15(
  input: CodexMemoryLifecycleMigrateV15Input
): Promise<CodexMemoryLifecycleMigrateV15Result> {
  const currentProject = await identifyCodexProject(input.cwd)
  const roots = new Map<string, MemoryRootSpec>()
  const addRoot = (root: MemoryRootSpec) => {
    roots.set(`${root.scope}:${root.projectId ?? 'global'}:${root.memoryRoot}`, root)
  }

  addRoot({ scope: 'global', memoryRoot: codexGlobalMemoryRoot() })
  addRoot({
    scope: 'project',
    projectId: currentProject.projectId,
    memoryRoot: codexProjectMemoryRoot(currentProject.projectId)
  })
  let registryFailure: CodexMemoryLifecycleMigrateV15RootResult | undefined
  if (input.allProjects === true) {
    try {
      for (const project of await listCodexProjects()) {
        addRoot({ scope: 'project', projectId: project.projectId, memoryRoot: project.memoryRoot })
      }
    } catch (error) {
      registryFailure = skippedRootResult(
        { scope: 'project', memoryRoot: join(codexGlobalMemoryRoot(), '..', '..', 'projects') },
        `project registry listing failed: ${errorMessage(error)}`
      )
    }
  }

  const dryRun = input.apply !== true
  const now = input.now ?? new Date().toISOString()
  const results: CodexMemoryLifecycleMigrateV15RootResult[] = []
  for (const root of roots.values()) {
    const readable = await readableMemoryRoot(root.memoryRoot)
    if (!readable.ok) {
      results.push(skippedRootResult(root, readable.reason))
      continue
    }
    const readableRoot = { ...root, memoryRoot: readable.memoryRoot }
    if (dryRun) {
      results.push(await migrateReadableRoot(readableRoot, { dryRun, now }))
      continue
    }
    results.push(await withMemoryMaintenanceLockFromRoot(readableRoot.memoryRoot, (lockedMemoryRoot) =>
      migrateReadableRoot({ ...readableRoot, memoryRoot: lockedMemoryRoot }, { dryRun, now })
    ))
  }
  if (registryFailure !== undefined) {
    results.push(registryFailure)
  }

  return {
    action: 'migrate_memory_lifecycle_v1_5',
    dryRun,
    roots: results
  }
}

async function migrateReadableRoot(
  root: MemoryRootSpec,
  input: { dryRun: boolean; now: string }
): Promise<CodexMemoryLifecycleMigrateV15RootResult> {
  const [legacyActiveRead, legacyPendingRead, semanticRead] = await Promise.all([
    readJsonLinesWithMalformed<CyreneMemory>(join(root.memoryRoot, LEGACY_INDEX_FILE), isValidLegacyActiveMemory),
    readJsonLinesWithMalformed<PendingMemory>(join(root.memoryRoot, LEGACY_PENDING_FILE), isValidPendingMemory),
    readJsonLinesWithMalformed<SemanticMemory>(join(root.memoryRoot, SEMANTIC_MEMORIES_FILE), isValidSemanticMemory)
  ])
  const legacyActive = legacyActiveRead.records
  const legacyPending = legacyPendingRead.records
  const existingSemantic = semanticRead.records
  const active = legacyActive.filter((memory) => memory.status === 'active')
  const pending = legacyPending.filter((memory) => memory.status === 'pending')
  const semanticActive = existingSemantic.filter((memory) => memory.status === 'active')
  const semanticPending = existingSemantic.filter((memory) => memory.status === 'pending')
  const malformedJsonLines = legacyActiveRead.malformedLines + legacyPendingRead.malformedLines + semanticRead.malformedLines
  const processedIds = new Set<string>()
  const semanticRowsToRemove = new Set<SemanticMemory>()
  const converted: SemanticMemory[] = []
  const recommendations: Recommendation[] = []
  const dropAudits: DropAudit[] = []
  const result = baseRootResult(root, {
    legacyActiveBefore: active.length,
    legacyPendingBefore: pending.length,
    semanticBefore: existingSemantic.length,
    semanticActiveBefore: semanticActive.length,
    semanticPendingBefore: semanticPending.length,
    malformedJsonLines
  })
  if (malformedJsonLines > 0) {
    return {
      ...result,
      skipped: true,
      reason: 'memory root contains malformed JSONL'
    }
  }

  const semanticOwnedIds = new Set(existingSemantic.map((memory) => memory.id))
  const selectedSemanticIds = new Set<string>()
  const selectedSemanticActive: SemanticMemory[] = []
  const selectedSemanticPending: SemanticMemory[] = []
  for (const memory of semanticActive) {
    if (selectedSemanticIds.has(memory.id)) {
      semanticRowsToRemove.add(memory)
      recordDuplicateDrop(result, dropAudits, dropAuditForSemantic(
        memory,
        'active',
        semanticMemoryToActiveMemory(memory),
        'duplicate semantic active id shadowed by selected semantic memory'
      ))
      continue
    }
    selectedSemanticIds.add(memory.id)
    selectedSemanticActive.push(memory)
  }
  for (const memory of semanticPending) {
    const pendingMemory = semanticMemoryToPendingMemory(memory)
    if (selectedSemanticIds.has(memory.id)) {
      semanticRowsToRemove.add(memory)
      recordDuplicateDrop(result, dropAudits, dropAuditForSemantic(
        memory,
        'pending',
        pendingMemory,
        'duplicate semantic pending id shadowed by selected semantic memory'
      ))
      continue
    }
    selectedSemanticIds.add(memory.id)
    selectedSemanticPending.push(memory)
  }

  const selectedLegacyActive: CyreneMemory[] = []
  const legacyActiveIds = new Set<string>()
  for (const memory of active) {
    if (semanticOwnedIds.has(memory.id)) {
      recordDuplicateDrop(result, dropAudits, dropAuditForActive(memory, 'duplicate legacy active id shadowed by semantic memory'))
      continue
    }
    if (legacyActiveIds.has(memory.id)) {
      recordDuplicateDrop(result, dropAudits, dropAuditForActive(memory, 'duplicate legacy active id shadowed by earlier active memory'))
      continue
    }
    legacyActiveIds.add(memory.id)
    selectedLegacyActive.push(memory)
  }

  const selectedLegacyPending: PendingMemory[] = []
  const legacyPendingIds = new Set<string>()
  for (const memory of pending) {
    if (semanticOwnedIds.has(memory.id)) {
      recordDuplicateDrop(result, dropAudits, dropAuditForPending(memory, 'duplicate legacy pending id shadowed by semantic memory'))
      continue
    }
    if (legacyActiveIds.has(memory.id)) {
      recordDuplicateDrop(result, dropAudits, dropAuditForPending(memory, 'duplicate pending id shadowed by active memory'))
      continue
    }
    if (legacyPendingIds.has(memory.id)) {
      recordDuplicateDrop(result, dropAudits, dropAuditForPending(memory, 'duplicate legacy pending id shadowed by earlier pending memory'))
      continue
    }
    legacyPendingIds.add(memory.id)
    selectedLegacyPending.push(memory)
  }

  for (const memory of selectedSemanticActive) {
    if (validateSemanticMemoryLifecycle(memory).length === 0) {
      continue
    }
    processedIds.add(memory.id)
    const activeMemory = semanticMemoryToActiveMemory(memory)
    if (isLowValueNoise(activeMemory)) {
      result.droppedActive += 1
      dropAudits.push(dropAuditForSemantic(memory, 'active', activeMemory, 'low-value memory'))
      continue
    }
    const recommendationReason = recommendationReasonForActive(root.scope, activeMemory)
    if (recommendationReason !== undefined) {
      result.recommendations += 1
      recommendations.push(recommendationForSemantic(memory, 'active', activeMemory, recommendationReason))
      continue
    }

    const tier = semanticLifecycleTierForActive(root.scope, memory, activeMemory, input.now)
    if (tier === undefined) {
      result.recommendations += 1
      recommendations.push(recommendationForSemantic(
        memory,
        'active',
        activeMemory,
        'semantic active memory cannot be migrated to a valid v1.5 lifecycle tier'
      ))
      continue
    }
    converted.push(withLifecycle(memory, tier, input.now))
    if (tier === 'validated') {
      result.convertedActiveToValidated += 1
    } else {
      result.convertedActiveToCore += 1
    }
  }

  for (const memory of selectedSemanticPending) {
    if (processedIds.has(memory.id)) {
      continue
    }
    processedIds.add(memory.id)
    const pendingMemory = semanticMemoryToPendingMemory(memory)
    if (isReviewSummaryNoise(pendingMemory)) {
      result.droppedPending += 1
      dropAudits.push(dropAuditForSemantic(memory, 'pending', pendingMemory, 'review-summary noise'))
      continue
    }
    if (isLowValueNoise(pendingMemory)) {
      result.droppedPending += 1
      dropAudits.push(dropAuditForSemantic(memory, 'pending', pendingMemory, 'low-value memory'))
      continue
    }
    const recommendationReason = recommendationReasonForPending(root.scope, pendingMemory)
    if (recommendationReason !== undefined || root.scope === 'global') {
      result.recommendations += 1
      recommendations.push(recommendationForSemantic(
        memory,
        'pending',
        pendingMemory,
        recommendationReason ?? 'global pending memory requires manual review'
      ))
      continue
    }

    converted.push(withLifecycle(memory, 'trial', input.now))
    result.convertedPendingToTrial += 1
  }

  for (const memory of selectedLegacyActive) {
    processedIds.add(memory.id)
    if (isLowValueNoise(memory)) {
      result.droppedActive += 1
      dropAudits.push(dropAuditForActive(memory, 'low-value memory'))
      continue
    }
    const recommendationReason = recommendationReasonForActive(root.scope, memory)
    if (recommendationReason !== undefined) {
      result.recommendations += 1
      recommendations.push(recommendationForActive(memory, recommendationReason))
      continue
    }

    const tier = root.scope === 'global' ? 'global_core' : projectTierForActive(memory)
    converted.push(withLifecycle(activeMemoryToSemanticMemory(memory), tier, input.now))
    if (tier === 'validated') {
      result.convertedActiveToValidated += 1
    } else {
      result.convertedActiveToCore += 1
    }
  }

  for (const memory of selectedLegacyPending) {
    processedIds.add(memory.id)
    if (isReviewSummaryNoise(memory)) {
      result.droppedPending += 1
      dropAudits.push(dropAuditForPending(memory, 'review-summary noise'))
      continue
    }
    if (isLowValueNoise(memory)) {
      result.droppedPending += 1
      dropAudits.push(dropAuditForPending(memory, 'low-value memory'))
      continue
    }
    const recommendationReason = recommendationReasonForPending(root.scope, memory)
    if (recommendationReason !== undefined || root.scope === 'global') {
      result.recommendations += 1
      recommendations.push(recommendationForPending(memory, recommendationReason ?? 'global pending memory requires manual review'))
      continue
    }

    converted.push(withLifecycle(pendingMemoryToSemanticMemory(memory), 'trial', input.now))
    result.convertedPendingToTrial += 1
  }

  const nextSemantic = upsertSemanticMemories(
    existingSemantic.filter((memory) => !processedIds.has(memory.id) && !semanticRowsToRemove.has(memory)),
    converted
  )
  result.semanticAfter = nextSemantic.length

  if (!input.dryRun) {
    for (const recommendation of recommendations) {
      await appendMemoryEventFromRoot(root.memoryRoot, recommendationEvent(root, recommendation, input.now))
    }
    for (const audit of dropAudits) {
      await appendMemoryEventFromRoot(root.memoryRoot, dropAuditEvent(root, audit, input.now))
    }
    await writeSemanticMemoriesFromRoot(root.memoryRoot, nextSemantic)
    await writeJsonLinesAtomic(join(root.memoryRoot, REVIEW_QUEUE_FILE), [])
    await removeMemoryDataFileIfExists(join(root.memoryRoot, LEGACY_INDEX_FILE))
    await removeMemoryDataFileIfExists(join(root.memoryRoot, LEGACY_PENDING_FILE))
    await appendMemoryEventFromRoot(root.memoryRoot, completionEvent(result, input.now))
  }

  return result
}

function withLifecycle(memory: SemanticMemory, confidenceTier: ConfidenceTier, now: string): SemanticMemory {
  return {
    ...memory,
    status: 'active',
    confidenceTier,
    activationPolicy: activationPolicyForConfidenceTier(confidenceTier),
    updatedAt: now
  }
}

function projectTierForActive(memory: CyreneMemory): ConfidenceTier {
  if (
    memory.strength === 'hard' &&
    hasEvidence(memory.evidence) &&
    memory.scores.evidenceStrength >= 0.85 &&
    memory.scores.stability >= 0.75 &&
    memory.scores.usefulness >= 0.75
  ) {
    return 'project_core'
  }
  return 'validated'
}

function semanticLifecycleTierForActive(
  scope: 'global' | 'project',
  memory: SemanticMemory,
  activeMemory: CyreneMemory,
  now: string
): ConfidenceTier | undefined {
  const preferredTier = scope === 'global' ? 'global_core' : projectTierForActive(activeMemory)
  if (validateSemanticMemoryLifecycle(withLifecycle(memory, preferredTier, now)).length === 0) {
    return preferredTier
  }
  if (
    scope === 'project' &&
    preferredTier === 'project_core' &&
    validateSemanticMemoryLifecycle(withLifecycle(memory, 'validated', now)).length === 0
  ) {
    return 'validated'
  }
  return undefined
}

function recommendationReasonForPending(scope: 'global' | 'project', memory: PendingMemory): string | undefined {
  if (scope === 'global') {
    if (isLowValueNoise(memory)) {
      return undefined
    }
    return isHighRiskOrAmbiguous(memory) ? highRiskReason(memory) : 'global pending memory requires manual review'
  }
  if (isHighRiskOrAmbiguous(memory)) {
    return highRiskReason(memory)
  }
  if (!isValuableLowRiskMemory(memory)) {
    return 'ambiguous project pending memory requires manual review'
  }
  return undefined
}

function recommendationReasonForActive(scope: 'global' | 'project', memory: CyreneMemory): string | undefined {
  if (scope === 'global') {
    if (isLowRiskGlobalCoreMemory(memory)) {
      return undefined
    }
    return isHighRiskOrAmbiguous(memory)
      ? highRiskReason(memory)
      : 'ambiguous global active memory requires manual review'
  }
  if (isHighRiskOrAmbiguous(memory)) {
    return highRiskReason(memory)
  }
  if (!isValuableLowRiskMemory(memory)) {
    return 'ambiguous project active memory requires manual review'
  }
  return undefined
}

function isLowRiskGlobalCoreMemory(memory: CyreneMemory): boolean {
  return (
    isValuableLowRiskMemory(memory) &&
    memory.scope === 'global' &&
    (memory.domain === 'procedural' || memory.domain === 'system' || memory.type === 'procedural_rule' || memory.type === 'system_policy')
  )
}

function isValuableLowRiskMemory(memory: CyreneMemory | PendingMemory): boolean {
  return (
    LOW_RISK_DOMAINS.has(memory.domain) &&
    !HIGH_RISK_DOMAINS.has(memory.domain) &&
    hasEvidence(memory.evidence) &&
    memory.scores.safety >= 0.8 &&
    memory.scores.sensitivity <= 0.35 &&
    memory.scores.evidenceStrength >= 0.6 &&
    memory.scores.usefulness >= 0.6 &&
    memory.content.trim().length >= 20
  )
}

function isHighRiskOrAmbiguous(memory: CyreneMemory | PendingMemory): boolean {
  return (
    HIGH_RISK_DOMAINS.has(memory.domain) ||
    memory.scores.safety < 0.8 ||
    memory.scores.sensitivity > 0.35 ||
    !LOW_RISK_DOMAINS.has(memory.domain)
  )
}

function highRiskReason(memory: CyreneMemory | PendingMemory): string {
  if (HIGH_RISK_DOMAINS.has(memory.domain)) {
    return `high-risk ${memory.domain} memory requires manual review`
  }
  if (memory.scores.sensitivity > 0.35) {
    return 'high-sensitivity memory requires manual review'
  }
  if (memory.scores.safety < 0.8) {
    return 'low-safety memory requires manual review'
  }
  return 'ambiguous memory domain requires manual review'
}

function isReviewSummaryNoise(memory: CyreneMemory | PendingMemory): boolean {
  const haystack = [
    memory.content,
    memory.normalizedKey,
    memory.sourceOfTruth ?? '',
    ...memory.evidence.flatMap((entry) => [entry.summary ?? '', entry.quote ?? '', ...(entry.traceRefs ?? [])])
  ].join('\n').toLowerCase()
  return REVIEW_SUMMARY_NOISE_PHRASES.some((phrase) => haystack.includes(phrase))
}

function isLowValueNoise(memory: CyreneMemory | PendingMemory): boolean {
  return (
    !isHighRiskOrAmbiguous(memory) &&
    (memory.scores.usefulness <= 0.25 || memory.scores.evidenceStrength <= 0.25 || memory.content.trim().length < 12)
  )
}

function hasEvidence(evidence: Array<{ summary?: string; quote?: string; runId?: string; evidenceGroupId?: string }>): boolean {
  return evidence.some((entry) =>
    [entry.summary, entry.quote, entry.runId, entry.evidenceGroupId].some((value) => value !== undefined && value.trim() !== '')
  )
}

function recordDuplicateDrop(
  result: CodexMemoryLifecycleMigrateV15RootResult,
  dropAudits: DropAudit[],
  audit: DropAudit
): void {
  result.duplicateRecordsDropped += 1
  if (audit.sourceStatus === 'active') {
    result.droppedActive += 1
  } else {
    result.droppedPending += 1
  }
  dropAudits.push(audit)
}

function recommendationForPending(memory: PendingMemory, reason: string): Recommendation {
  return {
    id: memory.id,
    sourceStatus: 'pending',
    domain: memory.domain,
    type: memory.type,
    normalizedKey: memory.normalizedKey,
    content: memory.content,
    reason,
    reviewPackage: {
      source: 'legacy_pending',
      sourceStatus: 'pending',
      domain: memory.domain,
      type: memory.type,
      normalizedKey: memory.normalizedKey,
      content: memory.content,
      evidence: memory.evidence,
      scores: memory.scores,
      tags: memory.tags,
      originalRecord: memory
    }
  }
}

function recommendationForActive(memory: CyreneMemory, reason: string): Recommendation {
  return {
    id: memory.id,
    sourceStatus: 'active',
    domain: memory.domain,
    type: memory.type,
    normalizedKey: memory.normalizedKey,
    content: memory.content,
    reason,
    reviewPackage: {
      source: 'legacy_index',
      sourceStatus: 'active',
      domain: memory.domain,
      type: memory.type,
      normalizedKey: memory.normalizedKey,
      content: memory.content,
      evidence: memory.evidence,
      scores: memory.scores,
      tags: memory.tags,
      originalRecord: memory
    }
  }
}

function recommendationForSemantic(
  memory: SemanticMemory,
  sourceStatus: 'active' | 'pending',
  normalizedMemory: CyreneMemory | PendingMemory,
  reason: string
): Recommendation {
  return {
    id: memory.id,
    sourceStatus,
    domain: memory.domain,
    type: normalizedMemory.type,
    normalizedKey: normalizedMemory.normalizedKey,
    content: memory.content,
    reason,
    reviewPackage: {
      source: 'semantic_memory',
      sourceStatus,
      domain: memory.domain,
      type: normalizedMemory.type,
      normalizedKey: normalizedMemory.normalizedKey,
      content: memory.content,
      evidence: memory.evidence,
      scores: memory.reviewState?.scores ?? normalizedMemory.scores,
      reviewState: memory.reviewState,
      tags: memory.reviewState?.tags ?? [memory.kind],
      originalRecord: memory
    }
  }
}

function dropAuditForPending(memory: PendingMemory, dropReason: string): DropAudit {
  return {
    id: memory.id,
    source: 'legacy_pending',
    sourceStatus: 'pending',
    domain: memory.domain,
    type: memory.type,
    normalizedKey: memory.normalizedKey,
    content: memory.content,
    dropReason,
    originalRecord: memory
  }
}

function dropAuditForActive(memory: CyreneMemory, dropReason: string): DropAudit {
  return {
    id: memory.id,
    source: 'legacy_index',
    sourceStatus: 'active',
    domain: memory.domain,
    type: memory.type,
    normalizedKey: memory.normalizedKey,
    content: memory.content,
    dropReason,
    originalRecord: memory
  }
}

function dropAuditForSemantic(
  memory: SemanticMemory,
  sourceStatus: 'active' | 'pending',
  normalizedMemory: CyreneMemory | PendingMemory,
  dropReason: string
): DropAudit {
  return {
    id: memory.id,
    source: 'semantic_memory',
    sourceStatus,
    domain: memory.domain,
    type: normalizedMemory.type,
    normalizedKey: normalizedMemory.normalizedKey,
    content: memory.content,
    dropReason,
    originalRecord: memory
  }
}

function recommendationEvent(root: MemoryRootSpec, recommendation: Recommendation, now: string): MemoryEvent {
  return {
    id: randomUUID(),
    action: 'audit',
    at: now,
    reason: 'v1.5 migration recommended manual review for high-risk memory',
    ...(recommendation.sourceStatus === 'active' ? { memoryId: recommendation.id } : { candidateId: recommendation.id }),
    details: {
      migration: 'memory_lifecycle_v1_5',
      scope: root.scope,
      projectId: root.projectId,
      sourceStatus: recommendation.sourceStatus,
      domain: recommendation.domain,
      type: recommendation.type,
      normalizedKey: recommendation.normalizedKey,
      reason: recommendation.reason,
      contentPreview: recommendation.content.slice(0, 160),
      reviewPackage: recommendation.reviewPackage
    }
  }
}

function dropAuditEvent(root: MemoryRootSpec, audit: DropAudit, now: string): MemoryEvent {
  return {
    id: randomUUID(),
    action: 'audit',
    at: now,
    reason: audit.dropReason === 'low-value memory'
      ? 'v1.5 migration dropped low-value memory'
      : 'v1.5 migration dropped memory',
    ...(audit.sourceStatus === 'active' ? { memoryId: audit.id } : { candidateId: audit.id }),
    details: {
      migration: 'memory_lifecycle_v1_5',
      scope: root.scope,
      projectId: root.projectId,
      id: audit.id,
      source: audit.source,
      sourceStatus: audit.sourceStatus,
      domain: audit.domain,
      type: audit.type,
      normalizedKey: audit.normalizedKey,
      dropReason: audit.dropReason,
      contentPreview: audit.content.slice(0, 160),
      originalRecord: audit.originalRecord
    }
  }
}

function completionEvent(result: CodexMemoryLifecycleMigrateV15RootResult, now: string): MemoryEvent {
  return {
    id: randomUUID(),
    action: 'audit',
    at: now,
    reason: 'completed v1.5 memory lifecycle migration',
    details: {
      migration: 'memory_lifecycle_v1_5',
      scope: result.scope,
      projectId: result.projectId,
      legacyActiveBefore: result.legacyActiveBefore,
      legacyPendingBefore: result.legacyPendingBefore,
      semanticBefore: result.semanticBefore,
      semanticActiveBefore: result.semanticActiveBefore,
      semanticPendingBefore: result.semanticPendingBefore,
      semanticAfter: result.semanticAfter,
      malformedJsonLines: result.malformedJsonLines,
      convertedPendingToTrial: result.convertedPendingToTrial,
      convertedActiveToValidated: result.convertedActiveToValidated,
      convertedActiveToCore: result.convertedActiveToCore,
      droppedPending: result.droppedPending,
      droppedActive: result.droppedActive,
      recommendations: result.recommendations,
      duplicateRecordsDropped: result.duplicateRecordsDropped
    }
  }
}

function upsertSemanticMemories(current: SemanticMemory[], replacements: SemanticMemory[]): SemanticMemory[] {
  const next = [...current]
  for (const replacement of replacements) {
    const index = next.findIndex((memory) => memory.id === replacement.id)
    if (index < 0) {
      next.push(replacement)
    } else {
      next[index] = replacement
    }
  }
  return next
}

async function readableMemoryRoot(memoryRoot: string): Promise<{ ok: true; memoryRoot: string } | { ok: false; reason: string }> {
  try {
    const stats = await lstat(memoryRoot)
    if (stats.isSymbolicLink()) return { ok: false, reason: 'memory root is a symlink' }
    if (!stats.isDirectory()) return { ok: false, reason: 'memory root is not a directory' }
    return { ok: true, memoryRoot: await realpath(memoryRoot) }
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return { ok: false, reason: 'memory root does not exist' }
    }
    if (isFileErrorCode(error, 'EACCES') || isFileErrorCode(error, 'EPERM')) {
      return { ok: false, reason: 'memory root is unreadable' }
    }
    throw error
  }
}

function skippedRootResult(root: MemoryRootSpec, reason: string): CodexMemoryLifecycleMigrateV15RootResult {
  return {
    ...baseRootResult(root),
    skipped: true,
    reason
  }
}

function baseRootResult(
  root: MemoryRootSpec,
  counts: Partial<Pick<
    CodexMemoryLifecycleMigrateV15RootResult,
    | 'legacyActiveBefore'
    | 'legacyPendingBefore'
    | 'semanticBefore'
    | 'semanticActiveBefore'
    | 'semanticPendingBefore'
    | 'semanticAfter'
    | 'malformedJsonLines'
  >> = {}
): CodexMemoryLifecycleMigrateV15RootResult {
  return {
    scope: root.scope,
    ...(root.projectId === undefined ? {} : { projectId: root.projectId }),
    memoryRoot: root.memoryRoot,
    legacyActiveBefore: counts.legacyActiveBefore ?? 0,
    legacyPendingBefore: counts.legacyPendingBefore ?? 0,
    semanticBefore: counts.semanticBefore ?? 0,
    semanticActiveBefore: counts.semanticActiveBefore ?? 0,
    semanticPendingBefore: counts.semanticPendingBefore ?? 0,
    semanticAfter: counts.semanticAfter ?? counts.semanticBefore ?? 0,
    malformedJsonLines: counts.malformedJsonLines ?? 0,
    convertedPendingToTrial: 0,
    convertedActiveToValidated: 0,
    convertedActiveToCore: 0,
    droppedPending: 0,
    droppedActive: 0,
    recommendations: 0,
    duplicateRecordsDropped: 0
  }
}

async function readJsonLinesWithMalformed<T>(
  filePath: string,
  isValidRecord: (value: unknown) => value is T
): Promise<JsonLinesReadResult<T>> {
  let content: string
  try {
    await assertSafeMemoryDataFileTarget(filePath)
    content = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return { records: [], malformedLines: 0 }
    }
    throw error
  }

  const records: T[] = []
  let malformedLines = 0
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (isValidRecord(parsed)) {
        records.push(parsed)
      } else {
        malformedLines += 1
      }
    } catch {
      malformedLines += 1
    }
  }
  return { records, malformedLines }
}

function isValidLegacyActiveMemory(value: unknown): value is CyreneMemory {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    value.status === 'active' &&
    oneOf(MEMORY_DOMAINS, value.domain) &&
    oneOf(MEMORY_TYPES, value.type) &&
    oneOf(MEMORY_STRENGTHS, value.strength) &&
    oneOf(MEMORY_SCOPES, value.scope) &&
    isNonEmptyString(value.content) &&
    isNonEmptyString(value.normalizedKey) &&
    oneOf(MEMORY_SOURCES, value.source) &&
    isEvidenceArray(value.evidence) &&
    isMemoryScores(value.scores) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt) &&
    isStringArray(value.tags)
  )
}

function isValidPendingMemory(value: unknown): value is PendingMemory {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    value.status === 'pending' &&
    oneOf(MEMORY_DOMAINS, value.domain) &&
    oneOf(MEMORY_TYPES, value.type) &&
    oneOf(MEMORY_STRENGTHS, value.strength) &&
    oneOf(MEMORY_SCOPES, value.scope) &&
    isNonEmptyString(value.content) &&
    isStringArray(value.useWhen, true) &&
    isStringArray(value.doNotUseWhen, true) &&
    isNonEmptyString(value.normalizedKey) &&
    oneOf(MEMORY_SOURCES, value.source) &&
    isEvidenceArray(value.evidence) &&
    isMemoryScores(value.scores) &&
    typeof value.seenCount === 'number' &&
    isNonEmptyString(value.firstSeenAt) &&
    isNonEmptyString(value.lastSeenAt) &&
    isNonEmptyString(value.expiresAt) &&
    isStringArray(value.tags)
  )
}

function isValidSemanticMemory(value: unknown): value is SemanticMemory {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    oneOf(SEMANTIC_MEMORY_STATUSES, value.status) &&
    oneOf(MEMORY_MODULES, value.module) &&
    oneOf(MEMORY_CANDIDATE_KINDS, value.kind) &&
    oneOf(MEMORY_SCOPES, value.scope) &&
    oneOf(MEMORY_DOMAINS, value.domain) &&
    isNonEmptyString(value.content) &&
    isStringArray(value.useWhen) &&
    isStringArray(value.doNotUseWhen) &&
    isOptionalString(value.sourceOfTruth) &&
    isStructuredEvidenceArray(value.evidence) &&
    (value.routing === undefined || isValidRouting(value.routing)) &&
    oneOf(UPDATE_POLICIES, value.reviewPolicy) &&
    (value.reviewState === undefined || isValidSemanticReviewState(value.reviewState)) &&
    (value.confidenceTier === undefined || oneOf(CONFIDENCE_TIERS, value.confidenceTier)) &&
    (value.activationPolicy === undefined || isValidActivationPolicy(value.activationPolicy)) &&
    isStringArray(value.supersedes) &&
    isOptionalString(value.expiresAt) &&
    isOptionalString(value.reviewAfter) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt)
  )
}

function isValidRouting(value: unknown): boolean {
  return (
    isRecord(value) &&
    oneOf(MEMORY_MODULES, value.module) &&
    oneOf(UPDATE_POLICIES, value.updatePolicy) &&
    oneOf(ROUTING_RISKS, value.risk) &&
    isStringArray(value.reasons)
  )
}

function isValidSemanticReviewState(value: unknown): value is NonNullable<SemanticMemory['reviewState']> {
  return (
    isRecord(value) &&
    isOptionalString(value.normalizedKey) &&
    isOptionalString(value.sourceOfTruth) &&
    (value.type === undefined || oneOf(MEMORY_TYPES, value.type)) &&
    (value.strength === undefined || oneOf(MEMORY_STRENGTHS, value.strength)) &&
    (value.source === undefined || oneOf(MEMORY_SOURCES, value.source)) &&
    (value.portability === undefined || oneOf(MEMORY_PORTABILITIES, value.portability)) &&
    (value.profileVisibility === undefined || oneOf(MEMORY_PROFILE_VISIBILITIES, value.profileVisibility)) &&
    (value.scores === undefined || isMemoryScores(value.scores)) &&
    isStringArray(value.tags, true) &&
    isOptionalFiniteNumber(value.seenCount) &&
    isOptionalString(value.firstSeenAt) &&
    isOptionalString(value.lastSeenAt) &&
    isOptionalString(value.expiresAt) &&
    isOptionalString(value.promoteAfter) &&
    (value.admittedBy === undefined || oneOf(ADMITTED_BY_VALUES, value.admittedBy)) &&
    (value.admissionAction === undefined || oneOf(ADMISSION_ACTIONS, value.admissionAction)) &&
    isOptionalFiniteNumber(value.admissionScore) &&
    isStringArray(value.admissionReasons, true) &&
    isStringArray(value.sourceEpisodeIds, true) &&
    isStringArray(value.sourceDraftIds, true) &&
    isOptionalBoolean(value.userConfirmed) &&
    (
      value.normalizedKeyConflictResolution === undefined ||
      oneOf(NORMALIZED_KEY_CONFLICT_RESOLUTIONS, value.normalizedKeyConflictResolution)
    ) &&
    isStringArray(value.conflictsWith, true)
  )
}

function isValidActivationPolicy(value: unknown): value is ActivationPolicy {
  return (
    isRecord(value) &&
    Array.isArray(value.allowedModes) &&
    value.allowedModes.every((mode) => oneOf(ACTIVATION_MODES, mode)) &&
    oneOf(RUNTIME_ACTIVATION_STRENGTHS, value.maxRuntimeStrength)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isStringArray(value: unknown, optional = false): value is string[] | undefined {
  return (optional && value === undefined) || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
}

function oneOf<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value as T[number])
}

function isEvidenceArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.every(isRecord)
}

function isStructuredEvidenceArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.every((entry) =>
    isRecord(entry) &&
    isNonEmptyString(entry.id) &&
    isNonEmptyString(entry.sourceKind) &&
    isNonEmptyString(entry.sourceRef) &&
    isNonEmptyString(entry.whatHappened) &&
    isNonEmptyString(entry.whyImportant)
  )
}

function isMemoryScores(value: unknown): value is MemoryScores {
  return (
    isRecord(value) &&
    isFiniteNumber(value.evidenceStrength) &&
    isFiniteNumber(value.stability) &&
    isFiniteNumber(value.usefulness) &&
    isFiniteNumber(value.safety) &&
    isFiniteNumber(value.sensitivity)
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || isFiniteNumber(value)
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean'
}

async function writeJsonLinesAtomic(filePath: string, values: unknown[]): Promise<void> {
  await assertSafeMemoryDataFileTarget(filePath)
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  const content = values.map((value) => JSON.stringify(value)).join('\n')
  await writeFile(tempPath, content === '' ? '' : `${content}\n`, 'utf8')
  await rename(tempPath, filePath)
}

async function removeMemoryDataFileIfExists(filePath: string): Promise<void> {
  await assertSafeMemoryDataFileTarget(filePath)
  await rm(filePath, { force: true })
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
