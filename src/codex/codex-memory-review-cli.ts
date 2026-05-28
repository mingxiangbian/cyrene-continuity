import {
  deferCodexPendingMemory,
  editCodexPendingMemory,
  listCodexPendingMemories,
  promoteCodexPendingMemory,
  rejectCodexPendingMemory
} from './memory-review.js'
import type { MemoryConflictResolution } from '../memory/types.js'

export async function formatCodexMemoryReview(input: { cwd: string; limit?: number }): Promise<string> {
  const result = await listCodexPendingMemories(input)
  const lines = [
    'Cyrene Pending Memory Review',
    `project: ${result.project.displayName} (${result.project.projectId})`,
    `memory root: ${result.memoryRoot}`,
    `pending: ${result.pending.length}/${result.total}`,
    ''
  ]
  if (result.pending.length === 0) {
    lines.push('No pending memory candidates.')
    return `${lines.join('\n')}\n`
  }

  for (const item of result.pending) {
    lines.push(
      `- id: ${item.id}`,
      `  recommendation: ${item.recommendation}`,
      `  type: ${item.type}`,
      `  scope: ${item.scope}`,
      `  domain: ${item.domain}`,
      `  candidate kind: ${item.candidateKind}`,
      `  content: ${item.content}`,
      `  evidence count: ${item.evidenceCount}`,
      `  risk: ${item.risk}`,
      `  sensitivity: ${item.sensitivity}`,
      `  review hash: ${item.reviewHash}`,
      `  suggested action: ${item.suggestedAction}`
    )
  }
  return `${lines.join('\n')}\n`
}

export async function runCodexMemoryApprove(input: {
  cwd: string
  id: string
  reviewHash: string
  conflictResolution?: MemoryConflictResolution
  reason?: string
}): Promise<string> {
  return `${JSON.stringify(await promoteCodexPendingMemory(input), null, 2)}\n`
}

export async function runCodexMemoryReject(input: {
  cwd: string
  id: string
  reviewHash: string
  reason?: string
}): Promise<string> {
  return `${JSON.stringify(await rejectCodexPendingMemory(input), null, 2)}\n`
}

export async function runCodexMemoryEdit(input: {
  cwd: string
  id: string
  reviewHash: string
  content: string
  normalizedKey?: string
  reason?: string
}): Promise<string> {
  return `${JSON.stringify(await editCodexPendingMemory(input), null, 2)}\n`
}

export async function runCodexMemoryDefer(input: {
  cwd: string
  id: string
  reviewHash: string
  days?: number
  reason?: string
}): Promise<string> {
  return `${JSON.stringify(await deferCodexPendingMemory(input), null, 2)}\n`
}
