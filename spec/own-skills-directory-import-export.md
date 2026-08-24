# “我的”Skills 通用仓库 ZIP 导入导出 Spec

状态：Export implemented / Import pending  
阶段：通用 Skill 仓库 ZIP 导出  
后续阶段：GitHub 同步（本 Spec 不实现）

## Problem Statement

BoAI 当前可以发现、安装、更新和收藏 Skills，“我的”集合也能聚合用户在 BoAI 中创建的 Skill 与收藏的第三方 Skill，但这些内容仍然只存在于当前机器的运行环境中：

- 用户自己创建的 Skill 位于 BoAI workspace 的 `skills/` 目录。
- 第三方 Skill 可能来自 GitHub、URL、ZIP、本地目录、全局 Agent 目录或 Plugin。
- “我的”收藏状态目前保存在 renderer localStorage，无法稳定跨设备恢复。
- 当前 ResourceBundle 可以在 workspace 之间搬运 Skills 与脱敏后的数据源，但其 JSON/base64 格式不适合作为人类可维护的 Git 仓库。
- 用户无法把“我的”导出成类似 `/Users/wangwenbo/Desktop/demo/skills` 的普通目录仓库，也无法在另一台机器上直接把该目录导回 BoAI。

用户需要一种可读、可版本管理、可离线保存的通用仓库格式。导出结果是 ZIP；解压后既能被 BoAI 导入，也能作为独立 Git 仓库维护。格式参考 `antfu/skills`：所有最终可安装 Skill 都完整保存在 `skills/`，上游仓库通过 `meta.ts`、`.gitmodules`、`sources/` 和 `vendor/` 表达。

## Goals

1. 在“我的”Skills 列表 header 中提供一个紧凑的 icon 按钮。
2. 点击按钮显示 Craft 风格 dropdown，包含“导入目录…”和“导出目录…”两个操作。
3. 将“我的”完整导出为一个 ZIP，解压后是可独立维护的通用 Skill 仓库。
4. 所有最终 Skill（本地、第三方、快照）都完整保存到 `skills/`，支持离线使用。
5. `meta.ts` 保存 Source、Vendor、Manual 与 Snapshot 的分类和映射。
6. `.gitmodules` 保存上游仓库 URL；同一仓库只声明一次。
7. `scripts/cli.ts` 提供 `init`、`sync`、`check` 与 `cleanup` 仓库维护命令。
8. 从符合规范的目录导入时，先检查并预览，再安装或恢复对应 Skills。
9. 导入后恢复“我的”集合关系。
10. 不导出任何凭据、Token、会话、使用统计或机器私有运行状态。
11. 解压后的目录可以由用户自行执行 `git init`、commit 和 push，而无需转换格式。

## Non-goals

- 当前阶段不连接 GitHub API。
- 导出阶段不执行 Git clone、pull、commit 或 push；解压后由用户主动运行 CLI。
- 当前阶段不自动创建 GitHub 仓库。
- 当前阶段不自动同步文件变化。
- 当前阶段不处理多设备双向冲突合并。
- 当前阶段不导入或导出会话、Memory、知识库、统计数据、BYOK 配置或凭据。
- 当前阶段不实现 `instructions/` 的运行时加载规则。
- BoAI 导入阶段不执行 ZIP 中的 `package.json` scripts、Git hooks、`meta.ts` 或任意程序。
- ZIP 无法携带 Git index 中的 submodule gitlink；`.gitmodules` 仅作为可移植的上游来源声明，`pnpm run init` 不建立或下载 submodule。

## Terminology and Classification

### Local Skill

用户拥有内容本身、需要完整复制才能恢复的 Skill。满足以下任一条件：

- `source === workspace`，即在 BoAI 中创建或保存的 Skill。
- 没有可移植、可重建的第三方 provenance，且用户选择以快照方式保存。
- 原始来源为当前机器上的离线目录，导入到另一台机器后无法依靠原路径重建。

Local Skill 导出到 `skills/<slug>/`，保留整个目录树，不能只保存 `SKILL.md`。

### Source

可重建第三方 Skill 的上游仓库。当前 v1 只定义 Git/GitHub 来源。

Source 是生成型上游仓库：它提供文档或源码，最终 Skill 由 AI 根据 `instructions/` 生成。当前安装信息不足以可靠判断某个本地 Skill 是否由 Source 生成，所以 v1 导出通常保留空 `sources/`，未来在生成工作流记录 provenance 后再写入。

“使用 GitHub”本身不是 Skill 类型。分类按用途确定：

