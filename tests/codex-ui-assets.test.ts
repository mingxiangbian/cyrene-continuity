import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Codex UI source assets', () => {
  it('contains the Warm Cream Coral console shell and v1 read-only labels', async () => {
    const [html, js, css] = await Promise.all([
      readFile(new URL('../src/ui/static/index.html', import.meta.url), 'utf8'),
      readFile(new URL('../src/ui/static/app.js', import.meta.url), 'utf8'),
      readFile(new URL('../src/ui/static/styles.css', import.meta.url), 'utf8')
    ])

    expect(html).toContain('Cyrene Memory Console')

    for (const label of ['Overview', 'Inbox', 'Timeline', 'Project Memory', 'Harvester', 'Dream', 'Profile']) {
      expect(js).toContain(label)
    }
    expect(js).toContain('Write actions disabled in v1')
    expect(js).toContain('No pending memory was written')
    expect(js).toContain('/api/memory/harvest-project/dry-run')
    expect(js).toContain("result.action === 'needs_model_config'")
    expect(js).toContain("result.action === 'noop'")
    expect(js).toContain("typeof result.reason === 'string'")
    expect(js).toContain('result.reason.trim()')
    expect(js).toContain('No preview candidates were produced.')

    for (const unsafeRoute of [
      '/api/memory/approve',
      '/api/memory/reject',
      '/api/memory/edit',
      '/api/memory/defer',
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

    for (const className of ['.soft-panel', '.soft-inset', '.soft-button', '.status-chip']) {
      expect(css).toContain(className)
    }
  })
})
