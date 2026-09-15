# 方案 B：Electron 瘦宿主 — 选型、架构、接口、仓库与发布


| 项    | 内容                                                         |
| ---- | ---------------------------------------------------------- |
| 状态   | 架构决策文档（尚未按本文落地拆进程）                                         |
| 产品   | SClaw 桌面端（本机安装器）                                           |
| 范围   | 本机宿主、Host API + SQLite、Claude / Pi Worker、OpenClaw Gateway |
| 不在范围 | 云端模型推理、SSO / memory-center / 配额等现有云服务；方案 C 的编译型助手          |


本文回答：为什么选 B；模块怎么切；瘦宿主如何与 Claude/Pi 直连（§5.4）以及相对 Gateway 的优势；对外接口；仓库、打包、更新。云端模型不进入本机拆分。

---

## 1. 结论

- **基座仍是 Electron**，作为 Chromium 发行版：窗口、webview、JSBridge、CDP、预览、自动更新都留在这份引擎上。
- **改的是进程边界**，不是换壳。主进程只保留浏览宿主；Claude、Host API、SQLite 按 Gateway / Pi 已有的 `utilityProcess` 模式外置。
- **Git 仓库仍是 1 个**（本仓）。自研单元 **4 个**：宿主、Host API、Claude Worker、Pi Worker。Gateway **不新建项目**，继续打现有 OpenClaw bundle。
- **发布单元仍是 1 份安装器**。sidecar 不单独发版、不上云、不绑 `0.0.0.0`。

---



## 2. 为什么选这个方案

对照过的方案：A 现状厚主进程；B 瘦宿主 + Node sidecar；C = B + 编译型系统进程；D 自研 CEF；E 系统 WebView（Tauri 等）；F GPU 原生壳 + 再嵌 Chromium。

等权七维（功能迁全、性能、稳定、安全补丁、三端一致、运维、主进程解耦）总分：B 34 > C 33 > A 28 > D 27 > F 22 > E 18。

B 胜出的可核对理由：

1. **功能迁全**要求同一份可锁定的 Blink（guest webview、partition、preload、CDP、Adaptive 预览）。Electron 已产品化这些能力（含签名、公证、electron-updater）。E 在 macOS 是 WebKit，迁不全。
2. **仓内已证明 Node sidecar 可行**：Gateway（`electron/gateway/process-launcher.ts`）、Pi（`electron/services/pi-runtime-service.ts`）走 `utilityProcess.fork`。Claude 仍在主进程 `require()`（`electron/utils/claude-agent-sdk-loader.ts`），Host API 与 `node:sqlite` 也在 `initialize()` 里进主进程。B 是把已验证模式扩到这两块，而不是换嵌入器。
3. **D / F** 不增加产品能力，却要自建 Chromium 嵌入层、更新列车和（F）双渲染栈。
4. **C** 相对 B 只多 Win32/看门狗一类系统胶水，功能与迁全无增益；本仓无自有 Rust/Go 代码。C 不是 B 的前置。

现状里必须改的耦合（否则 B 无意义）：


| 现象             | 证据                                                                       |
| -------------- | ------------------------------------------------------------------------ |
| Claude 与窗口同进程  | `claude-agent-sdk-loader.ts` 主进程 `require()`；注释写明为 CMS 探针不能 `import()`   |
| Host API 焊在主进程 | `api/server.ts` 约 43 条路由；`startHostApiServer` 在 `main.ts` `initialize()` |
| SQLite 焊在主进程   | `db/connection.ts` `initializeSqliteDatabase()`                          |
| IPC 面过大        | `ipc-handlers.ts` 约 3058 行                                               |


已做对、B 要保留的：Gateway / Pi / doctor 的 `utilityProcess`；`electron-builder.yml` 的 `npmRebuild: false`；宿主库用 `node:sqlite` 而不是 `better-sqlite3` 绑 Electron ABI；JSBridge / CDP 放在有 `webContents` 的进程。

---



## 3. 架构模块明细

