import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDefaultConfig } from '../config.js'
import { readModelProfileFromRootIfExists } from '../memory/model-profile.js'
import { readPendingMemoriesFromRoot } from '../memory/memory-store.js'
import {
  codexGlobalMemoryRoot,
  codexGlobalRoot,
  codexProjectMemoryRoot,
  getReadableCodexGlobalMemoryRoot,
  getReadableCodexProjectMemoryRoot
} from './codex-memory-root.js'
import { isCodexStopHookConfigured } from './codex-hook-install.js'
import { readCodexMemoryDreamState } from './memory-dream-state.js'
import { identifyCodexProject } from './project-id.js'

export async function formatCodexDoctor(input: { cwd: string; configPath?: string }): Promise<string> {
  const configPath = input.configPath ?? join(homedir(), '.codex', 'config.toml')
  const configText = await readOptional(configPath)
  const cyreneMcpBlock = readTomlBlock(configText, '[mcp_servers.cyrene]')
  const cyreneConfigured = cyreneMcpBlock !== undefined
  const cyreneMcpCommand = cyreneMcpBlock === undefined ? undefined : readDoctorMcpCommand(cyreneMcpBlock)
  const mcpCommandFreshness = cyreneMcpCommand === undefined ? undefined : readDoctorMcpCommandFreshness(cyreneMcpCommand)
  const installCommand = formatDoctorInstallCommand()
  const mcpCommandAction = mcpCommandFreshness === 'stale or external'
    ? `  action: rerun ${installCommand} and update [mcp_servers.cyrene] from its printed config`
    : undefined
  const agentmemoryEnabled = hasEnabledMcpServer(configText, 'agentmemory')
  const skillPath = join(homedir(), '.agents', 'skills', 'cyrene-continuity', 'SKILL.md')
  const skillExists = await pathExists(skillPath)
  const stopHookConfigured = await isCodexStopHookConfigured()
  const identity = await identifyCodexProject(input.cwd)
  const config = createDefaultConfig(input.cwd)
  const memoryState = await readDoctorMemoryState(identity.projectId)
  const actions = [
    cyreneConfigured ? undefined : '  action: add [mcp_servers.cyrene] to Codex config',
    mcpCommandAction,
    agentmemoryEnabled
      ? '  action: disable [mcp_servers.agentmemory] before validating Cyrene as the authoritative memory source'
      : undefined,
    skillExists ? undefined : `  action: run ${installCommand} to register the cyrene-continuity skill`
  ].filter((action): action is string => action !== undefined)
  const ready = actions.length === 0

  return [
    'Cyrene Codex Doctor',
    '',
    'runtime:',
    `  node: ${process.versions.node}`,
    '',
    'codex:',
    `  config: ${configText === '' ? 'missing' : configPath}`,
    `  cyrene mcp: ${cyreneConfigured ? 'configured' : 'missing'}`,
    cyreneMcpCommand === undefined ? undefined : `  mcp command: ${formatDoctorMcpCommand(cyreneMcpCommand)}`,
    mcpCommandFreshness === undefined ? undefined : `  mcp command freshness: ${mcpCommandFreshness}`,
    `  agentmemory: ${agentmemoryEnabled ? 'enabled' : 'disabled'}`,
    `  stop hook: ${stopHookConfigured ? 'configured' : 'missing'}`,
    stopHookConfigured ? undefined : '  advisory: optional Stop hook is not installed',
    `  status: ${ready ? 'ready' : 'not ready'}`,
    ...actions,
    '',
    'skill:',
    `  cyrene-continuity: ${skillExists ? 'ok' : 'missing'}`,
    '',
    'state:',
    `  codex root: ${codexGlobalRoot()}`,
    `  projectId: ${identity.projectId}`,
    `  displayName: ${identity.displayName}`,
    '',
    'memory:',
    `  global profile: ${memoryState.globalProfilePresent ? 'present' : 'missing'}`,
    `  global pending: ${memoryState.globalPendingCount}`,
    `  project profile: ${memoryState.projectProfilePresent ? 'present' : 'missing'}`,
    `  project pending: ${memoryState.projectPendingCount}`,
    `  dream due: ${memoryState.dreamDue ? 'yes' : 'no'}`,
    `  last dream: ${memoryState.lastDreamAt ?? 'never'}`,
    `  auto promote: ${config.memoryAutoPromoteEnabled ? 'enabled' : 'disabled'}`
  ].filter((line): line is string => line !== undefined && line !== '').join('\n') + '\n'
}

