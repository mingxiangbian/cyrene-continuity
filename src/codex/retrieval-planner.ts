import type { RetrieveMemoriesInput } from '../memory/memory-retriever.js'
import type { CyreneMemory, MemoryCandidateKind, MemoryType, PendingMemory } from '../memory/types.js'

export type RetrievalFacet =
  | 'exact_project'
  | 'global_policy'
  | 'task_intent'
  | 'memory_kind'
  | 'evidence'
  | 'recency'
  | 'transferability'
  | 'graph_edges'
  | 'personal_boundary'

export interface RetrievalPlan {
  taskIntent: string[]
  memoryKinds: string[]
  requiredFacets: RetrievalFacet[]
  optionalFacets: RetrievalFacet[]
  excludeDomains: string[]
  includePendingHypotheses: boolean
  includeSimilarHints: boolean
  includeGraphNeighbors: boolean
}

export interface RetrievalExplainInput {
  exactProject: boolean
  globalPolicy?: boolean
  memoryKind?: string
  taskIntent?: string[]
  edgeTypes?: string[]
  transferability?: boolean
  score: number
}

export function buildRetrievalPlan(input: {
  query: string
  task: NonNullable<RetrieveMemoriesInput['task']>
}): RetrievalPlan {
  const text = input.query.toLowerCase()
  const taskIntent = [
    ...(matches(text, ['memory', 'pending', 'active', 'archive', 'tombstone', 'review', 'promote']) ? ['memory_review'] : []),
    ...(matches(text, ['ui', 'button', 'web ui', 'route']) ? ['ui'] : []),
    ...(matches(text, ['debug', 'fail', 'error', 'bug', 'does not work']) || input.task === 'debugging' ? ['debugging'] : [])
  ]
  const memoryKinds = taskIntent.includes('memory_review')
    ? ['workflow_rule', 'known_pitfall', 'project_decision']
    : ['project_fact', 'workflow_rule']

  return {
    taskIntent,
    memoryKinds,
    requiredFacets: ['exact_project', 'memory_kind', 'evidence'],
    optionalFacets: ['graph_edges', 'transferability', 'recency'],
    excludeDomains: input.task === 'coding' || input.task === 'debugging' || input.task === 'memory'
      ? ['affective', 'relationship']
      : [],
    includePendingHypotheses: input.task === 'memory',
    includeSimilarHints: true,
    includeGraphNeighbors: true
  }
}

export function explainRetrievalReasons(input: RetrievalExplainInput): string[] {
  return [
    ...(input.exactProject ? ['exact_project'] : []),
    ...(input.globalPolicy ? ['global_policy'] : []),
    ...(input.memoryKind === undefined ? [] : [`memory_kind:${input.memoryKind}`]),
    ...((input.taskIntent ?? []).map((intent) => `task_intent:${intent}`)),
    ...((input.edgeTypes ?? []).map((edge) => `edge:${edge}`)),
    ...(input.transferability ? ['transferability'] : [])
  ]
}

export function memoryKindForRetrieval(memory: Pick<CyreneMemory | PendingMemory, 'candidateKind' | 'candidate_kind' | 'type'>): string {
  return memory.candidateKind ?? memory.candidate_kind ?? memoryKindFromType(memory.type)
}

export function retrievalPlanMemoryKindBoost(plan: RetrievalPlan, memory: Pick<CyreneMemory | PendingMemory, 'candidateKind' | 'candidate_kind' | 'type'>): number {
  const memoryKind = memoryKindForRetrieval(memory)
  return plan.memoryKinds.includes(memoryKind) ? 0.2 : 0
}

function memoryKindFromType(type: MemoryType): MemoryCandidateKind | MemoryType {
  if (type === 'procedural_rule' || type === 'system_policy') return 'workflow_rule'
  if (type === 'reference') return 'known_pitfall'
  if (type === 'user_preference') return 'user_instruction'
  return type
}

function matches(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term))
}
