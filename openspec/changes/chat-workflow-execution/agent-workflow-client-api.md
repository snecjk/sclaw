# Agent Workflow Client API

> `stoToken` 鉴权接口。面向外部客户端开放的工作流能力，统一挂在 `/agent/v1` 下。

## 概览

当前一期开放 6 个接口：

```http
POST /agent/v1/workflow-templates/search
GET  /agent/v1/workflow-templates/{templateId}/startup-schema
POST /agent/v1/workflows
POST /agent/v1/workflows/{workflowId}/start
GET  /agent/v1/runs/{runId}
GET  /agent/v1/runs/{runId}/stream
```

完整调用链路：

1. 搜索系统模板
2. 查询模板启动参数
3. 保存用户流程草稿与默认启动参数草稿
4. 启动流程
5. 查询或订阅运行结果

除 `GET /agent/v1/runs/{runId}/stream` 这类 SSE 流式接口外，所有 JSON 成功响应统一使用以下外层结构：

```json
{
  "success": true,
  "data": {},
  "traceId": "189215191610245120"
}
```

---

## 鉴权

所有接口均要求携带 `stoToken`。

### 请求头

| Header | 必填 | 说明 |
|------|------|------|
| `stoToken` | 是 | 当前登录用户 token |

### 鉴权失败响应

```json
{
  "success": false,
  "errCode": "401",
  "errMessage": "未登录或 stoToken 无效",
  "data": null,
  "traceId": "189215191610245120"
}
```

---

## Trace ID 约定

所有 `/agent/v1` 工作流客户端接口都必须遵守统一链路追踪约定。

### 请求头

| Header | 必填 | 说明 |
|------|------|------|
| `X-Trace-Id` | 否 | 调用方透传的链路追踪 ID，推荐优先传入 |


### 示例

请求头：

```http
stoToken: xxx
X-Trace-Id: xxxxx123
```

---

## 1. 搜索工作流模板

```http
POST /agent/v1/workflow-templates/search
```

### 说明

- 输入用户自然语言描述
- 服务端先召回系统模板候选，再由模型精选排序
- 默认返回 3 个结果
- 仅返回系统模板

### 请求体

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|------|------|
| `query` | string | 是 | - | 用户自然语言输入 |
| `limit` | integer | 否 | `3` | 返回数量，服务端会限制最大值 |

### 请求示例

```json
{
  "query": "帮我找一个合同审核流程",
  "limit": 3
}
```

### 成功响应

```json
{
  "success": true,
  "data": {
    "matchedItems": [
      {
        "id": "tpl_contract_review",
        "label": "合同审核",
        "description": "自动解析合同文件，AI 智能审核，人工确认后归档",
        "category": "legal",
        "scope": "system",
        "nodeCount": 4,
        "nodes": [
          {
            "id": "trigger_1",
            "type": "trigger",
            "name": "收到合同文件"
          }
        ],
        "edges": [],
        "matchScore": 0.92,
        "matchReason": [
          "名称命中: 合同审核",
          "描述命中: 合同文件/审核/归档"
        ],
        "resultType": "matched"
      }
    ],
    "recommendedItems": []
  },
  "traceId": "189215191610245120"
}
```

### 响应字段说明

`matchedItems[*]` / `recommendedItems[*]` 对齐现有模板摘要结构，并增加以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `matchScore` | number | 相对匹配分数 |
| `matchReason` | string[] | 模型给出的匹配原因 |
| `resultType` | string | `matched` / `recommended` |

### 错误响应

| HTTP 状态码 | 场景 |
|------|------|
| `401` | 未登录或 token 无效 |
| `422` | 请求参数不合法 |
| `500` | 服务端内部错误 |

---

## 2. 查询模板启动参数

```http
GET /agent/v1/workflow-templates/{templateId}/startup-schema
```

### 说明

- 基于系统模板 definition 解析 `startup_config` 节点
- 此接口不创建用户流程草稿
- 客户端应先拿到 schema，再让用户填写启动参数

