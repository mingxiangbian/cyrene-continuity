import type { Dirent } from 'node:fs'
import { access, readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDefaultConfig } from '../config.js'
import { createEmbeddingProviderFromEnv } from '../memory/embedding-provider.js'
import { readModelProfileFromRootIfExists } from '../memory/model-profile.js'
import { readPendingMemoriesFromRoot } from '../memory/memory-store.js'
import {
  codexGlobalMemoryRoot,
  codexGlobalRoot,
  codexProjectMemoryRoot,
  getReadableCodexGlobalMemoryRoot,
  getReadableCodexProjectMemoryRoot
} from './codex-memory-root.js'
import { readCodexMemoryStatus } from './codex-memory-status.js'
import { isCodexStopHookConfigured } from './codex-hook-install.js'
import { readCodexMemoryDreamState } from './memory-dream-state.js'
import { identifyCodexProject } from './project-id.js'
import { resolveDevRepoRoot, resolvePluginRoot, resolvePluginRuntimePath } from './runtime-paths.js'
import { codexStableExecutablePath } from './stable-shim.js'

const CURRENT_CYRENE_MCP_CONFIG_TABLE = '[mcp_servers."cyrene-continuity"]'
const LEGACY_CYRENE_MCP_CONFIG_TABLE = '[mcp_servers.cyrene]'

