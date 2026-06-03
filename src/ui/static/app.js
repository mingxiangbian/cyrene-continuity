const WRITE_ACTION_COPY = 'Manual review actions require confirmation and review hash.'
const SESSION_ENDPOINT = '/api/session'
const DRY_RUN_ENDPOINT = '/api/memory/harvest-project/dry-run'
const TRIAGE_DRY_RUN_ENDPOINT = '/api/memory/triage/dry-run'
const TRIAGE_APPLY_ENDPOINT = '/api/memory/triage/apply'
const PREPARE_DRY_RUN_ENDPOINT = '/api/memory/prepare/dry-run'
const PREPARE_APPLY_ENDPOINT = '/api/memory/prepare/apply'
const DISTILL_DRY_RUN_ENDPOINT = '/api/memory/distill/dry-run'
const BATCH_REJECT_ENDPOINT = '/api/memory/pending/reject-batch'
const EMPTY_DASHBOARD = {
  status: {},
  diagnostics: {},
  selection: { scope: 'project', label: 'Project', projectId: '' },
  projects: { projects: [], global: { counts: {} }, currentProjectId: '' },
  modelConfig: { configured: false, missing: [] },
  pending: { pending: [], total: 0, project: {} },
  active: { active: [], project: {} },
  reviewSummaries: { summaries: [] },
  projectMemory: { groups: [] },
  dream: { dream: {} },
  profile: { profile: '' },
  signals: { signals: [] }
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'manual-review', label: 'Manual Review' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'lifecycle-memory', label: 'Lifecycle Memory' },
  { id: 'automation', label: 'Automation' },
  { id: 'tools', label: 'Tools' },
  { id: 'profile', label: 'Profile' }
]

const CONFIRM_LABELS = {
  approve: 'Confirm approve',
  reject: 'Confirm reject',
  defer: 'Confirm defer',
  edit: 'Confirm edit'
}

const MEMORY_SCOPES = ['project', 'global']

const state = {
  activeTab: 'overview',
  memoryScope: 'project',
  selectedProjectId: '',
  dashboard: EMPTY_DASHBOARD,
  error: '',
  sessionToken: '',
  selectedPendingId: '',
  selectedPendingIds: [],
  pendingAction: null,
  receipt: null,
  actionError: '',
  activeAction: null,
  activeReceipt: null,
  activeActionError: '',
  projectDelete: { confirming: false, loading: false, error: '', receipt: null },
  harvester: { loading: false, result: null, error: '' },
  triage: { loading: false, result: null, error: '', receipt: null },
  prepare: { loading: false, result: null, error: '' },
  distill: { loading: false, result: null, error: '' }
}

const app = document.querySelector('[data-app]')
const nav = document.querySelector('[data-nav]')
const topbar = document.querySelector('[data-topbar]')
const workspace = document.querySelector('[data-workspace]')
const detailRail = document.querySelector('[data-detail-rail]')

if (app && nav && topbar && workspace && detailRail) {
  app.dataset.ready = 'true'
  render()
  loadApp()
}

async function loadApp() {
  try {
    await loadSession()
  } catch (error) {
    state.error = errorMessage(error)
    render()
  }
  await loadDashboard()
}

async function loadSession() {
  const response = await fetch(SESSION_ENDPOINT, { headers: { accept: 'application/json' } })
  const payload = await response.json()
  if (!payload.ok) {
    throw new Error(payload.error?.message || 'Session API returned an error.')
  }
  state.sessionToken = payload.data?.token || ''
}

async function apiFetch(pathname, options = {}) {
  const method = options.method || 'GET'
  const headers = {
    accept: 'application/json',
    ...(options.headers || {})
  }
  if (method.toUpperCase() !== 'GET') {
    headers['content-type'] = 'application/json'
    headers['x-cyrene-ui-token'] = state.sessionToken
  }
  return fetch(pathname, { ...options, method, headers })
}

async function loadDashboard(options = {}) {
  const renderAfter = options.renderAfter !== false
  try {
    const response = await apiFetch(dashboardEndpoint())
    const payload = await response.json()
    if (!payload.ok) {
      throw new Error(payload.error?.message || 'Dashboard API returned an error.')
    }
    state.dashboard = mergeDashboard(payload.data)
    state.selectedPendingIds = state.selectedPendingIds.filter((id) =>
      listPending().some((candidate) => candidate.id === id)
    )
    if (!state.selectedProjectId) {
      state.selectedProjectId = state.dashboard.selection?.projectId || state.dashboard.projects?.currentProjectId || ''
    }
    state.error = ''
  } catch (error) {
    state.dashboard = EMPTY_DASHBOARD
    state.error = errorMessage(error)
  }
  if (renderAfter) render()
}

function dashboardEndpoint() {
  const params = new URLSearchParams()
  params.set('scope', state.memoryScope)
  if (state.selectedProjectId) params.set('projectId', state.selectedProjectId)
  return `/api/dashboard?${params.toString()}`
}

function mergeDashboard(data) {
  return {
    ...EMPTY_DASHBOARD,
    ...(data || {}),
    diagnostics: { ...EMPTY_DASHBOARD.diagnostics, ...(data?.diagnostics || {}) },
    selection: { ...EMPTY_DASHBOARD.selection, ...(data?.selection || {}) },
    projects: { ...EMPTY_DASHBOARD.projects, ...(data?.projects || {}) },
    modelConfig: { ...EMPTY_DASHBOARD.modelConfig, ...(data?.modelConfig || {}) },
    pending: { ...EMPTY_DASHBOARD.pending, ...(data?.pending || {}) },
    active: { ...EMPTY_DASHBOARD.active, ...(data?.active || {}) },
    reviewSummaries: { ...EMPTY_DASHBOARD.reviewSummaries, ...(data?.reviewSummaries || {}) },
    projectMemory: { ...EMPTY_DASHBOARD.projectMemory, ...(data?.projectMemory || {}) },
    dream: { ...EMPTY_DASHBOARD.dream, ...(data?.dream || {}) },
    profile: { ...EMPTY_DASHBOARD.profile, ...(data?.profile || {}) },
    signals: { ...EMPTY_DASHBOARD.signals, ...(data?.signals || {}) }
  }
}

function render() {
  renderNav()
  renderTopbar()
  renderWorkspace()
  renderDetailRail()
}

function renderNav() {
  nav.innerHTML = TABS.map((tab) => `
    <button class="nav-button" type="button" data-tab="${escapeHtml(tab.id)}" aria-current="${tab.id === state.activeTab ? 'page' : 'false'}">
      <span>${escapeHtml(tab.label)}</span>
    </button>
  `).join('')
  nav.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab || 'overview'
      state.pendingAction = null
      state.actionError = ''
      state.activeAction = null
      state.activeActionError = ''
      render()
    })
  })
}

function renderTopbar() {
  const dashboard = state.dashboard
  const selection = selectionInfo(dashboard)
  const pendingCount = listPending().length
  const status = dashboard.status || {}
  const sqliteStatus = text(status.index?.status || status.sqlite?.status || status.fallbackMode || 'read-only')
  const modelStatus = modelLabel(dashboard.modelConfig || status)
  const stopHook = text(status.lastStopHook?.status || status.stopHook?.status || 'visible')

  topbar.innerHTML = `
    <div>
      <p class="eyebrow">Local review console</p>
      <h2>${escapeHtml(selection.label || 'Memory')}</h2>
    </div>
    <div class="topbar-actions">
      ${renderScopeControls(dashboard)}
      <div class="chip-row" aria-label="Runtime status">
        ${selection.scope === 'global'
          ? statusChip('Scope', 'Global', 'muted')
          : statusChip('Project ID', shortHash(selection.projectId || 'unknown'), 'muted')}
        ${statusChip('Stop Hook', stopHook, stopHook === 'failed' ? 'error' : 'ok')}
        ${statusChip('Manual Review', String(pendingCount), pendingCount > 0 ? 'warn' : 'ok')}
        ${statusChip('SQLite', sqliteStatus, sqliteStatus === 'stale' ? 'warn' : 'muted')}
        ${statusChip('Model', modelStatus, modelStatus === 'configured' ? 'ok' : 'warn')}
      </div>
    </div>
  `
  bindTopbarControls()
}

function renderScopeControls(dashboard) {
  const projects = Array.isArray(dashboard.projects?.projects) ? dashboard.projects.projects : []
  const selectedProjectId = state.selectedProjectId || dashboard.selection?.projectId || dashboard.projects?.currentProjectId || ''
  return `
    <div class="scope-controls" aria-label="Memory scope controls">
      <select class="soft-select" data-project-select aria-label="Project selector">
        ${projects.map((project) => `
          <option value="${escapeHtml(project.projectId)}" ${project.projectId === selectedProjectId ? 'selected' : ''}>
            ${escapeHtml(project.displayName || project.projectId)}${project.disabled ? ' (disabled)' : ''}${project.current ? ' (current)' : ''}
          </option>
        `).join('')}
      </select>
      <div class="segmented-control" role="group" aria-label="Memory scope">
        ${MEMORY_SCOPES.map((scope) => `
          <button type="button" data-scope="${scope}" aria-pressed="${state.memoryScope === scope ? 'true' : 'false'}">
            ${escapeHtml(scopeLabel(scope))}
          </button>
        `).join('')}
      </div>
    </div>
  `
}

function bindTopbarControls() {
  const projectSelect = topbar.querySelector('[data-project-select]')
  if (projectSelect) {
    projectSelect.addEventListener('change', () => {
      state.selectedProjectId = projectSelect.value || ''
      state.selectedPendingId = ''
      state.pendingAction = null
      state.receipt = null
      state.projectDelete = { confirming: false, loading: false, error: '', receipt: null }
      loadDashboard()
    })
  }
  topbar.querySelectorAll('[data-scope]').forEach((button) => {
    button.addEventListener('click', () => {
      state.memoryScope = button.dataset.scope || 'project'
      state.selectedPendingId = ''
      state.pendingAction = null
      state.receipt = null
      state.projectDelete = { confirming: false, loading: false, error: '', receipt: null }
      loadDashboard()
    })
  })
}

