#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const repoRoot = process.cwd()

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'cyrene-v2-runtime-sampling-'))
  const home = join(root, 'home')
  const project = join(root, 'project')
  await mkdir(home, { recursive: true })
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'v2-runtime-sampling' }, null, 2) + '\n')

  const env = { ...process.env, HOME: home }
  const projectStatus = await runCodex(project, env, ['project', 'status'])
  const memoryRoot = parseProjectMemoryRoot(projectStatus.stdout)
  assertWithin(home, memoryRoot, 'project memory root')
  await mkdir(memoryRoot, { recursive: true })

  const semanticPath = join(memoryRoot, 'semantic_memories.jsonl')
  assertWithin(home, semanticPath, 'semantic memory path')
  assertWithin(memoryRoot, semanticPath, 'semantic memory path')
  const original = `${JSON.stringify(runtimeSamplingMemory())}\n{malformed semantic memory}\n`
  await writeFile(semanticPath, original, 'utf8')

  const dryRun = await runCodex(project, env, ['memory', 'jsonl', 'repair', '--dry-run'])
  const dryRunJson = parseJson(dryRun.stdout, 'memory jsonl repair --dry-run')
  assertEqual(dryRunJson.action, 'memory_jsonl_repair', 'dry-run action')
  assertEqual(dryRunJson.dryRun, true, 'dry-run flag')
  assertEqual(dryRunJson.roots?.[0]?.malformedLineCount, 1, 'dry-run malformed count')
  const beforeApply = await readFile(semanticPath, 'utf8')
  assertEqual(beforeApply, original, 'dry-run must not mutate canonical JSONL')

  const repair = await runCodex(project, env, ['memory', 'jsonl', 'repair', '--apply'])
  const repairJson = parseJson(repair.stdout, 'memory jsonl repair --apply')
  assertEqual(repairJson.roots?.[0]?.action, 'repaired', 'repair action')
  assertEqual(repairJson.roots?.[0]?.malformedLineCount, 1, 'repair malformed count')

  const repaired = await readFile(semanticPath, 'utf8')
  if (repaired.includes('malformed semantic memory')) {
    throw new Error('repair left malformed line in semantic_memories.jsonl')
  }

  const rebuild = await runCodex(project, env, ['memory', 'db', 'rebuild'])
  const rebuildJson = parseJson(rebuild.stdout, 'memory db rebuild')
  assertEqual(rebuildJson.diagnostics?.available, true, 'SQLite diagnostics available')
  const dbPath = readString(rebuildJson.dbPath, 'memory db path')
  assertWithin(home, dbPath, 'memory db path')
  if ((rebuildJson.syncedRoots ?? 0) < 1) {
    throw new Error(`memory db rebuild synced no roots: ${rebuild.stdout}`)
  }
  if (Array.isArray(rebuildJson.skippedRoots) && rebuildJson.skippedRoots.length > 0) {
    throw new Error(`memory db rebuild skipped repaired roots: ${JSON.stringify(rebuildJson.skippedRoots)}`)
  }

  const status = await runCodex(project, env, ['memory', 'status'])
  if (!status.stdout.includes('memory repair: ok')) {
    throw new Error(`memory status did not report repaired state:\n${status.stdout}`)
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    home,
    project,
    memoryRoot,
    dbPath,
    dryRunAction: dryRunJson.roots?.[0]?.action,
    repairAction: repairJson.roots?.[0]?.action,
    syncedRoots: rebuildJson.syncedRoots
  }, null, 2) + '\n')
}

async function runCodex(cwd, env, args) {
  return execFile(process.execPath, [
    'node_modules/tsx/dist/cli.mjs',
    'src/main.ts',
    '--cwd',
    cwd,
    'codex',
    ...args
  ], {
    cwd: repoRoot,
    env,
    maxBuffer: 1024 * 1024 * 8
  })
}

function parseProjectMemoryRoot(stdout) {
  const match = stdout.match(/^\s*root:\s*(.+)$/m)
  if (match === null) {
    throw new Error(`project status did not include project memory root:\n${stdout}`)
  }
  return match[1].trim()
}

function parseJson(stdout, command) {
  try {
    return JSON.parse(stdout)
  } catch (error) {
    throw new Error(`${command} did not return JSON: ${error instanceof Error ? error.message : String(error)}\n${stdout}`)
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function readString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label}: expected non-empty string, got ${JSON.stringify(value)}`)
  }
  return value
}

function assertWithin(parent, child, label) {
  const parentPath = resolve(parent)
  const childPath = resolve(child)
  const path = relative(parentPath, childPath)
  if (path === '' || path.startsWith('..') || isAbsolute(path)) {
    throw new Error(`${label} escaped isolated runtime root: ${childPath} is not under ${parentPath}`)
  }
}

function runtimeSamplingMemory() {
  return {
    id: 'v2-runtime-sampling-memory',
    status: 'active',
    module: 'procedural',
    kind: 'workflow_rule',
    scope: 'project',
    domain: 'procedural',
    content: 'Runtime sampling repairs canonical JSONL before rebuilding the SQLite memory index.',
    useWhen: ['v2 runtime sampling jsonl repair sqlite rebuild'],
    doNotUseWhen: ['memory file repair has not been previewed'],
    sourceOfTruth: 'runtime-sampling',
    evidence: [{
      id: 'v2-runtime-sampling-evidence',
      sourceKind: 'user_explicit',
      sourceRef: 'runtime-sampling',
      when: '2026-06-12T00:00:00.000Z',
      whatHappened: 'The v2 foundation runtime sampler seeded a project workflow memory.',
      whyImportant: 'The sample exercises the CLI JSONL repair and index rebuild path in an isolated HOME.'
    }],
    routing: {
      module: 'procedural',
      updatePolicy: 'strict_auto_promote',
      risk: 'low',
      reasons: ['runtime sampling fixture']
    },
    reviewPolicy: 'strict_auto_promote',
    reviewState: {
      normalizedKey: 'v2-runtime-sampling-jsonl-repair-sqlite-rebuild',
      type: 'procedural_rule',
      strength: 'soft',
      source: 'user_explicit',
      scores: {
        evidenceStrength: 0.95,
        stability: 0.9,
        usefulness: 0.9,
        safety: 0.95,
        sensitivity: 0.05
      },
      tags: ['runtime-sampling']
    },
    confidenceTier: 'validated',
    activationPolicy: {
      allowedModes: ['workflow_hint', 'plan_constraint', 'checklist_item'],
      maxRuntimeStrength: 'checklist'
    },
    supersedes: [],
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z'
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
