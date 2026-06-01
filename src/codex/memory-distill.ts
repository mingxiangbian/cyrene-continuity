import {
  readActiveMemoriesFromRoot,
  readDistillationInputsFromRoot,
  readPendingMemoriesFromRoot
} from '../memory/memory-store.js'
import type {
  AdmissionDecision,
  CandidateDraft,
  CandidateDraftSourceKind,
  DistillationInput,
  MemoryEvidence,
  PendingMemory,
  SemanticMemory
} from '../memory/types.js'
import { codexProjectMemoryRoot } from './codex-memory-root.js'
import { routeCandidateDraft, semanticCandidateFromDraft } from './memory-router.js'
import { identifyCodexProject } from './project-id.js'

export type DistillationRisk = 'low' | 'medium' | 'high'
export type DistillationRecommendedAction = 'merge_pending' | 'needs_review'

export interface DistilledMemoryCandidate {
  id: string
  normalizedKey: string
  content: string
  sourceIds: string[]
  evidence: MemoryEvidence[]
  recommendedAction: DistillationRecommendedAction
  risk: DistillationRisk
  reasons: string[]
  sourceOfTruth?: string
  semanticMemory?: SemanticMemory
  rawContents?: string[]
  evidenceRefs?: string[]
  sourceAdmissionDecisionIds?: string[]
  sourceSemanticMemoryIds?: string[]
}

export interface CodexMemoryDistillResult {
  mode: 'dry_run'
  memoryRoot: string
  candidates: DistilledMemoryCandidate[]
  summary: {
    pendingRead: number
    activeRead: number
    distillationInputsRead: number
    duplicateClusters: number
    candidates: number
  }
}

export async function runCodexMemoryDistill(input: {
  cwd?: string
  memoryRoot?: string
  dryRun?: boolean
}): Promise<CodexMemoryDistillResult> {
  if (input.dryRun === false) {
    throw new Error('Codex memory distill apply is not supported.')
  }

  const memoryRoot = await resolveMemoryRoot(input)
  const [pending, active, distillationInputs] = await Promise.all([
    readPendingMemoriesFromRoot(memoryRoot),
    readActiveMemoriesFromRoot(memoryRoot),
    readDistillationInputsFromRoot(memoryRoot)
  ])
  const activeKeys = new Set(active.map((memory) => memory.normalizedKey))
  const groups = groupPendingByNormalizedKey(pending)
  const duplicateCandidates = Array.from(groups.entries())
    .filter(([, items]) => items.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([normalizedKey, items]) => buildDistilledCandidate(normalizedKey, items, activeKeys.has(normalizedKey)))
  const distillationInputCandidates = Array.from(groupDistillationInputsByNormalizedKey(distillationInputs).entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([normalizedKey, items]) => buildDistillationInputCandidate(normalizedKey, items, activeKeys.has(normalizedKey)))
  const candidates = [...duplicateCandidates, ...distillationInputCandidates]

  return {
    mode: 'dry_run',
    memoryRoot,
    candidates,
    summary: {
      pendingRead: pending.length,
      activeRead: active.length,
      distillationInputsRead: distillationInputs.length,
      duplicateClusters: duplicateCandidates.length,
      candidates: candidates.length
    }
  }
}

async function resolveMemoryRoot(input: { cwd?: string; memoryRoot?: string }): Promise<string> {
  if (input.memoryRoot !== undefined) {
    return input.memoryRoot
  }

  const project = await identifyCodexProject(input.cwd ?? process.cwd())
  return codexProjectMemoryRoot(project.projectId)
}

function groupPendingByNormalizedKey(pending: PendingMemory[]): Map<string, PendingMemory[]> {
  const groups = new Map<string, PendingMemory[]>()
  for (const item of pending) {
    const existing = groups.get(item.normalizedKey)
    if (existing === undefined) {
      groups.set(item.normalizedKey, [item])
    } else {
      existing.push(item)
    }
  }
  return groups
}

function buildDistilledCandidate(
  normalizedKey: string,
  items: PendingMemory[],
  hasActiveOverlap: boolean
): DistilledMemoryCandidate {
  const sourceItems = sortById(items)
  const highRiskDomains = Array.from(new Set(sourceItems.filter(isHighRiskDomain).map((item) => item.domain))).sort()
  const hasMixedMetadata = hasMixedPendingMetadata(sourceItems)
  const risk = hasActiveOverlap || highRiskDomains.length > 0
    ? 'high'
    : hasMixedMetadata
      ? 'medium'
      : 'low'
  const recommendedAction = risk === 'low' ? 'merge_pending' : 'needs_review'

  return {
    id: `distill-${normalizedKey}`,
    normalizedKey,
    content: chooseRepresentativeContent(sourceItems),
    sourceIds: sourceItems.map((item) => item.id),
    evidence: sourceItems.flatMap((item) => item.evidence),
    recommendedAction,
    risk,
    reasons: buildReasons(normalizedKey, sourceItems.length, hasActiveOverlap, highRiskDomains, hasMixedMetadata)
  }
}