function selectionInfo(dashboard) {
  if (dashboard.selection?.label || dashboard.selection?.projectId) {
    return dashboard.selection
  }
  for (const candidate of [dashboard.pending?.selection, dashboard.active?.selection, dashboard.projectMemory?.selection]) {
    if (candidate?.label || candidate?.projectId) return candidate
  }
  for (const candidate of [dashboard.pending?.project, dashboard.active?.project, dashboard.projectMemory?.project]) {
    if (candidate?.projectId || candidate?.displayName) {
      return { scope: 'project', label: candidate.displayName, projectId: candidate.projectId }
    }
  }
  return { scope: 'project', label: 'Lifecycle Memory', projectId: '' }
}

function modelLabel(status) {
  if (status.configured === true) return 'configured'
  if (Array.isArray(status.missing) && status.missing.length > 0) return 'needs config'
  const model = status.model || status.modelConfig || status.config?.model
  if (typeof model === 'string' && model.trim()) return 'configured'
  if (model && typeof model === 'object') {
    return model.configured || model.baseUrl || model.model ? 'configured' : 'needs config'
  }
  return 'unknown'
}

function renderWorkspace() {
  const warning = state.error ? panel('Dashboard unavailable', escapeHtml(state.error), 'error') : ''
  workspace.innerHTML = warning + pageHtml(state.activeTab)
  const dryRunButton = workspace.querySelector('[data-harvest-dry-run]')
  if (dryRunButton) {
    dryRunButton.addEventListener('click', runHarvesterDryRun)
  }
  workspace.querySelectorAll('[data-triage-mode]').forEach((button) => {
    button.addEventListener('click', () => runTriage(button.dataset.triageMode || 'dry-run'))
  })
  workspace.querySelectorAll('[data-prepare-mode]').forEach((button) => {
    button.addEventListener('click', () => runMemoryPrepare(button.dataset.prepareMode || 'dry-run'))
  })
  const distillButton = workspace.querySelector('[data-memory-distill-dry-run]')
  if (distillButton) {
    distillButton.addEventListener('click', runMemoryDistillDryRun)
  }
  workspace.querySelectorAll('[data-pending-id]').forEach((row) => {
    row.addEventListener('click', () => {
      state.activeTab = 'manual-review'
      state.selectedPendingId = row.dataset.pendingId || ''
      state.pendingAction = null
      state.receipt = null
      state.actionError = ''
      render()
    })
  })
  workspace.querySelectorAll('[data-pending-select]').forEach((checkbox) => {
    checkbox.addEventListener('click', (event) => {
      event.stopPropagation()
    })
    checkbox.addEventListener('change', () => {
      togglePendingSelection(checkbox.dataset.pendingSelect || '', checkbox.checked)
    })
  })
  const rejectSelected = workspace.querySelector('[data-reject-selected-pending]')
  if (rejectSelected) {
    rejectSelected.addEventListener('click', rejectSelectedPending)
  }
  const rejectAll = workspace.querySelector('[data-reject-all-pending]')
  if (rejectAll) {
    rejectAll.addEventListener('click', rejectAllPendingInView)
  }
  workspace.querySelectorAll('[data-active-action]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeAction = {
        id: button.dataset.memoryId || '',
        action: button.dataset.activeAction || ''
      }
      state.activeActionError = ''
      state.activeReceipt = null
      render()
    })
  })
  workspace.querySelectorAll('[data-cancel-active-action]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeAction = null
      state.activeActionError = ''
      render()
    })
  })
  const activeForm = workspace.querySelector('[data-active-action-form]')
  if (activeForm) {
    activeForm.addEventListener('submit', (event) => {
      event.preventDefault()
      submitActiveAction(new FormData(activeForm))
    })
  }
}

function pageHtml(tabId) {
  if (tabId === 'manual-review' || tabId === 'inbox') return renderInbox()
  if (tabId === 'timeline') return renderTimeline()
  if (tabId === 'lifecycle-memory' || tabId === 'project-memory') return renderProjectMemory()
  if (tabId === 'automation') return renderAutomation()
  if (tabId === 'tools') return renderTools()
  if (tabId === 'triage') return renderTriage()
  if (tabId === 'prepare') return renderMemoryPrepare()
  if (tabId === 'distillation') return renderDistillPanel()
  if (tabId === 'harvester') return renderHarvester()
  if (tabId === 'dream') return renderDream()
  if (tabId === 'profile') return renderProfile()
  return renderOverview()
}

function renderOverview() {
  const pending = listPending()
  const active = listActive()
  const summaries = listSummaries()
  const signals = listSignals()
  const selection = selectionInfo(state.dashboard)
  return `
    <section class="page-stack">
      ${sectionHeader('Overview', 'Visibility for the memory pipeline.')}
      <div class="metric-grid">
        ${metric('Manual Review', pending.length, 'Awaiting review')}
        ${renderLifecycleMetrics(active, selection.scope)}
        ${metric('Summaries', summaries.length, 'Stop Hook records')}
        ${metric('Signals', signals.length, 'Current workspace inputs')}
      </div>
      ${renderModelConfigPanel()}
      ${renderTimelineDiagnostic()}
      ${renderRetrievalExplainPanel()}
      <div class="soft-panel">
        <h3>Recent manual review</h3>
        ${pending.slice(0, 3).map(renderCandidateRow).join('') || emptyState('No manual review candidates.')}
      </div>
      <div class="soft-panel">
        <h3>Recent timeline</h3>
        ${summaries.slice(0, 4).map(renderSummaryRow).join('') || emptyState('No review summaries yet.')}
      </div>
    </section>
  `
}

function renderLifecycleMetrics(memories, scope) {
  if (scope === 'global') {
    return [
      metric('Global Core', countTier(memories, 'global_core'), 'Core memory')
    ].join('')
  }
  return [
    metric('Trial', countTier(memories, 'trial'), 'Workflow hints'),
    metric('Validated', countTier(memories, 'validated'), 'Planning constraints'),
    metric('Project Core', countTier(memories, 'project_core'), 'Profile candidates')
  ].join('')
}

function countTier(memories, tier) {
  return memories.filter((memory) => memory.confidenceTier === tier).length
}

function renderInbox() {
  const pending = listPending()
  const selectedCount = pending.filter((candidate) => state.selectedPendingIds.includes(candidate.id)).length
  return `
    <section class="page-stack">
      ${sectionHeader('Manual Review', 'Candidates stay provisional until explicit review.')}
      <div class="soft-inset boundary-copy">${escapeHtml(WRITE_ACTION_COPY)}</div>
      <div class="soft-panel">
        <div class="section-toolbar">
          <h3>Manual candidates</h3>
          <div class="detail-actions">
            <button class="soft-button compact" type="button" data-reject-selected-pending ${selectedCount === 0 ? 'disabled' : ''}>Reject selected</button>
            <button class="soft-button compact" type="button" data-reject-all-pending ${pending.length === 0 ? 'disabled' : ''}>Reject all in view</button>
          </div>
        </div>
        <p class="muted-copy">${escapeHtml(String(selectedCount))} selected</p>
        ${pending.map(renderCandidateRow).join('') || emptyState('No manual review candidates.')}
      </div>
    </section>
  `
}

function renderCandidateRow(candidate) {
  const selected = state.selectedPendingId === candidate.id
  return renderSemanticReviewCard(candidate, { selected, compact: true })
}

