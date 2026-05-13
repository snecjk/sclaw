# SAI CLI 架构与 Agent API 发现机制 Review

更新日期：2026-04-24

本文整理对 SAI CLI 当前代码与架构设计的 review 结论，重点从两个角度评估：

1. CLI 作为统一命令入口的架构合理性。
2. 面向 Agent 在多个历史系统、几百个 API 中高效发现和正确调用 API 的机制是否足够。

## 1. 总体判断

SAI CLI 当前方向是合理的：CLI 不硬编码业务 API，而是通过 registry 元数据驱动动态命令发现、参数说明、缓存和执行代理。这适合多个历史系统、多领域 API 的统一接入场景。

当前设计已经具备几个正确基础：

- `discover -> help/schema -> execute` 的三段式链路，避免 Agent 搜到候选后直接盲目执行。
- 固定动态命令路径 `{product}.{module}.{action}`，利于 Agent 从领域、模块、动作逐步收敛。
- registry schema 本地缓存和 TTL，降低 Agent 高频调用 `help`、`discover`、`list` 时的延迟。
- JSON envelope 输出，便于 Agent 稳定解析成功和失败结果。
- `--params JSON` 与 `--key value` 合并规则，兼顾机器调用和人工调试。

主要不足在于：当前发现机制仍偏“命令树浏览 + 简单语义搜索”，尚未形成完整的 Agent API router。对几百个历史 API 来说，Agent 不只需要找到候选命令，还需要理解候选为何匹配、何时适用、缺哪些参数、能否从上下文推断、执行风险是什么。

## 2. 当前架构合理性

### 2.1 合理部分

当前模块边界大体清晰：

- `internal/cli`：Cobra 命令注册、鉴权门禁、动态命令分发。
- `internal/registry`：命令注册中心客户端、schema 读取、本地缓存、discover/list 解析。
- `internal/execute`：按 registry 的 `execute` 元数据构造并调用目标 API。
- `internal/auth`：本地登录态读写和 token 过期判断。
- `internal/config`：环境 profile、URL、TTL、超时等配置解析。
- `internal/params`：参数解析与合并。
- `internal/output`：统一 JSON 输出。

这个分层符合“薄 CLI + registry 元数据驱动”的方向。CLI 保持通用能力，API 知识放在 registry，后续新增历史系统 API 时不需要发版 CLI。

### 2.2 不合理或需要优化的部分

#### 问题 1：动态命令兜底分发没有接入真实入口

位置：

- `main.go`
- `internal/cli/dynamic.go`

当前 `main.go` 只执行：

```go
cli.NewRootCmd().Execute()
```

而 `TryDynamicDispatch(argv)` 虽然存在，但没有接入。动态产品命令依赖启动时 `attachDynamicProductCommands(root)` 预挂载。如果 registry 或根缓存不可用，预挂载会静默失败，合法动态命令会被 Cobra 判成未知命令。

影响：

- Agent 输入合法命令时，结果可能取决于启动时 registry/cache 状态。
- 动态命令的可用性与 shell help/补全强绑定，不够稳。

建议：

- 在 `main.go` 或 root command 层接入 `TryDynamicDispatch(os.Args[1:])`。
- 或者改为 root `RunE/Args` 统一解析未知三段路径，不依赖启动期预挂载。
- 保留预挂载只用于 shell help 和补全，不作为动态命令能否执行的唯一入口。

#### 问题 2：下游 4xx/5xx 被包装成成功

位置：

- `internal/execute/query.go`

`RunQuery` 当前读取响应后，无论 HTTP 状态码是 200、401、500，都会返回 `nil` error。外层 `dynamic.go` 会继续输出：

```json
{"ok": true, "data": {...}}
```

影响：

- Agent 无法可靠判断 API 调用是否失败。
- 自动化脚本可能把 500 或 401 当成成功。
- 后续重试、补登录、提示用户补参数都无法正确触发。

建议：

- 在 `RunQuery` 中对非 2xx 返回 typed error。
- 按状态码映射：
  - `401` -> `AUTH_REQUIRED` 或 `AUTH_TOKEN_EXPIRED`
  - `403` -> `FORBIDDEN`
  - `400/422` -> `ARGUMENT_INVALID` 或 `DOWNSTREAM_ARGUMENT_INVALID`
  - `5xx` -> `DOWNSTREAM_UNAVAILABLE`
