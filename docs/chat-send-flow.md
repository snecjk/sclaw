# Chat 消息发送流程分析

## 概览

本文档描述用户在聊天窗口输入消息并发送后，消息从 UI 层经过 IPC 到达 OpenClaw Gateway 的完整流程。

---

## 1. 用户输入与触发

**文件**: `src/pages/Chat/ChatInput.tsx`

- 用户在文本框中输入内容后：
  - 按 **Enter** 键 → `handleKeyDown()` (line 320-336)
  - 点击 **发送按钮** → `handleSend()` (line 291-313)
- `handleSend` 清空输入框，收集附件信息，调用 `onSend(text, attachments, targetAgentId)`。

---

## 2. Chat 页面传递

**文件**: `src/pages/Chat/index.tsx`

页面从 Zustand store 中取出 `sendMessage`：

```ts
const sendMessage = useChatStore((s) => s.sendMessage)
```

将其作为 `onSend` prop 传递给 `ChatInput` 组件。

---

## 3. Zustand Store — sendMessage

**文件**: `src/stores/chat.ts` (line 1463-1636)

核心发送逻辑，分三个阶段：

| 阶段             | 行号        | 内容                                           |
| ---------------- | ----------- | ---------------------------------------------- |
| 验证与会话解析   | 1468-1516   | 校验消息、解析目标 session、乐观插入用户消息到 UI |
| 启动监控定时器   | 1520-1563   | 历史轮询（3s 后每 4s）、90s 安全超时检测卡死    |
| 通过 IPC 发送    | 1565-1635   | 根据是否有附件选择不同发送路径                   |

**两条发送路径：**

- **有附件** → `hostApiFetch('/api/chat/send-with-media', ...)`
- **纯文本** → `useGatewayStore().rpc('chat.send', ...)`

两条路径均使用 120 秒超时。

---

## 4. IPC 跨进程边界（Renderer → Main）

| 文件                        | 函数             | 说明                                              |
| --------------------------- | ---------------- | ------------------------------------------------- |
| `src/lib/api-client.ts`     | `invokeIpc()`    | 封装 `ipcRenderer.invoke(channel, ...args)`        |
| `src/lib/host-api.ts`       | `hostApiFetch()` | 通过 `hostapi:fetch` IPC 通道代理 HTTP 请求        |
| `src/stores/gateway.ts`     | `rpc()`          | 调用 `invokeIpc('gateway:rpc', method, params)`    |

---

## 5. Main 进程 IPC Handler

**文件**: `electron/main/ipc-handlers.ts` (line 1054-1061)

注册两个关键 IPC handler：

- `gateway:rpc` → 调用 `gatewayManager.rpc(method, params, timeoutMs)`
- `hostapi:fetch` → 代理请求到本地 Host API Server

---

## 6. Host API Server 路由处理（有附件时）

**文件**: `electron/api/routes/gateway.ts` (line 80-127)

`POST /api/chat/send-with-media` 路由处理：

1. 读取媒体文件
2. Base64 编码图片（PNG、JPEG、BMP、WebP）
3. 将文件引用添加到消息文本中
4. 最终调用 `gatewayManager.rpc('chat.send', ...)`

**文件**: `electron/api/routes/files.ts` (line 84-108)

`POST /api/files/stage-paths` 路由：将文件暂存到 `~/.stoclaw/openclaw/media/outbound/`

---

## 7. Gateway Manager — WebSocket 发送

**文件**: `electron/gateway/manager.ts` (line 625-660)

最终通过 WebSocket 将消息发送到 OpenClaw Gateway 进程：

1. 验证 WebSocket 连接状态（`ws.readyState === WebSocket.OPEN`）
2. 生成 `requestId`（UUID）
3. 存入 `pendingRequests` Map（等待响应回调）
4. 发送 JSON-RPC 格式消息：

```json
{
  "type": "req",
  "id": "<uuid>",
  "method": "chat.send",
  "params": { "sessionId": "...", "text": "...", "attachments": [...] }
}
```

---

## 8. 响应流回显

Gateway 进程收到 `chat.send` 后启动 AI 对话，通过 WebSocket **流式推送**事件通知。Main 进程收到事件后更新 Zustand store，React 组件监听 store 变化并重新渲染消息列表。

---

## 流程图

```
用户输入 + Enter/点击发送
    |
[ChatInput] handleSend() -> onSend(text, attachments)
    |
[Chat Page] sendMessage (from Zustand store)
    |
[chat.ts] sendMessage()
|-- 乐观写入用户消息到 UI
|-- 启动轮询 + 安全超时
|-- 发送 --+-- 有附件 -> hostApiFetch('/api/chat/send-with-media')
           |                  |
           |        [Main: Host API Server]
           |         处理媒体文件 + Base64 编码
           |                  |
           +-- 纯文本 -> gatewayStore.rpc('chat.send')
                              |
               [Renderer IPC] invokeIpc('gateway:rpc')
                              |
               [Main Process] ipc-handlers.ts
                              |
               [GatewayManager] rpc() -> WebSocket 发送
                              |
               [OpenClaw Gateway] 执行 AI 对话
                              |
                        流式回传 (WebSocket)
                              |
               [Zustand Store] 更新消息
                              |
               [React] 重渲染消息列表
```

---

## 关键超时配置

| 层级           | 超时   | 用途       |
| -------------- | ------ | ---------- |
| IPC 发送       | 120s   | 网络容错   |
| Gateway RPC    | 30s    | 常规操作   |
| 历史轮询延迟   | 3s     | 初始延迟   |
| 历史轮询间隔   | 4s     | 增量刷新   |
| 安全超时       | 90s    | 卡死检测   |

---

## 状态管理

| Store                | 职责                         |
| -------------------- | ---------------------------- |
| `useChatStore`       | 消息列表、会话、流式状态、发送状态 |
| `useGatewayStore`    | Gateway 连接状态、RPC 代理    |
| `useAgentsStore`     | 可用 Agent 列表              |

---

## 关键文件索引

| 文件                                      | 核心内容                    |
| ----------------------------------------- | --------------------------- |
| `src/pages/Chat/ChatInput.tsx`            | 输入组件、发送触发          |
| `src/pages/Chat/index.tsx`                | Chat 页面、Store 绑定       |
| `src/stores/chat.ts`                      | sendMessage 核心逻辑        |
| `src/stores/gateway.ts`                   | Gateway RPC 封装            |
| `src/lib/api-client.ts`                   | IPC 调用封装                |
| `src/lib/host-api.ts`                     | Host API 代理请求           |
| `electron/main/ipc-handlers.ts`           | Main 进程 IPC 注册          |
| `electron/main/ipc/host-api-proxy.ts`     | hostapi:fetch 代理          |
| `electron/api/server.ts`                  | Host API HTTP Server        |
| `electron/api/routes/gateway.ts`          | /api/chat/send-with-media   |
| `electron/api/routes/files.ts`            | /api/files/stage-paths      |
| `electron/gateway/manager.ts`             | WebSocket RPC 发送          |

---

## 架构原则

- **Renderer 不直接访问文件系统或网络**，所有请求通过 Main 进程代理
- **传输策略由 Main 进程控制**，固定为 `WS -> HTTP -> IPC fallback`
- **Renderer 通过 `host-api.ts` 和 `api-client.ts` 统一入口调用后端**，禁止直接使用 `ipcRenderer.invoke`
- **不直接调用 Gateway HTTP 端点**（`fetch('http://127.0.0.1:18789/...')`），通过 Main 进程代理通道避免 CORS 问题
