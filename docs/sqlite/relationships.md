# 表关系与连表查询

本文说明各表如何关联、典型 JOIN 模式，以及查询时的注意事项。

---

## 关系总览

```text
workspaces (1) ──< session_groups (N)           workspace_id
workspaces (1) ──< catalog_sessions (N)         workspace_id
session_groups (1) ──< catalog_sessions (N)     group_id (nullable)
session_engine_bindings (1) ── session_key ── catalog_sessions.session_key
```

- **实线 FK**：migration DDL 中声明（`session_groups`, `catalog_sessions` → `workspaces` / `session_groups`）
- **虚线逻辑关联**：`session_engine_bindings.session_key` = `catalog_sessions.session_key`，**无 FK**
- 运行时 `PRAGMA foreign_keys = OFF`，完整性由 Repository / Service 保证

---

## 核心实体：一次「侧栏会话」

侧栏展示的一条会话，通常需要合并三张表：

| 信息 | 来源表 |
|------|--------|
| 显示标题、置顶、所属项目、会话类型 | `catalog_sessions` |
| 引擎、cwd、模型、模型提供方 | `session_engine_bindings` |
| 项目名称、文件夹路径 | `workspaces` |

```sql
SELECT
  cs.session_key,
  COALESCE(cs.title, json_extract(seb.extra_json, '$.title')) AS display_title,
  cs.session_type,
  cs.task_id,
  cs.app_id,
  cs.channel_type,
  cs.channel_id,
  cs.pin_rank,
  cs.last_activity_at,
  cs.workspace_id,
  w.name   AS project_name,
  w.root_path,
  seb.engine_type,
  seb.agent_id,
  seb.cwd,
  seb.model,
  seb.provider
FROM catalog_sessions cs
INNER JOIN session_engine_bindings seb
  ON seb.session_key = cs.session_key AND seb.deleted_at IS NULL
LEFT JOIN workspaces w
  ON w.id = cs.workspace_id AND w.deleted_at IS NULL
WHERE cs.deleted_at IS NULL
  AND cs.workspace_id = '<project-id>'
ORDER BY
  CASE WHEN cs.pin_rank IS NULL THEN 1 ELSE 0 END,
  cs.pin_rank ASC,
  cs.last_activity_at DESC;
```

---

## 场景：侧栏「最近」

「最近」列表 = `workspace_id = 'default'` 的 `catalog_sessions`，不按用户项目过滤。

```sql
SELECT cs.session_key, cs.title, cs.last_activity_at, seb.engine_type
FROM catalog_sessions cs
LEFT JOIN session_engine_bindings seb
  ON seb.session_key = cs.session_key AND seb.deleted_at IS NULL
WHERE cs.workspace_id = 'default'
  AND cs.deleted_at IS NULL
ORDER BY cs.last_activity_at DESC NULLS LAST;
```

（SQLite 无 `NULLS LAST`，可用 `ORDER BY cs.last_activity_at IS NULL, cs.last_activity_at DESC`。）

---

## 场景：仅有 binding、尚无 catalog 行

Bootstrap 或引擎刚创建会话时，可能只有 `session_engine_bindings`：

```sql
SELECT seb.*
FROM session_engine_bindings seb
LEFT JOIN catalog_sessions cs
  ON cs.session_key = seb.session_key AND cs.deleted_at IS NULL
WHERE seb.deleted_at IS NULL
  AND cs.session_key IS NULL;
```

应用层会在 bind / 移入项目时 upsert `catalog_sessions`。

---

## 场景：项目与会话数量统计

```sql
SELECT
  w.id,
  w.name,
  COUNT(cs.session_key) AS session_count
FROM workspaces w
LEFT JOIN catalog_sessions cs
  ON cs.workspace_id = w.id AND cs.deleted_at IS NULL
WHERE w.deleted_at IS NULL
  AND w.is_default = 0
GROUP BY w.id, w.name
ORDER BY w.name;
```

---

## 场景：按 cwd 查项目会话

项目内工具目录应等于 `workspaces.root_path`：

```sql
SELECT seb.session_key, seb.cwd, w.name, w.root_path
FROM session_engine_bindings seb
JOIN catalog_sessions cs
  ON cs.session_key = seb.session_key AND cs.deleted_at IS NULL
JOIN workspaces w
  ON w.id = cs.workspace_id AND w.deleted_at IS NULL
WHERE w.is_default = 0
  AND seb.deleted_at IS NULL
  AND seb.cwd != w.root_path;
```

非空结果表示 cwd 与项目路径未同步，可用于排查。

---

## 软删除与 JOIN

所有业务查询应过滤：

```sql
WHERE <table>.deleted_at IS NULL
```

`workspaces` 软删除不会级联删除 `catalog_sessions`；业务层删除项目前需处理会话归属（移回 `default` 或软删 catalog 行）。

---

## 数据不在 SQLite 的关联

| 侧栏/聊天现象 | 实际数据源 |
|---------------|------------|
| 消息内容 | `~/.openclaw/.../*.jsonl` transcript |
| 未读红点 | Renderer `stoclaw:session-unread` |
| 发送中 / 队列 | Renderer Zustand stores |

SQLite 只回答「这条会话叫什么、在哪个项目、引擎 cwd 是什么」，不回答「最后一条消息写了什么」。
