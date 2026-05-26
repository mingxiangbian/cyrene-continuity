import type { AppConfig } from '../config.js'
import type { CyreneMemory } from '../memory/types.js'
import type { PrincipledDissentPolicy, ResponseStrategy } from './types.js'

export interface BuildContinuitySnapshotInput {
  config: AppConfig
  userMessage: string
  task: string
  memories: CyreneMemory[]
  generatedAt: string
}

export interface ContinuitySnapshot {
  strategy: ResponseStrategy
  dissent: PrincipledDissentPolicy
}

export async function buildContinuitySnapshot(input: BuildContinuitySnapshotInput): Promise<ContinuitySnapshot> {
  const shouldChallengeUser = shouldChallenge(input)
  const reason = shouldChallengeUser
    ? 'User request may conflict with active continuity memory or safety constraints.'
    : 'No direct conflict with active continuity memory was detected.'

  return {
    strategy: {
      tone: 'direct',
      verbosity: input.task === 'planning' ? 'structured' : 'concise',
      challenge: shouldChallengeUser ? 'direct' : 'normal',
      boundaryMode: 'standard',
      safetyMode: shouldChallengeUser ? 'elevated' : 'standard',
      shouldChallengeUser,
      shouldAskClarifyingQuestion: false,
      rationale: reason
    },
    dissent: {
      shouldChallenge: shouldChallengeUser,
      mode: shouldChallengeUser ? 'direct' : 'none',
      reason
    }
  }
}

function shouldChallenge(input: BuildContinuitySnapshotInput): boolean {
  const text = input.userMessage.toLowerCase()
  if (/\b(skip|bypass|ignore|disable)\b/.test(text) && /\b(validator|validation|safety|review|memory)\b/.test(text)) {
    return true
  }
  if (/\b(risky|unsafe)\b/.test(text)) {
    return true
  }
  return input.memories.some((memory) =>
    memory.strength === 'hard' && memory.content.toLowerCase().split(/\W+/).some((token) => token !== '' && text.includes(token))
  )
}
