---
name: sai-cli
description: >-
  用于查询处理申通各业务系统数据与能力的企业技能入口，覆盖财务、网络、经营、
  政策、运营、运单、客户等业务域，支持数据查询、数据操作与命令发现。
version: 0.4.0
---

# 通用业务数据查询、操作


这个技能的核心用途不是讲解 CLI 本身，而是作为 Agent 访问申通各业务系统数据与操作能力的统一入口。它覆盖财务、网络、经营、政策、运营、运单、客户等业务域，通过远程注册中心动态发现并执行对应命令，所有响应均为结构化 JSON 输出。

底层执行载体是 `sai-cli`，因此本文档同时说明 Agent 应如何完成登录、发现命令、补齐参数并执行业务操作。

## 技能定位

当用户想查询申通业务数据、调用申通内部业务能力、定位某个业务系统里的信息，或以自然语言描述一个申通业务诉求时，应优先使用本技能，而不是把它理解为单纯的命令行帮助文档。

## 可执行文件位置

默认优先使用全局命令 `sai-cli`。如果环境中未安装全局命令，再尝试到 `~/.sai/bin` 目录查找同目录下的可执行文件。

执行规则如下：

1. 先直接执行 `sai-cli`
2. 如果返回“命令不存在”或等价错误，再查找与本 `SKILL.md` 同目录下的可执行文件
3. 找到本地可执行文件后，后续命令统一使用其完整路径执行

本文档后续示例中默认使用全局命令写法 `sai-cli`。Agent 在实际执行时应按上述规则选择命令；如果已回退到同目录可执行文件，则把示例中的 `sai-cli` 替换为对应完整路径，例如：

## 快速开始

```powershell
# 1. 查看版本
sai-cli version

# 2. 登录
sai-cli login

# 3. 浏览可用命令
sai-cli help

# 4. 搜索命令
sai-cli discover "查询出港滞留"

# 5. 执行业务命令
sai-cli baseinfo organize search --key 上海
```

## 内建命令一览

| 命令 | 说明 | 需要登录 |
|------|------|----------|
| `sai-cli version` | 显示 CLI 版本、commit、构建时间和环境 | 否 |
| `sai-cli login` | 通过 SSO 登录并缓存凭据 | 否 |
| `sai-cli logout` | 清除本地登录凭据 | 是 |
| `sai-cli whoami` | 显示当前登录身份 | 是 |
| `sai-cli help [product] [module] [action]` | 显示结构化帮助信息 | 否 |
| `sai-cli discover <query>` | 语义搜索候选命令 | 是 |
| `sai-cli refresh-cache [--all] [product] [module] [action]` | 强制刷新注册中心 schema 缓存 | 是 |
| `sai-cli list` | 列出所有可执行的注册命令（当前已禁用） | 是 |

## 版本信息

```powershell
sai-cli version
```

返回 CLI 的 `version`、`commit`、`buildTime` 和 `buildEnv`（构建环境档位）。无需登录。

## 登录与身份

使用 sai-cli CLI 前需要先完成 SSO 登录。

```powershell
sai-cli login
```

支持的可选参数：
- `--timeout-sec <秒数>` — 最大轮询等待时间，默认 120 秒
- `--interval-ms <毫秒>` — 轮询间隔，默认 1000 毫秒

**执行登录命令后，立马将登录地址返回给用户**，等待用户登录成功，凭据自动保存在 `~/.sai/sso-auth.json`，后续命令自动携带认证信息。

检查当前身份：

```powershell
sai-cli whoami
```

退出登录：

```powershell
sai-cli logout
```

Token 过期时命令会返回 `AUTH_TOKEN_EXPIRED`，重新执行 `sai-cli login` 即可。

## 命令发现

三种方式查找可用的业务命令：

### 逐级浏览

```powershell
sai-cli help                                    # 查看所有产品列表
sai-cli help <product>                          # 查看产品下的模块
sai-cli help <product> <module>                 # 查看模块下的操作
sai-cli help <product> <module> <action>        # 查看操作详情（参数、示例）
```

help 无需登录，输出中 `agentHints` 字段提供下一步操作建议。

查询帮助信息时，不要使用 `-f md` 或其他 Markdown 格式化参数；优先使用默认结构化输出，便于继续解析 `agentHints`、参数定义和 `outputFields` 等字段。

### 语义搜索

```powershell
sai-cli discover "查询出港滞留"
sai-cli discover "出港滞留" --limit 20
```

用自然语言描述需求，返回匹配的候选命令列表。支持不加引号的多段查询（多个词会自动拼接）。`--limit` 控制返回数量，默认 20。

每个候选命令包含以下字段：
- `path` — 命令路径（如 `kunlun.timeliness.query`）
- `summary` — 命令摘要
- `score` — 匹配分数
- `requiredFlags` — 必填参数列表
- `nextHelp` — 查看详情的命令（如 `sai-cli help kunlun timeliness query`）
- `runTemplate` — 执行模板（如 `sai-cli kunlun timeliness query --params JSON`）

如果只有一个候选明显匹配用户意图，Agent 可直接采用，并通过 `nextHelp` 获取完整 schema，收集 `requiredFlags` 中无法推断的参数后再执行。

如果存在多个与用户问题相关性都很强的候选命令，Agent 不能自行拍板，必须把候选项整理给用户选择。至少展示：
- 命令路径 `path`
- 命令摘要 `summary`
- 匹配分数 `score`
- 关键必填参数 `requiredFlags`

只有在用户明确选定后，才能继续执行对应命令的 help 和 run 流程。

### 缓存刷新

当注册中心的命令有更新时，可强制刷新本地缓存：

