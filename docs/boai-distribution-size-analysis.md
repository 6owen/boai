# BoAI 桌面端分发体积分析

> 状态：Baseline / Accepted for planning<br>
> 分析日期：2026-08-25<br>
> 基准版本：BoAI 0.0.6，macOS arm64<br>
> 关联计划：[BoAI 桌面端体积瘦身执行计划](./boai-distribution-size-reduction-plan.md)

## 1. 结论

当前 BoAI 安装包约 233 MB，安装后的 `/Applications/BoAI.app` 约 736 MB。体积最大的部分不是 Craft 遗留的 TypeScript 源码，而是 Electron/Chromium、Claude Agent SDK 原生运行时、PI 使用的独立 Bun 运行时，以及没有被稳定排除的构建产物。

当前最重要的判断是：

1. 保留 Electron 时，约 255 MB 的 Frameworks 是短期不可避免的基础成本。
2. Claude Agent SDK 及原生程序占约 249 MB，是未来 PI-only 阶段最大的单项收益；本期不删除。
3. PI 子进程附带的 Bun 占约 58 MB，可以改用 Electron 自带的 Node 运行时；不需要迁移仓库的 Bun 开发工具链。
4. 当前安装产物中有约 38 MB sourcemap、约 45 MB Electron 全语言资源，以及源码、测试和构建期资源。这些内容不应进入正式发行包。
5. 删除 Craft 源码的主要收益是降低维护复杂度，不是显著缩小安装包。应该先治理分发边界，再做业务代码删除。

## 2. 实测基线

### 2.1 安装产物

以下数据来自本机已经安装的 `/Applications/BoAI.app`。子项存在包含关系，不能直接把每一行相加。

| 路径或组成 | 实测体积 | 说明 |
|---|---:|---|
| `BoAI.app` | 736 MB | 安装后的总占用 |
| `Contents/Frameworks` | 255 MB | Electron、Chromium 和辅助 Framework |
| `Contents/Resources` | 481 MB | 应用代码、运行时和资源 |
| `Resources/app/node_modules` | 253 MB | 其中 Claude 相关内容约 249 MB |
| `Resources/app/dist` | 154 MB | main、renderer、PI Server 和资源 |
| `Resources/app/vendor/bun` | 58 MB | PI 子进程的独立 Bun 运行时 |
| sourcemap | 38 MB | 当前未上传 Sentry，却仍出现在安装产物中 |
| Electron locale 资源 | 约 45 MB | 当前包含远多于产品实际支持的语言 |
| 原始源码、测试、脚本等 | 约 7 MB+ | 不属于生产运行时 |

安装包 233 MB 是压缩后的数字，不能用未压缩体积等比例推算。对几个大文件做近似 gzip 测量后：

| 对象 | 未压缩 | gzip 近似值 |
|---|---:|---:|
| Claude 原生程序 | 约 245 MB | 约 72 MB |
| Bun | 约 58 MB | 约 21 MB |
| `main.cjs` | 约 44 MB | 约 7 MB |
| PI Agent Server | 约 26 MB | 约 5 MB |

该压缩测量只用于估算优先级，最终结果必须以 clean build 生成的 DMG/ZIP/EXE/AppImage 为准。

### 2.2 当前阶段的合理目标

本期保留 Electron 和 Claude，因此不能达到 PI-only 后的最终体积。按照当前批准的范围，建议使用以下 macOS arm64 阶段目标：

| 阶段 | 安装后目标 | DMG 目标 | 主要收益来源 |
|---|---:|---:|---|
| 当前基线 | 736 MB | 233 MB | BoAI 0.0.6 |
| 清理构建产物和语言 | 不高于 650 MB | 不高于 210 MB | maps、locale、重复/构建期资源 |
| PI 改用 Electron Node | 不高于 600 MB | 不高于 190 MB | 再删除约 58 MB Bun |

这些是第一轮预算，不是长期下限。测量脚本落地后，应为 macOS arm64、macOS x64、Windows x64 和 Linux x64 分别建立基线，不能混用不同平台数字。

## 3. 体积来源分析

### 3.1 Electron 是保留桌面技术栈后的基础成本

Electron Frameworks 约 255 MB。删除浏览器工具或少量 renderer 页面不会移除 Chromium，因为 Electron UI 自身仍依赖 Chromium。

切换到 Tauri 或系统 WebView 可能进一步降低基础体积，但会影响窗口、浏览器视图、Node 集成、自动更新和跨平台行为，接近一次桌面端重构。本期不考虑。

### 3.2 Claude Agent SDK 是未来最大的单项收益

`apps/electron/electron-builder.yml` 当前通过 `extraResources` 打包 Claude SDK core、目标平台原生程序和 ripgrep。Claude 相关内容约 249 MB，其中原生程序约 245 MB。

PI 本身可以使用 Anthropic 模型，所以未来可以只保留 PI Agent Backend，同时继续提供 Claude 模型。但这不是简单删除依赖：需要迁移连接类型、补齐 Anthropic OAuth token 刷新，并处理 Claude 与 PI 不兼容的 session resume/fork metadata。

本期明确保留 Claude Backend 和相关代码，避免把分发治理与 Agent 架构迁移混在同一轮。

### 3.3 Bun 是可独立移除的重复运行时

