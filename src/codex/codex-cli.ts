import { formatCodexDoctor } from './codex-doctor.js'
import { runCodexSimilarHintsEval } from './codex-eval.js'
import { formatCodexStopHookInstall, installCodexStopHook } from './codex-hook-install.js'
import { handleCodexStopHookCommand } from './codex-hook-stop.js'
import { installCodexDevBridge, installCodexPluginBridge } from './codex-install.js'
import { rebuildCodexMemoryIndex } from './codex-memory-index.js'
import {
  formatCodexMemoryReview,
  runCodexMemoryApprove,
  runCodexMemoryDefer,
  runCodexMemoryEdit,
  runCodexMemoryReject
} from './codex-memory-review-cli.js'
import { formatCodexMemoryStatus } from './codex-memory-status.js'
import { readDreamReport } from './dream-artifacts.js'
import {
  getCodexMemoryProfile,
  runCodexMemoryDream,
  runCodexMemoryMaintenance,
  type CodexMemoryDreamStage
} from './memory-dream.js'
import {
  applyCodexProfileCandidate,
  runCodexProfileReflection
} from './profile-candidates.js'
import {
  formatCodexProjectList,
  formatCodexProjectStatus,
  runCodexProjectAlias,
  runCodexProjectMerge
} from './project-tools.js'
import {
  explainSimilarHints,
  markSimilarHintTransferable
} from './similar-hints-review.js'

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

  if (command === 'project' && input.args[1] === 'status') {
    process.stdout.write(await formatCodexProjectStatus({ cwd: input.cwd }))
    return
  }

  if (command === 'project' && input.args[1] === 'list') {
    process.stdout.write(await formatCodexProjectList({ cwd: input.cwd }))
    return
  }

  if (command === 'project' && input.args[1] === 'alias') {
    process.stdout.write(await runCodexProjectAlias({
      projectId: parseRequiredPositional(input.args, 2, 'projectId'),
      alias: parseRequiredPositional(input.args, 3, 'project alias')
    }))
    return
  }

  if (command === 'project' && input.args[1] === 'merge') {
    process.stdout.write(await runCodexProjectMerge({
      fromProjectId: parseRequiredPositional(input.args, 2, 'source projectId'),
      toProjectId: parseRequiredPositional(input.args, 3, 'target projectId')
    }))
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
    if (input.args[2] === 'report') {
      const report = await readDreamReport({ cwd: input.cwd, root: parseDreamReportRoot(input.args) })
      process.stdout.write(report.report)
      return
    }
    process.stdout.write(`${JSON.stringify(await runCodexMemoryDream({
      cwd: input.cwd,
      stage: parseDreamStage(input.args)
    }), null, 2)}\n`)
    return
  }

  if (command === 'memory' && input.args[1] === 'review') {
    process.stdout.write(await formatCodexMemoryReview({
      cwd: input.cwd,
      limit: parseOptionalPositiveInteger(input.args, '--limit')
    }))
    return
  }

  if (command === 'memory' && input.args[1] === 'approve') {
    process.stdout.write(await runCodexMemoryApprove({
      cwd: input.cwd,
      id: parseRequiredPositional(input.args, 2, 'pending memory id'),
      reviewHash: parseRequiredOption(input.args, '--review-hash', 'pending review hash'),
      reason: parseOptionalOption(input.args, '--reason')
    }))
    return
  }

  if (command === 'memory' && input.args[1] === 'reject') {
    process.stdout.write(await runCodexMemoryReject({
      cwd: input.cwd,
      id: parseRequiredPositional(input.args, 2, 'pending memory id'),
      reviewHash: parseRequiredOption(input.args, '--review-hash', 'pending review hash'),
      reason: parseOptionalOption(input.args, '--reason')
    }))
    return
  }

  if (command === 'memory' && input.args[1] === 'edit') {
    process.stdout.write(await runCodexMemoryEdit({
      cwd: input.cwd,
      id: parseRequiredPositional(input.args, 2, 'pending memory id'),
      reviewHash: parseRequiredOption(input.args, '--review-hash', 'pending review hash'),
      content: parseRequiredOption(input.args, '--content', 'pending memory content'),
      normalizedKey: parseOptionalOption(input.args, '--normalized-key'),
      reason: parseOptionalOption(input.args, '--reason')
    }))
    return
  }

  if (command === 'memory' && input.args[1] === 'defer') {
    process.stdout.write(await runCodexMemoryDefer({
      cwd: input.cwd,
      id: parseRequiredPositional(input.args, 2, 'pending memory id'),
      reviewHash: parseRequiredOption(input.args, '--review-hash', 'pending review hash'),
      days: parseOptionalPositiveInteger(input.args, '--days'),
      reason: parseOptionalOption(input.args, '--reason')
    }))
    return
  }

  if (command === 'memory' && input.args[1] === 'status') {
    process.stdout.write(await formatCodexMemoryStatus({ cwd: input.cwd }))
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

  if (command === 'profile' && input.args[1] === 'reflect') {
    process.stdout.write(`${JSON.stringify(await runCodexProfileReflection({
      cwd: input.cwd,
      source: parseProfileReflectionSource(input.args)
    }), null, 2)}\n`)
    return
  }

  if (command === 'profile' && input.args[1] === 'apply') {
    process.stdout.write(`${JSON.stringify(await applyCodexProfileCandidate({
      cwd: input.cwd,
      candidateId: parseRequiredOption(input.args, '--candidate', 'profile candidate'),
      reviewHash: parseRequiredOption(input.args, '--review-hash', 'profile review hash')
    }), null, 2)}\n`)
    return
  }

  if (command === 'similar-hints' && input.args[1] === 'explain') {
    process.stdout.write(`${JSON.stringify(await explainSimilarHints({
      cwd: input.cwd,
      memoryId: parseOptionalOption(input.args, '--memory-id'),
      sourceProjectId: parseOptionalOption(input.args, '--source-project-id')
    }), null, 2)}\n`)
    return
  }

  if (command === 'similar-hints' && input.args[1] === 'mark-transferable') {
    process.stdout.write(`${JSON.stringify(await markSimilarHintTransferable({
      cwd: input.cwd,
      memoryId: parseRequiredOption(input.args, '--memory-id', 'similar hint memory id'),
      reviewHash: parseRequiredOption(input.args, '--review-hash', 'similar hint review hash')
    }), null, 2)}\n`)
    return
  }

  console.error('Usage: cyrene-continuity codex <doctor [--config <path>]|install --dev|install --plugin|install-hook --stop [--dry-run]|hook stop|project status|project list|project alias <projectId> <alias>|project merge <from> <to>|eval run --check similar-hints|memory review [--limit <n>]|memory approve <id> --review-hash <hash>|memory reject <id> --review-hash <hash>|memory edit <id> --review-hash <hash> --content <text>|memory defer <id> --review-hash <hash> [--days <n>]|memory dream [--stage light|rem|deep-preview|deep-apply]|memory dream report [--root global|project]|memory status|memory db rebuild|memory maintenance|memory profile|profile reflect --source daily-interview|profile apply --candidate <id> --review-hash <hash>|similar-hints explain [--memory-id <id>|--source-project-id <projectId>]|similar-hints mark-transferable --memory-id <id> --review-hash <hash>>')
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
  if (value === 'light' || value === 'rem' || value === 'deep-preview' || value === 'deep-apply') {
    return value
  }
  if (value === 'deep') {
    throw new Error('Invalid memory dream stage: deep. Use deep-preview to generate proposed changes or deep-apply to apply gated changes.')
  }
  throw new Error(`Invalid memory dream stage: ${value}`)
}

