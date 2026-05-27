import { buildContinuitySnapshot } from '../affect/affect-runtime.js'
import type { PrincipledDissentPolicy } from '../affect/types.js'
import { createDefaultConfig } from '../config.js'
import { readModelProfileFromRootIfExists } from '../memory/model-profile.js'
import type { IndexedActiveMemory, IndexedPendingMemory, MemoryIndexDiagnostics } from '../memory/memory-index.js'
import { openMemoryIndexAdapter } from '../memory/memory-index.js'
import { memoryRetrievalBudgetForTask, retrieveMemories } from '../memory/memory-retriever.js'
import type { RetrievedMemory, RetrieveMemoriesInput } from '../memory/memory-retriever.js'
import { readActiveMemoriesFromRoot } from '../memory/memory-store.js'
import type { CyreneMemory } from '../memory/types.js'
import { codexMemoryDbPath, codexMemoryIndexRoots } from './codex-memory-index.js'
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

interface RoutedMemoryDigestItem {
  id: string
  domain: string
  type: string
  strength: string
  scope: string
  portability: string
  status: 'active'
  content: string
  score: number
}

interface PendingHypothesisDigestItem {
  id: string
  domain: string
  type: string
  strength: string
  scope: string
  portability: string
  status: 'pending'
  content: string
  provisional: true
  score: number
}

