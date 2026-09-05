# auth

OAuth 流程与本机 AI 配置扫描：为 LLM 连接（ChatGPT/Copilot/Google/Slack/Microsoft）和 source 认证提供令牌获取、刷新与本地检测。

## 文件列表
| 文件名 | 地位 | 功能 |
|--------|------|------|
| local-login-detection.ts | 核心 | Codex 扫描入口：无密钥 DTO、OAuth 的 15min TTL 缓存、服务端凭据读取 |
| codex-api-key-detection.ts | 核心 | 读取 Codex 当前 API 配置，配对接口、模型、协议及密钥来源；TOML 解析失败不输出原文 |
| chatgpt-oauth.ts | 核心 | ChatGPT PKCE OAuth（Codex 同款 client ID），token 交换与刷新 |
| chatgpt-oauth-config.ts | 核心 | ChatGPT OAuth 端点/client ID/回调端口常量 |
| github-copilot.ts | 核心 | Copilot 设备流登录与令牌交换 |
| google-oauth.ts / slack-oauth.ts / microsoft-oauth.ts | 支撑 | 各 source 的 OAuth 流程 |
| generic-oauth.ts | 支撑 | 自定义 OAuth source 的通用流程 |
| oauth.ts / oauth-relay.ts | 支撑 | 通用编排与 WebUI 中继回调 |
| callback-server.ts / callback-page.ts | 支撑 | 本地回调服务器（固定端口）与成功页 |
| oauth-flow-store.ts / oauth-flow-types.ts | 支撑 | 进行中 OAuth flow 的状态存储 |
| pkce.ts | 支撑 | PKCE verifier/challenge 工具 |
| state.ts / types.ts | 支撑 | 认证状态推导（getAuthState/getSetupNeeds）与共享类型 |

## Codex API 配置导入

在一级连接页面点击“扫描本地配置”后，进入独立二级页面并扫描 `$CODEX_HOME`（默认 `~/.codex`）下的 `auth.json` 与 `config.toml`。
识别当前 `model_provider`、`model`、`model_providers.<id>.base_url`，支持旧版内嵌默认 `profile` 的覆盖。
OpenAI 默认接口还支持 `openai_base_url` 和 `OPENAI_BASE_URL`，优先采用配置文件中的地址。

密钥来源包括 API-key 模式的 `auth.json.OPENAI_API_KEY`、`env_key` 引用的 BoAI 进程环境变量、
`experimental_bearer_token`。自定义提供商须显式指定 `env_key`、直接 token 或 `requires_openai_auth = true`，
不会将无关的 OpenAI 密钥配给另一个提供商；指定的 `env_key` 缺失时不回退到其他密钥。

默认 `wire_api = "responses"` 映射到 BoAI 的 `openai-responses`；旧版 `"chat"` 映射到
`openai-completions`。类型、配置校验器、设置界面和 Pi 的自定义模型注册均支持 Responses。

扫描结果只包含来源、地址、模型、协议、是否存在密钥和配置完整性。API 配置由用户点击导入；
一级页面保留正常的登录/手动配置入口，启动和打开一级页面均不扫描、不自动导入。导入服务
`packages/server-core/src/services/codex-api-key-import.ts` 重新读取密钥并核对已展示的配置标识，
通过 CredentialManager 保存密钥；重复导入更新同一导入连接的密钥，保留手动创建/修改的连接。
导入后用现有连接测试确认可用性；测试失败时可以修改设置并保留已经导入的密钥。

缺少环境变量或有效地址时，界面保留已检测字段，转入手动补齐。模型不是建立连接的必填条件。
暂不自动读取 Keychain、执行 shell/凭据命令、扫描项目覆盖或命令行临时 profile；
带额外请求头、查询参数或不支持协议的配置显示手动设置提示，避免静默丢失这些设置。

字段参考：[Codex 配置文档](https://developers.openai.com/codex/config-reference/)、
[自定义提供商配置](https://developers.openai.com/codex/config-advanced/)。

回归测试覆盖：API 文件/环境密钥、地址与模型配对、配置变化与密钥轮换、缺失字段、OAuth 切换、
解析错误脱敏、导入去重和并发、保存失败回滚，以及真实 Pi SDK 向本地 `/v1/responses` 发起请求。


## 本地账号导入

二级扫描页分别列出 API 配置和有效的 ChatGPT 登录，并提供返回、重新扫描、逐项导入。
普通 Codex 卡片始终启动浏览器登录，允许用户在 BoAI 使用另一个账号。
OAuth 导入核对扫描时的账号标识，只复用同来源、同账号、由扫描创建的连接；手动登录的
连接和另一账号的导入连接都保留。用户主动重新登录后清除该连接的扫描归属。
模型刷新保留扫描归属，扫描后 CLI 切换账号则拒绝旧结果，要求重新扫描。


## 选择目录扫描

扫描页支持选择目录，并可切回默认 Codex/Claude Code 目录（尊重 `CODEX_HOME`、`CLAUDE_CONFIG_DIR`）。
可用配置卡片不再显示“导入此配置”，点击卡片即按该来源创建连接。

- Codex：任意目录中的 `config.toml` 与 `auth.json`，支持 OAuth 账号和 API 配置。
- Claude Code：`settings.json` / `settings.local.json` 的 `env.ANTHROPIC_BASE_URL`、
  `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_MODEL`，以及顶层 `model` 和模型别名映射。
- 常见 OpenAI 配置：JSON/TOML/YAML 的 `base_url`/`baseUrl`、`api_key`/`apiKey`、`model`；
  支持嵌套提供商和数组，地址与密钥仅在同一配置对象内配对。
- `.env`：`OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`，也支持上述 Anthropic 字段。
  显式 `env_key` 或 `$VAR` / `${VAR}` 密钥引用可从同目录 `.env` 或进程环境读取。

默认扫描不遍历工具的会话目录。选择目录后最多进入 3 层子目录、读取 200 个配置文件和
2,000 个目录项，每个文件最多 1 MiB；跳过符号链接及依赖、构建、日志等目录。达到限制或
文件不可读时，界面提示选择更具体的目录。不会执行 shell 或 apiKeyHelper。

扫描 DTO 标注来源文件，不携带密钥。配置标识绑定文件、对象位置、接口、模型和协议；
导入时重新扫描同一范围并核对标识，因此相同地址的不同文件不会互相覆盖。
只有地址和密钥时也可建立连接，并使用该连接的凭据请求模型列表。OpenAI 兼容接口使用 `/models`，Anthropic 兼容接口使用 `/v1/models`，支持分页。扫描模型仅作为初始默认值；导入、启动和模型菜单刷新均可更新可选列表。获取失败时保留缓存，且不使用另一家服务商的静态模型列表冒充可用模型；无缓存或默认模型时才提示手动补充。

字段参考：[Claude Code settings](https://code.claude.com/docs/en/settings)、
[Claude Code environment variables](https://code.claude.com/docs/en/env-vars)。
