import { readMemoryEdgesFromRoot, readPendingMemoriesFromRoot, readSemanticMemoriesFromRoot, readTombstonesFromRoot } from '../memory/memory-store.js'
import { resolveRelationExpansion } from '../memory/memory-relations.js'
import type { MemoryEdge, MemoryTombstone, PendingMemory, SemanticMemory } from '../memory/types.js'
import type { RetrieveMemoriesInput } from '../memory/memory-retriever.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from './codex-memory-root.js'
import { buildRetrievalPolicy, type ContextMode } from './context-policy.js'
import { getCodexContinuityContext, type CodexContinuityContext } from './continuity-context.js'
import { identifyCodexProject } from './project-id.js'

export type CodexMemoryContextPreviewTask = NonNullable<RetrieveMemoriesInput['task']>
type CodexMemoryContextPreviewIndexDiagnostic = NonNullable<CodexContinuityContext['diagnostics']>['memoryIndex']

export interface CodexMemoryContextPreview {
  version: 1
  input: {
    task: CodexMemoryContextPreviewTask
    userMessage: string
    mode: ContextMode
    includeSimilarProjectHints?: boolean
    includePendingDetails?: boolean
    includePendingNotice?: boolean
    includeDiagnostics?: boolean
    recordRetrievedEvents?: boolean
    allowJsonlFallback?: boolean
    maxTokens?: number
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
      count?: number
      items?: PreviewExclusion[]
    }
    tombstones: PreviewExclusion[]
    archived: PreviewExclusion[]
  }
  diagnostics: {
    memoryIndex?: CodexMemoryContextPreviewIndexDiagnostic
    pendingReview?: {
      hasItems: boolean
      count: number
    }
    relations?: {
      included: PreviewRelationDiagnostic[]
      filtered: PreviewRelationFilteredDiagnostic[]
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

export interface PreviewRelationDiagnostic {
  edgeId: string
  relationType: string
  fromMemoryId: string
  toMemoryId: string
  reason: string
}

export interface PreviewRelationFilteredDiagnostic {
  edgeId: string
  relationType: string
  status: string
  reason: string
}

export async function runCodexMemoryContextPreview(input: {
  cwd: string
  userMessage: string
  task?: CodexMemoryContextPreviewTask
  mode?: ContextMode
  includeSimilarProjectHints?: boolean
  includePendingDetails?: boolean
  includePendingNotice?: boolean
  includeDiagnostics?: boolean
  recordRetrievedEvents?: boolean
  allowJsonlFallback?: boolean
  maxTokens?: number
}): Promise<CodexMemoryContextPreview> {
  const task = input.task ?? 'coding'
  const policy = buildRetrievalPolicy({
    mode: input.mode,
    task,
    userMessage: input.userMessage,
    includeSimilarProjectHints: input.includeSimilarProjectHints,
    includePendingDetails: input.includePendingDetails,
    includePendingNotice: input.includePendingNotice,
    includeDiagnostics: input.includeDiagnostics,
    recordRetrievedEvents: input.recordRetrievedEvents,
    allowJsonlFallback: input.allowJsonlFallback,
    maxTokens: input.maxTokens
  })
  const mode = policy.mode
  const includeExclusionDetails = mode === 'review' || input.includePendingDetails === true || input.includeDiagnostics === true
  const includeRelationDiagnostics = mode === 'review' || input.includeDiagnostics === true
  const project = await identifyCodexProject(input.cwd)
  const globalRoot = codexGlobalMemoryRoot()
  const projectRoot = codexProjectMemoryRoot(project.projectId)

  const [
    context,
    globalPending,
    projectPending,
    globalTombstones,
    projectTombstones,
    globalSemantic,
    projectSemantic,
    globalRelationEdges,
    projectRelationEdges
  ] =
    await Promise.all([
      getCodexContinuityContext({
        cwd: input.cwd,
        userMessage: input.userMessage,
        task,
        mode: input.mode,
        includeSimilarProjectHints: input.includeSimilarProjectHints,
        includePendingDetails: input.includePendingDetails,
        includePendingNotice: input.includePendingNotice,
        includeDiagnostics: input.includeDiagnostics,
        recordActivationEvents: false,
        recordRetrievedEvents: input.recordRetrievedEvents === true,
        allowJsonlFallback: input.allowJsonlFallback,
        maxTokens: input.maxTokens
      }),
      includeExclusionDetails ? readPendingMemoriesFromRoot(globalRoot) : Promise.resolve([]),
      includeExclusionDetails ? readPendingMemoriesFromRoot(projectRoot) : Promise.resolve([]),
      includeExclusionDetails ? readTombstonesFromRoot(globalRoot) : Promise.resolve([]),
      includeExclusionDetails ? readTombstonesFromRoot(projectRoot) : Promise.resolve([]),
      includeExclusionDetails ? readSemanticMemoriesFromRoot(globalRoot) : Promise.resolve([]),
      includeExclusionDetails ? readSemanticMemoriesFromRoot(projectRoot) : Promise.resolve([]),
      includeRelationDiagnostics ? readMemoryEdgesFromRoot(globalRoot) : Promise.resolve([]),
      includeRelationDiagnostics ? readMemoryEdgesFromRoot(projectRoot) : Promise.resolve([])
    ])

  const pendingReviewItems = [
    ...globalPending.map((memory) => pendingExclusion(memory, 'global')),
    ...projectPending.map((memory) => pendingExclusion(memory, 'project'))
  ]
  const relationDiagnostics = includeRelationDiagnostics
    ? previewRelationDiagnostics([...globalRelationEdges, ...projectRelationEdges])
    : undefined

  return {
    version: 1,
    input: {
      task,
      userMessage: input.userMessage,
      mode,
      ...(input.includeSimilarProjectHints === undefined ? {} : { includeSimilarProjectHints: input.includeSimilarProjectHints }),
      ...(input.includePendingDetails === undefined ? {} : { includePendingDetails: input.includePendingDetails }),
      ...(input.includePendingNotice === undefined ? {} : { includePendingNotice: input.includePendingNotice }),
      ...(input.includeDiagnostics === undefined ? {} : { includeDiagnostics: input.includeDiagnostics }),
      ...(input.recordRetrievedEvents === undefined ? {} : { recordRetrievedEvents: input.recordRetrievedEvents }),
      ...(input.allowJsonlFallback === undefined ? {} : { allowJsonlFallback: input.allowJsonlFallback }),
      ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens })
    },
    project: context.project,
    activeContext: {
      globalMemory: context.globalMemory.map(previewMemory),
      projectMemory: context.projectMemory.map(previewMemory),
      similarProjectHints: context.similarProjectHints.map(previewMemory)
    },
    activation: context.activation,
    exclusions: {
      pendingReview: includeExclusionDetails
        ? {
            count: pendingReviewItems.length,
            items: pendingReviewItems
          }
        : {},
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
      ...(includeExclusionDetails
        ? {
            pendingReview: {
              hasItems: pendingReviewItems.length > 0,
              count: pendingReviewItems.length
            }
          }
        : {}),
      ...(relationDiagnostics === undefined ? {} : { relations: relationDiagnostics })
    }
  }
}

