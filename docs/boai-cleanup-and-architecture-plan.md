# BoAI 产品精简与架构清理计划

> 状态：Draft / Proposed  
> 日期：2026-08-23  
> 目标版本：BoAI Core 1.0  
> 文档用途：指导从 Craft Agents fork 逐步收敛为 BoAI，而不是作为一次性大重写清单。

## 0. 执行摘要

BoAI 的第一阶段产品不需要继续承载 Craft Agents 的团队工作流、自动化编排和多层内容组织。当前应收敛为一个本地优先、面向个人使用的 AI 内容与能力管理器。

BoAI Core 只保留四条核心业务链：

1. BYOK：配置自己的模型供应商、API Key 或 OAuth 连接。
2. 会话：创建、搜索、打开、重命名和删除 AI 会话。
3. 数据源：连接并管理 MCP、API 和本地数据源。
4. Skills：发现、安装、更新、收藏和卸载技能。

未来再在这个核心上增加：

5. 知识库：管理可检索、可引用的个人资料。
6. Memory：管理 AI 对用户的长期认识、偏好和稳定结论。

当前推荐的产品信息架构是：

```text
BoAI
├── 所有会话
├── 数据源
├── 技能
└── 设置
    ├── AI 模型连接（BYOK）
    ├── 通用
    ├── 外观
    └── 权限与隐私

Later
├── 知识库
└── Memory
```

核心策略不是马上删除所有旧字段，而是按以下顺序推进：

> 停止副作用 → 移除产品入口 → 保留旧数据兼容 → 断开消费者 → 删除协议与实现 → 最后迁移数据。

禁止采用一次性全局删除、全局品牌替换或原地移动用户目录的方式。

### 0.1 下一次开发的明确起点

下一次开发不要先改品牌，也不要先重构 AppShell。建议只开一个短分支完成以下两个可审查提交：

1. `test: characterize boai core flows`：固定普通/archived/hidden 会话可见性，以及旧 Project context 行为。
2. `feat: decommission automation execution`：彻底停止 Automation runtime、隐藏入口、重定向旧路由。

第二个提交的硬性不变量是：即使旧 Workspace 中存在有效 `automations.json` 和 retry queue，启动应用后也不得创建 Automation runtime、启动 timer、注册事件订阅、创建会话、发送 webhook、消费 retry 或写 Automation history/event log。

这两个提交通过 Electron/CDP 和 runtime 测试后，再开始删除 Automation 的 UI/RPC/engine。

---

## 1. 产品定位

### 1.1 一句话定位

BoAI 是一个本地优先的个人 AI 使用与内容管理器：用户可以连接自己的模型，管理会话、数据源和 Skills，并逐步沉淀个人知识与 Memory。

### 1.2 当前用户价值

当前版本必须把以下闭环做好：

```text
连接模型 → 选择数据源和 Skill → 发起会话 → 保存会话 → 再次打开继续使用
```

只要这个闭环稳定，BoAI 就已经具备独立产品价值。自动化、项目看板、复杂标签体系并不是当前定位的必要条件。

### 1.3 当前明确保留

- Electron 桌面应用。
- BYOK 与模型连接管理。
- 会话创建、发送、流式输出、停止和恢复。
- 会话标题、搜索、重命名、删除。
- 会话附件、工作目录和运行时所需文件。
- 数据源的添加、认证、测试、编辑和删除。
- Skills 的扫描、安装、更新、收藏和卸载。
- Agent 权限模式和凭据安全存储。
- 为 Electron 本地运行提供服务的 RPC 与 Agent runtime 边界。
- 必要的日志、错误恢复、自动更新和跨平台能力。

### 1.4 当前明确移除或下线

- 自动化：定时、事件触发和 agentic automation。
- Projects 的用户界面、新建、编辑和新绑定能力。
- 会话工作流状态：Todo、In Progress、Needs Review、Done 等。
- 会话标签和基于标签的视图。
- Flagged、Archived、Kanban、Custom Views。
- 会话列表的复杂 include/exclude 筛选和按状态/项目分组。

### 1.5 推荐后续移除，但需要单独确认

以下能力不属于用户当前明确保留的核心，可以在核心清理稳定后逐项决定：

- Telegram、WhatsApp、Lark 等消息入口。
- Remote Workspace、远程 Server 和 Web UI。
- CLI 远程客户端。
- 会话公开分享与 Web Viewer。
- 跨 Workspace 资源传输。
- 多 Workspace 管理界面。
- Task/Conductor 编排产品（task.yaml、任务图、Run/Pause/Resume 等）。
- 营销站、公开文档站和与 Craft 服务绑定的发布基础设施。

这些能力不应与本轮核心清理混在一个提交中删除。

Task/Conductor 与普通会话内部的 background task output 不是同一能力。若删除 Task/Conductor，必须先证明普通会话的工具调用、异步输出和 Agent runtime 不再依赖同名 channel；禁止按 `tasks:*` 名称整组机械删除。

---

## 2. 当前代码审计结论

### 2.1 代码复杂度不是只存在于 UI

基于当前仓库的启发式扫描：

- 自动化相关文件约 61 个。
- Project 相关文件约 15 个。
- Labels、workflow status、views、board 相关文件约 106 个。
- Messaging 相关文件约 89 个。
- 包含 Craft 品牌、旧目录或旧环境变量的文件约 300 个。

这些数字不是删除目标，只说明相关能力已经横跨 renderer、RPC、server、Agent runtime、配置监听、存储、i18n 和测试，不能通过删除几个页面完成清理。

### 2.2 Workspace 与 Project 是两层不同概念

Workspace 是当前真正的数据作用域：Sessions、Sources、Workspace Skills、权限和部分配置都依赖它。

Project 只是 Workspace 内的可选二级组织：

- Session 通过可选的 `projectId` 与 Project 关联。
- Project 可以提供默认 working directory。
- Project 可以包含 Assets。
- Project 的 `MEMORY.md` 会被注入旧会话的 Agent 上下文。

