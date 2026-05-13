# Harness Manager Cli方案设计文档 V2

> 状态：方案实施中  
> 版本：2.1.0  
> 适用范围：`harness-manager` 管理层、CLI 网关、Agent Runtime、下游业务系统接入

## 1. 文档说明

本文档用于合并以下两类内容：

- Harness Manager 层设计细节
- Harness Manager CLI API 详细设计

合并后，本文档统一描述 `harness-manager` 的整体定位、分层架构、CLI 网关机制、OSS 规范、业务接入流程，以及面向下游业务系统和 Agent Runtime 的接口设计。

## 2. 总体定位

`harness-manager` 是 SAI CLI 体系中的管理与接入层，负责统一承接业务 API 注册、CLI 元数据管理、网关命令清单同步和 Agent 鉴权接入能力。

该层核心职责包括：

- 提供 CLI 命令元数据的 AI 辅助生成能力
- 提供业务 API 注册、更新、注销能力
- 管理 CLI 网关路由与命令清单同步
- 提供 Agent Runtime 静默登录能力，发放业务调用所需的 `stoToken`
- 约束 OSS 挂载路径和 CLI/Skill 目录规范

## 3. 整体架构

### 3.1 分层架构

- Agent 调用层：统一 AI Agent，负责语义指令理解、调用 SAI CLI、结果返回
- 通用网关层：CLI 权限校验、路由转发、命令清单同步，不承载业务逻辑
- 业务域 CLI 层：各业务域统一命令规范，建议使用 Golang 实现，不直接暴露给 Agent
- 业务域后端 API 层：各业务域现有或新增的后端服务接口
- Harness Manager 层：承接 API 注册、元数据管理、命令发现、鉴权配套能力

### 3.2 核心关系

```text
业务系统提交 API 信息/元数据
        ↓
Harness Manager 统一管理注册信息
        ↓
CLI 网关同步命令清单并生成 Agent 友好的命令视图
        ↓
Agent 基于自然语言理解选择命令并执行
        ↓
执行前通过静默登录获取 stoToken
        ↓
携带 Token 调用真实业务 API
```

## 4. Manager 服务设计

### 4.1 服务接口分类

#### 业务 CLI 管理接口（面向下游业务系统）

| 接口 | 用途 |
| :--- | :--- |
| CLI 命令元数据 AI 生成 | 业务系统提交 API 基础描述，由 AI 自动生成 D1-D9 Tag 结构化元数据 |
| 业务 API 注册（注册/更新/注销） | 业务系统将确认后的 API 信息和命令元数据注册到 Manager，由网关同步生效 |

#### Agent 层接口（面向 Agent Runtime）

| 接口 | 用途 |
| :--- | :--- |
| OSS 静默登录（获取 stoToken） | Agent 通过梧桐工号静默登录，获取用户身份信息与 Token 凭证 |

### 4.2 核心流程

```text
路径 A（AI 辅助）：
业务系统提交 API 信息 → AI 生成元数据 → 业务审核修改 → 注册到 Manager → CLI 网关同步生效

路径 B（自行准备）：
业务系统按 Tag 规范自行准备元数据 → 直接注册到 Manager → CLI 网关同步生效

执行链路：
Agent 执行命令 → 静默登录获取 stoToken → 携带 Token 调用业务 API
```

## 5. CLI 网关路由设计

### 5.1 网关职责

CLI 网关与 Manager 服务保持通信，动态获取业务域注册的 CLI 信息，并提取核心信息，组装成 Agent 友好、上下文长度可控的命令清单。

网关主要负责：

- 同步 Manager 注册中心的命令清单
- 对 Agent 执行请求进行权限校验和路由过滤
- 将 Agent 请求转换为真实业务域 CLI 或 API 调用
- 提供统一的 Token 发现能力

### 5.2 Token 发现机制

CLI 网关支持通过以下方式发现鉴权 Token：

- 固定目录下的 token 文件
- 命令行参数
- 环境变量

## 6. OSS 路径挂载规范

### 6.1 OSS 挂载约定

