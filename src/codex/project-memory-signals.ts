import { execFile } from 'node:child_process'
import { open, readdir, lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { assertSafeMemoryDataFileTarget } from '../memory/memory-store.js'
import { getReadableCodexProjectMemoryRoot } from './codex-memory-root.js'
import { readRecentCodexHookTrace } from './hook-trace-store.js'
import { identifyCodexProject } from './project-id.js'
import { redactReviewText } from './review-redaction.js'

const execFileAsync = promisify(execFile)
const PROJECT_FILES = [
  'package.json',
  'tsconfig.json',
  'plugin/.codex-plugin/plugin.json',
  'plugin/.mcp.json',
  'README.md',
  'AGENTS.md'
] as const
const PROJECT_FILE_MAX_BYTES = 16 * 1024
const SUMMARY_MAX_LENGTH = 180
const EVIDENCE_MAX_LENGTH = 360
const MAX_SIGNAL_FILES = 50
const REVIEW_SUMMARIES_FILE = 'review-summaries.jsonl'

export type CodexProjectHarvestMode = 'default' | 'changed_files'

export interface ProjectMemorySignal {
  kind:
    | 'git_changed_file'
    | 'project_manifest'
    | 'repository_policy'
    | 'documentation'
    | 'test_signal'
    | 'hook_trace'
    | 'review_summary'
  summary: string
  source: 'git' | 'file' | 'tool_trace' | 'review_summary'
  files?: string[]
  evidence?: string
}

interface GitSignals {
  signals: ProjectMemorySignal[]
  warnings: string[]
  changedFiles: string[]
}

interface ReviewSummaryRecord {
  id?: string
  runId?: string
  createdAt: string
  status: 'ok' | 'failed'
  summary: string
  candidateIds: string[]
  failureReason?: string
}

export async function collectProjectMemorySignals(input: {
  cwd: string
  mode?: CodexProjectHarvestMode
  now?: string
}): Promise<{ signals: ProjectMemorySignal[]; warnings: string[] }> {
  const project = await identifyCodexProject(input.cwd)
  const root = project.gitRoot ?? project.cwd
  const mode = input.mode ?? 'default'
  const git = await collectGitSignals(root, mode)
  const changedFiles = new Set(git.changedFiles)
  const warnings = [...git.warnings]
  const signals = [...git.signals]

  signals.push(...(await collectProjectFileSignals(root, mode, changedFiles)))
  signals.push(...(await collectTestSignals(root, mode, changedFiles)))

  if (mode !== 'changed_files') {
    const hookTrace = await readRecentCodexHookTrace({
      cwd: input.cwd,
      now: input.now,
      limit: 20,
      maxAgeDays: 7
    })
    warnings.push(...hookTrace.warnings)
    signals.push(...hookTrace.records.map(toHookTraceSignal))

    const reviewSummaries = await collectReviewSummarySignals(project.projectId)
    warnings.push(...reviewSummaries.warnings)
    signals.push(...reviewSummaries.signals)
  }

  return { signals, warnings }
}

async function collectGitSignals(cwd: string, mode: CodexProjectHarvestMode): Promise<GitSignals> {
  const warnings: string[] = []
  const signals: ProjectMemorySignal[] = []
  const status = await tryGit(cwd, ['status', '--porcelain=v1', '-z'])

  if (!status.ok) {
    warnings.push(`git status unavailable: ${status.warning}`)
    return { signals, warnings, changedFiles: [] }
  }

  const statusEvidence = clean(status.stdout.replace(/\0/g, '\n'), EVIDENCE_MAX_LENGTH)
  const statusFiles = parseGitStatusFiles(status.stdout)
  const diffNames = await tryGit(cwd, ['diff', '--name-only'])
  if (!diffNames.ok) {
    warnings.push(`git diff --name-only unavailable: ${diffNames.warning}`)
  }
  const diffFiles = diffNames.ok ? lines(diffNames.stdout) : []
  const changedFiles = uniqueSorted([...statusFiles, ...diffFiles]).slice(0, MAX_SIGNAL_FILES)

  if (changedFiles.length > 0) {
    signals.push({
      kind: 'git_changed_file',
      source: 'git',
      summary: clean(`changed files: ${changedFiles.join(', ')}`, SUMMARY_MAX_LENGTH),
      files: changedFiles,
      ...(statusEvidence === '' ? {} : { evidence: statusEvidence })
    })
  }

  if (mode === 'changed_files') {
    return { signals, warnings, changedFiles }
  }

  const diffStat = await tryGit(cwd, ['diff', '--stat'])
  if (!diffStat.ok) {
    warnings.push(`git diff --stat unavailable: ${diffStat.warning}`)
    return { signals, warnings, changedFiles }
  }

  const diffStatEvidence = clean(diffStat.stdout, EVIDENCE_MAX_LENGTH)
  if (diffStatEvidence !== '') {
    signals.push({
      kind: 'git_changed_file',
      source: 'git',
      summary: clean(`diff stat: ${firstLine(diffStatEvidence)}`, SUMMARY_MAX_LENGTH),
      ...(changedFiles.length === 0 ? {} : { files: changedFiles }),
      evidence: diffStatEvidence
    })
  }

  return { signals, warnings, changedFiles }
}

async function collectProjectFileSignals(
  root: string,
  mode: CodexProjectHarvestMode,
  changedFiles: Set<string>
): Promise<ProjectMemorySignal[]> {
  const signals: ProjectMemorySignal[] = []
  for (const file of PROJECT_FILES) {
    if (mode === 'changed_files' && !changedFiles.has(file)) {
      continue
    }
    const text = await readBoundedRegularFile(join(root, file))
    if (text === undefined) {
      continue
    }
    signals.push(summarizeProjectFile(file, text))
  }
  return signals
}

async function collectTestSignals(
  root: string,
  mode: CodexProjectHarvestMode,
  changedFiles: Set<string>
): Promise<ProjectMemorySignal[]> {
  let entries: string[]
  try {
    entries = (await readdir(join(root, 'tests'), { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => `tests/${entry.name}`)
      .sort()
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return []
    }
    throw error
  }

  const files = (mode === 'changed_files' ? entries.filter((file) => changedFiles.has(file)) : entries).slice(
    0,
    MAX_SIGNAL_FILES
  )
  if (files.length === 0) {
    return []
  }

  return [{
    kind: 'test_signal',
    source: 'file',
    summary: clean(`tests present: ${files.join(', ')}`, SUMMARY_MAX_LENGTH),
    files,
    evidence: clean(`${files.length} test file${files.length === 1 ? '' : 's'} listed under tests/.`, EVIDENCE_MAX_LENGTH)
  }]
}

async function collectReviewSummarySignals(projectId: string): Promise<{
  signals: ProjectMemorySignal[]
  warnings: string[]
}> {
  const warnings: string[] = []
  const memoryRoot = await getReadableCodexProjectMemoryRoot(projectId)
  if (memoryRoot === null) {
    return { signals: [], warnings }
  }
  const targetPath = join(memoryRoot, REVIEW_SUMMARIES_FILE)
  let content: string

  try {
    await assertSafeMemoryDataFileTarget(targetPath)
    content = await readFile(targetPath, 'utf8')
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return { signals: [], warnings }
    }
    return {
      signals: [],
      warnings: [`review summaries unavailable: ${cleanError(error)}`]
    }
  }

  const records: ReviewSummaryRecord[] = []
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (!isReviewSummaryRecord(parsed)) {
        warnings.push(`Malformed review summary line ${index + 1} skipped.`)
        continue
      }
      records.push(parsed)
    } catch {
      warnings.push(`Malformed review summary line ${index + 1} skipped.`)
    }
  }

  const recent = records
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-10)

  return {
    signals: recent.map(toReviewSummarySignal),
    warnings
  }
}

