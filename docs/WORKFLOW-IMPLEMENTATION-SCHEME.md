# 工作流功能实现方案

> 版本：v1.0  
> 日期：2026-06-05  
> 范围：Renderer（前端）+ Main Process（主进程）+ 接口契约  

---

## 一、概述

本文档完整覆盖用户需求的 4 个环节：

1. 斜杠命令 `/xxx-workflow` 触发模板选择
2. 查询模板详情 → 映射为表单 → 弹出填写
3. 提交表单 → 创建并执行工作流
4. 工作流执行状态实时展示（单消息气泡内卡片更新）

**核心决策**：执行状态更新采用 **IPC 状态驱动**，不通过 Gateway 推送，避免污染对话历史。

**本期范围**：
- **P0（必须）**：斜杠命令、表单流程、Tracker 轮询、IPC 状态同步、sessionKey 过滤、刷新恢复、内存管理
- **P1（建议）**：指数退避、停滞检测、错误消息映射、并发执行限制
- **P2（可选）**：tool_result 注入、系统通知、状态持久化、ARIA/网络检测

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Renderer Process                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ ChatInput    │  │ workflows    │  │ chat store   │  │ ChatMessage      │ │
│  │ (斜杠命令)    │  │ (模板状态)    │  │ (卡片状态)    │  │ (workflow_card)  │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────────────────┘ │
│         │                 │                 │                                │
│         └─────────────────┴─────────────────┘                                │
│                           IPC (invoke / on)                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Main Process                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ WorkflowExecutionTracker (单例)                                     │   │
│  │  - 轮询后端状态                                                     │   │
│  │  - 状态变更 → IPC 推送 Renderer                                      │   │
│  │  - 超时/错误处理                                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                           HTTP (hostApiFetch)                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Backend API                                     │
│  GET  /api/workflows/templates           模板列表                            │
│  GET  /api/workflows/templates/:id       模板详情                            │
│  POST /api/workflows                     创建工作流                          │
│  POST /api/workflows/:id/execute         执行工作流                          │
│  GET  /api/workflows/:id/status/:execId  查询执行状态                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、阶段拆解

### 阶段 1：斜杠命令选择模板

**触发方式**：输入框输入 `/` 字符 或 点击 `/` 按钮，弹出 WorkflowPicker 下拉。

**交互流程**：

```
用户输入 / → 弹出模板列表 → 点击选中
    │
    ▼
输入框中渲染 WorkflowChip（高亮标签）
    │
    ▼
用户继续输入内容 → 点击发送
    │
    ▼
onSend(text, attachments, targetAgentId, workflowId)
```

**关键约束**：
- 选中 workflow 后，**输入内容不可为空**（仅选模板不能发送）
- 按 Backspace 且输入为空时，清除 workflow chip（与 agent chip 行为一致）
- 一个消息只能绑定一个 workflow

**新增/修改文件**：

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/stores/workflows.ts` | 新增 | Zustand store：模板列表 `templates[]`、加载、选中态 |
| `src/lib/workflow-api.ts` | 新增 | `fetchWorkflowTemplates()` |
| `src/types/workflow.ts` | 新增 | `WorkflowTemplate` 类型 |
| `src/pages/Chat/ChatInput.tsx` | 修改 | 新增 `/` 按钮、WorkflowPicker、WorkflowChip |
| `src/pages/Chat/index.tsx` | 修改 | `handleSend` 新增 `workflowId` 参数 |
| `src/stores/chat.ts` | 修改 | `sendMessage` 新增 `workflowId` 参数，RPC 透传 |

---

### 阶段 2：模板详情 → 表单弹出

**时序**：

```
1. 用户选中模板后，前端立即调用：
   GET /api/workflows/templates/:id
   
