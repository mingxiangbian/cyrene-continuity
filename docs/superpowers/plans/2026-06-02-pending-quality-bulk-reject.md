# Pending Quality And Bulk Reject Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop review-summary and source-of-truth excerpts from polluting pending memory, and add Web UI controls to reject selected or all visible pending candidates.

**Architecture:** Add deterministic admission reasons before `admit_to_pending`, keeping v5 review hash validation intact. Add a single-root batch reject API that validates each candidate review hash, writes normal reject events and tombstones, then expose checkbox-based UI actions.

**Tech Stack:** TypeScript, Vitest, existing JSONL memory store, existing Codex Web UI static assets.

---

### Task 1: Admission Gate Pollution Rejects

**Files:**
- Modify: `src/codex/admission-gate.ts`
- Test: `tests/admission-gate.test.ts`

- [ ] Write failing tests showing `AGENTS.md` raw rule excerpts and `review_summary` transient/status candidates do not become `admit_to_pending`.
- [ ] Run `npm test -- tests/admission-gate.test.ts -t "source of truth|review summary"` and verify RED.
- [ ] Add deterministic reasons for `raw_file_rule_excerpt`, `review_summary_status_noise`, and `previously_rejected_semantic_duplicate`.
- [ ] Route those reasons to `reference_only`, `episode_only`, or `auto_drop` before valuable-kind admission.
- [ ] Run the admission tests and related harvester tests.

### Task 2: Batch Reject API

**Files:**
- Modify: `src/codex/codex-ui-api.ts`
- Test: `tests/codex-ui-api.test.ts`

- [ ] Write failing tests for `/api/memory/pending/reject-batch` rejecting selected candidates with per-candidate review hashes.
- [ ] Write failing tests for partial hash mismatch leaving mismatched candidates in pending.
- [ ] Implement a single-root batch reject handler using existing pending review hash logic and normal reject event/tombstone writes.
- [ ] Reject `scope=all` for the batch mutation route.
- [ ] Run `npm test -- tests/codex-ui-api.test.ts -t "batch reject|rejects scope=all"`.

### Task 3: Web UI Bulk Controls

**Files:**
- Modify: `src/ui/static/app.js`
- Generated: `src/codex/codex-ui-static.generated.ts`
- Test: `tests/codex-ui-static.test.ts`

- [ ] Write failing static tests for checkbox selection, `Reject selected`, and `Reject all in view`.
- [ ] Add inbox selection state, checkbox rendering, and batch reject submission to the new API.
- [ ] Regenerate static assets with `npm run build:plugin`.
- [ ] Run static UI tests.

### Task 4: Verification

- [ ] Run targeted tests: `npm test -- tests/admission-gate.test.ts tests/codex-ui-api.test.ts tests/codex-ui-static.test.ts`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build:plugin`.
- [ ] Run `python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin`.
- [ ] Run `git diff --check`.
