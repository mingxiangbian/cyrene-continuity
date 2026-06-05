import { validateSemanticMemoryLifecycle } from '../memory/memory-lifecycle.js'
import { readModelProfileFromRootIfExists } from '../memory/model-profile.js'
import type { SemanticMemory } from '../memory/types.js'
import { readCodexMemoryIndexStatus } from './codex-memory-index-status.js'
import { writeFastSummaryProjection } from './fast-summary-store.js'

const FAST_SUMMARY_GLOBAL_DOMAINS = new Set(['procedural', 'system'])
const FAST_SUMMARY_GOVERNANCE_LABEL = /\b(?:similar[- ]project|pending|trial|candidate)\b/i

export async function refreshGlobalFastSummaryProjection(input: {
  memoryRoot: string
  memories: SemanticMemory[]
  generatedAt: string
}): Promise<void> {
  const profileFastSummary = await readModelProfileFromRootIfExists(input.memoryRoot) ?? ''
  await writeFastSummaryProjection(input.memoryRoot, {
    globalFastSummary: buildGlobalFastSummary(input.memories),
    profileFastSummary,
    generatedAt: input.generatedAt
  })
}

export function buildGlobalFastSummary(memories: SemanticMemory[]): string {
  return memories
    .filter(isFastSummaryGlobalMemory)
    .slice(0, 8)
    .map((memory) => `- ${memory.content}`)
    .join('\n')
}

export async function checkCodexMemoryIndexHealth(memoryRoots: string[]): Promise<boolean> {
  try {
    await readCodexMemoryIndexStatus(memoryRoots)
    return true
  } catch {
    return false
  }
}

function isFastSummaryGlobalMemory(memory: SemanticMemory): boolean {
  return (
    memory.status === 'active' &&
    memory.scope === 'global' &&
    memory.confidenceTier === 'global_core' &&
    FAST_SUMMARY_GLOBAL_DOMAINS.has(memory.domain) &&
    validateSemanticMemoryLifecycle(memory).length === 0 &&
    !FAST_SUMMARY_GOVERNANCE_LABEL.test(memory.content)
  )
}