### 路径参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `templateId` | string | 是 | 系统模板业务主键 |

### 成功响应

```json
{
  "success": true,
  "data": {
    "templateId": "tpl_contract_review",
    "schemaHash": "3a6ff85d959e4210c6f57f65ec1d89a0689de991f8f8e6b4bd79a759ce256736",
    "schema": {
      "nodeId": "startup_config_1780559578678",
      "enabled": true,
      "steps": [
        {
          "id": "step_1",
          "title": "数据取数",
          "mode": "confirm",
          "order": 10
        },
        {
          "id": "step_2",
          "title": "数据处理",
          "mode": "confirm",
          "order": 20
        }
      ],
      "fields": [
        {
          "key": "time",
          "label": "取数时间范围？",
          "group": "step_1",
          "component": "single_select",
          "required": true,
          "order": 10,
          "options": [
            {
              "value": "1",
              "label": "昨日全天 · 00:00~23:59（默认）",
              "description": "昨日全天 · 00:00~23:59（默认）"
            }
          ],
          "groupTitle": "取数时间范围？",
          "description": "取数来源说明",
          "sourceNodes": [
            "agent_task_1779887624967"
          ]
        }
      ]
    }
  },
  "traceId": "189215191610245120"
}
```

### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `templateId` | string | 模板业务主键 |
| `schemaHash` | string | 当前启动参数 schema 哈希，用于后续保存/启动一致性校验 |
| `schema` | object | 启动参数定义，直接复用现有 startup 节点 JSON 结构 |

### 错误响应

| HTTP 状态码 | 场景 |
|------|------|
| `401` | 未登录或 token 无效 |
| `404` | 模板不存在或非系统模板 |
| `500` | 服务端内部错误 |

---

## 3. 保存用户流程草稿与默认启动参数草稿

```http
POST /agent/v1/workflows
```

### 说明

- 组合保存接口
- 一次性完成：
  - 创建用户流程草稿
  - 保存该流程草稿对应的默认启动参数草稿
- 不再先创建空流程草稿

### 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 否 | 流程名称；为空时服务端按现有默认逻辑命名 |
| `description` | string | 否 | 流程描述 |
| `templateId` | string | 是 | 系统模板业务主键 |
| `category` | string | 否 | 分类 |
| `startupPreset` | object | 是 | 默认启动参数草稿 |
| `idempotencyKey` | string | 建议是 | 幂等键 |
| `sourceClient` | string | 建议是 | 来源客户端标识 |

### `startupPreset` 字段

`startupPreset` 对齐现有 `SaveWorkflowPresetRequest` 核心结构。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 预设名称，建议统一传“默认启动配置” |
| `values` | object | 是 | 用户填写后的启动参数值 |
| `isDefault` | boolean | 是 | 组合保存场景应传 `true` |
| `schemaHash` | string | 是 | 必须来自模板启动参数查询接口 |

### 请求示例

```json
{
  "name": "我的合同审核流程",
  "description": "给客户端使用的合同审核流程",
  "templateId": "tpl_contract_review",
  "category": "legal",
  "startupPreset": {
    "name": "默认启动配置",
    "values": {
      "huizongweidu": [
        "wangdian",
        "kehu"
      ],
      "time": "2"
    },
    "isDefault": true,
    "schemaHash": "3a6ff85d959e4210c6f57f65ec1d89a0689de991f8f8e6b4bd79a759ce256736"
  },
  "idempotencyKey": "create-wf-20260605-001",
  "sourceClient": "client-a"
}
```

### 成功响应

