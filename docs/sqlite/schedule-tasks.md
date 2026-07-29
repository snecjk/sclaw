# schedule_tasks / schedule_task_runs

定时任务**统一存储**表（Phase 1，migration `0011`）。定义 + 调度状态 + 运行记录，取代 `jobs.json` / `definitions.json` / 各自 `runs/*.jsonl`。

> **状态（2026-07-24）**：已 cutover 生产路径。启动期迁移读 `definitions.json` + `jobs.json` → 本表；迁后清 `jobs.json` 已迁 cron，**不清** `definitions.json`。进度见 `docs/定时任务重构-交接与执行计划.md`。

> ⚠ **命名说明**：表名 `schedule_tasks`（无 d）。`catalog_sessions.session_type` 保留 `cron` / `claude_task` / `scheduled_task`（P2-C 已否决不收敛）；侧栏「任务」只展示 dated 的 `cron`/`claude_task`。

---

## 用途

- `schedule_tasks`：任务**定义** + **调度状态**（合并进本表，减少 JOIN）。靠 `engine_type` 区分 openclaw / claude，引擎专属未列字段走 `extra_json`。
- `schedule_task_runs`：任务**运行记录**（替代两引擎各自 `runs/*.jsonl`）。一条 = 一次 run 生命周期。

**不在本表**：聊天消息正文（引擎 transcript）、会话组织元数据（`catalog_sessions`）、引擎绑定（`session_engine_bindings`）。任务会话仍由 `catalog_sessions`（`session_type` + `task_id`）组织，侧栏读 catalog 不读本表。

---

## DDL

```sql
-- migration 0011: schedule-tasks
CREATE TABLE IF NOT EXISTS schedule_tasks (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  enabled               INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  cron_expr             TEXT NOT NULL,
  engine_type           TEXT NOT NULL,                       -- openclaw | claude，应用层约束（DB 无 CHECK，对齐 _shared-fields 约定）
  prompt                TEXT NOT NULL,
  agent_id              TEXT NOT NULL,                       -- 两引擎都有：openclaw 从 sessionKey 派生；claude 取自 definition
  -- 引用列（两引擎共享、均可空、不互斥）
  workflow_code         TEXT,                                -- openclaw description.workflowCode / claude workflowCode
  skill_code            TEXT,                                -- 引用 skill，与 workflow_code 同级
  dingtalk_recipients_json TEXT CHECK (dingtalk_recipients_json IS NULL OR json_valid(dingtalk_recipients_json)),
  -- 引擎高频列（可空；引擎用不到的留 NULL）
  model                 TEXT,                                -- openclaw: payload.model；claude: 顶层 model
  provider              TEXT,
  account_id            TEXT,                                -- claude providerAccountId
  workspace_path        TEXT,
  permission_profile    TEXT,                                -- claude 三值；openclaw 无（NULL）；无 DB CHECK，应用层校验
  timeout_sec          INTEGER,
  retry_policy_json    TEXT CHECK (retry_policy_json IS NULL OR json_valid(retry_policy_json)),
  failure_policy_json  TEXT CHECK (failure_policy_json IS NULL OR json_valid(failure_policy_json)),
  -- 兜底冗余 JSON（引擎专属未列字段 + 未来扩展）
  extra_json           TEXT CHECK (extra_json IS NULL OR json_valid(extra_json)),
  -- 调度状态（合并进本表）
  next_run_at          TEXT,
  last_scheduled_for   TEXT,
  last_recovered_at    TEXT,
  cron_expr_snapshot   TEXT,                                 -- 算 next_run_at 时所用 cronExpr；编辑后重算依据
  -- 审计（对齐 catalog_sessions 约定，见 _shared-fields.md）
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  deleted_at           TEXT,
  version              INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by           TEXT,
  updated_by           TEXT
);

CREATE INDEX IF NOT EXISTS idx_schedule_tasks_enabled_due
  ON schedule_tasks(enabled, next_run_at) WHERE deleted_at IS NULL;     -- scheduler tick 取 due 任务
CREATE INDEX IF NOT EXISTS idx_schedule_tasks_engine
  ON schedule_tasks(engine_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_schedule_tasks_agent
  ON schedule_tasks(agent_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS schedule_task_runs (
  run_id               TEXT PRIMARY KEY,
  task_id              TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','timed_out','cancelled')),
  trigger_source       TEXT NOT NULL CHECK (trigger_source IN ('manual','schedule','recovery')),
  scheduled_for        TEXT,
  started_at           TEXT,
  completed_at         TEXT,
  attempt              INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  idempotency_key      TEXT NOT NULL,
  session_key          TEXT,                                  -- 关联 catalog_sessions（run 会话，非 dated；dated 会话无绑定）
  summary              TEXT,
  error                TEXT,
  runtime_result_json  TEXT CHECK (runtime_result_json IS NULL OR json_valid(runtime_result_json)),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  deleted_at           TEXT,
  version              INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by           TEXT,
  updated_by           TEXT,
  FOREIGN KEY (task_id) REFERENCES schedule_tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_task_runs_task_created
  ON schedule_task_runs(task_id, created_at DESC) WHERE deleted_at IS NULL;   -- MyTask「最近运行状态」
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_task_runs_idem
  ON schedule_task_runs(task_id, idempotency_key) WHERE deleted_at IS NULL;  -- 单飞去重
```

