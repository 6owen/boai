# BoAI 桌面端体积瘦身执行计划

> 状态：Implemented / macOS arm64 verified；其他目标平台待 CI 实机验证<br>
> 建立日期：2026-08-25<br>
> 执行日期：2026-08-25<br>
> 基准分析：[BoAI 桌面端分发体积分析](./boai-distribution-size-analysis.md)<br>
> 当前目标：先完成分发基线与守门、构建产物清理、中英文语言收敛，以及 PI 的 Bun → Electron Node

> PI-only 后续阶段已于同日完成，最终结果见 [BoAI PI-only / Claude Agent SDK 移除计划](./boai-pi-only-migration-plan.md)。

## 执行结果（2026-08-25）

本期代码改造已经完成，macOS arm64 完成 clean build、真实 DMG 打包、最终 artifact 校验和 packaged PI smoke test。Windows x64、Linux x64 与 macOS x64 的构建规则已经同步，但仍需各平台 CI/实机完成最终 smoke test。

| 指标 | 优化前 | 优化后（macOS arm64） | 结果 |
|---|---:|---:|---:|
| DMG | 约 233 MB | 222,082,584 bytes（211.79 MiB） | 约减少 4.7%，未达到 190 MB 激进预算 |
| unpacked app | 约 736 MiB | 641,073,041 logical bytes（611.37 MiB）；磁盘占用 612.61 MiB | 约减少 123 MiB / 16.7%，略高于 600 MiB 预算 |
| Bun | 约 58 MiB | 0 | 已移除 |
| sourcemap | 约 38 MiB | 0 | 已移除 |
| Electron locale | 约 45 MiB / 多语言 | 1.03 MiB，仅 `en.lproj`、`zh_CN.lproj` | 已收敛 |

最终最大项为 Claude 250.50 MiB、Electron Framework 212.09 MiB、文档工具 uv 42.24 MiB、PI Agent Server 23.09 MiB。这说明在本期明确保留 Claude 与文档工具的前提下，190 MB DMG 预算不可达；下一阶段的主要空间来自 PI-only 和文档工具按需化，而不是继续清理零散资源。

下一阶段已确定采用无需历史兼容的 PI-only 方案，执行顺序与验收门槛见：[BoAI PI-only / Claude Agent SDK 移除计划](./boai-pi-only-migration-plan.md)。

### PI-only 后续实测

Claude Agent SDK/runtime 完全移除后，macOS arm64 unpacked app 进一步降至 377,635,253 bytes（360.14 MiB），DMG 降至 145,643,944 bytes（138.90 MiB），ZIP 为 139,504,510 bytes（133.04 MiB）。相对本计划首轮产物，unpacked app 再减少 41.1%，DMG 再减少 34.4%；artifact 报告中的 Claude 分类为 0。

验证命令：

```bash
bun run electron:artifact:validate apps/electron/release/mac-arm64/BoAI.app
bun run electron:artifact:report apps/electron/release/mac-arm64/BoAI.app --json apps/electron/release/artifact-report-mac-arm64.json
```

## 0. 本期范围

### 本期必须完成

- [x] 建立可重复的 clean build 和 artifact 体积报告。
- [x] 在最终 unpacked app 上检查禁止文件、运行时和语言包。
- [x] 清理 sourcemap、旧构建产物、重复资源和构建期资源。
- [x] BoAI UI 只支持 English 和简体中文。
- [x] Electron/Chromium 只保留 English 和简体中文 locale。
- [x] PI Agent Server 改为 Node 22 兼容 bundle。
- [x] 桌面发行版使用 Electron 自带 Node 启动 PI，不再附带 Bun。
- [x] macOS arm64、macOS x64、Windows x64、Linux x64 的打包规则保持一致。

### 本期明确不做

- [ ] 不删除 Claude Agent SDK、Claude Backend 或 Claude 认证代码。
- [ ] 不迁移现有 Claude/PI connection 和 session metadata。
- [ ] 不裁剪文档工具、Python/uv、Lark、Telegram、WhatsApp。
- [ ] 不裁剪 Shiki 语言/主题，不移除生产 Playground。
- [ ] 不切换 Tauri，不调整 ASAR 策略。
- [ ] 不把仓库的包管理器、构建脚本和测试工具从 Bun 迁移到 Node。
- [ ] 不以 aggressive minify 作为本期体积目标。

