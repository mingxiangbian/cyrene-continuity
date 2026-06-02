import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { getCodexUiStaticAsset, listCodexUiStaticAssetPaths } from '../src/codex/codex-ui-static.js'

describe('Codex UI static assets', () => {
  it('keeps generated asset bodies in sync with static source files', async () => {
    const [html, js, css] = await Promise.all([
      readFile(new URL('../src/ui/static/index.html', import.meta.url), 'utf8'),
      readFile(new URL('../src/ui/static/app.js', import.meta.url), 'utf8'),
      readFile(new URL('../src/ui/static/styles.css', import.meta.url), 'utf8')
    ])

    expect(getCodexUiStaticAsset('/')?.body).toBe(html)
    expect(getCodexUiStaticAsset('/app.js')?.body).toBe(js)
    expect(getCodexUiStaticAsset('/styles.css')?.body).toBe(css)
  })

  it('lists bundled static asset paths', () => {
    expect(listCodexUiStaticAssetPaths().sort()).toEqual(['/', '/app.js', '/styles.css'].sort())
  })

  it('returns static assets with content types', () => {
    expect(getCodexUiStaticAsset('/')?.contentType).toBe('text/html; charset=utf-8')
    expect(getCodexUiStaticAsset('/app.js')?.contentType).toBe('text/javascript; charset=utf-8')
    expect(getCodexUiStaticAsset('/styles.css')?.contentType).toBe('text/css; charset=utf-8')
  })

  it('returns undefined for missing static assets', () => {
    expect(getCodexUiStaticAsset('/missing')).toBeUndefined()
  })

  it('renders readable semantic memory review sections in the inbox bundle', async () => {
    const appSource = await readFile(new URL('../src/ui/static/app.js', import.meta.url), 'utf8')
    const pendingDetailStart = appSource.indexOf('function renderPendingDetail(candidate)')
    const confirmFormStart = appSource.indexOf('function renderConfirmForm(candidate, action)')
    const pendingDetail = appSource.slice(pendingDetailStart, confirmFormStart)
    const useBoundariesStart = appSource.indexOf('function renderUseBoundariesSection(candidate)')
    const reviewActionStart = appSource.indexOf('function renderReviewActionSection(candidate)')
    const useBoundariesSection = appSource.slice(useBoundariesStart, reviewActionStart)
    const sourceOfTruthStart = appSource.indexOf('function sourceOfTruthForWorkflow(candidate)')
    const firstPresentStart = appSource.indexOf('function firstPresent(...values)')
    const sourceOfTruthHelper = appSource.slice(sourceOfTruthStart, firstPresentStart)
    const workflowItemStart = appSource.indexOf('function renderWorkflowItem(label, value)')
    const workflowEvidenceStart = appSource.indexOf('function workflowEvidenceForCandidate(candidate)')
    const workflowItem = appSource.slice(workflowItemStart, workflowEvidenceStart)
    const workflowSectionStart = appSource.indexOf('function renderWorkflowSection(title, rows)')
    const workflowSection = appSource.slice(workflowSectionStart, workflowItemStart)
    const proposedMemoryStart = appSource.indexOf('function renderProposedSemanticMemorySection(candidate)')
    const episodeEvidenceStart = appSource.indexOf('function renderEpisodeEvidenceSection(candidate)')
    const proposedMemorySection = appSource.slice(proposedMemoryStart, episodeEvidenceStart)
    const admissionRoutingStart = appSource.indexOf('function renderAdmissionRoutingSection(candidate)')
    const episodeEvidenceSection = appSource.slice(episodeEvidenceStart, admissionRoutingStart)
    const updatePolicyStart = appSource.indexOf('function renderUpdatePolicySection(candidate)')
    const admissionRoutingSection = appSource.slice(admissionRoutingStart, updatePolicyStart)

    expect(pendingDetailStart).toBeGreaterThanOrEqual(0)
    expect(confirmFormStart).toBeGreaterThan(pendingDetailStart)
    expect(useBoundariesStart).toBeGreaterThanOrEqual(0)
    expect(reviewActionStart).toBeGreaterThan(useBoundariesStart)
    expect(sourceOfTruthStart).toBeGreaterThanOrEqual(0)
    expect(firstPresentStart).toBeGreaterThan(sourceOfTruthStart)
    expect(workflowSectionStart).toBeGreaterThanOrEqual(0)
    expect(workflowItemStart).toBeGreaterThanOrEqual(0)
    expect(workflowItemStart).toBeGreaterThan(workflowSectionStart)
    expect(workflowEvidenceStart).toBeGreaterThan(workflowItemStart)
    expect(proposedMemoryStart).toBeGreaterThanOrEqual(0)
    expect(episodeEvidenceStart).toBeGreaterThanOrEqual(0)
    expect(episodeEvidenceStart).toBeGreaterThan(proposedMemoryStart)
    expect(admissionRoutingStart).toBeGreaterThan(episodeEvidenceStart)
    expect(updatePolicyStart).toBeGreaterThan(admissionRoutingStart)
    expect(appSource).toContain('Proposed Semantic Memory')
    expect(appSource).toContain('Episode Evidence')
    expect(appSource).toContain('Admission / Routing Decision')
    expect(appSource).toContain('Review Action')
    expect(appSource).toContain('Update Policy')
    expect(appSource).toContain('Source of truth')
    expect(appSource).toContain('Evidence ref')
    expect(appSource).toContain('Routing reasons')
    expect(pendingDetail).toMatch(
      /renderProposedSemanticMemorySection\(candidate\)[\s\S]*renderEpisodeEvidenceSection\(candidate\)[\s\S]*renderAdmissionRoutingSection\(candidate\)[\s\S]*renderUpdatePolicySection\(candidate\)[\s\S]*renderUseBoundariesSection\(candidate\)[\s\S]*renderReviewActionSection\(candidate\)/
    )
    expect(useBoundariesSection).toContain("renderWorkflowSection('Use Boundaries'")
    expect(useBoundariesSection).not.toContain("renderWorkflowSection('Use boundaries'")
    expect(useBoundariesSection).toContain("['Use when', firstArrayWithValues(memory.useWhen, proposed.useWhen)]")
    expect(useBoundariesSection).toContain("['Do not use when', firstArrayWithValues(memory.doNotUseWhen, proposed.doNotUseWhen)]")
    expect(proposedMemorySection).toContain("['Source of truth', sourceOfTruthForWorkflow(candidate)]")
    expect(sourceOfTruthHelper).toContain('semanticMemoryForCandidate(candidate)')
    expect(sourceOfTruthHelper).toContain('memory.sourceOfTruth')
    expect(sourceOfTruthHelper).toContain('candidate.normalizedKey')
    expect(workflowSection).toContain('renderWorkflowItem(label, value)')
    expect(workflowItem).toContain('formatWorkflowValue(value)')
    expect(episodeEvidenceSection).toContain("['Evidence ref', evidence.evidenceRef]")
    expect(admissionRoutingSection).toContain("['Routing reasons', routing.reasons]")
    expect(pendingDetail).not.toContain('renderSemanticReviewCard(candidate, { compact: false })')
  })

  it('bundles expected initial UI content', () => {
    const html = getCodexUiStaticAsset('/')?.body

    expect(html).toContain('Cyrene Memory Console')
    expect(html).toContain('href="/styles.css"')
    expect(html).toContain('src="/app.js"')
    expect(html).toContain('data-app')
    expect(html).toContain('class="sidebar"')
    expect(html).toContain('class="main-shell"')
    expect(html).toContain('class="detail-rail"')
    expect(getCodexUiStaticAsset('/app.js')?.body).toContain('Write actions require confirmation and review hash')
    expect(getCodexUiStaticAsset('/styles.css')?.body).toContain('--coral: #cc785c')
    expect(getCodexUiStaticAsset('/styles.css')?.body).toContain('--canvas: #f4efe7')
  })

  it('bundles the distillation dry-run UI surface', () => {
    const js = getCodexUiStaticAsset('/app.js')?.body

    expect(js).toContain('data-memory-distill-dry-run')
    expect(js).toContain('renderDistillCandidates')
  })

  it('wires static asset generation into plugin build', async () => {
    const buildScript = await readFile('scripts/build-plugin.mjs', 'utf8')
    const generatedSource = await readFile('src/codex/codex-ui-static.generated.ts', 'utf8')

    expect(buildScript).toContain('generate-ui-static.mjs')
    expect(generatedSource).toContain('Generated by scripts/generate-ui-static.mjs')
  })
})
