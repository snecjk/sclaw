# Tasks: `2026-06-08-user-skill-workspace-sync`

> 每项实现完成后勾选；须与对应 `### Requirement:` 名称可追溯。

---

## 1. 基础设施与用户工作区服务

### 1.1 路径工具扩展
- [ ] 1.1.1 在 `electron/utils/paths.ts` 新增 `getOpenClawUserBaseDir(userCode)`、`getOpenClawUserSkillsDir(userCode)`、`getOpenClawUserDisabledDir(userCode)`、`getOpenClawUserLockDir(userCode)`、`getOpenClawUserLockPath(userCode)`
- [ ] 1.1.2 新增 `sanitizeUserCodeForPath(userCode)` 及 `getUserCodeFromSanitizedDirName(dirName)`，处理特殊字符
- [ ] 1.1.3 新增单元测试覆盖特殊字符映射和双向转换

### 1.2 用户工作区核心服务
- [ ] 1.2.1 新建 `electron/services/user-skill-workspace.ts`，实现 `UserSkillWorkspaceService` 类
- [ ] 1.2.2 实现 `getCurrentActiveUserCode(): Promise<string | null>`，从 electron-store 读取
- [ ] 1.2.3 实现 `setCurrentActiveUserCode(userCode): Promise<void>`，写入 electron-store
- [ ] 1.2.4 实现 `ensureUserWorkspace(userCode): Promise<void>`，创建用户目录结构
- [ ] 1.2.5 实现 `syncMountPointToUser(userCode): Promise<void>`，将全局 `skills/`、`skills-disabled/`、`.clawhub/lock.json` 同步回用户目录
- [ ] 1.2.6 实现 `activateUserWorkspace(userCode): Promise<void>`：
  - 保存旧用户数据（如有）
  - 清空挂载点
  - 复制新用户数据到挂载点
  - 调用云端 `GET /agent/v1/skills/plaza/installed`
  - 下载缺失 skills
  - 更新 lock.json
  - 保存新的当前用户
- [ ] 1.2.7 实现 `migrateLegacySkills(userCode): Promise<void>`，将存量全局 skills 迁移到首个登录用户

---

## 2. 安装/卸载服务改造

### 2.1 `StoSkillService` 用户隔离改造
> 引用 Requirement: `StoSkillService` reads and writes skills from the active user workspace
- [ ] 2.1.1 修改 `StoSkillService` 构造函数，增加当前用户代码参数或运行时解析
- [ ] 2.1.2 修改 `install()`：解压到 `users/{userCode}/skills/{slug}/`，再复制到挂载点
- [ ] 2.1.3 修改 `uninstall()`：从用户目录和挂载点同时删除
- [ ] 2.1.4 修改 `updateLockFile()`：同时写入用户 lock 和挂载点 lock
- [ ] 2.1.5 修改 `listInstalled()` 和 `backfillLockVersions()`：扫描用户目录
- [ ] 2.1.6 确保 agent-scoped install（`agentId` 参数）路径逻辑不受影响

### 2.2 `SkillPlazaService` 用户隔离改造
> 引用 Requirement: `SkillPlazaService` local state overlays use the active user workspace
- [ ] 2.2.1 修改 `SkillPlazaService` 读取 `configDir` 和 `skillsDir` 的逻辑，优先使用当前用户工作区
- [ ] 2.2.2 修改 `getInstalledSlugs()` / `getEnabledSlugs()` / `overlayLocalState()` 从用户目录读取
- [ ] 2.2.3 修改 `getLocalSkills()` 从用户目录扫描
- [ ] 2.2.4 修改 `toggleSkillEnabled()` 在用户目录内移动 skill 文件夹，并同步挂载点

---

## 3. 登录/切换流程集成

### 3.1 Auth 路由集成
> 引用 Requirement: Cloud installed list is the source of truth on login
- [ ] 3.1.1 在 `electron/api/routes/auth.ts` 的 login handler 中，调用 `setAuthUser(user)` 之后调用 `UserSkillWorkspaceService.activateUserWorkspace(user.code)`
- [ ] 3.1.2 在 logout handler 中，调用 `UserSkillWorkspaceService.activateUserWorkspace(null)` 或保留当前匿名态（根据产品决策）
- [ ] 3.1.3 处理登录失败/取消场景，确保不触发同步

### 3.2 Gateway 重启与登出集成
> 引用 Requirement: Local skill files are isolated by user code
- [ ] 3.2.1 当 `activateUserWorkspace` 检测到用户变化时，调用 `GatewayManager.restart()`
- [ ] 3.2.2 确保重启前 Gateway 已完全停止，避免 Windows 文件锁
- [ ] 3.2.3 在 `syncMountPointToUser` 中处理 Gateway 停止失败时的降级策略
- [ ] 3.2.4 登出时不清空挂载点，保留最后登录用户的技能集合

