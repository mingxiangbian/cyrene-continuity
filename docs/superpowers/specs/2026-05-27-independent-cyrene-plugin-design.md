# Independent Cyrene Codex Plugin Design

## 目标

把 `cyrene-continuity` 从“repo 本地开发桥接”升级为真正独立的 Codex plugin。完成后，Codex 应通过 plugin 加载 `cyrene-continuity` skill 和 Cyrene MCP，不再依赖手写的 `~/.codex/config.toml` `[mcp_servers.cyrene]` 配置，也不再要求 hook 或 automation 直接调用 `/Users/phoenix/Assistant/cyrene-continuity` 里的 `npm run dev`。

## 非目标

- 不迁移根目录旧 `.cyrene/memory`。用户已确认当前根目录没有这个文件或目录。
- 不改变 Cyrene memory 数据位置。长期数据继续使用 `~/.cyrene/codex/...`。
- 不改 MCP tool 名称或语义。
- 不把 memory 写入 plugin cache、plugin source 或 repo 内部。
- 不直接 promote 或 reject pending memory candidate。

## 当前状态

当前 repo 已经实现 MCP server，入口在 `src/mcp/mcp-server.ts`：

- server name: `cyrene`
- 主要 tools:
  - `cyrene_project_identify`
  - `cyrene_continuity_get`
  - `cyrene_memory_propose`
  - `cyrene_memory_pending_list`
  - `cyrene_memory_pending_get`
  - `cyrene_memory_promote`
  - `cyrene_memory_reject`
  - `cyrene_memory_dream_run`
  - `cyrene_memory_profile_get`

当前 plugin manifest 位于 `plugin/.codex-plugin/plugin.json`，只声明了 skill，没有声明 `mcpServers`。

当前 Codex MCP 由 `~/.codex/config.toml` 手写配置启动：

```toml
[mcp_servers.cyrene]
command = "npm"
args = ["--prefix", "/Users/phoenix/Assistant/cyrene-continuity", "run", "--silent", "dev", "--", "mcp-server", "--stdio"]
enabled = true
required = false
startup_timeout_sec = 20
tool_timeout_sec = 60
```

当前 Stop hook 仍调用 repo：

```bash
npm --prefix /Users/phoenix/Assistant/cyrene-continuity run --silent dev -- codex hook stop
```

当前 `Cyrene Memory Dream Deep` automation 也调用 repo：

```bash
npm run dev -- codex memory dream --stage deep
```

## 设计方案

采用“plugin MCP + stable shim”的两层设计。

### 1. Plugin MCP

在 plugin 内增加 `.mcp.json`，并在 `plugin/.codex-plugin/plugin.json` 中声明：

```json
{
  "mcpServers": "./.mcp.json"
}
```

`.mcp.json` 必须声明同名 server：

```json
{
  "mcpServers": {
    "cyrene": {
      "command": "...",
      "args": ["mcp-server", "--stdio"],
      "cwd": "."
    }
  }
}
```

实现时需要让 `command` 指向 plugin 内可运行 runtime，不能再依赖 `/Users/phoenix/Assistant/cyrene-continuity`。可接受的实现是把 runtime 打包进 plugin，例如 `plugin/package.json` + compiled JS，或 plugin-local executable shim。最终选择以 Codex plugin validator 和本地 MCP smoke test 为准。

### 2. Stable Shim

hook 和 automation 不直接指向 plugin cache 路径，因为 plugin cache 路径会随安装和版本变化。

新增稳定入口：

```text
~/.cyrene/codex/bin/cyrene-continuity
```

该 shim 由安装或迁移命令生成，负责转发到当前已安装 plugin runtime。hook 和 automation 只调用这个稳定入口：

```bash
~/.cyrene/codex/bin/cyrene-continuity codex hook stop
~/.cyrene/codex/bin/cyrene-continuity codex memory dream --stage deep
```

