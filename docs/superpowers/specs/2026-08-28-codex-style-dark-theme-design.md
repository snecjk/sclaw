# Codex 风格暗色主题升级设计

日期：2026-08-28  
状态：待实现  
范围：仅升级暗色主题；浅色主题的视觉表现保持不变

## 背景

SClaw 已有 `light | dark | system` 设置、Tailwind `dark` class、全局 CSS 变量和 L0/L1/L2 Surface 分层，但暗色实现仍处于“全局 token + 页面局部补丁”并存状态。主应用中的硬编码浅色、iframe 的样式隔离，以及主窗口/浮窗各自重复解析主题，导致暗色模式在不同场景中不一致。

本次设计以本机 Codex 桌面端实际样式为参照，采用中性灰阶和低对比交互面，同时保留 SClaw 橙色品牌。用户明确要求浅色视觉不变，因此迁移方式必须让现有浅色值继续作为语义 token 的 light 映射，只重构 dark 映射和暗色消费方式。

## 已确认的问题

### 1. 生成 HTML 表格在暗色预览中失配

`FilePreviewViewer` 的远程 HTML 通过 `RemoteSrcDocPreview` 和 `preparePreviewSrcDoc()` 写入独立 iframe。目前注入逻辑只有 `<base>` 和 HTTP fetch bridge，没有主题标记、主题变量或主题同步协议。iframe 不继承父文档的 `.dark` class，生成 HTML 自身的白色表格单元格因此保留在暗色容器中；若文档文字已响应系统暗色，则会进一步形成浅色文字叠在白色单元格上的不可读状态。

同类风险还存在于：

- `HtmlIframeView` 直接加载的 HTML；
- Word 的 Mammoth HTML 兜底，其壳样式写死 `#fff / #333 / #f4f4f4`；
- 工作流预览面板，其背景、卡片和文字使用成组浅色十六进制值；
- PPT/Office 预览。这里“纸张/幻灯片白底”有内容保真含义，不能像普通应用 Surface 一样无条件反色。

### 2. 技能广场控件对比度过高

截图中的白色搜索框、文件夹按钮、上传按钮、排序按钮、分类选中胶囊和技能图标底均可在源码中对应到硬编码值：

- `SkillPlazaHeader.tsx`：`bg-white`、`text-[#1D2129]`、`hover:bg-[#F2F3F5]`；
- `SkillPlazaCategoryNav.tsx`：分类选中 `#E5E6EB`，排序/视图按钮 `bg-white`；
- `SkillIcon.tsx`：图标容器固定 `bg-white`，没有暗色映射；
- `SkillCard.tsx`：卡片、操作图标和局部标签继续混用硬编码浅色与页面级 `dark:` 修补。

这些控件没有统一消费“暗色交互 Surface”，因此和“我的任务”页已经形成的低对比控件语言不一致。

### 3. 主题机制不完整

- `App.tsx`、`Sprite`、`FloatIcon` 分别修改根节点 class，逻辑重复；
- `system` 在部分入口只读取一次 `matchMedia`，系统主题运行中切换时不会全部同步；
- renderer 设置同时存在 Zustand/localStorage 与 Main store 两套持久化路径；
- Electron `nativeTheme` 和窗口 `backgroundColor` 未跟随解析后的主题；
- iframe/webview 没有统一的主题边界协议。

## 目标与非目标

### 目标

1. 暗色视觉接近 Codex：中性黑灰、有限层级、弱边框、低对比控件，避免大量纯白小块。
2. 浅色主题在本次升级前后保持视觉一致，包括颜色、层级和主要交互状态。
3. 建立单一的主题解析和同步机制，覆盖主窗口、Sprite、FloatIcon、系统主题变化和可控 iframe。
4. 修复用户截图中的 HTML 表格和技能广场问题，并用静态审计覆盖相同根因的未知场景。
5. 把暗色映射集中到语义 token/共享 Surface，减少页面级 `dark:` 特例。

### 非目标

- 不改 SClaw 的橙色品牌主色；
- 不重做页面布局、字号、间距或浅色设计；
- 不对照片、PPT 幻灯片、Word 纸张等内容保真型预览做全局反色；
- 不修改依赖、lockfile、构建脚本或工程配置；
- 不在本次工作中清理所有与主题无关的历史样式。

## 暗色语义映射

暗色采用 Codex 的中性灰阶关系，具体映射如下：