全部跑在用户机器上，由瘦宿主拉起。不部署到云端。

```
渲染进程（工作台 UI）
        │  IPC（薄） / hostapi:fetch
        ▼
Electron 主进程（瘦宿主）──── 窗 / webview / JSBridge / CDP / 托盘 / 更新
        │
        ├── OpenClaw Gateway     utilityProcess   :18789
        ├── Claude Worker        utilityProcess   postMessage
        ├── Pi Worker            utilityProcess   postMessage（已有）
        └── Host API + SQLite    utilityProcess   127.0.0.1:3210
```


| 模块               | 进程                             | 技术                                                      | 负责                                                                                                 | 不负责                                            |
| ---------------- | ------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 宿主               | Electron 主进程 + Chromium 渲染/GPU | Electron 40                                             | 多窗、webview、partition、preload JSBridge、CDP、托盘、外观、代理、electron-updater、拉起/杀死 sidecar、把业务请求转到 Host API | Claude `query`、业务 HTTP、SQLite 读写、工作流编排、通道长连接   |
| 工作台 UI           | 渲染进程（从属于宿主应用）                  | 现有 React + Vite                                         | 页面与交互                                                                                              | 直接打开 SQLite、直接加载 Agent SDK                     |
| Host API         | 独立 Node 进程                     | 现有 `http.createServer`，优先 `utilityProcess`              | 现 `electron/api` 中不依赖 `webContents` 的路由；会话目录；工作流编排；技能/应用广场元数据；定时任务                                 | 系统 dialog、guest 注入、CDP observe/act（这些 RPC 回宿主） |
| SQLite           | 在 Host API 进程内                 | 继续 `node:sqlite` `DatabaseSync`                         | `stoclaw.sqlite` 唯一写者                                                                              | 不单独成进程、不成项目                                    |
| Claude Worker    | 独立 Node 进程                     | `@anthropic-ai/claude-agent-sdk` + 仿 Pi 的 `postMessage` | `query` / resume / 本引擎会话；CMS 探针改挂本进程                                                               | 窗口、CDP、目录库                                     |
| Pi Worker        | 已有独立 Node 进程                   | 现协议不变                                                   | Pi coding agent                                                                                    | 同 Claude                                       |
| OpenClaw Gateway | 已有独立 Node 进程                   | 现 bundle + `utilityProcess`                             | 插件、通道、技能、WS JSON-RPC（默认 `127.0.0.1:18789`）                                                         | 画 UI、嵌网页                                       |


**为什么宿主用 Electron**：产品契约绑定 Blink guest + CDP；发行版已含更新/公证。换 Tauri/CEF 是换引擎，不是 B。

**为什么 Host API / SQLite / Claude 用 Node 外置**：三者都是 Node 生态；Pi 已验证 `utilityProcess`；搬进程即可隔离崩溃与 GC，不必换语言。

**Gateway 为什么不新建项目**：它是上游 `openclaw` 的打包结果（`scripts/bundle-openclaw.mjs` + `after-pack.cjs` 写入 `openclaw.asar`），不是 SClaw 自研服务。

## 4. 代码仓库与目录



### 4.1 仓库


| 项   | 决定                                                           |
| --- | ------------------------------------------------------------ |
| Git | **1 个**：现 `sto-claw`                                         |
| 发布  | **1 个安装器**，sidecar 打进 `extraResources` / `utilityProcess` 入口 |
| 不上  | Host API、Claude Worker 各自一个 GitLab 项目；用户装多个应用                |


先按进程拆开跑稳，再收目录。禁止「先拆 4 个仓库再对协议」。

### 4.2 自研单元（4 个 package）+ 协议库

目标态（pnpm workspace，仍在本仓）：

```
sto-claw/
  apps/
    desktop-shell/          # 单元 1：Electron 主进程（瘦宿主）
    workbench-ui/           # 渲染进程代码；发布上从属于单元 1，不算第 5 个项目
  services/
    host-api/               # 单元 2：Host API + SQLite
    claude-worker/          # 单元 3
    pi-worker/              # 单元 4
  shared/                   # 协议与类型，无进程
  scripts/                  # 现有 bundle-openclaw / after-pack / 打包脚本
```

