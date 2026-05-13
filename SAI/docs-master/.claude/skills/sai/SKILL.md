---
name: sai
description: SAI 申通快递智能数据查询 CLI 工具。当用户需要查询申通快递的业务数据、网点信息、业务量指标、网络贡献、派件履约、损益分析等运营和财务数据时，使用此 skill。也适用于用户提到"网点查询"、"业务量"、"达成率"、"派费"、"面单损益"、"派件履约"、"网络贡献"、"中转收入"、"散单量"等申通业务术语的场景，即使没有显式提及 sai CLI。此 skill 指导如何通过 sai 命令行工具发现、理解并执行合适的查询命令来获取数据。
---

# SAI CLI 数据查询 Skill

## 前置条件

确保已经登录 sai CLI：

```bash
sai login    # 通过 SSO 登录
sai whoami   # 检查当前认证状态
```

如果 `sai whoami` 显示 `loggedIn: false`，先执行 `sai login`。

## 核心工作流程

使用 sai CLI 查询数据遵循三步流程：**发现 → 理解 → 执行**。

### Step 1: 发现（Discover）

用 `sai discover` 搜索匹配用户意图的命令。这是最关键的入口——不要凭记忆猜测命令路径，始终用 discover 来确认。

```bash
sai discover "用户意图关键词"
```

discover 返回候选命令列表，每个候选包含：
- **path**: 命令路径，如 `metric.biznum.query`
- **summary**: 命令功能概述
- **score**: 匹配度评分
- **requiredFlags**: 必须提供的参数
- **nextHelp**: 获取完整 schema 的命令

### Step 2: 理解（Inspect）

对选中的候选命令，用 `sai help` 获取完整参数 schema，确认所有必填参数的含义和格式。

```bash
sai help <command path>
```

例如：`sai help metric biznum query`

help 返回每个 flag 的：
- **name**: 参数名
- **type**: 类型（string / integer / boolean / array）
- **required**: 是否必填
- **description**: 含义说明

仔细阅读 description，理解参数的格式要求（日期格式、枚举值等）。

### Step 3: 执行（Execute）

根据 help 返回的 schema，构造 `--params` JSON 并执行命令。

```bash
sai <command path> --params '<JSON>'
```

参数 JSON 的 key 对应 help 中返回的 flag name。

## 已知命令参考

以下是当前 registry 中可用的命令。但 registry 可能动态更新，遇到不确定的场景时优先使用 discover。

### 网点组织查询（baseinfo）

| 命令 | 路径 | 用途 | 必填参数 |
|------|------|------|----------|
| 网点模糊搜索 | `baseinfo.organize.search` | 按名称/编码关键字检索网点 | `key` |

示例：
```bash
sai baseinfo organize search --params '{"key":"浙江义乌","page_num":1,"page_size":20}'
```

### 业务量指标（metric.biznum）

| 命令 | 路径 | 用途 | 必填参数 |
|------|------|------|----------|
| 业务量查询 | `metric.biznum.query` | 查询网点/组织的业务量、散单量、达成率等 | `targetOrgCode`, `orgDimension`, `dateDimension`, `statDate` |

关键参数说明：
- `targetOrgCode`: 网点编码（如 `030000`），全国用 `V000000`
- `orgDimension`: `SITE`(网点) / `BIG_AREA`(大区) / `POLICY_PROV`(政策省)
- `dateDimension`: `MTD`(月累计)
- `statDate`: 格式 `yyyyMMdd`，如 `20260421`

### 网络贡献指标（metric.netcontribute）

| 命令 | 路径 | 用途 | 必填参数 |
|------|------|------|----------|
| 网络贡献查询 | `metric.netcontribute.query` | 查询政策返利、中转收入、派费利润及趋势 | `targetOrgCode`, `orgDimension`, `dateDimension` |

### 派件履约（network.delivery）

| 命令 | 路径 | 用途 | 必填参数 |
|------|------|------|----------|
| 履约指标查询 | `network.delivery.query` | 查询按需派送、客户声音、派前电联、签收短信的履约量率 | 无严格必填，但通常需要 `orgLvl`, `dateType`, `startDate`, `endDate` |

关键参数：
- `orgLvl`: `1`(全国) / `2`(大区) / `42`(大片区) / `43`(小片区) / `6`(网点) / `7`(承包区)
- `dateType`: `10`(日) / `20`(周) / `30`(月)

### 派费损益（finance.paifei）

| 命令 | 路径 | 用途 | 必填参数 |
|------|------|------|----------|
| 派费损益总表 | `finance.paifei.list` | 查询派费产品线收入、成本、利润 | `reportDateDim`, `dt` |

关键参数：
- `reportDateDim`: `日` / `周` / `月` / `年`
- `dt`: 日期格式取决于维度——日 `yyyyMMdd`、月 `yyyyMM`、周 `yyyyMMdd-yyyyMMdd`
- `columnType`: `curM`(本年实际) / `curPre`(本年预测) / `curD`(本年预算) / `lastM`(上年实际)

### 面单损益（finance.pnl）

| 命令 | 路径 | 用途 | 必填参数 |
|------|------|------|----------|
| 面单损益总表 | `finance.pnl.list` | 查询面单产品线损益（信息服务收支、截留、返利、利润） | `reportDateDim`, `dt` |

参数格式与 paifei 相同。

## 处理用户请求的指南

1. **理解用户意图** — 确定用户想查什么数据（网点信息？业务量？财务指标？履约率？）
2. **如果用户提供了网点名称但没给编码** — 先用 `baseinfo.organize.search` 查出网点编码，再用于后续查询
3. **如果用户没指明具体日期** — 对于 metric 查询，statDate 可以传空字符串；对于 finance 查询，默认用月维度和当月
4. **如果不确定该用哪个命令** — 用 `sai discover` 搜索，不要硬猜
5. **执行前先 inspect** — 始终用 `sai help` 确认参数格式，避免构造错误的 JSON
6. **展示结果** — 将 sai 返回的 JSON 数据以清晰的格式呈现给用户，提取关键指标并做简要解读

## 常见场景示例

**场景1: 查某网点本月业务量达成率**
```bash
# 先查网点编码
sai baseinfo organize search --params '{"key":"义乌","page_size":5}'
# 用得到的编码查业务量
sai metric biznum query --params '{"targetOrgCode":"030000","orgDimension":"SITE","dateDimension":"MTD","statDate":""}'
```

**场景2: 查全国派件履约情况**
```bash
sai network delivery query --params '{"orgLvl":"1","dateType":"30","startDate":"20260301","endDate":"20260331"}'
```

**场景3: 查本月面单损益**
```bash
sai finance pnl list --params '{"reportDateDim":"month","dt":"202604","columnType":"curM"}'
```