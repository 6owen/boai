# BoAI PI-only / Claude Agent SDK 移除计划

> 状态：Implemented / macOS arm64 artifact verified；真实凭据与其他平台待验收<br>
> 建立日期：2026-08-25<br>
> 执行日期：2026-08-25<br>
> 前置工作：[BoAI 桌面端体积瘦身执行计划](./boai-distribution-size-reduction-plan.md)<br>
> 当前基线：[BoAI 桌面端分发体积分析](./boai-distribution-size-analysis.md)

## 1. 决策与目标

本阶段将 BoAI 收敛为 **PI-only**：应用只保留 `PiAgent` 这一套 Agent Backend，彻底删除 `@anthropic-ai/claude-agent-sdk`、Claude 原生可执行文件、`ClaudeAgent`、Claude OAuth 和专属于 Claude Backend 的构建逻辑。

已确认的产品前提：

- 当前没有需要保留或迁移的 Claude 历史会话。
- 当前没有需要迁移的 Claude connection、Claude Pro / Max OAuth 凭据。
- 不设计旧 Claude 会话继续对话、自动转为 PI、只读恢复或失败兜底。
- 不为旧配置保留 `providerType: "anthropic"` 兼容分支。
- 允许 Claude Backend 和 Claude Pro / Max 登录能力直接消失。
- 本阶段不要求保留“使用 Claude 模型”的产品能力，也不为它单独做回归保障。

这里仍要区分两个概念：

1. `@anthropic-ai/claude-agent-sdk` 是当前约 250.50 MiB 的 Agent Runtime，包含原生 `claude` 可执行文件；它必须从依赖、源码、构建和最终 artifact 中归零。
2. PI 自身是多模型引擎，上游包内部可能仍认识 Anthropic provider 或 `claude-*` 模型 ID。那不等于应用仍有 Claude Backend。除非这些代码在 PI bundle 中形成可独立、安全裁剪的明显体积，本阶段不 fork PI 上游库做供应商级删减。

## 2. 完成标准

全部条件同时满足才算 PI-only 完成：

1. 运行时代码只会创建 `PiAgent`，不存在 Claude Backend factory、driver 或 fallback。
2. 仓库运行时代码、manifest、构建脚本和 lockfile 不再直接依赖 `@anthropic-ai/claude-agent-sdk`。
3. 最终桌面 artifact 中不存在 `claude-agent-sdk`、`claude-agent-sdk-binary` 或原生 `claude[.exe]`。
4. Claude Pro / Max OAuth 的 UI、RPC、preload API、credential 类型和 token 刷新代码均被删除。
5. 新安装只会创建/选择 PI 或 PI-compatible connection，不再生成 `providerType: "anthropic"`。
6. PI 的聊天、流式输出、工具调用、MCP/API Source、权限、分支、abort、重启和 mini completion 通过回归验证。
7. macOS arm64 clean artifact 的 `Claude` 分类必须为 `0 bytes`；unpacked app 预期从 611.37 MiB 降至约 361 MiB，第一轮预算设为不高于 380 MiB。
8. installer 压缩率未知，不提前承诺固定数字；首次 clean build 后以实测值加小幅容差固化预算。

## 2.1 执行结果（2026-08-25）

PI-only 的代码、依赖和 macOS arm64 发行产物已经完成。删除范围包括 Claude Backend、Claude OAuth、原生 Claude runtime、direct Claude connection 类型，以及相应的构建/打包分支。Anthropic API Key 和 Claude 模型仍可作为 **PI 的上游模型供应商** 使用；这不会创建 Claude Backend，也不会携带 Claude Agent SDK。

| 指标 | PI-only 前 | PI-only 后 | 减少 |
|---|---:|---:|---:|
| unpacked app logical size | 641,073,041 bytes（611.37 MiB） | 377,635,253 bytes（360.14 MiB） | 263,437,788 bytes（251.23 MiB，41.1%） |
| DMG | 222,082,584 bytes（211.79 MiB） | 145,643,944 bytes（138.90 MiB） | 76,438,640 bytes（72.90 MiB，34.4%） |
| ZIP | 未记录 | 139,504,510 bytes（133.04 MiB） | — |
| Claude Agent SDK/runtime | 250.50 MiB | 0 | 全部移除 |
| bundled Bun / sourcemap | 0 / 0 | 0 / 0 | 保持守门 |
| Electron locale | English + 简体中文 | English + 简体中文（1.03 MiB） | 保持守门 |

