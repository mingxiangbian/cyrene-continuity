import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDefaultConfig } from '../config.js'
import {
  callModel as defaultCallModel,
  modelBaseUrlRequiresApiKey,
  type CallModelInput,
  type ModelResponse
} from '../llm-client.js'
import { openMemoryIndexAdapter } from '../memory/memory-index.js'
import {
  appendMemoryEventFromRoot,
  assertSafeMemoryDataFileTarget,
  mergePendingMemory,
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot,
  writePendingMemoriesFromRoot
} from '../memory/memory-store.js'
import {
  assertMemoryMaintenanceTargetsSafeFromRoot,
  withMemoryMaintenanceLockFromRoot
} from '../memory/memory-maintenance.js'
import { readModelProfileFromRootIfExists } from '../memory/model-profile.js'
import { isMemoryCandidateKind } from '../memory/candidate-kind.js'
import type { CyreneMemory, MemoryCandidateKind, MemoryScores, PendingMemory } from '../memory/types.js'
import { buildRetrievalPlan } from './retrieval-planner.js'
import { codexMemoryDbPath, syncCurrentCodexMemoryIndex } from './codex-memory-index.js'
import { readCodexMemoryStatus } from './codex-memory-status.js'
import {
  archiveCodexActiveMemory,
  contentHashForActiveMemory,
  proposeEditCodexActiveMemory,
  supersedeCodexActiveMemory,
  tombstoneCodexActiveMemory
} from './active-memory-review.js'
import {
  codexGlobalMemoryRoot,
  codexProjectMemoryRoot,
  getReadableCodexGlobalMemoryRoot,
  getReadableCodexProjectMemoryRoot
} from './codex-memory-root.js'
import { triagePendingMemories, type TriageDecision } from './memory-triage.js'
import {
  deferCodexPendingMemory,
  editCodexPendingMemory,
  promoteCodexPendingMemory,
  rejectCodexPendingMemory,
  summarizePendingMemory,
  type CodexPendingMemoryDeferResult,
  type CodexPendingMemoryEditResult,
  type CodexPendingMemoryPromoteResult,
  type CodexPendingMemoryRejectResult,
  type CodexPendingMemorySummary
} from './memory-review.js'
import { readCodexMemoryDreamState } from './memory-dream-state.js'
import { identifyCodexProject, type CodexProjectIdentity } from './project-id.js'
import { runCodexProjectMemoryHarvest } from './project-memory-harvester.js'
import { collectProjectMemorySignals } from './project-memory-signals.js'
import { deleteCodexProjectMemory, listCodexProjects, type CodexProjectRegistryEntry } from './project-registry.js'
import type { CodexReviewSummaryRecord } from './review-summary-store.js'

export type CodexUiApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } }

export interface CodexUiApiResult<T> {
  status: number
  body: CodexUiApiResponse<T>
}

export interface HandleCodexUiApiRequestInput {
  cwd: string
  method: string
  pathname: string
  searchParams?: URLSearchParams
  body?: unknown
  now?: string
  uiToken?: string
  callModel?: (input: CallModelInput) => Promise<ModelResponse>
}

interface CodexUiProjectIdentity {
  projectId: string
  displayName: string
  cwd?: string
  gitRoot?: string
  gitRemoteHash?: string
}

interface ActiveMemoryResult {
  project: CodexUiProjectIdentity
  active: CodexUiActiveMemorySummary[]
  memoryRoot: string
}

type CodexUiActiveMemorySummary = CyreneMemory & { contentHash: string }

interface ProjectMemoryGroup {
  label: string
  memories: CyreneMemory[]
}

const REVIEW_SUMMARIES_FILE = 'review-summaries.jsonl'
const PROJECT_MEMORY_LABELS = [
  'Project Facts',
  'Project Decisions',
  'Workflow Rules',
  'Known Pitfalls',
  'Rejected Approaches',
  'Open Questions',
  'Other Project Memory'
] as const

const GLOBAL_MEMORY_LABELS = [
  'User Preferences',
  'Interaction Style',
  'Relationship Boundaries',
  'Affective Patterns',
  'Workflow Rules',
  'System Policies',
  'References',
  'Episodes',
  'Project Facts',
  'Other Global Memory'
] as const

type ProjectMemoryLabel = typeof PROJECT_MEMORY_LABELS[number]
type GlobalMemoryLabel = typeof GLOBAL_MEMORY_LABELS[number]
type CodexUiMemoryScope = 'project' | 'global' | 'all'
type MemoryWriteAction = 'approve' | 'reject' | 'defer' | 'edit'
type ActiveMemoryWriteAction = 'archive' | 'tombstone' | 'propose-edit' | 'supersede'
type MemoryWriteReviewResult =
  | CodexPendingMemoryPromoteResult
  | CodexPendingMemoryRejectResult
  | CodexPendingMemoryDeferResult
  | CodexPendingMemoryEditResult

interface MemoryWriteRoute {
  id: string
  action: MemoryWriteAction
}

interface ActiveMemoryWriteRoute {
  id: string
  action: ActiveMemoryWriteAction
}

interface EditPatch {
  content: string
  candidateKind?: MemoryCandidateKind
  tags?: string[]
  scores?: Partial<MemoryScores>
}

interface CodexUiRootCounts {
  active: number
  pending: number
  tombstones: number
}

interface CodexUiProjectOption {
  projectId: string
  displayName: string
  aliases: string[]
  mergedInto?: string
  disabled: boolean
  disabledAt?: string
  disabledReason?: string
  memoryRoot: string
  counts: CodexUiRootCounts
  current: boolean
}

interface CodexUiProjectsResult {
  currentProjectId: string
  currentProject: CodexProjectIdentity
  global: {
    label: 'Global'
    memoryRoot: string
    counts: CodexUiRootCounts
  }
  projects: CodexUiProjectOption[]
}

interface CodexUiSelectionRequest {
  scope: CodexUiMemoryScope
  projectId?: string
}

interface CodexUiResolvedSelection {
  scope: CodexUiMemoryScope
  projectId: string
  label: string
  project: CodexUiProjectIdentity
  memoryRoot: string
  memoryRoots: string[]
  globalMemoryRoot: string
  projectMemoryRoot: string
}