1. 运维购买并准备 SAI 使用的 OSS 服务
2. Agent 容器启动时挂载 `sai/` 路径及其子目录
3. Agent 按约定目录结构读取 CLI 与 Skill 资源

### 6.2 目录规范

#### CLI

```text
sai/cli/sai-cli
```

说明：`sai-cli` 为 CLI 网关可执行文件。

#### Skill

Skill 分为系统内置技能、公共技能、用户技能三级：

```text
sai/skill/system/xxx-skill
sai/skill/public/xxx-skill

sai/skill/wtcodexx/aaa-xxskill
sai/skill/wtcodexx/bbb-xxskill
```

## 7. 业务域 CLI 发布流程

1. 业务 CLI 逻辑更新并完成代码发布
2. 打包为二进制可执行文件
3. 上传至约定的 OSS 路径
4. 调用 Manager/网关发布通知接口，触发命令清单更新
5. CLI 网关生效，Agent 感知到新的可用命令

## 8. 接口设计总览

### 8.1 环境域名

- 测试环境：`https://baseinfo-aimemory-test.sto.cn`
- 正式环境：`https://baseinfo-aimemory.sto.cn`

### 8.2 接口清单

| 编号 | 接口名称 | 方法 | 路径 | 调用方 |
| :--- | :--- | :--- | :--- | :--- |
| 3.1 | CLI 命令元数据 AI 生成 | `POST` | `/api/v1/sai/cli/metadata/generate` | 下游业务系统 |
| 3.2 | 业务 API 注册（注册/更新/注销） | `POST` | `/api/v1/sai/cli/registry` | 下游业务系统 |
| 4.1 | OSS 静默登录（获取 stoToken） | `POST` | `/api/v1/sai/auth/silent-login` | Agent Runtime |

## 9. 全局约定

### 9.1 统一响应格式

所有接口采用统一 JSON 响应信封：

```json
{
  "code": 200,
  "message": "操作成功",
  "timestamp": "2026-04-21T10:30:00Z",
  "data": {}
}
```

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `code` | `integer` | 业务状态码，`200` 表示成功 |
| `message` | `string` | 响应描述信息 |
| `timestamp` | `string` | 服务端处理时间戳（ISO 8601） |
| `data` | `object / null` | 业务数据，失败时为 `null` |

### 9.2 统一错误码

| 错误码 | 说明 |
| :--- | :--- |
| `200` | 操作成功 |
| `400` | 请求参数错误 |
| `401` | 鉴权失败 |
| `404` | 资源不存在 |
| `409` | 资源冲突 |
| `422` | 数据处理失败 |
| `500` | 服务内部错误 |

### 9.3 统一鉴权方式

所有接口采用 AK/SK 签名鉴权，请求头需包含：

| Header | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `X-Access-Key` | `string` | 是 | 调用方 Access Key |
| `X-Signature` | `string` | 是 | 基于 Secret Key 计算的 HMAC-SHA256 签名 |
| `X-Timestamp` | `string` | 是 | 毫秒时间戳，有效期 5 分钟 |

签名规则：

```text
StringToSign = AccessKey + "\n" + Timestamp
Signature = HMAC-SHA256(SecretKey, StringToSign)
```

> AK/SK 由 Harness Manager 团队统一分配。业务系统和 Agent Runtime 持有各自独立密钥对。

## 10. 业务 CLI 管理接口

> 面向下游业务系统，用于元数据生成与 API 注册管理。  
> 业务系统不需要直接提供 CLI 可执行文件，主要注册 API 信息和 Tag 元数据。

### 10.1 命令格式规范

CLI 标准命令格式：

```text
{product} {module} {action} [params]
```

| 段 | 说明 | 示例 |
| :--- | :--- | :--- |
| `product` | 产品域标识 | `network`、`policy`、`finance` |
| `module` | 功能模块 | `order`、`fee`、`route` |
| `action` | 操作类型 | `get`、`list`、`create`、`update` |
| `[params]` | 运行参数 | `--orgName 杭州网点` |