2. 返回结构示例：
   {
     "workflowId": "wf_demo",
     "workflowVersionId": 7,
     "schema": {
       "nodeId": "startup_1",
       "enabled": true,
       "steps": [
         { "id": "fetch", "title": "数据取数", "mode": "confirm", "order": 10 },
         { "id": "process", "title": "数据处理", "mode": "auto", "order": 20 }
       ],
       "fields": [
         {
           "key": "fetch.timeRange",
           "label": "取数时间范围",
           "description": "取数来源：财务结算-账单明细 + 进出港账单",
           "group": "fetch",
           "groupTitle": "数据取数",
           "order": 10,
           "component": "single_select",
           "required": true,
           "defaultValue": "this_week_to_yesterday",
           "options": [
             { "value": "yesterday", "label": "昨日全天", "description": "00:00~23:59" },
             { "value": "this_week_to_yesterday", "label": "本周累计·周一至昨日", "description": "适合查看本周整体成本趋势" },
             { "value": "custom", "label": "自定义时间范围", "description": "手动指定开始/结束日期" }
           ],
           "sourceNodes": ["agent_1"]
         }
       ]
     },
     "defaultPreset": {
       "id": "preset_001",
       "values": {
         "fetch.timeRange": "this_week_to_yesterday",
         "process.dimensions": ["site", "customer"]
       }
     }
   }

3. 前端将 schema.fields 映射为 UserFormConfig.fields：
   - field.component → FormFieldType (映射表见下方)
   - field.key → field.name (表单字段标识)
   - field.label → field.label
   - field.description → field.description
   - field.options → FormFieldOption[]
   - field.required → validation.required
   - field.defaultValue → field.defaultValue (可被 defaultPreset.values 覆盖)

4. component → FormFieldType 映射：
   ┌──────────────────┬───────────────┐
   │ component        │ FormFieldType │
   ├──────────────────┼───────────────┤
   │ single_select    │ select        │
   │ multi_select     │ multiselect   │
   │ text             │ text          │
   │ textarea         │ textarea      │
   │ number           │ number        │
   │ date             │ date          │
   │ date_range       │ text*         │
   │ (unknown)        │ text (兜底)   │
   └──────────────────┴───────────────┘
   * date_range 组件本期映射为 text，后续支持专用日期范围控件

5. 从用户输入文本中自动提取参数值（如有 extractable 标记）：
   - 匹配 field.extractPattern 正则 → 填充对应 field.defaultValue
   - 提取值优先级高于 defaultPreset.values

6. 调用 showForm(config, { source: 'workflow', sourceId: templateId })
   → 弹出 UserFormModal
```

**新增/修改文件**：

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/lib/workflow-api.ts` | 新增 | `fetchWorkflowDetail(templateId)` |
| `src/types/workflow.ts` | 新增 | `WorkflowTemplateDetail` 类型 |
| `src/pages/Chat/index.tsx` | 修改 | 选中模板后调详情 → 映射表单 → 显示 |

---

### 阶段 3：提交表单 → 创建 → 执行

**时序**：

```
用户点击表单"确认"
    │
    ▼
1. 调 POST /api/workflows
   {
     "templateId": "cost-analysis-v1",
     "userMessage": "帮我分析上个月的成本",  // 用户在输入框中写的内容
     "values": { "timeRange": "2026-05-01~2026-05-31", "departments": ["A", "B"] }
   }
   → 返回 { "workflowId": "wf-123", "status": "created" }
    │
    ▼
2. 调 POST /api/workflows/:workflowId/execute
   {
     "sessionKey": "agent:main:main",
     "agentId": "main"
   }
   → 返回 { "executionId": "exec-20260605-001", "status": "pending" }
    │
    ▼
3. 前端调 Gateway chat.send
   {
     "sessionKey": "agent:main:main",
     "message": "帮我分析上个月的成本",
     "workflowId": "cost-analysis-v1",
     "executionId": "exec-20260605-001"
   }
   → Gateway 让模型输出初始回复（含 workflow_card block）
    │
    ▼
4. 前端通过 IPC 通知 Main Process 启动 Tracker
   invokeIpc('workflow:startTracking', { executionId, sessionKey, agentId })
```

