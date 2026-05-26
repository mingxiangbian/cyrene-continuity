import { estimateTokens } from '../token-counter.js'
import { readActiveMemories, readActiveMemoriesFromRoot } from './memory-store.js'
import type { CyreneMemory, MemoryDomain, MemoryScope, MemoryStrength, MemoryType } from './types.js'

export interface RetrieveMemoriesInput {
  cwd: string
  userCyreneDir: string
  memoryRoot?: string
  memoryRoots?: string[]
  extraMemories?: CyreneMemory[]
  query: string
  task?: 'coding' | 'planning' | 'conversation' | 'memory' | 'debugging'
  domains?: MemoryDomain[]
  types?: MemoryType[]
  strengths?: MemoryStrength[]
  scopes?: MemoryScope[]
  maxItems: number
  maxTokens: number
}

export interface RetrievedMemory {
  memory: CyreneMemory
  score: number
}

export interface MemoryRetrievalBudget {
  maxItems: number
  maxTokens: number
}

export function memoryRetrievalBudgetForTask(task: NonNullable<RetrieveMemoriesInput['task']>): MemoryRetrievalBudget {
  if (task === 'coding' || task === 'debugging') return { maxItems: 12, maxTokens: 2_000 }
  if (task === 'planning') return { maxItems: 16, maxTokens: 3_000 }
  if (task === 'memory') return { maxItems: 24, maxTokens: 4_000 }
  return { maxItems: 10, maxTokens: 1_500 }
}

export async function retrieveMemories(input: RetrieveMemoriesInput): Promise<RetrievedMemory[]> {
  const memories = await readInputMemories(input)
  const task = input.task ?? 'conversation'
  const queryTokens = tokenize(input.query)
  const filtered = memories.filter((memory) => isEligible(memory, input, task))
  const scored = filtered
    .map((memory) => ({ memory, score: scoreMemory(memory, queryTokens) }))
    .filter((item) => input.query.trim() === '' || item.score > 0)
    .sort(compareRetrievedMemories)

  const selected: RetrievedMemory[] = []
  let tokenCount = 0
  for (const item of scored) {
    if (selected.length >= input.maxItems) {
      break
    }
    const itemTokens = estimateTokens(item.memory.content)
    if (selected.length > 0 && tokenCount + itemTokens > input.maxTokens) {
      break
    }
    selected.push(item)
    tokenCount += itemTokens
  }
  return selected
}

async function readInputMemories(input: RetrieveMemoriesInput): Promise<CyreneMemory[]> {
  const roots = input.memoryRoots ?? (input.memoryRoot === undefined ? undefined : [input.memoryRoot])
  const memories = roots === undefined
    ? await readActiveMemories(input.cwd)
    : (await Promise.all(roots.map((root) => readActiveMemoriesFromRoot(root)))).flat()
  return dedupeMemories([...(input.extraMemories ?? []), ...memories])
}

function dedupeMemories(memories: CyreneMemory[]): CyreneMemory[] {
  const byKey = new Map<string, CyreneMemory>()
  for (const memory of memories) {
    byKey.set(memory.normalizedKey || memory.id, memory)
  }
  return [...byKey.values()]
}

export function formatMemoryContext(memories: RetrievedMemory[]): string {
  if (memories.length === 0) {
    return ''
  }
  return ['## Relevant Memory', ...memories.map(({ memory }) => `- ${memory.content}`)].join('\n')
}

function isEligible(
  memory: CyreneMemory,
  input: RetrieveMemoriesInput,
  task: NonNullable<RetrieveMemoriesInput['task']>
): boolean {
  if (memory.status !== 'active') {
    return false
  }

  if (input.domains !== undefined && !input.domains.includes(memory.domain)) {
    return false
  }
  if (input.types !== undefined && !input.types.includes(memory.type)) {
    return false
  }
  if (input.strengths !== undefined && !input.strengths.includes(memory.strength)) {
    return false
  }
  if (input.scopes !== undefined && !input.scopes.includes(memory.scope)) {
    return false
  }
  if (memory.expiresAt !== undefined && memory.expiresAt <= new Date().toISOString()) {
    return false
  }

  const defaultDomains = defaultDomainsForTask(task)
  if (!defaultDomains.includes(memory.domain)) {
    return false
  }

  if (task === 'conversation' && (memory.scores.safety < 0.8 || memory.scores.sensitivity > 0.6)) {
    return false
  }

  if (memory.strength === 'session' && task !== 'memory') {
    return false
  }

  return true
}

function defaultDomainsForTask(task: NonNullable<RetrieveMemoriesInput['task']>): MemoryDomain[] {
  if (task === 'coding' || task === 'debugging') {
    return ['project', 'procedural', 'system']
  }
  if (task === 'planning') {
    return ['project', 'procedural', 'personal', 'relationship']
  }
  if (task === 'conversation') {
    return ['personal', 'relationship', 'affective', 'procedural']
  }
  return ['project', 'personal', 'relationship', 'affective', 'procedural', 'system']
}

function scoreMemory(memory: CyreneMemory, queryTokens: string[]): number {
  const relevance = queryTokens.length === 0 ? 0.2 : relevanceScore(memory, queryTokens)
  const recency = memory.lastUsedAt === undefined ? 0.5 : 1
  const sensitivityPenalty = memory.scores.sensitivity > 0.3
    ? memory.scores.sensitivity * (memory.domain === 'affective' ? 0.35 : 0.2)
    : 0
  return (
    relevance * 0.35 +
    memory.scores.usefulness * 0.25 +
    memory.scores.evidenceStrength * 0.2 +
    memory.scores.safety * 0.1 +
    recency * 0.1 -
    sensitivityPenalty
  )
}

function relevanceScore(memory: CyreneMemory, queryTokens: string[]): number {
  const haystack = tokenize([
    memory.content,
    memory.normalizedKey,
    memory.domain,
    memory.type,
    memory.strength,
    ...memory.tags
  ].join(' '))
  const matches = queryTokens.filter((token) => haystack.some((candidate) => candidate.includes(token)))
  return matches.length / queryTokens.length
}

function compareRetrievedMemories(left: RetrievedMemory, right: RetrievedMemory): number {
  const scoreDiff = right.score - left.score
  if (scoreDiff !== 0) {
    return scoreDiff
  }
  const domainDiff = domainPriority(left.memory.domain) - domainPriority(right.memory.domain)
  if (domainDiff !== 0) {
    return domainDiff
  }
  return left.memory.id.localeCompare(right.memory.id)
}

function domainPriority(domain: MemoryDomain): number {
  if (domain === 'procedural') return 0
  if (domain === 'project') return 1
  if (domain === 'system') return 2
  if (domain === 'personal') return 3
  if (domain === 'relationship') return 4
  return 5
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter(Boolean)
}
