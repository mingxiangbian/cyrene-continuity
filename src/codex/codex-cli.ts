import { formatCodexDoctor } from './codex-doctor.js'
import { runCodexReleaseEval, runCodexSimilarHintsEval } from './codex-eval.js'
import { formatCodexStopHookInstall, installCodexStopHook } from './codex-hook-install.js'
import { handleCodexStopHookCommand } from './codex-hook-stop.js'
import { handleCodexHookTraceCommand } from './codex-hook-trace.js'
import { installCodexDevBridge, installCodexPluginBridge } from './codex-install.js'
import { rebuildCodexMemoryIndex } from './codex-memory-index.js'
import {
  runCodexMemoryActiveArchive,
  runCodexMemoryActiveProposeEdit,
  runCodexMemoryActiveSupersede,
  runCodexMemoryActiveTombstone
} from './codex-memory-active-cli.js'
import { formatCodexMemoryDashboard } from './codex-memory-dashboard.js'
import { runCodexMemoryTriage } from './codex-memory-triage-cli.js'
import { startCodexUiServer, type CodexUiServer } from './codex-ui-server.js'
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
import type { MemoryConflictResolution } from '../memory/types.js'
import { createDefaultConfig } from '../config.js'
import { callModel as defaultCallModel } from '../llm-client.js'
import { runCodexProjectMemoryHarvest } from './project-memory-harvester.js'
import type { CodexProjectHarvestMode } from './project-memory-signals.js'

