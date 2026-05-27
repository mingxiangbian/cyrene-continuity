# cyrene-continuity

Local-first continuity bridge for Codex. This repository packages Cyrene as an
independent Codex plugin with a bundled MCP server, a Codex skill, and local
memory maintenance commands.

## Plugin Features

- Codex plugin manifest at `plugin/.codex-plugin/plugin.json`.
- Plugin MCP server named `cyrene-continuity`, declared in `plugin/.mcp.json`.
- Bundled runtime at `plugin/runtime/cyrene-continuity.mjs`, built from
  `src/main.ts`.
- Stable executable shim at `~/.cyrene/codex/bin/cyrene-continuity`, written by
  `cyrene-continuity codex install --plugin`.
- Codex skill at `plugin/skills/cyrene-continuity/SKILL.md`.
- Optional Codex Stop hook that records review-safe continuity summaries and
  pending memory candidates.

## MCP Tools

The plugin MCP server exposes:

- `cyrene_project_identify`: identify the current Cyrene project namespace.
- `cyrene_continuity_get`: read compact continuity context, response strategy,
  and principled dissent hints.
- `cyrene_memory_propose`: write a pending-only memory candidate for review.
- `cyrene_memory_pending_list`: list pending memory candidates.
- `cyrene_memory_pending_get`: read one pending candidate.
- `cyrene_memory_promote`: promote a pending candidate only after explicit user
  approval and review-hash validation.
- `cyrene_memory_reject`: reject a pending candidate only after explicit user
  rejection and review-hash validation.
- `cyrene_memory_dream_run`: run light, REM, or deep memory maintenance.
- `cyrene_memory_profile_get`: read the effective global and project
  `MODEL_PROFILE.md` context.

## Install

Build the standalone plugin runtime before installing the plugin bridge:

```bash
npm install
npm run build:plugin
npm run dev -- codex install --plugin
```

After validating the installed plugin MCP server in a new Codex session, disable
or remove any manual Cyrene MCP config such as
`[mcp_servers."cyrene-continuity"]` or legacy `[mcp_servers.cyrene]`. The plugin
declares its own MCP server, so keeping a manual server enabled can create
duplicate Cyrene tools.

For source-checkout development, use:

```bash
npm run dev -- codex install --dev
```

## Commands

```bash
npm run build:plugin
npm run dev -- mcp-server --stdio
npm run dev -- codex doctor
npm run dev -- codex install --dev
npm run dev -- codex install --plugin
npm run dev -- codex install-hook --stop
npm run dev -- codex hook stop
npm run dev -- codex eval run --check similar-hints
npm run dev -- codex memory db rebuild
npm run dev -- codex memory dream --stage deep
npm run dev -- codex memory maintenance
npm run dev -- codex memory profile
```

## Similar-Project Hints

`cyrene_continuity_get` can return `similarProjectHints` when another indexed
project has explicitly portable `similar_project` or `project_family` memory.
These hints are transferable guidance, not facts about the current project.
`local_only`, personal, relationship, and affective memories are excluded by
policy and by the deterministic eval gate.

## Verify

```bash
npm test
npm run typecheck
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
```

## Data

This repo reads and writes existing local data under:

```txt
~/.cyrene/codex/global/memory/
~/.cyrene/codex/projects/<projectId>/memory/
~/.cyrene/codex/memory.db
```

It does not migrate or copy user memory data during install. `memory.db` is the
runtime SQLite/FTS retrieval index. JSONL files remain the audit/recovery source
of truth, and generated Markdown profiles remain review/debug projections.

## Review Policy

Pending memory candidates are not active memory. Promotion requires explicit user approval and a matching review hash.
