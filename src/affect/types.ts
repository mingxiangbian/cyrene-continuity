export interface ResponseStrategy {
  tone: string
  verbosity: string
  challenge: string
  boundaryMode: string
  safetyMode: string
  shouldChallengeUser: boolean
  shouldAskClarifyingQuestion: boolean
  rationale: string
}

export interface PrincipledDissentPolicy {
  shouldChallenge: boolean
  mode: string
  reason: string
}
