import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { CodexProjectIdentity } from './project-id.js'

const MAX_PROJECT_SCAN_FILES = 1000
const MAX_PROJECT_SCAN_DEPTH = 6
const SKIPPED_SCAN_DIRS = new Set([
  '.git',
  '.codegraph',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.superpowers',
  '.tox',
  '.venv',
  '.worktrees',
  'build',
  'coverage',
  'dist',
  'external',
  'node_modules',
  'site-packages',
  'venv',
  '__pycache__'
])

export interface ProjectFingerprint {
  projectId: string
  displayName: string
  rootHash?: string
  remoteHash?: string
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'unknown'
  languages: string[]
  frameworks: string[]
  dependencyNames: string[]
  domainTags: string[]
  updatedAt: string
}

export async function buildCodexProjectFingerprint(input: {
  cwd: string
  project: CodexProjectIdentity
}): Promise<ProjectFingerprint> {
  const root = input.project.gitRoot ?? input.cwd
  const scannedFiles = await scanProjectFiles(root)
  const packageJson = await readPackageJson(root)
  const dependencyNames = Array.from(new Set([
    ...(packageJson === undefined
      ? []
      : Object.keys({
          ...readObject(packageJson.dependencies),
          ...readObject(packageJson.devDependencies)
        })),
    ...(await readPythonRequirementNames(root, scannedFiles))
  ])).sort()
  const packageManager = await detectPackageManager(root, scannedFiles)
  const rootEntries = await safeReaddir(root)
  const languages = detectLanguages(rootEntries, scannedFiles, dependencyNames)
  const frameworks = detectFrameworks(rootEntries, scannedFiles, dependencyNames)
  const domainTags = detectDomainTags(rootEntries, scannedFiles, frameworks, dependencyNames, languages)

  return {
    projectId: input.project.projectId,
    displayName: input.project.displayName,
    rootHash: input.project.gitRoot === undefined ? undefined : hashShort(input.project.gitRoot),
    remoteHash: input.project.gitRemoteHash,
    packageManager,
    languages,
    frameworks,
    dependencyNames,
    domainTags,
    updatedAt: new Date().toISOString()
  }
}