已完成的自动验证：

- `bun run typecheck:all` 全部通过。
- PI factory、runtime resolver、connection/onboarding/model picker、session tools、MCP/API Source、URL validation、artifact 与 packaging 等定向回归通过。
- 最终核心收尾套件 47/47 通过；全仓复跑为 4,448 pass、11 skip、14 fail。剩余失败均不在 PI-only 路径：8 个 BrowserPaneManager 测试独立运行仍失败；6 个 WebUI HTTP 测试独立运行通过、仅全量并发时失败，属于测试隔离问题。
- 新增 PI-only dependency guard，禁止 manifest、lockfile 与发行构建链重新引入 exact package `@anthropic-ai/claude-agent-sdk`。
- Node PI bundle 完成无云凭据的 `init → ready → shutdown` JSONL 生命周期测试。
- `bun run electron:build`、macOS arm64 package、artifact validator 均通过；报告见 [boai-pi-only-artifact-report.json](./boai-pi-only-artifact-report.json)。

仍需单独验收的项目：

- 使用真实 PI connection 做聊天、流式输出、权限、tool call、abort/restart、分支、MCP/API Source 与 mini completion 的完整手工 smoke test。
- Windows x64、Linux x64、macOS x64 的 CI package 与 packaged PI smoke test。
- 本机 `bun install --frozen-lockfile --lockfile-only` 在 Bun 的 resolving 阶段长时间无进展；lockfile 可解析，direct Claude SDK 项已经由静态 guard 证明为零，但仍需在 CI/干净环境重跑 frozen install。

## 3. 明确不做

- 不迁移或恢复旧 Claude SDK session ID、turn ID、branch metadata 和 transcript continuation。
- 不迁移旧 `anthropic` connection 到 `pi`。
- 不迁移旧 `claude_oauth`、`anthropic_api_key` credential key。
- 不保留隐藏开关或环境变量重新启用 Claude Backend。
- 不在本阶段裁剪 uv、文档工具、消息平台、Shiki 或 Electron Framework。
- 不为了清除 PI 上游内部的 Anthropic adapter 而维护私有 PI fork；先用 artifact 数据判断是否值得。
- 不把仓库开发/测试命令从 Bun 改为 Node；此前完成的只是桌面 PI runtime 使用 Electron Node。

## 4. 为什么不能先直接删依赖

当前 PI 主路径仍间接加载若干 Claude SDK 包装层：

- `PiAgent` 从 `session-scoped-tools.ts` 导入回调与 plan state，而该文件顶层导入 Claude SDK 的 `tool()` / `createSdkMcpServer()`。
- `llm-tool.ts` 同时包含 provider-neutral 的 `call_llm` 请求构建和 Claude SDK tool wrapper。
- `browser-tools.ts`、`spawn-session-tool.ts` 主要是 Claude SDK tool wrapper；PI 已有自己的 proxy 执行路径。
- `sources/api-tools.ts` 和 `sources/server-builder.ts` 使用 Claude SDK helper 创建 in-process MCP server，但 PI 的 `McpClientPool` 只需要标准 MCP `McpServer`。
- `url-validator.ts` 与 `llm-validation.ts` 直接调用 Claude SDK `query()`。

因此正确顺序是：先把 PI 需要的 provider-neutral 能力从 Claude adapter 中剥离并测试，再删 Claude 实现和 package。直接 `bun remove` 会同时破坏 PI 的会话工具、API Source 和部分校验流程。

## 5. 执行阶段

### Phase A：锁定 PI-only 行为基线

