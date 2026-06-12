import { createHash, randomUUID } from 'node:crypto'
import { contentHashForActiveMemory } from './active-memory-review.js'
import {
  codexGlobalMemoryRoot,
  codexProjectMemoryRoot,
  getReadableCodexGlobalMemoryRoot,
  getReadableCodexProjectMemoryRoot
} from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'
import { redactReviewText } from './review-redaction.js'
import { assertMemoryMaintenanceTargetsSafeFromRoot, withMemoryMaintenanceLockFromRoot } from '../memory/memory-maintenance.js'
import {
  appendActivationEventFromRoot,
  appendReflectionCandidateFromRoot,
  readActivationEventsFromRoot,
  readActiveMemoriesFromRoot
} from '../memory/memory-store.js'
import type { ActivationEvent, ActivationEventType, ReflectionCandidate, SemanticMemory } from '../memory/types.js'

export type PublicActivationFeedbackEvent = 'applied' | 'ignored' | 'corrected' | 'violated'

const PUBLIC_ACTIVATION_FEEDBACK_EVENTS: readonly PublicActivationFeedbackEvent[] = [
  'applied',
  'ignored',
  'corrected',
  'violated'
]

export interface CodexMemoryFeedbackInput {
  cwd: string
  memoryId: string
  contentHash: string
  event: PublicActivationFeedbackEvent
  activationId?: string
  evidenceRef?: string
  query?: string
  reason?: string
  idempotencyKey?: string
  now?: string
}

interface CodexMemoryFeedbackProject {
  projectId: string
  displayName: string
}

export interface CodexMemoryFeedbackResult {
  action: 'memory_feedback'
  memoryRoot: string
  project: CodexMemoryFeedbackProject
  result:
    | {
        action: 'recorded'
        eventId: string
        memoryId: string
        event: PublicActivationFeedbackEvent
        queryHash?: string
        idempotencyKey: string
      }
    | {
        action: 'duplicate'
        eventId: string
        memoryId: string
        event: PublicActivationFeedbackEvent
        idempotencyKey: string
      }
    | {
        action: 'not_found'
        reason: string
      }
    | {
        action: 'conflict'
        reason: 'Active memory changed since review'
      }
    | {
        action: 'invalid_request'
        reason: string
      }
}

type ActivationFeedbackEvent = ActivationEvent & { contentHash?: string; idempotencyKey?: string }

function queryHashFor(query: string): string {
  return createHash('sha256').update(query).digest('hex').slice(0, 16)
}