过渡期允许继续 `src/` + `electron/` 目录名，但 **import 边界必须先立住**：`desktop-shell` 不得引用 Claude SDK、不得直接打开 SQLite、不得注册业务 HTTP 路由。

Gateway 仍由现有脚本打进安装包，不出现在上面 4 个自研单元里。

### 4.3 门禁

`apps/desktop-shell` 新增代码只能依赖 Electron 与 `shared/`。评审拒绝：主进程 `import` Host API 仓库、`require('@anthropic-ai/claude-agent-sdk')`、`initializeSqliteDatabase()`。

---



## 5. 改造后的接口

原则：**渲染进程看到的路径尽量不变**；变的是对端进程和「必须碰 Chromium」的 RPC。

### 5.1 本机端口（保持）


| 服务               | 地址                                              | 改造后                  |
| ---------------- | ----------------------------------------------- | -------------------- |
| Host API         | `http://127.0.0.1:3210`（`PORTS.CLAWX_HOST_API`） | 进程从主进程迁走，**端口与路径不变** |
| OpenClaw Gateway | `127.0.0.1:18789`                               | 不变                   |
| 开发 UI            | Vite `5173`                                     | 不变                   |


只绑 loopback。禁止 Host API / Gateway 对局域网暴露。内部请求继续带 `x-sclaw-internal-request`（见 `electron/api/internal-request-auth.ts`）。

### 5.2 渲染进程 → 后端（尽量兼容）


| 通道                                                            | 现状                      | 改造后                                 |
| ------------------------------------------------------------- | ----------------------- | ----------------------------------- |
| `ipcRenderer.invoke('hostapi:fetch', { path, method, body })` | 主进程转发到本机 3210           | **保留**。主进程只做薄代理；3210 上是 Host API 进程 |
| 现有 `/api/*` 与 `/ai-memory/agent/v1/*`                         | `electron/api/routes/*` | **路径表不变**。纯业务路由随 Host API 搬家        |
| Gateway `gateway:rpc` / `gateway:status` 等                    | 主进程连 Gateway            | **保留**。宿主仍负责 Gateway 生命周期           |


`/ai-memory/agent/v1/*` 仍由 Host API 透传到 memory-center，规则见 `electron/api/server.ts` 文件头。云端模型 HTTP 不在本机拆分范围内，也不改为「每个 Worker 自己直连 UI」。

### 5.3 必须改到「宿主 RPC」的接口

下列能力依赖 `webContents` / `dialog` / `session`，**不能**随 Host API 整段搬家。Host API 或 Worker 调用宿主提供的本机 RPC（名称可落在 `shared/`，由主进程实现）：


| 能力               | 现状大致位置                                                             | 改造后                         |
| ---------------- | ------------------------------------------------------------------ | --------------------------- |
| 浏览器自动化 CDP       | `electron/services/browser-automation/*`、`/api/browser-automation` | HTTP 可仍由 Host API 接收，执行落到宿主 |
| JSBridge / embed | `electron/main/services/jsbridge/*`、`sclaw-embed-browser-*`        | 留在宿主                        |
| 系统对话框 / 授权本地文件   | `dialog-handlers`、`/api/local-authorized-files`                    | 宿主选路径，结果回 Host API 写库       |
| session 代理、外观、更新 | `electron/main/proxy.ts`、`appearance.ts`、`updater.ts`              | 留在宿主                        |


工作流编排在 Host API；执行到「操作内嵌页」时走上述宿主 RPC，禁止 Host API 进程 `import 'electron'`。

### 5.4 瘦宿主与 Agent 直连（完整方案）

这里的 Agent 指 **Claude Agent SDK** 与 **Pi coding agent**，不是 OpenClaw Gateway。二者与瘦宿主 **直连**，不经过 `127.0.0.1:18789`。OpenClaw 会话仍走 Gateway。三者并列，互不为总线。