function parseDreamReportRoot(args: string[]): 'global' | 'project' {
  const index = args.indexOf('--root')
  const inline = args.find((arg) => arg.startsWith('--root='))
  const value = index >= 0 ? args[index + 1] : inline?.slice('--root='.length)
  if (value === undefined) {
    return 'project'
  }
  if (value === '' || value.startsWith('--')) {
    throw new Error('Invalid memory dream report root: missing value')
  }
  if (value === 'global' || value === 'project') {
    return value
  }
  throw new Error(`Invalid memory dream report root: ${value}`)
}

function parseProfileReflectionSource(args: string[]): 'daily-interview' {
  const value = parseRequiredOption(args, '--source', 'profile reflection source')
  if (value === 'daily-interview') {
    return value
  }
  throw new Error(`Invalid profile reflection source: ${value}`)
}

function parseRequiredPositional(args: string[], index: number, label: string): string {
  const value = args[index]
  if (value === undefined || value === '' || value.startsWith('--')) {
    throw new Error(`Invalid ${label}: missing value`)
  }
  return value
}

function parseRequiredOption(args: string[], option: string, label: string): string {
  const index = args.indexOf(option)
  const inline = args.find((arg) => arg.startsWith(`${option}=`))
  const value = index >= 0 ? args[index + 1] : inline?.slice(option.length + 1)
  if (value === undefined || value === '' || value.startsWith('--')) {
    throw new Error(`Invalid ${label}: missing value`)
  }
  return value
}

function parseOptionalOption(args: string[], option: string): string | undefined {
  const index = args.indexOf(option)
  const inline = args.find((arg) => arg.startsWith(`${option}=`))
  const value = index >= 0 ? args[index + 1] : inline?.slice(option.length + 1)
  if (value === undefined) {
    return undefined
  }
  if (value === '' || value.startsWith('--')) {
    throw new Error(`Invalid ${option}: missing value`)
  }
  return value
}

function parseOptionalPositiveInteger(args: string[], option: string): number | undefined {
  const value = parseOptionalOption(args, option)
  if (value === undefined) {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${option}: expected positive integer`)
  }
  return parsed
}
