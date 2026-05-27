import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { CodexProjectIdentity } from './project-id.js'

export interface ProjectFingerprint {
  projectId: string
  displayName: string
  rootHash?: string
  remoteHash?: string
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'
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
  const packageJson = await readPackageJson(root)
  const dependencyNames =
    packageJson === undefined
      ? []
      : Object.keys({
          ...readObject(packageJson.dependencies),
          ...readObject(packageJson.devDependencies)
        }).sort()
  const packageManager = await detectPackageManager(root)
  const rootEntries = await safeReaddir(root)
  const languages = detectLanguages(rootEntries, dependencyNames)
  const frameworks = detectFrameworks(rootEntries, dependencyNames)
  const domainTags = detectDomainTags(rootEntries, frameworks, dependencyNames, languages)

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

async function detectPackageManager(cwd: string): Promise<ProjectFingerprint['packageManager']> {
  if (await exists(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await exists(join(cwd, 'yarn.lock'))) return 'yarn'
  if ((await exists(join(cwd, 'bun.lockb'))) || (await exists(join(cwd, 'bun.lock')))) return 'bun'
  if (await exists(join(cwd, 'package-lock.json'))) return 'npm'
  return 'unknown'
}

async function safeReaddir(cwd: string): Promise<string[]> {
  try {
    return (await readdir(cwd)).sort()
  } catch {
    return []
  }
}

function detectLanguages(rootEntries: string[], dependencyNames: string[]): string[] {
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

  return [...languages].sort()
}

function detectFrameworks(rootEntries: string[], dependencyNames: string[]): string[] {
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

  return [...frameworks].sort()
}

function detectDomainTags(
  rootEntries: string[],
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
