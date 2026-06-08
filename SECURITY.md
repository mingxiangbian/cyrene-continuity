# Security Policy

Cyrene Continuity is local-first. It reads and writes local memory, profiles,
audit logs, and retrieval indexes under the user's Cyrene data directory, and it
does not require hosted storage for normal operation.

## Sensitive Data

Do not paste or upload:

- Secrets, tokens, API keys, or `.env` values.
- Private memory contents.
- Full `.cyrene` directories or raw memory stores.
- Logs that contain private user, project, relationship, or profile data.

When reporting a bug, reduce logs to the smallest useful excerpt and redact
secret values and private memory. Prefer structural descriptions over raw memory
content.

## Memory Review Safety

High-risk or ambiguous memory requires explicit review and hash-checked approval
before it can become active memory. Do not bypass review-hash validation, and do
not treat pending memory as approved context.

Strict low-risk project or procedural/global memory may only auto-promote through
the named v5 policy, daily caps, eval gates, and auditable `MemoryEvent`
receipts.

## Reporting a Vulnerability

This project does not currently publish a public security email. Until one is
available, contact the private maintainer channel and include only redacted
details needed to reproduce or triage the issue.
