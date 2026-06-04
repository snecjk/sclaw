# 大模型对接方式 —— 模型服务中心直连 + 计费中心

## Context

当前系统通过 STO AI Memory Center (`baseinfo-aimemory.sto.cn`) 对接模型能力，包含模型列表同步（`StoModelSyncService`）、Token 配额查询（`StoTokenQuotaService`）、功能订阅（`StoSubscriptionService`）、业务 Agent 同步（`StoBizAgentSyncService`）等模块。

本次改造目标：**废弃旧的 Memory Center 对接，切换为直接对接公司模型服务中心**（已存在，OpenAI 兼容）。同时新增**模型计费中心**功能，支持管理员购买套餐、查看余额、分配资源给子账户，子账户可查看余额和购买个人包。

## Goals / Non-Goals

**Goals**

- 客户端直连模型服务中心（OpenAI 兼容接口），用用户 AK 鉴权
- 新增计费中心菜单：购买套餐、套餐余额、消耗明细
- 管理员可购买团队资源包并按金额分配给子账户
- 子账户可查看余额、消耗记录、购买个人资源包
- 计费规则（token/元）由业务后台 + Web 运营后台配置，客户端只读展示
- 购买套餐时费率锁定到套餐包，后续消耗按购买时费率换算

**Non-Goals**

- 不改变现有聊天交互逻辑（Gateway 协议不变，只换模型推理的上游 endpoint）
- 不在线支付——企业内部结算
- 不在客户端配置计费规则——通过 Web 运营后台配置
- 不做费率历史版本管理——费率锁定在购买时的套餐包上

## Decisions

### 1. 架构分层

| 层 | 职责 |
|---|---|
| **业务后台（你们的后端）** | 计费规则配置、套餐定义/购买记录、组织关系管理 |
| **模型服务中心（已有，OpenAI 兼容）** | 模型调用、账户体系（AK/余额/用量/消耗明细）、多租户、子账户管理、资源分配、扣费优先级 |
| **客户端（Electron）** | 展示层 + 调用层；管理接口走业务后台，模型推理直连服务中心 |

### 2. 用户角色与权限

| 角色 | 可见菜单 |
|---|---|
| **管理员**（SSO 登录时自带角色） | 购买套餐、套餐余额、消耗明细、资源分配（选择子账户 + 输入金额） |
| **子账户**（管理员调服务中心开通） | 套餐余额（团队包 + 个人包）、消耗明细、购买个人资源包 |

### 3. 调用链路

- **模型推理**：客户端 → AK 鉴权 → 直连模型服务中心 `/v1/chat/completions`（支持 streaming + 非 streaming）
- **管理接口**：客户端 → 业务后台 → 模型服务中心（购买套餐、分配资源、账户开通等）
- **AK 管理**：长期有效、多设备共用、管理员可手动重置，存储在客户端 `secure-storage`

### 4. 计费规则

- 粒度：**按模型 + 按 input/output 方向** 分别定价（token/元）
- 费率配置入口：**Web 运营后台**，客户端只读
- 费率锁定时机：**购买套餐时**锁定到套餐包，后续消耗按购买时费率换算金额
- 金额展示：客户端从业务后台获取已算好的金额（业务后台根据套餐包锁定的费率换算）

### 5. 扣费优先级

由模型服务中心内部决定（先到期先扣 / 先买先扣等），客户端不感知。客户端只展示各包的剩余余额。

### 6. 模型同步

废弃现有 `StoModelSyncService`，根据模型服务中心返回的扩展字段重写模型同步逻辑（服务中心接口定义见下文）。

### 7. 现有模块迁移

| 现有模块 | 处理方式 |
|---|---|
| `StoModelSyncService` | **重写** —— 对接服务中心的扩展模型列表接口 |
| `StoTokenQuotaService` | **废弃** —— 替换为服务中心的账户详情接口（spend + maxBudget） |
| `StoSubscriptionService` | **保留/调整** —— 功能订阅与计费中心可能整合 |
| `StoBizAgentSyncService` | **保留** —— 业务 Agent 同步仍走业务后台 |
| `token-usage-core.ts`（本地 JSONL 解析） | **保留作离线参考**，但以服务中心的消耗记录为准 |

## 模型服务中心需提供的接口清单

> 以下接口规范由我们指定，需与模型服务中心团队协商确认。所有接口均要求 **OpenAI 兼容基础 + 业务扩展**。认证方式：`Authorization: Bearer {AK}`。

---

### 接口 1：模型列表（扩展版）

```
GET /v1/models
```

