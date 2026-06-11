# 工作流工具架构修改方案

## 1. 背景与现状分析

### 1.1 用户预期流程
```
用户自然语言输入 → 工作流模板查询 → 获取 schema → 弹出表单填写
                    ↓
表单确认 → 创建工作流 → 引导执行
                    ↓
执行命令 → 执行工具 + SSE 状态更新卡片
                    ↓
执行完成 → 输出最终产物
```

### 1.2 当前实现状态

| 功能模块 | 当前实现 | 文件位置 |
|---------|---------|---------|
| 工作流 API 客户端 | 已实现 | `src/lib/workflow-api.ts` |
| 表单映射工具 | 已实现 | `src/lib/workflow-form-utils.ts` |
| 参数表单组件 | 已实现 | `src/components/parameter-form/ParameterFormCard.tsx` |
| 工作流记忆存储 | 已实现 | `src/stores/workflow-memory.ts` |
| 工作流状态追踪器 | 已实现 | `electron/main/services/workflow-execution-tracker.ts` |
| 发送流程集成 | 已实现 | `src/hooks/use-workflow-send.ts` |
| 消息卡片渲染 | 已实现 | `src/components/workflow/WorkflowCard.tsx` |

### 1.3 存在的问题

1. **sai-cli 不可用**：原设计的 sai-cli 技能方式无法使用
2. **工具封装缺失**：现有代码直接调用 HTTP API，没有统一的工具封装层
3. **SSE 支持不完整**：当前使用轮询方式，需要增强 SSE 实时推送能力
4. **自然语言触发集成**：需要与 Agent 工具调用系统深度集成

---

## 2. 架构设计方案

### 2.1 技术选型：OpenClaw 插件模式

**决策理由**：
- ✅ 不依赖 sai-cli
- ✅ 可直接调用 HTTP API
- ✅ 支持 SSE 流式推送
- ✅ 与现有 sto-plugin 架构一致
- ✅ 可以与前端深度集成（表单、卡片）

**架构对比**：

| 方案 | 优点 | 缺点 | 适用场景 |
|-----|------|------|---------|
| CLI 模式 | 简单直接 | 状态管理复杂，不适合长连接 | 一次性任务 |
| MCP 模式 | 标准化协议，支持 SSE | 需要额外协议支持 | 实时状态更新 |
| **OpenClaw 插件** | 原生支持，深度集成 | 需要遵循插件规范 | **本项目最佳** |

### 2.2 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Renderer (Frontend)                       │
├─────────────────────────────────────────────────────────────────┤
│  ChatInput → use-workflow-send → workflow-api.ts               │
│                              ↓                                   │
│  ParameterFormCard ← form-handlers.ts                          │
│                              ↓                                   │
│  WorkflowCard ← workflow:status-update (IPC)                   │
└─────────────────────────────────────────────────────────────────┘
                              ↕ (host-api / IPC)
┌─────────────────────────────────────────────────────────────────┐
│                      Main Process (Electron)                     │
├─────────────────────────────────────────────────────────────────┤
│  workflow:startTracking / workflow:status-update               │
│                              ↓                                   │
│  WorkflowExecutionTracker (轮询 + SSE)                         │
└─────────────────────────────────────────────────────────────────┘
                              ↕ (HTTP / SSE)
┌─────────────────────────────────────────────────────────────────┐
│                    OpenClaw Plugin Layer                         │
├─────────────────────────────────────────────────────────────────┤
│  sto-workflow-tool (新插件)                                     │
│  ├── search_workflow_templates                                  │
│  ├── get_workflow_schema                                        │
│  ├── create_workflow                                            │
│  ├── execute_workflow                                           │
│  ├── get_workflow_status                                        │
│  └── subscribe_workflow_status (SSE)                           │
└─────────────────────────────────────────────────────────────────┘
                              ↕ (HTTP API)
┌─────────────────────────────────────────────────────────────────┐
│                    Backend API (STO Cloud)                       │
├─────────────────────────────────────────────────────────────────┤
│  /agent/v1/workflow-templates/search                           │
│  /agent/v1/workflow-templates/:id/startup-schema               │
│  /agent/v1/workflows                                            │
│  /agent/v1/workflows/:id/start                                  │
│  /agent/v1/runs/:id                                             │
│  /agent/v1/runs/:id/stream (SSE)                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 工具接口定义

### 3.1 工具列表

