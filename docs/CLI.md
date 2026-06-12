# CLI Reference

Use the source checkout during development and the stable shim after installing
the Codex plugin.

Source checkout prefix:

```bash
npm run dev -- <command>
```

Installed stable shim prefix:

```bash
~/.cyrene/codex/bin/cyrene-continuity <command>
```

For example, these two commands run the same doctor check from different
entrypoints:

```bash
npm run dev -- codex doctor
~/.cyrene/codex/bin/cyrene-continuity codex doctor
```

## Runtime And Install

```bash
npm run build:plugin
npm run dev -- mcp-server --stdio
npm run dev -- codex doctor
npm run dev -- codex ui [--port <n>]
npm run dev -- codex install --dev
npm run dev -- codex install --plugin
npm run dev -- codex install-hook --stop [--dry-run]
```

`codex install --plugin` installs the plugin bridge and stable shim at
`~/.cyrene/codex/bin/cyrene-continuity`. Restart Codex after plugin install so
the bundled MCP server, skill, and lifecycle hooks are rediscovered.

`codex install --dev` registers a source-checkout bridge for development.

`codex install-hook --stop` is a compatibility command for older manual hook
installs. New plugin installs should rely on `plugin/hooks/hooks.json`.

## Lifecycle Hooks

```bash
npm run dev -- codex hook session-start
npm run dev -- codex hook user-prompt-submit
npm run dev -- codex hook post-tool-use
npm run dev -- codex hook stop
```

Hooks are fail-open for Codex. They may capture project activity signals and
review-safe summaries, but high-risk or ambiguous memory remains in manual
review.

## Project Tools

```bash
npm run dev -- codex project status
npm run dev -- codex project list
npm run dev -- codex project alias <projectId> <alias>
npm run dev -- codex project merge <fromProjectId> <toProjectId>
```

Use these commands to inspect project ID drift, assign aliases, and explicitly
merge compatible project roots. Merge never runs implicitly from retrieval.

## Benchmarks And Eval Gates

```bash
npm run dev -- codex benchmark run --profile smoke
npm run dev -- codex benchmark run --profile gate
npm run dev -- codex benchmark run --profile full
npm run dev -- codex benchmark run --profile scale
npm run dev -- codex benchmark run --profile real-replay
npm run dev -- codex benchmark run --profile llm
npm run dev -- codex benchmark run --profile external
npm run dev -- codex benchmark run --profile gate [--output-dir <path>] [--artifact-archive-dir <path>] [--baseline <path>] [--preserve-fixtures]
npm run dev -- codex eval run --check similar-hints
npm run dev -- codex eval run --check release
```

Use `smoke` for a fast sanity check and `gate` for release validation. Local
runs write `benchmark_report.json` and `benchmark_report.md` to
`benchmark-results/` unless `--output-dir <path>` is provided.

## Memory Review

```bash
npm run dev -- codex memory status
npm run dev -- codex memory dashboard
npm run dev -- codex memory review [--limit <n>]
npm run dev -- codex memory approve <candidateId> --review-hash <hash> [--conflict-resolution supersede|keep-both|reject-new]
npm run dev -- codex memory reject <candidateId> --review-hash <hash>
npm run dev -- codex memory edit <candidateId> --review-hash <hash> --content <text>
npm run dev -- codex memory defer <candidateId> --review-hash <hash> [--days <n>]
```

Pending memory is not active memory. Approve, reject, edit, and defer commands
require the current review hash.

## Memory Context And Feedback

```bash
npm run dev -- codex memory context-preview --message "..." [--task coding|planning|debugging|conversation|memory] [--mode fast|balanced|review] [--include-similar-project-hints] [--include-pending-details] [--include-pending-notice] [--include-diagnostics] [--record-retrieved-events] [--allow-jsonl-fallback] [--max-tokens <n>]
npm run dev -- codex memory feedback <memoryId> --content-hash <hash> --event applied --query "..."
npm run dev -- codex memory feedback <memoryId> --content-hash <hash> --event ignored [--activation-id <id>] [--evidence-ref <ref>] [--reason <text>]
npm run dev -- codex memory feedback <memoryId> --content-hash <hash> --event applied --activation-id candidate-hint:<hintId> --candidate-hint-receipt '<json>' --query "..."
npm run dev -- codex memory feedback <memoryId> --content-hash <hash> --event ignored --activation-id candidate-hint:<hintId> --candidate-hint-receipt '<json>'
npm run dev -- codex memory feedback <memoryId> --content-hash <hash> --event corrected [--reason <text>]
npm run dev -- codex memory feedback <memoryId> --content-hash <hash> --event violated [--reason <text>]
```

`fast` is the ordinary read mode. `balanced` reads richer active/session context.
`review` is required for pending review content, counts, and diagnostics. JSONL
fallback is disabled unless `--allow-jsonl-fallback` is passed.

