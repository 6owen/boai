<div align="center">
  <img src="apps/electron/resources/boai-mascot.png" width="160" alt="BoAI 奶牛图标" />

  <h1>BoAI</h1>

  <p><strong>本地优先的个人 AI 资产与 Skills 管理器</strong></p>
  <p>先把分散在不同 Agent、Workspace 和项目中的 Skills 管理清楚，再逐步扩展到更多 AI 资产。</p>

  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="Apache 2.0 License" /></a>
    <img src="https://img.shields.io/badge/status-active%20development-f97360" alt="Active development" />
  </p>
</div>

> [!IMPORTANT]
> BoAI 正在持续开发中。当前 README 只提供从源码运行的方式，不再使用上游 Craft Agents 的安装脚本、更新服务或品牌资源。

## BoAI 是什么

AI Agent 的能力通常散落在不同目录和配置中：全局 Skills、Workspace Skills、项目级 Skills、MCP、Tools、Plugins、Hooks、Commands、Knowledge 和 Memory。文件虽然都在本机，却很难回答这些问题：

- 我安装了哪些 Skills？
- 同名 Skill 是否存在多个副本？
- 它来自哪里、修改过什么、在哪个 Agent 中生效？
- 更新或删除后，能否预览差异并安全恢复？

BoAI 希望为这些本地 AI 资产提供一个可见、可追溯、可恢复的管理界面。

**文件可见 · 来源可追溯 · 修改可预览 · 操作可恢复 · 作用域明确**

## 当前重点

### Skills Manager

- 统一查看全局、Workspace 与项目中的 Skills。
- 保留同名或多位置副本，避免合并后丢失真实文件状态。
- 提供已安装 Skills、我的 Skills、详情与使用统计视图。
- 支持从聊天和工作区中发现、创建并使用 Skills。

### Agent 工作区

BoAI 继承并继续维护上游项目中的 Agent 工作区能力：

- 多会话管理、状态流转、标记和历史记录。
- 多种 LLM 连接与 Workspace 默认模型配置。
- MCP、REST API 与本地文件系统数据源。
- Explore、Ask to Edit、Auto 三种权限模式。
- 文件附件、工具调用展示、多文件 Diff 和主题系统。

### 本地优先

- 配置、会话、Skills 和工作区数据优先保存在本机。
- 本地 MCP Server 作为子进程运行。
- 凭据由本地凭据存储管理，不应提交到版本控制。

## 路线图

### 现在：Skills Manager MVP

- 完善 Skill 的发现、详情、创建和 Agent 使用体验。
- 清晰展示不同作用域与位置中的本机 Skills。
- 让已安装、我的 Skills 和使用统计更容易理解。

### 接下来：安全管理闭环

- 记录来源、版本、内容哈希与操作历史。
- 支持安装、更新 Diff、安全卸载、备份与恢复。
- 明确展示 Skill 在哪个 Agent、Workspace 或项目中生效。

### 以后：个人 AI 资产中心

- 管理 Tools、Plugins、MCP、Hooks、Commands 与 Permissions。
- 管理可查看、可编辑、可删除的 Knowledge 与 Memory。
- 通过 Profile 和 Injection Plan，把能力安全地交给不同 Agent 使用。

完整内容见 [BoAI 路线图](apps/electron/resources/release-notes/roadmap.md)。路线图表达产品方向，不承诺固定日期。

## 从源码运行

### 环境要求

- [Bun](https://bun.sh/)
- Node.js 18 或更高版本（部分工具需要）
- macOS、Windows 或 Linux

### 安装与启动

```bash
git clone https://github.com/6owen/boai.git
cd boai
bun install
bun run electron:dev
```

首次启动后，在应用内配置 LLM 连接并创建 Workspace。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `bun run electron:dev` | 启动 Electron 开发模式 |
| `bun run electron:start` | 构建并启动桌面端 |
| `bun run electron:build` | 构建桌面端全部资源 |
| `bun run electron:dist:mac` | 生成 macOS 安装包 |
| `bun run electron:dist:win` | 生成 Windows 安装包 |
| `bun run electron:dist:linux` | 生成 Linux 安装包 |
| `bun run lint` | 执行项目 Lint |
| `bun run typecheck:all` | 执行完整 TypeScript 检查 |

## 远程模式与 CLI

仓库仍保留 Headless Server、WebUI 和 CLI，可用于远程会话或自动化场景。

```bash
# 启动远程 Server
CRAFT_SERVER_TOKEN=$(openssl rand -hex 32) bun run server:start

# 查看 CLI 帮助
bun run apps/cli/src/index.ts --help
```

远程模式目前继续使用 `CRAFT_SERVER_*`、`CRAFT_RPC_*` 等兼容环境变量，避免破坏已有脚本和部署。

## 项目结构

```text
boai/
├── apps/
│   ├── electron/              # BoAI 桌面端
│   ├── cli/                   # 命令行客户端
│   ├── webui/                 # 远程 Web 客户端
│   └── viewer/                # 会话查看器
├── packages/
│   ├── core/                  # 共享类型与基础模型
│   ├── shared/                # Agent、配置、Skills、Sources 等核心逻辑
│   ├── ui/                    # 共享 React UI
│   ├── server/                # Headless Server 入口
│   ├── server-core/           # RPC 与服务端核心逻辑
│   └── pi-agent-server/       # Pi Agent 后端
└── scripts/                   # 构建、校验与发布脚本
```

主要技术栈：Bun、TypeScript、Electron、React、Vite、Tailwind CSS v4、shadcn/ui、Claude Agent SDK 与 Pi SDK。

## 数据目录与兼容边界

BoAI 当前仍使用 `~/.craft-agent/` 作为本地数据目录，并保留以下内部兼容标识：

- `@craft-agent/*` Workspace 包名
- `CRAFT_*` 环境变量
- `craftagents://` Deep Link 协议
- 既有 App ID、OAuth 回调和本地日志路径

这些标识不会作为 BoAI 产品品牌展示。它们暂时保留，是为了兼容已有数据、导入路径、脚本、OAuth 和 Deep Link；在没有迁移方案前，不建议直接批量重命名。

作为真实第三方数据源存在的 Craft 连接器仍使用其官方名称。

## 更新

BoAI 默认不连接上游 Craft Agents 的自动更新服务。需要自建更新通道时，可以在构建或运行环境中配置 `BOAI_UPDATE_URL`。

## 上游关系

BoAI fork 自 [Craft Agents OSS](https://github.com/craft-ai-agents/craft-agents-oss)，并在其 Apache 2.0 许可基础上继续开发。

BoAI 是独立项目，与 Craft Docs Ltd. 没有隶属、赞助或官方认可关系。“Craft”与“Craft Agents”仅在说明上游来源、兼容标识或真实第三方连接器时使用。

## 参与贡献

- 提交问题或建议：[GitHub Issues](https://github.com/6owen/boai/issues)
- UI 改动请附截图或录屏。
- 功能改动请说明验证方式，并避免覆盖无关的本地修改。
- 涉及兼容标识、数据目录或协议的改动，应同时提供迁移方案。

## License

本项目使用 [Apache License 2.0](LICENSE)。上游代码、第三方组件及其商标仍分别受各自许可和政策约束。
