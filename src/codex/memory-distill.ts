import {
  readAdmissionDecisionsFromRoot,
  readActiveMemoriesFromRoot,
  readCandidateDraftsFromRoot,
  readDistillationInputsFromRoot,
  readEpisodeMemoriesFromRoot,
  readMemoryEventsFromRoot,
  readPendingMemoriesFromRoot,
  readReviewDecisionsFromRoot,
  readSemanticMemoriesFromRoot
} from '../memory/memory-store.js'
import type {
  AdmissionDecision,
  CandidateDraft,
  CandidateDraftSourceKind,
  DistillationInput,
  MemoryEvidence,
  PendingMemory,
  SemanticMemory,
  StructuredEvidence
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
  sourceEpisodeIds?: string[]
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
    inputsRead: {
      drafts: number
      admissions: number
      distillationInputs: number
      episodes: number
      semanticMemories: number
      pendingMemories: number
      activeMemories: number
      legacyPending: number
      legacyActive: number
      memoryEvents: number
      reviewDecisions: number
    }
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
  const [
    pending,
    active,
    distillationInputs,
    drafts,
    admissions,
    episodes,
    semanticMemories,
    memoryEvents,
    reviewDecisions
  ] = await Promise.all([
    readPendingMemoriesFromRoot(memoryRoot),
    readActiveMemoriesFromRoot(memoryRoot),
    readDistillationInputsFromRoot(memoryRoot),
    readCandidateDraftsFromRoot(memoryRoot),
    readAdmissionDecisionsFromRoot(memoryRoot),
    readEpisodeMemoriesFromRoot(memoryRoot),
    readSemanticMemoriesFromRoot(memoryRoot),
    readMemoryEventsFromRoot(memoryRoot),
    readReviewDecisionsFromRoot(memoryRoot)
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
  const orphanAdmissionCandidates = buildOrphanAdmissionCandidates({
    drafts,
    admissions,
    distillationInputs,
    activeKeys
  })
  const candidates = mergeCandidatesByNormalizedKey([
    ...duplicateCandidates,
    ...distillationInputCandidates,
    ...orphanAdmissionCandidates
  ])

  return {
    mode: 'dry_run',
    memoryRoot,
    candidates,
    summary: {
      pendingRead: pending.length,
      activeRead: active.length,
      distillationInputsRead: distillationInputs.length,
      duplicateClusters: duplicateCandidates.length,
      candidates: candidates.length,
      inputsRead: {
        drafts: drafts.length,
        admissions: admissions.length,
        distillationInputs: distillationInputs.length,
        episodes: episodes.length,
        semanticMemories: semanticMemories.length,
        pendingMemories: pending.length,
        activeMemories: active.length,
        legacyPending: pending.length,
        legacyActive: active.length,
        memoryEvents: memoryEvents.length,
        reviewDecisions: reviewDecisions.length
      }
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
  const sourceEpisodeIds = uniqueSorted(sourceItems.flatMap((item) => item.sourceEpisodeIds))
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
    sourceEpisodeIds,
    sourceSemanticMemoryIds
  }
}

function buildOrphanAdmissionCandidates(input: {
  drafts: CandidateDraft[]
  admissions: AdmissionDecision[]
  distillationInputs: DistillationInput[]
  activeKeys: Set<string>
}): DistilledMemoryCandidate[] {
  const draftsById = new Map(input.drafts.map((draft) => [draft.id, draft]))
  const draftIdsCoveredByInputs = new Set(input.distillationInputs.flatMap((item) => item.sourceDraftIds))
  return input.admissions
    .filter((admission) => admission.action === 'admit_to_distillation')
    .filter((admission) => !draftIdsCoveredByInputs.has(admission.draftId))
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((admission) => {
      const draft = draftsById.get(admission.draftId)
      if (draft === undefined) {
        return []
      }
      const normalizedKey = normalizedKeyForDraft(draft)
      return [buildOrphanAdmissionCandidate(draft, admission, input.activeKeys.has(normalizedKey))]
    })
}

function buildOrphanAdmissionCandidate(
  draft: CandidateDraft,
  admission: AdmissionDecision,
  hasActiveOverlap: boolean
): DistilledMemoryCandidate {
  const normalizedKey = normalizedKeyForDraft(draft)
  const route = routeCandidateDraft({ draft, admission })
  const semanticRoute = hasActiveOverlap
    ? {
        ...route,
        risk: 'high' as const,
        updatePolicy: 'manual_only' as const,
        reasons: uniqueInOrder([`active memory already has normalizedKey ${normalizedKey}`, ...route.reasons])
      }
    : route
  const risk = hasActiveOverlap ? 'high' : semanticRoute.risk
  const semanticMemory = semanticCandidateFromDraft({
    draft,
    admission,
    route: semanticRoute,
    now: admission.createdAt
  })

  return {
    id: `distill-${normalizedKey}`,
    normalizedKey,
    content: draft.content,
    sourceIds: [draft.id],
    evidence: evidenceForDraft(draft),
    recommendedAction: 'needs_review',
    risk,
    reasons: buildOrphanAdmissionReasons(normalizedKey, draft, admission, hasActiveOverlap),
    ...(draft.sourceOfTruth === undefined ? {} : { sourceOfTruth: draft.sourceOfTruth }),
    semanticMemory,
    rawContents: [draft.content],
    evidenceRefs: uniqueSorted(draft.evidenceRefs),
    sourceAdmissionDecisionIds: [admission.id],
    sourceEpisodeIds: uniqueSorted(draft.sourceEpisodeIds)
  }
}

function mergeCandidatesByNormalizedKey(candidates: DistilledMemoryCandidate[]): DistilledMemoryCandidate[] {
  const byNormalizedKey = new Map<string, DistilledMemoryCandidate>()
  for (const candidate of candidates) {
    const existing = byNormalizedKey.get(candidate.normalizedKey)
    byNormalizedKey.set(
      candidate.normalizedKey,
      existing === undefined ? candidate : mergeDistilledCandidates(existing, candidate)
    )
  }
  return Array.from(byNormalizedKey.values()).sort((left, right) => left.normalizedKey.localeCompare(right.normalizedKey))
}

function mergeDistilledCandidates(
  left: DistilledMemoryCandidate,
  right: DistilledMemoryCandidate
): DistilledMemoryCandidate {
  const risk = highestRisk(left.risk, right.risk)
  const sourceIds = uniqueSorted([...left.sourceIds, ...right.sourceIds])
  const evidence = [...left.evidence, ...right.evidence]
  const reasons = uniqueInOrder([...left.reasons, ...right.reasons])
  const sourceOfTruth = left.sourceOfTruth ?? right.sourceOfTruth
  const evidenceRefs = mergeOptionalStrings(left.evidenceRefs, right.evidenceRefs, 'sorted')
  const sourceAdmissionDecisionIds = mergeOptionalStrings(
    left.sourceAdmissionDecisionIds,
    right.sourceAdmissionDecisionIds,
    'sorted'
  )
  const sourceEpisodeIds = mergeOptionalStrings(left.sourceEpisodeIds, right.sourceEpisodeIds, 'sorted')
  const sourceSemanticMemoryIds = mergeOptionalStrings(
    left.sourceSemanticMemoryIds,
    right.sourceSemanticMemoryIds,
    'sorted'
  )
  return {
    ...left,
    sourceIds,
    evidence,
    recommendedAction: risk === 'low' && left.recommendedAction === 'merge_pending' && right.recommendedAction === 'merge_pending'
      ? 'merge_pending'
      : 'needs_review',
    risk,
    reasons,
    sourceOfTruth,
    semanticMemory: mergeSemanticMemoryPreviews(left.semanticMemory, right.semanticMemory, {
      risk,
      reasons,
      sourceOfTruth,
      sourceEpisodeIds
    }),
    rawContents: mergeOptionalStrings(left.rawContents, right.rawContents),
    evidenceRefs,
    sourceAdmissionDecisionIds,
    sourceEpisodeIds,
    sourceSemanticMemoryIds
  }
}

function mergeSemanticMemoryPreviews(
  left: SemanticMemory | undefined,
  right: SemanticMemory | undefined,
  merged: {
    risk: DistillationRisk
    reasons: string[]
    sourceOfTruth?: string
    sourceEpisodeIds?: string[]
  }
): SemanticMemory | undefined {
  if (left === undefined) return right
  if (right === undefined) return left

  const routing = mergeSemanticRouting(left.routing, right.routing, merged.risk, merged.reasons)
  const reviewPolicy = routing?.updatePolicy ?? strongestReviewPolicy(left.reviewPolicy, right.reviewPolicy, merged.risk)
  const reviewState = {
    ...(left.reviewState ?? {}),
    ...(right.reviewState ?? {}),
    ...(merged.sourceOfTruth === undefined ? {} : { sourceOfTruth: merged.sourceOfTruth }),
    admissionReasons: uniqueInOrder([
      ...(left.reviewState?.admissionReasons ?? []),
      ...(right.reviewState?.admissionReasons ?? [])
    ]),
    sourceDraftIds: uniqueSorted([
      ...(left.reviewState?.sourceDraftIds ?? []),
      ...(right.reviewState?.sourceDraftIds ?? [])
    ]),
    sourceEpisodeIds: uniqueSorted([
      ...(left.reviewState?.sourceEpisodeIds ?? []),
      ...(right.reviewState?.sourceEpisodeIds ?? []),
      ...(merged.sourceEpisodeIds ?? [])
    ])
  }
  return {
    ...left,
    ...(merged.sourceOfTruth === undefined ? {} : { sourceOfTruth: merged.sourceOfTruth }),
    evidence: mergeStructuredEvidence(left.evidence, right.evidence),
    ...(routing === undefined ? {} : { routing }),
    reviewPolicy,
    reviewState,
    supersedes: uniqueSorted([...left.supersedes, ...right.supersedes]),
    updatedAt: maxIsoTimestamp(left.updatedAt, right.updatedAt)
  }
}

function mergeSemanticRouting(
  left: SemanticMemory['routing'],
  right: SemanticMemory['routing'],
  risk: DistillationRisk,
  reasons: string[]
): SemanticMemory['routing'] {
  const base = left ?? right
  if (base === undefined) return undefined
  const updatePolicy = risk === 'high'
    ? 'manual_only'
    : risk === 'medium' && base.updatePolicy === 'strict_auto_promote'
      ? 'pending_review'
      : base.updatePolicy
  return {
    ...base,
    risk,
    updatePolicy,
    reasons: uniqueInOrder([...(left?.reasons ?? []), ...(right?.reasons ?? []), ...reasons])
  }
}

function strongestReviewPolicy(
  left: SemanticMemory['reviewPolicy'],
  right: SemanticMemory['reviewPolicy'],
  risk: DistillationRisk
): SemanticMemory['reviewPolicy'] {
  if (risk === 'high' || left === 'manual_only' || right === 'manual_only') return 'manual_only'
  if (risk === 'medium' && (left === 'strict_auto_promote' || right === 'strict_auto_promote')) return 'pending_review'
  if (left === 'pending_review' || right === 'pending_review') return 'pending_review'
  return left
}

function mergeStructuredEvidence(left: StructuredEvidence[], right: StructuredEvidence[]): StructuredEvidence[] {
  const seen = new Set<string>()
  const merged: StructuredEvidence[] = []
  for (const item of [...left, ...right]) {
    const key = [item.id, item.sourceKind, item.sourceRef, item.whatHappened].join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged
}

function maxIsoTimestamp(left: string, right: string): string {
  return left >= right ? left : right
}

function highestRisk(left: DistillationRisk, right: DistillationRisk): DistillationRisk {
  return riskRank(left) >= riskRank(right) ? left : right
}

function riskRank(risk: DistillationRisk): number {
  if (risk === 'high') return 2
  if (risk === 'medium') return 1
  return 0
}

function mergeOptionalStrings(
  left: string[] | undefined,
  right: string[] | undefined,
  order: 'preserve' | 'sorted' = 'preserve'
): string[] | undefined {
  if (left === undefined && right === undefined) {
    return undefined
  }
  const values = [...(left ?? []), ...(right ?? [])]
  return order === 'sorted' ? uniqueSorted(values) : uniqueInOrder(values)
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

function normalizedKeyForDraft(draft: CandidateDraft): string {
  return draft.normalizedKey ?? draft.id
}

function sourceIdsForDistillationInput(input: DistillationInput): string[] {
  return input.sourceDraftIds.length > 0 ? input.sourceDraftIds : [input.id]
}

function evidenceForDraft(draft: CandidateDraft): MemoryEvidence[] {
  const refs = draft.evidenceRefs.length > 0 ? draft.evidenceRefs : [draft.sourceOfTruth ?? draft.id]
  return refs.map((summary) => ({ summary }))
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

function buildOrphanAdmissionReasons(
  normalizedKey: string,
  draft: CandidateDraft,
  admission: AdmissionDecision,
  hasActiveOverlap: boolean
): string[] {
  return [
    ...(hasActiveOverlap ? [`active memory already has normalizedKey ${normalizedKey}`] : []),
    `draft ${draft.id} admitted to distillation by ${admission.id}`,
    `no v2 distillation input covers draft ${draft.id}`
  ]
}
