# Cyrene Web UI Soft UI Design Spec

Date: 2026-05-29
Status: Ready for user review
Branch: `codex/web-ui-soft-ui`

## 背景

Cyrene v4 已经补上 project memory harvest 的核心管线：lifecycle hooks、project signals、harvester、CLI/MCP 入口和 pending-only 审核边界。当前缺口转向可见性和操作入口：用户需要一个本地 Web UI 来直接看清 `summary -> signals -> pending -> active` 的链路，并用更顺手的方式检查 pending candidates 和 harvester preview。

本 spec 定义首版 `cyrene-continuity codex ui`。它是一个 local-first、read-first 的 review console，不是远程服务，也不是完整写操作后台。

视觉方向来自用户选择的 Soft UI / Neumorphism 风格，并参考 `VoltAgent/awesome-design-md` 里 developer/productivity 工具的 `DESIGN.md` 方向。最终锁定为 **Warm Cream Coral**：暖奶油底、珊瑚主 accent、teal 表示健康、amber 表示待处理、red 表示错误。

References:

- `VoltAgent/awesome-design-md`: https://github.com/VoltAgent/awesome-design-md
- `Claude DESIGN.md`: https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/claude/DESIGN.md
- `Mintlify DESIGN.md`: https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/mintlify/DESIGN.md
- `Raycast DESIGN.md`: https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/raycast/DESIGN.md
- `Vercel DESIGN.md`: https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/vercel/DESIGN.md

## 目标

1. 提供 `cyrene-continuity codex ui`，启动本地 Web UI。
2. 使用 Sidebar Console 主布局，让 memory pipeline 状态一眼可见。
3. v1 以 read-only 为主，只允许 `harvest-project` dry-run，不写 pending、不写 active、不写 profile。
4. 展示 pending candidates、review summaries、active project memory、dream/profile 状态和 harvester preview。
5. 保持现有 pending-only memory review model，不能绕过 review hash 或用户显式 approval。
6. 采用 Soft UI 视觉语言，但不牺牲可读性、密度、状态清晰度和 accessibility。

## 非目标

v1 不做以下内容：

- 不接真实 `approve` / `reject` / `edit` / `defer` 写操作。
- 不做 `deep-apply`、`profile apply`、`db rebuild` 等高风险操作。
- 不引入 React、Vite、Tailwind 或前端构建链。
- 不做登录、多用户、远程访问或局域网暴露。
- 不做 Tauri 桌面封装。
- 不把 harvester preview 当作 active memory 使用。

## 用户体验

### 启动

```bash
cyrene-continuity codex ui
cyrene-continuity codex ui --port 47833
```

默认监听 `127.0.0.1:47833`。如果端口占用，自动尝试后续端口。启动成功输出：

```txt
Cyrene UI running at http://127.0.0.1:<port>
```

### 主布局

采用 Sidebar Console：

- 左侧固定导航：Overview、Inbox、Timeline、Project Memory、Harvester、Dream、Profile。
- 顶部状态条：当前 `projectId`、Stop Hook 状态、pending 数量、SQLite freshness、模型配置状态。
- 主内容区：根据导航切换页面。
- 右侧 detail rail：展示选中项的 evidence、review hash、warnings、next action。

布局原则：

- 页面外壳是 app shell，不做 marketing landing page。
- 页面 section 不做浮动大卡片，直接铺在主内容网格内。
- 可以使用独立 panel 表示 dashboard 模块、candidate、timeline item、detail rail。
- 不使用 card-in-card。若一个 panel 内需要分组，用 dividers、rows、inset bands 或 table/list，而不是再嵌套 card。
- 所有固定格式元素使用稳定尺寸和 responsive constraints，避免 hover、label、count 造成布局跳动。

## 页面设计

### Overview

展示系统健康：

- Stop Hook：installed / stale / missing。
- Last summary：时间、状态、candidate count。
- Pending：global + project count。
- Active project memory：project active count。
- SQLite：fresh / stale / unavailable。
- ProjectId：current id 和 split warning。
- Dream：last run、due、last status。
- Model config：ready / missing。

状态色：

- Teal：OK / fresh / available。
- Amber：needs review / stale / due。
- Red：failed / missing / unsafe。
- Muted：disabled / unavailable / not configured。

### Inbox

展示 pending candidates：

- `candidate_kind`
- `domain` / `type`
- `scope`
- recommendation
- risk
- evidence count
- content preview
- review hash
- source root

