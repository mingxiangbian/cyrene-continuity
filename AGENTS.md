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
- Preserve the pending-only memory review model: docs must not imply automatic
  promotion, rejection, profile mutation, or active-memory writes without
  explicit user approval and review-hash validation.

## Verification

- For documentation-only changes, run `git diff --check`.
- If `plugin/skills/cyrene-continuity/SKILL.md` changes, also run
  `npm run build:plugin` and
  `python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin`.
- Run `npm run typecheck` when command examples or documented contracts change
  enough that TypeScript-facing behavior may be affected.