- GitHub 仓库已经提供可安装 Skill：仓库是 Source，其中的 Skill 是 Vendor Skill。
- GitHub 仓库只是生成本地 Skill 的资料来源：属于未来的生成工作流，当前 v1 不自动导入或生成。

### Vendor Skill

用户收藏或安装的第三方 Skill。完整可安装内容同样位于 `skills/<slug>/`；`meta.ts` 通过上游仓库、`sourcePath` 与最终 slug 记录同步关系，对应仓库预留在 `vendor/<repository-id>/`。

如果第三方 Skill 没有可重建 Source，其完整内容仍保存在 `skills/<slug>/`，并列入 `meta.ts` 的 `snapshots`，明确标记为不可自动 checking/update。

### Own Collection

“我的”集合由以下内容组成：

- 所有 Local Skills。
- manifest 中标记 `favorite: true` 的 Vendor Skills。

导入后必须恢复这两类关系，而不只是让 Skill 出现在“全部”列表。

## Exported Directory Format

```text
<library-name>.zip
├── .gitignore
├── .gitmodules
├── boai.json
├── boai.lock.json
├── meta.ts
├── package.json
├── README.md
├── scripts/
│   └── cli.ts
├── instructions/
├── skills/
│   └── <slug>/
│       ├── SKILL.md
│       └── ...
├── sources/
│   └── <generated-source-repository>/   # 默认为空，仅保留来源声明
└── vendor/
    └── <vendor-repository>/             # 默认为空，同步时也不常驻完整仓库
```

### Required Files

#### `boai.json`

仓库入口 manifest，至少包含：

- `schemaVersion`
- `kind: "boai-skill-library"`
- `name`
- `exportedAt`
- `skillsPath`
- `vendorPath`
- `sourcesPath`

导入器必须先验证 `boai.json`，不能通过猜测目录结构导入任意文件夹。

#### `boai.lock.json`

由 BoAI 生成，不要求用户手工编辑。保存可重建性与版本状态：

- Source 实际解析到的 commit/ref。
- Vendor Skill 的 source path。
- Skills CLI revision/content hash。
- 导出内容 checksum。
- 最后导出时间。

Lock 文件不得保存访问令牌、认证 header、SSH key 或本地凭据。

#### `skills/<slug>/`

保存所有最终可安装 Skill 的完整文件树，包括 Local、Vendor 与 Snapshot：

- `SKILL.md` 必须存在。
- 其他文件名和目录不做固定假设。
- `references/`、`reference/`、`scripts/`、`assets/`、templates 和许可证均原样保留。
- 隐藏文件、临时文件和 lock 文件默认排除，除非在 allowlist 中明确支持。

#### `meta.ts`、`.gitmodules` 与 `scripts/cli.ts`

- `meta.ts` 是人类可编辑的仓库真源，声明 `submodules`、`vendors`、`manual` 和 `snapshots`。
- `.gitmodules` 保存 Source/Vendor 上游 URL 与预期路径，但 ZIP 中不包含 Git gitlink。
- `scripts/cli.ts init` 只初始化当前 Git 仓库和必要目录，不下载上游仓库。
- `sync` 在系统临时目录使用浅层、blobless、sparse clone 获取声明的 Vendor Skill 路径，复制到 `skills/` 后立即清理临时仓库。
- `check` 通过远端引用检查版本，不要求本地存在完整上游仓库；`cleanup` 清理未声明条目。
- URL 不得包含 access token、认证 header、SSH key 或其他凭据。

### Repository Tooling Files

- `README.md`：使用中文说明仓库结构、BoAI 来源、上游仓库的按需获取策略与 CLI 使用方法。
- `.gitignore`：忽略 `node_modules`、系统临时文件和本地凭据文件。
- `package.json`：提供 CLI scripts；BoAI 导入器永远不执行它。
- `instructions/`：保留生成型 Source 的说明；当前导出可为空。
- `LICENSE`：用户可以自行补充。

## Source Classification Rules

导出时按以下优先级分类，每个 Skill 只能进入一种导出形态：

1. 所有条目先完整复制到 `skills/<slug>/`，保证 ZIP 离线可用。
2. Workspace Skill：列入 `meta.ts.manual`。
3. 有 Skills CLI Git/GitHub provenance：按仓库创建或复用 `meta.ts.vendors` 和 `.gitmodules` 的 `vendor/<repository-id>` 声明。
4. 有可访问 URL/ZIP provenance但无法转换成 Git：列入 `meta.ts.snapshots`。
5. Plugin Skill：如果能够解析 Git 来源则作为 Vendor；否则作为 Snapshot。
6. 无 provenance 的 global/project Skill：不冒充原创，作为 Snapshot 并返回警告。
7. 仅有当前机器绝对路径的来源：绝对路径不写入仓库，完整内容作为 Snapshot 保存。