type SafeTriageAction = 'auto_drop' | 'auto_defer' | 'auto_merge'
type SkippedTriageAction = 'auto_promote' | 'manual_review' | 'recommend'

interface TriageApplyReceipt {
  action: 'triage_apply'
  createdAt: string
  applied: Record<SafeTriageAction, number>
  skipped: Record<SkippedTriageAction, number>
  summary: string
}

export async function handleCodexUiApiRequest(input: HandleCodexUiApiRequestInput): Promise<CodexUiApiResult<unknown>> {
  try {
    if (input.pathname === '/api/session') {
      if (input.method.toUpperCase() !== 'GET') {
        return methodNotAllowed()
      }
      return ok({ token: input.uiToken ?? '' })
    }

    if (input.pathname === '/api/memory/harvest-project/dry-run') {
      if (input.method.toUpperCase() !== 'POST') {
        return methodNotAllowed()
      }
      const result = await runCodexProjectMemoryHarvest({
        cwd: input.cwd,
        config: createDefaultConfig(input.cwd),
        callModel: input.callModel ?? defaultCallModel,
        dryRun: true,
        now: input.now
      })
      return ok({ result })
    }

    if (input.pathname === '/api/memory/triage/dry-run' || input.pathname === '/api/memory/triage/apply') {
      if (input.method.toUpperCase() !== 'POST') {
        return methodNotAllowed()
      }
      return ok(await runUiMemoryTriage({
        cwd: input.cwd,
        dryRun: input.pathname.endsWith('/dry-run'),
        apply: input.pathname.endsWith('/apply'),
        now: input.now
      }))
    }

    const activeWriteRoute = parseActiveMemoryWriteRoute(input.pathname)
    if (activeWriteRoute !== undefined) {
      if (input.method.toUpperCase() !== 'POST') {
        return methodNotAllowed()
      }
      return handleActiveMemoryWriteRoute(input, activeWriteRoute)
    }

    const writeRoute = parseMemoryWriteRoute(input.pathname)
    if (writeRoute !== undefined) {
      if (input.method.toUpperCase() !== 'POST') {
        return methodNotAllowed()
      }
      const selection = parseSelectionRequest(input.searchParams)
      if ('error' in selection) return selection.error
      return handleMemoryWriteRoute(input, writeRoute, selection.value)
    }

    const projectDeleteRoute = parseProjectDeleteRoute(input.pathname)
    if (projectDeleteRoute !== undefined) {
      if (input.method.toUpperCase() !== 'POST') {
        return methodNotAllowed()
      }
      return handleProjectDeleteRoute(input, projectDeleteRoute)
    }

    if (input.method.toUpperCase() !== 'GET') {
      return methodNotAllowed()
    }

    switch (input.pathname) {
      case '/api/projects':
        return ok(await readProjects(input.cwd))
      case '/api/status':
        return ok(await readCodexMemoryStatus({ cwd: input.cwd }))
      case '/api/dashboard': {
        const selection = parseSelectionRequest(input.searchParams)
        if ('error' in selection) return selection.error
        return ok(await readDashboard(input.cwd, input.now, selection.value))
      }
      case '/api/memory/pending': {
        const selection = parseSelectionRequest(input.searchParams)
        if ('error' in selection) return selection.error
        return ok(await readPending(input.cwd, selection.value))
      }
      case '/api/memory/active': {
        const selection = parseSelectionRequest(input.searchParams)
        if ('error' in selection) return selection.error
        return ok(await readActive(input.cwd, selection.value))
      }
      case '/api/review-summaries': {
        const selection = parseSelectionRequest(input.searchParams)
        if ('error' in selection) return selection.error
        return ok(await readReviewSummaries(input.cwd, selection.value))
      }
      case '/api/project-memory': {
        const selection = parseSelectionRequest(input.searchParams)
        if ('error' in selection) return selection.error
        return ok(await readProjectMemory(input.cwd, selection.value))
      }
      case '/api/dream': {
        const selection = parseSelectionRequest(input.searchParams)
        if ('error' in selection) return selection.error
        return ok(await readDream(input.cwd, selection.value))
      }
      case '/api/profile': {
        const selection = parseSelectionRequest(input.searchParams)
        if ('error' in selection) return selection.error
        return ok(await readProfile(input.cwd, selection.value))
      }
      default:
        return notFound()
    }
  } catch (error) {
    return failure(500, 'internal_error', errorMessage(error))
  }
}

function parseMemoryWriteRoute(pathname: string): MemoryWriteRoute | undefined {
  const match = /^\/api\/memory\/([^/]+)\/(approve|reject|defer|edit)$/.exec(pathname)
  if (match === null) return undefined
  return { id: decodeURIComponent(match[1]), action: match[2] as MemoryWriteAction }
}

function parseActiveMemoryWriteRoute(pathname: string): ActiveMemoryWriteRoute | undefined {
  const match = /^\/api\/active-memory\/([^/]+)\/(archive|tombstone|propose-edit|supersede)$/.exec(pathname)
  if (match === null) return undefined
  return { id: decodeURIComponent(match[1]), action: match[2] as ActiveMemoryWriteAction }
}

function parseProjectDeleteRoute(pathname: string): { projectId: string } | undefined {
  const match = /^\/api\/projects\/([^/]+)\/delete-memory$/.exec(pathname)
  if (match === null) return undefined
  const projectId = decodeURIComponent(match[1])
  return isValidProjectId(projectId) ? { projectId } : undefined
}

async function handleProjectDeleteRoute(
  input: HandleCodexUiApiRequestInput,
  route: { projectId: string }
): Promise<CodexUiApiResult<unknown>> {
  const body = input.body
  if (!isRecord(body) || typeof body.confirmProjectId !== 'string') {
    return failure(400, 'invalid_request', 'Project memory deletion requires confirmProjectId.')
  }
  if (body.confirmProjectId.trim() !== route.projectId) {
    return failure(400, 'invalid_request', 'Project memory deletion confirmation must match projectId.')
  }
  const result = await deleteCodexProjectMemory({
    projectId: route.projectId,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    now: input.now
  })
  return ok({
    receipt: {
      action: 'delete_project_memory',
      ...result,
      createdAt: result.disabledAt,
      summary: 'Project memory deleted and future project memory capture disabled.'
    }
  })
}

