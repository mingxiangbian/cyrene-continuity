# Agent Guidance

Scope: this file applies to the whole repository.

## Working Rules

- Make surgical changes that trace directly to the requested issue or task.
- Keep documentation, source, tests, generated runtime, and review artifacts in
  their existing ownership lanes.
- Do not edit `REVIEW_REPORT.md` unless the user explicitly asks for report
  coordination.
- Do not edit generated plugin runtime files directly; update source and rebuild
  when runtime changes are requested.
- Preserve the v5 memory review model: high-risk or ambiguous memory still
  requires explicit user approval and review-hash validation. Strict low-risk
  project/global memory may auto-promote only through named v5 policy, daily
  caps, eval gates, and auditable `MemoryEvent` receipts.

## Verification

- For documentation-only changes, run `git diff --check`.
- If `plugin/skills/cyrene-continuity/SKILL.md` changes, also run
  `npm run build:plugin` and
  `python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin`.
- Run `npm run typecheck` when command examples or documented contracts change
  enough that TypeScript-facing behavior may be affected.