---

## 主键

| 表 | 主键 | 说明 |
|----|------|------|
| `schedule_tasks` | `id` (TEXT, UUID) | 任务定义唯一标识；与 `catalog_sessions.task_id` 逻辑关联 |
| `schedule_task_runs` | `run_id` (TEXT, UUID) | 单次运行唯一标识 |

---

## 字段一览 — schedule_tasks

| 列 | 中文名 | 类型 | 可空 | 默认 | 说明 |
|----|--------|------|------|------|------|
| `id` | 任务 ID | `TEXT` | 否 | — | UUID |
| `name` | 任务名 | `TEXT` | 否 | — | 展示名 |
| `enabled` | 启用 | `INTEGER` | 否 | `1` | 0/1 |
| `cron_expr` | cron 表达式 | `TEXT` | 否 | — | 本地时区解析 |
| `engine_type` | 引擎 | `TEXT` | 否 | — | `openclaw` / `claude`（应用层约束） |
| `prompt` | 提示词 | `TEXT` | 否 | — | openclaw payload.message / claude promptTemplate |
| `agent_id` | agent | `TEXT` | 否 | — | openclaw 从 sessionKey 派生；claude 取自 definition |
| `workflow_code` | 工作流引用 | `TEXT` | 是 | `NULL` | 两引擎共享；不与 skill_code 互斥 |
| `skill_code` | skill 引用 | `TEXT` | 是 | `NULL` | 新增；与 workflow_code 同级 |
| `dingtalk_recipients_json` | 钉钉收件人 | `TEXT` | 是 | `NULL` | JSON：`[{type,displayName,userId}]` |
| `model` | 模型 | `TEXT` | 是 | `NULL` | openclaw: payload.model；claude: 顶层 model |
| `provider` | provider | `TEXT` | 是 | `NULL` | |
| `account_id` | 账号 ID | `TEXT` | 是 | `NULL` | claude providerAccountId |
| `workspace_path` | 工作目录 | `TEXT` | 是 | `NULL` | claude workspacePath |
| `permission_profile` | 权限档 | `TEXT` | 是 | `NULL` | claude `readonly-safe`/`workspace-write`/`dangerous-bypass`；openclaw 无 |
| `timeout_sec` | 超时秒 | `INTEGER` | 是 | `NULL` | |
| `retry_policy_json` | 重试策略 | `TEXT` | 是 | `NULL` | JSON：`{maxAttempts,backoffSec}` |
| `failure_policy_json` | 失败策略 | `TEXT` | 是 | `NULL` | JSON：`{pauseAfterConsecutiveFailures}` |
| `extra_json` | 兜底冗余 | `TEXT` | 是 | `NULL` | 引擎专属未列字段 + 未来扩展 |
| `next_run_at` | 下次运行 | `TEXT` | 是 | `NULL` | UTC ISO8601；scheduler 维护 |
| `last_scheduled_for` | 上次调度目标 | `TEXT` | 是 | `NULL` | |
| `last_recovered_at` | 上次恢复 | `TEXT` | 是 | `NULL` | |
| `cron_expr_snapshot` | cron 快照 | `TEXT` | 是 | `NULL` | 算 next_run_at 时所用 cronExpr；编辑后重算依据 |
| `created_at` / `updated_at` / `deleted_at` / `version` / `created_by` / `updated_by` | — | — | — | — | 见 [_shared-fields.md](./_shared-fields.md) |