export async function formatCodexDoctor(input: { cwd: string; configPath?: string; runtimeEntryPath?: string }): Promise<string> {
  const runtimeEntryPath = input.runtimeEntryPath ?? fileURLToPath(import.meta.url)
  const configPath = input.configPath ?? join(homedir(), '.codex', 'config.toml')
  const configText = await readOptional(configPath)
  const cyreneMcpConfig = readCyreneManualMcpConfig(configText)
  const cyreneConfigured = cyreneMcpConfig !== undefined
  const cyreneMcpCommand = cyreneMcpConfig === undefined ? undefined : readDoctorMcpCommand(cyreneMcpConfig.block)
  const mcpCommandFreshness = cyreneMcpCommand === undefined ? undefined : readDoctorMcpCommandFreshness(cyreneMcpCommand, runtimeEntryPath)
  const pluginState = await readDoctorPluginState(runtimeEntryPath)
  const pluginBridgeInstalled = pluginState.mcpDeclared && pluginState.runtimeExists && pluginState.shimExists
  const installCommand = formatDoctorInstallCommand(runtimeEntryPath)
  const mcpCommandAction = mcpCommandFreshness === 'stale or external' && !pluginBridgeInstalled
    ? `  action: rerun ${installCommand} and update ${CURRENT_CYRENE_MCP_CONFIG_TABLE} from its printed config`
    : undefined
  const manualMcpConflictAction = pluginBridgeInstalled && cyreneConfigured
    ? `  action: disable or remove manual Cyrene MCP config (${cyreneMcpConfig.table}) after validating the installed plugin MCP server`
    : undefined
  const agentmemoryEnabled = hasEnabledMcpServer(configText, 'agentmemory')
  const skillPath = join(homedir(), '.agents', 'skills', 'cyrene-continuity', 'SKILL.md')
  const skillExists = await pathExists(skillPath)
  const cyreneSkillReady = skillExists || (pluginBridgeInstalled && pluginState.skillDeclared)
  const stopHookConfigured = await isCodexStopHookConfigured()
  const identity = await identifyCodexProject(input.cwd)
  const config = createDefaultConfig(input.cwd)
  const memoryState = await readDoctorMemoryState(identity.projectId)
  const migrationState = await readDoctorMigrationState()
  const memoryStatus = await readCodexMemoryStatus({ cwd: input.cwd })
  const memoryIndex = memoryStatus.index
  const actions = [
    cyreneConfigured || pluginBridgeInstalled ? undefined : `  action: run ${installCommand} to install the Cyrene bridge`,
    mcpCommandAction,
    manualMcpConflictAction,
    agentmemoryEnabled
      ? '  action: disable [mcp_servers.agentmemory] before validating Cyrene as the authoritative memory source'
      : undefined,
    cyreneSkillReady ? undefined : `  action: run ${installCommand} to register the cyrene-continuity skill`
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
    `  cyrene-continuity mcp: ${cyreneConfigured ? 'configured' : 'missing'}`,
    `  manual mcp: ${cyreneConfigured ? 'enabled' : 'absent'}`,
    cyreneMcpConfig?.legacy === true ? '  legacy mcp name: cyrene' : undefined,
    cyreneMcpCommand === undefined ? undefined : `  mcp command: ${formatDoctorMcpCommand(cyreneMcpCommand)}`,
    mcpCommandFreshness === undefined ? undefined : `  mcp command freshness: ${mcpCommandFreshness}`,
    `  agentmemory: ${agentmemoryEnabled ? 'enabled' : 'disabled'}`,
    `  stop hook: ${stopHookConfigured ? 'configured' : 'missing'}`,
    stopHookConfigured ? undefined : '  advisory: optional Stop hook is not installed',
    `  status: ${ready ? 'ready' : 'not ready'}`,
    ...actions,
    '',
    'plugin:',
    `  root: ${pluginState.root}`,
    `  manifest: ${pluginState.manifestPresent ? 'ok' : 'missing'}`,
    `  plugin mcp: ${pluginState.mcpDeclared ? 'declared' : 'missing'}`,
    `  runtime: ${pluginState.runtimeExists ? 'present' : 'missing'}`,
    `  stable shim: ${pluginState.shimExists ? 'present' : 'missing'}`,
    '',
    'migration:',
    `  automation dream stage: ${migrationState.automationDreamStage}`,
    `  stable shim deep-preview: ${migrationState.stableShimDeepPreview}`,
    `  stable shim deep-apply: ${migrationState.stableShimDeepApply}`,
    `  embedding provider: ${migrationState.embeddingProvider}`,
    '',
    'skill:',
    `  cyrene-continuity: ${skillExists ? 'ok' : pluginBridgeInstalled && pluginState.skillDeclared ? 'plugin' : 'missing'}`,
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
    `  profile candidates: ${memoryState.profileCandidates}`,
    `  memory index: ${memoryIndex.available ? 'available' : 'unavailable'}`,
    `  memory db: ${memoryIndex.dbPath}`,
    memoryIndex.ftsTokenizer === undefined ? undefined : `  memory fts: ${memoryIndex.ftsTokenizer}`,
    memoryIndex.reason === undefined ? undefined : `  memory index reason: ${memoryIndex.reason}`,
    `  memory fallback mode: ${memoryIndex.fallbackMode}`,
    `  memory index freshness: ${memoryIndex.freshness}`,
    memoryIndex.lastSyncAt === undefined ? undefined : `  memory index last sync: ${memoryIndex.lastSyncAt}`,
    memoryIndex.sourceLatestAt === undefined ? undefined : `  memory index source latest: ${memoryIndex.sourceLatestAt}`,
    memoryIndex.staleReason === undefined ? undefined : `  memory index stale reason: ${memoryIndex.staleReason}`,
    `  similar-project retrieval: ${memoryStatus.similarProjectRetrieval}`,
    `  dream due: ${memoryState.dreamDue ? 'yes' : 'no'}`,
    `  last dream: ${memoryState.lastDreamAt ?? 'never'}`,
    `  promotion recommendations: ${config.memoryRecommendPromotionEnabled ? 'enabled' : 'disabled'}`,
    `  deprecated CYRENE_MEMORY_AUTO_PROMOTE: ${config.deprecatedMemoryAutoPromoteConfigured ? 'set' : 'unset'}`,
    config.deprecatedMemoryAutoPromoteConfigured
      ? '  advisory: CYRENE_MEMORY_AUTO_PROMOTE is deprecated; use CYRENE_MEMORY_RECOMMEND_PROMOTION'
      : undefined
  ].filter((line): line is string => line !== undefined && line !== '').join('\n') + '\n'
}

interface DoctorMemoryState {
  globalProfilePresent: boolean
  globalPendingCount: number
  projectProfilePresent: boolean
  projectPendingCount: number
  profileCandidates: DoctorProfileCandidatesStatus
  dreamDue: boolean
  lastDreamAt?: string
}

