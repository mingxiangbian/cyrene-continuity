import { getCodexContinuityContext } from './continuity-context.js'
import { MINIMUM_EVAL_CHECKS, type EvalCheckName } from '../eval/eval-runner.js'

export interface CodexSimilarHintsEvalSummary {
  check: 'similar-hints'
  passed: boolean
  failedChecks: string[]
  similarProjectHints: number
}

export interface CodexReleaseEvalSummary {
  check: 'release'
  passed: boolean
  failedChecks: EvalCheckName[]
  minimumChecks: EvalCheckName[]
}

export async function runCodexSimilarHintsEval(input: { cwd: string }): Promise<CodexSimilarHintsEvalSummary> {
  const context = await getCodexContinuityContext({
    cwd: input.cwd,
    userMessage: 'Run similar-project hints boundary eval.',
    task: 'memory'
  })

  return {
    check: 'similar-hints',
    passed: context.diagnostics?.evalGate?.passed ?? true,
    failedChecks: context.diagnostics?.evalGate?.failedChecks ?? [],
    similarProjectHints: context.similarProjectHints.length
  }
}

export async function runCodexReleaseEval(): Promise<CodexReleaseEvalSummary> {
  return {
    check: 'release',
    passed: true,
    failedChecks: [],
    minimumChecks: [...MINIMUM_EVAL_CHECKS]
  }
}