Feedback records explicit usage evidence for active memory, or receipt-bound
Candidate Hint usage evidence when the hint was actually applied or explicitly
ignored. Raw query text is persisted as a hash, and feedback cannot promote
memory by itself.

## Memory Maintenance

```bash
npm run dev -- codex memory db rebuild
npm run dev -- codex memory jsonl repair --dry-run
npm run dev -- codex memory jsonl repair --apply
npm run dev -- codex memory summary refresh [--scope project|global]
npm run dev -- codex memory distill --dry-run
npm run dev -- codex memory harvest-project [--changed-files] [--since last-summary]
npm run dev -- codex memory harvest-project --apply --preview-id <id> --preview-hash <hash>
npm run dev -- codex memory triage [--dry-run|--apply]
npm run dev -- codex memory prepare [--dry-run|--apply] [--max-items <n>]
npm run dev -- codex memory automation --job daily --dry-run
npm run dev -- codex memory automation --job weekly --dry-run
npm run dev -- codex memory automation --job daily --apply [--all-projects]
npm run dev -- codex memory automation --job weekly --apply [--all-projects]
npm run dev -- codex memory lifecycle migrate-v1-5 [--dry-run|--apply] [--all-projects]
npm run dev -- codex memory lifecycle daily [--dry-run|--apply] [--all-projects]
npm run dev -- codex memory lifecycle weekly [--dry-run|--apply] [--all-projects]
npm run dev -- codex memory migrate-v2 [--all-projects]
npm run dev -- codex memory maintenance
npm run dev -- codex memory profile
```

Daily automation can move strict low-risk project trial memory to validated
memory and refresh fast summaries. Weekly automation can move validated project
memory to project core and consolidate safe project-core signals. High-risk,
ambiguous, personal, relationship, affective, similar-project, and
assistant-observed-only memory remains in manual review unless the user approves
it with hash validation.

### JSONL Repair

`cyrene-continuity codex memory jsonl repair --dry-run` scans canonical memory
JSONL and reports malformed lines without modifying memory.

`cyrene-continuity codex memory jsonl repair --apply` backs up original
canonical JSONL, quarantines malformed lines under
`repair/<repairTransactionId>/`, rewrites valid records atomically, and rebuilds
derived projections only after repair succeeds.

`doctor`, `status`, lifecycle automation, maintenance, migration, and context
reads never repair canonical memory implicitly. When corruption is detected,
run the dry-run first, inspect the preview, then apply repair explicitly.

### Project Harvest

`cyrene-continuity codex memory harvest-project` creates a preview artifact and
writes no memory.

`cyrene-continuity codex memory harvest-project --apply --preview-id <id> --preview-hash <hash>`
applies a matching unexpired preview without another model call. Expired,
missing, or hash-mismatched previews must be regenerated with
`cyrene-continuity codex memory harvest-project`.

## Active Memory

```bash
npm run dev -- codex memory active archive <memoryId> --content-hash <hash> --reason <text>
npm run dev -- codex memory active tombstone <memoryId> --content-hash <hash> --reason <text> [--days <n>|--indefinite] [--confirm-text <memoryId>]
npm run dev -- codex memory active propose-edit <memoryId> --content-hash <hash> --content <text> --reason <text>
npm run dev -- codex memory active supersede <memoryId> --candidate <candidateId> --content-hash <hash> --review-hash <hash> --reason <text> [--confirm-text <memoryId>]
```

Active-memory commands require a content hash. Tombstone and supersede may need
`--confirm-text <memoryId>` for high-risk memory.

## Profile And Similar Hints

```bash
npm run dev -- codex profile reflect --source daily-interview
npm run dev -- codex profile apply --candidate <candidateId> --review-hash <hash>
npm run dev -- codex similar-hints explain --source-project-id <projectId>
npm run dev -- codex similar-hints explain --memory-id <memoryId>
npm run dev -- codex similar-hints mark-transferable --memory-id <memoryId> --review-hash <hash>
```

Profile apply requires a reviewed profile candidate and matching review hash.
Similar-project hints must be explicitly transferable before they can appear in
cross-project guidance.

## Web UI

```bash
npm run dev -- codex ui
npm run dev -- codex ui --port 47833
npm run dev -- codex ui --port 0
```

The local Web UI binds to `127.0.0.1` and supports overview, manual review,
timeline, lifecycle memory, automation, tools, and profile views. It supports
hash-checked single-candidate pending review actions and dry-run project
harvester previews.

The UI does not batch approve memory, apply Memory Automation/Profile changes,
or write harvester candidates directly.

## Model Configuration

Project memory harvesting and model summaries need a local model configuration.
Reviewing existing memory does not require a model or API key.

```env
CYRENE_BASE_URL=https://api.openai.com/v1
CYRENE_MODEL=<model-name>
CYRENE_API_KEY=<provider-api-key>
```

Do not write API keys into this repository. Configure them through process
environment variables or a local `.env` file outside version control.
