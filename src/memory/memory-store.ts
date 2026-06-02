import { randomUUID } from 'node:crypto'
import { appendFile, lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureMemoryRoot, getReadableMemoryRoot } from './paths.js'
import {
  activeMemoryToSemanticMemory,
  pendingMemoryToSemanticMemory,
  semanticMemoryToActiveMemory,
  semanticMemoryToPendingMemory
} from './semantic-memory-adapter.js'
import type {
  ActivationEvent,
  AdmissionDecision,
  CandidateDraft,
  CyreneMemory,
  DistillationInput,
  EpisodeMemory,
  MemoryEvent,
  MemoryScores,
  MemoryTombstone,
  PendingMemory,
  ReflectionCandidate,
  ReviewDecision,
  RoutingDecision,
  SemanticMemory
} from './types.js'

const INDEX_FILE = 'index.jsonl'
const PENDING_FILE = 'pending.jsonl'
const EPISODES_FILE = 'episodes.jsonl'
const CANDIDATE_DRAFTS_FILE = 'candidate_drafts.jsonl'
const ADMISSION_DECISIONS_FILE = 'admission_decisions.jsonl'
const SEMANTIC_MEMORIES_FILE = 'semantic_memories.jsonl'
const DISTILLATION_INPUTS_FILE = 'distillation_inputs.jsonl'
const ROUTING_DECISIONS_FILE = 'routing_decisions.jsonl'
const REVIEW_DECISIONS_FILE = 'review_decisions.jsonl'
const ACTIVATION_EVENTS_FILE = 'activation_events.jsonl'
const REFLECTION_CANDIDATES_FILE = 'reflection_candidates.jsonl'
const EVENTS_FILE = 'events.jsonl'
const TOMBSTONES_FILE = 'tombstones.jsonl'
const MAX_PENDING_EVIDENCE = 10

export async function readActiveMemories(cwd: string): Promise<CyreneMemory[]> {
  const root = await getReadableMemoryRoot(cwd)
  if (root === null) {
    return []
  }
  return readActiveMemoriesFromRoot(root)
}

export async function writeActiveMemories(cwd: string, memories: CyreneMemory[]): Promise<void> {
  const root = await ensureMemoryRoot(cwd)
  await writeActiveMemoriesFromRoot(root, memories)
}

export async function readPendingMemories(cwd: string): Promise<PendingMemory[]> {
  const root = await getReadableMemoryRoot(cwd)
  if (root === null) {
    return []
  }
  return readPendingMemoriesFromRoot(root)
}

export async function readActiveMemoriesFromRoot(memoryRoot: string): Promise<CyreneMemory[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  if (await semanticMemoryStoreExists(memoryRoot)) {
    return (await readSemanticMemoriesFromRoot(memoryRoot))
      .filter((memory) => memory.status === 'active')
      .map(semanticMemoryToActiveMemory)
  }
  return (await readJsonLines<CyreneMemory>(join(memoryRoot, INDEX_FILE))).filter((memory) => memory.status === 'active')
}

export async function writeActiveMemoriesFromRoot(memoryRoot: string, memories: CyreneMemory[]): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  const active = memories.filter((memory) => memory.status === 'active')
  const current = await semanticProjectionForWrite(root)
  const next = replaceSemanticMemoriesByStatus(current, 'active', active.map(activeMemoryToSemanticMemory))
  await writeSemanticMemoriesFromRoot(root, next)
  await writeJsonLinesAtomic(join(root, INDEX_FILE), await orderActiveForLegacyProjection(root, active))
}

export async function ensureWritableMemoryRootPath(memoryRoot: string): Promise<string> {
  return ensureWritableMemoryRoot(memoryRoot)
}

