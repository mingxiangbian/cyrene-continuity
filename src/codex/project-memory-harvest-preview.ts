import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CodexMemoryCandidateInput } from './memory-propose.js'
import { HARVEST_PREVIEW_TTL_MS } from './retrieval-v2-constants.js'

export type ProjectHarvestPreviewRoute = 'trial_eligible' | 'review_required' | 'reject_recommended'

export interface ProjectHarvestPreviewCandidate extends CodexMemoryCandidateInput {
  route: ProjectHarvestPreviewRoute
  reason: string
}

export interface ProjectHarvestPreviewGroup {
  route: ProjectHarvestPreviewRoute
  candidates: ProjectHarvestPreviewCandidate[]
}

export interface ProjectHarvestPreviewArtifact {
  previewId: string
  previewHash: string
  projectId: string
  memoryRoot: string
  createdAt: string
  expiresAt: string
  admissionPolicyVersion: string
  toolVersion: string
  candidates: ProjectHarvestPreviewCandidate[]
  groups: ProjectHarvestPreviewGroup[]
  warnings: string[]
  sourceSignalHashes: string[]
}

export type ReadHarvestPreviewArtifactResult =
  | { action: 'ok'; artifact: ProjectHarvestPreviewArtifact }
  | { action: 'preview_expired'; reason: string }
  | { action: 'preview_not_found'; reason: string }
  | { action: 'preview_hash_mismatch'; reason: string }

export const HARVEST_PREVIEW_ROUTES: readonly ProjectHarvestPreviewRoute[] = [
  'trial_eligible',
  'review_required',
  'reject_recommended'
] as const

const HARVEST_PREVIEWS_DIR = 'harvest_previews'
const HARVEST_PREVIEW_ID_PATTERN = /^harvest-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function stableCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export function previewHashForPayload(payload: Omit<ProjectHarvestPreviewArtifact, 'previewHash'>): string {
  return createHash('sha256').update(stableCanonicalJson(payload)).digest('hex')
}

export async function writeHarvestPreviewArtifact(input: {
  projectId: string
  memoryRoot: string
  now?: string
  admissionPolicyVersion: string
  toolVersion: string
  candidates: ProjectHarvestPreviewCandidate[]
  groups: ProjectHarvestPreviewGroup[]
  warnings: string[]
  sourceSignalHashes: string[]
}): Promise<ProjectHarvestPreviewArtifact> {
  const createdAt = input.now ?? new Date().toISOString()
  const expiresAt = new Date(Date.parse(createdAt) + HARVEST_PREVIEW_TTL_MS).toISOString()
  const payload: Omit<ProjectHarvestPreviewArtifact, 'previewHash'> = {
    previewId: `harvest-${randomUUID()}`,
    projectId: input.projectId,
    memoryRoot: input.memoryRoot,
    createdAt,
    expiresAt,
    admissionPolicyVersion: input.admissionPolicyVersion,
    toolVersion: input.toolVersion,
    candidates: input.candidates,
    groups: input.groups,
    warnings: input.warnings,
    sourceSignalHashes: input.sourceSignalHashes
  }
  const artifact: ProjectHarvestPreviewArtifact = {
    ...payload,
    previewHash: previewHashForPayload(payload)
  }
  const dir = join(input.memoryRoot, HARVEST_PREVIEWS_DIR)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${artifact.previewId}.json`), `${stableCanonicalJson(artifact)}\n`, 'utf8')
  return artifact
}

export async function readHarvestPreviewArtifact(input: {
  memoryRoot: string
  previewId: string
  previewHash: string
  now?: string
}): Promise<ReadHarvestPreviewArtifactResult> {
  if (!HARVEST_PREVIEW_ID_PATTERN.test(input.previewId)) {
    return { action: 'preview_not_found', reason: 'Harvest preview id is invalid.' }
  }

  let raw: string
  try {
    raw = await readFile(join(input.memoryRoot, HARVEST_PREVIEWS_DIR, `${input.previewId}.json`), 'utf8')
  } catch {
    return { action: 'preview_not_found', reason: 'Harvest preview artifact was not found.' }
  }

  const artifact = parseHarvestPreviewArtifact(raw)
  if (artifact === undefined || artifact.previewId !== input.previewId) {
    return { action: 'preview_hash_mismatch', reason: 'Harvest preview artifact is invalid.' }
  }

  const { previewHash: storedHash, ...payload } = artifact
  const expectedHash = previewHashForPayload(payload)
  if (storedHash !== input.previewHash || expectedHash !== input.previewHash) {
    return { action: 'preview_hash_mismatch', reason: 'Harvest preview hash does not match the artifact.' }
  }

  const createdAtMs = Date.parse(artifact.createdAt)
  const expiresAtMs = Date.parse(artifact.expiresAt)
  const now = Date.parse(input.now ?? new Date().toISOString())
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs) || !Number.isFinite(now) || expiresAtMs <= createdAtMs) {
    return { action: 'preview_hash_mismatch', reason: 'Harvest preview artifact has invalid timestamps.' }
  }
  if (now >= expiresAtMs) {
    return { action: 'preview_expired', reason: 'Harvest preview expired; run preview again.' }
  }

  return { action: 'ok', artifact }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter((entry) => entry[1] !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalValue(entryValue)])
    )
  }
  return value
}

function parseHarvestPreviewArtifact(raw: string): ProjectHarvestPreviewArtifact | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isHarvestPreviewArtifact(parsed)) {
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

function isHarvestPreviewArtifact(value: unknown): value is ProjectHarvestPreviewArtifact {
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.previewId === 'string' &&
    typeof value.previewHash === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.memoryRoot === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.expiresAt === 'string' &&
    typeof value.admissionPolicyVersion === 'string' &&
    typeof value.toolVersion === 'string' &&
    Array.isArray(value.candidates) &&
    Array.isArray(value.groups) &&
    Array.isArray(value.warnings) &&
    Array.isArray(value.sourceSignalHashes)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
