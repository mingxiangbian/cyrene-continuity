import { execFile as execFileCallback } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)

const REQUIRED_V2_GATES = [
  'jsonl-corruption-write-block',
  'jsonl-repair-atomic-concurrent',
  'index-stale-mode-matrix',
  'pending-isolation-under-fallback',
  'false-persistence-under-fallback',
  'retrieval-quality-tight-budget',
  'edge-lookup-index-backed',
  'project-harvest-preview-first',
  'project-harvest-quality-routing',
  'ux-diagnostics-next-action',
  'llm-call-budget'
] as const

type V2Gate = (typeof REQUIRED_V2_GATES)[number]

const V2_GATE_BACKING: Record<V2Gate, { file: string; fragments: string[] }> = {
  'jsonl-corruption-write-block': {
    file: 'benchmark/cases/tier4-failure-security.ts',
    fragments: ['gate=jsonl-corruption-write-block', 'runJsonlCorrupt']
  },
  'jsonl-repair-atomic-concurrent': {
    file: 'tests/memory-jsonl-repair.test.ts',
    fragments: ['apply aborts if source file changes between scan and rewrite']
  },
  'index-stale-mode-matrix': {
    file: 'tests/codex-cli.test.ts',
    fragments: [
      'reports SQLite unavailable fallback in memory status without mutating the index',
      'reports stale index in memory status and doctor without rebuilding it'
    ]
  },
  'pending-isolation-under-fallback': {
    file: 'tests/codex-continuity-context.test.ts',
    fragments: ['balanced mode uses bounded JSONL fallback and only returns relevant active memory']
  },
  'false-persistence-under-fallback': {
    file: 'tests/codex-continuity-context.test.ts',
    fragments: ['keeps JSONL fallback pending memory provisional when explicitly allowed without creating the index']
  },
  'retrieval-quality-tight-budget': {
    file: 'benchmark/cases/tier3-scale-efficiency.ts',
    fragments: ['gate=retrieval-quality-tight-budget', 'runRankingCase']
  },
  'edge-lookup-index-backed': {
    file: 'tests/memory-index.test.ts',
    fragments: ['uses indexed predicates for memory edge lookup', 'explain query plan']
  },
  'project-harvest-preview-first': {
    file: 'tests/project-memory-harvester.test.ts',
    fragments: [
      'returns a preview artifact by default and does not write memory or review queue',
      'preview_required for explicit dryRun false without apply credentials'
    ]
  },
  'project-harvest-quality-routing': {
    file: 'tests/project-memory-harvester.test.ts',
    fragments: [
      'routes review-summary-only harvest candidates to review_required instead of trial_eligible',
      'routes same-boundary contradictory workflow commands to review_required'
    ]
  },
  'ux-diagnostics-next-action': {
    file: 'tests/codex-ui-api.test.ts',
    fragments: [
      'returns next actions for repair-required dashboard diagnostics',
      'returns next action for stale index dashboard diagnostics'
    ]
  },
  'llm-call-budget': {
    file: 'tests/project-memory-harvester.test.ts',
    fragments: ['applies a matching preview without another LLM call', 'apply must not call the LLM']
  }
}

describe('v2 foundation gates', () => {
  it('keeps every required gate backed by a focused test or benchmark fixture', async () => {
    expect(Object.keys(V2_GATE_BACKING).sort()).toEqual([...REQUIRED_V2_GATES].sort())
    for (const [gate, backing] of Object.entries(V2_GATE_BACKING) as Array<[V2Gate, typeof V2_GATE_BACKING[V2Gate]]>) {
      const text = await readFile(join(process.cwd(), backing.file), 'utf8')
      for (const fragment of backing.fragments) {
        expect(text, `${gate} backing is missing ${fragment}`).toContain(fragment)
      }
    }
  })

  it('runs runtime sampling for the isolated CLI repair and rebuild path', async () => {
    const { stdout, stderr } = await execFile(
      process.execPath,
      ['scripts/v2-foundation-runtime-sampling.mjs'],
      { cwd: process.cwd(), maxBuffer: 1024 * 1024 * 8 }
    )
    expect(stderr).toBe('')
    const parsed = JSON.parse(stdout) as {
      ok: boolean
      home: string
      project: string
      memoryRoot: string
      dbPath: string
      dryRunAction: string
      repairAction: string
      syncedRoots: number
    }
    expect(parsed).toEqual(expect.objectContaining({
      ok: true,
      dryRunAction: 'dry_run',
      repairAction: 'repaired',
      syncedRoots: 1
    }))
    expect(isWithin(parsed.home, parsed.memoryRoot)).toBe(true)
    expect(isWithin(parsed.home, parsed.dbPath)).toBe(true)
    expect(isWithin(parsed.project, parsed.memoryRoot)).toBe(false)
  }, 20_000)
})

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}
