# SkillDeck Skills 扫描机制源码分析与 BoAI 改造建议

> 状态：Research / P0 implemented；Windows CI 与安装包实测待确认<br>
> 分析日期：2026-08-25<br>
> 研究对象：[crossoverJie/SkillDeck](https://github.com/crossoverJie/SkillDeck)<br>
> 固定源码版本：[`e6677f321ba7f34d083895ea645e2b585ac06ad9`](https://github.com/crossoverJie/SkillDeck/tree/e6677f321ba7f34d083895ea645e2b585ac06ad9)（2026-07-07）<br>
> 研究方法：只引用该仓库 README、Swift 源码与测试等一手资料；所有 SkillDeck 源码链接固定到上述 commit。

## 1. 执行结论

SkillDeck 对 BoAI 当前 Windows“机器上明明有很多 Skills，但技能页扫不到”的问题有直接参考价值，最关键的不是它使用 Swift 或符号链接，而是以下三个设计选择：

1. **扫描器直接枚举每个 Agent 的 Skills 目录，不依赖 `skills` CLI 是否安装。** Agent CLI 检测与 Skills 文件扫描是并行但互相独立的两条链路。只要某个支持目录存在并包含 `<skill>/SKILL.md`，SkillDeck 就会尝试加载。
2. **把 Agent 目录表做成统一定义。** `AgentType` 同时提供各 Agent 的默认 Skills 路径、配置目录、检测命令和跨目录继承规则；扫描、安装标注和文件监听共用这些定义。
3. **发现与“安装到哪些 Agent”分开建模。** 扫描器先发现真实 Skill，再通过路径和符号链接解析建立 installations，并标出直接安装、符号链接安装或继承可读。

这正好暴露 BoAI 当前实现里的断层：BoAI 已经在 [`agent-placements.ts`](../packages/shared/src/skills/agent-placements.ts) 维护了大量 Agent 路径，也能给已加载的 Skill 标注 Agent，但 [`loadAllSkills()`](../packages/shared/src/skills/storage.ts) 仍只把 `~/.agents/skills`、工作区、当前项目和启用插件作为“发现源”。因此 `.codex/skills`、`.claude/skills`、`.cursor/skills` 等路径只参与后置标注，不能把其中独有的 Skill 反向导入列表。这个缺口能够直接解释当前现象，是最可能的直接原因；但在 Windows 安装包上完成端到端复现和修复验证前，不能把它表述成已经确认的唯一根因。

建议吸收 SkillDeck 的“多根目录发现 + 安装位置标注”结构，但不要原样复制它的同名去重、macOS 文件监听和符号链接写操作。BoAI 是跨平台 Electron 应用，Windows 上应采用**只读外部发现、明确冲突、异步扫描、快照缓存、跨平台监听**的方案。

### 1.1 2026-08-26 实施进度

P0 代码已经落地：`loadAllSkills()` 和 `loadSkillBySlug()` 会扫描现有 Agent 注册表中的全局目录，不要求安装 `skills` CLI；Codex/Claude 自定义 Home、普通目录及 symlink/Windows junction 都有回归用例。外部目录使用独立的只读 `agent` 来源，UI 不提供编辑/删除，RPC 也会拒绝伪造的删除请求。CI 新增 Windows Agent Skill discovery job。

当前仍保留两个边界：同 slug 的多个外部不同版本暂时只确定性展示第一个，完整 variants/conflict UI 属于 P1；本轮已在 macOS 完成逻辑与类型验证，Windows runner 和安装包实机结果仍是最终验收条件。

## 2. 入口调用与完整扫描链路

SkillDeck 的首屏入口在 `ContentView` 的 `.task`：创建各 ViewModel 后调用 `await skillManager.refresh()`。这意味着扫描由视图首次出现触发，而不是由 CLI 或安装流程触发。[`ContentView.swift` L116-L125](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Views/ContentView.swift#L116-L125)

`SkillManager.refresh()` 同时启动 Agent 检测和 Skill 扫描：

```text
ContentView.task
  └─ SkillManager.refresh()
       ├─ AgentDetector.detectAll()
       └─ SkillScanner.scanAll()
            ├─ ~/.agents/skills
            └─ 每个 AgentType.skillsDirectoryURL
```

其中 `async let detectedAgents` 与 `async let scannedSkills` 并行执行；扫描完成后再补充 lock file 和缓存信息、替换界面的 `skills` 数组并启动目录监听。[`SkillManager.swift` L210-L268](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillManager.swift#L210-L268)

值得注意的是：

- `AgentDetector.detectAll()` 的结果仅用于 Agent 状态展示；[`SkillScanner.scanAll()`](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillScanner.swift#L17-L62) 始终遍历 `AgentType.allCases`，没有用 `isInstalled` 过滤扫描根目录。
- Agent 检测会尝试 `/usr/bin/which <command>`，也会查看配置目录和 Skills 目录，但这不是扫描的前置条件。[`AgentDetector.swift` L29-L63](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/AgentDetector.swift#L29-L63)、[`AgentDetector.swift` L66-L88](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/AgentDetector.swift#L66-L88)
- 所以在 SkillDeck 的模型里，“没有安装 `skills` CLI”不会阻止扫描；甚至某个 Agent CLI 没装，只要其 Skills 目录还在，目录里的 Skill 仍会被发现。

这个行为很适合 BoAI 当前场景：**文件系统中的 Skill 是事实来源，CLI 只是管理工具，不应成为发现依赖。**

## 3. 扫描目录集合

### 3.1 共享目录

SkillDeck 先扫描共享全局目录 `~/.agents/skills`，再扫描每个 Agent 自己的目录。共享路径由 `AgentType.sharedSkillsDirectoryURL` 集中定义，扫描器直接复用，避免路径常量在多个模块漂移。[`AgentType.swift` L171-L177](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Models/AgentType.swift#L171-L177)、[`SkillScanner.swift` L14-L38](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillScanner.swift#L14-L38)

### 3.2 Agent 专属目录

固定 commit 的 `AgentType.allCases` 共定义 14 个 Agent：

| Agent | 扫描目录 |
|---|---|
| Claude Code | `~/.claude/skills` |
| Codex | `~/.codex/skills` |
| Gemini CLI | `~/.gemini/skills` |
| Copilot CLI | `~/.copilot/skills` |
| OpenCode | `~/.config/opencode/skills` |
| Antigravity | `~/.gemini/antigravity/skills` |
| Cursor | `~/.cursor/skills` |
| Kiro | `~/.kiro/skills` |
| CodeBuddy | `~/.codebuddy/skills` |
| OpenClaw | 默认 `~/.openclaw/skills`，允许设置自定义路径 |
| Trae | `~/.trae/skills` |
| Qoder | `~/.qoder/skills` |
| QClaw | `~/.qclaw/skills` |
| WorkBuddy | `~/.workbuddy/skills` |

完整枚举和路径映射见 [`AgentType.swift` L5-L19](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Models/AgentType.swift#L5-L19) 与 [`AgentType.swift` L85-L123](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Models/AgentType.swift#L85-L123)。OpenClaw 是唯一支持用户自定义目录的 Agent，自定义值保存在 `UserDefaults`。[`AgentPathSettings.swift` L3-L35](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/AgentPathSettings.swift#L3-L35)

### 3.3 跨 Agent 可读目录

SkillDeck 还单独描述“一个 Agent 可以读取另一个目录”的继承规则：

- Codex 可读共享 `~/.agents/skills`；
- Copilot CLI 可读 Claude Code 的目录；
- OpenCode 可读 Claude Code 和共享目录；
- Cursor 可读 Claude Code 的目录。

这些规则位于 [`AgentType.additionalReadableSkillsDirectories`](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Models/AgentType.swift#L179-L213)，主要用于安装位置标注，不会额外递归扫描一遍同一目录。

## 4. Home、配置目录与 Windows 处理

### 4.1 SkillDeck 的实际处理

SkillDeck 用 `NSString.expandingTildeInPath` 把 `~` 展开为当前用户 Home，再构造文件 URL。[`AgentType.swift` L125-L129](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Models/AgentType.swift#L125-L129) 配置目录也全部使用 `~/.xxx` 或 `~/.config/xxx` 的 macOS/Unix 风格路径。[`AgentType.swift` L131-L149](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Models/AgentType.swift#L131-L149)

它没有通用的 `XDG_CONFIG_HOME`、`CODEX_HOME`、`CLAUDE_CONFIG_DIR` 或 Windows `%APPDATA%`/`%LOCALAPPDATA%` 解析；只有 OpenClaw 的单项自定义路径。

### 4.2 不能把 SkillDeck 当作 Windows 参考实现

SkillDeck 明确是 macOS 14+ 应用：Swift Package 只声明 `.macOS(.v14)`，[`Package.swift` L18-L19](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Package.swift#L18-L19)；README 也把产品定义为 macOS 桌面 GUI。[`README.md` L7-L15](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/README.md#L7-L15)

因此，它的**目录枚举架构**值得借鉴，但它没有解决 Windows Home、盘符、大小写、目录 Junction、符号链接权限或 `fs.watch` 差异。BoAI 不能照抄 `~` 字符串和 macOS `DispatchSource`。

### 4.3 BoAI 已有更好的跨平台路径基础

BoAI 的 `agent-placements.ts` 已经：

- 用 Node `homedir()` 获取 Home；
- 用 `path.join()` 生成平台路径；
- 支持 `CODEX_HOME`、`CLAUDE_CONFIG_DIR`；
- 支持 `XDG_CONFIG_HOME`，否则回退到 `<home>/.config`；
- 维护远多于 SkillDeck 的 Agent 目录映射。

对应源码见 [`agent-placements.ts` L18-L31](../packages/shared/src/skills/agent-placements.ts#L18-L31)、[`agent-placements.ts` L33-L106](../packages/shared/src/skills/agent-placements.ts#L33-L106) 与 [`agent-placements.ts` L146-L175](../packages/shared/src/skills/agent-placements.ts#L146-L175)。真正缺少的是把这些根目录暴露给发现扫描器，而不是重新维护另一张路径表。

Windows 不能采用“所有 Unix 路径统一改到 `%APPDATA%`”这样的通用猜测。每个 Agent resolver 应有明确优先级：该 Agent 官方支持的环境变量或用户自定义路径优先，其次是注册表中经过平台验证的默认路径；`XDG_CONFIG_HOME`、`APPDATA`、`LOCALAPPDATA` 只用于明确采用它们的 Agent，最后才是该 Agent 文档确认的 Home 点目录。测试应注入 `homeDir`、`configDir` 和环境变量，不依赖运行测试机器的真实用户目录。P0 可以先覆盖 Codex、Claude 和共享目录，再按 Agent 的 Windows 权威路径逐项开放，避免把 SkillDeck 的 Unix 假设批量移植到 Windows。

## 5. 递归深度与 `SKILL.md` 校验

### 5.1 本地扫描只有一层

`scanDirectory()` 调用 `contentsOfDirectory` 读取扫描根目录的直接子项，然后对每个子项检查 `<item>/SKILL.md`。它不会递归寻找更深层的 `SKILL.md`，并使用 `.skipsHiddenFiles` 跳过隐藏项。[`SkillScanner.swift` L64-L88](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillScanner.swift#L64-L88)、[`SkillScanner.swift` L92-L107](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillScanner.swift#L92-L107)

所以 SkillDeck 接受的本地布局本质上是：

```text
<agent-skills-root>/
  <skill-slug>/
    SKILL.md
```

这对于本机 Agent Skills 目录是合理边界：避免扫遍整个 Home；候选目录枚举阶段的耗时近似与已知根目录下的 Skill 数量线性相关。后续安装位置标注还有 `O(K × A)` 级别的探测成本，见第 9.2 节。

### 5.2 硬校验与软降级

硬校验只有一项：解析符号链接后的 Skill 目录下必须存在 `SKILL.md`。文件不存在就忽略该目录。[`SkillScanner.swift` L96-L107](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillScanner.swift#L96-L107)

正常解析器会：

1. 要求 UTF-8；
2. 要求开头和结尾 `---` frontmatter；
3. 先用 Yams 解码到 `SkillMetadata`；
4. 严格解码失败后再用一个行级 fallback；
5. fallback 要求 `name` 和 `description` 非空。

证据见 [`SkillMDParser.swift` L31-L70](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillMDParser.swift#L31-L70)、[`SkillMDParser.swift` L73-L119](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillMDParser.swift#L73-L119) 和 [`SkillMDParser.swift` L183-L207](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillMDParser.swift#L183-L207)。模型中的 `name`、`description` 也都是必填字符串。[`SkillMetadata.swift` L3-L22](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Models/SkillMetadata.swift#L3-L22)

但扫描器对解析失败采取**软降级**：仍保留该 Skill，以目录名作为名称、空描述和空正文展示，而不是丢弃整项。[`SkillScanner.swift` L110-L121](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillScanner.swift#L110-L121)

BoAI 当前 `parseSkillFile()` 对缺少 `name`/`description` 或解析异常直接返回 `null`，随后整项消失。[`storage.ts` L65-L95](../packages/shared/src/skills/storage.ts#L65-L95) 对用户而言，“格式无效”和“没有扫描到”现在无法区分。可以借鉴 SkillDeck 的容错思想，但最好展示“无效 Skill + 错误原因”，而不是静默用空元数据伪装成有效项。

## 6. 来源、Agent 标注与继承关系

每个 Skill 的核心模型包含：目录名 `id`、解析符号链接后的 `canonicalURL`、元数据、Scope、安装位置数组和可选 lock entry。[`Skill.swift` L8-L29](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Models/Skill.swift#L8-L29)

Scope 有三类：

- `sharedGlobal`：共享目录；
- `agentLocal(agent)`：某 Agent 自己的真实目录；
- `project(URL)`：模型存在，但 `SkillScanner.scanAll()` 当前没有扫描项目目录。

定义见 [`SkillScope.swift` L3-L21](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Models/SkillScope.swift#L3-L21)。

`SymlinkManager.findInstallations()` 用两遍扫描建立 Agent 标注：

1. 第一遍检查每个 Agent 自己的 `<skills-root>/<skillName>`。符号链接必须最终解析到当前 canonical path；真实目录直接记为该 Agent 的直接安装。
2. 第二遍只处理没有直接安装的 Agent，在 `additionalReadableSkillsDirectories` 中查找同一个 canonical path，并标记 `isInherited` 和 `inheritedFrom`。

具体实现见 [`SymlinkManager.swift` L118-L166](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SymlinkManager.swift#L118-L166) 与 [`SymlinkManager.swift` L168-L207](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SymlinkManager.swift#L168-L207)。`SkillInstallation` 还保留实际 path、是否符号链接、是否继承及继承来源，足以让 UI 显示“via Claude Code”一类状态。[`SkillInstallation.swift` L3-L21](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Models/SkillInstallation.swift#L3-L21)

这部分和 BoAI 已有的 `annotateSkillAgentPlacements()` 思路非常接近。BoAI 当前也会检查真实路径或相同内容，并标出 inherited placement。[`agent-placements.ts` L108-L135](../packages/shared/src/skills/agent-placements.ts#L108-L135)、[`agent-placements.ts` L168-L205](../packages/shared/src/skills/agent-placements.ts#L168-L205) 因此 BoAI 不需要重写 Agent 标注器，只需要让发现阶段把 Agent 专属目录中的独有 Skill 加入输入集合。

## 7. 去重与冲突行为

### 7.1 SkillDeck 的规则

SkillDeck 以**目录名 `skill.id`** 作为全局去重键，而不是 canonical path 或内容哈希。共享目录先写入 map，随后各 Agent 目录按 `AgentType.allCases` 顺序扫描。[`SkillScanner.swift` L19-L38](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillScanner.swift#L19-L38)

遇到同名 Skill 时，它只合并 installations，不替换已有 metadata、正文或 canonical URL。代码注释明确说明：即使两个同名 Skill 指向不同物理路径，也要当成同一个 Skill。[`SkillScanner.swift` L20-L25](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillScanner.swift#L20-L25)、[`SkillScanner.swift` L41-L57](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillScanner.swift#L41-L57)

优先结果是：

1. `~/.agents/skills/<slug>` 存在时，它的内容优先；
2. 否则，`AgentType` 枚举中最先扫描到的目录内容优先；
3. 后续同名但内容不同的目录只贡献安装标记，冲突不会暴露给用户。

`Skill` 的相等和哈希也只使用 `id`。[`Skill.swift` L66-L73](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Models/Skill.swift#L66-L73)

### 7.2 可借鉴与不可照搬

可以借鉴：

- 同一个 real path 被多个 Agent 符号链接引用时，应合并成一个 Skill，并把多个 Agent 作为 locations/installations 展示；
- 多级符号链接应解析到最终真实路径。SkillDeck 使用 `resolvingSymlinksInPath()` 递归解析。[`SymlinkManager.swift` L103-L115](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SymlinkManager.swift#L103-L115)

不可照搬：

- `.codex/skills/review` 和 `.claude/skills/review` 可能是两个完全不同的 Skill；仅按 slug 合并会隐藏内容冲突，并错误地把第一个版本标成同时安装到多个 Agent。
- Windows 路径大小写不敏感，但 slug/content 冲突仍然需要独立判断，不能把“路径键规范化”误当作“Skill 内容相同”。

BoAI 应采用分层身份规则：

1. real path 相同：确定为同一实例，合并 Agent locations；
2. real path 不同但 `SKILL.md` 哈希相同：只能标为“疑似副本”，不能自动合并；Skill 还可能依赖同目录下的脚本、模板、图片等文件；
3. 如果产品确实需要内容级去重，应计算完整目录的稳定清单哈希，并排除缓存、版本控制目录等非运行文件；即使哈希相同，也保留每个物理 location；
4. slug 相同但 real path 或目录内容不同：保留冲突 variants，UI 提示来源，不静默覆盖；
5. BoAI 自身执行时再应用现有优先级，而“所有 Skills”管理页仍应能看见冲突版本。

## 8. 缓存、刷新与文件监听

### 8.1 SkillDeck 没有 Skills 扫描结果缓存

`SkillManager.refresh()` 每次都重新调用 `scanner.scanAll()`，再替换整个 `skills` 数组。[`SkillManager.swift` L210-L256](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillManager.swift#L210-L256) lock file 有内存缓存，但刷新前会主动 invalidation，避免外部工具修改后读到旧值。[`SkillManager.swift` L224-L235](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillManager.swift#L224-L235)

仓库中的 `.skilldeck-cache.json` 用于 commit hash、远端更新状态和手工仓库链接，不是本地发现索引；不能把它理解成扫描快照。[`SkillManager.swift` L124-L136](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillManager.swift#L124-L136)

### 8.2 自动刷新

首次刷新后，Manager 监听共享目录和所有 Agent Skills 目录。[`SkillManager.swift` L298-L305](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillManager.swift#L298-L305) `FileSystemWatcher` 对每个已存在目录打开 macOS `DispatchSourceFileSystemObject`，监听 write/delete/rename/attrib，并用 0.5 秒 debounce 合并事件。[`FileSystemWatcher.swift` L36-L55](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/FileSystemWatcher.swift#L36-L55)、[`FileSystemWatcher.swift` L79-L127](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/FileSystemWatcher.swift#L79-L127)

监听事件触发后再次执行完整 `refresh()`。[`SkillManager.swift` L195-L205](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillManager.swift#L195-L205)

局限性：

- watcher 只监听当前已存在的根目录；根目录启动时不存在，就不会建立 watcher；
- 它监听的是根目录文件描述符，不是递归 watcher；从代码不能保证深层 `SKILL.md` 内容修改在所有情况下都触发；
- 每次刷新都会停止并重建全部 watcher；
- 实现依赖 macOS `O_EVTONLY` 与 GCD，Windows 不能复用。

### 8.3 对 BoAI 的建议

BoAI 目前 `loadAllSkills()` 有 5 分钟内存 TTL，缓存键是 workspace/project，但扫描集合只有四类现有来源。[`storage.ts` L268-L327](../packages/shared/src/skills/storage.ts#L268-L327) 扩展 Agent 根目录后，应避免每次进入页面同步读取几十个目录和所有 `SKILL.md`：

- Electron main/server 端执行异步扫描，Renderer 只消费 RPC 快照；
- 先立即返回上次成功快照，再后台 revalidate；
- 使用有限并发读取目录和文件，避免同步 `readdirSync/readFileSync` 阻塞主进程；
- 监听已存在的 Agent 根目录，300–500ms debounce 后做增量或完整重扫；
- watcher 失败时保留“刷新”按钮和 TTL 回退；
- 新建了原先不存在的根目录时，通过手工刷新、周期校验或监听其最近存在的父目录补建 watcher。

## 9. 错误处理、性能与安全

### 9.1 错误处理

SkillDeck 的本地扫描遵循“单项失败不阻断列表”：

- 根目录不存在：返回空数组；
- 目录读取失败：`try?` 后返回空数组；
- 缺少 `SKILL.md`：忽略；
- `SKILL.md` 解析失败：保留默认名称的 Skill；
- 整体 `refresh()` 捕获顶层错误并设置 `errorMessage`。

证据见 [`SkillScanner.swift` L69-L87](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillScanner.swift#L69-L87)、[`SkillScanner.swift` L104-L121](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillScanner.swift#L104-L121) 和 [`SkillManager.swift` L261-L267](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillManager.swift#L261-L267)。

这种容错保证一个损坏目录不会拖垮全部列表，但大量错误被静默吞掉。BoAI 应返回结构化 diagnostics，例如 `root-unreadable`、`missing-skill-md`、`invalid-frontmatter`、`file-too-large`；对于合法但需要关注的跨根目录链接，使用 `symlink-outside-root` warning，而不是直接判定 Skill 无效。diagnostics 至少应在日志和扫描摘要里可见。

### 9.2 性能特征

SkillDeck 的根目录枚举是一层、串行扫描，基础成本是所有根目录直接子项总数。更昂贵的是：每解析一个 Skill 都会调用 `findInstallations()`，再次遍历所有 Agent 和继承目录并做多个 `fileExists`/realpath 检查。[`SkillScanner.swift` L123-L127](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillScanner.swift#L123-L127)、[`SymlinkManager.swift` L127-L206](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SymlinkManager.swift#L127-L206)

若发现 Skill 数为 `K`、Agent 数为 `A`，安装标注大致会引入 `O(K × A)` 的文件系统探测；同一个 Skill 在多个根目录出现时仍会重复解析文件和计算 installations。`SkillScanner` 是 actor、并由 async task 调用，能避免数据竞争，但内部仍是同步 Foundation 文件 I/O，并不等于具备高吞吐的并行扫描。

BoAI 可以比 SkillDeck 更进一步：先一次性枚举所有 root，建立 `realPath -> locations` 和 `slug -> variants` 索引，再各读取一次唯一 `SKILL.md`，避免对每个 Skill 重扫所有 Agent 根目录。

### 9.3 安全边界

SkillDeck 会跟随 Agent 目录中的符号链接到最终真实目录，并直接读取目标 `SKILL.md`。[`SkillScanner.swift` L96-L114](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillScanner.swift#L96-L114) 代码中没有检查解析后的 canonical path 是否仍位于受信任 Skills 根目录，也没有 `SKILL.md` 文件大小上限。

更重要的是，扫描到的 `canonicalURL` 后续可被编辑、删除或用于创建新符号链接；删除逻辑直接 `removeItem(at: skill.canonicalURL)`，保存逻辑直接写入 canonical path。[`SkillManager.swift` L320-L351](https://github.com/crossoverJie/SkillDeck/blob/e6677f321ba7f34d083895ea645e2b585ac06ad9/Sources/SkillDeck/Services/SkillManager.swift#L320-L351)

因此可以从源码推导出一个需要防范的风险：如果某个 Agent Skills 目录中存在指向任意外部目录的符号链接，扫描后对该 Skill 执行编辑/删除，可能修改符号链接目标。这里是代码审计推论，不代表已验证的公开漏洞。

BoAI 的安全规则应更严格：

- 外部 Agent 目录发现到的 Skill 默认只读；
- 删除、更新、编辑只允许作用于 BoAI 管理目录或经过明确授权的确切 location；
- 解析 symlink/junction 后记录 real path；mutation 前再次校验目标和授权范围，以缩小 TOCTOU 风险窗口；
- `SKILL.md` 设置合理大小上限，例如 1 MiB，并限制单 root 最大条目数；
- 不执行 frontmatter 或 Markdown 中的任何命令；图标/远程资源继续走现有 URL 校验；
- Windows 下同时处理 symlink、directory junction 和大小写归一化，不能依赖 macOS 的符号链接语义。

`symlink-outside-root` 不应天然等同于无效 Skill，因为跨目录链接本身可能是合法的共享方式。发现阶段应把它记录为安全属性或警告并允许只读展示；写操作则采用更严格的授权规则。mutation 前重新解析 real path 只能缩小 TOCTOU 竞态窗口，不能彻底消除目标在“校验—操作”之间被替换的风险。最安全的默认行为仍是：先把外部 Skill 复制/导入 BoAI 管理目录，再对副本执行编辑、更新或删除；若将来允许原地修改，需要基于平台能力采用句柄约束或原子操作，并明确接受剩余风险。

## 10. 与 BoAI 当前实现的逐项对照

| 维度 | SkillDeck | BoAI 当前 | 结论 |
|---|---|---|---|
| 是否依赖 `skills` CLI | 不依赖 | 基础读取不依赖，但发现源局限 | 保持 CLI 非必需 |
| 全局共享目录 | 扫 `~/.agents/skills` | 扫 `~/.agents/skills` | 已具备 |
| Agent 专属目录 | 扫 14 个 Agent root | 有大量 root 定义，但只用于标注 | 需要接入发现阶段 |
| 项目/工作区 | 扫描器当前不扫项目；模型预留 | 扫 workspace 和 project | BoAI 现状更完整，应保留 |
| 递归深度 | root 下直接子目录 | root 下直接子目录 | 保持浅扫描 |
| 无效 `SKILL.md` | 保留降级项 | 静默丢弃 | 改为带错误状态的可见项 |
| 去重 | 仅按 slug，冲突静默 | 按 slug 且有来源优先级 | 外部目录加入后必须引入 variants |
| Agent 标注 | canonical path + direct/inherited | realpath/内容 + direct/inherited | 复用 BoAI 现有实现 |
| 缓存 | 每次全量重扫 | 5 分钟内存 TTL | 改成 stale-while-revalidate 快照 |
| 刷新 | macOS watcher，0.5s debounce | 有显式 cache invalidation 基础 | 增加跨平台 watcher/RPC 刷新 |
| Windows | 不支持 | Electron/Node 跨平台 | 只能借鉴架构，不能照搬实现 |
| 外部 Skill 写操作 | canonical target 可编辑/删除 | 当前删除按 source 路径 | 外部发现必须明确只读权限 |

BoAI 当前发现入口的限制可直接从 [`loadAllSkills()`](../packages/shared/src/skills/storage.ts#L292-L327) 看出：

1. `~/.agents/skills`；
2. `{workspace}/skills`；
3. `{project}/.agents/skills`；
4. 启用插件目录。

而 Agent 路径与可读继承关系已经存在于 [`AGENTS`](../packages/shared/src/skills/agent-placements.ts#L33-L106)。这说明修复可以围绕“统一根目录真源 + 新发现索引”做局部重构，不需要引入或强制安装 `skills` CLI。

BoAI 技能列表的当前调用链也是直接文件系统读取：Renderer 调用 `window.electronAPI.getSkills(...)`，[`AppShell.tsx` L829-L840](../apps/electron/src/renderer/components/app-shell/AppShell.tsx#L829-L840)；RPC handler 随后直接执行 `loadAllSkills()` 再做 management/placement 标注，[`skills.ts` L66-L84](../packages/server-core/src/handlers/rpc/skills.ts#L66-L84)。这条 GET 链路没有调用 `skills` CLI。CLI 只参与安装、更新、卸载和 lock provenance 等管理动作，例如 update/uninstall handler 会显式校验 `management.manager === 'skills-cli'`。[`skills.ts` L185-L217](../packages/server-core/src/handlers/rpc/skills.ts#L185-L217)、[`skills.ts` L269-L295](../packages/server-core/src/handlers/rpc/skills.ts#L269-L295) 因此“不安装 `skills` CLI 仍应能够发现本地文件”既符合 SkillDeck 的实现，也符合 BoAI 当前读链路；缺失的是扫描根，而不是 CLI 门控。

## 11. 推荐的 BoAI 目标设计

### 11.1 统一 Agent 定义输出

把 `agent-placements.ts` 中的内部 `AGENTS` 提炼为只读定义或查询 API，同时提供：

```ts
interface SkillDiscoveryRoot {
  path: string
  kind: 'shared' | 'agent-global' | 'agent-project'
  agentId?: string
  readableByAgentIds: string[]
  exists: boolean
}
```

扫描器与 placement annotator 都消费这个输出，避免新增第二张路径表。路径求值继续尊重：

- `os.homedir()`；
- `CODEX_HOME`；
- `CLAUDE_CONFIG_DIR`；
- `XDG_CONFIG_HOME`；
- Windows 环境变量和 Agent 明确支持的自定义目录。

不要用“Agent CLI 是否在 PATH”筛掉扫描根；目录存在本身就足够成为发现依据。

### 11.2 把 location 与逻辑 Skill 分开

建议新增类似模型：

```ts
interface SkillLocation {
  path: string
  realPath: string
  sourceKind: 'boai-global' | 'workspace' | 'project' | 'plugin' | 'agent-global' | 'agent-project'
  pluginId?: string
  agentIds: string[]
  readOnly: boolean
}

interface DiscoveredSkillVariant {
  slug: string
  skillMdHash: string
  treeHash?: string
  metadata: SkillMetadata | null
  parseError?: string
  locations: SkillLocation[]
}
```

这样可以表示：同一 real path 被多个 Agent 共享、疑似相同内容存在多个副本、同 slug 存在内容冲突，以及外部只读/BoAI 可管理的权限差异。`skillMdHash` 只用于快速比较和提示；只有可复现的完整目录 `treeHash` 才能辅助判断整个 Skill 内容一致，且 real path 不同的 location 仍不应丢失。

### 11.3 两阶段扫描

第一阶段只枚举目录并收集候选：

1. BoAI global/workspace/project/plugin；
2. 所有已知 Agent global roots；
3. 如有当前 project，再收集各 Agent 明确支持的 project roots；
4. 每个 root 只读取直接子目录，不扫描整个 Home；
5. 对路径做跨平台规范化并收集 real path。

第二阶段对唯一 real path 做有限并发解析：

1. 检查 `SKILL.md`；
2. 检查文件类型和大小；
3. UTF-8 + frontmatter 解析；
4. 计算 `SKILL.md` 哈希；仅在需要内容级比较时计算稳定的完整目录清单哈希；
5. 建立 variants、locations、Agent placements 和 diagnostics。

### 11.4 冲突和执行优先级

管理页面显示全部 variants；BoAI 真正给 Agent 注入 Skill 时保持明确优先级：

```text
当前项目 > BoAI 工作区 > BoAI 管理的全局 Skill > 外部 Agent Skill
```

插件继续使用限定 slug，并走现有的独立命名空间，不参加普通 slug 的覆盖竞争。外部同 slug 不同内容时，在没有用户选择或配置规则前，管理页可以展示，但不自动加入可执行 Skill 集合；UI 至少显示“发现 2 个版本”及各自路径。这样不会用一个笼统的“外部最低优先级”掩盖外部来源之间的歧义。

### 11.5 后台刷新与用户体验

- 应用启动或进入技能页时先返回持久化/内存快照；
- 后台 worker 或 Electron main/server task 扫描，完成后通过事件更新 UI；
- 扫描不在 Renderer 首次渲染同步路径执行；
- 目录事件 debounce 后刷新受影响 root；
- 提供“上次扫描时间、扫描目录数、有效/无效/冲突数量”；
- 提供手工刷新，便于处理 watcher 丢事件、新安装 Agent 或新建目录。

## 12. 分阶段落地与验收建议

### P0：解决 Windows 扫不到

1. 从现有 Agent 定义导出全局扫描 roots。
2. 先在发现层加入共享、Codex、Claude 等已经验证 Windows 路径的 root；其他 Agent 经路径核验后逐项开放。
3. 不以 `skills` CLI 或 Agent CLI 存在为条件。
4. 外部来源使用独立只读类型；Renderer 隐藏或禁用编辑、删除、更新，RPC/mutation API 也必须按来源拒绝，不能只靠 UI。
5. 增加 Windows 临时目录测试，至少覆盖反斜杠、盘符、大小写和目录 Junction/符号链接可用时的行为。

P0 必须在 Windows 打包安装版完成端到端验收，而不只跑 storage 单测：

1. 仅在 `%USERPROFILE%\.codex\skills\foo\SKILL.md` 放置 Skill，未安装 `skills` CLI，也能在技能页看到 `foo`，来源标为 Codex；
2. Codex CLI 不在 PATH、但目录存在时仍可发现；目录不存在或不可读时其他来源仍正常，并产生可诊断记录；
3. 新建/删除 Skill 后手工刷新或 watcher 能使缓存失效；应用重启后结果一致；
4. 大小写不同的 Windows 路径不会生成重复项；可创建 junction/symlink 的环境中，同一 real path 合并 location，无法创建链接的普通用户环境也能扫描真实目录副本；
5. 同 slug、不同内容的外部来源不会在 P0 被静默覆盖；如果冲突 UI 尚未进入 P0，至少跳过歧义项并记录 diagnostics；
6. 外部 Skill 不显示可用的编辑/删除/更新操作，直接构造 RPC 请求也会被后端拒绝；
7. BoAI 既有 global/workspace/project/plugin 的发现和执行优先级不回归。

### P1：冲突与可诊断性

1. 只对相同 real path 自动合并；内容哈希用于疑似副本提示，完整目录哈希用于辅助比较；
2. 同 slug 不同内容展示 variants；
3. 无效 Skill 进入 diagnostics，而不是静默消失；
4. UI 展示实际路径、可读 Agent 和只读状态。

验收：Claude 与 Codex 下两个同名不同内容的 Skill 都可见，不会被错误合并为一个“同时安装到两个 Agent”的 Skill。

### P2：性能与自动刷新

1. 异步有限并发扫描；
2. stale-while-revalidate 快照；
3. 跨平台 watcher + debounce；
4. 增量更新或至少避免重复解析相同 real path；
5. 大规模基准测试。

建议基准场景：80 个 Agent roots、1,000 个唯一 Skill、30% 重复链接、10% 同 slug 冲突、5% 无效文件。先固定 Windows x64 CI/测试机和冷、热缓存条件；初始工程预算可设为：热快照 RPC `p95 ≤ 100 ms`、Renderer 首次渲染不等待全量扫描、后台扫描期间 main/Renderer 单次长任务 `< 50 ms`、全量扫描 `p95 ≤ 2 s`、扫描额外常驻内存 `< 100 MiB`。这些是待基线验证的建议阈值；若硬件差异较大，应同时要求相对当前版本不回退，并把最终阈值固化进性能测试。

### P3：管理操作边界

1. 外部只读 Skill 可“导入到 BoAI”或“在文件管理器打开”；
2. 只有导入后或用户明确授权确切目录，才允许编辑/删除/更新；
3. mutation 前重新解析 real path 并校验授权边界；
4. Windows Junction/symlink 和 TOCTOU 加回归测试。

验收：未授权的 external location 在 UI 和 RPC 两层都不能被修改；“导入到 BoAI”后编辑只改变管理目录中的副本；扫描后链接目标被替换时，原地 mutation 被拒绝或根本不存在该入口；删除 BoAI 副本不会删除原 external location。

## 13. 最终判断

SkillDeck 的实现支持了一个简单而有效的产品原则：**Skills 发现应该扫描实际存在的 Agent 目录，而不是要求用户先用某个统一 CLI 把 Skill 复制到 `~/.agents/skills`。** 这一结构能够解释并有望解决 BoAI Windows 用户当前的漏扫现象，最终结论以 Windows 打包版端到端验收为准。

但 SkillDeck 是 macOS 原生应用，它的路径展开、文件监听和符号链接管理不具备 Windows 可移植性；它仅按 slug 合并也会隐藏多 Agent 内容冲突。BoAI 最合理的做法是复用自身已有的 Agent 路径表和 placement 逻辑，新增跨平台只读发现层，并以 real path、目录指纹和 variants 明确处理去重与冲突。

换句话说：**借 SkillDeck 的扫描边界和数据分层，不借它的 macOS 实现细节与同名即同 Skill 的假设。**