同一 slug 如果存在多个来源，身份使用 `source + slug`，导出预览必须显示最终选择，不能静默覆盖。

## Export UX

1. “我的”Skills list header 增加一个 icon-only 按钮。
2. 按钮使用项目现有 header icon button 尺寸、hover、focus 和 disabled 状态。
3. 点击显示 dropdown：
   - `导入目录…`
   - `导出“我的”…`
4. 选择导出后打开系统目录选择器，用于选择 ZIP 保存位置。
5. 导出只写入一个 `<library-name>.zip`，不在目标目录散落仓库文件。
6. 目标目录中的无关文件保持不变。
7. 写入前展示导出预览：
   - Local Skills 数量。
   - Vendor Skills 数量。
   - Sources 数量。
   - 将新增、更新、跳过和需要用户决定的项目。
   - 将被保存为 snapshot、因此无法自动更新的项目。
8. 用户确认后执行导出。
9. 导出按临时目录 staging，ZIP 完成后再写入目标位置。
10. 导出完成后显示结果摘要，并提供“在 Finder 中查看 ZIP”。

## Import UX

1. 用户点击 dropdown 中的 `导入目录…`。
2. 打开系统目录选择器。
3. 选择目录后验证 `boai.json`、schema 版本、路径安全和文件大小。
4. 读取 Local Skills、Sources、Vendor Skills 和 lock 信息。
5. 在产生任何修改前展示导入预览：
   - 将新增的 Skills。
   - 已存在且内容相同的 Skills。
   - 已存在但内容不同的冲突。
   - 将通过 Skills CLI 安装的 Vendor Skills。
   - 将作为 snapshot 恢复的 Vendor Skills。
   - 无法访问或无法解析的 Source。
6. 默认冲突策略为 `skip`。
7. 用户可以对冲突选择覆盖，但必须明确确认。
8. Local Skills 导入到当前默认 BoAI workspace 的 `skills/`，因此自动进入“我的”。
9. 可重建 Vendor Skills 复用 Skills CLI 安装，默认安装到 global scope。
10. Vendor 安装成功后恢复 favorite 状态，使其进入“我的”。
11. Vendor snapshot 以不可管理 Skill 恢复，详情中明确不支持 checking/update。
12. 导入过程允许部分成功，并逐项报告成功、跳过和失败。
13. 导入不删除任何当前已安装 Skill。
14. 导入完成后刷新 Skills 列表与详情状态。

## User Stories

1. 作为 BoAI 用户，我希望从“我的”header 直接找到导入导出入口，从而不需要进入 workspace 管理页面。
2. 作为 BoAI 用户，我希望入口是与现有 Craft header 一致的 icon 按钮，从而保持界面操作语言一致。
3. 作为 BoAI 用户，我希望把“我的”导出成普通目录，从而可以查看和编辑其中的 Markdown 文件。
4. 作为 BoAI 用户，我希望自己写的 Skill 被完整导出，从而不会丢失 references、scripts、assets 或许可证。
5. 作为 BoAI 用户，我希望第三方 Skill 保留来源信息，从而导入后仍可 checking 和 update。
6. 作为 BoAI 用户，我希望同一 GitHub 仓库只保存一次 Source 声明，从而避免多个 Skill 重复配置仓库 URL。
7. 作为 BoAI 用户，我希望没有稳定来源的第三方 Skill 可以保存快照，从而仍能离线备份。
8. 作为 BoAI 用户，我希望快照 Skill 被明确标记为不可自动更新，从而不会误以为它仍受 Skills CLI 管理。
9. 作为 BoAI 用户，我希望导入后第三方收藏仍出现在“我的”，从而恢复的是集合而不只是文件。
10. 作为 BoAI 用户，我希望导入前看到变化预览，从而避免无意覆盖已有 Skill。
11. 作为 BoAI 用户，我希望相同内容自动跳过，从而可以重复导入同一个目录。
12. 作为 BoAI 用户，我希望内容冲突默认跳过，从而保护本地修改。
13. 作为 BoAI 用户，我希望可以明确选择覆盖某个冲突，从而在需要时以备份内容为准。
14. 作为 BoAI 用户，我希望导出到非空无关目录时被阻止，从而不会损坏其他文件。
15. 作为 BoAI 用户，我希望导入单项失败不影响其他项目，从而能得到部分可用的恢复结果。
16. 作为 BoAI 用户，我希望导出的配置不包含密钥和 Token，从而可以安全地提交到私有或公开 Git 仓库。
17. 作为 BoAI 用户，我希望导出结果不包含本机绝对路径，从而能在另一台机器导入。
18. 作为 BoAI 用户，我希望 BoAI 不执行导入仓库中的脚本，从而能够安全检查不可信目录。
19. 作为 BoAI 用户，我希望完成后能在 Finder 中查看目录，从而可以自行 commit 和 push。
20. 作为未来使用 GitHub 同步的用户，我希望当前目录格式已经包含稳定 manifest 和 lock，从而以后增加 Git 同步时无需迁移内容。

