# session_engine_bindings

多引擎会话绑定表，替代历史文件 `~/.stoclaw/engine-sessions.json`。记录 `session_key` 与引擎、Agent、工作目录、模型等运行时信息。

---

## 用途

- 全局唯一标识每个聊天会话的引擎侧配置
- 存储工具 `cwd`（项目会话会与 `workspaces.root_path` 同步）
- `extra_json` 存放引擎特定扩展（标题快照、归档 id 等）
- 应用首次启动时可从旧 `engine-sessions.json` bootstrap 导入

---

## 主键

`session_key`（`TEXT PRIMARY KEY`）— 每个会话全局仅一条绑定记录。

---

## 字段一览

| 列 | 中文名 | 类型 | 可空 | 默认值 | 说明 |
|----|--------|------|------|--------|------|
| `session_key` | 会话键 | `TEXT` | 否 | — | 主键，与 `catalog_sessions.session_key` 对应 |
| `engine_type` | 引擎类型 | `TEXT` | 否 | — | `openclaw` 或 `claude` |
| `agent_id` | Agent ID | `TEXT` | 否 | — | 如 `main`，标识使用哪个 Agent |
| `engine_session_id` | 引擎会话 ID | `TEXT` | 是 | `NULL` | 引擎/runtime 内部的 session 标识 |
| `cwd` | 工作目录 | `TEXT` | 是 | `NULL` | 工具执行时的当前工作目录 |
| `model` | 模型 | `TEXT` | 是 | `NULL` | 当前使用的模型 ID |
| `provider` | 模型提供方 | `TEXT` | 是 | `NULL` | 如 `anthropic`、`openai`、`sto` |
| `account_id` | 账号 ID | `TEXT` | 是 | `NULL` | AI 提供方账号标识 |
| `extra_json` | 扩展 JSON | `TEXT` | 是 | `NULL` | 引擎特定扩展字段（见下文） |
| `created_at` | 创建时间 | `TEXT` | 否 | — | 绑定首次创建时间 |
| `updated_at` | 更新时间 | `TEXT` | 否 | — | 绑定最后一次变更时间 |
| `deleted_at` | 删除时间 | `TEXT` | 是 | `NULL` | 软删除 |
| `version` | 版本号 | `INTEGER` | 否 | `1` | 乐观锁 |
| `created_by` | 创建者 | `TEXT` | 是 | `NULL` | 审计字段 |
| `updated_by` | 更新者 | `TEXT` | 是 | `NULL` | 审计字段 |

领域模型映射：`SessionEngineBinding`（`engine_session_id` → `engineSessionId`，`extra_json` → `extra` 对象）。

---

## 字段详解

### `session_key` — 会话键

- **含义**：全应用唯一的会话标识，是 catalog 与引擎之间的纽带。
- **格式示例**：`agent:main:550e8400-e29b-41d4-a716-446655440000`
- **写入时机**：OpenClaw/Claude 引擎创建会话、从 `engine-sessions.json` bootstrap、手动注册。
- **与 catalog 关系**：逻辑一对一；catalog 用同一 `session_key` 查组织元数据，但无 DB 外键。

### `engine_type` — 引擎类型

- **含义**：该会话由哪个 Agent 引擎驱动。
- **枚举值**（`AgentEngineType`）：
  - `openclaw` — OpenClaw Gateway 引擎（默认）
  - `claude` — Claude 引擎
- **约束**：`NOT NULL`，决定 IPC/HTTP 调用走哪条引擎路径。

### `agent_id` — Agent ID

- **含义**：会话绑定的 Agent 实例，通常为配置中的主 Agent。
- **常见值**：`main`
- **用途**：Gateway 请求路由、按 Agent 列出会话（索引 `idx_session_engine_bindings_agent`）。
- **与 session_key 关系**：`session_key` 中段常含 `agent_id`，如 `agent:main:...`。

### `engine_session_id` — 引擎会话 ID

- **含义**：引擎/runtime 内部分配的 session 标识，与 StoClaw 的 `session_key` 不同。
- **可空**：引擎尚未分配或仅本地注册时可为 `NULL`。
- **写入时机**：引擎创建会话后回写；upsert 时映射自 DTO 的 `sessionId`。
- **用途**：向 Gateway 拉历史、续聊时传给引擎 API。

### `cwd` — 工作目录

- **含义**：Agent 工具（读文件、执行命令等）使用的当前工作目录。
- **可空**：未指定时引擎可能使用默认目录。
- **项目会话**：应等于所属项目的 `workspaces.root_path`；`updateWorkspace(rootPath)` 会批量同步。
- **解析逻辑**：`resolveSessionToolCwd()` 优先项目 `root_path`，否则用 binding 中的 `cwd`。
- **示例**：`/Users/sto/Documents/project/my-app`

### `model` — 模型

