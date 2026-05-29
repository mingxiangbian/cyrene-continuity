import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDefaultConfig } from '../config.js'
import { callModel as defaultCallModel, type CallModelInput, type ModelResponse } from '../llm-client.js'
import { assertSafeMemoryDataFileTarget, readActiveMemoriesFromRoot } from '../memory/memory-store.js'
import { readModelProfileFromRootIfExists } from '../memory/model-profile.js'
import type { CyreneMemory, MemoryCandidateKind } from '../memory/types.js'
import { readCodexMemoryStatus } from './codex-memory-status.js'
import { codexProjectMemoryRoot } from './codex-memory-root.js'
import { listCodexPendingMemories } from './memory-review.js'
import { readCodexMemoryDreamState } from './memory-dream-state.js'
import { identifyCodexProject, type CodexProjectIdentity } from './project-id.js'
import { runCodexProjectMemoryHarvest } from './project-memory-harvester.js'
import type { CodexReviewSummaryRecord } from './review-summary-store.js'

export type CodexUiApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export interface CodexUiApiResult<T> {
  status: number
  body: CodexUiApiResponse<T>
}

export interface HandleCodexUiApiRequestInput {
  cwd: string
  method: string
  pathname: string
  body?: unknown
  now?: string
  callModel?: (input: CallModelInput) => Promise<ModelResponse>
}

interface ActiveMemoryResult {
  project: CodexProjectIdentity
  active: CyreneMemory[]
  memoryRoot: string
}

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

type ProjectMemoryLabel = typeof PROJECT_MEMORY_LABELS[number]

export async function handleCodexUiApiRequest(input: HandleCodexUiApiRequestInput): Promise<CodexUiApiResult<unknown>> {
  try {
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

    if (input.method.toUpperCase() !== 'GET') {
      return methodNotAllowed()
    }

    switch (input.pathname) {
      case '/api/status':
        return ok(await readCodexMemoryStatus({ cwd: input.cwd }))
      case '/api/dashboard':
        return ok(await readDashboard(input.cwd))
      case '/api/memory/pending':
        return ok(await listCodexPendingMemories({ cwd: input.cwd }))
      case '/api/memory/active':
        return ok(await readActive(input.cwd))
      case '/api/review-summaries':
        return ok(await readReviewSummaries(input.cwd))
      case '/api/project-memory':
        return ok(await readProjectMemory(input.cwd))
      case '/api/dream':
        return ok(await readDream(input.cwd))
      case '/api/profile':
        return ok(await readProfile(input.cwd))
      default:
        return notFound()
    }
  } catch (error) {
    return failure(500, 'internal_error', errorMessage(error))
  }
}

async function readActive(cwd: string): Promise<ActiveMemoryResult> {
  const project = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(project.projectId)
  const active = await readActiveMemoriesFromRoot(memoryRoot)
  return { project, active, memoryRoot }
}

async function readDashboard(cwd: string) {
  const [status, pending, active, reviewSummaries, projectMemory, dream, profile] = await Promise.all([
    readCodexMemoryStatus({ cwd }),
    listCodexPendingMemories({ cwd }),
    readActive(cwd),
    readReviewSummaries(cwd),
    readProjectMemory(cwd),
    readDream(cwd),
    readProfile(cwd)
  ])
  return {
    status,
    pending,
    active,
    reviewSummaries,
    projectMemory,
    dream,
    profile
  }
}

async function readProjectMemory(cwd: string): Promise<ActiveMemoryResult & { groups: ProjectMemoryGroup[] }> {
  const active = await readActive(cwd)
  return {
    ...active,
    groups: groupProjectMemories(active.active)
  }
}

async function readReviewSummaries(cwd: string): Promise<{
  project: CodexProjectIdentity
  memoryRoot: string
  reviewSummaries: CodexReviewSummaryRecord[]
}> {
  const project = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(project.projectId)
  const reviewSummaries = await readReviewSummaryRecordsForUi(memoryRoot)
  return { project, memoryRoot, reviewSummaries }
}

async function readProfile(cwd: string): Promise<{
  project: CodexProjectIdentity
  memoryRoot: string
  profile: string | null
}> {
  const project = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(project.projectId)
  const profile = await readModelProfileFromRootIfExists(memoryRoot)
  return { project, memoryRoot, profile: profile ?? null }
}

async function readDream(cwd: string): Promise<{
  project: CodexProjectIdentity
  memoryRoot: string
  dream: Awaited<ReturnType<typeof readCodexMemoryDreamState>>
}> {
  const project = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(project.projectId)
  const dream = await readCodexMemoryDreamState(memoryRoot)
  return { project, memoryRoot, dream }
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

  return PROJECT_MEMORY_LABELS
    .map((label) => ({ label, memories: groups.get(label) ?? [] }))
    .filter((group) => group.memories.length > 0)
}

function labelForProjectMemory(memory: CyreneMemory): ProjectMemoryLabel {
  const candidateKind = memory.candidateKind ?? memory.candidate_kind
  if (hasKindOrTag(memory, candidateKind, 'project_decision')) return 'Project Decisions'
  if (hasKindOrTag(memory, candidateKind, 'workflow_rule')) return 'Workflow Rules'
  if (hasKindOrTag(memory, candidateKind, 'known_pitfall')) return 'Known Pitfalls'
  if (hasKindOrTag(memory, candidateKind, 'rejected_approach')) return 'Rejected Approaches'
  if (hasKindOrTag(memory, candidateKind, 'open_question')) return 'Open Questions'
  if (hasKindOrTag(memory, candidateKind, 'project_fact') || memory.type === 'project_fact') return 'Project Facts'
  return 'Other Project Memory'
}

function hasKindOrTag(memory: CyreneMemory, candidateKind: MemoryCandidateKind | undefined, expected: MemoryCandidateKind): boolean {
  return candidateKind === expected || memory.tags.includes(expected)
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

function failure(status: number, code: string, message: string): CodexUiApiResult<never> {
  return { status, body: { ok: false, error: { code, message } } }
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