### 10.2 CLI 命令元数据 AI 生成

- 请求路径：`POST /api/v1/sai/cli/metadata/generate`
- Content-Type：`application/json`
- 鉴权方式：AK/SK 签名鉴权
- 用途：业务系统提交 API 基础信息，由 AI 生成 D1-D9 Tag、命令定义和参数建议
- 说明：生成结果仅为建议，不直接写入注册中心

#### 请求参数

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `systemCode` | `string` | 是 | 业务系统编码 |
| `systemName` | `string` | 是 | 业务系统名称 |
| `apiId` | `string` | 否 | API 唯一标识，不传则系统生成 |
| `apiHost` | `string` | 是 | API 服务域名（含协议） |
| `apiPath` | `string` | 是 | API 路径 |
| `method` | `string` | 是 | `GET` / `POST` / `PUT` / `DELETE` |
| `apiName` | `string` | 是 | API 中文名称 |
| `apiDesc` | `string` | 是 | API 功能描述 |
| `parametersSchema` | `object` | 否 | API 入参 JSON Schema |
| `responseSchema` | `object` | 否 | API 出参 JSON Schema |
| `category` | `string` | 否 | 指标大类提示 |

#### 响应核心字段

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `commandId` | `string` | AI 生成的命令唯一 ID |
| `command` | `string` | AI 生成的标准命令 |
| `commandName` | `string` | AI 生成的命令中文名称 |
| `description` | `string` | 命令描述 |
| `commandExample` | `string` | 命令调用示例 |
| `tags` | `object` | D1-D9 Tag 结构 |
| `parametersSchema` | `object` | AI 增强后的参数结构 |
| `permissions` | `array<string>` | AI 推荐权限列表 |

### 10.3 Tags 结构（D1-D9）

#### 路由与分类组

| 字段 | 维度 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| `D1_category` | D1 指标大类 | `string` | 一级路由，快速归类到业务域 |
| `D2_api_name` | D2 API 名称 | `string` | 二级路由，CLI 的唯一内部标识 |
| `D4_indicators` | D4 指标清单 | `array<string>` | 细粒度路由，对应指标列表 |

#### NLU 理解组

| 字段 | 维度 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| `D5_metric_type` | D5 指标类型 | `string` | `count` / `rate` / `target` |
| `D7_keywords` | D7 触发关键词 | `object` | 关键词匹配规则 |
| `D8_intent_scenarios` | D8 场景意图 | `array<string>` | 支持的查询场景 |

`D7_keywords` 结构：

| 子字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `exact` | `array<string>` | 精确匹配词 |
| `synonym` | `array<string>` | 同义词/口语化表达 |
| `negative` | `array<string>` | 排除词，防止误路由 |

#### 执行与展示组

| 字段 | 维度 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| `D3_sub_category` | D3 二级类目 | `array<string>` | 对应子类目入参 |
| `D6_scope_level` | D6 适用层级 | `string` | 如 `网点` / `分拨` / `大区` / `省区` |
| `D9_output_mapping` | D9 出参映射 | `object` | 返回字段与中文含义映射 |

### 10.4 业务 API 注册（注册/更新/注销）

- 请求路径：`POST /api/v1/sai/cli/registry`
- Content-Type：`application/json`
- 鉴权方式：AK/SK 签名鉴权
- 用途：将 API 信息和命令元数据注册到 Harness Manager 注册中心

支持两种元数据来源：

- AI 辅助生成后审核修改
- 按 Tag 标准格式自行准备