async function readDoctorMemoryState(projectId: string): Promise<DoctorMemoryState> {
  const globalRoot = (await getReadableCodexGlobalMemoryRoot()) ?? codexGlobalMemoryRoot()
  const projectRoot = (await getReadableCodexProjectMemoryRoot(projectId)) ?? codexProjectMemoryRoot(projectId)
  const [
    globalProfilePresent,
    globalPending,
    projectProfilePresent,
    projectPending,
    profileCandidates,
    dreamState
  ] = await Promise.all([
    profilePresent(globalRoot),
    readPendingMemoriesFromRoot(globalRoot),
    profilePresent(projectRoot),
    readPendingMemoriesFromRoot(projectRoot),
    readProfileCandidatesStatus(projectRoot),
    readCodexMemoryDreamState(projectRoot)
  ])
  return {
    globalProfilePresent,
    globalPendingCount: globalPending.length,
    projectProfilePresent,
    projectPendingCount: projectPending.length,
    profileCandidates,
    dreamDue: dreamState?.dreamDue === true,
    lastDreamAt: dreamState?.lastDreamAt
  }
}

type DoctorProfileCandidatesStatus = 'ok' | 'missing' | 'unreadable'

async function readProfileCandidatesStatus(memoryRoot: string): Promise<DoctorProfileCandidatesStatus> {
  try {
    await readFile(join(memoryRoot, 'profile_candidates.jsonl'), 'utf8')
    return 'ok'
  } catch (error) {
    return isErrorCode(error, 'ENOENT') ? 'missing' : 'unreadable'
  }
}

async function profilePresent(memoryRoot: string): Promise<boolean> {
  return (await readModelProfileFromRootIfExists(memoryRoot)) !== undefined
}

interface DoctorMigrationState {
  automationDreamStage: DoctorAutomationDreamStageStatus
  stableShimDeepPreview: DoctorStableShimStageStatus
  stableShimDeepApply: DoctorStableShimStageStatus
  embeddingProvider: DoctorEmbeddingProviderStatus
}

type DoctorAutomationDreamStageStatus = 'migrated' | 'needs migration' | 'unknown'
type DoctorStableShimStageStatus = 'ok' | 'missing' | 'failed'
type DoctorEmbeddingProviderStatus = 'disabled' | 'enabled' | 'misconfigured'

async function readDoctorMigrationState(): Promise<DoctorMigrationState> {
  const [automationDreamStage, stableShimDeepPreview, stableShimDeepApply] = await Promise.all([
    readAutomationDreamStageStatus(),
    readStableShimStageStatus(),
    readStableShimStageStatus()
  ])
  return {
    automationDreamStage,
    stableShimDeepPreview,
    stableShimDeepApply,
    embeddingProvider: readEmbeddingProviderStatus()
  }
}

async function readAutomationDreamStageStatus(): Promise<DoctorAutomationDreamStageStatus> {
  const automationsRoot = join(homedir(), '.codex', 'automations')
  let entries: Dirent[]
  try {
    entries = await readdir(automationsRoot, { withFileTypes: true })
  } catch {
    return 'unknown'
  }

  let migrated = false
  let sawAutomation = false
  for (const entry of entries) {
    const automationPath = entry.isDirectory()
      ? join(automationsRoot, entry.name, 'automation.toml')
      : join(automationsRoot, entry.name)
    const text = await readOptional(automationPath)
    if (text === '') {
      continue
    }
    sawAutomation = true
    if (readTomlStringValue(text, 'status') === 'PAUSED') {
      continue
    }
    if (containsLegacyDreamDeepStage(text)) {
      return 'needs migration'
    }
    if (containsCurrentDreamDeepStage(text)) {
      migrated = true
    }
  }
  if (!sawAutomation) {
    return 'unknown'
  }
  return migrated ? 'migrated' : 'unknown'
}

async function readStableShimStageStatus(): Promise<DoctorStableShimStageStatus> {
  try {
    const text = await readFile(codexStableExecutablePath(), 'utf8')
    return text.trim() === '' ? 'failed' : 'ok'
  } catch (error) {
    return isErrorCode(error, 'ENOENT') ? 'missing' : 'failed'
  }
}

