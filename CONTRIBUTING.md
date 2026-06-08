# Contributing

Cyrene Continuity is a local-first Codex plugin that packages an MCP server,
Codex skill, lifecycle hooks, and memory maintenance commands. Keep changes
small, reviewable, and limited to the requested behavior.

## Prerequisites

- Node.js `>=22.5.0`
- npm `>=10`

Install dependencies with:

```bash
npm ci
```

## Development

Run source-checkout commands through the dev entrypoint:

```bash
npm run dev --
```

For example:

```bash
npm run dev -- codex doctor
npm run dev -- mcp-server --stdio
npm run dev -- codex memory status
```

Build the bundled plugin runtime before installing or testing plugin packaging:

```bash
npm run build:plugin
```

Do not edit generated plugin runtime files directly. Update source files and run
`npm run build:plugin` so generated runtime changes are reproducible.

## Verification

Run the checks that match your change:

```bash
npm test
npm run typecheck
git diff --check
```

Documentation-only changes should at least pass `git diff --check`. Changes that
alter TypeScript-facing behavior or documented command contracts should also run
`npm run typecheck`. Plugin packaging changes should run `npm run build:plugin`.

## Benchmarks

Local benchmark runs write output to `benchmark-results/` by default. Treat that
directory as local run output unless a maintainer asks for it.

Curated benchmark reports belong under `benchmark/reports/<date>/` and should be
intentional, reviewed artifacts. Do not mix local scratch output with curated
benchmark reports.

## Privacy

Do not commit `.cyrene/` data, `.env` files, private memory exports, API keys, or
other local user data. Avoid pasting private memory into issues, pull requests,
commit messages, tests, fixtures, or documentation.