async function tryGit(cwd: string, args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; warning: string }> {
  try {
    const result = await execFileAsync('git', args, { cwd })
    return { ok: true, stdout: result.stdout }
  } catch (error) {
    return { ok: false, warning: cleanError(error) }
  }
}

async function readBoundedRegularFile(path: string): Promise<string | undefined> {
  let stats
  try {
    stats = await lstat(path)
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return undefined
    }
    throw error
  }

  if (!stats.isFile()) {
    return undefined
  }

  const byteLength = Math.min(stats.size, PROJECT_FILE_MAX_BYTES)
  const buffer = Buffer.alloc(byteLength)
  const file = await open(path, 'r')
  try {
    const { bytesRead } = await file.read(buffer, 0, byteLength, 0)
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    return stats.size > PROJECT_FILE_MAX_BYTES ? `${text}\n[truncated]` : text
  } finally {
    await file.close()
  }
}

function summarizeProjectFile(file: (typeof PROJECT_FILES)[number], text: string): ProjectMemorySignal {
  if (file === 'package.json') {
    return {
      kind: 'project_manifest',
      source: 'file',
      files: [file],
      ...summarizeJsonFile(file, text, 'package manifest')
    }
  }

  if (file === 'tsconfig.json') {
    return {
      kind: 'project_manifest',
      source: 'file',
      files: [file],
      ...summarizeJsonFile(file, text, 'TypeScript config')
    }
  }

  if (file === 'plugin/.codex-plugin/plugin.json' || file === 'plugin/.mcp.json') {
    return {
      kind: 'project_manifest',
      source: 'file',
      files: [file],
      ...summarizeJsonFile(file, text, 'plugin manifest')
    }
  }

  if (file === 'AGENTS.md') {
    const excerpt = markdownExcerpt(text)
    return {
      kind: 'repository_policy',
      source: 'file',
      files: [file],
      summary: clean(`repository policy: ${firstLine(excerpt)}`, SUMMARY_MAX_LENGTH),
      evidence: clean(excerpt, EVIDENCE_MAX_LENGTH)
    }
  }

  const excerpt = markdownExcerpt(text)
  return {
    kind: 'documentation',
    source: 'file',
    files: [file],
    summary: clean(`documentation: ${firstLine(excerpt)}`, SUMMARY_MAX_LENGTH),
    evidence: clean(excerpt, EVIDENCE_MAX_LENGTH)
  }
}

