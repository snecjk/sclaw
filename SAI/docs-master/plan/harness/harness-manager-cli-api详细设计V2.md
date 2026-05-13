# Harness Manager CLI API 接口文档

> 负责：Harness Manager 团队（隋云）
> 状态：方案设计中
> 版本：2.1.0
>
> **环境域名：**
> - 测试环境：`https://baseinfo-aimemory-test.sto.cn`
> - 正式环境：`https://baseinfo-aimemory.sto.cn`

## 一、接口概述

本文档定义 Harness Manager 的接口。业务系统将自身 API 注册到 Harness Manager 注册中心，由 Manager 统一管理 CLI 命令的生成与注册。

接口分为两部分：

**业务 CLI 管理接口（面向下游业务系统）：**

| 接口 | 用途 |
| :--- | :--- |
| **3.1 CLI 命令元数据 AI 生成** | （可选）业务系统提交 API 信息，由 AI 自动生成 D1-D9 Tag 结构化元数据，供业务审核修改后用于注册 |
| **3.2 业务 API 注册（注册/更新/注销）** | 业务系统将 API 信息和 CLI 命令元数据（Tag）注册到 Manager，命令注册生效后 Agent 可发现并执行 |

**Agent 层接口（面向 Agent Runtime）：**

| 接口 | 用途 |
| :--- | :--- |
| **4.1 OSS 静默登录（获取 stoToken）** | Agent 通过梧桐工号静默登录，获取用户身份信息和 stoToken 鉴权凭证 |

**核心流程（两条路径）：**

```text
路径 A（AI 辅助生成）：
  业务系统提交 API 信息 → [3.1] AI 生成元数据 → 业务审核修改 → [3.2] 携带元数据注册

路径 B（自行准备）：
  业务系统按 Tag 标准格式自行准备元数据 → [3.2] 直接注册

Agent 执行命令时 → [4.1] 静默登录获取 stoToken → 携带 Token 调用业务 API
```

---

## 二、全局约定

### 2.1 统一响应格式

所有接口采用统一的 JSON 响应信封格式：