“Bun → Node”在本计划中仅表示：桌面安装包不再携带 `apps/electron/vendor/bun`，PI 子进程由 Electron executable 以 Node 模式启动。

## 1. 完成标准

本期完成时应同时满足：

1. 连续执行两次 clean release build，artifact 文件清单和体积在允许误差内一致。
2. 最终安装产物中没有 `.map`、源 `src/`、测试、`__pycache__`、图标生成脚本、DMG 背景或 `vendor/bun`。
3. 最终产物中只有 English 和简体中文的 BoAI UI 资源及 Electron locale。
4. PI 在打包后的应用中能够完成 `init → ready → prompt/tool → shutdown`。
5. Claude Backend、PI Backend、应用启动、自动更新和现有文档/消息能力没有被本轮删除。
6. macOS arm64 阶段预算：unpacked app 不高于 600 MB，DMG 不高于 190 MB。
7. 如果预算未达到，报告必须显示剩余最大的 20 个文件/目录，禁止以删功能的方式临时过线。

Windows 和 Linux 第一轮先采集基线，再按相同优化项建立平台独立预算。

## 2. 推荐提交结构

每一阶段单独提交，便于审查和回滚：

1. `build: add electron artifact size report and guardrails`
2. `build: make electron resource staging deterministic`
3. `build: ship only English and Simplified Chinese locales`
4. `refactor: run pi agent server with Electron Node`
5. `build: remove bundled Bun from desktop artifacts`
6. `docs: record post-slimming artifact baseline`

Node bundle和删除 Bun建议拆成两个提交：先证明新 runtime 稳定，再删除旧 runtime。出现回归时可以只回退最后一刀。

## 3. Phase A：建立基线和 artifact 守门

### A1. 增加体积报告脚本

- [x] 新增统一的 artifact report 脚本，例如 `scripts/electron-artifact-report.ts`。
- [x] 输入必须是明确的 unpacked app 目录或 installer 路径，不能默认扫描整个仓库。
- [x] 输出总字节数、各一级目录、最大 20 个文件、最大 20 个目录。
- [x] 单独汇总以下分类：Frameworks、Claude、Bun、maps、locales、renderer、main、PI Server、runtime resources。
- [x] 结果支持写入 JSON，供 CI 做前后版本比较。
- [x] 同时输出人类可读表格，方便本地开发。

建议报告单位同时保留原始 bytes 和 MiB，预算比较必须使用 bytes，避免 `du` 在不同文件系统上的块大小差异。

### A2. 增加最终产物验证脚本

- [x] 新增 `scripts/validate-electron-artifact.ts`，验证 electron-builder 的 unpacked 目录，而不是只检查源码或 `dist/`。
- [x] 禁止 `**/*.map`。
- [x] 禁止 `**/__tests__/**`、`**/test/**`、`**/tests/**`、`**/__pycache__/**`。
- [x] 禁止生产应用中的原始 `src/`，但使用精确路径规则，避免误伤合法资源名称。
- [x] 禁止 `vendor/bun/bun` 和 `vendor/bun/bun.exe`。
- [x] 禁止构建期资源：DMG background、`generate-icons.sh`、`icon.icon/`、资源目录的 `AGENTS.md`。
- [x] 检查 PI Server、Claude runtime、ripgrep 和必要运行时资源仍存在。
- [x] 检查 Electron locale allowlist，出现第三种 locale 或缺少中英文时失败。
- [x] 支持平台差异：`.app`、`win-unpacked`、`linux-unpacked` 分开解析。

### A3. 将守门接入构建和 CI

- [x] 本地 `electron:dist:*` 在 electron-builder 完成后执行 report 和 validator。
- [x] Release workflow 上传 installer 前执行相同验证。
- [ ] 先用当前 artifact 生成 baseline；修复完成后再启用硬体积上限。
- [x] CI 保存 JSON report 作为 artifact，便于定位体积回归。
- [x] 增加测试夹具，证明禁止项会失败、必须项缺失会失败、合法双语 artifact 会通过。