这样 plugin 升级时只需要更新 shim 指向，不需要反复修改 Codex hook 和 automation。

### 3. Memory 数据

memory 数据继续使用当前 Codex memory root：

```text
~/.cyrene/codex
```

全局 memory 和项目 memory 保持现有结构：

```text
~/.cyrene/codex/global/memory
~/.cyrene/codex/projects/<projectId>/memory
```

plugin runtime 只能读写这些外部稳定路径，不能把长期 memory 放在 plugin 目录。

### 4. Compatibility Contract

迁移后必须保持以下兼容性：

- MCP server name 保持 `cyrene`。
- MCP tool 名保持不变。
- 每个 tool 的 input schema 保持向后兼容。
- `cyrene-continuity` skill 名保持不变。
- `codex hook stop`、`codex memory dream`、`codex memory profile` 等 CLI 子命令保持可用。
- `codex doctor` 能识别 plugin/shim 状态，并提示旧手写 MCP 配置是否仍存在。

## 安装和迁移流程

实现应提供一个明确的迁移命令，建议继续扩展现有 CLI：

```bash
cyrene-continuity codex install --plugin
```

该命令负责：

1. 确认或创建 `~/.cyrene/codex/bin`。
2. 写入或更新 `~/.cyrene/codex/bin/cyrene-continuity` shim。
3. 安装或更新 Codex Stop hook，使它调用 stable shim。
4. 输出应删除或禁用的旧 `[mcp_servers.cyrene]` 手写配置。
5. 输出需要用户在 Codex plugin UI 中重新安装或刷新 plugin 的提示。

实际实现可以拆分为更小命令，但最终用户路径必须清楚，不能要求用户手动拼装多个不稳定路径。

## 自动化影响

`每日存在主义自我访谈` automation 依赖 MCP tool `cyrene_continuity_get`。只要 plugin MCP 继续暴露同名 tool，它可以保持语义兼容。

`Cyrene Memory Dream Deep` automation 当前依赖 repo 命令。迁移后应改为调用 stable shim：

```bash
~/.cyrene/codex/bin/cyrene-continuity codex memory dream --stage deep
```

如果 Codex automation 运行环境没有继承用户 shell `PATH`，automation prompt 必须使用绝对路径，不能只写 `cyrene-continuity`。

## 错误处理

- 如果 plugin runtime 不存在，stable shim 应输出清晰错误，提示重新运行安装或重新安装 plugin。
- 如果旧手写 MCP 和 plugin MCP 同时启用，doctor 应标记冲突或至少提示用户禁用旧配置。
- 如果 Stop hook 里仍存在旧 repo 命令，install 命令应替换旧 Cyrene hook，同时保留无关 hook。
- 如果 automation 仍指向 repo 命令，doctor 应提示需要更新 automation。

## 测试策略

需要覆盖这些行为：

- plugin manifest validation 通过。
- `.mcp.json` 声明 `cyrene` server。
- plugin MCP smoke test 能 list 出所有 `cyrene_*` tools。
- stable shim 可以运行 `codex hook stop` 和 `codex memory dream --stage light`。
- hook installer 使用 stable shim，不再使用 repo-local `npm --prefix ... run dev`。
- doctor 能识别 plugin/shim 状态和旧手写 MCP 配置。
- automation 文案或配置迁移后不再依赖 repo path。

## 验收标准

完成后应满足：

1. 新 Codex thread 中，Cyrene MCP 由 plugin 暴露，而不是由手写 `~/.codex/config.toml` 暴露。
2. `cyrene_continuity_get`、pending review、memory dream、profile tools 均可用。
3. Stop hook 调用 `~/.cyrene/codex/bin/cyrene-continuity codex hook stop`。
4. Dream Deep automation 调用 `~/.cyrene/codex/bin/cyrene-continuity codex memory dream --stage deep`。
5. `~/.cyrene/codex/...` memory 数据保持原位且可读。
6. `npm test` 和 `npm run typecheck` 通过。
