import { createHash, randomUUID } from 'node:crypto'
import { appendActivationEventFromRoot, appendReflectionCandidateFromRoot } from '../memory/memory-store.js'
import type { ActivationEventType, ReflectionCandidate, SemanticMemory } from '../memory/types.js'

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
    const queryHash = createHash('sha256').update(input.query).digest('hex').slice(0, 16)
    await Promise.all(memoryIds.map((memoryId) => appendActivationEventFromRoot(input.memoryRoot, {
      id: randomUUID(),
      memoryId,
      projectId: input.projectId,
      queryHash,
      event: input.event ?? 'retrieved',
      ...(input.evidenceRef === undefined ? {} : { evidenceRef: input.evidenceRef }),
      createdAt
    })))
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
