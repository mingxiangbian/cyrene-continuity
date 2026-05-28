import { z } from 'zod'
import { getCodexMemoryProfile, runCodexMemoryDream } from '../../codex/memory-dream.js'
import { jsonText } from '../mcp-json.js'

export const memoryDreamRunInputSchema = {
  cwd: z.string().optional(),
  stage: z.enum(['light', 'rem', 'deep-preview', 'deep-apply']).optional()
}

export const memoryProfileGetInputSchema = {
  cwd: z.string().optional()
}

export async function handleMemoryDreamRun(
  input: { cwd?: string; stage?: 'light' | 'rem' | 'deep-preview' | 'deep-apply' },
  fallbackCwd: string
) {
  const result = await runCodexMemoryDream({
    cwd: input.cwd ?? fallbackCwd,
    stage: input.stage
  })
  return jsonText(result)
}

export async function handleMemoryProfileGet(input: { cwd?: string }, fallbackCwd: string) {
  const result = await getCodexMemoryProfile({
    cwd: input.cwd ?? fallbackCwd
  })
  return jsonText(result)
}
