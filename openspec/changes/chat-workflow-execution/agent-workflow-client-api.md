# Agent Workflow Client API

> `stoToken` 鉴权接口。面向外部客户端开放的工作流能力，统一挂在 `/agent/v1` 下。

## 概览

当前一期开放 6 个接口：

```http
POST /agent/v1/workflow-templates
GET  /agent/v1/workflow-templates/{templateId}/startup-schema
POST /agent/v1/workflows
POST /agent/v1/workflows/{workflowId}/start
GET  /agent/v1/runs/{runId}
GET  /agent/v1/runs/{runId}/stream
```

完整调用链路：

1. 查询系统模板（分页 / 可选关键词）
2. 查询模板启动参数
3. 保存用户流程草稿与默认启动参数草稿
4. 启动流程
5. 查询或订阅运行结果

## 完整联调示例

下面用一条真实联调链路说明客户端如何从“查询模板”一直走到“查看运行结果”。

### Step 1. 查询工作流模板

请求：

```http
POST /agent/v1/workflow-templates
stoToken: xxx
X-Trace-Id: 189286878971117568
X-Source-Client: client-a
Content-Type: application/json
```

```json
{
  "query": "结算对账",
  "page": 1,
  "pageSize": 10
}
```

响应：

```json
{
  "success": true,
  "data": [
    {
      "id": "tpl_61afd1ae",
      "label": "结算对账流程",
      "description": "制作一份结算对账报表",
      "category": "通用",
      "scope": "system",
      "nodeCount": 4,
      "nodes": [
        {
          "id": "trigger_1",
          "type": "trigger",
          "name": "开始方式"
        },
        {
          "id": "check_bill_config_1",
          "type": "startup_config",
          "name": "启动配置"
        },
        {
          "id": "agent_task_1780804497810",
          "type": "agent_task",
          "name": "智能处理"
        },
        {
          "id": "output_1780813808607",
          "type": "output",
          "name": "保存结果"
        }
      ],
      "edges": [
        {
          "id": "edge_1",
          "source": "trigger_1",
          "target": "check_bill_config_1",
          "condition": null
        },
        {
          "id": "edge_1780804500853",
          "source": "check_bill_config_1",
          "target": "agent_task_1780804497810",
          "condition": null
        },
        {
          "id": "edge_1780813812773",
          "source": "agent_task_1780804497810",
          "target": "output_1780813808607",
          "condition": null
        }
      ]
    }
  ],
  "total": 19,
  "page": 1,
  "pageSize": 10,
  "traceId": "189286878971117568"
}
```

本步客户端需要记住：

- `templateId = tpl_61afd1ae`

### Step 2. 查询模板启动参数

请求：

```http
GET /agent/v1/workflow-templates/tpl_61afd1ae/startup-schema
stoToken: xxx
X-Trace-Id: 189268196596793344
X-Source-Client: client-a
```

响应：

```json
{
  "success": true,
  "traceId": "189268196596793344",
  "data": {
    "templateId": "tpl_61afd1ae",
    "schemaHash": "e310e4b4e078af409cb6ff73f5f0a4fedc8a0d4d142807220c1117b271c60500",
    "schema": {
      "nodeId": "check_bill_config_1",
      "enabled": true,
      "steps": [
        {
          "id": "step_1",
          "title": "对账周期",
          "mode": "confirm",
          "order": 10
        },
        {
          "id": "step_2",
          "title": "对账项",
          "mode": "confirm",
          "order": 20
        },
        {
          "id": "step_3",
          "title": "告警规则",
          "mode": "confirm",
          "order": 30
        }
      ],
      "fields": [
        {
          "key": "check_cycle",
          "label": "对账周期",
          "group": "step_1",
          "component": "single_select",
          "required": true
        },
        {
          "key": "check_items",
          "label": "我会为你输出账单的整体情况以及异常波动，选择重点关注内容",
          "group": "step_2",
          "component": "multi_select",
          "required": true
        },
        {
          "key": "alarm_rlues",
          "label": "告警规则",
          "group": "step_3",
          "component": "editable_list",
          "required": true
        }
      ]
    }
  }
}
```

本步客户端需要记住：

- `schemaHash = e310e4b4e078af409cb6ff73f5f0a4fedc8a0d4d142807220c1117b271c60500`
- 表单字段 key：
  - `check_cycle`
  - `check_items`
  - `alarm_rlues`

### Step 3. 保存用户流程草稿与默认启动参数

请求：