**新增/修改文件**：

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/lib/workflow-api.ts` | 新增 | `createWorkflow()`、`executeWorkflow()` |
| `electron/main/ipc-handlers.ts` | 修改 | 注册 `workflow:startTracking` handler |

---

### 阶段 4：执行状态推送 & 卡片渲染（核心）

#### 4.1 为什么不用 Gateway 推送？

| 问题 | 说明 |
|------|------|
| 只能追加新消息 | Gateway `chat.send` 只能产生新的 assistant 气泡，无法修改已有消息 |
| 对话刷屏 | 每个状态变化（10% → 20% → ...）都会产生新消息 |
| 历史污染 | 刷新页面后，历史记录中全是"进度 30%"之类的假 assistant 消息 |
| Token 成本 | 假 assistant 消息被计入 token 统计 |

#### 4.2 推荐方案：IPC 状态驱动

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Main Process: WorkflowExecutionTracker                                      │
│                                                                             │
│ 1. 收到 workflow:startTracking { executionId, sessionKey }                  │
│    → 创建 ExecutionSession 存入 Map                                         │
│    → 启动 setInterval(2000ms) 轮询                                          │
│                                                                             │
│ 2. 轮询 GET /api/workflows/:id/status/:executionId                          │
│    → 对比状态，如有变更：                                                   │
│       BrowserWindow.getAllWebContents().forEach(wc =>                       │
│         wc.send('workflow:status-update', { executionId, sessionKey, ... }) │
│       )                                                                     │
│                                                                             │
│ 3. 状态为 completed / failed / 超时                                         │
│    → 清除定时器，从 Map 删除                                                │
│    → 可选：发送 IPC workflow:complete 触发前端总结                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
               IPC: workflow:status-update (携带 sessionKey)
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Renderer                                                                    │
│                                                                             │
│ 1. useEffect 监听 IPC：window.electron.ipcRenderer.on(                      │
│      'workflow:status-update', (event, payload) => {                        │
│        if (payload.sessionKey !== currentSessionKey) return; // 过滤        │
│        setWorkflowCardState(payload.executionId, payload);                  │
│      }                                                                      │
│    )                                                                        │
│                                                                             │
│ 2. 页面加载后：从 messages 提取 executionIds →                             │
│    invokeIpc('workflow:sync-state', { executionId }) →                     │
│    恢复卡片状态（Tracker 未清理则返回状态，已清理则走后端查询 fallback）     │
│                                                                             │
│ 3. ChatMessage 检测到 workflow_card content block：                         │
│    const liveState = useChatStore(s => s.workflowCardStates[executionId])   │
│    用 liveState 渲染卡片（实时更新）                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

**关键约束**：
- Tracker 广播时必须携带 `sessionKey`
- Renderer 收到后只处理属于**当前会话**的状态更新
- 刷新页面后通过 `workflow:sync-state` IPC 重新关联状态

#### 4.3 卡片状态流转

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ pending  │────▶│ running  │────▶│completed │     │  failed  │
│ (待运行)  │     │ (执行中)  │     │ (成功)   │     │ (失败)   │
└──────────┘     └────┬─────┘     └──────────┘     └──────────┘
                      │
                 步骤时间线
                 - 步骤1 ✓ 2.3s
                 - 步骤2 ⏳ 执行中
                 - 步骤3 ○ 待执行
```

#### 4.4 消息中的 content block 设计

Gateway 模型输出的初始消息包含一个特殊 block：

```typescript
interface WorkflowCardBlock {
  type: 'workflow_card';      // 扩展 ContentBlock type union
  executionId: string;        // 用于关联 Tracker 状态
  templateName: string;       // 显示标题
  initialStatus: 'pending';   // 初始状态（会被本地状态覆盖）
}
```

ChatMessage 渲染逻辑：

```tsx
// 遍历 message.content blocks
if (block.type === 'workflow_card') {
  const liveState = workflowCardStates[block.executionId];
  return <WorkflowCard state={liveState || block.initialStatus} />;
}
```

#### 4.6 刷新恢复：`workflow:sync-state`

页面刷新后，Renderer 需要重新获取 Tracker 中的执行状态。

**时序**：
```
Renderer 页面加载
    │
    ▼
1. 从 messages 中提取所有 workflow_card 的 executionId
    │
    ▼
2. 对每个 executionId 调用：
   invokeIpc('workflow:sync-state', { executionId })
    │
    ├── 返回状态 → setWorkflowCardState(id, state)
    │
    └── 返回 null（Tracker 已清理）
            │
            ▼
        3. fallback 到后端查询：
           GET /api/workflows/status/:executionId
            │
            ├── 返回 completed/failed → setWorkflowCardState
            │
            └── 也查不到 → 标记为 unknown
```