- 成功 envelope 只用于真正 2xx。

#### 问题 3：默认 prod profile 仍是占位 URL

位置：

- `internal/config/profiles.go`

当前 README 说明不传 `Env` 默认打 prod 包，但 prod profile 中仍包含 `REPLACE_PROD_*` 占位 URL。

影响：

- 生产包可能构建成功，但运行时访问无效地址。
- 问题会延迟到发布后暴露。

建议：

- 构建脚本在 `-Env prod` 时校验 profile，不允许 `REPLACE_` 占位进入产物。
- 或将 prod profile 从代码中移除，要求生产 URL 通过构建变量或配置注入。
- `version` 输出中保留 `buildEnv` 和关键 endpoint 摘要，便于排查。

#### 问题 4：下游请求日志默认输出业务参数

位置：

- `internal/execute/query.go`

`writeDownstreamDebugLog` 每次执行都会向 stderr 输出 URL、query、input、body。token 已脱敏，但业务参数本身可能敏感。

影响：

- 污染 Agent 解析 stderr。
- 可能泄露业务查询条件。
- 在 CI 或用户终端日志中产生不必要噪音。

建议：

- 仅在 `SAI_DEBUG=true` 时输出。
- 对敏感字段做 masking。
- 输出 request id、path、method、status、duration 即可，默认不输出完整 input/body。

#### 问题 5：`registry.Client` 责任过重

位置：

- `internal/registry/client.go`

该文件同时承担：

- HTTP transport。
- 缓存读取和回源。
- ETag/304 处理。
- tree refresh。
- stale cache fallback。
- schema children 解析。
- command meta 解析。
- response 兼容字段深度查找。

影响：

- 单文件复杂度过高。
- registry 协议演进时容易引入回归。
- 兼容解析逻辑和 transport/cache 逻辑耦合。

建议拆分为：

- `transport.go`：HTTP 请求、重试、状态码处理。
- `cache_store.go`：本地缓存。
- `commands_client.go`：`GetChildren`、`GetCommandMeta`、`GetCommandDoc`。
- `parser.go`：registry JSON 解析和兼容字段处理。
- `refresh.go`：`RefreshPath`、`RefreshTree`、prune。

#### 问题 6：`execute.RunQuery` 边界偏厚

位置：

- `internal/execute/query.go`

当前 `RunQuery` 同时做：

- 读取 auth state。
- 判断 token 过期。
- 构造 URL/query/body。
- 写调试日志。
- 创建 HTTP client。
- 发送请求。
- 解析响应。

建议：

- 引入 `Executor` 结构体，注入 `http.Client`、token provider、logger。
- 将请求构造拆成纯函数，单测覆盖 query/body map。
- 将响应状态码处理拆成 `parseDownstreamResponse`。

## 3. 面向 Agent 的发现机制评估

### 3.1 当前机制

当前链路是：

```text
sai discover <query>
  -> 返回候选 path、summary、score、requiredFlags

sai help <product> <module> <action>
  -> 返回命令文档、flags、execute 元数据

sai <product> <module> <action> --params JSON
  -> 执行目标 API
```

这是合理的 v1 骨架，但对“几百个历史 API”还不够。

Agent 在真实上下文中面对的问题通常不是“找不到 API”，而是：

- 找到了多个相似 API，不知道哪个更适合。
- 用户输入缺参数，不知道哪些能推断、哪些必须追问。
- API 名称和业务口径相近，但数据粒度、延迟、适用边界不同。
- 部分 API 只读，部分 API 有副作用，需要不同执行策略。
- 历史系统字段名不统一，需要参数归一化。

因此 discover 不应该只是“搜索命令路径”，而应该返回“可执行意图候选”。

## 4. 发现机制改进方向

### 4.1 推荐的 Agent 发现链路

建议将发现链路设计为四层：

```text
1. list/index
   快速知道当前用户可见 API 空间。

2. discover
   根据自然语言、上下文、权限和标签召回候选。

3. schema/help
   获取候选的完整输入、输出、约束、适用边界和示例。

4. validate/dry-run
   执行前校验参数、风险、规范化结果和目标 endpoint。
```

