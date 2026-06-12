import { join } from 'node:path'
import { estimateTokens } from '../token-counter.js'
import { scanJsonlFile } from '../memory/jsonl-diagnostics.js'
import { semanticMemoryToActiveMemory } from '../memory/semantic-memory-adapter.js'
import type { CyreneMemory, MemoryTombstone, SemanticMemory } from '../memory/types.js'
import {
  BALANCED_CANDIDATE_CAP,
  JSONL_FALLBACK_FILE_SIZE_CAP_BYTES,
  JSONL_FALLBACK_RECORD_CAP
} from './retrieval-v2-constants.js'

export interface BoundedActiveJsonlFallbackDiagnostics {
  fallbackMode: 'jsonl_bounded_fallback' | 'degraded'
  recordCap: number
  fileSizeCap: number
  selectedCount: number
  skippedRoots: string[]
  corruptionCount: number
  reason?: string
}

export async function readBoundedActiveJsonlFallback(input: {
  memoryRoots: string[]
  currentProjectId: string
  query: string
  maxTokens: number
}): Promise<{
  memories: CyreneMemory[]
  diagnostics: BoundedActiveJsonlFallbackDiagnostics
}> {
  const skippedRoots = new Set<string>()
  let corruptionCount = 0
  const tombstonedIds = new Set<string>()
  const tombstonedKeys = new Set<string>()
  const activeSemanticMemories: SemanticMemory[] = []
  let consumedRecords = 0

  for (const memoryRoot of input.memoryRoots) {
    const tombstoneScan = await scanJsonlFile(
      join(memoryRoot, 'tombstones.jsonl'),
      { fileSizeCapBytes: JSONL_FALLBACK_FILE_SIZE_CAP_BYTES },
      'tombstones.jsonl'
    )
    const tombstones: MemoryTombstone[] = []
    let invalidTombstones = 0
    const tombstoneRecordCapExceeded = tombstoneScan.records.length > JSONL_FALLBACK_RECORD_CAP
    for (const record of tombstoneRecordCapExceeded ? [] : tombstoneScan.records) {
      if (isMemoryTombstone(record)) {
        tombstones.push(record)
      } else {
        invalidTombstones += 1
      }
    }
    if (
      tombstoneScan.skippedReason !== undefined ||
      tombstoneScan.malformed.length > 0 ||
      invalidTombstones > 0 ||
      tombstoneRecordCapExceeded
    ) {
      skippedRoots.add(memoryRoot)
      corruptionCount += tombstoneScan.malformed.length +
        invalidTombstones +
        (tombstoneScan.skippedReason === undefined ? 0 : 1) +
        (tombstoneRecordCapExceeded ? 1 : 0)
      continue
    }
    for (const tombstone of tombstones) {
      if (!isActiveTombstone(tombstone)) {
        continue
      }
      if (tombstone.memoryId !== undefined) {
        tombstonedIds.add(tombstone.memoryId)
      }
      tombstonedKeys.add(tombstone.normalizedKey)
    }
  }

  if (skippedRoots.size > 0) {
    return {
      memories: [],
      diagnostics: {
        fallbackMode: 'degraded',
        recordCap: JSONL_FALLBACK_RECORD_CAP,
        fileSizeCap: JSONL_FALLBACK_FILE_SIZE_CAP_BYTES,
        selectedCount: 0,
        skippedRoots: [...skippedRoots],
        corruptionCount,
        reason: 'fail_closed_missing_lifecycle_side_data'
      }
    }
  }

  for (const memoryRoot of input.memoryRoots) {
    if (consumedRecords >= JSONL_FALLBACK_RECORD_CAP) {
      break
    }
    const semanticScan = await scanJsonlFile(
      join(memoryRoot, 'semantic_memories.jsonl'),
      { fileSizeCapBytes: JSONL_FALLBACK_FILE_SIZE_CAP_BYTES },
      'semantic_memories.jsonl'
    )
    if (semanticScan.skippedReason !== undefined || semanticScan.malformed.length > 0) {
      skippedRoots.add(memoryRoot)
      corruptionCount += semanticScan.malformed.length + (semanticScan.skippedReason === undefined ? 0 : 1)
      continue
    }
    for (const record of semanticScan.records) {
      if (consumedRecords >= JSONL_FALLBACK_RECORD_CAP) {
        break
      }
      consumedRecords += 1
      if (!isSemanticMemory(record)) {
        corruptionCount += 1
        continue
      }
      if (record.status === 'active') {
        activeSemanticMemories.push(record)
      }
    }
  }

  const supersededIds = new Set<string>()
  for (const memory of activeSemanticMemories) {
    for (const supersededId of memory.supersedes) {
      supersededIds.add(supersededId)
    }
  }

  const queryTokens = tokenize(input.query)
  const scored = activeSemanticMemories
    .map(semanticMemoryToActiveMemory)
    .filter((memory) => (
      !tombstonedIds.has(memory.id) &&
      !tombstonedKeys.has(memory.normalizedKey) &&
      !supersededIds.has(memory.id)
    ))
    .map((memory) => ({
      memory,
      score: scoreMemory(memory, queryTokens)
    }))
    .filter((item) => queryTokens.length === 0 || item.score > 0)
    .sort(compareScoredMemories)

  const memories = selectWithinBudget(scored.map((item) => item.memory), BALANCED_CANDIDATE_CAP, input.maxTokens)

  return {
    memories,
    diagnostics: {
      fallbackMode: 'jsonl_bounded_fallback',
      recordCap: JSONL_FALLBACK_RECORD_CAP,
      fileSizeCap: JSONL_FALLBACK_FILE_SIZE_CAP_BYTES,
      selectedCount: memories.length,
      skippedRoots: [...skippedRoots],
      corruptionCount
    }
  }
}

