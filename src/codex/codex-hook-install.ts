import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

interface CodexCommandHook {
  type: 'command'
  command: string
  timeout: number
}

interface CodexHookGroup {
  hooks: CodexCommandHook[]
}

interface CodexHooksConfig {
  hooks?: {
    Stop?: CodexHookGroup[]
    [name: string]: unknown
  }
  [name: string]: unknown
}

const CODEX_STOP_HOOK_TIMEOUT_SECONDS = 30

export function codexStopHookCommand(): string {
  return 'cyrene-continuity codex hook stop'
}

export async function formatCodexStopHookInstall(input: { hooksPath?: string; dryRun?: boolean }): Promise<string> {
  const hooksPath = input.hooksPath ?? defaultHooksPath()
  const command = codexStopHookCommand()
  const config = mergeStopHookConfig(await readHooksConfig(hooksPath))

  return [
    input.dryRun === true ? 'Codex Stop hook install dry-run' : 'Codex Stop hook install',
    `hooks: ${hooksPath}`,
    `command: ${command}`,
    '',
    JSON.stringify(config, null, 2),
    ''
  ].join('\n')
}

export async function installCodexStopHook(input: { hooksPath?: string }): Promise<string> {
  const hooksPath = input.hooksPath ?? defaultHooksPath()
  const config = mergeStopHookConfig(await readHooksConfig(hooksPath))
  await mkdir(dirname(hooksPath), { recursive: true })
  await writeFile(hooksPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return [
    'Codex Stop hook installed',
    `hooks: ${hooksPath}`,
    `command: ${codexStopHookCommand()}`,
    ''
  ].join('\n')
}

export function mergeStopHookConfig(existing: unknown): CodexHooksConfig {
  const config = isRecord(existing) ? { ...existing } as CodexHooksConfig : {}
  const hooks = isRecord(config.hooks) ? { ...config.hooks } : {}
  const stop = Array.isArray(hooks.Stop) ? [...hooks.Stop] as CodexHookGroup[] : []
  const command = codexStopHookCommand()
  let alreadyConfigured = false
  const mergedStop = stop.map((entry) => {
    if (!Array.isArray(entry?.hooks)) {
      return entry
    }

    return {
      ...entry,
      hooks: entry.hooks.map((hook) => {
        if (hook?.type === 'command' && hook.command === command) {
          alreadyConfigured = true
          return { ...hook, timeout: CODEX_STOP_HOOK_TIMEOUT_SECONDS }
        }
        return hook
      })
    }
  })

  if (!alreadyConfigured) {
    mergedStop.push({
      hooks: [{ type: 'command', command, timeout: CODEX_STOP_HOOK_TIMEOUT_SECONDS }]
    })
  }

  return {
    ...config,
    hooks: {
      ...hooks,
      Stop: mergedStop
    }
  }
}

export async function isCodexStopHookConfigured(input: { hooksPath?: string } = {}): Promise<boolean> {
  const hooksPath = input.hooksPath ?? defaultHooksPath()
  const config = await readHooksConfig(hooksPath)
  const hooks = isRecord(config.hooks) ? config.hooks : {}
  const stop = Array.isArray(hooks.Stop) ? hooks.Stop as CodexHookGroup[] : []
  const command = codexStopHookCommand()
  return stop.some((entry) =>
    Array.isArray(entry?.hooks) && entry.hooks.some((hook) => hook?.type === 'command' && hook.command === command)
  )
}

function defaultHooksPath(): string {
  return join(homedir(), '.codex', 'hooks.json')
}

async function readHooksConfig(hooksPath: string): Promise<CodexHooksConfig> {
  try {
    return JSON.parse(await readFile(hooksPath, 'utf8')) as CodexHooksConfig
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
