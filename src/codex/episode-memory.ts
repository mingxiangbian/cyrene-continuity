import { randomUUID } from 'node:crypto'
import { appendEpisodeMemoryFromRoot } from '../memory/memory-store.js'
import type { EpisodeMemory } from '../memory/types.js'
import { ensureCodexGlobalMemoryRoot, ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import type { CodexStopHookPayload } from './codex-hook-stop.js'
import { redactReviewText } from './review-redaction.js'
import type { TranscriptMessage } from './transcript.js'

const SUMMARY_MAX_LENGTH = 500
const ITEM_MAX_LENGTH = 240

export interface StopHookEpisodeInput {
  id?: string
  cwd: string
  projectId: string
  payload: CodexStopHookPayload
  messages: TranscriptMessage[]
  summary: string
  actions?: string[]
  decisions?: string[]
  failures?: string[]
  openQuestions?: string[]
  toolNames?: string[]
  now?: string
}

export async function appendStopHookEpisodeFailOpen(input: StopHookEpisodeInput): Promise<EpisodeMemory | undefined> {
  try {
    const memoryRoot = await ensureCodexProjectMemoryRoot(input.projectId)
    return await appendStopHookEpisodeToRootFailOpen(memoryRoot, input)
  } catch {
    return undefined
  }
}

export async function appendGlobalStopHookEpisodeFailOpen(input: StopHookEpisodeInput): Promise<EpisodeMemory | undefined> {
  try {
    const memoryRoot = await ensureCodexGlobalMemoryRoot()
    return await appendStopHookEpisodeToRootFailOpen(memoryRoot, input)
  } catch {
    return undefined
  }
}

export function buildStopHookEpisode(input: StopHookEpisodeInput): EpisodeMemory & { sessionId?: string; turnId?: string } {
  const sessionId = asString(input.payload.session_id)
  const turnId = asString(input.payload.turn_id)
  const sourceTraceIds = [sessionId, turnId].filter((value): value is string => value !== undefined)
  const title = lastNonemptyUserMessage(input.messages) ?? 'Codex Stop hook episode'

  return {
    id: input.id ?? randomUUID(),
    projectId: input.projectId,
    title: clean(title, ITEM_MAX_LENGTH),
    summary: clean(input.summary, SUMMARY_MAX_LENGTH),
    actions: cleanItems(input.actions ?? []),
    decisions: cleanItems(input.decisions ?? []),
    failures: cleanItems(input.failures ?? []),
    openQuestions: cleanItems(input.openQuestions ?? []),
    toolNames: cleanItems(input.toolNames ?? ['stop_hook']),
    sourceTraceIds: sourceTraceIds.length === 0 ? [input.projectId] : sourceTraceIds,
    createdAt: input.now ?? new Date().toISOString(),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(turnId === undefined ? {} : { turnId })
  }
}

async function appendStopHookEpisodeToRootFailOpen(
  memoryRoot: string,
  input: StopHookEpisodeInput
): Promise<EpisodeMemory> {
  const episode = buildStopHookEpisode(input)
  await appendEpisodeMemoryFromRoot(memoryRoot, episode)
  return episode
}

function lastNonemptyUserMessage(messages: TranscriptMessage[]): string | undefined {
  return [...messages].reverse().find((message) => message.role === 'user' && message.content.trim() !== '')?.content
}

function cleanItems(values: string[]): string[] {
  return values.map((value) => clean(value, ITEM_MAX_LENGTH)).filter((value) => value !== '')
}

function clean(value: string, maxLength: number): string {
  return redactReviewText(value.replace(/\s+/g, ' ').trim()).text.slice(0, maxLength)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}
