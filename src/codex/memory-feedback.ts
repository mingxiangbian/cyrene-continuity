import { createHash, randomUUID } from 'node:crypto'
import { appendActivationEventFromRoot, appendReflectionCandidateFromRoot } from '../memory/memory-store.js'
import type { ActivationEventType, ReflectionCandidate, SemanticMemory } from '../memory/types.js'

function queryHashFor(query: string): string {
  return createHash('sha256').update(query).digest('hex').slice(0, 16)
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
    const memoryIds = [...new Set(input.memoryIds)].sort()
    const createdAt = input.now ?? new Date().toISOString()
    for (const memoryId of memoryIds) {
      await appendActivationEventFailOpen({
        memoryRoot: input.memoryRoot,
        memoryId,
        projectId: input.projectId,
        query: input.query,
        event: input.event ?? 'retrieved',
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
