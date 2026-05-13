# SAI CLI 架构设计文档

**版本**：v1.2  
**更新日期**：2026-04-24  
**文档状态**：正式版  
**适用范围**：运营域、网络域、政策域 及 企业智能团队

**变更记录：**


| 版本   | 日期         | 变更说明                                                                                                             |
| ---- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| v1.0 | 2026-04-21 | 初版发布                                                                                                             |
| v1.1 | 2026-04-22 | 架构调整：Agent 与 SAI-CLI 交互改为注册中心+三步调用流程；各业务域只提供 API 接口，CLI 开发职责统一上移至 Harness Manager，由其打包为单一 CLI 二进制文件，各域无需独立开发 CLI |
| v1.2 | 2026-04-24 | 对齐上游 Harness Manager 设计：Tag 升级为 9 维体系（D1-D9）；鉴权方案升级为 PoP Token + ECDSA 签名（分一期/二期实施）；新增 CLI-API 注册接口规范；新增 SkillCompiler 编译模块说明；Agent 调用流程升级为 6 步 NLU Pipeline；新增单 CLI/多 CLI 链路演进规划；新增全链路监控与审计设计 |


---

## 目录

1. [整体架构框架](#一整体架构框架)
2. [CLI 设计原则与规范](#二cli-设计原则与规范)
3. [CLI 需求池（渐进式交付）](#三cli-需求池渐进式交付)
4. [CLI 与 Harness Manager、Agent 对接及运维职责](#四cli-与-harness-manageragent-对接及运维职责)

---

## 一、整体架构框架

SAI采用四层分层架构，实现 AI Agent 与各业务域后端服务的标准化接入。

```
┌─────────────────────────────────────────────────────────────────┐
│  调用层   统一 AI Agent                                            │
│          ① 根据用户提问，在 SAI-CLI 中搜索相关 API                  │
│          ② 结合上下文选择最匹配的 API                               │
│          ③ 依据入参说明拼接执行命令 → 调用 CLI → 返回结构化结果        │
└─────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│  网关层   CLI 路由转发、负载均衡、同步机制、权限校验                    │
└─────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│  CLI 核心层（由 Harness Manager 统一构建与维护）                      │
│  统一命令规范、入参/出参 JSON、公共能力（认证/日志）                    │
│  API 注册中心（9 维 Tag、description、入参说明统一注册于此）            │
│  SkillCompiler（将注册元数据编译为 Agent 可读的 Tool 定义）            │
│                                                                  │
│           统一 SAI-CLI 二进制（单一可执行文件）                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  昆仑域命令集  │  网络域命令集  │  政策域命令集  │ ...      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│  后端 API 层                                                       │
│  各域只提供 API 接口（无需改造前端 GUI，无需开发 CLI）                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │
│  │  昆仑域 API │    │  网络域 API │    │  政策域 API │          │
│  └─────────────┘    └─────────────┘    └─────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

**各层职责说明：**


| 层级            | 核心职责                                                                                                | 关键约束                                |
| ------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 调用层（AI Agent） | 根据用户提问搜索 SAI-CLI 中的 API，结合上下文选择匹配 API，拼接执行命令并返回结构化结果                                                | 不直接调用后端 API；命令必须通过 SAI-CLI 注册发现     |
| 网关层           | 路由转发、鉴权校验（PoP 签名验证）、负载均衡、命令清单同步                                                                     | 不包含业务逻辑                             |
| CLI 核心层       | 由 **Harness Manager 统一开发和维护**，将三个业务域 API 封装为单一 CLI 二进制文件；内置 API 注册中心，统一管理各域命令的 9 维 Tag、description、入参说明；通过 **SkillCompiler** 将元数据编译为 Agent 可读的 Tool 定义 | 各业务域**不参与** CLI 开发；CLI 不感知 Agent 存在 |
| 后端 API 层      | 各业务域**只需提供 API 接口**，无需改造前端 GUI，无需开发任何 CLI 代码                                                        | 零侵入，各域只维护自身 API                     |


---

## 二、CLI 设计原则与规范

### 原则 1：GUI 零改造，各域只提供 API

各业务域**只需提供后端 API 接口**，CLI 由 Harness Manager 统一开发，不修改任何前端 GUI 代码，不要求各域开发 CLI 工具。

**各角色职责边界：**


| 角色              | 职责                             | 不需要做的事          |
| --------------- | ------------------------------ | --------------- |
| 各业务域（昆仑/网络/政策）  | 提供并维护后端 API 接口，提供 API 描述文档     | 不开发 CLI，不改造 GUI |
| Harness Manager | 读取各域 API，统一开发并打包 SAI-CLI 二进制文件 | —               |


---

### 原则 2：架构解耦

调用链路为：**Agent → 网关 → SAI-CLI → API**，层层解耦，每一层只依赖下一层的接口契约，不穿透调用。

- **Agent** 不直接调用后端 API；通过 SAI-CLI 的注册中心搜索和发现 API，再组装命令下发
- **SAI-CLI** 由 Harness Manager 统一构建，封装所有业务域命令；不感知 Agent 的存在
- **各业务域** 只暴露 API 接口，不参与 CLI 层的任何开发
- **网关** 负责路由转发和鉴权

此分层设计使每一层可以独立演进、独立部署、独立测试，且 CLI 的迭代与业务域 API 的迭代完全解耦。

---

### 原则 3：协议统一

所有 HTTP 调用及 CLI 的入参/出参统一使用 **JSON 格式**，禁止使用非结构化文本输出（错误输出同样遵循此约定，见原则 6）。

---

### 原则 4：统一命令规范

**命令格式：**

```
{product} {module} {action} [params]
```

**格式说明：**


| 字段      | 含义            | 示例值                                     |
| ------- | ------------- | --------------------------------------- |
| product | 产品域标识         | `kunlun`、`network`、`policy`、`finance`   |
| module  | 功能模块          | `timeliness`（时效）、`route`（路由）、`rule`（规则）、`order`（订单）、`fee`（费用） |
| action  | 操作类型          | `get`、`list`、`create`、`update`、`delete` |
| params  | 命令参数（JSON 格式） | `--type 出港滞留`                           |


**各域命令示例：**

```bash
# 昆仑域 - 查询出港滞留时效
kunlun timeliness query --type 出港滞留 --date 2026-04-21

# 网络域 - 查询网点单量
network order get --orgName 杭州网点 --timeType day

# 政策域 - 查询运费政策规则（示例，待补充）
policy rule query --product 标快 --region 华东
```

---

### 原则 5：可被 Agent 调用

#### 5.1 API 统一注册机制（9 维 Tag 体系）

所有业务域的 API 必须在 **SAI-CLI 注册中心**完成注册。注册采用 **"通用路由骨架 + 9 维深度 Tag"** 模式，通用骨架解决基础鉴权和系统归属，9 维 Tag 解决语义理解、参数构造、消歧防误判和结果解读。

**9 维 Tag 维度总览：**

| 组别 | 维度 | 名称 | 用途 |
|------|------|------|------|
| **路由与分类组** | D1 | 指标大类 | 一级路由粗筛（如：时效、单量、签收率） |
| | D2 | API 名称 | 二级路由精确定位 |
| | D4 | 指标清单 | 细粒度路由，映射 indicatorList 入参 |
| **NLU 理解组** | D5 | 指标类型 | count/rate/target，影响结果解读方式 |
| | D7 | 触发关键词 | exact（精确）+ synonym（同义）+ negative（排除）三层匹配 |
| | D8 | 场景意图 | 单点查询 / 趋势分析 / 异常监控 |
| **执行与展示组** | D3 | 二级类目 | 对应 subCategoryList 入参 |
| | D6 | 适用层级 | 网点 / 分拨 / 大区，用于权限校验 |
| | D9 | 出参映射 | JSON 字段到中文含义翻译，供 Agent 解读结果 |

> **关键机制**：D7 的 negative 关键词是防误判的核心，防止 Agent 将用户请求路由到错误的 API。

**注册信息示例（昆仑域时效查询）：**

```json
{
  "command": "kunlun timeliness query",
  "tags": {
    "D1_category": "时效",
    "D2_api_name": "出港滞留率查询",
    "D3_sub_category": ["出港滞留", "到港超时"],
    "D4_indicators": ["滞留率", "滞留票数", "总票数"],
    "D5_indicator_type": "rate",
    "D6_org_level": ["网点", "分拨", "大区"],
    "D7_keywords": {
      "exact": ["出港滞留率", "出港滞留"],
      "synonym": ["出发延迟", "发件积压"],
      "negative": ["到港", "签收", "派件"]
    },
    "D8_intent": "单点查询",
    "D9_output_map": {
      "retentionRate": "滞留率",
      "retentionCount": "滞留票数",
      "totalCount": "总票数"
    }
  },
  "description": "查询昆仑时效数据，支持按类型、日期、区域筛选，返回对应时效指标",
  "params": [
    {
      "name": "--type",
      "type": "string",
      "required": true,
      "description": "时效类型",
      "options": ["出港滞留", "到港超时", "全程时效"],
      "example": "出港滞留"
    },
    {
      "name": "--date",
      "type": "string",
      "required": false,
      "description": "查询日期，格式 YYYY-MM-DD",
      "default": "今日",
      "example": "2026-04-22"
    },
    {
      "name": "--region",
      "type": "string",
      "required": false,
      "description": "区域筛选，如：华东、华南",
      "example": "华东"
    }
  ],
  "example": "kunlun timeliness query --type 出港滞留 --date 2026-04-22"
}
```

#### 5.2 SkillCompiler 编译模块

Harness Manager 内置 **SkillCompiler（技能编译模块）**，负责将业务方上报的原始注册 JSON 编译为 Agent 可读的"增强型 Tool 定义"。

**编译流程：**

```
业务方上报 API 注册信息（含 9 维 Tag）
       ↓
Manager 接收并存储原始注册数据
       ↓
SkillCompiler 编译为 Agent Tool 定义
       ↓
Agent Runtime 拉取编译后的 Tool 定义
```

**编译后的 Agent Tool 定义格式：**

Agent 接收的 Tool 定义分为两层：

| 层级 | 内容 | 说明 |
|------|------|------|
| **LLM 可见层** | name、description、parameters | LLM 直接可见，用于理解命令功能和参数 |
| **框架控制层** | `__agent_meta__`（含 domain、intent_scenarios、negative_keywords、result_fields） | 框架内部使用，用于路由控制、消歧和结果解读 |

#### 5.3 Agent 调用流程（6 步 NLU Pipeline）

Agent 与 SAI-CLI 的完整交互流程升级为 6 步 NLU Pipeline：

```
用户输入（自然语言）
       ↓
① 意图分类（D8）：判断用户意图类型（单点查询/趋势分析/异常监控）
       ↓
② 实体抽取：从用户输入中提取关键实体（时间、地点、指标等）
       ↓
③ Tag 匹配 + 评分（D7）：基于 exact/synonym/negative 三层关键词进行命令匹配与评分
       ↓
④ 参数组装（D3/D4）：依据所选 API 的入参说明，自动组装完整的 CLI 执行命令
       ↓
⑤ API 调用：命令经网关鉴权后路由至对应域 CLI 执行
       ↓
⑥ 结果解读（D9）：基于出参映射将 JSON 字段翻译为中文，生成人类可读的回复
```

**流程示例：**

> **用户提问**："帮我查一下今天华东区域的出港滞留情况"
>
> **① 意图分类**：判断为「单点查询」（D8）
>
> **② 实体抽取**：时间=今天，区域=华东，指标=出港滞留
>
> **③ Tag 匹配**：「出港滞留」命中 D7 exact 关键词，匹配 `kunlun timeliness query`；negative 词排除到港/签收相关 API
>
> **④ 参数组装**：
> ```bash
> kunlun timeliness query --type 出港滞留 --date 2026-04-24 --region 华东
> ```
>
> **⑤ API 调用**：经网关路由至昆仑 CLI，返回 JSON 结果
>
> **⑥ 结果解读**：通过 D9 映射将 `retentionRate` 翻译为「滞留率」，生成回复："华东区域今日出港滞留率为 3.2%，滞留票数 1,250 票"

#### 5.4 无交互式输入要求

CLI 命令必须支持纯参数化调用，**禁止运行时弹出任何交互式提示**（如 `prompt` 等待用户输入），确保 Agent 可以完全自动化执行。

---

### 原则 6：结构化错误输出

所有错误输出必须为结构化 JSON，包含以下四个固定字段：


| 字段        | 类型     | 说明                                       |
| --------- | ------ | ---------------------------------------- |
| `type`    | string | 错误类型（如 AUTH_ERROR、PARAM_ERROR、API_ERROR） |
| `code`    | string | 错误码（与后端 API 错误码对齐）                       |
| `message` | string | 人类可读的错误描述                                |
| `hint`    | string | 修复建议，指导用户或 Agent 下一步操作                   |


**错误输出示例：**

```json
{
  "type": "AUTH_ERROR",
  "code": "401",
  "message": "Token 已过期或无效",
  "hint": "请执行 sai login 重新获取 Token，或检查 STO_CLI_TOKEN 环境变量是否正确配置"
}
```

```json
{
  "type": "PARAM_ERROR",
  "code": "400",
  "message": "缺少必填参数 --type",
  "hint": "请通过 --type 指定时效类型，可选值：出港滞留、到港超时"
}
```

```json
{
  "type": "API_ERROR",
  "code": "500",
  "message": "后端服务暂时不可用",
  "hint": "请稍后重试，如问题持续请联系 STO 运维团队"
}
```

---

### 原则 7：开发语言统一（仅 Harness Manager 侧）

SAI-CLI 统一由 Harness Manager 使用 **Golang** 开发，各业务域无需关心开发语言。

**选型依据：**

- 飞书 CLI、GitHub CLI 均采用 Go，生态成熟
- 编译为**单一二进制文件**，无运行时依赖，各域 API 命令集打包合并后部署简单
- 跨平台支持良好，适合在 Agent 容器环境中运行
- 业务域只需提供 API 接口及描述文档，CLI 构建与业务域技术栈无关

**业务方接入方式（Java SDK 注解）：**

业务方可通过 Java SDK 注解快速接入，降低接入成本：

| 注解 | 级别 | 用途 |
|------|------|------|
| `@CliSystem` | 类级别 | 声明系统归属（systemCode、systemName） |
| `@CliCommand` | 方法级别 | 定义 CLI 命令（apiPath、method、description） |
| `@NLU` | 方法级别 | 声明 D1-D9 Tag 标签 |
| `@OutMap` | 返回字段级别 | D9 出参映射（JSON 字段 → 中文含义） |

接入深度分三层：基础接入（一行 `@CliCommand` 注解即可生成基础元数据）、完整接入（全部注解）、指标特化。

---

### 原则 8：Tag 自动化生成

CLI 命令的注册元数据（9 维 Tag、description、入参说明）由 AI 根据各域 API 描述文档自动生成，**不人工手写**，生成后由业务团队 Review 确认后，由 Harness Manager 注册至 SAI-CLI。

**生成与注册流程（两条路径）：**

| 路径 | 说明 | 适用场景 |
|------|------|---------|
| **路径 A（AI 辅助）** | 提交 API 基础信息 → AI 自动生成 9 维 Tag 元数据 → 业务团队审核修改 → 注册 | 推荐，大部分场景使用 |
| **路径 B（自行准备）** | 按标准格式自行编写 9 维 Tag 元数据 → 直接注册 | 特殊定制需求 |

**AI 生成接口：**

```
POST /api/v1/sai/cli/metadata/generate
```

入参包含：systemCode、systemName、apiPath、method、apiDesc、parametersSchema、responseSchema 等。AI 自动推导生成完整的 D1-D9 Tag 和命令元数据。

**注册接口：**

```
POST /api/v1/sai/cli/registry
```

支持三种操作：`add`（新增）、`update`（更新）、`remove`（注销，软删除 30 天可恢复）。

---

### 原则 9：安全与鉴权

#### 鉴权方案概述

采用 **PoP（Proof-of-Possession）** Token 方案，实现 Token + 环境绑定签名，分一期/二期实施。

| 阶段 | 方案 | 说明 |
|------|------|------|
| **一期（基础链路）** | 标准 Bearer Token | Agent → sai-cli → 业务 API，暂不校验 Token 是否被复制 |
| **二期（安全增强）** | PoP 签名 + ECDSA (P-256) | Agent → sai-cli → sai-agent → 云端网关 → 业务 API，引入环境绑定签名防复用 |

#### 一期：Token 获取优先级（从高到低）

1. **命令行参数**：`--token <JWT_TOKEN>`
2. **环境变量**：`STO_CLI_TOKEN=<JWT_TOKEN>`
3. **本地配置文件**：`~/.sai/sso-auth.json`（由 Agent 登录后自动写入）

CLI 在执行每条命令前，按此顺序依次尝试获取 Token，取到即停止。

**静默登录接口（获取 stoToken）：**

```
POST /api/v1/sai/auth/silent-login
入参：{ "code": "梧桐工号" }
响应：{ userName, realName, stoToken, stoTokenExpiresAt, ... }
```

#### 二期：PoP Token + 环境绑定

二期引入 **sai-agent** 作为安全代理，实现 Token 与设备/环境绑定：

| 场景 | 密钥来源 | 环境绑定 |
|------|---------|---------|
| 本地客户端 | OS Keychain | Machine ID（设备指纹） |
| 云端 Agent | K8s Secret Volume（tmpfs，不落盘） | Pod UID |

**安全目标：**
- 云上 Token 只能在云上用（即使被提取也无法在其他地方使用）
- 本地 Token 只能自己用（换设备无法使用）
- 下游业务零感知（下游 API 只需原始 stoToken）

**CLI 命令附加安全字段（二期）：**

```bash
sai-cli {module} {action} --params --user-query-raw "用户原话" --user-query-expanded "Agent补全意图"
```

#### Token 机制说明


| 维度   | 说明                                          |
| ---- | ------------------------------------------- |
| 认证标准 | JWT Token，全链路统一使用 SSO Token                 |
| 权限控制 | Scope 权限控制，每个命令对应一组所需 Scope                 |
| 身份体系 | Bot Token（Agent 应用级权限）+ User Token（人工用户级权限） |
| 高危操作 | 批量修改、删除类操作需要更高权限 Token 或额外二次确认              |


#### 接口鉴权：AK/SK 签名

所有 Harness Manager API 接口统一使用 **AK/SK 签名鉴权**（HMAC-SHA256）：

```
签名规则：StringToSign = AccessKey + "\n" + Timestamp
Header：X-Access-Key、X-Signature、X-Timestamp
```

#### 配置文件格式（`~/.sai/sso-auth.json`）

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "identity_type": "bot",
  "scopes": ["kunlun:read", "network:read", "policy:read"],
  "expires_at": "2026-04-22T10:00:00Z"
}
```

---

### 原则 10：可测试性与 Dry-Run

#### Dry-Run 模式

每个**写操作命令**（create/update/delete）必须支持 `--dry-run` 参数：

```bash
# 示例：Dry-Run 模式下预览将要执行的操作，不实际执行
policy rule update --id R001 --fee 12.5 --dry-run
```

Dry-Run 返回"将要执行的操作描述"，而非实际执行，让 Agent 和操作人员在执行前确认影响范围。

**Dry-Run 返回示例：**

```json
{
  "dry_run": true,
  "action": "UPDATE",
  "target": "policy.rule",
  "changes": [
    { "field": "fee", "from": "10.0", "to": "12.5" }
  ],
  "affected_count": 1,
  "warning": null
}
```

#### 单元测试可测性要求

CLI 核心逻辑通过接口抽象实现，确保在无真实 API 环境下可单元测试：


| 依赖项      | 抽象方式                    |
| -------- | ----------------------- |
| 文件系统     | 使用 `vfs` 虚拟文件系统封装       |
| HTTP 客户端 | 通过 interface 注入，支持 Mock |
| Token 读取 | 通过接口抽象，支持注入测试 Token     |


---

## 三、CLI 需求池（渐进式交付）

### 3.1 一期目标

从3个业务域（昆仑、网络、政策）中遴选**20+ 高频使用场景**，完成 CLI 开发，跑通 SAI Agent 完整调用链路。

#### 任务进度总览


| 事项                                  | 截止时间       | 状态     | 交付物/说明                                                                               |
| ----------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------ |
| 各域完成高频使用场景圈选                        | 2026-04-20 | ✅ 已完成  | [场景圈选文档](https://alidocs.dingtalk.com/i/nodes/dQPGYqjpJYgLrkjQHZ1DOe0RWakx1Z5N)      |
| 需求梳理与 API 盘点，完成 20+ CLI 描述 + API 列表 | 2026-04-21 | ✅ 已完成  | [CLI描述&API列表](https://alidocs.dingtalk.com/i/nodes/jb9Y4gmKWr7wPKB3fj2d5qrLVGXn6lpz) |
| 完成 1 个 CLI 可测试的内容                   | 2026-04-22 | ✅ 已完成  | —                                                                                    |
| 完成 20+ CLI 的开发与环境部署                 | 2026-04-29 | 🔄 进行中 | —                                                                                    |


> **状态定义**：✅ 已完成 / 🔄 进行中 / ⏳ 待启动 / ❌ 已延期（详见附录）

---

### 3.2 二期目标

> 待整理，预计 2026-04-29 更新内容。

---

## 四、CLI 与 Harness Manager、Agent 对接及运维职责

### 4.1 Harness Manager 职责与部署方式

#### Harness Manager 核心职责

Harness Manager 是 SAI-CLI 的**唯一构建和维护方**，负责将各业务域 API 统一封装为单一 CLI 二进制文件。其核心模块包括：


| 模块 | 职责 | 说明 |
| -------- | ------------------------------------------------- | --- |
| **Register** | API 注册管理 | 接收业务方上报，管理 CLI 命令的注册、更新和注销 |
| **CLI Meta** | 元数据引擎 | 存储和管理 9 维 Tag 元数据，支持 AI 自动生成 |
| **SkillCompiler** | 技能编译 | 将注册元数据编译为 Agent 可读的 Tool 定义 |
| **CLI Router** | 路由与鉴权 | CLI 命令路由转发，Token 校验 |
| **CLI Invoke** | 调用代理（待定） | 可选的调用代理节点，一期可跳过以降低链路延时 |


#### 部署方式

采用 **OSS 挂载**形式，将统一打包的 SAI-CLI 二进制文件挂载至 Agent 运行环境。

**OSS 路径规范：**

| 类型 | 路径 | 说明 |
|------|------|------|
| CLI 网关 | `sai/cli/sai-cli` | CLI 网关可执行文件 |
| 系统内置技能 | `sai/skill/system/` | 系统预置的通用技能 |
| 公共技能 | `sai/skill/public/` | 可共享的公共技能 |
| 用户技能 | `sai/skill/wtcodexx/` | 特定用户的个人技能 |

**SAI-CLI 发布流程（由 Harness Manager 执行）：**

```
各域提供新增/变更的 API 接口及描述文档
       ↓
Harness Manager 更新 CLI 代码（新增命令/修改参数）
       ↓
打包为统一 SAI-CLI 二进制（Go build，包含所有域命令集）
       ↓
上传至约定的 OSS 路径
       ↓
调用网关"发布通知"接口，同步更新命令清单
       ↓
网关生效，Agent 可调用新版命令
```

> **各业务域只需提供 API 接口文档，无需参与 CLI 打包和发布流程。**

#### 鉴权机制（任选其一，优先级见原则 9）


| 方式     | 说明                                         |
| ------ | ------------------------------------------ |
| 配置文件读取 | 读取本地 `~/.sai/sso-auth.json`（Agent 登录后自动生成） |
| 参数传入   | CLI 网关通过参数注入，格式：`--sso-auth {xxxxx}`       |


---

### 4.2 CLI 网关与 Agent 职责划分

#### CLI 网关能力

网关向下游 SAI-CLI 提供以下核心支持：


| 能力       | 说明                                                                    |
| -------- | --------------------------------------------------------------------- |
| API 注册接口 | 接收 Harness Manager 的 API 注册请求，将 9 维 Tag、description、入参说明写入 SAI-CLI 注册中心 |
| 元数据搜索接口  | 支持 Agent 通过关键词/语义进行 API 搜索，返回匹配的命令候选列表                                |
| 元数据生成    | 支持通过自然语言描述，AI 自动生成命令元数据及 9 维 Tag 信息；业务团队 Review 确认后由 Harness Manager 注册生效 |
| 发布通知接口   | 接收 Harness Manager 的 CLI 版本上报，触发命令清单同步更新                              |
| 路由转发     | 根据 product 字段将请求路由至 SAI-CLI 对应命令集                                     |
| 权限校验     | 验证 Token 合法性及 Scope 是否满足命令所需权限；二期支持 PoP 签名验证                          |


#### Agent 职责


| 职责     | 说明                                      |
| ------ | --------------------------------------- |
| SSO 认证 | 通过 SSO 单点登录接口（或静默登录）获取 Token 及用户身份信息    |
| 信息持久化  | 将认证信息保存至本地 `~/.sai/sso-auth.json`       |
| API 搜索 | 根据用户提问，向 SAI-CLI 注册中心发起语义搜索，获取候选 API 列表 |
| API 选择 | 结合对话上下文，从候选 API 中选择最匹配的 API             |
| 命令拼接   | 依据所选 API 的入参说明，自动拼接完整 CLI 执行命令          |
| 命令执行   | 将拼接好的命令提交至网关执行，返回结构化结果给用户               |
| 鉴权标准   | 全链路权限认证统一使用 SSO Token                   |


---