Pi **已经是这套模型**（`electron/services/pi-runtime-service.ts` + `electron/pi-runtime/worker-entry.ts`）。Claude 今天仍在主进程 `require()` SDK；B 的改造就是把 Claude 做成第二个同类 Worker。

#### 5.4.1 原理

Electron `utilityProcess.fork(入口脚本)` 拉起一个 **没有窗口、只有 Node** 的子进程。父子通过 Chromium 内置 IPC 交换结构化克隆消息（`child.postMessage` / `process.parentPort`），**不占用本机端口、不走 WebSocket、不经过 OpenClaw 协议**。

```
渲染进程
  │  现有 chat / engine IPC
  ▼
瘦宿主主进程（只做：fork、转发、重启、把网页能力 RPC 给自己）
  │
  ├─ utilityProcess.fork(pi-runtime/worker-entry.js)
  │     postMessage  ←→  Pi Worker
  │                     进程内跑 @earendil-works/pi-coding-agent
  │
  └─ utilityProcess.fork(claude-worker/worker-entry.js)   ← 新
        postMessage  ←→  Claude Worker
                        进程内跑 @anthropic-ai/claude-agent-sdk
                        AgentLoop 探针在本进程 require 注册
```

一次用户发消息：

1. 主进程若尚未 fork 对应 Worker，则 fork，等到 `runtime.ready`（Pi 现状超时 10s）。
2. `engines/manager` 按会话 `engineType` 选 `piAdapter` 或 `claudeAdapter`。
3. adapter 发 `{ requestId, command: 'session.prompt', sessionKey, payload }`。
4. Worker 在子进程跑 SDK；流式结果以 `{ type: 'engine.event', event }` 推回（事件形状对齐现有 `NormalizedEngineEvent`）。
5. 主进程把事件转给 UI（以及 Host API 需要落库的一侧）。
6. 若本轮要操作内嵌页 / 系统对话框：Worker **禁止** `import 'electron'`，只发「宿主 RPC」，由主进程碰 `webContents` / `dialog`。

两个 Worker **互不相通**。失败、超时、进程退出时，主进程按 `requestId` reject 进行中的请求（Pi 已有 `rejectAll`），窗口进程继续活着。

#### 5.4.2 协议面

| | Pi（已有，不改命令表） | Claude（新，对齐 Pi） |
| --- | --- | --- |
| 协议文件 | `shared/pi-runtime-protocol.ts` | 建议 `shared/claude-runtime-protocol.ts` |
| 传输 | `utilityProcess` `postMessage` | 同左 |
| 命令 | `runtime.initialize` / `shutdown`；`session.open` / `prompt` / `abort` / `history` / `inspect` / `contextUsage` / `compact` / `delete` | 至少：`runtime.initialize` / `shutdown`；`session.prompt` / `abort` / `history` / `delete` |
| 下行 | `runtime.ready` / `runtime.failed`；`response`；`engine.event` | 同形状 |
| 主进程客户端 | `PiRuntimeService.request()` | 对等的 `ClaudeRuntimeService`；`claude-adapter.ts` 改为调它，删除主进程 `loadClaudeAgentSdk()` |

不要合成一个 package：两个 SDK 依赖面不同，合成会导致两边互相拖包。

#### 5.4.3 监督器（必须比现在的 Pi 更完整，但远小于 Gateway）

直连稳的是传输，不稳的是「Worker 挂了怎么办」。Claude 外置时监督器最低集：