**实现**：
```typescript
// Renderer
async function syncWorkflowState(executionId: string) {
  let state = await invokeIpc('workflow:sync-state', { executionId });
  if (state) {
    setWorkflowCardState(executionId, state);
    return;
  }
  // Tracker 已清理 → 直接问后端
  try {
    state = await hostApiFetch(`/api/workflows/status/${executionId}`);
    if (state?.status === 'completed' || state?.status === 'failed') {
      setWorkflowCardState(executionId, state);
    } else {
      setWorkflowCardState(executionId, { executionId, status: 'unknown', error: '执行状态已过期' });
    }
  } catch {
    setWorkflowCardState(executionId, { executionId, status: 'unknown', error: '无法获取执行状态' });
  }
}

// Main Process
ipcMain.handle('workflow:sync-state', async (_, { executionId }) => {
  return workflowExecutionTracker.getState(executionId); // null 表示已清理
});
```

#### 4.7 并发执行限制

防止用户同时创建过多工作流导致后端资源紧张、前端 UI 混乱。

**前端限制（主）**：
```typescript
// src/stores/workflows.ts
const MAX_CONCURRENT_WORKFLOWS = 5;

function canStartWorkflow(): boolean {
  const activeCount = Object.values(workflowCardStates).filter(
    s => s.status === 'pending' || s.status === 'running'
  ).length;
  return activeCount < MAX_CONCURRENT_WORKFLOWS;
}

// 用户提交表单前检查
if (!canStartWorkflow()) {
  toast.error(`同时执行的工作流不能超过 ${MAX_CONCURRENT_WORKFLOWS} 个`);
  return;
}
```

**Tracker 兜底（辅）**：
```typescript
// Tracker 内部也限制 Map 总量
const MAX_TRACKED_EXECUTIONS = 50;
```

---

## 五、Tracker 内部实现细节

### 5.1 内存管理

```typescript
class WorkflowExecutionTracker {
  private sessions = new Map<string, ExecutionSession>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    // 每 60 秒清理一次已完成的旧会话
    this.cleanupTimer = setInterval(() => this.periodicCleanup(), 60_000);
  }

  startTracking(executionId: string, sessionKey: string, workflowId: string) {
    // 超限时先清理最老的 completed
    if (this.sessions.size >= MAX_TRACKED_EXECUTIONS) {
      this.evictOldestCompleted();
    }
    this.sessions.set(executionId, {
      executionId, sessionKey, workflowId,
      state: { status: 'pending', progress: 0, steps: [] },
      createdAt: Date.now(), updatedAt: Date.now(),
      pollTimer: null, failCount: 0,
      lastStepSignature: '', lastStepChangeAt: Date.now(),
    });
    this.beginPolling(executionId);
  }

  private evictOldestCompleted() {
    const completed = Array.from(this.sessions.values())
      .filter(s => s.state.status === 'completed' || s.state.status === 'failed')
      .sort((a, b) => a.updatedAt - b.updatedAt);
    while (this.sessions.size >= MAX_TRACKED_EXECUTIONS && completed.length > 0) {
      this.stopTracking(completed.shift()!.executionId);
    }
  }

  private periodicCleanup() {
    const now = Date.now();
    const TTL = 5 * 60 * 1000; // completed/failed 保留 5 分钟
    for (const [id, session] of this.sessions) {
      const isTerminal = session.state.status === 'completed' || session.state.status === 'failed';
      if (isTerminal && now - session.updatedAt > TTL) {
        this.stopTracking(id);
      }
    }
  }

  stopTracking(executionId: string) {
    const session = this.sessions.get(executionId);
    if (session?.pollTimer) clearInterval(session.pollTimer);
    this.sessions.delete(executionId);
  }

  getState(executionId: string): WorkflowExecutionState | null {
    return this.sessions.get(executionId)?.state ?? null;
  }

  destroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const [id] of this.sessions) this.stopTracking(id);
  }
}
```

### 5.2 指数退避 + 停滞检测

