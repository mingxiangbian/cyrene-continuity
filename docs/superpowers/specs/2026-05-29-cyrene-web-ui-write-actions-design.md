# Cyrene Web UI Write Actions Design Spec

Date: 2026-05-29
Status: Approved for implementation
Branch: `codex/web-ui-soft-ui`

## 背景

`cyrene-continuity codex ui` v1 已经提供 Soft UI 本地 console：可以查看 memory pipeline、pending candidates、review summaries、project memory、harvester dry-run、dream/profile 状态。v1 的边界是 read-first，只允许 harvester dry-run，不允许在 Web UI 中处理 pending memory。

下一步要解决的断点是：用户可以在 UI 里看到 pending candidate，但仍然必须回到 CLI 执行 `approve` / `reject` / `edit` / `defer`。这会打断 review flow，也让 evidence、review hash、decision reason 之间的上下文断裂。

本 spec 定义 Web UI v2 的单项 pending write actions。目标是在保持 pending-only review model 的前提下，让用户可以从 Inbox 的 detail rail 中安全处理一个 pending candidate。

## 目标

1. 在 Web UI Inbox 中选择一个 pending candidate 后，右侧 detail rail 展示完整 review 上下文。
2. 支持单项 `Approve` / `Reject` / `Defer` / `Edit`。
3. 所有写操作都必须二次确认，第一次点击只进入 confirm 状态，不发请求。
4. `Reject` / `Defer` 必须填写 reason，`Edit` 必须填写 change note。
5. `Edit` 只修改 pending candidate，不能直接写 active memory。
6. 所有写 API 必须经过同源检查、per-server CSRF token、当前 `reviewHash` 校验。
7. 操作成功后刷新 pending queue，并在 detail rail 显示 decision receipt。
8. 保持 v1 local-first、pending-only、hash-checked 的安全边界。

## 非目标

v2 不做以下内容：

- 不做 batch approve / reject / defer。
- 不做 `dream deep-apply` 或任何 dream 写操作。
- 不做 `profile apply`。
- 不做 active memory 直接编辑。
- 不做远程访问、登录、多用户权限或局域网暴露。
- 不依赖模型 API key。
- 不自动生成新的 pending candidate；harvester 仍按现有 dry-run/模型配置规则运行。

## UX 设计

### Inbox 选择

Inbox 的每条 pending row 可被选中。选中后：

- row 显示 selected 状态；
- detail rail 展示该 candidate 的完整 content；
- 展示 `candidateKind` / `domain` / `type` / `scope`；
- 展示 `reviewHash`；
- 展示 evidence summaries；
- 展示 tags/scores（如果存在）；
- 展示 `Approve` / `Reject` / `Defer` / `Edit` actions。

未选择 candidate 时，detail rail 显示 review queue summary 和提示文案。

### 二次确认

所有 action 的交互流程相同：

1. 用户点击 action button。
2. detail rail 进入 confirm 状态。
3. UI 展示将要提交的 action、candidate id、current `reviewHash`。
4. 对需要输入的 action 显示表单：
   - `Reject`: reason textarea，必填。
   - `Defer`: reason textarea，必填；days numeric input，默认 7。
   - `Edit`: editable fields + change note textarea，change note 必填。
5. 用户点击 `Confirm` 才发送 API 请求。
6. 用户点击 `Cancel` 返回 detail view，不提交。

### Edit 范围

`Edit` 允许修改 pending candidate 的 review 内容，但不能绕过 schema：

- 可修改 `content`。
- 可修改 `candidateKind` / `candidate_kind`。
- 可修改 `tags`。
- 可修改 `scores` 中已有或允许的 numeric fields。
- 不允许修改 `id`。
- 不允许直接修改 active memory。
- 不允许跳过 `reviewHash`。

服务端收到 edit request 后重新读取 pending candidate，以当前 pending record 为基础应用 patch，再走 schema/validator。成功后写回 pending，并返回更新后的 candidate 和新的 `reviewHash`。

### 成功反馈

写操作成功后：

- UI 刷新 `/api/dashboard` 或至少刷新 `/api/memory/pending`。
- 被处理的 candidate 从 Inbox queue 中移除（`Edit` 除外，Edit 后仍保留在 queue）。
- detail rail 显示 decision receipt：
  - action；
  - candidate id；
  - timestamp；
  - submitted `reviewHash`；
  - reason 或 change note；
  - result summary。
- 若 `Edit` 成功，detail rail 显示更新后的 pending candidate 和新 `reviewHash`。

### 错误反馈

错误必须是用户可恢复的：

