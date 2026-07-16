## Context

应用广场外部应用清单目前由 `src/stores/more-apps.ts` 直接读写 `localStorage`（`stoclaw:more-apps:*`）。Renderer 生命周期与 Chromium 分区绑定，清站点数据或重装后易丢。技能与 OpenClaw 配置已落在 `~/.stoclaw/`，重装 App 通常仍保留。本变更把 More Apps 用户资产对齐到同一用户目录，并由 Main + host-api 拥有真相源。

## Goals / Non-Goals

**Goals:**

- Main 将 `externalApps` / `installedIds` / `favoriteIds` 持久化到 `~/.stoclaw/more-apps/apps.json`
- Renderer 经 host-api 读写，禁止页面内直接 `ipcRenderer.invoke`
- 一次性从 localStorage 迁移；成功后清除旧键
- 重启与重装 App（不删 `~/.stoclaw`）后清单仍在

**Non-Goals:**

- 不上 SQLite；不做云同步
- 不做按登录账号分桶（后续可加；本期机级共享清单）
- 不改变内置应用目录与 UI 主题
- 不级联删除 embed 会话（`catalog_sessions.app_id`）

## Decisions

### 1. 落盘路径：`~/.stoclaw/more-apps/apps.json`

- **Rationale**：与技能/OpenClaw 同属用户资产；比默认 `electron-store`（Application Support）更能扛「重装清 userData」。
- **Alternative**：默认 electron-store → 抗缓存但抗重装弱；SQLite `userData/sqlite` → 过重且路径仍偏 App 数据目录。

### 2. 存储形态：单 JSON 文件 + Main 服务模块

- **Rationale**：数据量小（URL 书签列表），整包读写即可；实现简单，易备份/人工查看。
- **Alternative**：electron-store `cwd: ~/.stoclaw/more-apps` → 也可，但多一层依赖配置；本期直接 `fs` 读写更直观。
- Schema：
  ```ts
  {
    version: 1,
    externalApps: AppItem[],
    installedIds: string[],
    favoriteIds: string[]
  }
  ```

### 3. API：整包 GET/PUT `/api/more-apps`

- **Rationale**：store 每次变更已是整包写；一个 GET（启动 hydrate）+ PUT（任意变更后保存）足够，避免细粒度 CRUD 膨胀。
- **Alternative**：细粒度 add/update/remove 路由 → 更 REST，但对当前 Zustand 同步写模式无额外收益。
- Renderer：`src/lib/more-apps-api.ts` 封装 `hostApiFetch`；store 在 hydrate 后异步写回。

### 4. 迁移：Renderer 上报 localStorage 载荷，Main 合并

- **Rationale**：Main 读不到 renderer localStorage；由 Renderer 在首次 hydrate 时 `POST /api/more-apps/migrate` 带上三键内容。若磁盘已有非空数据，以磁盘为准、不覆盖；若磁盘为空则写入迁移数据并返回结果，Renderer 再清 localStorage。
- **Alternative**：只迁移到 electron-store → 不符合抗重装目标。

### 5. 卸载外部应用与会话

- **Rationale**：本期不删 `catalog_sessions`；产品可后续再定。卸载/删除仅更新 apps.json。

## Risks / Trade-offs

- **[Risk]** hydrate 完成前用户操作导致写空包覆盖 → Mitigation：store 增加 `hydrated` 标志；未 hydrate 禁止 PUT；UI 可短暂用空列表。
- **[Risk]** 迁移与磁盘并发 → Mitigation：migrate 在 Main 内串行；磁盘非空则 skip 写。
- **[Risk]** 用户手动删 `~/.stoclaw` → Mitigation：接受（与技能一致）；无法防护。
- **[Risk]** 多窗口同时写 → Mitigation：整包 PUT 后写盘；可接受 last-write-wins（单用户桌面）。

## Migration Plan

1. 发布含 host-api + 磁盘路径的版本
2. 用户打开应用广场或 App 启动时 hydrate：`GET /api/more-apps`
3. 若 Renderer 仍有 localStorage 且磁盘为空 → `POST migrate` → 清 localStorage
4. 回滚：旧版本仍只读 localStorage（已清则空）；磁盘文件保留不影响旧版

## Open Questions

- 无（账号隔离留后续）
