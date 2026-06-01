# 定时任务中心技术设计文档

> 本文档覆盖定时任务中心的前端 UI 改版、后端 API 对接、云端脚本执行体系及历史任务迁移方案。**工作流（WORKFLOW）相关设计暂不包含，待后续单独确定。**

---

## 1. 背景与目标

### 1.1 现状问题
- 现有 Cron 页面（`src/pages/Cron/index.tsx`）以技术导向呈现，创建表单使用 cron 表达式预设按钮，非技术用户门槛高。
- 现有系统分为两套：Gateway 本地 cron（RPC）和 Cloud Task API（`/agent/v1/cloud-cron`），架构分散。

### 1.2 目标
- 基于新的 **STO Scheduled Tasks API**（`baseinfo-aimemory*.sto.cn`）重建定时任务中心，替换现有 `/cron` 页面。
- 采用设计团队提供的新版卡片化 UI，支持自然语言描述、频率联动选择器、推荐任务快速 onboarding。
- 建立完整的**云端脚本生成 → 存储 → 执行 → 产物交付**链路。
- 妥善处理用户历史本地任务的过渡，不自动强制迁移。

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Claw 桌面端 (Electron)                          │
│  ┌─────────────────┐    ┌──────────────┐    ┌──────────────────────────┐   │
│  │ ScheduledTasks  │───▶│  host-api    │───▶│ Main-process HTTP proxy  │   │
│  │   Page (React)  │    │ (api-client) │    │  (sto-scheduled-task-svc)│   │
│  └─────────────────┘    └──────────────┘    └────────────┬─────────────┘   │
└──────────────────────────────────────────────────────────┼─────────────────┘
                                                           │ HTTPS
┌──────────────────────────────────────────────────────────▼─────────────────┐
│                         STO 云端 (baseinfo-aimemory*.sto.cn)                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────────────┐  │
│  │   Task      │  │   Script    │  │   Script    │  │     Artifact      │  │
│  │   Store     │  │  Generator  │  │   Store     │  │     Store         │  │
│  │  (MySQL)    │  │   (LLM)     │  │   (OSS)     │  │  (OSS / CDN)      │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────────┬─────────┘  │
│         │                │                │                    │           │
│  ┌──────▼────────────────▼────────────────▼────────────────────▼───────┐  │
│  │                      Execution Engine                               │  │
│  │  ┌────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │  │
│  │  │ XXL-JOB    │  │  Sandbox     │  │   Notification Service   │   │  │
│  │  │ dispatch   │  │  Runner      │  │   (钉钉群 / 对话推送)     │   │  │
│  │  │ tick       │  │ (脚本执行)   │  │                          │   │  │
│  │  └────────────┘  └──────────────┘  └──────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 前端设计

基于设计稿 `scheduled-tasks.html`，新建 `src/pages/ScheduledTasks/` 页面组件，最终替换 `/cron` 路由。

### 3.1 页面布局

