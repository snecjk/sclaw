# 通信架构分析

## 概览

本文档描述 StoClaw 桌面应用中 React 前端与后端服务之间的完整通信架构，包括 API 调用链路、SSE 事件推送机制、以及本地 Gateway 网关的角色与数据流。

项目中存在 **三个通信目标**：

| 服务 | 地址 | 性质 |
|------|------|------|
| **Host API（内嵌 Node.js 服务）** | `127.0.0.1:3210` | Electron 主进程内嵌的 HTTP 服务器，提供业务 API（认证、配置、技能市场等） |
| **OpenClaw Gateway** | `127.0.0.1:18789` | 本地 AI Agent 网关（独立进程），负责会话管理、消息收发、实时事件推送 |
| **远程 STO 后端** | `https://baseinfo-aimemory.sto.cn` 等 | 云端 Java 服务，按 SSO 环境切换 |

---

## 1. 前端调用 Host API

Host API 是 **Electron 主进程内嵌的 Node.js HTTP 服务器**（`electron/api/server.ts`），监听 `127.0.0.1:3210`，集中提供所有业务 API。前端不直接发起 HTTP 请求，所有调用通过 Electron IPC 代理到 Main Process，由主进程通过 `proxyAwareFetch()` 向自身内嵌的 HTTP 服务器发起请求。

### 1.1 调用链路

```
React Renderer
  └── hostApiFetch('/api/xxx')          // src/lib/host-api.ts
      └── invokeIpc('hostapi:fetch')    // IPC 调用到 Main Process
          └── Main Process              // electron/main/ipc/host-api-proxy.ts
              └── proxyAwareFetch()     // electron/utils/proxy-fetch.ts
                  └── net.fetch('http://127.0.0.1:3210/api/xxx')
                      └── Host API Server (同进程)  // electron/api/server.ts
                          └── routeHandlers 匹配路由并处理
```

### 1.2 各层职责

- **`hostApiFetch`**（`src/lib/host-api.ts`）：渲染进程入口，封装请求参数，优先走 IPC，若 IPC 不可用且 `localStorage` 中 `stoclaw:allow-localhost-fallback` 为 `'1'`，则回退为直接 `fetch()`。
- **`hostapi:fetch` IPC Handler**（`electron/main/ipc/host-api-proxy.ts`）：主进程处理器，校验路径、设置超时、调用 `proxyAwareFetch()`。
- **`proxyAwareFetch`**（`electron/utils/proxy-fetch.ts`）：优先使用 Electron `net.fetch()`（自动遵守企业代理设置），失败时降级到 Node.js 全局 `fetch()`。

### 1.3 超时策略

| 路径 | 超时 |
|------|------|
| `/api/auth/login`（SSO 登录） | 300,000ms（5 分钟） |
| 技能安装（`/api/skill-plaza/install` 等） | 180,000ms（3 分钟） |
| 其他请求 | 15,000ms（15 秒） |

### 1.4 响应信封格式

兼容两种格式：

- **Unified 格式**（新）：`{ ok: boolean, data: { status, ok, json, text } }`
- **Legacy 格式**（旧）：`{ success: boolean, ok: boolean, status, json, text }`

---

## 2. Gateway 通信

### 2.1 多传输层架构

**文件**: `src/lib/api-client.ts`

渲染进程通过 `invokeApi(channel, ...args)` 调用 Gateway，支持三种传输方式：

| 传输方式 | 说明 | 默认启用 |
|---------|------|---------|
| **IPC** | 通过 Electron IPC 调用主进程 | 始终启用 |
| **WebSocket** | 直连 Gateway WS (`ws://127.0.0.1:{port}/ws`) | 默认关闭，诊断模式可开 |
| **HTTP** | 通过主进程 `gateway:httpProxy` 代理 | 默认关闭，诊断模式可开 |

传输优先级通过规则匹配 channel 名决定：

- `gateway:rpc`：默认 `['ipc']`，诊断模式 `['ws', 'http', 'ipc']`
- 其他所有 channel：始终 `['ipc']`

### 2.2 Gateway HTTP 代理

**文件**: `electron/main/ipc-handlers.ts`

`gateway:httpProxy` 处理器：

1. 安全检查：阻止 `/update`、`/upgrade`、`/install`、`/openclaw/` 等危险路径
2. 从设置中获取 `gatewayToken`，自动注入 `Authorization: Bearer {token}` 头
3. 通过 `proxyAwareFetch()` 向 `http://127.0.0.1:{port}{path}` 发起请求

### 2.3 Gateway RPC

渲染进程通过 `useGatewayStore.rpc(method, params)` 发起 RPC 调用，底层走 `invokeIpc('gateway:rpc', method, params)`，主进程转发给 Gateway 的 `/rpc` 端点。

---

## 3. SSE / 实时事件推送

