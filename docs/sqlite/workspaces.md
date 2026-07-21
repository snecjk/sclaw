# workspaces

用户「项目」表。每个项目对应一个本地文件夹（`root_path`），项目下的会话通过 `catalog_sessions.workspace_id` 归属。

---

## 用途

- 侧栏「项目」列表的数据源
- 为项目内会话提供工具工作目录（`root_path` → `session_engine_bindings.cwd`）
- 内置默认工作区 `id = 'default'`：承载未归入项目的会话（侧栏「最近」），**不在项目列表中展示**

---

## 字段一览

| 列 | 中文名 | 类型 | 可空 | 默认值 | 说明 |
|----|--------|------|------|--------|------|
| `id` | 项目 ID | `TEXT` | 否 | — | 主键。用户项目为 UUID；系统内置 `default` |
| `name` | 项目名称 | `TEXT` | 否 | — | 侧栏与项目表单中显示的名称 |
| `root_path` | 项目根路径 | `TEXT` | 否 | `''` | 本地文件夹绝对路径，Agent 工具 `cwd` 的来源 |
| `is_default` | 是否默认工作区 | `INTEGER` | 否 | `0` | `1` 表示内置默认工作区，全局仅一条 |
| `created_at` | 创建时间 | `TEXT` | 否 | — | UTC ISO8601，记录首次创建时刻 |
| `updated_at` | 更新时间 | `TEXT` | 否 | — | UTC ISO8601，最近一次修改名称或路径的时刻 |
| `deleted_at` | 删除时间 | `TEXT` | 是 | `NULL` | 软删除标记；非空则从列表隐藏 |
| `version` | 版本号 | `INTEGER` | 否 | `1` | 乐观锁，每次更新 +1 |
| `created_by` | 创建者 | `TEXT` | 是 | `NULL` | 审计字段，可选 actor 标识 |
| `updated_by` | 更新者 | `TEXT` | 是 | `NULL` | 审计字段，最后一次修改者 |

领域模型映射：`electron/db/models/domain/session-catalog.ts` → `Workspace`（`root_path` → `rootPath`，`is_default` → `isDefault`）。

---

## 字段详解

### `id` — 项目 ID

- **含义**：工作区唯一标识，同时被 `catalog_sessions.workspace_id`、`session_groups.workspace_id` 引用。
- **取值**：
  - 用户创建的项目：`randomUUID()` 生成，如 `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
  - 系统内置：`default`（migration `0003` 插入，不可删除）
- **写入时机**：创建项目时生成；`default` 在首次 migration 时写入。
- **读取方**：侧栏项目列表、会话归属解析、`getWorkspaceRootPath()`。

### `name` — 项目名称

- **含义**：用户在 UI 中看到的项目名，与磁盘文件夹名可以不同。
- **约束**：`NOT NULL`，Repository 层会 `trim()`，空字符串会报错。
- **写入时机**：创建项目、重命名（侧栏「重命名」或编辑对话框）。
- **示例**：`我的前端项目`、`sto-claw`

### `root_path` — 项目根路径

- **含义**：项目对应的本地目录绝对路径。项目内会话执行文件读写、终端、代码工具时，工作目录应与此一致。
- **约束**：`NOT NULL`，默认 `''`。默认工作区 `default` 的 `root_path` 为空字符串。
- **写入时机**：创建项目（用户选择文件夹）、修改项目位置（「更改位置」）。
- **联动**：`updateWorkspace` 若修改 `root_path`，会遍历该项目下所有 `catalog_sessions`，同步更新对应 `session_engine_bindings.cwd`。
- **示例**：`/Users/sto/Documents/project/my-app`

### `is_default` — 是否默认工作区

- **含义**：标记内置「非项目」工作区，侧栏「最近」区域的会话归属 `workspace_id = 'default'` 的项目。
- **取值**：`0` = 普通用户项目；`1` = 默认工作区。
- **约束**：部分唯一索引 `idx_workspaces_default` 保证活跃记录中仅一条 `is_default = 1`。
- **UI 行为**：列表 API 默认 `includeDefault: false`，侧栏项目区不展示此行。

### `created_at` / `updated_at` — 创建 / 更新时间

- **格式**：UTC ISO8601 字符串，如 `2026-07-11T08:15:30.123Z`。
- **`created_at`**：项目首次保存时写入，之后不变。
- **`updated_at`**：每次 `name` 或 `root_path` 变更时刷新为当前时间。

### `deleted_at` — 删除时间

- **含义**：软删除。非 `NULL` 时项目从侧栏消失，但历史行保留在库中。
- **写入时机**：用户删除项目（`softDelete`）。
- **联动**：删除项目前，业务层会将其下会话移回 `default` 工作区（`deleteWorkspace`），再软删项目行。
- **查询**：常规列表必须加 `WHERE deleted_at IS NULL`。

### `version` / `created_by` / `updated_by` — 版本与审计

- **`version`**：每次 `update` 时 `version + 1`，用于并发冲突检测（当前 UI 未暴露给用户）。
- **`created_by` / `updated_by`**：预留审计字段，传入 `actor` 时写入；多数路径为 `NULL`。

---

## 索引

| 索引名 | 定义 | 说明 |
|--------|------|------|
| `idx_workspaces_default` | UNIQUE on `is_default` WHERE `is_default = 1 AND deleted_at IS NULL` | 保证仅一个活跃默认工作区 |

---

## 表关系

| 关联 | 方向 | 外键列 |
|------|------|--------|
| → `session_groups` | 1 : N | `session_groups.workspace_id` |
| → `catalog_sessions` | 1 : N | `catalog_sessions.workspace_id` |

Migration 中声明了 `FOREIGN KEY (workspace_id) REFERENCES workspaces(id)`，但运行时 `foreign_keys = OFF`。

---

## 业务规则

- 列表 API 默认 `includeDefault: false`，过滤 `is_default = 0`
- 创建项目时 `id` 由 `randomUUID()` 生成（可选手动指定）
- 修改 `root_path` 后，项目内已有会话的 `session_engine_bindings.cwd` 会同步更新

---

## 常用查询

```sql
-- 用户可见的项目列表
SELECT id, name, root_path, created_at, updated_at
FROM workspaces
WHERE deleted_at IS NULL AND is_default = 0
ORDER BY name;

-- 默认工作区
SELECT * FROM workspaces WHERE id = 'default' AND deleted_at IS NULL;
```

---

## 相关源码

- Migration: `electron/db/migrations/0003-session-catalog-schema.ts`
- 表类型: `electron/db/models/tables/session-catalog-tables.ts` → `WorkspacesTable`
- 领域模型: `electron/db/models/domain/session-catalog.ts` → `Workspace`
- Repository: `electron/db/repositories/workspace-repository.ts`
- 常量: `DEFAULT_WORKSPACE_ID = 'default'`
