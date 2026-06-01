# 用户定时任务 API 文档（Claw）

## 概述

| 项 | 说明 |
|----|------|
| **Base URL** | `https://{host}/agent/v1/scheduled-tasks` |
| **鉴权** | Claw SSO：`Authorization: Bearer {stoToken}` 或 Header `stoToken` |
| **数据隔离** | 仅可操作当前登录用户归属的任务（`owner_user_id`） |
| **时区** | Cron 按 `Asia/Shanghai` 计算 `next_run_at` |
| **Content-Type** | `application/json` |

### 统一响应结构

**成功**

```json
{
  "success": true,
  "errCode": "200",
  "errMessage": "OK",
  "data": {},
  "extend": null,
  "total": 1
}
```

| 字段 | 说明 |
|------|------|
| `data` | 业务数据；删除成功时多为 `null` |
| `total` | 列表接口返回条数，其它接口可能无此字段 |
| `extend` | 扩展信息，一般为 `null` |

**失败**（HTTP 4xx/5xx，`success: false`）

| HTTP | 典型场景 |
|------|----------|
| 401 | 未登录 / token 无效 |
| 403 | 无权操作他人任务 |
| 404 | 任务不存在或已逻辑删除 |
| 409 | 任务名重复 |
| 422 | 参数校验失败（cron、description 等） |

---

## 任务对象字段说明

列表 `data.items[]`、详情/新增/修改的 `data` 均为此结构（部分字段可为 `null`）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int | 任务 ID |
| `owner_user_id` | string | 归属用户（工号/Code） |
| `name` | string | 任务名称，同用户下唯一 |
| `task_type` | string | v1 仅 `MONITOR_TASK` |
| `description` | string | 任务说明（派发知多星时作 question） |
| `cron_expr` | string | 5 段 cron，如 `0 9 * * *` |
| `enabled` | boolean | 是否参与调度 |
| `next_run_at` | string | 下次计划执行时间；停用时为 `null` |
| `last_run_at` | string | 最近一次执行时间 |
| `last_run_status` | string | 最近状态：`success` / `dispatch_failed` 等 |
| `notify_mode` | string | `none` / `dingtalk_group` / `dialog` / `both` |
| `site_code` | string | 网点编码（派发知多星必填） |
| `site_name` | string | 网点名称 |
| `dingding_id` | string | 钉钉用户 ID |
| `dingding_group_id` | string | 钉钉群 ID |
| `dingding_group_name` | string | 钉钉群名称 |
| `oss_object_key` | string | 脚本 OSS 路径，无脚本为 `null` |
| `dialog_session_key` | string | 对话会话键 |
| `openclaw_gateway_url` | string | Gateway 地址 |
| `created_at` | string | 创建时间 |
| `updated_at` | string | 更新时间 |

---

## 1. 新增（登记任务）

创建定时监控任务。登记后默认 **已启用**（`enabled=true`），并计算 `next_run_at`。可按 SSO 自动补全网点/钉钉群信息。

| 项 | 值 |
|----|-----|
| **Method** | `POST` |
| **Path** | `/agent/v1/scheduled-tasks` |

### 请求 Body

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `name` | 是 | string | 任务名，1–128 字符，同用户唯一 |
| `cron_expr` | 是 | string | Cron 表达式，如 `0 9 * * *` |
| `description` | 否 | string | 任务说明，最长 2000；若传则不能全空白 |
| `task_type` | 否 | string | 默认 `MONITOR_TASK`；`WORKFLOW` v1 不支持 |
| `notify_mode` | 否 | string | 默认 `none` |
| `script_content` | 否 | string | Python 脚本内容，有则上传 OSS |
| `site_code` | 否 | string | 网点编码；可不传，由服务端按用户补全 |
| `site_name` | 否 | string | 网点名称 |
| `dingding_id` | 否 | string | 钉钉用户 ID |
| `dingding_group_id` | 否 | string | 钉钉群 ID，可自动补全 |
| `dingding_group_name` | 否 | string | 钉钉群名称，可自动补全 |
| `dialog_session_key` | 否 | string | 对话推送会话 |
| `openclaw_gateway_url` | 否 | string | Gateway 地址 |
| `wt_user_id` | 否 | string | 梧桐用户 ID；一般不需传 |

### 请求示例

