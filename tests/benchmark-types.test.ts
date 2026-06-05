import { describe, expect, it } from 'vitest'
import { BENCHMARK_CASES, BENCHMARK_CASE_IDS } from '../benchmark/catalog.js'
import { HARD_GATE_RULE_IDS, SOFT_METRIC_THRESHOLDS } from '../benchmark/thresholds.js'
import { BENCHMARK_METRIC_IDS, EXECUTION_PROFILES } from '../benchmark/types.js'

const requiredCaseIds = [
  'T0-MODE-FAST',
  'T0-MODE-BALANCED',
  'T0-MODE-REVIEW',
  'T0-PENDING-BOUNDARY',
  'T0-SIMILAR-BOUNDARY',
  'T0-SESSION-HINTS',
  'T0-ACTIVATION-RETRIEVED',
  'T0-SQLITE-HOT-PATH',
  'T0-SURFACE-CONSISTENCY',
  'T1-FACT-EXTRACTION',
  'T1-MULTI-SESSION-REASONING',
  'T1-TEMPORAL-ORDER',
  'T1-KNOWLEDGE-UPDATE',
  'T1-CONFLICT-HANDLING',
  'T1-ABSTAIN-NO-EVIDENCE',
  'T1-EVENT-SUMMARY',
  'T15-UPGRADE',
  'T15-REPLACE',
  'T15-MERGE',
  'T15-EXPIRE',
  'T15-SUPERSEDE-HASH',
  'T15-CONFLICT-SINGLE-INJECTION',
  'T16-PROPOSE-IMPORTANT',
  'T16-PROPOSE-NOISE',
  'T16-PROPOSE-SENSITIVE',
  'T16-PROPOSE-ASSISTANT-INFERENCE',
  'T16-ROUTING-NAMESPACE',
  'T16-REVIEW-HASH-REQUIRED',
  'T16-REVIEW-STALE-HASH',
  'T16-REVIEW-REJECT-DEFER',
  'T16-REVIEW-EDIT-HASH',
  'T2-REMEMBER-TEST-COMMAND',
  'T2-AVOID-REJECTED-APPROACH',
  'T2-FOLLOW-WORKFLOW',
  'T2-UPDATED-RULE',
  'T2-CROSS-SESSION-FIX',
  'T2-REDUCE-REPEAT-MISTAKE',
  'T3-S-SCALE',
  'T3-M-SCALE',
  'T3-L-SCALE',
  'T3-XL-SCALE',
  'T3-RANKING',
  'T3-TOKEN-OVERHEAD',
  'T3-LATENCY',
  'T3-INDEX-HEALTH',
  'T4-SQLITE-UNAVAILABLE',
  'T4-JSONL-CORRUPT',
  'T4-PROFILE-MISSING',
  'T4-FAST-SUMMARY-MISSING-STALE',
  'T4-SESSION-HINTS-EXPIRED',
  'T4-MCP-ERROR',
  'T4-AUTOMATION-INTERRUPT',
  'T4-HOOK-LIGHTWEIGHT',
  'T4-HOOK-TIMEOUT',
  'T4-SECURITY-SECRETS',
  'T4-SECURITY-PROMPT-INJECTION',
  'T4-SECURITY-GLOBAL-WRITE'
] as const

