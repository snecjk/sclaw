## Context

技能广场一期已经把「安装/卸载」流程对接到了云端，并在 `SkillPlazaService` 中调用 `POST /agent/v1/skills/plaza/{slug}/install` 做安装上报。但一期明确把「跨设备同步 / 云端技能状态」列为 Out of Scope，因此本地文件仍然使用全局目录。现在后端已经补全了 `user_skill_installs` 表和 `GET /agent/v1/skills/plaza/installed` 接口，客户端需要完成「按用户隔离本地文件 + 登录同步」这一最后一块拼图。

## Goals / Non-Goals

**Goals:**
- 账号 A 安装的技能在本地文件系统中与账号 B 完全隔离
- 切换账号后，UI 和 Gateway 加载的技能集合只包含当前账号已安装的技能
- 新设备/新账号登录后，能自动从云端 installed 列表恢复历史安装
- 安装/卸载操作同时更新本地用户工作区和云端记录
- 存量技能（升级前已存在的全局 skills）平滑迁移到当前登录用户

**Non-Goals:**
- 不隔离 agents、sessions、extensions、providers、openclaw.json 等其他 OpenClaw 状态
- 不改写 Gateway 扫描逻辑，仍然依赖固定 `skills/` 目录
- 不做实时双向同步（只保证登录/安装/卸载三个时点的同步）
- 不做离线冲突解决（离线安装的技能在下次登录时会通过 installed 列表和本地状态自动对齐）

## Decisions

### 1. 用户工作区目录结构：每个用户独立 `skills/` + `skills-disabled/` + `lock.json`
- **Decision**: 在 `~/.stoclaw/openclaw/users/{userCode}/` 下为每个用户保存完整的技能状态副本，包含 `skills/`、`skills-disabled/`、`.clawhub/lock.json`。Gateway 可见的 `~/.stoclaw/openclaw/skills/` 等路径作为当前激活用户的挂载点。
- **Rationale**:
  - 对 Gateway 零侵入，不需要改 OpenClaw 代码或启动参数
  - `lock.json` 与 skills 目录同生命周期，避免跨用户时 lock 记录混乱
  - 文件系统隔离最彻底，不会出现权限交叉或数据残留
- **Alternative considered**:
  - 在单一全局目录下通过命名空间子目录（`skills/{userCode}/{slug}/`）。拒绝，因为 Gateway 会直接把 `{userCode}` 当成 skill slug 扫描进去，破坏运行时。
  - 使用符号链接把 `skills/` 指向当前用户目录。拒绝，Windows 对目录符号链接需要开发者模式或管理员权限，生产环境不稳定；硬链接不能用于目录。

### 2. 同步策略：全量替换挂载点 + 云端 installed 列表补全
- **Decision**: 切换账号时，先把旧用户的挂载点内容同步回 `users/{oldUserCode}/`，然后清空挂载点，再把新用户的 `users/{newUserCode}/` 全量复制到挂载点；最后调用云端 `GET .../installed`，对缺失 slug 调用 download API 补齐。
- **Rationale**:
  - 全量替换实现最简单，不容易出现文件残留
  - 以云端 installed 列表为权威来源，确保本地不会多展示已卸载技能
  - 技能包体积通常较小（MB 级别），全量复制可接受
- **Alternative considered**:
  - 增量同步（只 diff 差异）。拒绝，当前技能数量少，增量带来的复杂度超过收益；未来数据量大时可以再优化。
  - 不清空挂载点，而是直接按云端列表过滤展示。拒绝，Gateway 仍然会把本地所有 skill 加载进运行时，无法真正隔离。

### 3. 用户识别：使用 `SsoUserInfo.code`（工号）作为命名空间
- **Decision**: 本地目录名使用 `SsoUserInfo.code`，与后端 `user_skill_installs.user_code` 保持一致。
- **Rationale**:
  - 接口文档明确使用 `UserPermission.code`（stoToken 中的 `Code`）作为用户标识
  - `code` 在 SSO 信息中稳定存在，且与后端表结构一致
- **Risk**: 如果某些测试账号的 `code` 包含特殊字符（如 `/`、`.`），会导致目录创建失败
- **Mitigation**: 对 `code` 做路径安全化（URL-safe base64 或替换非法字符）后再作为目录名；同时保留原始 `code` 到 `user-code.txt` 元数据中便于排查。

### 4. 当前用户状态持久化：使用独立的 electron-store
- **Decision**: 新增一个 `user-skill-workspace` 的 electron-store，持久化 `currentUserCode` 和 `lastSyncedAt`。
- **Rationale**:
  - 需要知道「上一次激活的是哪个用户」才能在切换时把旧用户数据同步回去
  - 不能依赖 `auth-store` 中的 user，因为进程重启后需要先恢复挂载点，再等待 auth status 检查完成
- **Alternative considered**:
  - 用文件标记（如 `~/.stoclaw/openclaw/.current-user-code`）。拒绝，electron-store 提供原子写入和 JSON Schema，更安全。

### 5. 安装/卸载写路径：同时更新用户目录和挂载点
- **Decision**: `StoSkillService.install()` 先把 ZIP 解压到 `users/{userCode}/skills/{slug}/`，然后复制到 `skills/{slug}/`；`updateLockFile` 同时写入用户 lock 和挂载点 lock。卸载同理。
- **Rationale**:
  - 避免每次操作都走一次完整的「激活用户工作区」流程
  - 保持挂载点与用户目录实时一致，Gateway 随时重启都能看到最新状态
