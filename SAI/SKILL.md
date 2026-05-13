---
name: sai-agent-cli
description: >-
  SAI Agent CLI 命令行工具使用指南。当用户询问 "sai命令"、"如何使用sai"、
  "sai怎么用"、"sai login"、"sai help"、"sai discover"、"sai 登录"、
  "sai 查询"、"sai CLI"、"sai version"、"sai refresh-cache"、
  命令行工具使用方法，或遇到 AUTH_REQUIRED、AUTH_TOKEN_EXPIRED、
  COMMAND_NOT_FOUND、EXECUTION_FAILED、CONFIG_INVALID、
  COMMAND_DISABLED 等 SAI 错误码时触发。
version: 0.3.0
---

# SAI Agent CLI 使用指南

SAI CLI 是面向 agent 和人工终端的命令行工具，通过远程注册中心提供动态业务命令的发现与执行能力。所有响应均为结构化 JSON 输出。

## 可执行文件位置

`sai.exe` 与本 SKILL.md 位于同一目录下。执行所有 `sai` 命令时，**必须使用完整路径**：


本文档后续示例中写的 `sai` 均表示上述完整路径。Agent 在实际执行时必须替换为完整路径，例如：

## 快速开始

```powershell
# 1. 查看版本
sai version

# 2. 登录
sai login

# 3. 浏览可用命令
sai help

# 4. 搜索命令
sai discover "查询出港滞留"

# 5. 执行业务命令
sai baseinfo organize search --key 上海
```

## 内建命令一览

| 命令 | 说明 | 需要登录 |
|------|------|----------|
| `sai version` | 显示 CLI 版本、commit、构建时间和环境 | 否 |
| `sai login` | 通过 SSO 登录并缓存凭据 | 否 |
| `sai logout` | 清除本地登录凭据 | 是 |
| `sai whoami` | 显示当前登录身份 | 是 |
| `sai help [product] [module] [action]` | 显示结构化帮助信息 | 否 |
| `sai discover <query>` | 语义搜索候选命令 | 是 |
| `sai refresh-cache [--all] [product] [module] [action]` | 强制刷新注册中心 schema 缓存 | 是 |
| `sai list` | 列出所有可执行的注册命令（当前已禁用） | 是 |

## 版本信息

```powershell
sai version
```

返回 CLI 的 `version`、`commit`、`buildTime` 和 `buildEnv`（构建环境档位）。无需登录。

## 登录与身份

使用 SAI CLI 前需要先完成 SSO 登录。

```powershell
sai login
```

支持的可选参数：
- `--timeout-sec <秒数>` — 最大轮询等待时间，默认 120 秒
- `--interval-ms <毫秒>` — 轮询间隔，默认 1000 毫秒

**执行登录命令后，立马将登录地址返回给用户**，等待用户登录成功，凭据自动保存在 `~/.sai/sso-auth.json`，后续命令自动携带认证信息。

检查当前身份：

```powershell
sai whoami
```

退出登录：

```powershell
sai logout
```

Token 过期时命令会返回 `AUTH_TOKEN_EXPIRED`，重新执行 `sai login` 即可。

## 命令发现

三种方式查找可用的业务命令：

### 逐级浏览

```powershell
sai help                                    # 查看所有产品列表
sai help <product>                          # 查看产品下的模块
sai help <product> <module>                 # 查看模块下的操作
sai help <product> <module> <action>        # 查看操作详情（参数、示例）
```

help 无需登录，输出中 `agentHints` 字段提供下一步操作建议。

### 语义搜索

```powershell
sai discover "查询出港滞留"
sai discover "出港滞留" --limit 3
```

用自然语言描述需求，返回匹配的候选命令列表。支持不加引号的多段查询（多个词会自动拼接）。`--limit` 控制返回数量，默认 5。

每个候选命令包含以下字段：
- `path` — 命令路径（如 `kunlun.timeliness.query`）
- `summary` — 命令摘要
- `score` — 匹配分数
- `requiredFlags` — 必填参数列表
- `nextHelp` — 查看详情的命令（如 `sai help kunlun timeliness query`）
- `runTemplate` — 执行模板（如 `sai kunlun timeliness query --params JSON`）

Agent 应根据 `score` 选择最佳候选，通过 `nextHelp` 获取完整 schema，收集 `requiredFlags` 中无法推断的参数后再执行。

