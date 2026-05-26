import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface CodexProjectIdentity {
  projectId: string
  cwd: string
  gitRoot?: string
  gitRemoteHash?: string
  displayName: string
}

export interface ModelVisibleCodexProjectIdentity {
  projectId: string
  displayName: string
  gitRootExists: boolean
}

export async function identifyCodexProject(cwd: string): Promise<CodexProjectIdentity> {
  const resolvedCwd = await realpath(resolve(cwd))
  const gitRootRaw = await tryGit(['rev-parse', '--show-toplevel'], resolvedCwd)
  const gitRoot = gitRootRaw?.trim()
  const root = gitRoot ?? resolvedCwd
  const remoteRaw = await tryGit(['config', '--get', 'remote.origin.url'], root)
  const remote = remoteRaw?.trim()
  const basis = remote && remote.length > 0 ? remote : root

  return {
    projectId: sha256Short(basis),
    cwd: resolvedCwd,
    gitRoot,
    gitRemoteHash: remote && remote.length > 0 ? sha256Short(remote) : undefined,
    displayName: basename(root) || 'unknown-project'
  }
}

export function renderModelVisibleProjectIdentity(
  identity: CodexProjectIdentity
): ModelVisibleCodexProjectIdentity {
  return {
    projectId: identity.projectId,
    displayName: identity.displayName,
    gitRootExists: identity.gitRoot !== undefined
  }
}

async function tryGit(args: string[], cwd: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync('git', args, { cwd })
    const text = result.stdout.trim()
    return text === '' ? undefined : text
  } catch {
    return undefined
  }
}

function sha256Short(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
