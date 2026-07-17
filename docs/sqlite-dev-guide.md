# StoClaw SQLite 开发指南

面向开发者的实操文档：如何在本机安装、启动应用、找到数据库文件、理解表结构、查询 session / 项目数据。

架构与编码规范见 [sqlite-local-db-architecture.md](./sqlite-local-db-architecture.md)。  
**表结构详解**（各表字段、索引、连表）见 **[docs/sqlite/](./sqlite/README.md)**。  
Session catalog 行为规格见 OpenSpec change `session-catalog-sqlite`。

---

## 1. 快速开始

### 1.1 环境要求

- macOS 11+ / Windows 10+ / Ubuntu 20.04+
- Node.js（版本以仓库 `package.json` 的 `engines` 为准）
- **pnpm**（版本由 `packageManager` 字段锁定，使用 corepack）

### 1.2 安装与启动

```bash
# 克隆仓库
git clone http://gitlab.sto.cn/ai-memory/sto-claw.git
cd sto-claw

# 安装依赖 + 下载 uv（首次必做）
pnpm run init

# 开发模式（Vite + Electron，自动拉起 Gateway）
pnpm dev
```

说明：

- `pnpm run init` = `pnpm install` + `pnpm run uv:download`
- SQLite 依赖 **`kysely`**（已在 `package.json` 中声明）。若 `node_modules/kysely` 不存在，主进程无法编译/初始化数据库，需重新执行 `pnpm run init`
- 应用**首次成功启动**后才会创建 `stoclaw.sqlite`

### 1.3 确认数据库已初始化

主进程日志中应出现（启动后数秒内，取决于动态 import 速度）：

```text
[sqlite] initialized file=/Users/<you>/Library/Application Support/stoclaw/sqlite/stoclaw.sqlite journal=wal foreignKeys=false
[session-catalog] registering IPC handler session-catalog:invoke
```

若无 `[sqlite] initialized`：

1. 检查终端是否有 `Could not resolve "kysely"` 或 migration 报错
2. 确认 `pnpm run init` 已完成
3. 完全重启 `pnpm dev`（主进程改动需重启 Electron）

---

## 2. 数据库文件位置

### 2.1 路径规则

```text
{app.getPath('userData')}/sqlite/stoclaw.sqlite
```

| 平台 | 典型 `userData` 目录 |
|------|----------------------|
| macOS | `~/Library/Application Support/stoclaw/` |
| Windows | `%APPDATA%\stoclaw\` |
| Linux | `~/.config/stoclaw/` |

完整示例（macOS，用户 `sto`）：

```text
/Users/sto/Library/Application Support/stoclaw/sqlite/stoclaw.sqlite
```

### 2.2 在 Finder 中打开（macOS）

1. 访达中按 **`Cmd + Shift + G`**
2. 粘贴（不要用 `~`，部分对话框不展开）：

   ```text
   /Users/<你的用户名>/Library/Application Support/stoclaw/sqlite
   ```

3. 应看到 `stoclaw.sqlite`，以及 WAL 伴生文件（应用运行时）：
   - `stoclaw.sqlite-wal`
   - `stoclaw.sqlite-shm`

### 2.3 终端快速验证

```bash
ls -la "$HOME/Library/Application Support/stoclaw/sqlite/"
sqlite3 "$HOME/Library/Application Support/stoclaw/sqlite/stoclaw.sqlite" ".tables"
```

---

## 3. 如何查看数据

### 3.1 DB Browser for SQLite（推荐 GUI）

1. 安装：[DB Browser for SQLite](https://sqlitebrowser.org/dl/)
   - macOS: `brew install --cask db-browser-for-sqlite`
   - 启动: `open -a "DB Browser for SQLite"`
2. **File → Open Database…** → 选择 `stoclaw.sqlite`
3. **Browse Data**：浏览表
4. **Execute SQL**：运行下方示例查询

应用运行时建议**只读**查看；改数据请先退出应用或复制一份 db：

```bash
cp "$HOME/Library/Application Support/stoclaw/sqlite/stoclaw.sqlite" ~/Desktop/stoclaw-copy.sqlite
```

### 3.2 sqlite3 命令行

```bash
DB="$HOME/Library/Application Support/stoclaw/sqlite/stoclaw.sqlite"
sqlite3 "$DB"
```

```sql
.tables
.schema catalog_sessions
```

---

## 4. 代码中的访问边界

```text
Renderer (React)
    │  invokeIpc('session-catalog:invoke', { action, payload })
    ▼
Main IPC (electron/main/ipc/session-catalog-handlers.ts)
    ▼
session-catalog-service (electron/services/session-catalog-service.ts)
    ▼
