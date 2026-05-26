import { z } from 'zod'
import {
  getCodexPendingMemory,
  listCodexPendingMemories,
  promoteCodexPendingMemory,
  rejectCodexPendingMemory
} from '../../codex/memory-review.js'
import { jsonText } from '../mcp-json.js'

export const memoryPendingListInputSchema = {
  cwd: z.string().optional(),
  limit: z.number().int().positive().optional()
}

export const memoryPendingGetInputSchema = {
  cwd: z.string().optional(),
  id: z.string()
}

export const memoryReviewDecisionInputSchema = {
  cwd: z.string().optional(),
  id: z.string(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().optional()
}

export async function handleMemoryPendingList(input: { cwd?: string; limit?: number }, fallbackCwd: string) {
  const result = await listCodexPendingMemories({
    cwd: input.cwd ?? fallbackCwd,
    limit: input.limit
  })
  return jsonText(result)
}

export async function handleMemoryPendingGet(input: { cwd?: string; id: string }, fallbackCwd: string) {
  const result = await getCodexPendingMemory({
    cwd: input.cwd ?? fallbackCwd,
    id: input.id
  })
  return jsonText(result)
}

export async function handleMemoryPromote(
  input: { cwd?: string; id: string; reviewHash: string; reason?: string },
  fallbackCwd: string
) {
  const result = await promoteCodexPendingMemory({
    cwd: input.cwd ?? fallbackCwd,
    id: input.id,
    reviewHash: input.reviewHash,
    reason: input.reason
  })
  return jsonText(result)
}

export async function handleMemoryReject(
  input: { cwd?: string; id: string; reviewHash: string; reason?: string },
  fallbackCwd: string
) {
  const result = await rejectCodexPendingMemory({
    cwd: input.cwd ?? fallbackCwd,
    id: input.id,
    reviewHash: input.reviewHash,
    reason: input.reason
  })
  return jsonText(result)
}
