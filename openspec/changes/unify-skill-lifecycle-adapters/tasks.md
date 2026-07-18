# Tasks

## 1. 中立规范库与 manifest

- [x] 1.1 在 `electron/utils/paths.ts` 新增规范库路径:`getSkillsStoreDir`、`getSkillsStoreGlobalDir`、`getSkillsStoreUserSkillsDir(userCode)`、`getSkillsStoreAgentSkillsDir(agentId)`、`getSkillsManifestPath`(Requirement: 技能事实真源位于引擎无关的中立规范库)
- [x] 1.2 新增 `electron/services/skills/canonical-store.ts`:manifest 读写(复用 `withConfigLock` 串行化)、按 scope 解析包目录、增删条目、列出 desired 集合(Requirement: 启用态与技能配置以 manifest 为单一真源)
- [x] 1.3 定义 manifest 数据结构与 scope 分区键(`scope` + `userCode`/`agentId`),并提供读取时对旧 `lock.json` 的回退(Requirement: 技能事实真源位于引擎无关的中立规范库)

## 2. 引擎无关的技能包处理

- [x] 2.1 新增 `electron/services/skills/skill-package.ts`,从 `sto-skill-service.ts` 抽出下载、`extractZip`、`hoistSkillContent`、`ensureSkillFrontmatter`、版本比对等引擎无关逻辑(Requirement: 技能生命周期由单一编排器统管)
- [x] 2.2 保持 SKILL.md frontmatter 规整规则(`name` 小写 slug、`title`、`description`)不变(Requirement: 技能生命周期由单一编排器统管)

## 3. 适配器接口与注册表

- [x] 3.1 新增 `electron/services/skills/adapters/engine-skill-adapter.ts`:定义 `SkillPackage`、`EngineSkillContext`、`ReconcileResult`、`EngineSkillAdapter` 接口与适配器注册表(Requirement: 引擎通过统一适配器接口接入)
- [x] 3.2 实现注册表的孤儿投影清扫:当引擎从注册表移除后,清理其遗留的受管投影目录(Requirement: 引擎通过统一适配器接口接入)

## 4. OpenClaw 适配器

- [x] 4.1 新增 `electron/services/skills/adapters/openclaw-skill-adapter.ts`,实现 `applyInstall/applyUninstall`,把规范库技能投影到 `openclaw/skills` 与用户/agent 运行目录(Requirement: 生命周期变更即时对称下发到所有引擎)
- [x] 4.2 实现 `applyEnabled`:启用移入 `skills/`、禁用移入 `skills-disabled/`,并写 `openclaw.json` 条目;`apiKey/env` 从 manifest 投影到 `openclaw.json`(Requirement: 启用态与技能配置以 manifest 为单一真源)
- [x] 4.3 实现 `reconcile`,并将 `project-agent-service` 的 agent→项目 agent 镜像逻辑并入 agent 级对齐(Requirement: 幂等 reconcile 维持最终一致并处理 agent 级技能)
- [x] 4.4 实现 `onAfterBatch`:每批变更后触发一次 Gateway 刷新(沿用现有刷新/重启路径)(Requirement: 生命周期变更即时对称下发到所有引擎)

## 5. Claude 适配器

- [x] 5.1 新增 `electron/services/skills/adapters/claude-skill-adapter.ts`,收纳 `claude-skill-bridge.ts` 的内容哈希、bridge marker、镜像与孤儿清理逻辑(Requirement: 引擎通过统一适配器接口接入)
- [x] 5.2 实现 `applyInstall/applyUninstall/applyEnabled`(禁用即移除镜像),投影到 `.claude/skills`(Requirement: 生命周期变更即时对称下发到所有引擎)
- [x] 5.3 实现 `reconcile`,保留「非受管目录(无 bridge marker)跳过」的冲突保护,返回 `mirrored/removed/skippedConflicts`(Requirement: 非受管的引擎技能目录受冲突保护)

## 6. 编排器 SkillManager

