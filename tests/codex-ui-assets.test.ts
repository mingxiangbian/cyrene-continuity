import { readFile } from 'node:fs/promises'
import { Script, createContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

async function loadAppHelpers(): Promise<Record<string, (input: unknown) => unknown>> {
  const source = await readFile(new URL('../src/ui/static/app.js', import.meta.url), 'utf8')
  const executableSource = source.replace(/\nexport \{ TABS, WRITE_ACTION_COPY, escapeHtml \}\s*$/, '\n')
  const context = createContext({
    document: { querySelector: () => null }
  })
  new Script(`
${executableSource}
globalThis.__helpers = {
  renderPendingDetail,
  renderUseBoundariesSection,
  sourceOfTruthForWorkflow,
  workflowEvidenceForCandidate,
  formatWorkflowValue,
  formatWorkflowList
}
`, { filename: 'src/ui/static/app.js' }).runInContext(context)
  return (context as { __helpers: Record<string, (input: unknown) => unknown> }).__helpers
}

describe('Codex UI source assets', () => {
  it('includes triage and retrieval explain UI surfaces', async () => {
    const [source, css] = await Promise.all([
      readFile(new URL('../src/ui/static/app.js', import.meta.url), 'utf8'),
      readFile(new URL('../src/ui/static/styles.css', import.meta.url), 'utf8')
    ])

    expect(source).toContain("{ id: 'tools', label: 'Tools' }")
    expect(source).toContain('renderTools')
    expect(source).toContain('Run triage dry-run')
    expect(source).toContain('preview only')
    expect(source).toContain('Retrieval Explain')
    expect(source).toContain('/api/memory/triage/dry-run')
    expect(source).toContain('renderRetrievalPlan')
    expect(source).toContain('renderRetrievalReasons')
    expect(source).not.toContain('data-triage-apply')
    expect(css).toContain('.triage-grid')
    expect(css).toContain('.explain-list')
  })

  it('renders semantic memory review detail without raw evidence summaries', async () => {
    const source = await readFile(new URL('../src/ui/static/app.js', import.meta.url), 'utf8')
    const pendingDetailStart = source.indexOf('function renderPendingDetail(candidate)')
    const confirmFormStart = source.indexOf('function renderConfirmForm(candidate, action)')
    const pendingDetail = source.slice(pendingDetailStart, confirmFormStart)
    const useBoundariesStart = source.indexOf('function renderUseBoundariesSection(candidate)')
    const reviewActionStart = source.indexOf('function renderReviewActionSection(candidate)')
    const useBoundariesSection = source.slice(useBoundariesStart, reviewActionStart)
    const workflowItemStart = source.indexOf('function renderWorkflowItem(label, value)')
    const workflowEvidenceStart = source.indexOf('function workflowEvidenceForCandidate(candidate)')
    const workflowItem = source.slice(workflowItemStart, workflowEvidenceStart)

    expect(pendingDetailStart).toBeGreaterThanOrEqual(0)
    expect(confirmFormStart).toBeGreaterThan(pendingDetailStart)
    expect(pendingDetail).toContain('renderProposedSemanticMemorySection(candidate)')
    expect(pendingDetail).toContain('renderEpisodeEvidenceSection(candidate)')
    expect(pendingDetail).toContain('renderAdmissionRoutingSection(candidate)')
    expect(pendingDetail).toContain('renderUpdatePolicySection(candidate)')
    expect(pendingDetail).toContain('renderUseBoundariesSection(candidate)')
    expect(pendingDetail).toContain('renderReviewActionSection(candidate)')
    expect(pendingDetail).toContain('Review Action')
    expect(source).toContain('Proposed Semantic Memory')
    expect(source).toContain('Episode Evidence')
    expect(source).toContain('Admission / Routing Decision')
    expect(source).toContain('Update Policy')
    expect(useBoundariesStart).toBeGreaterThanOrEqual(0)
    expect(reviewActionStart).toBeGreaterThan(useBoundariesStart)
    expect(useBoundariesSection).toContain("renderWorkflowSection('Use Boundaries'")
    expect(useBoundariesSection).not.toContain("renderWorkflowSection('Use boundaries'")
    expect(source).toContain('Source of truth')
    expect(source).toContain('Evidence ref')
    expect(source).toContain('Routing reasons')
    expect(workflowItem).toContain('formatWorkflowValue(value)')
    expect(pendingDetail).not.toContain('renderSemanticReviewCard(candidate, { compact: false })')
    expect(pendingDetail).not.toContain('renderEvidence')
    expect(pendingDetail).not.toContain('evidenceSummary')
    expect(source).not.toContain('function renderEvidence(candidate)')
  })

  it('renders workflow detail fallbacks for legacy candidates', async () => {
    const helpers = await loadAppHelpers()
    const legacyCandidate = {
      id: 'legacy-1',
      content: 'Legacy pending memory',
      candidateKind: 'project_fact',
      domain: 'project',
      scope: 'project',
      normalizedKey: 'legacy-normalized-key',
      reviewHash: 'abcdef1234567890'
    }

    const detail = String(helpers.renderPendingDetail(legacyCandidate))

    expect(helpers.sourceOfTruthForWorkflow({
      semanticMemory: { sourceOfTruth: 'semantic-source' },
      proposedSemanticMemory: { sourceOfTruth: 'proposed-source' },
      sourceOfTruth: 'candidate-source',
      normalizedKey: 'normalized-key'
    })).toBe('semantic-source')
    expect(helpers.sourceOfTruthForWorkflow({
      proposedSemanticMemory: { sourceOfTruth: 'proposed-source' },
      normalizedKey: 'normalized-key'
    })).toBe('proposed-source')
    expect(helpers.sourceOfTruthForWorkflow(legacyCandidate)).toBeUndefined()
    expect(detail).toContain('<h3>Use Boundaries</h3>')
    expect(detail).not.toContain('<h3>Use boundaries</h3>')
    expect(detail).toMatch(/<strong>Source of truth<\/strong>\s*<span>missing<\/span>/)
    expect(detail).not.toMatch(/<strong>Source of truth<\/strong>\s*<span>legacy-normalized-key<\/span>/)
    expect(detail).toMatch(/<strong>Evidence ref<\/strong>\s*<span>missing<\/span>/)
    expect(detail).toMatch(/<strong>What happened<\/strong>\s*<span>missing<\/span>/)
    expect(detail).toMatch(/<strong>Routing reasons<\/strong>\s*<span>missing<\/span>/)
    expect(detail).toMatch(/<strong>Use when<\/strong>\s*<span>missing<\/span>/)
    expect(detail).toMatch(/<strong>Do not use when<\/strong>\s*<span>missing<\/span>/)
  })

  it('renders semantic review sections in pending rows and detail rail', async () => {
    const source = await readFile(new URL('../src/ui/static/app.js', import.meta.url), 'utf8')

    expect(source).toContain('renderSemanticReviewCard')
    expect(source).toContain('renderSemanticReviewCard(candidate, { selected, compact: true })')
    expect(source).toContain('semanticMemoryForCandidate')
    expect(source).toContain('Review policy')
    expect(source).toContain('Review hash')
    expect(source).toContain('What happened')
  })

  it('contains the Warm Cream Coral console shell and write-confirm review labels', async () => {
    const [html, js, css] = await Promise.all([
      readFile(new URL('../src/ui/static/index.html', import.meta.url), 'utf8'),
      readFile(new URL('../src/ui/static/app.js', import.meta.url), 'utf8'),
      readFile(new URL('../src/ui/static/styles.css', import.meta.url), 'utf8')
    ])

    expect(html).toContain('Cyrene Memory Console')

    for (const label of ['Overview', 'Manual Review', 'Timeline', 'Lifecycle Memory', 'Automation', 'Tools', 'Profile']) {
      expect(js).toContain(label)
    }
    expect(js).toContain('Manual review actions require confirmation and review hash')
    expect(js).toContain('No manual review memory was written')
    expect(js).toContain('Trial')
    expect(js).toContain('Validated')
    expect(js).toContain('Project Core')
    expect(js).toContain('Global Core')
    expect(js).toContain('Daily 15:00')
    expect(js).toContain('Weekly Sun 15:00')
    expect(js).toContain('Automation status')
    expect(js).not.toContain('Dream status')
    expect(js).not.toContain('Needs Tier')
    expect(js).not.toContain('Needs Tier Review')
    expect(js).toContain('/api/session')
    expect(js).toContain('x-cyrene-ui-token')
    expect(js).toContain('selectedPendingId')
    expect(js).toContain('pendingAction')
    expect(js).toContain('renderPendingDetail')
    expect(js).toContain('Confirm approve')
    expect(js).toContain('Confirm reject')
    expect(js).toContain('Confirm defer')
    expect(js).toContain('Confirm edit')
    expect(js).toContain('changeNote')
    expect(js).toContain('reviewHash')
    expect(js).toContain('decision receipt')
    expect(js).not.toContain('Approve selected')
    expect(js).toContain('Reject selected')
    expect(js).toContain('Reject all in view')
    expect(js).toContain('/api/memory/harvest-project/dry-run')
    expect(js).toContain('/api/active-memory/')
    expect(js).toContain('data-active-action="archive"')
    expect(js).toContain('data-active-action="tombstone"')
    expect(js).toContain('data-active-action="propose-edit"')
    expect(js).toContain('confirmText')
    expect(js).toContain('lifecycle memory receipt')
    expect(js).toContain('/delete-memory')
    expect(js).toContain('Delete & disable project memory')
    expect(js).toContain('confirmProjectId')
    expect(js).toContain("result.action === 'needs_model_config'")
    expect(js).toContain('Apply safe triage')
    expect(js).toContain("result.action === 'noop'")
    expect(js).toContain("typeof result.reason === 'string'")
    expect(js).toContain('result.reason.trim()')
    expect(js).toContain('No preview candidates were produced.')
    expect(js).toContain('renderPreviewCandidateRow')
    expect(js).toContain('dry-run preview')
    expect(js).toContain('preview · dry-run only')
    expect(js).toContain("['project', 'global']")
    expect(js).not.toContain("{ id: 'inbox', label: 'Review Queue' }")
    expect(js).not.toContain("{ id: 'project-memory', label: 'Project Memory' }")

    for (const unsafeRoute of [
      'deep-apply',
      'profile apply'
    ]) {
      expect(js).not.toContain(unsafeRoute)
    }

    for (const token of [
      '--canvas: #f4efe7',
      '--coral: #cc785c',
      '--teal: #5db8a6',
      '--amber: #d4a017',
      '--red: #c64545'
    ]) {
      expect(css).toContain(token)
    }
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain(':focus-visible')

    for (const className of [
      '.soft-panel',
      '.soft-inset',
      '.soft-button',
      '.status-chip',
      '.selectable-row',
      '.detail-actions',
      '.confirm-form',
      '.receipt-panel',
      '.active-action-form'
    ]) {
      expect(css).toContain(className)
    }
  })
})