右侧 detail rail 展示：

- full content
- evidence summaries
- review hash
- tags
- scores
- disabled actions

`approve` / `reject` / `edit` / `defer` 按钮在 v1 中 disabled，文案为 `CLI required in v1` 或 `Write actions disabled in v1`。不能让 disabled button 看起来已经执行成功。

### Timeline

展示 session pipeline：

- review summaries，按时间倒序。
- 每条 summary 的状态：ok / failed。
- candidate count。
- failed reason。
- linked pending ids。
- hook traces 和 recent project signals 的摘要。

目标是回答：为什么本轮工作没有产出 project memory，或者产出了哪些 pending candidates。

### Project Memory

按项目记忆分类展示 active project memory：

- Project Facts
- Project Decisions
- Workflow Rules
- Known Pitfalls
- Rejected Approaches
- Open Questions
- Other Project Memory

对于缺失分类，显示空状态和 `Try Harvester dry-run`。空状态不能暗示会自动写 active memory。

### Harvester

v1 只做 dry-run：

- 按钮：`Preview project memory harvest`
- 调用 `POST /api/memory/harvest-project/dry-run`
- 显示 `signals`
- 显示 preview candidates
- 显示 warnings 和 `needs_model_config`
- 不写 pending candidates

当模型配置缺失时，仍展示 deterministic signals，并明确说明：

```txt
Model config is required before LLM candidate extraction. No pending memory was written.
```

### Dream

只读展示：

- last dream
- next dream due
- due status
- last dream status / error
- recent dream report summary

v1 不提供 `deep-apply` 按钮。

### Profile

只读展示：

- effective project `MODEL_PROFILE.md`
- global/profile boundary
- profile candidates count

必须明确：

- Profile 来自 approved active memory。
- Web UI v1 不 apply profile candidates。
- Project harvester 默认只产生 project-scope preview/pending，v1 dry-run 不写 pending。

## Visual Design

### Warm Cream Coral Tokens

Core palette:

```txt
canvas:        #f4efe7
surface:       #f4efe7
surfaceInset:  #efe4d6
ink:           #181715
body:          #5f584f
muted:         #8d8479
coral:         #cc785c
coralPressed:  #a9583e
teal:          #5db8a6
amber:         #d4a017
red:           #c64545
line:          rgba(118, 91, 70, 0.14)
```

Soft UI shadow tokens:

```txt
raised:
  10px 10px 22px rgba(141, 126, 108, 0.28)
  -10px -10px 22px rgba(255, 255, 255, 0.88)

pressed:
  inset 8px 8px 18px rgba(141, 126, 108, 0.24)
  inset -8px -8px 18px rgba(255, 255, 255, 0.90)

subtle:
  4px 4px 10px rgba(141, 126, 108, 0.18)
  -4px -4px 10px rgba(255, 255, 255, 0.72)
```

Shape:

- App shell radius: 0。
- Panels: 16px 到 20px。
- Buttons: 10px 到 12px，icon buttons 12px 或 circle。
- Pills: 999px，仅用于 status chips 和 filters。
- Avoid large 28px+ radii for dense review tables.

Typography:

- Use system UI / Inter fallback。
- No viewport-scaled font sizes。
- `letter-spacing: 0`，除极小 uppercase labels 可保持 0。
- Compact UI panel headings 不使用 hero-scale type。
- Monospace 仅用于 ids、hash、commands 和 code。

Accessibility:

- 关键状态不能只靠阴影。
- 所有状态必须同时有 color + text 或 icon label。
- Focus ring 必须明显，不能只靠 pressed shadow。
- Disabled actions 必须视觉上和文本上都清楚。
- Red/amber/teal 状态需要足够文字说明，避免色盲不可辨。
- `prefers-reduced-motion` 下关闭过渡动画。

## 技术设计

### 文件结构

```txt
src/codex/codex-ui-server.ts
src/codex/codex-ui-api.ts
src/codex/codex-ui-static.ts
src/ui/static/index.html
src/ui/static/app.js
src/ui/static/styles.css
```

`codex-ui-static.ts` 由源码维护或构建脚本生成，导出静态资源字符串映射。v1 倾向直接维护 TS string map 或在 `build:plugin` 中生成内联模块，避免 plugin runtime 安装后找不到 `src/ui/static` 文件。

### Server

