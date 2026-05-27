import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCodexProjectFingerprint } from '../src/codex/project-fingerprint.js'
import { identifyCodexProject } from '../src/codex/project-id.js'

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

describe('Codex project fingerprint', () => {
  it('extracts low-sensitivity project signals without raw paths or remotes', async () => {
    const repo = await createTempDir('cyrene-fingerprint-repo-')
    await execFileAsync('git', ['init'], { cwd: repo })
    await execFileAsync('git', ['remote', 'add', 'origin', 'git@github.com:example/private-plugin.git'], {
      cwd: repo
    })
    await writeFile(
      join(repo, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@modelcontextprotocol/sdk': '^1.0.0',
          vite: '^6.0.0'
        },
        devDependencies: {
          typescript: '^5.0.0',
          vitest: '^2.0.0'
        }
      }),
      'utf8'
    )
    await writeFile(join(repo, 'package-lock.json'), '{}\n', 'utf8')
    await writeFile(join(repo, 'tsconfig.json'), '{}\n', 'utf8')
    await mkdir(join(repo, 'plugin'), { recursive: true })
    await writeFile(join(repo, 'plugin', '.mcp.json'), '{}\n', 'utf8')

    const identity = await identifyCodexProject(repo)
    const fingerprint = await buildCodexProjectFingerprint({ cwd: repo, project: identity })

    expect(fingerprint.projectId).toBe(identity.projectId)
    expect(fingerprint.displayName).toBe(identity.displayName)
    expect(fingerprint.packageManager).toBe('npm')
    expect(fingerprint.languages).toEqual(expect.arrayContaining(['typescript']))
    expect(fingerprint.frameworks).toEqual(expect.arrayContaining(['mcp', 'vite', 'vitest']))
    expect(fingerprint.dependencyNames).toEqual(
      expect.arrayContaining(['@modelcontextprotocol/sdk', 'typescript'])
    )
    expect(fingerprint.domainTags).toEqual(expect.arrayContaining(['codex-plugin', 'mcp', 'typescript']))
    expect(fingerprint.rootHash).toMatch(/^[a-f0-9]{16}$/)
    expect(fingerprint.remoteHash).toMatch(/^[a-f0-9]{16}$/)
    expect(JSON.stringify(fingerprint)).not.toContain(repo)
    expect(JSON.stringify(fingerprint)).not.toContain('git@github.com')
  })

  it('returns a stable minimal fingerprint when package files are absent', async () => {
    const repo = await createTempDir('cyrene-fingerprint-empty-')
    const identity = await identifyCodexProject(repo)

    const fingerprint = await buildCodexProjectFingerprint({ cwd: repo, project: identity })

    expect(fingerprint.projectId).toBe(identity.projectId)
    expect(fingerprint.packageManager).toBe('unknown')
    expect(fingerprint.languages).toEqual([])
    expect(fingerprint.frameworks).toEqual([])
    expect(fingerprint.dependencyNames).toEqual([])
    expect(fingerprint.domainTags).toEqual([])
    expect(fingerprint.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