```json
{
  "success": true,
  "data": {
    "workflow": {
      "id": "wf_usr_xxx",
      "schemaVersion": "workflow/v2",
      "name": "我的合同审核流程",
      "description": "给客户端使用的合同审核流程",
      "version": 1,
      "nodes": [],
      "edges": [],
      "startupSchema": {
        "nodeId": "startup_config_1780559578678",
        "enabled": true,
        "steps": [],
        "fields": []
      }
    },
    "defaultPreset": {
      "id": "preset_10f0563c51ed",
      "name": "默认启动配置",
      "workflowId": "wf_usr_xxx",
      "workflowVersionId": 1,
      "ownerUserId": "u_xxx",
      "values": {
        "huizongweidu": [
          "wangdian",
          "kehu"
        ],
        "time": "2"
      },
      "schemaHash": "3a6ff85d959e4210c6f57f65ec1d89a0689de991f8f8e6b4bd79a759ce256736",
      "isDefault": true,
      "status": "active",
      "createdAt": "2026-06-05T10:00:00Z",
      "updatedAt": "2026-06-05T10:00:00Z"
    }
  },
  "traceId": "189215191610245120"
}
```

### 最小必返字段

`workflow` 最少应包含：

- `id`
- `name`
- `version`
- `startupSchema`

`defaultPreset` 最少应包含：

- `id`
- `workflowId`
- `values`
- `schemaHash`
- `isDefault`

### 幂等规则

组合保存去重键建议为：

`ownerUserId + sourceClient + idempotencyKey`

规则：

- 相同去重键的重复请求：直接返回首次创建结果
- 相同去重键但核心参数不同：返回 `409`

### 错误响应

| HTTP 状态码 | 场景 |
|------|------|
| `401` | 未登录或 token 无效 |
| `404` | 模板不存在 |
| `409` | `schemaHash` 已失效，或相同幂等键但核心参数不同 |
| `422` | 启动参数缺失或不合法 |
| `500` | 服务端内部错误 |

---

## 4. 启动流程

```http
POST /agent/v1/workflows/{workflowId}/start
```

### 说明

- 基于已保存的默认启动参数草稿启动流程
- 允许本次请求传入 `inputs` 做覆盖
- 返回值直接复用现有 `WorkflowRunResponse`

### 路径参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workflowId` | string | 是 | 用户流程草稿业务主键 |

### 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `inputs` | object | 否 | 本次启动覆盖参数 |
| `presetId` | string | 否 | 指定使用的 preset；不传时优先取默认 preset |
| `agentContext` | object | 否 | 附加 agent 运行上下文 |
| `idempotencyKey` | string | 建议是 | 启动幂等键 |

### 请求示例

```json
{
  "inputs": {
    "time": "2",
    "huizongweidu": [
      "wangdian",
      "kehu"
    ]
  },
  "presetId": "preset_10f0563c51ed",
  "agentContext": {},
  "idempotencyKey": "start-wf-20260605-001"
}
```

### 成功响应

```json
{
  "success": true,
  "data": {
    "id": "run_xxx",
    "workflowId": "wf_usr_xxx",
    "status": "running",
    "mode": null,
    "startedAt": "2026-06-05T10:05:00Z",
    "completedAt": null,
    "waitingNodeId": null,
    "nodeRuns": [],
    "events": [],
    "approvalTasks": [],
    "userInputTasks": [],
    "artifacts": [],
    "toolInvocations": [],
    "input": {
      "inputs": {
        "time": "2",
        "huizongweidu": [
          "wangdian",
          "kehu"
        ]
      },
      "agentContext": {},
      "startup": {
        "schemaHash": "3a6ff85d959e4210c6f57f65ec1d89a0689de991f8f8e6b4bd79a759ce256736",
        "schema": {
          "nodeId": "startup_config_1780559578678",
          "enabled": true,
          "steps": [],
          "fields": []
        },
        "presetId": "preset_10f0563c51ed",
        "presetName": "默认启动配置",
        "presetVersionId": 7,
        "overrides": {
          "time": "2",
          "huizongweidu": [
            "wangdian",
            "kehu"
          ]
        },
        "resolvedInputs": {
          "time": "2",
          "huizongweidu": [
            "wangdian",
            "kehu"
          ]
        }
      }
    },
    "output": null,
    "startup": {
      "schemaHash": "3a6ff85d959e4210c6f57f65ec1d89a0689de991f8f8e6b4bd79a759ce256736",
      "schema": {
        "nodeId": "startup_config_1780559578678",
        "enabled": true,
        "steps": [],
        "fields": []
      },
      "presetId": "preset_10f0563c51ed",
      "presetName": "默认启动配置",
      "presetVersionId": 7,
      "overrides": {
        "time": "2",
        "huizongweidu": [
          "wangdian",
          "kehu"
        ]
      },
      "resolvedInputs": {
        "time": "2",
        "huizongweidu": [
          "wangdian",
          "kehu"
        ]
      }
    },
    "lastAgentRawText": null,
    "error": null
  },
  "traceId": "189215191610245120"
}
```

