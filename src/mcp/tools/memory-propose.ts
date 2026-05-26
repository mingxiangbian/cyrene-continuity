import { z } from 'zod'
import { proposeCodexMemoryCandidate } from '../../codex/memory-propose.js'
import { jsonText } from '../mcp-json.js'

const memoryCandidateSchema = z.object({
  domain: z.enum(['project', 'personal', 'relationship', 'affective', 'procedural', 'system']),
  type: z.enum([
    'project_fact',
    'user_preference',
    'interaction_style',
    'relationship_boundary',
    'affective_pattern',
    'procedural_rule',
    'episode',
    'system_policy',
    'reference'
  ]),
  strength: z.enum(['hard', 'soft', 'session']).optional(),
  scope: z.enum(['global', 'project', 'session']).optional(),
  content: z.string(),
  normalizedKey: z.string().optional(),
  source: z.enum(['user_explicit', 'user_implicit', 'assistant_observed', 'tool_trace', 'file', 'legacy_markdown']).optional(),
  evidence: z.array(
    z.object({
      runId: z.string().optional(),
      quote: z.string().optional(),
      summary: z.string().optional(),
      evidenceGroupId: z.string().optional(),
      sessionId: z.string().optional(),
      taskHash: z.string().optional(),
      quoteHash: z.string().optional(),
      sourceKind: z.enum(['user_explicit', 'user_implicit', 'assistant_observed', 'tool_trace', 'file', 'legacy_markdown']).optional()
    })
  ),
  scores: z
    .object({
      evidenceStrength: z.number().optional(),
      stability: z.number().optional(),
      usefulness: z.number().optional(),
      safety: z.number().optional(),
      sensitivity: z.number().optional()
    })
    .optional(),
  tags: z.array(z.string()).optional(),
  userConfirmed: z.boolean().optional()
})

export const memoryProposeInputSchema = {
  cwd: z.string().optional(),
  candidate: memoryCandidateSchema
}

export async function handleMemoryPropose(
  input: { cwd?: string; candidate: z.infer<typeof memoryCandidateSchema> },
  fallbackCwd: string
) {
  const result = await proposeCodexMemoryCandidate({
    cwd: input.cwd ?? fallbackCwd,
    candidate: input.candidate
  })
  return jsonText(result)
}