describe('benchmark contract catalog', () => {
  it('declares every case from the spec exactly once', () => {
    expect([...BENCHMARK_CASE_IDS].sort()).toEqual([...requiredCaseIds].sort())
    expect(new Set(BENCHMARK_CASE_IDS).size).toBe(BENCHMARK_CASE_IDS.length)
    expect(Object.isFrozen(BENCHMARK_CASE_IDS)).toBe(true)
  })

  it('declares complete case contract fields for every case', () => {
    for (const benchmarkCase of BENCHMARK_CASES) {
      expect(benchmarkCase.title).not.toBe('')
      expect(benchmarkCase.executionProfiles.length).toBeGreaterThan(0)
      expect(benchmarkCase.fixture).toMatchObject({
        isolation: expect.any(String),
        seed: expect.any(String),
        now: expect.any(String),
        timezone: 'UTC',
        groundTruth: expect.any(Array),
        expectedContext: expect.any(Array),
        expectedForbiddenContent: expect.any(Array),
        expectedMetrics: expect.any(Array),
        passFailRule: expect.any(Array)
      })
      expect(benchmarkCase.action.kind).toMatch(/direct|cli|mcp|replay|adapter/)
      expect(benchmarkCase.expected.length).toBeGreaterThan(0)
      expect(benchmarkCase.forbidden.length).toBeGreaterThan(0)
      expect(benchmarkCase.metrics.length).toBeGreaterThan(0)
      expect(benchmarkCase.passFail.length).toBeGreaterThan(0)
    }
  })

  it('keeps smoke profile non-empty and deterministic', () => {
    const smokeCases = BENCHMARK_CASES.filter((item) => item.executionProfiles.includes('smoke'))
    expect(smokeCases.map((item) => item.id).sort()).toEqual([
      'T0-MODE-FAST',
      'T0-PENDING-BOUNDARY',
      'T0-SQLITE-HOT-PATH',
      'T16-ROUTING-NAMESPACE'
    ].sort())
    expect(smokeCases.every((item) => item.adapter === undefined || item.adapter.kind === 'deterministic')).toBe(true)
  })

  it('keeps gate profile aligned with release-gate case contract', () => {
    const byId = new Map(BENCHMARK_CASES.map((item) => [item.id, item]))
    const requiredGateCaseIds = [
      'T16-PROPOSE-IMPORTANT',
      'T16-PROPOSE-NOISE',
      'T16-PROPOSE-SENSITIVE',
      'T16-PROPOSE-ASSISTANT-INFERENCE',
      'T16-ROUTING-NAMESPACE',
      'T16-REVIEW-HASH-REQUIRED',
      'T16-REVIEW-STALE-HASH',
      'T16-REVIEW-REJECT-DEFER',
      'T16-REVIEW-EDIT-HASH',
      'T4-HOOK-LIGHTWEIGHT',
      'T4-SECURITY-SECRETS',
      'T4-SECURITY-PROMPT-INJECTION',
      'T4-SECURITY-GLOBAL-WRITE'
    ]

    for (const caseId of requiredGateCaseIds) {
      expect(byId.get(caseId)?.executionProfiles).toContain('gate')
    }
  })

  it('does not use synthesized default expected or forbidden catalog content', () => {
    for (const benchmarkCase of BENCHMARK_CASES) {
      expect(benchmarkCase.expected.join('\n')).not.toMatch(/T\d+.* expected context/)
      expect(benchmarkCase.forbidden.join('\n')).not.toMatch(/T\d+.* forbidden context/)
    }
  })

  it('declares T2 utility thresholds as pass/fail rules for the repeat mistake case', () => {
    const repeatMistakeCase = BENCHMARK_CASES.find((item) => item.id === 'T2-REDUCE-REPEAT-MISTAKE')
    expect(repeatMistakeCase?.passFail).toEqual(expect.arrayContaining([
      'withMemoryTaskSuccessRate',
      'repeatedMistakeReduction',
      'userCorrectionReduction',
      'toolCallReduction'
    ]))
  })

  it('makes hook latency threshold a release-gate failure for the lightweight hook case', () => {
    const hookCase = BENCHMARK_CASES.find((item) => item.id === 'T4-HOOK-LIGHTWEIGHT')
    expect(hookCase?.metrics).toContain('postToolUseHookP95Ms')
    expect(hookCase?.passFail).toContain('postToolUseHookP95Ms')
  })

  it('defines all execution profiles and centralized thresholds', () => {
    expect(EXECUTION_PROFILES).toEqual(['smoke', 'gate', 'full', 'scale', 'llm', 'external'])
    expect(SOFT_METRIC_THRESHOLDS.map((item) => item.metric)).toEqual(expect.arrayContaining([
      'fastTokenOverhead',
      'continuityGetP95FastMs',
      'sqliteHitRateFreshIndex',
      'jsonlFallbackRateHotPath',
      'recallAt3',
      'mrr',
      'scaleXLRuntimeMs',
      'withMemoryTaskSuccessRate'
    ]))
    expect(HARD_GATE_RULE_IDS).toEqual(expect.arrayContaining([
      'fixture_isolation_violation',
      'pending_leakage',
      'cross_project_pollution',
      'real_user_memory_read_write',
      'cross_case_mutable_state_reuse',
      'unauthorized_promotion',
      'secret_persistence',
      'prompt_injection_memory_write',
      'wrong_namespace_routing',
      'hash_bypass',
      'retrieved_default_write',
      'hot_path_rebuild'
    ]))
  })

  it('keeps catalog metrics and threshold metrics on one vocabulary', () => {
    const metricVocabulary = new Set(BENCHMARK_METRIC_IDS)
    const catalogMetrics = new Set(BENCHMARK_CASES.flatMap((item) => item.metrics))

    for (const threshold of SOFT_METRIC_THRESHOLDS) {
      expect(metricVocabulary.has(threshold.metric)).toBe(true)
      expect(catalogMetrics.has(threshold.metric)).toBe(true)
    }
  })
})