function readEmbeddingProviderStatus(): DoctorEmbeddingProviderStatus {
  const configuredProvider = process.env.CYRENE_EMBEDDING_PROVIDER?.trim()
  if (
    configuredProvider === undefined ||
    configuredProvider === '' ||
    configuredProvider === 'off' ||
    configuredProvider === 'disabled'
  ) {
    return 'disabled'
  }
  const diagnostics = createEmbeddingProviderFromEnv().diagnostics
  if (!diagnostics.enabled || diagnostics.provider === 'fail') {
    return 'misconfigured'
  }
  return 'enabled'
}

function containsLegacyDreamDeepStage(text: string): boolean {
  return /--stage(?:=|\s+)deep(?=$|[\s"'\\])/m.test(text)
}

function containsCurrentDreamDeepStage(text: string): boolean {
  return /--stage(?:=|\s+)(?:deep-preview|deep-apply)(?=$|[\s"'\\])/m.test(text)
}

interface DoctorMcpCommand {
  command: string
  args: string[]
}

type DoctorMcpCommandFreshness = 'current repo' | 'stable shim' | 'stale or external'

interface DoctorManualMcpConfig {
  block: string
  table: string
  legacy: boolean
}

function readCyreneManualMcpConfig(configText: string): DoctorManualMcpConfig | undefined {
  const current = readTomlBlock(configText, CURRENT_CYRENE_MCP_CONFIG_TABLE)
  if (current !== undefined) {
    return { block: current, table: CURRENT_CYRENE_MCP_CONFIG_TABLE, legacy: false }
  }
  const legacy = readTomlBlock(configText, LEGACY_CYRENE_MCP_CONFIG_TABLE)
  if (legacy !== undefined) {
    return { block: legacy, table: LEGACY_CYRENE_MCP_CONFIG_TABLE, legacy: true }
  }
  return undefined
}

interface DoctorPluginState {
  root: string
  manifestPresent: boolean
  skillDeclared: boolean
  mcpDeclared: boolean
  runtimeExists: boolean
  shimExists: boolean
}

async function readDoctorPluginState(runtimeEntryPath: string): Promise<DoctorPluginState> {
  const root = resolvePluginRoot(runtimeEntryPath)
  const manifestPath = join(root, '.codex-plugin', 'plugin.json')
  const manifestText = await readOptional(manifestPath)
  const manifest = parseJsonObject(manifestText)

  return {
    root,
    manifestPresent: manifest !== undefined,
    skillDeclared: typeof manifest?.skills === 'string',
    mcpDeclared: typeof manifest?.mcpServers === 'string',
    runtimeExists: await pathExists(resolvePluginRuntimePath(runtimeEntryPath)),
    shimExists: await pathExists(codexStableExecutablePath())
  }
}

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

function readDoctorMcpCommandFreshness(mcpCommand: DoctorMcpCommand, runtimeEntryPath: string): DoctorMcpCommandFreshness {
  const parts = [mcpCommand.command, ...mcpCommand.args]
  if (parts.some((part) => referencesStableShimPath(part))) {
    return 'stable shim'
  }
  const devRepoRoot = resolveDevRepoRoot(runtimeEntryPath)
  if (devRepoRoot !== null && parts.some((part) => referencesPath(part, devRepoRoot))) {
    return 'current repo'
  }
  return 'stale or external'
}

function referencesStableShimPath(value: string): boolean {
  return referencesPath(value, codexStableExecutablePath())
}

function referencesPath(value: string, targetPath: string): boolean {
  return value === targetPath || value.endsWith(`=${targetPath}`) || value.startsWith(`${targetPath}/`) || value.includes(`${targetPath}/`)
}

function formatDoctorInstallCommand(runtimeEntryPath: string): string {
  const devRepoRoot = resolveDevRepoRoot(runtimeEntryPath)
  if (devRepoRoot === null) {
    return 'cyrene-continuity codex install --plugin'
  }
  return `npm --prefix ${devRepoRoot} run --silent dev -- codex install --dev`
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

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  if (value === '') {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
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

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
