# Context

主进程技能生命周期当前以 OpenClaw 运行目录为事实真源:`StoSkillService.doInstall/uninstall` 下载并写入 `~/.stoclaw/openclaw/skills/{slug}`,同时拷贝到用户工作区 `~/.stoclaw/openclaw/users/{code}/skills`、写 `~/.stoclaw/openclaw/.clawhub/lock.json`,agent 级安装再由 `project-agent-service` 镜像到项目 agent。OpenClaw Gateway 直接扫描运行目录;Claude 引擎不参与安装,`claude-skill-bridge.syncClaudeSkillsForAgent` 在 `claude-adapter.startClaudeQuery` 内按内容哈希把启用技能懒镜像到 `~/.stoclaw/.claude/skills/{slug}`。启用态由「`skills/` ↔ `skills-disabled/` 目录移动 + `openclaw.json` 的 `skills.entries.{slug}.enabled`」双写维护。

这套模型把「引擎无关的通用逻辑」和「各引擎落地方式」耦合、把「持久真源」和「引擎运行副本」混为一谈,导致时机不对称、状态分散、难以增减引擎。本设计在不改变对外 API 与 UI 的前提下,引入引擎适配器层与中立规范库。

# Goals / Non-Goals

**Goals:**

- 引擎无关的通用逻辑集中到单一编排器 `SkillManager`。
- 统一的 `EngineSkillAdapter` 接口 + 注册表,新增引擎只写一个适配器、增删引擎只改注册表一行。
- 安装/更新/卸载/启用对所有已注册引擎即时对称生效,漂移由幂等 reconcile 自愈。
- 事实真源迁到引擎无关的中立规范库,使移除任一引擎链路不触及真源。

**Non-Goals:**

- 不改变技能市场后端接口、下载协议、SKILL.md 格式。
- 不改变 Renderer 侧 API 或任何可见 UI(纯主进程重构)。
- 不引入事件总线 / 异步消息机制。
- 不改动 OpenClaw 本地插件或打包脚本。

# Decisions

## Decision: 引入引擎无关的中立规范库作为唯一事实真源

新增 `~/.stoclaw/skills-store/`,含 `global/{slug}/`(预装/共享)、`users/{userCode}/skills/{slug}/`(每用户持久安装)、`agents/{agentId}/skills/{slug}/`(agent 级),以及单一 `manifest.json` 记录每条技能的 `version / source / name / title / description / author / scope / enabled / config{apiKey,env} / installedAt`。各引擎的运行目录(`openclaw/skills`、`skills-disabled`、`.claude/skills`、agent 运行目录)与 `openclaw.json` 条目全部降级为「投影产物」,由适配器从规范库重建。

Rationale:真源与引擎运行态解耦后,移除某条引擎链路 = 删除其适配器,不动真源;启用态与技能配置收敛到 manifest 单一来源,消除双写漂移。

Alternative considered:继续以 `openclaw/skills` 为真源、仅在其上包适配器。改动最小,但 OpenClaw 与真源仍耦合,与「未来可移除 OpenClaw 引擎」目标冲突,故放弃。

Alternative considered:复用现有 `openclaw/users/{code}/skills` 原地正式化为规范库(不搬家)。省去迁移,但真源仍留在 `openclaw/` 命名空间下,语义上仍与 OpenClaw 绑定,长期不够干净;故选择新建中立目录 + 一次性迁移。

## Decision: manifest 采用单一全局文件 + 分区键

`~/.stoclaw/skills-store/manifest.json` 用单文件承载所有作用域,以 `scope` + `userCode`/`agentId` 作分区键,而非每用户一份 manifest。

Rationale:单文件便于一次性读取全量 desired 集合、便于迁移与备份、避免多文件一致性问题;写入通过既有 `withConfigLock` 串行化。

Alternative considered:每用户 / 每 agent 一份 manifest。隔离更强,但读取 desired 集合要聚合多文件、跨文件一致性更复杂,收益不抵成本。

## Decision: 定义 `EngineSkillAdapter` 接口与注册表

```ts
interface SkillPackage {
  slug: string;
  sourceDir: string;            // 规范库中该 scope 的包目录
  version: string;
  enabled: boolean;
  scope: 'global' | 'user' | 'agent';
  config?: { apiKey?: string; env?: Record<string, string> };
}
interface EngineSkillContext { userCode: string | null; agentId?: string; }
interface EngineSkillAdapter {
  readonly id: 'openclaw' | 'claude';
  applyInstall(pkg: SkillPackage, ctx: EngineSkillContext): Promise<void>;
  applyUninstall(slug: string, ctx: EngineSkillContext): Promise<void>;
  applyEnabled(slug: string, enabled: boolean, ctx: EngineSkillContext): Promise<void>;
  reconcile(desired: SkillPackage[], ctx: EngineSkillContext): Promise<ReconcileResult>;
  onAfterBatch?(ctx: EngineSkillContext): Promise<void>;
}
```

