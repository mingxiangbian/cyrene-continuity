import { z } from 'zod'
import {
  deferCodexPendingMemory,
  editCodexPendingMemory,
  getCodexPendingMemory,
  listCodexPendingMemories,
  promoteCodexPendingMemory,
  rejectCodexPendingMemory
} from '../../codex/memory-review.js'
import { MEMORY_CONFLICT_RESOLUTIONS } from '../../memory/types.js'
import { jsonText } from '../mcp-json.js'

export const memoryPendingListInputSchema = {
  limit: z.number().int().positive().optional()
}

export const memoryPendingGetInputSchema = {
  id: z.string()
}

export const memoryReviewDecisionInputSchema = {
  id: z.string(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  conflictResolution: z.enum(MEMORY_CONFLICT_RESOLUTIONS).optional(),
  reason: z.string().optional()
}

export const memoryReviewEditInputSchema = {
  id: z.string(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string().min(1),
  normalizedKey: z.string().optional(),
  reason: z.string().optional()
}

export const memoryReviewDeferInputSchema = {
  id: z.string(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  days: z.number().int().positive().optional(),
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
  input: { cwd?: string; id: string; reviewHash: string; conflictResolution?: 'supersede' | 'keep_both' | 'reject_new'; reason?: string },
  fallbackCwd: string
) {
  const result = await promoteCodexPendingMemory({
    cwd: input.cwd ?? fallbackCwd,
    id: input.id,
    reviewHash: input.reviewHash,
    conflictResolution: input.conflictResolution,
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

export async function handleMemoryEdit(
  input: { cwd?: string; id: string; reviewHash: string; content: string; normalizedKey?: string; reason?: string },
  fallbackCwd: string
) {
  const result = await editCodexPendingMemory({
    cwd: input.cwd ?? fallbackCwd,
    id: input.id,
    reviewHash: input.reviewHash,
    content: input.content,
    normalizedKey: input.normalizedKey,
    reason: input.reason
  })
  return jsonText(result)
}

export async function handleMemoryDefer(
  input: { cwd?: string; id: string; reviewHash: string; days?: number; reason?: string },
  fallbackCwd: string
) {
  const result = await deferCodexPendingMemory({
    cwd: input.cwd ?? fallbackCwd,
    id: input.id,
    reviewHash: input.reviewHash,
    days: input.days,
    reason: input.reason
  })
  return jsonText(result)
}
