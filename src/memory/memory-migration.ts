import { lstat, readFile, readdir, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { renderMemoryProjections } from './memory-exporter.js'
import {
  appendMemoryEvent,
  readActiveMemories,
  writeActiveMemories
} from './memory-store.js'
import { createMemorySnapshot } from './memory-snapshot.js'
import { ensureMemoryRoot, resolveMemoryFile } from './paths.js'
import type { CyreneMemory, MemoryDomain, MemoryScope, MemoryStrength, MemoryType } from './types.js'

interface LegacyIndexEntry {
  title: string
  file: string
  type?: string
  summary: string
}

export interface LegacyMemoryMigrationResult {
  migrated: number
  skipped: number
  deletedLegacyFiles: number
  snapshotId?: string
}

const GENERATED_MARKER = 'Generated from .cyrene/memory/index.jsonl'

export async function migrateLegacyMemory(cwd: string): Promise<LegacyMemoryMigrationResult> {
  const root = await ensureMemoryRoot(cwd)
  const legacyCandidates = await collectLegacyMemories(root)
  const deleteTargets = await collectLegacyDeleteTargets(root)

  if (legacyCandidates.length === 0) {
    return { migrated: 0, skipped: 0, deletedLegacyFiles: 0 }
  }

  const snapshot = await createMemorySnapshot(cwd, 'before legacy memory migration')
  const existing = await readActiveMemories(cwd)
  const existingKeys = new Set(existing.map((memory) => memory.normalizedKey))
  const migrated = legacyCandidates
    .filter((memory) => !existingKeys.has(memory.normalizedKey))
    .map((memory) => {
      existingKeys.add(memory.normalizedKey)
      return memory
    })

  await writeActiveMemories(cwd, [...existing, ...migrated])
  for (const memory of migrated) {
    await appendMemoryEvent(cwd, {
      id: randomUUID(),
      action: 'create',
      at: new Date().toISOString(),
      reason: 'Migrated legacy memory into Personal Memory Core.',
      memoryId: memory.id,
      details: { source: 'legacy_migration' }
    })
  }
  await renderMemoryProjections(cwd)

  const deletedLegacyFiles = await deleteLegacyArtifacts(root, deleteTargets)
  return {
    migrated: migrated.length,
    skipped: legacyCandidates.length - migrated.length,
    deletedLegacyFiles,
    snapshotId: snapshot.id
  }
}

async function collectLegacyMemories(memoryRoot: string): Promise<CyreneMemory[]> {
  const now = new Date().toISOString()
  const memories: CyreneMemory[] = []
  memories.push(...(await collectLegacyIndexMemories(memoryRoot, now)))
  memories.push(...(await collectLegacyDailyMemory(memoryRoot, now)))
  memories.push(...(await collectLegacySessionMemories(memoryRoot, now)))
  return memories
}

async function collectLegacyIndexMemories(memoryRoot: string, now: string): Promise<CyreneMemory[]> {
  const indexPath = join(memoryRoot, 'MEMORY.md')
  const index = await readTextIfExists(indexPath)
  if (index === null || index.includes(GENERATED_MARKER)) return []

  const entries = index
    .split(/\r?\n/)
    .map(parseLegacyIndexEntry)
    .filter((entry): entry is LegacyIndexEntry => entry !== null)

  const memories: CyreneMemory[] = []
  for (const entry of entries) {
    const filePath = resolveMemoryFile(memoryRoot, entry.file)
    const content = await readTextIfExists(filePath)
    if (content === null) continue
    const cleanContent = content.trim()
    if (cleanContent === '') continue
    memories.push(createLegacyMemory({
      now,
      sourceName: entry.file,
      title: entry.title,
      legacyType: entry.type,
      summary: entry.summary,
      content: cleanContent
    }))
  }
  return memories
}

async function collectLegacyDailyMemory(memoryRoot: string, now: string): Promise<CyreneMemory[]> {
  const daily = await readTextIfExists(join(memoryRoot, 'daily.md'))
  const cleanDaily = daily?.trim()
  if (!cleanDaily) return []

  return [
    createLegacyEpisodeMemory({
      now,
      sourceName: 'daily.md',
      content: cleanDaily,
      evidenceSummary: 'Migrated from legacy daily.md.'
    })
  ]
}

async function collectLegacySessionMemories(memoryRoot: string, now: string): Promise<CyreneMemory[]> {
  const sessionsDir = join(memoryRoot, 'sessions')
  try {
    const stats = await lstat(sessionsDir)
    if (stats.isSymbolicLink() || !stats.isDirectory()) return []
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) return []
    throw error
  }

  const files = (await readdir(sessionsDir)).filter((entry) => entry.endsWith('.md')).sort()
  const memories: CyreneMemory[] = []
  for (const file of files) {
    const content = await readTextIfExists(join(sessionsDir, file))
    const cleanContent = content?.trim()
    if (!cleanContent) continue
    memories.push(
      createLegacyEpisodeMemory({
        now,
        sourceName: `sessions/${file}`,
        content: cleanContent,
        evidenceSummary: `Migrated from legacy session summary ${file}.`
      })
    )
  }
  return memories
}

