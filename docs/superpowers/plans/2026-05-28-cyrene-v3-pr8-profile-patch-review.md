# Cyrene Continuity v3 PR8: Profile Patch Review

## 目标

把 profile reflection / apply 流程调整为可审查、可追溯、稳定渲染：

- `profile reflect` 只写 `profile_candidates.jsonl` 和 `MODEL_PROFILE.pending.md` review artifact，不直接写 stable `MODEL_PROFILE.md`。
- `profile apply` 必须校验 `reviewHash`，通过 gate 后写入结构化 active memory，再从结构化 memory 渲染 stable `MODEL_PROFILE.md`。
- Profile candidate section 转 active memory 时保留语义，不再统一 flatten 成 `procedural_rule`。
- apply 审计事件保留 `sourceMemoryIds`、evidence summary、candidate section 和 `reviewHash`。

## 成功标准

- Reflection 生成 pending patch，且 stable `MODEL_PROFILE.md` 仍不存在或不被 reflection 更新。
- Apply 返回可审查 diff，diff 指向 candidate section，并包含 added / removed lines。
- `Project Context` -> `project_fact`，`Interaction Preferences` -> `interaction_style`，`Response Policy` -> `procedural_rule`，`Always Apply` -> `system_policy`。
- Apply 生成的 active memory 保留 source memory id、original evidence summary、candidate section 和 review hash。
- `MODEL_PROFILE.md` 只由 approved structured active memory 渲染生成。

## 任务

### Task 1: 写失败测试

**文件：**

- 修改：`tests/profile-candidates.test.ts`

测试覆盖：

1. `runCodexProfileReflection()` 写入 `MODEL_PROFILE.pending.md`，文件包含 candidate id、section、review hash、source memory ids 和 evidence summary。
2. reflection 不写 stable `MODEL_PROFILE.md`。
3. `applyCodexProfileCandidate()` 对不同 section 生成正确 domain/type，不再全部是 `procedural_rule`。
4. apply 返回 `ProfileDiff`，包含 `candidateId`、`section`、`before`、`after`、`addedLines`、`removedLines`。
5. apply 审计事件 `details` 保留 `reviewHash`、`sourceMemoryIds`、`evidenceSummary` 和 `proposedSection`。

**验证：**

```bash
npm test -- tests/profile-candidates.test.ts
```

预期先失败。

### Task 2: 实现 pending profile patch

**文件：**

- 修改：`src/codex/profile-candidates.ts`

实现：

- 增加 `MODEL_PROFILE.pending.md` 常量和安全原子写 helper。
- reflection 在写入 candidates 后同步写 pending patch。
- pending patch 是 review artifact，只从 `ProfileCandidateSummary[]` 格式化，不作为 stable profile 输入。

**验证：**

```bash
npm test -- tests/profile-candidates.test.ts
```

### Task 3: 修复 semantic mapping 和 apply metadata

**文件：**

- 修改：`src/codex/profile-candidates.ts`
- 修改：`src/memory/memory-exporter.ts`

实现：

- 增加 section -> `{ domain, type }` 映射。
- active memory evidence 保留 source memory ids、evidence summary、review hash 和 candidate section。
- approval event 的 `details` 写入同一组 review metadata。
- `ProfileDiff` 扩展 `candidateId`、`section`、`addedLines`、`removedLines`，并由 apply 前后 stable profile 内容计算。
- stable profile renderer 尊重 profile apply 写入的 `profile-section:*` tag，避免 approved profile memory 被强制渲染到错误 section。

**验证：**

```bash
npm test -- tests/profile-candidates.test.ts
```

### Task 4: 全量验证和提交

运行：

```bash
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
git diff --check
```

提交：

```bash
git add docs/superpowers/plans/2026-05-28-cyrene-v3-pr8-profile-patch-review.md tests/profile-candidates.test.ts src/codex/profile-candidates.ts src/memory/memory-exporter.ts
git commit -m "feat: add profile patch review flow"
```