```typescript
private async poll(session: ExecutionSession) {
  try {
    const res = await hostApiFetch<WorkflowExecutionState>(
      `/api/workflows/${session.workflowId}/status/${session.executionId}`
    );

    session.failCount = 0;

    // 停滞检测：steps 签名 30 秒无变化 → warn
    const stepSignature = JSON.stringify(res.steps);
    if (stepSignature === session.lastStepSignature) {
      if (Date.now() - session.lastStepChangeAt > 30_000) {
        logger.warn(`[Tracker] ${session.executionId} stalled, no step change for 30s`);
      }
    } else {
      session.lastStepSignature = stepSignature;
      session.lastStepChangeAt = Date.now();
    }

    this.handleStateChange(session, res);

  } catch (err) {
    session.failCount++;
    const statusCode = (err as { status?: number })?.status;

    // 404 直接失败，不重试
    if (statusCode === 404) {
      this.handleStateChange(session, {
        ...session.state, status: 'failed',
        error: this.toUserFriendlyError('404'),
      });
      return;
    }

    // 指数退避重试（最多 3 次）
    if (session.failCount <= 3) {
      const backoff = Math.min(2000 * Math.pow(2, session.failCount - 1), 30000);
      logger.warn(`[Tracker] Poll failed #${session.failCount}, retry in ${backoff}ms`);
      setTimeout(() => this.poll(session), backoff);
      return;
    }

    // 超过 3 次，标记失败
    this.handleStateChange(session, {
      ...session.state, status: 'failed',
      error: this.toUserFriendlyError(String(err)),
    });
  }
}

private toUserFriendlyError(error: string): string {
  const map: Array<{ pattern: RegExp; message: string }> = [
    { pattern: /404/, message: '工作流执行记录不存在，可能已被清理' },
    { pattern: /500|502|503/, message: '服务器繁忙，请稍后重试' },
    { pattern: /ENOTFOUND|ECONNREFUSED/, message: '网络连接失败，请检查网络设置' },
    { pattern: /ECONNRESET|EPIPE/, message: '连接被重置，请稍后重试' },
    { pattern: /timeout/i, message: '请求超时，请稍后重试' },
  ];
  for (const { pattern, message } of map) {
    if (pattern.test(error)) return message;
  }
  return `执行异常：${error.split(':')[0].trim()}`;
}
```

---

## 六、接口契约

工作流完成后，如果希望模型基于结果继续对话：

**方式A（前端主动）—— 本期采用**：
```typescript
// 卡片状态变为 completed 后，前端自动发送
sendMessage(`工作流执行完成，结果摘要：\n${summary}\n请继续分析。`);
```

**方式B（Main Process 注入 tool_result）—— P2**：
```typescript
// Tracker 调用 gatewayManager.rpc('chat.send', { role: 'toolresult', ... })
// 触发模型基于结果自动回复（无需用户操作）
// 需要 Gateway 协议支持，本期不做
```

**本期采用方式A**，不依赖 Gateway 协议变更。

---

## 四、接口契约

### 4.1 模板列表

```http
GET /api/workflows/templates
```

**Response：**
```json
[
  {
    "id": "cost-analysis-v1",
    "name": "成本分析",
    "description": "分析指定时间段的成本构成",
    "icon": "📊"
  }
]
```

### 4.2 模板详情

```http
GET /api/workflows/templates/:id
```

**Response：**
```json
{
  "workflowId": "wf_demo",
  "workflowVersionId": 7,
  "schema": {
    "nodeId": "startup_1",
    "enabled": true,
    "steps": [
      { "id": "fetch", "title": "数据取数", "mode": "confirm", "order": 10 },
      { "id": "process", "title": "数据处理", "mode": "auto", "order": 20 }
    ],
    "fields": [
      {
        "key": "fetch.timeRange",
        "label": "取数时间范围",
        "description": "取数来源：财务结算-账单明细 + 进出港账单",
        "group": "fetch",
        "groupTitle": "数据取数",
        "order": 10,
        "component": "single_select",
        "required": true,
        "defaultValue": "this_week_to_yesterday",
        "options": [
          { "value": "yesterday", "label": "昨日全天", "description": "00:00~23:59" },
          { "value": "this_week_to_yesterday", "label": "本周累计·周一至昨日", "description": "适合查看本周整体成本趋势" },
          { "value": "custom", "label": "自定义时间范围", "description": "手动指定开始/结束日期" }
        ],
        "sourceNodes": ["agent_1"]
      },
      {
        "key": "process.dimensions",
        "label": "汇总维度",
        "description": "可多选",
        "group": "process",
        "groupTitle": "数据处理",
        "order": 20,
        "component": "multi_select",
        "required": false,
        "defaultValue": ["site", "customer"],
        "options": [
          { "value": "site", "label": "网点" },
          { "value": "customer", "label": "客户" },
          { "value": "waybill", "label": "电子面单" }
        ],
        "sourceNodes": ["output_1"]
      }
    ]
  },
  "defaultPreset": {
    "id": "preset_001",
    "name": "默认启动配置",
    "values": {
      "fetch.timeRange": "this_week_to_yesterday",
      "process.dimensions": ["site", "customer"]
    }
  }
}
```

### 4.3 创建工作流

```http
POST /api/workflows
Content-Type: application/json