## Implementation Decisions

### Persistence prerequisite

“我的”收藏不能继续只存在 renderer localStorage。实现导入导出前，需要将 favorite identities 迁移到 workspace/server 持久化配置，并提供一次性兼容迁移：

- 首次读取新存储为空时，导入当前 workspace 对应的旧 localStorage 收藏。
- 成功迁移后以新存储为真源。
- identity 继续包含 Skill source 和 slug，避免同名来源冲突。

### Personal Skill Repository module

新增一个深模块负责目录格式、校验、分类、diff、staging 和 apply。renderer 与 RPC 不直接拼路径或复制文件。

推荐的外部 interface：

- `plan({ direction, directory, workspaceId })`
- `apply(planId, conflictDecisions)`

`plan` 是只读操作，返回标准化 transfer plan；`apply` 只能执行先前生成且仍有效的 plan。实现内部可以复用 ResourceBundle、bundle file 安全校验、SkillsCliService 和原子导入逻辑。

### Existing modules to reuse

- 复用现有 ResourceBundle 的目录文件收集、路径校验、source 脱敏和原子导入实现。
- 复用 SkillsCliService 的 scan/install 与 lock provenance。
- 复用 Skills loader 的 source、management 和 Plugin metadata。
- 复用现有系统文件/目录选择能力。
- 复用现有 Skills changed broadcast，让列表在导入后刷新。

### Safety

- 仅根据 allowlist 读取和写入规范文件。
- 拒绝 `..`、绝对路径、目录逃逸和 symlink 逃逸。
- 限制总目录大小、单文件大小和文件数量。
- 不执行任何来自导入目录的程序。
- 不读取 `.git/`、`node_modules/`、凭据文件或隐藏运行状态。
- 数据源如果在未来加入该仓库格式，必须使用现有 sanitizer；当前 Spec 只处理 Skill library Sources，不处理 BoAI 数据源。
- 写入目标前使用 staging，失败时保留原内容。

### Compatibility

- `schemaVersion` 从 1 开始。
- 未知更高版本必须停止导入并给出明确错误。
- 未知可选字段必须保留向前兼容空间。
- `package.json`、`README`、LICENSE 可以存在，但不是导入真源。
- 目录导入不依赖 Git 仓库，也不要求存在 `.git/`。

## Testing Decisions

最高测试 seam 是 Personal Skill Repository module 的 `plan/apply` interface。测试通过临时目录和 fake Skills CLI adapter 观察外部结果，不测试内部辅助函数。

### Module behavior tests

- 导出一个 Local Skill 后完整目录树保持一致。
- 同一 Git Source 下多个 Vendor Skills 只生成一个 Source 声明。
- 导出无法重建的 Skill 时生成 snapshot 和警告。
- 导出不会写入凭据、绝对路径或 runtime state。
- 导入合法 Local Skill 后出现在 workspace skills。
- 导入 Vendor Skill 时调用 Skills CLI 的正确 source、slug 和 scope。
- 导入后恢复 favorite 状态。
- 重复导入相同内容得到 skip/no-op。
- 冲突默认 skip，明确 overwrite 后才替换。
- 非法 schema、路径逃逸、symlink 逃逸、过大目录和缺少 `SKILL.md` 被拒绝。
- apply 前目录变化导致 plan 失效时拒绝执行并要求重新 checking。
- 单项失败产生部分成功结果，不破坏其他项目。

### RPC tests

- handler 正确校验 workspace 与本地目录权限。
- plan RPC 为只读，不产生文件变化。
- apply RPC 只接受仍有效的 plan。
- 导入后发出 Skills changed 通知。
- remote workspace 在 v1 中明确返回不支持本地目录导入导出。

### Renderer tests

