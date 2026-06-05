import { access, readFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBenchmarkFixture, seededId, withFixtureEnvironment } from '../benchmark/fixtures.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { readActiveMemoriesFromRoot, readPendingMemoriesFromRoot } from '../src/memory/memory-store.js'

const fixtures: Array<Awaited<ReturnType<typeof createBenchmarkFixture>>> = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(async (fixture) => {
    await fixture.cleanup()
    await rm(fixture.metadata.root, { recursive: true, force: true })
  }))
})

describe('benchmark fixtures', () => {
  it('creates isolated HOME and memory roots with deterministic ids', async () => {
    const previousHome = process.env.HOME
    const originalTz = process.env.TZ
    process.env.TZ = 'Asia/Shanghai'
    try {
      const fixture = await createBenchmarkFixture({
        caseId: 'T0-MODE-FAST',
        seed: 'seed-a',
        now: '2026-06-05T00:00:00.000Z'
      })
      const sameSeedFixture = await createBenchmarkFixture({
        caseId: 'T0-MODE-FAST',
        seed: 'seed-a',
        now: '2026-06-05T00:00:00.000Z'
      })
      fixtures.push(fixture, sameSeedFixture)

      expect(fixture.home).toContain('cyrene-benchmark-')
      expect(fixture.cwd).toContain('cyrene-benchmark-project-')
      expect(fixture.globalMemoryRoot).toContain(fixture.home)
      expect(fixture.projectMemoryRoot).toContain(fixture.home)
      expect(fixture.now).toBe('2026-06-05T00:00:00.000Z')
      expect(fixture.timezone).toBe('UTC')
      expect(sameSeedFixture.home).not.toBe(fixture.home)
      expect(sameSeedFixture.projectId).toBe(fixture.projectId)
      expect(seededId('seed-a', 'memory')).toBe(seededId('seed-a', 'memory'))
      expect(seededId('seed-a', 'memory')).not.toBe(seededId('seed-a', 'other-memory'))

      await withFixtureEnvironment(fixture, async () => {
        const project = await identifyCodexProject(fixture.cwd)
        const fixtureCwd = await realpath(fixture.cwd)
        expect(project.projectId).toBe(fixture.projectId)
        expect(process.env.HOME).toBe(fixture.home)
        expect(process.env.TZ).toBe('UTC')
        expect(process.cwd()).toBe(fixtureCwd)
        expect(codexGlobalMemoryRoot()).toContain(fixture.home)
        expect(codexProjectMemoryRoot(project.projectId)).toContain(fixture.home)
      })

      expect(process.env.HOME).toBe(previousHome)
      expect(process.env.TZ).toBe('Asia/Shanghai')
      expect(process.cwd()).not.toBe(fixture.cwd)
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = originalTz
      }
    }
  })

  it('seeds active, pending, profile, fast summary, and SQLite paths inside fixture HOME', async () => {
    const fixture = await createBenchmarkFixture({
      caseId: 'T16-ROUTING-NAMESPACE',
      seed: 'seed-routing',
      now: '2026-06-05T00:00:00.000Z',
      activeMemories: [{ id: 'active-a', content: 'Fixture active memory stays isolated.' }],
      pendingMemories: [{ id: 'pending-a', content: 'Fixture pending memory stays isolated.' }],
      globalProfile: '# Fixture Global Profile\n',
      projectProfile: '# Fixture Project Profile\n',
      fastSummary: 'Fixture fast summary.'
    })
    fixtures.push(fixture)

    await expect(readFile(join(fixture.projectMemoryRoot, 'semantic_memories.jsonl'), 'utf8')).resolves.toContain(
      'Fixture active memory'
    )
    await expect(readFile(join(fixture.projectMemoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toContain(
      'Fixture pending memory'
    )
    await expect(readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).resolves.toEqual([
      expect.objectContaining({ id: 'active-a', content: 'Fixture active memory stays isolated.' })
    ])
    await expect(readPendingMemoriesFromRoot(fixture.projectMemoryRoot)).resolves.toEqual([
      expect.objectContaining({ id: 'pending-a', content: 'Fixture pending memory stays isolated.' })
    ])
    await expect(readFile(join(fixture.globalMemoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain(
      'Fixture Global Profile'
    )
    await expect(readFile(join(fixture.projectMemoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain(
      'Fixture Project Profile'
    )
    await expect(readFile(join(fixture.projectMemoryRoot, 'profile_fast_summary.md'), 'utf8')).resolves.toContain(
      'Fixture fast summary'
    )
    await expect(readFile(join(fixture.projectMemoryRoot, 'fast_summary_meta.json'), 'utf8')).resolves.toContain(
      '2026-06-05T00:00:00.000Z'
    )
    expect(fixture.memoryDbPath).toContain(fixture.home)
    expect(fixture.metadata).toMatchObject({
      root: expect.stringContaining('cyrene-benchmark-'),
      home: fixture.home,
      cwd: fixture.cwd,
      seed: 'seed-routing',
      clock: '2026-06-05T00:00:00.000Z',
      timezone: 'UTC',
      cleanupStatus: 'pending',
      preserveFixture: false
    })
  })

  it('seeds global scoped memory into the global memory root', async () => {
    const fixture = await createBenchmarkFixture({
      caseId: 'T16-ROUTING-NAMESPACE',
      seed: 'seed-global-routing',
      now: '2026-06-05T00:00:00.000Z',
      activeMemories: [
        { id: 'active-project', content: 'Project scoped memory stays local.', scope: 'project' },
        { id: 'active-global', content: 'Global scoped memory stays global.', scope: 'global' }
      ],
      pendingMemories: [
        { id: 'pending-project', content: 'Project pending stays local.', scope: 'project' },
        { id: 'pending-global', content: 'Global pending stays global.', scope: 'global' }
      ]
    })
    fixtures.push(fixture)

    await expect(readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).resolves.toEqual([
      expect.objectContaining({ id: 'active-project' })
    ])
    await expect(readActiveMemoriesFromRoot(fixture.globalMemoryRoot)).resolves.toEqual([
      expect.objectContaining({ id: 'active-global' })
    ])
    await expect(readPendingMemoriesFromRoot(fixture.projectMemoryRoot)).resolves.toEqual([
      expect.objectContaining({ id: 'pending-project' })
    ])
    await expect(readPendingMemoriesFromRoot(fixture.globalMemoryRoot)).resolves.toEqual([
      expect.objectContaining({ id: 'pending-global' })
    ])
  })

  it('removes normal fixtures and records cleaned status', async () => {
    const fixture = await createBenchmarkFixture({
      caseId: 'T4-PROFILE-MISSING',
      seed: 'seed-cleanup',
      now: '2026-06-05T00:00:00.000Z'
    })
    fixtures.push(fixture)

    await fixture.cleanup()

    expect(fixture.metadata.cleanupStatus).toBe('cleaned')
    await expect(access(fixture.metadata.root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('records cleanup and preserve status in fixture metadata', async () => {
    const fixture = await createBenchmarkFixture({
      caseId: 'T4-JSONL-CORRUPT',
      seed: 'seed-preserve',
      now: '2026-06-05T00:00:00.000Z',
      preserveFixture: true,
      preserveReason: 'debug failing fixture'
    })
    fixtures.push(fixture)

    await fixture.cleanup()

    expect(fixture.metadata.cleanupStatus).toBe('preserved')
    expect(fixture.metadata.preserveFixture).toBe(true)
    expect(fixture.metadata.preserveReason).toBe('debug failing fixture')
    await expect(access(fixture.metadata.root)).resolves.toBeUndefined()
  })

  it('requires an explicit reason when preserving a fixture', async () => {
    await expect(createBenchmarkFixture({
      caseId: 'T4-JSONL-CORRUPT',
      seed: 'seed-preserve-missing-reason',
      now: '2026-06-05T00:00:00.000Z',
      preserveFixture: true
    } as unknown as Parameters<typeof createBenchmarkFixture>[0])).rejects.toThrow(
      'Benchmark fixture preservation requires a non-empty preserveReason.'
    )

    await expect(createBenchmarkFixture({
      caseId: 'T4-JSONL-CORRUPT',
      seed: 'seed-preserve-empty-reason',
      now: '2026-06-05T00:00:00.000Z',
      preserveFixture: true,
      preserveReason: '   '
    })).rejects.toThrow('Benchmark fixture preservation requires a non-empty preserveReason.')
  })
})