function summarizeJsonFile(file: string, text: string, label: string): { summary: string; evidence: string } {
  try {
    const parsed: unknown = JSON.parse(text)
    if (isPlainRecord(parsed)) {
      const evidence = jsonFacts(parsed)
      return {
        summary: clean(`${label} ${file}: ${firstLine(evidence)}`, SUMMARY_MAX_LENGTH),
        evidence: clean(evidence, EVIDENCE_MAX_LENGTH)
      }
    }
  } catch {
    return {
      summary: clean(`${label} ${file}: JSON parse failed`, SUMMARY_MAX_LENGTH),
      evidence: clean(text, EVIDENCE_MAX_LENGTH)
    }
  }

  return {
    summary: clean(`${label} ${file}: present`, SUMMARY_MAX_LENGTH),
    evidence: clean(text, EVIDENCE_MAX_LENGTH)
  }
}

function jsonFacts(value: Record<string, unknown>): string {
  const facts: string[] = []
  if (typeof value.name === 'string') facts.push(`name=${value.name}`)
  if (typeof value.version === 'string') facts.push(`version=${value.version}`)
  if (typeof value.description === 'string') facts.push(`description=${value.description}`)
  if (isPlainRecord(value.scripts)) facts.push(`scripts=${Object.keys(value.scripts).sort().slice(0, 8).join(',')}`)
  const dependencies = dependencyNames(value)
  if (dependencies.length > 0) facts.push(`dependencies=${dependencies.slice(0, 12).join(',')}`)
  if (isPlainRecord(value.compilerOptions)) {
    const options = value.compilerOptions
    const compilerFacts = [
      typeof options.target === 'string' ? `target=${options.target}` : undefined,
      typeof options.module === 'string' ? `module=${options.module}` : undefined,
      typeof options.strict === 'boolean' ? `strict=${String(options.strict)}` : undefined
    ].filter((item): item is string => item !== undefined)
    if (compilerFacts.length > 0) facts.push(`compilerOptions=${compilerFacts.join(',')}`)
  }
  if (isPlainRecord(value.interface)) {
    const pluginInterface = value.interface
    if (typeof pluginInterface.displayName === 'string') facts.push(`displayName=${pluginInterface.displayName}`)
    if (Array.isArray(pluginInterface.capabilities)) {
      facts.push(`capabilities=${pluginInterface.capabilities.filter(isString).slice(0, 8).join(',')}`)
    }
  }
  if (isPlainRecord(value.mcpServers)) {
    facts.push(`mcpServers=${Object.keys(value.mcpServers).sort().slice(0, 8).join(',')}`)
  }
  return facts.length === 0 ? 'present' : facts.join('; ')
}

