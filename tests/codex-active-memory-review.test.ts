import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  archiveCodexActiveMemory,
  contentHashForActiveMemory,
  proposeEditCodexActiveMemory,
  supersedeCodexActiveMemory,
  tombstoneCodexActiveMemory
} from '../src/codex/active-memory-review.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { reviewHashForPendingMemory } from '../src/codex/memory-review.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { renderMemoryProjectionsFromRoot } from '../src/memory/memory-exporter.js'
import type { CyreneMemory, MemoryEvent, MemoryTombstone, PendingMemory } from '../src/memory/types.js'

const originalHome = process.env.HOME
const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function active(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'active-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Active memory can be archived safely.',
    normalizedKey: 'active-memory-lifecycle',
    evidence: [{ runId: 'active-run-1', summary: 'Seed active memory.' }],
    source: 'file',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
    tags: ['lifecycle'],
    ...overrides
  }
}

function pending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'Existing pending memory.',
    normalizedKey: 'active-memory-lifecycle',
    evidence: [{ runId: 'pending-run-1', summary: 'Seed pending memory.' }],
    source: 'file',
    scores: {
      evidenceStrength: 0.9,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 1,
    firstSeenAt: '2026-05-30T00:00:00.000Z',
    lastSeenAt: '2026-05-30T00:00:00.000Z',
    expiresAt: '2026-06-29T00:00:00.000Z',
    tags: ['lifecycle'],
    ...overrides
  }
}

async function seed(cwd: string, memories: CyreneMemory[]): Promise<string> {
  const project = await identifyCodexProject(cwd)
  const root = codexProjectMemoryRoot(project.projectId)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'index.jsonl'), jsonlText(memories), 'utf8')
  return realpath(root)
}

async function seedGlobal(memories: CyreneMemory[]): Promise<string> {
  const root = codexGlobalMemoryRoot()
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'index.jsonl'), jsonlText(memories), 'utf8')
  return realpath(root)
}

