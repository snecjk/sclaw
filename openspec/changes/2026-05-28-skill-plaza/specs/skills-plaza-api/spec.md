# Capability: `skills-plaza-api`（本 change 新增）

## 概览

本 capability 定义技能广场全部 7 个 host-api 端点的请求/响应契约、错误码规范、以及数据模型。前端 MUST 通过 `src/lib/host-api.ts` 的 `hostApiFetch()` 调用这些接口，MUST NOT 直接调用 Gateway HTTP 端点或使用 `window.electron.ipcRenderer.invoke()`。

## 通用响应格式

所有接口遵循项目统一的 `{ success, results/data, error }` 包装格式：

**成功响应**:

```json
{ "success": true, "data": { ... } }
```

**错误响应**:

```json
{ "success": false, "error": "人类可读的错误信息", "code": "ERROR_CODE" }
```

HTTP 状态码统一为 `200`，业务错误通过 `success` 字段和 `code` 区分。

## 数据模型

### SkillSummary（技能摘要）

用于列表项展示的核心字段：


| 字段             | 类型           | 必填       | 说明                                                        |
| -------------- | ------------ | -------- | --------------------------------------------------------- |
| `slug`         | string       | 是        | 技能唯一标识（kebab-case）                                        |
| `title`        | string       | 是        | 展示名称                                                      |
| `description`  | string       | 是        | 简短描述（最多 80 字符）                                            |
| `category`     | string \| null | 是       | 分类中文展示名称（label），未分类为 `null`                             |
| `categoryCode` | string \| null | 是       | 分类英文编码（slug），用于过滤和 `categoryCounts` 计数，未分类为 `null`      |
| `source`       | `"official"` \| `"mine"` | 是 | 来源：官方 / 自建，**由后端根据 `author_id` 推导，不持久化存储** |
| `installed`    | boolean      | 是        | 本地是否已安装，**从 `lock.json` / `skills/` 目录实时读取，不持久化存储**    |
| `enabled`      | boolean      | 否        | 是否启用（仅已安装技能有效），**从 `openclaw.json` 实时读取，不持久化存储**    |
| `installCount` | number       | 否        | 安装次数（用于热门排序）                                              |
| `useCount`     | number       | 否        | 使用次数                                                      |
| `points`       | number \| null | 是     | 预计积分消耗，本期固定返回 `8`                                |
| `icon`         | string       | 否        | 图标完整 SVG 字符串，前端直接渲染                                |
| `defaultPrompt`| string       | 是        | 技能默认使用的初始 prompt，前端据此拼接为 `/conversation?q=<encodedPrompt>` 跳转 |
| `updatedAt`    | string       | 否        | 最近更新时间（ISO 8601）                                          |


### SkillDetail（技能详情）

详情弹窗使用的完整数据模型，包含 `SkillSummary` 全部字段加：


| 字段             | 类型     | 必填  | 说明     |
| -------------- | ------ | --- | ------ |
| `detail.intro` | string | 是   | 技能介绍文本 |


### CategoryDef（分类定义）


| 字段      | 类型     | 必填  | 说明              |
| ------- | ------ | --- | --------------- |
| `id`    | string | 是   | 唯一标识            |
| `slug`  | string | 是   | kebab-case 分类标识 |
| `label` | string | 是   | 展示名称（i18n 友好）   |
| `order` | number | 是   | 排序权重（升序）        |


### `source` 字段推导规则

`source` 不在数据库中持久化存储，由后端在查询时根据 `skills.author_id` 与当前登录用户对比实时推导：


| 条件                                         | 推导结果       | 前端标签                                 |
| ------------------------------------------ | ---------- | ------------------------------------ |
| `author_id == 当前用户工号`                      | `mine`     | **自建**（橙色）                           |
| `author_id ≠ 当前用户工号` 或 `author_id IS NULL` | `official` | 未安装时显示 **官方**（蓝色），已安装时显示 **已安装**（绿色） |


> **Rationale**: 官方技能与自建技能的本质区别仅在于创建者是否当前用户，无需额外字段。标签显示由前端根据 `source` + `installed` 联合判断。

#### `source` 查询参数过滤的实现

当接口收到 `source=official` 或 `source=mine` 查询参数时，后端 MUST 将条件转换为 `author_id` 判断：

- `source=mine` → `WHERE author_id = :currentUserId`
- `source=official` → `WHERE (author_id != :currentUserId OR author_id IS NULL)`

`categoryCounts` 的统计 MUST 同步应用上述过滤条件，确保计数与列表数据严格对齐。

---

## 接口定义

### 1. GET /api/skill-plaza/categories

获取技能分类列表。

**请求参数**: 无

分类列表为固定字典数据，不需要搜索、过滤、排序或分页参数。

**响应** (`200 OK`):

