## Why

归档设计稿（`STO Claw/index.html` + `styles.css`）定义了网点端 STO Claw 的目标视觉与信息架构：浅灰画布、248px 宽侧栏、品牌区与「任务列表」分组、底部用户卡，以及主内容区「Hero → 数据概览卡 → 助手输入区」的纵向排版。当前 Electron 应用采用窄轨图标侧栏 + 可展开会话列、青色系玻璃态与渐变画布，与目标稿在间距、层级和模块划分上不一致，需要一次有规格约束的对齐变更，避免实现时随意发挥。

## What Changes

- 以设计稿 CSS 变量与模块结构为基准，收敛全局画布/侧栏/主内容区的排版与配色（优先通过 Tailwind 主题与布局组件实现，而非整页粘贴静态 HTML）。
- 侧栏：宽度、分区（主导航 / 分组标签 / 列表项 / 底部用户区）、折叠宽度与交互语义对齐原型；会话与业务任务的呈现方式在设计阶段明确映射关系。
- 主内容区：引入与设计稿一致的「主区内层最大宽度 + 水平内边距」约束；在落地路由策略确定后，实现 Hero、概览卡栅格、助手输入条（composer）的组件化结构。
- 若将「首页」与「对话」分离：调整默认路由与侧栏「对话」入口，使设计稿首页与现有 Chat 能力共存且不破坏 host-api / Gateway 代理约束。

## Capabilities

### New Capabilities

- `navigation-sidebar-sto-prototype`：应用壳侧栏在尺寸、分区、折叠与底部用户卡等维度对齐 STO Claw 归档原型。
- `dashboard-sto-home-surface`：主内容区首页级表面（Hero、概览卡、助手 composer 排版与样式），数据层可与业务接口分阶段接入。

### Modified Capabilities

- **None in this change folder at baseline.** When the default route splits so Chat leaves `/`, a follow-up OpenSpec delta SHALL add **Modified** entries under the appropriate existing `chat-*` capability specs in `openspec/specs/` (copy full requirement blocks per writing standards), rather than duplicating chat semantics only inside this change archive.

## Impact

- `src/components/layout/MainLayout.tsx`、`src/components/layout/Sidebar.tsx`、`src/components/layout/TitleBar.tsx`（与侧栏衔接的垂直节奏）。
- `src/styles/globals.css` 及可能的 Tailwind 主题扩展（色板、圆角、阴影、字体栈）。
- `src/App.tsx` 与路由表（若执行「首页 / 对话」拆分）。
- `src/pages/Chat/` 与新建 `src/pages/` 下首页模块（若引入独立 Home 页）。
- 国际化文案键（导航标签、分组标题等）。
- 按 `openspec/config.yaml`：本变更不新增 renderer 直连 Gateway `fetch`；不涉及 comms 协议时可省略 `comms:replay`，若触及会话列表与 Gateway 事件的联动再补跑。
