import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assertMemoryMaintenanceTargetsSafeFromRoot,
  withMemoryMaintenanceLockFromRoot
} from '../memory/memory-maintenance.js'
import { readModelProfileFromRootIfExists } from '../memory/model-profile.js'
import { renderMemoryProjectionsFromRoot } from '../memory/memory-exporter.js'
import {
  appendMemoryEventFromRoot,
  ensureWritableMemoryRootPath,
  readActiveMemoriesFromRoot,
  writeActiveMemoriesFromRoot
} from '../memory/memory-store.js'
import { deriveProfileVisibility } from '../memory/memory-validator.js'
import type { CyreneMemory } from '../memory/types.js'
import { ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import { syncCurrentCodexMemoryIndex } from './codex-memory-index.js'
import { identifyCodexProject } from './project-id.js'

const PROFILE_CANDIDATES_FILE = 'profile_candidates.jsonl'
const MODEL_PROFILE_PENDING_FILE = 'MODEL_PROFILE.pending.md'

export type ProfileCandidateStatus = 'pending' | 'applied' | 'rejected'
export type ProfileCandidateSection =
  | 'Always Apply'
  | 'Project Context'
  | 'Interaction Preferences'
  | 'Response Policy'
  | 'Restricted Notes'

export interface ProfileCandidate {
  id: string
  scope: 'global' | 'project'
  status: ProfileCandidateStatus
  source: 'daily_profile_reflection' | 'manual_review' | 'memory_dream'
  proposedSection: ProfileCandidateSection
  content: string
  rationale: string
  sourceMemoryIds: string[]
  evidenceSummary: string
  createdAt: string
  appliedAt?: string
  appliedMemoryId?: string
}

export interface ProfileCandidateSummary extends ProfileCandidate {
  reviewHash: string
}

export interface ProfileDiff {
  candidateId: string
  section: ProfileCandidateSection
  before: string
  after: string
  addedLines: string[]
  removedLines: string[]
  addedMemoryId?: string
}

export interface ProfileReflectionResult {
  project: { projectId: string; displayName: string }
  memoryRoot: string
  source: 'daily-interview'
  candidates: ProfileCandidateSummary[]
  openQuestions: string[]
  conflictNotes: string[]
}

export interface ProfileApplyResult {
  project: { projectId: string; displayName: string }
  memoryRoot: string
  result:
    | {
        action: 'apply'
        candidateId: string
        reviewHash: string
        diff: ProfileDiff
      }
    | {
        action: 'not_found'
        candidateId: string
        reason: string
      }
    | {
        action: 'conflict'
        candidateId: string
        reason: string
        latest: ProfileCandidateSummary
      }
    | {
        action: 'blocked_by_gate'
        candidateId: string
        failedChecks: Array<'profile_pollution_eval' | 'affective_boundary_eval'>
        reason: string
      }
}

export function reviewHashForProfileCandidate(candidate: ProfileCandidate): string {
  const payload = {
    id: candidate.id,
    scope: candidate.scope,
    status: candidate.status,
    source: candidate.source,
    proposedSection: candidate.proposedSection,
    content: candidate.content,
    rationale: candidate.rationale,
    sourceMemoryIds: candidate.sourceMemoryIds,
    evidenceSummary: candidate.evidenceSummary,
    createdAt: candidate.createdAt
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export async function runCodexProfileReflection(input: {
  cwd: string
  source: 'daily-interview'
  now?: string
}): Promise<ProfileReflectionResult> {
  const now = input.now ?? new Date().toISOString()
  const project = await identifyCodexProject(input.cwd)
  const memoryRoot = await ensureCodexProjectMemoryRoot(project.projectId)
  const active = await readActiveMemoriesFromRoot(memoryRoot)
  const existing = await readProfileCandidatesFromRoot(memoryRoot)
  const reflected = active
    .flatMap((memory) => profileCandidateFromMemory(memory, now))
    .filter((candidate) => !isUnsafeProfileCandidate(candidate))
  const nextCandidates = upsertProfileCandidates(existing, reflected)

  if (reflected.length > 0 || existing.length > 0) {
    await writeProfileCandidatesFromRoot(memoryRoot, nextCandidates)
    await writePendingProfilePatchFromRoot(memoryRoot, nextCandidates)
  }

  return {
    project: { projectId: project.projectId, displayName: project.displayName },
    memoryRoot,
    source: input.source,
    candidates: reflected.map(summarizeProfileCandidate),
    openQuestions: [],
    conflictNotes: []
  }
}

export async function applyCodexProfileCandidate(input: {
  cwd: string
  candidateId: string
  reviewHash: string
  now?: string
}): Promise<ProfileApplyResult> {
  const now = input.now ?? new Date().toISOString()
  const project = await identifyCodexProject(input.cwd)
  const memoryRoot = await ensureCodexProjectMemoryRoot(project.projectId)
  const candidates = await readProfileCandidatesFromRoot(memoryRoot)
  const candidate = candidates.find((item) => item.id === input.candidateId && item.status === 'pending')
  if (candidate === undefined) {
    return {
      project: { projectId: project.projectId, displayName: project.displayName },
      memoryRoot,
      result: {
        action: 'not_found',
        candidateId: input.candidateId,
        reason: 'Profile candidate not found'
      }
    }
  }

  const latestHash = reviewHashForProfileCandidate(candidate)
  if (latestHash !== input.reviewHash) {
    return {
      project: { projectId: project.projectId, displayName: project.displayName },
      memoryRoot,
      result: {
        action: 'conflict',
        candidateId: input.candidateId,
        reason: 'Profile candidate changed since review',
        latest: summarizeProfileCandidate(candidate)
      }
    }
  }

  await assertMemoryMaintenanceTargetsSafeFromRoot(memoryRoot)
  return withMemoryMaintenanceLockFromRoot(memoryRoot, async (lockedRoot) => {
    await assertMemoryMaintenanceTargetsSafeFromRoot(lockedRoot)
    const lockedCandidates = await readProfileCandidatesFromRoot(lockedRoot)
    const lockedCandidate = lockedCandidates.find((item) => item.id === input.candidateId && item.status === 'pending')
    if (lockedCandidate === undefined) {
      return {
        project: { projectId: project.projectId, displayName: project.displayName },
        memoryRoot: lockedRoot,
        result: {
          action: 'not_found',
          candidateId: input.candidateId,
          reason: 'Profile candidate not found'
        }
      }
    }

    const lockedHash = reviewHashForProfileCandidate(lockedCandidate)
    if (lockedHash !== input.reviewHash) {
      return {
        project: { projectId: project.projectId, displayName: project.displayName },
        memoryRoot: lockedRoot,
        result: {
          action: 'conflict',
          candidateId: input.candidateId,
          reason: 'Profile candidate changed since review',
          latest: summarizeProfileCandidate(lockedCandidate)
        }
      }
    }

    const gate = evaluateProfileApplyGate(lockedCandidate)
    if (!gate.passed) {
      return {
        project: { projectId: project.projectId, displayName: project.displayName },
        memoryRoot: lockedRoot,
        result: {
          action: 'blocked_by_gate',
          candidateId: lockedCandidate.id,
          failedChecks: gate.failedChecks,
          reason: gate.reason
        }
      }
    }

    const before = await readModelProfileFromRootIfExists(lockedRoot) ?? ''
    const active = await readActiveMemoriesFromRoot(lockedRoot)
    const memory = activeMemoryFromProfileCandidate(lockedCandidate, now, lockedHash)
    await writeActiveMemoriesFromRoot(lockedRoot, upsertActiveMemory(active, memory))
    const updatedCandidates: ProfileCandidate[] = lockedCandidates.map((item) => item.id === lockedCandidate.id
      ? { ...item, status: 'applied', appliedAt: now, appliedMemoryId: memory.id }
      : item)
    await writeProfileCandidatesFromRoot(
      lockedRoot,
      updatedCandidates
    )
    await writePendingProfilePatchFromRoot(lockedRoot, updatedCandidates)
    await appendMemoryEventFromRoot(lockedRoot, {
      id: randomUUID(),
      action: 'promote',
      at: now,
      reason: 'Approved by Codex profile candidate review',
      memoryId: memory.id,
      candidateId: lockedCandidate.id,
      details: profileApprovalDetails(lockedCandidate, lockedHash)
    })
    await renderMemoryProjectionsFromRoot(lockedRoot)
    await syncCurrentCodexMemoryIndex({ cwd: input.cwd })
    const after = await readModelProfileFromRootIfExists(lockedRoot) ?? ''

    return {
      project: { projectId: project.projectId, displayName: project.displayName },
      memoryRoot: lockedRoot,
      result: {
        action: 'apply',
        candidateId: lockedCandidate.id,
        reviewHash: lockedHash,
        diff: profileDiffForApply(lockedCandidate, before, after, memory.id)
      }
    }
  })
}

function profileCandidateFromMemory(memory: CyreneMemory, now: string): ProfileCandidate[] {
  const visibility = deriveProfileVisibility(memory)
  if (visibility !== 'always' && visibility !== 'safe_summary') {
    return []
  }
  return [{
    id: `profile-${memory.id}`,
    scope: memory.scope === 'global' ? 'global' : 'project',
    status: 'pending',
    source: 'daily_profile_reflection',
    proposedSection: profileSection(memory, visibility),
    content: memory.content,
    rationale: 'Derived from active memory marked profile-visible.',
    sourceMemoryIds: [memory.id],
    evidenceSummary: memory.evidence.map((entry) => entry.summary ?? entry.runId ?? '').filter(Boolean).join(' '),
    createdAt: now
  }]
}

function profileSection(memory: CyreneMemory, visibility: 'always' | 'safe_summary'): ProfileCandidateSection {
  if (visibility === 'always') {
    return 'Always Apply'
  }
  if (memory.domain === 'project') {
    return 'Project Context'
  }
  if (memory.domain === 'procedural' || memory.domain === 'system') {
    return 'Response Policy'
  }
  if (memory.domain === 'personal' || memory.domain === 'relationship' || memory.domain === 'affective') {
    return 'Interaction Preferences'
  }
  return 'Restricted Notes'
}

function summarizeProfileCandidate(candidate: ProfileCandidate): ProfileCandidateSummary {
  return { ...candidate, reviewHash: reviewHashForProfileCandidate(candidate) }
}

function activeMemoryFromProfileCandidate(candidate: ProfileCandidate, now: string, reviewHash: string): CyreneMemory {
  const classification = profileMemoryClassification(candidate.proposedSection)
  return {
    id: `profile-memory-${candidate.id}`,
    domain: classification.domain,
    type: classification.type,
    strength: 'hard',
    scope: candidate.scope,
    status: 'active',
    content: candidate.content,
    normalizedKey: `profile:${candidate.id}`,
    evidence: [{
      runId: candidate.id,
      sourceKind: 'tool_trace',
      summary: candidate.evidenceSummary,
      traceRefs: candidate.sourceMemoryIds,
      taskHash: reviewHash,
      evidenceGroupId: candidate.proposedSection
    }],
    source: 'tool_trace',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.9,
      sensitivity: 0.1
    },
    createdAt: candidate.createdAt,
    updatedAt: now,
    userConfirmed: true,
    profileVisibility: 'always',
    tags: ['profile-candidate', `profile-section:${candidate.proposedSection}`]
  }
}

function profileMemoryClassification(section: ProfileCandidateSection): Pick<CyreneMemory, 'domain' | 'type'> {
  switch (section) {
    case 'Project Context':
      return { domain: 'project', type: 'project_fact' }
    case 'Interaction Preferences':
      return { domain: 'personal', type: 'interaction_style' }
    case 'Response Policy':
      return { domain: 'procedural', type: 'procedural_rule' }
    case 'Always Apply':
      return { domain: 'system', type: 'system_policy' }
    case 'Restricted Notes':
      return { domain: 'system', type: 'reference' }
  }
}

function profileApprovalDetails(candidate: ProfileCandidate, reviewHash: string): Record<string, unknown> {
  return {
    reviewHash,
    sourceMemoryIds: candidate.sourceMemoryIds,
    evidenceSummary: candidate.evidenceSummary,
    proposedSection: candidate.proposedSection
  }
}

function profileDiffForApply(
  candidate: ProfileCandidate,
  before: string,
  after: string,
  addedMemoryId: string
): ProfileDiff {
  const beforeLines = profileDiffLines(before)
  const afterLines = profileDiffLines(after)
  return {
    candidateId: candidate.id,
    section: candidate.proposedSection,
    before,
    after,
    addedLines: subtractLines(afterLines, beforeLines),
    removedLines: subtractLines(beforeLines, afterLines),
    addedMemoryId
  }
}

function profileDiffLines(content: string): string[] {
  return content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function subtractLines(left: string[], right: string[]): string[] {
  const remaining = new Map<string, number>()
  for (const line of right) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1)
  }
  const result: string[] = []
  for (const line of left) {
    const count = remaining.get(line) ?? 0
    if (count > 0) {
      remaining.set(line, count - 1)
    } else {
      result.push(line)
    }
  }
  return result
}

function evaluateProfileApplyGate(candidate: ProfileCandidate): {
  passed: boolean
  failedChecks: Array<'profile_pollution_eval' | 'affective_boundary_eval'>
  reason: string
} {
  if (isUnsafeProfileCandidate(candidate)) {
    return {
      passed: false,
      failedChecks: ['affective_boundary_eval'],
      reason: 'Profile candidate contains diagnostic affective content'
    }
  }
  return { passed: true, failedChecks: [], reason: 'Profile candidate passed apply gate' }
}

function isUnsafeProfileCandidate(candidate: ProfileCandidate): boolean {
  return /\b(?:unstable|emotionally dependent|dependent|narciss(?:ist|istic)?|borderline|trauma bonded|attachment disorder|diagnos(?:e|is|tic))\b/i.test(candidate.content)
}

function upsertProfileCandidates(existing: ProfileCandidate[], candidates: ProfileCandidate[]): ProfileCandidate[] {
  const next = [...existing]
  for (const candidate of candidates) {
    const index = next.findIndex((item) => item.id === candidate.id)
    if (index === -1) {
      next.push(candidate)
    } else if (next[index]?.status === 'pending') {
      next[index] = candidate
    }
  }
  return next
}

function upsertActiveMemory(active: CyreneMemory[], memory: CyreneMemory): CyreneMemory[] {
  const index = active.findIndex((entry) => entry.id === memory.id || entry.normalizedKey === memory.normalizedKey)
  if (index === -1) {
    return [...active, memory]
  }
  const next = [...active]
  next[index] = memory
  return next
}

async function readProfileCandidatesFromRoot(memoryRoot: string): Promise<ProfileCandidate[]> {
  const root = await ensureWritableMemoryRootPath(memoryRoot)
  try {
    const content = await readFile(join(root, PROFILE_CANDIDATES_FILE), 'utf8')
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ProfileCandidate)
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return []
    }
    throw error
  }
}

