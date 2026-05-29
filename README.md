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
- Bundled Codex lifecycle hooks at `plugin/hooks/hooks.json` for
  `SessionStart`, `UserPromptSubmit`, `PostToolUse`, and `Stop`.

The bundled lifecycle hooks capture project activity signals during a Codex
session. The Stop hook writes review-safe session summaries and may propose
pending candidates. It is fail-open for Codex sessions, records failed summary
runs in `review-summaries.jsonl`, and never promotes, rejects, or updates active
memory/profile files from hook execution.

The older `codex install-hook --stop` and `codex hook stop` commands remain
available as compatibility entrypoints for manual hook installs and existing
configurations. New plugin installs should rely on the bundled
`plugin/hooks/hooks.json` lifecycle config.

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
- `cyrene_memory_edit`: edit a pending candidate after review-hash validation;
  the edited candidate remains pending.
- `cyrene_memory_defer`: defer a pending candidate after review-hash validation;
  this never promotes active memory.
- `cyrene_memory_dream_run`: run light, REM, deep-preview, or gated deep-apply
  memory maintenance. Dream can recommend promotions for review, but it does
  not promote unapproved pending memory.
- `cyrene_memory_profile_get`: read the effective global and project
  `MODEL_PROFILE.md` context.
- `cyrene_memory_harvest_project`: harvest current-project signals into
  pending-only project memory candidates. Use `dryRun` to preview candidates
  without writing pending review items. The tool uses the MCP server fallback
  working directory and does not accept a `cwd` input.

## Install

Build the standalone plugin runtime before installing the plugin bridge:

```bash
npm install
npm run build:plugin
npm run dev -- codex install --plugin
```

`codex install --plugin` installs/refreshes the Codex plugin bridge under the
user Codex plugin directory. Start a new Codex session after this step so plugin
discovery reloads the bundled MCP server and skill from `plugin/`.

After validating the installed plugin MCP server in the new Codex session, disable
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
npm run dev -- codex ui [--port <n>]
npm run dev -- codex install --dev
npm run dev -- codex install --plugin
npm run dev -- codex install-hook --stop
npm run dev -- codex hook stop
npm run dev -- codex project status
npm run dev -- codex project list
npm run dev -- codex project alias <projectId> <alias>
npm run dev -- codex project merge <fromProjectId> <toProjectId>
npm run dev -- codex eval run --check similar-hints
npm run dev -- codex eval run --check release
npm run dev -- codex memory status
npm run dev -- codex memory dashboard
npm run dev -- codex memory review
npm run dev -- codex memory approve <candidateId> --review-hash <hash>
npm run dev -- codex memory reject <candidateId> --review-hash <hash>
npm run dev -- codex memory edit <candidateId> --review-hash <hash> --content <text>
npm run dev -- codex memory defer <candidateId> --review-hash <hash> --days 7
npm run dev -- codex memory db rebuild
npm run dev -- codex memory harvest-project [--dry-run] [--changed-files] [--since last-summary]
npm run dev -- codex memory dream --stage deep-preview
npm run dev -- codex memory dream report --root project
npm run dev -- codex memory dream --stage deep-apply
npm run dev -- codex memory maintenance
npm run dev -- codex memory profile
npm run dev -- codex profile reflect --source daily-interview
npm run dev -- codex profile apply --candidate <candidateId> --review-hash <hash>
npm run dev -- codex similar-hints explain --source-project-id <projectId>
npm run dev -- codex similar-hints mark-transferable --memory-id <memoryId> --review-hash <hash>
```

`cyrene-continuity codex ui` starts a local-only Web UI on
`http://127.0.0.1:47833` by default. If that port is busy, the server tries the
following ports and prints the bound URL. Pass `--port <n>` to request a
specific port, or `--port 0` to let the operating system choose an available
local port.

The v1 Web UI is a read-first visibility console for Overview, Inbox, Timeline,
Project Memory, Harvester, Dream, and Profile views. It shows pending review
candidates, review summaries, active project memory, project harvester signals,
Dream state, and profile text from the local Cyrene data store. The review
console is read-only: approve, reject, edit, and defer actions are disabled in
the browser. Use `codex memory review` to inspect candidate metadata, then use
`codex memory approve|reject|edit|defer <candidateId> --review-hash <hash>` for
decisions that write review state. The Harvester view only runs
`harvest-project` dry-run preview from the UI; it does not write pending memory,
active memory, or profiles.

