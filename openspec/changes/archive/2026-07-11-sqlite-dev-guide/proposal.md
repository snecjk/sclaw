## Why

Session catalog 已落地 SQLite（`stoclaw.sqlite`），但缺少一份面向开发者的实操文档：如何安装依赖、启动应用、定位数据库文件、查看表结构、理解各表职责与常用 SQL。新人或联调时容易在路径、`~` 展开、WAL 文件、IPC 边界上踩坑。

## What Changes

- 新增 `docs/sqlite-dev-guide.md`：SQLite 开发指南（安装、启动、路径、工具、表说明、查询示例、边界）
- 在 `docs/sqlite-local-db-architecture.md` 增加指向开发指南的链接
- 不修改运行时 schema 或业务逻辑

## Capabilities

### New Capabilities

- `sqlite-dev-documentation`: 维护 StoClaw SQLite 本地库的开发文档（路径、表、查询、调试）

### Modified Capabilities

（无 — 仅文档，不改变产品行为）

## Impact

- 文档：`docs/sqlite-dev-guide.md`、`docs/sqlite-local-db-architecture.md`（交叉引用）
- 代码：无
- 依赖：无
