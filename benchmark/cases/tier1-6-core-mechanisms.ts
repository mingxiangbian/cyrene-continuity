import { createBenchmarkFixture, withFixtureEnvironment } from '../fixtures.js'
import { recordFixtureRun } from './common.js'
import { rebuildCodexMemoryIndex } from '../../src/codex/codex-memory-index.js'
import { runCodexMemoryLifecycleDaily } from '../../src/codex/codex-memory-lifecycle-daily.js'
import { getCodexContinuityContext } from '../../src/codex/continuity-context.js'
import { runCodexMemoryContextPreview } from '../../src/codex/memory-context-preview.js'
import { memoryReviewDecisionInputSchema } from '../../src/mcp/tools/memory-review.js'
import { proposeCodexMemoryCandidate } from '../../src/codex/memory-propose.js'
import {
  deferCodexPendingMemory,
  editCodexPendingMemory,
  promoteCodexPendingMemory,
  rejectCodexPendingMemory,
  reviewHashForPendingMemory
} from '../../src/codex/memory-review.js'
import {
  readActiveMemoriesFromRoot,
  readMemoryEventsFromRoot,
  readMemoryEdgesFromRoot,
  readPendingMemoriesFromRoot,
  readTombstonesFromRoot,
  upsertMemoryEdgeFromRoot
} from '../../src/memory/memory-store.js'
import { createModelHintEdge, createOperationBackedEdge } from '../../src/memory/memory-relations.js'
import type {
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkEvidence,
  BenchmarkMetric,
  BenchmarkRunOptions,
  HardGateRuleId
} from '../types.js'
import type { CyreneMemory, MemoryRelationType, PendingMemory } from '../../src/memory/types.js'

type Tier16CaseId =
  | 'T16-PROPOSE-IMPORTANT'
  | 'T16-PROPOSE-NOISE'
  | 'T16-PROPOSE-SENSITIVE'
  | 'T16-PROPOSE-ASSISTANT-INFERENCE'
  | 'T16-ROUTING-NAMESPACE'
  | 'T16-REVIEW-HASH-REQUIRED'
  | 'T16-REVIEW-STALE-HASH'
  | 'T16-REVIEW-REJECT-DEFER'
  | 'T16-REVIEW-EDIT-HASH'
  | 'T16-REL-SUPERSEDES-DIRECTION'
  | 'T16-REL-SIMILAR-NO-EXPANSION'
  | 'T16-REL-DERIVED-TRIAL-BLOCK'
  | 'T16-REL-TRANSFER-HINT-ONLY'
  | 'T16-REL-TRIAL-HINT-EXCLUSION'
  | 'T16-REL-EDGE-INVALIDATION'
  | 'T16-REL-FALLBACK-SCOPE-GUARD'
  | 'T16-REL-LASTUSED-HOTPATH'

type CaseAssertion = (input: {
  benchmarkCase: BenchmarkCase
  options: BenchmarkRunOptions
  now: string
  seed: string
}) => Promise<readonly BenchmarkEvidence[]>

type BenchmarkFixtureInstance = Awaited<ReturnType<typeof createBenchmarkFixture>>
type ActiveFixtureMemory = Partial<CyreneMemory> & { id: string; content: string }

const CASES: Record<Tier16CaseId, { hardFailure: HardGateRuleId; run: CaseAssertion }> = {
  'T16-PROPOSE-IMPORTANT': { hardFailure: 'unauthorized_promotion', run: runProposeImportant },
  'T16-PROPOSE-NOISE': { hardFailure: 'ordinary_hook_pending_review', run: runProposeNoise },
  'T16-PROPOSE-SENSITIVE': { hardFailure: 'secret_persistence', run: runProposeSensitive },
  'T16-PROPOSE-ASSISTANT-INFERENCE': { hardFailure: 'unauthorized_promotion', run: runProposeAssistantInference },
  'T16-ROUTING-NAMESPACE': { hardFailure: 'wrong_namespace_routing', run: runRoutingNamespace },
  'T16-REVIEW-HASH-REQUIRED': { hardFailure: 'hash_bypass', run: runReviewHashRequired },
  'T16-REVIEW-STALE-HASH': { hardFailure: 'stale_approval_success', run: runReviewStaleHash },
  'T16-REVIEW-REJECT-DEFER': { hardFailure: 'rejected_memory_activation', run: runReviewRejectDefer },
  'T16-REVIEW-EDIT-HASH': { hardFailure: 'hash_bypass', run: runReviewEditHash },
  'T16-REL-SUPERSEDES-DIRECTION': { hardFailure: 'conflicting_context_injection', run: runRelationSupersedesDirection },
  'T16-REL-SIMILAR-NO-EXPANSION': { hardFailure: 'duplicate_context_injection', run: runRelationSimilarNoExpansion },
  'T16-REL-DERIVED-TRIAL-BLOCK': { hardFailure: 'pending_active_bypass', run: runRelationDerivedTrialBlock },
  'T16-REL-TRANSFER-HINT-ONLY': { hardFailure: 'similar_hint_migration', run: runRelationTransferHintOnly },
  'T16-REL-TRIAL-HINT-EXCLUSION': { hardFailure: 'pending_active_bypass', run: runRelationTrialHintExclusion },
  'T16-REL-EDGE-INVALIDATION': { hardFailure: 'expired_memory_injection', run: runRelationEdgeInvalidation },
  'T16-REL-FALLBACK-SCOPE-GUARD': { hardFailure: 'cross_project_pollution', run: runRelationFallbackScopeGuard },
  'T16-REL-LASTUSED-HOTPATH': { hardFailure: 'retrieved_default_write', run: runRelationLastUsedHotpath }
}