```http
POST /agent/v1/workflows
stoToken: xxx
X-Trace-Id: 189291225619087360
X-Source-Client: client-a
Content-Type: application/json
```

```json
{
  "displayName": "结算对账流程",
  "templateId": "tpl_61afd1ae",
  "startup": {
    "schemaHash": "e310e4b4e078af409cb6ff73f5f0a4fedc8a0d4d142807220c1117b271c60500",
    "values": {
      "check_cycle": "daily",
      "check_items": [
        "KHJL",
        "MDFL"
      ],
      "alarm_rlues": [
        "较昨日金额>100元提醒",
        "环比昨日>20%提醒"
      ]
    }
  },
  "idempotencyKey": "create-wf-20260607-001"
}
```

响应：

```json
{
  "success": true,
  "traceId": "189291225619087360",
  "data": {
    "workflowId": "wf_68503352",
    "workflowName": "结算对账流程",
    "defaultPresetId": "preset_dcb7dc5b4938",
    "schemaHash": "e310e4b4e078af409cb6ff73f5f0a4fedc8a0d4d142807220c1117b271c60500",
    "startupValues": {
      "check_cycle": "daily",
      "check_items": [
        "KHJL",
        "MDFL"
      ],
      "alarm_rlues": [
        "较昨日金额>100元提醒",
        "环比昨日>20%提醒"
      ]
    }
  }
}
```

本步客户端需要记住：

- `workflowId = wf_68503352`

### Step 4. 启动流程

请求路径：

```http
POST /agent/v1/workflows/wf_68503352/start
```

请求：

```http
stoToken: xxx
X-Trace-Id: 189296145174970368
X-Source-Client: client-a
Content-Type: application/json
```

```json
{
  "idempotencyKey": "uid1-wf_68503352",
  "inputs": {
    "check_cycle": "daily",
    "check_items": [
      "KHJL",
      "MDFL"
    ],
    "alarm_rlues": [
      "较昨日金额>100元提醒",
      "环比昨日>20%提醒"
    ]
  }
}
```

响应：

```json
{
  "success": true,
  "traceId": "189296145174970368",
  "data": {
    "runId": "run_ec60a524-c3cb-4d19-b7cc-fdb467358585",
    "workflowId": "wf_68503352",
    "status": "running",
    "startedAt": "2026-06-07T08:35:18",
    "queryUrl": "/agent/v1/runs/run_ec60a524-c3cb-4d19-b7cc-fdb467358585",
    "streamUrl": "/agent/v1/runs/run_ec60a524-c3cb-4d19-b7cc-fdb467358585/stream"
  }
}
```

本步客户端需要记住：

- `runId = run_ec60a524-c3cb-4d19-b7cc-fdb467358585`

### Step 5. 查询运行结果

请求：

```http
GET /agent/v1/runs/run_ec60a524-c3cb-4d19-b7cc-fdb467358585
stoToken: xxx
X-Trace-Id: 189278612342489088
X-Source-Client: client-a
```

响应示例：

```json
{
  "success": true,
  "traceId": "189278612342489088",
  "data": {
    "id": "run_ec60a524-c3cb-4d19-b7cc-fdb467358585",
    "workflowId": "wf_68503352",
    "status": "succeeded",
    "startedAt": "2026-06-07T14:36:34+08:00",
    "completedAt": "2026-06-07T14:36:34+08:00",
    "result": {
      "title": "智能处理完成",
      "summary": "每日对账智能处理已完成。检查项：考核激励(KHJL)、面单返利(MDFL)；告警规则：较昨日金额>100元提醒、环比昨日>20%提醒。当前无触发告警的异常项。",
      "status": "succeeded",
      "data": {
        "check_cycle": "daily",
        "check_items": [
          "KHJL",
          "MDFL"
        ],
        "alarm_rules": [
          "较昨日金额>100元提醒",
          "环比昨日>20%提醒"
        ]
      }
    },
    "startup": {
      "resolvedInputs": {
        "check_cycle": "daily",
        "check_items": [
          "KHJL",
          "MDFL"
        ],
        "alarm_rlues": [
          "较昨日金额>100元提醒",
          "环比昨日>20%提醒"
        ]
      }
    },
    "artifacts": [],
    "error": null
  }
}
```

### 串联关键字段总结

| 步骤 | 关键字段 | 下游用途 |
|------|------|------|
| Step 1 搜模板 | `templateId` | Step 2、Step 3 |
| Step 2 查启动参数 | `schemaHash`、`fields[*].key` | Step 3、Step 4 |
| Step 3 保存流程 | `workflowId` | Step 4、Step 5 |
| Step 4 查询流程详情（可选） | `nodes`、`edges`、`startup` | 流程预览、参数回显 |
| Step 5 启动流程 | `runId` | Step 6、Step 7 |