```
┌────────────────────────────────────────────────────────────┐
│  Sidebar                                                   │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  Hero 区域                                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  定时任务                    [搜索] [排序▼] [+ 新建] │  │
│  │  按计划自动执行任务...                                │  │
│  └──────────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────┤
│  内容区                                                     │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐             │
│  │  任务卡片   │ │  任务卡片   │ │  任务卡片   │             │
│  │  (grid)    │ │            │ │            │             │
│  └────────────┘ └────────────┘ └────────────┘             │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  空状态：暂无定时任务                                │  │
│  │  + 新建定时任务                                      │  │
│  │  [推荐任务卡片] [推荐任务卡片] [推荐任务卡片]        │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**关键元素：**
- **Hero 区域**：标题 + 描述文案 + 搜索框 + 排序选择器 + 新建按钮
- **卡片网格**：响应式网格布局（参考技能广场 `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`）
- **空状态**：插图引导 + 推荐任务卡片（支持一键添加）
- **搜索无结果**：单独的搜索空状态

### 3.2 任务卡片

每张卡片（`<article>`）包含：

| 区域 | 内容 | 交互 |
|------|------|------|
| **标题行** | 时钟图标 + 任务名称（可点击编辑）+ 启用/暂停 Toggle | 标题点击打开编辑弹窗；Toggle 直接调用 `/update` 启停 |
| **描述** | 任务说明（`description`，自然语言描述，2-3 行截断） | 无 |
| **底部** | 执行计划时间（如"工作日 09:00"）+ "测试运行"按钮 + 更多菜单（编辑/删除） | 测试运行调用 `/trigger`；更多菜单展开折叠操作 |

**状态展示：**
- `enabled=true`：绿色状态点 + Toggle 开启
- `enabled=false`：灰色状态点 + Toggle 关闭
- `next_run_at`：显示下次执行时间
- `last_run_status`：上次执行成功/失败指示

### 3.3 创建/编辑弹窗

#### 表单字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| **任务名称** | `input[type=text]` | 是 | 1-128 字符，同用户下唯一；实时校验 409 冲突 |
| **关联工作流** | `select` / Picker | 否 | **待后端接口调整支持**；v1 仅展示，实际传 `MONITOR_TASK` |
| **指令描述** | `textarea` (12 行) | 否 | 自然语言描述任务内容；最长 2000 字符；作为 LLM 生成脚本的输入 |
| **计划时间** | 组合选择器 | 是 | 见下方频率联动选择器 |

#### 频率联动选择器

前端提供用户友好的频率选择，最终转换为标准 5 段 cron 表达式提交给后端。

| 频率选项 | 子控件 | Cron 转换示例 |
|---------|--------|--------------|
| **一次性** | 日期选择器（日历弹窗）+ 时间选择器 | 需后端支持 `kind: "at"` 或一次性特殊处理；**若后端仅支持 cron_expr，则一次性任务需单独处理** |
| **每天** | 时间选择器 | `0 9 * * *` |
| **工作日** | 星期多选（默认周一到周五）+ 时间选择器 | `0 9 * * 1-5` |
| **每周** | 星期单选 + 时间选择器 | `0 9 * * 1` |
| **每月** | 月内日期选择（1-31）+ 时间选择器 | `0 9 1 * *` |

**时间选择器**：双列选择（小时 00-23 + 分钟 00-55/5 分钟步长），自定义下拉面板。

#### 脚本相关交互（新增）

- 保存任务后，若 `description` 不为空，前端显示"正在生成执行脚本..."状态
- 脚本生成完成后（通过轮询或 WebSocket），前端可切换"代码模式"预览/编辑脚本
- 用户修改 `description` 后，提示"描述已变更，是否重新生成脚本？"

### 3.4 删除确认弹窗

独立的二次确认对话框：
- 标题："删除定时任务？"
- 描述："确定要删除该任务吗？此操作无法撤销。"
- 操作：取消 / 删除（调用 `/delete` 逻辑删除）

### 3.5 交互流程图

```
用户进入页面
    │
    ▼
┌─────────────┐     ┌─────────────┐
│ 检测本地历史 │──Yes─▶│ 显示迁移横幅 │
│ Gateway任务 │     │ "X个本地任务可迁移" │
└─────────────┘     └─────────────┘
    │ No
    ▼
调用 GET /list ──▶ 渲染任务卡片网格
    │
    ▼
用户操作 ──┬── 搜索/排序（前端本地过滤/排序）
          ├── 点击 Toggle ──▶ POST /update { enabled }
          ├── 点击测试运行 ──▶ POST /trigger
          ├── 点击编辑 ──▶ 打开编辑弹窗
          ├── 点击删除 ──▶ 确认弹窗 ──▶ POST /delete
          └── 点击新建 ──▶ 打开创建弹窗
                          │
                          ▼
                  填写表单，选择频率
                          │
                          ▼
                  前端将频率转换为 cron_expr
                          │
                          ▼
                  POST / （创建）
                          │
                          ▼
                  服务端异步生成脚本（LLM）
                          │
                          ▼
                  前端轮询脚本生成状态 / 或 WebSocket 推送
```

---

## 4. 后端 API 对接

### 4.1 环境地址

| 环境 | Base URL |
|------|----------|
| 测试 | `https://baseinfo-aimemory-test.sto.cn/agent/v1/scheduled-tasks` |
| 预发布 | `https://pre-baseinfo-aimemory.sto.cn/agent/v1/scheduled-tasks` |
| 生产 | `https://baseinfo-aimemory.sto.cn/agent/v1/scheduled-tasks` |

