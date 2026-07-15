# catalog_sessions

会话**组织元数据**表：侧栏展示、项目归属、置顶、排序、活跃时间。不存储聊天消息正文。

---

## 用途

- 记录会话属于哪个项目（`workspace_id`）
- 侧栏标题（`title`）、项目内置顶（`pin_rank`）、排序（`sort_key`、`last_activity_at`）
- 与 `session_engine_bindings` 通过 `session_key` 逻辑关联（引擎绑定、cwd 在 bindings 表）

---

## 主键

复合主键：`(workspace_id, session_key)`

同一会话键在不同工作区理论上可各有一条记录；实际业务中会话通过 `moveToWorkspace` 更新 `workspace_id` 在项目间移动，而非复制行。

---

## 字段一览

| 列 | 中文名 | 类型 | 可空 | 默认值 | 说明 |
|----|--------|------|------|--------|------|
| `workspace_id` | 所属项目 ID | `TEXT` | 否 | — | 复合主键之一；`default` = 侧栏「最近」 |
| `session_key` | 会话键 | `TEXT` | 否 | — | 复合主键之一；全局会话唯一标识 |
| `group_id` | 分组 ID | `TEXT` | 是 | `NULL` | 遗留分组，指向 `session_groups.id` |
| `session_type` | 会话类型 | `TEXT` | 否 | `'chat'` | `chat` / `cron` / `scheduled_task` / `claude_task` / `app` / `channel` / `workflow` |
| `task_id` | 任务 ID | `TEXT` | 是 | `NULL` | cron / scheduled / claude 定时任务 ID |
| `app_id` | 应用 ID | `TEXT` | 是 | `NULL` | 应用广场应用 ID |
| `channel_type` | 频道类型 | `TEXT` | 是 | `NULL` | 微信、钉钉、Telegram 等频道类型 |
| `channel_id` | 频道 ID | `TEXT` | 是 | `NULL` | 频道账号/群 ID |
| `title` | 会话标题 | `TEXT` | 是 | `NULL` | 侧栏显示名；空则回退引擎侧标题 |
| `pin_rank` | 置顶序号 | `INTEGER` | 是 | `NULL` | 项目内置顶排序，越小越靠前 |
| `sort_key` | 排序键 | `TEXT` | 是 | `NULL` | 稳定字典序排序辅助字段 |
| `last_activity_at` | 最近活跃时间 | `TEXT` | 是 | `NULL` | Catalog 层活跃时间，影响「最近」排序 |
| `created_at` | 创建时间 | `TEXT` | 否 | — | 首次写入 catalog 的时间 |
| `updated_at` | 更新时间 | `TEXT` | 否 | — | 元数据最后一次变更时间 |
| `deleted_at` | 删除时间 | `TEXT` | 是 | `NULL` | 软删除；非空则侧栏不显示 |
| `version` | 版本号 | `INTEGER` | 否 | `1` | 乐观锁 |
| `created_by` | 创建者 | `TEXT` | 是 | `NULL` | 审计字段 |
| `updated_by` | 更新者 | `TEXT` | 是 | `NULL` | 审计字段 |

领域模型映射：`CatalogSession`（`workspace_id` → `workspaceId`，`pin_rank` → `pinRank` 等）。

---

## 字段详解

### `workspace_id` — 所属项目 ID

- **含义**：该会话在组织层面归属哪个工作区 / 项目。
- **取值**：
  - `default`：未归入用户项目，出现在侧栏「最近」
  - 其他 UUID：对应 `workspaces.id` 的用户项目
- **写入时机**：首次 bind/upsert、移入项目、移出项目（回到 `default`）、删除项目时批量迁移。
- **外键**：DDL 引用 `workspaces(id)`，运行时未强制。

### `session_key` — 会话键

- **含义**：贯穿 catalog 与引擎绑定的全局会话标识，格式由引擎生成，catalog 视为不透明字符串。
- **格式示例**：
  - 常规聊天：`agent:main:550e8400-e29b-41d4-a716-446655440000`
  - Cron 任务：`agent:main:cron:job-123:2026-07-14`
  - STO 定时任务：`scheduled-task:42` 或 `agent:main:scheduled-task:42:2026-07-14`
  - Claude 定时任务：`claude-task:task-abc:2026-07-14`
  - 应用广场：`agent:main:session-embed-app-crm--conv-1`
- **结构**：通常为 `agent:{agentId}:{uuid}`，与 `session_engine_bindings.session_key` 一一对应。
- **写入时机**：引擎注册会话、bootstrap 导入、用户将会话加入项目时 upsert。
- **类型推断**：Repository 在创建 catalog 行时会根据 key 前缀自动推断 `session_type` / `task_id` / `app_id`。

### `group_id` — 分组 ID

