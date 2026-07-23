# StoClaw 记忆模块架构设计

> 基于代码与 OpenSpec 文档梳理。记忆模块采用 **mem0 OSS SDK + 自定义远程 Provider** 架构，memories 实际上存储在 STO `memory-center` 后端的 DashVector（语义）和 Elasticsearch（关键词）中。

---

## 一、总体架构图

```mermaid
graph TB
    subgraph Renderer["渲染进程 src/"]
        UI["聊天 / Agent UI"]
    end

    subgraph Main["主进程 electron/"]
        IPC["IPC Handlers<br/>electron/main/ipc/agent-memory.ts"]
        Orchestrator["AgentMemoryOrchestrator<br/>electron/services/agent-memory-orchestrator.ts"]
        ContextService["agentMemoryContextService<br/>electron/services/agent-memory-context-service.ts"]
        CaptureService["memoryCaptureService<br/>electron/services/memory-capture-service.ts"]
        TurnCoord["memoryTurnCoordinator<br/>electron/services/memory-turn-coordinator.ts"]
        TurnObs["memoryTurnEventObserver<br/>electron/services/memory-turn-event-observer.ts"]
        SummarySvc["claudeExecutionSummaryService<br/>electron/services/claude-execution-summary-service.ts"]
        Mem0Service["mem0Service<br/>electron/services/mem0-service.ts"]
        RemoteSvc["agentMemoryRemoteService<br/>electron/services/agent-memory-remote-service.ts"]
        VectorStore["stoMemoryCenterVectorStore"]
        Embedder["stoMemoryCenterEmbedder"]
        LLM["stoMemoryCenterLlm"]
        CustomProviders["mem0-custom-providers.ts<br/>自定义 LLM/Embedder/VectorStore"]
    end

    subgraph Shared["shared/ 跨进程共享逻辑"]
        Prompt["agent-memory-prompt.ts<br/>构建记忆 Block"]
        Filter["execution-memory-filter.ts<br/>执行/偏好记忆过滤"]
        Display["agent-memory-display.ts<br/>清理记忆标记"]
    end

    subgraph Remote["远程服务"]
        MC["memory-center"]
        DV["DashVector<br/>语义向量索引"]
        ES["Elasticsearch<br/>BM25 关键词索引"]
    end

    UI -->|ipcInvoke| IPC
    IPC --> Orchestrator
    Orchestrator --> Mem0Service
    Orchestrator --> VectorStore
    Orchestrator --> Embedder
    Orchestrator --> LLM
    Orchestrator --> SummarySvc
    ContextService --> Orchestrator
    CaptureService --> Orchestrator
    TurnCoord --> CaptureService
    TurnObs --> TurnCoord
    Mem0Service --> CustomProviders
    CustomProviders --> RemoteSvc
    VectorStore --> RemoteSvc
    Embedder --> RemoteSvc
    LLM --> RemoteSvc
    RemoteSvc -->|HTTP| MC
    MC --> DV
    MC --> ES
    Prompt -.-> ContextService
    Filter -.-> ContextService
    Filter -.-> CaptureService
    Display -.-> UI
```

---

## 二、记忆写入（捕获）流程

记忆在用户一次 Agent 执行结束后写入，分为两种：

- **Conversation Memory**（偏好记忆）：沉淀用户问答偏好、风格、长期目标。
- **Execution Experience**（执行经验）：沉淀工具选择、参数规划、避坑路径。

