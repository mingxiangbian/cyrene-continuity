import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readModelProfileFromRootIfExists } from '../memory/model-profile.js'
import {
  assertSafeMemoryDataFileTarget,
  readActiveMemoriesFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot
} from '../memory/memory-store.js'
import type { CyreneMemory, MemoryTombstone, PendingMemory } from '../memory/types.js'
import { readCodexMemoryStatus } from './codex-memory-status.js'
import { readCodexMemoryDreamState, type CodexMemoryDreamState } from './memory-dream-state.js'
import { summarizePendingMemory, type CodexPendingMemorySummary } from './memory-review.js'
import type { CodexReviewSummaryRecord } from './review-summary-store.js'

const REVIEW_SUMMARIES_FILE = 'review-summaries.jsonl'
const STOP_HOOK_STALE_MS = 24 * 60 * 60 * 1000

interface DashboardWarning {
  label: string
  reason: string
}

export async function formatCodexMemoryDashboard(input: {
  cwd: string
  configPath?: string
  now?: string
}): Promise<string> {
  const now = input.now ?? new Date().toISOString()
  const status = await readCodexMemoryStatus({ cwd: input.cwd })
  const globalRoot = status.roots.global.path
  const projectRoot = status.roots.project.path
  const [projectActive, pending, tombstones, reviewSummaries, dreamState, projectProfile, configText] =
    await Promise.all([
      readActiveMemoriesFromRoot(projectRoot),
      readDashboardPendingMemories([globalRoot, projectRoot]),
      readTombstonesFromRoot(projectRoot),
      readReviewSummaries(projectRoot),
      readDashboardDreamState(projectRoot),
      readModelProfileFromRootIfExists(projectRoot),
      readOptional(input.configPath ?? join(homedir(), '.codex', 'config.toml'))
    ])
  const pendingSummaries = pending.map((candidate) => summarizePendingMemory(candidate, now))
  const warnings = buildDashboardWarnings({
    status,
    configText,
    projectProfilePresent: projectProfile !== undefined,
    now
  })

  return [
    'Cyrene Memory Dashboard',
    '',
    'project:',
    `  projectId: ${status.project.projectId}`,
    `  displayName: ${status.project.displayName}`,
    '',
    'counts:',
    `  active memories: ${status.roots.global.counts.active + status.roots.project.counts.active}`,
    `  pending memories: ${status.roots.global.counts.pending + status.roots.project.counts.pending}`,
    `  rejected/tombstoned: ${status.roots.global.counts.tombstones + status.roots.project.counts.tombstones}`,
    `  profile candidates: ${status.roots.global.counts.profileCandidates + status.roots.project.counts.profileCandidates}`,
    '',
    ...formatTopActiveMemories(projectActive),
    '',
    ...formatPendingReview(pendingSummaries),
    '',
    ...formatReviewSummaries(reviewSummaries),
    '',
    'dream:',
    `  last dream: ${dreamState.lastDreamAt ?? 'never'}`,
    `  next dream due: ${dreamState.nextDreamDueAt ?? 'unknown'}`,
    `  dream due: ${dreamState.dreamDue ? 'yes' : 'no'}`,
    dreamState.lastDreamStatus === undefined ? undefined : `  last dream status: ${dreamState.lastDreamStatus}`,
    dreamState.lastDreamError === undefined ? undefined : `  last dream error: ${dreamState.lastDreamError}`,
    '',
    ...formatTombstones(tombstones),
    '',
    ...formatWarnings(warnings)
  ].filter((line): line is string => line !== undefined).join('\n') + '\n'
}

async function readDashboardPendingMemories(roots: string[]): Promise<PendingMemory[]> {
  return (await Promise.all(uniqueStrings(roots).map((root) => readPendingMemoriesFromRoot(root)))).flat()
}

