import { randomUUID } from 'node:crypto'
import { appendCandidateDraftFromRoot } from '../memory/memory-store.js'
import type {
  CandidateDraft,
  CandidateDraftSourceKind,
  MemoryCandidateKind,
  MemoryDomain,
  MemoryEvidence,
  MemoryScope
} from '../memory/types.js'
import { deriveMemoryCandidateKind } from '../memory/candidate-kind.js'
import { ensureCodexGlobalMemoryRoot, ensureCodexProjectMemoryRoot } from './codex-memory-root.js'
import { normalizedKeyForCodexMemoryCandidate, type CodexMemoryCandidateInput } from './memory-propose.js'

export interface CandidateDraftInput {
  projectId: string
  candidate: CodexMemoryCandidateInput
  sourceKind: CandidateDraftSourceKind
  sourceEpisodeIds?: string[]
  evidenceRefs?: string[]
  now?: string
}

export async function appendCodexCandidateDraftFailOpen(input: CandidateDraftInput): Promise<CandidateDraft | undefined> {
  try {
    const draft = toCandidateDraft(input)
    const root = draft.scope === 'global'
      ? await ensureCodexGlobalMemoryRoot()
      : await ensureCodexProjectMemoryRoot(input.projectId)
    await appendCandidateDraftFromRoot(root, draft)
    return draft
  } catch {
    return undefined
  }
}

export function toCandidateDraft(input: CandidateDraftInput): CandidateDraft {
  const candidateKind = deriveMemoryCandidateKind({
    candidateKind: input.candidate.candidateKind,
    candidate_kind: input.candidate.candidate_kind,
    tags: input.candidate.tags ?? [],
    type: input.candidate.type
  }) as MemoryCandidateKind
  const scope: MemoryScope = input.candidate.scope ?? 'project'
  const sourceOfTruth = nonEmptyString(input.candidate.sourceOfTruth) ?? sourceOfTruthFromEvidence(input.candidate.evidence)
  return {
    id: randomUUID(),
    content: input.candidate.content,
    candidateKind,
    scope,
    domain: input.candidate.domain as MemoryDomain,
    sourceKind: input.sourceKind,
    sourceEpisodeIds: input.sourceEpisodeIds ?? [],
    evidenceRefs: input.evidenceRefs ?? evidenceRefs(input.candidate.evidence),
    normalizedKey: normalizedKeyForCodexMemoryCandidate(input.candidate),
    ...(sourceOfTruth === undefined ? {} : { sourceOfTruth }),
    tags: input.candidate.tags ?? [],
    createdAt: input.now ?? new Date().toISOString()
  }
}

function evidenceRefs(evidence: MemoryEvidence[]): string[] {
  return evidence.flatMap((entry) => {
    const ref = evidenceRef(entry)
    return ref === undefined ? [] : [ref]
  })
}

function sourceOfTruthFromEvidence(evidence: MemoryEvidence[]): string | undefined {
  return evidence
    .map(evidenceRef)
    .find((value): value is string => value !== undefined)
}

function evidenceRef(entry: MemoryEvidence): string | undefined {
  return [
    entry.evidenceGroupId,
    entry.runId,
    entry.sessionId,
    entry.taskHash,
    entry.summary,
    entry.quote
  ]
    .map(nonEmptyString)
    .find((value): value is string => value !== undefined)
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}