function renderSemanticReviewCard(candidate, options = {}) {
  const selected = options.selected === true
  const compact = options.compact === true
  const memory = semanticMemoryForCandidate(candidate)
  const readiness = candidate.readiness || candidate.activeReadiness || {}
  const readinessStatus = readiness.status || (readiness.ready === false ? 'needs_rewrite' : 'ready')
  const targetShape = readiness.targetShape || readiness.suggestedShape || 'review'
  const evidence = Array.isArray(memory.evidence) ? memory.evidence : []
  const evidencePreview = evidence[0] || candidate.episodeEvidence || {}
  const updatePolicy = memory.routing?.updatePolicy || memory.reviewPolicy || 'pending_review'
  const reviewPolicy = memory.reviewPolicy || updatePolicy
  const routingReasons = Array.isArray(memory.routing?.reasons) ? memory.routing.reasons : []
  const sourceOfTruth = firstPresent(memory.sourceOfTruth, candidate.sourceOfTruth, candidate.proposedSemanticMemory?.sourceOfTruth)
  const evidenceRef = evidencePreview.sourceRef || evidencePreview.evidenceRef || candidate.evidenceRef || sourceOfTruth
  const risk = candidate.risk || memory.routing?.risk || 'pending'
  return `
    <article class="memory-review-card selectable-row ${selected ? 'selected' : ''}" data-pending-id="${escapeHtml(candidate.id)}">
      <header class="memory-review-header">
        ${state.activeTab === 'manual-review' || state.activeTab === 'inbox' ? `
          <label class="pending-select" aria-label="Select pending candidate">
            <input type="checkbox" data-pending-select="${escapeHtml(candidate.id)}" ${state.selectedPendingIds.includes(candidate.id) ? 'checked' : ''}>
          </label>
        ` : ''}
        <div>
          <p class="eyebrow">${escapeHtml(memory.module || 'semantic memory')} · ${escapeHtml(reviewQueueStatusLabel(memory.status))}</p>
          <h3>${escapeHtml(memory.content || candidate.content || candidate.id || 'Review candidate')}</h3>
        </div>
        <div class="row-actions">
          ${statusChip('Readiness', `${readinessStatus} · ${targetShape}`, readinessTone(readinessStatus))}
          ${statusChip('Action', candidate.recommendation || 'review', recommendationTone(candidate.recommendation))}
          ${statusChip('Risk', risk, riskTone(risk))}
        </div>
      </header>
      <div class="memory-review-sections ${compact ? 'compact' : ''}">
        ${reviewSection('What will be remembered', [
          ['Content', memory.content || candidate.content || ''],
          ['Why it matters', evidencePreview.whyImportant || candidate.episodeEvidence?.whyImportant || 'Review before this becomes trial/validated/core memory.']
        ])}
        ${reviewSection('Identity', [
          ['Kind', memory.kind || candidate.candidateKind || candidate.type || 'memory'],
          ['Module', memory.module || 'project_semantic'],
          ['Scope', memory.scope || candidate.scope || 'project'],
          ['Domain', memory.domain || candidate.domain || 'project']
        ])}
        ${reviewSection('Policy', [
          ['Update policy', updatePolicy],
          ['Review policy', reviewPolicy],
          ['Readiness', `${readinessStatus} · ${targetShape}`],
          ['Recommendation', candidate.recommendation || 'review'],
          ['Routing reasons', formatValueList(routingReasons)],
          ['Review hash', shortHash(candidate.reviewHash || '')]
        ])}
        ${reviewSection('Use boundaries', [
          ['Use when', formatValueList(memory.useWhen || candidate.proposedSemanticMemory?.useWhen)],
          ['Do not use when', formatValueList(memory.doNotUseWhen || candidate.proposedSemanticMemory?.doNotUseWhen)]
        ])}
        ${reviewSection('Evidence', [
          ['Source of truth', sourceOfTruth],
          ['Evidence ref', evidenceRef],
          ['When', evidencePreview.when || candidate.episodeEvidence?.when || 'unknown'],
          ['What happened', evidencePreview.whatHappened || candidate.episodeEvidence?.whatHappened || 'No event summary available.'],
          ['Source', evidencePreview.sourceKind || evidencePreview.source || candidate.source || 'unknown']
        ])}
      </div>
    </article>
  `
}

function semanticMemoryForCandidate(candidate) {
  if (candidate.semanticMemory) return candidate.semanticMemory
  const proposed = candidate.proposedSemanticMemory || {}
  return {
    id: candidate.id,
    status: 'pending',
    module: candidate.domain === 'procedural' ? 'procedural' : 'project_semantic',
    kind: candidate.candidateKind || proposed.type || candidate.type || 'project_fact',
    scope: candidate.scope || proposed.scope || 'project',
    domain: candidate.domain || 'project',
    content: candidate.content || proposed.content || '',
    useWhen: proposed.useWhen || [],
    doNotUseWhen: proposed.doNotUseWhen || [],
    sourceOfTruth: proposed.sourceOfTruth || candidate.sourceOfTruth || '',
    reviewPolicy: 'pending_review',
    routing: { risk: candidate.risk || 'low', updatePolicy: 'pending_review' },
    evidence: candidate.episodeEvidence ? [{
      when: candidate.episodeEvidence.when,
      whatHappened: candidate.episodeEvidence.whatHappened,
      whyImportant: candidate.episodeEvidence.whyImportant,
      sourceKind: candidate.episodeEvidence.source
    }] : []
  }
}

function reviewSection(title, rows) {
  return `
    <section class="review-section">
      <h4>${escapeHtml(title)}</h4>
      <dl>
        ${rows.map(([label, value]) => `
          <div>
            <dt>${escapeHtml(label)}</dt>
            <dd>${escapeHtml(value || 'missing')}</dd>
          </div>
        `).join('')}
      </dl>
    </section>
  `
}

function renderTimeline() {
  const summaries = listSummaries()
  return `
    <section class="page-stack">
      ${sectionHeader('Timeline', 'Stop Hook review summaries and linked review ids.')}
      ${renderTimelineDiagnostic()}
      <div class="soft-panel">
        <h3>Review summaries</h3>
        ${summaries.map(renderSummaryRow).join('') || emptyState('No review summaries yet.')}
      </div>
    </section>
  `
}

function renderSummaryRow(summary) {
  const ids = Array.isArray(summary.candidateIds) ? summary.candidateIds.join(', ') : 'none'
  return `
    <article class="data-row">
      <div>
        <div class="row-title">${escapeHtml(summary.summary || summary.id || 'Review summary')}</div>
        <div class="row-meta">${escapeHtml(summary.createdAt || 'unknown time')} · candidates ${escapeHtml(ids)}</div>
      </div>
      ${statusChip(summary.status || 'unknown', summary.status || 'unknown', summary.status === 'failed' ? 'error' : 'ok')}
    </article>
  `
}

function renderProjectMemory() {
  const groups = Array.isArray(state.dashboard.projectMemory.groups) ? state.dashboard.projectMemory.groups : []
  const selection = selectionInfo(state.dashboard)
  return `
    <section class="page-stack">
      ${sectionHeader('Lifecycle Memory', `Tiered memory for ${selection.label || 'selected scope'}.`)}
      ${state.activeReceipt ? renderActiveReceipt(state.activeReceipt) : ''}
      ${state.activeAction ? renderActiveActionForm() : ''}
      ${groups.length > 0 ? groups.map((group) => `
        <div class="soft-panel">
          <h3>${escapeHtml(group.label || 'Lifecycle memory')}</h3>
          ${(group.memories || []).map(renderMemoryRow).join('') || emptyState('No lifecycle memories in this group.')}
        </div>
      `).join('') : panel('Lifecycle memory unavailable', 'No grouped lifecycle memory returned yet.', 'muted')}
    </section>
  `
}

function renderMemoryRow(memory) {
  return `
    <article class="data-row">
      <div>
        <div class="row-title">${escapeHtml(memory.content || memory.id || 'Memory')}</div>
        <div class="row-meta">${escapeHtml(memory.candidateKind || memory.type || 'memory')} · ${escapeHtml(memory.updatedAt || memory.createdAt || 'unknown time')}</div>
      </div>
      <div class="row-actions">
        ${statusChip('tier', memoryTierLabel(memory), 'ok')}
        <button class="soft-button compact" type="button" data-active-action="archive" data-memory-id="${escapeHtml(memory.id)}">Archive</button>
        <button class="soft-button compact" type="button" data-active-action="tombstone" data-memory-id="${escapeHtml(memory.id)}">Tombstone</button>
        <button class="soft-button compact" type="button" data-active-action="propose-edit" data-memory-id="${escapeHtml(memory.id)}">Propose edit</button>
      </div>
    </article>
  `
}

function renderActiveActionForm() {
  const memory = findActiveMemoryById(state.activeAction.id)
  if (!memory) return panel('Lifecycle memory unavailable', 'Refresh the dashboard and try again.', 'error')
  const action = state.activeAction.action
  const editField = action === 'propose-edit'
    ? `
      <label>Replacement content
        <textarea name="content" rows="4" required>${escapeHtml(memory.content || '')}</textarea>
      </label>
    `
    : ''
  const tombstoneField = action === 'tombstone'
    ? `
      <label>Days
        <input name="days" type="number" min="1" step="1" value="180">
      </label>
    `
    : ''
  const confirmField = (action === 'tombstone' || action === 'supersede') && memory.destructiveConfirmationRequired
    ? `
      <label>Confirm memory id
        <input name="confirmText" type="text" autocomplete="off" placeholder="${escapeHtml(memory.id)}" required>
      </label>
    `
    : ''
  return `
    <div class="soft-panel active-action-form">
      <h3>${escapeHtml(activeActionLabel(action))}</h3>
      <form class="confirm-form" data-active-action-form>
        <label>Reason
          <textarea name="reason" rows="3" required></textarea>
        </label>
        ${editField}
        ${tombstoneField}
        ${confirmField}
        <div class="detail-actions">
          <button class="soft-button primary compact" type="submit">${escapeHtml(activeActionLabel(action))}</button>
          <button class="soft-button compact" type="button" data-cancel-active-action>Cancel</button>
        </div>
      </form>
      ${state.activeActionError ? `<p class="notice error">${escapeHtml(state.activeActionError)}</p>` : ''}
    </div>
  `
}

function renderActiveReceipt(receipt) {
  return `
    <div class="soft-panel receipt-panel">
      <p class="eyebrow">lifecycle memory receipt</p>
      <h3>${escapeHtml(activeActionLabel(receipt.action || 'archive'))}</h3>
      <div class="soft-inset rail-item"><strong>${escapeHtml(receipt.id || 'memory')}</strong><span>${escapeHtml(receipt.summary || 'Lifecycle memory action applied.')}</span></div>
    </div>
  `
}

async function submitActiveAction(formData) {
  const activeAction = state.activeAction
  if (!activeAction) return
  const memory = findActiveMemoryById(activeAction.id)
  if (!memory) return
  const body = {
    contentHash: memory.contentHash || '',
    reason: String(formData.get('reason') || '').trim()
  }
  if (activeAction.action === 'propose-edit') {
    body.content = String(formData.get('content') || '').trim()
  }
  if (activeAction.action === 'tombstone') {
    const days = Number(formData.get('days') || 180)
    body.days = Number.isFinite(days) ? days : 180
  }
  const confirmText = String(formData.get('confirmText') || '').trim()
  if (confirmText) {
    body.confirmText = confirmText
  }
  try {
    const response = await apiFetch(`/api/active-memory/${encodeURIComponent(activeAction.id)}/${activeAction.action}`, {
      method: 'POST',
      body: JSON.stringify(body)
    })
    const payload = await response.json()
    if (!payload.ok) {
      throw new Error(payload.error?.message || 'Lifecycle memory action failed.')
    }
    await loadDashboard({ renderAfter: false })
    state.activeReceipt = payload.data?.receipt || { id: activeAction.id, action: activeAction.action, summary: 'Lifecycle memory action applied.' }
    state.activeAction = null
    state.activeActionError = ''
  } catch (error) {
    state.activeActionError = errorMessage(error)
  }
  render()
}