export async function recordCodexMemoryFeedback(
  input: CodexMemoryFeedbackInput
): Promise<CodexMemoryFeedbackResult> {
  const projectIdentity = await identifyCodexProject(input.cwd)
  const project = { projectId: projectIdentity.projectId, displayName: projectIdentity.displayName }
  const projectMemoryRoot = (await getReadableCodexProjectMemoryRoot(project.projectId)) ??
    codexProjectMemoryRoot(project.projectId)
  const globalMemoryRoot = (await getReadableCodexGlobalMemoryRoot()) ?? codexGlobalMemoryRoot()
  const defaultResult = (result: CodexMemoryFeedbackResult['result']): CodexMemoryFeedbackResult => ({
    action: 'memory_feedback',
    memoryRoot: projectMemoryRoot,
    project,
    result
  })

  const validation = validatePublicFeedbackInput(input)
  if (validation !== undefined) {
    return defaultResult(validation)
  }

  const roots = uniqueInOrder([projectMemoryRoot, globalMemoryRoot])
  const foundMemoryRoot = await findActiveMemoryRoot(roots, input.memoryId)
  if (foundMemoryRoot === undefined) {
    return defaultResult({ action: 'not_found', reason: 'Active memory not found' })
  }

  await assertMemoryMaintenanceTargetsSafeFromRoot(foundMemoryRoot)
  return withMemoryMaintenanceLockFromRoot(foundMemoryRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const active = await readActiveMemoriesFromRoot(lockedMemoryRoot)
    const memory = active.find((item) => item.id === input.memoryId)
    if (memory === undefined) {
      return {
        action: 'memory_feedback',
        memoryRoot: lockedMemoryRoot,
        project,
        result: { action: 'not_found', reason: 'Active memory not found' }
      }
    }
    if (contentHashForActiveMemory(memory) !== input.contentHash) {
      return {
        action: 'memory_feedback',
        memoryRoot: lockedMemoryRoot,
        project,
        result: { action: 'conflict', reason: 'Active memory changed since review' }
      }
    }

    const queryHash = input.query === undefined ? undefined : queryHashFor(input.query)
    const idempotencyKey = normalizedIdempotencyKey(input, queryHash)
    const existing = findDuplicateFeedback(
      await readActivationEventsFromRoot(lockedMemoryRoot),
      {
        memoryId: input.memoryId,
        event: input.event,
        activationId: input.activationId,
        evidenceRef: input.evidenceRef,
        queryHash,
        idempotencyKey
      }
    )
    if (existing !== undefined) {
      return {
        action: 'memory_feedback',
        memoryRoot: lockedMemoryRoot,
        project,
        result: {
          action: 'duplicate',
          eventId: existing.id,
          memoryId: input.memoryId,
          event: input.event,
          idempotencyKey
        }
      }
    }

    const eventId = randomUUID()
    const event: ActivationFeedbackEvent = {
      id: eventId,
      memoryId: memory.id,
      projectId: project.projectId,
      contentHash: input.contentHash,
      ...(queryHash === undefined ? {} : { queryHash }),
      event: input.event,
      ...(input.activationId === undefined ? {} : { activationId: input.activationId }),
      ...(input.reason === undefined ? {} : { reason: sanitizeReason(input.reason) }),
      ...(input.evidenceRef === undefined ? {} : { evidenceRef: input.evidenceRef }),
      idempotencyKey,
      createdAt: input.now ?? new Date().toISOString()
    }
    await appendActivationEventFromRoot(lockedMemoryRoot, event)
    return {
      action: 'memory_feedback',
      memoryRoot: lockedMemoryRoot,
      project,
      result: {
        action: 'recorded',
        eventId,
        memoryId: memory.id,
        event: input.event,
        ...(queryHash === undefined ? {} : { queryHash }),
        idempotencyKey
      }
    }
  })
}

function validatePublicFeedbackInput(
  input: CodexMemoryFeedbackInput
): Extract<CodexMemoryFeedbackResult['result'], { action: 'invalid_request' }> | undefined {
  if (!isPublicActivationFeedbackEvent(input.event)) {
    return { action: 'invalid_request', reason: 'event must be applied, ignored, corrected, or violated' }
  }
  if (input.memoryId.trim() === '') {
    return { action: 'invalid_request', reason: 'memoryId is required' }
  }
  if (input.contentHash.trim() === '') {
    return { action: 'invalid_request', reason: 'contentHash is required' }
  }
  if ((input.event === 'corrected' || input.event === 'violated') && empty(input.reason)) {
    return { action: 'invalid_request', reason: `${input.event} feedback requires reason` }
  }
  if (input.event === 'applied' && empty(input.query) && empty(input.evidenceRef)) {
    return { action: 'invalid_request', reason: 'applied feedback requires query or evidenceRef' }
  }
  return undefined
}

function isPublicActivationFeedbackEvent(value: unknown): value is PublicActivationFeedbackEvent {
  return PUBLIC_ACTIVATION_FEEDBACK_EVENTS.includes(value as PublicActivationFeedbackEvent)
}

async function findActiveMemoryRoot(roots: string[], memoryId: string): Promise<string | undefined> {
  for (const root of roots) {
    const active = await readActiveMemoriesFromRoot(root)
    if (active.some((memory) => memory.id === memoryId)) {
      return root
    }
  }
  return undefined
}

