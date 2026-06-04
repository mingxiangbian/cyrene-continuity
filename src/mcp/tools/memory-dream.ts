import { getCodexMemoryProfile } from '../../codex/memory-dream.js'
import { jsonText } from '../mcp-json.js'

export const memoryProfileGetInputSchema = {}

export async function handleMemoryProfileGet(input: { cwd?: string }, fallbackCwd: string) {
  const result = await getCodexMemoryProfile({
    cwd: input.cwd ?? fallbackCwd
  })
  return jsonText(result)
}
