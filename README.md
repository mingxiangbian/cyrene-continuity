# cyrene-continuity

Local-first continuity bridge for Codex.

## Commands

```bash
npm run dev -- mcp-server --stdio
npm run dev -- codex doctor
npm run dev -- codex install --dev
npm run dev -- codex install-hook --stop
npm run dev -- codex hook stop
npm run dev -- codex memory dream --stage deep
npm run dev -- codex memory profile
```

## Data

This repo reads and writes existing local data under:

```txt
~/.cyrene/codex/global/memory/
~/.cyrene/codex/projects/<projectId>/memory/
```

It does not migrate or copy user memory data during install.

## Review Policy

Pending memory candidates are not active memory. Promotion requires explicit user approval and a matching review hash.
