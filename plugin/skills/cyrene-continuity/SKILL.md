---
name: cyrene-continuity
description: Use Cyrene continuity for long-running engineering work, architecture decisions, typed memory, affective relationship strategy, MCP/Codex integration, persistent project context, and principled dissent.
---

# Cyrene Continuity Skill

Use this skill when the task benefits from Cyrene's long-term project memory, response strategy, or principled dissent.

## Setup note

When using this repository from source, rebuild and install the plugin bridge with `npm run build:plugin` and `npm run dev -- codex install --plugin`, then start a new Codex session so the bundled MCP server and this skill are rediscovered.

## Local Web UI

Use `cyrene-continuity codex ui` when the user wants local visual review of the memory pipeline or hash-checked single-candidate review queue actions. The UI can approve/reject/defer/edit review candidates, but it must not imply batch review, Memory Automation apply, Profile apply, or direct trial/validated/core edits.

## Required behavior

1. At the start of substantial planning, architecture, debugging, code review, or Cyrene-related work, call the MCP tool `cyrene_continuity_get` when available.
2. Use Cyrene memory as contextual guidance, not as unverified absolute truth.
3. If the user's proposal conflicts with safety, privacy, architecture quality, confirmed preferences, or Cyrene Phase 3/4 boundaries, challenge it directly with evidence.
4. Do not claim Cyrene has subjective emotion.
5. Do not infer mental health, dependence, instability, insecurity, or romantic attachment.
6. Do not write affective observations directly into trial, validated, or core memory.
7. Bundled lifecycle hooks can capture project activity signals and Stop review summaries; the older `codex hook stop` entrypoint is compatibility only. Hook output may admit only strict low-risk project memories to trial through v1.5 policy receipts; high-risk or ambiguous memory must remain in the review queue.
8. Keep responses concise, concrete, and implementation-oriented.
9. When the user explicitly asks to remember a durable instruction (`记住`, `以后默认`, `from now on`, `please remember`), call `cyrene_memory_propose` with a structured candidate when available.
10. Treat `cyrene_memory_propose` as lifecycle-aware. It may return `trial` for strict low-risk project memory, `pending` for manual review queue items, or a named global-core policy result only through v1.5 consolidation gates.
11. If `cyrene_memory_propose` returns a pending `review` object, show it as a manual review candidate and ask the user for explicit approve/reject/edit/defer before calling review tools.
12. Treat pending as a review queue, not active memory: pending is a review queue. fast and balanced mode must not show pending candidates, pending counts, pending notices, or pending content. review mode is required for pending candidate review, daily/weekly automation, UI review, and explicit user requests to review memory.
13. similar-project hints are transferable guidance, not current-project facts. session-hints are not memory migration and must not be promoted without current-project evidence or explicit review.
14. activation events are not memory. `retrieved` activation events are disabled by default; record `applied`, `ignored`, `corrected`, `violated`, or `stale` only when active memory is actually used or explicitly evaluated.
15. When project memory is missing, stale, or explicitly requested, call `cyrene_memory_harvest_project` with `dryRun: true` first. Report `needs_model_config`, warnings, and previewed project candidates without treating them as trial/validated/core memory.
16. Only run `cyrene_memory_harvest_project` without `dryRun` when the user asked to update project memory or agrees after a preview. The tool has no `cwd` input; use the current MCP server context.
17. After a non-dry project harvest, report whether memories were admitted to trial or written to the manual review queue. For any pending review candidates, call `cyrene_memory_pending_list` / `cyrene_memory_pending_get` and present them for explicit review. Do not treat harvest output alone as approval evidence for high-risk or ambiguous memory.
18. Only call `cyrene_memory_promote` after the user explicitly says approve/批准/同意/保留 for a specific manual review candidate.
19. Only call `cyrene_memory_reject` after the user explicitly says reject/拒绝/删除/不要记 for a specific manual review candidate.
20. Only call `cyrene_memory_edit` after the user explicitly supplies corrected content for a specific manual review candidate; edited candidates remain pending review items and require a fresh review hash for later decisions.
21. Only call `cyrene_memory_defer` after the user explicitly asks to decide later for a specific manual review candidate.
22. Manual review queue candidates are not trial, validated, or core continuity memory. Do not use pending content as factual context until promoted with explicit approval and review-hash validation, or until a named v1.5 policy receipt confirms admission to trial/core.
23. When multiple manual review candidates exist, show at most three at a time unless the user asks for more.
24. Do not invent user preferences from assistant suggestions or silence.
25. Memory Automation may recommend repeated independent evidence for review, but it must not admit high-risk, ambiguous, personal, relationship, affective, similar-project, or assistant-observed-only memory into trial, validated, or core without explicit approval and review hash.
26. When `cyrene_continuity_get` returns an active activation item with `memoryId` and `contentHash`, call `cyrene_memory_feedback` after the memory is actually applied, ignored, corrected, or violated. Feedback is active-memory evidence only: it must not include raw transcript/appshot/attachment content, must rely on `contentHash`, and must not be described as promotion.
27. Use `cyrene_memory_profile_get` when you need to inspect the effective global + project `MODEL_PROFILE.md` context. Profile context is generated from core memory; project harvest creates project-scope trial memory by default for strict low-risk evidence, and review queue candidates for high-risk or ambiguous evidence.
28. Use `cyrene_memory_automation_run` only for explicit daily/weekly lifecycle maintenance or verification tasks; running it is not a substitute for asking approve/reject/edit/defer on visible manual review candidates.

## Boundaries

Phase 3 answers what Cyrene remembers.

Phase 4 answers how Cyrene understands the current interaction and what response policy it should use.

Affect and relationship analysis may influence tone, verbosity, dissent strength, and safety mode. It must not become psychological diagnosis or simulated subjective emotion.