### 客户端最小实现建议

1. 第 1 步拿到 `templateId`
2. 第 2 步拿到 `schemaHash` 和 `fields[*].key`
3. 将用户填写结果按 `key -> value` 组装成 `startup.values`
4. 第 3 步保存后拿到 `workflowId`
5. （可选）第 4 步用 `workflowId` 查询流程详情，用于预览节点与启动参数回显
6. 第 5 步用 `workflowId` 启动，拿到 `runId`
7. 第 6 步轮询 `/agent/v1/runs/{runId}`，或订阅 SSE

除 `GET /agent/v1/runs/{runId}/stream` 这类 SSE 流式接口外，所有 JSON 成功响应统一使用以下外层结构：

```json
{
  "success": true,
  "data": {},
  "traceId": "189215191610245120"
}
```

### JSON 成功响应外层字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 成功响应固定为 `true` |
| `data` | object | 实际业务响应体，不同接口结构不同 |
| `traceId` | string | 本次请求链路追踪 ID；与响应头 `X-Trace-Id` 保持一致 |

---

## 鉴权

所有接口均要求携带 `stoToken`。

### 请求头

| Header | 必填 | 说明 |
|------|------|------|
| `stoToken` | 是 | 当前登录用户 token |
| `X-Source-Client` | 建议是 | 调用方客户端标识，用于来源追踪与幂等隔离 |

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

## 1. 查询工作流模板（分页）

```http
POST /agent/v1/workflow-templates
```

### 说明

当客户端不走自然语言搜索，而是希望直接浏览系统模板列表时，可调用分页接口。

- `query` 可选，按 `template_id` / `name` / `description` 做模糊查询；不传时默认分页查全部系统模板
- 仅返回系统模板（`scope = system`）
- 分页从第 `1` 页开始

### 请求体

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|------|------|
| `query` | string | 否 | - | 按 `template_id` / `name` / `description` 模糊查询 |
| `page` | integer | 否 | `1` | 页码，从 `1` 开始 |
| `pageSize` | integer | 否 | `10` | 每页条数 |

### 请求示例

```json
{
  "query": "结算",
  "page": 1,
  "pageSize": 10
}
```

### 成功响应

```json
{
  "success": true,
  "data": [
    {
      "id": "tpl_61afd1ae",
      "label": "结算对账流程",
      "description": "制作一份结算对账报表",
      "category": "通用",
      "scope": "system",
      "nodeCount": 4,
      "nodes": [
        {
          "id": "trigger_1",
          "type": "trigger",
          "name": "开始方式"
        }
      ],
      "edges": []
    }
  ],
  "total": 19,
  "page": 1,
  "pageSize": 10,
  "traceId": "189312518965379073"
}
```

### 响应字段说明

外层字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 固定为 `true` |
| `data` | array | 当前页模板列表 |
| `total` | integer | 满足查询条件的模板总数 |
| `page` | integer | 当前页码 |
| `pageSize` | integer | 当前每页条数 |
| `traceId` | string | 链路追踪 ID |

