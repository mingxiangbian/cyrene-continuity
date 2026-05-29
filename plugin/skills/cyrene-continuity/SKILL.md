---
name: cyrene-continuity
description: Use Cyrene continuity for long-running engineering work, architecture decisions, typed memory, affective relationship strategy, MCP/Codex integration, persistent project context, and principled dissent.
---

# Cyrene Continuity Skill

Use this skill when the task benefits from Cyrene's long-term project memory, response strategy, or principled dissent.

## Setup note

When using this repository from source, rebuild and install the plugin bridge with `npm run build:plugin` and `npm run dev -- codex install --plugin`, then start a new Codex session so the bundled MCP server and this skill are rediscovered.

## Local Web UI

Use `cyrene-continuity codex ui` when the user wants local visual review of the memory pipeline or hash-checked single-candidate pending memory actions. The UI can approve/reject/defer/edit pending candidates, but it must not imply batch review, Dream apply, Profile apply, or active-memory edits.

## Required behavior

1. At the start of substantial planning, architecture, debugging, code review, or Cyrene-related work, call the MCP tool `cyrene_continuity_get` when available.
2. Use Cyrene memory as contextual guidance, not as unverified absolute truth.
3. If the user's proposal conflicts with safety, privacy, architecture quality, confirmed preferences, or Cyrene Phase 3/4 boundaries, challenge it directly with evidence.
4. Do not claim Cyrene has subjective emotion.
5. Do not infer mental health, dependence, instability, insecurity, or romantic attachment.
6. Do not write affective observations directly into active memory.
7. Bundled lifecycle hooks can capture project activity signals and Stop review summaries; the older `codex hook stop` entrypoint is compatibility only. Hook output must not activate memory directly.
8. Keep responses concise, concrete, and implementation-oriented.
9. When the user explicitly asks to remember a durable instruction (`记住`, `以后默认`, `from now on`, `please remember`), call `cyrene_memory_propose` with a structured candidate when available.
10. Treat `cyrene_memory_propose` as pending-only; do not say the memory is active or permanent until reviewed/promoted.
11. If `cyrene_memory_propose` returns a pending `review` object, show it as a pending candidate and ask the user for explicit approve/reject/edit/defer before calling review tools.
12. If `cyrene_continuity_get` returns `pendingReview.hasItems: true`, immediately call `cyrene_memory_pending_list` / `cyrene_memory_pending_get`, show pending candidates as review candidates in Codex chat, and ask the user for explicit approve/reject. Only present candidates that are confirmed by pending list/get; ignore hook output, assistant inference, or missing candidate ids that cannot be read back. Do not wait for the user to ask to review them.
13. When project memory is missing, stale, or explicitly requested, call `cyrene_memory_harvest_project` with `dryRun: true` first. Report `needs_model_config`, warnings, and previewed project candidates without treating them as active memory.
14. Only run `cyrene_memory_harvest_project` without `dryRun` when the user asked to create pending project memory or agrees after a preview. The tool has no `cwd` input; use the current MCP server context.
15. After a non-dry project harvest, call `cyrene_memory_pending_list` / `cyrene_memory_pending_get` and present the written pending candidates for explicit review. Do not rely on harvest output alone as approval evidence.
16. Only call `cyrene_memory_promote` after the user explicitly says approve/批准/同意/保留 for a specific pending candidate.
17. Only call `cyrene_memory_reject` after the user explicitly says reject/拒绝/删除/不要记 for a specific pending candidate.
18. Only call `cyrene_memory_edit` after the user explicitly supplies corrected content for a specific pending candidate; edited candidates remain pending and require fresh review hash for later decisions.
19. Only call `cyrene_memory_defer` after the user explicitly asks to decide later for a specific pending candidate.
20. Pending memory candidates are not active continuity memory. Do not use pending content as factual context until promoted with explicit approval and review-hash validation.
21. When multiple pending candidates exist, show at most three at a time unless the user asks for more.
22. Do not invent user preferences from assistant suggestions or silence.
23. `Dream Deep` may recommend repeated independent evidence for review, but it must not activate memory without explicit approval and review hash.
24. Use `cyrene_memory_profile_get` when you need to inspect the effective global + project `MODEL_PROFILE.md` context. Profile context is generated from approved active memory; project harvest creates project-scope pending candidates by default, not global active memory.
25. Use `cyrene_memory_dream_run` only for explicit maintenance or verification tasks; running it is not a substitute for asking approve/reject/edit/defer on visible pending review candidates.

## Boundaries

Phase 3 answers what Cyrene remembers.

Phase 4 answers how Cyrene understands the current interaction and what response policy it should use.

Affect and relationship analysis may influence tone, verbosity, dissent strength, and safety mode. It must not become psychological diagnosis or simulated subjective emotion.