因此：

- 可以立即取消 Project 的产品概念和用户入口。
- 不能在同一阶段连 Workspace 一起删除。
- 不能直接删除旧 Project 文件或清空旧会话的 `projectId`。

推荐将 Workspace 暂时降级为用户不可见的内部 `AppScope`，默认只使用一个 Workspace。等核心稳定后，再评估是否值得把目录结构真正扁平化。

### 2.3 自动化是常驻后台系统

自动化不是只有一个侧栏入口。应用启动时会为 Workspace 创建 `AutomationSystem`，并启动：

- 定时任务 Scheduler。
- 事件总线与会话 metadata diff。
- Prompt/Webhook handlers。
- Webhook retry queue。
- 自动化 history 和 event log。

因此只隐藏 UI 是不安全的：旧 `automations.json` 仍可能在后台创建会话或发出 webhook。

自动化清理的第一个提交必须同时完成：

1. 停止创建自动化运行时。
2. 隐藏所有自动化入口。
3. 将旧自动化路由安全重定向到“所有会话”。

### 2.4 扁平会话列表仍有不可误删的 runtime 字段

新列表只需要显示所有普通会话，但下列字段或行为仍应保留：

- `hidden`：内部会话、草稿和部分任务会话不应突然暴露。
- `isProcessing`：显示会话当前是否运行。
- `hasUnread` / `lastReadMessageId`：基础的新消息反馈。
- `workingDirectory` / `sdkCwd`：Agent 执行和 session resume 需要。
- `enabledSourceSlugs`：会话选择的数据源。
- model、connection、permission、branch、pending plan 等运行时信息。

可以停止使用但先兼容读取的旧 metadata：

- `isFlagged`
- `isArchived` / `archivedAt`
- workflow `sessionStatus`
- `labels`
- `projectId`
- automation `triggeredBy`

旧字段没有必要批量重写所有 session JSONL。新代码不再产生它们，旧读取器忽略或兼容它们即可。

### 2.5 当前已经存在存储分裂风险

当前机器同时存在 `~/.craft-agent` 和 `~/.boai`，而且不是同一份数据：

- `~/.craft-agent` 中存在主要 Workspace、会话、Workspace Skill 和 LLM Connections。
- `~/.boai` 中存在另一套不同 Workspace ID，目前基本为空。

仓库当前没有正式的 `.boai` 默认路径实现。现有 `.boai` 很可能来自外部 `CRAFT_CONFIG_DIR` 覆盖，但凭据、日志、window state 等模块仍有硬编码 `.craft-agent` 的情况。

这意味着当前可能已经有部分数据写入 `.boai`、另一部分仍写入 `.craft-agent`。正式迁移前必须先统一所有路径解析，严禁直接覆盖现有 `~/.boai`。

### 2.6 Skills 不全部属于 BoAI 数据目录

Skills 可能来自：

- 全局 Agent Skill 目录。
- Workspace Skill 目录。
- 当前 working directory 下的项目级 Skill 目录。
- Codex、Claude 或插件管理器的安装目录。

迁移 `.craft-agent → .boai` 时，只迁 BoAI 自己管理的 Workspace 数据和元数据。不要移动或重命名 `~/.agents`、`~/.codex`、`~/.claude` 等外部 Agent 目录。

---

## 3. 已确认的架构决策

### D1. BoAI 是本地优先、单用户产品

第一阶段不为团队审批、跨用户共享或远程运维优化架构。

### D2. 产品上移除 Project，内部暂时保留一个 Workspace

用户只看到 BoAI，不需要理解 Workspace/Project 层级。内部仍用一个默认 Workspace 作为 Sessions 和 Sources 的隔离根，避免立即重写大量稳定存储代码。

### D3. 会话只有一个主列表

列表规则：

- 排除 `hidden=true` 的内部会话。
- 包含历史上曾被 archived 的普通会话，避免入口移除后数据“消失”。
- 默认按最近更新时间倒序。
- 保留搜索、分页或增量加载。
- 保留 New、Rename、Delete。
- 不再提供 status、label、flag、archive、project 或 custom view 筛选。

### D4. 先停止自动化副作用，再删除代码

自动化的 runtime shutdown 是安全变更，不应等待 UI 清理完成。

### D5. Project 先进入 Legacy Read-Only

- 不允许新建 Project。
- 不允许新会话绑定 Project。
- 不允许从 UI 删除旧 Project。
- 旧 Project-bound 会话仍可解析原 working directory、Assets 和 Memory。
- 等 Knowledge/Memory 有承接模型后，再迁移并删除 Legacy Project resolver。

### D6. `.boai` 迁移采用复制、校验和可回滚切换

不原地移动，不自动删除旧目录，不在源目标冲突时自动合并。

### D7. 用户可见品牌与内部代码品牌分开处理

先完成 BoAI 的产品名、UI、图标和用户目录。内部的 `@craft-agent/*` package scope、部分 `CRAFT_*` 环境变量和历史兼容标识最后再处理，因为它们对用户价值很低、变更面很大。

### D8. 先减法，后重构

不要先花时间重构即将删除的 Automation、Project、Labels 或 Board 代码。先用 characterization tests 固定核心行为，按垂直能力删除，再重构剩余的 AppShell、RPC 和 domain 边界。

### D9. BYOK 本轮只简化产品入口，不删除 Provider 能力

现有 connection/credential/provider 数据模型继续作为兼容真源。首次启动和设置页改成简单入口，高级认证方式收进“高级”；本轮不批量删除 Anthropic、ChatGPT、Copilot、兼容 API、本地模型或 IAM 等底层 adapter。

---

## 4. BoAI 目标架构

### 4.1 分层