async function handleMemoryWriteRoute(
  input: HandleCodexUiApiRequestInput,
  route: MemoryWriteRoute,
  selection: CodexUiSelectionRequest
): Promise<CodexUiApiResult<unknown>> {
  const body = input.body
  if (!isRecord(body) || typeof body.reviewHash !== 'string' || body.reviewHash.trim() === '') {
    return failure(400, 'invalid_request', 'Write requests require reviewHash.')
  }

  const reviewHash = body.reviewHash.trim()
  const reason = typeof body.reason === 'string' && body.reason.trim() !== '' ? body.reason.trim() : undefined
  if (route.action === 'approve') {
    return writeResultToApi(
      await promoteCodexPendingMemory({ cwd: input.cwd, projectId: selection.projectId, id: route.id, reviewHash, now: input.now }),
      'approve',
      reviewHash,
      input.now
    )
  }

  if (route.action === 'reject') {
    return writeResultToApi(
      await rejectCodexPendingMemory({
        cwd: input.cwd,
        projectId: selection.projectId,
        id: route.id,
        reviewHash,
        reason,
        now: input.now
      }),
      'reject',
      reviewHash,
      input.now
    )
  }

  if (route.action === 'defer') {
    const days = optionalPositiveInteger(body.days, 7)
    if (days === undefined) {
      return failure(400, 'invalid_request', 'Defer days must be a positive integer.')
    }
    return writeResultToApi(
      await deferCodexPendingMemory({
        cwd: input.cwd,
        projectId: selection.projectId,
        id: route.id,
        reviewHash,
        reason,
        days,
        now: input.now
      }),
      'defer',
      reviewHash,
      input.now
    )
  }

  if (typeof body.changeNote !== 'string' || body.changeNote.trim() === '') {
    return failure(400, 'invalid_request', 'Edit requires a change note.')
  }
  if (!isRecord(body.patch)) {
    return failure(400, 'invalid_request', 'Edit requires a patch object.')
  }
  const patch = parseEditPatch(body.patch)
  if ('error' in patch) return patch.error

  return writeResultToApi(
    await editCodexPendingMemory({
      cwd: input.cwd,
      projectId: selection.projectId,
      id: route.id,
      reviewHash,
      reason: body.changeNote.trim(),
      now: input.now,
      ...patch.value
    }),
    'edit',
    reviewHash,
    input.now
  )
}

async function handleActiveMemoryWriteRoute(
  input: HandleCodexUiApiRequestInput,
  route: ActiveMemoryWriteRoute
): Promise<CodexUiApiResult<unknown>> {
  const body = input.body
  if (!isRecord(body) || typeof body.contentHash !== 'string' || body.contentHash.trim() === '') {
    return failure(400, 'invalid_request', 'Active memory write requests require contentHash.')
  }
  if (typeof body.reason !== 'string' || body.reason.trim() === '') {
    return failure(400, 'invalid_request', 'Active memory write requests require reason.')
  }

  const base = {
    cwd: input.cwd,
    id: route.id,
    contentHash: body.contentHash.trim(),
    reason: body.reason.trim(),
    now: input.now
  }
  const result = route.action === 'archive'
    ? await archiveCodexActiveMemory(base)
    : route.action === 'tombstone'
      ? await tombstoneCodexActiveMemory({
          ...base,
          days: optionalPositiveInteger(body.days, 180),
          indefinite: body.indefinite === true
        })
      : route.action === 'propose-edit'
        ? await proposeEditCodexActiveMemory({
            ...base,
            content: requiredBodyString(body.content, 'Active memory propose-edit requires content.')
          })
        : await supersedeCodexActiveMemory({
            ...base,
            candidateId: requiredBodyString(body.candidateId, 'Active memory supersede requires candidateId.'),
            reviewHash: requiredBodyString(body.reviewHash, 'Active memory supersede requires reviewHash.')
          })

  return activeResultToApi(result, route.action, route.id, input.now)
}

function activeResultToApi(
  lifecycleResult: Awaited<
    ReturnType<typeof archiveCodexActiveMemory> |
    ReturnType<typeof tombstoneCodexActiveMemory> |
    ReturnType<typeof proposeEditCodexActiveMemory> |
    ReturnType<typeof supersedeCodexActiveMemory>
  >,
  action: ActiveMemoryWriteAction,
  id: string,
  now?: string
): CodexUiApiResult<unknown> {
  const result = lifecycleResult.result
  if (result.action === 'not_found') {
    return failure(404, 'not_found', result.reason)
  }
  if (result.action === 'conflict') {
    return failure(409, 'active_memory_conflict', result.reason, { result })
  }
  if (result.action === 'rejected_by_validator') {
    return failure(400, 'rejected_by_validator', result.reason, { result })
  }
  return ok({
    receipt: {
      action: `${action.replace('-', '_')}_active_memory`,
      id,
      createdAt: now ?? new Date().toISOString(),
      summary: 'Active memory action applied.'
    },
    result
  })
}

function requiredBodyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(message)
  }
  return value.trim()
}

function parseEditPatch(value: Record<string, unknown>): { value: EditPatch } | { error: CodexUiApiResult<never> } {
  if (typeof value.content !== 'string' || value.content.trim() === '') {
    return { error: failure(400, 'invalid_request', 'Edit patch requires content.') }
  }

  const patch: EditPatch = { content: value.content.trim() }
  if (value.candidateKind !== undefined) {
    if (!isMemoryCandidateKind(value.candidateKind)) {
      return { error: failure(400, 'invalid_request', 'Edit patch candidateKind is invalid.') }
    }
    patch.candidateKind = value.candidateKind
  }
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || !value.tags.every((item) => typeof item === 'string')) {
      return { error: failure(400, 'invalid_request', 'Edit patch tags must be strings.') }
    }
    patch.tags = value.tags.map((item) => item.trim()).filter(Boolean)
  }
  if (value.scores !== undefined) {
    if (!isRecord(value.scores)) {
      return { error: failure(400, 'invalid_request', 'Edit patch scores must be an object.') }
    }
    const scores = parseScorePatch(value.scores)
    if ('error' in scores) return scores
    patch.scores = scores.value
  }
  return { value: patch }
}

