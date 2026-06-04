import { execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { codexGlobalMemoryRoot, codexProjectMemoryRoot } from '../src/codex/codex-memory-root.js'
import { reviewHashForPendingMemory } from '../src/codex/memory-review.js'
import { identifyCodexProject } from '../src/codex/project-id.js'
import { reviewHashForSimilarHintMemory } from '../src/codex/similar-hints-review.js'
import { activationPolicyForConfidenceTier } from '../src/memory/memory-lifecycle.js'
import {
  appendTombstoneFromRoot,
  readActivationEventsFromRoot,
  readActiveMemoriesFromRoot,
  writeSemanticMemoriesFromRoot,
  writeActiveMemoriesFromRoot,
  writePendingMemoriesFromRoot
} from '../src/memory/memory-store.js'
import type { CyreneMemory, MemoryDomain, MemoryModule, PendingMemory, SemanticMemory } from '../src/memory/types.js'

const execFileAsync = promisify(execFile)
const PLUGIN_BUILD_TEST_TIMEOUT_MS = 20_000
const originalHome = process.env.HOME
const tempDirs: string[] = []

afterEach(async () => {
  process.env.HOME = originalHome
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function readChildStdoutUntil(
  child: ChildProcess,
  predicate: (stdout: string) => boolean,
  timeoutMs = 5_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for expected stdout after ${timeoutMs}ms: stdout=${stdout}`))
    }, timeoutMs)
    const onData = (chunk: Buffer | string) => {
      stdout += chunk.toString()
      if (predicate(stdout)) {
        cleanup()
        resolve(stdout)
      }
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup()
      reject(new Error(`Child exited before expected stdout: code=${code ?? 'null'} signal=${signal ?? 'null'} stdout=${stdout}`))
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      clearTimeout(timeout)
      child.stdout?.off('data', onData)
      child.off('exit', onExit)
      child.off('error', onError)
    }

    child.stdout?.on('data', onData)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

function cliEnv(home: string): NodeJS.ProcessEnv {
  const { FORCE_COLOR: _forceColor, NO_COLOR: _noColor, ...env } = process.env
  return { ...env, HOME: home, CYRENE_MEMORY_AUTO_EXTRACT: '0' }
}

function currentRepoMcpConfigLines(): string[] {
  return [
    'command = "npm"',
    `args = ["--prefix", ${JSON.stringify(process.cwd())}, "run", "--silent", "dev", "--", "mcp-server", "--stdio"]`
  ]
}

function createPending(overrides: Partial<PendingMemory> = {}): PendingMemory {
  return {
    id: 'cli-pending-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'pending',
    content: 'CLI dream promotes repeated pending memory.',
    normalizedKey: 'cli-dream-promotes-pending',
    evidence: [
      { runId: 'run-1', evidenceGroupId: 'group-1', summary: 'First.' },
      { runId: 'run-2', evidenceGroupId: 'group-2', summary: 'Second.' }
    ],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    seenCount: 2,
    firstSeenAt: '2026-05-25T00:00:00.000Z',
    lastSeenAt: '2026-05-25T01:00:00.000Z',
    expiresAt: '2026-06-24T00:00:00.000Z',
    tags: ['cli'],
    ...overrides
  }
}

function createActive(overrides: Partial<CyreneMemory> = {}): CyreneMemory {
  return {
    id: 'cli-active-1',
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    status: 'active',
    content: 'CLI maintenance renders active memory into the model profile.',
    normalizedKey: 'cli-maintenance-renders-profile',
    evidence: [{ runId: 'run-active', sourceKind: 'user_explicit', summary: 'Active seed.' }],
    source: 'user_explicit',
    scores: {
      evidenceStrength: 0.95,
      stability: 0.9,
      usefulness: 0.9,
      safety: 0.95,
      sensitivity: 0.1
    },
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    tags: ['cli'],
    ...overrides
  }
}

function semanticMemory(overrides: Partial<SemanticMemory> = {}): SemanticMemory {
  const confidenceTier = overrides.confidenceTier ?? 'trial'
  const scope = overrides.scope ?? 'project'
  const domain = overrides.domain ?? 'procedural'
  const module = overrides.module ?? moduleForDomain(domain)
  const content = overrides.content ?? 'Context preview trial review workflow memory must stay a workflow hint.'
  return {
    id: overrides.id ?? 'context-preview-trial-1',
    status: overrides.status ?? 'active',
    module,
    kind: overrides.kind ?? 'workflow_rule',
    scope,
    domain,
    content,
    useWhen: overrides.useWhen ?? ['context preview trial review'],
    doNotUseWhen: overrides.doNotUseWhen ?? ['unrelated work'],
    sourceOfTruth: overrides.sourceOfTruth,
    evidence: overrides.evidence ?? [
      {
        id: `evidence-${overrides.id ?? 'context-preview-trial-1'}`,
        sourceKind: 'review_event',
        sourceRef: `review:${overrides.id ?? 'context-preview-trial-1'}`,
        when: '2026-06-03T00:00:00.000Z',
        whatHappened: 'The preview memory was reviewed.',
        whyImportant: 'It verifies runtime preview boundaries.'
      }
    ],
    routing: overrides.routing ?? {
      module,
      updatePolicy: 'strict_auto_promote',
      risk: 'low',
      reasons: ['context preview fixture']
    },
    reviewPolicy: overrides.reviewPolicy ?? 'strict_auto_promote',
    reviewState: overrides.reviewState ?? {
      normalizedKey: content.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      type: domain === 'system' ? 'system_policy' : 'procedural_rule',
      strength: 'hard',
      source: 'review_event',
      portability: scope === 'global' ? 'global' : 'local_only',
      scores: {
        evidenceStrength: 0.9,
        stability: 0.9,
        usefulness: 0.85,
        safety: 0.95,
        sensitivity: 0.1
      },
      tags: ['workflow_rule']
    },
    confidenceTier,
    activationPolicy: activationPolicyForConfidenceTier(confidenceTier),
    supersedes: overrides.supersedes ?? [],
    expiresAt: overrides.expiresAt,
    reviewAfter: overrides.reviewAfter,
    createdAt: overrides.createdAt ?? '2026-06-03T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-03T00:00:00.000Z',
    ...overrides
  }
}

function moduleForDomain(domain: MemoryDomain): MemoryModule {
  if (domain === 'system') return 'system'
  if (domain === 'project') return 'project_semantic'
  if (domain === 'procedural') return 'procedural'
  return 'relationship_affective'
}

async function seedCliPending(cwd: string, pending: PendingMemory | PendingMemory[]): Promise<string> {
  const identity = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(identity.projectId)
  const values = Array.isArray(pending) ? pending : [pending]
  await writePendingMemoriesFromRoot(memoryRoot, values)
  return memoryRoot
}

async function seedCliActiveMemory(cwd: string): Promise<{ active: CyreneMemory; contentHash: string; memoryRoot: string }> {
  const { contentHashForActiveMemory } = await import('../src/codex/active-memory-review.js')
  const identity = await identifyCodexProject(cwd)
  const memoryRoot = codexProjectMemoryRoot(identity.projectId)
  const active = createActive({ id: 'cli-active-lifecycle-1' })
  await writeActiveMemoriesFromRoot(memoryRoot, [active])
  return { active, contentHash: contentHashForActiveMemory(active), memoryRoot }
}

describe('cyrene-continuity codex CLI', () => {
  it('starts the Codex Web UI server until terminated', async () => {
    const home = await createTempDir('cyrene-codex-ui-home-')
    const cwd = await createTempDir('cyrene-codex-ui-project-')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'codex-ui-cli-test' }), 'utf8')

    const child = execFile(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        '--cwd',
        cwd,
        'codex',
        'ui',
        '--port',
        '0'
      ],
      { cwd: process.cwd(), env: cliEnv(home) }
    )

    try {
      const stdout = await readChildStdoutUntil(child, (text) => /Cyrene Web UI: http:\/\/127\.0\.0\.1:\d+/.test(text))
      const url = stdout.match(/Cyrene Web UI: (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
      expect(url).toBeDefined()
      const response = await fetch(url as string)
      const html = await response.text()
      expect(html).toContain('Cyrene Memory Console')
    } finally {
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve()
          return
        }
        child.once('exit', () => resolve())
      })
    }
  })

  it.each([
    ['separate option without value', ['--port'], 'Invalid --port: missing value'],
    ['empty inline option', ['--port='], 'Invalid --port: missing value'],
    ['out-of-range port', ['--port', '65536'], 'Invalid --port: expected integer port 0-65535']
  ])('rejects Codex Web UI %s', async (_label, portArgs, stderr) => {
    const home = await createTempDir('cyrene-codex-ui-bad-port-home-')
    const cwd = await createTempDir('cyrene-codex-ui-bad-port-project-')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'codex-ui-bad-port-test' }), 'utf8')

    await expect(
      execFileAsync(
        process.execPath,
        [
          'node_modules/tsx/dist/cli.mjs',
          'src/main.ts',
          '--cwd',
          cwd,
          'codex',
          'ui',
          ...portArgs
        ],
        { cwd: process.cwd(), env: cliEnv(home), timeout: 5_000 }
      )
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(stderr)
    })
  })

  it('previews runtime memory context without exposing pending or archived content', async () => {
    const home = await createTempDir('cyrene-codex-cli-context-preview-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-codex-cli-context-preview-project-')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'context-preview-cli-test' }), 'utf8')
    const identity = await identifyCodexProject(cwd)
    const projectRoot = codexProjectMemoryRoot(identity.projectId)
    const globalRoot = codexGlobalMemoryRoot()

    await writeSemanticMemoriesFromRoot(projectRoot, [
      semanticMemory({
        id: 'preview-trial-1',
        content: 'Context preview trial review workflow memory must stay a workflow hint.',
        useWhen: ['context preview trial review']
      }),
      semanticMemory({
        id: 'preview-archived-1',
        status: 'archived',
        content: 'DO NOT LEAK ARCHIVED CONTENT'
      })
    ])
    await writePendingMemoriesFromRoot(projectRoot, [
      createPending({
        id: 'preview-project-pending-1',
        content: 'DO NOT LEAK PROJECT PENDING CONTENT',
        normalizedKey: 'preview-project-pending',
        sourceDraftIds: ['draft-project-pending']
      })
    ])
    await writePendingMemoriesFromRoot(globalRoot, [
      createPending({
        id: 'preview-global-pending-1',
        scope: 'global',
        content: 'DO NOT LEAK GLOBAL PENDING CONTENT',
        normalizedKey: 'preview-global-pending'
      })
    ])
    await appendTombstoneFromRoot(projectRoot, {
      id: 'preview-tombstone-1',
      normalizedKey: 'preview-tombstone',
      domain: 'procedural',
      type: 'procedural_rule',
      scope: 'project',
      reason: 'user_rejected',
      createdAt: '2026-06-03T00:00:00.000Z'
    })

    const result = await execFileAsync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        join(process.cwd(), 'src/main.ts'),
        '--cwd',
        cwd,
        'codex',
        'memory',
        'context-preview',
        '--message',
        'context preview trial review',
        '--task',
        'coding'
      ],
      { cwd: process.cwd(), env: cliEnv(home), timeout: 10_000 }
    )
    const preview = JSON.parse(result.stdout)

    expect(preview.input).toEqual({ task: 'coding', userMessage: 'context preview trial review' })
    expect(preview.activeContext.projectMemory).toEqual([])
    expect(preview.activation.workflowHints).toEqual([])
    expect(preview.activation.planConstraints).toEqual([])
    expect(preview.activation.checklistItems).toEqual([])
    expect(preview.exclusions.pendingReview).toMatchObject({
      count: 2,
      items: expect.arrayContaining([
        { id: 'preview-project-pending-1', scope: 'project', root: 'project', reason: 'pending_review_required' },
        { id: 'preview-global-pending-1', scope: 'global', root: 'global', reason: 'pending_review_required' }
      ])
    })
    expect(preview.exclusions.tombstones).toContainEqual({
      id: 'preview-tombstone-1',
      scope: 'project',
      root: 'project',
      reason: 'user_rejected'
    })
    expect(preview.exclusions.archived).toContainEqual({
      id: 'preview-archived-1',
      scope: 'project',
      root: 'project',
      reason: 'archived'
    })

    const activeAndActivation = JSON.stringify({
      activeContext: preview.activeContext,
      activation: preview.activation
    })
    expect(activeAndActivation).not.toContain('DO NOT LEAK PROJECT PENDING CONTENT')
    expect(activeAndActivation).not.toContain('DO NOT LEAK GLOBAL PENDING CONTENT')
    expect(activeAndActivation).not.toContain('DO NOT LEAK ARCHIVED CONTENT')
    expect(await readActivationEventsFromRoot(projectRoot)).toEqual([])
  })

  it('records active memory feedback from the CLI without storing raw query text', async () => {
    const home = await createTempDir('cyrene-codex-cli-feedback-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-codex-cli-feedback-project-')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'feedback-cli-test' }), 'utf8')
    const { active, contentHash, memoryRoot } = await seedCliActiveMemory(cwd)

    const result = await execFileAsync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        join(process.cwd(), 'src/main.ts'),
        '--cwd',
        cwd,
        'codex',
        'memory',
        'feedback',
        active.id,
        '--content-hash',
        contentHash,
        '--event',
        'applied',
        '--query',
        'CLI feedback raw query must not persist.'
      ],
      { cwd: process.cwd(), env: cliEnv(home), timeout: 10_000 }
    )
    const parsed = JSON.parse(result.stdout)

    expect(parsed).toMatchObject({
      action: 'memory_feedback',
      result: {
        action: 'recorded',
        memoryId: active.id,
        event: 'applied'
      }
    })
    const events = await readActivationEventsFromRoot(memoryRoot)
    expect(events).toHaveLength(1)
    expect(events[0]?.queryHash).toMatch(/^[a-f0-9]{16}$/)
    expect(JSON.stringify(events)).not.toContain('CLI feedback raw query must not persist')
  })

  it.each([
    ['invalid event', ['--event', 'retrieved'], 'Invalid --event: retrieved. Expected applied, ignored, corrected, or violated'],
    ['missing content hash', ['--event', 'applied', '--query', 'feedback query'], 'Invalid feedback content hash: missing value'],
    ['negative event missing reason', ['--event', 'violated'], 'violated feedback requires reason']
  ])('rejects CLI memory feedback with %s', async (_label, args, stderr) => {
    const home = await createTempDir('cyrene-codex-cli-feedback-invalid-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-codex-cli-feedback-invalid-project-')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'feedback-cli-invalid-test' }), 'utf8')
    const { active, contentHash } = await seedCliActiveMemory(cwd)
    const contentHashArgs = args.includes('--content-hash') || stderr.includes('content hash')
      ? []
      : ['--content-hash', contentHash]

    await expect(
      execFileAsync(
        process.execPath,
        [
          join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
          join(process.cwd(), 'src/main.ts'),
          '--cwd',
          cwd,
          'codex',
          'memory',
          'feedback',
          active.id,
          ...contentHashArgs,
          ...args
        ],
        { cwd: process.cwd(), env: cliEnv(home), timeout: 10_000 }
      )
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(stderr)
    })
  })

  it('runs project memory harvest dry-run without model config', async () => {
    const home = await createTempDir('cyrene-codex-cli-harvest-home-')
    const cwd = await createTempDir('cyrene-codex-cli-harvest-project-')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'harvest-cli-test' }), 'utf8')

    const result = await execFileAsync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        join(process.cwd(), 'src/main.ts'),
        'codex',
        'memory',
        'harvest-project',
        '--dry-run'
      ],
      { cwd, env: { ...cliEnv(home), CYRENE_BASE_URL: '', CYRENE_MODEL: '' } }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as { action?: string; signals?: unknown[] }
    expect(parsed.action).toBe('needs_model_config')
    expect(parsed.signals?.length).toBeGreaterThan(0)
  })

  it.each([
    ['separate option', ['--since', 'last-summary']],
    ['inline option', ['--since=last-summary']]
  ])('accepts project memory harvest %s compatibility option', async (_label, sinceArgs) => {
    const home = await createTempDir('cyrene-codex-cli-harvest-since-home-')
    const cwd = await createTempDir('cyrene-codex-cli-harvest-since-project-')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'harvest-cli-since-test' }), 'utf8')

    const result = await execFileAsync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        join(process.cwd(), 'src/main.ts'),
        'codex',
        'memory',
        'harvest-project',
        '--dry-run',
        ...sinceArgs
      ],
      { cwd, env: { ...cliEnv(home), CYRENE_BASE_URL: '', CYRENE_MODEL: '' } }
    )

    const parsed = JSON.parse(result.stdout) as { warnings?: string[] }
    expect(result.stderr).toBe('')
    expect(parsed.warnings).toContain(
      '--since last-summary accepted for compatibility; current harvest uses default signal collection.'
    )
  })

  it.each([
    ['missing trailing value', ['--since'], 'Invalid --since: missing value'],
    ['empty inline value', ['--since='], 'Invalid --since: missing value'],
    ['invalid value', ['--since', 'latest'], 'Invalid --since: latest. Expected last-summary']
  ])('rejects project memory harvest %s', async (_label, sinceArgs, stderr) => {
    const home = await createTempDir('cyrene-codex-cli-harvest-bad-since-home-')
    const cwd = await createTempDir('cyrene-codex-cli-harvest-bad-since-project-')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'harvest-cli-bad-since-test' }), 'utf8')

    await expect(
      execFileAsync(
        process.execPath,
        [
          join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
          join(process.cwd(), 'src/main.ts'),
          'codex',
          'memory',
          'harvest-project',
          '--dry-run',
          ...sinceArgs
        ],
        { cwd, env: { ...cliEnv(home), CYRENE_BASE_URL: '', CYRENE_MODEL: '' } }
      )
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(stderr)
    })
  })

  it('doctor rejects --config without a path', async () => {
    const home = await createTempDir('cyrene-codex-cli-config-missing-home-')

    await expect(
      execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config'],
        { env: cliEnv(home) }
      )
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Invalid doctor config path: missing value')
    })
  })

  it('doctor rejects --config= without a path', async () => {
    const home = await createTempDir('cyrene-codex-cli-config-empty-home-')

    await expect(
      execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config='],
        { env: cliEnv(home) }
      )
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Invalid doctor config path: missing value')
    })
  })

  it('doctor reports agentmemory as not ready when configured', async () => {
    const home = await createTempDir('cyrene-codex-cli-home-')
    await writeFile(
      join(home, '.codex-config.toml'),
      [
        '[mcp_servers.agentmemory]',
        'command = "npx"',
        'args = ["-y", "@agentmemory/mcp"]',
        '',
        '[mcp_servers.cyrene]',
        ...currentRepoMcpConfigLines()
      ].join('\n')
    )

    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        'codex',
        'doctor',
        '--config',
        join(home, '.codex-config.toml')
      ],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Cyrene Codex Doctor')
    expect(result.stdout).toContain('cyrene-continuity mcp: configured')
    expect(result.stdout).toContain('mcp command:')
    expect(result.stdout).toContain('npm')
    expect(result.stdout).toContain('--prefix')
    expect(result.stdout).toContain(process.cwd())
    expect(result.stdout).toContain('mcp-server')
    expect(result.stdout).toContain('--stdio')
    expect(result.stdout).toContain('mcp command freshness: current repo')
    expect(result.stdout).toContain('agentmemory: enabled')
    expect(result.stdout).toContain('status: not ready')
  })

  it('doctor is not ready until the Cyrene skill is registered', async () => {
    const home = await createTempDir('cyrene-codex-cli-no-skill-home-')
    await writeFile(
      join(home, '.codex-config.toml'),
      [
        '[mcp_servers.cyrene]',
        ...currentRepoMcpConfigLines(),
        'enabled = true'
      ].join('\n')
    )

    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        'codex',
        'doctor',
        '--config',
        join(home, '.codex-config.toml')
      ],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('cyrene-continuity mcp: configured')
    expect(result.stdout).toContain('agentmemory: disabled')
    expect(result.stdout).toContain('cyrene-continuity: missing')
    expect(result.stdout).toContain('status: not ready')
    expect(result.stdout).toContain('action: run npm --prefix')
    expect(result.stdout).toContain(process.cwd())
    expect(result.stdout).toContain('run --silent dev -- codex install --dev')
  })

  it('doctor reads the cyrene-continuity manual MCP config name', async () => {
    const home = await createTempDir('cyrene-codex-cli-named-mcp-home-')
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers."cyrene-continuity"]',
        ...currentRepoMcpConfigLines(),
        'enabled = true'
      ].join('\n')
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('cyrene-continuity mcp: configured')
    expect(result.stdout).toContain('manual mcp: enabled')
    expect(result.stdout).toContain('mcp command freshness: current repo')
  })

  it('doctor reports ready after the skill is installed and agentmemory is disabled', async () => {
    const home = await createTempDir('cyrene-codex-cli-ready-home-')
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene]',
        ...currentRepoMcpConfigLines(),
        'enabled = true',
        '',
        '[mcp_servers.agentmemory]',
        'command = "npx"',
        'args = ["-y", "@agentmemory/mcp"]',
        'enabled = false'
      ].join('\n')
    )

    await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
      { env: cliEnv(home) }
    )
    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        'codex',
        'doctor',
        '--config',
        configPath
      ],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('cyrene-continuity mcp: configured')
    expect(result.stdout).toContain('agentmemory: disabled')
    expect(result.stdout).toContain('cyrene-continuity: ok')
    expect(result.stdout).toContain('status: ready')
  })

  it('doctor reports stale MCP commands as not ready even when the skill is installed', async () => {
    const home = await createTempDir('cyrene-codex-cli-stale-home-')
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene]',
        'command = "cyrene-continuity"',
        'args = ["mcp-server", "--stdio"]',
        'enabled = true',
        '',
        '[mcp_servers.agentmemory]',
        'command = "npx"',
        'args = ["-y", "@agentmemory/mcp"]',
        'enabled = false'
      ].join('\n')
    )
    await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
      { env: cliEnv(home) }
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('cyrene-continuity mcp: configured')
    expect(result.stdout).toContain('mcp command freshness: stale or external')
    expect(result.stdout).toContain('agentmemory: disabled')
    expect(result.stdout).toContain('cyrene-continuity: ok')
    expect(result.stdout).toContain('status: not ready')
    expect(result.stdout).toContain('action: rerun npm --prefix')
    expect(result.stdout).toContain(process.cwd())
    expect(result.stdout).toContain('run --silent dev -- codex install --dev')
    expect(result.stdout).toContain('update [mcp_servers."cyrene-continuity"] from its printed config')
  })

  it('install --dev creates only the skill symlink and Cyrene Codex state root', async () => {
    const home = await createTempDir('cyrene-codex-install-home-')
    const codexConfig = join(home, '.codex', 'config.toml')
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(codexConfig, 'existing = true\n')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('[mcp_servers."cyrene-continuity"]')
    expect(result.stdout).not.toContain('[mcp_servers.cyrene]')
    expect(result.stdout).toContain('command = "npm"')
    expect(result.stdout).toContain('--prefix')
    expect(result.stdout).toContain(process.cwd())
    expect(result.stdout).toContain('run')
    expect(result.stdout).toContain('--silent')
    expect(result.stdout).toContain('dev')
    expect(result.stdout).toContain('mcp-server')
    expect(result.stdout).toContain('--stdio')
    expect(result.stdout).toContain('Disable agentmemory before validating Cyrene')
    await expect(readFile(join(home, '.agents', 'skills', 'cyrene-continuity', 'SKILL.md'), 'utf8')).resolves.toContain(
      'Cyrene Continuity Skill'
    )
    await expect(readFile(join(home, '.cyrene', 'codex', '.keep'), 'utf8')).resolves.toBe(
      'created by cyrene-continuity codex install --dev\n'
    )
    await expect(readFile(codexConfig, 'utf8')).resolves.toBe('existing = true\n')
  })

  it('install --dev refuses to replace an existing non-symlink skill path', async () => {
    const home = await createTempDir('cyrene-codex-install-existing-home-')
    const skillPath = join(home, '.agents', 'skills', 'cyrene-continuity')
    await mkdir(skillPath, { recursive: true })
    await writeFile(join(skillPath, 'SKILL.md'), 'custom skill\n')

    try {
      await execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
        { env: cliEnv(home) }
      )
      throw new Error('install unexpectedly succeeded')
    } catch (error) {
      expect((error as { code?: number }).code).toBe(1)
      expect(String((error as { stderr?: string }).stderr ?? '')).toContain('Refusing to replace existing non-symlink skill path')
    }

    await expect(readFile(join(skillPath, 'SKILL.md'), 'utf8')).resolves.toBe('custom skill\n')
  })

  it('install --plugin writes a stable shim that points at the plugin runtime', async () => {
    const home = await createTempDir('cyrene-codex-plugin-install-home-')
    await execFileAsync('npm', ['run', 'build:plugin'], { env: cliEnv(home) })

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--plugin'],
      { env: cliEnv(home) }
    )

    const shimPath = join(home, '.cyrene', 'codex', 'bin', 'cyrene-continuity')
    const shim = await readFile(shimPath, 'utf8')
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Cyrene Codex plugin bridge installed.')
    expect(result.stdout).toContain(shimPath)
    expect(result.stdout).toContain('Disable or remove manual Cyrene MCP config')
    expect(shim).toContain('plugin/runtime/cyrene-continuity.mjs')
    expect(shim).toContain('exec node "$runtime" "$@"')
  }, PLUGIN_BUILD_TEST_TIMEOUT_MS)

  it('install --plugin refuses to write a shim when the plugin runtime has not been built', async () => {
    const home = await createTempDir('cyrene-codex-plugin-install-missing-runtime-home-')
    await rm(join(process.cwd(), 'plugin', 'runtime'), { recursive: true, force: true })

    await expect(
      execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--plugin'],
        { env: cliEnv(home) }
      )
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Cyrene plugin runtime is missing')
    })
  })

  it('doctor reports plugin bridge ready without a manual MCP config', async () => {
    const home = await createTempDir('cyrene-codex-plugin-doctor-home-')
    const configPath = join(home, '.codex-config.toml')
    await execFileAsync('npm', ['run', 'build:plugin'], { env: cliEnv(home) })
    await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--plugin'],
      { env: cliEnv(home) }
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('cyrene-continuity mcp: missing')
    expect(result.stdout).toContain('manual mcp: absent')
    expect(result.stdout).toContain('plugin mcp: declared')
    expect(result.stdout).toContain('runtime: present')
    expect(result.stdout).toContain('stable shim: present')
    expect(result.stdout).toContain('cyrene-continuity: plugin')
    expect(result.stdout).toContain('status: ready')
  }, PLUGIN_BUILD_TEST_TIMEOUT_MS)

  it('doctor reports a manual MCP config as a plugin bridge conflict', async () => {
    const home = await createTempDir('cyrene-codex-plugin-conflict-home-')
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene]',
        ...currentRepoMcpConfigLines(),
        'enabled = true'
      ].join('\n')
    )
    await execFileAsync('npm', ['run', 'build:plugin'], { env: cliEnv(home) })
    await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--plugin'],
      { env: cliEnv(home) }
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('manual mcp: enabled')
    expect(result.stdout).toContain('plugin mcp: declared')
    expect(result.stdout).toContain('stable shim: present')
    expect(result.stdout).toContain('status: not ready')
    expect(result.stdout).toContain('action: disable or remove manual Cyrene MCP config')
    expect(result.stdout).not.toContain('action: rerun')
  }, PLUGIN_BUILD_TEST_TIMEOUT_MS)

  it('install-hook --stop --dry-run does not write hooks.json', async () => {
    const home = await createTempDir('cyrene-codex-hook-dry-run-home-')
    const hooksPath = join(home, '.codex', 'hooks.json')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install-hook', '--stop', '--dry-run'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('dry-run')
    expect(result.stdout).toContain('codex hook stop')
    await expect(readFile(hooksPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('usage lists Codex lifecycle hook routes', async () => {
    const home = await createTempDir('cyrene-codex-cli-hook-usage-home-')

    try {
      await execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'unknown-command'],
        { env: cliEnv(home) }
      )
      throw new Error('unknown command unexpectedly succeeded')
    } catch (error) {
      const stderr = String((error as { stderr?: string }).stderr ?? '')
      expect(stderr).toContain('hook session-start|hook user-prompt-submit|hook post-tool-use|hook stop')
      expect(stderr).toContain('memory lifecycle daily [--dry-run|--apply] [--all-projects]')
      expect(stderr).toContain('memory lifecycle weekly [--dry-run|--apply] [--all-projects]')
      expect(stderr).toContain('ui [--port <n>]')
    }
  })

  it('install-hook --stop writes hooks.json and preserves existing Stop hooks', async () => {
    const home = await createTempDir('cyrene-codex-hook-install-home-')
    const hooksPath = join(home, '.codex', 'hooks.json')
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(
      hooksPath,
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [{ type: 'command', command: '/Users/phoenix/.codex/hooks/task_done_sound.sh', timeout: 5 }]
              }
            ]
          }
        },
        null,
        2
      )
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install-hook', '--stop'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Codex Stop hook installed')
    const parsed = JSON.parse(await readFile(hooksPath, 'utf8')) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> }
    }
    const commands = parsed.hooks.Stop.flatMap((entry) => entry.hooks.map((hook) => hook.command))
    expect(commands).toContain('/Users/phoenix/.codex/hooks/task_done_sound.sh')
    expect(commands.filter((command) => command.includes('codex hook stop'))).toHaveLength(1)
  })

  it('doctor reports missing Stop hook as an advisory without blocking readiness', async () => {
    const home = await createTempDir('cyrene-codex-cli-stop-hook-advisory-home-')
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene]',
        ...currentRepoMcpConfigLines(),
        'enabled = true',
        '',
        '[mcp_servers.agentmemory]',
        'command = "npx"',
        'args = ["-y", "@agentmemory/mcp"]',
        'enabled = false'
      ].join('\n')
    )
    await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
      { env: cliEnv(home) }
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('status: ready')
    expect(result.stdout).toContain('stop hook: missing')
    expect(result.stdout).toContain('advisory: optional Stop hook is not installed')
  })

  it('doctor reports memory profile and automation state without blocking readiness', async () => {
    const home = await createTempDir('cyrene-codex-cli-memory-doctor-home-')
    process.env.HOME = home
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene]',
        ...currentRepoMcpConfigLines(),
        'enabled = true',
        '',
        '[mcp_servers.agentmemory]',
        'command = "npx"',
        'args = ["-y", "@agentmemory/mcp"]',
        'enabled = false'
      ].join('\n')
    )
    await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install', '--dev'],
      { env: cliEnv(home) }
    )
    const identity = await identifyCodexProject(process.cwd())
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const globalMemoryRoot = codexGlobalMemoryRoot()
    await mkdir(projectMemoryRoot, { recursive: true })
    await mkdir(globalMemoryRoot, { recursive: true })
    await writeFile(join(globalMemoryRoot, 'MODEL_PROFILE.md'), '# Global Profile\n')
    await writeFile(
      join(projectMemoryRoot, 'dream-state.json'),
      JSON.stringify({ dreamDue: true, lastDreamAt: '2026-05-25T00:00:00.000Z' }) + '\n'
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('status: ready')
    expect(result.stdout).toContain('memory:')
    expect(result.stdout).toContain('global profile: present')
    expect(result.stdout).toContain('project profile: missing')
    expect(result.stdout).toContain('automation due: yes')
    expect(result.stdout).toContain('last automation run: 2026-05-25T00:00:00.000Z')
    expect(result.stdout).toContain('promotion recommendations: enabled')
    expect(result.stdout).not.toContain(['auto', 'promote:'].join(' '))
  })

  it('doctor reports migration checks for automations, shims, embeddings, and profile candidates', async () => {
    const home = await createTempDir('cyrene-codex-cli-migration-doctor-home-')
    process.env.HOME = home
    const identity = await identifyCodexProject(process.cwd())
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const automationRoot = join(home, '.codex', 'automations', 'cyrene-memory-dream-deep')
    await mkdir(projectMemoryRoot, { recursive: true })
    await mkdir(automationRoot, { recursive: true })
    await writeFile(join(projectMemoryRoot, 'profile_candidates.jsonl'), '{"id":"profile-candidate-1"}\n')
    await writeFile(
      join(automationRoot, 'automation.toml'),
      [
        'id = "cyrene-memory-dream-deep"',
        'status = "ACTIVE"',
        'prompt = "Run codex memory automation --job weekly --apply and report the summary."'
      ].join('\n')
    )

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor'],
      { env: { ...cliEnv(home), CYRENE_EMBEDDING_PROVIDER: '' } }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('legacy deep automation: unknown')
    expect(result.stdout).toContain('stable shim preview job: missing')
    expect(result.stdout).toContain('stable shim apply job: missing')
    expect(result.stdout).toContain('embedding provider: disabled')
    expect(result.stdout).toContain('profile candidates: ok')
  })

  it('doctor reports deprecated auto promote env as recommend-only compatibility', async () => {
    const home = await createTempDir('cyrene-codex-cli-deprecated-promotion-home-')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor'],
      { env: { ...cliEnv(home), CYRENE_MEMORY_AUTO_PROMOTE: '1' } }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('promotion recommendations: enabled')
    expect(result.stdout).toContain('deprecated CYRENE_MEMORY_AUTO_PROMOTE: set')
    expect(result.stdout).toContain('advisory: CYRENE_MEMORY_AUTO_PROMOTE is deprecated; use CYRENE_MEMORY_RECOMMEND_PROMOTION')
    expect(result.stdout).not.toContain(['auto', 'promote: enabled'].join(' '))
  })

  it('rebuilds the Codex memory SQLite index from JSONL roots', async () => {
    const home = await createTempDir('cyrene-codex-cli-memory-db-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-memory-db-repo-')
    const identity = await identifyCodexProject(repo)
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    await writeActiveMemoriesFromRoot(projectMemoryRoot, [createActive()])

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'db', 'rebuild'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as {
      dbPath: string
      diagnostics: { available: boolean; ftsTokenizer?: string }
      syncedRoots: number
    }
    expect(parsed.dbPath).toBe(join(home, '.cyrene', 'codex', 'memory.db'))
    expect(parsed.diagnostics.available).toBe(true)
    expect(parsed.syncedRoots).toBeGreaterThanOrEqual(1)
  })

  it('runs semantic memory v2 migration from the CLI for global and current project roots', async () => {
    const home = await createTempDir('cyrene-codex-cli-migrate-v2-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-migrate-v2-repo-')
    const identity = await identifyCodexProject(repo)
    const globalMemoryRoot = codexGlobalMemoryRoot()
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(globalMemoryRoot, { recursive: true })
    await mkdir(projectMemoryRoot, { recursive: true })
    const globalMemoryRootReal = await realpath(globalMemoryRoot)
    const projectMemoryRootReal = await realpath(projectMemoryRoot)
    await writeFile(join(globalMemoryRoot, 'index.jsonl'), `${JSON.stringify(createActive({
      id: 'cli-global-v2-active',
      scope: 'global',
      normalizedKey: 'cli-global-v2-active',
      content: 'Global CLI migration keeps active memory.'
    }))}\n`)
    await writeFile(join(projectMemoryRoot, 'index.jsonl'), `${JSON.stringify(createActive({
      id: 'cli-project-v2-active',
      normalizedKey: 'cli-project-v2-active',
      content: 'Project CLI migration keeps active memory.'
    }))}\n`)
    await writeFile(join(projectMemoryRoot, 'pending.jsonl'), `${JSON.stringify(createPending({
      id: 'cli-project-v2-pending',
      normalizedKey: 'cli-project-v2-pending'
    }))}\n`)

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'migrate-v2'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as {
      action: string
      roots: Array<{
        scope: string
        projectId?: string
        memoryRoot: string
        migratedActive?: number
        droppedLegacyPending?: number
        semanticMemories?: number
      }>
    }
    expect(parsed.action).toBe('migrate_semantic_memory_v2')
    expect(parsed.roots.find((root) => root.scope === 'global')).toMatchObject({
      scope: 'global',
      memoryRoot: globalMemoryRootReal,
      migratedActive: 1,
      droppedLegacyPending: 0,
      semanticMemories: 1
    })
    expect(parsed.roots.find((root) => root.projectId === identity.projectId)).toMatchObject({
      scope: 'project',
      projectId: identity.projectId,
      memoryRoot: projectMemoryRootReal,
      migratedActive: 1,
      droppedLegacyPending: 1,
      semanticMemories: 1
    })
    await expect(readFile(join(projectMemoryRoot, 'semantic_memories.jsonl'), 'utf8')).resolves.toContain('cli-project-v2-active')
    await expect(readFile(join(projectMemoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toBe('')
  })

  it('runs v1.5 lifecycle automation commands from the CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-lifecycle-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-lifecycle-repo-')
    await identifyCodexProject(repo)

    const daily = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'lifecycle', 'daily', '--dry-run'],
      { env: cliEnv(home) }
    )
    const weekly = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'lifecycle', 'weekly', '--dry-run'],
      { env: cliEnv(home) }
    )

    expect(daily.stderr).toBe('')
    expect(JSON.parse(daily.stdout).action).toBe('memory_lifecycle_daily')
    expect(weekly.stderr).toBe('')
    expect(JSON.parse(weekly.stdout).action).toBe('memory_lifecycle_weekly')
  })

  it('memory lifecycle --all-projects includes registered non-current project roots', async () => {
    const home = await createTempDir('cyrene-codex-cli-lifecycle-all-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-lifecycle-all-repo-')
    const identity = await identifyCodexProject(repo)
    const currentMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const otherMemoryRoot = codexProjectMemoryRoot('cli-lifecycle-other-project')
    await mkdir(codexGlobalMemoryRoot(), { recursive: true })
    await mkdir(currentMemoryRoot, { recursive: true })
    await mkdir(otherMemoryRoot, { recursive: true })
    const otherMemoryRootReal = await realpath(otherMemoryRoot)

    const daily = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        '--cwd',
        repo,
        'codex',
        'memory',
        'lifecycle',
        'daily',
        '--dry-run',
        '--all-projects'
      ],
      { env: cliEnv(home) }
    )
    const weekly = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        '--cwd',
        repo,
        'codex',
        'memory',
        'lifecycle',
        'weekly',
        '--dry-run',
        '--all-projects'
      ],
      { env: cliEnv(home) }
    )

    expect(daily.stderr).toBe('')
    const dailyParsed = JSON.parse(daily.stdout) as { roots: Array<{ memoryRoot: string; scope: string }> }
    expect(dailyParsed.roots.filter((root) => root.scope === 'project').map((root) => root.memoryRoot)).toContain(
      otherMemoryRootReal
    )

    expect(weekly.stderr).toBe('')
    const weeklyParsed = JSON.parse(weekly.stdout) as { projectRoots: Array<{ memoryRoot: string }> }
    expect(weeklyParsed.projectRoots.map((root) => root.memoryRoot)).toContain(otherMemoryRootReal)
  })

  it('memory migrate-v2 --all-projects includes registered non-current project roots', async () => {
    const home = await createTempDir('cyrene-codex-cli-migrate-v2-all-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-migrate-v2-all-repo-')
    const identity = await identifyCodexProject(repo)
    const currentMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const otherProjectId = 'cli-legacy-v2-project'
    const otherMemoryRoot = codexProjectMemoryRoot(otherProjectId)
    await mkdir(codexGlobalMemoryRoot(), { recursive: true })
    await mkdir(currentMemoryRoot, { recursive: true })
    await mkdir(otherMemoryRoot, { recursive: true })
    await writeFile(join(currentMemoryRoot, 'index.jsonl'), `${JSON.stringify(createActive({
      id: 'cli-current-v2-active',
      normalizedKey: 'cli-current-v2-active',
      content: 'Current project CLI migration keeps active memory.'
    }))}\n`)
    await writeFile(join(otherMemoryRoot, 'index.jsonl'), `${JSON.stringify(createActive({
      id: 'cli-other-v2-active',
      normalizedKey: 'cli-other-v2-active',
      content: 'Other project CLI migration keeps active memory.'
    }))}\n`)

    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        '--cwd',
        repo,
        'codex',
        'memory',
        'migrate-v2',
        '--all-projects'
      ],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as {
      roots: Array<{ scope: string; projectId?: string; migratedActive?: number }>
    }
    const projectIds = parsed.roots.filter((root) => root.scope === 'project').map((root) => root.projectId)
    expect(projectIds).toContain(identity.projectId)
    expect(projectIds).toContain(otherProjectId)
    expect(parsed.roots.find((root) => root.projectId === otherProjectId)).toMatchObject({
      scope: 'project',
      projectId: otherProjectId,
      migratedActive: 1
    })
    await expect(readFile(join(otherMemoryRoot, 'semantic_memories.jsonl'), 'utf8')).resolves.toContain('cli-other-v2-active')
  })

  it('doctor reports memory index diagnostics', async () => {
    const home = await createTempDir('cyrene-codex-cli-doctor-index-home-')
    const repo = await createTempDir('cyrene-codex-cli-doctor-index-repo-')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'doctor'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('memory index:')
    expect(result.stdout).toContain(join(home, '.cyrene', 'codex', 'memory.db'))
  })

  it('prints read-only memory pipeline status from the CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-memory-status-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-memory-status-repo-')
    const identity = await identifyCodexProject(repo)
    const globalMemoryRoot = codexGlobalMemoryRoot()
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(globalMemoryRoot, { recursive: true })
    await mkdir(projectMemoryRoot, { recursive: true })
    await writeFile(join(globalMemoryRoot, 'review_queue.jsonl'), `${JSON.stringify({
      ...createPending(),
      id: 'global-status-pending',
      scope: 'global' as const,
      normalizedKey: 'global-status-pending'
    })}\n`)
    await writeActiveMemoriesFromRoot(projectMemoryRoot, [createActive()])

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'status'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Cyrene Memory Status')
    expect(result.stdout).toContain(`projectId: ${identity.projectId}`)
    expect(result.stdout).toContain('node:')
    expect(result.stdout).toContain('sqlite index:')
    expect(result.stdout).toContain('fallback mode:')
    expect(result.stdout).toContain('stop hook:')
    expect(result.stdout).toContain('global review queue: 1')
    expect(result.stdout).toContain('project trial/validated/core memory: 1')
  })

  it('reports SQLite unavailable fallback in memory status without mutating the index', async () => {
    const home = await createTempDir('cyrene-codex-cli-memory-status-fallback-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-memory-status-fallback-repo-')
    await mkdir(join(home, '.cyrene', 'codex', 'memory.db'), { recursive: true })

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'status'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('sqlite index: unavailable')
    expect(result.stdout).toContain('fallback mode: jsonl')
    expect(result.stdout).toContain('similar-project retrieval: degraded')
    await expect(readFile(join(home, '.cyrene', 'codex', 'memory.db'), 'utf8')).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('reports stale index in memory status and doctor without rebuilding it', async () => {
    const home = await createTempDir('cyrene-codex-cli-memory-status-stale-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-memory-status-stale-repo-')
    const identity = await identifyCodexProject(repo)
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(projectMemoryRoot, { recursive: true })
    await writeActiveMemoriesFromRoot(projectMemoryRoot, [createActive()])

    const status = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'status'],
      { env: cliEnv(home) }
    )
    const doctor = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'doctor'],
      { env: cliEnv(home) }
    )

    expect(status.stderr).toBe('')
    expect(status.stdout).toContain('index freshness: stale')
    expect(status.stdout).toContain('action: run cyrene-continuity codex memory db rebuild')
    expect(doctor.stdout).toContain('memory fallback mode:')
    expect(doctor.stdout).toContain('memory index freshness: stale')
    await expect(readFile(join(home, '.cyrene', 'codex', 'memory.db'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports stale shared index when another readable project root has newer memory source', async () => {
    const home = await createTempDir('cyrene-codex-cli-memory-status-all-roots-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-memory-status-all-roots-repo-')
    const identity = await identifyCodexProject(repo)
    const currentMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const legacyProjectId = 'legacy-project-id'
    const legacyMemoryRoot = codexProjectMemoryRoot(legacyProjectId)
    const dbPath = join(home, '.cyrene', 'codex', 'memory.db')
    const currentSource = join(currentMemoryRoot, 'semantic_memories.jsonl')
    const legacySource = join(legacyMemoryRoot, 'review_queue.jsonl')
    await mkdir(currentMemoryRoot, { recursive: true })
    await mkdir(legacyMemoryRoot, { recursive: true })
    await mkdir(join(home, '.cyrene', 'codex'), { recursive: true })
    await writeActiveMemoriesFromRoot(currentMemoryRoot, [createActive()])
    await writeFile(dbPath, '')
    await writeFile(legacySource, `${JSON.stringify(createPending())}\n`)
    await utimes(currentSource, new Date('2026-05-28T00:00:00.000Z'), new Date('2026-05-28T00:00:00.000Z'))
    await utimes(dbPath, new Date('2026-05-28T00:01:00.000Z'), new Date('2026-05-28T00:01:00.000Z'))
    await utimes(legacySource, new Date('2026-05-28T00:02:00.000Z'), new Date('2026-05-28T00:02:00.000Z'))

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'status'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('index freshness: stale')
    expect(result.stdout).toContain(legacyProjectId)
    expect(result.stdout).toContain('similar-project retrieval: degraded')
  })

  it('reports projectId and Stop hook run diagnostics in memory status and doctor', async () => {
    const home = await createTempDir('cyrene-codex-cli-memory-status-project-hook-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-memory-status-project-hook-repo-')
    const identity = await identifyCodexProject(repo)
    const currentMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(currentMemoryRoot, { recursive: true })
    await mkdir(codexProjectMemoryRoot('legacy-project-id'), { recursive: true })
    await writeFile(join(currentMemoryRoot, 'review-summaries.jsonl'), `${JSON.stringify({
      id: 'summary-1',
      runId: 'session:turn',
      createdAt: '2026-05-28T00:00:00.000Z',
      status: 'ok',
      summary: 'Review-safe summary.',
      redaction: { input: {}, output: {} },
      candidateIds: []
    })}\n`)
    await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'install-hook', '--stop'],
      { env: cliEnv(home) }
    )

    const status = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'status'],
      { env: cliEnv(home) }
    )
    const doctor = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'doctor'],
      { env: cliEnv(home) }
    )

    expect(status.stderr).toBe('')
    expect(status.stdout).toContain('known project roots: 2')
    expect(status.stdout).toContain('projectId diagnostic: multiple project memory roots detected')
    expect(status.stdout).toContain('stop hook: configured')
    expect(status.stdout).toContain('session summaries: present')
    expect(status.stdout).toContain('last stop hook run: 2026-05-28T00:00:00.000Z (ok)')
    expect(doctor.stdout).toContain('projectId diagnostic: multiple project memory roots detected')
    expect(doctor.stdout).toContain('last stop hook run: 2026-05-28T00:00:00.000Z (ok)')
  })

  it('prints a memory dashboard with review, automation, top memory, and warnings', async () => {
    const home = await createTempDir('cyrene-codex-cli-dashboard-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-dashboard-repo-')
    const identity = await identifyCodexProject(repo)
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await mkdir(join(home, '.codex'), { recursive: true })
    await mkdir(codexProjectMemoryRoot('legacy-project-id'), { recursive: true })
    await writeFile(join(home, '.codex', 'config.toml'), [
      '[mcp_servers."cyrene-continuity"]',
      ...currentRepoMcpConfigLines(),
      'enabled = true',
      '',
      '[mcp_servers.agentmemory]',
      'command = "npx"',
      'args = ["-y", "@agentmemory/mcp"]',
      'enabled = true'
    ].join('\n'))
    await writeActiveMemoriesFromRoot(memoryRoot, [createActive({
      id: 'dashboard-active-1',
      content: 'Dashboard should surface the strongest project memory.',
      scores: {
        evidenceStrength: 0.95,
        stability: 0.9,
        usefulness: 0.99,
        safety: 0.95,
        sensitivity: 0.1
      }
    })])
    await writeFile(join(memoryRoot, 'review_queue.jsonl'), `${JSON.stringify(createPending({
      id: 'dashboard-pending-1',
      content: 'Dashboard should show pending review.',
      lastSeenAt: '2026-05-28T00:00:00.000Z'
    }))}\n`)
    await writeFile(join(memoryRoot, 'tombstones.jsonl'), `${JSON.stringify({
      id: 'dashboard-tombstone-1',
      memoryId: 'dashboard-rejected-1',
      normalizedKey: 'dashboard-rejected',
      domain: 'procedural',
      type: 'procedural_rule',
      scope: 'project',
      reason: 'rejected',
      createdAt: '2026-05-28T00:00:00.000Z'
    })}\n`)
    await writeFile(join(memoryRoot, 'review-summaries.jsonl'), `${JSON.stringify({
      id: 'dashboard-summary-1',
      runId: 'session:turn',
      createdAt: '2000-01-01T00:00:00.000Z',
      status: 'ok',
      summary: 'Dashboard review summary.',
      redaction: { input: {}, output: {} },
      candidateIds: ['dashboard-pending-1']
    })}\n`)
    await writeFile(join(memoryRoot, 'dream-state.json'), `${JSON.stringify({
      dreamDue: true,
      lastDreamAt: '2026-05-27T00:00:00.000Z',
      nextDreamDueAt: '2026-05-28T00:00:00.000Z',
      lastDreamStatus: 'success'
    })}\n`)

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'dashboard'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Cyrene Memory Dashboard')
    expect(result.stdout).toContain('lifecycle memories: 1')
    expect(result.stdout).toContain('review queue: 1')
    expect(result.stdout).toContain('rejected/tombstoned: 1')
    expect(result.stdout).toContain('top lifecycle project memories:')
    expect(result.stdout).toContain('Dashboard should surface the strongest project memory.')
    expect(result.stdout).toContain('manual review queue:')
    expect(result.stdout).toContain('dashboard-pending-1')
    expect(result.stdout).toContain('review summaries:')
    expect(result.stdout).toContain('Dashboard review summary.')
    expect(result.stdout).toContain('last automation run: 2026-05-27T00:00:00.000Z')
    expect(result.stdout).toContain('next automation due: 2026-05-28T00:00:00.000Z')
    expect(result.stdout).toContain('warnings:')
    expect(result.stdout).toContain('Stop Hook stale')
    expect(result.stdout).toContain('profile missing')
    expect(result.stdout).toContain('SQLite stale')
    expect(result.stdout).toContain('projectId split')
    expect(result.stdout).toContain('Codex memory enabled')
    expect(result.stdout).toContain('agentmemory enabled')
  })

  it('project status and list expose split diagnostics and aliases', async () => {
    const home = await createTempDir('cyrene-codex-cli-project-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-project-repo-')
    const identity = await identifyCodexProject(repo)
    await mkdir(codexProjectMemoryRoot(identity.projectId), { recursive: true })
    await mkdir(codexProjectMemoryRoot('legacy-project-id'), { recursive: true })

    await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        'codex',
        'project',
        'alias',
        'legacy-project-id',
        identity.displayName
      ],
      { env: cliEnv(home) }
    )

    const status = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'project', 'status'],
      { env: cliEnv(home) }
    )
    const list = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'project', 'list'],
      { env: cliEnv(home) }
    )

    expect(status.stdout).toContain(`projectId: ${identity.projectId}`)
    expect(status.stdout).toContain('projectId split: possible')
    expect(status.stdout).toContain('split candidates: legacy-project-id')
    expect(status.stdout).toContain(`action: cyrene-continuity codex project merge legacy-project-id ${identity.projectId}`)
    expect(list.stdout).toContain('legacy-project-id')
    expect(list.stdout).toContain(`aliases: ${identity.displayName}`)
  })

  it('project merge requires an explicit command and merges into the selected target', async () => {
    const home = await createTempDir('cyrene-codex-cli-project-merge-home-')
    process.env.HOME = home
    await mkdir(codexProjectMemoryRoot('from-project'), { recursive: true })
    await mkdir(codexProjectMemoryRoot('to-project'), { recursive: true })
    await writeActiveMemoriesFromRoot(
      codexProjectMemoryRoot('from-project'),
      [createActive({ id: 'from-active', content: 'Merged project memory.' })]
    )

    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        'codex',
        'project',
        'merge',
        'from-project',
        'to-project'
      ],
      { env: cliEnv(home) }
    )

    expect(result.stdout).toContain('merged from: from-project')
    expect(result.stdout).toContain('merged into: to-project')
    await expect(readActiveMemoriesFromRoot(codexProjectMemoryRoot('to-project'))).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ content: 'Merged project memory.' })])
    )
  })

  it('reports failed Stop hook summary reason in memory status and doctor', async () => {
    const home = await createTempDir('cyrene-codex-cli-stop-hook-failure-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-stop-hook-failure-repo-')
    const identity = await identifyCodexProject(repo)
    const currentMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(currentMemoryRoot, { recursive: true })
    await writeFile(join(currentMemoryRoot, 'review-summaries.jsonl'), `${JSON.stringify({
      id: 'summary-failed-1',
      runId: 'session:turn',
      sessionId: 'session',
      turnId: 'turn',
      createdAt: '2026-05-28T00:00:00.000Z',
      status: 'failed',
      summary: 'Codex Stop hook failed; no transcript content persisted.',
      redaction: { input: {}, output: {} },
      candidateIds: [],
      failureReason: 'Transcript path is unreadable.'
    })}\n`)

    const status = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'status'],
      { env: cliEnv(home) }
    )
    const doctor = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'doctor'],
      { env: cliEnv(home) }
    )

    expect(status.stdout).toContain('last stop hook run: 2026-05-28T00:00:00.000Z (failed)')
    expect(status.stdout).toContain('stop hook reason: Transcript path is unreadable.')
    expect(doctor.stdout).toContain('last stop hook run: 2026-05-28T00:00:00.000Z (failed)')
    expect(doctor.stdout).toContain('stop hook reason: Transcript path is unreadable.')
  })

  it('reports unreadable automation state without failing memory status', async () => {
    const home = await createTempDir('cyrene-codex-cli-memory-status-automation-state-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-memory-status-automation-state-repo-')
    const identity = await identifyCodexProject(repo)
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(projectMemoryRoot, { recursive: true })
    await writeFile(join(projectMemoryRoot, 'dream-state.json'), '{not json')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'status'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('automation state: unreadable')
    expect(result.stdout).toContain('automation state reason:')
  })

  it('reports unreadable automation state without failing doctor', async () => {
    const home = await createTempDir('cyrene-codex-cli-doctor-automation-state-home-')
    process.env.HOME = home
    const repo = await createTempDir('cyrene-codex-cli-doctor-automation-state-repo-')
    const identity = await identifyCodexProject(repo)
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(projectMemoryRoot, { recursive: true })
    await writeFile(join(projectMemoryRoot, 'dream-state.json'), '{not json')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'doctor'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('automation state: unreadable')
    expect(result.stdout).toContain('automation state reason:')
  })

  it('doctor reports pending counts and current repo MCP command freshness', async () => {
    const home = await createTempDir('cyrene-codex-cli-doctor-pending-home-')
    process.env.HOME = home
    const repoRoot = process.cwd()
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene]',
        'command = "npm"',
        `args = ["--prefix", ${JSON.stringify(repoRoot)}, "run", "--silent", "dev", "--", "mcp-server", "--stdio"]`,
        'enabled = true'
      ].join('\n')
    )
    const globalMemoryRoot = codexGlobalMemoryRoot()
    const globalPending = {
      ...createPending(),
      id: 'global-pending-1',
      scope: 'global' as const,
      normalizedKey: 'global-pending-count-diagnostic'
    }
    await mkdir(globalMemoryRoot, { recursive: true })
    await writeFile(join(globalMemoryRoot, 'review_queue.jsonl'), `${JSON.stringify(globalPending)}\n`)

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('global review queue: 1')
    expect(result.stdout).toContain('project review queue: 0')
    expect(result.stdout).toContain('mcp command:')
    expect(result.stdout).toContain('npm')
    expect(result.stdout).toContain('--prefix')
    expect(result.stdout).toContain(repoRoot)
    expect(result.stdout).toContain('mcp-server')
    expect(result.stdout).toContain('--stdio')
    expect(result.stdout).toContain('mcp command freshness: current repo')
  })

  it('doctor parses TOML inline comments and reports project pending counts', async () => {
    const home = await createTempDir('cyrene-codex-cli-doctor-comments-home-')
    process.env.HOME = home
    const repoRoot = process.cwd()
    const configPath = join(home, '.codex-config.toml')
    await writeFile(
      configPath,
      [
        '[mcp_servers.cyrene] # local dev',
        'command = "npm" # local',
        `args = ["--prefix", ${JSON.stringify(repoRoot)}, "run", "--silent", "dev", "--", "mcp-server", "--stdio"] # local`,
        'enabled = true # local'
      ].join('\n')
    )
    const identity = await identifyCodexProject(process.cwd())
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const projectPending = {
      ...createPending(),
      id: 'project-pending-1',
      normalizedKey: 'project-pending-count-diagnostic'
    }
    await mkdir(projectMemoryRoot, { recursive: true })
    await writeFile(join(projectMemoryRoot, 'review_queue.jsonl'), `${JSON.stringify(projectPending)}\n`)

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'doctor', '--config', configPath],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('cyrene-continuity mcp: configured')
    expect(result.stdout).toContain('legacy mcp name: cyrene')
    expect(result.stdout).toContain('mcp command:')
    expect(result.stdout).toContain('npm')
    expect(result.stdout).toContain('--prefix')
    expect(result.stdout).toContain(repoRoot)
    expect(result.stdout).toContain('mcp command freshness: current repo')
    expect(result.stdout).toContain('global review queue: 0')
    expect(result.stdout).toContain('project review queue: 1')
  })

  it('memory review lists pending candidates with review metadata', async () => {
    const home = await createTempDir('cyrene-codex-cli-review-home-')
    const repo = await createTempDir('cyrene-codex-cli-review-project-')
    process.env.HOME = home
    const candidate = createPending()
    await seedCliPending(repo, candidate)

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', repo, 'codex', 'memory', 'review'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Cyrene Pending Memory Review')
    expect(result.stdout).toContain('id: cli-pending-1')
    expect(result.stdout).toContain('recommendation: promote')
    expect(result.stdout).toContain('candidate kind: workflow_rule')
    expect(result.stdout).toContain('evidence count: 2')
    expect(result.stdout).toContain(`review hash: ${reviewHashForPendingMemory(candidate)}`)
    expect(result.stdout).toContain(
      `suggested action: Review cli-pending-1 in Codex chat before any promote action; review hash ${reviewHashForPendingMemory(candidate)}.`
    )
    expect(result.stdout).not.toContain('cyrene-continuity codex memory approve')
    expect(result.stdout).not.toContain('cyrene-continuity codex memory reject')
    expect(result.stdout).not.toContain('cyrene-continuity codex memory defer')
  })

  it('memory approve/reject/edit/defer route through hash-checked review functions', async () => {
    const home = await createTempDir('cyrene-codex-cli-review-actions-home-')
    const repo = await createTempDir('cyrene-codex-cli-review-actions-project-')
    process.env.HOME = home
    const editCandidate = createPending({ id: 'cli-edit-1', normalizedKey: 'cli-edit-1' })
    const deferCandidate = createPending({ id: 'cli-defer-1', normalizedKey: 'cli-defer-1' })
    const rejectCandidate = createPending({ id: 'cli-reject-1', normalizedKey: 'cli-reject-1' })
    const approveCandidate = createPending({ id: 'cli-approve-1', normalizedKey: 'cli-approve-1' })
    const memoryRoot = await seedCliPending(repo, [editCandidate, deferCandidate, rejectCandidate, approveCandidate])

    const edit = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        '--cwd',
        repo,
        'codex',
        'memory',
        'edit',
        'cli-edit-1',
        '--review-hash',
        reviewHashForPendingMemory(editCandidate),
        '--content',
        'Edited CLI pending memory.'
      ],
      { env: cliEnv(home) }
    )
    expect(JSON.parse(edit.stdout).result.action).toBe('edit')

    const defer = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        '--cwd',
        repo,
        'codex',
        'memory',
        'defer',
        'cli-defer-1',
        '--review-hash',
        reviewHashForPendingMemory(deferCandidate),
        '--days',
        '14'
      ],
      { env: cliEnv(home) }
    )
    expect(JSON.parse(defer.stdout).result.action).toBe('defer')

    const reject = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        '--cwd',
        repo,
        'codex',
        'memory',
        'reject',
        'cli-reject-1',
        '--review-hash',
        reviewHashForPendingMemory(rejectCandidate)
      ],
      { env: cliEnv(home) }
    )
    expect(JSON.parse(reject.stdout).result.action).toBe('reject')

    const approve = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        '--cwd',
        repo,
        'codex',
        'memory',
        'approve',
        'cli-approve-1',
        '--review-hash',
        reviewHashForPendingMemory(approveCandidate)
      ],
      { env: cliEnv(home) }
    )
    expect(JSON.parse(approve.stdout).result.action).toBe('promote')

    const pending = await readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')
    expect(pending).toContain('Edited CLI pending memory.')
    expect(pending).toContain('cli-defer-1')
    expect(pending).not.toContain('cli-reject-1')
    expect(pending).not.toContain('cli-approve-1')
  })

  it('runs active memory archive from the Codex CLI', async () => {
    const home = await createTempDir('cyrene-cli-active-home-')
    const repo = await createTempDir('cyrene-cli-active-project-')
    process.env.HOME = home
    const { active, contentHash, memoryRoot } = await seedCliActiveMemory(repo)

    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        '--cwd',
        repo,
        'codex',
        'memory',
        'active',
        'archive',
        active.id,
        '--content-hash',
        contentHash,
        '--reason',
        'Stale.'
      ],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout).result.action).toBe('archive')
    await expect(readActiveMemoriesFromRoot(memoryRoot)).resolves.toEqual([])
  })

  it('runs memory triage dry-run from the Codex CLI', async () => {
    const home = await createTempDir('cyrene-cli-triage-home-')
    const repo = await createTempDir('cyrene-cli-triage-project-')
    process.env.HOME = home
    await seedCliPending(repo, createPending({
      id: 'triage-noise',
      content: 'Ran npm test today.',
      normalizedKey: 'ran-npm-test-today',
      evidence: [{ summary: 'temporary command result' }],
      seenCount: 1
    }))

    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        '--cwd',
        repo,
        'codex',
        'memory',
        'triage',
        '--dry-run'
      ],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as { action?: string; decisions?: Array<{ action: string; candidateId: string }> }
    expect(parsed.action).toBe('dry_run')
    expect(parsed.decisions).toContainEqual(expect.objectContaining({ action: 'auto_drop', candidateId: 'triage-noise' }))
  })

  it('runs memory prepare dry-run from the Codex CLI without mutating pending memory', async () => {
    const home = await createTempDir('cyrene-cli-prepare-home-')
    const repo = await createTempDir('cyrene-cli-prepare-project-')
    process.env.HOME = home
    const candidate = createPending({
      id: 'prepare-implementation-note',
      domain: 'project',
      type: 'project_fact',
      content: 'v1 admission gate 核心实现采用 subagent-driven 执行方案，并创建隔离工作区。',
      normalizedKey: 'v1-admission-gate-subagent-worktree',
      candidateKind: 'project_decision',
      sourceOfTruth: 'review_summary:task-1',
      tags: ['project_decision']
    })
    const memoryRoot = await seedCliPending(repo, candidate)
    const pendingBefore = await readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')

    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        '--cwd',
        repo,
        'codex',
        'memory',
        'prepare',
        '--dry-run'
      ],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as { dryRun?: boolean; results?: Array<{ action: string }> }
    expect(parsed.dryRun).toBe(true)
    expect(parsed.results).toContainEqual(expect.objectContaining({ action: 'replace_content' }))
    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toBe(pendingBefore)
  })

  it('runs memory distill dry-run from the CLI', async () => {
    const home = await createTempDir('cyrene-distill-cli-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-distill-cli-project-')
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'distill-cli-test' }), 'utf8')
    await seedCliPending(cwd, [
      createPending({ id: 'distill-a', normalizedKey: 'release-typecheck', content: 'Use npm run typecheck before release.' }),
      createPending({ id: 'distill-b', normalizedKey: 'release-typecheck', content: 'Release verification includes npm run typecheck.' })
    ])

    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        '--cwd',
        cwd,
        'codex',
        'memory',
        'distill',
        '--dry-run'
      ],
      { cwd: process.cwd(), env: cliEnv(home), timeout: 5_000 }
    )

    expect(result.stdout).toContain('"mode": "dry_run"')
    expect(result.stdout).toContain('"recommendedAction": "merge_pending"')
  })

  it('memory approve accepts explicit normalizedKey conflict resolution', async () => {
    const home = await createTempDir('cyrene-codex-cli-conflict-resolution-home-')
    const repo = await createTempDir('cyrene-codex-cli-conflict-resolution-project-')
    process.env.HOME = home
    const active = createActive({
      id: 'cli-active-conflict',
      normalizedKey: 'cli-conflict-resolution-key',
      content: 'Old CLI active memory should be superseded.'
    })
    const candidate = createPending({
      id: 'cli-pending-conflict',
      normalizedKey: active.normalizedKey,
      content: 'New CLI pending memory should supersede the old one.'
    })
    const memoryRoot = await seedCliPending(repo, candidate)
    await writeActiveMemoriesFromRoot(memoryRoot, [active])

    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        '--cwd',
        repo,
        'codex',
        'memory',
        'approve',
        candidate.id,
        '--review-hash',
        reviewHashForPendingMemory(candidate),
        '--conflict-resolution',
        'supersede'
      ],
      { env: cliEnv(home) }
    )

    const parsed = JSON.parse(result.stdout)
    expect(parsed.result.action).toBe('promote')
    expect(parsed.result.memory.supersedes).toEqual([active.id])
    const activeAfter = await readActiveMemoriesFromRoot(memoryRoot)
    expect(activeAfter).toEqual(expect.arrayContaining([expect.objectContaining({ content: candidate.content })]))
    expect(activeAfter).not.toEqual(expect.arrayContaining([expect.objectContaining({ content: active.content })]))
  })

  it('memory approve rejects invalid normalizedKey conflict resolution values', async () => {
    const home = await createTempDir('cyrene-codex-cli-invalid-conflict-resolution-home-')
    const repo = await createTempDir('cyrene-codex-cli-invalid-conflict-resolution-project-')
    process.env.HOME = home
    const candidate = createPending({
      id: 'cli-invalid-conflict-resolution',
      normalizedKey: 'cli-invalid-conflict-resolution'
    })
    await seedCliPending(repo, candidate)

    await expect(
      execFileAsync(
        process.execPath,
        [
          'node_modules/tsx/dist/cli.mjs',
          'src/main.ts',
          '--cwd',
          repo,
          'codex',
          'memory',
          'approve',
          candidate.id,
          '--review-hash',
          reviewHashForPendingMemory(candidate),
          '--conflict-resolution',
          'replace'
        ],
        { env: cliEnv(home) }
      )
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Invalid --conflict-resolution')
    })
  })

  it('runs memory automation daily and weekly from the CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-automation-home-')
    process.env.HOME = home

    const daily = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'automation', '--job', 'daily', '--dry-run'],
      { env: cliEnv(home) }
    )

    const weekly = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'automation', '--job', 'weekly', '--dry-run'],
      { env: cliEnv(home) }
    )

    expect(daily.stderr).toBe('')
    expect(JSON.parse(daily.stdout)).toMatchObject({ job: 'daily', action: 'memory_lifecycle_daily', dryRun: true })
    expect(weekly.stderr).toBe('')
    expect(JSON.parse(weekly.stdout)).toMatchObject({ job: 'weekly', action: 'memory_lifecycle_weekly', dryRun: true })
  })

  it('runs memory maintenance from the CLI without promoting pending memory', async () => {
    const home = await createTempDir('cyrene-codex-cli-maintenance-home-')
    process.env.HOME = home
    const identity = await identifyCodexProject(process.cwd())
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeActiveMemoriesFromRoot(memoryRoot, [createActive()])
    await writeFile(join(memoryRoot, 'review_queue.jsonl'), `${JSON.stringify(createPending())}\n`)

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'maintenance'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as { roots: Array<{ maintenance: { activeCount: number; pendingCount: number }; promoted?: number }> }
    expect(parsed.roots.some((root) => root.maintenance.activeCount === 1 && root.maintenance.pendingCount === 1)).toBe(true)
    expect(parsed.roots.every((root) => root.promoted === undefined || root.promoted === 0)).toBe(true)
    await expect(readFile(join(memoryRoot, 'review_queue.jsonl'), 'utf8')).resolves.toContain('CLI dream promotes repeated pending memory.')
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain('CLI maintenance renders active memory into the model profile.')
  })

  it('runs profile reflect and apply from the CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-profile-home-')
    process.env.HOME = home
    const identity = await identifyCodexProject(process.cwd())
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(memoryRoot, { recursive: true })
    await writeActiveMemoriesFromRoot(memoryRoot, [createActive()])

    const reflect = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'profile', 'reflect', '--source', 'daily-interview'],
      { env: cliEnv(home) }
    )

    expect(reflect.stderr).toBe('')
    const reflected = JSON.parse(reflect.stdout) as { candidates: Array<{ id: string; reviewHash: string }> }
    expect(reflected.candidates[0]?.reviewHash).toMatch(/^[a-f0-9]{64}$/)

    const apply = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        'codex',
        'profile',
        'apply',
        '--candidate',
        reflected.candidates[0]?.id ?? '',
        '--review-hash',
        reflected.candidates[0]?.reviewHash ?? ''
      ],
      { env: cliEnv(home) }
    )

    expect(apply.stderr).toBe('')
    const applied = JSON.parse(apply.stdout) as { result: { action: string } }
    expect(applied.result.action).toBe('apply')
    await expect(readFile(join(memoryRoot, 'MODEL_PROFILE.md'), 'utf8')).resolves.toContain('CLI maintenance renders active memory into the model profile.')
  })

  it('runs similar-hints explain and mark-transferable from the CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-similar-home-')
    process.env.HOME = home
    const identity = await identifyCodexProject(process.cwd())
    const memoryRoot = codexProjectMemoryRoot(identity.projectId)
    const memory = createActive()
    await writeActiveMemoriesFromRoot(memoryRoot, [memory])

    const explain = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'similar-hints', 'explain', '--memory-id', memory.id],
      { env: cliEnv(home) }
    )

    expect(explain.stderr).toBe('')
    expect(JSON.parse(explain.stdout)).toEqual(expect.arrayContaining([
      expect.objectContaining({ memoryId: memory.id })
    ]))

    const mark = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        'codex',
        'similar-hints',
        'mark-transferable',
        '--memory-id',
        memory.id,
        '--review-hash',
        reviewHashForSimilarHintMemory(memory)
      ],
      { env: cliEnv(home) }
    )

    expect(mark.stderr).toBe('')
    expect(JSON.parse(mark.stdout)).toMatchObject({ action: 'mark_transferable', memoryId: memory.id })
    await expect(readActiveMemoriesFromRoot(memoryRoot)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: memory.id, portability: 'similar_project' })])
    )
  })

  it('runs the similar hints eval check from the Codex CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-eval-home-')
    const repo = await createTempDir('cyrene-codex-cli-eval-repo-')
    const repoRoot = process.cwd()

    const result = await execFileAsync(
      process.execPath,
      [
        join(repoRoot, 'node_modules/tsx/dist/cli.mjs'),
        join(repoRoot, 'src/main.ts'),
        'codex',
        'eval',
        'run',
        '--check',
        'similar-hints'
      ],
      { cwd: repo, env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as {
      check: string
      passed: boolean
      failedChecks: string[]
      similarProjectHints: number
    }
    expect(parsed).toEqual({
      check: 'similar-hints',
      passed: true,
      failedChecks: [],
      similarProjectHints: 0
    })
  })

  it('runs the release eval check from the Codex CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-release-eval-home-')

    const result = await execFileAsync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'src/main.ts',
        'codex',
        'eval',
        'run',
        '--check',
        'release'
      ],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout) as {
      check: string
      passed: boolean
      failedChecks: string[]
      minimumChecks: string[]
      results: Array<{ name: string; passed: boolean }>
    }
    expect(parsed).toMatchObject({
      check: 'release',
      passed: true,
      failedChecks: [],
      minimumChecks: [
        'memory_routing_eval',
        'profile_pollution_eval',
        'affective_boundary_eval',
        'cross_project_leak_eval',
        'pending_usage_eval',
        'similar_hint_eval',
        'auto_promotion_policy_eval',
        'global_auto_promotion_eval',
        'active_lifecycle_eval',
        'pending_budget_eval',
        'memory_edge_eval',
        'retrieval_explain_eval',
        'distillation_review_gate'
      ]
    })
    expect(parsed.results.map((item) => item.name)).toEqual(parsed.minimumChecks)
    expect(parsed.results.every((item) => item.passed)).toBe(true)
  })

  it('rejects similar hints eval check with trailing unsupported args', async () => {
    const home = await createTempDir('cyrene-codex-cli-eval-extra-home-')

    await expect(
      execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'eval', 'run', '--check', 'similar-hints', 'extra'],
        { env: cliEnv(home) }
      )
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Usage')
    })
  })

  it('rejects memory automation --job without a value', async () => {
    const home = await createTempDir('cyrene-codex-cli-automation-home-')
    process.env.HOME = home

    await expect(
      execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'automation', '--job'],
        { env: cliEnv(home) }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Invalid memory automation job')
    })
  })

  it('rejects unsupported memory automation jobs', async () => {
    const home = await createTempDir('cyrene-codex-cli-automation-invalid-home-')
    process.env.HOME = home

    await expect(
      execFileAsync(
        process.execPath,
        ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'automation', '--job', 'deep'],
        { env: cliEnv(home) }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Invalid memory automation job: deep. Expected daily or weekly')
    })
  })

  it('forwards --cwd to codex subcommands', async () => {
    const home = await createTempDir('cyrene-codex-cli-cwd-home-')
    process.env.HOME = home
    const cwd = await createTempDir('cyrene-codex-cli-cwd-project-')
    const identity = await identifyCodexProject(cwd)
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    await mkdir(projectMemoryRoot, { recursive: true })
    await writeFile(join(projectMemoryRoot, 'MODEL_PROFILE.md'), '# Cyrene Model Profile\n\n- Cwd-specific profile.\n')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', '--cwd', cwd, 'codex', 'memory', 'profile'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Cwd-specific profile.')
  })

  it('prints effective memory profile from the CLI', async () => {
    const home = await createTempDir('cyrene-codex-cli-profile-home-')
    process.env.HOME = home
    const identity = await identifyCodexProject(process.cwd())
    const projectMemoryRoot = codexProjectMemoryRoot(identity.projectId)
    const globalMemoryRoot = codexGlobalMemoryRoot()
    await mkdir(projectMemoryRoot, { recursive: true })
    await mkdir(globalMemoryRoot, { recursive: true })
    await writeFile(join(globalMemoryRoot, 'MODEL_PROFILE.md'), '# Cyrene Model Profile\n\n- Global profile.\n')
    await writeFile(join(projectMemoryRoot, 'MODEL_PROFILE.md'), '# Cyrene Model Profile\n\n- Project profile.\n')

    const result = await execFileAsync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'src/main.ts', 'codex', 'memory', 'profile'],
      { env: cliEnv(home) }
    )

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Global profile.')
    expect(result.stdout).toContain('Project profile.')
  })
})
