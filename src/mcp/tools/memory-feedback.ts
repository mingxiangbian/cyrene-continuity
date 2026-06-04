import { z } from 'zod'
import { recordCodexMemoryFeedback, type PublicActivationFeedbackEvent } from '../../codex/memory-feedback.js'
import { jsonText } from '../mcp-json.js'

export const memoryFeedbackInputSchema = {
  memoryId: z.string().min(1),
  contentHash: z.string().min(1),
  event: z.enum(['applied', 'ignored', 'corrected', 'violated']),
  activationId: z.string().optional(),
  evidenceRef: z.string().optional(),
  query: z.string().optional(),
  reason: z.string().optional(),
  idempotencyKey: z.string().optional()
}

export async function handleMemoryFeedback(
  input: {
    memoryId: string
    contentHash: string
    event: PublicActivationFeedbackEvent
    activationId?: string
    evidenceRef?: string
    query?: string
    reason?: string
    idempotencyKey?: string
  },
  fallbackCwd: string
) {
  const result = await recordCodexMemoryFeedback({
    cwd: fallbackCwd,
    memoryId: input.memoryId,
    contentHash: input.contentHash,
    event: input.event,
    activationId: input.activationId,
    evidenceRef: input.evidenceRef,
    query: input.query,
    reason: input.reason,
    idempotencyKey: input.idempotencyKey
  })
  return jsonText(result)
}
