import { z } from 'zod'
import { getCodexContinuityContext } from '../../codex/continuity-context.js'
import { jsonText } from '../mcp-json.js'

const taskSchema = z.enum(['coding', 'planning', 'debugging', 'conversation', 'memory'])

export const continuityGetInputSchema = {
  cwd: z.string().optional(),
  userMessage: z.string(),
  task: taskSchema.optional()
}

export async function handleContinuityGet(
  input: {
    cwd?: string
    userMessage: string
    task?: z.infer<typeof taskSchema>
  },
  fallbackCwd: string
) {
  const context = await getCodexContinuityContext({
    cwd: input.cwd ?? fallbackCwd,
    userMessage: input.userMessage,
    task: input.task ?? 'coding'
  })
  return jsonText(context)
}
