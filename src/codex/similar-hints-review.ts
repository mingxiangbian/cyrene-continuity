import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname } from 'node:path'
import {
  assertMemoryMaintenanceTargetsSafeFromRoot,
  withMemoryMaintenanceLockFromRoot
} from '../memory/memory-maintenance.js'
import {
  appendMemoryEventFromRoot,
  readActiveMemoriesFromRoot,
  writeActiveMemoriesFromRoot
} from '../memory/memory-store.js'
import type { CyreneMemory, MemoryPortability } from '../memory/types.js'
import {
  runSimilarHintsEvalGate,
  type EvalFinding,
  type EvalGateResult
} from '../eval/eval-runner.js'
import {
  codexMemoryDbPath,
  syncCurrentCodexMemoryIndex
} from './codex-memory-index.js'
import {
  ensureCodexProjectMemoryRoot,
  getReadableCodexProjectMemoryRoots
} from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'
import { openMemoryIndexAdapter } from '../memory/memory-index.js'

export interface SimilarHintExplanation {
  memoryId?: string
  sourceProjectId?: string
  sourceProjectName?: string
  similarityScore?: number
  similarityReason?: string[]
  selected: boolean
  gateFindings: EvalFinding[]
}

export type SimilarHintMarkResult =
  | { action: 'mark_transferable'; memoryId: string; portability: 'similar_project' }
  | { action: 'not_found'; memoryId: string; reason: string }
  | { action: 'conflict'; memoryId: string; reason: string; latest: { reviewHash: string } }
  | { action: 'blocked_by_gate'; memoryId: string; reason: string; gateFindings: EvalFinding[] }

