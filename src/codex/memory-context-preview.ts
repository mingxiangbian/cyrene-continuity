import { readPendingMemoriesFromRoot, readSemanticMemoriesFromRoot, readTombstonesFromRoot } from '../memory/memory-store.js'
import type { MemoryTombstone, PendingMemory, SemanticMemory } from '../memory/types.js'
import type { RetrieveMemoriesInput } from '../memory/memory-retriever.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from './codex-memory-root.js'
import { getCodexContinuityContext, type CodexContinuityContext } from './continuity-context.js'
import { identifyCodexProject } from './project-id.js'

export type CodexMemoryContextPreviewTask = NonNullable<RetrieveMemoriesInput['task']>
type CodexMemoryContextPreviewIndexDiagnostic = NonNullable<CodexContinuityContext['diagnostics']>['memoryIndex']

export interface CodexMemoryContextPreview {
  version: 1
  input: {
    task: CodexMemoryContextPreviewTask
    userMessage: string
  }
  project: {
    projectId: string
    displayName: string
  }
  activeContext: {
    globalMemory: PreviewMemory[]
    projectMemory: PreviewMemory[]
    similarProjectHints: PreviewMemory[]
  }
  activation: CodexContinuityContext['activation']
  exclusions: {
    pendingReview: {
      count: number
      items: PreviewExclusion[]
    }
    tombstones: PreviewExclusion[]
    archived: PreviewExclusion[]
  }
  diagnostics: {
    memoryIndex?: CodexMemoryContextPreviewIndexDiagnostic
    pendingReview: {
      hasItems: boolean
      count: number
    }
  }
}

export interface PreviewMemory {
  id: string
  scope: string
  domain: string
  type: string
  strength: string
  content: string
  score?: number
}

export interface PreviewExclusion {
  id: string
  scope: string
  root: 'project' | 'global'
  reason: string
}

export async function runCodexMemoryContextPreview(input: {
  cwd: string
  userMessage: string
  task?: CodexMemoryContextPreviewTask
}): Promise<CodexMemoryContextPreview> {
  const task = input.task ?? 'coding'
  const project = await identifyCodexProject(input.cwd)
  const globalRoot = codexGlobalMemoryRoot()
  const projectRoot = codexProjectMemoryRoot(project.projectId)

  const [context, globalPending, projectPending, globalTombstones, projectTombstones, globalSemantic, projectSemantic] =
    await Promise.all([
      getCodexContinuityContext({
        cwd: input.cwd,
        userMessage: input.userMessage,
        task,
        recordActivationEvents: false
      }),
      readPendingMemoriesFromRoot(globalRoot),
      readPendingMemoriesFromRoot(projectRoot),
      readTombstonesFromRoot(globalRoot),
      readTombstonesFromRoot(projectRoot),
      readSemanticMemoriesFromRoot(globalRoot),
      readSemanticMemoriesFromRoot(projectRoot)
    ])

  const pendingReviewItems = [
    ...globalPending.map((memory) => pendingExclusion(memory, 'global')),
    ...projectPending.map((memory) => pendingExclusion(memory, 'project'))
  ]

  return {
    version: 1,
    input: {
      task,
      userMessage: input.userMessage
    },
    project: context.project,
    activeContext: {
      globalMemory: context.globalMemory.map(previewMemory),
      projectMemory: context.projectMemory.map(previewMemory),
      similarProjectHints: context.similarProjectHints.map(previewMemory)
    },
    activation: context.activation,
    exclusions: {
      pendingReview: {
        count: pendingReviewItems.length,
        items: pendingReviewItems
      },
      tombstones: [
        ...globalTombstones.map((memory) => tombstoneExclusion(memory, 'global')),
        ...projectTombstones.map((memory) => tombstoneExclusion(memory, 'project'))
      ],
      archived: [
        ...globalSemantic.flatMap((memory) => archivedExclusion(memory, 'global')),
        ...projectSemantic.flatMap((memory) => archivedExclusion(memory, 'project'))
      ]
    },
    diagnostics: {
      ...(context.diagnostics?.memoryIndex === undefined ? {} : { memoryIndex: context.diagnostics.memoryIndex }),
      pendingReview: {
        hasItems: pendingReviewItems.length > 0,
        count: pendingReviewItems.length
      }
    }
  }
}

function previewMemory(
  memory:
    | CodexContinuityContext['globalMemory'][number]
    | CodexContinuityContext['projectMemory'][number]
    | CodexContinuityContext['similarProjectHints'][number]
): PreviewMemory {
  return {
    id: memory.id,
    scope: 'scope' in memory ? memory.scope : 'project',
    domain: memory.domain,
    type: memory.type,
    strength: memory.strength,
    content: memory.content,
    score: memory.score
  }
}

function pendingExclusion(memory: PendingMemory, root: PreviewExclusion['root']): PreviewExclusion {
  return {
    id: memory.id,
    scope: memory.scope,
    root,
    reason: 'pending_review_required'
  }
}

function tombstoneExclusion(memory: MemoryTombstone, root: PreviewExclusion['root']): PreviewExclusion {
  return {
    id: memory.id,
    scope: memory.scope,
    root,
    reason: memory.reason
  }
}

function archivedExclusion(memory: SemanticMemory, root: PreviewExclusion['root']): PreviewExclusion[] {
  if (memory.status !== 'archived' && memory.status !== 'rejected' && memory.status !== 'superseded') {
    return []
  }
  return [{
    id: memory.id,
    scope: memory.scope,
    root,
    reason: memory.status
  }]
}
