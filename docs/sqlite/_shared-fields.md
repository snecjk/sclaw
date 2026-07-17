# 共享字段约定

StoClaw SQLite 业务表（`app_demo_records` 及 session catalog 相关表）遵循统一列约定。Migration 定义见 `electron/db/migrations/`。

以下字段在多张表中重复出现，各表文档中的「字段详解」会引用本节。

---

## 时间戳字段

| 列 | 中文名 | 类型 | 可空 | 说明 |
|----|--------|------|------|------|
| `created_at` | 创建时间 | `TEXT` | 否 | 记录首次插入数据库的时刻 |
| `updated_at` | 更新时间 | `TEXT` | 否 | 记录最后一次被修改的时刻 |
| `deleted_at` | 删除时间 | `TEXT` | 是 | 软删除标记；`NULL` 表示仍活跃 |

### `created_at` — 创建时间

- **格式**：UTC ISO8601，如 `2026-07-11T09:30:00.000Z`
- **写入**：insert 时由 Repository 调用 `new Date().toISOString()` 生成
- **不变性**：创建后通常不再修改

### `updated_at` — 更新时间

- **格式**：同 `created_at`
- **写入**：每次 update / upsert / softDelete 时刷新为当前时间
- **用途**：列表按最近变更排序、排查数据新鲜度

### `deleted_at` — 删除时间

- **含义**：软删除，行仍保留在表中
- **查询约定**：业务查询必须 `WHERE deleted_at IS NULL`
- **与硬删区别**：Repository 提供 `hardDelete` 会物理删除行（仅演示表等少数场景）

---

## 乐观锁与审计字段

| 列 | 中文名 | 类型 | 可空 | 默认值 | 说明 |
|----|--------|------|------|--------|------|
| `version` | 版本号 | `INTEGER` | 否 | `1` | 每次更新 +1，乐观锁 |
| `created_by` | 创建者 | `TEXT` | 是 | `NULL` | 谁创建了该行 |
| `updated_by` | 更新者 | `TEXT` | 是 | `NULL` | 谁最后修改了该行 |

### `version` — 版本号

- **约束**：`CHECK (version > 0)`，默认 `1`
- **更新**：Repository update 时执行 `version = version + 1`
- **用途**：预留并发冲突检测，当前 UI 未向用户展示

### `created_by` / `updated_by` — 审计

- **含义**：可选的操作者标识（DTO 中的 `actor` 字段）
- **现状**：多数代码路径传 `NULL`，为后续多用户/审计预留

---

## 布尔值

布尔列使用 `INTEGER`，`CHECK (col IN (0, 1))`：

| 存储值 | 含义 |
|--------|------|
| `0` | false |
| `1` | true |

示例：`workspaces.is_default`（是否默认工作区）。

---

## JSON 列

可变结构数据存为 `TEXT`，并校验 JSON 合法性：

```sql
some_json TEXT CHECK (some_json IS NULL OR json_valid(some_json))
```

- **写入**：`JSON.stringify(object)` 或 `NULL`
- **读取**：`JSON.parse` 为 TypeScript 对象
- **使用表**：`app_demo_records.payload_json`、`session_engine_bindings.extra_json`

---

## 枚举

状态类字段使用 `TEXT NOT NULL CHECK (...)` 限制取值，例如：

```sql
status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'))
```

引擎类型 `engine_type` 在应用层约束为 `openclaw | claude`（DB 层无 CHECK）。

---

## 主键策略

| 策略 | 使用表 |
|------|--------|
| 单列 `TEXT PRIMARY KEY`（UUID） | `workspaces`, `session_groups`, `app_demo_records` |
| 复合主键 | `catalog_sessions (workspace_id, session_key)` |
| 单列业务键 | `session_engine_bindings.session_key` |
| 整数版本号 | `schema_migrations.version` |

内置常量：`workspaces.id = 'default'` 为默认工作区（侧栏「最近」会话归属，不在项目列表展示）。