```http
POST /agent/v1/scheduled-tasks
Authorization: Bearer {stoToken}
Content-Type: application/json

{
  "name": "daily-report",
  "cron_expr": "0 9 * * *",
  "description": "每天 9 点检查日均发件量",
  "notify_mode": "dingtalk_group",
  "site_code": "276000"
}
```

### 响应示例

```json
{
  "success": true,
  "errCode": "200",
  "errMessage": "OK",
  "data": {
    "id": 6,
    "owner_user_id": "2760006744",
    "name": "daily-report",
    "task_type": "MONITOR_TASK",
    "description": "每天 9 点检查日均发件量",
    "cron_expr": "0 9 * * *",
    "enabled": true,
    "next_run_at": "2026-05-29T09:00:00",
    "notify_mode": "dingtalk_group",
    "site_code": "276000",
    "oss_object_key": null
  }
}
```

---

## 2. 列表

查询当前用户未逻辑删除的全部任务。

| 项 | 值 |
|----|-----|
| **Method** | `GET` |
| **Path** | `/agent/v1/scheduled-tasks/list` |
| **Query** | 无 |
| **Body** | 无 |

### 请求示例

```http
GET /agent/v1/scheduled-tasks/list
Authorization: Bearer {stoToken}
```

### 响应示例

```json
{
  "success": true,
  "errCode": "200",
  "errMessage": "OK",
  "total": 2,
  "data": {
    "items": [
      {
        "id": 6,
        "name": "daily-report",
        "enabled": true,
        "next_run_at": "2026-05-29T09:00:00",
        "cron_expr": "0 9 * * *"
      }
    ]
  }
}
```

---

## 3. 详情

按 `task_id` 查询单条任务。

| 项 | 值 |
|----|-----|
| **Method** | `GET` |
| **Path** | `/agent/v1/scheduled-tasks/details` |

### Query 参数

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `task_id` | 是 | int | 任务 ID |

### 请求示例

```http
GET /agent/v1/scheduled-tasks/details?task_id=6
Authorization: Bearer {stoToken}
```

### 响应示例

```json
{
  "success": true,
  "errCode": "200",
  "errMessage": "OK",
  "data": {
    "id": 6,
    "name": "daily-report",
    "description": "每天 9 点检查日均发件量",
    "cron_expr": "0 9 * * *",
    "enabled": true,
    "next_run_at": "2026-05-29T09:00:00",
    "last_run_at": "2026-05-28T09:00:00",
    "last_run_status": "success"
  }
}
```

---

## 4. 修改 / 启停

更新任务元数据；**停用、启用**均通过本接口的 `enabled` 字段完成。

| 项 | 值 |
|----|-----|
| **Method** | `POST` |
| **Path** | `/agent/v1/scheduled-tasks/update` |

> 仅允许更新下表字段，其它字段传了会 422（`extra=forbid`）。

### 请求 Body

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `task_id` | 是 | int | 任务 ID |
| `name` | 否 | string | 新任务名 |
| `cron_expr` | 否 | string | 新 cron；已启用时会重算 `next_run_at` |
| `description` | 否 | string | 新说明 |
| `notify_mode` | 否 | string | 通知模式 |
| `enabled` | 否 | boolean | `true` 启用 / `false` 停用 |

### 启停行为

| `enabled` | 效果 |
|-----------|------|
| `false` | 停用：`enabled=0`，`next_run_at=null`，不再被定时 tick 扫描 |
| `true` | 启用：按当前（或新）`cron_expr` 计算 `next_run_at` |

### 停用示例

```http
POST /agent/v1/scheduled-tasks/update
Authorization: Bearer {stoToken}
Content-Type: application/json

{
  "task_id": 6,
  "enabled": false
}
```

### 启用示例

```json
{
  "task_id": 6,
  "enabled": true
}
```

### 修改 cron 示例

```json
{
  "task_id": 6,
  "cron_expr": "0 10 * * *",
  "description": "改为每天 10 点"
}
```

### 响应示例

```json
{
  "success": true,
  "errCode": "200",
  "errMessage": "OK",
  "data": {
    "id": 6,
    "enabled": false,
    "next_run_at": null
  }
}
```

---

## 5. 手动触发

立即对该任务执行一次知多星派发（不等待 cron，**不修改** `next_run_at`）。

| 项 | 值 |
|----|-----|
| **Method** | `POST` |
| **Path** | `/agent/v1/scheduled-tasks/trigger` |