- 使用 Node 内置 `http`。
- 只绑定 `127.0.0.1`。
- 默认端口 `47833`。
- `--port 0` 允许系统分配端口，方便测试。
- 静态路由：
  - `GET /`
  - `GET /app.js`
  - `GET /styles.css`
- API 路由全部在 `/api/*`。
- 未知路由返回 JSON 404 或静态 404。
- 错误返回结构化 JSON，不把 stack trace 暴露给 UI。

### CLI

新增：

```txt
cyrene-continuity codex ui [--port <n>]
```

实现位置接入现有 `src/codex/codex-cli.ts`。启动后保持进程运行，直到用户中断。

### API

```txt
GET  /api/status
GET  /api/dashboard
GET  /api/memory/pending
GET  /api/memory/active
GET  /api/review-summaries
GET  /api/project-memory
GET  /api/dream
GET  /api/profile
POST /api/memory/harvest-project/dry-run
```

API 不接受 `cwd`。服务启动时固定 `cwd`，所有读取都基于这个 cwd 和现有 project identification。

API 聚合应复用现有模块：

- `readCodexMemoryStatus`
- `readPendingMemoriesFromRoot`
- `readActiveMemoriesFromRoot`
- `readCodexMemoryDreamState`
- `readModelProfileFromRootIfExists`
- `collectProjectMemorySignals`
- `runCodexProjectMemoryHarvest`

如现有 helper 未导出，应优先补小型 read-only helper，而不是复制解析逻辑。

### Security Boundary

允许：

- Read status/dashboard/memory/review summaries/dream/profile。
- Run `harvest-project` with `dryRun: true`。

禁止：

- Promote pending memory。
- Reject/edit/defer pending memory。
- Write active memory。
- Apply profile candidate。
- Run Dream deep-apply。
- Rebuild DB。
- Accept arbitrary cwd from browser。
- Bind non-loopback host。

## Data Contracts

### Common API response

Success:

```ts
type UiApiSuccess<T> = {
  ok: true
  data: T
}
```

Failure:

```ts
type UiApiFailure = {
  ok: false
  error: {
    code: string
    message: string
  }
}
```

### Harvester dry-run response

Wrap existing `runCodexProjectMemoryHarvest` result:

```ts
type UiHarvestDryRun = {
  result: CodexProjectMemoryHarvestResult
}
```

The server must force `dryRun: true` even if browser payload includes other values.

## Testing

Unit and integration tests:

- API route handler returns status/dashboard JSON.
- Pending/active endpoints read from seeded temp memory roots.
- Harvester dry-run endpoint does not write pending candidates.
- Missing model config returns `needs_model_config` without API call.
- CLI `codex ui --port 0` starts and serves `/`.
- Unknown route returns expected 404.
- Static assets contain expected navigation labels and disabled write-action copy.
- Server rejects or ignores request body fields that attempt to set `cwd`.

Frontend verification:

- Use Browser to open local UI.
- Check first screen is nonblank.
- Check Sidebar Console layout on desktop and mobile widths.
- Check Inbox disabled write actions are visible and disabled.
- Check Harvester dry-run renders `needs_model_config` state in missing config environment.
- Check text does not overflow buttons/panels.
- Check palette does not become one-note: coral only for primary/action accents, teal/amber/red for state, warm neutral for surfaces.

Repository verification:

```bash
npm test
npm run typecheck
npm run build:plugin
python3 /Users/phoenix/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugin
git diff --check
```

## Documentation Updates

README:

- Add `cyrene-continuity codex ui`.
- Explain v1 Web UI is read-first and only supports harvest dry-run as an action.
- Clarify write actions remain CLI-only in v1 and still require review hash.

Skill:

- Add guidance: use Web UI when the user wants visual inspection of the memory pipeline.
- Do not treat disabled UI write controls as user approval.
- Do not use pending content as active memory just because it appears in the UI.

## Open Decisions Closed By User

- Visual style: Soft UI / Neumorphism, specifically tactile Warm Cream Coral.
- Main layout: Sidebar Console.
- v1 scope: read-only console plus harvester dry-run.
- Implementation stack: Node `http` + static HTML/CSS/JS, no React/Vite/Tailwind.

## Remaining Implementation Decisions

These are implementation-level, not product-level:

- Whether `codex-ui-static.ts` is manually maintained or generated by `build:plugin`.
- Exact JSON shapes for grouped `project-memory` endpoint.
- Whether `/api/dashboard` returns text-parsed dashboard data or a richer structured aggregate. Prefer structured aggregate, using existing readers.
