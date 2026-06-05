import { z } from 'zod'
import { getCodexContinuityContext } from '../../codex/continuity-context.js'
import { jsonText } from '../mcp-json.js'

const taskSchema = z.enum(['coding', 'planning', 'debugging', 'conversation', 'memory'])
const modeSchema = z.enum(['fast', 'balanced', 'review'])

export const continuityGetInputSchema = {
  userMessage: z.string(),
  task: taskSchema.optional(),
  mode: modeSchema.optional(),
  includeSimilarProjectHints: z.boolean().optional(),
  includePendingDetails: z.boolean().optional(),
  includePendingNotice: z.boolean().optional(),
  includeDiagnostics: z.boolean().optional(),
  recordRetrievedEvents: z.boolean().optional(),
  maxTokens: z.number().int().positive().optional()
}

export async function handleContinuityGet(
  input: {
    cwd?: string
    userMessage: string
    task?: z.infer<typeof taskSchema>
    mode?: z.infer<typeof modeSchema>
    includeSimilarProjectHints?: boolean
    includePendingDetails?: boolean
    includePendingNotice?: boolean
    includeDiagnostics?: boolean
    recordRetrievedEvents?: boolean
    maxTokens?: number
  },
  fallbackCwd: string
) {
  const context = await getCodexContinuityContext({
    cwd: input.cwd ?? fallbackCwd,
    userMessage: input.userMessage,
    task: input.task ?? 'coding',
    mode: input.mode,
    includeSimilarProjectHints: input.includeSimilarProjectHints,
    includePendingDetails: input.includePendingDetails,
    includePendingNotice: input.includePendingNotice,
    includeDiagnostics: input.includeDiagnostics,
    recordRetrievedEvents: input.recordRetrievedEvents,
    maxTokens: input.maxTokens
  })
  return jsonText(context)
}