---

## 字段一览 — schedule_task_runs

| 列 | 中文名 | 类型 | 可空 | 默认 | 说明 |
|----|--------|------|------|------|------|
| `run_id` | 运行 ID | `TEXT` | 否 | — | UUID |
| `task_id` | 任务 ID | `TEXT` | 否 | — | FK→`schedule_tasks.id` |
| `status` | 状态 | `TEXT` | 否 | — | `queued`/`running`/`succeeded`/`failed`/`timed_out`/`cancelled` |
| `trigger_source` | 触发来源 | `TEXT` | 否 | — | `manual`/`schedule`/`recovery` |
| `scheduled_for` | 调度目标时刻 | `TEXT` | 是 | `NULL` | |
| `started_at` | 开始 | `TEXT` | 是 | `NULL` | |
| `completed_at` | 完成 | `TEXT` | 是 | `NULL` | |
| `attempt` | 尝试序号 | `INTEGER` | 否 | `1` | >0 |
| `idempotency_key` | 幂等键 | `TEXT` | 否 | — | `{taskId}:{scheduledFor}` 之类；去重 |
| `session_key` | 会话键 | `TEXT` | 是 | `NULL` | run 会话（有绑定）；dated 会话无 |
| `summary` | 摘要 | `TEXT` | 是 | `NULL` | run 产出摘要 |
| `error` | 错误 | `TEXT` | 是 | `NULL` | |
| `runtime_result_json` | 运行结果 | `TEXT` | 是 | `NULL` | JSON：`{stopReason,isError,durationMs}` |
| `created_at` / `updated_at` / `deleted_at` / `version` / `created_by` / `updated_by` | — | — | — | — | 见 [_shared-fields.md](./_shared-fields.md) |

---

## 索引

| 索引名 | 表 | 列 | 条件 | 用途 |
|--------|----|----|----|------|
| `idx_schedule_tasks_enabled_due` | schedule_tasks | `enabled, next_run_at` | `deleted_at IS NULL` | scheduler tick 取 due 任务 |
| `idx_schedule_tasks_engine` | schedule_tasks | `engine_type` | `deleted_at IS NULL` | 按引擎过滤 |
| `idx_schedule_tasks_agent` | schedule_tasks | `agent_id` | `deleted_at IS NULL` | 按 agent 过滤 |
| `idx_schedule_task_runs_task_created` | schedule_task_runs | `task_id, created_at DESC` | `deleted_at IS NULL` | MyTask 最近运行状态 |
| `idx_schedule_task_runs_idem` (UNIQUE) | schedule_task_runs | `task_id, idempotency_key` | `deleted_at IS NULL` | 单飞去重 |

---

## 表关系

| 关联 | 类型 | 说明 |
|------|------|------|
| `schedule_task_runs.task_id` → `schedule_tasks.id` | FK | 运行归属任务；软删保留行 |
| `schedule_task_runs.session_key` ↔ `catalog_sessions.session_key` | 逻辑 | run 会话（非 dated）；无 DB 外键，应用层保证 |
| `schedule_tasks.id` ↔ `catalog_sessions.task_id` | 逻辑 | 任务会话组织；侧栏读 catalog 不读本表 |
| 无 `workspace_id` | — | 任务定义全局（agent_id 维度），不属项目 |

