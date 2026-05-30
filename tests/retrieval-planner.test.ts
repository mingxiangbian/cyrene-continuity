import { describe, expect, it } from 'vitest'
import { buildRetrievalPlan, explainRetrievalReasons } from '../src/codex/retrieval-planner.js'

describe('retrieval planner', () => {
  it('detects memory review UI intent and excludes affective domains', () => {
    const plan = buildRetrievalPlan({
      query: 'active memory delete button does not work in Web UI',
      task: 'memory'
    })

    expect(plan.taskIntent).toEqual(expect.arrayContaining(['memory_review', 'ui']))
    expect(plan.memoryKinds).toEqual(expect.arrayContaining(['workflow_rule', 'known_pitfall']))
    expect(plan.requiredFacets).toEqual(expect.arrayContaining(['exact_project', 'memory_kind', 'evidence']))
    expect(plan.optionalFacets).toEqual(expect.arrayContaining(['graph_edges', 'transferability']))
    expect(plan.excludeDomains).toEqual(expect.arrayContaining(['affective', 'relationship']))
  })

  it('explains retrieval reasons from matched facets and edges', () => {
    const reasons = explainRetrievalReasons({
      exactProject: true,
      memoryKind: 'workflow_rule',
      edgeTypes: ['memory_about_route'],
      score: 0.91
    })

    expect(reasons).toEqual(['exact_project', 'memory_kind:workflow_rule', 'edge:memory_about_route'])
  })
})
