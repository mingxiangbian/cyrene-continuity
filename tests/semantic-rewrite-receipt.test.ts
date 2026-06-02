import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  appendSemanticRewriteReceiptFromRoot,
  readSemanticRewriteReceiptsFromRoot
} from '../src/memory/memory-store.js'
import type { SemanticRewriteReceipt } from '../src/memory/types.js'

describe('semantic rewrite receipts', () => {
  it('appends and reads rewrite receipts from a memory root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cyrene-rewrite-receipt-'))
    const receipt: SemanticRewriteReceipt = {
      id: 'receipt-1',
      pendingMemoryId: 'pending-1',
      action: 'replace_content',
      method: 'deterministic',
      oldReviewHash: 'old-hash',
      newReviewHash: 'new-hash',
      originalContentHash: 'original-hash',
      rewrittenContentHash: 'rewritten-hash',
      changedFields: ['content', 'useWhen'],
      eligibilityReasons: ['needs_active_memory_rewrite'],
      validatorReasons: ['rewritten content is active-ready'],
      sourceOfTruth: 'AGENTS.md',
      createdAt: '2026-06-02T00:00:00.000Z'
    }

    await appendSemanticRewriteReceiptFromRoot(root, receipt)

    await expect(readSemanticRewriteReceiptsFromRoot(root)).resolves.toEqual([receipt])
    await expect(readFile(join(root, 'semantic_rewrite_receipts.jsonl'), 'utf8')).resolves.toContain('"replace_content"')
  })
})
