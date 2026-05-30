import {
  assertMemoryMaintenanceTargetsSafeFromRoot,
  withMemoryMaintenanceLockFromRoot
} from '../memory/memory-maintenance.js'
import {
  appendMemoryEventFromRoot,
  appendTombstoneFromRoot,
  readActiveMemoriesFromRoot,
  readMemoryEventsFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot,
  writePendingMemoriesFromRoot
} from '../memory/memory-store.js'
import { syncCurrentCodexMemoryIndex } from './codex-memory-index.js'
import { codexProjectMemoryRoot } from './codex-memory-root.js'
import { candidatesFromReviewEvents } from './global-memory-capture.js'
import { proposeCodexMemoryCandidate } from './memory-propose.js'
import { triagePendingMemories } from './memory-triage.js'
import { identifyCodexProject } from './project-id.js'
import { applySafeTriageDecisions } from './triage-apply.js'

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
  let reviewDerivedCandidateCount = 0
  let applied: ReturnType<typeof applySafeTriageDecisions>['counts'] | undefined
  let result: ReturnType<typeof triagePendingMemories>

  if (input.apply) {
    await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
    const appliedResult = await withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedMemoryRoot) => {
      await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
      const [pending, active, tombstones] = await Promise.all([
        readPendingMemoriesFromRoot(lockedMemoryRoot),
        readActiveMemoriesFromRoot(lockedMemoryRoot),
        readTombstonesFromRoot(lockedMemoryRoot)
      ])
      const lockedResult = triagePendingMemories({ pending, active, tombstones, scope: 'project', now })
      const applyResult = applySafeTriageDecisions({ pending, decisions: lockedResult.decisions, now })
      await writePendingMemoriesFromRoot(lockedMemoryRoot, applyResult.pending)
      for (const tombstone of applyResult.tombstones) {
        await appendTombstoneFromRoot(lockedMemoryRoot, tombstone)
      }
      for (const event of applyResult.events) {
        await appendMemoryEventFromRoot(lockedMemoryRoot, event)
      }
      await syncCurrentCodexMemoryIndex({ cwd: input.cwd })

      return { result: lockedResult, applied: applyResult.counts }
    })
    result = appliedResult.result
    applied = appliedResult.applied

    const reviewDerived = candidatesFromReviewEvents({
      events: await readMemoryEventsFromRoot(memoryRoot),
      now
    })
    reviewDerivedCandidateCount = reviewDerived.length
    for (const candidate of reviewDerived) {
      await proposeCodexMemoryCandidate({
        cwd: input.cwd,
        candidate,
        now,
        recordRejectedCandidate: false,
        allowAutoPromote: false
      })
    }

    return `${JSON.stringify({ action: 'apply', project, memoryRoot, reviewDerivedCandidateCount, applied, ...result }, null, 2)}\n`
  }

  const [pending, active, tombstones] = await Promise.all([
    readPendingMemoriesFromRoot(memoryRoot),
    readActiveMemoriesFromRoot(memoryRoot),
    readTombstonesFromRoot(memoryRoot)
  ])
  result = triagePendingMemories({ pending, active, tombstones, scope: 'project', now })

  return `${JSON.stringify({ action: 'dry_run', project, memoryRoot, reviewDerivedCandidateCount, ...result }, null, 2)}\n`
}