async function writeProfileCandidatesFromRoot(memoryRoot: string, candidates: ProfileCandidate[]): Promise<void> {
  const root = await ensureWritableMemoryRootPath(memoryRoot)
  const targetPath = join(root, PROFILE_CANDIDATES_FILE)
  await assertSafeProfileFileTarget(targetPath, 'profile candidate')
  const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  const content = candidates.map((candidate) => JSON.stringify(candidate)).join('\n')
  await writeFile(tempPath, content === '' ? '' : `${content}\n`, 'utf8')
  await rename(tempPath, targetPath)
}

async function writePendingProfilePatchFromRoot(memoryRoot: string, candidates: ProfileCandidate[]): Promise<void> {
  const root = await ensureWritableMemoryRootPath(memoryRoot)
  const targetPath = join(root, MODEL_PROFILE_PENDING_FILE)
  await assertSafeProfileFileTarget(targetPath, 'pending profile patch')
  const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tempPath, formatPendingProfilePatch(candidates.map(summarizeProfileCandidate)), 'utf8')
  await rename(tempPath, targetPath)
}

function formatPendingProfilePatch(candidates: ProfileCandidateSummary[]): string {
  const pending = candidates.filter((candidate) => candidate.status === 'pending')
  const lines = [
    '<!-- Generated by Cyrene Continuity. Review before applying. -->',
    '',
    '# Cyrene Model Profile Pending Patch',
    ''
  ]

  if (pending.length === 0) {
    lines.push('No pending profile candidates.', '')
    return lines.join('\n')
  }

  for (const candidate of pending) {
    lines.push(`## ${candidate.id}`)
    lines.push('')
    lines.push(`- Section: ${candidate.proposedSection}`)
    lines.push(`- Review hash: ${candidate.reviewHash}`)
    lines.push(`- Scope: ${candidate.scope}`)
    lines.push(`- Source memory ids: ${candidate.sourceMemoryIds.join(', ') || 'none'}`)
    lines.push(`- Evidence: ${candidate.evidenceSummary || 'none'}`)
    lines.push(`- Rationale: ${candidate.rationale}`)
    lines.push('')
    lines.push(candidate.content)
    lines.push('')
    lines.push('Apply:')
    lines.push('')
    lines.push(`cyrene-continuity codex profile apply --candidate ${candidate.id} --review-hash ${candidate.reviewHash}`)
    lines.push('')
  }

  return lines.join('\n')
}

async function assertSafeProfileFileTarget(targetPath: string, label: string): Promise<void> {
  try {
    const stats = await lstat(targetPath)
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to use ${label} symlink: ${targetPath}`)
    }
    if (!stats.isFile()) {
      throw new Error(`Refusing to use non-file ${label} path: ${targetPath}`)
    }
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return
    }
    throw error
  }
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
