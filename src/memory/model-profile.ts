import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const MODEL_PROFILE_FILE = 'MODEL_PROFILE.md'

export async function readModelProfileFromRootIfExists(memoryRoot: string): Promise<string | undefined> {
  const targetPath = join(memoryRoot, MODEL_PROFILE_FILE)
  let stats
  try {
    stats = await lstat(targetPath)
  } catch (error) {
    if (isFileErrorCode(error, 'ENOENT')) {
      return undefined
    }
    throw error
  }

  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to read memory profile symlink: ${targetPath}`)
  }
  if (!stats.isFile()) {
    throw new Error(`Refusing to read non-file memory profile path: ${targetPath}`)
  }

  return (await readFile(targetPath, 'utf8')).trim()
}

function isFileErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
