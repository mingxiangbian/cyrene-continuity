import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runJsonlRepairFromRoot } from '../src/memory/memory-repair.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function parseJsonLines<T>(content: string): T[] {
  return content.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as T)
}

describe('jsonl repair', () => {
  it('dry-run leaves corrupted file bytes unchanged and creates no quarantine', async () => {
    const memoryRoot = await createTempDir('cyrene-jsonl-repair-dry-run-')
    const sourcePath = join(memoryRoot, 'semantic_memories.jsonl')
    const original = '{"id":"ok"}\n{bad json}\n{"id":"ok2"}\n'
    await writeFile(sourcePath, original, 'utf8')
    const resolvedMemoryRoot = await realpath(memoryRoot)

    const result = await runJsonlRepairFromRoot({ memoryRoot, apply: false })

    expect(result).toMatchObject({
      action: 'dry_run',
      memoryRoot: resolvedMemoryRoot,
      filesScanned: 1,
      filesRepaired: 0,
      malformedLineCount: 1,
      backupPaths: []
    })
    expect(result.quarantinePath).toBeUndefined()
    expect(result.summaryPath).toBeUndefined()
    await expect(readFile(sourcePath, 'utf8')).resolves.toBe(original)
    await expect(readdir(join(memoryRoot, 'repair'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('apply backs up original bytes, quarantines malformed line, rewrites valid records, and writes summary', async () => {
    const memoryRoot = await createTempDir('cyrene-jsonl-repair-apply-')
    const sourcePath = join(memoryRoot, 'semantic_memories.jsonl')
    const original = '{ "id": "ok", "nested": { "b": 2 } }\n{bad json}\n{"id":"ok2","a":1}\n'
    await writeFile(sourcePath, original, 'utf8')

    const result = await runJsonlRepairFromRoot({
      memoryRoot,
      apply: true,
      now: '2026-06-12T01:02:03.004Z'
    })

    expect(result.action).toBe('repaired')
    expect(result.filesScanned).toBe(1)
    expect(result.filesRepaired).toBe(1)
    expect(result.malformedLineCount).toBe(1)
    expect(result.backupPaths).toHaveLength(1)
    expect(result.quarantinePath).toEqual(expect.stringContaining('/repair/'))
    expect(result.summaryPath).toEqual(expect.stringContaining('/repair/'))

    await expect(readFile(result.backupPaths[0] as string, 'utf8')).resolves.toBe(original)
    await expect(readFile(sourcePath, 'utf8')).resolves.toBe(
      `${JSON.stringify({ id: 'ok', nested: { b: 2 } })}\n${JSON.stringify({ id: 'ok2', a: 1 })}\n`
    )

    const quarantine = parseJsonLines<{
      repairTransactionId: string
      source: string
      lineNumber: number
      rawLineSha256: string
      rawLine: string
      parseError: string
      quarantinedAt: string
    }>(await readFile(result.quarantinePath as string, 'utf8'))
    expect(quarantine).toEqual([
      expect.objectContaining({
        repairTransactionId: result.repairTransactionId,
        source: 'semantic_memories.jsonl',
        lineNumber: 2,
        rawLine: '{bad json}',
        quarantinedAt: '2026-06-12T01:02:03.004Z'
      })
    ])
    expect(quarantine[0]?.rawLineSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(quarantine[0]?.parseError).toEqual(expect.any(String))

    const summary = JSON.parse(await readFile(result.summaryPath as string, 'utf8')) as {
      status: string
      repairTransactionId: string
      filesRepaired: number
      malformedLineCount: number
      backupPaths: string[]
      quarantinePath: string
      startedAt: string
      finishedAt: string
      toolVersion: string
    }
    expect(summary).toMatchObject({
      status: 'repaired',
      repairTransactionId: result.repairTransactionId,
      filesRepaired: 1,
      malformedLineCount: 1,
      backupPaths: result.backupPaths,
      quarantinePath: result.quarantinePath,
      startedAt: '2026-06-12T01:02:03.004Z',
      finishedAt: '2026-06-12T01:02:03.004Z'
    })
    expect(summary.toolVersion).toEqual(expect.any(String))
  })

  it('apply aborts if source file changes between scan and rewrite', async () => {
    const memoryRoot = await createTempDir('cyrene-jsonl-repair-race-')
    const sourcePath = join(memoryRoot, 'semantic_memories.jsonl')
    const original = '{"id":"ok"}\n{bad json}\n'
    const changed = '{"id":"external"}\n{bad json}\n'
    await writeFile(sourcePath, original, 'utf8')

    await expect(runJsonlRepairFromRoot({
      memoryRoot,
      apply: true,
      now: '2026-06-12T01:02:03.004Z',
      beforeRewrite: async () => {
        await writeFile(sourcePath, changed, 'utf8')
      }
    })).rejects.toThrow(/changed during repair/)

    await expect(readFile(sourcePath, 'utf8')).resolves.toBe(changed)
    const [repairTransaction] = await readdir(join(memoryRoot, 'repair'))
    const summaryPath = join(memoryRoot, 'repair', repairTransaction as string, 'summary.json')
    const summary = JSON.parse(await readFile(summaryPath, 'utf8')) as { status: string; error: string }
    expect(summary.status).toBe('failed')
    expect(summary.error).toMatch(/changed during repair/)
  })

  it('does not delegate repair planning to the independent JSONL scanner', async () => {
    const repairSource = await readFile(join(process.cwd(), 'src/memory/memory-repair.ts'), 'utf8')

    expect(repairSource).not.toContain('scanJsonlFile')
  })

  it('removes a stale maintenance lock with a dead owner and noops on clean files', async () => {
    const memoryRoot = await createTempDir('cyrene-jsonl-repair-stale-lock-')
    await writeFile(join(memoryRoot, 'semantic_memories.jsonl'), '{"id":"ok"}\n', 'utf8')
    const lockDir = join(memoryRoot, '.maintenance.lock')
    await mkdir(lockDir)
    await writeFile(
      join(lockDir, 'owner.json'),
      `${JSON.stringify({
        acquiredAt: '2000-01-01T00:00:00.000Z',
        hostname: 'old-host',
        pid: 99999999,
        token: 'stale-token'
      })}\n`,
      'utf8'
    )

    const result = await runJsonlRepairFromRoot({ memoryRoot, apply: true })

    expect(result.action).toBe('noop')
    expect(result.filesScanned).toBe(1)
    expect(result.filesRepaired).toBe(0)
    expect(result.malformedLineCount).toBe(0)
    await expect(readFile(join(memoryRoot, 'semantic_memories.jsonl'), 'utf8')).resolves.toBe('{"id":"ok"}\n')
    await expect(readdir(lockDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
