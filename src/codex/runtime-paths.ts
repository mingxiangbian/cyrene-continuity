import { basename, dirname, resolve } from 'node:path'

const PLUGIN_RUNTIME_FILE = 'cyrene-continuity.mjs'

export function isPluginRuntimeEntryPath(runtimeEntryPath: string): boolean {
  const entryPath = resolve(runtimeEntryPath)
  return basename(entryPath) === PLUGIN_RUNTIME_FILE && basename(dirname(entryPath)) === 'runtime'
}

export function resolvePluginRoot(runtimeEntryPath: string): string {
  const entryPath = resolve(runtimeEntryPath)
  if (isPluginRuntimeEntryPath(entryPath)) {
    return dirname(dirname(entryPath))
  }
  return resolve(requireDevRepoRoot(entryPath), 'plugin')
}

export function resolvePluginRuntimePath(runtimeEntryPath: string): string {
  const entryPath = resolve(runtimeEntryPath)
  if (isPluginRuntimeEntryPath(entryPath)) {
    return entryPath
  }
  return resolve(resolvePluginRoot(entryPath), 'runtime', PLUGIN_RUNTIME_FILE)
}

export function resolveDevRepoRoot(runtimeEntryPath: string): string | null {
  const entryPath = resolve(runtimeEntryPath)
  if (isPluginRuntimeEntryPath(entryPath)) {
    return null
  }

  const entryDir = dirname(entryPath)
  if (basename(entryDir) === 'src') {
    return dirname(entryDir)
  }
  if (basename(entryDir) === 'codex' && basename(dirname(entryDir)) === 'src') {
    return dirname(dirname(entryDir))
  }
  return resolve(entryDir, '..', '..')
}

export function requireDevRepoRoot(runtimeEntryPath: string): string {
  const repoRoot = resolveDevRepoRoot(runtimeEntryPath)
  if (repoRoot === null) {
    throw new Error('Cyrene dev bridge install requires a source checkout. Use cyrene-continuity codex install --plugin from the installed plugin.')
  }
  return repoRoot
}