function jsonl<T>(text: string): T[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

function jsonlText(values: unknown[]): string {
  return values.length === 0 ? '' : `${values.map((item) => JSON.stringify(item)).join('\n')}\n`
}

describe('Codex active memory lifecycle', () => {
  it('archives active memory without creating a blocking tombstone and refreshes projections', async () => {
    const home = await createTempDir('cyrene-active-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-active-project-')
    const memory = active()
    const root = await seed(cwd, [memory])
    await renderMemoryProjectionsFromRoot(root)
    await expect(readFile(join(root, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain(memory.content)

    const result = await archiveCodexActiveMemory({
      cwd,
      id: memory.id,
      contentHash: contentHashForActiveMemory(memory),
      reason: 'Stale.',
      now: '2026-05-30T01:00:00.000Z'
    })

    expect(result.result.action).toBe('archive')
    expect(result.memoryRoot).toBe(root)
    expect(await readFile(join(root, 'index.jsonl'), 'utf8')).toBe('')
    await expect(readFile(join(root, 'tombstones.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(root, 'MODEL_PROFILE.md'), 'utf8')).resolves.not.toContain(memory.content)
    const events = jsonl<MemoryEvent>(await readFile(join(root, 'events.jsonl'), 'utf8'))
    expect(events[0]).toMatchObject({ action: 'archive', memoryId: memory.id, reason: 'Stale.' })
  })

  it('archives global active memory from the global root before a same-id project memory', async () => {
    const home = await createTempDir('cyrene-active-global-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-active-global-project-')
    const memory = active({
      id: 'shared-active-1',
      scope: 'global',
      domain: 'procedural',
      type: 'procedural_rule',
      content: 'Global active memory wins root precedence.',
      normalizedKey: 'global-active-root'
    })
    const projectMemory = active({
      id: memory.id,
      content: 'Project memory with the same id remains untouched.',
      normalizedKey: 'project-active-root'
    })
    const globalRoot = await seedGlobal([memory])
    const projectRoot = await seed(cwd, [projectMemory])

    const result = await archiveCodexActiveMemory({
      cwd,
      id: memory.id,
      contentHash: contentHashForActiveMemory(memory),
      reason: 'Global stale.',
      now: '2026-05-30T01:00:00.000Z'
    })

    expect(result.result.action).toBe('archive')
    expect(result.memoryRoot).toBe(globalRoot)
    expect(await readFile(join(globalRoot, 'index.jsonl'), 'utf8')).toBe('')
    expect(await readFile(join(projectRoot, 'index.jsonl'), 'utf8')).toContain(projectMemory.content)
  })

  it('tombstones active memory with an expiring block', async () => {
    const home = await createTempDir('cyrene-tombstone-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-tombstone-project-')
    const memory = active()
    const root = await seed(cwd, [memory])

    const result = await tombstoneCodexActiveMemory({
      cwd,
      id: memory.id,
      contentHash: contentHashForActiveMemory(memory),
      reason: 'Wrong memory.',
      days: 180,
      now: '2026-05-30T01:00:00.000Z'
    })

    expect(result.result.action).toBe('tombstone')
    const tombstones = jsonl<MemoryTombstone>(await readFile(join(root, 'tombstones.jsonl'), 'utf8'))
    expect(tombstones[0]).toMatchObject({
      memoryId: memory.id,
      normalizedKey: memory.normalizedKey,
      reason: 'archived'
    })
    expect(tombstones[0]?.expiresAt).toBe('2026-11-26T01:00:00.000Z')
    const events = jsonl<MemoryEvent>(await readFile(join(root, 'events.jsonl'), 'utf8'))
    expect(events[0]).toMatchObject({
      action: 'archive',
      memoryId: memory.id,
      details: expect.objectContaining({ reviewAction: 'tombstone' })
    })
  })

  it('proposes active edit as a distinct pending replacement', async () => {
    const home = await createTempDir('cyrene-propose-edit-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-propose-edit-project-')
    const memory = active({ candidateKind: 'project_decision' })
    const existing = pending({ id: 'existing-same-key' })
    const root = await seed(cwd, [memory])
    await writeFile(join(root, 'pending.jsonl'), jsonlText([existing]), 'utf8')

    const result = await proposeEditCodexActiveMemory({
      cwd,
      id: memory.id,
      contentHash: contentHashForActiveMemory(memory),
      content: 'Updated replacement memory.',
      reason: 'Clarify wording.',
      now: '2026-05-30T01:00:00.000Z'
    })

    expect(result.result.action).toBe('propose_edit')
    const pendingMemories = jsonl<PendingMemory>(await readFile(join(root, 'pending.jsonl'), 'utf8'))
    expect(pendingMemories).toHaveLength(2)
    expect(pendingMemories[0]).toMatchObject({ id: existing.id, content: existing.content })
    expect(pendingMemories[1]).toMatchObject({
      content: 'Updated replacement memory.',
      normalizedKey: memory.normalizedKey,
      candidateKind: 'project_decision',
      source: memory.source,
      evidence: memory.evidence,
      conflictsWith: [memory.id]
    })
    if (result.result.action !== 'propose_edit') throw new Error('expected propose_edit')
    expect(result.result.reviewHash).toBe(reviewHashForPendingMemory(pendingMemories[1] as PendingMemory))
  })

  it('supersedes active memory with a pending replacement and refreshes projections', async () => {
    const home = await createTempDir('cyrene-supersede-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-supersede-project-')
    const memory = active()
    const root = await seed(cwd, [memory])
    const proposed = await proposeEditCodexActiveMemory({
      cwd,
      id: memory.id,
      contentHash: contentHashForActiveMemory(memory),
      content: 'Replacement active memory.',
      reason: 'Replace.',
      now: '2026-05-30T01:00:00.000Z'
    })
    if (proposed.result.action !== 'propose_edit') throw new Error('expected propose_edit')

    const result = await supersedeCodexActiveMemory({
      cwd,
      id: memory.id,
      candidateId: proposed.result.candidateId,
      contentHash: contentHashForActiveMemory(memory),
      reviewHash: proposed.result.reviewHash,
      reason: 'Accept replacement.',
      now: '2026-05-30T02:00:00.000Z'
    })

    expect(result.result.action).toBe('supersede')
    const activeLines = jsonl<CyreneMemory>(await readFile(join(root, 'index.jsonl'), 'utf8'))
    expect(activeLines.map((item) => item.content)).toEqual(['Replacement active memory.'])
    expect(activeLines[0]?.supersedes).toEqual([memory.id])
    expect(await readFile(join(root, 'pending.jsonl'), 'utf8')).toBe('')
    const tombstones = jsonl<MemoryTombstone>(await readFile(join(root, 'tombstones.jsonl'), 'utf8'))
    expect(tombstones[0]).toMatchObject({
      memoryId: memory.id,
      reason: 'superseded',
      replacementMemoryId: activeLines[0]?.id
    })
    await expect(readFile(join(root, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain('Replacement active memory.')
  })

  it('rejects supersede when the pending candidate is not linked to the active memory', async () => {
    const home = await createTempDir('cyrene-unlinked-supersede-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-unlinked-supersede-project-')
    const memory = active()
    const replacement = pending({
      id: 'unlinked-replacement',
      content: 'Unlinked replacement should not supersede active memory.',
      normalizedKey: memory.normalizedKey,
      conflictsWith: ['some-other-memory']
    })
    const root = await seed(cwd, [memory])
    await writeFile(join(root, 'pending.jsonl'), jsonlText([replacement]), 'utf8')

    const result = await supersedeCodexActiveMemory({
      cwd,
      id: memory.id,
      candidateId: replacement.id,
      contentHash: contentHashForActiveMemory(memory),
      reviewHash: reviewHashForPendingMemory(replacement),
      reason: 'Wrong replacement.',
      now: '2026-05-30T02:00:00.000Z'
    })

    expect(result.result).toMatchObject({
      action: 'conflict',
      reason: 'Pending replacement is not linked to the active memory'
    })
    expect(await readFile(join(root, 'index.jsonl'), 'utf8')).toContain(memory.content)
    expect(await readFile(join(root, 'pending.jsonl'), 'utf8')).toContain(replacement.content)
  })

  it('rejects supersede when the replacement normalized key conflicts with another active memory', async () => {
    const home = await createTempDir('cyrene-supersede-key-conflict-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-supersede-key-conflict-project-')
    const memory = active({ id: 'target-active', normalizedKey: 'target-key' })
    const other = active({
      id: 'other-active',
      content: 'Other active memory keeps this normalized key.',
      normalizedKey: 'other-key'
    })
    const replacement = pending({
      id: 'replacement-key-conflict',
      content: 'Replacement conflicts with another active memory key.',
      normalizedKey: other.normalizedKey,
      conflictsWith: [memory.id]
    })
    const root = await seed(cwd, [memory, other])
    await writeFile(join(root, 'pending.jsonl'), jsonlText([replacement]), 'utf8')

    const result = await supersedeCodexActiveMemory({
      cwd,
      id: memory.id,
      candidateId: replacement.id,
      contentHash: contentHashForActiveMemory(memory),
      reviewHash: reviewHashForPendingMemory(replacement),
      reason: 'Conflicting replacement.',
      now: '2026-05-30T02:00:00.000Z'
    })

    expect(result.result).toMatchObject({
      action: 'conflict',
      reason: 'Replacement normalizedKey conflicts with another active memory'
    })
    const activeLines = await readFile(join(root, 'index.jsonl'), 'utf8')
    expect(activeLines).toContain(memory.content)
    expect(activeLines).toContain(other.content)
    expect(activeLines).not.toContain(replacement.content)
    expect(await readFile(join(root, 'pending.jsonl'), 'utf8')).toContain(replacement.content)
  })

  it('returns conflict and does not mutate when the active content hash is stale', async () => {
    const home = await createTempDir('cyrene-active-conflict-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-active-conflict-project-')
    const reviewed = active()
    const changed = active({ content: 'Active memory changed after review.' })
    const root = await seed(cwd, [changed])

    const result = await archiveCodexActiveMemory({
      cwd,
      id: changed.id,
      contentHash: contentHashForActiveMemory(reviewed),
      reason: 'Stale.',
      now: '2026-05-30T01:00:00.000Z'
    })

    expect(result.result.action).toBe('conflict')
    expect(await readFile(join(root, 'index.jsonl'), 'utf8')).toContain(changed.content)
    await expect(readFile(join(root, 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects unsafe supersede candidates before activation', async () => {
    const home = await createTempDir('cyrene-unsafe-supersede-home-')
    vi.stubEnv('HOME', home)
    const cwd = await createTempDir('cyrene-unsafe-supersede-project-')
    const memory = active()
    const root = await seed(cwd, [memory])
    const unsafe = pending({
      id: 'unsafe-replacement',
      content: 'The user is emotionally dependent and unstable.',
      normalizedKey: memory.normalizedKey,
      conflictsWith: [memory.id]
    })
    await writeFile(join(root, 'pending.jsonl'), jsonlText([unsafe]), 'utf8')

    const result = await supersedeCodexActiveMemory({
      cwd,
      id: memory.id,
      candidateId: unsafe.id,
      contentHash: contentHashForActiveMemory(memory),
      reviewHash: reviewHashForPendingMemory(unsafe),
      reason: 'Reject unsafe replacement.',
      now: '2026-05-30T02:00:00.000Z'
    })

    expect(result.result).toMatchObject({
      action: 'rejected_by_validator',
      candidateId: unsafe.id,
      reason: 'Affective memory cannot contain diagnostic claims'
    })
    expect(await readFile(join(root, 'index.jsonl'), 'utf8')).toContain(memory.content)
    expect(await readFile(join(root, 'pending.jsonl'), 'utf8')).toContain(unsafe.content)
    await expect(readFile(join(root, 'tombstones.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
