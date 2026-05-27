import { join } from 'node:path'
import {
  openMemoryIndexAdapter,
  type MemoryIndexDiagnostics,
  type MemoryIndexRoot
} from '../memory/memory-index.js'
import {
  codexGlobalRoot,
  getReadableCodexGlobalMemoryRoot,
  getReadableCodexProjectMemoryRoot
} from './codex-memory-root.js'
import { identifyCodexProject } from './project-id.js'

export interface CodexMemoryIndexRebuildResult {
  dbPath: string
  diagnostics: MemoryIndexDiagnostics
  syncedRoots: number
}

export function codexMemoryDbPath(): string {
  return join(codexGlobalRoot(), 'memory.db')
}

export async function codexMemoryIndexRoots(projectId: string): Promise<MemoryIndexRoot[]> {
  const roots: MemoryIndexRoot[] = []
  const globalRoot = await getReadableCodexGlobalMemoryRoot()
  if (globalRoot !== null) {
    roots.push({ memoryRoot: globalRoot, projectId: null, scope: 'global' })
  }
  const projectRoot = await getReadableCodexProjectMemoryRoot(projectId)
  if (projectRoot !== null) {
    roots.push({ memoryRoot: projectRoot, projectId, scope: 'project' })
  }
  return roots
}

export async function rebuildCodexMemoryIndex(input: { cwd: string }): Promise<CodexMemoryIndexRebuildResult> {
  const project = await identifyCodexProject(input.cwd)
  const roots = await codexMemoryIndexRoots(project.projectId)
  const adapter = await openMemoryIndexAdapter({ dbPath: codexMemoryDbPath() })
  try {
    const diagnostics = await adapter.rebuildFromRoots({ roots })
    return { dbPath: codexMemoryDbPath(), diagnostics, syncedRoots: roots.length }
  } finally {
    adapter.close()
  }
}

export async function readCodexMemoryIndexDiagnostics(): Promise<MemoryIndexDiagnostics> {
  const adapter = await openMemoryIndexAdapter({ dbPath: codexMemoryDbPath() })
  try {
    return adapter.diagnostics()
  } finally {
    adapter.close()
  }
}