{
  "templateId": "cost-analysis-v1",
  "userMessage": "帮我分析上个月的成本",
  "values": {
    "timeRange": "2026-05-01~2026-05-31",
    "departments": ["sales", "tech"]
  }
}
```

**Response：**
```json
{
  "workflowId": "wf-20260605-001",
  "templateId": "cost-analysis-v1",
  "status": "created",
  "createdAt": "2026-06-05T10:30:00Z"
}
```

### 4.4 执行工作流

```http
POST /api/workflows/:workflowId/execute
Content-Type: application/json

{
  "sessionKey": "agent:main:main",
  "agentId": "main"
}
```

**Response：**
```json
{
  "executionId": "exec-20260605-001",
  "workflowId": "wf-20260605-001",
  "status": "pending",
  "createdAt": "2026-06-05T10:30:05Z",
  "estimatedDuration": 120
}
```

### 4.5 查询执行状态

```http
GET /api/workflows/:workflowId/status/:executionId
```

**Response：**
```json
{
  "executionId": "exec-20260605-001",
  "workflowId": "wf-20260605-001",
  "status": "running",
  "progress": 65,
  "currentStep": "生成报表中...",
  "startedAt": "2026-06-05T10:30:05Z",
  "steps": [
    { "name": "拉取数据", "status": "completed", "duration": 3200 },
    { "name": "数据清洗", "status": "completed", "duration": 1500 },
    { "name": "生成报表", "status": "running" },
    { "name": "导出产物", "status": "pending" }
  ],
  "result": null,
  "error": null
}
```

### 4.6 执行结果（completed 时）

```json
{
  "executionId": "exec-20260605-001",
  "status": "completed",
  "progress": 100,
  "completedAt": "2026-06-05T10:32:15Z",
  "result": {
    "summary": "本月成本较上月增长 12%，主要增长来源为...",
    "kpis": [
      { "name": "总成本", "value": 1234567, "change": 12, "changeType": "increase" }
    ],
    "artifacts": [
      { "id": "art-1", "name": "成本分析报告.html", "type": "html", "url": "/api/files/xxx" }
    ]
  }
}
```

---

## 六、IPC 契约

### Renderer → Main

| Channel | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `workflow:startTracking` | `{ executionId, sessionKey, agentId }` | `void` | 启动 Tracker 轮询 |
| `workflow:stopTracking` | `{ executionId }` | `void` | 手动停止轮询 |
| `workflow:sync-state` | `{ executionId }` | `WorkflowExecutionState \| null` | 查询当前跟踪状态 |

### Main → Renderer

| Channel | 参数 | 说明 |
|---------|------|------|
| `workflow:status-update` | `{ executionId, sessionKey, status, progress, currentStep, steps, result, error }` | 状态变更推送（含 sessionKey 过滤） |
| `workflow:complete` | `{ executionId, result }` | 执行完成通知（可选） |

---

## 七、关键类型定义

```typescript
// src/types/workflow.ts

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  icon?: string;
}

export interface WorkflowTemplateDetail {
  workflowId: string;
  workflowVersionId: number;
  schema: WorkflowSchema;
  defaultPreset?: WorkflowPreset;
}