- **含义**：会话在工作区内的二级分组（遗留能力，侧栏分组 UI 已移除）。
- **可空**：`NULL` 表示未分组；列表查询 `groupId: null` 时只返回未分组会话。
- **外键**：引用 `session_groups(id)`。
- **现状**：新功能不依赖此字段，保留兼容历史数据。

### `session_type` — 会话类型

- **含义**：标识这条会话在业务上的分类，用于侧栏分组、筛选和后续统计。
- **枚举值**：
  - `chat` — 常规聊天会话（默认）
  - `cron` — OpenClaw Cron 定时任务会话
  - `scheduled_task` — STO 定时任务会话
  - `claude_task` — Claude 定时任务会话
  - `app` — 应用广场（内置浏览器抽屉）会话
  - `channel` — 频道消息驱动的会话（如微信、钉钉）
  - `workflow` — 工作流会话（预留）
- **默认值**：`'chat'`；Migration 对历史行自动回填。
- **写入时机**：
  - 创建 catalog 行时若未显式传入，Repository 会根据 `session_key` 自动推断。
  - 频道类会话需要在创建入口显式传入 `sessionType: 'channel'`。
- **相关源码**：`shared/session-type.ts` → `inferSessionCatalogMeta`

### `task_id` — 任务 ID

- **含义**：Cron / STO / Claude 定时任务会话所关联的任务标识。
- **可空**：非任务会话为 `NULL`。
- **写入时机**：
  - 随 `session_type` 一起从 `session_key` 自动推断，例如：
    - `agent:main:cron:job-123` → `task_id = 'job-123'`
    - `scheduled-task:42` → `task_id = '42'`
    - `claude-task:task-abc` → `task_id = 'task-abc'`
  - 也可以由业务代码在创建时显式传入。

### `app_id` — 应用 ID

- **含义**：应用广场会话所属的应用标识。
- **可空**：非应用会话为 `NULL`。
- **写入时机**：从 `agent:*:session-embed-app-{appId}[--{conversationId}]` 格式的 key 自动推断。
- **示例**：`agent:main:session-embed-app-crm` → `app_id = 'crm'`。

### `channel_type` — 频道类型

- **含义**：标识会话来自或发往哪个消息频道类型。
- **常见值**：`wechat`、`dingtalk`、`telegram`、`discord`、`whatsapp`、`qqbot`、`wecom`、`signal`、`imessage`、`matrix`、`line`、`msteams`、`googlechat`、`mattermost` 等。
- **可空**：非频道会话为 `NULL`。
- **写入时机**：**不会**从 `session_key` 推断，必须由频道消息创建会话的入口显式写入。

### `channel_id` — 频道 ID

- **含义**：频道内的具体账号、群 ID 或机器人 ID。
- **可空**：非频道会话为 `NULL`。
- **写入时机**：与 `channel_type` 一起由业务代码显式传入。
- **示例**：钉钉群 ID、微信账号 ID、Telegram Chat ID。

### `title` — 会话标题

- **含义**：侧栏显示的会话名称，由用户重命名或首次创建时写入。
- **可空**：`NULL` 时 UI 回退到 `session_engine_bindings.extra_json.title` 或引擎生成的默认标题。
- **写入时机**：用户重命名、引擎 bind 时传入 `title`、upsert catalog 行。
- **注意**：聊天消息内容不在此字段，仅组织层显示名。

### `pin_rank` — 置顶序号

- **含义**：**项目内**置顶顺序，仅对 `workspace_id != 'default'` 的项目会话有意义。
- **可空**：`NULL` = 未置顶；非空整数越小越靠上。
- **写入时机**：用户在项目下点击「置顶」/「取消置顶」。
- **排序**：Repository 先排 `pin_rank IS NOT NULL`，再 `pin_rank ASC`，再 `last_activity_at DESC`。
- **示例**：第一个置顶 `0`，第二个置顶 `1`。

### `sort_key` — 排序键

- **含义**：预留的稳定排序字段，用于需要固定字典序的场景（如手动排序）。
- **可空**：当前多数路径未写入，依赖 `pin_rank` + `last_activity_at` 排序。
- **写入时机**：显式传入 `sortKey` 的 upsert 操作。

### `last_activity_at` — 最近活跃时间

- **含义**：Catalog 记录的会话最近活跃时间，用于侧栏「最近」与项目内按活跃排序。
- **格式**：UTC ISO8601 字符串。
- **写入时机**：upsert/bind 时从引擎 `updatedAt` 带入；部分元数据更新也会刷新。
- **已知缺口**：并非每条聊天消息后都更新；渲染层 `sessionLastActivity` 内存值有时领先于 DB。
- **与 bindings 区别**：`session_engine_bindings.updated_at` 反映绑定变更；本字段反映「组织层认为的活跃」。

### `created_at` — 创建时间

- **含义**：该会话**首次**写入 `catalog_sessions` 的时间（加入 catalog 的时间，不等于聊天开始时间）。
- **写入后不变**。

### `updated_at` — 更新时间

