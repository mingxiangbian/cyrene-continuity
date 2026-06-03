import { randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, rename, writeFile } from 'node:fs/promises'
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
import type {
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

const INDEX_FILE = 'index.jsonl'
const PENDING_FILE = 'pending.jsonl'
const SEMANTIC_MEMORIES_FILE = 'semantic_memories.jsonl'
const HIGH_RISK_DOMAINS = new Set<MemoryDomain>(['personal', 'relationship', 'affective'])
const LOW_RISK_DOMAINS = new Set<MemoryDomain>(['project', 'procedural', 'system'])
const REVIEW_SUMMARY_NOISE_PHRASES = [
  'review summary ok',
  'merged branch',
  'deleted local branch'
]

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
    results.push(await migrateReadableRoot({ ...root, memoryRoot: readable.memoryRoot }, { dryRun, now }))
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
    readJsonLinesWithMalformed<CyreneMemory>(join(root.memoryRoot, INDEX_FILE)),
    readJsonLinesWithMalformed<PendingMemory>(join(root.memoryRoot, PENDING_FILE)),
    readJsonLinesWithMalformed<SemanticMemory>(join(root.memoryRoot, SEMANTIC_MEMORIES_FILE))
  ])
  const legacyActive = legacyActiveRead.records
  const legacyPending = legacyPendingRead.records
  const existingSemantic = semanticRead.records
  const active = legacyActive.filter((memory) => memory.status === 'active')
  const pending = legacyPending.filter((memory) => memory.status === 'pending')
  const semanticActive = existingSemantic.filter((memory) => memory.status === 'active')
  const semanticPending = existingSemantic.filter((memory) => memory.status === 'pending')
  const malformedJsonLines = legacyActiveRead.malformedLines + legacyPendingRead.malformedLines + semanticRead.malformedLines
  const activeIds = new Set([...active, ...semanticActive].map((memory) => memory.id))
  const processedIds = new Set<string>()
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

  for (const memory of active) {
    if (processedIds.has(memory.id)) {
      continue
    }
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

  for (const memory of semanticActive) {
    if (processedIds.has(memory.id) || validateSemanticMemoryLifecycle(memory).length === 0) {
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

    const tier = root.scope === 'global' ? 'global_core' : projectTierForActive(activeMemory)
    converted.push(withLifecycle(memory, tier, input.now))
    if (tier === 'validated') {
      result.convertedActiveToValidated += 1
    } else {
      result.convertedActiveToCore += 1
    }
  }

  for (const memory of pending) {
    if (activeIds.has(memory.id)) {
      result.droppedPending += 1
      dropAudits.push(dropAuditForPending(memory, 'duplicate pending id shadowed by active memory'))
      continue
    }
    if (processedIds.has(memory.id)) {
      continue
    }
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

  for (const memory of semanticPending) {
    const pendingMemory = semanticMemoryToPendingMemory(memory)
    if (activeIds.has(memory.id)) {
      result.droppedPending += 1
      dropAudits.push(dropAuditForSemantic(memory, 'pending', pendingMemory, 'duplicate pending id shadowed by active memory'))
      continue
    }
    if (processedIds.has(memory.id)) {
      continue
    }
    processedIds.add(memory.id)
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

  const nextSemantic = upsertSemanticMemories(
    existingSemantic.filter((memory) => !processedIds.has(memory.id)),
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
    await writeJsonLinesAtomic(join(root.memoryRoot, PENDING_FILE), [])
    await writeJsonLinesAtomic(
      join(root.memoryRoot, INDEX_FILE),
      nextSemantic.filter((memory) => memory.status === 'active').map(semanticMemoryToActiveMemory)
    )
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
      recommendations: result.recommendations
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
    recommendations: 0
  }
}

async function readJsonLinesWithMalformed<T>(filePath: string): Promise<JsonLinesReadResult<T>> {
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
      records.push(JSON.parse(trimmed) as T)
    } catch {
      malformedLines += 1
    }
  }
  return { records, malformedLines }
}

async function writeJsonLinesAtomic(filePath: string, values: unknown[]): Promise<void> {
  await assertSafeMemoryDataFileTarget(filePath)
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  const content = values.map((value) => JSON.stringify(value)).join('\n')
  await writeFile(tempPath, content === '' ? '' : `${content}\n`, 'utf8')
  await rename(tempPath, filePath)
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