interface ReviewReminder {
  kind: 'pending_review'
  candidateId: string
  content: string
}

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
  globalMemory: RoutedMemoryDigestItem[]
  projectMemory: RoutedMemoryDigestItem[]
  pendingHypotheses: PendingHypothesisDigestItem[]
  similarProjectHints: []
  responseStrategy: {
    tone: string
    verbosity: string
    challengePolicy: string
    avoid: string[]
    rationale: string
  }
  reviewReminders: ReviewReminder[]
  diagnostics?: {
    memoryIndex?: {
      available: boolean
      reason?: string
      ftsTokenizer?: string
    }
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
  const legacyRetrievalInput: RetrieveMemoriesInput = {
      cwd: input.cwd,
      userCyreneDir: config.userCyreneDir,
      memoryRoots: [globalMemoryRoot, projectMemoryRoot],
      extraMemories: await readLegacyGlobalCodexMemories(project.projectId),
      query: input.userMessage,
      task,
      maxItems: budget.maxItems,
      maxTokens: budget.maxTokens
  }
  const [pendingReview, globalProfile, projectProfile] = await Promise.all([
    getCodexPendingReviewNotice({ cwd: input.cwd }),
    readGlobalCodexProfileIfExists(),
    readProjectCodexProfileIfExists(project.projectId)
  ])
  const routedMemory = await retrieveRoutedMemory({
    projectId: project.projectId,
    query: input.userMessage,
    fallback: legacyRetrievalInput
  })
  const activeMemory = [...routedMemory.globalMemory, ...routedMemory.projectMemory]
  const profileContent = [globalProfile, projectProfile].filter(Boolean).join('\n\n')
  const snapshot = await buildContinuitySnapshot({
    config: {
      ...config,
      memoryCwd: input.cwd
    },
    userMessage: input.userMessage,
    task,
    memories: activeMemory.map((item) => item.memory),
    generatedAt: new Date().toISOString()
  })

  return {
    project: {
      projectId: project.projectId,
      displayName: project.displayName
    },
    memory: {
      items: activeMemory.map(({ memory }) => ({
        id: memory.id,
        domain: memory.domain,
        type: memory.type,
        strength: memory.strength,
        content: memory.content
      }))
    },
    globalMemory: routedMemory.globalMemory.map(toRoutedMemoryDigestItem),
    projectMemory: routedMemory.projectMemory.map(toRoutedMemoryDigestItem),
    pendingHypotheses: routedMemory.pendingHypotheses.map(toPendingHypothesisDigestItem),
    similarProjectHints: [],
    responseStrategy: {
      tone: snapshot.strategy.tone,
      verbosity: snapshot.strategy.verbosity,
      challengePolicy: snapshot.strategy.challenge,
      avoid: [
        'claimed sentience',
        'psychological diagnosis',
        'romantic attachment',
        'emotional manipulation'
      ],
      rationale: snapshot.strategy.rationale
    },
    reviewReminders: formatReviewReminders(pendingReview),
    diagnostics: {
      memoryIndex: {
        available: routedMemory.diagnostics.available,
        reason: routedMemory.diagnostics.reason,
        ftsTokenizer: routedMemory.diagnostics.ftsTokenizer
      }
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

interface RoutedMemoryResult {
  globalMemory: Array<IndexedActiveMemory | RetrievedMemory>
  projectMemory: Array<IndexedActiveMemory | RetrievedMemory>
  pendingHypotheses: IndexedPendingMemory[]
  diagnostics: MemoryIndexDiagnostics
}

async function retrieveRoutedMemory(input: {
  projectId: string
  query: string
  fallback: RetrieveMemoriesInput
}): Promise<RoutedMemoryResult> {
  const adapter = await openMemoryIndexAdapter({ dbPath: codexMemoryDbPath() })
  try {
    const roots = await codexMemoryIndexRoots(input.projectId)
    const diagnostics = await adapter.rebuildFromRoots({ roots })
    if (!diagnostics.available) {
      return fallbackRoutedMemory(input.fallback, diagnostics)
    }
    const [globalMemory, projectMemory, pendingHypotheses] = await Promise.all([
      adapter.queryActive({
        currentProjectId: input.projectId,
        query: input.query,
        route: 'global',
        maxItems: 8,
        maxTokens: 500
      }),
      adapter.queryActive({
        currentProjectId: input.projectId,
        query: input.query,
        route: 'project',
        maxItems: 12,
        maxTokens: 900
      }),
      adapter.queryPending({
        currentProjectId: input.projectId,
        query: input.query,
        maxItems: 6,
        maxTokens: 400
      })
    ])
    return { globalMemory, projectMemory, pendingHypotheses, diagnostics }
  } catch (error) {
    return fallbackRoutedMemory(input.fallback, {
      available: false,
      dbPath: codexMemoryDbPath(),
      reason: error instanceof Error ? error.message : String(error)
    })
  } finally {
    adapter.close()
  }
}

async function fallbackRoutedMemory(
  input: RetrieveMemoriesInput,
  diagnostics: MemoryIndexDiagnostics
): Promise<RoutedMemoryResult> {
  const memories = await retrieveMemories(input)
  return {
    globalMemory: memories.filter(({ memory }) => memory.scope === 'global'),
    projectMemory: memories.filter(({ memory }) => memory.scope !== 'global'),
    pendingHypotheses: [],
    diagnostics
  }
}

function toRoutedMemoryDigestItem(item: IndexedActiveMemory | RetrievedMemory): RoutedMemoryDigestItem {
  return {
    id: item.memory.id,
    domain: item.memory.domain,
    type: item.memory.type,
    strength: item.memory.strength,
    scope: item.memory.scope,
    portability: 'portability' in item ? item.portability : item.memory.scope === 'global' ? 'global' : 'local_only',
    status: item.memory.status,
    content: item.memory.content,
    score: item.score
  }
}

function toPendingHypothesisDigestItem(item: IndexedPendingMemory): PendingHypothesisDigestItem {
  return {
    id: item.memory.id,
    domain: item.memory.domain,
    type: item.memory.type,
    strength: item.memory.strength,
    scope: item.memory.scope,
    portability: item.portability,
    status: item.memory.status,
    content: item.memory.content,
    provisional: true,
    score: item.score
  }
}

function formatReviewReminders(pendingReview: CodexPendingReviewNotice): ReviewReminder[] {
  if (pendingReview.newestCandidateId === undefined || pendingReview.newestPreview === undefined) {
    return []
  }
  return [{
    kind: 'pending_review',
    candidateId: pendingReview.newestCandidateId,
    content: pendingReview.newestPreview
  }]
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