- [ ] 记录当前 PI smoke test、全量 typecheck 和 artifact report。
- [ ] 为 PI 建立无需真实云凭据的 subprocess 协议测试：`init → ready → register_tools → shutdown`。
- [ ] 补齐 session tool proxy 测试，至少覆盖 `call_llm`、`spawn_session`、`browser_tool` 和一个 registry tool。
- [ ] 补齐 MCP Source 与 API Source 经 `McpClientPool` 的 list/call/close 测试。
- [ ] 补齐 PI 的 abort、子进程异常退出、重新拉起、分支和 source reload 测试。
- [ ] 保存 macOS arm64 PI-only 前的 JSON artifact report，当前参考值：总计 611.37 MiB、Claude 250.50 MiB、PI Server 23.09 MiB。

Phase A 的原则是只补测试和观测，不改 provider 行为。它将成为后续删除代码的安全网。

### Phase B：把 provider-neutral 能力从 Claude adapter 中拆出

#### B1. 会话工具状态与回调

- [ ] 将 callback registry、plan path state、session self-management binding 等 PI/Claude 共用内容移到不依赖任何 Agent SDK 的模块。
- [ ] 让 `PiAgent`、`BaseAgent`、backend types 和 storage 直接引用 provider-neutral 模块。
- [ ] 将现有 `session-scoped-tools.ts` 收缩为纯 Claude adapter；确认 PI import graph 不再经过它。
- [ ] 删除注释和类型中“只用于 ClaudeAgent”但实际被 PI 使用的错误表述。

#### B2. `call_llm`、spawn 与 browser 工具

- [ ] 将 `llm-tool.ts` 拆成两层：provider-neutral 的 schema/request/result/runtime，以及 Claude SDK wrapper。
- [ ] PI 继续复用 `buildCallLlmRequest()` 和 `queryLlm()`，不再加载 Claude `tool()`。
- [ ] `spawn_session` 与 `browser_tool` 的 schema/执行逻辑以 `session-tools-core` 和当前 PI proxy 路径为真源。
- [ ] Claude 专用的 `createLLMTool()`、`createSpawnSessionTool()`、`createBrowserTools()` 在删除 Claude Backend 时一并删除，而不是再造一套 PI wrapper。

#### B3. API Source 改用标准 MCP SDK

- [ ] 用 `@modelcontextprotocol/sdk/server/mcp.js` 的 `McpServer` 和标准 tool registration 取代 Claude SDK 的 `createSdkMcpServer()` / `tool()`。
- [ ] `SourceServerBuilder` 直接返回 `ApiServerConfig { type: "sdk", instance: McpServer }`，不再暴露 Claude SDK return type。
- [ ] 保持 API Source 的认证注入、二进制响应、large-response guard、summarize callback 和 error shape 不变。
- [ ] 用 `InMemoryTransport` 对 API Source 做真实 list-tools / call-tool 测试。

#### B4. 删除不必要的 AI URL 校验

- [ ] 将 `validateMcpUrl()` 改为确定性的 `URL` 解析与规则校验；当前 prompt 中的协议、host、path、credential 和字符规则都可本地完成。
- [ ] 删除该路径对 Claude SDK、默认 Claude mini model 和 SDK error mapper 的依赖。
- [ ] 为合法 URL、协议错误、伪造子域名、userinfo、非法 link ID 和额外文本建立表驱动测试。

### Phase B 验收

- [ ] 从 `pi-agent.ts`、`base-agent.ts`、sources、validation 入口追踪 import graph，不再到达 `@anthropic-ai/claude-agent-sdk`。
- [ ] PI session tools、MCP Source、API Source 和 URL 校验测试通过。
- [ ] 此时 Claude Backend 暂时仍可编译，便于将“解耦回归”和“删除回归”分开定位。

### Phase C：把 connection、model 与 backend 类型收敛为 PI-only

#### C1. Backend 类型和工厂

