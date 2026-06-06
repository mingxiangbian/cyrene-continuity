import { estimateTokens } from '../token-counter.js'
import {
  buildRetrievalPlan,
  explainRetrievalReasons,
  memoryKindForRetrieval,
  retrievalPlanMemoryKindBoost,
  type RetrievalPlan
} from '../codex/retrieval-planner.js'
import { resolveRelationExpansion } from './memory-relations.js'
import { readActiveMemories, readActiveMemoriesFromRoot, readMemoryEdgesFromRoot } from './memory-store.js'
import { tokenizeMemoryText } from './tokenizer.js'
import type { CyreneMemory, MemoryDomain, MemoryEdge, MemoryScope, MemoryStrength, MemoryType } from './types.js'

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
  explain?: string[]
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
  const retrievalPlan = buildRetrievalPlan({ query: input.query, task })
  const queryTokens = tokenizeMemoryText(input.query)
  const filtered = memories.filter((memory) => (
    isMemoryEligibleForRetrieval(memory, input, task) &&
    !retrievalPlan.excludeDomains.includes(memory.domain)
  ))
  const scored = filtered
    .map((memory) => {
      const score = scoreMemory(memory, queryTokens, retrievalPlan)
      return {
        memory,
        score,
        explain: explainRetrievalReasons({
          exactProject: memory.scope !== 'global',
          globalPolicy: memory.scope === 'global',
          memoryKind: memoryKindForRetrieval(memory),
          taskIntent: retrievalPlan.taskIntent,
          score
        })
      }
    })
    .filter((item) => input.query.trim() === '' || item.score > 0)
    .sort(compareRetrievedMemories)

  const selected = selectRetrievedWithinBudget(scored, input.maxItems, input.maxTokens)
  return expandJsonlRelationMemories(input, selected, filtered)
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

async function expandJsonlRelationMemories(
  input: RetrieveMemoriesInput,
  selected: RetrievedMemory[],
  eligibleMemories: CyreneMemory[]
): Promise<RetrievedMemory[]> {
  const roots = input.memoryRoots ?? (input.memoryRoot === undefined ? undefined : [input.memoryRoot])
  if (roots === undefined || selected.length === 0) {
    return selected
  }

  let expanded = [...selected]
  const eligibleKeys = new Set(eligibleMemories.map(memoryIdentityKey))
  for (const root of roots) {
    let rootMemories: CyreneMemory[]
    let edges: MemoryEdge[]
    try {
      [rootMemories, edges] = await Promise.all([
        readActiveMemoriesFromRoot(root),
        readMemoryEdgesFromRoot(root)
      ])
    } catch {
      continue
    }
    if (edges.length === 0) {
      continue
    }
    const rootEligibleById = new Map(
      rootMemories
        .filter((memory) => eligibleKeys.has(memoryIdentityKey(memory)))
        .map((memory) => [memory.id, memory])
    )
    expanded = expandRelationMemoriesForRoot(expanded, rootEligibleById, edges)
  }
  return selectRetrievedWithinBudget(expanded, input.maxItems, input.maxTokens)
}

function expandRelationMemoriesForRoot(
  selected: RetrievedMemory[],
  memoryById: Map<string, CyreneMemory>,
  edges: MemoryEdge[]
): RetrievedMemory[] {
  const byId = new Map(selected.map((item) => [item.memory.id, item]))
  const suppressed = new Set<string>()
  for (const seed of selected) {
    if (!memoryById.has(seed.memory.id)) {
      continue
    }
    for (const edge of relationEdgesForSeed(edges, seed.memory.id)) {
      const resolution = resolveRelationExpansion({ seedMemoryId: seed.memory.id, edge })
      for (const memoryId of resolution.suppressMemoryIds) {
        suppressed.add(memoryId)
      }
      if (resolution.includeMemoryId === undefined) {
        continue
      }
      const related = memoryById.get(resolution.includeMemoryId)
      if (related === undefined) {
        continue
      }
      const edgeType = `edge:relation:${edge.relationType}`
      const existing = byId.get(related.id)
      byId.set(related.id, {
        memory: related,
        score: existing?.score ?? Math.min(seed.score, edge.confidence),
        explain: mergeExplain(existing?.explain ?? seed.explain, [edgeType])
      })
    }
  }
  return [...byId.values()].filter((item) => !suppressed.has(item.memory.id))
}

function relationEdgesForSeed(edges: MemoryEdge[], seedMemoryId: string): MemoryEdge[] {
  return edges.filter((edge) => edge.fromMemoryId === seedMemoryId || edge.toMemoryId === seedMemoryId)
}

function mergeExplain(current: string[] | undefined, additions: string[]): string[] {
  return Array.from(new Set([...(current ?? []), ...additions]))
}

function memoryIdentityKey(memory: CyreneMemory): string {
  return JSON.stringify([memory.id, memory.normalizedKey, memory.content, memory.scope, memory.updatedAt])
}

function selectRetrievedWithinBudget(items: RetrievedMemory[], maxItems: number, maxTokens: number): RetrievedMemory[] {
  const selected: RetrievedMemory[] = []
  let tokenCount = 0
  for (const item of items) {
    if (selected.length >= maxItems) {
      break
    }
    const itemTokens = estimateTokens(item.memory.content)
    if (itemTokens > maxTokens) {
      continue
    }
    if (tokenCount + itemTokens > maxTokens) {
      break
    }
    selected.push(item)
    tokenCount += itemTokens
  }
  return selected
}

export function isMemoryEligibleForRetrieval(
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

function scoreMemory(memory: CyreneMemory, queryTokens: string[], retrievalPlan: RetrievalPlan): number {
  const relevance = queryTokens.length === 0 ? 0.2 : relevanceScore(memory, queryTokens)
  const recency = memory.lastUsedAt === undefined ? 0.5 : 1
  const sensitivityPenalty = memory.scores.sensitivity > 0.3
    ? memory.scores.sensitivity * (memory.domain === 'affective' ? 0.35 : 0.2)
    : 0
  const plannerBoost = retrievalPlanMemoryKindBoost(retrievalPlan, memory)
  return (
    relevance * 0.35 +
    memory.scores.usefulness * 0.25 +
    memory.scores.evidenceStrength * 0.2 +
    memory.scores.safety * 0.1 +
    recency * 0.1 -
    sensitivityPenalty +
    plannerBoost
  )
}

function relevanceScore(memory: CyreneMemory, queryTokens: string[]): number {
  const haystack = tokenizeMemoryText([
    memory.content,
    memory.normalizedKey,
    memory.domain,
    memory.type,
    memory.strength,
    ...memory.tags
  ].join(' '))
  const matches = queryTokens.filter((token) => haystack.some((candidate) => candidate.includes(token)))
  const denominator = Math.min(queryTokens.length, 8)
  return Math.min(matches.length, denominator) / denominator
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
