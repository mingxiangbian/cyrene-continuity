import { basename, dirname, join } from 'node:path'
import {
  openMemoryIndexAdapter,
  type MemoryIndexDiagnostics,
  type MemoryIndexRoot
} from '../memory/memory-index.js'
import {
  codexGlobalRoot,
  getReadableCodexGlobalMemoryRoot,
  getReadableCodexProjectMemoryRoot,
  getReadableCodexProjectMemoryRoots
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
  const seen = new Set<string>()
  const addRoot = (root: MemoryIndexRoot): void => {
    if (seen.has(root.memoryRoot)) return
    seen.add(root.memoryRoot)
    roots.push(root)
  }

  const globalRoot = await getReadableCodexGlobalMemoryRoot()
  if (globalRoot !== null) {
    addRoot({ memoryRoot: globalRoot, projectId: null, scope: 'global' })
  }
  const projectRoot = await getReadableCodexProjectMemoryRoot(projectId)
  if (projectRoot !== null) {
    addRoot({ memoryRoot: projectRoot, projectId, scope: 'project' })
  }
  for (const memoryRoot of await getReadableCodexProjectMemoryRoots()) {
    addRoot({ memoryRoot, projectId: basename(dirname(memoryRoot)), scope: 'project' })
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

export async function syncCurrentCodexMemoryIndex(input: { cwd: string }): Promise<void> {
  try {
    await rebuildCodexMemoryIndex(input)
  } catch {
    // JSONL is the source of truth. Index sync must not break memory writes.
  }
}
