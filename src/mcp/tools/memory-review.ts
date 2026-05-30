import { z } from 'zod'
import {
  archiveCodexActiveMemory,
  proposeEditCodexActiveMemory,
  supersedeCodexActiveMemory,
  tombstoneCodexActiveMemory
} from '../../codex/active-memory-review.js'
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

export const activeMemoryArchiveInputSchema = {
  id: z.string(),
  contentHash: z.string().min(1),
  reason: z.string().min(1),
  cwd: z.string().optional()
}

export const activeMemoryTombstoneInputSchema = {
  id: z.string(),
  contentHash: z.string().min(1),
  reason: z.string().min(1),
  days: z.number().int().positive().optional(),
  indefinite: z.boolean().optional(),
  confirmText: z.string().optional(),
  cwd: z.string().optional()
}

export const activeMemoryProposeEditInputSchema = {
  id: z.string(),
  contentHash: z.string().min(1),
  content: z.string().min(1),
  reason: z.string().min(1),
  cwd: z.string().optional()
}

export const activeMemorySupersedeInputSchema = {
  id: z.string(),
  candidateId: z.string().min(1),
  contentHash: z.string().min(1),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().min(1),
  confirmText: z.string().optional(),
  cwd: z.string().optional()
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

export async function handleActiveMemoryArchive(
  input: { cwd?: string; id: string; contentHash: string; reason: string },
  fallbackCwd: string
) {
  return jsonText(await archiveCodexActiveMemory({
    cwd: input.cwd ?? fallbackCwd,
    id: input.id,
    contentHash: input.contentHash,
    reason: input.reason
  }))
}

export async function handleActiveMemoryTombstone(
  input: { cwd?: string; id: string; contentHash: string; reason: string; days?: number; indefinite?: boolean; confirmText?: string },
  fallbackCwd: string
) {
  return jsonText(await tombstoneCodexActiveMemory({
    cwd: input.cwd ?? fallbackCwd,
    id: input.id,
    contentHash: input.contentHash,
    reason: input.reason,
    days: input.days,
    indefinite: input.indefinite,
    confirmText: input.confirmText
  }))
}

export async function handleActiveMemoryProposeEdit(
  input: { cwd?: string; id: string; contentHash: string; content: string; reason: string },
  fallbackCwd: string
) {
  return jsonText(await proposeEditCodexActiveMemory({
    cwd: input.cwd ?? fallbackCwd,
    id: input.id,
    contentHash: input.contentHash,
    content: input.content,
    reason: input.reason
  }))
}

export async function handleActiveMemorySupersede(
  input: { cwd?: string; id: string; candidateId: string; contentHash: string; reviewHash: string; reason: string; confirmText?: string },
  fallbackCwd: string
) {
  return jsonText(await supersedeCodexActiveMemory({
    cwd: input.cwd ?? fallbackCwd,
    id: input.id,
    candidateId: input.candidateId,
    contentHash: input.contentHash,
    reviewHash: input.reviewHash,
    reason: input.reason,
    confirmText: input.confirmText
  }))
}