CLI 不需要承担复杂语义判断。语义搜索、权限过滤、领域知识应在 registry/index 层完成。CLI 的职责是提供稳定、结构化、可缓存、可执行的协议。

### 4.2 增强 discover 返回结构

当前 discover 候选字段偏轻：

```json
{
  "path": "kunlun.timeliness.query",
  "summary": "查询昆仑出港滞留时效",
  "score": 0.97,
  "requiredFlags": ["type", "date"]
}
```

建议升级为：

```json
{
  "path": "kunlun.timeliness.query",
  "summary": "查询昆仑出港滞留时效",
  "domain": "时效",
  "intent": "查询出港滞留",
  "score": 0.92,
  "confidence": "high",
  "matchReason": "用户提到出港滞留和日期，匹配该命令的 type/date 参数",
  "requiredFlags": ["type", "date"],
  "optionalFlags": ["siteCode", "region"],
  "missingFlags": ["date"],
  "inferredParams": {
    "type": "出港滞留"
  },
  "riskLevel": "readonly",
  "nextHelp": "sai help kunlun timeliness query"
}
```

关键字段：

- `matchReason`：告诉 Agent 为什么该 API 被召回。
- `confidence`：辅助 Agent 判断是否需要用户确认。
- `missingFlags`：直接提示缺什么。
- `inferredParams`：把可从上下文推断的参数结构化返回。
- `riskLevel`：区分只读查询和有副作用操作。

### 4.3 list/index 应支持过滤和轻量索引

当前 `sai list` 设计为分页返回当前用户可见叶子命令。对于几百个 API，仅分页 20 条对 Agent 价值有限。

建议支持：

```bash
sai list --product kunlun
sai list --module timeliness
sai list --tag readonly
sai list --query 时效
sai list --capability query
```

registry list API 可增加 query 参数：

```text
product
module
tag
query
capability
page
pageSize
```

这样 Agent 可以先按领域或标签粗筛，再调用 discover 做语义召回。

### 4.4 command schema 需要描述适用边界

历史 API 的难点通常不是 URL 和参数，而是“什么时候该用它，什么时候不该用它”。

建议 command doc 增加：

```json
{
  "usagePolicy": {
    "useWhen": [
      "用户要查询出港滞留时效",
      "需要按日期查询聚合指标"
    ],
    "doNotUseWhen": [
      "用户要查询包裹轨迹明细",
      "用户要执行拦截、取消、修改等操作"
    ],
    "dataFreshness": "T+0，约 5 分钟延迟",
    "sideEffect": "readonly",
    "confirmationRequired": false
  }
}
```

`doNotUseWhen` 对 Agent 尤其重要，可以减少相似 API 误用。

### 4.5 参数 schema 需要支持 Agent 补全和追问

当前 flags 结构包括 `name/type/required/description/example`，建议扩展：

```json
{
  "name": "date",
  "type": "string",
  "format": "date",
  "required": true,
  "description": "查询日期",
  "examples": ["2026-04-24"],
  "inferFrom": ["用户提到的今天、昨天、本周"],
  "defaultStrategy": "ask_user",
  "askWhenMissing": true,
  "sensitive": false
}
```

对于枚举类业务字段建议支持：

```json
{
  "name": "type",
  "type": "string",
  "required": true,
  "enum": ["出港滞留", "进港滞留"],
  "aliases": {
    "出港延误": "出港滞留",
    "进港延误": "进港滞留"
  },
  "normalization": "enum_alias"
}
```

Agent 需要知道：

- 哪些参数可以从用户话术推断。
- 哪些参数必须追问。
- 字段格式是什么。
- 业务别名如何归一化。
- 哪些参数敏感，不能默认写日志。

### 4.6 增加 validate 或 dry-run

建议支持执行前校验：

```bash
sai validate kunlun timeliness query --params JSON
```

或：

```bash
sai kunlun timeliness query --params JSON --dry-run
```

返回示例：

```json
{
  "ok": true,
  "data": {
    "path": "kunlun.timeliness.query",
    "valid": true,
    "normalizedInput": {
      "type": "出港滞留",
      "date": "2026-04-23"
    },
    "missing": [],
    "warnings": [],
    "resolvedEndpoint": "/api/mock/kunlun/timeliness",
    "sideEffect": "readonly",
    "confirmationRequired": false
  }
}
```