export function reviewHashForSimilarHintMemory(memory: CyreneMemory): string {
  const payload = {
    id: memory.id,
    domain: memory.domain,
    type: memory.type,
    strength: memory.strength,
    scope: memory.scope,
    content: memory.content,
    normalizedKey: memory.normalizedKey,
    source: memory.source,
    portability: memory.portability ?? null,
    scores: memory.scores,
    updatedAt: memory.updatedAt,
    tags: memory.tags
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export async function explainSimilarHints(input: {
  cwd: string
  memoryId?: string
  sourceProjectId?: string
}): Promise<SimilarHintExplanation[]> {
  const current = await identifyCodexProject(input.cwd)
  if (input.memoryId !== undefined) {
    const found = await findActiveMemory(input.cwd, input.memoryId)
    if (found === undefined) {
      return [{ memoryId: input.memoryId, selected: false, gateFindings: [{ reason: 'memory not found' }] }]
    }
    const gate = gateForMemory(found.memory, current.projectId, found.projectId)
    return [{
      memoryId: found.memory.id,
      sourceProjectId: found.projectId,
      selected: gate.passed,
      gateFindings: flattenGateFindings(gate)
    }]
  }

  if (input.sourceProjectId !== undefined) {
    const adapter = await openMemoryIndexAdapter({ dbPath: codexMemoryDbPath() })
    try {
      const [metadata, similarities] = await Promise.all([
        adapter.listProjectMetadata(),
        adapter.listProjectSimilarities(current.projectId)
      ])
      const similarity = similarities.find((item) => item.targetProjectId === input.sourceProjectId)
      const project = metadata.find((item) => item.projectId === input.sourceProjectId)
      return [{
        sourceProjectId: input.sourceProjectId,
        ...(project === undefined ? {} : { sourceProjectName: project.displayName }),
        ...(similarity === undefined ? {} : {
          similarityScore: similarity.score,
          similarityReason: similarity.reason
        }),
        selected: false,
        gateFindings: similarity === undefined ? [{ reason: 'source project is not selected as similar' }] : []
      }]
    } finally {
      adapter.close()
    }
  }

  return []
}

export async function markSimilarHintTransferable(input: {
  cwd: string
  memoryId: string
  reviewHash: string
  now?: string
}): Promise<SimilarHintMarkResult> {
  const now = input.now ?? new Date().toISOString()
  const found = await findActiveMemory(input.cwd, input.memoryId, true)
  if (found === undefined) {
    return { action: 'not_found', memoryId: input.memoryId, reason: 'Active project memory not found' }
  }
  const latestHash = reviewHashForSimilarHintMemory(found.memory)
  if (latestHash !== input.reviewHash) {
    return {
      action: 'conflict',
      memoryId: input.memoryId,
      reason: 'Active memory changed since review',
      latest: { reviewHash: latestHash }
    }
  }
  const gate = gateForTransferableMemory(found.memory)
  if (!gate.passed) {
    return {
      action: 'blocked_by_gate',
      memoryId: input.memoryId,
      reason: 'Active memory is not eligible for similar-project transfer',
      gateFindings: flattenGateFindings(gate)
    }
  }

  await assertMemoryMaintenanceTargetsSafeFromRoot(found.memoryRoot)
  return withMemoryMaintenanceLockFromRoot(found.memoryRoot, async (lockedRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedRoot)
    const active = await readActiveMemoriesFromRoot(lockedRoot)
    const lockedMemory = active.find((memory) => memory.id === input.memoryId)
    if (lockedMemory === undefined) {
      return { action: 'not_found', memoryId: input.memoryId, reason: 'Active project memory not found' }
    }
    const lockedHash = reviewHashForSimilarHintMemory(lockedMemory)
    if (lockedHash !== input.reviewHash) {
      return {
        action: 'conflict',
        memoryId: input.memoryId,
        reason: 'Active memory changed since review',
        latest: { reviewHash: lockedHash }
      }
    }
    const lockedGate = gateForTransferableMemory(lockedMemory)
    if (!lockedGate.passed) {
      return {
        action: 'blocked_by_gate',
        memoryId: input.memoryId,
        reason: 'Active memory is not eligible for similar-project transfer',
        gateFindings: flattenGateFindings(lockedGate)
      }
    }

    const nextMemory: CyreneMemory = { ...lockedMemory, portability: 'similar_project', updatedAt: now }
    await writeActiveMemoriesFromRoot(
      lockedRoot,
      active.map((memory) => memory.id === lockedMemory.id ? nextMemory : memory)
    )
    await appendMemoryEventFromRoot(lockedRoot, {
      id: randomUUID(),
      action: 'update',
      at: now,
      reason: 'Marked active memory transferable for similar-project hints',
      memoryId: lockedMemory.id,
      details: { portability: 'similar_project' }
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })
    return { action: 'mark_transferable', memoryId: lockedMemory.id, portability: 'similar_project' }
  })
}

async function findActiveMemory(
  cwd: string,
  memoryId: string,
  currentProjectOnly = false
): Promise<{ memoryRoot: string; projectId: string; memory: CyreneMemory } | undefined> {
  const current = await identifyCodexProject(cwd)
  const currentRoot = await ensureCodexProjectMemoryRoot(current.projectId)
  const roots = currentProjectOnly
    ? [currentRoot]
    : uniqueInOrder([currentRoot, ...(await getReadableCodexProjectMemoryRoots())])
  for (const memoryRoot of roots) {
    const active = await readActiveMemoriesFromRoot(memoryRoot)
    const memory = active.find((item) => item.id === memoryId)
    if (memory !== undefined) {
      return { memoryRoot, projectId: projectIdFromMemoryRoot(memoryRoot), memory }
    }
  }
  return undefined
}

function gateForMemory(memory: CyreneMemory, currentProjectId: string, homeProjectId: string): EvalGateResult {
  return runSimilarHintsEvalGate([{
    id: memory.id,
    currentProjectId,
    homeProjectId,
    domain: memory.domain,
    portability: memoryPortability(memory),
    scope: memory.scope,
    content: memory.content,
    transferable: memoryPortability(memory) === 'similar_project' || memoryPortability(memory) === 'project_family',
    notCurrentProjectFact: homeProjectId !== currentProjectId
  }])
}

function gateForTransferableMemory(memory: CyreneMemory): EvalGateResult {
  return runSimilarHintsEvalGate([{
    id: memory.id,
    currentProjectId: 'current',
    homeProjectId: 'other',
    domain: memory.domain,
    portability: 'similar_project',
    scope: memory.scope,
    content: memory.content,
    transferable: true,
    notCurrentProjectFact: true
  }])
}

function flattenGateFindings(gate: EvalGateResult): EvalFinding[] {
  return gate.results.flatMap((result) => result.findings)
}

function memoryPortability(memory: CyreneMemory): MemoryPortability {
  return memory.portability ?? (memory.scope === 'global' ? 'global' : 'local_only')
}

function projectIdFromMemoryRoot(memoryRoot: string): string {
  return basename(dirname(memoryRoot))
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const value of values) {
    if (!seen.has(value)) {
      unique.push(value)
      seen.add(value)
    }
  }
  return unique
}
