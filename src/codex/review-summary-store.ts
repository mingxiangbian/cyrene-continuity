import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSafeMemoryDataFileTarget, ensureWritableMemoryRootPath } from '../memory/memory-store.js'

const REVIEW_SUMMARIES_FILE = 'review-summaries.jsonl'

export interface CodexReviewSummaryRecord {
  id: string
  runId: string
  sessionId?: string
  turnId?: string
  createdAt: string
  status: 'ok' | 'failed'
  summary: string
  redaction: {
    input: Record<string, number>
    output: Record<string, number>
  }
  model?: {
    useCase: 'memory_extraction'
    model?: string
  }
  candidateIds: string[]
  failureReason?: string
}

export async function appendCodexReviewSummary(
  memoryRoot: string,
  record: CodexReviewSummaryRecord
): Promise<void> {
  const root = await ensureWritableMemoryRootPath(memoryRoot)
  const targetPath = join(root, REVIEW_SUMMARIES_FILE)
  await assertSafeMemoryDataFileTarget(targetPath)
  await appendFile(targetPath, `${JSON.stringify(record)}\n`, 'utf8')
}