- **含义**：该会话当前选用的大模型标识（provider 内部 model id）。
- **可空**：未显式选择时由 Agent 默认配置决定。
- **示例**：`claude-sonnet-4-20250514`、`gpt-4o`
- **写入时机**：用户切换模型、引擎 bind 时传入。

### `provider` — 模型提供方

- **含义**：当前 `model` 所属的提供方（vendor），与 `model` 组合成完整的「引擎+模型」信息。
- **常见值**：`anthropic`、`openai`、`sto` 以及自定义 provider 的 `vendorId`。
- **写入时机**：Claude 引擎启动/切模型时从账号配置读取；OpenClaw 路径暂时依赖外部传入。

### `account_id` — 账号 ID

- **含义**：多账号场景下，标识使用哪个已配置的 AI 提供方账号。
- **可空**：单账号或未区分账号时为 `NULL`。
- **用途**：按账号隔离会话、计费或配额统计（如后续扩展）。

### `extra_json` — 扩展 JSON

- **含义**：不宜建独立列的引擎特定字段，存为 JSON 字符串。
- **约束**：`json_valid` 校验；应用层 parse 为 `extra: Record<string, unknown>`。
- **当前已知字段**（`buildExtraJson` / `bindingToRegistryEntry`）：

| JSON 键 | 类型 | 说明 |
|---------|------|------|
| `title` | `string` | 标题快照；`catalog_sessions.title` 为空时 UI 可回退到此 |
| `archivedClaudeSessionIds` | `string[]` | Claude 引擎归档的历史 session id 列表 |
| `pendingHistoryBridge` | `boolean` | 是否待完成历史桥接迁移 |

- **示例**：

```json
{
  "title": "重构登录模块",
  "archivedClaudeSessionIds": ["sess_abc123"],
  "pendingHistoryBridge": false
}
```

### `created_at` / `updated_at`

- **`created_at`**：绑定行首次 insert 时间。
- **`updated_at`**：每次 upsert（cwd、model、extra 等变更）刷新；可来自引擎 `updatedAt` 毫秒时间戳转换。

### `deleted_at` — 删除时间

- **含义**：软删除绑定；引擎注销会话时写入。
- **注意**：删除 binding 不一定会软删 `catalog_sessions`，两表生命周期可独立。

### `version` / `created_by` / `updated_by`

- 与其他业务表相同，见 [_shared-fields.md](./_shared-fields.md)。

---

## 索引

| 索引名 | 列 | 条件 |
|--------|-----|------|
| `idx_session_engine_bindings_agent` | `agent_id`, `updated_at DESC` | `deleted_at IS NULL` |

---

## 表关系

| 关联 | 类型 | 说明 |
|------|------|------|
| `catalog_sessions` | **逻辑** `session_key` | 组织元数据与引擎绑定分离存储 |
| `workspaces` | **间接** | 通过 `cwd` ≈ `workspaces.root_path` 与项目关联 |

无指向 `catalog_sessions` 或 `workspaces` 的数据库外键。

---

## 常用查询

```sql
-- 所有活跃绑定
SELECT session_key, engine_type, agent_id, cwd, model, provider, updated_at
FROM session_engine_bindings
WHERE deleted_at IS NULL
ORDER BY updated_at DESC;

-- 某 Agent 的会话
SELECT session_key, cwd, engine_session_id
FROM session_engine_bindings
WHERE agent_id = 'main' AND deleted_at IS NULL;

-- 按模型提供方筛选
SELECT session_key, model, provider
FROM session_engine_bindings
WHERE deleted_at IS NULL
  AND provider = 'anthropic';

-- 绑定 + catalog + 项目（完整会话视图）
SELECT
  seb.session_key,
  seb.engine_type,
  seb.cwd,
  seb.model,
  seb.provider,
  cs.session_type,
  cs.task_id,
  cs.app_id,
  cs.channel_type,
  cs.channel_id,
  cs.title,
  cs.workspace_id,
  cs.pin_rank,
  w.name AS project_name
FROM session_engine_bindings seb
LEFT JOIN catalog_sessions cs
  ON cs.session_key = seb.session_key AND cs.deleted_at IS NULL
LEFT JOIN workspaces w ON w.id = cs.workspace_id
WHERE seb.session_key = 'agent:main:...'
  AND seb.deleted_at IS NULL;
```

---

## 已知缺口

- `provider` 当前只在 Claude 引擎路径自动写入；OpenClaw 路径需要后续在模型切换/启动处补充传入。

## 相关源码

- Migration: `electron/db/migrations/0004-session-types-and-channels.ts`
- 表类型: `electron/db/models/tables/session-catalog-tables.ts` → `SessionEngineBindingsTable`
- 领域模型: `electron/db/models/domain/session-catalog.ts` → `SessionEngineBinding`
- Repository: `electron/db/repositories/session-engine-binding-repository.ts`
- 映射: `electron/engines/session-binding-map.ts` → `bindingToRegistryEntry`
- 引擎类型: `electron/engines/types.ts` → `AgentEngineType`