function parseScorePatch(value: Record<string, unknown>): { value: Partial<MemoryScores> } | { error: CodexUiApiResult<never> } {
  const scoreFields = ['evidenceStrength', 'stability', 'usefulness', 'safety', 'sensitivity'] as const
  const allowed = new Set<string>(scoreFields)
  const scores: Partial<MemoryScores> = {}

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      return { error: failure(400, 'invalid_request', 'Edit patch scores contain an unsupported field.') }
    }
  }

  for (const key of scoreFields) {
    const score = value[key]
    if (score === undefined) continue
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
      return { error: failure(400, 'invalid_request', 'Edit patch scores must be numbers from 0 to 1.') }
    }
    scores[key] = score
  }

  return { value: scores }
}

function optionalPositiveInteger(value: unknown, fallback: number): number | undefined {
  if (value === undefined) return fallback
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function writeResultToApi(
  reviewResult: MemoryWriteReviewResult,
  action: MemoryWriteAction,
  reviewHash: string,
  now?: string
): CodexUiApiResult<unknown> {
  const result = reviewResult.result
  if (result.action === 'not_found') {
    return failure(404, 'not_found', result.reason)
  }
  if (result.action === 'conflict') {
    return failure(409, 'review_hash_mismatch', result.reason, { latest: result.latest })
  }
  if (result.action === 'normalized_key_conflict') {
    return failure(409, 'normalized_key_conflict', result.reason, { result })
  }
  if (result.action === 'rejected_by_validator') {
    return failure(400, 'rejected_by_validator', result.reason, { result })
  }

  const summary = summaryForWriteResult(action, result.action)
  const receipt = writeReceipt(action, result.candidateId, reviewHash, summary, now)
  if (result.action === 'promote') return ok({ receipt, memory: result.memory })
  if (result.action === 'reject_new') return ok({ receipt, tombstone: result.tombstone })
  if (result.action === 'reject') return ok({ receipt, tombstone: result.tombstone })
  if (result.action === 'defer') return ok({ receipt, candidate: result.candidate })
  return ok({ receipt, candidate: result.candidate })
}

function summaryForWriteResult(action: MemoryWriteAction, resultAction: string): string {
  if (resultAction === 'reject_new') return 'Pending memory rejected by conflict resolution.'
  if (action === 'approve') return 'Pending memory approved.'
  if (action === 'reject') return 'Pending memory rejected.'
  if (action === 'defer') return 'Pending memory deferred.'
  return 'Pending memory edited.'
}

function writeReceipt(
  action: MemoryWriteAction,
  id: string,
  reviewHash: string,
  summary: string,
  now?: string
): {
  action: MemoryWriteAction
  id: string
  reviewHash: string
  createdAt: string
  summary: string
} {
  return {
    action,
    id,
    reviewHash,
    createdAt: now ?? new Date().toISOString(),
    summary
  }
}

async function readProjects(cwd: string): Promise<CodexUiProjectsResult> {
  const currentProject = await identifyCodexProject(cwd)
  const [entries, globalCounts, indexedProjectNames] = await Promise.all([
    safeListCodexProjects(),
    readCountsFromRoot(codexGlobalMemoryRoot()),
    safeListIndexedProjectDisplayNames()
  ])
  const projects = new Map<string, CodexUiProjectOption>()

  for (const entry of entries) {
    projects.set(entry.projectId, projectOptionFromRegistryEntry(entry, currentProject, indexedProjectNames.get(entry.projectId)))
  }

  if (!projects.has(currentProject.projectId)) {
    const memoryRoot = codexProjectMemoryRoot(currentProject.projectId)
    projects.set(currentProject.projectId, {
      projectId: currentProject.projectId,
      displayName: currentProject.displayName,
      aliases: [],
      disabled: false,
      memoryRoot,
      counts: await readCountsFromRoot(memoryRoot),
      current: true
    })
  }

  return {
    currentProjectId: currentProject.projectId,
    currentProject,
    global: {
      label: 'Global',
      memoryRoot: codexGlobalMemoryRoot(),
      counts: globalCounts
    },
    projects: Array.from(projects.values()).sort(compareProjectOptions)
  }
}

async function readDashboard(cwd: string, now: string | undefined, request: CodexUiSelectionRequest) {
  const selection = await resolveSelection(cwd, request)
  const [status, pending, active, reviewSummaries, projectMemory, dream, profile, signals, projects] = await Promise.all([
    readCodexMemoryStatus({ cwd }),
    readPendingFromSelection(selection),
    readActiveFromSelection(selection),
    readReviewSummariesFromSelection(selection),
    readProjectMemoryFromSelection(selection),
    readDreamFromSelection(selection),
    readProfileFromSelection(selection),
    collectProjectMemorySignals({ cwd, now, mode: 'default' }),
    readProjects(cwd)
  ])
  return {
    selection: publicSelection(selection),
    projects,
    modelConfig: readModelConfigDiagnostic(cwd),
    diagnostics: readDashboardDiagnostics(status),
    status,
    pending,
    active,
    reviewSummaries,
    projectMemory,
    dream,
    profile,
    signals
  }
}

function readDashboardDiagnostics(status: Awaited<ReturnType<typeof readCodexMemoryStatus>>): {
  memoryIndex: typeof status.index
  retrievalPlan: Pick<ReturnType<typeof buildRetrievalPlan>, 'taskIntent' | 'memoryKinds' | 'requiredFacets' | 'optionalFacets'>
} {
  const retrievalPlan = buildRetrievalPlan({
    query: 'memory review web ui route button',
    task: 'coding'
  })
  return {
    memoryIndex: status.index,
    retrievalPlan: {
      taskIntent: retrievalPlan.taskIntent,
      memoryKinds: retrievalPlan.memoryKinds,
      requiredFacets: retrievalPlan.requiredFacets,
      optionalFacets: retrievalPlan.optionalFacets
    }
  }
}

async function runUiMemoryTriage(input: {
  cwd: string
  dryRun: boolean
  apply: boolean
  now?: string
}): Promise<{
  action: 'dry_run' | 'apply'
  project: CodexProjectIdentity
  memoryRoot: string
  decisions: TriageDecision[]
  clusters: ReturnType<typeof triagePendingMemories>['clusters']
  receipt?: TriageApplyReceipt
}> {
  const project = await identifyCodexProject(input.cwd)
  const memoryRoot = codexProjectMemoryRoot(project.projectId)
  const now = input.now ?? new Date().toISOString()

  if (!input.apply) {
    const [pending, active, tombstones] = await Promise.all([
      readPendingMemoriesFromRoot(memoryRoot),
      readActiveMemoriesFromRoot(memoryRoot),
      readTombstonesFromRoot(memoryRoot)
    ])
    const result = triagePendingMemories({ pending, active, tombstones, scope: 'project', now })
    return { action: 'dry_run', project, memoryRoot, ...result }
  }

  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedMemoryRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedMemoryRoot)
    const [pending, active, tombstones] = await Promise.all([
      readPendingMemoriesFromRoot(lockedMemoryRoot),
      readActiveMemoriesFromRoot(lockedMemoryRoot),
      readTombstonesFromRoot(lockedMemoryRoot)
    ])
    const result = triagePendingMemories({ pending, active, tombstones, scope: 'project', now })
    const { nextPending, receipt } = applySafeTriageDecisions(pending, result.decisions, now)
    await writePendingMemoriesFromRoot(lockedMemoryRoot, nextPending)
    await appendMemoryEventFromRoot(lockedMemoryRoot, {
      id: randomUUID(),
      action: 'audit',
      at: now,
      reason: 'Applied safe Web UI memory triage decisions',
      details: {
        reviewAction: 'triage_apply',
        applied: receipt.applied,
        skipped: receipt.skipped
      }
    })
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })
    return { action: 'apply', project, memoryRoot: lockedMemoryRoot, ...result, receipt }
  })
}