```powershell
sai-cli refresh-cache                             # 刷新根节点缓存
sai-cli refresh-cache <product>                   # 刷新指定产品缓存
sai-cli refresh-cache <product> <module>          # 刷新指定模块缓存
sai-cli refresh-cache <product> <module> <action> # 刷新指定操作缓存
sai-cli refresh-cache --all                       # 递归刷新整棵子树并清理失效缓存
sai-cli refresh-cache --all <product>             # 递归刷新指定产品及其子树
```

返回 `refreshedCount`、`refreshedPaths`、`prunedCount` 等信息。

## 执行业务命令

命令格式为固定三层路径：

```
sai-cli <product> <module> <action> [参数]
```

### 参数传递


**JSON 形式（推荐）：**

```powershell
sai-cli baseinfo organize search --params '{"key":"上海"}'
```

**KV 形式：**

```powershell
sai-cli baseinfo organize search --key 上海
```

两种方式可混合使用。同名参数时 KV 标志优先于 `--params` JSON 中的值。

### 参数类型自动转换

CLI 会根据命令 schema 中定义的参数类型自动做类型强制转换：
- `string` — 保持原样
- `int` / `integer` — 字符串自动转为整数
- `bool` / `boolean` — 字符串自动转为布尔值（true/false/1/0）

类型转换失败时返回 `ARGUMENT_INVALID`。

### 参数校验

缺少必填参数时返回 `ARGUMENT_INVALID`，错误消息中会列出缺少的字段名。可通过 `sai-cli help <product> <module> <action>` 查看完整参数定义。

## 输出格式

所有命令输出统一 JSON 信封：

```json
// 成功
{"ok": true, "data": {...}}

// 失败
{"ok": false, "error": {"code": "ERROR_CODE", "message": "...", "hint": "..."}}
```

解析建议：先检查 `ok` 字段，失败时根据 `error.code` 判断类型并按 `hint` 采取修复操作。`hint` 同时输出到 stderr。

登录流程的进度信息通过 stderr 输出 `[login]` 前缀的行，不污染 JSON 标准输出。

## 返回值字段说明

在向用户解释某个业务命令的返回字段时，Agent 必须优先参考 `sai-cli help <product> <module> <action>` 输出中的 `outputFields` 定义。

优先级规则如下：

1. 若 help 返回了 `outputFields`，必须以该字段中的名称、类型、说明为准
2. 只有在 help 未提供 `outputFields`，或该字段明显不完整时，才允许结合示例响应和字段命名做谨慎推断
3. 如果返回值字段来自推断而非 help 明示，必须明确告知用户“以下为推断说明”

不要在已有 `outputFields` 的情况下，用执行结果样例自行重写一套字段定义。

## 错误处理

| 错误码 | 含义 | 解决方法 |
|--------|------|----------|
| `AUTH_REQUIRED` | 未登录 | 执行 `sai-cli login` |
| `AUTH_TOKEN_EXPIRED` | Token 已过期 | 重新执行 `sai-cli login` |
| `AUTH_CONFIG_INVALID` | 认证配置读取失败 | 执行 `sai-cli login` 重新初始化 |
| `AUTH_LOGIN_TIMEOUT` | 登录轮询超时 | 先打开 loginUrl 完成 SSO，再重试 `sai-cli login` |
| `CONFIG_INVALID` | 环境配置无效 | 检查 `~/.sai/cli-config.json` 或 `SAI_*` 环境变量 |
| `COMMAND_NOT_FOUND` | 命令路径不存在 | 通过 `sai-cli help` 或 `sai-cli discover` 查找正确路径 |
| `COMMAND_DISABLED` | 命令已禁用 | 该命令尚未启用，等待后续版本 |
| `ARGUMENT_INVALID` | 参数缺失或格式/类型错误 | 通过 `sai-cli help <product> <module> <action>` 查看必填参数和类型 |
| `EXECUTION_FAILED` | 下游 API 执行失败 | 检查参数是否正确或下游服务状态 |
| `REGISTRY_UNAVAILABLE` | 命令注册中心不可达 | 检查网络连接；可尝试 `sai-cli refresh-cache` |
| `INTERNAL_ERROR` | CLI 内部错误 | 重试操作 |

## 环境与配置

CLI 环境档位（test/prod）在构建时固定，运行时不可切换。配置优先级从高到低：

1. **环境变量** — `SAI_SSO_*`、`SAI_REGISTRY_*`、`SAI_API_BASE_URL` 等
2. **配置文件** — `~/.sai/cli-config.json`
3. **内建档位** — 构建时写入的 test/prod 默认配置

可通过 `sai-cli version` 查看当前 `buildEnv` 确认环境档位。

## Agent 典型工作流

1. 执行 `sai-cli version` 确认 CLI 版本和环境
2. 执行 `sai-cli whoami` 检查登录状态；若返回 `AUTH_REQUIRED` 则先执行 `sai-cli login`
3. 执行 `sai-cli help` 获取可用产品列表，根据 `agentHints` 逐级浏览
4. 或执行 `sai-cli discover "<自然语言描述>"` 直接搜索目标命令
5. 若只有一个明显最佳候选则继续；若有多个高相关候选，先让用户选择
6. 通过 `sai-cli help <product> <module> <action>` 获取命令参数定义和 `outputFields`
7. 收集 `requiredFlags` 中用户未提供的必填参数（向用户询问）
8. 拼装参数执行命令，解析返回的 JSON 结果，并优先基于 `outputFields` 解释返回字段
9. 若遇到错误，根据 `error.code` 和 `hint` 自动修复后重试
10. 若发现命令找不到，尝试 `sai-cli refresh-cache` 刷新缓存后重试
