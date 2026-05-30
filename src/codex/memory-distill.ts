import { readActiveMemoriesFromRoot, readPendingMemoriesFromRoot } from '../memory/memory-store.js'
import type { MemoryEvidence, PendingMemory } from '../memory/types.js'
import { codexProjectMemoryRoot } from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'

export type DistillationRisk = 'low' | 'medium' | 'high'
export type DistillationRecommendedAction = 'merge_pending' | 'needs_review'

export interface DistilledMemoryCandidate {
  id: string
  normalizedKey: string
  content: string
  sourceIds: string[]
  evidence: MemoryEvidence[]
  recommendedAction: DistillationRecommendedAction
  risk: DistillationRisk
  reasons: string[]
}

export interface CodexMemoryDistillResult {
  mode: 'dry_run'
  memoryRoot: string
  candidates: DistilledMemoryCandidate[]
  summary: {
    pendingRead: number
    activeRead: number
    duplicateClusters: number
    candidates: number
  }
}

export async function runCodexMemoryDistill(input: {
  cwd?: string
  memoryRoot?: string
  dryRun?: boolean
}): Promise<CodexMemoryDistillResult> {
  if (input.dryRun === false) {
    throw new Error('Codex memory distill apply is not supported.')
  }

  const memoryRoot = await resolveMemoryRoot(input)
  const [pending, active] = await Promise.all([
    readPendingMemoriesFromRoot(memoryRoot),
    readActiveMemoriesFromRoot(memoryRoot)
  ])
  const activeKeys = new Set(active.map((memory) => memory.normalizedKey))
  const groups = groupPendingByNormalizedKey(pending)
  const candidates = Array.from(groups.entries())
    .filter(([, items]) => items.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([normalizedKey, items]) => buildDistilledCandidate(normalizedKey, items, activeKeys.has(normalizedKey)))

  return {
    mode: 'dry_run',
    memoryRoot,
    candidates,
    summary: {
      pendingRead: pending.length,
      activeRead: active.length,
      duplicateClusters: candidates.length,
      candidates: candidates.length
    }
  }
}

async function resolveMemoryRoot(input: { cwd?: string; memoryRoot?: string }): Promise<string> {
  if (input.memoryRoot !== undefined) {
    return input.memoryRoot
  }

  const project = await identifyCodexProject(input.cwd ?? process.cwd())
  return codexProjectMemoryRoot(project.projectId)
}

function groupPendingByNormalizedKey(pending: PendingMemory[]): Map<string, PendingMemory[]> {
  const groups = new Map<string, PendingMemory[]>()
  for (const item of pending) {
    const existing = groups.get(item.normalizedKey)
    if (existing === undefined) {
      groups.set(item.normalizedKey, [item])
    } else {
      existing.push(item)
    }
  }
  return groups
}

function buildDistilledCandidate(
  normalizedKey: string,
  items: PendingMemory[],
  hasActiveOverlap: boolean
): DistilledMemoryCandidate {
  const sourceItems = sortById(items)
  const highRiskDomains = Array.from(new Set(sourceItems.filter(isHighRiskDomain).map((item) => item.domain))).sort()
  const risk = hasActiveOverlap || highRiskDomains.length > 0 ? 'high' : 'low'
  const recommendedAction = risk === 'high' ? 'needs_review' : 'merge_pending'

  return {
    id: `distill-${normalizedKey}`,
    normalizedKey,
    content: chooseRepresentativeContent(sourceItems),
    sourceIds: sourceItems.map((item) => item.id),
    evidence: sourceItems.flatMap((item) => item.evidence),
    recommendedAction,
    risk,
    reasons: buildReasons(normalizedKey, sourceItems.length, hasActiveOverlap, highRiskDomains)
  }
}

function isHighRiskDomain(item: PendingMemory): boolean {
  return item.domain === 'personal' || item.domain === 'relationship' || item.domain === 'affective'
}

function chooseRepresentativeContent(items: PendingMemory[]): string {
  return [...items].sort((left, right) => {
    const byLength = right.content.length - left.content.length
    return byLength === 0 ? left.id.localeCompare(right.id) : byLength
  })[0]?.content ?? ''
}

function sortById(items: PendingMemory[]): PendingMemory[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id))
}

function buildReasons(
  normalizedKey: string,
  pendingCount: number,
  hasActiveOverlap: boolean,
  highRiskDomains: string[]
): string[] {
  return [
    ...(hasActiveOverlap ? [`active memory already has normalizedKey ${normalizedKey}`] : []),
    ...highRiskDomains.map((domain) => `high-risk pending domain ${domain}`),
    `duplicate normalizedKey ${normalizedKey} has ${pendingCount} pending candidates`
  ]
}
