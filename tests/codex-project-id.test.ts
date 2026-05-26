import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { identifyCodexProject, renderModelVisibleProjectIdentity } from '../src/codex/project-id.js'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe('Codex project identity', () => {
  it('uses the git remote as stable project identity when available', async () => {
    const root = await createTempDir('cyrene-codex-git-')
    await execFileAsync('git', ['init'], { cwd: root })
    await execFileAsync('git', ['remote', 'add', 'origin', 'git@github.com:example/private-repo.git'], { cwd: root })
    await mkdir(join(root, 'nested'), { recursive: true })

    const fromRoot = await identifyCodexProject(root)
    const fromNested = await identifyCodexProject(join(root, 'nested'))
    const realRoot = await realpath(root)

    expect(fromRoot.projectId).toBe(fromNested.projectId)
    expect(fromRoot.gitRoot).toBe(realRoot)
    expect(fromRoot.gitRemoteHash).toBeDefined()
    expect(fromRoot.displayName).toBe(basename(realRoot))
  })

  it('falls back to cwd identity outside git repos', async () => {
    const root = await createTempDir('cyrene-codex-nogit-')

    const identity = await identifyCodexProject(root)
    const realRoot = await realpath(root)

    expect(identity.projectId).toMatch(/^[a-f0-9]{16}$/)
    expect(identity.gitRoot).toBeUndefined()
    expect(identity.gitRemoteHash).toBeUndefined()
    expect(identity.cwd).toBe(realRoot)
  })

  it('does not expose full remote URLs in model-visible identity', async () => {
    const root = await createTempDir('cyrene-codex-visible-')
    await execFileAsync('git', ['init'], { cwd: root })
    await execFileAsync('git', ['remote', 'add', 'origin', 'https://token@example.com/secret/repo.git'], { cwd: root })

    const identity = await identifyCodexProject(root)
    const visible = renderModelVisibleProjectIdentity(identity)

    expect(JSON.stringify(visible)).not.toContain('token@example.com')
    expect(JSON.stringify(visible)).not.toContain('secret/repo.git')
    expect(visible).toEqual({
      projectId: identity.projectId,
      displayName: identity.displayName,
      gitRootExists: true
    })
  })
})