async function readReviewSummaries(root: string): Promise<CodexReviewSummaryRecord[]> {
  let content: string
  try {
    content = await readOptionalMemoryDataFile(join(root, REVIEW_SUMMARIES_FILE))
  } catch {
    return []
  }
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as Partial<CodexReviewSummaryRecord>
        if (
          typeof parsed.createdAt !== 'string' ||
          typeof parsed.summary !== 'string' ||
          (parsed.status !== 'ok' && parsed.status !== 'failed')
        ) {
          return []
        }
        return [{
          id: typeof parsed.id === 'string' ? parsed.id : parsed.createdAt,
          runId: typeof parsed.runId === 'string' ? parsed.runId : '',
          createdAt: parsed.createdAt,
          status: parsed.status,
          summary: parsed.summary,
          redaction: isReviewSummaryRedaction(parsed.redaction) ? parsed.redaction : { input: {}, output: {} },
          candidateIds: Array.isArray(parsed.candidateIds)
            ? parsed.candidateIds.filter((item): item is string => typeof item === 'string')
            : [],
          failureReason: typeof parsed.failureReason === 'string' ? parsed.failureReason : undefined
        }]
      } catch {
        return []
      }
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function isReviewSummaryRedaction(value: unknown): value is CodexReviewSummaryRecord['redaction'] {
  return (
    typeof value === 'object' &&
    value !== null &&
    'input' in value &&
    'output' in value &&
    typeof value.input === 'object' &&
    value.input !== null &&
    typeof value.output === 'object' &&
    value.output !== null
  )
}

async function readDashboardDreamState(root: string): Promise<CodexMemoryDreamState> {
  try {
    return await readCodexMemoryDreamState(root)
  } catch (error) {
    return { dreamDue: false, lastDreamStatus: 'failed', lastDreamError: errorMessage(error) }
  }
}

function formatTopActiveMemories(memories: CyreneMemory[]): string[] {
  const lines = ['top active project memories:']
  const top = [...memories].sort(compareActiveMemory).slice(0, 5)
  if (top.length === 0) {
    lines.push('- none')
    return lines
  }
  for (const memory of top) {
    lines.push(`- ${memory.id} [${memory.domain}/${memory.type}] usefulness=${formatScore(memory.scores.usefulness)} ${truncate(memory.content)}`)
  }
  return lines
}

function formatPendingReview(pending: CodexPendingMemorySummary[]): string[] {
  const lines = ['pending review:']
  const top = [...pending].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt)).slice(0, 5)
  if (top.length === 0) {
    lines.push('- none')
    return lines
  }
  for (const item of top) {
    lines.push(`- ${item.id} recommendation=${item.recommendation} risk=${item.risk} reviewHash=${item.reviewHash}`)
    lines.push(`  ${truncate(item.content)}`)
  }
  return lines
}

function formatReviewSummaries(summaries: CodexReviewSummaryRecord[]): string[] {
  const lines = ['review summaries:']
  const top = summaries.slice(0, 3)
  if (top.length === 0) {
    lines.push('- none')
    return lines
  }
  for (const summary of top) {
    lines.push(`- ${summary.createdAt} (${summary.status}) candidates=${summary.candidateIds.join(', ') || 'none'}`)
    lines.push(`  ${truncate(summary.summary)}`)
  }
  return lines
}

function formatTombstones(tombstones: MemoryTombstone[]): string[] {
  const lines = ['rejected/tombstoned summaries:']
  const top = [...tombstones].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 5)
  if (top.length === 0) {
    lines.push('- none')
    return lines
  }
  for (const tombstone of top) {
    lines.push(`- ${tombstone.id} reason=${tombstone.reason} normalizedKey=${tombstone.normalizedKey}`)
  }
  return lines
}

function formatWarnings(warnings: DashboardWarning[]): string[] {
  const lines = ['warnings:']
  if (warnings.length === 0) {
    lines.push('- none')
    return lines
  }
  for (const warning of warnings) {
    lines.push(`- ${warning.label}: ${warning.reason}`)
  }
  return lines
}

