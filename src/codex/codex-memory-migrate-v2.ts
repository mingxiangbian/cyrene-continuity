import { lstat } from 'node:fs/promises'
import {
  isMemoryJsonlRepairRequiredError,
  migrateMemoryRootToSemanticV2FromRoot,
  type SemanticMemoryV2MigrationResult
} from '../memory/memory-store.js'
import {
  codexGlobalMemoryRoot,
  codexProjectMemoryRoot
} from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'
import { listCodexProjects } from './project-registry.js'

export interface CodexMemoryMigrateV2RootResult extends Partial<SemanticMemoryV2MigrationResult> {
  scope: 'global' | 'project'
  projectId?: string
  memoryRoot: string
  skipped?: boolean
  reason?: string
  malformedJsonLines?: number
}

export interface CodexMemoryMigrateV2Result {
  action: 'migrate_semantic_memory_v2'
  roots: CodexMemoryMigrateV2RootResult[]
}

export async function runCodexMemoryMigrateV2(input: {
  cwd: string
  allProjects?: boolean
  now?: string
}): Promise<CodexMemoryMigrateV2Result> {
  const currentProject = await identifyCodexProject(input.cwd)
  const roots = new Map<string, { scope: 'global' | 'project'; projectId?: string; memoryRoot: string }>()
  const addRoot = (root: { scope: 'global' | 'project'; projectId?: string; memoryRoot: string }) => {
    roots.set(`${root.scope}:${root.projectId ?? 'global'}:${root.memoryRoot}`, root)
  }

  addRoot({ scope: 'global', memoryRoot: codexGlobalMemoryRoot() })
  addRoot({ scope: 'project', projectId: currentProject.projectId, memoryRoot: codexProjectMemoryRoot(currentProject.projectId) })
  if (input.allProjects === true) {
    for (const project of await listCodexProjects().catch(() => [])) {
      addRoot({ scope: 'project', projectId: project.projectId, memoryRoot: codexProjectMemoryRoot(project.projectId) })
    }
  }

  const results: CodexMemoryMigrateV2RootResult[] = []
  for (const root of roots.values()) {
    const readable = await readableMemoryRoot(root.memoryRoot)
    if (!readable.ok) {
      results.push({
        ...root,
        skipped: true,
        reason: readable.reason
      })
      continue
    }
    try {
      results.push({
        ...root,
        ...(await migrateMemoryRootToSemanticV2FromRoot(root.memoryRoot, { now: input.now }))
      })
    } catch (error) {
      if (!isMemoryJsonlRepairRequiredError(error)) {
        throw error
      }
      results.push({
        ...root,
        skipped: true,
        reason: 'repair_required',
        malformedJsonLines: error.malformedLineCount + error.skippedFileCount
      })
    }
  }

  return {
    action: 'migrate_semantic_memory_v2',
    roots: results
  }
}

async function readableMemoryRoot(memoryRoot: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const stats = await lstat(memoryRoot)
    if (stats.isSymbolicLink()) return { ok: false, reason: 'memory root is a symlink' }
    if (!stats.isDirectory()) return { ok: false, reason: 'memory root is not a directory' }
    return { ok: true }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { ok: false, reason: 'memory root does not exist' }
    }
    throw error
  }
}