### 缓存刷新

当注册中心的命令有更新时，可强制刷新本地缓存：

```powershell
sai refresh-cache                             # 刷新根节点缓存
sai refresh-cache <product>                   # 刷新指定产品缓存
sai refresh-cache <product> <module>          # 刷新指定模块缓存
sai refresh-cache <product> <module> <action> # 刷新指定操作缓存
sai refresh-cache --all                       # 递归刷新整棵子树并清理失效缓存
sai refresh-cache --all <product>             # 递归刷新指定产品及其子树
```

返回 `refreshedCount`、`refreshedPaths`、`prunedCount` 等信息。

## 执行业务命令

命令格式为固定三层路径：

```
sai <product> <module> <action> [参数]
```

### 参数传递


**JSON 形式（推荐）：**

```powershell
sai baseinfo organize search --params '{"key":"上海"}'
```

**KV 形式：**

```powershell
sai baseinfo organize search --key 上海
```

两种方式可混合使用。同名参数时 KV 标志优先于 `--params` JSON 中的值。

### 参数类型自动转换

CLI 会根据命令 schema 中定义的参数类型自动做类型强制转换：
- `string` — 保持原样
- `int` / `integer` — 字符串自动转为整数
- `bool` / `boolean` — 字符串自动转为布尔值（true/false/1/0）

类型转换失败时返回 `ARGUMENT_INVALID`。

### 参数校验

缺少必填参数时返回 `ARGUMENT_INVALID`，错误消息中会列出缺少的字段名。可通过 `sai help <product> <module> <action>` 查看完整参数定义。

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

## 错误处理

| 错误码 | 含义 | 解决方法 |
|--------|------|----------|
| `AUTH_REQUIRED` | 未登录 | 执行 `sai login` |
| `AUTH_TOKEN_EXPIRED` | Token 已过期 | 重新执行 `sai login` |
| `AUTH_CONFIG_INVALID` | 认证配置读取失败 | 执行 `sai login` 重新初始化 |
| `AUTH_LOGIN_TIMEOUT` | 登录轮询超时 | 先打开 loginUrl 完成 SSO，再重试 `sai login` |
| `CONFIG_INVALID` | 环境配置无效 | 检查 `~/.sai/cli-config.json` 或 `SAI_*` 环境变量 |
| `COMMAND_NOT_FOUND` | 命令路径不存在 | 通过 `sai help` 或 `sai discover` 查找正确路径 |
| `COMMAND_DISABLED` | 命令已禁用 | 该命令尚未启用，等待后续版本 |
| `ARGUMENT_INVALID` | 参数缺失或格式/类型错误 | 通过 `sai help <product> <module> <action>` 查看必填参数和类型 |
| `EXECUTION_FAILED` | 下游 API 执行失败 | 检查参数是否正确或下游服务状态 |
| `REGISTRY_UNAVAILABLE` | 命令注册中心不可达 | 检查网络连接；可尝试 `sai refresh-cache` |
| `INTERNAL_ERROR` | CLI 内部错误 | 重试操作 |

## 环境与配置

CLI 环境档位（test/prod）在构建时固定，运行时不可切换。配置优先级从高到低：

1. **环境变量** — `SAI_SSO_*`、`SAI_REGISTRY_*`、`SAI_API_BASE_URL` 等
2. **配置文件** — `~/.sai/cli-config.json`
3. **内建档位** — 构建时写入的 test/prod 默认配置

可通过 `sai version` 查看当前 `buildEnv` 确认环境档位。

## Agent 典型工作流

1. 执行 `sai version` 确认 CLI 版本和环境
2. 执行 `sai whoami` 检查登录状态；若返回 `AUTH_REQUIRED` 则先执行 `sai login`
3. 执行 `sai help` 获取可用产品列表，根据 `agentHints` 逐级浏览
4. 或执行 `sai discover "<自然语言描述>"` 直接搜索目标命令
5. 从候选列表中根据 `score` 选择最佳匹配
6. 通过 `sai help <product> <module> <action>` 获取命令参数定义
7. 收集 `requiredFlags` 中用户未提供的必填参数（向用户询问）
8. 拼装参数执行命令，解析返回的 JSON 结果
9. 若遇到错误，根据 `error.code` 和 `hint` 自动修复后重试
10. 若发现命令找不到，尝试 `sai refresh-cache` 刷新缓存后重试