#### 请求参数

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `systemCode` | `string` | 是 | 业务系统编码 |
| `systemName` | `string` | 是 | 业务系统名称 |
| `actionType` | `string` | 是 | `add` / `update` / `remove` |
| `apiId` | `string` | 是 | API 唯一标识 |
| `apiHost` | `string` | add 时必填 | API 服务域名 |
| `apiPath` | `string` | add 时必填 | API 路径 |
| `method` | `string` | add 时必填 | HTTP 方法 |
| `apiName` | `string` | add 时必填 | API 中文名称 |
| `apiDesc` | `string` | add 时必填 | API 功能描述 |
| `apiVersion` | `string` | add/update 时必填 | 语义化版本号 |
| `commandId` | `string` | add 时必填 | 命令唯一 ID |
| `command` | `string` | add 时必填 | 标准命令 |
| `commandName` | `string` | add 时必填 | 命令中文名称 |
| `description` | `string` | 否 | 命令描述 |
| `commandExample` | `string` | 否 | 命令示例 |
| `tags` | `object` | add/update 时必填 | D1-D9 元数据 |
| `parametersSchema` | `object` | add/update 时必填 | API 入参 JSON Schema |
| `permissions` | `array<string>` | 否 | 权限列表 |
| `note` | `string` | 否 | 变更备注 |

#### actionType 必填对照

| 字段 | `add` | `update` | `remove` |
| :--- | :---: | :---: | :---: |
| `systemCode` | 是 | 是 | 是 |
| `systemName` | 是 | 是 | 是 |
| `actionType` | 是 | 是 | 是 |
| `apiId` | 是 | 是 | 是 |
| `apiVersion` | 是 | 是 | 否 |
| `tags` | 是 | 是 | 否 |
| `parametersSchema` | 是 | 是 | 否 |

#### 响应核心字段

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `registrationId` | `string` | 注册操作唯一 ID |
| `apiId` | `string` | API 唯一标识 |
| `actionType` | `string` | 操作类型 |
| `commandId` | `string` | 命令唯一 ID |
| `apiVersion` | `string` | 生效版本号 |
| `status` | `string` | `active` / `removed` |
| `effectiveTime` | `string` | 网关生效时间 |
| `previousVersion` | `string` | 旧版本号 |
| `gatewaySync` | `boolean` | 是否已同步到网关 |

#### 业务规则与约束

| 规则 | 说明 |
| :--- | :--- |
| `apiId` 唯一性 | 同一 `systemCode` 下不可重复 |
| 版本递增 | `update` 时 `apiVersion` 必须递增 |
| Tags 完整性 | 必须包含 D1-D9 全维度 |
| `parametersSchema` 校验 | 必须是合法 JSON Schema |
| API 路径合法性 | `apiPath` 必须以 `/` 开头 |
| 注销保护 | `remove` 为软删除，保留 30 天可恢复 |
| 操作审计 | 所有操作记录 `registrationId` 与时间戳 |
| 并发控制 | 同一 `apiId` 串行处理 |

### 10.5 parametersSchema 结构

遵循 JSON Schema 规范，供 Agent 自动组装请求参数。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `type` | `string` | 固定为 `"object"` |
| `properties` | `object` | 参数定义 |
| `required` | `array<string>` | 必填参数列表 |

建议每个字段都补充 `description`，以便 Agent 更准确理解参数语义。

## 11. Agent 层接口

### 11.1 OSS 静默登录（获取 stoToken）

- 请求路径：`POST /api/v1/sai/auth/silent-login`
- Content-Type：`application/json`
- 鉴权方式：AK/SK 签名鉴权
- 调用方：Agent Runtime
- 用途：通过梧桐工号静默登录，获取用户身份信息与 `stoToken`

#### 请求参数

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `code` | `string` | 是 | 梧桐工号 |

#### 响应字段

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | `string` | 用户唯一 ID |
| `userName` | `string` | 用户工号 |
| `realName` | `string` | 用户姓名 |
| `companyName` | `string` | 所属公司 |
| `departmentName` | `string` | 所属部门 |
| `openId` | `string` | 用户 OpenID |
| `signature` | `string` | 用户签名标识 |
| `authenticatedAt` | `string` | 认证时间 |
| `stoTokenExpiresAt` | `string` | Token 过期时间 |
| `stoToken` | `string` | 业务调用凭证 |

## 12. AI 生成逻辑说明

### 12.1 Tag 维度生成规则

AI 基于 `apiDesc`、`parametersSchema`、`responseSchema` 和 `category` 自动推导 D1-D9：

