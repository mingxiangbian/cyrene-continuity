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
| R5 | P1 | Tests/CI | Deferred | No CI and `codex eval run --check release` is effectively static. |
| R6 | P1 | Documentation/setup | Fixed | Fresh plugin setup docs omit Codex plugin install/refresh step. |
| R7 | P2 | Security/privacy | Fixed | `CYRENE_MEMORY_AUTO_EXTRACT` is parsed but not enforced. |
| R8 | P2 | Security/privacy | Fixed | Stop hook reads arbitrary transcript paths without symlink, size, regular-file, or location validation. |
| R9 | P2 | Security/privacy | Fixed | Memory data files inside safe roots can still be symlinks. |
| R10 | P2 | Runtime | Fixed | Maintenance and dream locks can become permanently stale. |
| R11 | P2 | Runtime | Fixed | Project merge can lose concurrent target writes. |
| R12 | P2 | Runtime | Fixed | Project id validation accepts `.`. |
| R13 | P2 | Memory/promotion | Fixed | Review hash omits `profileVisibility` and `portability`. |
| R14 | P2 | Runtime | Fixed | `memoryDreamEnabled` / `memoryDreamMaxRuntimeMs` are parsed but ignored. |
| R15 | P2 | Tests | Deferred | Tests/build mutate tracked plugin runtime. |
| R16 | P2 | Retrieval | Fixed | Oversized first memory bypasses JSONL token budget. |
| R17 | P3 | Persistence | Deferred | One malformed JSONL line breaks the whole memory root read. |
| R18 | P3 | LLM | Deferred | LLM retry configuration is parsed but unused. |
| R19 | P3 | Behavior | Deferred | `cyrene_continuity_get` is documented as a read but mutates dream scheduling state. |
| R20 | P3 | Maintainability | Deferred | Memory schema enums are duplicated across layers. |
| R21 | P3 | Maintainability | Deferred | Pending merge logic is duplicated. |
| R22 | P3 | Cleanup | Deferred | Unused dependency: `chalk`. |
| R23 | P3 | Cleanup | Deferred | Unwired memory helpers appear dead. |
| R24 | P3 | Cleanup | Deferred | Duplicated TOML parsing helpers in doctor and dashboard. |
| R25 | P3 | Documentation | Deferred | Historical plan/spec docs contain stale active-task state. |
| R26 | P3 | Documentation | Fixed | Repository lacks checked-in `AGENTS.md` / `.agents/skills` guidance. |

## Current Fix Batch

This batch intentionally does not fix everything. Coordinator owns this report. Subagents must avoid editing `REVIEW_REPORT.md`.

Planned first-pass ownership:

- Security/privacy worker: source security boundaries only.
- Runtime worker: runtime source files only.
- Memory/promotion worker: memory/profile promotion source files only.
- Test coverage worker: tests only, after source ownership is settled.
- Documentation worker: README / AGENTS / skill docs only.

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
- R16: Skipped oversized first JSONL retrieval candidates instead of exceeding the token budget.
- R26: Added root `AGENTS.md` repository guidance and updated the checked-in Cyrene skill guidance.

### Caveats

- R11 protects lock-respecting merge/write paths and writes that land before merge obtains the target lock. A direct writer that ignores the maintenance lock can still race.
- R14 bounds dream lock waits and skips roots after the configured budget is exhausted. It does not preempt work that has already started inside a root.

### Remaining recommended fix order

1. R5/R15 CI and generated-runtime hygiene: add CI and isolate plugin runtime mutation in tests/builds.
2. R17/R18/R19 reliability and behavior cleanup: malformed JSONL tolerance, LLM retry config, and read-tool side effects.
3. R20/R21 maintainability cleanup around duplicated schema enums and pending merge logic.
4. R22/R23/R24 dead/redundant code cleanup.
5. R25 stale historical documentation cleanup.

### Verification after batch

- `npm run build:plugin`: passed.
- `npm test`: passed, 27 files / 312 tests.
- `npm run typecheck`: passed.
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: passed.
- `git diff --check`: passed.
- Plugin validation: passed with `/Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py`.
- Lint: no lint script is defined in `package.json`.
