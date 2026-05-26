import { lstat, mkdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

export async function ensureMemoryRoot(cwd: string): Promise<string> {
  const cwdRealPath = await realpath(cwd)
  const cyreneDir = await ensureSafeDirectory(join(cwdRealPath, '.cyrene'), cwdRealPath)
  return ensureSafeDirectory(join(cyreneDir, 'memory'), cyreneDir)
}

export async function getReadableMemoryRoot(cwd: string): Promise<string | null> {
  const cwdRealPath = await realpath(cwd)
  const cyreneDir = await getSafeDirectoryOrNull(join(cwdRealPath, '.cyrene'), cwdRealPath)
  if (cyreneDir === null) {
    return null
  }

  return getSafeDirectoryOrNull(join(cyreneDir, 'memory'), cyreneDir)
}

export async function getMemoryRoot(cwd: string): Promise<string> {
  const root = await getReadableMemoryRoot(cwd)
  if (root === null) {
    throw new Error('Memory root does not exist')
  }
  return root
}

export function resolveMemoryFile(memoryRoot: string, relativePath: string): string {
  const resolved = resolve(memoryRoot, relativePath)
  if (!isPathInside(memoryRoot, resolved)) {
    throw new Error(`Memory file must stay inside memory directory: ${relativePath}`)
  }
  return resolved
}

async function ensureSafeDirectory(dirPath: string, parentRealPath: string): Promise<string> {
  try {
    return await getSafeDirectory(dirPath, parentRealPath)
  } catch (error) {
    if (!isFileErrorCode(error, 'ENOENT')) {
      throw error
    }
  }

  await mkdir(dirPath).catch((error: unknown) => {
    if (!isFileErrorCode(error, 'EEXIST')) {
      throw error
    }
  })
  return getSafeDirectory(dirPath, parentRealPath)
}

async function getSafeDirectoryOrNull(dirPath: string, parentRealPath: string): Promise<string | null> {
  try {
    return await getSafeDirectory(dirPath, parentRealPath)
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return null
    }

    throw error
  }
}

async function getSafeDirectory(dirPath: string, parentRealPath: string): Promise<string> {
  const stats = await lstat(dirPath)
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to use memory symlink: ${dirPath}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`Refusing to use non-directory memory path: ${dirPath}`)
  }

  const dirRealPath = await realpath(dirPath)
  if (!isPathInside(parentRealPath, dirRealPath)) {
    throw new Error(`Refusing to use memory path outside parent: ${dirPath}`)
  }
  return dirRealPath
}

function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
