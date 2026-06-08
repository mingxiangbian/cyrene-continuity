# Changelog

All notable changes to this project are documented here.

## Unreleased

### Added

- Added lightweight GitHub health documentation and issue/PR templates for
  contribution, security, bug reports, feature requests, and pull request review.

### Packaging Cleanup

- Clarified packaging expectations around generated plugin runtime files,
  benchmark output locations, and local privacy boundaries.

## 2026-06-05

### Changed

- `cyrene_continuity_get` now defaults to `mode=fast` for ordinary continuity
  reads.
- Fast and balanced modes no longer expose pending review counts, notices, or
  content.
- Similar-project hints are disabled in fast mode and explicit or policy-gated
  in richer modes.
- `retrieved` activation events are disabled by default.
- Pending review diagnostics now require `mode=review` or
  `memory context-preview --mode review`.