```text
┌──────────────────────────────────────────────────────────┐
│ Electron Renderer                                        │
│ Sessions │ Sources │ Skills │ Settings                   │
├──────────────────────────────────────────────────────────┤
│ Typed Application API / RPC                              │
├──────────────────────────────────────────────────────────┤
│ Application Use Cases                                    │
│ Conversations │ Source Management │ Skill Management     │
│ AI Connections │ Preferences                             │
├──────────────────────────────────────────────────────────┤
│ Domain / Runtime                                         │
│ Agent Runtime │ LLM Adapters │ Source Adapters           │
│ Skill Discovery │ Session Persistence                    │
├──────────────────────────────────────────────────────────┤
│ Infrastructure                                           │
│ AppPaths │ Credentials │ Filesystem │ Network │ Logging  │
└──────────────────────────────────────────────────────────┘

Future domains: Knowledge Library │ Personal Memory
```

### 4.2 核心领域边界

#### AI Connections

负责：

- Provider 和 model definition。
- API Key、OAuth、IAM 或本地 endpoint 配置。
- 连接测试、模型刷新和默认连接。
- 非敏感连接 metadata 与敏感 credential 分离。

不负责：

- Workspace 导航。
- 会话列表分类。
- 数据源认证。

#### Conversations

负责：

- Session 生命周期。
- Message persistence 与流式事件。
- working directory、附件、模型、权限、Sources 和 Skills 的会话绑定。
- 搜索、恢复和删除。

不负责：

- Workflow status。
- Labels、Projects、Kanban 或 Automation。

#### Sources

负责：

- MCP、API、本地目录等 Source CRUD。
- Source credential、OAuth、连接测试和工具发现。
- 会话对 Source 的启用关系。

#### Skills

负责：

- 从 Agent、Workspace、working directory 和 plugin 位置发现 Skill。
- 安装、更新、卸载、来源信息和收藏。
- 向会话/Agent runtime 暴露可用 Skill。

#### Infrastructure

负责：

- 唯一的 AppPaths。
- 凭据加密存储。
- 日志、配置、迁移和备份。
- 本地 RPC 和 Agent 子进程生命周期。

### 4.3 Workspace 的临时角色

第一阶段把 Workspace 当成内部实现细节：

```text
BoAI App
└── internal default workspace
    ├── sessions
    ├── sources
    ├── workspace skills
    └── permissions/config
```

不要在清理初期把所有 `workspaceId` 参数一起删除。先在 application boundary 注入唯一 Workspace，再根据实际剩余调用点评估是否值得移除 ID。

---

## 5. 分阶段清理计划

每个提交必须满足：应用能够启动、已有会话不会丢失、BYOK/Sources/Skills 主链仍可用。

### Milestone 0：建立清理基线

目标：在开始删除前，给核心行为建立最低安全网。

#### Commit 0.1 — `test: characterize boai core flows`

- 增加会话列表 selector 的 characterization tests。
- 确认普通 archived 会话在新扁平列表中仍可见。
- 确认 `hidden` 会话仍被排除。
- 确认 processing/unread 信息仍保留。
- 确认旧 Project-bound 会话仍能获得原有 prompt context。
- 声明旧 session metadata 的只读兼容策略和数据迁移不得删除源数据的规则。
- 记录 `.craft-agent` 与 `.boai` 当前冲突状态。
- 固化 Electron/CDP smoke 流程。
- 覆盖冷启动、BYOK、创建会话、发送、停止、重启恢复和搜索。
- 覆盖 Source CRUD/test。
- 覆盖 Skill scan/install/check/update/uninstall。

验收：基线测试通过；工作目录仍是当前旧目录，不发生迁移。

### Milestone 1：安全下线 Automation

目标：先终止后台副作用，再删除产品与代码入口。

#### Commit 1.1 — `feat: decommission automation execution`

- 停止为 Workspace 创建 `AutomationSystem`。
- 不启动 Scheduler、webhook handler 和 retry queue。
- 隐藏侧栏及命令搜索中的 Automation 入口。
- 将已持久化的旧 Automation route 重定向到所有会话。
- 保留旧配置文件，不修改、不执行。

这是安全边界提交。发布后即使后续 UI 清理回滚，旧自动化也不能恢复后台执行。

此提交必须以 runtime 断言证明：

- Workspace 的 Automation runtime registry 始终为空。
- Scheduler 和 retry scheduler 的 start 调用次数为零。
- 不注册 Automation event subscriber。
- Prompt/Webhook handler 不可达。
- 启动带旧 Automation 配置的 Workspace 后，等待超过一个调度周期也没有副作用。
- 原 `automations.json`、retry queue、history 和 event log 均未被消费或改写。

#### Commit 1.2 — `refactor: remove automation renderer`

- 删除列表、详情、测试、历史、Cron builder 和 automation menus。
- 删除对应 atom、hook、context props 和 main content branch。
- 删除添加/编辑 Automation 的 AI Edit Popover。
- 从 navigation state 中删除 Automation 类型。
- 暂时保留旧 route 的兼容 redirect。

#### Commit 1.3 — `refactor: remove automation rpc contract`

- 删除 Automation RPC handler 和注册。
- 删除 Electron API、channel map 和 shared channels。
- 删除 server status 中的 automation count/scheduler 状态。
- 删除只为 Automation 服务的 DTO 和 push event。

#### Commit 1.4 — `refactor: detach automation from sessions and agents`

- 删除 SessionManager 内的 automation runtime map 和 metadata diff。
- 删除 prompt automation 执行入口。
- 删除 Agent backend 中的 automation hook 注入。
- 删除 automation 专用的 Telegram topic binder。
- 不删除普通 Session create/sendMessage 或普通消息平台绑定。

#### Commit 1.5 — `refactor: remove automation resource support`

- 跨 Workspace resource bundle 不再导出 Automation。
- 旧 bundle 中若存在 Automation，读取时忽略并给出 warning，不使整个 bundle 失败。
- 删除 ConfigWatcher、validator、session tool、system prompt 和文档索引中的 Automation 支持。

#### Commit 1.6 — `refactor: delete automation engine`