**说明**：在标准 OpenAI `/v1/models` 基础上扩展字段，返回当前 AK 对应账户可用的模型列表及定价信息。

**Response**：

```jsonc
{
  "object": "list",
  "data": [
    {
      "id": "qwen3.7-max",
      "object": "model",
      "owned_by": "sto",
      // ----- 扩展字段 -----
      "name": "Qwen 3.7 Max",
      "reasoning": true,
      "input": ["text", "image"],
      "context_window": 128000,
      "max_tokens": 8192,
      "available": true
    }
  ]
}
```

**扩展字段定义**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | `string` | 是 | 模型展示名称 |
| `reasoning` | `boolean` | 否 | 是否为推理模型（影响 UI 展示思考过程） |
| `input` | `string[]` | 否 | 支持的输入类型：`text` / `image` / `audio` |
| `context_window` | `number` | 否 | 上下文窗口大小（token 数） |
| `max_tokens` | `number` | 否 | 单次最大输出 token 数 |
| `available` | `boolean` | 是 | 当前账户是否可用此模型 |

---

### 接口 2：模型推理（OpenAI 兼容）

```
POST /v1/chat/completions
```

**说明**：标准 OpenAI Chat Completions 接口，支持 `stream: true/false`。无额外扩展，按 OpenAI 规范即可。

**Request**（标准 OpenAI 格式）：

```jsonc
{
  "model": "qwen3.7-max",
  "messages": [...],
  "stream": true,
  "max_tokens": 4096
}
```

**Response**（stream=false）：

```jsonc
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "model": "qwen3.7-max",
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 200,
    "total_tokens": 300
  },
  "choices": [...]
}
```

**Response**（stream=true）：标准 SSE `data: {...}` 格式，最后一条包含 `usage` 字段。

---

### 接口 3：账户详情

```
GET /v1/account/info
```

**说明**：返回当前 AK 对应账户的基本信息、余额、用量。

**Response**：

```jsonc
{
  "code": 0,
  "data": {
    "account_id": "acc_xxx",
    "account_name": "张三",
    "role": "member",           // "admin" | "member"
    "org_id": "org_xxx",        // 所属组织 ID
    "org_name": "技术部",
    "ak": "sk-xxx",             // 当前 AK
    "spend": 350000,            // 总消耗 token 数
    "max_budget": 1000000,      // 总额度 token 数
    "balance": 650000,          // 剩余额度 token 数（= max_budget - spend）
    "models": [                 // 可用模型列表（精简版，同接口 1）
      "qwen3.7-max",
      "qwen3.5-plus"
    ]
  }
}
```

**字段定义**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `account_id` | `string` | 是 | 账户唯一标识 |
| `account_name` | `string` | 是 | 账户名称 |
| `role` | `string` | 是 | 角色：`admin` / `member` |
| `org_id` | `string` | 否 | 所属组织 ID |
| `org_name` | `string` | 否 | 所属组织名称 |
| `ak` | `string` | 是 | 当前 AK |
| `spend` | `number` | 是 | 总消耗 token 数 |
| `max_budget` | `number` | 是 | 总额度 token 数 |
| `balance` | `number` | 是 | 剩余额度 token 数 |
| `models` | `string[]` | 是 | 可用模型 ID 列表 |

---

### 接口 4：资源包列表

```
GET /v1/account/packages
```

**说明**：返回当前账户下所有资源包（含团队包和个人包），用于余额展示。

**Response**：

```jsonc
{
  "code": 0,
  "data": [
    {
      "package_id": "pkg_xxx",
      "name": "技术部 2026Q2 团队包",
      "type": "team",              // "team" | "personal"
      "total_tokens": 5000000,     // 总 token 数
      "used_tokens": 1200000,      // 已用 token 数
      "remaining_tokens": 3800000, // 剩余 token 数
      "created_at": "2026-04-01T00:00:00Z",
      "expires_at": "2026-06-30T23:59:59Z",
      "source": "admin_allocated"  // "admin_allocated" | "self_purchased"
    }
  ]
}
```

**字段定义**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `package_id` | `string` | 是 | 资源包唯一标识 |
| `name` | `string` | 是 | 资源包名称 |
| `type` | `string` | 是 | 类型：`team`（管理员分配）/ `personal`（自购） |
| `total_tokens` | `number` | 是 | 总 token 额度 |
| `used_tokens` | `number` | 是 | 已使用 token 数 |
| `remaining_tokens` | `number` | 是 | 剩余 token 数 |
| `created_at` | `string` | 是 | 创建时间（ISO 8601） |
| `expires_at` | `string` | 否 | 过期时间（ISO 8601），null 表示永不过期 |
| `source` | `string` | 是 | 来源：`admin_allocated` / `self_purchased` |