| 项 | 要求 | 不要学 Gateway 的 |
| --- | --- | --- |
| 入口 | 打包后入口在 asar 外，或先拷到 `userData` 再 `--require`（Pi 已证明：asar 路径 `--require` 在 Windows Electron 40 会杀掉**整个应用**） | 不要再套一层本机端口探测 |
| ready | 等 `runtime.ready`，超时失败可重 fork | 不要用「TCP 连上就算 ready」 |
| 退出 | `exit` → reject 进行中请求 → 有限次重启（指数退避 + 上限） | 不要 `openclaw doctor --fix`、不要配置 schema 自动修 |
| 单点 | 默认每引擎 **一个** Worker 进程（与现 Pi 相同） | 不要多开端口、不要抢 18789 |
| 日志 | stdout/stderr 接到主日志，带 `[pi-worker]` / `[claude-worker]` | 不要把 OpenClaw 插件加载噪声混进来 |
| 关停 | 应用 `will-quit` 先 `runtime.shutdown` 再 `kill`（主进程已对 Pi 这样做） | |

Gateway 现有的孤儿 pidfile、`.jsonl.lock` 清理、Python/uv 预热、challenge 握手，**不**搬到 Claude/Pi。那些是 OpenClaw 守护进程的问题。

#### 5.4.4 对比现在的 Gateway 链路：优势在哪

Gateway 现状（OpenClaw 专用，**保留**）：主进程 `utilityProcess.fork(openclaw.mjs)` → 再在 `ws://127.0.0.1:18789` 上做 JSON-RPC 与 `connect.challenge` 握手。启动失败常见原因：配置非法、进程秒退、握手超时、`ECONNREFUSED`、孤儿占端口导致第二实例、Windows 会话锁、Python 未就绪。这些与「父子 IPC」无关。

若让 Claude/Pi **也**经 Gateway 连宿主，等于把 SDK 稳定性绑到上述最重、最常起不来的那一层。直连是针对性避开这些：

| 维度 | 经 Gateway（仅 OpenClaw；不用于 Claude/Pi） | 瘦宿主直连 Worker |
| --- | --- | --- |
| 启动面 | 端口、已有进程探测、challenge、doctor、锁文件、插件/通道/Python | fork + `runtime.ready`。无端口，无握手 |
| 失败爆炸半径 | Gateway 起不来 → 所有走它的会话不可用 | Claude 挂了 Pi/OpenClaw 仍可用；Worker 崩默认不带走窗口 |
| 故障模式 | 守护进程级（配置 schema、插件、孤儿双开） | SDK 进程级（OOM、query 抛错、Worker 退出） |
| 传输 | 本机 WebSocket，有半开、重连、token mismatch | 同应用内 `postMessage`，无 TCP |
| 协议 | OpenClaw JSON-RPC，要兼容上游 | SClaw 自有 request/event，跟 adapter 走 |
| 实现存量 | `GatewayManager` 上千行生命周期 | Pi 已跑通；Claude 抄同一客户端 |

决策句：Gateway 是 OpenClaw 的产品运行时，不是 SClaw 的 Agent 总线。Claude/Pi 直连后，OpenClaw 启动失败不再误伤另外两套引擎；窗口也不再与 Claude SDK 同生共死。代价是每引擎一个小监督器（ready/退出/重启），比再包一层 18789 握手便宜，也比 Claude 留在主进程安全。

**不把 Gateway 改成 postMessage：** OpenClaw 上游就是 WS JSON-RPC 守护进程，强行改传输等于分叉上游。B 只规定：OpenClaw 继续 Gateway；Claude/Pi 用直连。

#### 5.4.5 UI 与 Host API 怎么接到这条链

- 渲染进程 **不** 直连 Worker，仍只跟瘦宿主 IPC。
- 会话发送走现有 engine adapter；adapter 在主进程内改为 `*RuntimeService.request`。
- Host API 编排工作流时：Pi 已有 `agent-runner-pi` 调 `getPiRuntimeService()`；Host API 迁出独立进程后 **不要** 自己 fork Worker，应 RPC 回瘦宿主再转发到已有 Worker（保证每引擎一个进程，网页 RPC 仍打到有 `webContents` 的进程）。
- 探针：Claude 的 `@loongsuite/cms_node_sdk` 在 **Claude Worker 入口** 同步 `require`，不再绑 Electron 主进程。

### 5.5 Host API 进程启动契约（新）

宿主拉起 Host API 时注入：