function renderPreviewCandidateRow(candidate) {
  return `
    <article class="data-row">
      <div>
        <div class="row-title">${escapeHtml(candidate.content || candidate.id || 'Dry-run preview candidate')}</div>
        <div class="row-meta">${escapeHtml(candidate.candidateKind || candidate.type || 'memory')} · preview · dry-run only</div>
      </div>
      ${statusChip('preview', 'dry-run only', 'warn')}
    </article>
  `
}

function renderHarvester() {
  const result = state.harvester.result
  const resultHtml = state.harvester.error
    ? panel('Harvester dry-run failed', escapeHtml(state.harvester.error), 'error')
    : result
      ? renderHarvesterResult(result)
      : panel('Dry-run ready', 'Preview project-scope candidates without writing manual review memory.', 'muted')

  return `
    <section class="page-stack">
      ${sectionHeader('Harvester', 'Run a project-memory dry-run preview.')}
      <div class="soft-panel action-panel">
        <div>
          <h3>Project harvester</h3>
          <p>Uses the current workspace, not the selected memory scope. No manual review memory was written.</p>
        </div>
        <button class="soft-button primary" type="button" data-harvest-dry-run ${state.harvester.loading ? 'disabled' : ''}>
          ${state.harvester.loading ? 'Running dry-run' : 'Run dry-run'}
        </button>
      </div>
      ${resultHtml}
    </section>
  `
}

async function runHarvesterDryRun() {
  state.harvester = { loading: true, result: null, error: '' }
  render()
  try {
    const response = await apiFetch(DRY_RUN_ENDPOINT, {
      method: 'POST',
      body: '{}'
    })
    const payload = await response.json()
    if (!payload.ok) {
      throw new Error(payload.error?.message || 'Harvester API returned an error.')
    }
    state.harvester = { loading: false, result: payload.data?.result || payload.data, error: '' }
  } catch (error) {
    state.harvester = { loading: false, result: null, error: errorMessage(error) }
  }
  render()
}

function renderHarvesterResult(result) {
  const candidates = Array.isArray(result.candidates) ? result.candidates : []
  const warnings = Array.isArray(result.warnings) ? result.warnings : []
  const reason = typeof result.reason === 'string' && result.reason.trim()
    ? `<p class="notice ${result.action === 'needs_model_config' ? 'warn' : 'muted'}">${escapeHtml(result.reason.trim())}</p>`
    : ''
  const emptyCopy = result.action === 'needs_model_config' || result.action === 'noop'
    ? 'No preview candidates were produced.'
    : 'No preview candidates returned.'
  return `
    <div class="soft-panel">
      <h3>Dry-run result</h3>
      <div class="soft-inset">Action: ${escapeHtml(result.action || 'preview')} · No manual review memory was written.</div>
      ${reason}
      ${warnings.map((warning) => `<p class="notice warn">${escapeHtml(warning)}</p>`).join('')}
      ${candidates.map(renderPreviewCandidateRow).join('') || emptyState(emptyCopy)}
    </div>
  `
}

function renderTriage() {
  const result = state.triage.result
  const resultHtml = state.triage.error
    ? panel('Triage failed', escapeHtml(state.triage.error), 'error')
    : result
      ? renderTriageResult(result)
      : panel('Triage ready', 'Preview manual review cleanup and recommendations for the selected scope.', 'muted')

  return `
    <section class="page-stack">
      ${sectionHeader('Triage', 'Cluster and rank manual review candidates.')}
      <div class="soft-panel action-panel">
        <div>
          <h3>Manual review triage</h3>
          <p>Preview duplicate, defer, drop, and review recommendations. Safe apply only drops transient noise, merges duplicate review candidates, and defers weak candidates.</p>
        </div>
        <div class="detail-actions">
          <button class="soft-button primary" type="button" data-triage-mode="dry-run" ${state.triage.loading ? 'disabled' : ''}>
            ${state.triage.loading ? 'Running triage' : 'Run triage dry-run'}
          </button>
          <button class="soft-button" type="button" data-triage-mode="apply" ${state.triage.loading ? 'disabled' : ''}>
            ${state.triage.loading ? 'Applying triage' : 'Apply safe triage'}
          </button>
        </div>
      </div>
      ${resultHtml}
    </section>
  `
}

async function runTriage(mode) {
  state.triage = { loading: true, result: null, error: '', receipt: null }
  render()
  try {
    const endpoint = mode === 'apply' ? TRIAGE_APPLY_ENDPOINT : TRIAGE_DRY_RUN_ENDPOINT
    const response = await apiFetch(`${endpoint}${selectionQuery()}`, { method: 'POST', body: '{}' })
    const payload = await response.json()
    if (!payload.ok) {
      throw new Error(payload.error?.message || 'Triage API returned an error.')
    }
    if (mode === 'apply') {
      await loadDashboard({ renderAfter: false })
    }
    state.triage = {
      loading: false,
      result: payload.data,
      error: '',
      receipt: payload.data?.receipt || null
    }
  } catch (error) {
    state.triage = { loading: false, result: null, error: errorMessage(error), receipt: null }
  }
  render()
}

function renderTriageResult(result) {
  const decisions = Array.isArray(result.decisions) ? result.decisions : []
  const clusters = Array.isArray(result.clusters) ? result.clusters : []
  const actions = ['auto_drop', 'auto_merge', 'auto_defer', 'recommend', 'auto_promote', 'manual_review']
  const applied = result.applied || {}
  const resultTitle = result.action === 'apply' ? 'Triage apply result' : 'Triage dry-run result'
  const scopeNote = result.action === 'apply' ? 'safe changes applied' : 'preview only'
  return `
    <div class="soft-panel">
      <h3>${escapeHtml(resultTitle)}</h3>
      <div class="triage-grid">
        ${actions.map((action) => metric(triageActionLabel(action), countTriageDecision(decisions, action), 'decisions')).join('')}
      </div>
      <div class="soft-inset">Clusters: ${escapeHtml(String(clusters.length))}</div>
      ${result.action === 'apply' ? `<div class="soft-inset">Applied: drop ${escapeHtml(String(applied.auto_drop || 0))} · merge ${escapeHtml(String(applied.auto_merge || 0))} · defer ${escapeHtml(String(applied.auto_defer || 0))}</div>` : ''}
      <div class="soft-inset">Scope: ${escapeHtml(result.selection?.label || selectionInfo(state.dashboard).label || 'selected scope')} · ${escapeHtml(scopeNote)}</div>
      ${decisions.slice(0, 8).map(renderTriageDecisionRow).join('') || emptyState('No triage decisions returned.')}
    </div>
  `
}

function renderTriageDecisionRow(decision) {
  const ids = decision.candidateIds || [decision.candidateId].filter(Boolean)
  return `
    <article class="data-row">
      <div>
        <div class="row-title">${escapeHtml(triageActionLabel(decision.action || 'manual_review'))}</div>
        <div class="row-meta">${escapeHtml(ids.join(', ') || decision.clusterId || 'candidate')} · ${escapeHtml(decision.reason || 'triage decision')}</div>
      </div>
      ${statusChip('triage', decision.action || 'review', triageTone(decision.action))}
    </article>
  `
}

function countTriageDecision(decisions, action) {
  return decisions.filter((decision) => decision.action === action).length
}

function triageActionLabel(action) {
  if (action === 'auto_drop') return 'Auto drop'
  if (action === 'auto_merge') return 'Auto merge'
  if (action === 'auto_defer') return 'Auto defer'
  if (action === 'auto_promote') return 'Auto promote'
  if (action === 'manual_review') return 'Manual review'
  return 'Recommend'
}

function triageTone(action) {
  if (action === 'auto_drop') return 'error'
  if (action === 'auto_defer' || action === 'recommend') return 'warn'
  return 'muted'
}

function renderMemoryPrepare() {
  const result = state.prepare.result
  const resultHtml = state.prepare.error
    ? panel('Prepare failed', escapeHtml(state.prepare.error), 'error')
    : result
      ? renderMemoryPrepareResult(result)
      : panel('Prepare ready', 'Preview or apply semantic cleanup for review candidates in the selected scope.', 'muted')

  return `
    <section class="page-stack">
      ${sectionHeader('Prepare', 'Rewrite review candidates into reviewable semantic memory shape.')}
      <div class="soft-panel action-panel">
        <div>
          <h3>Semantic prepare</h3>
          <p>Dry-run previews content replacements and boundary enrichment. Apply writes manual review records and rewrite receipts; lifecycle memory is not changed.</p>
        </div>
        <div class="detail-actions">
          <button class="soft-button primary" type="button" data-prepare-mode="dry-run" ${state.prepare.loading ? 'disabled' : ''}>
            ${state.prepare.loading ? 'Running prepare' : 'Run prepare dry-run'}
          </button>
          <button class="soft-button" type="button" data-prepare-mode="apply" ${state.prepare.loading ? 'disabled' : ''}>
            ${state.prepare.loading ? 'Applying prepare' : 'Apply prepare'}
          </button>
        </div>
      </div>
      ${resultHtml}
    </section>
  `
}