export async function handleCodexCommand(input: { cwd: string; args: string[]; runtimeEntryPath?: string }): Promise<void> {
  const command = input.args[0]
  if (command === 'ui') {
    const server = await startCodexUiServer({
      cwd: input.cwd,
      port: parseOptionalNonNegativeInteger(input.args, '--port')
    })
    process.stdout.write(`Cyrene Web UI: ${server.url}\n`)
    await waitForProcessTermination(server)
    return
  }

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

  if (command === 'hook' && input.args[1] === 'session-start') {
    process.stdout.write(await handleCodexHookTraceCommand('session_start'))
    return
  }

  if (command === 'hook' && input.args[1] === 'user-prompt-submit') {
    process.stdout.write(await handleCodexHookTraceCommand('user_prompt_submit'))
    return
  }

  if (command === 'hook' && input.args[1] === 'post-tool-use') {
    process.stdout.write(await handleCodexHookTraceCommand('post_tool_use'))
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

  if (
    command === 'eval' &&
    input.args.length === 4 &&
    input.args[1] === 'run' &&
    input.args[2] === '--check' &&
    input.args[3] === 'release'
  ) {
    process.stdout.write(`${JSON.stringify(await runCodexReleaseEval(), null, 2)}\n`)
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

  if (command === 'memory' && input.args[1] === 'harvest-project') {
    const sinceWarning = harvestProjectSinceWarning(input.args)
    const result = await runCodexProjectMemoryHarvest({
      cwd: input.cwd,
      config: createDefaultConfig(input.cwd),
      callModel: defaultCallModel,
      dryRun: input.args.includes('--dry-run'),
      mode: parseHarvestProjectMode(input.args)
    })
    process.stdout.write(`${JSON.stringify(addHarvestProjectCompatibilityWarnings(result, sinceWarning), null, 2)}\n`)
    return
  }

  if (command === 'memory' && input.args[1] === 'review') {
    process.stdout.write(await formatCodexMemoryReview({
      cwd: input.cwd,
      limit: parseOptionalPositiveInteger(input.args, '--limit')
    }))
    return
  }

  if (command === 'memory' && input.args[1] === 'triage') {
    process.stdout.write(await runCodexMemoryTriage({
      cwd: input.cwd,
      dryRun: input.args.includes('--dry-run') || !input.args.includes('--apply'),
      apply: input.args.includes('--apply')
    }))
    return
  }

  if (command === 'memory' && input.args[1] === 'active' && input.args[2] === 'archive') {
    process.stdout.write(await runCodexMemoryActiveArchive({
      cwd: input.cwd,
      id: parseRequiredPositional(input.args, 3, 'active memory id'),
      contentHash: parseRequiredOption(input.args, '--content-hash', 'active content hash'),
      reason: parseRequiredOption(input.args, '--reason', 'archive reason')
    }))
    return
  }

  if (command === 'memory' && input.args[1] === 'active' && input.args[2] === 'tombstone') {
    process.stdout.write(await runCodexMemoryActiveTombstone({
      cwd: input.cwd,
      id: parseRequiredPositional(input.args, 3, 'active memory id'),
      contentHash: parseRequiredOption(input.args, '--content-hash', 'active content hash'),
      reason: parseRequiredOption(input.args, '--reason', 'tombstone reason'),
      days: parseOptionalPositiveInteger(input.args, '--days'),
      indefinite: input.args.includes('--indefinite'),
      confirmText: parseOptionalOption(input.args, '--confirm-text')
    }))
    return
  }

  if (command === 'memory' && input.args[1] === 'active' && input.args[2] === 'propose-edit') {
    process.stdout.write(await runCodexMemoryActiveProposeEdit({
      cwd: input.cwd,
      id: parseRequiredPositional(input.args, 3, 'active memory id'),
      contentHash: parseRequiredOption(input.args, '--content-hash', 'active content hash'),
      content: parseRequiredOption(input.args, '--content', 'replacement content'),
      reason: parseRequiredOption(input.args, '--reason', 'edit reason')
    }))
    return
  }

  if (command === 'memory' && input.args[1] === 'active' && input.args[2] === 'supersede') {
    process.stdout.write(await runCodexMemoryActiveSupersede({
      cwd: input.cwd,
      id: parseRequiredPositional(input.args, 3, 'active memory id'),
      candidateId: parseRequiredOption(input.args, '--candidate', 'replacement candidate id'),
      contentHash: parseRequiredOption(input.args, '--content-hash', 'active content hash'),
      reviewHash: parseRequiredOption(input.args, '--review-hash', 'replacement review hash'),
      reason: parseRequiredOption(input.args, '--reason', 'supersede reason'),
      confirmText: parseOptionalOption(input.args, '--confirm-text')
    }))
    return
  }

  if (command === 'memory' && input.args[1] === 'dashboard') {
    process.stdout.write(await formatCodexMemoryDashboard({ cwd: input.cwd }))
    return
  }

  if (command === 'memory' && input.args[1] === 'approve') {
    process.stdout.write(await runCodexMemoryApprove({
      cwd: input.cwd,
      id: parseRequiredPositional(input.args, 2, 'pending memory id'),
      reviewHash: parseRequiredOption(input.args, '--review-hash', 'pending review hash'),
      conflictResolution: parseOptionalConflictResolution(input.args),
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

  console.error('Usage: cyrene-continuity codex <ui [--port <n>]|doctor [--config <path>]|install --dev|install --plugin|install-hook --stop [--dry-run]|hook session-start|hook user-prompt-submit|hook post-tool-use|hook stop|project status|project list|project alias <projectId> <alias>|project merge <from> <to>|eval run --check similar-hints|eval run --check release|memory dashboard|memory review [--limit <n>]|memory triage [--dry-run|--apply]|memory active archive <id> --content-hash <hash> --reason <text>|memory active tombstone <id> --content-hash <hash> --reason <text> [--days <n>|--indefinite] [--confirm-text <id>]|memory active propose-edit <id> --content-hash <hash> --content <text> --reason <text>|memory active supersede <id> --candidate <candidateId> --content-hash <hash> --review-hash <hash> --reason <text> [--confirm-text <id>]|memory approve <id> --review-hash <hash> [--conflict-resolution supersede|keep-both|reject-new]|memory reject <id> --review-hash <hash>|memory edit <id> --review-hash <hash> --content <text>|memory defer <id> --review-hash <hash> [--days <n>]|memory dream [--stage light|rem|deep-preview|deep-apply]|memory dream report [--root global|project]|memory harvest-project [--dry-run] [--changed-files] [--since last-summary]|memory status|memory db rebuild|memory maintenance|memory profile|profile reflect --source daily-interview|profile apply --candidate <id> --review-hash <hash>|similar-hints explain [--memory-id <id>|--source-project-id <projectId>]|similar-hints mark-transferable --memory-id <id> --review-hash <hash>>')
  process.exit(1)
}

function waitForProcessTermination(server: CodexUiServer): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
    }
    const onSignal = () => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      server.close().then(resolve, reject)
    }

    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
  })
}

function parseHarvestProjectMode(args: string[]): CodexProjectHarvestMode | undefined {
  return args.includes('--changed-files') ? 'changed_files' : undefined
}

function harvestProjectSinceWarning(args: string[]): string | undefined {
  const hasSinceOption = args.includes('--since') || args.some((arg) => arg.startsWith('--since='))
  if (!hasSinceOption) {
    return undefined
  }
  const since = parseOptionalOption(args, '--since')
  if (since === undefined) {
    throw new Error('Invalid --since: missing value')
  }
  if (since !== 'last-summary') {
    throw new Error(`Invalid --since: ${since}. Expected last-summary`)
  }
  return '--since last-summary accepted for compatibility; current harvest uses default signal collection.'
}

function addHarvestProjectCompatibilityWarnings<T extends { warnings: string[] }>(result: T, warning: string | undefined): T {
  if (warning === undefined) {
    return result
  }
  return {
    ...result,
    warnings: [...result.warnings, warning]
  }
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

function parseOptionalNonNegativeInteger(args: string[], option: string): number | undefined {
  const index = args.indexOf(option)
  if (index >= 0 && args[index + 1] === undefined) {
    throw new Error(`Invalid ${option}: missing value`)
  }
  const value = parseOptionalOption(args, option)
  if (value === undefined) {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid ${option}: expected integer port 0-65535`)
  }
  return parsed
}

function parseOptionalConflictResolution(args: string[]): MemoryConflictResolution | undefined {
  const value = parseOptionalOption(args, '--conflict-resolution')
  if (value === undefined) {
    return undefined
  }
  if (value === 'supersede') {
    return 'supersede'
  }
  if (value === 'keep-both' || value === 'keep_both') {
    return 'keep_both'
  }
  if (value === 'reject-new' || value === 'reject_new') {
    return 'reject_new'
  }
  throw new Error(`Invalid --conflict-resolution: ${value}. Expected supersede, keep-both, or reject-new`)
}