### Phase A 验收

- [x] 对同一个 artifact 重复运行，JSON 结果一致。
- [x] 人工放入一个 `.map` 或假 `vendor/bun` 后验证器稳定失败。
- [x] 当前 0.0.6 artifact 能生成完整报告，并把已知问题报告出来。
- [ ] 该阶段只增加观测和守门，不改变运行时行为。

## 4. Phase B：确定性构建与发行资源清理

### B1. 统一 clean build 入口

- [x] 所有正式 `electron:dist:*` 在构建前调用统一的 `electron:clean`。
- [x] 清理目标至少包括 `apps/electron/dist`、`apps/electron/release` 和平台 staging 目录。
- [x] 不删除用户数据、根 `node_modules` 或源 `resources/`。
- [x] Vite 使用标准 `emptyOutDir`，不再依赖无效的 `emptyDirBeforeWrite`。
- [x] `apps/electron/package.json` 的直接 build 路径与根目录 build 路径复用同一套脚本或行为。
- [x] 连续构建两次前后，在源目录中删除一个测试资源，确认第二次 artifact 不残留该文件。

### B2. 将资源复制改成 runtime allowlist

当前 `resources/` 同时承载“构建输入”和“应用运行时资源”。源目录可以继续保持这一结构，但 `dist/resources/` 必须只包含 allowlist。

本期保留的运行时类别：

- [x] `docs/`
- [x] `themes/`
- [x] `permissions/`
- [x] `tool-icons/`
- [x] 运行时需要的 `release-notes/`
- [x] `config-defaults.json`
- [x] 产品内使用的 `boai-mascot.png`、`source.png`
- [x] 当前文档工具需要的 wrapper、Python scripts 和目标平台 uv
- [x] `powershell-parser.ps1`
- [x] PI Agent Server、Session MCP Server、Bridge MCP Server

不得复制到 `dist/resources/` 的构建期内容：

- [x] `AGENTS.md`
- [x] `dmg-background.*`
- [x] `icon.icns`、`icon.ico`、`icon.png`、`icon.icon/` 等打包输入
- [x] `Assets.car`
- [x] `generate-icons.sh`
- [x] tests、缓存和临时文件

注意：这些文件仍可留在源 `resources/` 供 electron-builder/afterPack 使用，只是不应进入 app runtime。不要为了缩包删除打包所需源文件。

### B3. 消除重复 staging

- [x] `scripts/electron-build-resources.ts` 成为 runtime resource staging 的单一入口。
- [x] staging 前先删除目标 `dist/resources/`。
- [x] `apps/electron/scripts/copy-assets.ts` 改为调用统一实现，或从正式构建链中移除。
- [x] MCP Server 每种只保留一个 canonical packaged path。
- [x] 更新 runtime resolver 和测试，使其优先路径与实际 packaged path 一致。
- [x] electron-builder 的 `files` 不再同时打包源 `resources/*` 和 `dist/resources/*` 的同一内容。

### B4. 关闭正式发行 sourcemap

- [x] production renderer build 设置 `sourcemap: false`。
- [ ] development build 可以继续生成 sourcemap，但输出目录不能被 release build 复用。
- [x] main、preload、worker 和 PI Server 都明确检查无外部 `.map`。
- [x] Sentry 继续关闭时，不在产物中保留 private sourcemap。
- [ ] 如果未来开启 Sentry，则采用“上传后删除”，仍然不进入 installer。

### B5. 收敛 BoAI UI 语言

- [x] `LOCALE_REGISTRY` 只注册 `en` 和 `zh-Hans`。
- [x] renderer 不再静态导入 Spanish、Japanese、Hungarian、German、Polish 的 messages 和 `date-fns` locale。
- [x] 设置页语言选择器只显示 English 和简体中文。
- [x] 已保存的其他语言值稳定回退到 `en`。
- [x] 更新 locale registry、preference migration、i18n parity/sorted/coverage 测试。
- [x] 暂不要求删除翻译 JSON 的 Git 历史；未被 registry 引用即可不进入 bundle。