- 删除 shared Automation engine。
- 删除只被 Automation 使用的 Scheduler。
- 清理 exports、依赖、bundled docs 和非历史 i18n。
- 保留历史 release notes 原文。

验收：应用运行期间没有 Automation timer、retry queue 或 Automation 写入；BYOK、Sessions、Sources、Skills 回归通过。

### Milestone 2：把会话收敛为单一列表

目标：用户只看到一个清晰的会话列表，同时不让旧数据消失。

#### Commit 2.1 — `refactor: introduce canonical visible sessions selector`

统一列表输入：

```text
workspace sessions
→ exclude hidden sessions
→ include legacy archived sessions
→ sort by updatedAt descending
→ apply text search
```

所有列表数量、空状态和搜索都使用同一 selector，避免多个页面各自解释 Session metadata。

#### Commit 2.2 — `refactor: canonicalize session routes`

- 保留一个 `sessions` / `allSessions` canonical route。
- Flagged、Archived、Status、Label、View 和 Board 旧路由统一 redirect。
- 清理 navigation state 和 URL serialization 的多 filter union。

#### Commit 2.3 — `refactor: simplify session navigation`

- 侧栏只保留“所有会话”。
- 删除 workflow states、Flagged、Archived、Labels、Views 和 Board 入口。
- 删除这些入口的数量计算、展开状态和拖拽排序。

#### Commit 2.4 — `refactor: simplify session list behavior`

- 删除 status/label/project include-exclude filters。
- 删除 per-view filter localStorage。
- 删除按 status、project 和 unread 分组。
- 可保留简单日期分组；如果仍显复杂，则使用完全扁平列表。
- 保留搜索和增量加载。

#### Commit 2.5 — `refactor: simplify session rows and menus`

- 移除 workflow status icon。
- 移除 label badge 和 Project tint/name。
- 移除 Status、Labels、Project、Flag、Archive 菜单。
- 保留 processing/unread、标题、时间、搜索命中信息。
- 菜单只保留当前真正需要的 Rename、Delete，以及运行所需的文件/目录操作。

#### Commit 2.6 — `refactor: stop loading session taxonomy in renderer`

- AppShell 不再加载 Labels、workflow Statuses、Views 和 Projects 列表。
- 删除 context 中只为这些能力存在的 props。
- 删除对应 renderer atoms/hooks 和 localStorage keys。
- 完成删除后再清理 i18n，避免先删文案造成运行时报错。

验收：所有普通历史会话都能在同一列表找到；hidden 会话不出现；创建、搜索、重命名、删除、恢复正常。

### Milestone 3：将 Project 降级为 Legacy Read-Only

目标：产品上不再有 Project，但旧会话上下文仍安全可用。

#### Commit 3.1 — `refactor: remove project product surfaces`

- 删除 Project 侧栏、列表、详情和创建入口。
- 删除 Session 菜单里的 Project 绑定操作。
- 新 Session API 不再接收 Project 参数。
- 旧 Project route 重定向到所有会话。

#### Commit 3.2 — `refactor: stop project mutations`

- 停止注册 create/update/delete/upload Project 的写 RPC。
- 不允许 UI 删除 Project 文件。
- 保留内部只读 Project context resolver。

#### Commit 3.3 — `refactor: isolate legacy project context`

Legacy resolver 只负责：

- 读取旧会话的 `projectId`。
- 恢复 working directory。
- 提供旧 Assets manifest。
- 提供旧 `MEMORY.md`。

新的产品代码不得继续依赖 Project 类型。

Legacy resolver 的读取契约：

- 只处理已有 Session 上的 `projectId`，不为新 Session 建立绑定。
- Session 已持久化的 working directory 优先，resolver 不覆盖它。
- Project 不存在、配置损坏、Asset 缺失或 `MEMORY.md` 缺失时，只记录诊断并继续打开会话。
- Assets 和 Memory 只作为旧会话上下文读取，不再通过 Project UI 修改。
- resolver 不得隐式创建、修复或删除 Project 文件。
- 只有在所有 legacy Project 已导出/迁移，并且一个兼容周期内不再出现 `projectId` 命中后，才允许删除 resolver。

#### Commit 3.4 — `feat: add legacy project export`

在未来正式删除前，提供一次性导出能力：

- Project metadata。
- Assets。
- `MEMORY.md`。
- 关联 Session ID 清单。

Project 的最终删除推迟到 Knowledge/Memory 具备明确承接位置之后。

验收：用户界面中没有 Project；新会话不产生 `projectId`；旧 Project-bound 会话仍可打开和继续运行。

### Milestone 4：删除 Session Taxonomy 后端

目标：在 UI 和所有消费者都已移除后，再删协议和存储实现。

#### Commit 4.1 — `refactor: remove taxonomy agent tools`

- 删除 Agent 自助修改 status/labels/archive 的 tools 与 prompt 指引。
- 删除 New Session action 中的 status/label 参数。
- 确认普通 session runtime status 没有被误删。

注意：workflow status 与 `running/idle/error` 等运行时状态不是同一概念，不得用全局搜索机械删除所有 `status`。

#### Commit 4.2 — `refactor: remove labels and workflow status rpc`

- 删除 Labels 和 workflow Statuses RPC。
- 删除 shared channels、events 和 renderer API。
- 删除 config watcher 对 labels/status config 的处理。

#### Commit 4.3 — `refactor: remove custom views and board`

- 删除 View config/storage/validators。
- 删除 Kanban/Board presentation 和相关拖拽逻辑。
- 删除 Tasks 对看板放置字段的依赖前，先确认 Tasks 是否也会下线。

#### Commit 4.4 — `refactor: remove conductor task product`

仅在确认 BoAI 不保留 Task/Conductor 后执行：

- 删除任务编辑、任务图、Run/Pause/Resume/Stop 等产品入口。
- 删除 TaskRunner、task spec RPC 和专用持久化。
- 删除与 Kanban placement、Project 和 taxonomy 的任务耦合。
- 保留普通会话仍需要的异步 operation/background output 协议，直到调用图证明可删。
- 将旧 task/session metadata 作为只读兼容字段，不暴露为普通会话。