---

### 接口 5：消耗明细列表

```
GET /v1/account/usage?start={start}&end={end}&page={page}&page_size={page_size}
```

**说明**：分页返回当前账户的模型调用消耗记录，支持按时间范围筛选。

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `start` | `string` | 否 | 起始时间（ISO 8601），默认近 7 天 |
| `end` | `string` | 否 | 结束时间（ISO 8601） |
| `page` | `number` | 否 | 页码，默认 1 |
| `page_size` | `number` | 否 | 每页条数，默认 50，最大 200 |

**Response**：

```jsonc
{
  "code": 0,
  "data": {
    "total": 1234,
    "page": 1,
    "page_size": 50,
    "items": [
      {
        "record_id": "rec_xxx",
        "timestamp": "2026-06-03T10:30:00Z",
        "model": "qwen3.7-max",
        "input_tokens": 500,
        "output_tokens": 200,
        "total_tokens": 700,
        "package_id": "pkg_xxx",
        "session_id": "sess_xxx",
        "agent_id": "main"
      }
    ]
  }
}
```

**字段定义**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `record_id` | `string` | 是 | 消耗记录唯一标识 |
| `timestamp` | `string` | 是 | 调用时间（ISO 8601） |
| `model` | `string` | 是 | 使用的模型 ID |
| `input_tokens` | `number` | 是 | 输入 token 数 |
| `output_tokens` | `number` | 是 | 输出 token 数 |
| `total_tokens` | `number` | 是 | 总 token 数 |
| `package_id` | `string` | 是 | 扣减的资源包 ID |
| `session_id` | `string` | 否 | 会话 ID（可选，便于客户端关联） |
| `agent_id` | `string` | 否 | Agent ID（可选，便于客户端关联） |

---

### 接口 6：开通子账户

```
POST /v1/account/create
```

**说明**：管理员在组织下开通子账户，由业务后台代理调用。

**Request**：

```jsonc
{
  "account_name": "李四",
  "sso_user_id": "sso_user_xxx",
  "role": "member",
  "models": ["qwen3.7-max", "qwen3.5-plus"]  // 可选：指定可用模型，不传则继承组织默认
}
```

**Response**：

```jsonc
{
  "code": 0,
  "data": {
    "account_id": "acc_yyy",
    "account_name": "李四",
    "ak": "sk-yyy",
    "models": ["qwen3.7-max", "qwen3.5-plus"],
    "spend": 0,
    "max_budget": 0,
    "balance": 0
  }
}
```

---

### 接口 7：重置 AK

```
POST /v1/account/reset-ak
```

**说明**：管理员为指定子账户重置 AK（旧 AK 立即失效），返回新 AK。

**Request**：

```jsonc
{
  "account_id": "acc_yyy"
}
```

**Response**：

```jsonc
{
  "code": 0,
  "data": {
    "account_id": "acc_yyy",
    "ak": "sk-new-yyy"
  }
}
```

---

### 接口 8：资源分配（管理员 → 子账户）

```
POST /v1/account/allocate
```

**说明**：管理员将团队资源包中的额度分配给子账户。由业务后台代理调用。

**Request**：

```jsonc
{
  "target_account_id": "acc_yyy",
  "package_id": "pkg_xxx",
  "amount_yuan": 50.00           // 按金额分配，模型服务中心内部换算成 token
}
```

**Response**：

```jsonc
{
  "code": 0,
  "data": {
    "target_account_id": "acc_yyy",
    "allocated_tokens": 2500000,  // 实际分配的 token 数
    "allocated_yuan": 50.00,
    "remaining_budget": 12500000  // 管理员账户剩余可分配额度（token）
  }
}
```

---

### 接口 9：组织成员列表

```
GET /v1/org/members
```

**说明**：管理员获取组织下所有子账户列表，用于分配资源时选择目标账户。

**Response**：

```jsonc
{
  "code": 0,
  "data": [
    {
      "account_id": "acc_yyy",
      "account_name": "李四",
      "role": "member",
      "spend": 120000,
      "max_budget": 500000,
      "balance": 380000,
      "created_at": "2026-05-01T00:00:00Z"
    }
  ]
}
```

---

### 接口 10：可用套餐列表（购买用）

```
GET /v1/packages/catalog
```

**说明**：返回可购买的套餐列表，含当前费率（token/元）。由业务后台代理调用或直接暴露。