`deep-preview` is the default safe dream stage. It writes review artifacts under
`dream-preview/` and does not promote, reject, or tombstone memory. `deep-apply`
recomputes the proposal, runs the deterministic eval gate, may reject or expire
gated unsafe pending memory, and writes recommendation artifacts. It does not
promote unapproved pending memory; use pending review tools with explicit user
approval and review-hash validation for active promotion.

`CYRENE_MEMORY_RECOMMEND_PROMOTION=0` disables Dream promotion
recommendations while preserving pending candidates. The older
`CYRENE_MEMORY_AUTO_PROMOTE` variable is deprecated and read only as
recommendation-generation compatibility; it no longer enables unapproved active
promotion.

`codex memory harvest-project` extracts durable project memory candidates from
git changes, project files, lifecycle hook traces, and recent review summaries.
It emits candidates such as project facts, decisions, workflow rules, known
pitfalls, rejected approaches, and open questions. Normal runs write only
pending review candidates. `--dry-run` previews the harvest without writing
pending items, `--changed-files` limits signal collection to changed files, and
`--since last-summary` is accepted as a compatibility selector.

Project memory harvesting needs the existing Cyrene model configuration before
it can run LLM extraction. Do not write API keys into this repository. Configure
the model through the existing environment/config path, such as
`CYRENE_BASE_URL`, `CYRENE_MODEL`, and the matching provider API key expected by
that provider. If model configuration is missing, the command returns
`needs_model_config` and does not write pending candidates; dry-run remains safe
for diagnostics.

Profile reflection writes reviewable candidates to `profile_candidates.jsonl`;
applying a candidate requires the matching review hash and regenerates
`MODEL_PROFILE.md` from structured memory. Similar-project memory must be
explicitly marked transferable before it can appear in cross-project hints.
Current always-on global/profile context still comes from approved active
memory: profile reflection proposes profile candidates, and profile apply
requires review-hash validation before rendering `MODEL_PROFILE.md`. The
project harvester creates project-scope pending candidates by default; it does
not create global active memory or mutate profiles directly.

Embedding retrieval is disabled by default. Set `CYRENE_EMBEDDING_PROVIDER` only
when a safe provider is configured; unsafe content or provider failures fall
back to structured FTS retrieval with diagnostics.

## Project Tools

Use `cyrene-continuity codex project status` and
`cyrene-continuity codex project list` to inspect projectId drift. Use
`cyrene-continuity codex project alias <projectId> <alias>` to label a known
project root, and `cyrene-continuity codex project merge <from> <to>` to
explicitly merge split project memory. Alias and merge never run implicitly from
retrieval. Project merges are blocked when the source active memory contains
personal, relationship, or affective domains, because those memories must not be
migrated across project IDs as generic project context.

## Similar-Project Hints

`cyrene_continuity_get` can return `similarProjectHints` when another indexed
project has explicitly portable `similar_project` or `project_family` memory.
These hints are transferable guidance, not facts about the current project.
`local_only`, personal, relationship, and affective memories are excluded by
policy and by the deterministic eval gate.

## Eval Gates

Deterministic gates protect retrieval, review, apply, and release paths:

- `memory_routing_eval`: active, pending, and similar-project memories must stay
  in their explicit routes.
- `pending_usage_eval`: Dream apply cannot promote assistant-observed or
  unauditable pending memory.
- `profile_pollution_eval`: profile apply must trace to approved active memory
  and profile previews cannot include pending-only content.
- `affective_boundary_eval`: diagnostic affective claims are blocked from
  profile and Dream apply outputs.
- `cross_project_leak_eval`: same-project, global, local-only, or missing-home
  similar hints are rejected, and personal, relationship, or affective memory is
  not migrated across project IDs.
- `similar_hint_eval`: similar-project hints must be explicitly transferable and
  scrubbed of absolute paths, raw remotes, and secret-like values.

`codex eval run --check similar-hints` reports the live similar-project hint
boundary result. `codex eval run --check release` reports the minimum gate
checklist expected before plugin release; it does not replace the verification
commands below.

## Verify

```bash
npm test
npm run typecheck
npm run build:plugin
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

Pending memory candidates are not active memory. Promotion requires explicit
user approval and a matching review hash. `codex memory review` shows the
candidate metadata needed for approval, rejection, edit, or deferral.