export async function assertSafeMemoryDataFileTarget(filePath: string): Promise<void> {
  try {
    const stats = await lstat(filePath)
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to use memory data file symlink: ${filePath}`)
    }
    if (!stats.isFile()) {
      throw new Error(`Refusing to use non-file memory data path: ${filePath}`)
    }
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return
    }
    throw error
  }
}

export async function readPendingMemoriesFromRoot(memoryRoot: string): Promise<PendingMemory[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  const legacyPending = (await readJsonLines<PendingMemory>(join(memoryRoot, PENDING_FILE))).filter((memory) => memory.status === 'pending')
  if (legacyPending.length > 0) {
    return legacyPending
  }
  if (await semanticMemoryStoreExists(memoryRoot)) {
    return (await readSemanticMemoriesFromRoot(memoryRoot))
      .filter((memory) => memory.status === 'pending')
      .map(semanticMemoryToPendingMemory)
  }
  return []
}

export async function writePendingMemories(cwd: string, memories: PendingMemory[]): Promise<void> {
  const root = await ensureMemoryRoot(cwd)
  await writePendingMemoriesFromRoot(root, memories)
}

export async function writePendingMemoriesFromRoot(memoryRoot: string, memories: PendingMemory[]): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  const pending = memories.filter((memory) => memory.status === 'pending')
  const current = await semanticProjectionForWrite(root)
  const next = replaceSemanticMemoriesByStatus(current, 'pending', pending.map(pendingMemoryToSemanticMemory))
  await writeSemanticMemoriesFromRoot(root, next)
  await writeJsonLinesAtomic(join(root, PENDING_FILE), pending)
}

export async function upsertPendingMemoryFromRoot(memoryRoot: string, candidate: PendingMemory): Promise<PendingMemory> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  const pending = await readPendingMemoriesFromRoot(root)
  const existingIndex = pending.findIndex((memory) => memory.normalizedKey === candidate.normalizedKey)
  let result = candidate

  if (existingIndex >= 0) {
    const existing = pending[existingIndex]
    result = mergePendingMemory(existing, candidate)
    pending[existingIndex] = result
  } else {
    pending.push(candidate)
  }

  await writePendingMemoriesFromRoot(root, pending)
  return result
}

export async function appendEpisodeMemoryFromRoot(memoryRoot: string, episode: EpisodeMemory): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, EPISODES_FILE), episode)
}

export async function readEpisodeMemoriesFromRoot(memoryRoot: string): Promise<EpisodeMemory[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<EpisodeMemory>(join(memoryRoot, EPISODES_FILE))
}

export async function appendCandidateDraftFromRoot(memoryRoot: string, draft: CandidateDraft): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, CANDIDATE_DRAFTS_FILE), draft)
}

export async function readCandidateDraftsFromRoot(memoryRoot: string): Promise<CandidateDraft[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<CandidateDraft>(join(memoryRoot, CANDIDATE_DRAFTS_FILE))
}

export async function appendAdmissionDecisionFromRoot(
  memoryRoot: string,
  decision: AdmissionDecision
): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, ADMISSION_DECISIONS_FILE), decision)
}

export async function readAdmissionDecisionsFromRoot(memoryRoot: string): Promise<AdmissionDecision[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<AdmissionDecision>(join(memoryRoot, ADMISSION_DECISIONS_FILE))
}

export async function readSemanticMemoriesFromRoot(memoryRoot: string): Promise<SemanticMemory[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<SemanticMemory>(join(memoryRoot, SEMANTIC_MEMORIES_FILE))
}

export async function writeSemanticMemoriesFromRoot(
  memoryRoot: string,
  memories: SemanticMemory[]
): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await writeJsonLinesAtomic(join(root, SEMANTIC_MEMORIES_FILE), memories)
}

export interface SemanticMemoryV2MigrationResult {
  memoryRoot: string
  migratedActive: number
  droppedLegacyPending: number
  semanticMemories: number
}

export async function migrateMemoryRootToSemanticV2FromRoot(
  memoryRoot: string,
  input: { now?: string } = {}
): Promise<SemanticMemoryV2MigrationResult> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  const now = input.now ?? new Date().toISOString()
  const legacyActive = (await readJsonLines<CyreneMemory>(join(root, INDEX_FILE))).filter((memory) => memory.status === 'active')
  const legacyPending = (await readJsonLines<PendingMemory>(join(root, PENDING_FILE))).filter((memory) => memory.status === 'pending')
  const existingSemantic = await readSemanticMemoriesFromRoot(root)
  const migratedActive = legacyActive.map(activeMemoryToSemanticMemory)
  const activeIds = new Set(migratedActive.map((memory) => memory.id))
  const preservedSemantic = existingSemantic.filter((memory) => !activeIds.has(memory.id))
  const nextSemantic = upsertSemanticMemories(preservedSemantic, migratedActive)

  await writeSemanticMemoriesFromRoot(root, nextSemantic)
  await writeJsonLinesAtomic(join(root, INDEX_FILE), legacyActive)
  await writeJsonLinesAtomic(
    join(root, PENDING_FILE),
    nextSemantic.filter((memory) => memory.status === 'pending').map(semanticMemoryToPendingMemory)
  )
  await appendMemoryEventFromRoot(root, {
    id: randomUUID(),
    action: 'audit',
    at: now,
    reason: 'Migrated active memory to SemanticMemory v2',
    details: {
      migratedActive: migratedActive.length,
      semanticStore: SEMANTIC_MEMORIES_FILE
    }
  })
  await appendMemoryEventFromRoot(root, {
    id: randomUUID(),
    action: 'audit',
    at: now,
    reason: 'Reset legacy pending memory after SemanticMemory v2 migration',
    details: {
      droppedLegacyPending: legacyPending.length,
      legacyPendingStore: PENDING_FILE
    }
  })

  return {
    memoryRoot: root,
    migratedActive: migratedActive.length,
    droppedLegacyPending: legacyPending.length,
    semanticMemories: nextSemantic.length
  }
}

export async function appendDistillationInputFromRoot(
  memoryRoot: string,
  input: DistillationInput
): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, DISTILLATION_INPUTS_FILE), input)
}

export async function readDistillationInputsFromRoot(memoryRoot: string): Promise<DistillationInput[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<DistillationInput>(join(memoryRoot, DISTILLATION_INPUTS_FILE))
}

export async function appendRoutingDecisionFromRoot(
  memoryRoot: string,
  decision: RoutingDecision
): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, ROUTING_DECISIONS_FILE), decision)
}

export async function readRoutingDecisionsFromRoot(memoryRoot: string): Promise<RoutingDecision[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<RoutingDecision>(join(memoryRoot, ROUTING_DECISIONS_FILE))
}

export async function appendReviewDecisionFromRoot(
  memoryRoot: string,
  decision: ReviewDecision
): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, REVIEW_DECISIONS_FILE), decision)
}

export async function readReviewDecisionsFromRoot(memoryRoot: string): Promise<ReviewDecision[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<ReviewDecision>(join(memoryRoot, REVIEW_DECISIONS_FILE))
}

export async function appendActivationEventFromRoot(
  memoryRoot: string,
  event: ActivationEvent
): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, ACTIVATION_EVENTS_FILE), event)
}

export async function readActivationEventsFromRoot(memoryRoot: string): Promise<ActivationEvent[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<ActivationEvent>(join(memoryRoot, ACTIVATION_EVENTS_FILE))
}

export async function appendReflectionCandidateFromRoot(
  memoryRoot: string,
  candidate: ReflectionCandidate
): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, REFLECTION_CANDIDATES_FILE), candidate)
}

export async function readReflectionCandidatesFromRoot(memoryRoot: string): Promise<ReflectionCandidate[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<ReflectionCandidate>(join(memoryRoot, REFLECTION_CANDIDATES_FILE))
}

export async function appendMemoryEvent(cwd: string, event: MemoryEvent): Promise<void> {
  const root = await ensureMemoryRoot(cwd)
  await appendMemoryEventFromRoot(root, event)
}

export async function appendMemoryEventFromRoot(memoryRoot: string, event: MemoryEvent): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, EVENTS_FILE), event)
}

export async function readMemoryEventsFromRoot(memoryRoot: string): Promise<MemoryEvent[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<MemoryEvent>(join(memoryRoot, EVENTS_FILE))
}

export async function readTombstones(cwd: string): Promise<MemoryTombstone[]> {
  const root = await getReadableMemoryRoot(cwd)
  if (root === null) {
    return []
  }
  return readTombstonesFromRoot(root)
}

export async function readTombstonesFromRoot(memoryRoot: string): Promise<MemoryTombstone[]> {
  const readable = await isReadableMemoryRoot(memoryRoot)
  if (!readable) {
    return []
  }
  return readJsonLines<MemoryTombstone>(join(memoryRoot, TOMBSTONES_FILE))
}

export async function writeTombstones(cwd: string, tombstones: MemoryTombstone[]): Promise<void> {
  const root = await ensureMemoryRoot(cwd)
  await writeJsonLinesAtomic(join(root, TOMBSTONES_FILE), tombstones)
}

export async function appendTombstoneFromRoot(memoryRoot: string, tombstone: MemoryTombstone): Promise<void> {
  const root = await ensureWritableMemoryRoot(memoryRoot)
  await appendJsonLine(join(root, TOMBSTONES_FILE), tombstone)
}

export function mergePendingMemory(existing: PendingMemory, candidate: PendingMemory): PendingMemory {
  const seenCount = existing.seenCount + candidate.seenCount
  const sourceOfTruth = existing.sourceOfTruth ?? candidate.sourceOfTruth
  return {
    ...existing,
    content: existing.content,
    scores: averageScores(existing.scores, existing.seenCount, candidate.scores, candidate.seenCount),
    seenCount,
    lastSeenAt: latestIso(existing.lastSeenAt, candidate.lastSeenAt),
    expiresAt: latestIso(existing.expiresAt, candidate.expiresAt),
    promoteAfter: candidate.promoteAfter ?? existing.promoteAfter,
    evidence: [...existing.evidence, ...candidate.evidence].slice(-MAX_PENDING_EVIDENCE),
    candidateKind: existing.candidateKind ?? candidate.candidateKind,
    candidate_kind: existing.candidate_kind ?? candidate.candidate_kind,
    ...(sourceOfTruth === undefined ? {} : { sourceOfTruth }),
    tags: Array.from(new Set([...existing.tags, ...candidate.tags])),
    admittedBy: existing.admittedBy ?? candidate.admittedBy,
    admissionScore: Math.max(existing.admissionScore ?? 0, candidate.admissionScore ?? 0) || undefined,
    admissionReasons: uniqueOptional([...(existing.admissionReasons ?? []), ...(candidate.admissionReasons ?? [])]),
    sourceEpisodeIds: uniqueOptional([...(existing.sourceEpisodeIds ?? []), ...(candidate.sourceEpisodeIds ?? [])]),
    sourceDraftIds: uniqueOptional([...(existing.sourceDraftIds ?? []), ...(candidate.sourceDraftIds ?? [])]),
    conflictsWith: uniqueOptional([...(existing.conflictsWith ?? []), ...(candidate.conflictsWith ?? [])])
  }
}

function averageScores(
  left: MemoryScores,
  leftWeight: number,
  right: MemoryScores,
  rightWeight: number
): MemoryScores {
  const total = leftWeight + rightWeight
  return {
    evidenceStrength: weightedAverage(left.evidenceStrength, leftWeight, right.evidenceStrength, rightWeight, total),
    stability: weightedAverage(left.stability, leftWeight, right.stability, rightWeight, total),
    usefulness: weightedAverage(left.usefulness, leftWeight, right.usefulness, rightWeight, total),
    safety: weightedAverage(left.safety, leftWeight, right.safety, rightWeight, total),
    sensitivity: weightedAverage(left.sensitivity, leftWeight, right.sensitivity, rightWeight, total)
  }
}

function weightedAverage(left: number, leftWeight: number, right: number, rightWeight: number, total: number): number {
  return total === 0 ? right : (left * leftWeight + right * rightWeight) / total
}

function latestIso(left: string, right: string): string {
  return left >= right ? left : right
}

function uniqueOptional(values: string[]): string[] | undefined {
  const unique = Array.from(new Set(values))
  return unique.length === 0 ? undefined : unique
}

async function semanticProjectionForWrite(memoryRoot: string): Promise<SemanticMemory[]> {
  if (await semanticMemoryStoreExists(memoryRoot)) {
    return readSemanticMemoriesFromRoot(memoryRoot)
  }
  const [active, pending] = await Promise.all([
    readJsonLines<CyreneMemory>(join(memoryRoot, INDEX_FILE)),
    readJsonLines<PendingMemory>(join(memoryRoot, PENDING_FILE))
  ])
  return [
    ...active.filter((memory) => memory.status === 'active').map(activeMemoryToSemanticMemory),
    ...pending.filter((memory) => memory.status === 'pending').map(pendingMemoryToSemanticMemory)
  ]
}

async function orderActiveForLegacyProjection(memoryRoot: string, active: CyreneMemory[]): Promise<CyreneMemory[]> {
  const previous = (await readJsonLines<CyreneMemory>(join(memoryRoot, INDEX_FILE))).filter((memory) => memory.status === 'active')
  if (previous.length === 0 || active.length <= 1) {
    return active
  }
  const previousOrder = new Map(previous.map((memory, index) => [memory.id, index]))
  const incomingOrder = new Map(active.map((memory, index) => [memory.id, index]))
  return [...active].sort((left, right) => {
    const leftPrevious = previousOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER
    const rightPrevious = previousOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER
    if (leftPrevious !== rightPrevious) {
      return leftPrevious - rightPrevious
    }
    return (incomingOrder.get(left.id) ?? 0) - (incomingOrder.get(right.id) ?? 0)
  })
}

function replaceSemanticMemoriesByStatus(
  current: SemanticMemory[],
  status: SemanticMemory['status'],
  replacements: SemanticMemory[]
): SemanticMemory[] {
  return upsertSemanticMemories(current.filter((memory) => memory.status !== status), replacements)
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

async function semanticMemoryStoreExists(memoryRoot: string): Promise<boolean> {
  const filePath = join(memoryRoot, SEMANTIC_MEMORIES_FILE)
  try {
    const stats = await lstat(filePath)
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to use memory data file symlink: ${filePath}`)
    }
    if (!stats.isFile()) {
      throw new Error(`Refusing to use non-file memory data path: ${filePath}`)
    }
    return true
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return false
    }
    throw error
  }
}

