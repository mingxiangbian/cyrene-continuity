import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('plugin runtime package', () => {
  it('declares a plugin MCP server named cyrene-continuity', async () => {
    const manifest = JSON.parse(await readFile('plugin/.codex-plugin/plugin.json', 'utf8'))
    const mcp = JSON.parse(await readFile('plugin/.mcp.json', 'utf8'))

    expect(manifest.name).toBe('cyrene-continuity')
    expect(manifest.skills).toBe('./skills/')
    expect(manifest.mcpServers).toBe('./.mcp.json')
    expect(manifest).not.toHaveProperty('schema_version')
    expect(mcp.mcpServers['cyrene-continuity']).toMatchObject({
      command: 'sh',
      args: ['-lc', 'exec "$HOME/.cyrene/codex/bin/cyrene-continuity" mcp-server --stdio']
    })
    expect(mcp.mcpServers).not.toHaveProperty('cyrene')
    expect(mcp.mcpServers['cyrene-continuity']).not.toHaveProperty('cwd')
  })

  it('builds a standalone plugin runtime bundle', async () => {
    const outDir = await createTempDir('cyrene-plugin-runtime-out-')
    const runtimePath = join(outDir, 'cyrene-continuity.mjs')
    const staticOutfile = join(outDir, 'codex-ui-static.generated.ts')

    await execFileAsync('npm', ['run', 'build:plugin'], {
      env: {
        ...process.env,
        CYRENE_PLUGIN_RUNTIME_OUTFILE: runtimePath,
        CYRENE_UI_STATIC_OUTFILE: staticOutfile
      }
    })

    const stats = await stat(runtimePath)
    const source = await readFile(runtimePath, 'utf8')
    expect(stats.isFile()).toBe(true)
    expect(source.startsWith('#!/usr/bin/env node')).toBe(true)
    expect(source).toContain('cyrene_continuity_get')
    expect(source).not.toMatch(/^import\s+.+from ['"]@modelcontextprotocol\/sdk/m)
  })

  it('builds the plugin runtime relative to the repo when invoked from another directory', async () => {
    const otherCwd = await createTempDir('cyrene-plugin-build-cwd-')
    const outDir = await createTempDir('cyrene-plugin-runtime-out-')
    const runtimePath = join(outDir, 'cyrene-continuity.mjs')
    const staticOutfile = join(outDir, 'codex-ui-static.generated.ts')

    await execFileAsync(process.execPath, [join(process.cwd(), 'scripts', 'build-plugin.mjs')], {
      cwd: otherCwd,
      env: {
        ...process.env,
        CYRENE_PLUGIN_RUNTIME_OUTFILE: runtimePath,
        CYRENE_UI_STATIC_OUTFILE: staticOutfile
      }
    })

    const source = await readFile(runtimePath, 'utf8')
    expect(source.startsWith('#!/usr/bin/env node')).toBe(true)
    await expect(stat(join(otherCwd, 'plugin', 'runtime', 'cyrene-continuity.mjs'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
