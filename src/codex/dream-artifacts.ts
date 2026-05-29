import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSafeMemoryDataFileTarget, ensureWritableMemoryRootPath } from '../memory/memory-store.js'
import {
  getReadableCodexGlobalMemoryRoot,
  getReadableCodexProjectMemoryRoot
} from './codex-memory-root.js'
import type { DreamRootProposal } from './dream-proposal.js'
import { identifyCodexProject } from './project-id.js'

const DREAM_PREVIEW_DIR = 'dream-preview'
const DREAM_REPORT_FILE = 'DREAM_REPORT.md'

export interface DreamPreviewArtifactPaths {
  reportPath: string
  proposedChangesPath: string
  diffPath: string
  evalResultsPath: string
}

export async function writeDreamPreviewArtifacts(input: {
  memoryRoot: string
  proposal: DreamRootProposal
}): Promise<DreamPreviewArtifactPaths> {
  const memoryRoot = await ensureWritableMemoryRootPath(input.memoryRoot)
  const previewDir = await ensurePreviewDir(memoryRoot)
  const proposalId = randomUUID()
  const createdAt = new Date().toISOString()
  const paths: DreamPreviewArtifactPaths = {
    reportPath: join(previewDir, DREAM_REPORT_FILE),
    proposedChangesPath: join(previewDir, 'proposed_changes.json'),
    diffPath: join(previewDir, 'diff.json'),
    evalResultsPath: join(previewDir, 'eval_results.json')
  }

  await writeTextAtomic(paths.reportPath, renderDreamReport({ proposalId, createdAt, proposal: input.proposal }))
  await writeJsonAtomic(paths.proposedChangesPath, {
    proposalId,
    createdAt,
    root: {
      memoryRoot: input.proposal.memoryRoot,
      proposedChanges: input.proposal.proposedChanges,
      summary: input.proposal.summary,
      evalGate: input.proposal.evalGate
    }
  })
  await writeJsonAtomic(paths.diffPath, input.proposal.diff)
  await writeJsonAtomic(paths.evalResultsPath, input.proposal.evalGate)
  return paths
}

export async function readDreamReport(input: {
  cwd: string
  root: 'global' | 'project'
}): Promise<{ memoryRoot: string; report: string }> {
  const memoryRoot = input.root === 'global'
    ? await getReadableCodexGlobalMemoryRoot()
    : await getReadableProjectMemoryRoot(input.cwd)
  if (memoryRoot === null) {
    throw new Error(`No readable ${input.root} memory root exists`)
  }

  try {
    const previewDir = await getExistingPreviewDir(memoryRoot)
    const reportPath = join(previewDir, DREAM_REPORT_FILE)
    await assertSafeMemoryDataFileTarget(reportPath)
    return { memoryRoot, report: await readFile(reportPath, 'utf8') }
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      throw new Error(`No dream report found for ${input.root} memory root. Run codex memory dream --stage deep-preview first.`)
    }
    throw error
  }
}

async function getReadableProjectMemoryRoot(cwd: string): Promise<string | null> {
  const project = await identifyCodexProject(cwd)
  return getReadableCodexProjectMemoryRoot(project.projectId)
}

function renderDreamReport(input: {
  proposalId: string
  createdAt: string
  proposal: DreamRootProposal
}): string {
  const lines = [
    '# Cyrene Dream Preview',
    '',
    `- proposalId: ${input.proposalId}`,
    `- createdAt: ${input.createdAt}`,
    `- memoryRoot: ${input.proposal.memoryRoot}`,
    `- recommendedPromotions: ${input.proposal.summary.recommendedPromotions}`,
    `- reject: ${input.proposal.summary.reject}`,
    `- expire: ${input.proposal.summary.expire}`,
    `- keepPending: ${input.proposal.summary.keepPending}`,
    `- evalGate: ${input.proposal.evalGate.passed ? 'passed' : 'failed'}`,
    '',
    '## Proposed Changes',
    ''
  ]

  if (input.proposal.proposedChanges.length === 0) {
    lines.push('- none')
  } else {
    for (const change of input.proposal.proposedChanges) {
      if (change.action === 'recommend_promote') {
        lines.push(`- recommend_promote ${change.normalizedKey} (${change.candidateId}) -> ${change.recommendedMemoryId}: ${change.reason}`)
      } else if (change.action === 'promote') {
        lines.push(`- promote ${change.normalizedKey} (${change.candidateId}) -> ${change.memoryId}: ${change.reason}`)
      } else if (change.action === 'reject') {
        lines.push(`- reject ${change.normalizedKey} (${change.candidateId}) as ${change.tombstoneReason}: ${change.reason}`)
      } else {
        lines.push(`- keep_pending ${change.normalizedKey} (${change.candidateId}): ${change.reason}`)
      }
    }
  }

  lines.push(
    '',
    '## Apply',
    '',
    'Use cyrene_memory_pending_list / cyrene_memory_pending_get and explicit cyrene_memory_promote approval to promote recommended candidates. deep-apply does not promote unapproved pending memory.'
  )
  return `${lines.join('\n')}\n`
}

async function ensurePreviewDir(memoryRoot: string): Promise<string> {
  const previewDir = join(memoryRoot, DREAM_PREVIEW_DIR)
  await mkdir(previewDir, { recursive: true })
  const stats = await lstat(previewDir)
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to use dream preview symlink: ${previewDir}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`Refusing to use non-directory dream preview path: ${previewDir}`)
  }
  return realpath(previewDir)
}

async function getExistingPreviewDir(memoryRoot: string): Promise<string> {
  const previewDir = join(memoryRoot, DREAM_PREVIEW_DIR)
  const stats = await lstat(previewDir)
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to use dream preview symlink: ${previewDir}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`Refusing to use non-directory dream preview path: ${previewDir}`)
  }
  return realpath(previewDir)
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  await assertSafeMemoryDataFileTarget(filePath)
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, filePath)
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