async function runMemoryPrepare(mode) {
  state.prepare = { loading: true, result: null, error: '' }
  render()
  try {
    const endpoint = mode === 'apply' ? PREPARE_APPLY_ENDPOINT : PREPARE_DRY_RUN_ENDPOINT
    const response = await apiFetch(`${endpoint}${selectionQuery()}`, { method: 'POST', body: '{}' })
    const payload = await response.json()
    if (!payload.ok) {
      throw new Error(payload.error?.message || 'Prepare API returned an error.')
    }
    if (mode === 'apply') {
      await loadDashboard({ renderAfter: false })
    }
    state.prepare = { loading: false, result: payload.data, error: '' }
  } catch (error) {
    state.prepare = { loading: false, result: null, error: errorMessage(error) }
  }
  render()
}

function renderMemoryPrepareResult(result) {
  const results = Array.isArray(result.results) ? result.results : []
  const receipts = Array.isArray(result.receipts) ? result.receipts : []
  const changed = results.filter((item) => item.action && item.action !== 'skip').length
  const title = result.dryRun ? 'Prepare dry-run result' : 'Prepare apply result'
  return `
    <div class="soft-panel">
      <h3>${escapeHtml(title)}</h3>
      <div class="triage-grid">
        ${metric('Manual Review', result.pendingBeforeCount ?? 0, `${result.pendingAfterCount ?? 0} after prepare`)}
        ${metric('Changed', changed, 'replace/enrich/fail actions')}
        ${metric('Receipts', receipts.length, result.dryRun ? 'preview only' : 'written')}
        ${metric('Lifecycle', result.activeAfterCount ?? 0, `${result.activeBeforeCount ?? 0} before prepare`)}
      </div>
      <div class="soft-inset">Scope: ${escapeHtml(result.selection?.label || selectionInfo(state.dashboard).label || 'selected scope')} · ${result.dryRun ? 'preview only' : 'manual review updated'}</div>
      ${results.slice(0, 8).map(renderMemoryPrepareRow).join('') || emptyState('No review candidates needed prepare.')}
    </div>
  `
}

function renderMemoryPrepareRow(result) {
  const receipt = result.receipt || {}
  const candidateId = result.original?.id || result.next?.id || receipt.pendingMemoryId || 'candidate'
  const reasons = Array.isArray(result.validation?.reasons) && result.validation.reasons.length > 0
    ? result.validation.reasons.join(', ')
    : Array.isArray(receipt.validatorReasons) && receipt.validatorReasons.length > 0
      ? receipt.validatorReasons.join(', ')
      : 'validated'
  return `
    <article class="data-row">
      <div>
        <div class="row-title">${escapeHtml(result.action || 'skip')}</div>
        <div class="row-meta">${escapeHtml(candidateId)} · ${escapeHtml(reasons)}</div>
      </div>
      ${statusChip('prepare', result.action || 'skip', prepareTone(result.action))}
    </article>
  `
}

function prepareTone(action) {
  if (action === 'replace_content' || action === 'enrich_boundaries') return 'ok'
  if (action === 'fail') return 'error'
  return 'muted'
}

function renderDistillPanel() {
  const result = state.distill.result
  const resultHtml = state.distill.error
    ? panel('Distillation dry-run failed', escapeHtml(state.distill.error), 'error')
    : result
      ? renderDistillCandidates(result)
      : panel('Distillation ready', 'Duplicate manual review preview.', 'muted')

  return `
    <section class="page-stack">
      ${sectionHeader('Distillation', 'Manual review duplicate dry-run.')}
      <div class="soft-panel action-panel">
        <div>
          <h3>Memory distillation</h3>
          <p>Dry-run only.</p>
        </div>
        <button class="soft-button primary" type="button" data-memory-distill-dry-run ${state.distill.loading ? 'disabled' : ''}>
          ${state.distill.loading ? 'Running dry-run' : 'Run dry-run'}
        </button>
      </div>
      ${resultHtml}
    </section>
  `
}

async function runMemoryDistillDryRun() {
  state.distill = { loading: true, result: null, error: '' }
  render()
  try {
    const response = await apiFetch(`${DISTILL_DRY_RUN_ENDPOINT}${selectionQuery()}`, {
      method: 'POST',
      body: '{}'
    })
    const payload = await response.json()
    if (!payload.ok) {
      throw new Error(payload.error?.message || 'Distillation API returned an error.')
    }
    state.distill = { loading: false, result: payload.data, error: '' }
  } catch (error) {
    state.distill = { loading: false, result: null, error: errorMessage(error) }
  }
  render()
}

function renderDistillCandidates(result) {
  const candidates = Array.isArray(result.candidates) ? result.candidates : []
  const summary = result.summary || {}
  return `
    <div class="soft-panel">
      <h3>Dry-run result</h3>
      <div class="soft-inset">Mode: ${escapeHtml(result.mode || 'dry_run')} · Candidates: ${escapeHtml(String(summary.candidates ?? candidates.length))}</div>
      <ul class="distill-list">
        ${candidates.map(renderDistillCandidate).join('') || emptyState('No distillation candidates returned.')}
      </ul>
    </div>
  `
}

function renderDistillCandidate(candidate) {
  const sourceIds = Array.isArray(candidate.sourceIds) ? candidate.sourceIds.join(', ') : ''
  const reasons = Array.isArray(candidate.reasons) ? candidate.reasons.join(' · ') : ''
  return `
    <li class="soft-inset distill-item">
      <div>
        <div class="row-title">${escapeHtml(candidate.content || candidate.id || 'Distillation candidate')}</div>
        <div class="row-meta">${escapeHtml(candidate.id || 'candidate')} · ${escapeHtml(candidate.normalizedKey || 'normalized key')}</div>
        <div class="row-meta">sources ${escapeHtml(sourceIds || 'none')}</div>
        <div class="row-meta">${escapeHtml(reasons || 'no reasons')}</div>
      </div>
      <div class="row-actions">
        ${statusChip('action', candidate.recommendedAction || 'needs_review', candidate.recommendedAction === 'merge_pending' ? 'ok' : 'warn')}
        ${statusChip('risk', candidate.risk || 'unknown', candidate.risk === 'high' ? 'error' : 'muted')}
      </div>
    </li>
  `
}

function renderAutomation() {
  const dream = state.dashboard.dream.dream || {}
  return `
    <section class="page-stack">
      ${sectionHeader('Automation', 'Scheduled lifecycle maintenance.')}
      <div class="metric-grid">
        ${metric('Daily 15:00', 'Trial -> Validated', 'Project lifecycle')}
        ${metric('Weekly Sun 15:00', 'Validated -> Core', 'Core consolidation')}
        ${metric('Manual Review', listPending().length, 'High-risk recommendations')}
      </div>
      <div class="soft-panel">
        <h3>Dream status</h3>
        <div class="soft-inset">
          Due: ${escapeHtml(String(dream.dreamDue ?? 'unknown'))}<br>
          Last run: ${escapeHtml(dream.lastDreamAt || 'never')}<br>
          Status: ${escapeHtml(dream.lastDreamStatus || 'unknown')}
        </div>
      </div>
    </section>
  `
}

function renderTools() {
  return `
    <section class="page-stack">
      ${sectionHeader('Tools', 'Maintenance tools for manual review and project signal previews.')}
      ${renderTriage()}
      ${renderMemoryPrepare()}
      ${renderDistillPanel()}
      ${renderHarvester()}
    </section>
  `
}

function renderDream() {
  const dream = state.dashboard.dream.dream || {}
  return `
    <section class="page-stack">
      ${sectionHeader('Dream', 'Read-only dream pass state.')}
      <div class="soft-panel">
        <h3>Dream status</h3>
        <div class="soft-inset">
          Due: ${escapeHtml(String(dream.dreamDue ?? 'unknown'))}<br>
          Last run: ${escapeHtml(dream.lastDreamAt || 'never')}<br>
          Status: ${escapeHtml(dream.lastDreamStatus || 'unknown')}
        </div>
      </div>
    </section>
  `
}

function renderProfile() {
  const profile = state.dashboard.profile.profile || ''
  return `
    <section class="page-stack">
      ${sectionHeader('Profile', 'Current project model profile preview.')}
      <div class="soft-panel">
        <h3>MODEL_PROFILE.md</h3>
        <pre class="profile-preview">${escapeHtml(profile || 'No project profile text found.')}</pre>
      </div>
    </section>
  `
}

function renderDetailRail() {
  const selected = selectedPending()
  if ((state.activeTab === 'manual-review' || state.activeTab === 'inbox') && state.receipt) {
    detailRail.innerHTML = renderReceipt()
    bindDetailRailActions(selected)
    return
  }
  if ((state.activeTab === 'manual-review' || state.activeTab === 'inbox') && selected) {
    detailRail.innerHTML = renderPendingDetail(selected)
    bindDetailRailActions(selected)
    return
  }

  const pending = listPending()
  const signals = listSignals()
  detailRail.innerHTML = `
    <div class="rail-stack">
      <div class="soft-panel">
        <h3>Boundary</h3>
        <p>${escapeHtml(WRITE_ACTION_COPY)}</p>
      </div>
      ${renderSelectionRail()}
      ${renderProjectDeletePanel()}
      <div class="soft-panel">
        <h3>Harvester inputs</h3>
        <p>Signals are files and traces the harvester can inspect for project-memory candidates; they are not memories.</p>
        ${signals.slice(0, 5).map((signal) => `
          <div class="soft-inset rail-item">
            <strong>${escapeHtml(signal.kind || 'signal')}</strong>
            <span>${escapeHtml((signal.files || signal.paths || []).slice(0, 2).join(', ') || 'detected')}</span>
          </div>
        `).join('') || emptyState('No signals found.')}
      </div>
      <div class="soft-panel">
        <h3>Manual Review</h3>
        <p>${escapeHtml(String(pending.length))} manual review candidates in this scope</p>
      </div>
    </div>
  `
  bindProjectDeleteActions()
}

