const WRITE_ACTION_COPY = 'Write actions require confirmation and review hash.'
const SESSION_ENDPOINT = '/api/session'
const DRY_RUN_ENDPOINT = '/api/memory/harvest-project/dry-run'
const EMPTY_DASHBOARD = {
  status: {},
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
  { id: 'inbox', label: 'Inbox' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'project-memory', label: 'Project Memory' },
  { id: 'harvester', label: 'Harvester' },
  { id: 'dream', label: 'Dream' },
  { id: 'profile', label: 'Profile' }
]

const CONFIRM_LABELS = {
  approve: 'Confirm approve',
  reject: 'Confirm reject',
  defer: 'Confirm defer',
  edit: 'Confirm edit'
}

const state = {
  activeTab: 'overview',
  dashboard: EMPTY_DASHBOARD,
  error: '',
  sessionToken: '',
  selectedPendingId: '',
  pendingAction: null,
  receipt: null,
  actionError: '',
  harvester: { loading: false, result: null, error: '' }
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
    const response = await apiFetch('/api/dashboard')
    const payload = await response.json()
    if (!payload.ok) {
      throw new Error(payload.error?.message || 'Dashboard API returned an error.')
    }
    state.dashboard = mergeDashboard(payload.data)
    state.error = ''
  } catch (error) {
    state.dashboard = EMPTY_DASHBOARD
    state.error = errorMessage(error)
  }
  if (renderAfter) render()
}

function mergeDashboard(data) {
  return {
    ...EMPTY_DASHBOARD,
    ...(data || {}),
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
      render()
    })
  })
}

function renderTopbar() {
  const dashboard = state.dashboard
  const project = projectInfo(dashboard)
  const pendingCount = listPending().length
  const status = dashboard.status || {}
  const sqliteStatus = text(status.index?.status || status.sqlite?.status || status.fallbackMode || 'read-only')
  const modelStatus = modelLabel(status)
  const stopHook = text(status.lastStopHook?.status || status.stopHook?.status || 'visible')

  topbar.innerHTML = `
    <div>
      <p class="eyebrow">Local review console</p>
      <h2>${escapeHtml(project.displayName || 'Project Memory')}</h2>
    </div>
    <div class="chip-row" aria-label="Runtime status">
      ${statusChip('Project', project.projectId || 'unknown', 'muted')}
      ${statusChip('Stop Hook', stopHook, stopHook === 'failed' ? 'error' : 'ok')}
      ${statusChip('Pending', String(pendingCount), pendingCount > 0 ? 'warn' : 'ok')}
      ${statusChip('SQLite', sqliteStatus, sqliteStatus === 'stale' ? 'warn' : 'muted')}
      ${statusChip('Model', modelStatus, modelStatus === 'configured' ? 'ok' : 'warn')}
    </div>
  `
}

function projectInfo(dashboard) {
  for (const candidate of [dashboard.pending?.project, dashboard.active?.project, dashboard.projectMemory?.project]) {
    if (candidate?.projectId || candidate?.displayName) return candidate
  }
  return {}
}

function modelLabel(status) {
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
  workspace.querySelectorAll('[data-pending-id]').forEach((row) => {
    row.addEventListener('click', () => {
      state.activeTab = 'inbox'
      state.selectedPendingId = row.dataset.pendingId || ''
      state.pendingAction = null
      state.receipt = null
      state.actionError = ''
      render()
    })
  })
}

function pageHtml(tabId) {
  if (tabId === 'inbox') return renderInbox()
  if (tabId === 'timeline') return renderTimeline()
  if (tabId === 'project-memory') return renderProjectMemory()
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
  return `
    <section class="page-stack">
      ${sectionHeader('Overview', 'Visibility for the memory pipeline.')}
      <div class="metric-grid">
        ${metric('Pending', pending.length, 'Awaiting review')}
        ${metric('Active', active.length, 'Project memories')}
        ${metric('Summaries', summaries.length, 'Stop Hook records')}
        ${metric('Signals', signals.length, 'Harvester inputs')}
      </div>
      <div class="soft-panel">
        <h3>Recent pending candidates</h3>
        ${pending.slice(0, 3).map(renderCandidateRow).join('') || emptyState('No pending candidates.')}
      </div>
      <div class="soft-panel">
        <h3>Recent timeline</h3>
        ${summaries.slice(0, 4).map(renderSummaryRow).join('') || emptyState('No review summaries yet.')}
      </div>
    </section>
  `
}

function renderInbox() {
  const pending = listPending()
  return `
    <section class="page-stack">
      ${sectionHeader('Inbox', 'Pending hypotheses stay provisional until explicit review.')}
      <div class="soft-inset boundary-copy">${escapeHtml(WRITE_ACTION_COPY)}</div>
      <div class="soft-panel">
        <h3>Pending candidates</h3>
        ${pending.map(renderCandidateRow).join('') || emptyState('No pending candidates.')}
      </div>
    </section>
  `
}