价值：

- Agent 可以在执行前确认参数是否完整。
- 可以提前发现枚举、日期、权限等问题。
- 对有副作用 API，可以要求用户确认。
- 能降低历史 API 误调用风险。

### 4.7 discover 请求应支持上下文

当前 discover 请求只有：

```json
{
  "query": "查一下昨天华东出港滞留",
  "limit": 5
}
```

建议扩展为：

```json
{
  "query": "查一下昨天华东出港滞留",
  "limit": 5,
  "context": {
    "locale": "zh-CN",
    "recentPaths": [],
    "preferredProduct": "kunlun",
    "conversationHints": {
      "date": "2026-04-23",
      "region": "华东"
    }
  }
}
```

registry 可以利用上下文做排序和参数推断。CLI 不需要理解这些字段，只需要透传即可。

## 5. 建议的目标架构

建议将系统契约划分为三层。

### 5.1 CLI 层

职责：

- 统一 JSON 输出。
- 登录态和鉴权头。
- 动态命令路径解析。
- 参数合并和基础校验。
- 本地 schema/index cache。
- 调用 registry 和下游 API。
- 非 2xx 状态码可靠映射为错误 envelope。

CLI 不负责：

- 复杂语义搜索。
- API 业务口径判断。
- 权限规则计算。
- 历史系统字段知识维护。

### 5.2 Registry 层

职责：

- command tree。
- command list index。
- semantic discover。
- permission-aware filtering。
- command schema/doc/policy metadata。
- 参数枚举、别名、归一化规则。
- API 适用边界与风险等级。

### 5.3 Agent Discovery Contract

面向 Agent 的稳定协议应提供：

- 候选召回。
- 候选解释。
- 适用和不适用场景。
- 参数需求。
- 参数推断结果。
- 缺失参数。
- 风险等级。
- 执行前校验。
- 结构化错误。

## 6. 优先级建议

### P0：保证 Agent 能可靠执行和判断结果

1. 修复下游非 2xx 仍返回 `ok=true`。
2. 接入动态命令兜底分发，避免合法动态命令依赖启动时预挂载。

### P1：提升发现质量

1. 增强 discover 返回：`matchReason`、`missingFlags`、`inferredParams`、`confidence`、`riskLevel`。
2. command doc 增加 `useWhen`、`doNotUseWhen`、`sideEffect`、`dataFreshness`。
3. list API 增加 product/module/tag/query/capability 过滤。

### P2：提升执行前安全性

1. 增加 `validate` 或 `--dry-run`。
2. 参数 schema 增加 `format`、`enum`、`aliases`、`inferFrom`、`askWhenMissing`、`sensitive`。
3. 有副作用 API 引入 `confirmationRequired`。

### P3：提升代码可维护性

1. 拆分 `registry.Client`。
2. 拆分 `execute.RunQuery`。
3. debug 日志改为显式开启，并对业务参数脱敏。
4. 构建阶段校验 prod profile。

## 7. 推荐演进路线

### 阶段 1：修正 CLI 可靠性问题

- 修复非 2xx 状态码处理。
- 接入动态命令兜底分发。
- 调试日志默认关闭。

### 阶段 2：扩展 registry 元数据协议

- discover 返回候选解释、缺失参数、推断参数和风险等级。
- command doc 增加 usage policy。
- flags 增加参数格式、枚举、别名和补全策略。

### 阶段 3：增强 Agent 工具链

- 增加 `validate` 或 `--dry-run`。
- list 支持过滤。
- help/schema 输出更稳定的 Agent hints。

### 阶段 4：重构内部实现

- 拆分 registry client。
- 引入 executor。
- 建立 registry contract tests，保证新旧响应兼容。

## 8. 结论

SAI CLI 当前适合作为 v1 骨架，但如果目标是让 Agent 在多个历史系统、几百个 API 中高效发现和正确调用，registry 元数据需要从“命令说明”升级为“Agent 可决策的 API contract”。

核心改进方向不是让 CLI 变得更聪明，而是让 registry 返回的信息足够结构化、可解释、可验证。CLI 应保持薄而可靠，负责稳定协议、缓存、鉴权、参数校验和执行反馈；API 语义、适用边界、候选排序和参数推断应主要由 registry/index 层承担。
