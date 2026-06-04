import { runCodexMemoryLifecycleDaily, type DailyLifecycleResult } from './codex-memory-lifecycle-daily.js'
import { runCodexMemoryLifecycleWeekly, type WeeklyLifecycleResult } from './codex-memory-lifecycle-weekly.js'

export type CodexMemoryAutomationJob = 'daily' | 'weekly'

export type CodexMemoryAutomationResult =
  | ({ job: 'daily' } & DailyLifecycleResult)
  | ({ job: 'weekly' } & WeeklyLifecycleResult)

export async function runCodexMemoryAutomation(input: {
  cwd: string
  job: CodexMemoryAutomationJob
  allProjects?: boolean
  apply?: boolean
  now?: string
}): Promise<CodexMemoryAutomationResult> {
  if (input.job === 'daily') {
    const result = await runCodexMemoryLifecycleDaily({
      cwd: input.cwd,
      allProjects: input.allProjects,
      includeGlobalRoot: true,
      apply: input.apply,
      now: input.now
    })
    return { job: 'daily', ...result }
  }

  const result = await runCodexMemoryLifecycleWeekly({
    cwd: input.cwd,
    allProjects: input.allProjects,
    apply: input.apply,
    now: input.now
  })
  return { job: 'weekly', ...result }
}
