# Why

技能的安装、更新、卸载目前把「引擎无关的通用逻辑」和「各引擎的落地方式」耦合在一起:`StoSkillService` 直接把技能写入 OpenClaw 运行目录 `~/.stoclaw/openclaw/skills/`(该目录既是事实真源、又是 OpenClaw 引擎运行目录),而 Claude 引擎不参与安装,仅靠 `syncClaudeSkillsForAgent` 在每次对话前做懒镜像到 `~/.stoclaw/.claude/skills/`。

这带来三个问题:

- **时机不对称**:市场安装/卸载后,OpenClaw 立即生效,但 Claude 要等到下一条消息才同步,当前会话内不生效。
- **状态分散**:启用态分散在「目录移动(`skills-disabled/`)+ `openclaw.json` 条目」,Claude 侧又靠目录过滤;真源、用户工作区副本、agent 级副本、两引擎运行副本各写各的,容易漂移。
- **难以增减引擎**:OpenClaw 目录被当作真源,未来若要移除 OpenClaw 或 Claude 任一链路,需要连带迁移真源,耦合无法干净解除。

本次重构引入一层**引擎适配器**,由统一编排器把安装/更新/卸载/启用对称地下发给各引擎,并把事实真源迁到引擎无关的中立规范库,为「未来可插拔、可移除某条引擎链路」做准备。

# What Changes

- 新增**中立规范库** `~/.stoclaw/skills-store/`(`global/`、`users/{userCode}/skills/`、`agents/{agentId}/skills/`)与 `manifest.json`,作为技能包与元数据的唯一事实真源,取代以 OpenClaw 目录 + `lock.json` 为真源的模型。
- 新增 `SkillManager` 编排器,持有全部引擎无关逻辑(下载、解压、hoist、frontmatter 规整、版本比对、写规范库与 manifest),并在每次变更后遍历适配器注册表下发。
- 新增 `EngineSkillAdapter` 接口与注册表,内置 `OpenClawSkillAdapter` 与 `ClaudeSkillAdapter` 两个瘦适配器;各引擎的运行态(`openclaw/skills`、`skills-disabled`、`openclaw.json`、`.claude/skills`、agent 级目录)降级为由规范库重建的投影产物。
- 同步时机改为「**即时下发为主 + 幂等 reconcile 兜底**」:install/update/uninstall/enable 时即时投影到所有引擎;`reconcile(ctx)` 幂等对齐,在 Claude 对话前、用户登录、启动引导时调用,处理 agent 级技能与漂移自愈。
- 启用/禁用与 `apiKey/env` 配置上移到 manifest 单一真源,由各适配器投影到各自引擎的配置格式。
- 新增一次性迁移:从现有 `openclaw/users/{code}/skills`、`openclaw/skills`、`lock.json` 构建规范库与 manifest,迁移后 reconcile 重建各引擎投影;过渡期保留 `syncClaudeSkillsForAgent` 等旧入口作薄 wrapper。
- 失败语义明确:规范库写入为事务边界,适配器投影 best-effort、失败不回滚真源,由 reconcile 自愈。

# Capabilities

## New Capabilities

- `service-skill-lifecycle`: 主进程中引擎无关的技能生命周期编排边界,统一安装/更新/卸载/启用与多引擎投影同步(基于中立规范库 + 引擎适配器)。

## Modified Capabilities

- None.

# Impact

- 影响主进程技能安装链路:`electron/services/sto-skill-service.ts`(降级为薄 facade)、`electron/services/claude-skill-bridge.ts`(逻辑迁入 Claude 适配器)、`electron/services/project-agent-service.ts`(agent 镜像并入 OpenClaw 适配器)、`electron/services/user-skill-workspace.ts`(登录挂载改为 reconcile)、`electron/utils/skill-config.ts`、`electron/utils/retired-skills-cleanup.ts`、`electron/utils/paths.ts`(新增规范库路径)。
- 新增 `electron/services/skills/`(`skill-manager.ts`、`canonical-store.ts`、`skill-package.ts`、`migration.ts`、`adapters/`)。
- `electron/engines/claude-adapter.ts` 的查询前同步改为调用编排器 reconcile。
- 磁盘布局新增 `~/.stoclaw/skills-store/`;一次性迁移现有安装数据。
- 不涉及 Renderer API 与可见 UI 变更(纯主进程架构重构);不新增/修改 OpenClaw 本地插件,不改打包脚本。