| 维度 | 生成规则 |
| :--- | :--- |
| D1 | 优先使用 `category`，否则基于 `apiDesc` 推断 |
| D2 | 基于 D1 和 `apiName` 生成内部标识 |
| D3 | 从描述和参数中提取二级类目 |
| D4 | 从描述和参数中提取指标清单 |
| D5 | 根据指标后缀推断 `count` / `rate` / `target` |
| D6 | 从描述和参数中提取组织层级 |
| D7 | 生成精确词、同义词、排除词 |
| D8 | 根据查询场景和时间维度推断意图 |
| D9 | 基于 `responseSchema` 生成出参映射 |

### 12.2 CLI 命令生成规则

| 字段 | 生成规则 |
| :--- | :--- |
| `commandId` | 基于 `systemCode` + `apiId` 生成 |
| `command` | 基于 `{product} {module} {action}` 组合生成 |
| `commandName` | 基于 `apiName` 生成 |
| `description` | 基于 `apiDesc` 增强 |
| `parametersSchema` | 在原始参数结构基础上补充说明与枚举优化 |

### 12.3 生成约束

- 生成结果仅作为建议，不直接入库
- 业务系统必须审核修改后再注册
- `D7_keywords.negative` 必须包含易混淆排除词，防止误路由

## 13. 业务接入流程

```text
                    ┌────── 路径 A：AI 辅助 ──────┐
                    │                             │
业务系统准备 API 信息 ─→ AI 生成元数据 ─→ 审核修改 ─→ 注册到 Manager ─→ CLI 网关生效

                    ┌────── 路径 B：自行准备 ─────┐
                    │                             │
业务系统按 Tag 标准自行编写元数据 ───────────────→ 注册到 Manager ─→ CLI 网关生效
```

### 13.1 路径 A：AI 辅助

| 步骤 | 操作 | 说明 |
| :--- | :--- | :--- |
| 1 | 调用 3.1 接口 | 提交 API 基础信息 |
| 2 | AI 生成元数据 | 输出 D1-D9、命令定义、参数建议 |
| 3 | 业务审核修改 | 修正关键词、排除词、命令名等 |
| 4 | 调用 3.2 接口 | 提交最终元数据完成注册 |

### 13.2 路径 B：自行准备

| 步骤 | 操作 | 说明 |
| :--- | :--- | :--- |
| 1 | 按标准准备元数据 | 自行编写 Tags 结构 |
| 2 | 调用 3.2 接口 | 直接完成注册 |

## 14. 附录

### 14.1 D5 指标类型枚举

| 值 | 含义 | 示例 |
| :--- | :--- | :--- |
| `count` | 绝对数量值 | 遗失量、订单量 |
| `rate` | 百分比/比率 | 遗失率、破损率 |
| `target` | 目标值 | 发件量目标、达标率 |

### 14.2 D8 场景意图枚举

| 值 | 含义 | 对应场景 |
| :--- | :--- | :--- |
| `单点查询` | 查询某一时刻或当天指标值 | 即时查询 |
| `趋势分析` | 查看时间维度变化趋势 | 周/月趋势 |
| `异常监控` | 检测指标是否异常波动 | 实时监控 |

### 14.3 Tag 维度总览

| 维度 ID | 名称 | 分组 | 用途 |
| :--- | :--- | :--- | :--- |
| D1 | 指标大类 | 路由与分类 | 一级路由 |
| D2 | API 名称 | 路由与分类 | 二级定位 |
| D3 | 二级类目 | 执行与展示 | 子类目入参 |
| D4 | 指标清单 | 路由与分类 | 指标定位 |
| D5 | 指标类型 | NLU 理解 | 数值含义推理 |
| D6 | 适用层级 | 执行与展示 | 层级过滤 |
| D7 | 触发关键词 | NLU 理解 | 正向匹配与排除 |
| D8 | 场景意图 | NLU 理解 | 意图识别 |
| D9 | 出参映射 | 执行与展示 | 结果翻译 |
