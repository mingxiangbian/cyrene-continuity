import { z } from 'zod'
import { createDefaultConfig } from '../../config.js'
import { callModel as defaultCallModel } from '../../llm-client.js'
import { runCodexProjectMemoryHarvest } from '../../codex/project-memory-harvester.js'
import type { CodexProjectHarvestMode } from '../../codex/project-memory-signals.js'
import { jsonText } from '../mcp-json.js'

export const memoryHarvestProjectInputSchema = {
  dryRun: z.boolean().optional(),
  apply: z.boolean().optional(),
  previewId: z.string().optional(),
  previewHash: z.string().optional(),
  changedFiles: z.boolean().optional(),
  since: z.enum(['last-summary']).optional()
}

export async function handleMemoryHarvestProject(
  input: {
    dryRun?: boolean
    apply?: boolean
    previewId?: string
    previewHash?: string
    changedFiles?: boolean
    since?: 'last-summary'
  },
  fallbackCwd: string
) {
  if (input.dryRun === true && input.apply === true) {
    throw new Error('memory harvest-project accepts only one of apply or dryRun')
  }

  const result = await runCodexProjectMemoryHarvest({
    cwd: fallbackCwd,
    config: createDefaultConfig(fallbackCwd),
    callModel: defaultCallModel,
    dryRun: input.dryRun,
    apply: input.apply,
    previewId: input.previewId,
    previewHash: input.previewHash,
    mode: harvestProjectMode(input)
  })

  return jsonText(withHarvestProjectCompatibilityWarnings(result, input))
}

function harvestProjectMode(input: { changedFiles?: boolean }): CodexProjectHarvestMode | undefined {
  return input.changedFiles === true ? 'changed_files' : undefined
}

function withHarvestProjectCompatibilityWarnings<T extends { warnings: string[] }>(
  result: T,
  input: { since?: 'last-summary' }
): T {
  if (input.since === undefined) {
    return result
  }
  return {
    ...result,
    warnings: [
      ...result.warnings,
      'since=last-summary accepted for compatibility; current harvest uses default signal collection.'
    ]
  }
}
