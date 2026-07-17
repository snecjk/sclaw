## Context

StoClaw 在 Main Process 使用 `node:sqlite` + Kysely，数据库文件位于 Electron `userData/sqlite/stoclaw.sqlite`。Session catalog（项目、会话归属、置顶、引擎绑定）是 v2 migration 的主要业务。渲染进程通过 `session-catalog:invoke` IPC 访问，不直接读库。

已有 `docs/sqlite-local-db-architecture.md` 偏架构规范；本变更补充**开发者实操手册**。

## Goals / Non-Goals

**Goals:**

- 一条命令链：clone → init → dev → 确认 DB 已创建
- macOS / Windows / Linux 的 `userData` 路径说明（含 Finder `Cmd+Shift+G` 技巧）
- 7 张表职责、关键字段、表间关系
- 常用 SQL 与 [DB Browser for SQLite](https://sqlitebrowser.org/about/) 使用说明
- 明确「什么在 SQLite、什么不在」

**Non-Goals:**

- 不新增 UI 内的数据库浏览器
- 不修改 migration 或表结构
- 不替代 OpenSpec `session-catalog-sqlite` 行为规格

## Decisions

### 1. 文档落点 `docs/sqlite-dev-guide.md`

**选择**：独立开发指南，架构文档保留规范职责。

**备选**：全部合并进 `sqlite-local-db-architecture.md` — 单文件过长，查阅不便。

### 2. 路径用绝对路径示例 + `userData` 规则

**选择**：文档写 `app.getPath('userData')/sqlite/stoclaw.sqlite`，并给出 macOS 实例子路径；强调 Finder 中 `~` 可能无效，应用 `Cmd+Shift+G`。

**[Risk]** 不同打包名导致 `userData` 目录名差异 → **Mitigation**：说明以 `productName` / 日志 `[sqlite] initialized file=...` 为准。

### 3. WAL 模式说明

**选择**：文档注明存在 `-wal` / `-shm` 伴生文件，应用运行时可只读查看。

## Risks / Trade-offs

- [Risk] 文档与 migration 漂移 → Mitigation：表结构以 `electron/db/migrations/*.ts` 为源码真相，文档引用 migration 版本号
- [Risk] `kysely` 未安装导致主进程无法初始化 SQLite → Mitigation：文档写明 `pnpm run init` 必须完成且 `node_modules/kysely` 存在