### 3.1 事件订阅机制

**文件**: `src/lib/host-events.ts`

`subscribeHostEvent(eventName, callback)` 有两条路径，**优先走 IPC，回退走 SSE**：

```
subscribeHostEvent('gateway:chat-message')
  ├── 首选: ipcRenderer.on('gateway:chat-message')    // Main 进程推送的 IPC 事件
  └── 回退: EventSource('http://127.0.0.1:3210/api/events')  // 浏览器 SSE
```

### 3.2 支持的 IPC 事件映射

| 事件名 | IPC Channel | 用途 |
|--------|-------------|------|
| `gateway:status` | `gateway:status-changed` | Gateway 进程状态变化 |
| `gateway:error` | `gateway:error` | Gateway 错误 |
| `gateway:notification` | `gateway:notification` | Agent 通知（会话、任务状态） |
| `gateway:chat-message` | `gateway:chat-message` | 聊天消息推送 |
| `gateway:channel-status` | `gateway:channel-status` | 通信频道状态变更 |
| `oauth:success` | `oauth:success` | OAuth 回调成功 |

### 3.3 实时数据的完整流向

大部分实时事件的数据来源是 **本地 Gateway 进程**，而非 Host API：

```
OpenClaw Gateway (18789)
  │
  │  WebSocket 长连接（Main Process 主动连接）
  ↓
Main Process (Electron)
  │  收到 Gateway 推送的事件
  │  mainWindow.webContents.send('gateway:chat-message', payload)
  ↓
Renderer (React)
  │  ipcRenderer.on('gateway:chat-message', callback)
  ↓
useGatewayStore.handleGatewayNotification()
  └── useChatStore.handleChatEvent()   // 更新聊天 UI
```

**关键理解**：SSE（`/api/events`）只是 IPC 不可用时的回退方案。正常情况下，实时推送走的是 `Gateway → Main Process WebSocket → IPC → Renderer` 这条链路。

### 3.4 事件去重机制

**文件**: `src/stores/gateway.ts`

Gateway Store 内置事件去重逻辑（`buildGatewayEventDedupeKey` + `shouldProcessGatewayEvent`），基于 `runId`、`sessionKey`、`seq`、`messageId` 等字段生成去重 key，30 秒 TTL 过期清理，防止重复事件导致 UI 闪烁。

---

## 4. 安全层：Preload 白名单

**文件**: `electron/preload/index.ts`

Preload 脚本通过 `contextBridge` 暴露 `window.electron` API，对 IPC channel 实行严格白名单控制：

- **invoke 白名单**（约 70 个 channel）：`hostapi:fetch`、`gateway:httpProxy`、`gateway:rpc`、`gateway:status`、`app:request` 等
- **on/once 事件白名单**（约 30 个事件）：`gateway:status-changed`、`gateway:chat-message`、`oauth:success` 等
- 不在白名单中的 channel 调用会抛出 `Invalid IPC channel` 错误

---

## 5. 远程 STO 后端通信

**文件**: `electron/utils/sto-domain.ts`

远程 STO Java 后端的 URL 根据 SSO 环境动态解析：

| SSO 环境 | Base URL |
|----------|----------|
| `daily-external` | `https://baseinfo-aimemory-test.sto.cn` |
| `pre-release` | `https://pre-baseinfo-aimemory.sto.cn` |
| `local` | `http://127.0.0.1:7001` |
| 默认（生产） | `https://baseinfo-aimemory.sto.cn` |

环境变量 `STO_MEMORY_CENTER_BASE_URL` 可覆盖上述映射。鉴权使用 `stotoken` + `Authorization: Bearer` 头。

---

## 6. 网络代理支持

**文件**: `electron/utils/proxy.ts`、`electron/main/proxy.ts`

支持 HTTP/HTTPS/ALL 三种代理服务器配置：

- 生成 Electron proxy config（`session.setProxy`）
- 生成环境变量（`HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 等）供子进程使用
- 用户可在 Settings > Gateway > Proxy 中配置代理服务器地址和绕过规则

---

## 7. 完整架构图

```
┌─────────────────────────────────────────────────────┐
│                  React Renderer                      │
│                                                      │
│  hostApiFetch('/api/xxx')                            │
│    └─ invokeIpc('hostapi:fetch') ───── IPC ──┐       │
│                                              │       │
│  invokeApi('gateway:rpc', method)            │       │
│    └─ invokeIpc('gateway:rpc') ───────── IPC ──┐     │
│                                                │     │
│  subscribeHostEvent('gateway:chat-message')    │     │
│    └─ ipcRenderer.on('gateway:chat-message') ◄─┼──┐  │
│    └─ EventSource('/api/events') [回退]        │  │  │
└────────────────────────────────────────────────┼──┼──┘
                                                 │  │