| 语义角色 | 暗色值 | 使用场景 |
| --- | --- | --- |
| Window / Underlay | `#0d0d0d` | 窗口底、最外层壳、深层背景 |
| Primary Surface | `#181818` | 主工作区、页面承载面 |
| Secondary Surface | `#212121` | 卡片、输入框、编辑器、常规控件 |
| Elevated Surface | `#282828` | 菜单、Popover、浮层、选中控件 |
| Primary Text | `#dfdfdf` | 标题与正文，不使用纯白作为常规正文 |
| Secondary Text | `rgba(255,255,255,.70)` | 描述、辅助信息 |
| Tertiary Text | `rgba(255,255,255,.50)` | 占位、禁用、弱提示 |
| Border Light | `rgba(255,255,255,.04)` | 大 Surface 的最弱分隔 |
| Border Default | `rgba(255,255,255,.08)` | 控件、卡片常规描边 |
| Border Heavy | `rgba(255,255,255,.16)` | 聚焦、强调边界 |

现有 `--background`、`--card`、`--popover`、`--muted`、`--border` 继续作为兼容别名，但在暗色中统一指向新语义层。现有 `--sto-shell-bg`、`--sto-workspace-bg`、`--sto-panel-bg` 也映射到同一套 Surface 所有权。`:root` 的浅色值不改变，仅新增别名指向现有浅色 token。

建议新增的角色：

- `--sto-surface-under`
- `--sto-surface-primary`
- `--sto-surface-secondary`
- `--sto-surface-elevated`
- `--sto-control-bg`
- `--sto-control-hover-bg`
- `--sto-control-active-bg`
- `--sto-text-primary`
- `--sto-text-secondary`
- `--sto-text-tertiary`
- `--sto-border-light`
- `--sto-border-default`
- `--sto-border-heavy`

主按钮仍使用橙色品牌。中性按钮、搜索框、图标底、分段选择、排序按钮统一使用 `control` 角色；暗色不再使用 `bg-white` 或高比例 `white/*` 作为常态底色。

## 主题控制架构

新增单一 `ThemeController`，由主应用和独立窗口入口共同使用。

职责：

1. 从设置中读取用户偏好 `light | dark | system`；
2. 解析得到唯一的 `resolvedAppearance: light | dark`；
3. 在 `<html>` 同步 class、`data-theme` 和 `color-scheme`；
4. 当偏好为 `system` 时订阅 `prefers-color-scheme` 的 `change` 事件；
5. 通过现有 Host API 边界通知 Main，使 Electron `nativeTheme.themeSource` 和窗口原生背景跟随主题；
6. 广播解析后的主题给受控 iframe，不让各页面自行解释主题。

持久化仍以现有设置接口为入口；本次不引入新的 renderer 直连 IPC。Main store 是跨窗口事实来源，renderer 的持久化数据只作为启动/不可达时的兼容缓存。迁移期间保留旧字段，避免升级后用户设置丢失。

## HTML 与文档预览主题边界

预览必须区分“应用型生成 HTML”和“内容保真文档”。

### 应用型生成 HTML

`preparePreviewSrcDoc()` 接收解析后的主题，并向 `<head>` 注入：

- `data-sto-theme` / `color-scheme`；
- 与主应用同源的文本、Surface、边框、控件变量；
- 主题消息 bridge，响应父窗口运行时切换；
- 最小兼容样式，覆盖常见的 `body / table / th / td / input / button / code / blockquote` 浅色硬编码。

兼容样式只作用于标记为 `adaptive` 的生成 HTML。表格在暗色下应使用 Secondary Surface、Default Border、Primary/Secondary Text，不再保留白色单元格。

### 内容保真预览

PPT 幻灯片、Word 页面、图片和明确要求保持原稿颜色的 HTML 使用 `fidelity` 模式：外部画布可暗色化，但文档纸张/幻灯片本体不反色。这样避免把白纸文档误改成应用界面。

直接 `src` 的跨域 iframe 无法安全注入 CSS，仅设置 iframe 自身 `color-scheme`；只有受控同源页面才通过 `postMessage` 接收主题。

## 页面与组件迁移

### P0：用户已复现

- HTML 生成内容与表格预览；
- 技能广场 Header、分类导航、排序/视图按钮、卡片、技能图标、上传弹窗；
- 共享 Button/Input/Tabs/Dropdown 的暗色中性状态。