#### Commit 4.5 — `refactor: retire taxonomy storage`

- 新代码不再创建 labels、statuses 和 views 配置。
- 旧配置文件只读保留一个兼容周期。
- 不批量改写历史 session JSONL。
- 最终仅删除已经无人读取的 helper、schema 和 docs。

验收：启动和运行时不读取 taxonomy 配置；旧字段不会导致解析错误；核心四条主链通过。

### Milestone 5：收敛为单一内部 Workspace

目标：去掉多 Workspace 的产品复杂度，但不进行高风险的存储大重写。

#### Commit 5.1 — `refactor: introduce app scope service`

- Application layer 通过 `AppScope` 获得唯一 active workspace。
- Renderer 不再到处传递和切换 Workspace。
- 底层 API 暂时保留 `workspaceId`，由边界层统一注入。

#### Commit 5.2 — `refactor: simplify onboarding workspace setup`

- BYOK 完成后自动创建或打开默认 Workspace。
- 删除新用户必须命名/选择 Workspace 的步骤。
- 设置页可显示数据目录，但不暴露 Workspace 管理。

#### Commit 5.3 — `refactor: hide workspace switching`

- 单 Workspace 用户直接进入所有会话。
- 零个 Workspace：创建一个 internal default workspace。
- 只有一个 Workspace：将它设为 AppScope，不移动数据。
- 多个 Workspace：优先预选有效的 `activeWorkspaceId`，但在隐藏切换 UI 前必须让用户确认 primary workspace。
- 非 primary Workspace 保持只读可发现，并提供会话、Sources 和 Workspace Skills 的导入/导出入口。
- 不自动合并 Workspace；名称、Source slug、connection slug 或 credential key 冲突必须逐项处理。
- 只有当所有旧 Workspace 的数据都可达或已明确归档后，才删除 Workspace picker。

#### Commit 5.4 — `refactor: remove remote workspace product flows`

仅在确认不需要远程能力后执行：

- 删除 remote workspace picker/transfer UI。
- 删除远程连接与跨 Workspace 操作。
- 保留 Electron 本地 RPC 与必要的 Agent process transport。

验收：冷启动无需理解 Workspace；旧用户数据仍从选定的 Workspace 加载；Sources 和 Sessions 作用域稳定。

### Milestone 6：统一路径并迁移到 `.boai`

目标：消除分裂存储，将 BoAI 自有数据安全切换到 `~/.boai`。

详细方案见第 7 节。

### Milestone 7：删除不属于 BoAI Core 的应用与包

目标：核心稳定后再缩小 monorepo。

推荐顺序：

1. 删除不再使用的 UI 和 build script。
2. 删除对应 app/package 的引用。
3. 删除 workspace package。
4. 更新 CI、release、typecheck 和 dependency lockfile。
5. 每次只删除一条纵向能力。

不要为了改 package 名称而先做全仓 import 重写。

### Milestone 8：重构剩余核心代码

目标：删除完成后再整理真正会长期保留的代码。

- 拆分过大的 AppShell。
- 将 Sessions、Sources、Skills、Settings 各自收拢为 feature module。
- 将 API types 按领域拆开，避免一个巨型 Electron API interface。
- 将 SessionManager 中与四条核心链无关的职责剥离。
- 为 Knowledge 和 Memory 留领域扩展点，但不提前实现数据库或 RAG。

---

## 6. BYOK 清理方案

### 6.1 现有架构中值得保留的部分

现有 BYOK 已经正确区分：

- 非敏感的 connection metadata。
- 加密存储的 API Key/OAuth Token/IAM credentials。
- Provider 类型和 Auth 类型。
- Connection test、model refresh 和 default model。
- Session 对具体 LLM connection 的绑定。

这条链不需要推倒重写。

### 6.2 简化后的首次启动

```text
欢迎使用 BoAI
→ 选择模型连接方式
→ 填写 API Key / OAuth / 本地 Endpoint
→ 测试连接
→ 选择默认模型
→ 自动进入“所有会话”
```

首次启动不再要求：

- 创建 Project。
- 配置 Automation。
- 选择 Session workflow。
- 创建或命名多个 Workspace。
- 配置消息平台或远程 Server。

本轮 BYOK 简化是信息架构调整，不是 Provider 数据迁移：

- 一级只展示“使用 API Key”“登录已有账号”“本地或自定义 Endpoint”三类入口。
- 进入后再选择 Anthropic、ChatGPT、GitHub Copilot、兼容 API 或本地 Provider。
- IAM、Service Account、Environment 等放进“高级设置”。
- 连接成功后自动设置可用的默认模型；用户仍可在设置中修改。
- 删除 onboarding 中与 Workspace、Remote Server、Messaging、Project 和 Automation 有关的步骤与状态。
- 已有 `LlmConnection`、connection slug 和 credential key 不改名、不重建。
- 没有明确弃用数据和迁移方案前，不删除任何底层 Provider adapter。

### 6.3 设置页目标结构

```text
AI 模型
├── 当前默认连接
├── 已配置连接
├── 添加连接
└── 每个连接的模型与认证状态

通用
├── 默认 working directory（可选）
├── 发送快捷键
└── 通知

权限与隐私
├── Agent 权限模式
├── 本地 MCP 开关
├── 数据目录
└── 凭据状态（不显示明文）
```

### 6.4 暂时隐藏而不是删除的认证能力

IAM、Service Account、Environment 和高级兼容 endpoint 可以先放进“高级”，不必第一轮删除底层支持。先根据真实使用情况决定是否维护，避免因为 UI 精简而破坏已有连接。

### 6.5 删除边界

本轮可以删除：

