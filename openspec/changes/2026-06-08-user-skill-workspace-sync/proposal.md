## Why

当前 StoClaw 所有登录用户的技能文件共享同一个本地目录 `~/.stoclaw/openclaw/skills/` 和同一个 `~/.stoclaw/openclaw/.clawhub/lock.json`。这导致切换账号时出现数据交叉：

- 账号 A 从技能广场安装的技能，在退出并登录账号 B 后仍然展示在「我的技能」Tab 中
- Gateway 启动时扫描的技能集合不会因为当前登录用户变化而变化
- 同一台设备被多个工号使用时，存在技能和配置泄露风险

后端已经提供了「用户技能安装同步」API（`20260605_user_skill_installs` 迁移 + `/agent/v1/skills/plaza/installed` 等接口），客户端需要把这些远程记录与本地文件系统按用户工号隔离开，实现真正的「换号换 skill」。

## What Changes

- **用户维度技能工作区**：在本地磁盘按 `user.code`（工号）拆分技能目录，每个用户拥有独立的 `skills/`、`skills-disabled/` 和 `.clawhub/lock.json`
- **挂载点机制**：Gateway 仍然扫描固定的 `~/.stoclaw/openclaw/skills/` 目录，但该目录只是「当前激活用户」的挂载点；切换账号时把新用户的工作区内容同步到挂载点
- **登录/切换同步**：登录成功后，根据当前 `user.code` 调用云端 `GET /agent/v1/skills/plaza/installed`，把缺失的技能通过 `GET /agent/v1/skills/slug/{slug}/download` 恢复到本地；卸载时调用 `POST .../uninstall` 并从本地和云端同时删除记录
- **安装/卸载流程改造**：`StoSkillService.install/uninstall` 和 `SkillPlazaService` 的本地状态读写全部以当前用户工作区为真实来源，同时保持挂载点与 Gateway 可见目录一致
- **Gateway 重启**：切换用户工作区后触发 Gateway 重启，使运行时加载的技能集合与当前用户一致
- **存量数据迁移**：首次启用该能力时，如果全局 `skills/` 非空但 `users/` 为空，将存量技能归属给当前登录用户（若未登录则保持原状直到登录）

## Capabilities

### New Capabilities
- `skills-user-workspace-sync`：按用户工号隔离本地技能文件，并在登录/切换/安装/卸载时保持与云端安装记录一致

### Modified Capabilities
- `skills-plaza-api` / `skills-plaza-marketplace` / `skills-plaza-local-skills`：本地技能扫描、安装、卸载、启用/禁用以当前用户工作区为准
- `service-skill-install`（`StoSkillService`）：install / uninstall / listInstalled / backfillLockVersions 使用用户隔离路径
- `service-skill-plaza`（`SkillPlazaService`）：本地状态读取/overlay、安装计数上报、详情查询使用用户隔离路径
- `auth-session-management`：登录成功后触发用户技能工作区激活与云端同步

## Impact
- `electron/utils/paths.ts`：新增 `getOpenClawUserSkillsDir(userCode)`、`getOpenClawUserDisabledDir(userCode)`、`getOpenClawUserLockPath(userCode)` 等工具函数
- `electron/services/user-skill-workspace.ts`（新建）：用户工作区激活、同步、迁移的核心服务
- `electron/services/sto-skill-service.ts`：install / uninstall / listInstalled / backfillLockVersions / updateLockFile 使用当前用户工作区
- `electron/services/skill-plaza-service.ts`：本地扫描、状态 overlay、toggleSkillEnabled 使用当前用户工作区
- `electron/api/routes/auth.ts`：登录成功后调用用户技能同步；登出时清理挂载点或切换到匿名态
- `electron/api/routes/skill-plaza.ts`：安装/卸载/本地扫描路由保持 API 不变，内部委托改为用户工作区
- `src/stores/skill-plaza.ts` / `src/stores/auth.ts`：登录/用户变化时触发 plaza / local-skills 刷新，并展示同步 loading
- Gateway：切换用户后需要一次重启以加载新的技能集合

## Out of Scope
- 不修改 Gateway 的 skills 扫描路径（仍然使用 `OPENCLAW_STATE_DIR/skills/`）
- 不按用户隔离 OpenClaw 的 agents、sessions、extensions、providers 等状态（仅隔离 skills 和 lock.json）
- 不修改 `package.json`、构建脚本、CI/CD、lockfile
- 不实现技能版本升级/增量更新机制
