## Why

应用广场（More Apps）里用户自装的外部应用、安装列表与收藏目前只写在渲染进程 `localStorage`。清站点数据、换 Chromium 分区或重装应用后数据常会丢失，与技能/OpenClaw 配置落在 `~/.stoclaw` 可跨重装保留的体验不一致。需要把该清单提升为 Main 拥有的用户资产持久化。

## What Changes

- 将外部应用注册表（`externalApps` / `installedIds` / `favoriteIds`）持久化到 `~/.stoclaw/more-apps/`（JSON），由 Main 读写
- 通过 host-api 暴露 CRUD / 整包读写；Renderer 的 `more-apps` store 改为经 host-api 持久化，不再以 `localStorage` 为真相源
- 首次启动从既有 `localStorage` 键一次性迁移到磁盘，迁移成功后清除旧键
- **不**引入 SQLite；不改变内置应用目录（仍为代码内 `builtin-apps`）

## Capabilities

### New Capabilities

- `more-apps-persistence`: 应用广场用户安装清单（外部应用、已安装 ID、收藏）在 Main 侧持久化到 `~/.stoclaw`，经 host-api 访问，并支持从 localStorage 迁移

### Modified Capabilities

- （无）主规格中尚无应用广场相关 capability

## Impact

- `src/stores/more-apps.ts`、可选 `src/lib/more-apps-api.ts`
- `electron/services/` 或 `electron/utils/` 新增 more-apps 持久化模块
- `electron/api/routes/` 新增路由并在 `electron/api/server.ts` 注册
- 单元测试覆盖读写与迁移合并逻辑
- README 三语：若文档描述应用广场存储，需同步说明落盘路径