async function collectLegacyDeleteTargets(memoryRoot: string): Promise<string[]> {
  const targets: string[] = []
  const index = await readTextIfExists(join(memoryRoot, 'MEMORY.md'))
  if (index !== null && !index.includes(GENERATED_MARKER)) {
    for (const entry of index.split(/\r?\n/).map(parseLegacyIndexEntry)) {
      if (entry === null) continue
      targets.push(resolveMemoryFile(memoryRoot, entry.file))
    }
  }
  return targets
}

async function deleteLegacyArtifacts(memoryRoot: string, legacyIndexFiles: string[]): Promise<number> {
  let deleted = 0
  for (const file of legacyIndexFiles) {
    deleted += await removeIfExists(file)
  }

  deleted += await removeIfExists(join(memoryRoot, 'MEMORY.md'))
  deleted += await removeIfExists(join(memoryRoot, 'daily.md'))
  deleted += await removeIfExists(join(memoryRoot, 'daily.archive.md'))
  deleted += await removeIfExists(join(memoryRoot, 'sessions'))
  return deleted
}

function createLegacyMemory(input: {
  now: string
  sourceName: string
  title: string
  legacyType?: string
  summary: string
  content: string
}): CyreneMemory {
  const classification = classifyLegacyType(input.legacyType)
  const normalizedKey = normalizeKey(`${classification.domain}:${classification.type}:${input.summary || input.title}`)
  return {
    id: `legacy-${hashKey(normalizedKey)}`,
    domain: classification.domain,
    type: classification.type,
    strength: classification.strength,
    scope: classification.scope,
    status: 'active',
    content: input.content,
    normalizedKey,
    evidence: [
      {
        traceRefs: [`legacy:${input.sourceName}`],
        summary: `Migrated legacy MEMORY.md entry: ${input.summary || input.title}`
      }
    ],
    source: 'legacy_markdown',
    scores: {
      evidenceStrength: 0.72,
      stability: classification.strength === 'hard' ? 0.75 : 0.65,
      usefulness: 0.7,
      safety: 0.9,
      sensitivity: classification.domain === 'personal' || classification.domain === 'relationship' ? 0.35 : 0.1
    },
    createdAt: input.now,
    updatedAt: input.now,
    tags: ['legacy']
  }
}

function createLegacyEpisodeMemory(input: {
  now: string
  sourceName: string
  content: string
  evidenceSummary: string
}): CyreneMemory {
  const normalizedKey = normalizeKey(`legacy-episode:${input.sourceName}:${input.content.slice(0, 80)}`)
  return {
    id: `legacy-${hashKey(normalizedKey)}`,
    domain: 'personal',
    type: 'episode',
    strength: 'session',
    scope: 'session',
    status: 'active',
    content: input.content,
    normalizedKey,
    evidence: [{ traceRefs: [`legacy:${input.sourceName}`], summary: input.evidenceSummary }],
    source: 'legacy_markdown',
    scores: {
      evidenceStrength: 0.65,
      stability: 0.35,
      usefulness: 0.55,
      safety: 0.85,
      sensitivity: 0.3
    },
    createdAt: input.now,
    updatedAt: input.now,
    expiresAt: addDays(input.now, 7),
    decay: { enabled: true, halfLifeDays: 7 },
    tags: ['legacy', 'episode']
  }
}

function classifyLegacyType(value: string | undefined): {
  domain: MemoryDomain
  type: MemoryType
  strength: MemoryStrength
  scope: MemoryScope
} {
  switch (value) {
    case 'user':
      return { domain: 'personal', type: 'user_preference', strength: 'soft', scope: 'global' }
    case 'feedback':
      return { domain: 'relationship', type: 'interaction_style', strength: 'soft', scope: 'global' }
    case 'reference':
      return { domain: 'project', type: 'reference', strength: 'hard', scope: 'project' }
    case 'project':
    default:
      return { domain: 'project', type: 'project_fact', strength: 'hard', scope: 'project' }
  }
}

function parseLegacyIndexEntry(line: string): LegacyIndexEntry | null {
  const match = line.match(/^- \[([^\]]+)\]\(([^)]+)\) — (?:\[([^\]]+)\] )?(.+)$/)
  if (match === null) return null
  return {
    title: match[1] ?? '',
    file: match[2] ?? '',
    type: match[3],
    summary: match[4] ?? ''
  }
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    const stats = await lstat(filePath)
    if (stats.isSymbolicLink() || !stats.isFile()) return null
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) return null
    throw error
  }
}

async function removeIfExists(path: string): Promise<number> {
  try {
    await rm(path, { recursive: true, force: false })
    return 1
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) return 0
    throw error
  }
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
