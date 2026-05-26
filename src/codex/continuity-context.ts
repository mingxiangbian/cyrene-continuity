import { buildContinuitySnapshot } from '../affect/affect-runtime.js'
import type { PrincipledDissentPolicy } from '../affect/types.js'
import { createDefaultConfig } from '../config.js'
import { readModelProfileFromRootIfExists } from '../memory/model-profile.js'
import { memoryRetrievalBudgetForTask, retrieveMemories } from '../memory/memory-retriever.js'
import type { RetrieveMemoriesInput } from '../memory/memory-retriever.js'
import { readActiveMemoriesFromRoot } from '../memory/memory-store.js'
import type { CyreneMemory } from '../memory/types.js'
import {
  codexGlobalMemoryRoot,
  codexProjectMemoryRoot,
  getReadableCodexGlobalMemoryRoot,
  getReadableCodexProjectMemoryRoot,
  getReadableCodexProjectMemoryRoots
} from './codex-memory-root.js'
import { markCodexMemoryDreamDue, readCodexMemoryDreamState } from './memory-dream-state.js'
import { getCodexPendingReviewNotice } from './memory-review.js'
import { identifyCodexProject } from './project-id.js'
import type { CodexPendingReviewNotice } from './memory-review.js'

type CodexContinuityTask = NonNullable<RetrieveMemoriesInput['task']>

export interface CodexContinuityContext {
  project: {
    projectId: string
    displayName: string
  }
  memory: {
    items: Array<{
      id: string
      domain: string
      type: string
      strength: string
      content: string
    }>
  }
  profile: {
    global?: string
    project?: string
    content: string
  }
  pendingReview: CodexPendingReviewNotice
  strategy: {
    tone: string
    verbosity: string
    challenge: string
    boundaryMode: string
    safetyMode: string
    shouldChallengeUser: boolean
    shouldAskClarifyingQuestion: boolean
    rationale: string
  }
  dissent: Pick<PrincipledDissentPolicy, 'shouldChallenge' | 'mode' | 'reason'>
}

export async function getCodexContinuityContext(input: {
  cwd: string
  userMessage: string
  task?: CodexContinuityTask
}): Promise<CodexContinuityContext> {
  const project = await identifyCodexProject(input.cwd)
  const config = createDefaultConfig(input.cwd)
  const task = input.task ?? 'coding'
  const globalMemoryRoot = codexGlobalMemoryRoot()
  const projectMemoryRoot = codexProjectMemoryRoot(project.projectId)
  const budget = memoryRetrievalBudgetForTask(task)
  await markProjectDreamDueIfOverdue(project.projectId, config)
  const [memories, pendingReview, globalProfile, projectProfile] = await Promise.all([
    retrieveMemories({
      cwd: input.cwd,
      userCyreneDir: config.userCyreneDir,
      memoryRoots: [globalMemoryRoot, projectMemoryRoot],
      extraMemories: await readLegacyGlobalCodexMemories(project.projectId),
      query: input.userMessage,
      task,
      maxItems: budget.maxItems,
      maxTokens: budget.maxTokens
    }),
    getCodexPendingReviewNotice({ cwd: input.cwd }),
    readGlobalCodexProfileIfExists(),
    readProjectCodexProfileIfExists(project.projectId)
  ])
  const profileContent = [globalProfile, projectProfile].filter(Boolean).join('\n\n')
  const snapshot = await buildContinuitySnapshot({
    config: {
      ...config,
      memoryCwd: input.cwd
    },
    userMessage: input.userMessage,
    task,
    memories: memories.map(({ memory }) => memory),
    generatedAt: new Date().toISOString()
  })

  return {
    project: {
      projectId: project.projectId,
      displayName: project.displayName
    },
    memory: {
      items: memories.map(({ memory }) => ({
        id: memory.id,
        domain: memory.domain,
        type: memory.type,
        strength: memory.strength,
        content: memory.content
      }))
    },
    profile: {
      global: globalProfile,
      project: projectProfile,
      content: profileContent
    },
    pendingReview,
    strategy: {
      tone: snapshot.strategy.tone,
      verbosity: snapshot.strategy.verbosity,
      challenge: snapshot.strategy.challenge,
      boundaryMode: snapshot.strategy.boundaryMode,
      safetyMode: snapshot.strategy.safetyMode,
      shouldChallengeUser: snapshot.strategy.shouldChallengeUser,
      shouldAskClarifyingQuestion: snapshot.strategy.shouldAskClarifyingQuestion,
      rationale: snapshot.strategy.rationale
    },
    dissent: {
      shouldChallenge: snapshot.dissent.shouldChallenge,
      mode: snapshot.dissent.mode,
      reason: snapshot.dissent.reason
    }
  }
}

async function markProjectDreamDueIfOverdue(projectId: string, config: ReturnType<typeof createDefaultConfig>): Promise<void> {
  if (!config.memoryDreamCatchUpEnabled) {
    return
  }
  const root = await getReadableCodexProjectMemoryRoot(projectId)
  if (root === null) {
    return
  }

  try {
    const state = await readCodexMemoryDreamState(root)
    const now = new Date().toISOString()
    if (state.dreamDue !== true && state.nextDreamDueAt !== undefined && state.nextDreamDueAt <= now) {
      await markCodexMemoryDreamDue(root, now)
    }
  } catch {
    // Continuity reads must not fail just because dream scheduling metadata is unavailable.
  }
}

async function readGlobalCodexProfileIfExists(): Promise<string | undefined> {
  const root = await getReadableCodexGlobalMemoryRoot()
  if (root === null) {
    return undefined
  }
  return readModelProfileFromRootIfExists(root)
}

async function readProjectCodexProfileIfExists(projectId: string): Promise<string | undefined> {
  const root = await getReadableCodexProjectMemoryRoot(projectId)
  if (root === null) {
    return undefined
  }
  return readModelProfileFromRootIfExists(root)
}

async function readLegacyGlobalCodexMemories(currentProjectId: string): Promise<CyreneMemory[]> {
  const currentProjectMemoryRoot = codexProjectMemoryRoot(currentProjectId)
  const roots = await getReadableCodexProjectMemoryRoots()
  const legacy = await Promise.all(
    roots
      .filter((root) => root !== currentProjectMemoryRoot)
      .map(async (root) => (await readActiveMemoriesFromRoot(root)).filter((memory) => memory.scope === 'global'))
  )
  return legacy.flat()
}