### 4.2 鉴权

Claw SSO：`Authorization: Bearer {stoToken}` 或 Header `stoToken`。

Main 进程侧复用现有 `buildStoMemoryCenterAuthHeaders()` + `getStoToken()`（参考 `cloud-task-service.ts`）。

### 4.3 接口映射

| 前端操作 | API Method | API Path | 说明 |
|---------|-----------|----------|------|
| 获取列表 | `GET` | `/list` | 无搜索/排序参数，前端全量拉取后本地处理 |
| 获取详情 | `GET` | `/details?task_id=` | |
| 创建任务 | `POST` | `/` | Body: `name`, `cron_expr`, `description`, `notify_mode` 等 |
| 修改任务 | `POST` | `/update` | Body: `task_id` + 变更字段；启停通过 `enabled` 字段 |
| 删除任务 | `POST` | `/delete` | Body: `task_id`；逻辑删除 |
| 手动触发 | `POST` | `/trigger` | Body: `task_id`；前置条件：`enabled=true` + `site_code` 非空 |
| 重新生成脚本 | `POST` | `/{id}/regenerate-script` | **建议后端新增** |
| 获取脚本 | `GET` | `/{id}/script` | **建议后端新增** |
| 获取产物列表 | `GET` | `/{id}/runs/{run_id}/artifacts` | **建议后端新增** |

### 4.4 错误处理

| HTTP | 场景 | 前端处理 |
|------|------|---------|
| 401 | Token 过期 | 引导重新登录 |
| 403 | 无权操作 | Toast 提示 |
| 404 | 任务不存在 | 从本地列表移除，提示"任务已被删除" |
| 409 | 任务名重复 | 表单校验错误，高亮名称输入框 |
| 422 | 参数校验失败 | 根据 `errMessage` 展示对应字段错误 |

---

## 5. 云端执行体系

### 5.1 脚本生成

**触发时机：**
1. 创建任务时，若 `description` 不为空，服务端**异步**调用 Script Generator（LLM 服务）
2. 用户主动点击"重新生成脚本"
3. 用户修改 `description` 并确认重新生成

**LLM Prompt 设计：**
```
你是一个为物流业务生成数据分析脚本的 AI 助手。

任务名称：{name}
任务描述：{description}
用户网点编码：{site_code}
可用数据源：
  - HQ Reconciliation API (总部对账)
  - Customer Cost API (客户成本)
  - Daily Volume API (日均发件量)

要求：
1. 生成标准 Python 3 脚本
2. 脚本需从指定数据源拉取数据
3. 进行分析和计算
4. 将产物（报表/图表）写入 OUTPUT_DIR 环境变量指定的目录
5. 生成执行摘要，打印到 stdout

输出格式：仅返回 Python 代码，不要 Markdown 代码块标记。
```

**生成后处理：**
- 代码安全扫描（禁用 `os.system`, `subprocess`, `eval`, `exec` 等危险调用）
- 格式化（Black/AutoPEP8）
- 写入 `script_content`（DB）并上传 OSS

### 5.2 脚本存储

| 存储层 | 用途 | 规范 |
|--------|------|------|
| **MySQL** | `script_content` 字段 | ≤ 64KB 存完整脚本；> 64KB 存 `null`，读时回源 OSS |
| **OSS** | 脚本持久化 | `scheduled-tasks/{owner_user_id}/{task_id}/script_v{version}.py` |

**版本管理：**
- 每次生成或手动更新都递增 `version`
- 旧版本保留 30 天，支持回滚
- 当前版本号记录在任务元数据中

### 5.3 触发执行

**调度层：** XXL-JOB `dispatch-tick` 定时扫描。