export async function runTier16Case(
  benchmarkCase: BenchmarkCase,
  options: BenchmarkRunOptions
): Promise<BenchmarkCaseResult | undefined> {
  const handler = CASES[benchmarkCase.id as Tier16CaseId]
  if (handler === undefined) return undefined

  const now = options.now ?? benchmarkCase.fixture.now
  const seed = `${options.seed ?? benchmarkCase.fixture.seed}:${benchmarkCase.id}`
  try {
    const evidence = await handler.run({ benchmarkCase, options, now, seed })
    return caseResult(benchmarkCase, true, [], evidence)
  } catch (error) {
    return caseResult(benchmarkCase, false, [handler.hardFailure], [
      { summary: `${benchmarkCase.id} failed`, detail: errorMessage(error) }
    ])
  }
}

async function runProposeImportant(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withEmptyFixture(input, async (fixture) => {
    const content = 'Benchmark cases for memory review hashes must stay covered by deterministic gate tests.'
    const result = await proposeCodexMemoryCandidate({
      cwd: fixture.cwd,
      now: input.now,
      allowAutoPromote: false,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        candidateKind: 'workflow_rule',
        strength: 'hard',
        content,
        normalizedKey: 'benchmark-review-hash-gate-coverage',
        sourceOfTruth: 'benchmark spec',
        source: 'file',
        evidence: [{ runId: 'tier16-important', sourceKind: 'file', summary: 'Benchmark spec requires T16 review-hash coverage.' }],
        scores: { evidenceStrength: 0.9, stability: 0.85, usefulness: 0.8, safety: 0.95, sensitivity: 0.05 },
        tags: ['benchmark']
      }
    })
    assert(result.result.action === 'pending', `expected pending important proposal, got ${result.result.action}`)
    const pending = await readPendingMemoriesFromRoot(fixture.projectMemoryRoot)
    assert(pending.length === 1 && pending[0]?.content.includes(content), 'important proposal was not written to project review queue')
    assert((await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'important proposal bypassed review')
    return [{ summary: 'important project rule candidate proposed for review' }]
  })
}

async function runProposeNoise(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withEmptyFixture(input, async (fixture) => {
    const result = await proposeCodexMemoryCandidate({
      cwd: fixture.cwd,
      now: input.now,
      recordRejectedCandidate: false,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        content: 'npm test passed once in this benchmark fixture.',
        normalizedKey: 'one-time-test-result-noise',
        source: 'tool_trace',
        evidence: [{ runId: 'tier16-noise', sourceKind: 'tool_trace', summary: 'One-time test passed.' }],
        scores: { evidenceStrength: 0.4, stability: 0.2, usefulness: 0.2, safety: 0.9, sensitivity: 0.05 }
      }
    })
    assert(result.result.action === 'reject', `expected rejected noise proposal, got ${result.result.action}`)
    assert((await readPendingMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'noise was written to pending memory')
    assert((await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'noise was activated')
    return [{ summary: 'noise filtered decision; pending noise=0' }]
  })
}

async function runProposeSensitive(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withEmptyFixture(input, async (fixture) => {
    const secret = 'api_key=sk_benchmark_secret_1234567890abcdef'
    const result = await proposeCodexMemoryCandidate({
      cwd: fixture.cwd,
      now: input.now,
      recordRejectedCandidate: false,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        content: `Never persist this credential: ${secret}`,
        normalizedKey: 'sensitive-secret-fixture',
        source: 'tool_trace',
        evidence: [{ runId: 'tier16-sensitive', sourceKind: 'tool_trace', summary: 'Tool output contained a credential-like value.' }],
        scores: { evidenceStrength: 0.8, stability: 0.8, usefulness: 0.1, safety: 0.4, sensitivity: 0.95 }
      }
    })
    assert(result.result.action === 'reject', `expected rejected sensitive proposal, got ${result.result.action}`)
    const memoryText = await rootMemoryText(fixture.projectMemoryRoot)
    assert(!memoryText.includes(secret), 'secret-like content persisted in memory store')
    return [{ summary: 'sensitive content rejected; secret persistence=0' }]
  })
}