function applySafeTriageDecisions(
  pending: PendingMemory[],
  decisions: TriageDecision[],
  now: string
): { nextPending: PendingMemory[]; receipt: TriageApplyReceipt } {
  const byId = new Map(pending.map((candidate) => [candidate.id, candidate]))
  const removedIds = new Set<string>()
  const applied = zeroSafeTriageCounts()
  const skipped = zeroSkippedTriageCounts()

  for (const decision of decisions) {
    if (decision.action === 'auto_merge') {
      const winnerId = decision.candidateIds[0]
      const winner = winnerId === undefined ? undefined : byId.get(winnerId)
      if (winner === undefined || removedIds.has(winner.id)) continue
      let merged = winner
      let mergedCount = 0
      for (const candidateId of decision.candidateIds.slice(1)) {
        const candidate = byId.get(candidateId)
        if (candidate === undefined || removedIds.has(candidate.id)) continue
        merged = mergePendingMemory(merged, candidate)
        removedIds.add(candidate.id)
        mergedCount += 1
      }
      if (mergedCount > 0) {
        byId.set(winner.id, merged)
        applied.auto_merge += 1
      }
      continue
    }

    if (decision.action === 'auto_drop') {
      if (byId.has(decision.candidateId) && !removedIds.has(decision.candidateId)) {
        removedIds.add(decision.candidateId)
        applied.auto_drop += 1
      }
      continue
    }

    if (decision.action === 'auto_defer') {
      const candidate = byId.get(decision.candidateId)
      if (candidate !== undefined && !removedIds.has(candidate.id)) {
        byId.set(candidate.id, { ...candidate, promoteAfter: addDays(now, decision.days) })
        applied.auto_defer += 1
      }
      continue
    }

    skipped[decision.action] += 1
  }

  return {
    nextPending: pending
      .filter((candidate) => !removedIds.has(candidate.id))
      .map((candidate) => byId.get(candidate.id) ?? candidate),
    receipt: {
      action: 'triage_apply',
      createdAt: now,
      applied,
      skipped,
      summary: 'Applied safe triage decisions; manual approval remains unavailable for batch actions.'
    }
  }
}

function zeroSafeTriageCounts(): Record<SafeTriageAction, number> {
  return { auto_drop: 0, auto_defer: 0, auto_merge: 0 }
}

