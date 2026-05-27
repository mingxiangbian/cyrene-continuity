import { formatCodexDoctor } from './codex-doctor.js'
import { runCodexSimilarHintsEval } from './codex-eval.js'
import { formatCodexStopHookInstall, installCodexStopHook } from './codex-hook-install.js'
import { handleCodexStopHookCommand } from './codex-hook-stop.js'
import { installCodexDevBridge, installCodexPluginBridge } from './codex-install.js'
import { rebuildCodexMemoryIndex } from './codex-memory-index.js'
import {
  getCodexMemoryProfile,
  runCodexMemoryDream,
  runCodexMemoryMaintenance,
  type CodexMemoryDreamStage
} from './memory-dream.js'

export async function handleCodexCommand(input: { cwd: string; args: string[]; runtimeEntryPath?: string }): Promise<void> {
  const command = input.args[0]
  if (command === 'doctor') {
    process.stdout.write(await formatCodexDoctor({
      cwd: input.cwd,
      configPath: parseConfigPath(input.args),
      runtimeEntryPath: input.runtimeEntryPath
    }))
    return
  }

  if (command === 'install' && input.args[1] === '--dev') {
    process.stdout.write(await installCodexDevBridge({ runtimeEntryPath: input.runtimeEntryPath }))
    return
  }

  if (command === 'install' && input.args[1] === '--plugin') {
    process.stdout.write(await installCodexPluginBridge({ runtimeEntryPath: input.runtimeEntryPath }))
    return
  }

  if (command === 'install-hook' && input.args[1] === '--stop') {
    const dryRun = input.args.includes('--dry-run')
    process.stdout.write(dryRun ? await formatCodexStopHookInstall({ dryRun: true }) : await installCodexStopHook({}))
    return
  }

  if (command === 'hook' && input.args[1] === 'stop') {
    process.stdout.write(await handleCodexStopHookCommand())
    return
  }

  if (
    command === 'eval' &&
    input.args.length === 4 &&
    input.args[1] === 'run' &&
    input.args[2] === '--check' &&
    input.args[3] === 'similar-hints'
  ) {
    process.stdout.write(`${JSON.stringify(await runCodexSimilarHintsEval({ cwd: input.cwd }), null, 2)}\n`)
    return
  }

  if (command === 'memory' && input.args[1] === 'dream') {
    process.stdout.write(`${JSON.stringify(await runCodexMemoryDream({
      cwd: input.cwd,
      stage: parseDreamStage(input.args)
    }), null, 2)}\n`)
    return
  }

  if (command === 'memory' && input.args[1] === 'db' && input.args[2] === 'rebuild') {
    process.stdout.write(`${JSON.stringify(await rebuildCodexMemoryIndex({ cwd: input.cwd }), null, 2)}\n`)
    return
  }

  if (command === 'memory' && input.args[1] === 'profile') {
    const profile = await getCodexMemoryProfile({ cwd: input.cwd })
    process.stdout.write(profile.content === '' ? '' : `${profile.content}\n`)
    return
  }

  if (command === 'memory' && input.args[1] === 'maintenance') {
    process.stdout.write(`${JSON.stringify(await runCodexMemoryMaintenance({ cwd: input.cwd }), null, 2)}\n`)
    return
  }

  console.error('Usage: cyrene-continuity codex <doctor [--config <path>]|install --dev|install --plugin|install-hook --stop [--dry-run]|hook stop|eval run --check similar-hints|memory dream [--stage light|rem|deep]|memory db rebuild|memory maintenance|memory profile>')
  process.exit(1)
}

function parseConfigPath(args: string[]): string | undefined {
  const index = args.indexOf('--config')
  if (index >= 0) {
    const value = args[index + 1]
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new Error('Invalid doctor config path: missing value')
    }
    return value
  }
  const inline = args.find((arg) => arg.startsWith('--config='))
  if (inline === undefined) {
    return undefined
  }
  const value = inline.slice('--config='.length)
  if (value === '') {
    throw new Error('Invalid doctor config path: missing value')
  }
  return value
}

function parseDreamStage(args: string[]): CodexMemoryDreamStage | undefined {
  const index = args.indexOf('--stage')
  const inline = args.find((arg) => arg.startsWith('--stage='))
  const value = index >= 0 ? args[index + 1] : inline?.slice('--stage='.length)
  if (value === undefined) {
    if (index >= 0 || inline !== undefined) {
      throw new Error('Invalid memory dream stage: missing value')
    }
    return undefined
  }
  if (value === '' || value.startsWith('--')) {
    throw new Error('Invalid memory dream stage: missing value')
  }
  if (value === 'light' || value === 'rem' || value === 'deep') {
    return value
  }
  throw new Error(`Invalid memory dream stage: ${value}`)
}
