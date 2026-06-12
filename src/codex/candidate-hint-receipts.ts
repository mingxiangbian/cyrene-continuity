import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ensureCodexRuntimeRoot,
  getReadableCodexRuntimeRoot
} from './codex-memory-root.js'

export type CandidateHintReceiptMode = 'balanced' | 'review'

export interface CandidateHintSelectionReceipt {
  version: 1
  contextId: string
  hintId: string
  memoryId: string
  contentHash: string
  projectId: string
  mode: CandidateHintReceiptMode
  selectedAt: string
  receiptHash: string
}

export interface CandidateHintReceiptAudit {
  candidateHintContextId: string
  candidateHintReceiptHash: string
}

type ReceiptWithoutHash = Omit<CandidateHintSelectionReceipt, 'receiptHash'>

const RECEIPT_KEY_FILE = 'candidate-hint-receipt.key'
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000

export async function createCandidateHintSelectionReceipt(
  input: ReceiptWithoutHash
): Promise<CandidateHintSelectionReceipt> {
  const key = await loadOrCreateCandidateHintReceiptVerificationKey()
  const receipt = receiptPayload(input)
  return {
    ...receipt,
    receiptHash: candidateHintReceiptHash(receipt, key)
  }
}

export async function readCandidateHintReceiptVerificationKey(): Promise<string | undefined> {
  const root = await getReadableCodexRuntimeRoot()
  if (root === null) return undefined
  try {
    const value = (await readFile(join(root, RECEIPT_KEY_FILE), 'utf8')).trim()
    return /^[a-f0-9]{64}$/.test(value) ? value : undefined
  } catch {
    return undefined
  }
}

export async function validateCandidateHintSelectionReceipt(
  value: unknown,
  expected: {
    memoryId: string
    contentHash: string
    projectId: string
    activationId?: string
    now?: string
  }
): Promise<
  | { ok: true; audit: CandidateHintReceiptAudit }
  | { ok: false; reason: string }
> {
  if (!isCandidateHintSelectionReceipt(value)) {
    return { ok: false, reason: 'candidate hint receipt is required for candidate-hint activation' }
  }
  if (value.memoryId !== expected.memoryId) {
    return { ok: false, reason: 'candidate hint receipt does not match memory id' }
  }
  if (value.contentHash !== expected.contentHash) {
    return { ok: false, reason: 'candidate hint receipt does not match content hash' }
  }
  if (value.projectId !== expected.projectId) {
    return { ok: false, reason: 'candidate hint receipt does not match project id' }
  }
  if (expected.activationId !== `candidate-hint:${value.hintId}`) {
    return { ok: false, reason: 'candidate hint receipt does not match activation id' }
  }

  const selectedAtMs = Date.parse(value.selectedAt)
  const nowMs = Date.parse(expected.now ?? new Date().toISOString())
  if (
    !Number.isFinite(selectedAtMs) ||
    !Number.isFinite(nowMs) ||
    nowMs - selectedAtMs > RECEIPT_TTL_MS ||
    nowMs < selectedAtMs
  ) {
    return { ok: false, reason: 'candidate hint receipt expired' }
  }

  const key = await readCandidateHintReceiptVerificationKey()
  if (key === undefined) {
    return { ok: false, reason: 'candidate hint receipt hash mismatch' }
  }
  const expectedHash = candidateHintReceiptHash(receiptPayload(value), key)
  if (!safeEqualHex(value.receiptHash, expectedHash)) {
    return { ok: false, reason: 'candidate hint receipt hash mismatch' }
  }

  return {
    ok: true,
    audit: {
      candidateHintContextId: value.contextId,
      candidateHintReceiptHash: value.receiptHash
    }
  }
}

async function loadOrCreateCandidateHintReceiptVerificationKey(): Promise<string> {
  const existing = await readCandidateHintReceiptVerificationKey()
  if (existing !== undefined) return existing
  const root = await ensureCodexRuntimeRoot()
  const key = randomBytes(32).toString('hex')
  await writeFile(join(root, RECEIPT_KEY_FILE), `${key}\n`, { mode: 0o600 })
  return key
}

function candidateHintReceiptHash(receipt: ReceiptWithoutHash, key: string): string {
  return createHmac('sha256', key)
    .update(JSON.stringify(receiptPayload(receipt)))
    .digest('hex')
    .slice(0, 32)
}

function receiptPayload(receipt: ReceiptWithoutHash): ReceiptWithoutHash {
  return {
    version: 1,
    contextId: receipt.contextId,
    hintId: receipt.hintId,
    memoryId: receipt.memoryId,
    contentHash: receipt.contentHash,
    projectId: receipt.projectId,
    mode: receipt.mode,
    selectedAt: receipt.selectedAt
  }
}

function isCandidateHintSelectionReceipt(value: unknown): value is CandidateHintSelectionReceipt {
  if (typeof value !== 'object' || value === null) return false
  const receipt = value as Record<string, unknown>
  return (
    receipt.version === 1 &&
    typeof receipt.contextId === 'string' &&
    typeof receipt.hintId === 'string' &&
    typeof receipt.memoryId === 'string' &&
    typeof receipt.contentHash === 'string' &&
    typeof receipt.projectId === 'string' &&
    (receipt.mode === 'balanced' || receipt.mode === 'review') &&
    typeof receipt.selectedAt === 'string' &&
    typeof receipt.receiptHash === 'string'
  )
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/.test(left) || !/^[a-f0-9]+$/.test(right)) return false
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