- Onboarding 中的 Workspace 创建/选择步骤。
- Remote Server 和 Messaging 的引导步骤。
- 重复的 Provider 说明页或同一凭据的多套表单状态。
- 已确认无消费者的旧 billing/setup presentation 状态。

本轮不能删除：

- Connection test、model refresh 和 default connection resolution。
- CredentialManager 与加密 credential backend。
- OAuth PKCE/state/callback 校验。
- Session 与具体 connection/model 的持久化绑定。
- Compat/local endpoint 支持。

### 6.6 BYOK 验收

- API Key 不进入普通 `config.json`。
- 连接测试失败时不保存半成品为默认连接。
- OAuth 回调能回到 BoAI。
- 重启后连接和默认模型仍存在。
- 删除连接时清理对应 credential。
- `.boai` 迁移后旧 credential 在同一台机器上仍可解密。

---

## 7. `.craft-agent → .boai` 迁移设计

### 7.1 实际迁移对象

目标根目录：

```text
~/.boai/
├── config.json
├── config-defaults.json
├── preferences.json
├── credentials.enc
├── drafts.json
├── window-state.json
├── docs/
├── permissions/
├── themes/
├── tool-icons/
├── logs/
└── workspaces/
    └── {internal-default-workspace}/
        ├── config.json
        ├── sessions/
        ├── sources/
        └── skills/
```

第一阶段保留原 Workspace 子目录结构。不要在品牌迁移的同时扁平化 sessions/sources，这会把两个独立风险混在一起。

### 7.2 先建立唯一 AppPaths

所有模块只能通过统一路径服务访问：

- `appRoot`
- `configFile`
- `credentialsFile`
- `preferencesFile`
- `workspacesDir`
- `logsDir`
- `docsDir`
- `themesDir`
- `permissionsDir`
- `windowStateFile`
- `migrationManifestFile`

禁止业务模块自行拼接 `homedir()` 和品牌目录。

第一步只统一路径调用，默认仍指向旧目录，不迁数据。并增加静态检查，禁止新增 `.craft-agent` 硬编码。

### 7.3 环境变量兼容

切换前：

```text
explicit BOAI_HOME
→ legacy CRAFT_CONFIG_DIR
→ ~/.craft-agent
```

迁移成功后：

```text
BOAI_HOME
→ deprecated CRAFT_CONFIG_DIR
→ ~/.boai
```

`CRAFT_CONFIG_DIR` 至少保留一个兼容版本，并打印一次弃用提示。开发多实例改为使用 `BOAI_HOME=~/.boai-dev-N`。

### 7.4 迁移算法

迁移必须在 SessionManager、watchers、RPC server 和 Agent subprocess 未运行时执行。

1. 解析旧根目录和目标根目录。
2. 检查两者是否存在、是否为空、是否包含 migration manifest。
3. 如果目标非空，停止自动迁移，进入冲突处理。
4. 复制旧目录到临时 staging 目录。
5. 校验关键文件和目录。
6. 校验所有关键 JSON 可解析。
7. 校验每个 session JSONL 至少能读取 header。
8. 校验 `credentials.enc` 能在当前机器解密。
9. 重写明确属于 BoAI 根目录的 Workspace root path。
10. 不修改旧会话的 `sdkCwd`。
11. 原子地将 staging rename 为 `~/.boai`。
12. 写 migration manifest、来源、版本、时间和校验摘要。
13. 新进程只写 `.boai`。
14. `.craft-agent` 保持只读不动，至少保留一个发布周期。

### 7.5 当前机器的冲突处理

由于当前 `~/.boai` 已存在，实际执行迁移前必须明确处理：

- 不覆盖现有 `~/.boai`。
- 先将现有目标完整备份为带时间戳的目录，或由用户选择保留哪个数据根。
- 不根据更新时间自动合并 Workspace、LLM connection 或 credential。
- 迁移完成后显示当前 active data root。

正式产品应提供三个选择：

1. 使用旧 Craft 数据迁移到 BoAI。
2. 保留当前 BoAI 数据。
3. 稍后处理，并以只读诊断模式启动。

确定性启动状态机：

| 旧目录 | 新目录 | 启动行为 |
|---|---|---|
| 不存在 | 不存在 | 创建全新的 `.boai` |
| 存在 | 不存在 | 提示迁移；确认后复制、校验并切换，取消则继续使用旧目录 |
| 不存在 | 存在但为空 | 在该目录初始化新的 BoAI 数据 |
| 不存在 | 存在且有数据 | 使用 `.boai`，执行完整性检查 |
| 存在 | 存在但为空 | 先把空目标 rename 为带时间戳的备份，再按“目标不存在”流程迁移；不得直接删除空目标 |
| 存在 | 存在且带同一 migration manifest | 使用 manifest 指定的新目录，旧目录只读保留 |
| 存在 | 存在但数据不同 | 禁止自动写入和自动切换，显示冲突报告，由用户选择 active root 或新的迁移目标 |

冲突状态下不得“哪个更新时间新就用哪个”。用户选择 active root 后，只允许该 root 写入；另一个 root 保持只读。若用户选择迁移到新的第三目录，则重新执行 staging/校验流程，不在两个现有目录之间就地合并。

这里的“空”必须由迁移器按业务文件判定：不存在有效 `config.json`、credentials、Workspace、Sessions、Sources 或 Workspace Skills。即使目录只有系统隐藏文件或临时文件，也先整体 rename 备份，绝不先递归删除。这样 staging 才能跨平台安全地原子 rename 到目标名称。

迁移成功必须以一个原子 active-root 指针或等价 manifest 为提交点。提交点之前继续使用旧 root；提交点之后只写新 root。任何校验失败都删除 staging 或保留诊断副本，但不能修改源目录和当前 active root。

### 7.6 凭据迁移护栏

- `credentials.enc` 可以在同一台机器复制。
- 现有加密 magic、salt purpose 和 key derivation 中包含 Craft 历史标识。
- 品牌改名时不要顺手修改这些字节或派生字符串。
- 如果未来要改，必须先尝试旧算法解密，再用新格式重加密，并保留明确的格式版本。

