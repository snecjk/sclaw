## Context

当前应用广场（`/more-apps`）在页内用「应用广场 / 我的应用」两个内容 Tab；打开应用走 `openInSclawBrowser` → `MainLayout` 上的单会话抽屉 `<webview>`。侧边栏 `pointerdown` 会 `closeSclawBrowser()`，关闭即销毁 webview。收藏与外部应用已持久化在 `~/.stoclaw/more-apps/apps.json`。

产品确认（2026-07-24）：
1. 采用「应用广场壳 + 多页签工作区」方案（原方案 A）
2. 最多 5 个存活浏览器 webview；超出停掉最久未用；点回休眠页签重新加载
3. 离开应用广场：完全不可见，进程仍在
4. 同 URL 复用已有页签
5. 保留侧边 AI 聊天

## Goals / Non-Goals

**Goals:**
- Chrome 式页签：固定首页 + 可关浏览器页签 +「+」开空白浏览器
- 切换 claw 其它路由不中断应用使用；再进应用广场不重置页签状态（存活页签）
- URL 规范化后复用；收藏写入「我的应用」
- 硬上限 5 个存活 webview；休眠页签可点回并 reload
- 每浏览器页签可开侧边 AI 聊天（复用现有 embed chat 生命周期，按 appId / runtime 绑定）
- 页签 chrome 支持 light / dark，语义 token

**Non-Goals:**
- 不上 Electron `BrowserView` 主进程多视图架构
- 不做跨应用重启后的「上次页签完整恢复」（进程级 session 即可；不持久化打开中的 Tab 列表到磁盘）
- 不做完整 Chrome 特性：拖拽排序到系统窗口、扩展、下载管理器、多窗口
- 不把全 App 其它路由做成 KeepAlive
- 不改变 app-plaza 服务端目录 API 契约
- 第一期不强制改造「非广场入口」若仍调用旧 `openInSclawBrowser` 抽屉——优先让广场路径走多页签；其它入口可委托到同一壳或暂留抽屉（实现任务中二选一并写清）

## Decisions

### 1. 应用广场壳挂在 MainLayout，用可见性保活（非路由 KeepAlive 库）
- **Decision**: 在 `MainLayout`（或与 `Outlet` 同级）挂载 `AppPlazaShell`；当 `pathname === '/more-apps'` 时可见，否则 `hidden`（`display: none` / `invisible` + `aria-hidden`），**不卸载** React 树与已挂载 webview。`/more-apps` 的 `Route` 可渲染轻量占位或仅负责同步「壳应可见」。
- **Rationale**: 满足「完全不可见但进程仍在」；避免引入第三方 KeepAlive 与全路由缓存。
- **Alternative considered**: React Router 卸载 + Zustand 只存 URL 列表、回页重建 webview。Rejected：无法满足「不中断」与表单/登录态连续。

### 2. 页签模型：Home + BrowserTab[]，存活上限 5
- **Decision**:
  - `home` 页签：id 固定、不可关闭、渲染现有 `MoreAppsPage` 内容。
  - `browser` 页签：`{ id, url, title, appId?, status: 'live' | 'suspended' | 'blank', lastActiveAt, embedRuntimeId? }`。
  - **存活（live）** webview 数量 ≤ 5；`blank`（未提交 URL）不计入、不创建 webview。
  - 需要第 6 个 live 时：将 **最久未用（smallest lastActiveAt）且非当前激活** 的 live 页签置为 `suspended`：销毁其 webview、unregister runtime，保留 url/title/appId/chat 索引元数据。
  - 激活 `suspended` 页签：重新创建 webview 并 **navigate 到记录的 url（重新加载）**；若因此超过 5，再休眠其它。
- **Rationale**: 产品明确的性能闸门；休眠可保留页签栏入口且控制内存。
- **Alternative considered**: 硬禁止开第 6 个。Rejected：体验更差；休眠+重载更接近「停掉未使用的」。

### 3. 同 URL 复用
- **Decision**: 打开前对 URL 做规范化（trim、默认 https、去掉 hash 是否参与比较在实现里固定一种并单测；建议 **origin + pathname + search**，忽略 hash）。若已有 browser 页签匹配，则激活该页签（若 suspended 则按决策 2 重载）；否则新建。
- **Rationale**: 避免同一业务系统开多个重复 live webview。
- **Alternative considered**: 每次都新开。Rejected：与产品确认不符。

### 4. 收藏 → 我的应用
- **Decision**: 浏览器页签工具栏提供收藏控件。若 URL 对应目录应用且已在 `favoriteIds`，显示已收藏并可取消；若为任意 URL / 未安装外部应用，收藏时调用与「安装外部应用」等价的写入（`externalApps` + 必要时 `favoriteIds`），出现在「我的应用」。已存在同 URL 的 external 则切为已收藏态，不重复创建。
- **Rationale**: 复用 `MoreAppsRegistry`，不新造持久化格式。
- **Alternative considered**: 仅收藏目录 appId。Rejected：空白浏览器输入的网址也需要进「我的应用」。