模板项字段：`data[*]`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 系统模板业务主键，即 `templateId` |
| `label` | string | 模板名称 |
| `description` | string \| null | 模板描述 |
| `category` | string \| null | 模板分类 |
| `scope` | string \| null | 模板范围；当前客户端接口固定只返回 `system` |
| `nodeCount` | integer | 模板中节点数量 |
| `nodes` | array | 模板节点摘要列表，用于客户端轻量展示 |
| `nodes[*].id` | string | 节点 ID |
| `nodes[*].type` | string | 节点类型 |
| `nodes[*].name` | string | 节点名称 |
| `edges` | array | 模板边摘要列表；当前仅用于补充展示或调试 |

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
    "templateId": "tpl_61afd1ae",
    "schemaHash": "e310e4b4e078af409cb6ff73f5f0a4fedc8a0d4d142807220c1117b271c60500",
    "schema": {
      "nodeId": "check_bill_config_1",
      "enabled": true,
      "steps": [
        {
          "id": "step_1",
          "title": "对账周期",
          "mode": "confirm",
          "order": 10
        },
        {
          "id": "step_2",
          "title": "对账项",
          "mode": "confirm",
          "order": 20
        },
        {
          "id": "step_3",
          "title": "告警规则",
          "mode": "confirm",
          "order": 30
        }
      ],
      "fields": [
        {
          "key": "check_cycle",
          "label": "对账周期",
          "group": "step_1",
          "component": "single_select",
          "required": true,
          "order": 10,
          "options": [
            {
              "value": "daily",
              "label": "每天对一次账",
              "description": "昨日全天 · 00:00~23:59（默认）"
            }
          ],
          "groupTitle": "对账周期",
          "description": "用户启动后需要先指定对账的周期",
          "sourceNodes": [
            "agent_task_1779887624967"
          ]
        },
        {
          "key": "check_items",
          "label": "我会为你输出账单的整体情况以及异常波动，选择重点关注内容",
          "group": "step_2",
          "component": "multi_select",
          "required": true,
          "order": 20,
          "options": [
            {
              "value": "KHJL",
              "label": "考核激励",
              "description": "考核激励"
            }
          ],
          "groupTitle": "对账项",
          "description": "重点关注内容工 默认：考核激励、面单返利、新增费用科目",
          "sourceNodes": [
            "agent_task_1780804497810"
          ]
        },
        {
          "key": "alarm_rlues",
          "label": "告警规则",
          "group": "step_3",
          "component": "editable_list",
          "required": true,
          "order": 30,
          "options": [],
          "groupTitle": "告警规则",
          "defaultValue": [
            "较昨日金额>100元提醒",
            "环比昨日>20%提醒"
          ],
          "sourceNodes": [
            "agent_task_1780804497810"
          ]
        }
      ]
    }
  },
  "traceId": "189215191610245120"
}
```

### 响应字段说明

外层字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 固定为 `true` |
| `data.templateId` | string | 系统模板业务主键 |
| `data.schemaHash` | string | 当前启动参数 schema 哈希 |
| `data.schema` | object | 启动参数 schema 对象 |
| `traceId` | string | 请求链路 ID |

`data.schema` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `nodeId` | string | `startup_config` 节点 ID |
| `enabled` | boolean | 是否启用启动参数；为 `false` 时表示该模板无需额外启动参数 |
| `steps` | array | 启动参数步骤定义，用于分步展示 |
| `steps[*].id` | string | 步骤 ID |
| `steps[*].title` | string | 步骤标题 |
| `steps[*].mode` | string \| null | 步骤模式；当前示例为 `confirm`，表示该步骤用于用户确认填写 |
| `steps[*].order` | integer | 步骤排序，值越小越靠前 |
| `fields` | array | 启动参数字段定义 |
| `fields[*].key` | string | 参数键；客户端提交 `values`、`inputs` 时必须使用该 key，服务端按此 key 取值 |
| `fields[*].label` | string | 参数展示名称；客户端应直接展示给用户 |
| `fields[*].group` | string \| null | 所属步骤 ID；客户端可据此将字段归到对应 step 下 |
| `fields[*].groupTitle` | string \| null | 所属分组标题；通常与步骤标题一致，可直接用于表单分组标题 |
| `fields[*].component` | string | 推荐渲染组件类型。当前已出现：`single_select` 单选、`multi_select` 多选、`editable_list` 可编辑字符串列表 |
| `fields[*].required` | boolean | 是否必填 |
| `fields[*].order` | integer | 字段排序，值越小越靠前 |
| `fields[*].description` | string \| null | 字段说明；建议客户端在字段下方作为提示文案展示 |
| `fields[*].options` | array | 选项型字段的候选项；`single_select` / `multi_select` 通常会有值，`editable_list` 这类自由输入组件通常为空数组 |
| `fields[*].options[*].value` | string | 选项值；客户端实际提交该值 |
| `fields[*].options[*].label` | string | 选项展示文案 |
| `fields[*].options[*].description` | string \| null | 选项补充说明；建议作为次级提示文案展示 |
| `fields[*].defaultValue` | any | 字段默认值；仅在部分组件存在，例如 `editable_list` 可直接带默认字符串数组 |
| `fields[*].sourceNodes` | string[] | 该参数来源节点 ID 列表，主要用于排障、配置溯源或高级展示，普通客户端可不使用 |

### 客户端渲染建议

| `component` 值 | 建议渲染方式 | 提交值格式 |
|------|------|------|
| `single_select` | 单选框 / 下拉单选 | `string` |
| `multi_select` | 多选框 / 多选下拉 | `string[]` |
| `editable_list` | 可新增/删除项的文本列表 | `string[]` |

### 重要约定

- 客户端提交启动参数时，字段名必须使用 `fields[*].key`
- `required=true` 的字段必须提交非空值，否则后端会返回 `422`
- `options` 不为空时，客户端提交值应尽量限制在候选值范围内
- `defaultValue` 存在时，客户端若未做额外编辑，建议直接以默认值回填表单
- `sourceNodes` 不是提交参数，不应回传给服务端

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
- 保存成功后返回轻量确认响应，不默认回传完整流程定义

### 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `displayName` | string | 否 | 流程展示名称；为空时服务端按模板名称自动生成 |
| `templateId` | string | 是 | 系统模板业务主键 |
| `startup` | object | 是 | 用户基于模板启动参数 schema 填写后的启动参数内容 |
| `idempotencyKey` | string | 建议是 | 幂等键 |

### `startup` 字段

`startup` 面向客户端表达“本次基于模板填写的启动参数”，服务端收到后会内部落成该流程的默认 preset。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `schemaHash` | string | 是 | 必须来自模板启动参数查询接口 |
| `values` | object | 是 | 用户填写后的启动参数值；key 必须对应模板 schema 中 `fields[*].key` |

### 请求示例

```json
{
  "displayName": "我的合同审核流程",
  "templateId": "tpl_contract_review",
  "startup": {
    "schemaHash": "3a6ff85d959e4210c6f57f65ec1d89a0689de991f8f8e6b4bd79a759ce256736",
    "values": {
      "huizongweidu": [
        "wangdian",
        "kehu"
      ],
      "time": "2"
    }
  },
  "idempotencyKey": "create-wf-20260605-001"
}
```

请求头示例：

```http
stoToken: xxx
X-Trace-Id: 189215191610245120
X-Source-Client: client-a
```

### 成功响应

```json
{
  "success": true,
  "data": {
    "workflowId": "wf_7756bd08",
    "workflowName": "结算对账流程",
    "defaultPresetId": "preset_dcb7dc5b4938",
    "schemaHash": "e310e4b4e078af409cb6ff73f5f0a4fedc8a0d4d142807220c1117b271c60500",
    "startupValues": {
      "check_cycle": "daily",
      "check_items": [
        "KHJL",
        "MDFL"
      ],
      "alarm_rlues": [
        "较昨日金额>100元提醒",
        "环比昨日>20%提醒"
      ]
    }
  },
  "traceId": "189291225619087360"
}
```

### 最小必返字段

- `workflowId`
- `workflowName`
- `defaultPresetId`
- `schemaHash`
- `startupValues`

### 响应字段说明

外层字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 固定为 `true` |
| `data` | object | 保存确认响应 |
| `traceId` | string | 请求链路 ID |

`data` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `workflowId` | string | 新创建的用户流程草稿业务主键；后续启动流程时使用 |
| `workflowName` | string | 最终保存的流程名称 |
| `defaultPresetId` | string | 当前流程默认启动参数 preset 主键 |
| `schemaHash` | string | 当前绑定的启动参数 schema 哈希 |
| `startupValues` | object | 当前保存的启动参数值，key 与模板启动参数 schema 中 `fields[*].key` 对应 |

### 默认不返回的重数据

以下字段更适合单独的流程详情接口或管理端视图，保存接口默认不建议返回：

- 完整 `workflow.nodes`
- 完整 `workflow.edges`
- 节点 `config`
- 完整 `startupSchema`
- preset 的内部元数据，如 `ownerUserId`、`workflowVersionId`

### 请求组装规则

客户端应按以下方式将“查询模板启动参数”接口返回结果转换为本接口请求：

1. 直接透传上一步返回的 `data.templateId`
2. 直接透传上一步返回的 `data.schemaHash` 到 `startup.schemaHash`
3. 遍历上一步返回的 `data.schema.fields`
4. 以每个 `fields[*].key` 作为 `startup.values` 的字段名
5. 以用户实际填写结果作为 `startup.values[key]` 的字段值
6. 若客户端需要自定义流程名称，可额外传 `displayName`
7. `X-Source-Client` 放到请求头，不放在业务请求体里

映射示例：

- `fields[*].key = check_cycle` -> `startup.values.check_cycle = "daily"`
- `fields[*].key = check_items` -> `startup.values.check_items = ["KHJL", "MDFL"]`
- `fields[*].key = alarm_rlues` -> `startup.values.alarm_rlues = ["较昨日金额>100元提醒", "环比昨日>20%提醒"]`

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

## 4. 查询流程详情

```http
GET /agent/v1/workflows/{workflowId}
```

### 说明

- 客户端根据前面步骤返回的 `workflowId` 查询整个流程详情
- 返回该流程草稿的完整定义
- 同时返回当前流程的启动参数 schema 与当前用户默认启动参数
- 适合客户端做流程预览、流程回显、启动参数回显

### 路径参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workflowId` | string | 是 | 用户流程草稿业务主键 |