**Response**：

```jsonc
{
  "code": 0,
  "data": [
    {
      "catalog_id": "cat_001",
      "name": "基础包",
      "description": "适合日常办公场景",
      "price_yuan": 100.00,
      "tokens": 5000000,
      "valid_days": 90,
      "pricing_rules": [
        {
          "model": "qwen3.7-max",
          "input_rate": 50000,     // 5 万 token/元
          "output_rate": 12500     // 1.25 万 token/元
        },
        {
          "model": "qwen3.5-plus",
          "input_rate": 100000,    // 10 万 token/元
          "output_rate": 25000
        }
      ]
    }
  ]
}
```

**字段定义**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `catalog_id` | `string` | 是 | 套餐目录 ID |
| `name` | `string` | 是 | 套餐名称 |
| `description` | `string` | 否 | 套餐描述 |
| `price_yuan` | `number` | 是 | 套餐价格（元） |
| `tokens` | `number` | 是 | 套餐包含的总 token 数 |
| `valid_days` | `number` | 是 | 有效天数 |
| `pricing_rules` | `array` | 是 | 各模型的计费规则（购买时快照） |
| `pricing_rules[].model` | `string` | 是 | 模型 ID |
| `pricing_rules[].input_rate` | `number` | 是 | 输入 token/元 |
| `pricing_rules[].output_rate` | `number` | 是 | 输出 token/元 |

---

### 接口 11：购买套餐

```
POST /v1/packages/purchase
```

**说明**：管理员/子账户购买套餐。企业内部结算，无需对接支付网关。由业务后台代理调用。

**Request**：

```jsonc
{
  "catalog_id": "cat_001",
  "purchase_type": "team"   // "team"（管理员购买团队包）| "personal"（子账户购买个人包）
}
```

**Response**：

```jsonc
{
  "code": 0,
  "data": {
    "order_id": "ord_xxx",
    "package_id": "pkg_new",
    "catalog_id": "cat_001",
    "name": "基础包",
    "total_tokens": 5000000,
    "used_tokens": 0,
    "remaining_tokens": 5000000,
    "price_yuan": 100.00,
    "purchased_at": "2026-06-03T12:00:00Z",
    "expires_at": "2026-09-01T23:59:59Z",
    "pricing_rules": [...]    // 同接口 10 中的 pricing_rules，锁定到该套餐包
  }
}
```

---

## 接口总览

| # | 接口 | 方法 | 路径 | 调用方 | 说明 |
|---|---|---|---|---|---|
| 1 | 模型列表 | GET | `/v1/models` | 客户端直连 | 扩展版，含可用性和模型属性 |
| 2 | 模型推理 | POST | `/v1/chat/completions` | 客户端直连 | 标准 OpenAI 兼容，支持 streaming |
| 3 | 账户详情 | GET | `/v1/account/info` | 客户端直连 | AK、余额、用量、可用模型 |
| 4 | 资源包列表 | GET | `/v1/account/packages` | 客户端直连 | 团队包 + 个人包余额 |
| 5 | 消耗明细 | GET | `/v1/account/usage` | 客户端直连 | 分页查询调用记录 |
| 6 | 开通子账户 | POST | `/v1/account/create` | 业务后台代理 | 管理员操作 |
| 7 | 重置 AK | POST | `/v1/account/reset-ak` | 业务后台代理 | 管理员操作 |
| 8 | 资源分配 | POST | `/v1/account/allocate` | 业务后台代理 | 管理员按金额分配给子账户 |
| 9 | 组织成员列表 | GET | `/v1/org/members` | 客户端直连 | 管理员查看子账户列表 |
| 10 | 套餐目录 | GET | `/v1/packages/catalog` | 客户端/后台 | 可购买套餐 + 费率 |
| 11 | 购买套餐 | POST | `/v1/packages/purchase` | 业务后台代理 | 企业内部结算 |

## Risks

- **[Risk]** AK 存储在客户端本地，桌面应用可被逆向提取 → **Mitigation**：使用现有 `secure-storage`（系统 Keychain），管理员支持重置 AK
- **[Risk]** 模型服务中心接口字段可能与上述规范有差异 → **Mitigation**：本文档作为协商基准，与服务中心团队对齐后调整
- **[Risk]** 流式调用中断线，usage 未返回 → **Mitigation**：保留本地 `token-usage-core.ts` JSONL 解析作为离线兜底
- **[Risk]** 多设备同时使用同一 AK 可能产生竞态扣费 → **Mitigation**：扣费由模型服务中心保证一致性，客户端无需处理
