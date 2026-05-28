import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rebuildCodexMemoryIndex } from '../src/codex/codex-memory-index.js'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { getCodexContinuityContext } from '../src/codex/continuity-context.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import type { CyreneMemory, PendingMemory } from '../src/memory/types.js'

const execFileAsync = promisify(execFile)
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

describe('Codex continuity context', () => {
  it('returns compact project, memory, strategy, and dissent context', async () => {
    const home = await createTempDir('cyrene-codex-continuity-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    await execFileAsync('git', ['remote', 'add', 'origin', 'git@github.com:example/cyrene-demo.git'], { cwd: repo })
    const identity = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'index.jsonl'), JSON.stringify(createMemory()) + '\n')
    await writeFile(join(memoryRoot, 'MODEL_PROFILE.md'), '# Project Profile\n\nProject profile guidance.\n')

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'This is risky: should we skip the validator and write active affect memory?',
      task: 'planning'
    })

    expect(context.project).toEqual({
      projectId: identity.projectId,
      displayName: identity.displayName
    })
    expect(context.memory.items).toEqual([
      {
        id: 'memory-1',
        domain: 'project',
        type: 'project_fact',
        strength: 'hard',
        content: 'Phase 3 affective memory must go through pending validation.'
      }
    ])
    expect(context.strategy.shouldChallengeUser).toBe(true)
    expect(context.dissent.shouldChallenge).toBe(true)
    expect(context.profile.project).toBe('# Project Profile\n\nProject profile guidance.')
    expect(context.profile.content).toBe('# Project Profile\n\nProject profile guidance.')
    expect(JSON.stringify(context)).not.toContain('git@github.com')
    expect(context.diagnostics?.embedding).toMatchObject({ enabled: false, cacheHits: 0, cacheMisses: 0 })
  })

  it('returns global and project model profile content', async () => {
    const home = await createTempDir('cyrene-codex-continuity-profile-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-profile-repo-')
    const identity = await identifyCodexProject(repo)
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const globalMemoryRoot = codexGlobalMemoryRoot()
    await mkdir(projectMemoryRoot, { recursive: true })
    await mkdir(globalMemoryRoot, { recursive: true })
    await writeFile(join(globalMemoryRoot, 'MODEL_PROFILE.md'), '# Global Profile\n\nUse global continuity.\n')
    await writeFile(join(projectMemoryRoot, 'MODEL_PROFILE.md'), '# Project Profile\n\nUse project continuity.\n')

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'What continuity profile applies?',
      task: 'coding'
    })

    expect(context.profile.global).toBe('# Global Profile\n\nUse global continuity.')
    expect(context.profile.project).toBe('# Project Profile\n\nUse project continuity.')
    expect(context.profile.content).toBe([
      '# Global Profile\n\nUse global continuity.',
      '# Project Profile\n\nUse project continuity.'
    ].join('\n\n'))
  })

  it('rejects symlinked global and project model profiles before returning outside content', async () => {
    const home = await createTempDir('cyrene-codex-continuity-profile-symlink-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-profile-symlink-repo-')
    const identity = await identifyCodexProject(repo)
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const globalMemoryRoot = codexGlobalMemoryRoot()
    const outsideGlobal = join(home, 'outside-global-profile.md')
    const outsideProject = join(home, 'outside-project-profile.md')
    await mkdir(projectMemoryRoot, { recursive: true })
    await mkdir(globalMemoryRoot, { recursive: true })
    await writeFile(outsideGlobal, 'Outside global profile must not be returned.\n')
    await writeFile(outsideProject, 'Outside project profile must not be returned.\n')
    await symlink(outsideGlobal, join(globalMemoryRoot, 'MODEL_PROFILE.md'))
    await symlink(outsideProject, join(projectMemoryRoot, 'MODEL_PROFILE.md'))

    await expect(getCodexContinuityContext({
      cwd: repo,
      userMessage: 'What continuity profile applies?',
      task: 'coding'
    })).rejects.toThrow(/Refusing.*symlink|symlink/i)
  })

  it('includes global active memory from the Codex global memory root in any project context', async () => {
    const home = await createTempDir('cyrene-codex-continuity-global-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-global-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    await execFileAsync('git', ['remote', 'add', 'origin', 'git@github.com:example/other-project.git'], { cwd: repo })
    const identity = await identifyCodexProject(repo)
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const globalMemoryRoot = join(home, '.cyrene', 'codex', 'global', 'memory')
    await mkdir(projectMemoryRoot, { recursive: true })
    await mkdir(globalMemoryRoot, { recursive: true })
    await writeFile(join(projectMemoryRoot, 'index.jsonl'), JSON.stringify(createMemory()) + '\n')
    await writeFile(
      join(globalMemoryRoot, 'index.jsonl'),
      JSON.stringify(createMemory({
        id: 'global-memory-1',
        domain: 'procedural',
        type: 'procedural_rule',
        scope: 'global',
        content: 'Specs and plans default to Chinese in all projects.',
        normalizedKey: 'global-spec-plan-chinese'
      })) + '\n'
    )

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'For this Phase memory spec plan, what durable workflow rules apply?',
      task: 'planning'
    })

    expect(context.memory.items.map((item) => item.content)).toEqual(
      expect.arrayContaining([
        'Phase 3 affective memory must go through pending validation.',
        'Specs and plans default to Chinese in all projects.'
      ])
    )
  })

  it('returns strategy when no Codex memory exists yet', async () => {
    const home = await createTempDir('cyrene-codex-continuity-empty-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-empty-repo-')

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'Summarize this repo.',
      task: 'coding'
    })

    expect(context.project.projectId).toMatch(/^[a-f0-9]{16}$/)
    expect(context.memory.items).toEqual([])
    expect(context.strategy.tone).toBeDefined()
    expect(context.dissent.mode).toBeDefined()
  })

  it('returns pending review notice without exposing pending content as active memory', async () => {
    const home = await createTempDir('cyrene-codex-continuity-pending-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-pending-repo-')
    const identity = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const pending = createPendingMemory()
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), JSON.stringify(pending) + '\n')

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'Review pending memory.',
      task: 'memory'
    })

    expect(context.pendingReview).toEqual({
      count: 1,
      hasItems: true,
      newestCandidateId: pending.id,
      newestPreview: pending.content
    })
    expect(context.memory.items).toEqual([])
    expect(context.profile.content).not.toContain(pending.content)
  })

  it('returns pending review notice for global pending without exposing it as active memory', async () => {
    const home = await createTempDir('cyrene-codex-continuity-global-pending-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-global-pending-repo-')
    const globalMemoryRoot = codexGlobalMemoryRoot()
    const pending = {
      ...createPendingMemory(),
      id: 'global-pending-review',
      scope: 'global' as const,
      content: 'Global pending memory should show only as pending review notice.'
    }
    await mkdir(globalMemoryRoot, { recursive: true })
    await writeFile(join(globalMemoryRoot, 'pending.jsonl'), JSON.stringify(pending) + '\n')

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'Check pending review.',
      task: 'memory'
    })

    expect(context.pendingReview).toMatchObject({
      count: 1,
      hasItems: true,
      newestCandidateId: pending.id
    })
    expect(context.memory.items).toEqual([])
    expect(JSON.stringify(context.memory)).not.toContain(pending.content)
    expect(context.profile.content).not.toContain(pending.content)
  })

  it('marks overdue dream state due without running deep promotion', async () => {
    const home = await createTempDir('cyrene-codex-continuity-dream-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-dream-repo-')
    const identity = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const pending = createPendingMemory()
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), JSON.stringify({
      ...pending,
      domain: 'procedural',
      type: 'procedural_rule',
      strength: 'hard',
      content: 'This promotable pending memory must not be activated by continuity get.',
      normalizedKey: 'continuity-get-does-not-run-deep',
      source: 'user_explicit',
      seenCount: 2,
      evidence: [
        { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
        { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
      ]
    }) + '\n')
    await writeFile(
      join(memoryRoot, 'dream-state.json'),
      JSON.stringify({ dreamDue: false, nextDreamDueAt: '2000-01-01T00:00:00.000Z' }) + '\n'
    )

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'Read continuity context only.',
      task: 'memory'
    })

    const state = JSON.parse(await readFile(join(memoryRoot, 'dream-state.json'), 'utf8')) as { dreamDue: boolean }
    expect(state.dreamDue).toBe(true)
    await expect(readFile(join(memoryRoot, 'index.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.stringify(context)).not.toContain('nextDreamDueAt')
  })

  it('returns routed global and project memory digest sections', async () => {
    const home = await createTempDir('cyrene-codex-continuity-router-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-router-repo-')
    const identity = await identifyCodexProject(repo)
    const globalMemoryRoot = codexGlobalMemoryRoot()
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(globalMemoryRoot, { recursive: true })
    await mkdir(projectMemoryRoot, { recursive: true })
    await writeFile(join(globalMemoryRoot, 'index.jsonl'), JSON.stringify(createMemory({
      id: 'global-router-memory',
      scope: 'global',
      domain: 'procedural',
      content: 'Global continuity router guidance applies across projects.',
      normalizedKey: 'global-continuity-router-guidance'
    })) + '\n')
    await writeFile(join(projectMemoryRoot, 'index.jsonl'), JSON.stringify(createMemory({
      id: 'project-router-memory',
      content: 'Project continuity router fact stays local.',
      normalizedKey: 'project-continuity-router-local'
    })) + '\n')

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'router continuity guidance local project',
      task: 'planning'
    })

    expect(context.globalMemory.map((item) => item.id)).toEqual(['global-router-memory'])
    expect(context.projectMemory.map((item) => item.id)).toEqual(['project-router-memory'])
    expect(context.similarProjectHints).toEqual([])
    expect(context.responseStrategy.challengePolicy).toBeDefined()
    expect(context.memory.items.map((item) => item.id)).toEqual(
      expect.arrayContaining(['global-router-memory', 'project-router-memory'])
    )
  })

  it('keeps current and global indexed retrieval when all-project root scanning hits an unsafe unrelated project', async () => {
    const home = await createTempDir('cyrene-codex-continuity-unsafe-scan-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-unsafe-scan-repo-')
    const outsideMemory = await createTempDir('cyrene-codex-continuity-outside-memory-')
    const identity = await identifyCodexProject(repo)
    const globalMemoryRoot = codexGlobalMemoryRoot()
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const unsafeProjectRoot = join(home, '.cyrene', 'codex', 'projects', 'unsafe-unrelated-project')
    await mkdir(globalMemoryRoot, { recursive: true })
    await mkdir(projectMemoryRoot, { recursive: true })
    await mkdir(unsafeProjectRoot, { recursive: true })
    await symlink(outsideMemory, join(unsafeProjectRoot, 'memory'))
    await writeFile(join(globalMemoryRoot, 'index.jsonl'), JSON.stringify(createMemory({
      id: 'global-unsafe-scan-memory',
      scope: 'global',
      domain: 'procedural',
      content: 'Global unsafe scan guidance should still be indexed.',
      normalizedKey: 'global-unsafe-scan-guidance'
    })) + '\n')
    await writeFile(join(projectMemoryRoot, 'index.jsonl'), JSON.stringify(createMemory({
      id: 'project-unsafe-scan-memory',
      content: 'Project unsafe scan memory should still be indexed.',
      normalizedKey: 'project-unsafe-scan-memory'
    })) + '\n')

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'unsafe scan guidance project memory',
      task: 'planning'
    })

    expect(context.diagnostics?.memoryIndex?.available).toBe(true)
    expect(context.globalMemory.map((item) => item.id)).toEqual(['global-unsafe-scan-memory'])
    expect(context.projectMemory.map((item) => item.id)).toEqual(['project-unsafe-scan-memory'])
  })

  it('filters expired and non-memory session records from routed active memory', async () => {
    const home = await createTempDir('cyrene-codex-continuity-router-eligibility-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-router-eligibility-repo-')
    const identity = await identifyCodexProject(repo)
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(projectMemoryRoot, { recursive: true })
    await writeFile(
      join(projectMemoryRoot, 'index.jsonl'),
      [
        createMemory({
          id: 'project-router-valid',
          content: 'Project router valid memory remains visible.',
          normalizedKey: 'project-router-valid'
        }),
        createMemory({
          id: 'project-router-expired-session',
          strength: 'session',
          scope: 'session',
          content: 'Expired session router memory must not enter coding digest.',
          normalizedKey: 'expired-session-router-memory',
          expiresAt: '2000-01-01T00:00:00.000Z'
        })
      ].map((memory) => JSON.stringify(memory)).join('\n') + '\n'
    )

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'router memory',
      task: 'coding'
    })

    expect(context.projectMemory.map((item) => item.id)).toEqual(['project-router-valid'])
    expect(context.memory.items.map((item) => item.id)).not.toContain('project-router-expired-session')
  })

  it('applies routed active eligibility before SQLite result budgeting', async () => {
    const home = await createTempDir('cyrene-codex-continuity-router-budget-eligibility-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-router-budget-eligibility-repo-')
    const identity = await identifyCodexProject(repo)
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const expired = Array.from({ length: 12 }, (_, index) => createMemory({
      id: `project-router-expired-session-${index}`,
      strength: 'session',
      scope: 'session',
      content: `Router budget expired session memory ${index} must not consume SQLite selection slots.`,
      normalizedKey: `router-budget-expired-session-${index}`,
      expiresAt: '2000-01-01T00:00:00.000Z'
    }))
    await mkdir(projectMemoryRoot, { recursive: true })
    await writeFile(
      join(projectMemoryRoot, 'index.jsonl'),
      [
        ...expired,
        createMemory({
          id: 'project-router-budget-valid',
          content: 'Router budget valid memory should remain visible.',
          normalizedKey: 'router-budget-valid',
          scores: {
            evidenceStrength: 0.1,
            stability: 0.1,
            usefulness: 0.1,
            safety: 0.1,
            sensitivity: 0.9
          }
        })
      ].map((memory) => JSON.stringify(memory)).join('\n') + '\n'
    )

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'router budget memory',
      task: 'coding'
    })

    expect(context.projectMemory.map((item) => item.id)).toEqual(['project-router-budget-valid'])
  })

  it('returns pending hypotheses as provisional without mixing them into active memory', async () => {
    const home = await createTempDir('cyrene-codex-continuity-router-pending-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-router-pending-repo-')
    const identity = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const pending = createPendingMemory()
    await mkdir(memoryRoot, { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), JSON.stringify({
      ...pending,
      content: 'Pending router candidate can guide clarification only.',
      normalizedKey: 'pending-router-clarification-only'
    }) + '\n')

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'pending router clarification',
      task: 'memory'
    })

    expect(context.pendingHypotheses).toHaveLength(1)
    expect(context.pendingHypotheses[0]).toMatchObject({
      id: pending.id,
      provisional: true,
      status: 'pending'
    })
    expect(context.memory.items).toEqual([])
    expect(context.profile.content).not.toContain('Pending router candidate can guide clarification only.')
  })

  it('returns pending hypotheses from JSONL fallback when SQLite is unavailable', async () => {
    const home = await createTempDir('cyrene-codex-continuity-router-fallback-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-router-fallback-repo-')
    const identity = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const pending = createPendingMemory()
    await mkdir(memoryRoot, { recursive: true })
    await mkdir(join(home, '.cyrene', 'codex', 'memory.db'), { recursive: true })
    await writeFile(join(memoryRoot, 'pending.jsonl'), JSON.stringify({
      ...pending,
      content: 'Fallback pending router candidate remains visible.',
      normalizedKey: 'fallback-pending-router-candidate'
    }) + '\n')

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'fallback pending router candidate',
      task: 'memory'
    })

    expect(context.diagnostics?.memoryIndex?.available).toBe(false)
    expect(context.pendingHypotheses).toEqual([
      expect.objectContaining({
        id: pending.id,
        provisional: true,
        status: 'pending'
      })
    ])
    expect(context.memory.items).toEqual([])
  })

  it('does not rebuild stale memory index from continuity read path', async () => {
    const home = await createTempDir('cyrene-codex-continuity-stale-readonly-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-stale-readonly-repo-')
    const identity = await identifyCodexProject(repo)
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const dbPath = join(home, '.cyrene', 'codex', 'memory.db')
    const sourcePath = join(projectMemoryRoot, 'index.jsonl')
    await mkdir(projectMemoryRoot, { recursive: true })
    await mkdir(join(home, '.cyrene', 'codex'), { recursive: true })
    await writeFile(dbPath, '')
    await writeFile(sourcePath, JSON.stringify(createMemory({
      id: 'stale-readonly-memory',
      content: 'Stale readonly memory should be returned through JSONL fallback.',
      normalizedKey: 'stale-readonly-memory'
    })) + '\n')
    await utimes(dbPath, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'))
    await utimes(sourcePath, new Date('2026-01-02T00:00:00.000Z'), new Date('2026-01-02T00:00:00.000Z'))
    const before = await stat(dbPath)

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'stale readonly memory',
      task: 'coding'
    })

    const after = await stat(dbPath)
    const memoryIndex = context.diagnostics?.memoryIndex as Record<string, unknown> | undefined
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(context.projectMemory.map((item) => item.id)).toEqual(['stale-readonly-memory'])
    expect(memoryIndex).toMatchObject({
      freshness: 'stale',
      source: 'jsonl',
      routes: ['global', 'project', 'pending']
    })
    expect(String(memoryIndex?.staleReason)).toContain('indexed source is newer')
  })

  it('keeps JSONL fallback pending memory provisional without creating the index', async () => {
    const home = await createTempDir('cyrene-codex-continuity-pending-fallback-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-continuity-pending-fallback-repo-')
    const identity = await identifyCodexProject(repo)
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const pending = createPendingMemory()
    await mkdir(projectMemoryRoot, { recursive: true })
    await writeFile(join(projectMemoryRoot, 'pending.jsonl'), JSON.stringify({
      ...pending,
      content: 'Pending fallback candidate must remain provisional.',
      normalizedKey: 'pending-fallback-provisional'
    }) + '\n')

    const context = await getCodexContinuityContext({
      cwd: repo,
      userMessage: 'pending fallback provisional',
      task: 'memory'
    })

    const memoryIndex = context.diagnostics?.memoryIndex as Record<string, unknown> | undefined
    await expect(readFile(join(home, '.cyrene', 'codex', 'memory.db'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(context.pendingHypotheses).toEqual([
      expect.objectContaining({
        id: pending.id,
        provisional: true,
        status: 'pending'
      })
    ])
    expect(context.memory.items).toEqual([])
    expect(context.projectMemory).toEqual([])
    expect(memoryIndex).toMatchObject({
      freshness: 'stale',
      source: 'jsonl',
      fallbackMode: 'sqlite'
    })
  })

  it('returns eligible similar-project hints without mixing them into active memory', async () => {
    const home = await createTempDir('cyrene-codex-continuity-similar-home-')
    process.env.HOME = home
    const currentRepo = await createTempDir('cyrene-codex-current-similar-repo-')
    const otherRepo = await createTempDir('cyrene-codex-other-similar-repo-')
    await writeFile(join(currentRepo, 'package.json'), JSON.stringify({
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      devDependencies: { typescript: '^5.0.0', vitest: '^2.0.0' }
    }), 'utf8')
    await writeFile(join(currentRepo, 'package-lock.json'), '{}\n', 'utf8')
    await writeFile(join(otherRepo, 'package.json'), JSON.stringify({
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      devDependencies: { typescript: '^5.0.0', vitest: '^2.0.0' }
    }), 'utf8')
    await writeFile(join(otherRepo, 'package-lock.json'), '{}\n', 'utf8')
    const current = await identifyCodexProject(currentRepo)
    const other = await identifyCodexProject(otherRepo)
    const currentRoot = codexProjectMemoryRoot(current.projectId)
    const otherRoot = codexProjectMemoryRoot(other.projectId)
    await mkdir(currentRoot, { recursive: true })
    await mkdir(otherRoot, { recursive: true })
    await writeFile(join(currentRoot, 'index.jsonl'), JSON.stringify(createMemory({
      id: 'current-project-fact',
      content: 'Current project exact fact stays in project memory.',
      normalizedKey: 'current-project-fact'
    })) + '\n')
    await writeFile(join(otherRoot, 'index.jsonl'), [
      JSON.stringify(createMemory({
        id: 'portable-similar-hint',
        domain: 'procedural',
        type: 'procedural_rule',
        portability: 'similar_project',
        content: 'MCP plugin projects should keep generated runtime rebuilds explicit.',
        normalizedKey: 'mcp-plugin-runtime-rebuild',
        tags: ['mcp', 'plugin']
      })),
      JSON.stringify(createMemory({
        id: 'other-local-only',
        domain: 'procedural',
        type: 'procedural_rule',
        portability: 'local_only',
        content: 'Other project local-only detail must not appear.',
        normalizedKey: 'other-local-only'
      }))
    ].join('\n') + '\n')

    await rebuildCodexMemoryIndex({ cwd: otherRepo })
    await rebuildCodexMemoryIndex({ cwd: currentRepo })
    const context = await getCodexContinuityContext({
      cwd: currentRepo,
      userMessage: 'For this MCP plugin runtime rebuild, what transferable guidance applies?',
      task: 'planning'
    })

    expect(context.similarProjectHints).toEqual([
      expect.objectContaining({
        id: 'portable-similar-hint',
        sourceProjectId: other.projectId,
        sourceProjectName: other.displayName,
        portability: 'similar_project',
        transferable: true,
        notCurrentProjectFact: true
      })
    ])
    expect(context.memory.items.map((item) => item.id)).toContain('current-project-fact')
    expect(context.memory.items.map((item) => item.id)).not.toContain('portable-similar-hint')
    expect(JSON.stringify(context)).not.toContain('other-local-only')
    expect(context.diagnostics?.projectSimilarity?.selectedProjects).toBeGreaterThanOrEqual(1)
    expect(context.diagnostics?.evalGate?.passed).toBe(true)
  })

  it('returns valid similar-project hints when an unrelated project memory root is unsafe', async () => {
    const home = await createTempDir('cyrene-codex-continuity-similar-unsafe-entry-home-')
    process.env.HOME = home
    const currentRepo = await createTempDir('cyrene-codex-current-similar-unsafe-entry-repo-')
    const otherRepo = await createTempDir('cyrene-codex-other-similar-unsafe-entry-repo-')
    const outsideMemory = await createTempDir('cyrene-codex-similar-unsafe-entry-outside-memory-')
    await writeFile(join(currentRepo, 'package.json'), JSON.stringify({
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      devDependencies: { typescript: '^5.0.0', vitest: '^2.0.0' }
    }), 'utf8')
    await writeFile(join(currentRepo, 'package-lock.json'), '{}\n', 'utf8')
    await writeFile(join(otherRepo, 'package.json'), JSON.stringify({
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      devDependencies: { typescript: '^5.0.0', vitest: '^2.0.0' }
    }), 'utf8')
    await writeFile(join(otherRepo, 'package-lock.json'), '{}\n', 'utf8')
    const current = await identifyCodexProject(currentRepo)
    const other = await identifyCodexProject(otherRepo)
    const currentRoot = codexProjectMemoryRoot(current.projectId)
    const otherRoot = codexProjectMemoryRoot(other.projectId)
    const unsafeProjectRoot = join(home, '.cyrene', 'codex', 'projects', 'unsafe-similar-unrelated-project')
    await mkdir(currentRoot, { recursive: true })
    await mkdir(otherRoot, { recursive: true })
    await mkdir(unsafeProjectRoot, { recursive: true })
    await symlink(outsideMemory, join(unsafeProjectRoot, 'memory'))
    await writeFile(join(currentRoot, 'index.jsonl'), JSON.stringify(createMemory({
      id: 'current-safe-similar-entry',
      content: 'Current project safe similar entry fact stays local.',
      normalizedKey: 'current-safe-similar-entry'
    })) + '\n')
    await writeFile(join(otherRoot, 'index.jsonl'), JSON.stringify(createMemory({
      id: 'portable-safe-similar-entry',
      domain: 'procedural',
      type: 'procedural_rule',
      portability: 'similar_project',
      content: 'MCP plugin projects should keep runtime rebuild checks explicit.',
      normalizedKey: 'mcp-plugin-runtime-rebuild-checks',
      tags: ['mcp', 'plugin']
    })) + '\n')

    await rebuildCodexMemoryIndex({ cwd: otherRepo })
    await rebuildCodexMemoryIndex({ cwd: currentRepo })
    const context = await getCodexContinuityContext({
      cwd: currentRepo,
      userMessage: 'For this MCP plugin runtime rebuild, what transferable guidance applies?',
      task: 'planning'
    })

    expect(context.diagnostics?.memoryIndex?.available).toBe(true)
    expect(context.similarProjectHints).toEqual([
      expect.objectContaining({
        id: 'portable-safe-similar-entry',
        sourceProjectId: other.projectId,
        sourceProjectName: other.displayName
      })
    ])
    expect(context.memory.items.map((item) => item.id)).not.toContain('portable-safe-similar-entry')
  })

  it('returns empty similar-project hints when eval gate detects unsafe content', async () => {
    const home = await createTempDir('cyrene-codex-continuity-similar-unsafe-home-')
    process.env.HOME = home
    const currentRepo = await createTempDir('cyrene-codex-current-unsafe-repo-')
    const otherRepo = await createTempDir('cyrene-codex-other-unsafe-repo-')
    await writeFile(join(currentRepo, 'package.json'), JSON.stringify({
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      devDependencies: { typescript: '^5.0.0' }
    }), 'utf8')
    await writeFile(join(otherRepo, 'package.json'), JSON.stringify({
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      devDependencies: { typescript: '^5.0.0' }
    }), 'utf8')
    const current = await identifyCodexProject(currentRepo)
    const other = await identifyCodexProject(otherRepo)
    const otherRoot = codexProjectMemoryRoot(other.projectId)
    await mkdir(codexProjectMemoryRoot(current.projectId), { recursive: true })
    await mkdir(otherRoot, { recursive: true })
    await writeFile(join(otherRoot, 'index.jsonl'), JSON.stringify(createMemory({
      id: 'unsafe-similar-hint',
      domain: 'procedural',
      type: 'procedural_rule',
      portability: 'similar_project',
      content: 'Use /Users/phoenix/private/project/config.json for this plugin.',
      normalizedKey: 'unsafe-path-similar-hint',
      tags: ['mcp']
    })) + '\n')

    await rebuildCodexMemoryIndex({ cwd: otherRepo })
    await rebuildCodexMemoryIndex({ cwd: currentRepo })
    const context = await getCodexContinuityContext({
      cwd: currentRepo,
      userMessage: 'What MCP plugin guidance applies?',
      task: 'planning'
    })

    expect(context.similarProjectHints).toEqual([])
    expect(context.diagnostics?.evalGate).toMatchObject({
      passed: false,
      failedChecks: ['similar_hint_boundary_eval']
    })
  })

  it('reports when indexed projects exist but no similar projects are selected', async () => {
    const home = await createTempDir('cyrene-codex-continuity-no-similar-home-')
    process.env.HOME = home
    const currentRepo = await createTempDir('cyrene-codex-current-no-similar-repo-')
    const otherRepo = await createTempDir('cyrene-codex-other-no-similar-repo-')
    await writeFile(join(currentRepo, 'package.json'), JSON.stringify({
      dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      devDependencies: { typescript: '^5.0.0' }
    }), 'utf8')
    await writeFile(join(currentRepo, 'package-lock.json'), '{}\n', 'utf8')
    const current = await identifyCodexProject(currentRepo)
    const other = await identifyCodexProject(otherRepo)
    await mkdir(codexProjectMemoryRoot(current.projectId), { recursive: true })
    await mkdir(codexProjectMemoryRoot(other.projectId), { recursive: true })

    await rebuildCodexMemoryIndex({ cwd: otherRepo })
    await rebuildCodexMemoryIndex({ cwd: currentRepo })
    const context = await getCodexContinuityContext({
      cwd: currentRepo,
      userMessage: 'What transferable guidance applies?',
      task: 'planning'
    })

    expect(context.diagnostics?.projectSimilarity).toMatchObject({
      indexedProjects: 2,
      candidateProjects: 1,
      selectedProjects: 0,
      reason: 'no_similar_projects_selected'
    })
  })

  it('does not leak project-local memory from another projectId into current continuity context', async () => {
    const home = await createTempDir('cyrene-codex-continuity-wrong-project-home-')
    process.env.HOME = home
    const currentRepo = await createTempDir('cyrene-current-project-')
    const otherRepo = await createTempDir('cyrene-other-project-')
    const current = await identifyCodexProject(currentRepo)
    const other = await identifyCodexProject(otherRepo)
    const currentRoot = codexProjectMemoryRoot(current.projectId)
    const otherRoot = codexProjectMemoryRoot(other.projectId)
    await mkdir(currentRoot, { recursive: true })
    await mkdir(otherRoot, { recursive: true })
    await writeFile(join(currentRoot, 'index.jsonl'), `${JSON.stringify(createMemory({
      id: 'current-memory',
      content: 'Current project memory.',
      normalizedKey: 'current-project-memory'
    }))}\n`)
    await writeFile(join(otherRoot, 'index.jsonl'), `${JSON.stringify(createMemory({
      id: 'other-memory',
      content: 'Other project local memory must not leak.',
      normalizedKey: 'other-project-local-memory'
    }))}\n`)

    const context = await getCodexContinuityContext({
      cwd: currentRepo,
      userMessage: 'Current project memory.',
      task: 'coding'
    })

    expect(JSON.stringify(context.projectMemory)).toContain('Current project memory.')
    expect(JSON.stringify(context.projectMemory)).not.toContain('Other project local memory must not leak.')
    expect(JSON.stringify(context.globalMemory)).not.toContain('Other project local memory must not leak.')
    expect(JSON.stringify(context.memory.items)).not.toContain('Other project local memory must not leak.')
  })
})

function createMemory(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'memory-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'Phase 3 affective memory must go through pending validation.',
    normalizedKey: 'phase-3-affective-memory-validator',
    evidence: [{ runId: 'run-1', summary: 'Spec decision.' }],
    source: 'assistant_observed',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    tags: ['codex'],
    ...overrides
  }
}

function createPendingMemory(): PendingMemory {
  return {
    id: 'pending-1',
    domain: 'project',
    type: 'project_fact',
    strength: 'soft',
    scope: 'project',
    status: 'pending',
    content: 'Pending memory content must not appear as active continuity memory.',
    normalizedKey: 'pending-memory-not-active',
    evidence: [{ runId: 'run-pending', summary: 'Pending review notice test.' }],
    source: 'assistant_observed',
    scores: {
      evidenceStrength: 0.8,
      stability: 0.7,
      usefulness: 0.7,
      safety: 0.9,
      sensitivity: 0.2
    },
    seenCount: 1,
    firstSeenAt: '2026-05-25T00:00:00.000Z',
    lastSeenAt: '2026-05-25T00:00:00.000Z',
    expiresAt: '2026-06-24T00:00:00.000Z',
    tags: ['codex']
  }
}