### 请求示例

```http
GET /agent/v1/workflows/wf_68503352
stoToken: xxx
X-Trace-Id: 189330001122334455
X-Source-Client: client-a
```

### 成功响应

```json
{
  "success": true,
  "traceId": "189330001122334455",
  "data": {
    "workflowId": "wf_68503352",
    "workflowName": "结算对账流程",
    "description": "制作一份结算对账报表",
    "schemaVersion": "workflow/v2",
    "version": 1,
    "nodes": [
      {
        "id": "trigger_1",
        "type": "trigger",
        "name": "开始方式"
      },
      {
        "id": "check_bill_config_1",
        "type": "startup_config",
        "name": "启动配置"
      }
    ],
    "edges": [
      {
        "id": "edge_1",
        "source": "trigger_1",
        "target": "check_bill_config_1"
      }
    ],
    "startup": {
      "schemaHash": "e310e4b4e078af409cb6ff73f5f0a4fedc8a0d4d142807220c1117b271c60500",
      "schema": {
        "nodeId": "check_bill_config_1",
        "enabled": true,
        "steps": [],
        "fields": []
      },
      "defaultPreset": {
        "id": "preset_dcb7dc5b4938",
        "name": "默认启动配置",
        "workflowId": "wf_68503352",
        "workflowVersionId": 14,
        "ownerUserId": "uid1",
        "values": {
          "check_cycle": "daily",
          "check_items": [
            "KHJL",
            "MDFL"
          ],
          "alarm_rlues": [
            "较昨日金额>100元提醒",
            "环比昨日>20%提醒"
          ]
        },
        "schemaHash": "e310e4b4e078af409cb6ff73f5f0a4fedc8a0d4d142807220c1117b271c60500",
        "isDefault": true,
        "status": "ACTIVE",
        "createdAt": "2026-06-07T08:30:00",
        "updatedAt": "2026-06-07T08:30:00"
      }
    }
  }
}
```

