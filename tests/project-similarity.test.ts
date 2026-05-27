import { describe, expect, it } from 'vitest'
import { scoreProjectSimilarity, selectSimilarProjects } from '../src/memory/project-similarity.js'
import type { ProjectMetadata } from '../src/memory/memory-index.js'

function project(overrides: Partial<ProjectMetadata>): ProjectMetadata {
  return {
    projectId: 'project-a',
    displayName: 'project-a',
    packageManager: 'npm',
    languages: ['typescript'],
    frameworks: ['mcp', 'vitest'],
    dependencyNames: ['@modelcontextprotocol/sdk', 'typescript', 'vitest'],
    domainTags: ['mcp', 'codex-plugin'],
    updatedAt: '2026-05-27T00:00:00.000Z',
    ...overrides
  }
}

describe('project similarity scoring', () => {
  it('scores deterministic overlap and reports reasons', () => {
    const result = scoreProjectSimilarity(
      project({ projectId: 'source' }),
      project({
        projectId: 'target',
        frameworks: ['mcp'],
        dependencyNames: ['@modelcontextprotocol/sdk', 'zod'],
        domainTags: ['mcp']
      })
    )

    expect(result.targetProjectId).toBe('target')
    expect(result.score).toBeGreaterThan(0.4)
    expect(result.reason).toEqual(expect.arrayContaining([
      'package_manager:npm',
      'framework:mcp',
      'language:typescript',
      'domain:mcp'
    ]))
  })

  it('selects non-current projects above threshold by score', () => {
    const source = project({ projectId: 'source' })
    const selected = selectSimilarProjects({
      source,
      candidates: [
        project({ projectId: 'source' }),
        project({
          projectId: 'close',
          frameworks: ['mcp'],
          dependencyNames: ['@modelcontextprotocol/sdk'],
          domainTags: ['mcp']
        }),
        project({
          projectId: 'far',
          packageManager: 'pnpm',
          languages: ['python'],
          frameworks: [],
          dependencyNames: [],
          domainTags: []
        })
      ],
      minScore: 0.2,
      maxProjects: 3,
      now: '2026-05-27T00:00:00.000Z'
    })

    expect(selected.map((item) => item.targetProjectId)).toEqual(['close'])
    expect(selected[0]?.sourceProjectId).toBe('source')
  })
})