| 工具 ID | 功能 | 触发时机 | 返回内容 |
|--------|------|---------|---------|
| `search_workflow_templates` | 查询工作流模板 | 用户自然语言请求创建工作流 | 模板列表（id, label, description） |
| `get_workflow_schema` | 获取启动参数 schema | 用户选择模板后 | schema（steps, fields） |
| `create_workflow` | 创建工作流实例 | 表单参数确认后 | workflowId, defaultPresetId |
| `execute_workflow` | 执行工作流 | 用户确认执行 | runId, status |
| `get_workflow_status` | 查询执行状态 | 轮询/手动查询 | 执行状态、进度、结果 |
| `subscribe_workflow_status` | SSE 订阅状态 | 实时跟踪执行 | 流式状态更新 |

### 3.2 工具参数定义

#### 3.2.1 search_workflow_templates
```typescript
{
  query: string;      // 搜索关键词
  limit?: number;     // 返回数量限制，默认 10
}
```

#### 3.2.2 get_workflow_schema
```typescript
{
  templateId: string;  // 模板 ID
}
```

#### 3.2.3 create_workflow
```typescript
{
  templateId: string;                    // 模板 ID
  displayName?: string;                  // 自定义名称
  startup: {
    schemaHash: string;                  // schema 哈希
    values: Record<string, unknown>;     // 参数值
  };
  idempotencyKey?: string;               // 幂等键
}
```

#### 3.2.4 execute_workflow
```typescript
{
  workflowId: string;                    // 工作流 ID
  inputs?: Record<string, unknown>;      // 输入参数
  idempotencyKey?: string;               // 幂等键
}
```

#### 3.2.5 get_workflow_status
```typescript
{
  runId: string;                         // 执行 ID
}
```

#### 3.2.6 subscribe_workflow_status
```typescript
{
  runId: string;                         // 执行 ID
  sessionKey: string;                    // 会话标识（用于 IPC 广播）
}
```

---

## 4. 实现计划

### 4.1 阶段一：插件基础结构（1 天）

```
sto-plugin/sto-workflow-tool/
├── openclaw.plugin.json    # 插件配置
├── package.json            # 依赖配置
├── api.ts                  # API 导出
├── index.ts                # 插件入口
├── tools/
│   ├── index.ts            # 工具注册
│   ├── search-templates.ts # 模板查询
│   ├── get-schema.ts       # Schema 获取
│   ├── create-workflow.ts  # 创建工作流
│   ├── execute-workflow.ts # 执行工作流
│   ├── get-status.ts       # 状态查询
│   └── subscribe-status.ts # SSE 订阅
└── utils/
    ├── http-client.ts      # HTTP 客户端
    └── sso-auth.ts         # SSO 认证
```

### 4.2 阶段二：前端集成优化（1 天）

- [ ] 优化 `use-workflow-send.ts` 与插件工具调用集成
- [ ] 增强 `ParameterFormCard` 支持更丰富的表单类型
- [ ] 优化 `WorkflowCard` 产物展示样式

### 4.3 阶段三：SSE 实时推送（1 天）

- [ ] 实现 `subscribe_workflow_status` 工具的 SSE 流式输出
- [ ] 优化 Main Process Tracker 支持 SSE 推送
- [ ] 实现 IPC 广播节流（避免频繁更新）

### 4.4 阶段四：长记忆与恢复（0.5 天）

- [ ] 增强 `workflow-memory.ts` 支持跨会话恢复
- [ ] 实现 `tryResolvePendingWorkflow` 的恢复逻辑
- [ ] 添加过期记录清理策略

### 4.5 阶段五：测试与文档（0.5 天）

- [ ] 编写工具单元测试
- [ ] 更新 README.md 工作流使用说明
- [ ] 更新 `docs/WORKFLOW-IMPLEMENTATION-SCHEME.md`

---

## 5. 关键代码示例

### 5.1 插件入口示例

```typescript
// sto-plugin/sto-workflow-tool/index.ts
import { Type } from "@sinclair/typebox";
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";

export default definePluginEntry({
  id: "sto-workflow-tool",
  name: "申通工作流执行工具",
  description: "提供工作流模板查询、创建、执行和状态跟踪的企业工具",
  register(api: OpenClawPluginApi) {
    // 注册搜索工具
    api.registerTool({
      id: "search_workflow_templates",
      name: "search_workflow_templates",
      label: "查询工作流模板",
      description: `根据用户自然语言描述搜索匹配的工作流模板。
用户可能会说"帮我创建对账工作流"、"执行结算流程"等。
返回匹配的模板列表供用户选择。`,
      parameters: Type.Object({
        query: Type.String({ description: "搜索关键词，用户描述的工作流名称或功能" }),
        limit: Type.Optional(Type.Number({ description: "返回数量限制，默认 10" })),
      }),
      execute: async (params, ctx) => {
        // 调用后端 API 搜索模板
        const templates = await searchTemplates(params.query, params.limit);
        return {
          content: [{ type: "text", text: JSON.stringify({ templates }) }],
          details: { templates },
        };
      },
    });
    
    // ... 注册其他工具
  },
});
```