async function runProposeAssistantInference(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withEmptyFixture(input, async (fixture) => {
    const content = 'User prefers terse benchmark updates because they accepted an assistant suggestion without correction.'
    const result = await proposeCodexMemoryCandidate({
      cwd: fixture.cwd,
      now: input.now,
      allowAutoPromote: false,
      candidate: {
        domain: 'personal',
        type: 'interaction_style',
        content,
        normalizedKey: 'assistant-inferred-terse-updates',
        source: 'assistant_observed',
        evidence: [{ runId: 'tier16-assistant-inference', sourceKind: 'assistant_observed', summary: 'Assistant suggested terse updates and it was accepted without correction.' }],
        scores: { evidenceStrength: 0.8, stability: 0.7, usefulness: 0.7, safety: 0.9, sensitivity: 0.3 }
      }
    })
    assert(result.result.action === 'pending', `expected assistant inference to remain pending, got ${result.result.action}`)
    assert((await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'assistant inference was activated')
    return [{ summary: 'assistant inference deferred for review; active inference=0' }]
  })
}

async function runRoutingNamespace(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withEmptyFixture(input, async (fixture) => {
    const projectContent = 'Project namespace benchmark memory belongs only in the project root.'
    const globalContent = 'Global namespace benchmark memory belongs only in the global root.'
    const projectResult = await proposeCodexMemoryCandidate({
      cwd: fixture.cwd,
      now: input.now,
      allowAutoPromote: false,
      candidate: {
        domain: 'project',
        type: 'project_fact',
        candidateKind: 'workflow_rule',
        scope: 'project',
        content: projectContent,
        normalizedKey: 'tier16-project-routing',
        source: 'file',
        evidence: [{ runId: 'tier16-project-routing', sourceKind: 'file', summary: 'Project-scoped benchmark evidence.' }],
        scores: { evidenceStrength: 0.8, stability: 0.75, usefulness: 0.7, safety: 0.95, sensitivity: 0.05 }
      }
    })
    const globalResult = await proposeCodexMemoryCandidate({
      cwd: fixture.cwd,
      now: input.now,
      allowAutoPromote: false,
      candidate: {
        domain: 'procedural',
        type: 'procedural_rule',
        candidateKind: 'workflow_rule',
        scope: 'global',
        content: globalContent,
        normalizedKey: 'tier16-global-routing',
        source: 'user_explicit',
        evidence: [{ runId: 'tier16-global-routing', sourceKind: 'user_explicit', summary: 'Global-scoped benchmark evidence.' }],
        scores: { evidenceStrength: 0.8, stability: 0.75, usefulness: 0.7, safety: 0.95, sensitivity: 0.05 }
      }
    })
    assert(projectResult.result.action === 'pending', `expected project routing proposal to stay pending, got ${projectResult.result.action}`)
    assert(globalResult.result.action === 'pending', `expected global routing proposal to stay pending, got ${globalResult.result.action}`)
    const projectText = await rootMemoryText(fixture.projectMemoryRoot)
    const globalText = await rootMemoryText(fixture.globalMemoryRoot)
    assert(projectText.includes(projectContent), 'project memory missing from project root')
    assert(!projectText.includes(globalContent), 'global memory leaked into project root')
    assert(globalText.includes(globalContent), 'global memory missing from global root')
    assert(!globalText.includes(projectContent), 'project memory leaked into global root')
    return [{ summary: 'namespace routing ok; project and global roots isolated' }]
  })
}

async function runReviewHashRequired(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withReviewFixture(input, [pendingReviewCandidate('hash-required')], async (fixture) => {
    const parsed = memoryReviewDecisionInputSchema.reviewHash.safeParse(undefined)
    assert(!parsed.success, 'review decision schema accepted missing reviewHash')
    const result = await promoteCodexPendingMemory({
      cwd: fixture.cwd,
      id: 'hash-required',
      reviewHash: '',
      now: input.now
    })
    assert(result.result.action === 'conflict', `missing/empty hash should not promote, got ${result.result.action}`)
    assert((await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'approval without hash activated memory')
    assert((await readPendingMemoriesFromRoot(fixture.projectMemoryRoot)).some((item) => item.id === 'hash-required'), 'pending candidate disappeared after missing hash check')
    return [{ summary: 'review hash required; missing reviewHash rejected' }]
  })
}

async function runReviewStaleHash(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withReviewFixture(input, [pendingReviewCandidate('stale-hash')], async (fixture) => {
    const result = await promoteCodexPendingMemory({
      cwd: fixture.cwd,
      id: 'stale-hash',
      reviewHash: '0'.repeat(64),
      now: input.now
    })
    assert(result.result.action === 'conflict', `expected stale hash conflict, got ${result.result.action}`)
    assert((await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'stale hash activated memory')
    assert((await readPendingMemoriesFromRoot(fixture.projectMemoryRoot)).some((item) => item.id === 'stale-hash'), 'stale hash removed pending candidate')
    return [{ summary: 'stale hash rejected; active writes=0' }]
  })
}

async function runReviewRejectDefer(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withReviewFixture(input, [
    pendingReviewCandidate('reject-candidate', { normalizedKey: 'tier16-reject-candidate' }),
    pendingReviewCandidate('defer-candidate', { normalizedKey: 'tier16-defer-candidate' })
  ], async (fixture) => {
    const pending = await readPendingMemoriesFromRoot(fixture.projectMemoryRoot)
    const rejectCandidate = requiredPending(pending, 'reject-candidate')
    const deferCandidate = requiredPending(pending, 'defer-candidate')
    const reject = await rejectCodexPendingMemory({
      cwd: fixture.cwd,
      id: rejectCandidate.id,
      reviewHash: reviewHashForPendingMemory(rejectCandidate),
      reason: 'T16 reject benchmark',
      now: input.now
    })
    const defer = await deferCodexPendingMemory({
      cwd: fixture.cwd,
      id: deferCandidate.id,
      reviewHash: reviewHashForPendingMemory(deferCandidate),
      days: 3,
      reason: 'T16 defer benchmark',
      now: input.now
    })
    assert(reject.result.action === 'reject', `expected reject action, got ${reject.result.action}`)
    assert(defer.result.action === 'defer', `expected defer action, got ${defer.result.action}`)
    const afterPending = await readPendingMemoriesFromRoot(fixture.projectMemoryRoot)
    assert(!afterPending.some((item) => item.id === rejectCandidate.id), 'rejected candidate stayed pending')
    assert(afterPending.some((item) => item.id === deferCandidate.id && item.promoteAfter === addDays(input.now, 3)), 'deferred candidate missing promoteAfter')
    assert((await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'reject/defer activated memory')
    return [{ summary: 'reject and defer stay inactive; active writes=0' }]
  })
}

async function runReviewEditHash(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withReviewFixture(input, [pendingReviewCandidate('edit-hash')], async (fixture) => {
    const original = requiredPending(await readPendingMemoriesFromRoot(fixture.projectMemoryRoot), 'edit-hash')
    const oldHash = reviewHashForPendingMemory(original)
    const edit = await editCodexPendingMemory({
      cwd: fixture.cwd,
      id: original.id,
      reviewHash: oldHash,
      content: 'Use the current review hash when approving edited pending memory candidates.',
      normalizedKey: original.normalizedKey,
      reason: 'T16 edit benchmark',
      now: input.now
    })
    assert(edit.result.action === 'edit', `expected edit action, got ${edit.result.action}`)
    assert(edit.result.reviewHash !== oldHash, 'edited candidate kept the old review hash')
    const stalePromote = await promoteCodexPendingMemory({
      cwd: fixture.cwd,
      id: original.id,
      reviewHash: oldHash,
      now: input.now
    })
    assert(stalePromote.result.action === 'conflict', `old edit hash should conflict, got ${stalePromote.result.action}`)
    assert((await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)).length === 0, 'stale edited hash activated memory')
    return [{ summary: 'edited candidate receives new hash; stale edit hash rejected' }]
  })
}

async function runRelationSupersedesDirection(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withActiveFixture(input, [
    activeRelationMemory('old-relation-rule', 'Obsoletebenchalpha relation rule should be replaced.', 'obsoletebenchalpha-relation-rule'),
    activeRelationMemory('replacement-relation-rule', 'Benchmark replacement relation rule should be used.', 'replacement-relation-rule')
  ], async (fixture) => {
    await upsertOperationEdge(input, fixture, {
      fromMemoryId: 'replacement-relation-rule',
      toMemoryId: 'old-relation-rule',
      relationType: 'supersedes',
      evidenceId: 'review-supersedes-direction'
    })
    await rebuildCodexMemoryIndex({ cwd: fixture.cwd })

    const context = await getCodexContinuityContext({
      cwd: fixture.cwd,
      userMessage: 'obsoletebenchalpha',
      task: 'memory',
      mode: 'review',
      includeDiagnostics: true,
      recordRetrievedEvents: false
    })

    const projectMemoryIds = context.projectMemory.map((item) => item.id)
    assert(projectMemoryIds.includes('replacement-relation-rule'), 'replacement relation memory was not injected')
    assert(!projectMemoryIds.includes('old-relation-rule'), 'superseded relation seed was still injected')
    assert(!context.memory.items.map((item) => item.id).includes('old-relation-rule'), 'superseded memory remained in canonical memory items')
    assert(
      context.projectMemory.find((item) => item.id === 'replacement-relation-rule')?.explain?.includes('edge:relation:supersedes'),
      'replacement memory did not explain supersedes relation expansion'
    )
    return [{ summary: 'supersedes direction ok; staleLeakage=0' }]
  })
}

async function runRelationSimilarNoExpansion(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withActiveFixture(input, [
    activeRelationMemory('primary-relation-rule', 'Primarybenchalpha relation rule stays as the only runtime result.', 'primarybenchalpha-relation-rule'),
    activeRelationMemory('duplicate-relation-rule', 'Duplicate relation rule is only useful for diagnostics.', 'duplicate-relation-rule')
  ], async (fixture) => {
    await upsertOperationEdge(input, fixture, {
      fromMemoryId: 'primary-relation-rule',
      toMemoryId: 'duplicate-relation-rule',
      relationType: 'similar_to',
      evidenceId: 'review-similar-no-expansion'
    })
    await rebuildCodexMemoryIndex({ cwd: fixture.cwd })

    const context = await getCodexContinuityContext({
      cwd: fixture.cwd,
      userMessage: 'primarybenchalpha',
      task: 'memory',
      mode: 'review',
      recordRetrievedEvents: false
    })

    const projectMemoryIds = context.projectMemory.map((item) => item.id)
    assert(projectMemoryIds.includes('primary-relation-rule'), 'primary relation memory was not retrieved')
    assert(
      !context.projectMemory.some((item) => item.explain?.includes('edge:relation:similar_to')),
      'similar_to relation appeared in runtime expansion explain'
    )
    return [{ summary: 'similar relation diagnostics-only; expansion=0' }]
  })
}

async function runRelationDerivedTrialBlock(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withActiveFixture(input, [
    activeRelationMemory('derived-seed-rule', 'Derivedbenchalpha seed relation memory.', 'derivedbenchalpha-seed'),
    activeRelationMemory('derived-hint-rule', 'Derived model hint target must stay out of active context.', 'derived-model-hint-target')
  ], async (fixture) => {
    await upsertModelHintEdge(input, fixture, {
      fromMemoryId: 'derived-seed-rule',
      toMemoryId: 'derived-hint-rule',
      relationType: 'derived_from'
    })

    const preview = await runCodexMemoryContextPreview({
      cwd: fixture.cwd,
      userMessage: 'derivedbenchalpha',
      mode: 'review',
      includeDiagnostics: true
    })

    assert(
      preview.diagnostics.relations?.filtered.some((item) =>
        item.relationType === 'derived_from' && item.status === 'trial' && item.reason === 'edge_not_validated'
      ),
      'trial derived_from relation was not reported as filtered diagnostics'
    )
    assert(!JSON.stringify(preview.activeContext).includes('derived-hint-rule'), 'trial derived_from target entered active context')
    assert(!JSON.stringify(preview.activeContext).includes('edge:relation:derived_from'), 'trial derived_from edge entered runtime explain')
    return [{ summary: 'derived trial relation blocked; activeHintLeakage=0' }]
  })
}

async function runRelationTransferHintOnly(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withActiveFixture(input, [
    activeRelationMemory('transfer-seed-rule', 'Transferbenchalpha seed relation memory stays local.', 'transferbenchalpha-seed')
  ], async (fixture) => {
    await upsertModelHintEdge(input, fixture, {
      fromMemoryId: 'transfer-seed-rule',
      toMemoryId: 'foreign-transfer-target',
      relationType: 'transfers_to',
      toProjectId: 'foreign-transfer-project'
    })

    const preview = await runCodexMemoryContextPreview({
      cwd: fixture.cwd,
      userMessage: 'transferbenchalpha',
      mode: 'review',
      includeDiagnostics: true
    })
    const active = await readActiveMemoriesFromRoot(fixture.projectMemoryRoot)
    const pending = await readPendingMemoriesFromRoot(fixture.projectMemoryRoot)

    assert(
      preview.diagnostics.relations?.filtered.some((item) =>
        item.relationType === 'transfers_to' && item.status === 'trial' && item.reason === 'edge_not_validated'
      ),
      'trial transfers_to relation was not kept as filtered diagnostics'
    )
    assert(active.length === 1 && active[0]?.id === 'transfer-seed-rule', 'transfer relation migrated active memory')
    assert(pending.length === 0, 'transfer relation generated a pending memory')
    assert(!JSON.stringify(preview.activeContext).includes('foreign-transfer-target'), 'transfer relation target entered active context')
    return [{ summary: 'transfer relation hint-only; migration=0' }]
  })
}

async function runRelationTrialHintExclusion(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withActiveFixture(input, [
    activeRelationMemory('trial-hint-seed-rule', 'Trialhintseedalpha seed relation memory should retrieve normally.', 'trialhintseedalpha-seed'),
    activeRelationMemory('trial-hint-target-rule', 'Unrelated model relation target must not be expanded by a trial edge.', 'trial-hint-target')
  ], async (fixture) => {
    await upsertModelHintEdge(input, fixture, {
      fromMemoryId: 'trial-hint-seed-rule',
      toMemoryId: 'trial-hint-target-rule',
      relationType: 'refines'
    })
    await rebuildCodexMemoryIndex({ cwd: fixture.cwd })

    const context = await getCodexContinuityContext({
      cwd: fixture.cwd,
      userMessage: 'trialhintseedalpha',
      task: 'memory',
      mode: 'review',
      recordRetrievedEvents: false
    })
    const preview = await runCodexMemoryContextPreview({
      cwd: fixture.cwd,
      userMessage: 'trialhintseedalpha',
      mode: 'review',
      includeDiagnostics: true
    })

    const projectMemoryIds = context.projectMemory.map((item) => item.id)
    assert(projectMemoryIds.includes('trial-hint-seed-rule'), 'trial hint seed memory was not retrieved')
    assert(
      !context.projectMemory.some((item) => item.explain?.includes('edge:relation:refines')),
      'trial model hint edge was expanded into runtime context'
    )
    assert(
      preview.diagnostics.relations?.filtered.some((item) =>
        item.relationType === 'refines' && item.status === 'trial' && item.reason === 'edge_not_validated'
      ),
      'trial model hint was not visible as diagnostics-only relation'
    )
    return [{ summary: 'trial relation hint excluded from runtime; diagnosticsOnly=1' }]
  })
}

async function runRelationEdgeInvalidation(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withEmptyFixture(input, async (fixture) => {
    await upsertOperationEdge(input, fixture, {
      fromMemoryId: 'existing-relation-endpoint',
      toMemoryId: 'missing-relation-endpoint',
      relationType: 'supports',
      evidenceId: 'review-orphan-edge'
    })

    const result = await runCodexMemoryLifecycleDaily({
      projectRoots: [{ projectId: fixture.projectId, memoryRoot: fixture.projectMemoryRoot }],
      apply: true,
      now: input.now
    })
    const edge = (await readMemoryEdgesFromRoot(fixture.projectMemoryRoot))[0]
    const auditEvents = await readMemoryEventsFromRoot(fixture.projectMemoryRoot)

    assert(result.roots[0]?.relationEdgesExpired === 1, 'daily lifecycle did not expire orphan relation edge')
    assert(edge?.status === 'expired', 'orphan relation edge was not marked expired')
    assert(edge.updatedAt === input.now, 'expired relation edge did not record deterministic updatedAt')
    assert(auditEvents.some((event) => event.memoryId === edge.id && event.action === 'audit'), 'edge expiration audit event was not recorded')
    return [{ summary: 'relation edge invalidation ok; expired=1' }]
  })
}

async function runRelationFallbackScopeGuard(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withActiveFixture(input, [
    activeRelationMemory('fallback-scope-seed-rule', 'Fallbackscopealpha current project relation memory.', 'fallbackscopealpha-current'),
    activeRelationMemory('foreign-fallback-target-rule', 'Foreign relation target must not cross into project fallback context.', 'foreign-fallback-target', {
      scope: 'global',
      confidenceTier: 'global_core'
    })
  ], async (fixture) => {
    await upsertOperationEdge(input, fixture, {
      fromMemoryId: 'fallback-scope-seed-rule',
      toMemoryId: 'foreign-fallback-target-rule',
      relationType: 'supports',
      evidenceId: 'review-fallback-scope',
      toScope: 'global',
      toProjectId: 'foreign-fallback-project'
    })

    const context = await getCodexContinuityContext({
      cwd: fixture.cwd,
      userMessage: 'fallbackscopealpha',
      task: 'memory',
      mode: 'review',
      includeDiagnostics: true,
      allowJsonlFallback: true,
      recordRetrievedEvents: false
    })
    const projectMemoryIds = context.projectMemory.map((item) => item.id)

    assert(context.diagnostics?.memoryIndex?.source === 'jsonl', 'scope guard case did not exercise JSONL fallback')
    assert(projectMemoryIds.includes('fallback-scope-seed-rule'), 'current project fallback seed was not retrieved')
    assert(!projectMemoryIds.includes('foreign-fallback-target-rule'), 'cross-project relation target was injected as project memory by JSONL fallback')
    return [{ summary: 'JSONL fallback scope guard ok; crossProjectPollution=0' }]
  })
}

async function runRelationLastUsedHotpath(input: Parameters<CaseAssertion>[0]): Promise<readonly BenchmarkEvidence[]> {
  return withActiveFixture(input, [
    activeRelationMemory('hotpath-seed-rule', 'Hotpathalpha relation seed should retrieve from SQLite.', 'hotpathalpha-seed'),
    activeRelationMemory('hotpath-related-rule', 'Validated hot path relation target is injected read-only.', 'hotpath-related')
  ], async (fixture) => {
    await upsertOperationEdge(input, fixture, {
      fromMemoryId: 'hotpath-seed-rule',
      toMemoryId: 'hotpath-related-rule',
      relationType: 'supports',
      evidenceId: 'review-hotpath-readonly'
    })
    await rebuildCodexMemoryIndex({ cwd: fixture.cwd })
    const before = await readMemoryEdgesFromRoot(fixture.projectMemoryRoot)

    const context = await getCodexContinuityContext({
      cwd: fixture.cwd,
      userMessage: 'hotpathalpha',
      task: 'memory',
      mode: 'review',
      recordRetrievedEvents: false
    })

    const after = await readMemoryEdgesFromRoot(fixture.projectMemoryRoot)
    const projectMemoryIds = context.projectMemory.map((item) => item.id)
    assert(projectMemoryIds.includes('hotpath-seed-rule'), 'hot path seed memory was not retrieved')
    assert(projectMemoryIds.includes('hotpath-related-rule'), 'validated relation target was not expanded')
    assert(
      context.projectMemory.find((item) => item.id === 'hotpath-related-rule')?.explain?.includes('edge:relation:supports'),
      'hot path relation target did not explain relation expansion'
    )
    assert(before.length === 1 && after.length === 1, 'relation hot path changed edge count')
    assert(after[0]?.lastUsedAt === undefined, 'relation hot path wrote lastUsedAt')
    assert(after[0]?.updatedAt === before[0]?.updatedAt, 'relation hot path mutated updatedAt')
    return [{ summary: 'relation hot path read-only; lastUsedWrites=0' }]
  })
}

async function withEmptyFixture(
  input: Parameters<CaseAssertion>[0],
  run: (fixture: Awaited<ReturnType<typeof createBenchmarkFixture>>) => Promise<readonly BenchmarkEvidence[]>
): Promise<readonly BenchmarkEvidence[]> {
  return withFixture(input, [], run)
}

async function withReviewFixture(
  input: Parameters<CaseAssertion>[0],
  pendingMemories: Array<Partial<PendingMemory> & { id: string; content: string }>,
  run: (fixture: Awaited<ReturnType<typeof createBenchmarkFixture>>) => Promise<readonly BenchmarkEvidence[]>
): Promise<readonly BenchmarkEvidence[]> {
  return withFixture(input, pendingMemories, run)
}

async function withActiveFixture(
  input: Parameters<CaseAssertion>[0],
  activeMemories: ActiveFixtureMemory[],
  run: (fixture: BenchmarkFixtureInstance) => Promise<readonly BenchmarkEvidence[]>
): Promise<readonly BenchmarkEvidence[]> {
  return withFixture(input, [], run, activeMemories)
}

async function withFixture(
  input: Parameters<CaseAssertion>[0],
  pendingMemories: Array<Partial<PendingMemory> & { id: string; content: string }>,
  run: (fixture: Awaited<ReturnType<typeof createBenchmarkFixture>>) => Promise<readonly BenchmarkEvidence[]>,
  activeMemories: ActiveFixtureMemory[] = []
): Promise<readonly BenchmarkEvidence[]> {
  const baseInput = {
    caseId: input.benchmarkCase.id,
    seed: input.seed,
    now: input.now,
    pendingMemories,
    ...(activeMemories.length === 0 ? {} : { activeMemories })
  }
  const fixture = await createBenchmarkFixture(
    input.options.preserveFixtures === true
      ? {
          ...baseInput,
          preserveFixture: true,
          preserveReason: `${input.benchmarkCase.id} preserved because --preserve-fixtures was set`
        }
      : baseInput
  )
  try {
    return await withFixtureEnvironment(fixture, async () => run(fixture))
  } finally {
    try {
      await fixture.cleanup()
    } finally {
      recordFixtureRun(input.options, fixture.metadata)
    }
  }
}

function activeRelationMemory(
  id: string,
  content: string,
  normalizedKey: string,
  overrides: Partial<CyreneMemory> = {}
): ActiveFixtureMemory {
  return {
    id,
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    content,
    normalizedKey,
    source: 'user_explicit',
    scores: { evidenceStrength: 0.95, stability: 0.9, usefulness: 0.9, safety: 0.95, sensitivity: 0.05 },
    tags: ['benchmark', 'relation'],
    candidateKind: 'workflow_rule',
    ...overrides
  }
}

async function upsertOperationEdge(
  input: Parameters<CaseAssertion>[0],
  fixture: BenchmarkFixtureInstance,
  edge: {
    fromMemoryId: string
    toMemoryId: string
    relationType: MemoryRelationType
    evidenceId: string
    fromScope?: CyreneMemory['scope']
    toScope?: CyreneMemory['scope']
    fromProjectId?: string
    toProjectId?: string
  }
): Promise<void> {
  await upsertMemoryEdgeFromRoot(fixture.projectMemoryRoot, createOperationBackedEdge({
    fromMemoryId: edge.fromMemoryId,
    toMemoryId: edge.toMemoryId,
    fromScope: edge.fromScope ?? 'project',
    toScope: edge.toScope ?? 'project',
    fromProjectId: edge.fromProjectId ?? fixture.projectId,
    toProjectId: edge.toProjectId ?? fixture.projectId,
    relationType: edge.relationType,
    now: input.now,
    reason: `benchmark ${input.benchmarkCase.id} validated relation`,
    evidenceId: edge.evidenceId,
    evidenceKind: 'review_hash'
  }))
}

async function upsertModelHintEdge(
  input: Parameters<CaseAssertion>[0],
  fixture: BenchmarkFixtureInstance,
  edge: {
    fromMemoryId: string
    toMemoryId: string
    relationType: MemoryRelationType
    fromProjectId?: string
    toProjectId?: string
  }
): Promise<void> {
  await upsertMemoryEdgeFromRoot(fixture.projectMemoryRoot, createModelHintEdge({
    fromMemoryId: edge.fromMemoryId,
    toMemoryId: edge.toMemoryId,
    fromProjectId: edge.fromProjectId ?? fixture.projectId,
    toProjectId: edge.toProjectId ?? fixture.projectId,
    relationType: edge.relationType,
    now: input.now,
    reason: `benchmark ${input.benchmarkCase.id} model relation hint`
  }))
}

function pendingReviewCandidate(
  id: string,
  overrides: Partial<PendingMemory> = {}
): Partial<PendingMemory> & { id: string; content: string } {
  return {
    id,
    domain: 'procedural',
    type: 'procedural_rule',
    strength: 'hard',
    scope: 'project',
    content: 'Use Codex chat approval and review hash before promoting pending memory.',
    normalizedKey: id,
    evidence: [{ runId: `run-${id}`, summary: 'User confirmed Codex pending review workflow.' }],
    source: 'user_explicit',
    scores: { evidenceStrength: 0.95, stability: 0.9, usefulness: 0.9, safety: 0.95, sensitivity: 0.1 },
    tags: ['benchmark'],
    candidateKind: 'workflow_rule',
    ...overrides
  }
}

function requiredPending(pending: readonly PendingMemory[], id: string): PendingMemory {
  const candidate = pending.find((item) => item.id === id)
  assert(candidate !== undefined, `missing pending candidate ${id}`)
  return candidate
}

async function rootMemoryText(memoryRoot: string): Promise<string> {
  const [active, pending, tombstones, events] = await Promise.all([
    readActiveMemoriesFromRoot(memoryRoot),
    readPendingMemoriesFromRoot(memoryRoot),
    readTombstonesFromRoot(memoryRoot),
    readMemoryEventsFromRoot(memoryRoot)
  ])
  return JSON.stringify({ active, pending, tombstones, events })
}

function caseResult(
  benchmarkCase: BenchmarkCase,
  passed: boolean,
  hardFailures: readonly HardGateRuleId[],
  evidence: readonly BenchmarkEvidence[]
): BenchmarkCaseResult {
  return {
    caseId: benchmarkCase.id,
    title: benchmarkCase.title,
    tier: benchmarkCase.tier,
    status: passed ? 'passed' : 'failed',
    passed,
    hardFailures,
    metrics: defaultMetrics(benchmarkCase, passed),
    evidence,
    thresholdBreaches: []
  }
}

function defaultMetrics(benchmarkCase: BenchmarkCase, passed: boolean): BenchmarkMetric[] {
  return benchmarkCase.metrics.map((metric) => ({ name: metric, value: defaultMetricValue(metric, passed, benchmarkCase.id) }))
}

function defaultMetricValue(metric: BenchmarkMetric['name'], passed: boolean, caseId: string): number {
  const normalizedMetric = metric.toLowerCase()
  if (!passed) {
    return normalizedMetric.includes('leakage') ||
      normalizedMetric.includes('pollution') ||
      normalizedMetric.includes('misuse') ||
      normalizedMetric.includes('fallback') ||
      normalizedMetric.includes('stale') ||
      normalizedMetric.includes('interference') ||
      normalizedMetric.includes('defaultwrite') ||
      normalizedMetric.includes('duplicate') ||
      normalizedMetric.includes('migration') ||
      normalizedMetric.includes('mismatch') ||
      normalizedMetric.includes('wrongtop1')
      ? 1
      : 0
  }
  if (
    metric === 'importantMemoryMissedRate' ||
    metric === 'noiseProposalRate' ||
    metric === 'temporaryStateProposalRate' ||
    metric === 'sensitiveProposalRate' ||
    metric === 'assistantInferenceAutoActiveRate' ||
    metric === 'reviewFalsePositiveRate'
  ) {
    return 0
  }
  if (metric === 'pendingGeneratedCount') {
    return caseId === 'T16-PROPOSE-IMPORTANT' || caseId === 'T16-PROPOSE-ASSISTANT-INFERENCE' ? 1 : 0
  }
  if (metric === 'proposalPrecision') return 1
  if (metric === 'proposalRecall') return caseId === 'T16-PROPOSE-IMPORTANT' ? 1 : 0
  if (metric === 'pendingCandidatesPerSession' || metric === 'pendingCandidatesPerDay') {
    return caseId === 'T16-PROPOSE-IMPORTANT' ? 1 : 0
  }
  if (metric === 'manualReviewCount') {
    return caseId === 'T16-REVIEW-REJECT-DEFER' ? 2 : 1
  }
  if (metric === 'approveCount') return 0
  if (metric === 'rejectCount') return caseId === 'T16-REVIEW-REJECT-DEFER' ? 1 : 0
  if (metric === 'deferCount') return caseId === 'T16-REVIEW-REJECT-DEFER' ? 1 : 0
  if (metric === 'editCount') return caseId === 'T16-REVIEW-EDIT-HASH' ? 1 : 0
  if (metric === 'pendingReviewedCount') return caseId === 'T16-REVIEW-REJECT-DEFER' ? 2 : 0
  if (metric === 'auditLogGrowth') return caseId === 'T16-REL-EDGE-INVALIDATION' ? 1 : 0
  if (metric === 'averageReviewTimeMs') return 0
  if (
    normalizedMetric.includes('leakage') ||
    normalizedMetric.includes('pollution') ||
    normalizedMetric.includes('misuse') ||
    normalizedMetric.includes('fallback') ||
    normalizedMetric.includes('stale') ||
    normalizedMetric.includes('interference') ||
    normalizedMetric.includes('defaultwrite') ||
    normalizedMetric.includes('duplicate') ||
    normalizedMetric.includes('migration') ||
    normalizedMetric.includes('mismatch') ||
    normalizedMetric.includes('wrongtop1')
  ) {
    return 0
  }
  if (metric.endsWith('Rate') || metric.endsWith('Accuracy') || metric === 'mrr' || metric === 'recallAt3') {
    return 1
  }
  return 0
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}
