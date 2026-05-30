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

  it('detects nested Python finance projects from requirements, notebooks, and paths', async () => {
    const repo = await createTempDir('cyrene-fingerprint-python-finance-')
    await mkdir(join(repo, 'projects', 'finance_quant_lab', 'src', 'finance'), { recursive: true })
    await mkdir(join(repo, 'projects', 'finance_quant_lab', 'tests'), { recursive: true })
    await mkdir(join(repo, 'projects', 'finance_quant_lab', 'notebooks'), { recursive: true })
    await mkdir(join(repo, 'wk1'), { recursive: true })
    await writeFile(
      join(repo, 'wk1', 'requirements.txt'),
      'numpy==2.0.0\npandas>=2.2\npytest~=8.0\n# comment\n',
      'utf8'
    )
    await writeFile(
      join(repo, 'projects', 'finance_quant_lab', 'src', 'finance', 'portfolio.py'),
      'def portfolio_value():\n    return 1\n',
      'utf8'
    )
    await writeFile(
      join(repo, 'projects', 'finance_quant_lab', 'tests', 'test_portfolio.py'),
      'def test_portfolio_value():\n    assert True\n',
      'utf8'
    )
    await writeFile(
      join(repo, 'projects', 'finance_quant_lab', 'notebooks', '01_cashflow_dashboard.ipynb'),
      '{"cells":[],"metadata":{},"nbformat":4,"nbformat_minor":5}\n',
      'utf8'
    )
    const identity = await identifyCodexProject(repo)

    const fingerprint = await buildCodexProjectFingerprint({ cwd: repo, project: identity })

    expect(fingerprint.packageManager).toBe('pip')
    expect(fingerprint.languages).toEqual(expect.arrayContaining(['python']))
    expect(fingerprint.frameworks).toEqual(expect.arrayContaining(['jupyter', 'pytest']))
    expect(fingerprint.dependencyNames).toEqual(expect.arrayContaining(['numpy', 'pandas', 'pytest']))
    expect(fingerprint.domainTags).toEqual(expect.arrayContaining(['finance', 'python', 'quant']))
    expect(JSON.stringify(fingerprint)).not.toContain(repo)
  })

  it('ignores vendored Python dependency trees when building project signals', async () => {
    const repo = await createTempDir('cyrene-fingerprint-vendored-python-')
    await mkdir(join(repo, 'external', 'nautilus_trader'), { recursive: true })
    await writeFile(join(repo, 'external', 'nautilus_trader', 'requirements.txt'), 'nautilus-trader==1.0.0\n', 'utf8')
    await writeFile(join(repo, 'external', 'nautilus_trader', 'engine.py'), 'VALUE = 1\n', 'utf8')
    const identity = await identifyCodexProject(repo)

    const fingerprint = await buildCodexProjectFingerprint({ cwd: repo, project: identity })

    expect(fingerprint.packageManager).toBe('unknown')
    expect(fingerprint.languages).toEqual([])
    expect(fingerprint.dependencyNames).not.toContain('nautilus-trader')
    expect(fingerprint.domainTags).toEqual([])
  })

  it('does not treat generic budget paths as finance-domain signals', async () => {
    const repo = await createTempDir('cyrene-fingerprint-budget-')
    await writeFile(join(repo, 'memory-pending-budget.ts'), 'export const limit = 1\n', 'utf8')
    const identity = await identifyCodexProject(repo)

    const fingerprint = await buildCodexProjectFingerprint({ cwd: repo, project: identity })

    expect(fingerprint.domainTags).not.toContain('finance')
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

  it('detects typescript from root ts files without package or tsconfig files', async () => {
    const repo = await createTempDir('cyrene-fingerprint-ts-file-')
    await writeFile(join(repo, 'index.ts'), 'export const value = 1\n', 'utf8')
    const identity = await identifyCodexProject(repo)

    const fingerprint = await buildCodexProjectFingerprint({ cwd: repo, project: identity })

    expect(fingerprint.languages).toEqual(['typescript'])
    expect(fingerprint.domainTags).toEqual(expect.arrayContaining(['typescript']))
  })

  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun']
  ] as const)('detects %s as %s package manager', async (lockfile, packageManager) => {
    const repo = await createTempDir(`cyrene-fingerprint-${packageManager}-`)
    await writeFile(join(repo, lockfile), '{}\n', 'utf8')
    const identity = await identifyCodexProject(repo)

    const fingerprint = await buildCodexProjectFingerprint({ cwd: repo, project: identity })

    expect(fingerprint.packageManager).toBe(packageManager)
  })
})