- [x] 6.1 新增 `electron/services/skills/skill-manager.ts`,实现 `install/update/uninstall/setEnabled/uploadSkill/reconcile`,每次变更后遍历适配器投影(Requirement: 技能生命周期由单一编排器统管)
- [x] 6.2 实现失败语义:规范库写入为事务边界,适配器投影 best-effort,失败记录 slug+引擎、不回滚真源(Requirement: 适配器投影失败不回滚真源并由 reconcile 自愈)
- [x] 6.3 实现 `reconcile(ctx, engines?)` 可限定引擎(Claude 对话前限 `['claude']`)(Requirement: 幂等 reconcile 维持最终一致并处理 agent 级技能)

## 7. 迁移与接线

- [x] 7.1 新增 `electron/services/skills/migration.ts`:从旧 `openclaw/users/{code}/skills`、`openclaw/skills`、`lock.json` 构建规范库与 manifest,写入临时目录后原子 rename,完成写 `.migrated` 标记(Requirement: 一次性迁移现有安装数据到规范库)
- [x] 7.2 在启动流程中调用迁移,迁移后执行一次全引擎 reconcile;已迁移则跳过(Requirement: 一次性迁移现有安装数据到规范库)
- [x] 7.3 将 `sto-skill-service.ts` 降级为委托 `SkillManager` 的薄 facade,保持 `install/uninstall/uploadSkill/listInstalled/backfillLockVersions` 对外签名不变(Requirement: 技能生命周期由单一编排器统管)
- [x] 7.4 将 `claude-skill-bridge.syncClaudeSkillsForAgent` 改为薄 wrapper 转调 `SkillManager.reconcile(ctx, ['claude'])`;`claude-adapter.startClaudeQuery` 保持调用点不变(Requirement: 幂等 reconcile 维持最终一致并处理 agent 级技能)
- [x] 7.5 将 `skill-plaza-service.toggleSkillEnabled` 改为调用 `SkillManager.setEnabled`(Requirement: 启用态与技能配置以 manifest 为单一真源)
- [x] 7.6 将 `user-skill-workspace.activateUserWorkspace` 的手工拷贝挂载改为 `SkillManager.reconcile(全引擎)`(Requirement: 幂等 reconcile 维持最终一致并处理 agent 级技能)
- [x] 7.7 将预装(`ensurePreinstalledSkillsInstalled`)与退役清理(`cleanupRetiredSkillsAndPlugins`)接入编排器的 install/setEnabled/reconcile(Requirement: 生命周期变更即时对称下发到所有引擎)

## 8. 测试与验证

- [x] 8.1 为 `canonical-store` 增加单测:manifest 读写、scope 解析、旧 lock 回退(Requirement: 技能事实真源位于引擎无关的中立规范库)
- [x] 8.2 为各适配器 `reconcile` 增加幂等性单测(第二次无写入)与冲突保护单测(Requirement: 幂等 reconcile 维持最终一致并处理 agent 级技能 / 非受管的引擎技能目录受冲突保护)
- [x] 8.3 为编排器增加 fan-out 单测:某引擎适配器失败时规范库保留、reconcile 自愈(Requirement: 适配器投影失败不回滚真源并由 reconcile 自愈)
- [x] 8.4 为迁移增加 fixture 单测:从旧布局构建规范库、幂等跳过(Requirement: 一次性迁移现有安装数据到规范库)
- [x] 8.5 运行 `pnpm run lint` 并修复问题
- [ ] 8.6 运行 `pnpm run typecheck` 并修复问题
- [x] 8.7 运行 `pnpm test` 并修复相关用例
- [x] 8.8 复核 `README.md`、`README.zh-CN.md`、`README.ja-JP.md`,若描述了技能安装内部结构/目录布局则同步更新

## 9. 技能广场本地态解耦(展示层)

- [x] 9.1 将 `SkillPlazaService.buildLocalStateSnapshot` 改为优先读 `skills-store/manifest.json` + 规范库包目录,OpenClaw 目录仅作迁移前回退(Requirement: 技能广场本地态从规范库读取且不依赖引擎投影目录)
- [x] 9.2 `getLocalSkills` / 办公技能 / 预装本地列表改为通过 snapshot.packageDirs 读取 SKILL.md,不再以 `openclaw/skills` 为唯一根(Requirement: 技能广场本地态从规范库读取且不依赖引擎投影目录)
- [x] 9.3 更新 OpenSpec proposal/design/spec,补充广场解耦决策与验收场景(Requirement: 技能广场本地态从规范库读取且不依赖引擎投影目录)