- `403 csrf_forbidden`: 提示刷新 UI 或重启 `codex ui`。
- `403 cross_origin_forbidden`: 提示请求被本地安全边界阻止。
- `400 invalid_request`: 提示缺失 reason/change note 或字段格式不合法。
- `404 not_found`: 提示 candidate 已不存在，刷新 queue。
- `409 review_hash_mismatch`: 提示 candidate 已变化，刷新后重试。
- `500 internal_error`: 显示短错误，不暴露 secrets。

## 安全边界

### 本地同源

`src/codex/codex-ui-server.ts` 已经对所有 non-GET `/api/*` 做跨站检查。v2 保留并扩展此边界：

- `Origin` 存在且 host 与 request host 不一致时拒绝。
- `Sec-Fetch-Site: cross-site` 时拒绝。
- 拒绝发生在读取 body 和 API dispatch 之前。

### CSRF token

每次 `startCodexUiServer()` 启动生成一个随机 token：

- token 保存在 server process 内存中；
- `index.html` 或 `/api/session` 提供给同源 UI；
- 所有 non-GET API 必须带 header `x-cyrene-ui-token`；
- token 缺失或不匹配返回 `403 csrf_forbidden`；
- token 不写入 repo、不写入 memory data、不打印到 logs。

### Review hash

每个 write action 必须提交当前 pending candidate 的 `reviewHash`：

- 服务端重新读取 pending candidate；
- 使用现有 hash-checked review path；
- hash mismatch 返回 `409 review_hash_mismatch`；
- UI 刷新 candidate 后才能重试。

### Pending-only model

Web UI v2 不改变 memory policy：

- `Approve` 可通过现有 hash-checked path 将 pending 写入 active。
- `Reject` / `Defer` 只处理 pending decision。
- `Edit` 只更新 pending candidate，不写 active。
- 任何 action 都不能自动修改 profile。
- 任何 action 都不能 promote 未经 confirm 的 candidate。

## API 设计

新增 write endpoints：

```txt
POST /api/memory/:id/approve
POST /api/memory/:id/reject
POST /api/memory/:id/defer
POST /api/memory/:id/edit
```

Shared request requirements：

```json
{
  "reviewHash": "current-review-hash"
}
```

Headers：

```txt
x-cyrene-ui-token: <server session token>
content-type: application/json
```

`reject` body：

```json
{
  "reviewHash": "current-review-hash",
  "reason": "reason text"
}
```

`defer` body：

```json
{
  "reviewHash": "current-review-hash",
  "reason": "reason text",
  "days": 7
}
```

`edit` body：

```json
{
  "reviewHash": "current-review-hash",
  "changeNote": "what changed and why",
  "patch": {
    "content": "updated candidate content",
    "candidateKind": "workflow_rule",
    "tags": ["project", "workflow"],
    "scores": {
      "usefulness": 0.9
    }
  }
}
```

Success response shape：

```json
{
  "ok": true,
  "data": {
    "receipt": {
      "action": "approve",
      "id": "pending-id",
      "reviewHash": "submitted-review-hash",
      "createdAt": "2026-05-29T00:00:00.000Z",
      "summary": "Approved pending memory."
    }
  }
}
```

`edit` success also returns updated candidate。

## 测试策略

### API/server tests

- missing `x-cyrene-ui-token` on non-GET write API returns `403 csrf_forbidden`。
- wrong token returns `403 csrf_forbidden`。
- cross-site non-GET still returns `403 cross_origin_forbidden` before body parse and route dispatch。
- matching token + matching `reviewHash` routes to existing approve/reject/defer/edit logic。
- stale `reviewHash` returns `409 review_hash_mismatch`。
- `reject` / `defer` missing reason returns `400 invalid_request`。
- `edit` missing change note returns `400 invalid_request`。
- `edit` keeps candidate pending and returns a new `reviewHash`。

### UI asset tests

- Inbox rows are selectable。
- detail rail includes action buttons only for selected pending candidate。
- action buttons do not call API immediately。
- confirm state includes `Confirm` / `Cancel`。
- `Reject` / `Defer` include reason fields。
- `Edit` includes change note。
- fetch calls include `x-cyrene-ui-token` and `reviewHash`。
- UI contains no batch action strings。

### Integration verification

- `npm test`
- `npm run typecheck`
- `npm run build:plugin`
- plugin validation
- `git diff --check`
- Browser QA：确认 Inbox selection、confirm state、receipt/error state、mobile no-overflow。

## Open Constraints

- v2 可以在没有 `CYRENE_BASE_URL` / `CYRENE_MODEL` 时工作，因为 write actions 不调用模型。
- 如果没有 pending candidates，UI 应显示空状态，不显示可用 write action。
- 若用户从多个 browser tabs 打开同一个 UI，token 相同但 `reviewHash` 仍防止 stale write。