- icon/dropdown 仅在“我的”Skills header 展示。
- dropdown 包含导入、导出操作，并符合 disabled/loading/focus 状态。
- directory picker 取消时不产生错误或写入。
- preview 正确展示新增、更新、冲突、snapshot 和失败。
- 完成后列表刷新并显示结果反馈。

### Electron end-to-end verification

- 使用开发端口 `1221` 启动 Electron。
- 使用 CDP 端口 `9333` 检查“我的”header、dropdown、目录选择后的 preview 和完成状态。
- 使用临时导出目录完成一次 export → remove from test workspace → import 的往返验证。
- 测试目录只能使用专用临时目录，不覆盖用户现有 `/Users/wangwenbo/Desktop/demo/skills`。

## Implementation Plan

### Phase 1 — Domain and persistence

1. 定义 schema v1、Source、Vendor Skill、Local Skill、lock 和 transfer plan 类型。
2. 将“我的”favorite 状态迁移到 workspace/server 持久化。
3. 添加旧 localStorage 收藏的一次性迁移。
4. 明确 Plugin、ZIP、本地绝对路径和无 provenance Skill 的分类与警告。

### Phase 2 — Repository planning and apply

1. 实现目录读取与安全校验。
2. 实现 export plan 和 import plan。
3. 复用现有 ResourceBundle 文件收集与原子写入逻辑。
4. 实现 Local Skill 导出与导入。
5. 实现 Source/Vendor 声明导出。
6. 复用 Skills CLI 实现 Vendor 安装。
7. 实现 snapshot fallback。
8. 实现 checksum 和 stale plan 检测。

### Phase 3 — RPC and filesystem picker

1. 增加 plan/apply RPC channels。
2. 增加选择导入目录、选择导出目录能力。
3. 导入完成后广播 Skills changed。
4. 增加打开导出目录能力。

### Phase 4 — “我的”header UX

1. 增加 icon-only dropdown 按钮。
2. 增加导入与导出 preview popover/panel。
3. 增加逐项冲突选择与结果摘要。
4. 对 loading、partial failure 和 cancellation 使用现有 Craft 状态样式。

### Phase 5 — Verification

1. 完成 module、RPC 和 renderer tests。
2. 执行 typecheck/build。
3. 使用 Electron + CDP 完成真实往返测试。
4. 确认无敏感信息、绝对路径或无关文件进入导出目录。

## Acceptance Criteria

1. “我的”header 显示一个符合现有设计语言的导入导出 icon 按钮。
2. 用户可以选择一个目录并导出“我的”。
3. Workspace/local Skills 完整出现在 `skills/<slug>/`。
4. 可重建的第三方 Skills 完整出现在 `skills/`，其上游仓库和源路径由 `meta.ts.vendors` 与 `.gitmodules` 声明；`vendor/` 默认不保存完整 clone。
5. 无法重建的第三方 Skills 可以保存 snapshot，并在 UI 中说明无法自动更新。
6. 导出的目录包含有效 `boai.json` 和 `boai.lock.json`。
7. 导出的目录不包含凭据、Token、会话、统计或本机绝对路径。
8. 用户可以选择该目录进行导入，并在修改前看到计划。
9. 导入后 Local Skills 和成功安装的 Vendor Skills 出现在“我的”。
10. 同内容重复导入不会重复创建或破坏 Skill。
11. 冲突默认不覆盖，只有用户明确选择后才替换。
12. 导入或导出部分失败时提供逐项结果，成功项目仍然可用。
13. 导入过程不执行目录中的任何代码。
14. Electron 在 `1221`/`9333` 环境下通过真实页面测试。

## Future Work

- 绑定本地 Git worktree。
- Git status 与差异展示。
- GitHub clone、pull、commit、push。
- 远程版本 checking 与同步阈值。
- 自动备份与版本历史。
- 多设备双向冲突处理。
- `instructions/` 的运行时加载与合并规则。
- 将脱敏后的 BoAI 数据源配置纳入同一 profile 仓库。
- 将目录导出为 `.boai.zip`，以及从 ZIP 导入。

## Further Notes

- `/Users/wangwenbo/Desktop/demo/skills` 只作为结构和理念参考，测试和实现不得修改该目录。
- 参考仓库的 `sources/` 是生成 Skills 的上游源码，`instructions/` 是生成提示；本 Spec 不假设它们已经等同于 BoAI 数据源或全局指令。
- 当前阶段完成后，目录已经具备 Git 友好性；用户可以自行初始化 Git 仓库并推送到 GitHub，应用内 Git 同步不影响 v1 格式。