function zeroSkippedTriageCounts(): Record<SkippedTriageAction, number> {
  return { auto_promote: 0, manual_review: 0, recommend: 0 }
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(isoDate)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

async function readActive(cwd: string, request: CodexUiSelectionRequest): Promise<ActiveMemoryResult> {
  return readActiveFromSelection(await resolveSelection(cwd, request))
}

async function readPending(cwd: string, request: CodexUiSelectionRequest): Promise<{
  project: CodexUiProjectIdentity
  selection: ReturnType<typeof publicSelection>
  pending: CodexPendingMemorySummary[]
  total: number
  memoryRoot: string
  memoryRoots: string[]
}> {
  return readPendingFromSelection(await resolveSelection(cwd, request))
}

async function readProjectMemory(
  cwd: string,
  request: CodexUiSelectionRequest
): Promise<ActiveMemoryResult & { groups: ProjectMemoryGroup[]; selection: ReturnType<typeof publicSelection> }> {
  return readProjectMemoryFromSelection(await resolveSelection(cwd, request))
}

async function readProjectMemoryFromSelection(
  selection: CodexUiResolvedSelection
): Promise<ActiveMemoryResult & { groups: ProjectMemoryGroup[]; selection: ReturnType<typeof publicSelection> }> {
  const active = await readActiveFromSelection(selection)
  return {
    ...active,
    selection: publicSelection(selection),
    groups: groupMemoriesForSelection(active.active, selection.scope)
  }
}

async function readReviewSummaries(cwd: string, request: CodexUiSelectionRequest): Promise<{
  project: CodexUiProjectIdentity
  selection: ReturnType<typeof publicSelection>
  memoryRoot: string
  memoryRoots: string[]
  summaries: CodexReviewSummaryRecord[]
}> {
  return readReviewSummariesFromSelection(await resolveSelection(cwd, request))
}

async function readReviewSummariesFromSelection(selection: CodexUiResolvedSelection): Promise<{
  project: CodexUiProjectIdentity
  selection: ReturnType<typeof publicSelection>
  memoryRoot: string
  memoryRoots: string[]
  summaries: CodexReviewSummaryRecord[]
}> {
  const summaries = (await Promise.all(selection.memoryRoots.map((root) => readReviewSummaryRecordsForUi(root)))).flat()
  return {
    project: selection.project,
    selection: publicSelection(selection),
    memoryRoot: selection.memoryRoot,
    memoryRoots: selection.memoryRoots,
    summaries: summaries.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }
}

async function readProfile(cwd: string, request: CodexUiSelectionRequest): Promise<{
  project: CodexUiProjectIdentity
  selection: ReturnType<typeof publicSelection>
  memoryRoot: string
  profile: string
}> {
  return readProfileFromSelection(await resolveSelection(cwd, request))
}

async function readProfileFromSelection(selection: CodexUiResolvedSelection): Promise<{
  project: CodexUiProjectIdentity
  selection: ReturnType<typeof publicSelection>
  memoryRoot: string
  profile: string
}> {
  const profile = await readModelProfileFromRootIfExists(selection.memoryRoot)
  return { project: selection.project, selection: publicSelection(selection), memoryRoot: selection.memoryRoot, profile: profile ?? '' }
}

async function readDream(cwd: string, request: CodexUiSelectionRequest): Promise<{
  project: CodexUiProjectIdentity
  selection: ReturnType<typeof publicSelection>
  memoryRoot: string
  dream: Awaited<ReturnType<typeof readCodexMemoryDreamState>>
}> {
  return readDreamFromSelection(await resolveSelection(cwd, request))
}

async function readDreamFromSelection(selection: CodexUiResolvedSelection): Promise<{
  project: CodexUiProjectIdentity
  selection: ReturnType<typeof publicSelection>
  memoryRoot: string
  dream: Awaited<ReturnType<typeof readCodexMemoryDreamState>>
}> {
  const memoryRoot = selection.memoryRoot
  const dream = await readCodexMemoryDreamState(memoryRoot)
  return { project: selection.project, selection: publicSelection(selection), memoryRoot, dream }
}

async function readActiveFromSelection(selection: CodexUiResolvedSelection): Promise<ActiveMemoryResult> {
  const active = (await Promise.all(selection.memoryRoots.map((root) => readActiveMemoriesFromRoot(root)))).flat()
  return {
    project: selection.project,
    active: sortMemoriesNewestFirst(active).map((memory) => ({
      ...memory,
      contentHash: contentHashForActiveMemory(memory)
    })),
    memoryRoot: selection.memoryRoot
  }
}

async function readPendingFromSelection(selection: CodexUiResolvedSelection): Promise<{
  project: CodexUiProjectIdentity
  selection: ReturnType<typeof publicSelection>
  pending: CodexPendingMemorySummary[]
  total: number
  memoryRoot: string
  memoryRoots: string[]
}> {
  const pending = (await Promise.all(selection.memoryRoots.map((root) => readPendingMemoriesFromRoot(root)))).flat()
  const summaries = sortPendingNewestFirst(pending.map((candidate) => summarizePendingMemory(candidate)))
  return {
    project: selection.project,
    selection: publicSelection(selection),
    pending: summaries,
    total: summaries.length,
    memoryRoot: selection.memoryRoot,
    memoryRoots: selection.memoryRoots
  }
}

async function resolveSelection(cwd: string, request: CodexUiSelectionRequest): Promise<CodexUiResolvedSelection> {
  const projects = await readProjects(cwd)
  const projectId = request.projectId ?? projects.currentProjectId
  const projectOption = projects.projects.find((project) => project.projectId === projectId)
  const project = projectOption === undefined
    ? { projectId, displayName: unlabeledProjectName(projectId) }
    : { projectId, displayName: projectOption.displayName }
  const globalMemoryRoot = (await getReadableCodexGlobalMemoryRoot()) ?? codexGlobalMemoryRoot()
  const projectMemoryRoot = (await getReadableCodexProjectMemoryRoot(projectId)) ?? codexProjectMemoryRoot(projectId)
  const memoryRoots = request.scope === 'global'
    ? [globalMemoryRoot]
    : request.scope === 'all'
      ? uniqueInOrder([globalMemoryRoot, projectMemoryRoot])
      : [projectMemoryRoot]
  const memoryRoot = request.scope === 'global' ? globalMemoryRoot : projectMemoryRoot
  return {
    scope: request.scope,
    projectId,
    label: selectionLabel(request.scope, project.displayName),
    project,
    memoryRoot,
    memoryRoots,
    globalMemoryRoot,
    projectMemoryRoot
  }
}

function parseSelectionRequest(params?: URLSearchParams): { value: CodexUiSelectionRequest } | { error: CodexUiApiResult<never> } {
  const scopeValue = params?.get('scope')?.trim() || 'project'
  if (!isCodexUiMemoryScope(scopeValue)) {
    return { error: failure(400, 'invalid_request', 'scope must be project, global, or all.') }
  }
  const projectId = params?.get('projectId')?.trim() || undefined
  if (projectId !== undefined && !isValidProjectId(projectId)) {
    return { error: failure(400, 'invalid_request', 'projectId is invalid.') }
  }
  return {
    value: {
      scope: scopeValue,
      ...(projectId === undefined ? {} : { projectId })
    }
  }
}

function publicSelection(selection: CodexUiResolvedSelection): {
  scope: CodexUiMemoryScope
  projectId: string
  label: string
  memoryRoot: string
  memoryRoots: string[]
  globalMemoryRoot: string
  projectMemoryRoot: string
} {
  return {
    scope: selection.scope,
    projectId: selection.projectId,
    label: selection.label,
    memoryRoot: selection.memoryRoot,
    memoryRoots: selection.memoryRoots,
    globalMemoryRoot: selection.globalMemoryRoot,
    projectMemoryRoot: selection.projectMemoryRoot
  }
}

function readModelConfigDiagnostic(cwd: string): {
  configured: boolean
  missing: string[]
  baseUrlConfigured: boolean
  modelConfigured: boolean
  apiKeyConfigured: boolean
  apiKeyRequired: boolean
  baseUrl: string
  model: string
  strongModel: string
  cheapModel: string
  apiKeyEnv: 'CYRENE_API_KEY'
  apiKeyPreview: 'set' | 'not set'
  help: string
} {
  const config = createDefaultConfig(cwd)
  const routeModel = config.model.cheapModel || config.model.strongModel || config.model.model
  const apiKeyRequired = modelBaseUrlRequiresApiKey(config.model.baseUrl)
  const apiKeyConfigured = Boolean(config.model.apiKey?.trim())
  const missing: string[] = []
  if (config.model.baseUrl.trim() === '') missing.push('CYRENE_BASE_URL')
  if (config.model.model.trim() === '' || routeModel.trim() === '') missing.push('CYRENE_MODEL')
  if (apiKeyRequired && !apiKeyConfigured) missing.push('CYRENE_API_KEY')
  return {
    configured: missing.length === 0,
    missing,
    baseUrlConfigured: config.model.baseUrl.trim() !== '',
    modelConfigured: config.model.model.trim() !== '' && routeModel.trim() !== '',
    apiKeyConfigured,
    apiKeyRequired,
    baseUrl: config.model.baseUrl,
    model: config.model.model,
    strongModel: config.model.strongModel,
    cheapModel: config.model.cheapModel,
    apiKeyEnv: 'CYRENE_API_KEY',
    apiKeyPreview: config.model.apiKey?.trim() ? 'set' : 'not set',
    help: 'Set CYRENE_BASE_URL, CYRENE_MODEL, and CYRENE_API_KEY when your OpenAI-compatible provider requires bearer auth.'
  }
}

async function safeListCodexProjects(): Promise<CodexProjectRegistryEntry[]> {
  try {
    return await listCodexProjects()
  } catch {
    return []
  }
}

async function safeListIndexedProjectDisplayNames(): Promise<Map<string, string>> {
  const adapter = await openMemoryIndexAdapter({ dbPath: codexMemoryDbPath() })
  try {
    const metadata = await adapter.listProjectMetadata()
    return new Map(metadata.flatMap((project) => {
      const displayName = project.displayName.trim()
      if (displayName === '' || displayName === project.projectId) return []
      return [[project.projectId, displayName]]
    }))
  } catch {
    return new Map()
  } finally {
    adapter.close()
  }
}

function projectOptionFromRegistryEntry(
  entry: CodexProjectRegistryEntry,
  currentProject: CodexProjectIdentity,
  indexedDisplayName?: string
): CodexUiProjectOption {
  return {
    projectId: entry.projectId,
    displayName: projectDisplayName(entry, currentProject, indexedDisplayName),
    aliases: entry.aliases,
    ...(entry.mergedInto === undefined ? {} : { mergedInto: entry.mergedInto }),
    disabled: entry.disabled,
    ...(entry.disabledAt === undefined ? {} : { disabledAt: entry.disabledAt }),
    ...(entry.disabledReason === undefined ? {} : { disabledReason: entry.disabledReason }),
    memoryRoot: entry.memoryRoot,
    counts: entry.counts,
    current: entry.projectId === currentProject.projectId
  }
}

function projectDisplayName(
  entry: CodexProjectRegistryEntry,
  currentProject: CodexProjectIdentity,
  indexedDisplayName?: string
): string {
  if (entry.aliases[0] !== undefined) return entry.aliases[0]
  if (entry.projectId === currentProject.projectId) return currentProject.displayName
  if (indexedDisplayName !== undefined && indexedDisplayName.trim() !== '') return indexedDisplayName
  if (entry.displayName.trim() !== '' && entry.displayName !== entry.projectId) return entry.displayName
  return unlabeledProjectName(entry.projectId)
}

function unlabeledProjectName(projectId: string): string {
  return `Unlabeled project (${shortProjectId(projectId)})`
}

function shortProjectId(projectId: string): string {
  return projectId.slice(0, 8)
}

async function readCountsFromRoot(memoryRoot: string): Promise<CodexUiRootCounts> {
  const [active, pending, tombstones] = await Promise.all([
    readActiveMemoriesFromRoot(memoryRoot),
    readPendingMemoriesFromRoot(memoryRoot),
    readTombstonesFromRoot(memoryRoot)
  ])
  return { active: active.length, pending: pending.length, tombstones: tombstones.length }
}

function selectionLabel(scope: CodexUiMemoryScope, projectName: string): string {
  if (scope === 'global') return 'Global'
  if (scope === 'all') return `${projectName} + Global`
  return projectName
}

function compareProjectOptions(left: CodexUiProjectOption, right: CodexUiProjectOption): number {
  if (left.current !== right.current) return left.current ? -1 : 1
  return left.displayName.localeCompare(right.displayName) || left.projectId.localeCompare(right.projectId)
}

function sortPendingNewestFirst(pending: CodexPendingMemorySummary[]): CodexPendingMemorySummary[] {
  return [...pending].sort((left, right) => {
    const lastSeen = right.lastSeenAt.localeCompare(left.lastSeenAt)
    return lastSeen === 0 ? left.id.localeCompare(right.id) : lastSeen
  })
}

function sortMemoriesNewestFirst(memories: CyreneMemory[]): CyreneMemory[] {
  return [...memories].sort((left, right) => {
    const updated = right.updatedAt.localeCompare(left.updatedAt)
    return updated === 0 ? left.id.localeCompare(right.id) : updated
  })
}

function isCodexUiMemoryScope(value: string): value is CodexUiMemoryScope {
  return value === 'project' || value === 'global' || value === 'all'
}

function isValidProjectId(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value) && !/^\.+$/.test(value)
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}