### B6. 收敛 Electron locale

- [x] electron-builder 只保留 `en-US` 和 `zh-CN` 对应的 locale 资源。
- [ ] macOS Framework `.lproj`、Chromium `locales/*.pak`、Windows/Linux locale 都在最终 artifact 中实测。
- [ ] 验证 macOS 菜单、文件选择器、上下文菜单在中英文系统下可正常显示。
- [ ] 未匹配的系统语言回退 English。
- [x] artifact validator 不以模糊文件名匹配判断，使用每个平台的实际 locale 路径 allowlist。

### Phase B 验收

- [x] unpacked app 中 `.map` 数量为 0。
- [x] unpacked app 中不包含已列出的构建期资源和 stale 文件。
- [ ] 应用语言设置只显示 English 和简体中文。
- [ ] English 和简体中文分别完成冷启动、设置页、日期显示和一次会话 smoke test。
- [ ] macOS arm64 unpacked app 不高于 650 MB，DMG 不高于 210 MB。

## 5. Phase C：PI 从捆绑 Bun 迁移到 Electron Node

### C1. 先建立 Node 兼容 bundle

- [x] `packages/pi-agent-server` 改为 Node 22 兼容的 ESM bundle。
- [x] bundle 保持 self-contained，不依赖 app 中不存在的普通 `node_modules`。
- [x] 对确实存在的动态 `require` 使用 `createRequire(import.meta.url)` 兼容入口。
- [x] 明确处理 `koffi` 等 optional/native dependency，不允许静默漏包。
- [x] `packages/pi-agent-server/package.json` 与 `scripts/electron-build-main.ts` 使用同一构建定义，防止 dev/release 漂移。
- [x] 保持 JSONL stdio 协议不变，不在本轮重构 PI 消息协议。
- [x] 先不启用 aggressive minify；Node 兼容和可调试性优先。

### C2. 增加 Electron Node 启动路径

- [x] 打包后的 Electron Desktop 使用 `process.execPath` 启动 PI。
- [x] 子进程环境设置 `ELECTRON_RUN_AS_NODE=1`。
- [x] 保留当前 `--require <interceptor>` 行为并验证 Node ESM 入口兼容。
- [x] 保留明确传入的 `hostRuntime.nodeRuntimePath`，避免破坏 headless server 或测试环境。
- [x] 开发态可以使用当前 Node executable；不再以“系统必须安装 Bun”作为 PI 前提。
- [x] 日志输出实际 runtime、版本和 PI bundle 路径，不能记录凭据。

### C3. Runtime 测试

- [x] 单元测试：packaged Electron 解析到 `process.execPath`。
- [x] 单元测试：spawn env 包含 `ELECTRON_RUN_AS_NODE=1`。
- [x] 单元测试：显式 `nodeRuntimePath` 的非 Electron 场景不被覆盖。
- [x] 协议测试：`init → ready → shutdown`（源码 Node bundle 与 packaged Electron Node 均通过）。
- [ ] 协议测试：prompt、stream event、abort、tool result、错误退出和重新拉起。
- [ ] 文件工具 smoke test：读取临时文件、写入临时目录、搜索。
- [ ] 至少跑一次无需真实云凭据的 fake/local provider 流程。
- [ ] macOS arm64、macOS x64、Windows x64、Linux x64 各在 packaged app 中执行 smoke test。

### C4. 确认稳定后删除发行版 Bun

- [x] 从 `electron-builder.yml` 的 `files` 和 Windows `extraResources` 删除 `vendor/bun`。
- [x] 从 `build-dmg.sh` 删除 Bun 下载、校验和 staging。
- [x] 从 `build-linux.sh` 删除 Bun 下载、校验和 staging。
- [x] 从 `build-win.ps1` 删除 Bun staging、EBUSY workaround 和 Bun debug 输出。
- [x] 更新 NSIS 中因 Bun 权限而存在的过时注释；不顺带改变安装范围或卸载策略。
- [x] runtime resolver 删除 desktop bundled Bun lookup；不要误删 headless server 自己的 Bun 打包逻辑。
- [x] artifact validator 将任何 desktop `vendor/bun` 视为失败。