export interface WorkflowSchema {
  nodeId: string;
  enabled: boolean;
  steps: WorkflowStep[];
  fields: WorkflowSchemaField[];
}

export interface WorkflowStep {
  id: string;
  title: string;
  mode: string;
  order: number;
}

export interface WorkflowSchemaField {
  key: string;
  label: string;
  description?: string;
  group: string;
  groupTitle: string;
  order: number;
  component: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: Array<{ value: string; label: string; description?: string }>;
  sourceNodes?: string[];
}

export interface WorkflowPreset {
  id: string;
  name: string;
  values: Record<string, unknown>;
}

export interface WorkflowExecutionStep {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  duration?: number; // ms
  error?: string;
}

export interface WorkflowExecutionState {
  executionId: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  progress: number; // 0-100
  currentStep?: string;
  startedAt?: string;
  completedAt?: string;
  steps: WorkflowExecutionStep[];
  result?: {
    summary?: string;
    kpis?: Array<{ name: string; value: string | number; change?: number; changeType?: 'increase' | 'decrease' }>;
    artifacts?: Array<{ id: string; name: string; type: string; url: string; size?: number }>;
  };
  error?: string;
}

// 扩展 ContentBlock
export interface WorkflowCardBlock {
  type: 'workflow_card';
  executionId: string;
  templateName: string;
  initialStatus: 'pending';
}
```

---

## 八、文件清单

### 新增文件

```
src/
├── types/workflow.ts                    # 工作流类型定义
├── lib/workflow-api.ts                  # 工作流 API 封装
├── stores/workflows.ts                  # 工作流模板状态管理
└── components/workflow/
    ├── WorkflowPicker.tsx               # 斜杠命令下拉选择器
    ├── WorkflowChip.tsx                 # 选中的模板高亮标签
    ├── WorkflowCard.tsx                 # 执行状态卡片
    └── WorkflowExecutionSteps.tsx       # 步骤时间线子组件

electron/
└── main/services/
    └── workflow-execution-tracker.ts    # 执行跟踪服务（轮询+IPC推送）
```

### 修改文件

```
src/
├── pages/Chat/ChatInput.tsx             # 新增 / 按钮、picker、chip、workflow 透传
├── pages/Chat/index.tsx                 # handleSend 新增 workflowId；表单提交流程
├── pages/Chat/ChatMessage.tsx           # 识别 workflow_card block，渲染卡片
├── pages/Chat/ChatPreviewPanel.tsx      # 替换 WorkflowPlaceholder（可选本期）
├── stores/chat.ts                       # sendMessage 新增 workflowId；workflowCardStates 状态
├── stores/chat/types.ts                 # ContentBlock union 新增 'workflow_card'
└── lib/form-api.ts                      # 如有需要扩展字段类型映射