async function isReadableMemoryRoot(memoryRoot: string): Promise<boolean> {
  try {
    const stats = await lstat(memoryRoot)
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to use memory symlink: ${memoryRoot}`)
    }
    if (!stats.isDirectory()) {
      throw new Error(`Refusing to use non-directory memory path: ${memoryRoot}`)
    }
    return true
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return false
    }
    throw error
  }
}

async function ensureWritableMemoryRoot(memoryRoot: string): Promise<string> {
  try {
    return await getSafeMemoryRoot(memoryRoot)
  } catch (error) {
    if (!isFileErrorCode(error, 'ENOENT')) {
      throw error
    }
  }

  await mkdir(memoryRoot, { recursive: true })
  return getSafeMemoryRoot(memoryRoot)
}

async function getSafeMemoryRoot(memoryRoot: string): Promise<string> {
  const stats = await lstat(memoryRoot)
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to use memory symlink: ${memoryRoot}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`Refusing to use non-directory memory path: ${memoryRoot}`)
  }
  return realpath(memoryRoot)
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
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const content = values.map((value) => JSON.stringify(value)).join('\n')
  await writeFile(tempPath, content === '' ? '' : `${content}\n`, 'utf8')
  await rename(tempPath, filePath)
}

async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await assertSafeMemoryDataFileTarget(filePath)
  await appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8')
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
