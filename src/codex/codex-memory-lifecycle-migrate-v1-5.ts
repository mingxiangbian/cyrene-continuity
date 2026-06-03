import { randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { activationPolicyForConfidenceTier } from '../memory/memory-lifecycle.js'
import {
  activeMemoryToSemanticMemory,
  pendingMemoryToSemanticMemory,
  semanticMemoryToActiveMemory,
  semanticMemoryToPendingMemory
} from '../memory/semantic-memory-adapter.js'
import {
  appendMemoryEventFromRoot,
  assertSafeMemoryDataFileTarget,
  readSemanticMemoriesFromRoot,
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
  semanticAfter: number
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
  if (input.allProjects === true) {
    for (const project of await listCodexProjects().catch(() => [])) {
      addRoot({ scope: 'project', projectId: project.projectId, memoryRoot: project.memoryRoot })
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
  const [legacyActive, legacyPending, existingSemantic] = await Promise.all([
    readJsonLines<CyreneMemory>(join(root.memoryRoot, INDEX_FILE)),
    readJsonLines<PendingMemory>(join(root.memoryRoot, PENDING_FILE)),
    readSemanticMemoriesFromRoot(root.memoryRoot)
  ])
  const active = legacyActive.filter((memory) => memory.status === 'active')
  const pending = legacyPending.filter((memory) => memory.status === 'pending')
  const semanticPending = existingSemantic.filter((memory) => memory.status === 'pending')
  const processedIds = new Set<string>()
  const converted: SemanticMemory[] = []
  const recommendations: Recommendation[] = []
  const result = baseRootResult(root, {
    legacyActiveBefore: active.length,
    legacyPendingBefore: pending.length,
    semanticBefore: existingSemantic.length
  })

  for (const memory of pending) {
    processedIds.add(memory.id)
    if (isReviewSummaryNoise(memory) || isLowValueNoise(memory)) {
      result.droppedPending += 1
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
    if (processedIds.has(memory.id)) {
      continue
    }
    processedIds.add(memory.id)
    const pendingMemory = semanticMemoryToPendingMemory(memory)
    if (isReviewSummaryNoise(pendingMemory) || isLowValueNoise(pendingMemory)) {
      result.droppedPending += 1
      continue
    }
    const recommendationReason = recommendationReasonForPending(root.scope, pendingMemory)
    if (recommendationReason !== undefined || root.scope === 'global') {
      result.recommendations += 1
      recommendations.push(recommendationForPending(
        pendingMemory,
        recommendationReason ?? 'global pending memory requires manual review'
      ))
      continue
    }

    converted.push(withLifecycle(memory, 'trial', input.now))
    result.convertedPendingToTrial += 1
  }

  for (const memory of active) {
    if (processedIds.has(memory.id)) {
      continue
    }
    processedIds.add(memory.id)
    if (isLowValueNoise(memory)) {
      result.droppedActive += 1
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

  const nextSemantic = upsertSemanticMemories(
    existingSemantic.filter((memory) => !processedIds.has(memory.id)),
    converted
  )
  result.semanticAfter = nextSemantic.length

  if (!input.dryRun) {
    await writeSemanticMemoriesFromRoot(root.memoryRoot, nextSemantic)
    await writeJsonLinesAtomic(join(root.memoryRoot, PENDING_FILE), [])
    await writeJsonLinesAtomic(
      join(root.memoryRoot, INDEX_FILE),
      nextSemantic.filter((memory) => memory.status === 'active').map(semanticMemoryToActiveMemory)
    )
    for (const recommendation of recommendations) {
      await appendMemoryEventFromRoot(root.memoryRoot, recommendationEvent(root, recommendation, input.now))
    }
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
    reason
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
    reason
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
      contentPreview: recommendation.content.slice(0, 160)
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
      semanticAfter: result.semanticAfter,
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
    'legacyActiveBefore' | 'legacyPendingBefore' | 'semanticBefore' | 'semanticAfter'
  >> = {}
): CodexMemoryLifecycleMigrateV15RootResult {
  return {
    scope: root.scope,
    ...(root.projectId === undefined ? {} : { projectId: root.projectId }),
    memoryRoot: root.memoryRoot,
    legacyActiveBefore: counts.legacyActiveBefore ?? 0,
    legacyPendingBefore: counts.legacyPendingBefore ?? 0,
    semanticBefore: counts.semanticBefore ?? 0,
    semanticAfter: counts.semanticAfter ?? counts.semanticBefore ?? 0,
    convertedPendingToTrial: 0,
    convertedActiveToValidated: 0,
    convertedActiveToCore: 0,
    droppedPending: 0,
    droppedActive: 0,
    recommendations: 0
  }
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  let content: string
  try {
    await assertSafeMemoryDataFileTarget(filePath)
    content = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return []
    }
    throw error
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T]
      } catch {
        return []
      }
    })
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
