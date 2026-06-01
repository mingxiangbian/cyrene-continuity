# Memory Quality Contract

## Purpose

本文档是 coordinator 和 subagent 使用 Memory Quality Contract 的 agent-facing 入口。
typed fixture 与 rubric section 的 source of truth 将放在 `src/codex/memory-quality-contract.ts`。

## Use This Before Agent Work

在开始 Distillation、Router / ReviewPolicy、Review Surface、Activation / Reflection、quality harness、CLI、MCP 或 UI 相关工作前，先阅读本合同。

每个 subagent 交付时必须附带 Memory Delta Report。没有生成 memory candidate 也必须说明已检查哪些 signal、为什么没有 durable signal 被漏掉，以及 pending / active 为什么保持干净。

## Quality Contract: high precision + high recall

高质量 memory 工作必须同时满足两侧约束：

- High precision：低价值 signal 不能污染 pending 或 active memory。
- High recall：durable signal 不能被 silent drop。

这意味着 agent 不能为了安全而什么都不产出，也不能为了自动化把 task state、短期 TODO、数字快照、raw emotion event 或 raw implementation note 推进 pending / active。

## Required Review Evidence

Coordinator review 至少检查以下证据：

- Capture：durable signal 已被捕获，或给出明确 No Memory Delta 理由。
- Non-pollution：task state、transient status、numeric snapshot、raw emotion event、one-off action、raw implementation note 没有直接进入 pending 或 active memory。
- Routing：每个 signal 进入预期 module 和 policy；高风险内容保持 manual review。
- Evidence：candidate 带有 source、episode 或 trace reference、what happened、why important、result、source boundary。
- Use boundaries：reviewable memory 有 `useWhen` 和 `doNotUseWhen`，或说明当前字段不可用的原因。
- Reviewability：reviewer 不需要读 raw JSON 就能判断 approve、edit、reject 或 defer。
- Activation safety：active write 只发生在 low-risk、有 evidence、有 receipt 的路径。
- Reflection safety：reflection 只生成 reviewable candidate，不直接修改 active memory。

## Memory Delta Report Template

```txt
# Memory Delta Report

## Captured durable signals

## Generated candidates / distillation inputs / reflection candidates

## Episode-only or task-state signals

## No-memory decisions and reasons

Signals reviewed:
Decision:
Why no durable memory candidate:
Why no durable signal was dropped:
Why pending / active stayed clean:

## Pollution safeguards

## Recall safeguards

## Fixture coverage

## Open risks
```

## Verification

Run the foundation tests with:

```bash
npm test -- tests/memory-quality-contract.test.ts
```
