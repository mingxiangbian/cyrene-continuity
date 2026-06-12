import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function loadDiagnostics(): Promise<typeof import('../src/memory/jsonl-diagnostics.js')> {
  return import('../src/memory/jsonl-diagnostics.js')
}

describe('jsonl diagnostics', () => {
  it('declares the v2 canonical JSONL allowlist', async () => {
    const { CANONICAL_JSONL_FILES } = await loadDiagnostics()

    expect(CANONICAL_JSONL_FILES).toEqual([
      'index.jsonl',
      'pending.jsonl',
      'review_queue.jsonl',
      'episodes.jsonl',
      'candidate_drafts.jsonl',
      'admission_decisions.jsonl',
      'semantic_memories.jsonl',
      'distillation_inputs.jsonl',
      'routing_decisions.jsonl',
      'review_decisions.jsonl',
      'activation_events.jsonl',
      'reflection_candidates.jsonl',
      'semantic_rewrite_receipts.jsonl',
      'memory_edges.jsonl',
      'events.jsonl',
      'tombstones.jsonl'
    ])
  })

  it('classifies non-core artifacts as diagnostic-only or ignored', async () => {
    const { classifyMemoryArtifact } = await loadDiagnostics()

    expect(classifyMemoryArtifact('semantic_memories.jsonl')).toBe('canonical')
    expect(classifyMemoryArtifact('nested/semantic_memories.jsonl')).toBe('ignored')
    expect(classifyMemoryArtifact('nested\\semantic_memories.jsonl')).toBe('ignored')
    expect(classifyMemoryArtifact('profile_candidates.jsonl')).toBe('diagnostic_only')
    expect(classifyMemoryArtifact('review-summaries.jsonl')).toBe('diagnostic_only')
    expect(classifyMemoryArtifact('runtime_metrics.jsonl')).toBe('diagnostic_only')
    expect(classifyMemoryArtifact('hook-trace.jsonl')).toBe('diagnostic_only')
    expect(classifyMemoryArtifact('session_hints.json')).toBe('ignored')
    expect(classifyMemoryArtifact('repair/tx/quarantine.jsonl')).toBe('ignored')
    expect(classifyMemoryArtifact('repair\\tx\\quarantine.jsonl')).toBe('ignored')
    expect(classifyMemoryArtifact('unknown.jsonl')).toBe('ignored')
  })

  it('returns an empty ok scan for missing files', async () => {
    const { scanJsonlFile } = await loadDiagnostics()
    const root = await createTempDir('cyrene-jsonl-missing-')

    const result = await scanJsonlFile(join(root, 'missing.jsonl'))

    expect(result).toMatchObject({
      ok: true,
      validRecords: [],
      malformed: [],
      bytesRead: 0
    })
  })

  it('reports malformed lines without returning raw line content', async () => {
    const { scanJsonlFile } = await loadDiagnostics()
    const root = await createTempDir('cyrene-jsonl-diagnostics-')
    const file = join(root, 'semantic_memories.jsonl')
    await writeFile(file, '{"id":"ok"}\n{bad json}\n{"id":"ok2"}\n', 'utf8')

    const result = await scanJsonlFile(file, { includeRawLine: false }, 'semantic_memories.jsonl')

    expect(result.ok).toBe(false)
    expect(result.validRecords).toEqual([{ id: 'ok' }, { id: 'ok2' }])
    expect(result.malformed).toHaveLength(1)
    expect(result.malformed[0]).toMatchObject({ lineNumber: 2, relativePath: 'semantic_memories.jsonl' })
    expect(result.malformed[0].rawLine).toBeUndefined()
    expect(result.malformed[0].rawLineSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.malformed[0].parseError).toEqual(expect.any(String))
  })

  it('can include raw malformed lines for explicit file scans', async () => {
    const { scanJsonlFile, sha256 } = await loadDiagnostics()
    const root = await createTempDir('cyrene-jsonl-raw-line-')
    const file = join(root, 'semantic_memories.jsonl')
    await writeFile(file, '  {bad json}  \n', 'utf8')

    const result = await scanJsonlFile(file, { includeRawLine: true })

    expect(result.malformed[0]).toMatchObject({
      lineNumber: 1,
      rawLine: '{bad json}',
      rawLineSha256: sha256('{bad json}')
    })
  })

  it('applies file size caps deterministically', async () => {
    const { scanJsonlFile } = await loadDiagnostics()
    const root = await createTempDir('cyrene-jsonl-cap-')
    const file = join(root, 'semantic_memories.jsonl')
    await writeFile(file, '{"id":"ok"}\n', 'utf8')

    const result = await scanJsonlFile(file, { fileSizeCapBytes: 4 })

    expect(result.ok).toBe(false)
    expect(result.validRecords).toEqual([])
    expect(result.malformed).toEqual([])
    expect(result.bytesRead).toBe(0)
    expect(result.skippedReason).toContain('file_size_cap:4')
  })

  it('refuses symlinks and non-files', async () => {
    const { scanJsonlFile } = await loadDiagnostics()
    const root = await createTempDir('cyrene-jsonl-unsafe-')
    const target = join(root, 'target.jsonl')
    const link = join(root, 'link.jsonl')
    await writeFile(target, '{"id":"ok"}\n', 'utf8')
    await symlink(target, link)

    await expect(scanJsonlFile(link)).rejects.toThrow(/symlink/i)
    await expect(scanJsonlFile(root)).rejects.toThrow(/non-file/i)
  })

  it('scans only canonical files by default', async () => {
    const { scanCanonicalJsonlFilesFromRoot } = await loadDiagnostics()
    const root = await createTempDir('cyrene-jsonl-root-')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'semantic_memories.jsonl'), '{"id":"ok"}\n', 'utf8')
    await writeFile(join(root, 'runtime_metrics.jsonl'), '{bad json}\n', 'utf8')

    const result = await scanCanonicalJsonlFilesFromRoot(root)

    expect(result.files.map((file) => file.relativePath)).toEqual(['semantic_memories.jsonl'])
    expect(result.corruptionCount).toBe(0)
  })

  it('orders root scans by the canonical allowlist and never returns raw lines', async () => {
    const { scanCanonicalJsonlFilesFromRoot } = await loadDiagnostics()
    const root = await createTempDir('cyrene-jsonl-root-order-')
    await writeFile(join(root, 'semantic_memories.jsonl'), '{bad json}\n', 'utf8')
    await writeFile(join(root, 'index.jsonl'), '{"id":"legacy"}\n', 'utf8')
    await writeFile(join(root, 'tombstones.jsonl'), '{bad tombstone}\n', 'utf8')

    const result = await scanCanonicalJsonlFilesFromRoot(root, { includeRawLine: true })

    expect(result.files.map((file) => file.relativePath)).toEqual([
      'index.jsonl',
      'semantic_memories.jsonl',
      'tombstones.jsonl'
    ])
    expect(result.corruptionCount).toBe(2)
    expect(result.files.flatMap((file) => file.malformed).map((line) => line.rawLine)).toEqual([undefined, undefined])
  })

  it('reports skipped root files as corruption', async () => {
    const { jsonlScanHasCorruption, scanCanonicalJsonlFilesFromRoot } = await loadDiagnostics()
    const root = await createTempDir('cyrene-jsonl-root-cap-')
    await writeFile(join(root, 'semantic_memories.jsonl'), '{"id":"ok"}\n', 'utf8')

    const result = await scanCanonicalJsonlFilesFromRoot(root, { fileSizeCapBytes: 4 })

    expect(result.skippedFiles).toEqual([
      expect.objectContaining({
        relativePath: 'semantic_memories.jsonl',
        skippedReason: 'file_size_cap:4'
      })
    ])
    expect(jsonlScanHasCorruption(result)).toBe(true)
  })
})