**执行流程：**
```
dispatch-tick 发现到期任务
        │
        ▼
  读取任务配置（cron_expr, enabled, script_ref）
        │
        ▼
  若 oss_object_key 存在：
        │
        ├── 从 OSS 下载脚本到本地缓存（/tmp/scheduled-tasks/{task_id}/）
        ├── 启动 Sandbox Runner（受限容器，限制 CPU/内存/网络/时长）
        ├── 注入环境变量：
        │     TASK_ID, OWNER_USER_ID, SITE_CODE,
        │     OUTPUT_DIR, STO_TOKEN, GATEWAY_URL
        ├── 执行 Python 脚本
        ├── 监控 stdout/stderr，捕获执行日志
        ├── 扫描 OUTPUT_DIR，将产物上传 OSS
        └── 生成 execution_result（markdown 摘要 + 产物链接）
        │
  若 oss_object_key 不存在：
        │
        └── 回退到现有"知多星派发"模式（向后兼容）
        │
        ▼
  更新 task_runs 记录
        │
        ▼
  根据 notify_mode 推送结果（钉钉群 / 对话）
```

**Sandbox 限制：**
- CPU：1 核
- 内存：512MB
- 执行时长：30 秒超时
- 网络：仅允许访问 STO 内网 API（白名单模式）
- 文件系统：只读根目录，仅 `OUTPUT_DIR` 可写

### 5.4 产物管理

**产物类型：**
- 表格：`*.xlsx`, `*.csv`
- 图表：`*.png`, `*.jpg`
- 报告：`*.pdf`
- 数据：`*.json`

**OSS 路径：**
```
scheduled-tasks/{owner_user_id}/{task_id}/artifacts/{run_id}/{filename}
```

**访问方式：**

| 场景 | 机制 | 有效期 |
|------|------|--------|
| Claw 前端预览/下载 | 服务端生成签名 URL | 1 小时 |
| 钉钉群推送 | 同步到 CDN，返回 CDN URL | 长期（按 CDN 策略） |

**产物元数据**（记录在 `task_runs` 表）：
```json
{
  "artifacts": [
    {
      "name": "daily_report.xlsx",
      "size": 24576,
      "type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "oss_key": "...",
      "cdn_url": "https://cdn.sto.cn/..."
    }
  ]
}
```

### 5.5 用户调整任务时的脚本更新

**推荐流程（用户确认式）：**
1. 用户修改 `description`，点击保存
2. 前端提交 `POST /update`
3. 服务端检测到 `description` 哈希变化，在响应中标记 `scriptStale: true`
4. 前端弹窗提示："任务描述已变更，是否重新生成执行脚本？"
5. 用户确认后，调用 `POST /{id}/regenerate-script`
6. 服务端重新调用 LLM，生成新脚本，更新 OSS
7. 前端轮询或接收推送，更新脚本预览状态

**高级模式（手动编辑）：**
- 提供"代码模式"切换按钮
- 用户直接编辑 Python 脚本
- 保存时调用 `POST /{task_id}/script`（文档已预留）
- 绕过 LLM，直接上传 OSS

---

## 6. 数据模型

### 6.1 前端类型定义（新增）

```typescript
// src/types/scheduled-task.ts

export interface ScheduledTask {
  id: number;
  ownerUserId: string;
  name: string;
  taskType: 'MONITOR_TASK';  // v1；WORKFLOW 待后续支持
  description: string;
  cronExpr: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: 'success' | 'dispatch_failed' | string;
  notifyMode: 'none' | 'dingtalk_group' | 'dialog' | 'both';
  siteCode: string;
  siteName: string;
  dingdingId: string;
  dingdingGroupId: string;
  dingdingGroupName: string;
  ossObjectKey: string | null;
  dialogSessionKey: string;
  openclawGatewayUrl: string;
  createdAt: string;
  updatedAt: string;

  // 前端派生状态
  scriptStatus?: 'pending' | 'ready' | 'stale' | 'error';
}

export interface ScheduledTaskCreateInput {
  name: string;
  cronExpr: string;
  description?: string;
  taskType?: 'MONITOR_TASK';
  notifyMode?: string;
  siteCode?: string;
  siteName?: string;
  dingdingId?: string;
  dingdingGroupId?: string;
  dingdingGroupName?: string;
  dialogSessionKey?: string;
  openclawGatewayUrl?: string;
}

export interface ScheduledTaskUpdateInput {
  taskId: number;
  name?: string;
  cronExpr?: string;
  description?: string;
  notifyMode?: string;
  enabled?: boolean;
}

export interface TaskRun {
  id: number;
  taskId: number;
  status: 'pending' | 'success' | 'failed' | 'timeout';
  startedAt: string;
  completedAt: string;
  duration: number;
  executionResult?: string;  // markdown
  logText?: string;
  artifacts?: TaskArtifact[];
  notifyDingtalkOk?: boolean;
}

export interface TaskArtifact {
  name: string;
  size: number;
  type: string;
  ossKey: string;
  cdnUrl?: string;
}

export interface SchedulePreset {
  label: string;
  frequency: 'once' | 'daily' | 'workdays' | 'weekly' | 'monthly';
  cronExpr: string;
  // 一次性任务的特殊处理字段
  at?: string;
}
```