function renderSelectionRail() {
  const selection = selectionInfo(state.dashboard)
  return `
    <div class="soft-panel">
      <h3>Memory scope</h3>
      <div class="soft-inset rail-item">
        <strong>${escapeHtml(selection.label || 'Selected memory')}</strong>
        <span>${escapeHtml(selectionMeta(selection))}</span>
      </div>
    </div>
  `
}

function renderProjectDeletePanel() {
  const selection = selectionInfo(state.dashboard)
  if (selection.scope === 'global') return ''
  const project = selectedProjectOption()
  if (!project) return ''
  if (project.disabled) {
    return `
      <div class="soft-panel danger-panel">
        <h3>Project memory disabled</h3>
        <p>No project-scope memory will be captured for this project.</p>
        ${project.disabledReason ? `<div class="soft-inset rail-item"><strong>Reason</strong><span>${escapeHtml(project.disabledReason)}</span></div>` : ''}
      </div>
    `
  }
  if (state.projectDelete.receipt) {
    return `
      <div class="soft-panel receipt-panel">
        <h3>Project memory disabled</h3>
        <div class="soft-inset rail-item">
          <strong>${escapeHtml(project.displayName || project.projectId)}</strong>
          <span>${escapeHtml(state.projectDelete.receipt.summary || 'Project memory deleted.')}</span>
        </div>
      </div>
    `
  }
  if (state.projectDelete.confirming) {
    return `
      <div class="soft-panel danger-panel">
        <h3>Delete & disable project memory</h3>
        <p>This deletes this project's memory files and prevents future project-scope capture for the selected project.</p>
        <form class="confirm-form" data-project-delete-form>
          <label>Confirm projectId
            <input name="confirmProjectId" required placeholder="${escapeHtml(project.projectId)}">
          </label>
          <label>Reason
            <textarea name="reason" rows="3" placeholder="Optional"></textarea>
          </label>
          <div class="detail-actions">
            <button class="soft-button danger compact" type="submit" ${state.projectDelete.loading ? 'disabled' : ''}>Delete memory</button>
            <button class="soft-button compact" type="button" data-cancel-project-delete>Cancel</button>
          </div>
        </form>
        ${state.projectDelete.error ? `<p class="notice error">${escapeHtml(state.projectDelete.error)}</p>` : ''}
      </div>
    `
  }
  return `
    <div class="soft-panel danger-panel">
      <h3>Delete project memory</h3>
      <p>Remove this project's memory files and disable future project-scope capture.</p>
      <button class="soft-button danger compact" type="button" data-project-delete>Delete & disable project memory</button>
      ${state.projectDelete.error ? `<p class="notice error">${escapeHtml(state.projectDelete.error)}</p>` : ''}
    </div>
  `
}

function bindProjectDeleteActions() {
  const deleteButton = detailRail.querySelector('[data-project-delete]')
  if (deleteButton) {
    deleteButton.addEventListener('click', () => {
      state.projectDelete = { confirming: true, loading: false, error: '', receipt: null }
      render()
    })
  }
  const cancelButton = detailRail.querySelector('[data-cancel-project-delete]')
  if (cancelButton) {
    cancelButton.addEventListener('click', () => {
      state.projectDelete = { confirming: false, loading: false, error: '', receipt: null }
      render()
    })
  }
  const form = detailRail.querySelector('[data-project-delete-form]')
  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      submitProjectDelete(new FormData(form))
    })
  }
}

async function submitProjectDelete(formData) {
  const project = selectedProjectOption()
  if (!project) return
  state.projectDelete = { confirming: true, loading: true, error: '', receipt: null }
  render()
  try {
    const response = await apiFetch(`/api/projects/${encodeURIComponent(project.projectId)}/delete-memory`, {
      method: 'POST',
      body: JSON.stringify({
        confirmProjectId: String(formData.get('confirmProjectId') || '').trim(),
        reason: String(formData.get('reason') || '').trim()
      })
    })
    const payload = await response.json()
    if (!payload.ok) {
      throw new Error(payload.error?.message || 'Project memory deletion failed.')
    }
    await loadDashboard({ renderAfter: false })
    state.projectDelete = { confirming: false, loading: false, error: '', receipt: payload.data?.receipt || {} }
  } catch (error) {
    state.projectDelete = { confirming: true, loading: false, error: errorMessage(error), receipt: null }
  }
  render()
}

function renderPendingDetail(candidate) {
  if (state.pendingAction) return renderConfirmForm(candidate, state.pendingAction)
  return `
    <div class="rail-stack">
      ${renderProposedSemanticMemorySection(candidate)}
      ${renderEpisodeEvidenceSection(candidate)}
      ${renderAdmissionRoutingSection(candidate)}
      ${renderUpdatePolicySection(candidate)}
      ${renderUseBoundariesSection(candidate)}
      ${renderSemanticPrepareSection(candidate)}
      ${renderReviewActionSection(candidate)}
    </div>
  `
}

function renderReadinessReview(readiness, activeReadiness) {
  const review = readiness || activeReadiness
  if (!review) return ''
  const status = review.status || (review.ready === false ? 'needs_rewrite' : 'ready')
  const targetShape = review.targetShape || review.suggestedShape || 'active_memory'
  const reasons = readinessReasonItems(review, activeReadiness)
  return `
    <div class="soft-inset rail-item">
      <strong>Readiness</strong>
      <span>${escapeHtml(status)}</span>
    </div>
    <div class="soft-inset rail-item">
      <strong>Target shape</strong>
      <span>${escapeHtml(targetShape)}</span>
    </div>
    <div class="soft-inset rail-item">
      <strong>Reasons</strong>
      <span>${escapeHtml(reasons.map(formatReadinessReason).join(' · '))}</span>
    </div>
    <div class="soft-inset rail-item">
      <strong>Rewrite hint</strong>
      <span>${escapeHtml(review.rewriteHint || activeReadiness?.rewriteHint || 'No rewrite needed.')}</span>
    </div>
  `
}

function readinessReasonItems(readiness, activeReadiness) {
  if (Array.isArray(readiness?.reasons) && readiness.reasons.length > 0) {
    return readiness.reasons.map((reason) => {
      if (typeof reason === 'string') return { code: reason, text: reason }
      return {
        code: reason.code || 'review_reason',
        text: reason.text || reason.code || 'Review reason present.'
      }
    })
  }
  if (Array.isArray(activeReadiness?.reasons) && activeReadiness.reasons.length > 0) {
    return activeReadiness.reasons.map((reason) => ({ code: reason, text: reason }))
  }
  return [{ code: 'reviewable_candidate_shape', text: 'Candidate has no blocking lifecycle-memory rewrite signals.' }]
}

function formatReadinessReason(reason) {
  return reason.text || reason.code || 'Review reason present.'
}

function renderProposedSemanticMemorySection(candidate) {
  const memory = semanticMemoryForCandidate(candidate)
  const proposed = candidate.proposedSemanticMemory || {}
  return renderWorkflowSection('Proposed Semantic Memory', [
    ['Content', firstPresent(memory.content, proposed.content, candidate.content)],
    ['Kind', firstPresent(memory.kind, proposed.type, candidate.candidateKind, candidate.type)],
    ['Module', memory.module],
    ['Scope', firstPresent(memory.scope, proposed.scope, candidate.scope)],
    ['Domain', firstPresent(memory.domain, candidate.domain)],
    ['Source of truth', sourceOfTruthForWorkflow(candidate)]
  ])
}

function renderEpisodeEvidenceSection(candidate) {
  const evidence = workflowEvidenceForCandidate(candidate)
  return renderWorkflowSection('Episode Evidence', [
    ['Evidence ref', evidence.evidenceRef],
    ['When', evidence.when],
    ['What happened', evidence.whatHappened],
    ['Why important', evidence.whyImportant],
    ['Result', evidence.result],
    ['Source', evidence.source]
  ])
}

function renderAdmissionRoutingSection(candidate) {
  const memory = semanticMemoryForCandidate(candidate)
  const routing = memory.routing || candidate.routing || {}
  const reviewState = memory.reviewState || candidate.reviewState || {}
  return renderWorkflowSection('Admission / Routing Decision', [
    ['Admission action', firstPresent(candidate.admissionAction, candidate.action, reviewState.admissionAction)],
    ['Admitted by', reviewState.admittedBy],
    ['Admission score', reviewState.admissionScore],
    ['Admission reasons', reviewState.admissionReasons],
    ['Module', firstPresent(routing.module, memory.module)],
    ['Risk', firstPresent(routing.risk, candidate.risk)],
    ['Routing reasons', routing.reasons],
    ['Tags', firstArrayWithValues(reviewState.tags, candidate.tags)]
  ])
}

function renderUpdatePolicySection(candidate) {
  const memory = semanticMemoryForCandidate(candidate)
  const routing = memory.routing || candidate.routing || {}
  const reviewState = memory.reviewState || candidate.reviewState || {}
  const readiness = candidate.readiness || candidate.activeReadiness || {}
  const readinessStatus = readiness.status || (readiness.ready === false ? 'needs_rewrite' : readiness.ready === true ? 'ready' : '')
  const targetShape = readiness.targetShape || readiness.suggestedShape
  return renderWorkflowSection('Update Policy', [
    ['Update policy', firstPresent(routing.updatePolicy, memory.reviewPolicy, candidate.updatePolicy)],
    ['Review policy', firstPresent(memory.reviewPolicy, routing.updatePolicy, candidate.reviewPolicy)],
    ['Readiness', readinessStatus],
    ['Target shape', targetShape],
    ['Recommendation', candidate.recommendation],
    ['Review hash', candidate.reviewHash ? shortHash(candidate.reviewHash) : ''],
    ['Promote after', reviewState.promoteAfter],
    ['Expires at', firstPresent(memory.expiresAt, candidate.expiresAt)]
  ])
}

