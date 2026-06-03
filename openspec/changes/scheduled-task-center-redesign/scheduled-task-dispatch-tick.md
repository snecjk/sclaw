# 用户定时任务 — Step2 到期派发接口

## 1. 概述

| 项 | 说明 |
|----|------|
| 功能 | 扫描数据库中**已到期**的用户定时任务，向**知多星** `site/agentrun/ask` 发起同步问答（可选群推送） |
| 触发方式 | 由外部系统定时调用本接口（如 **Java + XXL-JOB**），**不**使用 Celery Beat |
| 与用户 cron 关系 | 用户任务的执行时刻由表字段 `cron_expr` + `next_run_at` 决定；本接口只负责「到点扫库」，**不在 XXL 中为每个用户单独建 Job** |
| 关联能力 | Step1 任务登记：`POST /agent/v1/scheduled-tasks`（需 Claw SSO） |

---

## 2. 接口定义

### 2.1 基本信息

| 项 | 值 |
|----|-----|
| **Method** | `POST` |
| **Path** | `/no_auth/v1/scheduled-tasks/dispatch-tick` |
| **Content-Type** | 无要求（无请求体） |
| **鉴权** | 不走 Claw Bearer / Web `stoToken`；可选回调 Token（见 §3） |

### 2.2 完整 URL 示例

```
POST https://{memory-center-host}/no_auth/v1/scheduled-tasks/dispatch-tick
```

测试环境示例（以实际域名为准）：

```
POST https://memory-center-test.example.com/no_auth/v1/scheduled-tasks/dispatch-tick
```

---

## 3. 鉴权说明

| 场景 | 行为 |
|------|------|
| Apollo **未配置** `scheduled.task.dispatch.callback.token`（或为空） | **不校验** Header，适合测试/内网 |
| Apollo **已配置** `scheduled.task.dispatch.callback.token` | 请求头必须携带相同值，否则 `401` |

### 3.1 请求头（可选）

| Header | 必填 | 说明 |
|--------|------|------|
| `X-Scheduled-Dispatch-Token` | 配置了 callback.token 时必填 | 与 Apollo `scheduled.task.dispatch.callback.token` 一致 |

示例：

```http
X-Scheduled-Dispatch-Token: your-shared-secret
```

---

## 4. 请求

- **Body**：无（不需要 JSON / form）。
- **Query**：无。

### 4.1 调用频率建议

- 由 Java / XXL-JOB 自行决定（常见：**每 1～5 分钟** 一次）。
- 频率应 **不大于** 用户任务的最小执行间隔，避免长时间不到期才扫到。
- 全局只需 **一条** XXL Job 调本接口。

---

## 5. 响应

### 5.1 统一包装

与 memory-center 其它接口一致：

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 是否成功 |
| `errCode` | string | 业务码，`200` 表示成功 |
| `errMessage` | string | 提示信息 |
| `data` | object | 本接口业务数据 |
| `extend` | any | 扩展，一般为 `null` |
| `total` | number \| null | 本接口一般为 `null` |

### 5.2 `data` 字段（业务结果）

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | `ok`：已执行扫描；`skipped`：总开关关闭，未扫库 |
| `reason` | string | 仅 `status=skipped` 时有值，如 `scheduled.task.dispatch.enabled=false` |
| `due_found` | int | 本次扫描到的到期任务数（`enabled=1` 且 `next_run_at <= 当前时间`） |
| `claimed` | int | 成功 claim（锁定并推进 `next_run_at`、写入 `task_runs`）的数量 |
| `queued` | int | 固定为 `0`（HTTP 模式为进程内同步派发，不入 Celery 队列） |
| `dispatched` | int | 成功 POST 知多星的次数 |
| `dispatch_failed` | int | 派发 HTTP 失败次数 |
| `skipped` | int | claim 失败跳过（如并发已被其它实例 claim） |
| `dry_run` | int | 未配置派发 URL 且开启 dry-run 时仅打日志的次数 |

### 5.3 成功示例 — 有到期任务且派发成功

**HTTP 状态码**：`200`

```json
{
  "success": true,
  "errCode": "200",
  "errMessage": "OK",
  "data": {
    "status": "ok",
    "due_found": 2,
    "claimed": 2,
    "queued": 0,
    "dispatched": 2,
    "dispatch_failed": 0,
    "skipped": 0,
    "dry_run": 0
  },
  "extend": null,
  "total": null
}
```

### 5.4 成功示例 — 开关关闭