function dependencyNames(value: Record<string, unknown>): string[] {
  return Object.keys({
    ...recordOrEmpty(value.dependencies),
    ...recordOrEmpty(value.devDependencies),
    ...recordOrEmpty(value.peerDependencies)
  }).sort()
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {}
}

function toHookTraceSignal(record: Awaited<ReturnType<typeof readRecentCodexHookTrace>>['records'][number]): ProjectMemorySignal {
  const touchedFiles = record.tool?.touchedFiles?.slice(0, MAX_SIGNAL_FILES)
  const details = [
    `createdAt=${record.createdAt}`,
    `event=${record.event}`,
    record.tool?.name === undefined ? undefined : `tool=${record.tool.name}`,
    record.signals.length === 0 ? undefined : `signals=${record.signals.join(', ')}`
  ].filter((item): item is string => item !== undefined)

  return {
    kind: 'hook_trace',
    source: 'tool_trace',
    summary: clean(`hook trace ${record.event}: ${record.summary}`, SUMMARY_MAX_LENGTH),
    ...(touchedFiles === undefined || touchedFiles.length === 0 ? {} : { files: touchedFiles }),
    evidence: clean(details.join('; '), EVIDENCE_MAX_LENGTH)
  }
}

function toReviewSummarySignal(record: ReviewSummaryRecord): ProjectMemorySignal {
  const details = [
    `createdAt=${record.createdAt}`,
    `status=${record.status}`,
    record.candidateIds.length === 0 ? undefined : `candidates=${record.candidateIds.join(', ')}`,
    record.failureReason === undefined ? undefined : `failure=${record.failureReason}`
  ].filter((item): item is string => item !== undefined)

  return {
    kind: 'review_summary',
    source: 'review_summary',
    summary: clean(`review summary ${record.status}: ${record.summary}`, SUMMARY_MAX_LENGTH),
    evidence: clean(details.join('; '), EVIDENCE_MAX_LENGTH)
  }
}

function parseGitStatusFiles(output: string): string[] {
  const files: string[] = []
  const entries = output.split('\0').filter(Boolean)

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? ''
    const status = entry.slice(0, 2)
    const path = entry.length > 3 ? entry.slice(3) : entry.trim()
    if (path !== '') {
      files.push(path)
    }
    if (status.includes('R') || status.includes('C')) {
      index += 1
    }
  }

  return uniqueSorted(files)
}

function markdownExcerpt(text: string): string {
  const meaningfulLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 4)
  return meaningfulLines.join(' ')
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0]?.trim() ?? ''
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort()
}

function clean(value: string, maxLength: number): string {
  const redacted = redactReviewText(value.replace(/\s+/g, ' ').trim()).text
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength - 1)}...`
}

function cleanError(error: unknown): string {
  if (isErrorWithStderr(error) && error.stderr.trim() !== '') {
    return clean(error.stderr, SUMMARY_MAX_LENGTH)
  }
  if (error instanceof Error) {
    return clean(error.message, SUMMARY_MAX_LENGTH)
  }
  return 'unknown error'
}

function isReviewSummaryRecord(value: unknown): value is ReviewSummaryRecord {
  if (!isPlainRecord(value)) {
    return false
  }
  return (
    isValidTimestamp(value.createdAt) &&
    (value.status === 'ok' || value.status === 'failed') &&
    typeof value.summary === 'string' &&
    (value.id === undefined || typeof value.id === 'string') &&
    (value.runId === undefined || typeof value.runId === 'string') &&
    (value.failureReason === undefined || typeof value.failureReason === 'string') &&
    isStringArray(value.candidateIds)
  )
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function isErrorWithStderr(error: unknown): error is Error & { stderr: string } {
  return error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
}