- [ ] 将 `AgentProvider` 从 `ModelProvider` 中解耦，定义为唯一值 `'pi'`；不要因为删除 Claude Backend 而混淆“模型供应商”和“Agent Backend”。
- [ ] `createBackend()`、driver registry、available providers、capabilities 和默认 auth 只保留 PI。
- [ ] 删除 `detectProvider()` 的 Anthropic 默认值和所有未知值回退 Anthropic 的逻辑。
- [ ] 删除 `providerTypeToAgentProvider()` 中 `anthropic → ClaudeAgent` 分支；`pi` 与 `pi_compat` 都映射到 PI。
- [ ] 删除 factory 中 connection 缺失时默认 `'anthropic'` 的行为；无合法 PI connection 时必须给出明确配置错误。
- [ ] 删除 Anthropic driver、Claude runtime bootstrap 和 Claude binary path resolver。

#### C2. Connection schema 与默认配置

- [ ] `LlmProviderType` 只保留 `'pi' | 'pi_compat'`。
- [ ] 新安装默认 connection、onboarding 写入、CLI setup 和 settings 保存全部使用 PI schema。
- [ ] 自定义 OpenAI/Anthropic-compatible endpoint 均走 `pi_compat`，协议由 `customEndpoint.api` 决定。
- [ ] 删除 direct `anthropic` built-in template、`claude-max` template 和对应 model fetcher registry 项。
- [ ] 不实现旧 `providerType: "anthropic"` 的启动迁移；schema 校验应直接拒绝或忽略这类旧记录。
- [ ] 删除仅服务于 Claude connection 的 storage migrations、默认恢复逻辑和 credential migrations；保留 Bedrock/Vertex 等仍映射到 PI 的有效迁移时必须逐项确认。

#### C3. Model registry

- [ ] 清理把 `ModelProvider` 当作 backend selector 的调用点。
- [ ] 默认模型与 mini model 从有效 PI connection / PI model catalog 中取得，不再用全局 Claude `DEFAULT_MODEL` 兜底。
- [ ] UI model picker、Kanban 和 title/summary fallback 在“没有 connection / models 为空”时给出可诊断状态，不再回落到 `ANTHROPIC_MODELS`。
- [ ] 应用层不再维护 direct Claude Backend 专用的静态模型组；PI 上游 catalog 中是否仍出现 Claude 模型不作为本阶段兼容目标。

### Phase C 验收

- [ ] 新建 workspace、首次 onboarding、新建 session 和 connection test 全程只产生 PI Backend。
- [ ] 全仓运行时代码不存在 `new ClaudeAgent`、`provider: 'anthropic'` backend 或 Anthropic fallback。
- [ ] `piAuthProvider` 仍被视为 PI 内部路由字段，不与已删除的 backend provider 混为一谈。

### Phase D：删除 Claude OAuth 与产品入口

- [ ] 删除 Claude OAuth config、PKCE、token refresh、auth state 分支和 export。
- [ ] 删除 onboarding 的 prepare/exchange Claude code RPC channel、server handler、Electron main handler、preload API 和 transport mapping。
- [ ] 删除 `claude_oauth` credential 类型及 get/set/migration helper。
- [ ] 删除 Provider Select / API Setup / Credentials 中的 Claude Pro / Max 选项和流程。
- [ ] 删除 settings 中 Claude subscription/direct Anthropic Backend 的卡片、状态与 endpoint 特判。
- [ ] CLI 删除 direct Anthropic backend setup；保留的通用 API-key setup 必须明确产生 PI connection。
- [ ] 删除只为 Claude CLI on Windows 设置的 Git Bash 探测与 `CLAUDE_CODE_GIT_BASH_PATH` 管理。
- [ ] 删除 `CLAUDECODE`、`CLAUDE_CODE_OAUTH_TOKEN`、`CLAUDE_CODE_USE_BEDROCK` 等仅服务于 Claude Backend 的环境处理。
- [ ] 更新 English / 简体中文注册语言中的 onboarding/settings 文案和测试。

本阶段不要求把所有 `claude-*` 文本从仓库清零：测试夹具、PI 上游模型 ID 或历史说明可以合理存在。判断标准是它是否仍代表一个可达的 Claude Backend / OAuth 产品入口。

### Phase E：删除 Claude 实现、依赖与构建链

#### E1. 源码与测试