function buildDashboardWarnings(input: {
  status: Awaited<ReturnType<typeof readCodexMemoryStatus>>
  configText: string
  projectProfilePresent: boolean
  now: string
}): DashboardWarning[] {
  const warnings: DashboardWarning[] = []
  const lastRunAt = input.status.stopHook.lastRunAt
  if (lastRunAt === undefined || isOlderThan(lastRunAt, input.now, STOP_HOOK_STALE_MS)) {
    warnings.push({
      label: 'Stop Hook stale',
      reason: lastRunAt === undefined ? 'no review summary run found' : `last run at ${lastRunAt}`
    })
  }
  if (!input.projectProfilePresent) {
    warnings.push({ label: 'profile missing', reason: 'project MODEL_PROFILE.md is missing' })
  }
  if (input.status.index.freshness === 'stale' || input.status.index.freshness === 'unavailable') {
    warnings.push({
      label: 'SQLite stale',
      reason: input.status.index.staleReason ?? input.status.index.reason ?? `index freshness is ${input.status.index.freshness}`
    })
  }
  if (input.status.project.knownProjectRootCount > 1 && input.status.project.idDiagnostic !== 'current project root only') {
    warnings.push({ label: 'projectId split', reason: input.status.project.idDiagnostic })
  }
  if (hasEnabledMcpServer(input.configText, 'cyrene') || hasEnabledMcpServer(input.configText, '"cyrene-continuity"')) {
    warnings.push({ label: 'Codex memory enabled', reason: 'cyrene-continuity MCP is enabled in Codex config' })
  }
  if (hasEnabledMcpServer(input.configText, 'agentmemory')) {
    warnings.push({ label: 'agentmemory enabled', reason: 'disable agentmemory before validating Cyrene as authoritative memory' })
  }
  return warnings
}

function compareActiveMemory(left: CyreneMemory, right: CyreneMemory): number {
  return (
    right.scores.usefulness - left.scores.usefulness ||
    right.scores.evidenceStrength - left.scores.evidenceStrength ||
    right.scores.safety - left.scores.safety ||
    right.updatedAt.localeCompare(left.updatedAt)
  )
}

function isOlderThan(value: string, now: string, maxAgeMs: number): boolean {
  const valueTime = Date.parse(value)
  const nowTime = Date.parse(now)
  return Number.isFinite(valueTime) && Number.isFinite(nowTime) && nowTime - valueTime > maxAgeMs
}

function hasEnabledMcpServer(configText: string, name: string): boolean {
  const block = readTomlBlock(configText, `[mcp_servers.${name}]`)
  if (block === undefined) {
    return false
  }
  return readTomlBooleanValue(block, 'enabled') !== false
}

function readTomlBooleanValue(block: string, key: string): boolean | undefined {
  const value = readTomlAssignmentValue(block, key)
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  return undefined
}

function readTomlAssignmentValue(block: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const value = block.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*(.+?)\\s*$`, 'm'))?.[1]
  return value === undefined ? undefined : stripTomlInlineComment(value).trim()
}

function readTomlBlock(configText: string, heading: string): string | undefined {
  const lines = configText.split(/\r?\n/)
  const start = lines.findIndex((line) => stripTomlInlineComment(line).trim() === heading)
  if (start < 0) {
    return undefined
  }
  const body: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(stripTomlInlineComment(lines[index] ?? ''))) {
      break
    }
    body.push(lines[index] ?? '')
  }
  return body.join('\n')
}

function stripTomlInlineComment(value: string): string {
  let quote: '"' | "'" | undefined
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote === '"') {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        quote = undefined
      }
      continue
    }
    if (quote === "'") {
      if (char === "'") {
        quote = undefined
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#') {
      return value.slice(0, index)
    }
  }
  return value
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return ''
    }
    throw error
  }
}

async function readOptionalMemoryDataFile(path: string): Promise<string> {
  try {
    await assertSafeMemoryDataFileTarget(path)
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return ''
    }
    throw error
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

function truncate(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}...`
}

function formatScore(value: number): string {
  return value.toFixed(2)
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