function previewRelationDiagnostics(edges: MemoryEdge[]): CodexMemoryContextPreview['diagnostics']['relations'] | undefined {
  if (edges.length === 0) {
    return undefined
  }
  const included: PreviewRelationDiagnostic[] = []
  const filtered: PreviewRelationFilteredDiagnostic[] = []
  for (const edge of edges) {
    const reason = previewRelationReason(edge)
    if (edge.status === 'validated' && reason !== 'edge_not_validated' && reason !== 'diagnostics_only' && reason !== 'wrong_direction') {
      included.push({
        edgeId: edge.id,
        relationType: edge.relationType,
        fromMemoryId: edge.fromMemoryId,
        toMemoryId: edge.toMemoryId,
        reason
      })
    } else {
      filtered.push({
        edgeId: edge.id,
        relationType: edge.relationType,
        status: edge.status,
        reason
      })
    }
  }
  return {
    included: included.slice(0, 50),
    filtered: filtered.slice(0, 50)
  }
}

function previewRelationReason(edge: MemoryEdge): string {
  if (edge.status !== 'validated') {
    return 'edge_not_validated'
  }
  const reasons = [
    resolveRelationExpansion({ seedMemoryId: edge.fromMemoryId, edge }).reason,
    resolveRelationExpansion({ seedMemoryId: edge.toMemoryId, edge }).reason
  ]
  return reasons.find((reason) => reason !== 'diagnostics_only' && reason !== 'wrong_direction') ?? 'diagnostics_only'
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
