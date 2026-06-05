# Context Mode Lightweight Runtime

Date: 2026-06-05

- `cyrene_continuity_get` now defaults to `mode=fast` for ordinary continuity reads.
- Fast and balanced modes no longer expose pending review counts, notices, or content.
- Similar-project hints are disabled in fast mode and explicit/policy-gated in richer modes.
- `retrieved` activation events are disabled by default.
- Use `mode=review` or `memory context-preview --mode review` for pending review diagnostics.
