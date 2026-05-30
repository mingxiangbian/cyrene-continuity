import {
  archiveCodexActiveMemory,
  proposeEditCodexActiveMemory,
  supersedeCodexActiveMemory,
  tombstoneCodexActiveMemory
} from './active-memory-review.js'

export async function runCodexMemoryActiveArchive(input: {
  cwd: string
  id: string
  contentHash: string
  reason: string
}): Promise<string> {
  return `${JSON.stringify(await archiveCodexActiveMemory(input), null, 2)}\n`
}

export async function runCodexMemoryActiveTombstone(input: {
  cwd: string
  id: string
  contentHash: string
  reason: string
  days?: number
  indefinite?: boolean
}): Promise<string> {
  return `${JSON.stringify(await tombstoneCodexActiveMemory(input), null, 2)}\n`
}

export async function runCodexMemoryActiveProposeEdit(input: {
  cwd: string
  id: string
  contentHash: string
  content: string
  reason: string
}): Promise<string> {
  return `${JSON.stringify(await proposeEditCodexActiveMemory(input), null, 2)}\n`
}

export async function runCodexMemoryActiveSupersede(input: {
  cwd: string
  id: string
  candidateId: string
  contentHash: string
  reviewHash: string
  reason: string
}): Promise<string> {
  return `${JSON.stringify(await supersedeCodexActiveMemory(input), null, 2)}\n`
}