### 响应字段说明

`data` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `workflowId` | string | 用户流程草稿业务主键 |
| `workflowName` | string | 流程名称 |
| `description` | string/null | 流程描述 |
| `schemaVersion` | string/null | 流程定义 schema 版本 |
| `version` | number | 当前流程版本号 |
| `nodes` | array | 流程节点列表，客户端可用于流程预览 |
| `edges` | array | 流程连线列表，客户端可用于流程预览 |
| `startup` | object | 当前流程的启动参数配置详情 |

`startup` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `schemaHash` | string | 当前流程启动参数 schema 哈希 |
| `schema` | object | 当前流程启动参数 schema |
| `defaultPreset` | object/null | 当前用户在该流程下保存的默认启动参数；不存在时为 `null` |

`defaultPreset` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 默认启动参数 preset 主键 |
| `name` | string | preset 名称，当前默认固定为“默认启动配置” |
| `workflowId` | string | 所属流程业务主键 |
| `workflowVersionId` | number | 当前 preset 绑定的流程版本主键 |
| `ownerUserId` | string | preset 所属用户 |
| `values` | object | 默认启动参数值 |
| `schemaHash` | string | 保存该 preset 时对应的 schema 哈希 |
| `isDefault` | boolean | 是否为默认 preset |
| `status` | string | preset 状态 |
| `createdAt` | string/null | 创建时间 |
| `updatedAt` | string/null | 更新时间 |

### 错误响应

| HTTP 状态码 | 场景 |
|------|------|
| `401` | 未登录或 token 无效 |
| `403` | 无权访问该流程 |
| `404` | 流程不存在 |
| `500` | 服务端内部错误 |

---

## 5. 启动流程

```http
POST /agent/v1/workflows/{workflowId}/start
```

### 说明

- 基于已保存的默认启动参数草稿启动流程
- 允许本次请求传入 `inputs` 做覆盖
- 启动成功后返回轻量确认响应
- 运行过程与最终结果通过 `GET /agent/v1/runs/{runId}` 或 SSE 接口查询
- 标准串联路径下，客户端在第 3 步保存成功后，只需拿到 `workflowId` 即可直接调用本接口，不需要再传 `presetId`

### 路径参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workflowId` | string | 是 | 用户流程草稿业务主键 |

### 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `inputs` | object | 否 | 本次启动覆盖参数 |
| `agentContext` | object | 否 | 附加 agent 运行上下文 |
| `idempotencyKey` | string | 是 | 启动幂等键 |

