import { z } from 'zod'
import { identifyCodexProject, renderModelVisibleProjectIdentity } from '../../codex/project-id.js'
import { jsonText } from '../mcp-json.js'

export const projectIdentifyInputSchema = {
  cwd: z.string().optional()
}

export async function handleProjectIdentify(input: { cwd?: string }, fallbackCwd: string) {
  const identity = await identifyCodexProject(input.cwd ?? fallbackCwd)
  return jsonText(renderModelVisibleProjectIdentity(identity))
}