async function readReviewSummaryRecordsForUi(memoryRoot: string): Promise<CodexReviewSummaryRecord[]> {
  const targetPath = join(memoryRoot, REVIEW_SUMMARIES_FILE)
  let content: string
  try {
    await assertSafeMemoryDataFileTarget(targetPath)
    content = await readFile(targetPath, 'utf8')
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return []
    }
    throw error
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown
        return isReviewSummaryRecord(parsed) ? [parsed] : []
      } catch {
        return []
      }
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function groupProjectMemories(memories: CyreneMemory[]): ProjectMemoryGroup[] {
  const groups = new Map<ProjectMemoryLabel, CyreneMemory[]>()
  for (const label of PROJECT_MEMORY_LABELS) {
    groups.set(label, [])
  }

  for (const memory of memories) {
    groups.get(labelForProjectMemory(memory))?.push(memory)
  }

  return PROJECT_MEMORY_LABELS.map((label) => ({ label, memories: groups.get(label) ?? [] }))
}

function groupGlobalMemories(memories: CyreneMemory[]): ProjectMemoryGroup[] {
  const groups = new Map<GlobalMemoryLabel, CyreneMemory[]>()
  for (const label of GLOBAL_MEMORY_LABELS) {
    groups.set(label, [])
  }

  for (const memory of memories) {
    groups.get(labelForGlobalMemory(memory))?.push(memory)
  }

  return GLOBAL_MEMORY_LABELS.map((label) => ({ label, memories: groups.get(label) ?? [] }))
}

