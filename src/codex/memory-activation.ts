import { createHash } from 'node:crypto'
import { isRuntimeActivatableSemanticMemory } from '../memory/memory-lifecycle.js'
import { activeMemoryToSemanticMemory } from '../memory/semantic-memory-adapter.js'
import { tokenizeMemoryText } from '../memory/tokenizer.js'
import type { ActivationMode, ConfidenceTier, CyreneMemory, SemanticMemory } from '../memory/types.js'

export interface MemoryActivation {
  id: string
  memoryId: string
  confidenceTier: ConfidenceTier
  activationMode: ActivationMode
  text: string
  triggerReason: string
  source: 'project' | 'global'
  risk: 'low' | 'medium' | 'high'
}

export interface MemoryActivationOutput {
  workflowHints: MemoryActivation[]
  planConstraints: MemoryActivation[]
  checklistItems: MemoryActivation[]
}

type ActivationSource = MemoryActivation['source']

const DISTINCTIVE_TOKEN_LENGTH = 8
const DO_NOT_USE_BOUNDARY_TOKENS = new Set([
  'avoid',
  'contradict',
  'contradicted',
  'contradicts',
  'doc',
  'docs',
  'documentation',
  'except',
  'never',
  'not',
  'only',
  'outside',
  'stale',
  'unless',
  'unrelated'
])

interface ActivationCandidate {
  memory: SemanticMemory | CyreneMemory
  source: ActivationSource
}

export function buildMemoryActivations(input: {
  query: string
  projectMemories: Array<SemanticMemory | CyreneMemory>
  globalMemories: Array<SemanticMemory | CyreneMemory>
  maxPerBucket?: number
}): MemoryActivationOutput {
  const maxPerBucket = normalizeMaxPerBucket(input.maxPerBucket)
  const output: MemoryActivationOutput = {
    workflowHints: [],
    planConstraints: [],
    checklistItems: []
  }
  const queryTokens = tokenizeMemoryText(input.query)
  if (queryTokens.length === 0 || maxPerBucket === 0) {
    return output
  }

  const candidates: ActivationCandidate[] = [
    ...input.projectMemories.map((memory) => ({ memory, source: 'project' as const })),
    ...input.globalMemories.map((memory) => ({ memory, source: 'global' as const }))
  ]

  for (const candidate of candidates) {
    const memory = toSemanticMemory(candidate.memory)
    if (!isRuntimeActivatableSemanticMemory(memory)) {
      continue
    }
    const triggerReason = matchTriggerReason(memory, queryTokens)
    if (triggerReason === null) {
      continue
    }
    if (memory.confidenceTier === 'trial') {
      pushLimited(output.workflowHints, activationForMemory({
        memory,
        source: candidate.source,
        activationMode: 'workflow_hint',
        text: memory.content,
        triggerReason
      }), maxPerBucket)
      continue
    }
    pushLimited(output.planConstraints, activationForMemory({
      memory,
      source: candidate.source,
      activationMode: 'plan_constraint',
      text: `Plan constraint: ${memory.content}`,
      triggerReason
    }), maxPerBucket)
    pushLimited(output.checklistItems, activationForMemory({
      memory,
      source: candidate.source,
      activationMode: 'checklist_item',
      text: `Verify: ${memory.content}`,
      triggerReason
    }), maxPerBucket)
  }

  return output
}

function toSemanticMemory(memory: SemanticMemory | CyreneMemory): SemanticMemory {
  if (isSemanticMemory(memory)) {
    return memory
  }
  return activeMemoryToSemanticMemory(memory)
}

function isSemanticMemory(memory: SemanticMemory | CyreneMemory): memory is SemanticMemory {
  return (
    'module' in memory &&
    'kind' in memory &&
    Array.isArray((memory as Partial<SemanticMemory>).useWhen) &&
    Array.isArray((memory as Partial<SemanticMemory>).doNotUseWhen)
  )
}

function activationForMemory(input: {
  memory: SemanticMemory & { confidenceTier: ConfidenceTier }
  source: ActivationSource
  activationMode: ActivationMode
  text: string
  triggerReason: string
}): MemoryActivation {
  return {
    id: stableActivationId(input.memory.id, input.activationMode, input.source),
    memoryId: input.memory.id,
    confidenceTier: input.memory.confidenceTier,
    activationMode: input.activationMode,
    text: input.text,
    triggerReason: input.triggerReason,
    source: input.source,
    risk: riskForMemory(input.memory)
  }
}

function pushLimited(items: MemoryActivation[], item: MemoryActivation, maxItems: number): void {
  if (items.length < maxItems) {
    items.push(item)
  }
}

function matchTriggerReason(memory: SemanticMemory, queryTokens: string[]): string | null {
  if (memory.doNotUseWhen.some((boundary) => doNotUseWhenSuppresses(queryTokens, boundary))) {
    return null
  }

  const memoryTokens = new Set(tokenizeMemoryText([memory.content, ...memory.useWhen].join(' ')))
  const matchedTokens = matchingTokens(queryTokens, memoryTokens)
  if (!isStrongMatch(matchedTokens)) {
    return null
  }
  return `matched distinctive query tokens: ${matchedTokens.join(', ')}`
}

function doNotUseWhenSuppresses(queryTokens: string[], boundary: string): boolean {
  const boundaryTokens = new Set(tokenizeMemoryText(boundary))
  if (!isStrongTokenOverlap(queryTokens, boundaryTokens)) {
    return false
  }
  const boundaryMarkers = matchingTokens([...boundaryTokens], DO_NOT_USE_BOUNDARY_TOKENS)
  return boundaryMarkers.length === 0 || boundaryMarkers.some((token) => queryTokens.includes(token))
}

function isStrongTokenOverlap(queryTokens: string[], candidateTokens: Set<string>): boolean {
  return isStrongMatch(matchingTokens(queryTokens, candidateTokens))
}

function isStrongMatch(tokens: string[]): boolean {
  return tokens.length >= 2 || tokens.some((token) => token.length >= DISTINCTIVE_TOKEN_LENGTH)
}

function matchingTokens(queryTokens: string[], candidateTokens: Set<string>): string[] {
  return queryTokens.filter((token) => candidateTokens.has(token))
}

function riskForMemory(memory: SemanticMemory): MemoryActivation['risk'] {
  if (
    memory.routing?.risk === 'high' ||
    memory.domain === 'personal' ||
    memory.domain === 'relationship' ||
    memory.domain === 'affective'
  ) {
    return 'high'
  }
  const scores = memory.reviewState?.scores
  if (memory.routing?.risk === 'medium' || (scores?.sensitivity ?? 0) > 0.35 || (scores?.safety ?? 1) < 0.8) {
    return 'medium'
  }
  return 'low'
}

function stableActivationId(memoryId: string, mode: ActivationMode, source: ActivationSource): string {
  return createHash('sha256').update(`${memoryId}:${mode}:${source}`).digest('hex').slice(0, 16)
}

function normalizeMaxPerBucket(value: number | undefined): number {
  if (value === undefined) return 6
  if (!Number.isFinite(value)) return 6
  return Math.max(0, Math.floor(value))
}
