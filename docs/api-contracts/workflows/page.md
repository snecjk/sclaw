# POST /agent/v1/workflows/page

分页查询工作流列表（「我的工作流」列表页）。

## 基本信息

| 字段 | 值 |
| --- | --- |
| Method | `POST` |
| Path | `/agent/v1/workflows/page` |
| 鉴权 | `stoToken` + `Authorization: Bearer {stoToken}`（Main 进程自动注入） |
| Content-Type | `application/json` |

## 请求体

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `page` | `number` | 否 | 页码，1-based，默认 `1` |
| `pageSize` | `number` | 否 | 每页条数，默认 `10`，最大 `100` |
| `createdBy` | `string \| null` | 否 | 创建者工号；「我的工作流」传当前用户 `empCode` |
| `keyword` | `string \| null` | 否 | 模糊匹配工作流名称或 ID |

```json
{
  "page": 1,
  "pageSize": 20,
  "createdBy": "1065263",
  "keyword": "结算"
}
```

## 成功响应

HTTP 200，`success: true`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `success` | `boolean` | 固定 `true` |
| `data` | `WorkflowSummary[]` | 当前页列表 |
| `total` | `number` | 总条数 |
| `page` | `number` | 当前页码 |
| `pageSize` | `number` | 每页条数 |
| `traceId` | `string` | 链路追踪 ID |

### WorkflowSummary

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 工作流 ID，如 `wf_1` |
| `name` | `string` | 名称 |
| `version` | `number` | 最新版本号 |
| `lifecycleStatus` | `string` | `draft` / `active` / `archived` |
| `versionStatus` | `string` | `draft` / `published` |
| `updatedAt` | `string \| null` | ISO 8601 带时区 |
| `createdBy` | `string \| null` | 创建者工号 |
| `createdByName` | `string \| null` | 创建者姓名 |
| `updatedBy` | `string \| null` | 修改者工号 |
| `updatedByName` | `string \| null` | 修改者姓名 |

```json
{
  "success": true,
  "data": [
    {
      "id": "wf_1",
      "name": "结算对账流程",
      "version": 3,
      "lifecycleStatus": "active",
      "versionStatus": "published",
      "updatedAt": "2026-06-08T10:45:19+08:00",
      "createdBy": "1065263",
      "createdByName": "张三",
      "updatedBy": "1065263",
      "updatedByName": "张三"
    }
  ],
  "total": 19,
  "page": 1,
  "pageSize": 20,
  "traceId": "trace-123"
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
- 401 → 引导重登；500 → 全屏/区块 Error + 重试

## 参考

- memory-center: `src/schemas/workflow.py` (`WorkflowPageRequest` / `WorkflowPageResponse`)
- memory-center: `tests/contract/test_workflow_list_page_contract.py`