function renderUseBoundariesSection(candidate) {
  const memory = semanticMemoryForCandidate(candidate)
  const proposed = candidate.proposedSemanticMemory || {}
  return renderWorkflowSection('Use Boundaries', [
    ['Use when', firstArrayWithValues(memory.useWhen, proposed.useWhen)],
    ['Do not use when', firstArrayWithValues(memory.doNotUseWhen, proposed.doNotUseWhen)],
    ['Evidence strength', proposed.evidenceStrength],
    ['Future usefulness', proposed.futureUsefulness],
    ['Expiry', firstPresent(proposed.expiry, memory.expiresAt, candidate.expiresAt)]
  ])
}

function renderSemanticPrepareSection(candidate) {
  const semanticRewrite = candidate.semanticRewrite || {}
  const receipt = semanticRewrite.receipt || {}
  if (!semanticRewrite.status && !receipt.action) return ''
  return renderWorkflowSection('Semantic Prepare', [
    ['Status', semanticRewrite.status],
    ['Action', receipt.action],
    ['Method', receipt.method],
    ['Old review hash', receipt.oldReviewHash ? shortHash(receipt.oldReviewHash) : ''],
    ['New review hash', receipt.newReviewHash ? shortHash(receipt.newReviewHash) : ''],
    ['Changed fields', receipt.changedFields],
    ['Eligibility reasons', receipt.eligibilityReasons],
    ['Validator reasons', receipt.validatorReasons],
    ['Original content hash', receipt.originalContentHash ? shortHash(receipt.originalContentHash) : '']
  ])
}

function renderReviewActionSection(candidate) {
  return `
    <div class="soft-panel">
      <h3>Review Action</h3>
      <p>${escapeHtml(WRITE_ACTION_COPY)}</p>
      <div class="detail-actions">
        ${['approve', 'reject', 'defer', 'edit'].map((action) => `
          <button class="soft-button compact" type="button" data-action="${action}">${escapeHtml(actionLabel(action))}</button>
        `).join('')}
      </div>
      ${state.actionError ? `<p class="notice error">${escapeHtml(state.actionError)}</p>` : ''}
    </div>
  `
}

function renderWorkflowSection(title, rows) {
  return `
    <div class="soft-panel">
      <h3>${escapeHtml(title)}</h3>
      ${rows.map(([label, value]) => renderWorkflowItem(label, value)).join('')}
    </div>
  `
}

function renderWorkflowItem(label, value) {
  return `
    <div class="soft-inset rail-item">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(formatWorkflowValue(value))}</span>
    </div>
  `
}

function workflowEvidenceForCandidate(candidate) {
  const memory = candidate.semanticMemory || {}
  const structuredEvidence = Array.isArray(memory.evidence) ? memory.evidence[0] : null
  const episodeEvidence = candidate.episodeEvidence || {}
  return {
    evidenceRef: firstPresent(structuredEvidence?.sourceRef, structuredEvidence?.evidenceRef, candidate.evidenceRef) || firstArrayWithValues(candidate.evidenceRefs),
    when: firstPresent(structuredEvidence?.when, episodeEvidence.when),
    whatHappened: firstPresent(structuredEvidence?.whatHappened, episodeEvidence.whatHappened),
    whyImportant: firstPresent(structuredEvidence?.whyImportant, episodeEvidence.whyImportant),
    result: firstPresent(structuredEvidence?.result, episodeEvidence.result),
    source: firstPresent(structuredEvidence?.sourceKind, structuredEvidence?.source, episodeEvidence.source, candidate.source)
  }
}

function sourceOfTruthForWorkflow(candidate) {
  const memory = semanticMemoryForCandidate(candidate)
  return firstPresent(
    candidate.semanticMemory?.sourceOfTruth,
    candidate.proposedSemanticMemory?.sourceOfTruth,
    candidate.sourceOfTruth,
    memory.sourceOfTruth
  )
}

function firstPresent(...values) {
  return values.find((value) => {
    if (value === undefined || value === null) return false
    return String(value).trim() !== ''
  })
}

function firstArrayWithValues(...values) {
  return values.find((value) => Array.isArray(value) && value.some((item) => String(item || '').trim() !== '')) || []
}

function formatWorkflowValue(value) {
  if (Array.isArray(value)) return formatWorkflowList(value)
  if (value === undefined || value === null) return 'missing'
  const textValue = String(value).trim()
  return textValue === '' ? 'missing' : textValue
}

function formatWorkflowList(value) {
  const items = Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : []
  return items.length > 0 ? items.join(' · ') : 'missing'
}

function formatValueList(value) {
  if (!Array.isArray(value) || value.length === 0) return 'missing'
  return value.join(' · ')
}

function renderConfirmForm(candidate, action) {
  const confirmTitle = CONFIRM_LABELS[action] || 'Confirm action'
  const reasonField = action === 'reject' || action === 'defer'
    ? `
      <label>Reason
        <textarea name="reason" rows="3" placeholder="Optional review note"></textarea>
      </label>
    `
    : ''
  const deferField = action === 'defer'
    ? `
      <label>Days
        <input name="days" type="number" min="1" step="1" value="7">
      </label>
    `
    : ''
  const editFields = action === 'edit'
    ? `
      <label>Content
        <textarea name="content" rows="5" required>${escapeHtml(candidate.content || '')}</textarea>
      </label>
      <label>Candidate kind
        <input name="candidateKind" value="${escapeHtml(candidate.candidateKind || '')}" placeholder="workflow_rule">
      </label>
      <label>Tags
        <input name="tags" value="${escapeHtml(Array.isArray(candidate.tags) ? candidate.tags.join(', ') : '')}" placeholder="web_ui, reviewed">
      </label>
      <label>Usefulness
        <input name="usefulness" type="number" min="0" max="1" step="0.01" value="${escapeHtml(candidate.scores?.usefulness ?? '')}">
      </label>
      <label>Change note
        <textarea name="changeNote" rows="3" required placeholder="Required edit note"></textarea>
      </label>
    `
    : ''

  return `
    <div class="rail-stack">
      <div class="soft-panel">
        <h3>${escapeHtml(confirmTitle)}</h3>
        <p>${escapeHtml(WRITE_ACTION_COPY)}</p>
        <div class="soft-inset rail-item"><strong>reviewHash</strong><span>${escapeHtml(shortHash(candidate.reviewHash || ''))}</span></div>
        <form class="confirm-form" data-confirm-form aria-label="${escapeHtml(confirmTitle)}">
          ${reasonField}
          ${deferField}
          ${editFields}
          <div class="detail-actions">
            <button class="soft-button primary compact" type="submit">${escapeHtml(confirmTitle)}</button>
            <button class="soft-button compact" type="button" data-cancel-action>Cancel</button>
          </div>
        </form>
        ${state.actionError ? `<p class="notice error">${escapeHtml(state.actionError)}</p>` : ''}
      </div>
    </div>
  `
}

function renderReceipt() {
  const receipt = state.receipt || {}
  return `
    <div class="rail-stack">
      <div class="soft-panel receipt-panel">
        <p class="eyebrow">decision receipt</p>
        <h3>${escapeHtml(actionLabel(receipt.action || 'review'))}</h3>
        <div class="soft-inset rail-item"><strong>${escapeHtml(receipt.id || 'memory')}</strong><span>${escapeHtml(receipt.summary || 'Action completed.')}</span></div>
        <div class="soft-inset rail-item"><strong>reviewHash</strong><span>${escapeHtml(shortHash(receipt.reviewHash || ''))}</span></div>
        <button class="soft-button compact" type="button" data-clear-receipt>Back to Manual Review</button>
      </div>
    </div>
  `
}

function bindDetailRailActions(candidate) {
  detailRail.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      state.pendingAction = button.dataset.action || null
      state.receipt = null
      state.actionError = ''
      render()
    })
  })
  const clearReceipt = detailRail.querySelector('[data-clear-receipt]')
  if (clearReceipt) {
    clearReceipt.addEventListener('click', () => {
      state.receipt = null
      state.actionError = ''
      render()
    })
  }
  const cancel = detailRail.querySelector('[data-cancel-action]')
  if (cancel) {
    cancel.addEventListener('click', () => {
      state.pendingAction = null
      state.actionError = ''
      render()
    })
  }
  const form = detailRail.querySelector('[data-confirm-form]')
  if (form && candidate) {
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      submitPendingAction(candidate, new FormData(form))
    })
  }
}

async function submitPendingAction(candidate, formData) {
  const action = state.pendingAction
  if (!action) return
  const body = actionBody(action, candidate, formData)
  try {
    const response = await apiFetch(`/api/memory/${encodeURIComponent(candidate.id)}/${action}${selectionQuery()}`, {
      method: 'POST',
      body: JSON.stringify(body)
    })
    const payload = await response.json()
    if (!payload.ok) {
      throw new Error(payload.error?.message || 'Write action failed.')
    }
    const receipt = payload.data?.receipt || {
      action,
      id: candidate.id,
      reviewHash: candidate.reviewHash,
      summary: 'Action completed.'
    }
    await loadDashboard({ renderAfter: false })
    state.receipt = receipt
    state.pendingAction = null
    state.actionError = ''
    state.selectedPendingId = action === 'edit' && payload.data?.candidate?.id ? payload.data.candidate.id : ''
  } catch (error) {
    state.actionError = errorMessage(error)
  }
  render()
}

function togglePendingSelection(id, selected) {
  if (!id) return
  const current = new Set(state.selectedPendingIds)
  if (selected) {
    current.add(id)
  } else {
    current.delete(id)
  }
  state.selectedPendingIds = Array.from(current)
  render()
}

