import { readActiveMemoriesFromRoot, readPendingMemoriesFromRoot, readTombstonesFromRoot } from '../memory/memory-store.js'
import { codexProjectMemoryRoot } from './codex-memory-root.js'
import { triagePendingMemories } from './memory-triage.js'
import { identifyCodexProject } from './project-id.js'

export async function runCodexMemoryTriage(input: {
  cwd: string
  dryRun: boolean
  apply: boolean
  policy?: 'strict' | 'balanced'
  now?: string
}): Promise<string> {
  const project = await identifyCodexProject(input.cwd)
  const memoryRoot = codexProjectMemoryRoot(project.projectId)
  const now = input.now ?? new Date().toISOString()
  const [pending, active, tombstones] = await Promise.all([
    readPendingMemoriesFromRoot(memoryRoot),
    readActiveMemoriesFromRoot(memoryRoot),
    readTombstonesFromRoot(memoryRoot)
  ])
  const result = triagePendingMemories({ pending, active, tombstones, scope: 'project', now })
  return `${JSON.stringify({ action: input.apply ? 'apply' : 'dry_run', project, memoryRoot, ...result }, null, 2)}\n`
}
