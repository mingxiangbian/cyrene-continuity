import type { BenchmarkThreshold } from './types.js'
export { HARD_GATE_RULE_IDS } from './types.js'

export const BENCHMARK_VERSION = '1.0.0'
export const THRESHOLD_VERSION = '2026-06-05'

export const SOFT_METRIC_THRESHOLDS: BenchmarkThreshold[] = [
  { metric: 'fastTokenOverhead', operator: '<=', value: 800, profiles: ['smoke', 'gate', 'full'] },
  { metric: 'balancedTokenOverhead', operator: '<=', value: 1200, profiles: ['gate', 'full'] },
  { metric: 'reviewTokenOverhead', operator: '<=', value: 4000, profiles: ['full'] },
  { metric: 'continuityGetP95FastMs', operator: '<=', value: 300, profiles: ['smoke', 'gate', 'full'] },
  { metric: 'continuityGetP95BalancedMs', operator: '<=', value: 600, profiles: ['gate', 'full'] },
  { metric: 'continuityGetP95ReviewMs', operator: '<=', value: 1000, profiles: ['full'] },
  { metric: 'postToolUseHookP95Ms', operator: '<=', value: 100, profiles: ['gate', 'full'] },
  { metric: 'stopHookP95Ms', operator: '<=', value: 5000, profiles: ['full'] },
  { metric: 'sqliteQueryP95Ms', operator: '<=', value: 100, profiles: ['gate', 'full'] },
  { metric: 'sqliteHitRateFreshIndex', operator: '>=', value: 1, profiles: ['smoke', 'gate', 'full'] },
  { metric: 'jsonlFallbackRateHotPath', operator: '=', value: 0, profiles: ['smoke', 'gate', 'full'] },
  { metric: 'recallAt3', operator: '>=', value: 0.9, profiles: ['full', 'scale'] },
  { metric: 'mrr', operator: '>=', value: 0.8, profiles: ['full', 'scale'] },
  { metric: 'wrongTop1Rate', operator: '<=', value: 0.1, profiles: ['full', 'scale'] },
  { metric: 'irrelevantRetrievalRate', operator: '<=', value: 0.05, profiles: ['full', 'scale'] },
  { metric: 'scaleSRuntimeMs', operator: '<=', value: 30000, profiles: ['scale'] },
  { metric: 'scaleMRuntimeMs', operator: '<=', value: 120000, profiles: ['scale'] },
  { metric: 'scaleLRuntimeMs', operator: '<=', value: 600000, profiles: ['scale'] },
  { metric: 'scaleXLRuntimeMs', operator: '<=', value: 1800000, profiles: ['scale'] },
  { metric: 'memoryDbBytesPerMemory', operator: '<=', value: 8192, profiles: ['scale'] },
  { metric: 'withMemoryTaskSuccessRate', operator: '>=', value: 'noMemoryTaskSuccessRate', profiles: ['llm'] },
  { metric: 'repeatedMistakeReduction', operator: '>=', value: 0.3, profiles: ['llm'] },
  { metric: 'userCorrectionReduction', operator: '>=', value: 0.2, profiles: ['llm'] },
  { metric: 'toolCallReduction', operator: '>=', value: 0.1, profiles: ['llm'] }
]