### 最小必返字段

- `id`
- `workflowId`
- `status`
- `startedAt`
- `input.startup`
- `error`

### 幂等规则

启动去重键建议为：

`ownerUserId + workflowId + idempotencyKey`

规则：

- 相同去重键的重复请求：返回同一个 `run`
- 相同去重键但 `presetId` 或 `inputs` 不同：返回 `409`

### 错误响应

| HTTP 状态码 | 场景 |
|------|------|
| `401` | 未登录或 token 无效 |
| `403` | 无权启动他人的 `workflowId` |
| `404` | `workflowId` 不存在 |
| `409` | `schemaHash` 失效，或相同幂等键但启动参数不同 |
| `422` | 启动参数缺失或不合法 |
| `500` | 服务端内部错误 |

---

## 5. 查询运行结果

```http
GET /agent/v1/runs/{runId}
```

### 说明

- 轮询查询运行状态
- 返回值直接复用现有 `WorkflowRunResponse`

### 路径参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `runId` | string | 是 | 运行实例业务主键 |

### 成功响应

```json
{
  "success": true,
  "data": {
    "id": "run_xxx",
    "workflowId": "wf_usr_xxx",
    "status": "running",
    "startedAt": "2026-06-05T10:05:00Z",
    "completedAt": null,
    "waitingNodeId": null,
    "input": {
      "inputs": {},
      "agentContext": {},
      "startup": {}
    },
    "output": null,
    "startup": {},
    "error": null
  },
  "traceId": "189215191610245120"
}
```

### 错误响应

| HTTP 状态码 | 场景 |
|------|------|
| `401` | 未登录或 token 无效 |
| `403` | 无权查看他人的 `runId` |
| `404` | `runId` 不存在 |
| `500` | 服务端内部错误 |

---

## 6. 订阅运行结果

```http
GET /agent/v1/runs/{runId}/stream
```

### 说明

- SSE 持续推送运行状态变化
- 若客户端不支持 SSE，可退化为轮询 `GET /agent/v1/runs/{runId}`

### 路径参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `runId` | string | 是 | 运行实例业务主键 |

### 成功响应

响应头：

```http
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

说明：

- SSE 接口不使用 `success/data/traceId` JSON 包裹
- `traceId` 仍通过响应头 `X-Trace-Id` 回传

事件格式：

```text
event: run.update
data: {"id":"run_xxx","workflowId":"wf_usr_xxx","status":"running"}
```

### 错误响应

| HTTP 状态码 | 场景 |
|------|------|
| `401` | 未登录或 token 无效 |
| `403` | 无权查看他人的 `runId` |
| `404` | `runId` 不存在 |
| `500` | 服务端内部错误 |

---

## 状态码总表

| HTTP 状态码 | 说明 |
|------|------|
| `200` | 查询成功 |
| `401` | 未登录或 token 无效 |
| `403` | 无权访问当前资源 |
| `404` | 资源不存在 |
| `409` | 状态冲突、schema 失效、幂等键冲突 |
| `422` | 请求参数或启动参数校验失败 |
| `500` | 服务端内部错误 |

---

## 备注

- `workflowId`：用户流程草稿主键
- `runId`：流程运行实例主键
- `schemaHash`：启动参数 schema 版本标识，客户端应透传，不应自行生成
- `startupPreset`：对外语义是“启动参数草稿”，对内实现可复用现有 preset 能力