---

## 引擎字段映射（Step 4 迁移来源）

| 来源字段 | → schedule_tasks 列 | 引擎 |
|---|---|---|
| `jobs.json` name / enabled | `name` / `enabled` | openclaw |
| `jobs.json` schedule.expr | `cron_expr` | openclaw |
| `jobs.json` payload.message | `prompt` | openclaw |
| `jobs.json` payload.model | `model` | openclaw |
| sessionKey `agent:{aid}:cron:{jid}` → `aid` | `agent_id` | openclaw |
| `jobs.json` description.dingTalkMentions | `dingtalk_recipients_json` | openclaw |
| `jobs.json` description.workflowCode | `workflow_code` | openclaw |
| `jobs.json` state.nextRunAtMs（未到期） | `next_run_at` | openclaw |
| `jobs.json` state/delivery/sessionTarget/wakeMode 其余 | `extra_json` | openclaw |
| `definitions.json` name / enabled | `name` / `enabled` | claude |
| `definitions.json` cronExpr | `cron_expr` | claude |
| `definitions.json` promptTemplate | `prompt` | claude |
| `definitions.json` agentId | `agent_id` | claude |
| `definitions.json` model（顶层，新任务有） | `model` | claude |
| `definitions.json` providerAccountId | `account_id` | claude |
| `definitions.json` workspacePath | `workspace_path` | claude |
| `definitions.json` permissionProfile | `permission_profile` | claude |
| `definitions.json` timeoutSec | `timeout_sec` | claude |
| `definitions.json` workflowCode | `workflow_code` | claude |
| `definitions.json` retryPolicy / failurePolicy | `retry_policy_json` / `failure_policy_json` | claude |
| `definitions.json` 其余 | `extra_json` | claude |
| `scheduler-state.json` nextRunAt | `next_run_at` | claude |

> 历史 run 不导入（`schedule_task_runs` 起始空）。catalog `session_type` **不收敛**（P2-C）；侧栏只展示 dated 的 `cron`/`claude_task`。

---

## 常用查询

```sql
-- scheduler tick：取到期任务
SELECT id, engine_type, agent_id, prompt, cron_expr, next_run_at
FROM schedule_tasks
WHERE enabled = 1 AND deleted_at IS NULL AND next_run_at IS NOT NULL
  AND next_run_at <= datetime('now')
ORDER BY next_run_at ASC;

-- MyTask 列表 + 最近运行状态
SELECT t.id, t.name, t.engine_type, t.enabled, t.cron_expr, t.next_run_at,
       r.status AS last_status, r.completed_at AS last_completed_at, r.summary AS last_summary
FROM schedule_tasks t
LEFT JOIN schedule_task_runs r ON r.task_id = t.id AND r.deleted_at IS NULL
  AND r.created_at = (SELECT MAX(r2.created_at) FROM schedule_task_runs r2
                      WHERE r2.task_id = t.id AND r2.deleted_at IS NULL)
WHERE t.deleted_at IS NULL
ORDER BY t.updated_at DESC;

-- 单任务最近 N 次运行
SELECT run_id, status, trigger_source, scheduled_for, started_at, completed_at, attempt, summary, error
FROM schedule_task_runs
WHERE task_id = ? AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 20;
```

---

## 相关源码（Step 2 计划，本期落地）

- Migration: `electron/db/migrations/0011-schedule-tasks.ts`
- 表类型: `electron/db/models/tables/schedule-task-tables.ts`
- 领域模型: `electron/db/models/domain/schedule-task.ts`
- Repository: `electron/db/repositories/schedule-task-repository.ts` / `schedule-task-run-repository.ts`

共享字段（时间戳 / 乐观锁 / 审计 / 布尔 / JSON 列 / 枚举）约定见 [_shared-fields.md](./_shared-fields.md)。表级总览与表关系图见 [README.md](./README.md)。