┌────────────────────────────────────────────────┼──┼──┐
│                Electron Main Process            │  │  │
│                                                │  │  │
│  hostapi:fetch handler ◄───────────────────────┘  │  │
│    └─ proxyAwareFetch('http://127.0.0.1:3210/...') │  │
│         └─ Host API Server (同进程内嵌)           │  │
│                                                    │  │
│  gateway:httpProxy handler ◄───────────────────────┘  │
│    └─ proxyAwareFetch('http://127.0.0.1:18789/...')   │
│                                                      │
│  Gateway WebSocket 连接 ◄── ws://127.0.0.1:18789/ws  │
│    └─ webContents.send('gateway:chat-message', ...) ──┘
│
│  STO API 调用
│    └─ proxyAwareFetch('https://baseinfo-aimemory.sto.cn/...')
└──────────────────────────────────────────────────────┘
                                    │                    │
                                    ▼                    ▼
                             OpenClaw Gateway      远程 STO 后端
                             127.0.0.1:18789       baseinfo-aimemory.sto.cn
```

---

## 关键文件索引

| 文件 | 角色 |
|------|------|
| `src/lib/host-api.ts` | 渲染进程 Host API 客户端 |
| `src/lib/api-client.ts` | 渲染进程多传输层 API 客户端 |
| `src/lib/host-events.ts` | SSE / IPC 事件订阅层 |
| `src/stores/gateway.ts` | Gateway 状态管理 + 事件去重 |
| `electron/api/server.ts` | **Host API HTTP 服务器**（主进程内嵌，监听 3210 端口） |
| `electron/api/routes/*.ts` | Host API 各业务路由处理器 |
| `electron/api/context.ts` | Host API 上下文（注入 GatewayManager 等服务） |
| `electron/main/ipc/host-api-proxy.ts` | 主进程 Host API IPC 代理处理器 |
| `electron/main/ipc-handlers.ts` | 主进程全部 IPC 处理器注册 |
| `electron/preload/index.ts` | Preload 安全白名单 + contextBridge |
| `electron/utils/proxy-fetch.ts` | 代理感知的 HTTP fetch 封装 |
| `electron/utils/proxy.ts` | 代理设置解析 |
| `electron/main/proxy.ts` | Electron session 代理应用 |
| `electron/utils/sto-domain.ts` | 远程 STO 后端 URL 解析 |

---

## 8. Host API Server 详解

### 8.1 服务本质

Host API **不是外部 Java 服务**，而是 Electron 主进程内嵌的 Node.js HTTP 服务器。它使用 `node:http` 模块的 `createServer()` 创建，监听 `127.0.0.1:3210`。

**文件**: `electron/api/server.ts`

```ts
// 主进程启动时创建并监听
const server = createServer(async (req, res) => {
  for (const handler of routeHandlers) {
    if (await handler(req, res, requestUrl, ctx)) return;
  }
  sendJson(res, 404, { success: false, error: 'No route' });
});
server.listen(port, '127.0.0.1');
```

在 `electron/main/index.ts` 的窗口创建流程中启动：

```ts
hostApiServer = startHostApiServer({
  gatewayManager, clawHubService, stoSkillService,
  skillPlazaService, eventBus, mainWindow,
});
```

### 8.2 为什么主进程要 HTTP 请求自己

渲染进程的 IPC 调用到达主进程后，`hostapi:fetch` handler 通过 `proxyAwareFetch()` 向 `127.0.0.1:3210` 发起 HTTP 请求——这实际上是主进程请求自己内嵌的服务器。这样设计的好处：

- **统一接口**：渲染进程、浏览器回退模式、甚至外部工具都可通过标准 HTTP 访问同一套 API
- **关注点分离**：路由处理逻辑（`electron/api/routes/`）与 IPC 通信层解耦，独立演进
- **SSE 支持**：HTTP 服务器天然支持 `/api/events` 的 Server-Sent Events 推送
- **企业代理兼容**：通过 `proxyAwareFetch` 确保请求遵守企业代理设置

### 8.3 路由模块

| 路由文件 | API 路径 | 功能 |
|---------|---------|------|
| `routes/auth.ts` | `/api/auth/*` | SSO 登录/登出、环境信息 |
| `routes/settings.ts` | `/api/settings/*` | 应用设置持久化（主题、语言、自启动等） |
| `routes/gateway.ts` | `/api/gateway/*` | Gateway 进程控制 |
| `routes/providers.ts` | `/api/providers/*` | AI 提供商 OAuth 授权 |
| `routes/agents.ts` | `/api/agents` | Agent 列表管理 |
| `routes/channels.ts` | `/api/channels/*` | 渠道账号管理与绑定 |
| `routes/skills.ts` | `/api/sto-skills/*` | 技能安装 |
| `routes/skill-plaza.ts` | `/api/skill-plaza/*`、`/api/clawhub/*` | 技能市场 |
| `routes/sessions.ts` | `/api/sessions/*` | 会话模型配置 |
| `routes/cron.ts` | `/api/cron/*` | 定时任务管理 |
| `routes/scheduled-tasks.ts` | `/api/scheduled-tasks/*` | 计划任务 |
| `routes/files.ts` | `/api/files/*` | 文件读取 |
| `routes/logs.ts` | `/api/logs*` | 日志查看 |
| `routes/usage.ts` | `/api/usage/*` | Token 用量统计 |
| `routes/token-quota.ts` | `/api/token-quota/*` | Token 配额检查 |
| `routes/app.ts` | `/api/app/*` | 应用诊断 |
| `routes/sto-sync.ts` | `/api/sto-model-sync` | 远程模型同步 |
| `routes/subscriptions.ts` | `/api/subscriptions/*` | 订阅管理 |

---

## 9. FAQ

### 9.1 为什么在 Electron Chrome DevTools Network 面板看不到网络请求？

是的，几乎所有请求都不会出现在 DevTools Network 面板中，原因是请求被「转移」出了渲染进程：

| 阶段 | 机制 | DevTools 可见性 |
|------|------|----------------|
| 渲染进程 → 主进程 | `invokeIpc('hostapi:fetch')` — Electron IPC 进程间通信 | **不可见**（不是 HTTP 请求） |
| 主进程 → Host API (3210) | `proxyAwareFetch()` — 主进程内发起 HTTP 请求 | **不可见**（发生在 Main Process，DevTools 只能看到 Renderer 的网络） |
| 主进程 → Gateway (18789) | WebSocket 长连接 + HTTP 代理 | **不可见**（同上） |

> **调试提示**：若需观察实际网络请求，可在 Main Process 日志中查看 `proxyAwareFetch` 输出，或使用 `localStorage.setItem('stoclaw:allow-localhost-fallback', '1')` 让 `hostApiFetch` 回退为浏览器直接 `fetch()`（仅限开发环境）。

### 9.2 Gateway（18789）的核心职责是什么？

Gateway（OpenClaw）是 **独立的 AI Agent 运行时引擎**，作为 Electron 子进程启动，不属于 StoClaw 代码库本身。其核心职责：

| 职责 | 说明 |
|------|------|
| **AI 对话收发** | 每条消息最终通过 `gatewayManager.rpc('chat.send', ...)` 送达 AI 模型，模型流式响应后通过 WebSocket 推送事件 |
| **会话生命周期管理** | 创建/切换/删除会话（`session.create`、`session.switch`、`session.delete`） |
| **工具执行** | AI 调用工具（代码执行、文件操作、搜索等）时，由 Gateway 在沙箱中实际执行 |
| **实时事件源** | 所有 `gateway:chat-message`、`gateway:notification` 等事件均源自 Gateway，经 WebSocket → Main Process → IPC → Renderer 链路推送 |
| **插件系统** | 支持 `sto-plugin/` 下的插件（遥测、定时任务、技能监控等） |

### 9.3 为什么不把所有服务合并到 18789，要分 Host API + Gateway 两层？

这不是技术偏好，而是**两者本质上是两个独立产品**：

| 维度 | Host API (3210) | Gateway / OpenClaw (18789) |
|------|----------------|----------------------------|
| **归属** | StoClaw 团队自研业务层 | 独立产品，StoClaw 集成使用 |
| **代码位置** | `electron/api/` 目录内 | 独立代码库，通过 `utilityProcess.fork()` 作为子进程启动 |
| **安装方式** | 随 StoClaw 打包 | 可独立安装（`~/.local/bin/openclaw`），有自己的 CLI 和升级路径 |
| **职责边界** | SSO 认证、应用设置、技能市场、文件管理等桌面端业务 | AI 模型调用、会话管理、工具执行、插件运行时 |

**不能合并的具体原因**：

- **协议不兼容**：OpenClaw 有自己的 WebSocket 协议（`{ type: 'req/res', id, method, params }`）和认证机制（challenge/handshake），将 SSO、主题设置等业务塞进去需要修改 OpenClaw 源码
- **生命周期独立**：OpenClaw 可独立升级（`openclaw upgrade`）、独立诊断（`openclaw doctor`），甚至可被其他客户端复用
- **进程隔离 = 稳定性**：AI 运行时是重资源操作（模型调用、工具执行），若崩溃不影响 Host API 的认证/设置等功能
- **可替换性**：分层设计使 StoClaw 理论上可替换底层 AI 引擎，只需接口兼容

> **一句话总结**：Host API 是 StoClaw 自研的「桌面应用业务层」，Gateway 是集成的「AI 引擎」。StoClaw 的角色是用 Host API 处理桌面端业务需求，用 OpenClaw 提供 AI 能力，两者通过主进程粘合在一起。