function renderCandidateRow(candidate) {
  const selected = state.selectedPendingId === candidate.id
  return `
    <article class="data-row candidate-row selectable-row ${selected ? 'selected' : ''}" data-pending-id="${escapeHtml(candidate.id)}">
      <div>
        <div class="row-title">${escapeHtml(candidate.content || candidate.id || 'Pending candidate')}</div>
        <div class="row-meta">
          ${escapeHtml(candidate.candidateKind || candidate.type || 'memory')}
          ${candidate.reviewHash ? ` · review ${escapeHtml(shortHash(candidate.reviewHash))}` : ''}
        </div>
      </div>
      ${statusChip(candidate.recommendation || 'review', candidate.risk || 'pending', candidate.risk === 'high' ? 'error' : 'warn')}
    </article>
  `
}

function renderTimeline() {
  const summaries = listSummaries()
  return `
    <section class="page-stack">
      ${sectionHeader('Timeline', 'Stop Hook review summaries and linked pending ids.')}
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
  return `
    <section class="page-stack">
      ${sectionHeader('Project Memory', 'Active project memory grouped by kind.')}
      ${groups.length > 0 ? groups.map((group) => `
        <div class="soft-panel">
          <h3>${escapeHtml(group.label || 'Project memory')}</h3>
          ${(group.memories || []).map(renderMemoryRow).join('') || emptyState('No active memories in this group.')}
        </div>
      `).join('') : panel('Project memory unavailable', 'No grouped project memory returned yet.', 'muted')}
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
      ${statusChip('active', memory.status || 'active', 'ok')}
    </article>
  `
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
      : panel('Dry-run ready', 'Preview project-scope candidates without writing pending memory.', 'muted')

  return `
    <section class="page-stack">
      ${sectionHeader('Harvester', 'Run a project-memory dry-run preview.')}
      <div class="soft-panel action-panel">
        <div>
          <h3>Project harvester</h3>
          <p>No pending memory was written.</p>
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
      <div class="soft-inset">Action: ${escapeHtml(result.action || 'preview')} · No pending memory was written.</div>
      ${reason}
      ${warnings.map((warning) => `<p class="notice warn">${escapeHtml(warning)}</p>`).join('')}
      ${candidates.map(renderPreviewCandidateRow).join('') || emptyState(emptyCopy)}
    </div>
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
  if (state.activeTab === 'inbox' && state.receipt) {
    detailRail.innerHTML = renderReceipt()
    bindDetailRailActions(selected)
    return
  }
  if (state.activeTab === 'inbox' && selected) {
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
      <div class="soft-panel">
        <h3>Project signals</h3>
        ${signals.slice(0, 5).map((signal) => `
          <div class="soft-inset rail-item">
            <strong>${escapeHtml(signal.kind || 'signal')}</strong>
            <span>${escapeHtml((signal.files || signal.paths || []).slice(0, 2).join(', ') || 'detected')}</span>
          </div>
        `).join('') || emptyState('No signals found.')}
      </div>
      <div class="soft-panel">
        <h3>Review queue</h3>
        <p>${escapeHtml(String(pending.length))} pending candidates</p>
      </div>
    </div>
  `
}

function renderPendingDetail(candidate) {
  if (state.pendingAction) return renderConfirmForm(candidate, state.pendingAction)
  return `
    <div class="rail-stack">
      <div class="soft-panel">
        <h3>Pending detail</h3>
        <p>${escapeHtml(candidate.content)}</p>
        <div class="soft-inset rail-item"><strong>reviewHash</strong><span>${escapeHtml(shortHash(candidate.reviewHash || ''))}</span></div>
        ${renderEvidence(candidate)}
      </div>
      <div class="soft-panel">
        <h3>Actions</h3>
        <p>${escapeHtml(WRITE_ACTION_COPY)}</p>
        <div class="detail-actions">
          ${['approve', 'reject', 'defer', 'edit'].map((action) => `
            <button class="soft-button compact" type="button" data-action="${action}">${escapeHtml(actionLabel(action))}</button>
          `).join('')}
        </div>
        ${state.actionError ? `<p class="notice error">${escapeHtml(state.actionError)}</p>` : ''}
      </div>
    </div>
  `
}

function renderEvidence(candidate) {
  const evidence = Array.isArray(candidate.evidenceSummary) ? candidate.evidenceSummary : []
  return `
    <div class="evidence-list">
      <h3>Evidence</h3>
      ${evidence.slice(0, 4).map((item) => `<div class="soft-inset rail-item">${escapeHtml(item)}</div>`).join('') || emptyState('No evidence summary returned.')}
    </div>
  `
}

function renderConfirmForm(candidate, action) {
  const confirmTitle = CONFIRM_LABELS[action] || 'Confirm action'
  const reasonField = action === 'reject' || action === 'defer'
    ? `
      <label>Reason
        <textarea name="reason" rows="3" required placeholder="Required review reason"></textarea>
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
        <button class="soft-button compact" type="button" data-clear-receipt>Back to queue</button>
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
    const response = await apiFetch(`/api/memory/${encodeURIComponent(candidate.id)}/${action}`, {
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

function actionLabel(action) {
  if (action === 'approve') return 'Approve'
  if (action === 'reject') return 'Reject'
  if (action === 'defer') return 'Defer'
  if (action === 'edit') return 'Edit'
  return 'Review'
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

function statusChip(label, value, tone) {
  return `<span class="status-chip ${escapeHtml(tone || 'muted')}"><b>${escapeHtml(label)}</b>${escapeHtml(value)}</span>`
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