```json
{
  "code": 200,
  "message": "操作成功",
  "timestamp": "2026-04-21T10:30:00Z",
  "data": { ... }
}
```

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `code` | `integer` | 业务状态码，`200` 表示成功，其他见 [2.2 统一错误码](#22-统一错误码) |
| `message` | `string` | 响应描述信息 |
| `timestamp` | `string` | 服务端处理时间戳（ISO 8601 格式） |
| `data` | `object / null` | 业务数据，失败时为 `null` |

### 2.2 统一错误码

| 错误码 | 说明 |
| :--- | :--- |
| `200` | 操作成功 |
| `400` | 请求参数错误（缺少必填字段、格式不正确、版本号未递增、API 路径不合法等） |
| `401` | 鉴权失败（AK/SK 签名错误、Key 无效或时间戳过期） |
| `404` | 资源不存在（API 未注册、命令未找到、用户不存在等） |
| `409` | 资源冲突（apiId 重复等） |
| `422` | 数据处理失败（parametersSchema 不合法、Tags 结构不完整、AI 生成失败等） |
| `500` | 服务内部错误 |

**错误响应示例：**

```json
{
  "code": 400,
  "message": "缺少必填字段: apiPath",
  "timestamp": "2026-04-20T10:00:00Z",
  "data": null
}
```

### 2.3 统一鉴权方式

所有接口采用 **AK/SK 签名鉴权**，请求需在 HTTP Header 中携带以下签名信息：

| Header | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `X-Access-Key` | `string` | **是** | 分配给调用方系统的 Access Key |
| `X-Signature` | `string` | **是** | 基于 Secret Key 对请求体 + 时间戳计算的 HMAC-SHA256 签名 |
| `X-Timestamp` | `string` | **是** | 请求时间戳（毫秒），用于防重放，有效期 5 分钟 |

**签名计算规则：**

```text
StringToSign = AccessKey + "\n" + Timestamp
Signature = HMAC-SHA256(SecretKey, StringToSign)
```

**Java 示例：**

```java
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

public class SignatureUtil {

    public static String sign(String accessKey, String secretKey, String timestamp) throws Exception {
        String stringToSign = accessKey + "\n" + timestamp;
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secretKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] signed = mac.doFinal(stringToSign.getBytes(StandardCharsets.UTF_8));
        return Base64.getEncoder().encodeToString(signed);
    }
}
```

**Python 示例：**

```python
import hmac
import hashlib
import base64
import time

def sign(access_key: str, secret_key: str, timestamp: str) -> str:
    string_to_sign = f"{access_key}\n{timestamp}"
    signature = hmac.new(
        secret_key.encode("utf-8"),
        string_to_sign.encode("utf-8"),
        hashlib.sha256
    ).digest()
    return base64.b64encode(signature).decode("utf-8")

# 使用示例
access_key = "your_access_key"
secret_key = "your_secret_key"
timestamp = str(int(time.time() * 1000))

headers = {
    "X-Access-Key": access_key,
    "X-Signature": sign(access_key, secret_key, timestamp),
    "X-Timestamp": timestamp,
    "Content-Type": "application/json"
}
```

> AK/SK 由 Harness Manager 团队分配，业务系统和 Agent Runtime 各自持有独立的密钥对。
> 鉴权失败统一返回错误码 `401`。

---

## 三、业务 CLI 管理接口

> 以下接口面向 **下游业务系统**，用于 CLI 命令的元数据生成与 API 注册管理。
> 业务系统**不需要提供 CLI 可执行文件**，只需注册 API 信息和 Tag 元数据，Manager 统一管理 CLI 命令。

### 命令格式规范

CLI 命令遵循统一格式：

```text
{product} {module} {action} [params]
```

| 段 | 说明 | 示例 |
| :--- | :--- | :--- |
| `product` | 产品域标识，标识命令所属的业务产品线 | `network`、`policy`、`finance` |
| `module` | 功能模块，标识产品域下的具体功能 | `order`、`fee`、`route` |
| `action` | 操作类型，标识对该模块执行的具体操作 | `get`、`list`、`create`、`update` |
| `[params]` | 可选参数，运行时由 Agent 根据 `parametersSchema` 自动组装 | `--orgName 杭州网点` |

**命令示例：**

```text
network order get --orgName 杭州网点 --timeType day
policy fee query --region 华东
finance bill export --month 2026-04
```

### 3.1 CLI 命令元数据 AI 生成

**接口说明：** 辅助工具接口。业务系统提交 API 基础信息，由 AI 自动生成包含 D1-D9 Tag 维度的完整结构化元数据。**生成结果仅供参考，不触发注册。** 业务系统需审核修改后，将最终元数据通过 [3.2 业务 API 注册](#32-业务-api-注册注册更新注销) 接口提交注册。

> 此接口为**可选**步骤。若业务系统熟悉 Tag 规范且能自行准备元数据，可跳过此接口，直接调用 3.2 注册。

- **请求路径：** `POST /api/v1/sai/cli/metadata/generate`
- **Content-Type：** `application/json`
- **鉴权方式：** AK/SK 签名鉴权（见 [2.3 统一鉴权方式](#23-统一鉴权方式)）

---

#### 3.1.1 请求参数（入参）

| 字段                 | 类型 | 必填 | 说明                                                                                                           |
|:-------------------| :--- | :---: |:-------------------------------------------------------------------------------------------------------------|
| `systemCode`       | `string` | **是** | 业务系统编码，全局唯一标识。如 `"operation"`                                                                                |
| `systemName`       | `string` | **是** | 业务系统名称。如 `"运营系统"`                                                                                            |
| `apiId`            | `string` | 否 | API 唯一标识，在 `systemCode` 下唯一。若不传则由系统自动生成。如 `"qc_loss_damage"`                                                 |
| `apiHost`          | `string` | **是** | API 服务域名（含协议），即业务系统 API 的访问地址。如 `"https://operation-api.sto.cn"`                                             |
| `apiPath`          | `string` | **是** | API 端点路径。如 `"/api/v1/metrics/qc/loss_damage"`                                                                |
| `method`           | `string` | **是** | HTTP 请求方法，枚举值：`GET` / `POST` / `PUT` / `DELETE`。如 `"POST"`                                                   |
| `apiName`          | `string` | **是** | API 中文名称。如 `"遗失破损查询"`                                                                                        |
| `apiDesc`          | `string` | **是** | API 功能描述，AI 将基于此描述生成 Tag 维度数据。如 `"查询网点或分拨中心的遗失破损率及趋势，适用于质量监控场景"`                                             |
| `headerSchema`     | `object` | 否 | API 请求头 JSON Schema，提供后 AI 在调用 API 时自动组装请求头。                                                                 |
| `parametersSchema` | `object` | 否 | API 入参 JSON Schema，提供后 AI 可更精准地生成 D3/D4/D6 等维度。详见 [3.2.4 parametersSchema 结构](#324-parametersschema-结构)      |
| `responseSchema`   | `object` | 否 | API 出参 JSON Schema，提供后 AI 可更精准地生成 D9 出参映射                                                                    |
| `category`         | `string` | 否 | 指标大类提示（一级路由），如：`"质控"`、`"体验"`、`"时效"`。不传时由 AI 基于 `apiDesc` 自动推断                                                |

**请求示例：**

```json
{
  "systemCode": "operation",
  "systemName": "运营系统",
  "apiId": "qc_loss_damage",
  "apiHost": "https://operation-api.sto.cn",
  "apiPath": "/api/v1/metrics/qc/loss_damage",
  "method": "POST",
  "apiName": "遗失破损查询",
  "apiDesc": "查询网点或分拨中心的遗失破损率及趋势，适用于质量监控场景",
  "headerSchema": {
    "type": "object",
    "properties": {
      "Authorization": { "type": "string", "description": "认证信息" }
    }
  },
  "parametersSchema": {
    "type": "object",
    "properties": {
      "orgName": { "type": "string", "description": "组织名称，如'杭州网点'" },
      "timeType": { "type": "string", "enum": ["day", "week", "month"], "defaultValue": "day", "description": "时间维度" },
      "subCategoryList": { "type": "array", "items": { "type": "string" }, "description": "二级类目列表" },
      "indicatorList": { "type": "array", "items": { "type": "string" }, "description": "指标列表" }
    },
    "required": ["orgName", "subCategoryList", "indicatorList"]
  },
  "responseSchema": {
    "type": "object",
    "properties": {
      "loss_count": { "type": "integer", "description": "遗失量" },
      "damage_count": { "type": "integer", "description": "破损量" },
      "loss_rate": { "type": "number", "description": "遗失率" }
    }
  },
  "category": "质控"
}
```

---

#### 3.1.2 响应 data 字段

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `systemCode` | `string` | 业务系统编码 |
| `systemName` | `string` | 业务系统名称 |
| `apiId` | `string` | API 唯一标识（入参传入或系统自动生成） |
| `apiHost` | `string` | API 服务域名（含协议），即业务系统 API 的访问地址。如 `"https://operation-api.sto.cn"` |
| `apiPath` | `string` | API 端点路径。如 `"/api/v1/metrics/qc/loss_damage"` |
| `method` | `string` | HTTP 请求方法，枚举值：`GET` / `POST` / `PUT` / `DELETE`。如 `"POST"` |
| `apiName` | `string`| API 中文名称。如 `"遗失破损查询"` |
| `apiDesc` | `string` | API 功能描述，AI 将基于此描述生成 Tag 维度数据。如 `"查询网点或分拨中心的遗失破损率及趋势，适用于质量监控场景"` |
| `commandId` | `string` | AI 生成的命令唯一 ID |
| `command` | `string` | AI 生成的可执行标准命令，格式为 `{product} {module} {action}`。如 `"network route query"` |
| `commandName` | `string` | AI 生成的命令中文名称。如 `"遗失破损查询"` |
| `description` | `string` | AI 生成的命令描述（基于 `apiDesc` 增强） |
| `commandExample` | `string` | AI 生成的命令调用示例，展示完整的命令用法。如 `network order get ----params '{"param1":"xxxx","param2":"xxxx"}'` |
| `tags` | `Tags` | AI 生成的 D1-D9 Tag 结构化数据，详见 [3.1.3 Tags 结构](#313-tags-结构d1-d9) |
| `headerSchema` | `object` | AI 增强后的请求头 JSON Schema |
| `parametersSchema` | `object` | AI 增强后的参数 JSON Schema |
| `permissions` | `array<string>` | AI 推荐的权限列表 |

> **注意：** 以上返回内容仅为 AI 生成建议，不会写入注册中心。业务系统应审核修改后，将最终数据通过 3.2 接口注册。

---

#### 3.1.3 Tags 结构（D1-D9）

Tags 是 Agent NLU Pipeline 的核心数据结构，分为 **路由与分类组**、**NLU 理解组**、**执行与展示组** 三组：

**路由与分类组（找对 API）：**

| 字段 | 维度 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| `D1_category` | D1 指标大类 | `string` | 一级路由，快速归类到业务域。如 `"质控"` `"体验"` `"时效"` |
| `D2_api_name` | D2 API 名称 | `string` | 二级路由，CLI 的唯一内部标识。如 `"QC-01 遗失破损"` |
| `D4_indicators` | D4 指标清单 | `array<string>` | 细粒度路由，对应 API 的 `indicatorList` 入参。如 `["遗失量", "破损量", "遗失率", "破损率"]` |

**NLU 理解组（听懂人话）：**

| 字段 | 维度 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| `D5_metric_type` | D5 指标类型 | `string` | 指标属性：`count`（绝对值）/ `rate`（百分比）/ `target`（目标值） |
| `D7_keywords` | D7 触发关键词 | `object` | 关键词匹配规则，详见下方 D7 结构 |
| `D8_intent_scenarios` | D8 场景意图 | `array<string>` | 支持的查询场景。如 `["单点查询", "趋势分析", "异常监控"]` |

**D7_keywords 结构：**

| 子字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `exact` | `array<string>` | 精确匹配词，直接匹配用户输入。如 `["遗失", "破损"]` |
| `synonym` | `array<string>` | 同义词/口语化表达，扩大匹配范围。如 `["丢件", "坏件", "少件"]` |
| `negative` | `array<string>` | 反向排除词，命中则排除当前 API，防误判。如 `["投诉", "理赔", "签收"]` |

**执行与展示组（拼好参数 & 说人话）：**

| 字段 | 维度 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| `D3_sub_category` | D3 二级类目 | `array<string>` | 对应 API 的 `subCategoryList` 入参。如 `["遗失", "破损"]` |
| `D6_scope_level` | D6 适用层级 | `string` | 定义适用对象范围：`"网点"` / `"分拨"` / `"大区"` / `"省区"` |
| `D9_output_mapping` | D9 出参映射 | `object` | 返回 JSON 字段名与中文含义的映射，用于结果翻译 |

---

#### 3.1.4 响应示例

```json
{
  "code": 200,
  "message": "元数据生成成功",
  "timestamp": "2026-04-21T10:00:00Z",
  "data": {
    "systemCode": "operation",
    "systemName": "运营系统",
    "apiId": "qc_loss_damage",
    "commandId": "metric_order_loss_damage",
    "command": "network route query",
    "commandName": "遗失破损查询",
    "description": "查询网点或分拨中心的遗失破损率及趋势，适用于质量监控场景。",
    "commandExample": "`network order get ----params '{"param1":"xxxx","param2":"xxxx"}'`",
    "tags": {
      "D1_category": "质控",
      "D2_api_name": "QC-01 遗失破损",
      "D3_sub_category": ["遗失", "破损"],
      "D4_indicators": ["遗失量", "破损量", "遗失率", "破损率"],
      "D5_metric_type": "rate",
      "D6_scope_level": "网点",
      "D7_keywords": {
        "exact": ["遗失", "破损"],
        "synonym": ["丢件", "坏件", "少件"],
        "negative": ["投诉", "理赔", "签收"]
      },
      "D8_intent_scenarios": ["单点查询", "趋势分析", "异常监控"],
      "D9_output_mapping": {
        "loss_count": "遗失量",
        "damage_count": "破损量",
        "loss_rate": "遗失率"
      }
    },
    "headerSchema": {
      "type": "object",
      "properties": {
        "Authorization": { "type": "string", "description": "认证信息" }
      }
    },
    "parametersSchema": {
      "type": "object",
      "properties": {
        "orgName": { "type": "string", "description": "组织名称" },
        "timeType": { "type": "string", "enum": ["day", "week", "month"], "defaultValue": "day", "description": "时间维度" },
        "subCategoryList": { "type": "array", "items": { "type": "string" }, "description": "二级类目列表" },
        "indicatorList": { "type": "array", "items": { "type": "string" }, "description": "指标列表" }
      },
      "required": ["orgName", "subCategoryList", "indicatorList"]
    },
    "permissions": ["role:qc_manager", "role:ops_manager"]
  }
}
```

---

### 3.2 业务 API 注册（注册/更新/注销）

**接口说明：** 业务系统将自身 API 信息和 CLI 命令元数据（含 D1-D9 Tags）注册到 Harness Manager 注册中心。注册成功后，CLI 命令正式生效，Agent 侧可发现并执行。

元数据来源支持两种方式：
- **AI 辅助**：先调用 3.1 接口获取 AI 生成的元数据，审核修改后提交注册
- **自行准备**：按照 Tags 标准格式自行编写元数据，直接提交注册

- **请求路径：** `POST /api/v1/sai/cli/registry`
- **Content-Type：** `application/json`
- **鉴权方式：** AK/SK 签名鉴权（见 [2.3 统一鉴权方式](#23-统一鉴权方式)）

---

#### 3.2.1 请求参数（入参）

| 字段 | 类型 |       必填       | 说明 |
| :--- | :--- |:--------------:| :--- |
| `systemCode` | `string` |     **是**      | 业务系统编码，全局唯一标识。如 `"operation"` |
| `systemName` | `string` |     **是**      | 业务系统名称。如 `"运营系统"` |
| `actionType` | `string` |     **是**      | 操作类型，枚举值：`add`（新增注册）/ `update`（更新）/ `remove`（注销） |
| `apiId` | `string` |     **是**      | API 唯一标识，在 `systemCode` 下唯一。如 `"qc_loss_damage"` |
| `apiHost` | `string` |    add 时必填     | API 服务域名（含协议），即业务系统 API 的访问地址。如 `"https://operation-api.sto.cn"` |
| `apiPath` | `string` |    add 时必填     | API 端点路径。如 `"/api/v1/metrics/qc/loss_damage"` |
| `method` | `string` |    add 时必填     | HTTP 请求方法，枚举值：`GET` / `POST` / `PUT` / `DELETE` |
| `apiName` | `string` |    add 时必填     | API 中文名称。如 `"遗失破损查询"` |
| `apiDesc` | `string` |    add 时必填     | API 功能描述。如 `"查询网点或分拨中心的遗失破损率及趋势"` |
| `apiVersion` | `string` | add/update 时必填 | API 版本号，遵循语义化版本规范。如 `"1.0.0"` |
| `commandId` | `string` |    add 时必填     | CLI 命令唯一 ID。可使用 3.1 接口生成的值或自行定义。如 `"metric_order_loss_damage"` |
| `command` | `string` |    add 时必填     | 可执行的标准命令，格式为 `{product} {module} {action}`。如 `"network route query"` |
| `commandName` | `string` |    add 时必填     | 命令中文名称。如 `"遗失破损查询"` |
| `description` | `string` |       否        | 命令描述，不传时默认使用 `apiDesc` |
| `commandExample` | `string` |       否        | 命令调用示例，展示完整的命令用法含典型参数。如 `network order get ----params '{"param1":"xxxx","param2":"xxxx"}'` |
| `tags` | `Tags` | add/update 时必填 | D1-D9 Tag 结构化元数据。可使用 3.1 AI 生成的结果（审核修改后），或按标准格式自行准备。详见 [3.1.3 Tags 结构](#313-tags-结构d1-d9) |
| `headerSchema` | `object` |       否        | API 请求头 JSON Schema，供 Agent 自动组装请求头。 |
| `parametersSchema` | `object` | add/update 时必填 | API 入参 JSON Schema，供 Agent 自动组装请求参数。详见 [3.2.4 parametersSchema 结构](#324-parametersschema-结构) |
| `permissions` | `array<string>` |       否        | 权限列表，定义可调用此 API 的角色。不传时继承系统级权限 |
| `note` | `string` |       否        | 注册说明/变更备注，便于审计追溯 |

**各 actionType 的必填字段对照：**

| 字段 | `add` | `update` | `remove` |
| :--- | :---: | :---: | :---: |
| `systemCode` | **是** | **是** | **是** |
| `systemName` | **是** | **是** | **是** |
| `actionType` | **是** | **是** | **是** |
| `apiId` | **是** | **是** | **是** |
| `apiHost` | **是** | 否（不变则不传） | - |
| `apiPath` | **是** | 否（不变则不传） | - |
| `method` | **是** | 否（不变则不传） | - |
| `apiName` | **是** | 否（不变则不传） | - |
| `apiDesc` | **是** | 否（不变则不传） | - |
| `apiVersion` | **是** | **是** | - |
| `commandId` | **是** | 否（不变则不传） | - |
| `command` | **是** | 否（不变则不传） | - |
| `commandName` | **是** | 否（不变则不传） | - |
| `description` | 否 | 否 | - |
| `commandExample` | 否 | 否 | - |
| `tags` | **是** | **是** | - |
| `parametersSchema` | **是** | **是** | - |
| `headerSchema` | 否 | 否 | - |
| `permissions` | 否 | 否 | - |
| `note` | 否 | 否 | 否 |

---

#### 3.2.2 请求示例

**新增注册（add）——使用 AI 生成元数据修改后注册：**

```json
{
  "systemCode": "operation",
  "systemName": "运营系统",
  "actionType": "add",
  "apiId": "qc_loss_damage",
  "apiHost": "https://operation-api.sto.cn",
  "apiPath": "/api/v1/metrics/qc/loss_damage",
  "method": "POST",
  "apiName": "遗失破损查询",
  "apiDesc": "查询网点或分拨中心的遗失破损率及趋势，适用于质量监控场景",
  "apiVersion": "1.0.0",
  "commandId": "metric_order_loss_damage",
  "command": "network route query",
  "commandName": "遗失破损查询",
  "description": "查询网点或分拨中心的遗失破损率及趋势，适用于质量监控场景。",
  "commandExample": "network order get --orgName 杭州网点 --timeType day --indicatorList 遗失率,破损率",
  "tags": {
    "D1_category": "质控",
    "D2_api_name": "QC-01 遗失破损",
    "D3_sub_category": ["遗失", "破损"],
    "D4_indicators": ["遗失量", "破损量", "遗失率", "破损率"],
    "D5_metric_type": "rate",
    "D6_scope_level": "网点",
    "D7_keywords": {
      "exact": ["遗失", "破损"],
      "synonym": ["丢件", "坏件", "少件", "损坏"],
      "negative": ["投诉", "理赔", "签收"]
    },
    "D8_intent_scenarios": ["单点查询", "趋势分析", "异常监控"],
    "D9_output_mapping": {
      "loss_count": "遗失量",
      "damage_count": "破损量",
      "loss_rate": "遗失率"
    }
  },
  "headerSchema": {
    "type": "object",
    "properties": {
      "Authorization": { "type": "string", "description": "认证信息" }
    }
  },
  "parametersSchema": {
    "type": "object",
    "properties": {
      "orgName": { "type": "string", "description": "组织名称" },
      "timeType": { "type": "string", "enum": ["day", "week", "month"], "defaultValue": "day", "description": "时间维度" },
      "subCategoryList": { "type": "array", "items": { "type": "string" }, "description": "二级类目列表" },
      "indicatorList": { "type": "array", "items": { "type": "string" }, "description": "指标列表" }
    },
    "required": ["orgName", "subCategoryList", "indicatorList"]
  },
  "permissions": ["role:qc_manager", "role:ops_manager"],
  "note": "新增遗失破损查询，AI 生成后补充了 D7 同义词'损坏'"
}
```

**更新注册（update）：**

```json
{
  "systemCode": "operation",
  "systemName": "运营系统",
  "actionType": "update",
  "apiId": "qc_loss_damage",
  "apiVersion": "1.1.0",
  "tags": {
    "D1_category": "质控",
    "D2_api_name": "QC-01 遗失破损",
    "D3_sub_category": ["遗失", "破损"],
    "D4_indicators": ["遗失量", "破损量", "遗失率", "破损率"],
    "D5_metric_type": "rate",
    "D6_scope_level": "网点",
    "D7_keywords": {
      "exact": ["遗失", "破损"],
      "synonym": ["丢件", "坏件", "少件", "损坏", "缺件"],
      "negative": ["投诉", "理赔", "签收", "退货"]
    },
    "D8_intent_scenarios": ["单点查询", "趋势分析", "异常监控", "对比分析"],
    "D9_output_mapping": {
      "loss_count": "遗失量",
      "damage_count": "破损量",
      "loss_rate": "遗失率"
    }
  },
  "headerSchema": {
    "type": "object",
    "properties": {
      "Authorization": { "type": "string", "description": "认证信息" }
    }
  },
  "parametersSchema": {
    "type": "object",
    "properties": {
      "orgName": { "type": "string", "description": "组织名称" },
      "timeType": { "type": "string", "enum": ["day", "week", "month"] },
      "subCategoryList": { "type": "array", "items": { "type": "string" } },
      "indicatorList": { "type": "array", "items": { "type": "string" } },
      "scopeLevel": { "type": "string", "enum": ["网点", "分拨", "大区"], "description": "查询层级" }
    },
    "required": ["orgName", "subCategoryList", "indicatorList"]
  },
  "note": "新增大区层级支持，补充同义词和排除词"
}
```

**注销（remove）：**

```json
{
  "systemCode": "operation",
  "systemName": "运营系统",
  "actionType": "remove",
  "apiId": "qc_loss_damage",
  "note": "业务调整，遗失破损查询迁移至新系统"
}
```

---

#### 3.2.3 响应 data 字段

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `registrationId` | `string` | 本次注册操作的唯一 ID，用于追溯 |
| `apiId` | `string` | API 唯一标识 |
| `actionType` | `string` | 执行的操作类型 |
| `commandId` | `string` | CLI 命令唯一 ID |
| `apiVersion` | `string` | 生效的 API 版本号（remove 时为被注销的最后版本） |
| `status` | `string` | 命令状态：`active`（注册生效）/ `removed`（已注销） |
| `effectiveTime` | `string` | 命令在网关生效的时间戳 |
| `previousVersion` | `string` | 更新/注销前的旧版本号（add 时为 `null`） |
| `gatewaySync` | `boolean` | 是否已同步到网关命令清单 |

---

#### 3.2.4 parametersSchema 结构

遵循 JSON Schema 规范，定义 API 的请求参数结构，供 Agent 自动组装请求体。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `type` | `string` | 固定值 `"object"` |
| `properties` | `object` | 各参数的定义，每个参数包含 `type`、`description`、`enum`（可选）等 |
| `required` | `array<string>` | 必填参数列表 |

**建议参数字段包含 `description`，以便 Agent 更准确地理解和组装参数：**

```json
{
  "type": "object",
  "properties": {
    "orgName": { "type": "string", "description": "组织名称，如'杭州网点'、'上海分拨'" },
    "timeType": { "type": "string", "enum": ["day", "week", "month"], "description": "时间维度" },
    "subCategoryList": { "type": "array", "items": { "type": "string" }, "description": "二级类目列表" },
    "indicatorList": { "type": "array", "items": { "type": "string" }, "description": "指标列表" }
  },
  "required": ["orgName", "subCategoryList", "indicatorList"]
}
```

---

#### 3.2.5 响应示例

**新增注册成功：**

```json
{
  "code": 200,
  "message": "API 注册成功",
  "timestamp": "2026-04-21T10:30:00Z",
  "data": {
    "registrationId": "reg_20260421_103000_001",
    "apiId": "qc_loss_damage",
    "actionType": "add",
    "commandId": "metric_order_loss_damage",
    "apiVersion": "1.0.0",
    "status": "active",
    "effectiveTime": "2026-04-21T10:30:05Z",
    "previousVersion": null,
    "gatewaySync": true
  }
}
```

**更新注册成功：**

```json
{
  "code": 200,
  "message": "API 更新成功",
  "timestamp": "2026-04-21T14:00:00Z",
  "data": {
    "registrationId": "reg_20260421_140000_002",
    "apiId": "qc_loss_damage",
    "actionType": "update",
    "commandId": "metric_order_loss_damage",
    "apiVersion": "1.1.0",
    "status": "active",
    "effectiveTime": "2026-04-21T14:00:03Z",
    "previousVersion": "1.0.0",
    "gatewaySync": true
  }
}
```

**注销成功：**

```json
{
  "code": 200,
  "message": "API 已注销，关联 CLI 命令已下线",
  "timestamp": "2026-04-21T16:00:00Z",
  "data": {
    "registrationId": "reg_20260421_160000_003",
    "apiId": "qc_loss_damage",
    "actionType": "remove",
    "commandId": "metric_order_loss_damage",
    "apiVersion": "1.1.0",
    "status": "removed",
    "effectiveTime": "2026-04-21T16:00:02Z",
    "previousVersion": "1.1.0",
    "gatewaySync": true
  }
}
```

---

#### 3.2.6 业务规则与约束

| 规则 | 说明 |
| :--- | :--- |
| **apiId 唯一性** | 同一 `systemCode` 下 `apiId` 不可重复。`add` 时若已存在则返回 `409` |
| **版本递增** | `update` 时 `apiVersion` 必须大于当前已注册版本，否则返回 `400` |
| **Tags 完整性** | `tags` 必须包含 D1-D9 全部维度字段，结构不完整返回 `422` |
| **parametersSchema 校验** | `parametersSchema` 必须是合法 JSON Schema 格式，否则返回 `422` |
| **API 路径合法性** | `apiPath` 必须以 `/` 开头，符合 RESTful 路径规范 |
| **注销保护** | `remove` 操作为软删除，API 注册信息和关联 CLI 命令保留 30 天可恢复，之后物理清除 |
| **操作审计** | 所有操作记录 `registrationId`、时间戳，支持注册历史追溯 |
| **并发控制** | 同一 `apiId` 的注册操作串行处理，防止并发冲突 |

---

## 四、Agent 层接口

> 以下接口供 **Agent Runtime 层**使用，与上述业务 CLI 管理接口面向的下游业务系统不同。

### 4.1 OSS 静默登录（获取 stoToken）

**接口说明：** Agent Runtime 通过梧桐工号进行静默登录，获取用户身份信息和 stoToken。stoToken 用于 Agent 在执行 CLI 命令调用业务 API 时的身份鉴权。

- **请求路径：** `POST /api/v1/sai/auth/silent-login`
- **Content-Type：** `application/json`
- **鉴权方式：** AK/SK 签名鉴权（见 [2.3 统一鉴权方式](#23-统一鉴权方式)）
- **调用方：** Agent Runtime

---

#### 4.1.1 请求参数（入参）


| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `code` | `string` | **是** | 梧桐工号，用户在梧桐系统中的唯一标识。如 `"1200287"` |

**请求示例：**

```json
{
  "code": "1200287"
}
```

---

#### 4.1.2 响应 data 字段

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | `string` | 用户唯一 ID |
| `userName` | `string` | 用户工号 |
| `realName` | `string` | 用户真实姓名 |
| `companyName` | `string` | 所属公司名称 |
| `departmentName` | `string` | 所属部门名称 |
| `openId` | `string` | 用户 OpenID，用于第三方系统关联 |
| `signature` | `string` | 用户签名标识 |
| `authenticatedAt` | `string` | 认证时间（ISO 8601 格式，含时区） |
| `stoTokenExpiresAt` | `string` | stoToken 过期时间（ISO 8601 格式，含时区） |
| `stoToken` | `string` | 登录凭证 Token（JWT 格式），用于后续 CLI 命令鉴权 |

---

#### 4.1.3 响应示例

```json
{
  "code": 200,
  "message": "登录成功",
  "timestamp": "2026-04-21T09:21:12Z",
  "data": {
    "id": "8a8e9727872bcb75018730176ca467a5",
    "userName": "1200287",
    "realName": "李峥",
    "companyName": "总部",
    "departmentName": "产品技术中心成本中心测试",
    "openId": "8aa1d8d488277e300188282c9b382514",
    "signature": "db1cb6307b0c7b9096c8e877a755fa08",
    "authenticatedAt": "2026-04-21T09:21:12.117+08:00",
    "stoTokenExpiresAt": "2026-04-22T09:16:12.000+08:00",
    "stoToken": "eyJhbGciOiJIUzI1NiIsIlR5cGUiOiJKd3QiLCJ0eXAiOiJKV1QifQ..."
  }
}
```

---

## 五、AI 生成逻辑说明

### 5.1 Tag 维度生成规则

AI 基于入参中的 `apiDesc`（API 描述）、`parametersSchema`（入参结构）、`responseSchema`（出参结构）和 `category`（指标大类提示），按照以下逻辑自动推导 D1-D9 各维度：

| 维度 | 生成规则 |
| :--- | :--- |
| **D1** 指标大类 | 优先使用入参 `category`；未传时从 `apiDesc` 中提取业务域关键词，默认回退到 `systemName` |
| **D2** API 名称 | 基于 `D1_category` 生成业务域前缀 + `apiName` 组合，格式如 `"QC-01 遗失破损"` |
| **D3** 二级类目 | 从 `apiDesc` 中提取并列名词短语，结合 `parametersSchema` 中的枚举值拆分为子类目数组 |
| **D4** 指标清单 | 从 `apiDesc` 和 `parametersSchema.indicatorList` 中提取可量化的指标词，结合 D3 生成"量/率/目标"组合 |
| **D5** 指标类型 | 根据指标清单中的后缀推断：含"率"→ `rate`，含"量/数"→ `count`，含"目标"→ `target` |
| **D6** 适用层级 | 从 `apiDesc` 和 `parametersSchema` 中提取组织层级关键词（网点/分拨/大区/省区） |
| **D7** 触发关键词 | `exact`：从 D3 子类目提取；`synonym`：AI 生成口语化同义词；`negative`：AI 识别易混淆的排除词 |
| **D8** 场景意图 | 根据 `apiDesc` 中的动词/场景词和 `parametersSchema` 中的时间维度参数推断支持的查询场景 |
| **D9** 出参映射 | 优先基于 `responseSchema` 生成字段名到中文含义的映射；未传时基于 D4 指标清单推断 `snake_case` 字段名 |

### 5.2 CLI 命令生成规则

AI 同时基于 API 信息自动生成 CLI 命令定义（建议值）：

| 字段 | 生成规则 |
| :--- | :--- |
| **commandId** | 基于 `systemCode` + `apiId` 自动生成，格式如 `"metric_order_loss_damage"` |
| **command** | 基于 `product`、`module`、`action` 组合生成，格式为 `{product} {module} {action}`，如 `"network route query"` |
| **commandName** | 基于 `apiName` 生成或增强 |
| **description** | 基于 `apiDesc` 增强，生成更完整的命令描述 |
| **parametersSchema** | 基于原始 `parametersSchema` 增强，补充 `description`、优化 `enum` 枚举值 |

### 5.3 生成约束

- **仅返回 JSON 格式数据，不包含任何解释性文字**
- AI 生成的元数据**仅为建议**，不写入注册中心，需业务系统审核修改后通过 3.2 注册接口提交
- `D7_keywords.negative` 必须包含与当前 API 易混淆的排除词，防止 Agent 误路由

---

## 六、业务接入流程

```text
                    ┌─────── 路径 A：AI 辅助 ───────┐
                    │                                │
┌──────────────┐    │   ┌──────────────────┐         │   ┌──────────────┐   ┌─────────────┐
│  业务系统     │───→│──→│  [3.1] AI 生成   │──→ 审核修改 │──→│  [3.2] 注册  │──→│  CLI 网关    │
│  准备 API 信息│    │   │  元数据（建议）   │         │   │  API + 元数据│   │  注册生效    │
└──────────────┘    │   └──────────────────┘         │   └──────────────┘   └─────────────┘
                    │                                │          ↑
                    └────────────────────────────────┘          │
                                                                │
                    ┌─────── 路径 B：自行准备 ──────────────────┘
                    │
                    │   业务系统按 Tag 标准格式自行编写元数据，直接注册
```

### 步骤说明

**路径 A（AI 辅助生成）：**

| 步骤 | 操作 | 说明 |
| :--- | :--- | :--- |
| **1. 提交** | 业务系统调用 3.1 AI 生成接口 | 提交 `apiPath`、`method`、`apiName`、`apiDesc`、`parametersSchema` 等 API 基础信息 |
| **2. AI 生成** | Harness Manager 调用大模型 | 基于 API 描述自动生成 D1-D9 Tag、CLI 命令定义等结构化元数据 |
| **3. 审核修改** | 业务系统审核 AI 生成结果 | 确认 Tag 维度数据准确性，修正关键词、排除词、命令名称等 |
| **4. 注册** | 业务系统调用 3.2 注册接口 | 将修改确认后的 API 信息 + 元数据提交注册，CLI 命令正式生效 |

**路径 B（自行准备元数据）：**

| 步骤 | 操作 | 说明 |
| :--- | :--- | :--- |
| **1. 准备** | 业务系统自行编写元数据 | 按照 Tags（D1-D9）标准格式准备结构化元数据 |
| **2. 注册** | 业务系统调用 3.2 注册接口 | 将 API 信息 + 自行准备的元数据直接提交注册，CLI 命令正式生效 |

---

## 七、附录

### 7.1 D5 指标类型枚举

| 值 | 含义 | 示例 |
| :--- | :--- | :--- |
| `count` | 绝对数量值 | 遗失量、订单量、揽件量 |
| `rate` | 百分比/比率 | 遗失率、破损率、签收率 |
| `target` | 目标达成值 | 发件量目标、时效达标率 |

### 7.2 D8 场景意图枚举

| 值 | 含义 | 对应 timeType 参数 |
| :--- | :--- | :--- |
| `单点查询` | 查询某一时刻或当天的指标值 | `day` |
| `趋势分析` | 查看指标随时间的变化趋势 | `week` / `month` |
| `异常监控` | 检测指标是否存在异常波动 | `day`（实时） |

### 7.3 Tag 维度总览

| 维度 ID | 名称 | 分组 | 用途 |
| :--- | :--- | :--- | :--- |
| D1 | 指标大类 | 路由与分类 | 一级路由，粗筛业务域 |
| D2 | API 名称 | 路由与分类 | 二级路由，精确定位命令 |
| D3 | 二级类目 | 执行与展示 | 对应 `subCategoryList` 入参 |
| D4 | 指标清单 | 路由与分类 | 对应 `indicatorList` 入参 |
| D5 | 指标类型 | NLU 理解 | 数值含义推理（绝对值/百分比） |
| D6 | 适用层级 | 执行与展示 | 权限校验与层级过滤 |
| D7 | 触发关键词 | NLU 理解 | 正向匹配 + 反向排除防误判 |
| D8 | 场景意图 | NLU 理解 | 意图识别与参数推导 |
| D9 | 出参映射 | 执行与展示 | JSON 字段到中文的翻译映射 |