function normalizedIdempotencyKey(input: CodexMemoryFeedbackInput, queryHash: string | undefined): string {
  const explicit = input.idempotencyKey?.trim()
  if (explicit !== undefined && explicit !== '') {
    return explicit
  }
  return createHash('sha256')
    .update(`${input.memoryId}:${input.event}:${feedbackContextKey({
      activationId: input.activationId,
      evidenceRef: input.evidenceRef,
      queryHash
    })}`)
    .digest('hex')
    .slice(0, 16)
}

function findDuplicateFeedback(
  events: ActivationEvent[],
  input: {
    memoryId: string
    event: PublicActivationFeedbackEvent
    activationId?: string
    evidenceRef?: string
    queryHash?: string
    idempotencyKey: string
  }
): ActivationEvent | undefined {
  const contextKey = feedbackContextKey(input)
  return events.find((event) => {
    if (event.memoryId !== input.memoryId || event.event !== input.event) {
      return false
    }
    if ((event as ActivationFeedbackEvent).idempotencyKey === input.idempotencyKey) {
      return true
    }
    return feedbackContextKey(event) === contextKey
  })
}

function feedbackContextKey(input: {
  activationId?: string
  evidenceRef?: string
  queryHash?: string
}): string {
  return firstNonEmpty(input.evidenceRef, input.activationId, input.queryHash) ?? 'none'
}

function sanitizeReason(reason: string): string {
  return redactReviewText(reason.replace(/\s+/g, ' ').trim()).text.slice(0, 500)
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== '')
}

function empty(value: string | undefined): boolean {
  return value === undefined || value.trim() === ''
}

function uniqueInOrder(values: string[]): string[] {
  return Array.from(new Set(values))
}

export async function appendActivationEventFailOpen(input: {
  memoryRoot: string
  memoryId: string
  projectId?: string
  query?: string
  event: ActivationEventType
  activationId?: string
  reason?: string
  evidenceRef?: string
  now?: string
}): Promise<void> {
  try {
    await appendActivationEventFromRoot(input.memoryRoot, {
      id: randomUUID(),
      memoryId: input.memoryId,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.query === undefined ? {} : { queryHash: queryHashFor(input.query) }),
      event: input.event,
      ...(input.activationId === undefined ? {} : { activationId: input.activationId }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.evidenceRef === undefined ? {} : { evidenceRef: input.evidenceRef }),
      createdAt: input.now ?? new Date().toISOString()
    })
  } catch {
    // Continuity feedback is advisory; failures must not block callers.
  }
}

export async function appendActivationEventsFailOpen(input: {
  memoryRoot: string
  memoryIds: string[]
  projectId: string
  query: string
  event?: ActivationEventType
  evidenceRef?: string
  now?: string
}): Promise<void> {
  try {
    const event = input.event ?? 'retrieved'
    if (event !== 'retrieved') {
      return
    }
    const memoryIds = [...new Set(input.memoryIds)].sort()
    const createdAt = input.now ?? new Date().toISOString()
    for (const memoryId of memoryIds) {
      await appendActivationEventFailOpen({
        memoryRoot: input.memoryRoot,
        memoryId,
        projectId: input.projectId,
        query: input.query,
        event,
        evidenceRef: input.evidenceRef,
        now: createdAt
      })
    }
  } catch {
    // Continuity context construction must not fail because feedback logging failed.
  }
}

export async function appendReflectionCandidateFailOpen(input: {
  memoryRoot: string
  sourceActivationEventIds: string[]
  proposedAction: ReflectionCandidate['proposedAction']
  candidate: SemanticMemory
  reasons: string[]
  now?: string
}): Promise<void> {
  try {
    await appendReflectionCandidateFromRoot(input.memoryRoot, {
      id: randomUUID(),
      sourceActivationEventIds: input.sourceActivationEventIds,
      proposedAction: input.proposedAction,
      candidate: input.candidate,
      reasons: input.reasons,
      createdAt: input.now ?? new Date().toISOString()
    })
  } catch {
    // Reflection suggestions are advisory; failures must not block callers.
  }
}