- **含义**：最近一次修改组织元数据的时刻（重命名、置顶、移项目、更新活跃时间等）。
- **每次 upsert / move / softDelete 都会刷新**。

### `deleted_at` — 删除时间

- **含义**：从侧栏移除会话（软删 catalog 行），不删除 `session_engine_bindings`。
- **写入时机**：用户删除侧栏会话、部分清理流程。
- **注意**：软删后 `session_key` 仍可能在 bindings 表存在。

### `version` / `created_by` / `updated_by`

- 与其他业务表相同，见 [_shared-fields.md](./_shared-fields.md)。

---

## 索引

| 索引名 | 列 | 条件 | 用途 |
|--------|-----|------|------|
| `idx_catalog_sessions_workspace_activity` | `workspace_id`, `last_activity_at DESC` | `deleted_at IS NULL` | 按项目查最近活跃 |
| `idx_catalog_sessions_workspace_pin` | `workspace_id`, `pin_rank ASC`, `last_activity_at DESC` | `deleted_at IS NULL` | 置顶 + 活跃排序 |
| `idx_catalog_sessions_session_type` | `workspace_id`, `session_type` | `deleted_at IS NULL` | 按类型过滤 |
| `idx_catalog_sessions_task_id` | `task_id` | `deleted_at IS NULL AND task_id IS NOT NULL` | 按任务 ID 查询 |
| `idx_catalog_sessions_app_id` | `app_id` | `deleted_at IS NULL AND app_id IS NOT NULL` | 按应用 ID 查询 |
| `idx_catalog_sessions_channel` | `channel_type`, `channel_id` | `deleted_at IS NULL AND channel_type IS NOT NULL` | 按频道查询 |

默认列表排序逻辑（Repository）：

1. 有 `pin_rank` 的在前（`pin_rank ASC`）
2. 再按 `last_activity_at DESC`
3. 再按 `session_key ASC` 稳定排序

---

## 表关系

| 关联 | 类型 | 说明 |
|------|------|------|
| `workspaces` | FK `workspace_id` | 会话归属项目 |
| `session_groups` | FK `group_id`（可选） | 遗留分组 |
| `session_engine_bindings` | **逻辑** `session_key` | 无 DB 外键；一条 binding 对应全局唯一 `session_key` |

---

## 与 bindings 的差异

| 维度 | `catalog_sessions` | `session_engine_bindings` |
|------|-------------------|---------------------------|
| 主键 | `(workspace_id, session_key)` | `session_key` |
| 职责 | UI 组织、项目归属、会话类型、频道关联 | 引擎类型、agent、cwd、模型、provider |
| 可单独存在 | 是（仅组织元数据） | 是（bootstrap 前可能只有 binding） |

---

## 常用查询

```sql
-- 某项目下会话（含置顶排序）
SELECT session_key, title, pin_rank, last_activity_at, updated_at
FROM catalog_sessions
WHERE workspace_id = '<project-id>'
  AND deleted_at IS NULL
ORDER BY CASE WHEN pin_rank IS NULL THEN 1 ELSE 0 END,
         pin_rank ASC,
         last_activity_at DESC;

-- 「最近」工作区（default）会话
SELECT session_key, title, last_activity_at
FROM catalog_sessions
WHERE workspace_id = 'default' AND deleted_at IS NULL
ORDER BY last_activity_at DESC;

-- 会话 + 项目名
SELECT cs.*, w.name AS project_name, w.root_path
FROM catalog_sessions cs
LEFT JOIN workspaces w ON w.id = cs.workspace_id
WHERE cs.session_key = 'agent:main:...' AND cs.deleted_at IS NULL;

-- 按会话类型筛选
SELECT session_key, session_type, task_id, app_id
FROM catalog_sessions
WHERE workspace_id = '<project-id>'
  AND deleted_at IS NULL
  AND session_type = 'cron';

-- 按频道查询
SELECT session_key, channel_type, channel_id
FROM catalog_sessions
WHERE deleted_at IS NULL
  AND channel_type = 'dingtalk'
  AND channel_id = '<chat-id>';
```

---

## 已知缺口

- `CatalogSessionDto` 暂未向渲染层暴露 `createdAt` / `updatedAt`
- `last_activity_at` 未在每条聊天消息后自动同步（部分路径仍依赖渲染层内存排序）
- `channel_type` / `channel_id` 不会从 `session_key` 自动推断，需要频道会话创建入口显式写入

---

## 相关源码

- Migration: `electron/db/migrations/0004-session-types-and-channels.ts`
- 表类型: `electron/db/models/tables/session-catalog-tables.ts` → `CatalogSessionsTable`
- 领域模型: `electron/db/models/domain/session-catalog.ts` → `CatalogSession`
- 会话类型推断: `shared/session-type.ts` → `inferSessionCatalogMeta`
- Repository: `electron/db/repositories/catalog-session-repository.ts`
- 服务: `electron/services/session-catalog-service.ts`