interface DoctorMemoryState {
  globalProfilePresent: boolean
  globalPendingCount: number
  projectProfilePresent: boolean
  projectPendingCount: number
  dreamDue: boolean
  lastDreamAt?: string
}

async function readDoctorMemoryState(projectId: string): Promise<DoctorMemoryState> {
  const globalRoot = (await getReadableCodexGlobalMemoryRoot()) ?? codexGlobalMemoryRoot()
  const projectRoot = (await getReadableCodexProjectMemoryRoot(projectId)) ?? codexProjectMemoryRoot(projectId)
  const [globalProfilePresent, globalPending, projectProfilePresent, projectPending, dreamState] = await Promise.all([
    profilePresent(globalRoot),
    readPendingMemoriesFromRoot(globalRoot),
    profilePresent(projectRoot),
    readPendingMemoriesFromRoot(projectRoot),
    readCodexMemoryDreamState(projectRoot)
  ])
  return {
    globalProfilePresent,
    globalPendingCount: globalPending.length,
    projectProfilePresent,
    projectPendingCount: projectPending.length,
    dreamDue: dreamState?.dreamDue === true,
    lastDreamAt: dreamState?.lastDreamAt
  }
}

async function profilePresent(memoryRoot: string): Promise<boolean> {
  return (await readModelProfileFromRootIfExists(memoryRoot)) !== undefined
}

interface DoctorMcpCommand {
  command: string
  args: string[]
}

type DoctorMcpCommandFreshness = 'current repo' | 'stale or external'

function readDoctorMcpCommand(block: string): DoctorMcpCommand | undefined {
  const command = readTomlStringValue(block, 'command')
  if (command === undefined) {
    return undefined
  }
  return {
    command,
    args: readTomlStringArrayValue(block, 'args') ?? []
  }
}

function readDoctorMcpCommandFreshness(mcpCommand: DoctorMcpCommand): DoctorMcpCommandFreshness {
  return [mcpCommand.command, ...mcpCommand.args].some(referencesCurrentRepoPath)
    ? 'current repo'
    : 'stale or external'
}

function referencesCurrentRepoPath(value: string): boolean {
  const repoRoot = currentRepoRoot()
  return value === repoRoot || value.endsWith(`=${repoRoot}`) || value.startsWith(`${repoRoot}/`) || value.includes(`${repoRoot}/`)
}

function currentRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

function formatDoctorInstallCommand(): string {
  return `npm --prefix ${currentRepoRoot()} run --silent dev -- codex install --dev`
}

function formatDoctorMcpCommand(mcpCommand: DoctorMcpCommand): string {
  return [mcpCommand.command, ...mcpCommand.args].map(formatCommandPart).join(' ')
}

function formatCommandPart(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : JSON.stringify(value)
}

function readTomlStringValue(block: string, key: string): string | undefined {
  const value = readTomlAssignmentValue(block, key)
  if (value === undefined) {
    return undefined
  }
  return parseTomlString(value)
}

function readTomlStringArrayValue(block: string, key: string): string[] | undefined {
  const value = readTomlAssignmentValue(block, key)
  if (value === undefined) {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every((item): item is string => typeof item === 'string')
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

function readTomlAssignmentValue(block: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const value = block.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*(.+?)\\s*$`, 'm'))?.[1]
  return value === undefined ? undefined : stripTomlInlineComment(value).trim()
}

function parseTomlString(value: string): string | undefined {
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value)
      return typeof parsed === 'string' ? parsed : undefined
    } catch {
      return undefined
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }
  return undefined
}

function hasEnabledMcpServer(configText: string, name: string): boolean {
  const block = readTomlBlock(configText, `[mcp_servers.${name}]`)
  if (block === undefined) {
    return false
  }
  return readTomlBooleanValue(block, 'enabled') !== false
}

function readTomlBooleanValue(block: string, key: string): boolean | undefined {
  const value = readTomlAssignmentValue(block, key)
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  return undefined
}

function readTomlBlock(configText: string, heading: string): string | undefined {
  const lines = configText.split(/\r?\n/)
  const start = lines.findIndex((line) => stripTomlInlineComment(line).trim() === heading)
  if (start < 0) {
    return undefined
  }
  const body: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(stripTomlInlineComment(lines[index]))) {
      break
    }
    body.push(lines[index])
  }
  return body.join('\n')
}

function stripTomlInlineComment(value: string): string {
  let quote: '"' | "'" | undefined
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote === '"') {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        quote = undefined
      }
      continue
    }
    if (quote === "'") {
      if (char === "'") {
        quote = undefined
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#') {
      return value.slice(0, index)
    }
  }
  return value
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return ''
    }
    throw error
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