### 6.2 频率 ↔ Cron 转换映射

| 频率 | 参数 | 生成的 cronExpr |
|------|------|----------------|
| 每天 | 时间 `09:00` | `0 9 * * *` |
| 工作日 | 时间 `09:00` | `0 9 * * 1-5` |
| 每周 | 星期 `周一`, 时间 `09:00` | `0 9 * * 1` |
| 每月 | 日期 `1日`, 时间 `09:00` | `0 9 1 * *` |
| 一次性 | 日期时间 `2026-06-01 09:00` | **特殊处理**：需后端支持 `kind: "at"` 或前端在到达时间后自动禁用任务 |

> **注意**：若后端 v1 的 `scheduled-tasks` API 严格只接受 5 段 cron 表达式，一次性任务需要额外方案（如创建后立即自动禁用，或后端扩展支持 `at` 类型）。

---

## 7. 历史本地任务迁移

### 7.1 策略：不自动同步，半自动迁移引导

**原因：**
- 本地 Gateway cron 的 `target`（channelType/channelId）与云端 `notify_mode` 无直接映射
- 云端创建需要 `site_code`、`dingding_id` 等 SSO 信息，本地任务缺失
- 自动同步可能创建大量配置不完整的云端任务

### 7.2 迁移流程

```
用户首次进入新 ScheduledTasks 页面
        │
        ▼
  前端同时调用：
    ├── GET /agent/v1/scheduled-tasks/list （云端任务）
    └── GET /api/cron/jobs （本地 Gateway 任务，现有接口）
        │
        ▼
  若本地任务数 > 0 且云端任务数 == 0：
        │
        ▼
  显示迁移提示横幅：
  "检测到 3 个本地定时任务，可迁移到云端统一管理 [立即迁移]"
        │
        ▼
  用户点击 [立即迁移]
        │
        ▼
  打开迁移向导弹窗：
    ├── 展示本地任务列表（名称 / 计划 / 消息）
    ├── 每个任务可勾选是否迁移
    ├── 预填字段：名称 → name, message → description, schedule → cronExpr
    └── 必填补全：通知方式（notify_mode）、网点编码（site_code）
        │
        ▼
  用户确认后，逐个调用 POST /agent/v1/scheduled-tasks 创建云端任务
        │
        ▼
  创建完成后，本地任务标记为"已迁移"（或引导用户手动删除本地任务）
```

### 7.3 过渡期展示

- **云端任务**：正常展示在卡片网格中，完整操作（编辑/删除/启停/触发）
- **本地历史任务**：以"Legacy"标签展示在列表底部（或单独折叠区域）
- 本地任务仅支持：查看、启停、删除；不支持编辑（引导迁移后编辑）
- 过渡期建议 2-3 个版本，之后完全移除本地任务读取逻辑

---

## 8. 与现有系统的对比

| 维度 | 现有 Cron 页面 | 新 ScheduledTasks 页面 |
|------|---------------|------------------------|
| 后端 API | Gateway RPC + Cloud Task API | STO Scheduled Tasks API |
| 计划表达式 | cron 字符串 / CronSchedule 对象 | 标准 5 段 `cron_expr` |
| 指令/描述 | `message`（3 行） | `description`（12 行，2000 字） |
| 执行方式 | Gateway Agent Turn / 云端 Agent | 云端 Sandbox 脚本执行 + LLM 生成 |
| 产物交付 | 对话消息 / 通道推送 | OSS 产物 + CDN 链接 + 钉钉推送 |
| 脚本支持 | 无 | 完整脚本生成、存储、版本管理 |
| 推送目标 | `target.channelType/channelId` | `notify_mode`（none/dingtalk_group/dialog/both）|
| 任务 ID | `string` | `int` |
| 搜索排序 | 无 | 前端本地实现 |
| 推荐任务 | 无 | 静态配置 |

