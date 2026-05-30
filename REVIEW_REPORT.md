# Repository Review Report

Status legend: `Open`, `Fixed`, `Partially fixed`, `Deferred`.

`Deferred` means the issue remains unresolved and was intentionally left out of
the current fix batch.

## Verification Baseline

- `npm test`: passed, 25 files / 284 tests.
- `npm run typecheck`: passed.
- Plugin validation: passed with local plugin-creator validator.
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: passed.
- `git status --short`: clean before fixes.

## Issues

| ID | Severity | Area | Status | Finding |
| --- | --- | --- | --- | --- |
| R1 | P1 | Security/privacy | Fixed | Redaction misses common live secrets before LLM submission. |
| R2 | P1 | Security/privacy | Fixed | MCP tools accept caller-controlled `cwd`, enabling cross-project memory access. |
| R3 | P1 | Memory/promotion | Fixed | Review output suggests executable approve commands before explicit user approval. |
| R4 | P1 | Memory/promotion | Fixed | Profile reflection can turn personal safe-summary memory into raw always-on profile text. |
| R5 | P1 | Tests/CI | Fixed | No CI and `codex eval run --check release` is effectively static. |
| R6 | P1 | Documentation/setup | Fixed | Fresh plugin setup docs omit Codex plugin install/refresh step. |
| R7 | P2 | Security/privacy | Fixed | `CYRENE_MEMORY_AUTO_EXTRACT` is parsed but not enforced. |
| R8 | P2 | Security/privacy | Fixed | Stop hook reads arbitrary transcript paths without symlink, size, regular-file, or location validation. |
| R9 | P2 | Security/privacy | Fixed | Memory data files inside safe roots can still be symlinks. |
| R10 | P2 | Runtime | Fixed | Maintenance and dream locks can become permanently stale. |
| R11 | P2 | Runtime | Fixed | Project merge can lose concurrent target writes. |
| R12 | P2 | Runtime | Fixed | Project id validation accepts `.`. |
| R13 | P2 | Memory/promotion | Fixed | Review hash omits `profileVisibility` and `portability`. |
| R14 | P2 | Runtime | Fixed | `memoryDreamEnabled` / `memoryDreamMaxRuntimeMs` are parsed but ignored. |
| R15 | P2 | Tests | Fixed | Tests/build mutate tracked plugin runtime. |
| R16 | P2 | Retrieval | Fixed | Oversized first memory bypasses JSONL token budget. |
| R17 | P3 | Persistence | Fixed | One malformed JSONL line breaks the whole memory root read. |
| R18 | P3 | LLM | Fixed | LLM retry configuration is parsed but unused. |
| R19 | P3 | Behavior | Fixed | `cyrene_continuity_get` is documented as a read but mutates dream scheduling state. |
| R20 | P3 | Maintainability | Fixed | Memory schema enums are duplicated across layers. |
| R21 | P3 | Maintainability | Fixed | Pending merge logic is duplicated. |
| R22 | P3 | Cleanup | Fixed | Unused dependency: `chalk`. |
| R23 | P3 | Cleanup | Fixed | Unwired memory helpers appear dead. |
| R24 | P3 | Cleanup | Fixed | Duplicated TOML parsing helpers in doctor and dashboard. |
| R25 | P3 | Documentation | Fixed | Historical plan/spec docs contain stale active-task state. |
| R26 | P3 | Documentation | Fixed | Repository lacks checked-in `AGENTS.md` / `.agents/skills` guidance. |

## Fix Coordination

All review IDs are fixed in the current working tree. Fixes were kept in
ownership lanes: source behavior, tests/CI, package cleanup, generated-runtime
hygiene, documentation archive notes, and this coordinator report.

## Fixed / Remaining Notes

### Fixed in this batch

- R1: Added broader pre-LLM redaction for common provider tokens, JWT-like tokens, and JSON-style secret fields.
- R2: Removed caller-controlled `cwd` from exported MCP input schemas while preserving internal handler fallback wiring.
- R3: Replaced review/profile output command suggestions with Codex-chat review instructions.
- R4: Preserved `safe_summary` profile provenance and applied safe summaries without widening to raw `always` profile text.
- R6: Documented plugin bridge install/refresh and new-session rediscovery in README and skill setup notes.
- R7: Honored `CYRENE_MEMORY_AUTO_EXTRACT=0` before reading transcripts or calling the model.
- R8: Restricted Stop hook transcript reads to real files under the project cwd or Codex home, with symlink, file type, and size checks.
- R9: Added symlink/non-file guards for memory JSONL files, review summaries, profile candidates, dream state, dream artifacts, snapshots, status, dashboard, doctor, and project merge JSONL paths.
- R10: Added owner metadata and stale recovery for maintenance locks, plus stale ownerless/malformed dream lock recovery.
- R11: Project merge now takes the target memory maintenance lock, re-reads target JSONL files under that lock, rejects unsafe source/target JSONL files, and writes target JSONL atomically.
- R12: Rejected dot-only project IDs before touching project roots.
- R13: Included `profileVisibility` and `portability` in pending review hashes and summaries.
- R14: `CYRENE_MEMORY_DREAM_ENABLED=0` now skips dream roots, and `CYRENE_MEMORY_DREAM_MAX_RUNTIME_MS` bounds dream maintenance-lock waits and root starts.
- R15: Plugin-runtime build tests now write to temporary output paths instead of mutating tracked runtime or UI generated files.
- R16: Skipped oversized first JSONL retrieval candidates instead of exceeding the token budget.
- R5: Added GitHub Actions CI and made the release eval run the full minimum gate set with result details.
- R17: Malformed JSONL lines are skipped so one bad line no longer disables the whole memory root read.
- R18: LLM calls now honor retry attempts and delay config for transient HTTP/network failures while preserving non-transient fail-fast behavior.
- R19: `cyrene_continuity_get` no longer marks overdue dream state due while reading context.
- R20: Memory schema enum values now have shared runtime constants consumed by MCP schemas and review summary parsing.
- R21: Dream duplicate-pending merge now reuses the canonical pending merge implementation.
- R22: Removed unused `chalk` dependency from `package.json` and `package-lock.json`.
- R23: Removed confirmed unreferenced helper exports while preserving CLI/MCP behavior and from-root memory operations.
- R24: Doctor and dashboard TOML parsing now share `src/codex/toml-lite.ts`.
- R25: Added `docs/superpowers/README.md` to mark plan/spec artifacts as historical, not current task state.
- R26: Added root `AGENTS.md` repository guidance and updated the checked-in Cyrene skill guidance.

### Caveats

- R11 protects lock-respecting merge/write paths and writes that land before merge obtains the target lock. A direct writer that ignores the maintenance lock can still race.
- R14 bounds dream lock waits and skips roots after the configured budget is exhausted. It does not preempt work that has already started inside a root.
- R23 cleanup was limited to confirmed unreferenced helpers; it did not remove exported types or add new snapshot/restore feature wiring.
- R25 preserves historical plan/spec content instead of rewriting old task checkboxes, and adds an archive-level status disclaimer.

### Remaining recommended fix order

No review IDs remain open.

### Verification after batch

- `npm run build:plugin`: passed.
- `python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin`: passed.
- `npm run typecheck`: passed.
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: passed.
- `npm run dev -- codex eval run --check release`: passed all six minimum checks.
- `npm test`: passed, 37 files / 417 tests.
- `git diff --check`: passed.
- Lint: no lint script is defined in `package.json`.
