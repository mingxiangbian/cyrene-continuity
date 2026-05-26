import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureWritableMemoryRootPath } from '../memory/memory-store.js'

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
  await appendFile(join(root, REVIEW_SUMMARIES_FILE), `${JSON.stringify(record)}\n`, 'utf8')
}