```mermaid
flowchart TD
    A["用户发送消息 / Agent 执行完成"] --> B{"Gateway 事件"}
    B -->|"notification agent:phase=completed"| C["memoryTurnEventObserver"]
    B -->|"chat:message turn.failed/aborted"| D["标记回合失败/中止<br/>丢弃已注入记忆绑定"]
    C --> E["memoryTurnCoordinator.completed"]
    E --> F["memoryCaptureService.capture"]

    F --> G["创建/更新 memory_capture_jobs<br/>conversation_memory + execution_experience"]
    G --> H["加载 execution history snapshot<br/>electron/engines/execution-snapshot.ts"]

    H --> I{"memory_kind ?"}
    I -->|conversation_memory| J["提取 userMessage + assistantMessage"]
    J --> K["过滤空/短消息<br/>总长度 < 12 则 skip"]
    K --> L["agentMemoryOrchestrator.addMemories<br/>metadata.memoryScope=preference"]

    I -->|execution_experience| M["检查 tools 数量 >= 5"]
    M -->|不足| N["skip_execution_job<br/>记录 skip_reason"]
    M -->|足够| O["绑定本轮注入的执行经验<br/>injectedExperiences"]
    O --> P["claudeExecutionSummaryService.summarize<br/>LLM 输出 shouldStore/intent/directCommand/avoidPath..."]
    P --> Q{"shouldStore == true ?"}
    Q -->|否| R["skip_execution_job"]
    Q -->|是| S["formatExecutionMemoryText<br/>序列化为可检索/可注入文本"]
    S --> T["agentMemoryOrchestrator.addMemories<br/>metadata.memoryScope=execution"]
    T --> U["resolveDeleteCandidates<br/>判断 superseded 旧记忆"]
    U --> V["agentMemoryOrchestrator.deleteMemory<br/>删除被取代的旧经验"]
    V --> W["job status = stored"]

    L --> W
```

---

## 三、记忆读取（注入）流程

每次用户发消息时，主进程异步检索相关记忆并注入到本轮发送给 Runtime 的 prompt 中。

```mermaid
flowchart TD
    A["chat-send-service.ts<br/>runMainChatSend"] --> B["memoryTurnCoordinator.begin<br/>登记本轮 injectedExecutionMemories"]
    B --> C["agentMemoryContextService.prepare<br/>输入 sourceText/message"]

    C --> D{"shouldRetrieveAgentMemories?<br/>长度>=6 或含2+汉字"}
    D -->|否| E["返回空 AgentMemoryContextBlocks"]
    D -->|是| F["初始化 mem0Service<br/>含 warm-up 与重试"]

    F --> G["agentMemoryOrchestrator.searchMemories<br/>userId + query + topK=12"]
    G --> H["mem0 SDK search"]
    H --> I["自定义 VectorStore Provider<br/>semantic + keyword hybrid"]
    I --> J["memory-center 返回结果"]
    J --> K["buildAgentMemoryContextBlocks<br/>shared/agent-memory-prompt.ts"]

    K --> L["extractPreferenceMemories<br/>最多 5 条 / 240 字符"]
    K --> M["extractActiveExecutionMemories<br/>最多 3 条 / 1000 字符<br/>status=active & confidence>=0.5"]

    L --> N["构建 Preference Memory Block<br/>AGENT_MEMORY_CONTEXT_MARKER"]
    M --> O["构建 Execution Memory Block<br/>AGENT_EXECUTION_MEMORY_CONTEXT_MARKER"]
    N --> P["prepareMemoryInjection<br/>将 block 拼接到 EngineSendParams"]
    O --> P

    P --> Q["dispatch 到 Gateway/Runtime"]
    Q --> R["UI 展示前 agent-memory-display.ts<br/>stripAgentMemoryContexts 清理标记"]
```

---

## 四、执行经验总结子流程

执行经验不是原文存储，而是由 `qwen3.6-plus` 总结成结构化 JSON，再序列化为文本。

```mermaid
flowchart LR
    A["输入：userTask + finalAnswerSummary + tools + injectedExperiences"] --> B["buildSummaryPrompt"]
    B --> C["agentMemoryRemoteService.createChatCompletion<br/>model=qwen3.6-plus"]
    C --> D["parseJsonObjectFromText<br/>解析 JSON"]
    D --> E["ExecutionExperienceSummary"]
    E --> F{"shouldStore?"}
    F -->|false| G["丢弃"]
    F -->|true| H["formatExecutionMemoryText"]
    H --> I["直接执行 / 参数模式 / 避免 / 探索路径 / 适用 / 约束"]
    I --> J["写入 mem0<br/>memoryType=tool_routing_experience"]
    J --> K["candidateAssessments 判断旧经验是否被取代"]
    K --> L["删除 superseded 旧记忆"]
```

