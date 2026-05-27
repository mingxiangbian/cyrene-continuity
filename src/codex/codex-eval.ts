import { getCodexContinuityContext } from './continuity-context.js'

export interface CodexSimilarHintsEvalSummary {
  check: 'similar-hints'
  passed: boolean
  failedChecks: string[]
  similarProjectHints: number
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
