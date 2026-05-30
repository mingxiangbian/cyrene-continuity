import { z } from 'zod'
import { proposeCodexMemoryCandidate } from '../../codex/memory-propose.js'
import {
  MEMORY_CANDIDATE_KINDS,
  MEMORY_DOMAINS,
  MEMORY_SCOPES,
  MEMORY_SOURCES,
  MEMORY_STRENGTHS,
  MEMORY_TYPES
} from '../../memory/types.js'
import { jsonText } from '../mcp-json.js'

const memoryCandidateKindSchema = z.enum(MEMORY_CANDIDATE_KINDS)

const memoryCandidateSchema = z.object({
  domain: z.enum(MEMORY_DOMAINS),
  type: z.enum(MEMORY_TYPES),
  strength: z.enum(MEMORY_STRENGTHS).optional(),
  scope: z.enum(MEMORY_SCOPES).optional(),
  candidateKind: memoryCandidateKindSchema.optional(),
  candidate_kind: memoryCandidateKindSchema.optional(),
  content: z.string(),
  normalizedKey: z.string().optional(),
  source: z.enum(MEMORY_SOURCES).optional(),
  evidence: z.array(
    z.object({
      runId: z.string().optional(),
      quote: z.string().optional(),
      summary: z.string().optional(),
      evidenceGroupId: z.string().optional(),
      sessionId: z.string().optional(),
      taskHash: z.string().optional(),
      quoteHash: z.string().optional(),
      sourceKind: z.enum(MEMORY_SOURCES).optional()
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