- **Alternative considered**:
  - 只写入用户目录，在需要时重新激活。拒绝，安装后通常会立即触发 Gateway restart，必须保证挂载点已是最新。

### 6. 预安装技能：所有用户共享，不进入用户工作区
- **Decision**: 应用内置/预安装技能（通过 `preinstalled-manifest.json` 部署、带有 `.stoclaw-preinstalled.json` marker）不放入 `users/{userCode}/skills/`，而是继续保留在全局 `skills/` 下；切换用户时只替换非预安装技能，预安装技能保持始终挂载。
- **Rationale**:
  - 预安装技能是应用自带能力，与「用户从广场下载」的 skill 性质不同，应当所有账号共享
  - 避免每个用户重复复制预安装 skill，减少磁盘占用和同步时间
  - Gateway 仍然会扫描到预安装 skill，但 SkillPlazaService 在展示时通过 marker 识别并标记为 `source: 'official'` / `installed: true`
- **Alternative considered**:
  - 每个用户独立复制预安装技能。拒绝，增加磁盘占用且无业务收益。

### 7. 登出处理：保持最后一个用户的挂载点
- **Decision**: 用户登出时不清空 `skills/` 挂载点，保留最后登录用户的技能集合；下次登录新账号时再执行切换同步。
- **Rationale**:
  - 登出通常是临时操作，用户可能很快重新登录同一账号，清空会导致不必要的重新同步
  - 新账号登录时会强制重新挂载，不会产生数据交叉
- **Alternative considered**:
  - 登出时清空挂载点。拒绝，会让同一账号重新登录时无意义地重新复制 skill 文件。

### 8. 存量数据迁移：首次启用时归属当前登录用户
- **Decision**: 在 `activateUserSkillWorkspace` 首次运行时检测：如果 `users/` 目录为空且全局 `skills/` 非空，则将全局 `skills/`、`skills-disabled/`、`.clawhub/lock.json` 整体迁移到 `users/{currentUserCode}/`，然后清空全局目录并重新挂载。预安装技能在迁移时识别 marker 并保留在全局目录，不归入用户目录。
- **Rationale**:
  - 老用户在升级后不会丢失已安装技能
  - 未登录时的状态也保持一致（如果未登录，暂时保留全局目录，等登录后再迁移）
- **Alternative considered**:
  - 把所有存量技能移动到「公共池」并在每个用户激活时复制。拒绝，会浪费磁盘空间且无法确定哪些 skill 属于哪个用户。
  - 弹窗让用户手动选择归属。拒绝，增加交互复杂度，对于单用户场景没有价值。

### 9. Gateway 重启时机：用户切换后强制重启一次
- **Decision**: 当 `activateUserSkillWorkspace` 检测到 `currentUserCode` 发生变化并成功同步挂载点后，调用 `GatewayManager.restart()`。
- **Rationale**:
  - Gateway 在启动时扫描 `skills/` 目录并缓存 skill 元数据，运行时不会动态感知目录变化
  - 只有重启才能让新的 skill 集合生效
- **Risk**: 切换账号时 Gateway 重启需要 10-30s，期间对话等功能不可用
- **Mitigation**: 前端显示「正在切换工作区，请稍候」；未来可以评估 Gateway 热重载能力，但不在本期范围。

### 8. 云端同步失败的处理：本地优先，失败时记录待同步状态
- **Decision**: 安装/卸载的本地文件操作和调用云端 API 分为两步。本地文件操作成功后即使云端 API 失败也视为操作成功，并记录 `pendingCloudSync` 状态，下次登录时重试。
- **Rationale**:
  - 不能因为网络抖动导致用户无法安装/卸载技能
  - 以云端 installed 列表为最终权威来源，下次登录时会自动对齐
- **Alternative considered**:
  - 强一致性：本地和云端必须同时成功。拒绝，会降低可用性，且网络异常时用户体验差。

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| 切换账号时同步耗时，大 skill 包复制慢 | 异步执行 + 前端进度提示；未来可优化为增量同步 |
| Windows 文件锁导致替换挂载点失败 | 切换前确保 Gateway 已停止；使用 robust-copy（重试 + 临时目录原子替换） |
| 多设备场景下一端卸载，另一端本地仍保留 | 登录时以云端 installed 列表为准，本地多余 skill 只保留在用户目录但不挂载 |
| 用户 code 变化（如员工转岗换号）导致 skill 找不到 | code 作为目录名，换号后视为新用户；原 skill 仍保留在旧用户目录中 |
| 预安装 skill 被误判为某用户专属 | 迁移时通过 `.stoclaw-preinstalled.json` marker 识别并保留在全局目录 |
| 登出后挂载点仍保留旧用户数据 | 新用户登录时会强制清空并重新挂载，不会产生展示交叉 |
| 未登录时（匿名态）的技能状态 | 保持现有行为：使用全局 `skills/` 目录；登录后立即迁移 |

## UI / UX Notes

- 登录成功后，技能广场页面在同步期间显示「正在同步您的技能…」遮罩或进度条
- 切换账号后，侧边栏 Skills 入口在 Gateway 重启完成前保持禁用或显示连接中状态
- 安装/卸载操作保持现有 Toast 反馈，不新增额外提示
