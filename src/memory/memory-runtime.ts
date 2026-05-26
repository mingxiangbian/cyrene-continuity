import type { AppConfig } from '../config.js'
import type { CallModelInput, ModelResponse } from '../llm-client.js'
import { extractMemoryCandidates } from './memory-candidate-extractor.js'
import { processMemoryCandidate } from './memory-lifecycle.js'

export interface ProcessRunMemoryInput {
  cwd: string
  config: AppConfig
  runId: string
  userPrompt: string
  finalText: string
  callModel: (input: CallModelInput) => Promise<ModelResponse>
}

export interface ProcessRunMemoryResult {
  extracted: number
  created: number
  promoted: number
  pending: number
  rejected: number
  archived: number
  updated: number
  errors: number
}

export async function processRunMemory(input: ProcessRunMemoryInput): Promise<ProcessRunMemoryResult> {
  const result: ProcessRunMemoryResult = {
    extracted: 0,
    created: 0,
    promoted: 0,
    pending: 0,
    rejected: 0,
    archived: 0,
    updated: 0,
    errors: 0
  }

  if (!input.config.memoryAutoExtractEnabled) {
    return result
  }

  let candidates
  try {
    candidates = await extractMemoryCandidates(input)
    result.extracted = candidates.length
  } catch {
    result.errors += 1
    return result
  }

  for (const candidate of candidates) {
    try {
      const decision = await processMemoryCandidate({
        cwd: input.cwd,
        candidate
      })
      if (decision.action === 'create') result.created += 1
      if (decision.action === 'promote') result.promoted += 1
      if (decision.action === 'pending') result.pending += 1
      if (decision.action === 'reject') result.rejected += 1
      if (decision.action === 'archive') result.archived += 1
      if (decision.action === 'update') result.updated += 1
    } catch {
      result.errors += 1
    }
  }

  return result
}