function rejectSelectedPending() {
  const selected = listPending().filter((candidate) => state.selectedPendingIds.includes(candidate.id))
  submitBatchPendingReject(selected)
}

function rejectAllPendingInView() {
  submitBatchPendingReject(listPending())
}

async function submitBatchPendingReject(candidates) {
  const candidatesWithHashes = candidates
    .filter((candidate) => candidate.reviewHash)
    .map((candidate) => ({ id: candidate.id, reviewHash: candidate.reviewHash }))
  if (candidatesWithHashes.length === 0) return
  try {
    const response = await apiFetch(`${BATCH_REJECT_ENDPOINT}${selectionQuery()}`, {
      method: 'POST',
      body: JSON.stringify({ candidates: candidatesWithHashes, reason: 'Rejected by Codex manual review bulk review.' })
    })
    const payload = await response.json()
    if (!payload.ok) {
      throw new Error(payload.error?.message || 'Batch reject failed.')
    }
    await loadDashboard({ renderAfter: false })
    const results = Array.isArray(payload.data?.results) ? payload.data.results : []
    const rejectedIds = new Set(results.filter((result) => result.action === 'reject').map((result) => result.id))
    state.selectedPendingIds = state.selectedPendingIds.filter((id) => !rejectedIds.has(id))
    state.receipt = payload.data?.receipt || null
    state.pendingAction = null
    state.actionError = ''
    if (rejectedIds.has(state.selectedPendingId)) {
      state.selectedPendingId = ''
    }
  } catch (error) {
    state.actionError = errorMessage(error)
  }
  render()
}

function selectionQuery() {
  const params = new URLSearchParams()
  params.set('scope', state.memoryScope)
  if (state.selectedProjectId) params.set('projectId', state.selectedProjectId)
  return `?${params.toString()}`
}

function actionBody(action, candidate, formData) {
  const body = { reviewHash: candidate.reviewHash || '' }
  if (action === 'reject' || action === 'defer') {
    body.reason = String(formData.get('reason') || '').trim()
  }
  if (action === 'defer') {
    const days = Number(formData.get('days') || 7)
    body.days = Number.isFinite(days) ? days : 7
  }
  if (action === 'edit') {
    const candidateKind = String(formData.get('candidateKind') || '').trim()
    const tags = String(formData.get('tags') || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const usefulnessText = String(formData.get('usefulness') || '').trim()
    const usefulness = Number(usefulnessText)
    const patch = {
      content: String(formData.get('content') || '').trim()
    }
    if (candidateKind) patch.candidateKind = candidateKind
    if (tags.length > 0) patch.tags = tags
    if (usefulnessText !== '' && Number.isFinite(usefulness)) patch.scores = { usefulness }
    body.changeNote = String(formData.get('changeNote') || '').trim()
    body.patch = patch
  }
  return body
}

function selectedPending() {
  return listPending().find((candidate) => candidate.id === state.selectedPendingId)
}

function findActiveMemoryById(id) {
  return listActive().find((memory) => memory.id === id)
}

function memoryTierLabel(memory) {
  if (memory?.confidenceTier === 'trial') return 'Trial'
  if (memory?.confidenceTier === 'validated') return 'Validated'
  if (memory?.confidenceTier === 'project_core') return 'Project Core'
  if (memory?.confidenceTier === 'global_core') return 'Global Core'
  return 'Invalid Tier'
}

function reviewQueueStatusLabel(status) {
  if (status === 'pending') return 'manual review'
  return status || 'manual review'
}

function selectedProjectOption() {
  const projects = Array.isArray(state.dashboard.projects?.projects) ? state.dashboard.projects.projects : []
  const selectedProjectId = state.selectedProjectId || selectionInfo(state.dashboard).projectId || state.dashboard.projects?.currentProjectId || ''
  return projects.find((project) => project.projectId === selectedProjectId)
}

function actionLabel(action) {
  if (action === 'reject_batch') return 'Reject batch'
  if (action === 'approve') return 'Approve'
  if (action === 'reject') return 'Reject'
  if (action === 'defer') return 'Defer'
  if (action === 'edit') return 'Edit'
  return 'Review'
}

function activeActionLabel(action) {
  if (action === 'tombstone') return 'Tombstone'
  if (action === 'propose-edit') return 'Propose edit'
  if (action === 'supersede') return 'Supersede'
  return 'Archive'
}

function sectionHeader(title, subtitle) {
  return `
    <header class="section-header">
      <p class="eyebrow">${escapeHtml(subtitle)}</p>
      <h2>${escapeHtml(title)}</h2>
    </header>
  `
}

function metric(label, value, note) {
  return `
    <div class="soft-panel metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <small>${escapeHtml(note)}</small>
    </div>
  `
}

function panel(title, body, tone) {
  return `
    <div class="soft-panel notice ${escapeHtml(tone || 'muted')}">
      <h3>${escapeHtml(title)}</h3>
      <p>${body}</p>
    </div>
  `
}

function renderModelConfigPanel() {
  const config = state.dashboard.modelConfig || {}
  const missing = Array.isArray(config.missing) ? config.missing : []
  const title = config.configured ? 'Model configured' : 'Model config needed for harvest'
  const body = config.configured
    ? `Model ${escapeHtml(config.model || 'configured')} at ${escapeHtml(config.baseUrl || 'configured endpoint')}. API key: ${escapeHtml(config.apiKeyPreview || 'not set')}.`
    : `Reviewing existing memory works without a key. Harvest and model summaries need ${escapeHtml(missing.join(', ') || 'CYRENE_BASE_URL and CYRENE_MODEL')}; set CYRENE_API_KEY if the provider requires bearer auth.`
  return panel(title, body, config.configured ? 'muted' : 'warn')
}

function renderRetrievalExplainPanel() {
  return `
    <div class="soft-panel">
      <h3>Retrieval Explain</h3>
      ${renderRetrievalPlan(state.dashboard.diagnostics?.retrievalPlan)}
      ${renderRetrievalReasons(state.dashboard.diagnostics?.retrievalExplain)}
    </div>
  `
}

function renderRetrievalPlan(plan) {
  if (!plan) return emptyState('No retrieval diagnostics returned.')
  return `
    <ul class="explain-list">
      ${explainListItem('Task intent', plan.taskIntent)}
      ${explainListItem('Memory kinds', plan.memoryKinds)}
      ${explainListItem('Required facets', plan.requiredFacets)}
      ${explainListItem('Optional facets', plan.optionalFacets)}
    </ul>
  `
}

function explainListItem(label, values) {
  const textValue = Array.isArray(values) && values.length > 0 ? values.join(', ') : 'none'
  return `<li class="soft-inset rail-item"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(textValue)}</span></li>`
}

function renderRetrievalReasons(explain) {
  const rows = [
    ...(Array.isArray(explain?.projectMemory) ? explain.projectMemory : []),
    ...(Array.isArray(explain?.globalMemory) ? explain.globalMemory : []),
    ...(Array.isArray(explain?.similarProjectHints) ? explain.similarProjectHints : [])
  ]
  if (rows.length === 0) return emptyState('No retrieved memory reasons returned.')
  return `
    <ul class="explain-list">
      ${rows.slice(0, 6).map((item) => {
        const reasons = Array.isArray(item.explain) && item.explain.length > 0 ? item.explain.join(', ') : 'none'
        return `<li class="soft-inset rail-item"><strong>${escapeHtml(item.id || 'memory')}</strong><span>${escapeHtml(reasons)}</span></li>`
      }).join('')}
    </ul>
  `
}

function renderTimelineDiagnostic() {
  const failures = listSummaries().filter((summary) => summary.status === 'failed')
  if (failures.length === 0) return ''
  const latest = failures[0]
  const reason = latest.failureReason || latest.summary || 'Stop hook summary failed.'
  return panel(
    'Stop Hook summaries failing',
    `${escapeHtml(String(failures.length))} failed summary records in this scope. Latest: ${escapeHtml(reason)}`,
    'error'
  )
}

function statusChip(label, value, tone) {
  return `<span class="status-chip ${escapeHtml(tone || 'muted')}"><b>${escapeHtml(label)}</b>${escapeHtml(value)}</span>`
}

function readinessTone(status) {
  if (status === 'ready') return 'ok'
  if (status === 'needs_rewrite') return 'warn'
  return 'muted'
}

function recommendationTone(recommendation) {
  if (recommendation === 'promote') return 'ok'
  if (recommendation === 'reject') return 'error'
  if (recommendation === 'defer') return 'warn'
  return 'muted'
}

function riskTone(risk) {
  if (risk === 'high') return 'error'
  if (risk === 'medium') return 'warn'
  if (risk === 'low') return 'muted'
  return 'warn'
}

function scopeLabel(scope) {
  if (scope === 'global') return 'Global'
  return 'Project'
}

function selectionMeta(selection) {
  if (selection.scope === 'global') return 'Global memory'
  return `Project · ${selection.projectId || 'unknown'}`
}

function emptyState(textValue) {
  return `<div class="soft-inset empty-state">${escapeHtml(textValue)}</div>`
}

function listPending() {
  return Array.isArray(state.dashboard.pending.pending) ? state.dashboard.pending.pending : []
}

function listActive() {
  return Array.isArray(state.dashboard.active.active) ? state.dashboard.active.active : []
}

function listSummaries() {
  return Array.isArray(state.dashboard.reviewSummaries.summaries) ? state.dashboard.reviewSummaries.summaries : []
}

function listSignals() {
  return Array.isArray(state.dashboard.signals.signals) ? state.dashboard.signals.signals : []
}

function shortHash(value) {
  return String(value).slice(0, 10)
}

function text(value) {
  return String(value || 'unknown')
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export { TABS, WRITE_ACTION_COPY, escapeHtml }