### 7.7 Electron userData 与 localStorage

修改 Electron `productName`、`appId` 或 bundle ID 可能让 Chromium 使用新的 userData 路径。以下数据可能因此看似消失：

- Skills “我的”收藏。
- theme 和 panel layout。
- 最近目录。
- 最后打开的会话和路由。
- Cookies、OAuth/browser partition 和 Cache。

同时需要迁移 renderer localStorage：

- 兼容读取 `craft-*` key。
- 新写入使用 `boai-*` key。
- 对 `skill-favorites` 等用户数据执行一次性复制。
- 不迁移已经删除的 session filter、grouping 和 Project appearance keys。

### 7.8 双读单写兼容期

- 新写入只进入 `.boai`。
- 新目录缺少某个明确的 legacy 文件时，可以只读回退到 `.craft-agent`。
- 每次 legacy fallback 记录诊断日志。
- 设置页显示数据根与 migration status。
- 回滚只切换 active root，不把新目录覆盖回旧目录。

### 7.9 旧目录退出条件

只有满足以下条件才提示用户归档旧目录：

- 新目录连续稳定运行至少一个发布周期。
- 核心 smoke tests 通过。
- 没有 legacy fallback 命中。
- 用户确认 Sessions、Sources、Skills 和 BYOK 均完整。

BoAI 不自动永久删除旧目录。

---

## 8. 品牌清理顺序

### 8.1 第一层：用户可见品牌

- 应用名称改为 BoAI。
- UI、窗口标题、About、安装包名称和图标改为 BoAI。
- 用户文档使用 BoAI 术语。
- 移除依赖 Craft 在线服务的非必要链接。
- 保留 fork 对应的 Apache-2.0 License 和必要 attribution。

### 8.2 第二层：系统身份

在 `.boai` 数据迁移稳定后再处理：

- Electron app ID / bundle ID。
- `boai://` deep link protocol。
- 签名、notarization、自动更新 feed。
- OS 权限、single-instance lock 和 installer upgrade path。

迁移期同时识别旧 `craftagents://`，但内部新生成链接只使用 `boai://`。

### 8.3 第三层：内部实现名称

最后再考虑：

- `@craft-agent/*` package scope。
- `CRAFT_*` 环境变量。
- 内部 class/function 名称。
- 测试 fixture 和 debug label。

不需要为了“看起来完全改名”而制造一次几千行、没有产品价值的 import diff。内部 package scope 可以在 BoAI Core 稳定后独立迁移。

### 8.4 外部服务依赖

切换以下内容前必须先有 BoAI 自己的服务或明确移除对应能力：

- OAuth relay callback。
- Slack/Microsoft 等 Source OAuth relay。
- Auto-update feed。
- 文档和发布地址。
- Session sharing/viewer 服务。

不能只把域名字符串换成不存在的 BoAI 地址。

---

## 9. Monorepo 收敛建议

### 9.1 第一阶段继续保留

即使名称仍带 Craft，以下职责当前仍属于 BoAI Core：

- Electron app。
- Shared domain/config/auth/skills/sources/session logic。
- Server core 中为 Electron 本地 RPC 和 SessionManager 服务的部分。
- Core types。
- Shared UI。
- Pi/Claude/Codex Agent runtime adapter。
- Session-scoped MCP/tools（只保留仍被 Agent runtime 使用的工具）。

### 9.2 推荐删除候选

若确认 BoAI 只做个人本地桌面产品，建议逐条删除：

1. Messaging gateway 与 WhatsApp worker。
2. Web Viewer 与会话公开分享。
3. Web UI 与 remote thin client。
4. Standalone headless server。
5. Remote CLI client。
6. 与上述应用绑定的 build/release scripts。

每删除一个 package，先证明 Electron core 没有运行时 import 或 build dependency。不要通过删目录后再修到编译通过的方式探索依赖。

### 9.3 暂时不做的 package 重构

- 不急于合并 `core`、`shared` 和 `server-core`。
- 不急于把本地 RPC 改成 renderer 直接调用 filesystem。
- 不急于把 Agent subprocess 全部内嵌进 Electron main。

这些边界虽然来自原项目，但仍提供进程隔离和测试价值。先删除业务复杂度，再根据剩余依赖决定是否合并。

---

## 10. 测试策略

### 10.1 测试原则

- 测外部行为，不锁死内部实现。
- 先写 characterization test，再删除旧实现。
- 每个 commit 都应能启动应用并通过对应 domain tests。
- UI 清理必须使用 Electron 开发环境和 CDP 做真实交互测试。
- 数据迁移必须使用临时目录，禁止用真实用户目录做自动化测试。

### 10.2 每个 Milestone 的最低验证

#### Static

- TypeScript typecheck。
- ESLint。
- i18n parity/sorted/coverage。
- `git diff --check`。

#### Unit / Integration

- Route canonicalization 和 legacy redirect。
- Session visible selector。
- Session persistence/restart。
- LLM connection metadata 与 credential separation。
- Source CRUD/auth/test。
- Skill discovery/install/update/delete。
- AppPaths resolution。
- Migration conflict matrix。

#### Electron + CDP

- 冷启动进入所有会话。
- 添加 BYOK connection 并选择模型。
- 创建会话、发送消息、停止、继续。
- 重启 dev 后打开旧会话。
- 搜索和删除会话。
- 添加、编辑、测试和删除 Source。
- 扫描、安装、检查更新、更新和卸载 Skill。
- 确认没有 Automation timer 或后台创建的会话。
- 确认侧栏只有目标入口。

### 10.3 `.boai` 迁移矩阵

必须覆盖：