### 请求示例

```json
{
  "idempotencyKey": "uid1-wf_68503352",
  "inputs": {
    "check_cycle": "daily",
    "check_items": [
      "KHJL",
      "MDFL"
    ],
    "alarm_rlues": [
      "较昨日金额>100元提醒",
      "环比昨日>20%提醒"
    ]
  }
}
```

带覆盖值启动示例：

```json
{
  "idempotencyKey": "uid1-wf_68503352-override",
  "inputs": {
    "check_cycle": "weekly"
  }
}
```

### 成功响应

```json
{
  "success": true,
  "data": {
    "runId": "run_ec60a524-c3cb-4d19-b7cc-fdb467358585",
    "workflowId": "wf_68503352",
    "status": "running",
    "startedAt": "2026-06-07T08:35:18",
    "queryUrl": "/agent/v1/runs/run_ec60a524-c3cb-4d19-b7cc-fdb467358585",
    "streamUrl": "/agent/v1/runs/run_ec60a524-c3cb-4d19-b7cc-fdb467358585/stream"
  },
  "traceId": "189296145174970368"
}
```

### 最小必返字段

- `runId`
- `workflowId`
- `status`
- `startedAt`
- `queryUrl`

### 响应字段说明

外层字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 固定为 `true` |
| `data` | object | 启动确认响应 |
| `traceId` | string | 请求链路 ID |

`data` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `runId` | string | 运行实例业务主键；客户端后续查询或订阅运行结果时使用 |
| `workflowId` | string | 所属用户流程草稿主键 |
| `status` | string | 启动后的当前运行状态；通常为 `running` |
| `startedAt` | string \| null | 启动时间，建议返回带时区的 ISO-8601 |
| `queryUrl` | string \| null | 查询本次运行结果的相对路径 |
| `streamUrl` | string \| null | 订阅本次运行结果的 SSE 相对路径 |

### 串联方式

标准串联链路如下：

1. 第 3 步保存接口返回 `workflowId`
2. 客户端调用本接口时只传 `idempotencyKey`
3. 服务端自动读取该 `workflowId` 对应的默认启动参数并发起运行

客户端仅在需要“临时覆盖默认启动参数”时，才额外传 `inputs`

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

## 6. 查询运行结果

```http
GET /agent/v1/runs/{runId}
```

### 说明