```json
{
  "success": true,
  "data": {
    "categories": [
      { "slug": "", "label": "全部" },
      { "slug": "jishu", "label": "技术" },
      { "slug": "chanpin", "label": "产品" },
      { "slug": "sheji", "label": "设计" },
      { "slug": "xingzheng", "label": "行政" },
      { "slug": "caiwu", "label": "财务" },
      { "slug": "hr", "label": "HR" },
      { "slug": "tongyong", "label": "通用" },
      { "slug": "moban", "label": "模板" },
      { "slug": "wangluo", "label": "网络" },
      { "slug": "zhengce", "label": "政策" },
      { "slug": "yunying", "label": "运营" },
      { "slug": "kefu", "label": "客服" },
      { "slug": "qita", "label": "其他" }
    ]
  }
}
```

> **Note**: 分类顺序由前端按业务约定固定渲染（全部 → 技术 → 产品 → 设计 → 行政 → 财务 → HR → 通用 → 模板 → 网络 → 政策 → 运营 → 客服 → 其他），不依赖后端 `order` 字段。

**错误码**:


| Code                     | 说明         |
| ------------------------ | ---------- |
| `CATEGORIES_LOAD_FAILED` | 分类数据读取失败 |


---

### 2. GET /api/skill-plaza/list

获取技能广场全量列表（合并 STO 远端市场目录 + 本地已安装状态）。

**请求参数（Query）**:


| 参数         | 类型           | 必填         | 说明                                   |
| ---------- | ------------ | ---------- | ------------------------------------ |
| `q`        | string       | 否          | 搜索关键词（匹配 title / description），不区分大小写 |
| `category` | string       | 否          | 分类 code（slug）过滤，对应 `skills.category_code` |
| `source`   | `"official"` | `"mine"`   | 否                                    |
| `sort`     | `"hot"`      | `"recent"` | 否                                    |
| `page`     | number       | 否          | 页码，从 1 开始，默认 1                       |
| `pageSize` | number       | 否          | 每页条数，默认 20，最大 50                     |


**注**: 搜索、分类过滤、排序均由后端执行。`categoryCounts` 必须根据当前 `q` + `categoryCode` + `source` 条件在后端计算后返回，key 为 `categoryCode`（英文 slug），确保与列表数据严格对齐。

**响应** (`200 OK`):

```json
{
  "success": true,
  "data": {
    "skills": [ SkillSummary, ... ],
    "categoryCounts": {
      "": 42,
      "jishu": 8,
      "chanpin": 5,
      "sheji": 4,
      "xingzheng": 3,
      "caiwu": 3,
      "hr": 2,
      "tongyong": 4,
      "moban": 2,
      "wangluo": 2,
      "zhengce": 2,
      "yunying": 3,
      "kefu": 2,
      "qita": 2
    },
    "hasMore": false,
    "threshold": 50
  }
}
```

**字段说明**:

- `skills`: 当前页的技能列表
- `categoryCounts`: 各分类下的技能数量（按当前搜索/过滤条件计算）
- `hasMore`: 是否存在更多未返回的技能（总数超过 `threshold` 时为 `true`）
- `threshold`: 分页阈值，本期固定为 `50`

**分页策略**:

- 后端根据 `page` 和 `pageSize` 参数返回对应分页数据。
- 响应中必须包含 `hasMore`（是否还有更多数据）、`page`（当前页码）、`pageSize`（当前每页条数）、`total`（总条数，可选）。
- 当 `hasMore: false` 时，前端隐藏分页控件；当 `hasMore: true` 时，前端展示分页控件，用户翻页时传入新的 `page` 参数请求下一页。

**错误码**:


| Code                        | 说明                     |
| --------------------------- | ---------------------- |
| `PLAZA_LIST_FAILED`         | 列表获取失败                 |
| `REMOTE_MARKET_UNAVAILABLE` | 远端市场不可达（降级：仅返回本地已安装技能） |


---

### 3. GET /api/skill-plaza/mine

获取"我的技能"列表（仅本地已安装技能）。后端通过扫描本地 `skills/` 目录和读取 `lock.json` 获取已安装技能 slug 列表，再用 slug 去 `skills` 表反查详情；不在 `skills` 表中的（如自建技能）从本地元数据读取。

**请求参数**: 无

**响应** (`200 OK`):

```json
{
  "success": true,
  "data": {
    "skills": [ SkillSummary, ... ],
    "categoryCounts": {
      "": 8,
      "jishu": 2,
      "chanpin": 1,
      "sheji": 1,
      "xingzheng": 0,
      "caiwu": 1,
      "hr": 0,
      "tongyong": 1,
      "moban": 0,
      "wangluo": 0,
      "zhengce": 0,
      "yunying": 1,
      "kefu": 0,
      "qita": 1
    },
    "hasMore": false,
    "threshold": 50
  }
}
```

**错误码**:


| Code               | 说明       |
| ------------------ | -------- |
| `MINE_LIST_FAILED` | 本地技能扫描失败 |


---

### 4. GET /api/skill-plaza/skill/:slug

获取单个技能的完整详情（用于详情弹窗）。

**路径参数**:


| 参数     | 类型     | 必填  | 说明     |
| ------ | ------ | --- | ------ |
| `slug` | string | 是   | 技能唯一标识 |


**响应** (`200 OK`):

```json
{
  "success": true,
  "data": {
    "skill": SkillDetail
  }
}
```

**响应示例**:

```json
{
  "success": true,
  "data": {
    "skill": {
      "slug": "总部往来对账单汇总",
      "title": "总部往来对账单汇总",
      "description": "按账期汇总总部与各网点往来发生额、余额及对账状态，生成合并视图。",
      "category": "财务",
      "categoryCode": "finance",
      "source": "official",
      "installed": false,
      "installCount": 310,
      "useCount": 890,
      "points": 8,
      "icon": "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path fill='currentColor' d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/></svg>",
      "defaultPrompt": "帮我汇总本月总部往来对账单",
      "detail": {
        "intro": "按账期自动汇总总部与各网点的往来发生额和余额，生成对账状态合并视图。"
      }
    }
  }
}
```

**错误码**:


| Code                 | 说明       |
| -------------------- | -------- |
| `SKILL_NOT_FOUND`    | 技能不存在    |
| `DETAIL_LOAD_FAILED` | 详情数据加载失败 |


---

### 5. POST /api/skill-plaza/install

安装技能（官方技能或市场技能）。

**请求体** (JSON):

```json
{
  "slug": "string"
}
```

**响应** (`200 OK`):

```json
{ "success": true }
```

**错误响应**:

```json
{
  "success": false,
  "error": "下载技能包失败：网络超时",
  "code": "INSTALL_FAILED"
}
```

**错误码**:


| Code                        | 说明                 |
| --------------------------- | ------------------ |
| `SKILL_NOT_FOUND`           | 技能 slug 不存在        |
| `INSTALL_FAILED`            | 安装过程失败（下载/解压/配置失败） |
| `INSTALL_ALREADY_INSTALLED` | 该技能已安装             |

> **Note**: 安装操作仅修改本地文件系统（下载技能包到 `skills/` + 更新 `lock.json`），不写入数据库。`installed` 状态以本地文件为唯一真实来源。

---

### 6. POST /api/skill-plaza/uninstall

卸载/删除技能（仅我的技能中已安装的技能）。

**请求体** (JSON):

```json
{
  "slug": "string"
}
```

**响应** (`200 OK`):

```json
{ "success": true }
```

**错误响应**:

```json
{
  "success": false,
  "error": "删除技能失败：文件权限不足",
  "code": "UNINSTALL_FAILED"
}
```

**错误码**:


| Code                      | 说明                  |
| ------------------------- | ------------------- |
| `SKILL_NOT_FOUND`         | 技能 slug 不存在         |
| `UNINSTALL_FAILED`        | 卸载过程失败（文件删除/配置清理失败） |
| `UNINSTALL_NOT_INSTALLED` | 该技能未安装，无需卸载         |

> **Note**: 卸载操作仅修改本地文件系统（删除 `skills/` 下技能目录 + 更新 `lock.json`），不写入数据库。

---

### 7. POST /api/skill-plaza/use

记录技能使用次数。用户点击"使用"按钮时调用，后端将对应技能的 `use_count` +1。

**请求体** (JSON):

```json
{
  "slug": "string"
}
```

**响应** (`200 OK`):

```json
{ "success": true }
```

**错误响应**:

```json
{
  "success": false,
  "error": "技能不存在",
  "code": "SKILL_NOT_FOUND"
}
```

**错误码**:


| Code              | 说明          |
| ----------------- | ----------- |
| `SKILL_NOT_FOUND` | 技能 slug 不存在 |
| `USE_LOG_FAILED`  | 使用记录写入失败    |


> **Note**: 该接口为异步统计接口，前端在点击"使用"按钮后 SHOULD 调用，但不影响跳转流程。调用失败时不应阻塞用户进入对话页面。

---

## Points 字段说明（本期实现）

`points` 字段本期**不进行动态计算**，统一返回固定值 `8`。前端在卡片 meta 行展示为"预计8积分"。

后续迭代计划：

- 根据工作流步骤数量、API 调用次数、模型 token 消耗等因素动态计算 `points`
- 后端新增积分计算引擎
- 前端支持积分显示格式化（如 `8积分`、`免费`、`自定义`）

## 降级策略

### 远端市场不可达

当 `GET /api/skill-plaza/list` 调用时 STO 远端市场不可达：

1. 后端 MUST 降级为仅返回本地已安装技能 + 内置默认分类常量中配置的推荐技能
2. 响应中 `success` 仍为 `true`
3. 前端 NOT 展示降级提示（可后续迭代增加）

### Gateway 未就绪

当 Gateway 进程尚未启动或正在重启时：

1. "我的技能" Tab 的 `enabled` 状态从本地 `openclaw.json` 直接读取，不强依赖 Gateway RPC
2. 广场 Tab 的已安装状态从本地 `lock.json` 读取

