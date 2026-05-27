import type { ProjectMetadata, ProjectSimilarity } from './memory-index.js'

export interface ProjectSimilarityScore extends ProjectSimilarity {}

export function scoreProjectSimilarity(source: ProjectMetadata, target: ProjectMetadata): ProjectSimilarityScore {
  const reason: string[] = []
  let score = 0

  if (source.packageManager === target.packageManager) {
    score += 0.12
    reason.push(`package_manager:${source.packageManager}`)
  }
  score += overlapScore('language', source.languages, target.languages, 0.18, reason)
  score += overlapScore('framework', source.frameworks, target.frameworks, 0.28, reason)
  score += overlapScore('dependency', source.dependencyNames, target.dependencyNames, 0.26, reason)
  score += overlapScore('domain', source.domainTags, target.domainTags, 0.16, reason)

  return {
    sourceProjectId: source.projectId,
    targetProjectId: target.projectId,
    score: Math.min(1, Number(score.toFixed(4))),
    reason,
    updatedAt: source.updatedAt
  }
}

export function selectSimilarProjects(input: {
  source: ProjectMetadata
  candidates: ProjectMetadata[]
  minScore: number
  maxProjects: number
  now: string
}): ProjectSimilarityScore[] {
  return input.candidates
    .filter((candidate) => candidate.projectId !== input.source.projectId)
    .map((candidate) => ({
      ...scoreProjectSimilarity(input.source, candidate),
      updatedAt: input.now
    }))
    .filter((score) => score.score >= input.minScore)
    .sort((left, right) => {
      const scoreDiff = right.score - left.score
      if (scoreDiff !== 0) return scoreDiff
      return left.targetProjectId.localeCompare(right.targetProjectId)
    })
    .slice(0, input.maxProjects)
}

function overlapScore(
  label: string,
  sourceValues: string[],
  targetValues: string[],
  weight: number,
  reason: string[]
): number {
  const sourceSet = new Set(sourceValues)
  const targetSet = new Set(targetValues)
  const matches = Array.from(sourceSet).filter((value) => targetSet.has(value)).sort()
  for (const value of matches.slice(0, 5)) {
    reason.push(`${label}:${value}`)
  }
  const denominator = Math.max(sourceSet.size, targetSet.size, 1)
  return (matches.length / denominator) * weight
}