- 轮询查询运行状态与最终结果
- 默认返回“客户端结果视图”，不是管理端调试视图
- 重点面向客户端展示最终结果、结果摘要、实际启动参数、产物与错误信息

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
    "status": "succeeded",
    "startedAt": "2026-06-07T14:36:34+08:00",
    "completedAt": "2026-06-07T14:36:34+08:00",
    "result": {
      "title": "智能处理完成",
      "summary": "每日对账智能处理已完成。检查项：考核激励(KHJL)、面单返利(MDFL)；告警规则：较昨日金额>100元提醒、环比昨日>20%提醒。当前无触发告警的异常项。",
      "status": "succeeded",
      "data": {
        "check_cycle": "daily",
        "check_items": [
          "KHJL",
          "MDFL"
        ],
        "alarm_rules": [
          "较昨日金额>100元提醒",
          "环比昨日>20%提醒"
        ],
        "result": {
          "message": "已完成每日对账智能处理，针对考核激励(KHJL)、面单返利(MDFL)两项进行异常波动检测。",
          "alerts": [],
          "checked_items": [
            {
              "code": "KHJL",
              "name": "考核激励",
              "status": "checked",
              "alarms_triggered": []
            },
            {
              "code": "MDFL",
              "name": "面单返利",
              "status": "checked",
              "alarms_triggered": []
            }
          ],
          "summary_stats": {
            "total_check_items": 2,
            "total_alerts": 0,
            "alarm_rules_applied": 2
          }
        }
      }
    },
    "startup": {
      "resolvedInputs": {
        "check_cycle": "daily",
        "check_items": [
          "KHJL",
          "MDFL"
        ],
        "alarm_rlues": [
          "较昨日金额>100元提醒",
          "环比昨日>20%提醒"
        ]
      }
    },
    "artifacts": [
      {
        "id": "artifact_2ef672173e37",
        "nodeId": "output_1780813808607",
        "kind": "output",
        "uri": "artifact://run_xxx/output/result.json",
        "filePath": "workflow/runs/run_xxx/artifacts/output.json",
        "contentType": "application/json",
        "summary": null,
        "createdAt": "2026-06-07T14:36:34+08:00"
      }
    ],
    "error": null
  },
  "traceId": "189215191610245120"
}
```

### 响应字段说明

外层字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 固定为 `true` |
| `data` | object | 运行实例的客户端结果视图 |
| `traceId` | string | 请求链路 ID |

`data` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 运行实例业务主键，即 `runId` |
| `workflowId` | string | 所属用户流程草稿主键 |
| `status` | string | 运行状态，如 `running`、`succeeded`、`failed`、`cancelled` |
| `startedAt` | string \| null | 启动时间，建议返回带时区的 ISO-8601 |
| `completedAt` | string \| null | 完成时间，未结束时为空 |
| `result` | object \| null | 客户端应优先展示的结果对象 |
| `startup` | object \| null | 本次运行最终使用的启动参数 |
| `artifacts` | array | 本次运行输出产物列表 |
| `error` | string \| null | 失败原因；成功时通常为空 |

`data.result` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | string \| null | 结果标题；建议客户端作为主标题展示 |
| `summary` | string \| null | 结果摘要；建议客户端作为结果说明展示 |
| `status` | string \| null | 结果状态，通常与运行状态一致 |
| `data` | object \| null | 业务结果明细；结构由具体工作流决定 |

`data.result.data` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `check_cycle` | string | 本次运行使用的对账周期 |
| `check_items` | string[] | 本次运行重点关注的对账项编码列表 |
| `alarm_rules` | string[] | 本次运行应用的告警规则列表 |
| `result` | object | 业务结果主体 |

`data.result.data.result` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `message` | string \| null | 结果说明文案 |
| `alerts` | array | 告警列表；无告警时为空数组 |
| `checked_items` | array | 已检查项目列表 |
| `summary_stats` | object | 结果统计摘要 |

`data.result.data.result.checked_items[*]` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | string | 对账项编码 |
| `name` | string | 对账项名称 |
| `status` | string | 当前检查状态 |
| `alarms_triggered` | array | 该项触发的告警列表 |

`data.result.data.result.summary_stats` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `total_check_items` | integer | 检查项总数 |
| `total_alerts` | integer | 告警总数 |
| `alarm_rules_applied` | integer | 实际应用的告警规则数量 |

`data.startup` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `resolvedInputs` | object | 服务端最终解析后参与运行的启动参数；客户端可用于“本次运行参数回显” |

`data.artifacts[*]` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 产物业务主键 |
| `nodeId` | string | 产生产物的节点 ID |
| `kind` | string | 产物类型，如 `output` |
| `uri` | string | 产物访问 URI |
| `filePath` | string \| null | 服务端内部文件路径；客户端通常无需展示 |
| `contentType` | string \| null | 产物内容类型 |
| `summary` | string \| null | 产物摘要 |
| `createdAt` | string \| null | 产物创建时间 |

### 默认不返回的调试信息

以下字段更适合管理端调试视图，客户端默认结果接口不建议返回：

- `nodeRuns`
- `events`
- `approvalTasks`
- `userInputTasks`
- `toolInvocations`
- `lastAgentRawText`
- 顶层完整 `startup.schema`
- 各节点的详细 `input/output`

### 错误响应

| HTTP 状态码 | 场景 |
|------|------|
| `401` | 未登录或 token 无效 |
| `403` | 无权查看他人的 `runId` |
| `404` | `runId` 不存在 |
| `500` | 服务端内部错误 |

---

## 7. 订阅运行结果

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

### SSE 事件字段说明

事件名：

| 字段 | 类型 | 说明 |
|------|------|------|
| `event` | string | 当前固定为 `run.update` |

事件 `data` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 运行实例业务主键，即 `runId` |
| `workflowId` | string | 所属用户流程草稿主键 |
| `status` | string | 当前运行状态 |

说明：

- 当前 SSE 推送的是运行态快照，字段结构与 `GET /agent/v1/runs/{runId}` 的 `data` 兼容
- 客户端至少应依赖 `id`、`workflowId`、`status` 处理状态更新
- 当 `status` 进入 `succeeded`、`failed`、`cancelled` 时，可视为本次流结束

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

- `displayName`：客户端可选传入的流程展示名称，不传时服务端可按模板名称自动生成
- `workflowId`：用户流程草稿主键
- `runId`：流程运行实例主键
- `schemaHash`：启动参数 schema 版本标识，客户端应透传，不应自行生成
- `startup`：对外语义是“用户基于模板填写的启动参数”；服务端内部会将其保存为当前流程的默认启动参数 preset