### 前置条件

- 任务存在且未逻辑删除
- `enabled = true`
- `site_code` 非空

### 请求 Body

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `task_id` | 是 | int | 任务 ID |

### 请求示例

```http
POST /agent/v1/scheduled-tasks/trigger
Authorization: Bearer {stoToken}
Content-Type: application/json

{
  "task_id": 6
}
```

### 响应 data 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `task_id` | int | 任务 ID |
| `run_id` | int | 本次执行记录 ID |
| `outcome` | string | `dispatched` / `dispatch_failed` / `dry_run` / `skipped` |
| `run` | object | 本次 `task_runs` 记录 |

### run 对象主要字段

| 字段 | 说明 |
|------|------|
| `status` | `pending` / `success` / `failed` 等 |
| `execution_result` | 知多星返回的 markdown 正文 |
| `log_text` | trace、推送消息等摘要 |
| `notify_dingtalk_ok` | 群推送是否成功（有 pushId 时） |

### 响应示例

```json
{
  "success": true,
  "errCode": "200",
  "errMessage": "OK",
  "data": {
    "task_id": 6,
    "run_id": 42,
    "outcome": "dispatched",
    "run": {
      "id": 42,
      "task_id": 6,
      "status": "success",
      "execution_result": "以下是**山东临沂公司**的日均发件量数据：\n\n...",
      "log_text": "请求TraceID：xxx,耗时：61468ms; 群推送成功",
      "notify_dingtalk_ok": true
    }
  }
}
```

---

## 6. 删除（逻辑删除）

标记删除，不再出现在列表/详情；不物理删除库表行。

| 项 | 值 |
|----|-----|
| **Method** | `POST` |
| **Path** | `/agent/v1/scheduled-tasks/delete` |

### 请求 Body

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `task_id` | 是 | int | 任务 ID |

### 行为说明

- `is_delete = 1`，`enabled = 0`，`next_run_at = null`
- 任务名加后缀 `__del_{id}`，便于同名任务重新登记
- 尽力删除 OSS 上的脚本（若存在）

### 请求示例

```http
POST /agent/v1/scheduled-tasks/delete
Authorization: Bearer {stoToken}
Content-Type: application/json

{
  "task_id": 6
}
```

### 响应示例

```json
{
  "success": true,
  "errCode": "200",
  "errMessage": "deleted",
  "data": null
}
```

---

## 接口速查表

| 功能 | Method | Path | 主要入参 |
|------|--------|------|----------|
| 新增 | `POST` | `/agent/v1/scheduled-tasks` | Body：`name`, `cron_expr`, … |
| 列表 | `GET` | `/agent/v1/scheduled-tasks/list` | 无 |
| 详情 | `GET` | `/agent/v1/scheduled-tasks/details` | Query：`task_id` |
| 修改/启停 | `POST` | `/agent/v1/scheduled-tasks/update` | Body：`task_id` + 可选字段 |
| 手动触发 | `POST` | `/agent/v1/scheduled-tasks/trigger` | Body：`task_id` |
| 删除 | `POST` | `/agent/v1/scheduled-tasks/delete` | Body：`task_id` |

---

## 典型调用顺序

```
登记 POST /
  → 列表 GET /list（拿 task_id）
  → 详情 GET /details?task_id=
  → 手动试跑 POST /trigger
  → 停用 POST /update { "enabled": false }
  → 启用 POST /update { "enabled": true }
  → 删除 POST /delete
```

---

## 其它相关接口

| 接口 | 说明 |
|------|------|
| `POST /agent/v1/scheduled-tasks/{task_id}/script` | 单独更新脚本 |
| `GET /agent/v1/scheduled-tasks/{task_id}/runs` | 执行历史 |
| `POST /no_auth/v1/scheduled-tasks/dispatch-tick` | 内部定时扫描派发（XXL-JOB，非用户接口） |

详见 [scheduled-task-dispatch-tick.md](./scheduled-task-dispatch-tick.md)。

---

## 联调与参考

- 本地 HTTP 示例：`scripts/scheduled_tasks.local.http`
- 本地脚本：`scripts/test_scheduled_tasks_local_api.py`
- Swagger：`https://{host}/docs` → 标签 `agent-scheduled-tasks`
- 集成说明：[scheduled-tasks-claw-integration.md](../scheduled-tasks-claw-integration.md)
