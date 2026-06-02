import { codexProjectMemoryRoot } from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'
import { withMemoryMaintenanceLockFromRoot } from '../memory/memory-maintenance.js'
import {
  appendSemanticRewriteReceiptFromRoot,
  readActiveMemoriesFromRoot,
  readMemoryEventsFromRoot,
  readPendingMemoriesFromRoot,
  readSemanticRewriteReceiptsFromRoot,
  writePendingMemoriesFromRoot
} from '../memory/memory-store.js'
import type {
  MemoryEvent,
  PendingMemory,
  SemanticRewriteReceipt
} from '../memory/types.js'
import { reviewHashForPendingMemory } from './memory-review.js'
import {
  preparePendingSemanticRewrite,
  type SemanticRewritePreparationResult
} from './semantic-rewrite.js'

export interface CodexMemoryPrepareInput {
  cwd?: string
  memoryRoot?: string
  dryRun?: boolean
  now?: string
  maxItemsPerRun?: number
}

export interface CodexMemoryPrepareResult {
  memoryRoot: string
  dryRun: boolean
  activeBeforeCount: number
  activeAfterCount: number
  pendingBeforeCount: number
  pendingAfterCount: number
  results: SemanticRewritePreparationResult[]
  nextPending: PendingMemory[]
  receipts: SemanticRewriteReceipt[]
}

export async function runCodexMemoryPrepare(input: CodexMemoryPrepareInput): Promise<CodexMemoryPrepareResult> {
  const memoryRoot = await resolveMemoryRoot(input)
  if (input.dryRun ?? true) {
    return runCodexMemoryPrepareFromRoot({ ...input, memoryRoot, dryRun: true })
  }
  return withMemoryMaintenanceLockFromRoot(memoryRoot, (lockedMemoryRoot) =>
    runCodexMemoryPrepareFromRoot({ ...input, memoryRoot: lockedMemoryRoot, dryRun: false })
  )
}

async function runCodexMemoryPrepareFromRoot(
  input: Required<Pick<CodexMemoryPrepareInput, 'memoryRoot' | 'dryRun'>> & CodexMemoryPrepareInput
): Promise<CodexMemoryPrepareResult> {
  const now = input.now ?? new Date().toISOString()
  const [activeBefore, pending, existingReceipts, memoryEvents] = await Promise.all([
    readActiveMemoriesFromRoot(input.memoryRoot),
    readPendingMemoriesFromRoot(input.memoryRoot),
    readSemanticRewriteReceiptsFromRoot(input.memoryRoot),
    readMemoryEventsFromRoot(input.memoryRoot)
  ])
  const prepared = preparePendingBatch(pending, existingReceipts, {
    now,
    maxItemsPerRun: input.maxItemsPerRun,
    userReviewEvents: memoryEvents
  })

  if (input.dryRun) {
    return {
      memoryRoot: input.memoryRoot,
      dryRun: true,
      activeBeforeCount: activeBefore.length,
      activeAfterCount: activeBefore.length,
      pendingBeforeCount: pending.length,
      pendingAfterCount: prepared.nextPending.length,
      results: prepared.results,
      nextPending: prepared.nextPending,
      receipts: prepared.receipts
    }
  }

  await writePendingMemoriesFromRoot(input.memoryRoot, prepared.nextPending)
  for (const receipt of prepared.receipts) {
    await appendSemanticRewriteReceiptFromRoot(input.memoryRoot, receipt)
  }
  const activeAfter = await readActiveMemoriesFromRoot(input.memoryRoot)

  return {
    memoryRoot: input.memoryRoot,
    dryRun: false,
    activeBeforeCount: activeBefore.length,
    activeAfterCount: activeAfter.length,
    pendingBeforeCount: pending.length,
    pendingAfterCount: prepared.nextPending.length,
    results: prepared.results,
    nextPending: prepared.nextPending,
    receipts: prepared.receipts
  }
}

function preparePendingBatch(
  pending: PendingMemory[],
  existingReceipts: SemanticRewriteReceipt[],
  input: { now: string; maxItemsPerRun?: number; userReviewEvents: MemoryEvent[] }
): {
  results: SemanticRewritePreparationResult[]
  nextPending: PendingMemory[]
  receipts: SemanticRewriteReceipt[]
} {
  const maxItems = input.maxItemsPerRun ?? pending.length
  const results: SemanticRewritePreparationResult[] = []
  const nextPending: PendingMemory[] = []
  const receipts: SemanticRewriteReceipt[] = []
  let processed = 0

  for (const candidate of pending) {
    if (processed >= maxItems || hasCurrentSuccessfulReceipt(candidate, existingReceipts)) {
      nextPending.push(candidate)
      continue
    }

    const result = preparePendingSemanticRewrite(candidate, {
      now: input.now,
      ineligibleReasons: reviewIneligibilityReasonsForCandidate(candidate, input.userReviewEvents)
    })
    results.push(result)
    nextPending.push(result.next)
    processed += 1

    if (result.action !== 'skip' && result.receipt !== undefined) {
      receipts.push(result.receipt)
    }
  }

  return { results, nextPending, receipts }
}

function reviewIneligibilityReasonsForCandidate(candidate: PendingMemory, events: MemoryEvent[]): string[] {
  const reasons: string[] = []
  for (const event of events) {
    if (event.candidateId !== candidate.id) continue
    const reviewAction = typeof event.details?.reviewAction === 'string' ? event.details.reviewAction : undefined
    if (reviewAction === 'edit') reasons.push('user_edited_pending')
    if (reviewAction === 'defer') reasons.push('user_deferred_pending')
    if (reviewAction === 'reject') reasons.push('user_rejected_pending')
    if (reviewAction === 'promote') reasons.push('user_approved_pending')
    if (event.action === 'reject') reasons.push('user_rejected_pending')
    if (event.action === 'promote') reasons.push('user_approved_pending')
  }
  return Array.from(new Set(reasons))
}

function hasCurrentSuccessfulReceipt(candidate: PendingMemory, receipts: SemanticRewriteReceipt[]): boolean {
  const currentReviewHash = reviewHashForPendingMemory(candidate)
  return receipts.some((receipt) =>
    receipt.pendingMemoryId === candidate.id &&
    receipt.newReviewHash === currentReviewHash &&
    (receipt.action === 'replace_content' || receipt.action === 'enrich_boundaries')
  )
}

async function resolveMemoryRoot(input: CodexMemoryPrepareInput): Promise<string> {
  if (input.memoryRoot !== undefined) {
    return input.memoryRoot
  }
  const cwd = input.cwd ?? process.cwd()
  const identity = await identifyCodexProject(cwd)
  return codexProjectMemoryRoot(identity.projectId)
}