- `SCLAW_HOST_API_PORT`（默认 3210）
- 用户数据目录 / SQLite 路径（与现 `getDataDir()` 一致，避免两套库）
- 内部请求 secret（现进程内随机数改为启动时下发，主进程与 Host API 共享）
- Gateway 端口、OpenClaw 配置目录

宿主启动顺序：SQLite/Host API ready → 再接受 `hostapi:fetch`；Gateway / Pi / Claude 可并行，失败不得拖死窗口。

健康检查（建议）：`GET http://127.0.0.1:3210/api/app/health`（若已有等价路由则复用，不新开公网含义的 health）。

### 5.6 明确不增加的接口

- 不为 sidecar 做独立 REST 云端 API。
- 不为 Claude/Pi/Gateway 做独立自动更新通道。
- 不把 Host API 改成可从浏览器直连的局域网服务。

---



## 6. 如何打包



### 6.1 原则

与今天一样：**一次构建 → 一份 Electron 制品**。sidecar 是包内文件，不是五个安装包。

版本号仍是根 `package.json` 的 `version`（如 `2026.9.10-GA.1`）。四个自研单元与 Gateway bundle **同版本发布**，不搞 sidecar 独立 semver。

### 6.2 制品内布局（目标）

```
SClaw.app / SClaw.exe
  Chromium + 瘦宿主（app.asar：shell + renderer）
  extraResources/
    host-api/                 # Host API 入口 + 其 node_modules 子集
    claude-worker/
    pi-worker/                # 现 Pi 子进程打包结果
    openclaw.asar             # 现 afterPack 产物
    resources/preinstalled-skills/
    bin/                      # uv / 平台二进制（现 resources/bin）
    browser-extension/
```

OpenClaw 原生模块继续 **不要** 被 `@electron/rebuild` 处理（保持 `npmRebuild: false`）。Claude SDK 的平台 CLI 继续 `asarUnpack`（现 `electron-builder.yml` 已对 `claude-agent-sdk-`* 解包）；迁到 worker 后，unpack 范围跟着 worker 包走，不要再打进主进程 asar。

### 6.3 构建流水（在现有脚本上加 sidecar）

现有顺序（见 `package.json` / `docs/WINDOWS_BUILD_PROCESS.md`）保留，插入 sidecar 打包步：

1. `rebuild:native:electron`（仅当瘦宿主仍有必须的原生模块；目标是宿主 **零** `.node`）
2. `dws:manifest`、`bundle:gateway-preload`、`sync:plugin-shared`
3. `vite:build`（工作台 UI）
4. 编译 `desktop-shell`、`host-api`、`claude-worker`、`pi-worker`
5. `bundle-openclaw.mjs` + `bundle-openclaw-plugins.mjs` + `bundle-preinstalled-skills.mjs`
6. 平台二进制：`uv:download:*`、Windows 另走 `prep:win-binaries`
7. `electron-builder`（`electron-builder.config.js`）

命令入口保持现名，避免发布手册分叉：

```bash
pnpm run package:mac          # 生产 macOS
pnpm run package:win          # 生产 Windows NSIS + zip
pnpm run package:linux
pnpm run package:mac:test     # BUILD_ENV=test
pnpm run package:mac:staging
```

`electron-builder.yml` 的 `extraResources` 增加 host-api / worker 目录；`afterPack` 继续物化 `openclaw.asar`。

### 6.4 开发模式

`pnpm dev`：Vite 加载 UI；Electron 主进程拉起 Host API / Claude / Pi / Gateway 子进程（可用 tsx/watch）。禁止开发时把 Claude SDK 链回主进程「图省事」。

---



## 7. 如何发布与更新



### 7.1 仍是整包更新

用户只更新 **SClaw 客户端**。Host API、Worker、Gateway 随安装包替换，**没有** 独立 sidecar 热更新。原因：协议、SQLite schema、Electron ABI、OpenClaw 插件必须同一提交；拆通道会让灰度和回滚无法对齐。

### 7.2 现有发版通道（保持）