---

## 五、混合检索架构（DashVector + Elasticsearch）

这是 `openspec/changes/agent-memory-remote-vectorstore` 的核心设计：语义走 DashVector，关键词走 Elasticsearch，mem0 负责 hybrid ranking。

```mermaid
flowchart LR
    A["mem0 SDK V3"] --> B["StoMemoryCenterVectorStoreProvider<br/>electron/services/mem0-custom-providers.ts"]

    B --> C["search(queryVector, topK, filters)"]
    B --> D["keywordSearch(queryText, topK, filters)"]

    C --> E["POST /agent/v1/agent-memory/vector/search"]
    D --> F["POST /agent/v1/agent-memory/keyword/search"]

    E --> G["DashVector<br/>语义相似度"]
    F --> H["Elasticsearch 8.x<br/>BM25"]

    G --> I["返回向量得分"]
    H --> J["返回关键词得分"]
    I --> K["mem0 hybrid ranking"]
    J --> K
    K --> L["最终记忆列表"]

    M["写入/更新/删除"] --> N["memory-center 先写 DashVector"]
    N -->|成功| O["同步 Elasticsearch<br/>相同 recordId"]
    O -->|失败| P["仅记录日志<br/>不回滚主写入"]
```

---

## 六、关键数据表

`electron/db/migrations/0002-memory-capture-jobs.ts`：

| 字段 | 说明 |
|------|------|
| `id` | `conversation_memory:{runId}` / `execution_experience:{runId}` |
| `memory_kind` | `conversation_memory` / `execution_experience` |
| `status` | `pending -> ready -> summarizing -> stored / skipped / retry_wait / failed` |
| `payload_json` | 待处理/已处理的快照与总结结果 |
| `memory_id` | 最终写入 mem0 的记忆 ID |
| `retry_count` | 最大 3 次重试 |

---

## 七、核心设计决策

1. **远程优先**：mem0 SDK 的 LLM、Embedder、VectorStore 全部替换为 STO `memory-center` 远程实现，本地只保留 mem0 的编排逻辑和 SQLite history。
2. **双通道混合检索**：语义检索走 DashVector，关键词检索走 Elasticsearch，失败后自动降级为语义检索。
3. **执行经验生命周期**：新经验写入时会评估本轮注入的旧经验，对 `supersedes` 的旧路径执行删除，避免记忆膨胀。
4. **写入弱一致性**：Elasticsearch 作为 secondary index，同步失败只记录日志，不影响 DashVector 主写入成功。
5. **隔离性**：所有检索按 `user_id` / `app_id` / `collectionName` 隔离，服务端以认证用户为权威作用域。

---

## 八、关键文件索引

| 职责 | 文件路径 |
|------|----------|
| 统一编排入口 | `electron/services/agent-memory-orchestrator.ts` |
| mem0 SDK 封装 | `electron/services/mem0-service.ts` |
| 自定义远程 Provider | `electron/services/mem0-custom-providers.ts` |
| memory-center HTTP 客户端 | `electron/services/agent-memory-remote-service.ts` |
| 上下文检索服务 | `electron/services/agent-memory-context-service.ts` |
| 记忆捕获服务 | `electron/services/memory-capture-service.ts` |
| 回合协调器 | `electron/services/memory-turn-coordinator.ts` |
| 回合事件观察器 | `electron/services/memory-turn-event-observer.ts` |
| 执行经验总结 | `electron/services/claude-execution-summary-service.ts` |
| IPC 入口 | `electron/main/ipc/agent-memory.ts` |
| 提示词构建 | `shared/agent-memory-prompt.ts` |
| 记忆过滤 | `shared/execution-memory-filter.ts` |
| 记忆标记清理 | `shared/agent-memory-display.ts` |
| 聊天发送编排 | `electron/services/chat-send-service.ts` |
| 数据表迁移 | `electron/db/migrations/0002-memory-capture-jobs.ts` |
| OpenSpec 设计 | `openspec/changes/agent-memory-remote-vectorstore/design.md` |
