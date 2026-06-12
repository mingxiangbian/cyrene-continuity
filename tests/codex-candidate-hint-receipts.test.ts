import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createCandidateHintSelectionReceipt,
  readCandidateHintReceiptVerificationKey,
  validateCandidateHintSelectionReceipt
} from '../src/codex/candidate-hint-receipts.js'

const tempDirs: string[] = []
const originalHome = process.env.HOME

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function useTempHome(): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'cyrene-candidate-hint-receipts-home-'))
  tempDirs.push(home)
  process.env.HOME = home
}

describe('candidate hint selection receipts', () => {
  it('creates a receipt with HMAC hash and no raw memory text fields', async () => {
    await useTempHome()

    const receipt = await createCandidateHintSelectionReceipt({
      version: 1,
      contextId: 'context-1',
      hintId: 'hint-1',
      memoryId: 'memory-1',
      contentHash: 'content-hash-1',
      projectId: 'project-1',
      mode: 'balanced',
      selectedAt: '2026-06-13T00:00:00.000Z'
    })

    expect(receipt).toEqual({
      version: 1,
      contextId: 'context-1',
      hintId: 'hint-1',
      memoryId: 'memory-1',
      contentHash: 'content-hash-1',
      projectId: 'project-1',
      mode: 'balanced',
      selectedAt: '2026-06-13T00:00:00.000Z',
      receiptHash: expect.stringMatching(/^[a-f0-9]{32}$/)
    })
    expect(Object.keys(receipt)).not.toEqual(expect.arrayContaining([
      'text',
      'query',
      'transcript',
      'content'
    ]))
    await expect(readCandidateHintReceiptVerificationKey()).resolves.toMatch(/^[a-f0-9]{64}$/)
  })

  it('validates a matching receipt and rejects a plain SHA forgery', async () => {
    await useTempHome()
    const receipt = await createCandidateHintSelectionReceipt({
      version: 1,
      contextId: 'context-2',
      hintId: 'hint-2',
      memoryId: 'memory-2',
      contentHash: 'content-hash-2',
      projectId: 'project-2',
      mode: 'review',
      selectedAt: '2026-06-13T00:00:00.000Z'
    })

    await expect(validateCandidateHintSelectionReceipt(receipt, {
      memoryId: 'memory-2',
      contentHash: 'content-hash-2',
      projectId: 'project-2',
      activationId: 'candidate-hint:hint-2',
      now: '2026-06-13T01:00:00.000Z'
    })).resolves.toEqual({
      ok: true,
      audit: {
        candidateHintContextId: 'context-2',
        candidateHintReceiptHash: receipt.receiptHash
      }
    })

    const forged = {
      ...receipt,
      receiptHash: createHash('sha256').update(JSON.stringify(receipt)).digest('hex').slice(0, 32)
    }
    await expect(validateCandidateHintSelectionReceipt(forged, {
      memoryId: 'memory-2',
      contentHash: 'content-hash-2',
      projectId: 'project-2',
      activationId: 'candidate-hint:hint-2',
      now: '2026-06-13T01:00:00.000Z'
    })).resolves.toEqual({
      ok: false,
      reason: 'candidate hint receipt hash mismatch'
    })
  })

  it('rejects expired and mismatched receipts with stable reasons', async () => {
    await useTempHome()
    const receipt = await createCandidateHintSelectionReceipt({
      version: 1,
      contextId: 'context-3',
      hintId: 'hint-3',
      memoryId: 'memory-3',
      contentHash: 'content-hash-3',
      projectId: 'project-3',
      mode: 'balanced',
      selectedAt: '2026-06-13T00:00:00.000Z'
    })

    await expect(validateCandidateHintSelectionReceipt(receipt, {
      memoryId: 'different-memory',
      contentHash: 'content-hash-3',
      projectId: 'project-3',
      activationId: 'candidate-hint:hint-3',
      now: '2026-06-13T01:00:00.000Z'
    })).resolves.toEqual({
      ok: false,
      reason: 'candidate hint receipt does not match memory id'
    })
    await expect(validateCandidateHintSelectionReceipt(receipt, {
      memoryId: 'memory-3',
      contentHash: 'content-hash-3',
      projectId: 'project-3',
      activationId: 'candidate-hint:hint-3',
      now: '2026-06-14T00:00:01.000Z'
    })).resolves.toEqual({
      ok: false,
      reason: 'candidate hint receipt expired'
    })
  })
})