function groupMemoriesForSelection(memories: CyreneMemory[], scope: CodexUiMemoryScope): ProjectMemoryGroup[] {
  return scope === 'global' ? groupGlobalMemories(memories) : groupProjectMemories(memories)
}

function labelForProjectMemory(memory: CyreneMemory): ProjectMemoryLabel {
  const classifications = memoryClassifications(memory)
  if (classifications.includes('project_decision')) return 'Project Decisions'
  if (classifications.includes('workflow_rule') || classifications.includes('procedural_rule')) return 'Workflow Rules'
  if (classifications.includes('known_pitfall')) return 'Known Pitfalls'
  if (classifications.includes('rejected_approach')) return 'Rejected Approaches'
  if (classifications.includes('open_question')) return 'Open Questions'
  if (classifications.includes('project_fact')) return 'Project Facts'
  if (hasTag(memory, 'project_decision')) return 'Project Decisions'
  if (hasTag(memory, 'workflow_rule')) return 'Workflow Rules'
  if (hasTag(memory, 'known_pitfall')) return 'Known Pitfalls'
  if (hasTag(memory, 'rejected_approach')) return 'Rejected Approaches'
  if (hasTag(memory, 'open_question')) return 'Open Questions'
  if (hasTag(memory, 'project_fact')) return 'Project Facts'
  return 'Other Project Memory'
}

function labelForGlobalMemory(memory: CyreneMemory): GlobalMemoryLabel {
  const classifications = memoryClassifications(memory)
  if (classifications.includes('user_preference')) return 'User Preferences'
  if (classifications.includes('interaction_style')) return 'Interaction Style'
  if (classifications.includes('relationship_boundary')) return 'Relationship Boundaries'
  if (classifications.includes('affective_pattern')) return 'Affective Patterns'
  if (classifications.includes('workflow_rule') || classifications.includes('procedural_rule')) return 'Workflow Rules'
  if (classifications.includes('system_policy')) return 'System Policies'
  if (classifications.includes('reference')) return 'References'
  if (classifications.includes('episode')) return 'Episodes'
  if (classifications.includes('project_fact')) return 'Project Facts'
  if (hasTag(memory, 'user_preference')) return 'User Preferences'
  if (hasTag(memory, 'interaction_style')) return 'Interaction Style'
  if (hasTag(memory, 'relationship_boundary')) return 'Relationship Boundaries'
  if (hasTag(memory, 'affective_pattern')) return 'Affective Patterns'
  if (hasTag(memory, 'workflow_rule')) return 'Workflow Rules'
  if (hasTag(memory, 'system_policy')) return 'System Policies'
  if (hasTag(memory, 'reference')) return 'References'
  if (hasTag(memory, 'episode')) return 'Episodes'
  if (hasTag(memory, 'project_fact')) return 'Project Facts'
  return 'Other Global Memory'
}

function memoryClassifications(memory: CyreneMemory): string[] {
  const classifications: unknown[] = [memory.candidateKind, memory.candidate_kind, memory.type]
  return classifications
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
}

function hasTag(memory: CyreneMemory, expected: MemoryCandidateKind | string): boolean {
  return memory.tags.includes(expected)
}

function isReviewSummaryRecord(value: unknown): value is CodexReviewSummaryRecord {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.runId === 'string' &&
    optionalString(value.sessionId) &&
    optionalString(value.turnId) &&
    typeof value.createdAt === 'string' &&
    (value.status === 'ok' || value.status === 'failed') &&
    typeof value.summary === 'string' &&
    isRedaction(value.redaction) &&
    Array.isArray(value.candidateIds) &&
    value.candidateIds.every((item) => typeof item === 'string') &&
    optionalString(value.failureReason)
  )
}

function isRedaction(value: unknown): value is CodexReviewSummaryRecord['redaction'] {
  return (
    isRecord(value) &&
    isRecord(value.input) &&
    isRecord(value.output) &&
    Object.values(value.input).every((item) => typeof item === 'number') &&
    Object.values(value.output).every((item) => typeof item === 'number')
  )
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ok<T>(data: T): CodexUiApiResult<T> {
  return { status: 200, body: { ok: true, data } }
}

function failure(status: number, code: string, message: string, details?: unknown): CodexUiApiResult<never> {
  return {
    status,
    body: {
      ok: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details })
      }
    }
  }
}

function notFound(): CodexUiApiResult<never> {
  return failure(404, 'not_found', 'API route not found.')
}

function methodNotAllowed(): CodexUiApiResult<never> {
  return failure(405, 'method_not_allowed', 'Method not allowed.')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