图二中的白色控件统一为图三的低对比语言：Secondary/Transparent Surface + Default Border；hover 抬升一级；active 使用 Elevated Surface。图标底不再使用纯白。

### P1：同根因高风险场景

- 工作流预览和工作流设计器中的只写浅色卡片；
- Word Mammoth 兜底、Excel/Markdown/Text 预览外壳；
- Confirm/Dialog/Sheet/Popover/Dropdown/Tooltip/Toast；
- 文件选择器、参数表单、快捷输入、连接器和渠道配置弹窗；
- 空状态、Skeleton、滚动条、搜索框和排序触发器。

### P2：内容保真与状态色复核

- PPT/Word 高保真纸张边界；
- 图表、代码高亮、成功/警告/错误标签；
- 登录/Setup、Sprite、FloatIcon 和原生窗口闪屏背景；
- 应用市场嵌入页、外部/跨域内容的主题降级表现。

迁移不以“给每个 `bg-white` 加 `dark:`”为完成标准。共享角色应先进入 token 和 `surfaces.ts`，页面消费共享角色；仅内容保真或状态色允许保留局部显式颜色。

## 审计规则

增加针对暗色反模式的静态测试/检查：

1. 交互组件中新增 `bg-white`、`text-[#1D2129]`、`hover:bg-[#F2F3F5]` 时，必须有明确的内容保真说明或语义暗色映射；
2. 新增 iframe/srcDoc 时必须声明 `adaptive | fidelity` 主题策略；
3. App/Sprite/FloatIcon 不得再次实现独立的 `matchMedia` 解析逻辑；
4. 核心 Surface 测试同时验证 light 映射保持原值、dark 映射符合新角色；
5. 对技能广场和生成表格增加回归测试，验证暗色 class/注入样式不含白色常态 Surface。

静态规则用于阻止新遗漏；历史文件按 P0/P1/P2 分批迁移，不采用一次性机械替换。

## 验证与验收

### 机制验收

- Light、Dark、System 三种偏好均能正确解析；
- System 模式下切换 macOS 外观，主窗口和独立窗口无需重启即可同步；
- 重启应用后设置保持；
- Main 原生背景与 renderer 首帧一致，不出现蓝黑/白色闪屏；
- adaptive iframe 在运行时切换主题，内容不需要关闭重开。

### 视觉验收

- 浅色截图与改造前对比无视觉变化；
- 技能广场的搜索、文件夹、上传、排序、分类选中和图标底与“我的任务”控件处于同一暗色层级；
- 生成表格的表头、表体、文字和边框均可读，不出现白色大块；
- 主背景、卡片、Popover 至少能辨认三个层级，但不依赖高对比描边；
- 普通正文使用 `#dfdfdf` 层级，纯白只用于必要的高强调内容；
- 状态色保持语义，不因暗色化丢失成功/警告/错误辨识。

### 工程验证

- 新增/更新主题单元测试；
- 运行相关 Vitest、`pnpm run typecheck` 与 `pnpm run lint`；
- 用真实 Electron 窗口逐页巡检主要路由，而不是以缺少 preload 的普通浏览器白屏作为验证结果；
- 复核 `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 是否需要同步主题行为说明。

## 实施顺序

1. 建立 token/兼容别名与 `ThemeController`，先保证浅色映射不变；
2. 接通 Main 原生主题、系统实时切换和独立窗口；
3. 建立 preview `adaptive | fidelity` 协议，修复生成 HTML 表格；
4. 迁移技能广场与共享交互组件；
5. 按 P1/P2 审计清单处理其余场景；
6. 完成自动测试、真实 Electron 视觉巡检和文档复核。

## 风险与控制

- **浅色回归**：只在 `:root` 增加别名，不改现有浅色值；用 token 测试和截图对比锁定。
- **任意 HTML 被错误反色**：通过 `adaptive | fidelity` 明确区分，不对所有 iframe 做全局滤镜或无条件覆盖。
- **主题切换导致 iframe 状态丢失**：优先 `postMessage` 更新属性，不通过重建 `srcDoc` 实现运行时切换。
- **局部修补继续扩散**：共享 Surface 先行，页面只消费语义角色，并增加静态守卫。
- **跨窗口状态竞态**：Main 作为跨窗口事实来源，renderer 只保留兼容缓存；主题同步使用解析后的 light/dark，而不是每个窗口重复解析 system。