function groupDistillationInputsByNormalizedKey(inputs: DistillationInput[]): Map<string, DistillationInput[]> {
  const groups = new Map<string, DistillationInput[]>()
  for (const item of inputs) {
    const normalizedKey = normalizedKeyForDistillationInput(item)
    const existing = groups.get(normalizedKey)
    if (existing === undefined) {
      groups.set(normalizedKey, [item])
    } else {
      existing.push(item)
    }
  }
  return groups
}

function buildDistillationInputCandidate(
  normalizedKey: string,
  items: DistillationInput[],
  hasActiveOverlap: boolean
): DistilledMemoryCandidate {
  const sourceItems = sortDistillationInputs(items)
  const sourceIds = uniqueInOrder(sourceItems.flatMap(sourceIdsForDistillationInput))
  const rawContents = sourceItems.flatMap((item) => item.rawContents)
  const evidenceRefs = uniqueSorted(sourceItems.flatMap((item) => item.evidenceRefs))
  const sourceAdmissionDecisionIds = uniqueSorted(sourceItems.flatMap((item) => item.admissionDecisionIds))
  const sourceSemanticMemoryIds = uniqueSorted(sourceItems.flatMap((item) => item.sourceSemanticMemoryIds))
  const highRiskDomains = Array.from(new Set(sourceItems.filter(isHighRiskDistillationDomain).map((item) => item.domain))).sort()
  const hasMixedMetadata = hasMixedDistillationMetadata(sourceItems)
  const risk = hasActiveOverlap || highRiskDomains.length > 0
    ? 'high'
    : hasMixedMetadata
      ? 'medium'
      : 'low'
  const content = chooseRepresentativeRawContent(sourceItems)
  const sourceOfTruth = firstDefined(sourceItems.map((item) => item.sourceOfTruth))
  const candidateId = `distill-${normalizedKey}`
  const draft = candidateDraftFromDistillationInputs({
    id: candidateId,
    normalizedKey,
    content,
    sourceItems,
    sourceOfTruth
  })
  const admission = admissionDecisionForDistillationCandidate({
    id: `admission-${candidateId}`,
    draftId: draft.id,
    risk,
    now: sourceItems[0]?.createdAt ?? new Date().toISOString()
  })
  const route = routeCandidateDraft({ draft, admission })
  const semanticMemory = semanticCandidateFromDraft({
    draft,
    admission,
    route,
    now: admission.createdAt
  })

  return {
    id: candidateId,
    normalizedKey,
    content,
    sourceIds,
    evidence: sourceItems.flatMap((item) => item.evidenceRefs.map((summary) => ({ summary }))),
    recommendedAction: 'needs_review',
    risk,
    reasons: buildDistillationInputReasons(normalizedKey, sourceItems, hasActiveOverlap, highRiskDomains, hasMixedMetadata),
    ...(sourceOfTruth === undefined ? {} : { sourceOfTruth }),
    semanticMemory,
    rawContents,
    evidenceRefs,
    sourceAdmissionDecisionIds,
    sourceSemanticMemoryIds
  }
}

function isHighRiskDomain(item: PendingMemory): boolean {
  return item.domain === 'personal' || item.domain === 'relationship' || item.domain === 'affective'
}

function isHighRiskDistillationDomain(item: DistillationInput): boolean {
  return item.domain === 'personal' || item.domain === 'relationship' || item.domain === 'affective'
}

function chooseRepresentativeContent(items: PendingMemory[]): string {
  return [...items].sort((left, right) => {
    const byLength = right.content.length - left.content.length
    return byLength === 0 ? left.id.localeCompare(right.id) : byLength
  })[0]?.content ?? ''
}

function sortById(items: PendingMemory[]): PendingMemory[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id))
}

function sortDistillationInputs(items: DistillationInput[]): DistillationInput[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id))
}

function hasMixedPendingMetadata(items: PendingMemory[]): boolean {
  return new Set(items.map((item) => pendingMetadataSignature(item))).size > 1
}

function hasMixedDistillationMetadata(items: DistillationInput[]): boolean {
  return new Set(items.map((item) => distillationMetadataSignature(item))).size > 1
}