- [ ] 删除 `claude-agent.ts`、`backend/claude/**`、Anthropic driver、Claude LLM query 和 Claude SDK error mapper。
- [ ] 删除 `CraftAgent` → `ClaudeAgent` 兼容 alias 及其 export。
- [ ] 删除只验证 Claude streaming、thinking、handoff、branching、persistent input 和 SDK event adapter 的测试。
- [ ] 共用行为测试迁移到 PI 后再删旧测试，禁止以“删除测试”代替功能验证。
- [ ] 清理 `BaseAgent`、backend interfaces 和注释中的双后端抽象；保留真正有价值的 PI/core 边界，不为不存在的 provider 保留模板代码。

#### E2. Package dependencies

- [ ] 从根 `package.json` 删除直接依赖 `@anthropic-ai/claude-agent-sdk`。
- [ ] 从 `packages/shared/package.json`、`packages/core/package.json` 删除 Claude SDK peer dependency。
- [ ] 如果根 `@anthropic-ai/sdk` 没有直接 import，则删除该直接依赖；允许 PI 上游按自身需要保留传递依赖。
- [ ] 重新生成 `bun.lock`，确认不再出现 `@anthropic-ai/claude-agent-sdk-*` 平台包。
- [ ] 新增静态 guard，禁止未来重新引入 exact package `@anthropic-ai/claude-agent-sdk`。

#### E3. Build 与发行

- [ ] Electron main/dev/server build 删除 `--external:@anthropic-ai/claude-agent-sdk`。
- [ ] 删除 macOS、Windows、Linux 脚本中的 SDK 下载、架构选择、alias staging、权限和 210 MB 大小检查。
- [ ] 删除 `scripts/build/common.ts` 的 Claude package/binary staging helper。
- [ ] 删除 Electron builder 三个平台的 Claude SDK `extraResources`。
- [ ] 删除 headless server build 中 Claude optional package 收集与打包逻辑。
- [ ] artifact validator 从“Claude runtime 必须存在”改为“任何 Claude Agent SDK/runtime 出现都失败”。
- [ ] artifact report 保留 `claude` 分类，作为必须恒为 0 的回归指标。

### Phase E 验收

- [ ] `rg '@anthropic-ai/claude-agent-sdk'` 在 runtime、manifest、build config 和 lockfile 中无命中。
- [ ] `rg 'ClaudeAgent|claude-agent-sdk-binary'` 在运行时代码和构建脚本中无命中。
- [ ] `bun install --frozen-lockfile` 在更新后的 lockfile 上成功。
- [ ] desktop 和 headless server build 均不再寻找或下载 Claude binary。

### Phase F：PI 功能回归与 clean artifact 验收

#### F1. 静态与单元验证

- [ ] `bun run typecheck:all`
- [ ] PI factory、runtime resolver、driver、connection schema 和 storage tests。
- [ ] session tool parity、call_llm、spawn_session、browser tool tests。
- [ ] MCP remote/stdio Source 与 in-process API Source tests。
- [ ] English / 简体中文 parity、sorted、coverage tests。
- [ ] 只对本阶段修改文件执行 lint；全仓已有 lint debt 单独报告，不与本阶段混淆。

#### F2. PI runtime smoke test

- [ ] 使用 Node bundle 完成 `init → ready → prompt → stream → shutdown`。
- [ ] 使用 packaged Electron Node 完成同一流程。
- [ ] 覆盖 tool call/result、permission allow/deny、abort、process crash/restart。
- [ ] 覆盖 session branch、source enable/reload、MCP tool 和 API Source tool。
- [ ] 覆盖 mini completion、title generation 和 `call_llm`。
- [ ] 至少用一个真实 PI provider 或用户现有 PI connection 完成手工聊天回归；测试日志不得记录凭据。

#### F3. Fresh-install 产品验收

- [ ] 用全新的临时 data root 启动，不复用现有用户数据。
- [ ] onboarding 不显示 Claude Pro / Max，不创建 direct Anthropic Backend。
- [ ] 完成 PI 登录/API key 配置、新会话、工具调用、重启应用和继续会话。
- [ ] settings、model picker、Kanban、spawn session 中没有依赖已删除 Claude 默认 connection 的空状态或崩溃。