`electron-builder.yml`：

- 主：OSS generic  
`https://ali-sto-wisdom-star.oss-cn-shanghai.aliyuncs.com/stoclaw/releases/latest`
- 备：GitHub Releases（`ValueCell-ai/StoClaw`）

客户端：`electron-updater`（`electron/main/updater.ts`）。已登录且有 `stoToken` 时，经 memory-center `POST /api/v1/client-updates/resolve` 做灰度 / 分群；否则回落到内置 OSS。产品名 `sto-claw`。检查间隔默认 6 小时。

环境与产物后缀（现逻辑）：


| `BUILD_ENV` / `VITE_APP_ENV` | 产物名后缀      | 用途  |
| ---------------------------- | ---------- | --- |
| production（默认）               | 无          | 生产  |
| test                         | `-test`    | 测试  |
| staging                      | `-staging` | 预发  |




### 7.3 发布步骤（改造后与现在同一套人操作）

1. 主仓打版本（现有 `version:*` 或发版流程约定的 tag）。
2. CI 或打包机执行对应 `package:mac` / `package:win` / `package:linux`（或 `package:all`）。
3. 将 `release/` 下安装包与 `latest.yml` / `latest-mac.yml` 等 **整包** 上传 OSS 对应 channel（及需要时的 GitHub Releases）。
4. 在 memory-center 配置该版本的 `client-updates` 策略（全量 / 灰度）。不在 Host API 上做第二套更新服务。
5. 客户端按现有 Updater 检查、下载、安装、重启。macOS 保留现有 bundle 改名/旧版清理逻辑。

`pnpm run release` 仍表示「打包并以 electron-builder `publish always` 推送」，不要改成发布四个 npm 包。

### 7.4 回滚

回滚 = 把 OSS `latest` 指回上一份 **完整安装器**，或在 resolve 策略里停掉该版本。不能只回滚 Host API 而保留新 Worker。

SQLite 迁移仍在 Host API 进程启动时执行（现 `runDatabaseMigrations`）。发版前保证迁移可前进；不支持跨版本只换 sidecar 文件。

---



## 8. 落地顺序（进程先于目录）


| 阶段  | 内容                                              | 完成判据                                     |
| --- | ----------------------------------------------- | ---------------------------------------- |
| 1   | Claude 外置，协议仿 Pi；探针挂 worker                     | 主进程不再 `require` Claude SDK；杀 Worker 窗口仍在 |
| 2   | Host API + SQLite 迁独立进程；`hostapi:fetch` 仍走 3210 | 主进程启动不再 `initializeSqliteDatabase`       |
| 3   | 浏览器/JSBridge/dialog 定为宿主 RPC；工作流编排在 Host API    | Host API 进程无 `from 'electron'`           |
| 4   | 目录收成 4 个 package；shell 门禁进 CI                   | import 边界测试失败即红                          |
| 5   | extraResources + 安装器验证三端                        | 仍走现有 OSS / resolve 更新                    |


不要先拆 Git 仓库。不要先上 Rust 助手。

---



## 9. 相关代码（现状索引）


| 主题            | 路径                                                                            |
| ------------- | ----------------------------------------------------------------------------- |
| 主进程启动         | `electron/main/main.ts`                                                       |
| Host API      | `electron/api/server.ts`                                                      |
| SQLite        | `electron/db/connection.ts`                                                   |
| Gateway 拉起    | `electron/gateway/process-launcher.ts`                                        |
| Pi Worker     | `electron/services/pi-runtime-service.ts`、`shared/pi-runtime-protocol.ts`     |
| Claude 加载     | `electron/utils/claude-agent-sdk-loader.ts`                                   |
| UI 调 Host API | `electron/main/ipc/host-api-proxy.ts`、preload `hostapi:fetch`                 |
| 打包            | `electron-builder.yml`、`package.json` scripts、`docs/WINDOWS_BUILD_PROCESS.md` |
| 更新            | `electron/main/updater.ts`、`electron/services/client-update-platform.ts`      |