function pendingMetadataSignature(item: PendingMemory): string {
  return JSON.stringify({
    scope: item.scope,
    domain: item.domain,
    type: item.type,
    candidateKind: item.candidateKind ?? item.candidate_kind ?? null
  })
}

function distillationMetadataSignature(item: DistillationInput): string {
  return JSON.stringify({
    scope: item.scope,
    domain: item.domain,
    candidateKind: item.candidateKind,
    sourceKinds: [...item.sourceKinds].sort()
  })
}

function normalizedKeyForDistillationInput(input: DistillationInput): string {
  return input.normalizedKey ?? input.id
}

function sourceIdsForDistillationInput(input: DistillationInput): string[] {
  return input.sourceDraftIds.length > 0 ? input.sourceDraftIds : [input.id]
}

function chooseRepresentativeRawContent(items: DistillationInput[]): string {
  return items.flatMap((item) => item.rawContents).sort((left, right) => {
    const byLength = right.length - left.length
    return byLength === 0 ? left.localeCompare(right) : byLength
  })[0] ?? ''
}

function candidateDraftFromDistillationInputs(input: {
  id: string
  normalizedKey: string
  content: string
  sourceItems: DistillationInput[]
  sourceOfTruth?: string
}): CandidateDraft {
  const representative = input.sourceItems[0]
  return {
    id: input.id,
    content: input.content,
    candidateKind: representative.candidateKind,
    scope: representative.scope,
    domain: representative.domain,
    sourceKind: sourceKindForDistillationInput(representative),
    sourceEpisodeIds: uniqueSorted(input.sourceItems.flatMap((item) => item.sourceEpisodeIds)),
    evidenceRefs: uniqueSorted(input.sourceItems.flatMap((item) => item.evidenceRefs)),
    normalizedKey: input.normalizedKey,
    ...(input.sourceOfTruth === undefined ? {} : { sourceOfTruth: input.sourceOfTruth }),
    tags: [],
    createdAt: representative.createdAt
  }
}

function sourceKindForDistillationInput(input: DistillationInput): CandidateDraftSourceKind {
  return (input.sourceKinds[0] ?? 'assistant_observed') as CandidateDraftSourceKind
}

function admissionDecisionForDistillationCandidate(input: {
  id: string
  draftId: string
  risk: DistillationRisk
  now: string
}): AdmissionDecision {
  const sensitivity = input.risk === 'high' ? 0.7 : input.risk === 'medium' ? 0.45 : 0.1
  return {
    id: input.id,
    draftId: input.draftId,
    action: 'admit_to_distillation',
    admissionScore: input.risk === 'low' ? 0.8 : 0.65,
    reasons: ['needs_active_memory_rewrite'],
    scores: {
      futureUsefulness: 0.8,
      actionability: 0.7,
      stability: 0.7,
      specificity: 0.7,
      evidenceStrength: 0.8,
      repeatPotential: 0.7,
      expiryRisk: 0.1,
      redundancy: 0.2,
      sensitivity
    },
    createdAt: input.now
  }
}

function firstDefined<T>(items: Array<T | undefined>): T | undefined {
  return items.find((item): item is T => item !== undefined)
}

function uniqueSorted(items: string[]): string[] {
  return Array.from(new Set(items)).sort()
}

function uniqueInOrder(items: string[]): string[] {
  return Array.from(new Set(items))
}

function buildReasons(
  normalizedKey: string,
  pendingCount: number,
  hasActiveOverlap: boolean,
  highRiskDomains: string[],
  hasMixedMetadata: boolean
): string[] {
  return [
    ...(hasActiveOverlap ? [`active memory already has normalizedKey ${normalizedKey}`] : []),
    ...highRiskDomains.map((domain) => `high-risk pending domain ${domain}`),
    ...(hasMixedMetadata ? [`mixed pending metadata for duplicate normalizedKey ${normalizedKey}`] : []),
    `duplicate normalizedKey ${normalizedKey} has ${pendingCount} pending candidates`
  ]
}

function buildDistillationInputReasons(
  normalizedKey: string,
  items: DistillationInput[],
  hasActiveOverlap: boolean,
  highRiskDomains: string[],
  hasMixedMetadata: boolean
): string[] {
  return [
    ...(hasActiveOverlap ? [`active memory already has normalizedKey ${normalizedKey}`] : []),
    ...highRiskDomains.map((domain) => `high-risk distillation input domain ${domain}`),
    ...(hasMixedMetadata ? [`mixed distillation input metadata for normalizedKey ${normalizedKey}`] : []),
    `normalizedKey ${normalizedKey} has ${items.length} v2 distillation input${items.length === 1 ? '' : 's'}`
  ]
}