---

## 4. 云端 API 集成

### 4.1 新增云端 API 调用
> 引用 Requirement: Install and uninstall operations are reported to the cloud
- [ ] 4.1.1 在 `electron/services/skill-plaza-service.ts`（或新建 client）中实现 `fetchCloudInstalledList(): Promise<string[]>`
- [ ] 4.1.2 实现 `reportSkillInstall(slug)` 调用 `POST /agent/v1/skills/plaza/{slug}/install`
- [ ] 4.1.3 实现 `reportSkillUninstall(slug)` 调用 `POST /agent/v1/skills/plaza/{slug}/uninstall`
- [ ] 4.1.4 将 `recordInstall` 的内部调用改为使用新上报方法（如果一期已实现则复用）

### 4.2 下载恢复流程
> 引用 Requirement: Cloud installed list is the source of truth on login
- [ ] 4.2.1 实现 `downloadSkillForUser(slug, userCode): Promise<void>`，复用 `StoSkillService.install` 的下载逻辑
- [ ] 4.2.2 在 `activateUserWorkspace` 中循环调用下载，处理部分失败情况
- [ ] 4.2.3 记录下载失败日志，下次登录时重试

---

## 5. 前端状态同步

### 5.1 Skill Plaza Store 改造
> 引用 Requirement: Renderer reflects the active user's skill set
- [ ] 5.1.1 在 `src/stores/skill-plaza.ts` 中监听 auth 用户变化（通过订阅或 hook）
- [ ] 5.1.2 用户变化时设置 `loading: true` 并调用 `fetchCategories()` + `fetchPlazaSkills()` + `fetchLocalSkills()`
- [ ] 5.1.3 新增 `syncingUserSkills: boolean` 状态，用于展示同步中 UI

### 5.2 UI 反馈
> 引用 Requirement: Renderer reflects the active user's skill set
- [ ] 5.2.1 在 `src/components/skill-plaza/SkillPlazaPage.tsx` 中增加同步 loading 遮罩
- [ ] 5.2.2 文案使用 i18n：`skills.syncingUserSkills`
- [ ] 5.2.3 对齐 `docs/sto-design.md` loading 状态语义（Grey-8 次要文本 + Brand-6 进度指示）

---

## 6. 存量数据迁移

### 6.1 迁移逻辑
> 引用 Requirement: Legacy global skills are migrated on first activation
- [ ] 6.1.1 在 `UserSkillWorkspaceService` 中实现 `detectLegacyGlobalSkills(): boolean`
- [ ] 6.1.2 在首次 `activateUserWorkspace` 时触发迁移
- [ ] 6.1.3 迁移前备份全局 `skills/` 到 `users/.legacy-backup/skills-{timestamp}/`
- [ ] 6.1.4 迁移时识别 `.stoclaw-preinstalled.json` marker，预安装 skill 保留在全局目录
- [ ] 6.1.5 迁移完成后清空全局目录中的非预安装 skill

---

## 7. 测试与验证

### 7.1 单元测试
- [ ] 7.1.1 为 `sanitizeUserCodeForPath` 和路径工具编写单元测试
- [ ] 7.1.2 为 `UserSkillWorkspaceService` 的核心同步逻辑编写单元测试（使用临时目录）
- [ ] 7.1.3 验证预安装 skill 在切换用户时不被移动或删除
- [ ] 7.1.4 为 `StoSkillService` 和 `SkillPlazaService` 的新路径解析编写单元测试

### 7.2 集成测试
- [ ] 7.2.1 手工验证：账号 A 安装 skill → 切换账号 B → 确认 B 不展示 A 的 skill
- [ ] 7.2.2 手工验证：账号 A 在设备 X 安装 skill → 账号 A 在设备 Y 登录 → 自动下载恢复
- [ ] 7.2.3 手工验证：卸载 skill 后切换设备登录 → 确认 skill 不再恢复
- [ ] 7.2.4 手工验证：存量 skill 升级后首次登录 → 正确迁移到当前用户

### 7.3 工程检查
- [ ] 7.3.1 运行 `pnpm run lint` 并修复问题
- [ ] 7.3.2 运行 `pnpm run typecheck` 并修复类型错误
- [ ] 7.3.3 运行 `pnpm test` 确保现有测试通过
- [ ] 7.3.4 审阅 `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 是否需更新
- [ ] 7.3.5 由于涉及 host-api 路由但无新增通信通道，不需要 `comms:replay`；如涉及 gateway 事件则需补充
