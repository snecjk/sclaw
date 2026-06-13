# POST /agent/v1/workflow-templates/mine

分页查询当前用户可见的模板列表（系统模板 + 个人模板），前端据此区分 `scope: system` 与 `scope: personal`。

## 背景

现有 `POST /agent/v1/workflow-templates` 仅返回 `scope=system` 的系统模板（服务层过滤掉了 personal），无法满足「我的模板 + 系统模板」合并展示的需求。本端点模仿其结构，但保留两种 scope，并修复 `owner_user_id` alias 匹配问题。

## 基本信息

| 字段 | 值 |
| --- | --- |
| Method | `POST` |
| Path | `/agent/v1/workflow-templates/mine` |
| 鉴权 | `stoToken` + `Authorization: Bearer {stoToken}`（Main 进程自动注入） |
| Content-Type | `application/json` |

## 请求体

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `page` | `number` | 否 | 页码，1-based，默认 `1` |
| `pageSize` | `number` | 否 | 每页条数，默认 `100` |
| `keyword` | `string \| null` | 否 | 模糊匹配模板名称 / 描述 / ID |

> `owner_user_id` 由服务端从 SSO token 中自动注入并展开为别名集合，客户端无需传递。

```json
{
  "page": 1,
  "pageSize": 100,
  "keyword": "结算"
}
```

## 成功响应

HTTP 200，`success: true`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `success` | `boolean` | 固定 `true` |
| `data` | `TemplateMineItem[]` | 当前页列表 |
| `total` | `number` | 总条数 |
| `page` | `number` | 当前页码 |
| `pageSize` | `number` | 每页条数 |
| `traceId` | `string` | 链路追踪 ID |

### TemplateMineItem

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 模板业务 ID，如 `tpl_xxxx` |
| `label` | `string` | 模板名称 |
| `description` | `string \| null` | 模板描述 |
| `category` | `string \| null` | 分类标签 |
| `scope` | `string` | `"system"` 或 `"personal"`，前端据此区分展示 |
| `ownerUserId` | `string` | 模板所有者工号/ID |
| `createdAt` | `string \| null` | ISO 8601 创建时间 |
| `updatedAt` | `string \| null` | ISO 8601 更新时间 |
| `nodeCount` | `number` | 节点数量 |
| `nodes` | `dict[]` | 节点定义列表 |
| `edges` | `dict[]` | 边定义列表 |

```json
{
  "success": true,
  "data": [
    {
      "id": "tpl_daily_report",
      "label": "每日报告模板",
      "description": "自动生成每日业务汇总报告",
      "category": "report",
      "scope": "system",
      "ownerUserId": "system",
      "createdAt": "2026-05-10T08:00:00+08:00",
      "updatedAt": "2026-06-01T10:30:00+08:00",
      "nodeCount": 3,
      "nodes": [],
      "edges": []
    },
    {
      "id": "tpl_my_settlement",
      "label": "我的结算模板",
      "description": "个人结算对账流程模板",
      "category": "finance",
      "scope": "personal",
      "ownerUserId": "1065263",
      "createdAt": "2026-06-08T14:00:00+08:00",
      "updatedAt": "2026-06-12T09:00:00+08:00",
      "nodeCount": 2,
      "nodes": [],
      "edges": []
    }
  ],
  "total": 15,
  "page": 1,
  "pageSize": 20,
  "traceId": "trace-abc"
}
```

## 失败响应

HTTP 4xx/5xx 或 `success: false`：

```json
{
  "success": false,
  "errCode": "401",
  "errMessage": "未登录",
  "data": null,
  "traceId": "..."
}
```

## 客户端处理

- 分页字段 1-based：`page` / `pageSize` / `total`
- 无 `hasMore`：客户端用 `page * pageSize < total` 判断
- `scope` 区分：`scope === "system"` → 系统模板区域；`scope === "personal"` → 个人模板区域
- 401 → 引导重登；500 → 全屏/区块 Error + 重试

---

## 实施计划

### 一、后端 (memory-center)

#### 1. 新增 Schema (`src/schemas/workflow_client.py`)

| 类名 | 说明 |
| --- | --- |
| `ClientTemplateMinePageRequest` | `page, pageSize, keyword` |
| `ClientTemplateMineListItemResponse` | `id, label, description, category, scope, ownerUserId, createdAt, updatedAt, nodeCount, nodes, edges` |
| `AgentTemplateMinePageEnvelope` | `success, data: list, total, page, pageSize, traceId` |

#### 2. 新增 Service 方法 (`src/services/workflow_service.py`)

`list_client_mine_templates(query, page, page_size, owner_user_id_set)` — 调用 repo 查询，**不过滤 scope**，保留 system + personal，支持 keyword 搜索 + 内存分页。

#### 3. 新增/修改 Repository 方法 (`src/repositories/workflow_repository.py`)

查询条件：`scope == "system" OR owner_user_id IN (alias_set)`。

**关键：使用别名集合匹配 `owner_user_id`**（参考 `scheduled_tasks_list_alias_bug` — `owner_user_id` 可能存储为 Id 但解析为工号，单字段精确匹配会导致空结果）。使用 `collect_scheduled_task_owner_aliases` 或类似机制收集用户所有标识符，`WHERE owner_user_id IN (alias_set)`。

#### 4. 新增 API 端点 (`src/api/claw_api/v1/workflow_client.py`)

`POST /agent/v1/workflow-templates/mine` — 模仿 `/workflow-templates` 结构：
- 从 SSO token 提取工号 → 收集别名集合 → 调用 service
- 白名单门控：是否复用 `_check_template_whitelist` -> 不复用

### 二、Electron 中间层 (sto-claw/electron)

#### 5. 新增路由 (`electron/api/routes/workflows.ts`)

`GET /api/workflow-templates/mine?keyword=&page=&pageSize=` → 代理到后端 `POST /agent/v1/workflow-templates/mine`

### 三、前端 (sto-claw/src)

#### 6. 更新类型 (`src/types/workflow-api.ts` / `src/pages/Workflow/types.ts`)

- 新增 `WorkflowTemplateMineResponse` 类型
- `WorkflowCardItem` 可能需新增 `scope` 字段来区分 system / personal

#### 7. 更新 `use-workflow-list.ts`

- 调用 `/api/workflow-templates/mine`（替代现有 `/api/workflows`）
- 根据 `scope` 字段区分 system / personal
- 调整 `workflow-mapper.ts` 映射逻辑

### 四、需确认的点

1. **白名单门控**  新端点是否也需要 `_check_template_whitelist`？  不需要
2. **listKind 映射** 现有 `WorkflowMineListKind` 暂时不区分 `published/installed/draft` 概念，但 Tab ui 先行保存，只是切换不起作用
3. **现有 `/api/workflows`**  保留不动，新增 `/api/workflow-templates/mine`；前端改用新端点  是的