electron/
└── main/ipc-handlers.ts                 # 注册 workflow:startTracking / stopTracking
```

---

## 九、进度推送策略（Tracker 内部）

| 条件 | 是否 IPC 推送 |
|------|--------------|
| 状态变更（pending → running → completed/failed） | ✅ 必推 |
| 步骤状态变更（某步骤 completed / failed） | ✅ 必推 |
| progress 为 10 的倍数 | ✅ 推送 |
| progress 变化 < 10% 且无步骤变更 | ❌ 跳过 |
| 执行完成 / 失败 | ✅ 必推 + 清理定时器 |
| 超时（>10 分钟） | ✅ 推 timeout + 清理 |

---

## 十、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 刷新页面后卡片状态丢失 | 用户看到 pending 状态 | `workflow:sync-state` IPC + 后端 fallback 查询 |
| 多窗口状态不同步 | 各窗口看到的卡片状态不一致 | Tracker 广播携带 sessionKey，Renderer 按当前会话过滤 |
| Tracker 已清理 executionId | sync-state 返回 null，卡片无法恢复 | fallback 到后端直接查询；仍查不到则标记 `unknown` |
| 后端 API 未就绪 | 前端开发阻塞 | 先用 mock 数据开发 UI，接口Ready后替换 |
| Gateway 不支持 workflow_card block | 消息解析失败 | ContentBlock type 扩展为 union，Gateway 不认识的 type 前端兜底渲染为文本 |
| 用户并发执行过多 | 后端资源紧张、UI 混乱 | 前端限制 `MAX_CONCURRENT_WORKFLOWS = 5` + Tracker 限制 `MAX_TRACKED_EXECUTIONS = 50` |

---

## 十一、优先级汇总

| 项 | 优先级 | 本期 | 说明 |
|----|--------|------|------|
| sessionKey 过滤 | **P0** | ✅ | 广播携带 sessionKey，Renderer 过滤 |
| workflow:sync-state IPC | **P0** | ✅ | 刷新恢复 + 边界 fallback |
| 最大跟踪数 + 定期清理 | **P0** | ✅ | Map 上限 50，completed 保留 5 分钟 |
| 指数退避 + 停滞检测 | **P1** | ✅ | 2s 起指数退避，30s 停滞 warn |
| 错误消息友好性映射 | **P1** | ✅ | 技术错误 → 用户可读文案 |
| 并发执行限制 | **P1** | ✅ | 前端 5 个 + Tracker 50 个兜底 |
| tool_result 注入 | **P2** | ❌ | 需 Gateway 协议支持，下期优化 |
| 跨会话系统通知 | **P2** | ❌ | 完成后通知，体验优化 |
| 状态持久化（electron-store）| **P2** | ❌ | Tracker 崩溃概率低，可恢复 |
| ARIA / 网络检测 | **P2** | ❌ | 可访问性优化 |

---

## 十二、与 qianwen3.7 方案的衔接

qianwen3.7 的《工作流执行状态推送技术方案》设计了 **Main Process 轮询 + 消息格式化**，以下是其方案在本方案中的定位：

| qianwen3.7 内容 | 本方案中的位置 |
|-----------------|---------------|
| `WorkflowExecutionTracker` | `electron/main/services/workflow-execution-tracker.ts` ✅ 直接采用 |
| 轮询策略（2s / 10min / 300次） | Tracker 内部实现 ✅ 直接采用 |
| 错误重试（3次） | Tracker 内部实现 ✅ 直接采用 |
| 消息格式化（Markdown 模板） | **不采用** → 改为 IPC 推送 + 前端组件渲染卡片 |
| 通过 Gateway `chat.send` 推送 | **不采用** → 改为 IPC `workflow:status-update` |
| `role: 'assistant'` 推送状态 | **不采用** → 状态更新不走消息通道 |
| ExecutionSession Map 管理 | Tracker 内部实现 ✅ 直接采用 |

**变化原因**：qianwen3.7 的 Gateway 推送方案会产生大量假 assistant 消息，污染对话历史和 token 统计。本方案改为 IPC 直连 Renderer，状态更新零成本、零污染。

---

## 十三、实现偏差记录

以下记录实际实现与本文档的偏差：

1. **工作流发送逻辑提取为独立 Hook**
   - 文档假设表单→创建→执行→发送的逻辑在 `Chat/index.tsx` 中内联实现
   - 实际实现提取为 `src/hooks/use-workflow-send.ts` 中的 `sendWithWorkflow` 函数，使 `Chat/index.tsx` 保持简洁

2. **`WorkflowExecutionSteps` 提取为独立子组件**
   - 文档未明确步骤时间线是否独立组件
   - 实际实现将步骤时间线提取为 `src/components/workflow/WorkflowExecutionSteps.tsx`，由 `WorkflowCard` 引用

3. **并发限制检查位置**
   - 文档未明确并发限制的检查时机
   - 实际实现在 `sendWithWorkflow` 入口处调用 `canStartWorkflow()` 检查，若超限则直接 toast 报错并返回 false，避免进入表单/创建流程

4. **模板详情预取**
   - 文档未明确模板详情的获取时机
   - 实际实现在用户选择模板后立即通过 `fetchWorkflowDetail` 预取详情（`ChatInput.tsx` 的 `onSelect` 回调），发送时再次调用以确保数据最新

5. **i18n 覆盖**
   - 文档未涵盖国际化
   - 实际实现为所有工作流相关 UI 文本添加了 `zh` / `en` / `ja` 翻译键

---

**文档结束**