function isActiveTombstone(tombstone: MemoryTombstone): boolean {
  return tombstone.expiresAt === undefined || tombstone.expiresAt > new Date().toISOString()
}

function scoreMemory(memory: CyreneMemory, queryTokens: string[]): number {
  if (queryTokens.length === 0) {
    return 0.2
  }
  const haystack = new Set(tokenize([
    memory.content,
    memory.normalizedKey,
    memory.domain,
    memory.type,
    memory.strength,
    ...(memory.useWhen ?? []),
    ...(memory.tags ?? [])
  ].join(' ')))
  const matches = queryTokens.filter((token) => haystack.has(token) || [...haystack].some((candidate) => candidate.includes(token)))
  return matches.length / queryTokens.length
}

function compareScoredMemories(
  left: { memory: CyreneMemory; score: number },
  right: { memory: CyreneMemory; score: number }
): number {
  const scoreDiff = right.score - left.score
  if (scoreDiff !== 0) {
    return scoreDiff
  }
  const updatedDiff = right.memory.updatedAt.localeCompare(left.memory.updatedAt)
  if (updatedDiff !== 0) {
    return updatedDiff
  }
  return left.memory.id.localeCompare(right.memory.id)
}

function selectWithinBudget(memories: CyreneMemory[], maxItems: number, maxTokens: number): CyreneMemory[] {
  const selected: CyreneMemory[] = []
  let tokenCount = 0
  for (const memory of memories) {
    if (selected.length >= maxItems) {
      break
    }
    const itemTokens = estimateTokens(memory.content)
    if (itemTokens > maxTokens) {
      continue
    }
    if (tokenCount + itemTokens > maxTokens) {
      break
    }
    selected.push(memory)
    tokenCount += itemTokens
  }
  return selected
}

function tokenize(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9_./:-]+/g) ?? [])
    .map((token) => token.replace(/^[./:-]+|[./:-]+$/g, ''))
    .filter(Boolean)
}

function isSemanticMemory(value: unknown): value is SemanticMemory {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.status === 'string' &&
    typeof value.module === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.scope === 'string' &&
    typeof value.domain === 'string' &&
    typeof value.content === 'string' &&
    Array.isArray(value.useWhen) &&
    Array.isArray(value.doNotUseWhen) &&
    Array.isArray(value.evidence) &&
    typeof value.reviewPolicy === 'string' &&
    Array.isArray(value.supersedes) &&
    value.supersedes.every((item) => typeof item === 'string') &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  )
}

function isMemoryTombstone(value: unknown): value is MemoryTombstone {
  if (!isRecord(value)) {
    return false
  }
  return (
    (value.memoryId === undefined || typeof value.memoryId === 'string') &&
    typeof value.normalizedKey === 'string' &&
    typeof value.domain === 'string' &&
    typeof value.type === 'string' &&
    typeof value.scope === 'string' &&
    typeof value.reason === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.expiresAt === undefined || typeof value.expiresAt === 'string') &&
    (value.replacementMemoryId === undefined || typeof value.replacementMemoryId === 'string')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
