# session_groups

工作区内的自定义分组表。**侧栏分组 UI 已移除**，表结构保留以兼容历史数据与 migration，新功能优先使用 `workspaces` + `catalog_sessions.workspace_id`。

---

## 用途

- 在某一 `workspace_id` 下对会话做二级分组（名称 + 排序）
- `catalog_sessions.group_id` 可选指向本表

---

## 字段一览

| 列 | 中文名 | 类型 | 可空 | 默认值 | 说明 |
|----|--------|------|------|--------|------|
| `id` | 分组 ID | `TEXT` | 否 | — | 主键，UUID |
| `workspace_id` | 所属项目 ID | `TEXT` | 否 | — | 分组归属的工作区 |
| `name` | 分组名称 | `TEXT` | 否 | — | 分组在 UI 中的显示名 |
| `sort_order` | 排序序号 | `INTEGER` | 否 | `0` | 分组列表排序，越小越靠前 |
| `created_at` | 创建时间 | `TEXT` | 否 | — | 分组创建时刻 |
| `updated_at` | 更新时间 | `TEXT` | 否 | — | 最近修改名称或排序的时刻 |
| `deleted_at` | 删除时间 | `TEXT` | 是 | `NULL` | 软删除 |
| `version` | 版本号 | `INTEGER` | 否 | `1` | 乐观锁 |
| `created_by` | 创建者 | `TEXT` | 是 | `NULL` | 审计字段 |
| `updated_by` | 更新者 | `TEXT` | 是 | `NULL` | 审计字段 |

领域模型映射：`SessionGroup`（`workspace_id` → `workspaceId`，`sort_order` → `sortOrder`）。

---

## 字段详解

### `id` — 分组 ID

- **含义**：分组唯一标识，被 `catalog_sessions.group_id` 可选引用。
- **生成**：`randomUUID()`，创建时可选手动指定。
- **现状**：侧栏已无分组 UI，历史行可能仍存在。

### `workspace_id` — 所属项目 ID

- **含义**：分组隶属于哪个工作区；同一分组不能跨项目。
- **外键**：DDL 引用 `workspaces(id)`。
- **约束**：`NOT NULL`。

### `name` — 分组名称

- **含义**：分组显示标签，如「进行中」「归档」。
- **约束**：`NOT NULL`，Repository 层 trim 后不能为空。

### `sort_order` — 排序序号

- **含义**：同一 `workspace_id` 下多个分组的显示顺序。
- **规则**：整数越小越靠前；默认 `0`。
- **索引**：`idx_session_groups_workspace` 按 `(workspace_id, sort_order ASC)` 排序。

### `created_at` / `updated_at` / `deleted_at`

- **`created_at`**：分组创建时间，不变。
- **`updated_at`**：重命名或调整 `sort_order` 时更新。
- **`deleted_at`**：软删除后，引用此 `group_id` 的 `catalog_sessions` 行需业务层处理（当前较少触发）。

### `version` / `created_by` / `updated_by`

- 与其他业务表相同，见 [_shared-fields.md](./_shared-fields.md)。

---

## 索引

| 索引名 | 列 | 条件 |
|--------|-----|------|
| `idx_session_groups_workspace` | `workspace_id`, `sort_order ASC` | `deleted_at IS NULL` |

---

## 表关系

| 关联 | 方向 | 外键列 |
|------|------|--------|
| `workspaces` → 本表 | 1 : N | `workspace_id` |
| 本表 → `catalog_sessions` | 1 : N | `catalog_sessions.group_id`（可选） |

---

## 常用查询

```sql
SELECT sg.id, sg.name, sg.sort_order, w.name AS workspace_name
FROM session_groups sg
JOIN workspaces w ON w.id = sg.workspace_id
WHERE sg.deleted_at IS NULL
ORDER BY sg.workspace_id, sg.sort_order;
```

---

## 相关源码

- Migration: `electron/db/migrations/0002-session-catalog-schema.ts`
- 表类型: `electron/db/models/tables/session-catalog-tables.ts` → `SessionGroupsTable`
- 领域模型: `electron/db/models/domain/session-catalog.ts` → `SessionGroup`
- Repository: `electron/db/repositories/session-group-repository.ts`