Repositories (electron/db/repositories/*)
    ▼
Kysely + node:sqlite → stoclaw.sqlite
```

**渲染进程不得**直接打开 SQLite 文件或调用 SQL。

关键源码：

| 用途 | 路径 |
|------|------|
| 连接与迁移 | `electron/db/connection.ts` |
| Migration | `electron/db/migrations/` |
| Session catalog 服务 | `electron/services/session-catalog-service.ts` |
| IPC | `electron/main/ipc/session-catalog-handlers.ts` |
| 渲染层 API | `src/lib/session-catalog-api.ts` |
| Store | `src/stores/session-catalog.ts` |

初始化时机：`electron/main/index.ts` 的 `initialize()` 中，在创建主窗口**之前**执行 `initializeSqliteDatabase()` 并注册 `session-catalog:invoke`。

---

## 5. 表一览

当前 schema 版本：**2**（migrations `0001` + `0002`）。

完整字段、索引、连表说明见 **[docs/sqlite/](./sqlite/README.md)**（每张表独立文档 + ER 图）。

| 表名 | 类型 | 文档 |
|------|------|------|
| `schema_migrations` | 系统 | [schema-migrations.md](./sqlite/schema-migrations.md) |
| `app_demo_records` | 脚手架 | [app-demo-records.md](./sqlite/app-demo-records.md) |
| `workspaces` | **业务** | [workspaces.md](./sqlite/workspaces.md) |
| `session_groups` | 业务（遗留） | [session-groups.md](./sqlite/session-groups.md) |
| `catalog_sessions` | **业务** | [catalog-sessions.md](./sqlite/catalog-sessions.md) |
| `session_engine_bindings` | **业务** | [session-engine-bindings.md](./sqlite/session-engine-bindings.md) |

连表查询示例见 [relationships.md](./sqlite/relationships.md)。

---

## 6. 什么在 SQLite、什么不在

| 数据 | 存储位置 |
|------|----------|
| 项目列表、会话归属项目 | `workspaces` + `catalog_sessions` |
| 侧栏置顶（项目内） | `catalog_sessions.pin_rank` |
| 会话标题（catalog） | `catalog_sessions.title` |
| 工具 cwd（项目） | `session_engine_bindings.cwd` |
| **聊天消息正文** | OpenClaw transcript `.jsonl` |
| **未读红点** | 渲染进程 `stoclaw:session-unread`（内存/localStorage） |
| **发送队列 / runtime** | 渲染进程 Zustand |
| **侧栏最近排序（部分）** | 内存 `sessionLastActivity` + catalog `last_activity_at` |
| 旧版引擎注册表 | `~/.stoclaw/engine-sessions.json`（首次 bootstrap 可导入 bindings） |

---

## 7. 常用 SQL

### 7.1 所有表

```sql
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
```

### 7.2 项目列表

```sql
SELECT id, name, root_path, created_at, updated_at
FROM workspaces
WHERE deleted_at IS NULL AND is_default = 0;
```

### 7.3 会话 + 项目联查

```sql
SELECT
  cs.session_key,
  cs.title,
  cs.pin_rank,
  cs.created_at,
  cs.updated_at,
  cs.last_activity_at,
  w.name AS project_name,
  w.root_path
FROM catalog_sessions cs
LEFT JOIN workspaces w ON w.id = cs.workspace_id
WHERE cs.deleted_at IS NULL
ORDER BY cs.last_activity_at DESC;
```

### 7.4 引擎绑定与 cwd

```sql
SELECT session_key, engine_type, agent_id, cwd, created_at, updated_at
FROM session_engine_bindings
WHERE deleted_at IS NULL
ORDER BY updated_at DESC;
```

### 7.5 某 session 完整信息

```sql
SELECT cs.*, seb.engine_type, seb.cwd, w.name AS project_name
FROM catalog_sessions cs
LEFT JOIN session_engine_bindings seb ON seb.session_key = cs.session_key
LEFT JOIN workspaces w ON w.id = cs.workspace_id
WHERE cs.session_key = 'agent:main:你的会话key'
  AND cs.deleted_at IS NULL;
```

### 7.6 Migration 版本

```sql
SELECT * FROM schema_migrations ORDER BY version;
```

---

## 8. PRAGMA 与 WAL

启动时设置（见 `electron/db/pragmas.ts`）：

| PRAGMA | 值 | 说明 |
|--------|-----|------|
| `journal_mode` | WAL | 写前日志；会有 `-wal` / `-shm` 文件 |
| `foreign_keys` | OFF | 当前未强制外键 |
| `busy_timeout` | 5000 ms | 锁等待 |
| `synchronous` | NORMAL | 性能与安全折中 |

---

## 9. 新增表 / Migration 流程（开发者）

1. 在 `electron/db/migrations/` 新增 `000N-*.ts`，版本号递增
2. 在 `electron/db/migrations/index.ts` 注册
3. 在 `electron/db/models/tables/`、`domain/`、`dto/` 补充类型
4. 在 `electron/db/types.ts` 的 `SqliteDbSchema` 注册表名
5. 实现 `electron/db/repositories/*`
6. 业务编排放在 `electron/services/*`
7. 重启应用 → migration 自动执行 → 检查 `schema_migrations`

勿手改生产库 schema；以 migration 为唯一真相来源。

---

## 10. 故障排查

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 找不到 `stoclaw.sqlite` | 应用未成功启动过；路径用了 `~` | 用绝对路径；先 `pnpm dev` 启动一次 |
| `No handler registered for session-catalog:invoke` | 主进程未编译/未注册 IPC | 修 build 错误后重启；看 `[session-catalog] registering` 日志 |
| `Could not resolve "kysely"` | 依赖未安装 | `pnpm run init` |
| DB Browser 里表是空的 | 看错文件；WAL 未合并 | 确认路径；应用运行时用 Execute SQL 查询 |
| `catalog_sessions` 无某 session | 尚未 bind / 移入项目 | 侧栏操作后会写入；或仅有 `session_engine_bindings` 行 |

---

## 11. 相关文档

- [sqlite/README.md](./sqlite/README.md) — **表结构目录**（字段、索引、关系、连表 SQL）
- [sqlite-local-db-architecture.md](./sqlite-local-db-architecture.md) — 架构规范与 Repository 约定
- [AGENTS.md](../AGENTS.md) — 工程命令与红线
- [README.md](../README.md) / [README.zh-CN.md](../README.zh-CN.md) — 项目总览与安装
- OpenSpec `openspec/changes/session-catalog-sqlite/` — Session catalog 功能规格
- OpenSpec `openspec/changes/archive/2026-07-11-sqlite-dev-guide/` — 开发指南变更记录（已归档）