async function readPackageJson(cwd: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function readObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

async function detectPackageManager(
  cwd: string,
  scannedFiles: string[]
): Promise<ProjectFingerprint['packageManager']> {
  if (await exists(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await exists(join(cwd, 'yarn.lock'))) return 'yarn'
  if ((await exists(join(cwd, 'bun.lockb'))) || (await exists(join(cwd, 'bun.lock')))) return 'bun'
  if (await exists(join(cwd, 'package-lock.json'))) return 'npm'
  if (scannedFiles.some((file) => file.endsWith('requirements.txt') || file.endsWith('pyproject.toml'))) return 'pip'
  return 'unknown'
}

async function safeReaddir(cwd: string): Promise<string[]> {
  try {
    return (await readdir(cwd)).sort()
  } catch {
    return []
  }
}

async function scanProjectFiles(cwd: string): Promise<string[]> {
  const files: string[] = []
  await scanProjectDirectory(cwd, '', 0, files)
  return files.sort()
}

async function scanProjectDirectory(
  cwd: string,
  relativeDir: string,
  depth: number,
  files: string[]
): Promise<void> {
  if (files.length >= MAX_PROJECT_SCAN_FILES || depth > MAX_PROJECT_SCAN_DEPTH) return

  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
  try {
    entries = await readdir(join(cwd, relativeDir), { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (files.length >= MAX_PROJECT_SCAN_FILES) return
    const relativePath = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`
    if (entry.isDirectory()) {
      if (!SKIPPED_SCAN_DIRS.has(entry.name)) {
        await scanProjectDirectory(cwd, relativePath, depth + 1, files)
      }
      continue
    }
    if (entry.isFile()) files.push(relativePath)
  }
}

async function readPythonRequirementNames(cwd: string, scannedFiles: string[]): Promise<string[]> {
  const names = new Set<string>()
  const requirementsFiles = scannedFiles
    .filter((file) => file.endsWith('requirements.txt'))
    .slice(0, 20)

  for (const relativePath of requirementsFiles) {
    let content: string
    try {
      content = await readFile(join(cwd, relativePath), 'utf8')
    } catch {
      continue
    }

    for (const line of content.split(/\r?\n/)) {
      const name = parseRequirementName(line)
      if (name !== undefined) names.add(name)
    }
  }

  return [...names].sort()
}

function parseRequirementName(line: string): string | undefined {
  const cleaned = line.split('#')[0]?.trim()
  if (!cleaned || cleaned.startsWith('-') || cleaned.includes('://')) return undefined
  const match = cleaned.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/)
  return match?.[1]?.toLowerCase().replace(/_/g, '-')
}

function detectLanguages(rootEntries: string[], scannedFiles: string[], dependencyNames: string[]): string[] {
  const languages = new Set<string>()
  const dependencies = new Set(dependencyNames)

  if (
    rootEntries.includes('tsconfig.json') ||
    rootEntries.some((entry) => entry.endsWith('.ts')) ||
    dependencies.has('typescript')
  ) {
    languages.add('typescript')
  }

  if (rootEntries.some((entry) => entry.endsWith('.js'))) {
    languages.add('javascript')
  }

  if (
    scannedFiles.some(
      (file) =>
        file.endsWith('.py') ||
        file.endsWith('.ipynb') ||
        file.endsWith('requirements.txt') ||
        file.endsWith('pyproject.toml')
    ) ||
    ['numpy', 'pandas', 'pytest'].some((dependency) => dependencies.has(dependency))
  ) {
    languages.add('python')
  }

  return [...languages].sort()
}

function detectFrameworks(rootEntries: string[], scannedFiles: string[], dependencyNames: string[]): string[] {
  const frameworks = new Set<string>()
  const dependencies = new Set(dependencyNames)

  if (dependencies.has('@modelcontextprotocol/sdk')) frameworks.add('mcp')
  if (dependencies.has('vite') || rootEntries.some((entry) => entry.startsWith('vite.config.'))) {
    frameworks.add('vite')
  }
  if (dependencies.has('vitest') || rootEntries.some((entry) => entry.startsWith('vitest.config.'))) {
    frameworks.add('vitest')
  }
  if (dependencies.has('tsx')) frameworks.add('tsx')
  if (scannedFiles.some((file) => file.endsWith('.ipynb'))) frameworks.add('jupyter')
  if (
    dependencies.has('pytest') ||
    scannedFiles.some((file) => file.includes('/tests/test_') || file.split('/').at(-1)?.startsWith('test_'))
  ) {
    frameworks.add('pytest')
  }

  return [...frameworks].sort()
}

function detectDomainTags(
  rootEntries: string[],
  scannedFiles: string[],
  frameworks: string[],
  dependencyNames: string[],
  languages: string[]
): string[] {
  const tags = new Set<string>()
  const frameworkSet = new Set(frameworks)
  const dependencySet = new Set(dependencyNames)

  if (rootEntries.includes('plugin') || dependencySet.has('@modelcontextprotocol/sdk')) {
    tags.add('codex-plugin')
  }
  if (frameworkSet.has('mcp')) tags.add('mcp')
  if (languages.includes('typescript')) tags.add('typescript')
  if (languages.includes('python')) tags.add('python')

  const projectTerms = [...rootEntries, ...scannedFiles].join(' ').toLowerCase().replace(/[_./-]+/g, ' ')
  if (/\b(finance|financial|portfolio|cashflow|cash-flow|investment|trades?|positions?)\b/.test(projectTerms)) {
    tags.add('finance')
  }
  if (/\b(quant|backtest|factor|simulation|portfolio)\b/.test(projectTerms)) {
    tags.add('quant')
  }

  return [...tags].sort()
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function hashShort(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
