# app_demo_records

SQLite 脚手架演示表，用于验证 Kysely + Repository + Migration 链路。**与 StoClaw 业务功能无关**，新功能请勿依赖此表。

---

## 用途

- 首版 migration（`0001`）的 CRUD 示例
- 参考 `electron/db/repositories/demo-record-repository.ts` 的标准 Repository 写法

---

## 字段一览

| 列 | 中文名 | 类型 | 可空 | 默认值 | 说明 |
|----|--------|------|------|--------|------|
| `id` | 记录 ID | `TEXT` | 否 | — | 主键，UUID |
| `name` | 名称 | `TEXT` | 否 | — | 演示记录名称 |
| `description` | 描述 | `TEXT` | 是 | `NULL` | 可选说明文字 |
| `status` | 状态 | `TEXT` | 否 | `'active'` | `active` 或 `inactive` |
| `payload_json` | 扩展 JSON | `TEXT` | 是 | `NULL` | 任意 JSON 扩展数据 |
| `created_at` | 创建时间 | `TEXT` | 否 | — | 记录创建时刻 |
| `updated_at` | 更新时间 | `TEXT` | 否 | — | 最近修改时刻 |
| `deleted_at` | 删除时间 | `TEXT` | 是 | `NULL` | 软删除 |
| `version` | 版本号 | `INTEGER` | 否 | `1` | 乐观锁 |
| `created_by` | 创建者 | `TEXT` | 是 | `NULL` | 审计字段 |
| `updated_by` | 更新者 | `TEXT` | 是 | `NULL` | 审计字段 |

领域模型映射：`DemoRecord`（`payload_json` → `payload` 对象）。

---

## 字段详解

### `id` — 记录 ID

- **含义**：演示行唯一标识。
- **生成**：`randomUUID()`。

### `name` — 名称

- **含义**：演示数据的主标题，列表展示用。
- **约束**：`NOT NULL`。

### `description` — 描述

- **含义**：可选的补充说明。
- **可空**：未填写时为 `NULL`。

### `status` — 状态

- **含义**：演示用的简单状态机。
- **枚举**：`active`（默认）、`inactive`
- **约束**：`CHECK (status IN ('active', 'inactive'))`
- **索引**：`idx_app_demo_records_status` 支持按状态筛选。

### `payload_json` — 扩展 JSON

- **含义**：演示如何存储半结构化数据。
- **约束**：`json_valid` 校验。
- **示例**：

```json
{ "module": "demo", "tags": ["sqlite", "crud"] }
```

### `created_at` / `updated_at` / `deleted_at`

- 标准时间戳字段，见 [_shared-fields.md](./_shared-fields.md)。
- **`updated_at`** 有独立索引，支持按时间倒序列表。

### `version` / `created_by` / `updated_by`

- 标准审计字段，见 [_shared-fields.md](./_shared-fields.md)。

---

## 索引

| 索引名 | 列 | 说明 |
|--------|-----|------|
| `idx_app_demo_records_status` | `status` | 按状态筛选 |
| `idx_app_demo_records_updated_at` | `updated_at DESC` | 按更新时间排序 |

---

## 表关系

无业务外键，独立表。

---

## 常用查询

```sql
SELECT id, name, status, updated_at
FROM app_demo_records
WHERE deleted_at IS NULL
ORDER BY updated_at DESC;
```

---

## 相关源码

- Migration: `electron/db/migrations/0001-initial-schema.ts`
- 表类型: `electron/db/models/tables/demo-record-table.ts`
- 领域模型: `electron/db/models/domain/demo-record.ts`
- Repository: `electron/db/repositories/demo-record-repository.ts`