当前 `packages/pi-agent-server` 使用 `--target=bun --format=esm` 构建，桌面发行脚本再为每个平台准备一个独立 Bun。PI 启动时由 runtime resolver 找到该 Bun 并创建子进程。

这与仓库使用 Bun 安装依赖、执行 TypeScript 脚本和测试是两件事。本期只删除生产应用中的 `vendor/bun`：

```text
开发/CI：继续使用 Bun
桌面主进程：Electron
PI 子进程：Electron executable + ELECTRON_RUN_AS_NODE=1
```

已经完成一次不落库的可行性验证：

- 将 PI Agent Server 打包为 Node 22 兼容的 ESM bundle；
- 对旧依赖的动态 `require` 使用 `createRequire(import.meta.url)` 兼容入口；
- 分别使用系统 Node 和 Electron 内置 Node 启动；
- JSONL `init → ready → shutdown` 握手通过；
- 临时完整 minify bundle 约 12.7 MB，当前 bundle 约 25.7 MB。

该结果证明路线可行，但不能代替 macOS、Windows、Linux 上的正式回归测试。

### 3.4 构建输出目前不是完全确定性的

当前存在几条容易让旧文件或构建期文件进入安装包的路径：

1. Vite 配置使用 `emptyDirBeforeWrite`，不是标准的 `emptyOutDir` 配置键。根目录构建脚本会手动清理 renderer，但 `apps/electron` 自己的 `build:renderer` 直接运行 Vite，两条路径行为不一致。
2. `scripts/electron-build-resources.ts` 和 `apps/electron/scripts/copy-assets.ts` 都会整目录复制 `resources/`，并且没有统一的“先清空、再按 allowlist staging”规则。
3. `resources/` 同时存放运行时资源与 electron-builder 构建资源，如 DMG 背景、图标源文件、`Assets.car`、生成脚本和说明文档。整目录复制会把两类资源混合。
4. MCP Server 既可能从源 `resources/` 打包，又被复制到 `dist/resources/`，存在重复和历史残留风险。
5. 当前 `sourcemap: true`，同时 Sentry 上传被关闭。即使 electron-builder 配置声明排除 map，也需要对最终 artifact 做断言，因为已安装的 0.0.6 中实际存在约 38 MB map。

因此，“配置看起来排除了某个文件”不能作为完成标准。最终 unpacked app 中不存在该文件才算完成。

### 3.5 语言有两个层级

当前语言资源分成：

1. BoAI UI 翻译和 `date-fns` locale：`en`、`es`、`zh-Hans`、`ja`、`hu`、`de`、`pl` 被静态导入 renderer。
2. Electron/Chromium locale：安装包包含大量 `.pak` 和 Framework `.lproj` 资源。

本期产品决定只保留：

- English：BoAI `en`，Electron `en-US`；
- 简体中文：BoAI `zh-Hans`，Electron `zh-CN`。

旧用户如果保存了其他 UI 语言，应稳定回退到 English，而不是启动失败或显示空字符串。翻译源文件可以先留在仓库历史中，但不能继续进入生产 bundle 或语言选择器。

## 4. 其他已识别、但本期延期的机会

### 4.1 PI-only

未来删除 Claude Agent SDK 可减少约 249 MB 安装体积和约 70–80 MB 安装包体积。需要单独的迁移方案和兼容测试，本期不做。

### 4.2 文档处理

主进程中的 `markitdown-js` 会拉入多个 PDF 引擎、xlsx、Azure 等依赖，同时 resources 中还有 Python/uv 文档工具。后续应只保留一套，或将通用文档转换改为按需下载工具包。本期不改。

### 4.3 消息平台

Lark、Telegram、WhatsApp 可以在未来改成可选 adapter/plugin。当前继续完整保留。

### 4.4 Shiki 和 Playground

Shiki 当前打包较多语言与主题；Playground 也是生产 Rollup entry。后续可以收敛语法列表并把 Playground 限制在开发构建。本期不改。

### 4.5 主进程与 PI bundle minify

保守 minify 能进一步降低未压缩体积，但可能影响堆栈可读性，应在 artifact 边界稳定后单独评估。本期不把 minify 作为必须项。

### 4.6 ASAR 和压缩等级

ASAR 是归档格式，不是主要压缩手段。安装器压缩等级只能改善下载体积，不能显著改善安装后体积。这两项不应排在 runtime 和资源治理之前。

## 5. 长期体积预期

如果后续完成 PI-only、删除 Bun、清理 artifact、裁剪 locale，并逐步模块化文档和消息平台，保留 Electron 的情况下可将安装后体积控制在约 300–360 MB，安装包约 110–140 MB。

如果要求安装后明显低于 270–300 MB，需要重新评估 Electron，而不是继续删除少量业务源码。

## 6. 复测原则

所有优化必须遵守以下规则：

1. 从干净的 `dist/`、`release/` 和 staging 目录开始构建。
2. 同一平台、同一架构、同一压缩格式前后对比。
3. 同时记录 installer、unpacked app 和前 N 个大目录/文件。
4. 不以源码仓库大小或 `node_modules` 大小代替发行包测量。
5. 对禁止进入发行包的文件做自动化断言，而不是依赖人工检查。
6. 体积优化不能破坏离线启动、PI 会话、Claude 会话、更新和签名流程。