---

## 9. 后端接口扩展建议（需后端配合）

| 接口 | Method | 用途 |
|------|--------|------|
| `/agent/v1/scheduled-tasks/{id}/regenerate-script` | `POST` | 根据当前 description 重新生成脚本 |
| `/agent/v1/scheduled-tasks/{id}/script` | `GET` | 获取当前脚本内容（文档已有 POST，需补 GET） |
| `/agent/v1/scheduled-tasks/{id}/runs/{run_id}/artifacts` | `GET` | 获取某次执行的产物列表 |
| `/agent/v1/scheduled-tasks/{id}/runs/{run_id}/artifacts/{name}/url` | `GET` | 获取产物临时下载签名 URL |
| `/agent/v1/scheduled-tasks/{id}/script-status` | `GET` | 查询脚本生成状态（异步生成时轮询用） |

---

## 10. 前端实现清单

### 10.1 新增文件

```
src/
├── pages/
│   └── ScheduledTasks/
│       ├── index.tsx                    # 主页面（Hero + 卡片网格 + 空状态）
│       ├── components/
│       │   ├── TaskCard.tsx             # 任务卡片
│       │   ├── TaskCardGrid.tsx         # 卡片网格布局
│       │   ├── TaskHero.tsx             # Hero 区域（标题/搜索/排序/新建）
│       │   ├── TaskCreateModal.tsx      # 创建/编辑弹窗
│       │   ├── TaskDeleteModal.tsx      # 删除确认弹窗
│       │   ├── SchedulePicker.tsx       # 频率联动选择器
│       │   ├── TimePicker.tsx           # 时间选择器（小时+分钟）
│       │   ├── TaskEmptyState.tsx       # 空状态 + 推荐任务
│       │   ├── TaskSearchEmpty.tsx      # 搜索无结果
│       │   ├── LegacyTaskBanner.tsx     # 本地历史任务迁移横幅
│       │   └── LegacyTaskMigrationDialog.tsx  # 迁移向导
│       └── hooks/
│           ├── useScheduledTasks.ts     # 任务列表 + CRUD
│           ├── useTaskScript.ts         # 脚本生成状态
│           └── useLegacyTasks.ts        # 本地历史任务检测
├── types/
│   └── scheduled-task.ts              # 新类型定义
├── stores/
│   └── scheduledTasks.ts              # Zustand store（或扩展现有 cron.ts）
└── lib/
    └── cron-utils.ts                  # 频率 ↔ cron 转换工具函数
```

### 10.2 可复用现有组件

| 现有组件 | 来源 | 复用点 |
|---------|------|--------|
| `Switch` | `src/components/ui/switch.tsx` | 卡片上的启用/暂停开关 |
| `ConfirmDialog` | `src/components/ui/confirm-dialog.tsx` | 删除确认 |
| `Card` / `CardContent` | `src/components/ui/card.tsx` | 弹窗面板、推荐任务卡片 |
| `LoadingSpinner` | `src/components/common/LoadingSpinner.tsx` | 加载状态 |
| `Sheet` | `src/components/ui/sheet.tsx` | 任务详情抽屉（可选） |
| 搜索过滤逻辑 | `src/pages/Skills/index.tsx` | Hero 搜索框实现参考 |

---

## 11. 待确认事项

1. **一次性任务**：后端 v1 是否只支持 `cron_expr`？一次性任务如何表达？
2. **关联工作流**：后端接口调整 `task_type: WORKFLOW` 的时间节点？
3. **脚本生成**：LLM 服务是否已就绪？Prompt 模板需业务方确认
4. **产物存储**：OSS/CDN Bucket 和路径策略是否已确定？
5. **Sandbox 执行**：云端 Execution Engine 的 Sandbox 方案（Docker/Firecracker/gVisor）是否已确定？
6. **工作流**：整体 Workflow DSL 设计、节点编排逻辑，待后续单独文档确定
