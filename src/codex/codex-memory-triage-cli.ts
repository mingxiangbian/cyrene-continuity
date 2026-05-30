import {
  appendMemoryEventFromRoot,
  appendTombstoneFromRoot,
  readActiveMemoriesFromRoot,
  readMemoryEventsFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot,
  writePendingMemoriesFromRoot
} from '../memory/memory-store.js'
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
  const [pending, active, tombstones] = await Promise.all([
    readPendingMemoriesFromRoot(memoryRoot),
    readActiveMemoriesFromRoot(memoryRoot),
    readTombstonesFromRoot(memoryRoot)
  ])
  const result = triagePendingMemories({ pending, active, tombstones, scope: 'project', now })
  let reviewDerivedCandidateCount = 0
  let applied: ReturnType<typeof applySafeTriageDecisions>['counts'] | undefined
  if (input.apply) {
    const applyResult = applySafeTriageDecisions({ pending, decisions: result.decisions, now })
    await writePendingMemoriesFromRoot(memoryRoot, applyResult.pending)
    for (const tombstone of applyResult.tombstones) {
      await appendTombstoneFromRoot(memoryRoot, tombstone)
    }
    for (const event of applyResult.events) {
      await appendMemoryEventFromRoot(memoryRoot, event)
    }
    applied = applyResult.counts

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
  }

  return `${JSON.stringify({ action: input.apply ? 'apply' : 'dry_run', project, memoryRoot, reviewDerivedCandidateCount, ...(applied === undefined ? {} : { applied }), ...result }, null, 2)}\n`
}