```json
{
  "success": true,
  "errCode": "200",
  "errMessage": "OK",
  "data": {
    "status": "skipped",
    "reason": "scheduled.task.dispatch.enabled=false",
    "due_found": 0,
    "claimed": 0,
    "queued": 0,
    "dispatched": 0,
    "dispatch_failed": 0,
    "skipped": 0,
    "dry_run": 0
  },
  "extend": null,
  "total": null
}
```

### 5.5 成功示例 — 无到期任务

```json
{
  "success": true,
  "errCode": "200",
  "errMessage": "OK",
  "data": {
    "status": "ok",
    "due_found": 0,
    "claimed": 0,
    "queued": 0,
    "dispatched": 0,
    "dispatch_failed": 0,
    "skipped": 0,
    "dry_run": 0
  },
  "extend": null,
  "total": null
}
```

### 5.6 失败示例 — Token 无效

**HTTP 状态码**：`401`

```json
{
  "success": false,
  "errCode": "401",
  "errMessage": "定时任务派发回调 token 无效",
  "data": null,
  "extend": null,
  "total": null
}
```

---

## 6. 服务端处理流程

```
POST /dispatch-tick
    │
    ├─ scheduled.task.dispatch.enabled == false → 返回 status=skipped
    │
    └─ enabled == true
           │
           ├─ 查询 scheduled_tasks
           │     WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at <= now()
           │     LIMIT batch_size（默认 100）
           │
           ├─ 对每条任务：乐观锁 claim，next_run_at 按 cron_expr 推到下一次
           ├─ 插入 task_runs（status=pending）
           └─ POST 知多星（见 §7）
```

- 时区：**Asia/Shanghai**（与 `next_run_at` 计算一致）。
- 多实例：依赖 DB 乐观锁，同一到期时刻通常只会有一条实例 claim 成功。

---

## 7. 下游：知多星 HTTP

### 7.1 派发 URL

按优先级：

1. Apollo `scheduled.task.dispatch.url.override`（完整 URL，可选）
2. 否则：`{biz.agent.zhiduoxing.base.url}` + `/api/openness/site/agentrun/ask`

完整契约见 **[site-agentrun-ask.md](../site-agentrun-ask.md)**。

示例：

```
POST https://baseinfo-chatbotapi-test.sto.cn/api/openness/site/agentrun/ask
```

### 7.2 请求体（每条任务一次 POST）

Content-Type：`application/json`。`actionType` 由 `notify_mode` 推导：

| notify_mode | actionType |
|-------------|------------|
| `none` / `dialog` | `NONE`（仅同步 agentrun，不推钉钉） |
| `dingtalk_group` / `both`（且有 `dingding_group_id`） | `GROUP_PUSH`（问答成功后推群） |

主要字段来源：

| JSON 字段 | 来源（scheduled_tasks 表） |
|-----------|---------------------------|
| `wtUserCode` | `owner_user_id`（梧桐用户编码） |
| `siteCode` | `site_code`（**必填**） |
| `siteName` | `site_name` |
| `question` | `description`，空则 `name` |
| `robotCode` | Apollo `scheduled.task.dispatch.site.agent.robot.code`（默认 `J251104001`） |
| `conversationId` | `dingding_group_id`（`GROUP_PUSH` 时） |
| `dingRobotCode` | Apollo `scheduled.task.dispatch.ding.robot.code` |
| `pushTitle` | `name`（`GROUP_PUSH` 时） |

示例（`notify_mode=none`）：

```json
{
  "actionType": "NONE",
  "robotCode": "J251104001",
  "wtUserCode": "9000000130",
  "siteCode": "322000",
  "siteName": "测试网点",
  "question": "每日检查库存"
}
```

> **注意**：该接口为**同步阻塞**，单次调用可能耗时数十秒；`scheduled.task.dispatch.timeout.seconds` 建议 **120**。

请求 Header（知多星侧）：

| Header | Apollo |
|--------|--------|
| `Openness-Api-Key` | `scheduled.task.dispatch.openness.api.key`（未配时回退 `scheduled.task.dispatch.auth.token`） |
| `Openness-Api-App-Name` | `scheduled.task.dispatch.openness.app.name`（可选） |

---

## 8. Apollo 配置

