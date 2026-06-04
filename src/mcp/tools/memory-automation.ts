import { z } from 'zod'
import { runCodexMemoryAutomation } from '../../codex/memory-automation.js'
import { jsonText } from '../mcp-json.js'

export const memoryAutomationRunInputSchema = {
  job: z.enum(['daily', 'weekly']),
  apply: z.boolean().optional(),
  allProjects: z.boolean().optional()
}

export async function handleMemoryAutomationRun(
  input: { cwd?: string; job: 'daily' | 'weekly'; apply?: boolean; allProjects?: boolean },
  fallbackCwd: string
) {
  const result = await runCodexMemoryAutomation({
    cwd: input.cwd ?? fallbackCwd,
    job: input.job,
    allProjects: input.allProjects,
    apply: input.apply
  })
  return jsonText(result)
}