- 只有 `.craft-agent`。
- 只有 `.boai`。
- 两者都存在、目标为空。
- 两者都存在、都有真实数据。
- 自定义 `BOAI_HOME`。
- 旧 `CRAFT_CONFIG_DIR`。
- 两个开发实例并行。
- 凭据复制后 API Key 和各 OAuth 仍可用。
- 旧会话能打开并继续发送。
- 附件、计划、下载和长响应仍可读取。
- Sources OAuth/API Key/MCP 工具仍可用。
- Global、Workspace、working-directory、plugin Skills 都可发现。
- Window state、theme、permissions 和 logs 只写 active root。
- 迁移失败后可回滚到旧 root。
- `boai://` 与旧 protocol 的兼容期路由。

---

## 11. 风险清单

### 高风险

- 只隐藏 Automation UI，旧任务仍在后台运行。
- 直接删除 Project，导致旧会话丢失 working directory、Assets 或 Memory。
- 切换 `.boai` 后看似“丢失”旧 Sessions 或 API Key。
- 覆盖当前已经存在的 `~/.boai`。
- 修改 credential key derivation 的品牌字符串，导致无法解密。
- 修改 Electron app identity 后丢失 localStorage、Cookies 或 OAuth state。
- 误删 runtime session status，因为它与 workflow status 同名。
- 误删 `hidden` 过滤，导致内部会话出现在列表。

### 中风险

- 删除旧 route 后，从 persisted URL 启动白屏。
- 先删 i18n key，旧组件运行时报错。
- 删除 package 后遗漏 CI/release/build script。
- 全局 package scope 改名制造巨大、不可审查 diff。
- 自动合并多个旧 Workspace 产生 Source slug 或 credential key 冲突。

### 低风险

- 先隐藏不常用 BYOK 高级选项。
- 删除无消费者的 renderer presentation component。
- 删除已经不可达的 localStorage filter key。
- 保留历史 JSON 字段但停止新写入。

---

## 12. 明确不在本轮范围

- 不在清理阶段构建完整知识库。
- 不在清理阶段构建向量数据库或 RAG pipeline。
- 不在清理阶段实现自动个人 Memory。
- 不立即迁移 Project Assets/Memory 到一个尚未定义的数据模型。
- 不批量重写历史 session JSONL。
- 不自动删除 `.craft-agent`。
- 不同时改用户目录、bundle ID、OAuth relay 和 package scope。
- 不为了减少 package 数量破坏 Agent process isolation。

---

## 13. 清理完成的验收标准

### 产品层

- 左侧主导航只有所有会话、数据源、技能和设置。
- 会话只有一个列表，没有状态、标签、Project、Flag、Archive 或 Board。
- 首次启动只需要完成 BYOK，即可开始会话。
- 用户不需要理解 Workspace 或 Project。
- Automation 不可见且不运行。

### 数据层

- 旧会话全部可发现，hidden 会话除外。
- 旧 Project-bound 会话仍可继续使用。
- Sessions、Sources、Skills 和凭据没有被删除。
- Active data root 清晰可见。
- `.boai` 迁移可验证、可中断、可回滚。

### 代码层

- Automation runtime、renderer、RPC 和 shared engine 已删除。
- Session taxonomy 不再被 renderer 和 Agent runtime 使用。
- Project 只剩隔离的 legacy read-only resolver。
- AppShell 不再承担 Automation/Project/Taxonomy 编排。
- 路径由唯一 AppPaths 提供。
- 核心四个 feature module 边界清楚。
- 不属于本地个人产品的 app/package 已逐项确认并删除。

### 质量层

- 全量 typecheck、lint 和相关 tests 通过。
- Electron/CDP 核心 smoke tests 通过。
- 冷启动和重启恢复正常。
- 没有后台 Automation timer、retry queue 或事件写入。
- 迁移失败不会覆盖源目录或现有目标目录。

---

## 14. 清理完成后的下一阶段

清理结束后再进入“个人上下文”阶段，建议顺序：

1. Knowledge Library：文件、URL、笔记的导入、索引、检索和引用。
2. Explicit Memory：用户可查看、编辑、删除的稳定偏好和事实。
3. Memory Suggestions：AI 从会话提出候选记忆，用户确认后写入。
4. Automatic Memory：只有在来源、作用域、过期和冲突机制成熟后再考虑。

未来应保持概念分离：

| 概念 | 内容 | 使用方式 |
|---|---|---|
| Session Context | 当前对话内容 | 自动随会话加载 |
| Knowledge | 文档、资料和可引用事实 | 按需检索并给出处 |
| Memory | 用户偏好、长期事实、稳定结论 | 明确可见、可改、可删 |
| Skills | AI 的操作方法和能力 | 按任务调用 |
| Sources | 外部系统与实时数据 | 通过工具访问 |

这样 BoAI 会形成清晰的长期结构：

> BYOK 决定使用哪个 AI；Sessions 保存交互；Sources 提供实时数据；Skills 提供能力；Knowledge 提供资料；Memory 提供连续性。

---

## 15. 推荐实际执行顺序

如果从下一次开发开始执行，顺序应为：

1. 补核心 characterization tests。
2. 停止 Automation runtime，同时隐藏入口。
3. 删除 Automation renderer/RPC/runtime。
4. 将会话改成单一列表并删除复杂列表 UI。
5. 移除 Project 产品入口，保留 legacy read-only resolver。
6. 删除 Labels/workflow Statuses/Views/Board 的消费者和后端。
7. 单独确认并移除 Task/Conductor 产品层，保留普通会话需要的异步输出。
8. 引入内部单一 AppScope，简化 onboarding 和 Workspace UI。
9. 建立唯一 AppPaths。
10. 实现 `.craft-agent → .boai` 冲突检测和复制迁移。
11. 完成用户可见 BoAI 品牌与 Electron identity 迁移。
12. 逐项删除 Messaging、Viewer、Web UI、Standalone Server、CLI 等非核心能力。
13. 最后重构 AppShell、API contract 和核心 package 边界。

不建议把第 2–11 步放进一个分支或一次提交。每完成一个 Milestone，都应在 Electron 中进行一次完整的 CDP 回归，再进入下一阶段。