| Key | 必填 | 默认值 | 说明 |
|-----|------|--------|------|
| `scheduled.task.dispatch.enabled` | 是 | `false` | 总开关；`false` 时接口返回 `skipped` |
| `scheduled.task.dispatch.dry.run` | 否 | `true` | 未配置知多星 URL 时是否只打日志不 POST |
| `biz.agent.zhiduoxing.base.url` | 是* | 测试域名 | 知多星 base；与固定 path 拼接。*启用派发且非 dry-run 时必填 |
| `scheduled.task.dispatch.url.override` | 否 | 空 | 覆盖完整派发 URL |
| `scheduled.task.dispatch.callback.token` | 否 | 空 | 非空则校验 `X-Scheduled-Dispatch-Token` |
| `scheduled.task.dispatch.openness.api.key` | 建议 | 空 | 调知多星 `Openness-Api-Key` |
| `scheduled.task.dispatch.openness.app.name` | 否 | 空 | `Openness-Api-App-Name` |
| `scheduled.task.dispatch.site.agent.robot.code` | 否 | `J251104001` | 经营参谋鉴权机器人 |
| `scheduled.task.dispatch.ding.robot.code` | 否 | 钉钉默认码 | `GROUP_PUSH` 时钉钉机器人 |
| `scheduled.task.dispatch.auth.token` | 否 | 空 | 未配 openness.api.key 时作 Openness-Api-Key 回退 |
| `scheduled.task.dispatch.batch.size` | 否 | `100` | 单次 tick 最多处理任务数（1～500） |
| `scheduled.task.dispatch.timeout.seconds` | 否 | `120` | 调知多星超时（秒）；agentrun 同步耗时长 |

### 8.1 测试环境推荐

```properties
scheduled.task.dispatch.enabled=true
scheduled.task.dispatch.dry.run=false
biz.agent.zhiduoxing.base.url=https://baseinfo-chatbotapi-test.sto.cn
```

---

## 9. 调用前数据条件

数据库表 `scheduled_tasks` 中需存在可被扫描的记录：

| 字段 | 要求 |
|------|------|
| `enabled` | `1` |
| `next_run_at` | 非空，且 **≤ 当前时间**（上海时区） |
| `site_code` | **必填**，作为 `siteCode` |
| `owner_user_id` | 作为 `wtUserCode`（梧桐用户编码） |
| `dingding_group_id` | `notify_mode` 含群推送时必填（`conversationId`） |
| `description` | 作为 `question`（空则用 `name`） |

登记接口会自动写入 `next_run_at`（见 Step1 `POST /agent/v1/scheduled-tasks`）。

---

## 10. 调用示例

### 10.1 cURL

```bash
curl -X POST "https://{host}/no_auth/v1/scheduled-tasks/dispatch-tick" \
  -H "Content-Type: application/json"
```

带 Token：

```bash
curl -X POST "https://{host}/no_auth/v1/scheduled-tasks/dispatch-tick" \
  -H "X-Scheduled-Dispatch-Token: your-shared-secret"
```

### 10.2 Java（HttpClient 示意）

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://{host}/no_auth/v1/scheduled-tasks/dispatch-tick"))
    .POST(HttpRequest.BodyPublishers.noBody())
  // .header("X-Scheduled-Dispatch-Token", token)  // 若 Apollo 已配置 callback.token
    .build();
HttpResponse<String> response = HttpClient.newHttpClient()
    .send(request, HttpResponse.BodyHandlers.ofString());
```

### 10.3 XXL-JOB

- 注册 **1 条** Job，Cron 如：`0 0/5 * * * ?`（每 5 分钟）。
- 执行器：HTTP Job 或 Java Handler 调用上述 URL。
- 建议超时 ≥ **120s**（任务批量大时）。

---

## 11. 部署说明

| 组件 | 是否需要 |
|------|----------|
| memory-center **API 进程** | **需要** |
| Celery Beat | **不需要**（本功能） |
| Celery Worker | **不需要**（本功能） |

与 Step1 共用同一套 API 部署即可。

---

## 12. 错误排查

| 现象 | 可能原因 |
|------|----------|
| `status=skipped` | `scheduled.task.dispatch.enabled` 未开 |
| `due_found=0` | 无到期任务；检查 `enabled`、`next_run_at` |
| `dispatched=0` 且 `dry_run>0` | 未配知多星 URL 或 `dry.run=true` |
| `dispatch_failed>0` | 知多星不可达、超时或 4xx/5xx；查 API 日志 |
| `401` | callback.token 已配置但 Header 未带或错误 |
| 知多星无反应 | `dingding_group_id` / `dingding_id` 为空或错误 |

---

## 13. 变更记录

| 版本 | 说明 |
|------|------|
| 2026-05 | Step2 改为仅 HTTP 触发；移除 Celery Beat `scheduled-task-dispatch-tick` |