#### F4. Artifact 与体积

- [ ] clean build macOS arm64 artifact。
- [ ] validator 确认 Claude Agent SDK/native binary 为 0。
- [ ] report 确认 app logical size 目标不高于 380 MiB；若明显高于约 361 MiB，检查 staging 残留或新的重复依赖。
- [ ] 记录 DMG 实测体积，并以实测值加合理容差写入 release guard。
- [ ] Windows x64、Linux x64、macOS x64 在 CI 各完成一次 package 与 PI smoke test。
- [ ] 将最终数字回填到本文和总体瘦身文档。

## 6. 推荐提交顺序

建议每个提交都保持可编译，按以下顺序执行：

1. `test: lock pi-only runtime and tool behavior`
2. `refactor: decouple pi session tools from claude sdk`
3. `refactor: build api sources with the standard mcp sdk`
4. `refactor: make backend and connection resolution pi-only`
5. `refactor: remove claude oauth and direct anthropic setup`
6. `refactor: delete claude agent implementation`
7. `build: remove claude sdk dependencies and packaging`
8. `test: enforce pi-only dependency and artifact guardrails`
9. `docs: record pi-only artifact baseline`

不要把 Phase B 的解耦和 Phase E 的物理删除压成一个巨大提交。即使不需要用户数据兼容，也需要保留清晰的故障定位边界。

## 7. 主要风险与控制点

### 风险 1：删 SDK 后 PI 的 session tools 一起失效

原因：PI 目前间接 import `session-scoped-tools.ts`，该模块顶层依赖 Claude SDK。
控制：Phase B 先移动 provider-neutral state/callback，再用 proxy tool tests 证明 PI 不经过 Claude adapter。

### 风险 2：API Source 编译通过但运行时无法 list/call tool

原因：当前 in-process server 由 Claude SDK helper 创建。
控制：直接使用标准 MCP `McpServer`，以 `InMemoryTransport` 做真实协议测试，不只做结构 mock。

### 风险 3：删除 Anthropic fallback 后 fresh install 没有有效默认模型

原因：factory、storage 和多个 UI 组件当前以 Claude model / connection 兜底。
控制：先定义 PI connection/model 的唯一解析规则，再删除 `DEFAULT_MODEL` / `ANTHROPIC_MODELS` fallback；用临时 data root 完整走首次启动。

### 风险 4：Claude OAuth RPC 删除不完整

原因：同一流程横跨 renderer、preload、Electron main、server-core、protocol channel 和 credential store。
控制：以 RPC channel 为索引从两端删除，typecheck 后再用 `rg` 检查 prepare/exchange/token refresh 的残留可达路径。

### 风险 5：只删除 desktop 包，headless server 仍携带 Claude binary

原因：desktop 和 server 各有独立 packaging 脚本。
控制：同时审计 `electron-builder.yml`、平台 shell/PowerShell、`scripts/build/common.ts`、`scripts/build/{darwin,linux,win32}.ts` 与 `scripts/build-server.ts`。

### 风险 6：把 PI 内部 Anthropic 支持误判为 Claude Backend 残留

原因：PI 是多 provider SDK，可能传递依赖 Anthropic HTTP client 或携带 Claude model IDs。
控制：硬性归零对象是 `@anthropic-ai/claude-agent-sdk`、原生 `claude`、`ClaudeAgent` 和 Claude OAuth。PI 上游传递依赖单独按 artifact 体积判断，不以字符串扫描盲删。

## 8. 执行时的每阶段报告格式

每完成一个 Phase，记录：

- 修改的职责边界和关键文件。
- 新增/删除的测试及实际通过数量。
- `rg` 静态 guard 结果。
- typecheck/lint 结果及是否存在既有失败。
- artifact 总体积、Claude 分类和最大 10 项。
- 尚未覆盖的平台或必须留给 CI 的验证。

最终报告必须明确区分：

- Claude Agent SDK 已删除。
- Claude OAuth / direct Claude Backend 已删除。
- PI 上游是否仍包含 Anthropic provider 支持。
- 安装包与 unpacked app 的实际减少量。