`OpenClawSkillAdapter` 投影到 `openclaw/skills`(启用)/`skills-disabled`(禁用)+ 写 `openclaw.json` 条目 + agent 级目录 + 批量后刷新 Gateway;`ClaudeSkillAdapter` 收纳现 `claude-skill-bridge` 的哈希比对 + marker 逻辑,投影到 `.claude/skills`(禁用则移除)。注册表为一个数组,`reconcile(ctx, engines?)` 可限定引擎。

Rationale:接口薄、职责单一,`onAfterBatch` 把「Gateway 刷新」这类每批一次的副作用与单技能投影解耦;`reconcile` 承载幂等对齐与孤儿清扫,统一漂移自愈。

Alternative considered:让编排器直接 if/else 处理两引擎,不抽接口。短期简单,但违背可扩展/可移除目标。

## Decision: 同步时机为「即时下发为主 + 幂等 reconcile 兜底」

`install/update/uninstall/setEnabled` 在写规范库后即时遍历适配器投影;`reconcile(ctx)` 在 `claude-adapter.startClaudeQuery`(限 `['claude']`)、`user-skill-workspace.activateUserWorkspace`(全引擎)、启动引导(预装/退役)处调用。

Rationale:满足「安装/卸载后两引擎即时对称生效」,同时 reconcile 覆盖 agent 级技能(按 agentId 计算 desired)与漂移/中断恢复。

Alternative considered:纯即时下发,去掉 reconcile。无法优雅处理 agent 级按需同步与投影漂移,故保留 reconcile。

## Decision: 规范库写入为事务边界,适配器投影 best-effort

规范库(包目录 + manifest)写成功即视为操作成功;适配器投影失败仅记日志、不回滚真源,由下次 reconcile 自愈。

Rationale:避免某引擎失败导致两边撕裂或真源回退;幂等 reconcile 保证最终一致。

Alternative considered:两阶段提交 / 全引擎成功才算成功。跨文件系统难以真正原子,复杂度高、收益低。

## Decision: 一次性迁移 + 过渡期薄 wrapper 兼容

启动时若无 `skills-store/`,从现有 `openclaw/users/{code}/skills`、`openclaw/skills`(含预装 marker)、`lock.json` 构建规范库与 manifest,写 `.migrated` 版本标记,随后 `reconcile(全引擎)` 用规范库重建各引擎投影(哈希相同者不动)。`syncClaudeSkillsForAgent` 等旧入口保留为薄 wrapper 转调 `SkillManager.reconcile`,`sto-skill-service.ts` 降级为委托 `SkillManager` 的 facade,保持 API 路由与调用方不变。

Rationale:平滑迁移、避免调用方大改;facade/wrapper 可在后续 change 中逐步下线。

Alternative considered:一刀切替换所有调用方。回归面大、风险高,故分阶段。

# Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| [Risk] 迁移过程中断导致规范库半成品 | 迁移写入临时目录后原子 rename 为 `skills-store/`;`.migrated` 标记仅在完成后写入;失败时保留旧目录,下次启动重试 |
| [Risk] 某引擎投影失败使该引擎缺技能 | best-effort + 每次 reconcile 幂等自愈;记录失败 slug 与引擎便于诊断 |
| [Risk] `.claude/skills/{slug}` 已存在但非 bridge 管理(用户手放) | 沿用现有冲突保护:无 bridge marker 的目录跳过、不覆盖不删除,计入 `skippedConflicts` |
| [Risk] OpenClaw Gateway 未感知投影变化 | 由 `OpenClawSkillAdapter.onAfterBatch` 触发 Gateway 刷新(沿用现有刷新/重启路径),每批一次避免抖动 |
| [Risk] manifest 单文件并发写冲突 | 复用 `withConfigLock` 串行化所有 manifest 写入 |
| [Risk] 迁移后与旧 `lock.json` 读取路径不一致 | 过渡期 `listInstalled`/版本比对优先读 manifest,回退旧 `lock.json`;facade 保持返回结构不变 |

# Documentation

内部主进程架构重构,无用户可见流程或公开接口变化。需按仓库规则复核 `README.md`、`README.zh-CN.md`、`README.ja-JP.md`,仅当其描述了技能安装的内部结构 / 目录布局时才更新。若技能真源目录从 `~/.stoclaw/openclaw/skills` 迁移到 `~/.stoclaw/skills-store`,相关排障说明需同步。