### Phase C 验收

- [ ] 四个平台的 desktop artifact 均不存在 Bun binary。
- [ ] PI packaged smoke test 全部通过。
- [ ] Claude Backend smoke test 仍通过，证明本轮没有误伤 Claude runtime。
- [ ] macOS arm64 unpacked app 不高于 600 MB，DMG 不高于 190 MB。
- [ ] 与 Phase B 相比，unpacked app 应再减少约 55 MB；若明显不足，检查是否存在第二份 Bun 或 stale vendor 目录。

## 6. Phase D：结果记录与预算固化

- [ ] 从全新 checkout 或干净 CI workspace 构建最终 artifact。
- [x] 将各平台最终 JSON report 保存为 CI artifact。
- [x] 在本计划中填写实际数字和测试结果。
- [ ] 按推荐结构拆分 commit（本轮未代用户提交）。
- [ ] 体积上限以实际稳定结果加小幅容差固化，不用当前宽松目标永久兜底。
- [x] 在 release 文档中补充 artifact validator 的运行方式。
- [x] 如果变更进入版本发布，在 `apps/electron/resources/release-notes/next.md` 添加用户可见说明；纯文档计划阶段不写 release note。

建议最终表格：

| 平台 | 优化前 installer | 优化后 installer | 优化前 unpacked | 优化后 unpacked | 变化 |
|---|---:|---:|---:|---:|---:|
| macOS arm64 | 约 233 MB | 222.08 MB（211.79 MiB） | 约 736 MiB | 611.37 MiB logical / 612.61 MiB disk | DMG 约 -4.7%；unpacked 约 -16.7% |
| macOS x64 | 待采集 | 待填写 | 待采集 | 待填写 | 待填写 |
| Windows x64 | 待采集 | 待填写 | 待采集 | 待填写 | 待填写 |
| Linux x64 | 待采集 | 待填写 | 待采集 | 待填写 | 待填写 |

## 7. 风险与回滚点

### 资源清理风险

风险：allowlist 漏掉运行时动态读取的文件。
控制：先扫描所有 `getBundledAssetsDir`、`process.resourcesPath` 和相对资源路径消费者；validator 检查必须资源；完成中英文冷启动和功能 smoke test。
回滚：只回退 resource staging 提交，不回退报告和验证器。

### 语言收敛风险

风险：旧 preference 保存不再支持的语言，或 OS locale 找不到 fallback。
控制：加 preference migration/fallback 测试；未匹配语言统一回退 English。
回滚：恢复 locale registry 和 electron locale allowlist，不影响其他体积工作。

### Electron Node 风险

风险：PI 依赖中存在 Bun-only API、旧 CommonJS 动态加载、native module 或跨平台路径差异。
控制：先同时保留新 Node path 和旧 Bun packaging 完成验证，再单独提交删除 Bun；使用 packaged smoke test，而不只跑源码单测。
回滚：回退“删除发行版 Bun”的提交，恢复 runtime resolver 的 bundled Bun fallback。

### 构建路径漂移风险

风险：根脚本、Electron package script 和平台脚本继续各自构建，导致本地通过但 Release artifact 不同。
控制：所有入口复用统一 staging/build 函数，并对最终 unpacked app 执行同一个 validator。

## 8. 后续 Backlog（不属于本期）

- [x] PI-only：无需历史迁移/旧 session fallback；Claude Backend、OAuth 与 runtime 已删除。
- [ ] 文档工具单栈或按需工具包。
- [ ] Lark、Telegram、WhatsApp adapter/plugin 化。
- [ ] Shiki 语言和主题 allowlist。
- [ ] Playground 仅开发构建。
- [ ] 主进程和 PI Server 保守 minify。
- [ ] 审计无消费者依赖，如 Copilot SDK。
- [ ] 必要时重新评估 ASAR、installer 压缩等级和 Electron 替代方案。
