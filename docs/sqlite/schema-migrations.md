# schema_migrations

Migration 执行记录表，由 `electron/db/migrator.ts` 自动维护。

---

## 用途

- 记录已应用到 `stoclaw.sqlite` 的 schema 版本
- 应用启动时对比 migration 列表，执行未应用的 SQL
- **勿手动插入或删除**，除非在做灾难恢复

---

## 字段一览

| 列 | 中文名 | 类型 | 可空 | 默认值 | 说明 |
|----|--------|------|------|--------|------|
| `version` | 版本号 | `INTEGER` | 否 | — | 主键，与 migration 文件 `version` 一致 |
| `name` | 迁移名称 | `TEXT` | 否 | — | 人类可读的 migration 标识 |
| `applied_at` | 执行时间 | `TEXT` | 否 | — | 该版本 SQL 成功执行的时刻 |

---

## 字段详解

### `version` — 版本号

- **含义**：Schema 的单调递增版本号，每个 migration 文件对应一个整数。
- **主键**：不可重复；已存在的版本不会再次执行。
- **当前值**：`1`（demo schema）、`2`（session catalog schema）、`3`（session types & channels）。
- **对应文件**：`electron/db/migrations/000N-*.ts` 中的 `version` 字段。

### `name` — 迁移名称

- **含义**：描述该次 migration 做了什么，便于排查与日志对照。
- **示例**：
  - `initial-local-sqlite-demo-schema`
  - `session-catalog-schema`
- **约束**：`NOT NULL`，与 migration 定义中的 `name` 一致。

### `applied_at` — 执行时间

- **含义**：该 migration 的 SQL 在本机数据库上成功执行完成的时间。
- **格式**：UTC ISO8601 字符串。
- **写入时机**：`migrator` 在事务中执行 SQL 后立即 insert 本行。

---

## 索引

无额外索引（主键即 `version`）。

---

## 当前版本

| version | name | 引入的表 |
|---------|------|----------|
| 1 | `initial-local-sqlite-demo-schema` | `schema_migrations`, `app_demo_records` |
| 2 | `session-catalog-schema` | `workspaces`, `session_groups`, `catalog_sessions`, `session_engine_bindings` |
| 3 | `session-types-and-channels` | `catalog_sessions.session_type/task_id/app_id/channel_type/channel_id`, `session_engine_bindings.provider` |

---

## 常用查询

```sql
SELECT * FROM schema_migrations ORDER BY version;
```

---

## 相关源码

- `electron/db/migrations/0001-initial-schema.ts`
- `electron/db/migrations/0002-session-catalog-schema.ts`
- `electron/db/migrations/0003-session-types-and-channels.ts`
- `electron/db/migrations/index.ts`
- `electron/db/migrator.ts`
