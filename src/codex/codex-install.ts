import { lstat, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codexGlobalRoot } from './codex-memory-root.js'

export async function installCodexDevBridge(): Promise<string> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const skillSource = resolve(
    repoRoot,
    'plugin',
    'skills',
    'cyrene-continuity'
  )
  const skillTarget = join(homedir(), '.agents', 'skills', 'cyrene-continuity')
  const stateRoot = codexGlobalRoot()

  await mkdir(dirname(skillTarget), { recursive: true })
  await removeExistingSkillSymlink(skillTarget)
  await symlink(skillSource, skillTarget, 'dir')
  await mkdir(stateRoot, { recursive: true })
  await writeFile(join(stateRoot, '.keep'), 'created by cyrene-continuity codex install --dev\n', 'utf8')

  return [
    'Cyrene Codex dev bridge installed.',
    '',
    `skill: ${skillTarget} -> ${skillSource}`,
    '',
    'Add this MCP config manually to ~/.codex/config.toml:',
    '',
    '[mcp_servers.cyrene]',
    'command = "npm"',
    `args = ${JSON.stringify(['--prefix', repoRoot, 'run', '--silent', 'dev', '--', 'mcp-server', '--stdio'])}`,
    'enabled = true',
    'required = false',
    'startup_timeout_sec = 20',
    'tool_timeout_sec = 60',
    '',
    'Disable agentmemory before validating Cyrene as the authoritative memory source.',
    'Remove/comment [mcp_servers.agentmemory] or set enabled = false if your Codex config supports it.'
  ].join('\n') + '\n'
}

async function removeExistingSkillSymlink(path: string): Promise<void> {
  try {
    const stats = await lstat(path)
    if (!stats.isSymbolicLink()) {
      throw new Error(`Refusing to replace existing non-symlink skill path: ${path}`)
    }
    await rm(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return
    }
    throw error
  }
}