### 5. 侧边 AI 聊天随页签，并区分「已关联应用」与「临时网址」会话生命周期
- **Decision**:
  - 每个 live browser 页签拥有独立 `embedRuntimeId`；聊天会话集合仍按 **应用身份 `appId`** 隔离（与现网一致：目录应用用广场 `appId`；已在「我的应用」的外部应用用其 registry id）。
  - **绑定应用（bound）**：来自广场卡片 / Banner / 我的应用，或用户已对该 URL **收藏成功** → 关闭页签、休眠、切 claw 路由均 **保留** 该 `appId` 下的 embed 会话集合（localStorage index + 引擎会话），下次同应用打开可继续。
  - **临时页签（ephemeral）**：空白页提交的自定义网址，且该 URL **尚未**进入「我的应用」（非 catalog id、非 external/favorite）→ 使用派生临时 `appId`（可继续 `deriveSclawBrowserAppId` 或 `ephemeral-<tabId>`）。对此类页签：
    - **用户关闭页签**（点 Tab 关闭，非休眠）：MUST **清除**该临时身份下全部侧边 AI 会话——删除 embed chat index、对每个 `sessionKey` 走现有 `deleteSession`（best-effort），并 unregister runtime。
    - **休眠 / 隐藏壳**：不清除会话（仅拆 webview）；点回重载页面后仍可继续同一临时会话集合，直到用户关闭页签或收藏。
    - **收藏成功**：将该页签升级为 bound（写入 external / favorite）；临时 `appId` 下的会话 MUST **迁移或改挂**到新的稳定 external `appId`（或收藏前就用稳定 id 创建），之后关闭页签不再清除。
    - **空白未导航**：不创建 webview，也不创建 embed 会话。
- **Rationale**: 广场关联应用需要长期独立会话集合；未保存的临时浏览不应留下孤儿会话与磁盘/引擎垃圾。
- **Alternative considered**:
  - 关闭临时页签时弹窗「是否保留对话」。Rejected：第一期增加摩擦；用户已用「收藏」表达保留意图。
  - 临时会话永不落盘。Rejected：与现有 embed 管道耦合大，且休眠重载后无法续聊。
  - 全局共用一个聊天面板。Rejected：多应用会串话。

### 6. 广场内废弃抽屉打开路径
- **Decision**: 在应用广场壳内，卡片/Banner/`openInSclawBrowser` 改为 `openOrFocusAppPlazaBrowserTab(...)`。侧边栏切换到其它一级导航时 **不再** 为了切路由而关闭多页签壳（仅隐藏）。若保留旧抽屉给非广场入口，须避免与壳双开同一 URL 的双 webview（优先委托进壳）。
- **Rationale**: 单一工作区，降低双轨状态。
- **Alternative considered**: 抽屉内做多页签（原方案 B）。Rejected：与「首页在壳内」割裂。

### 7. 主题
- **Decision**: 页签栏、地址栏、休眠标记、收藏按钮使用 `docs/sto-design.md` 语义色（背景/边框/文字/Brand 选中态）；禁止仅 light 的硬编码白底；dark 下选中页签与地址栏对比度可读。
- **Alternative considered**: 复刻系统 Chrome 原生色。Rejected：与 StoClaw 壳不一致。

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| [Risk] 5 个重页面仍占大量内存 | 硬上限 5；blank 不建 webview；文档提示；后续可加「一键休眠全部」 |
| [Risk] 休眠重载丢失页内未保存表单 | UI 标明休眠态；休眠前可选 toast「已暂停以节省内存」；接受与产品确认一致的 trade-off |
| [Risk] 隐藏壳内 webview 仍跑定时器/音视频 | 离开广场时可对非必要页签降指针事件；音视频扰民列为已知限制，必要时后续加真正 freeze API |
| [Risk] 侧边栏误关壳 / 双宿主 | 改 Sidebar：切路由只 set 壳 hidden，不 `close` 全部 tabs；单测覆盖 |
| [Risk] embed chat 与多 runtime 泄漏 | 休眠/关页签必须 unregisterRuntime；bound 仅 deactivate；ephemeral 关闭须 purge 会话集合 |
| [Risk] 临时 URL 派生 appId 与日后收藏 id 不一致导致会话「消失」 | 收藏时明确迁移规则：index keys / activeKey 改挂到 external id，或收藏前用将写入的 external id |
| [Risk] URL 规范化不一致导致复用不命中 | 单测固定 normalize 规则 |
| [Risk] 范围膨胀成完整浏览器 | Non-Goals 卡住；页签仅保留：关、+、地址栏、刷新/外开（沿用现有）、收藏、AI |

## Migration Plan

1. 落地 store + 壳挂载 + 首页页签（行为与现网广场一致）。
2. 接入 browser 页签与打开/复用/收藏；广场内切换打开路径。
3. 存活上限与 suspended 重载；侧边 AI 按页签绑定。
4. 侧边栏/路由保活；去掉「切导航就关浏览器」对壳的破坏。
5. 单测 + dark mode 目视；更新 README 中应用打开描述（如有）。
6. 回滚：恢复 `MoreAppsPage` 单路由渲染 + 单抽屉 `openInSclawBrowser`（feature 可用路由级开关或 revert change）。
