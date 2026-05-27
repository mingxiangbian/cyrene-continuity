import { access, chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { codexGlobalRoot } from './codex-memory-root.js'

export function codexStableBinRoot(): string {
  return resolve(codexGlobalRoot(), 'bin')
}

export function codexStableExecutablePath(): string {
  return resolve(codexStableBinRoot(), 'cyrene-continuity')
}

export async function assertRuntimeExists(runtimePath: string): Promise<void> {
  try {
    await access(runtimePath)
  } catch {
    throw new Error(`Cyrene plugin runtime is missing: ${runtimePath}`)
  }
}

export async function writeCodexStableShim(runtimePath: string): Promise<string> {
  await assertRuntimeExists(runtimePath)
  const shimPath = codexStableExecutablePath()
  await mkdir(dirname(shimPath), { recursive: true })
  await writeFile(shimPath, formatStableShim(runtimePath), 'utf8')
  await chmod(shimPath, 0o755)
  return shimPath
}

export function formatStableShim(runtimePath: string): string {
  return [
    '#!/bin/sh',
    'set -eu',
    `runtime=${shellQuote(runtimePath)}`,
    'if [ ! -f "$runtime" ]; then',
    '  echo "Cyrene plugin runtime is missing: $runtime" >&2',
    '  echo "Reinstall the cyrene-continuity Codex plugin or run cyrene-continuity codex install --plugin." >&2',
    '  exit 1',
    'fi',
    'exec node "$runtime" "$@"',
    ''
  ].join('\n')
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}