### 5.2 SSE 订阅示例

```typescript
// sto-plugin/sto-workflow-tool/tools/subscribe-status.ts
export async function subscribeWorkflowStatus(
  runId: string,
  sessionKey: string,
  api: OpenClawPluginApi,
): Promise<AsyncIterable<{ event: string; data: WorkflowRunResponse }>> {
  const baseUrl = await getBaseUrl(api);
  const token = await getSsoToken(api);
  
  const response = await fetch(`${baseUrl}/agent/v1/runs/${runId}/stream`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Session-Key': sessionKey,
    },
  });
  
  if (!response.ok) {
    throw new Error(`SSE connection failed: ${response.status}`);
  }
  
  return parseSSEStream(response.body!);
}

async function* parseSSEStream(
  body: ReadableStream<Uint8Array>
): AsyncIterable<{ event: string; data: WorkflowRunResponse }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    
    let currentEvent = '';
    let currentData = '';
    
    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        currentData += line.slice(5);
      } else if (line === '' && currentEvent && currentData) {
        yield { event: currentEvent, data: JSON.parse(currentData) };
        currentEvent = '';
        currentData = '';
      }
    }
  }
}
```

---

## 6. 与现有代码的集成点

### 6.1 前端调用层

当前 `src/lib/workflow-api.ts` 已实现 HTTP 客户端，插件可直接复用或作为底层依赖。

**集成方式**：
```typescript
// 方案 A: 插件内部直接调用 HTTP
import { hostApiFetch } from '@/lib/host-api';

// 方案 B: 通过 IPC 委托给 Main Process
await invokeIpc('workflow-tool:execute', { runId, params });
```

### 6.2 表单系统集成

当前 `src/components/parameter-form/` 已实现参数表单，需与插件工具返回的 schema 集成。

**集成方式**：
```typescript
// use-workflow-send.ts
const schema = await getWorkflowSchema(templateId);
const formConfig = buildWorkflowFormConfig(schema, userInputText);
showForm(formConfig, { source: 'workflow', sourceId: templateId });
```

### 6.3 状态追踪器

当前 `electron/main/services/workflow-execution-tracker.ts` 已实现轮询追踪，需增强 SSE 支持。

**增强点**：
- 支持 SSE 连接作为主要推送方式
- 轮询作为 SSE 失败的降级方案
- IPC 广播增加节流逻辑

---

## 7. 风险评估与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|-----|------|------|---------|
| 后端 API 未就绪 | 高 | 中 | 先用 mock 数据开发，接口 Ready 后替换 |
| SSE 连接不稳定 | 中 | 中 | 轮询降级方案，自动重连机制 |
| 插件加载失败 | 中 | 低 | 插件启动时健康检查，失败时 fallback 到直接 HTTP 调用 |
| 表单类型不匹配 | 低 | 低 | 建立 component 映射表，不认识的类型降级为 text |

---

## 8. 验收标准

### 8.1 功能验收

- [ ] 用户可以通过自然语言触发工作流选择（如"帮我创建对账工作流"）
- [ ] 选择模板后弹出参数表单，支持分步确认
- [ ] 表单提交后创建工作流并引导执行
- [ ] 执行中实时显示进度和状态（SSE 推送）
- [ ] 执行完成后显示产物卡片
- [ ] 刷新页面后能恢复执行状态

### 8.2 性能验收

- [ ] 模板搜索响应时间 < 2s
- [ ] SSE 状态更新延迟 < 1s
- [ ] 表单渲染时间 < 500ms

### 8.3 质量验收

- [ ] 工具单元测试覆盖率 > 80%
- [ ] 通过 `pnpm run typecheck` 无类型错误
- [ ] 通过 `pnpm run lint` 无代码风格问题
- [ ] 通过 `pnpm run comms:replay` 通信变更验证

---

## 9. 时间估算

| 阶段 | 内容 | 时间 |
|-----|------|------|
| 阶段一 | 插件基础结构 | 1 天 |
| 阶段二 | 前端集成优化 | 1 天 |
| 阶段三 | SSE 实时推送 | 1 天 |
| 阶段四 | 长记忆与恢复 | 0.5 天 |
| 阶段五 | 测试与文档 | 0.5 天 |
| **总计** | | **4 天** |

---

## 10. 下一步行动

1. **确认方案**：与用户确认此方案是否符合预期
2. **创建插件**：创建 `sto-plugin/sto-workflow-tool` 目录结构
3. **实现工具**：逐个实现 6 个工具
4. **集成测试**：与前端联调测试
5. **文档更新**：更新相关文档

请确认此方案是否符合您的需求，我将开始实现。
