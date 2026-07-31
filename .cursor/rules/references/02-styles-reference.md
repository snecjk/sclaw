<!-- 从自动加载规则移出的完整视觉表格与历史示例。事实和强制边界以 ../02-styles.mdc 为准。 -->

# sto-claw 样式实践参考

> 当前阶段本文件是**工作基线和经验沉淀**，不是最终设计规范。
>
> - 当前开发以本次任务中**最新、已确认的设计稿**为第一视觉依据。
> - 本文件已有内容用于复用和参考；与最新设计稿冲突时，以设计稿为准，但必须记录差异。
> - 新设计稿中经过页面验证、具有复用价值的规律，应反哺到本文件，并标明适用范围。
> - 单页面特例不直接升级成全局规则，先作为页面或组件级约定记录。
> - 待公司设计规范齐全后，再统一校准 Token、本文件和历史页面。
> - **当前基线**：颜色 / 字号 / 字重 / 字体族 / 圆角 / 间距 / 阴影 / 描边 / 响应式。
> - **待验证资产**：状态视觉 / 动画 / 对话气泡 / 代码块 / 工具调用卡片 / 流式光标 / Tag / Icon / Loading-Empty-Error / Modal-Drawer / Toast / 输入框 / 按钮。
> - **主题能力**：项目已支持亮色与暗色主题；修改现有页面时必须保留两种主题的可读性和状态完整性。
>
> **来源**：MasterGo 首页设计 JSON + STO Design 框架稿（2026-06）+ 用户填写表（2026-06-08）

## 决策优先级

1. 本次任务已确认的最新设计稿及补充说明。
2. 当前页面已经验证通过的视觉实现。
3. 本文件中适用于当前组件或场景的工作基线。
4. `docs/sto-design.md` 中尚未与最新设计稿冲突的通用 Token 建议。

遇到冲突时不要静默选择：在实施前说明差异；页面验收后把结论更新回本文件。

## 反哺流程

`新设计稿 -> 页面实现 -> 视觉验收 -> 提取可复用规律 -> 更新本文件 -> 后续页面复用`

更新时写清楚：来源设计稿、适用页面或组件、是否已验收、是否可以全局复用。

---

## 样式技术栈（**已确定，不会变**）

| 类别 | 选型 |
| --- | --- |
| 样式方案 | **Tailwind CSS 3.4** |
| 组件库 | **shadcn/ui** + Radix 原件 |
| 暗色模式 | **已实现**：Tailwind `darkMode: ['class']` + `globals.css` 的 `.dark` tokens |
| 动画 | **Framer Motion**（业务）+ **tailwindcss-animate**（shadcn 状态动画） |
| 图标 | **Lucide React**（唯一图标库） |
| className 工具 | **`cn()`**（`clsx` + `tailwind-merge`，来自 `src/lib/utils`） |
| 字体族 | PingFang SC（中文）+ SF Pro（英文/数字）+ ui-monospace（代码） |

---

## 样式写法约定（**已确定，硬规则**）

### 必须

- **所有样式用 Tailwind utility classes**
- className 拼接**必须**用 `cn()`：

  ```tsx
  import { cn } from '@/lib/utils';
  <Button className={cn('shrink-0', isActive && 'bg-primary', className)} />
  ```

- 项目级 CSS variables（结构变量如侧栏宽度）在 `src/styles/globals.css` 定义，业务通过 `bg-[var(--xxx)]` 引用
- 重复 className 抽到 `src/lib/surfaces.ts` 或文件级 `const`

### 禁止

- ❌ inline `style={...}`（特殊场景必须注释说明为什么）
- ❌ `` className={`${a} ${b}`} `` 模板字符串拼接
- ❌ 自己写 CSS 文件做组件样式（全局 reset 和主题 vars 除外）
- ❌ 其他样式方案（CSS Modules / styled-components / vanilla-extract / SCSS）
- 新增或修改可见组件时，优先使用语义 token；需要主题差异时使用 `dark:`，不得破坏现有暗色适配

---

## 颜色系统（当前工作基线）

> 当前项目主品牌色以 `globals.css` 和 `docs/sto-design.md` 为准：**`#FF6F00`**。业务代码优先使用 `primary` 语义 token，不散落品牌色 hex。

### Primary 主品牌色

| 字段 | 值 | 用途 |
| --- | --- | --- |
| Primary 主色 | `#FF6F00`（HSL `26 100% 50%`） | 按钮 / 主操作 / 选中 / focus ring |
| Primary 文字色 | `#FFFFFF` | on primary 背景 |
| Primary hover | `bg-primary/90` | hover 默认变化 |
| Primary active | `bg-primary/80` + `scale-[0.98]` | 按下瞬间 |
| Primary disabled | `opacity-50` + `cursor-not-allowed` | 禁用态 |
| Primary 浅底（selected / hover bg）| `bg-primary/10` | tab 选中底 / pill 底 |
| Primary 边框色（focus ring）| `#FF6F00` | focus ring 默认色 |

```css
:root {
  --primary: 26 100% 50%;             /* #FF6F00 申通橙 */
  --primary-foreground: 0 0% 100%;    /* #FFFFFF */
}
```

### Grey 中性色阶（10 档）

| 色阶 | hex | 用途 | Tailwind |
| --- | --- | --- | --- |
| Grey-10 | `#1D2129` | 主标题 / 默认正文 | `text-foreground` |
| Grey-9 | `#4E5969` | 次要文字 / 卡片标题 | `text-foreground/80` |
| Grey-8 | `#86909C` | 三级文字 / 侧栏分区标题 / 版本号 | `text-[var(--sto-sidebar-text-section)]` |
| Grey-7 | `#A4AAB3` | 禁用文字 / 占位符 | `placeholder:text-[#A4AAB3]` |
| Grey-6 | `#8B9099` | 次要图标 | — |
| Grey-5 | `#C9CDD4` | 浅边框 / 空状态插画 | — |
| Grey-4 | `#E5E6EB` | 默认边框 | `border-border` |
| Grey-3 | `#F0F1F2` / `#F1F1F3` | 弱底 / hover / 行号背景 | `bg-muted` |
| Grey-2 | `#F4F5F7` | 浅卡片底 / 系统消息底 / NavItem 选中底 | — |
| Grey-1 | `#F7F8FA` | 页面背景 / Empty 卡片底 | `bg-background` |

### Background / Foreground

```css
:root {
  --background: 220 14% 97%;          /* #F7F8FA */
  --foreground: 220 26% 14%;          /* #1D2129 */
  --card: 0 0% 100%;                  /* #FFFFFF */
  --card-foreground: 220 26% 14%;
  --popover: 0 0% 100%;
  --popover-foreground: 220 26% 14%;
  --muted: 220 13% 95%;               /* #F0F1F2 */
  --muted-foreground: 215 14% 57%;    /* #86909C */
  --border: 220 13% 91%;              /* #E5E6EB */
  --input: 220 13% 91%;
  --ring: 26 100% 50%;                /* #FF6F00 primary */
}
```

### 状态色（完整变体）

| 类型 | 主色 | 文字色 | 浅底 | 边框 | hover |
| --- | --- | --- | --- | --- | --- |
| **Error / Destructive** | `#FA3C3C` | `#FFFFFF` | `bg-destructive/10` | `#FA3C3C` | `bg-destructive/90` |
| Error 变体（macOS）| `#FF5F57` | — | — | — | — |
| **Warning** | `#FEBC2E` | `#1D2129`（黄底用深色文字） | `bg-warning/10` | `#FEBC2E` | `bg-warning/90` |
| **Success** | `#28C840` | `#FFFFFF` | `bg-success/10` | `#28C840` | `bg-success/90` |
| **Info** | 复用 primary `#FF6F00` | `#FFFFFF` | `bg-primary/10` | `#FF6F00` | `bg-primary/90` |

```css
--destructive: 0 95% 61%;              /* #FA3C3C */
--destructive-foreground: 0 0% 100%;
--warning: 38 99% 59%;                 /* #FEBC2E */
--warning-foreground: 220 26% 14%;     /* 黄底用深色文字 */
--success: 130 67% 47%;                /* #28C840 */
--success-foreground: 0 0% 100%;
```

### 链接色（🟡 待前端 review 确认）

| 字段 | 值 |
| --- | --- |
| 链接默认 | 使用现有 `link` 语义 token；主操作链接按场景使用 primary `#FF6F00` |
| 链接 hover | hover 时显示下划线 |
| 链接 visited | 不区分 |
| 链接 disabled | `#A4AAB3`（Grey-7） |

### 透明覆盖

| 用途 | 值 |
| --- | --- |
| 极浅暗色覆盖（micro hover）| `bg-black/[0.01]` |
| 浅暗覆盖（hover bg） | `bg-black/[0.02]` 或 `bg-black/[0.04]` |
| 中度暗覆盖（Modal 遮罩）| `bg-black/20` |
| 半透明白卡片（glass）| `bg-white/85` |
| 极浅白覆盖 | `bg-white/15` |
| 品牌色极浅底 | `bg-primary/[0.06]` 或 `bg-primary/10` |
| 极浅蓝灰底 | `bg-[#0F172A]/[0.06]` |

### Glass 主题（保留 globals.css 已有）

| CSS class | 场景 |
| --- | --- |
| `.glass` | 默认磨砂卡片 |
| `.glass-chrome` | 顶栏 / 全宽壳层（无外阴影） |
| `.glass-panel` | 主要磨砂面板 |
| `.glass-subtle` | 弱化磨砂 |
| `.signal-card` | 主页指标卡（含 hover 扫光） |
| `.glow-badge` | 发光徽章 |
| `.neural-grid` | 神经网格底纹 |

### sto-claw 专属 CSS variables（结构层）

```css
--sto-page-bg: #F7F8FA;
--sto-sidebar-bg: #F3F4F6;
--sto-sidebar-border: #E8EAEF;
--sto-accent: #FF8C00;
--sto-accent-soft: #FFF3E0;
--sto-brand-6: #FF6F00;

/* 结构尺寸（响应式硬规则，来自 STO Design 框架稿） */
--sto-header-h: 52px;                 /* 标题栏高度 */
--sto-sidebar-w-expanded: 260px;      /* 侧栏展开 */
--sto-sidebar-w-collapsed: 72px;      /* 侧栏折叠 */
--sto-content-pad-x: 20px;            /* 主内容左右内距 */
--sto-chat-max-w: 760px;              /* 对话区最大宽度（聊天阅读最佳宽度） */

/* 三栏模式（产物预览时） */
--sto-split-min-chat: 30%;            /* 对话区最小占比 */
--sto-split-max-preview: 70%;         /* 预览区最大占比 */
```

### 颜色使用强制规则

- ✅ **优先用 Tailwind 语义 token**（`bg-primary` / `text-foreground` 等）
- ✅ 同一文件 ≥ 2 次的色值**必须**抽 TS 常量 + 注释引用 Grey-X / Brand-X
- ✅ 品牌色及衍生**统一从 `--primary` 派生**
- ❌ **禁止**未在本节列出的色值
- ❌ **禁止**散落 `text-[#xxxxxx]` 而无注释引用

---

## 字体系统（🟢 **已强制**）

### 字号阶梯（6 档）

| Token | px | 行高 | 字重 | 用途 |
| --- | --- | --- | --- | --- |
| `text-xs` | **12** | 14-18 | 400 / 500 | 角标 / 标签 / Meta / Footer |
| `text-[13px]` | **13** | 18 | 400 / 500 | 二级 meta / 卡片说明 / 代码块 / 工具调用 |
| `text-sm` | **14** | 18-20 | 400 / 500 / 600 | **默认正文** / 卡片副文 / 按钮 / 输入框 |
| `text-[15px]` | **15** | 20 | 400 / 500 | 主流文字 |
| `text-base` | **16** | 20 | 500 / 600 | 卡片标题 / 二级标题 |
| `text-2xl` | **24** | 36 | 600 | **主标题**（首页大标题）|

**不需要**：更大字号（hero 仍用 24px）/ 更小字号（最小 12px）。

### 字重

| 字重 | Tailwind | 中文 | 英文/数字 |
| --- | --- | --- | --- |
| 400 | `font-normal` | ✅ 正文 | ✅ 默认 |
| 500 | `font-medium` | ✅ 强调 / UI 标签 / Tag | ✅ UI 标签 |
| 600 | `font-semibold` | ✅ 标题 | ✅ 标题 |
| 700 | `font-bold` | ❌ 中文不用 | ❌ 不用（截图未见加粗英文数字）|

### 字体族

| 用途 | 字体族 | Tailwind |
| --- | --- | --- |
| **中文 / UI / 正文** | `PingFang SC, system-ui, -apple-system, "Hiragino Sans GB", sans-serif` | `font-sans` |
| **英文 / 数字** | `SF Pro, ui-monospace, ...` | 视场景 |
| **代码 / 路径 / ID / token** | `ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace` | `font-mono` |

### 行高（4 档）

| px | 用法 |
| --- | --- |
| 14 | text-xs (12px) 紧凑 |
| 18 | text-sm (13-14px) 默认 |
| 20 | text-[15px] / text-base (16px) 默认 |
| 36 | text-2xl (24px) 主标题 |

---

## 间距系统（🟢 **已强制**）

### Padding 阶梯

| Tailwind | px | 主用途 |
| --- | --- | --- |
| `p-1` | 4 | 微间距 / icon padding |
| `p-2` | 8 | 小元素内距 |
| `p-[10px]` | 10 | 标签内距 / 紧凑按钮 |
| `p-[11px]` | 11 | 中性内距 |
| `p-3` | 12 | 默认按钮内距 |
| `p-[14px]` | 14 | 卡片副内距 |
| `p-4` | 16 | 卡片内距 / 常规组件 |
| `p-[18px]` | 18 | 偏大卡片 |
| `p-5` | 20 | 页面内边距 / 大卡片 |
| `p-6` | 24 | 主卡片 / 弹窗内距 |

### Gap 阶梯

| Tailwind | px |
| --- | --- |
| `gap-0.5` | 2 |
| `gap-[3px]` | 3 |
| `gap-1` | 4 |
| `gap-1.5` | 6 |
| `gap-[7px]` | 7 |
| `gap-2` | 8 |
| `gap-2.5` | 10 |
| `gap-[11px]` | 11 |
| `gap-3` | 12 |
| `gap-4` | 16 |
| `gap-[18px]` | 18 |
| `gap-[30px]` | 30 |

### 组件级标准

| 场景 | 值 |
| --- | --- |
| 卡片内 padding | 20-24px |
| 卡片间 gap | 12-16px |
| 卡片标题与内容间距 | 14-18px |
| 章节间距 | 30px |
| 页面左右内距 | 20px (`--sto-content-pad-x`) |
| 主内容最大宽度 | 1100px (`--sto-main-inner-max`) |
| 侧栏宽度（展开/折叠） | 248 / 72px |
| 按钮内距 (sm/md/lg) | 8-10 / 11-12 / 14-16px |
| 输入框内距 | 11-14px |
| Tag/Pill 内距 | 6-10 (水平) / 2-4 (垂直) |

### 间距规则

- ✅ 优先用 Tailwind 标准 token，非 4 倍数（10/11/14/18）用任意值
- ❌ 禁止发明新值（如 `p-[7.5px]`）

---

## 圆角系统（🟢 **已强制** - 13 档）

```css
--radius: 0.5rem;  /* = 8px 基准 */
```

| Tailwind | px | 用途 |
| --- | --- | --- |
| `rounded-none` | 0 | 无圆角 |
| `rounded-[1px]` / `rounded-[2px]` | 1 / 2 | 极微 / 微 |
| `rounded-sm` | 4 | 角标 / Tag / 内联 code |
| `rounded-md` | 8 | **默认按钮 / 输入框 / 小卡片** |
| `rounded-[9px]` | 9 | 中性 |
| `rounded-lg` | 8 | **代码块 / 工具调用卡 / 系统消息**（同 `rounded-md`）|
| `rounded-xl` | 12 | **指标卡 / 内容卡** |
| `rounded-2xl` | 16 | **首页 3 大卡片 / 主容器 / 用户消息气泡 / Modal** |
| `rounded-[18px]` | 18 | 偏大卡片 |
| `rounded-[22px]` | 22 | 大圆角 pill |
| `rounded-[24px]` | 24 | **聊天输入框** |
| `rounded-full` | 9999 | 头像 / 状态点 / pill |

---

## 阴影系统（🟢 **已强制** - 4 档）

| Token | shadow | 场景 |
| --- | --- | --- |
| `shadow-glow` | `0 0 4px rgba(0,0,0,0.04)` | 极微 glow（侧栏选中 / hover 提示） |
| `shadow-soft` | `0 0 16px rgba(0,0,0,0.06)` | 软发光（卡片 hover / 按钮 hover / 输入框 focus） |
| `shadow-elevated` | `0 6px 30px rgba(0,0,0,0.08)` | **首页 3 大卡片 / 浮层 / Toast** |
| `shadow-modal` | `0 8px 40px rgba(0,0,0,0.16)` | **Modal / Dialog 专用更重阴影** |

```js
// tailwind.config.js
boxShadow: {
  glow: '0 0 4px rgba(0, 0, 0, 0.04)',
  soft: '0 0 16px rgba(0, 0, 0, 0.06)',
  elevated: '0 6px 30px rgba(0, 0, 0, 0.08)',
  modal: '0 8px 40px rgba(0, 0, 0, 0.16)',
  glass: 'var(--glass-shadow)',
  'glass-lg': 'var(--glass-shadow), inset 0 1px 0 0 hsl(var(--glass-highlight))',
}
```

### 组件级标准

| 场景 | shadow |
| --- | --- |
| 首页 3 大指标卡 | `shadow-elevated` |
| 普通卡片 | `shadow-glow` |
| 卡片 hover | `shadow-soft` |
| Modal / Dialog | `shadow-modal` |
| Dropdown / Popover | `shadow-soft` |
| Toast | `shadow-elevated` |
| Tooltip | `shadow-glow` |
| 输入框 default | 无 |
| 输入框 focus | `shadow-soft` 或 ring |
| 按钮 default | 无 |
| 按钮 hover (primary) | `shadow-soft` |

**禁止**：inner shadow / 自定义阴影值 / 多层叠加（除 `shadow-glass-lg`）。

---

## 描边系统（🟢 **已强制** - 新增）

### 描边颜色（按场景）

| 场景 | 颜色 | Tailwind |
| --- | --- | --- |
| 默认边框 | `#E5E6EB`（Grey-4） | `border-border` / `border-[#E5E6EB]` |
| 强调边框 | `#C9CDD4`（Grey-5） | `border-[#C9CDD4]` |
| Hover 边框 | 🟡 待定（先沿用默认或主色） | — |
| Focus 边框 | `#FF6F00`（primary） | `border-primary` |
| Active 边框 | `#FF6F00` | `border-primary` |
| Disabled 边框 | `#E5E6EB`（同默认） | `border-border` |
| Error 边框 | `#FA3C3C` | `border-destructive` |
| Success 边框 | `#28C840` | `border-success` |
| Warning 边框 | `#FEBC2E` | `border-warning` |
| 分割线 | `#F0F1F2`（Grey-3） | `border-[#F0F1F2]` |

### 描边粗细

| 场景 | px |
| --- | --- |
| 默认 | `1px` |
| 强调 / focus ring | `2px` |
| 卡片 | `1px` |
| 分割线 | `1px` |

### 描边样式

- 默认：`solid`
- **不需要**：dashed / dotted（截图未见，禁止使用除非业务明确需要）

---

## 响应式（🟢 **已强制** - 桌面端 / Qoder 模式）

> 来源：STO Design 框架稿（2026-06）。
> sto-claw 是桌面端 Electron app，**不是 Web 多断点重排版**——只有一个核心模式：固定结构 + 主内容自适应放大。

### 总规则

| 字段 | 值 |
| --- | --- |
| **最小窗口尺寸** | **1200 × 800px**（比例 3:2） |
| **Electron 窗口可拖拽** | yes（用户可手动调整） |
| **窗口尺寸记忆** | yes，下次开启按上次尺寸（持久化到 `electron-store`） |
| 不兼顾移动端 | yes |
| 设计稿基准 | 1440px |
| 字号随窗口变化 | no |
| 卡片 / 组件间距随窗口变化 | no |

### 结构尺寸

| 字段 | 值 | CSS variable |
| --- | --- | --- |
| 标题栏高度 | `52px` | `--sto-header-h` |
| 侧栏宽度（展开） | `260px` | `--sto-sidebar-w-expanded` |
| 侧栏宽度（折叠） | `72px` | `--sto-sidebar-w-collapsed` |
| **对话区最大宽度** | **`760px`** | `--sto-chat-max-w` |
| 主内容左右内距 | `20px` | `--sto-content-pad-x` |

### 模式 1：双栏（默认）

```
┌────────────────────────────────────────────────┐
│  标题栏 52px                                    │
├──────────┬─────────────────────────────────────┤
│ 侧边导航 │       对话区最大 760px              │
│  260px   │   ─── Auto ─── 760 ─── Auto ───     │
│          │                                     │
└──────────┴─────────────────────────────────────┘
```

- 对话区**固定最大 760px**
- 窗口放大时，对话区不变，两侧 `Auto` 留白自适应扩大
- 1200 屏（最小）：760 + 侧栏 260 + 内距 40 = 1060px，剩余空间均分两侧

### 模式 2：侧栏折叠

```
┌────────────────────────────────────────────────┐
│  标题栏 52px                                    │
├─┬──────────────────────────────────────────────┤
│ │        对话区居中 760px                       │
│↕│  ─── Auto ─── 760 ─── Auto ───               │
│ │                                              │
└─┴──────────────────────────────────────────────┘
```

- 侧栏收起到 `72px`（图标列）
- 对话区居中，两侧 `Auto` 自适应扩大
- 触发方式：**用户点击折叠按钮**（纯手动，**不**根据窗口宽度自动折叠）
- 折叠状态持久化（重启保留）

### 模式 3：三栏（产物预览时）

```
┌────────────────────────────────────────────────┐
│  标题栏 52px                                    │
├─────┬──────────┬───────────────────────────────┤
│侧栏 │ 对话区   │   预览区                       │
│     │  最小 30%│   最大 70%                    │
│     │          │                               │
└─────┴──────────┴───────────────────────────────┘
```

- 进入条件：用户预览对话产物（产物面板打开）
- 对话区与预览区**可手动拖拽分割**：
  - 对话区最小占比 `30%`
  - 预览区最大占比 `70%`
  - 默认比例 `30% : 70%`
- **拖拽比例持久化**：下次打开产物时按上次比例展示
- 标题栏 / 侧栏行为不变

### 三种模式切换约定

| 触发 | 切到模式 |
| --- | --- |
| 默认 | 模式 1（双栏） |
| 用户点折叠按钮 | 模式 2（侧栏折叠） / 反之展开 |
| 用户打开产物预览 | 模式 3（三栏） |
| 用户关闭产物预览 | 回到上一个模式（1 或 2） |
| 切换动画 duration | `200ms ease-out`（侧栏折叠 / 预览区开合统一） |

### Electron 窗口约束（工程参考，不属于 Tier 1 样式任务）

以下内容涉及 Main 进程和持久化逻辑。样式修改时不得直接实施；确有需求时重新分级，并由技术评审确认。

```ts
mainWindow = new BrowserWindow({
  minWidth: 1200,
  minHeight: 800,
  width: lastSize?.width ?? 1440,    // 记忆 or 默认
  height: lastSize?.height ?? 900,
  // ...
});

// 窗口尺寸变化时持久化（防抖 500ms）
mainWindow.on('resize', debounce(() => {
  const [width, height] = mainWindow.getSize();
  store.set('window.size', { width, height });
}, 500));
```

### 状态持久化（electron-store）

| key | 值 | 用途 |
| --- | --- | --- |
| `window.size` | `{ width, height }` | 窗口尺寸 |
| `window.position` | `{ x, y }` | 窗口位置（可选） |
| `sidebar.collapsed` | `boolean` | 侧栏是否折叠 |
| `preview.split` | `number` (0.3 - 1) | 对话区/预览区分割比例（对话区占比） |

### 系统缩放（DPI）

- 兼容 macOS / Windows **100% / 125%** 缩放（按等效像素 1200×800 测试）
- **150% 不强保证**（用户在那种屏幕下用 100%）

### 验证 checklist（PR 必跑）

- [ ] 1200×800（最小）：双栏 / 折叠 / 三栏三种模式都能正常显示
- [ ] 1440×900（基准）：默认布局正常
- [ ] 1920×1080：对话区固定 760，两侧 Auto 留白
- [ ] 拖拽窗口：从 1200 拖到 1920，结构稳定无抖动
- [ ] 重启 app：窗口尺寸 / 侧栏折叠状态 / 预览区比例都按上次记忆恢复
- [ ] 拖拽预览区分割条：到达 30%/70% 边界时停止
- [ ] 系统缩放 125%：等效 960×640，元素无遮挡

### 禁止

- ❌ 移动端兼容（公司有独立移动项目）
- ❌ 多断点改布局（不改列数 / 不改字号）
- ❌ 自动根据窗口宽度折叠侧栏（用户手动控制）
- ❌ 对话区超过 760px（阅读体验差）
- ❌ 三栏模式忽略 30/70 边界（拖到 80% 不停 = bug）
- ❌ 窗口尺寸不持久化（重启回到默认 = bug）

---

## 状态视觉量化（🟡 **v0.2 初版**）

### Hover

| 元素 | 视觉变化 |
| --- | --- |
| 主按钮（primary）背景 | `bg-primary/90` |
| 次按钮（secondary）背景 | `bg-black/[0.04]` |
| 文字按钮（ghost / link）背景 | `bg-black/[0.02]` |
| 链接 hover | `underline` |
| 卡片 hover | 阴影变化 `shadow-soft`，边框不变 |
| 列表项 hover 背景 | `#F0F1F2`（Grey-3） |
| 图标按钮 hover 背景 | `bg-black/[0.04]` |

### Active（按下）

| 字段 | 值 |
| --- | --- |
| 按钮缩放 | `scale-[0.98]` |
| 按钮颜色变深 | `bg-primary/80` |
| 反馈延迟 | < 100ms |

### Disabled

| 字段 | 值 |
| --- | --- |
| 整体透明度 | `opacity-50` |
| 灰度 | 不加（仅透明度） |
| cursor | `cursor-not-allowed` |
| 同时禁用 hover | yes |

**a11y 标准（硬规则）**：

- 必须同时 `disabled` 属性 + `aria-disabled="true"`
- **禁止**只用 `pointer-events: none`

### Focus ring（键盘聚焦）

| 字段 | 值 |
| --- | --- |
| ring 颜色 | `#FF6F00`（primary）|
| ring 宽度 | `2px` |
| ring offset | `2px` |
| ring 圆角跟随元素 | yes |
| 仅 keyboard focus 显示 | yes（用 `:focus-visible`） |

```tsx
className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
```

**硬规则**：所有交互元素 focus 样式必须可见；禁止全局 `outline: none` 而不补替代视觉。

### Selected 态（Tab / NavItem / Checkbox / Radio）

| 字段 | 值 |
| --- | --- |
| Tab 选中下划线颜色 | `#FF6F00`（primary）|
| Tab 选中下划线粗细 | `2px` |
| NavItem 选中背景 | `#F4F5F7`（Grey-2） |
| NavItem 选中文字色 | `#1D2129`（Grey-10） |
| Checkbox 选中色 | `#FF6F00`（primary） |
| Radio 选中色 | `#FF6F00`（primary） |

### Cursor

| 场景 | cursor |
| --- | --- |
| 文字 | `text` |
| 可点击 | `pointer` |
| 可拖动 | `move` / `grab` |
| 可调整 | `col-resize` / `row-resize` |
| 禁用 | `not-allowed` |

**禁止**：在 `<div>` 上加 `cursor: pointer` 装可点（用真实 `<button>`）。

---

## 动画系统（🟡 **v0.2 初版**）

### Duration

| Token | ms | 用途 |
| --- | --- | --- |
| `duration-fast` | **120ms** | 按钮 hover / 颜色切换 / 状态切换 |
| `duration-base` | **200ms** | Modal 入场 / Toast / 卡片 hover |
| `duration-slow` | **300ms** | Drawer 滑动 / 复杂场景 |

### Easing

| 场景 | easing |
| --- | --- |
| 入场（出现） | `cubic-bezier(0, 0, 0.2, 1)` ≈ `ease-out` |
| 退场 | `cubic-bezier(0.4, 0, 1, 1)` ≈ `ease-in` |
| 双向（hover / focus 切换） | `ease-in-out` |
| 默认 | `ease` |

**Framer Motion Spring**：不用（截图未见弹簧动画）。

### 关键场景动画

| 场景 | duration | easing | 动画类型 |
| --- | --- | --- | --- |
| Modal 入场 | `200ms` | `ease-out` | fade + zoom-in 95→100% |
| Modal 退场 | `150ms` | `ease-in` | fade + zoom-out |
| Drawer 滑入（右） | `300ms` | `ease-out` | slide from right |
| Drawer 滑入（底） | `300ms` | `ease-out` | slide from bottom |
| Toast 入场 | `200ms` | `ease-out` | slide from bottom + fade |
| Toast 出场 | `150ms` | `ease-in` | slide to bottom + fade |
| Toast 自动消失 | `3000ms` | — | — |
| Tooltip 触发延迟 | `300ms` | — | hover 多久才显示 |
| Tooltip 关闭延迟 | `100ms` | — | — |
| 卡片 hover | `200ms` | `ease-in-out` | 阴影过渡 |
| 按钮 hover | `120ms` | `ease-in-out` | 颜色过渡 |
| 页面切换 | — | — | **无动画** |
| 列表项进出场（AnimatePresence） | `200ms` | `ease-out` | fade + slide |
| `prefers-reduced-motion` 支持 | 🟡 待定 | — | 建议默认 respect |

### Framer Motion 风格约定

```tsx
// 简单条件动画
<motion.button
  initial={false}
  animate={{
    opacity: show ? 1 : 0,
    y: show ? 0 : 6,
    scale: show ? 1 : 0.96,
  }}
  transition={{ duration: 0.18, ease: 'easeOut' }}
/>

// AnimatePresence 挂载 / 卸载
<AnimatePresence>
  {show && (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: 0.25, ease: 'easeInOut' }}
    />
  )}
</AnimatePresence>
```

- `initial={false}` 用于条件动画避免初次入场
- 动画属性优先 `transform` / `opacity`，**禁止** layout 属性

### tailwindcss-animate（shadcn 状态动画）

```tsx
'data-[state=open]:animate-in data-[state=closed]:animate-out',
'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
'data-[side=bottom]:slide-in-from-top-2',
```

**禁止**用 Framer Motion 给 shadcn 原件做状态动画。

---

## Icon 规范（🟡 **v0.2 初版**）

### 库（硬规则）

- 唯一图标库：**Lucide React**
- **禁止**混用其他图标库

### 尺寸

| Tailwind | px | 用途 |
| --- | --- | --- |
| `h-3 w-3` | 12 | 行内 inline |
| `h-3.5 w-3.5` | 14 | 行内强调 |
| `h-4 w-4` | 16 | 按钮内 / 默认 |
| `h-5 w-5` | 20 | 独立小图标 / 侧栏 nav |
| `h-6 w-6` | 24 | 卡片图标 / 技能广场卡 |
| `h-8 w-8` | 32 | 主图标 / hero |

### strokeWidth

| 场景 | strokeWidth |
| --- | --- |
| 默认 / 信息图标 | `2` |
| 装饰 / 微妙图标 | `1.75` |
| 大图标 / Hero | `1.5` |

### 颜色策略

| 场景 | 颜色 | Tailwind |
| --- | --- | --- |
| 装饰图标（默认） | `#86909C` | `text-muted-foreground` |
| 语义图标（按钮内）| 继承父色 | — |
| 主品牌图标 | `#FF6F00` | `text-primary` |
| 错误图标 | `#FA3C3C` | `text-destructive` |
| 成功图标 | `#28C840` | `text-success` 或 `text-[#28C840]` |

### 装饰 vs 语义

```tsx
// 装饰图标 → aria-hidden
<AlertCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />

// 语义图标（按钮中替代文字）→ aria-label
<button type="button" aria-label="关闭" onClick={onClose}>
  <X className="h-4 w-4" aria-hidden="true" />
</button>
```

---

## 输入框（Input）（🟡 **v0.2 初版**）

### 普通输入框

| 字段 | 值 |
| --- | --- |
| 默认高度 | `36px`（中尺寸） / `44px`（大尺寸） |
| 内距 | 水平 `12px` / 垂直 `8-11px` |
| 圆角 | `8px`（`rounded-md`） |
| 边框（默认/focus/error） | `#E5E6EB` / `#FF6F00` / `#FA3C3C` |
| 边框粗细 | `1px` |
| 背景色 | `#FFFFFF` |
| 占位符颜色 | `#A4AAB3`（Grey-7） |
| 字号 | `14px` |
| focus ring | yes（参考状态视觉的 focus ring 规范） |
| 错误态 | 边框 `#FA3C3C` + ring `destructive/20` |
| 禁用态 | `opacity-50` + `cursor-not-allowed` |

### 聊天输入框（首页底部那个大圆角）

| 字段 | 值 |
| --- | --- |
| 高度 | 自适应（多行可扩展） |
| 圆角 | `24px`（`rounded-[24px]`） |
| 内距 | `px-4 py-3` |
| 背景 | `#FFFFFF` |
| 边框 | `#E5E6EB`，focus 时 `#FF6F00` |
| 字号 | `14-15px` |

---

## 按钮（Button）（🟡 **v0.2 初版**）

### 尺寸

| 尺寸 | 高度 | 内距 | 字号 | 圆角 |
| --- | --- | --- | --- | --- |
| `sm` | 32px | `px-3` | 12px | `rounded-md`（8px） |
| `md`（默认） | 36px | `px-4` | 14px | `rounded-md`（8px） |
| `lg` | 44px | `px-5` | 15px | `rounded-md`（8px） |
| `icon` | 36×36 | — | — | `rounded-md`（8px） |

### Variants

| Variant | 背景 | 文字 | 边框 | hover |
| --- | --- | --- | --- | --- |
| `default`（primary） | `#FF6F00` | `#FFFFFF` | 无 | `bg-primary/90` |
| `secondary` | `#F4F5F7`（Grey-2） | `#1D2129` | 无 | `bg-black/[0.04]` |
| `outline` | 透明 | `#1D2129` | `#E5E6EB` | `bg-black/[0.02]` |
| `ghost` | 透明 | `#4E5969` | 无 | `bg-black/[0.02]` |
| `destructive` | `#FA3C3C` | `#FFFFFF` | 无 | `bg-destructive/90` |
| `link` | 透明 | `#FF6F00` | 无 | `underline` |

### 状态

| 状态 | 视觉 |
| --- | --- |
| Loading（带 spinner） | spinner 继承按钮文字色 / 左侧 / 禁用点击 |
| Disabled | `opacity-50` + `cursor-not-allowed` |
| Active | `scale-[0.98]` + 主色 `bg-primary/80` |
| Focus | ring-2 ring-primary ring-offset-2（仅 keyboard focus） |

---

## Tag / Pill / 徽章（🟡 **v0.2 初版**）

### 通用

| 字段 | 值 |
| --- | --- |
| 圆角 | `rounded-sm`（4px，方角 tag） / `rounded-full`（pill） |
| 字号 | `12px` |
| 行高 | `18px` |
| 内距 | 水平 `8px` / 垂直 `2px` |
| 字重 | `500`（`font-medium`） |

### 类型变体

| 类型 | 背景 | 文字 | 边框 |
| --- | --- | --- | --- |
| `default` / `neutral` | `#F0F1F2`（Grey-3） | `#4E5969`（Grey-9） | 无 |
| `brand` / `primary` | `bg-primary/10` | `#FF6F00` | 无 |
| `success` | `bg-success/10` | `#28C840` | 无 |
| `warning` | `bg-warning/10` | `#FEBC2E` | 无 |
| `error` | `bg-destructive/10` | `#FA3C3C` | 无 |
| `info` | `bg-primary/10` | `#FF6F00` | 无 |
| `muted` | `#F4F5F7`（Grey-2） | `#86909C`（Grey-8） | 无 |
| 首页 3 张卡上的 tag（经营管理 / 任务监控 / 结算对账） | `#F4F5F7` | `#4E5969` | 无 |

### 尺寸变体

| 尺寸 | 字号 | 内距 |
| --- | --- | --- |
| `sm` | 11px | `4px 6px` |
| `md`（默认） | 12px | `6px 8px` |
| `lg` | 13px | `6px 10px` |

### 特殊变体（🟡 待补充）

| 类型 | 视觉 |
| --- | --- |
| 数字角标 / 红点（badge dot） | 待定（建议 8px 圆点，`#FA3C3C`，绝对定位 top-right） |
| 可关闭 tag | 待定（建议右侧 `X` 图标，hover 时显示） |
| 可选中 tag（filter chip） | 待定（未选中 = `default`，选中 = `brand`） |

---

## 业务组件视觉规范（🟡 **v0.2 初版**）

### 对话气泡

#### 用户消息（user）

| 字段 | 值 |
| --- | --- |
| 背景 | `#FF6F00`（primary 实底，也可改渐变） |
| 文字 | `#FFFFFF` |
| 圆角 | `rounded-2xl`（16px） |
| 内距 | `px-4 py-3` |
| 对齐 | right |
| 头像 | 无 |
| 最大宽度 | `max-w-[70%]` |
| 气泡间距 | `16px` |

#### AI 消息（assistant）

| 字段 | 值 |
| --- | --- |
| 背景 | 透明（无气泡） |
| 文字 | `#1D2129`（Grey-10） |
| 圆角 | — |
| 内距 | — |
| 对齐 | left |
| 头像 | 无独立头像（直接显示文字） |
| 最大宽度 | 全宽（占满内容区） |

#### 系统消息（system）

| 字段 | 值 |
| --- | --- |
| 背景 | `#F4F5F7`（Grey-2） |
| 文字 | `#4E5969`（Grey-9） |
| 圆角 | `rounded-lg`（8px） |
| 内距 | `px-3 py-2` |
| 对齐 | left |
| 带图标 | yes（如 AlertCircle / Info） |
| 可折叠 | yes（"深度思考"那种可展开） |
| 字号 | `13px` |

#### 流式中状态

| 字段 | 值 |
| --- | --- |
| 特殊视觉（边框/扫光） | 🟡 待定 |
| 完成时切换过渡 | `200ms ease-out` |

### 代码块（CodeBlock）

#### 容器

| 字段 | 值 |
| --- | --- |
| 背景 | `#F4F5F7`（Grey-2） |
| 边框 | `1px solid #E5E6EB` |
| 圆角 | `8px`（`rounded-lg`） |
| 内距 | `16px` |
| 溢出 | `overflow-x-auto` |

#### 顶部信息条（语言徽章 + 复制按钮）

| 字段 | 值 |
| --- | --- |
| 是否有 | yes |
| 背景 | `#E5E6EB`（Grey-4，比容器略深） |
| 高度 | `36px` |
| 语言徽章 | 左侧，`12px / #86909C / rounded-sm` |
| 复制按钮 | 右侧，icon-only（Copy 图标） |
| 复制反馈 | check 图标 + `#28C840` + `1500ms` 后复原 |

#### 行号区

- **不显示行号**

#### 代码区

| 字段 | 值 |
| --- | --- |
| 字体 | `font-mono` |
| 字号 | `13px` |
| 行高 | `20px` |
| 颜色 | `#1D2129`（Grey-10） |
| 语法高亮 | no（暂不开启） |

#### 内联 code

| 字段 | 值 |
| --- | --- |
| 背景 | `#F0F1F2`（Grey-3） |
| 文字 | `#1D2129` |
| 圆角 | `4px`（`rounded-sm`） |
| 内距 | `2px 4px` |
| 字号 | `12px`（略小于正文） |

#### 折叠 / 展开

| 字段 | 值 |
| --- | --- |
| 超过几行折叠 | `4 行` |
| 折叠后高度 | `4 行高度` ≈ `80px` |
| 展开方式 | 用滚动条（不用单独的展开按钮） |

### 工具调用卡片（ToolCallCard）

#### 通用

| 字段 | 值 |
| --- | --- |
| 圆角 | `8px`（`rounded-lg`） |
| 内距 | `px-3 py-2` |
| 字号 | `13px` |
| 工具名字体 | `font-mono` |
| 工具名字号 | `13px` |
| 可折叠 | yes（可见展开/收起箭头） |

#### Running

| 字段 | 值 |
| --- | --- |
| 边框 | `1px solid #E5E6EB` |
| 背景 | `#F7F8FA`（Grey-1） |
| 主图标 | spinner |
| 图标颜色 | `#FF6F00`（primary） |
| 扫光动画 | 🟡 待定（先不加） |
| 持续时间显示 | 🟡 待定 |

#### Completed

| 字段 | 值 |
| --- | --- |
| 边框 | `1px solid #E5E6EB` |
| 背景 | `#F7F8FA` |
| 主图标 | CheckCircle |
| 图标颜色 | `#28C840`（success） |

#### Error

| 字段 | 值 |
| --- | --- |
| 边框 | `1px solid #FA3C3C`（destructive） |
| 背景 | `bg-destructive/5` |
| 主图标 | AlertCircle |
| 图标颜色 | `#FA3C3C` |

### 流式光标 + 脉冲

#### 流式光标（光标 token 时呼吸）

```tsx
// 推荐参数
animate={{
  opacity: [0.35, 1, 0.45],
  scaleX: [0.92, 1.08, 0.96],
}}
transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
```

| 字段 | 值 |
| --- | --- |
| 宽度 | `2px` |
| 高度 | `1em`（贴文字行高） |
| 颜色 | `#FF6F00`（primary） |
| 阴影 / 高光 | 🟡 待定（先不加） |

#### 脉冲指示（"生成中…"小圆点）

```tsx
// 外层 ripple
animate={{ scale: [0.8, 1.8], opacity: [0.45, 0] }}
transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}

// 内层圆点
animate={{ scale: [0.92, 1.15, 0.92] }}
transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
```

| 字段 | 值 |
| --- | --- |
| 圆点尺寸 | `8px` |
| 圆点颜色 | `#FF6F00`（primary） |

---

## Loading / Empty / Error 三态（🟡 **v0.2 初版**）

### 项目组件约定（基于当前代码）

```tsx
// 通用状态优先复用 src/components/common/FeedbackState.tsx
<FeedbackState state="loading" title={loadingText} />
<FeedbackState state="empty" title={emptyText} action={optionalAction} />
<FeedbackState state="error" title={errorText} action={retryAction} />
```

项目同时存在 `LoadingSpinner` 和 feature 专属 Skeleton / 状态实现。沿用当前 feature 已有模式，不为满足规则创建不存在的 `LoadingState` / `EmptyState` / `ErrorState`。

### Loading

| 字段 | 值 |
| --- | --- |
| 主用 Spinner / Skeleton | Spinner 为主（结构稳定的列表可用 Skeleton） |
| 全屏 Loading | 🟡 待定（建议 spinner 居中 + 半透明遮罩） |
| 区块 Loading | spinner |
| Skeleton 背景 | `#F0F1F2`（Grey-3） |
| Skeleton 高亮（扫过）| `#F7F8FA`（Grey-1） |
| Skeleton 动画 duration | `1500ms` |
| Loading 文案样式 | `14px` / `#86909C`（Grey-8） |
| 最小展示时长（防闪烁） | 默认 `500ms`（复用 `useMinLoading`；特殊场景显式传参） |

### Empty

| 字段 | 值 |
| --- | --- |
| 插画 / 图标 | lucide icon（如 `Inbox` / `FolderOpen`） |
| 插画尺寸 | `48px`（`h-12 w-12`） |
| 插画颜色 | `#C9CDD4`（Grey-5） |
| 标题文字色 | `#4E5969`（Grey-9） |
| 副文字色 | `#86909C`（Grey-8） |
| 标题字号 | `15px` |
| 副文字字号 | `13px` |
| 是否带 action 按钮 | 按场景（如"新建任务"） |
| 整体内距 | `40px` |
| 居中方式 | 垂直水平居中 |

### Error

| 字段 | 值 |
| --- | --- |
| 图标 | `AlertCircle` |
| 图标颜色 | `#FA3C3C`（destructive） |
| 图标尺寸 | `48px` |
| 文字色 | `#4E5969`（Grey-9） |
| Retry 按钮 | 必带（硬规则） |
| Retry 按钮样式 | `outline` / `secondary` |
| 布局 | 居中 |

---

## Modal / Dialog / Drawer（🟡 **v0.2 初版**）

### Modal

| 字段 | 值 |
| --- | --- |
| 默认宽度（sm / md / lg / xl） | `400 / 560 / 720 / 900px` |
| 高度策略 | 自适应 + 限高内部滚动 |
| 内距 | `24px` |
| 圆角 | `16px`（`rounded-2xl`） |
| 阴影 | `shadow-modal` |
| 遮罩颜色 | `bg-black/20` |
| 遮罩 blur | no |
| 入场动画 | fade + zoom-in（95%→100%）`200ms ease-out` |
| 出场动画 | fade + zoom-out `150ms ease-in` |
| 关闭按钮位置 | top-right |

### Drawer

| 字段 | 值 |
| --- | --- |
| 默认宽度（右侧栏） | `400px` |
| 默认高度（底部栏） | `60vh` |
| 入场动画 | slide from right/bottom `300ms ease-out` |
| 遮罩 | 同 Modal `bg-black/20` |

---

## Toast / Notification（🟡 **v0.2 初版**）

| 字段 | 值 |
| --- | --- |
| 默认位置 | bottom-center |
| 单条宽度 | `max-w-[400px]` |
| 自动消失时长 | `3000ms` |
| 同时最多显示 | `3` 条 |
| 错误类可手动关闭 | yes |
| 入场动画 | slide from bottom + fade `200ms ease-out` |
| 出场动画 | slide to bottom + fade `150ms ease-in` |
| 阴影 | `shadow-elevated` |
| 类型差异 | 主要靠左侧彩色图标 + 文字 |

```tsx
// sonner 已配置 glass 主题 override
import { toast } from 'sonner';
toast.success(t('saved'));
toast.error(toUserMessage(err));
```

---

## 图片处理（🟡 **v0.2 初版**）

### 必须

- 资源**必须** `import` 由 Vite 处理：

  ```tsx
  import logoSvg from '@/assets/logo.svg';
  <img src={logoSvg} alt="" width={58} height={58} />
  ```

- **禁止**裸路径字符串 `<img src="/assets/...">`
- 装饰图片 `alt=""`，有语义的写描述
- 显式 `width` + `height` 防布局抖动

### 占位 / Fallback

| 字段 | 值 |
| --- | --- |
| 头像默认占位 | 首字母 |
| 头像占位背景 | `#E5E6EB`（Grey-4） |
| 头像占位文字 | `#4E5969`（Grey-9） |
| 内容图片 fallback | `ImageOff` 图标 + 灰底 |
| 加载失败显示 | 同 fallback |
| aspect-ratio 默认 | 头像 `aspect-square` / 卡片图 `16/9` |
| 圆角默认 | 头像 `rounded-full` / 缩略图 `rounded-lg` / 大图 `rounded-xl` |
| 是否懒加载 | yes（硬规则） |

---

## 侧栏文字色（🟢 **已强制** — MasterGo 8:46454 MCP goto/U0JBJlCx）

> 来源：MasterGo「调整标题颜色+任务icon」6 帧交互稿；MCP `paint_4:0441` / `0490` / `0520`。
> **实现**：CSS 变量 `globals.css` → surface class `src/lib/surfaces.ts` → `Sidebar.tsx` / `sidebar-brand-header.tsx`。
> **禁止**侧栏业务代码裸写 `#86909C` / `#4E5969` / `#393E47` / `#1D2129` 等 hex。

### MCP → Token 映射

| 层级 | MasterGo Token | Hex | Grey | CSS Variable | Surface Class |
| --- | --- | --- | --- | --- | --- |
| 一级正文（主导航 / 数据中心二级 / 项目 / 任务 / 最近） | 侧栏正文 | `#393E47`（暗色 `#E5E6EB`） | — | `--sto-sidebar-text-default` | `sidebarTextDefaultClass` / `sidebarListItemTextClass` |
| 行内图标（主导航 / 任务清单 / 设置） | 文字/文本-浅色-二级信息 | `#4E5969` | Grey-9 | `--sto-sidebar-text-icon` | `sidebarTextIconClass` |
| 分区标题 / 版本号 / chevron 默认 | 文字/文本-更浅-三级信息 | `#86909C` | Grey-8 | `--sto-sidebar-text-section` | `sidebarSectionLabelClass` / `sidebarBrandVersionClass` |
| 分区标题 hover | 侧栏正文（字重不变） | `#393E47`（暗色 `#E5E6EB`） | — | 同上 | `group-hover` → default，**仍 Regular 400** |
| 主导航选中 / 分区 hover 底 | — | `#EAEAED` | — | `--sto-sidebar-row-hover-bg` | `sidebarNavExpandedActiveClass` / section toggle hover / 任务组行 hover |
| 最近运行中 spinner | — | `#5F9274` | — | `--sto-sidebar-running-spinner` | `sidebarRunningSpinnerClass` |
| 未读红点 | destructive | `#FA3C3C` | — | `bg-destructive` | `sidebarUnreadDotClass`（**6×6px**） |
| 路由选中子项底 | Grey-4 | `#E5E6EB` | Grey-4 | `--sto-sidebar-subitem-active-bg` | `sidebarSubitemTextActiveClass` |
| 底部账号名 | — | `#1A1A1A` | — | `--sto-sidebar-footer-name` | `sidebarFooterNameClass` |
| 底部 ID / 元信息 | — | `#8B9099` | Grey-6 | `--sto-sidebar-footer-meta` | `sidebarFooterMetaClass` |

### 字号 / 字重（侧栏内）

> **字重原则**：侧栏列表/导航**默认全部 Regular 400**（MCP `font_4:0587` / `font_4:0607` / `font_8:35114`）；选中 / hover **仅改颜色或底色，不加粗**。

| 场景 | 字号 / 行高 | 字重 | Surface |
| --- | --- | --- | --- |
| 主导航 / 任务组 / 子项 / 最近 / 分区标题 | `text-sm` 14 / 20 | **Regular 400** | `sidebarBodyTextClass` |
| 主导航选中 / 子项路由选中 | `text-sm` 14 / 20 | **Regular 400** + 底色 | `sidebarNavExpandedActiveClass` / `sidebarSubitemTextActiveClass` |
| 品牌版本号 | `text-[11px]` / 13 | Regular（SF Pro） | `sidebarBrandVersionClass` |
| 「展开全部」等辅助链 | `text-xs` 12 | **Regular 400** | `sidebarMetaLinkClass` |
| 底部账号名 | `text-sm` 14 / 18 | **Regular 400** | `sidebarFooterNameClass` |
| 底部 ID | `text-[13px]` / 18 | Regular 400 | `sidebarFooterMetaClass` |

### 复用 surface 清单

`sidebarBodyTextClass` / `sidebarBodyTextMediumClass` / `sidebarTextDefaultClass` / `sidebarTextIconClass` / `sidebarTextSectionClass` / `sidebarBrandVersionClass` / `sidebarSectionLabelClass` / `sidebarSectionChevronClass` / `sidebarNavExpandedIdleClass` / `sidebarNavExpandedActiveClass` / `sidebarListItemTextClass` / `sidebarSubitemTextIdleClass` / `sidebarSubitemTextActiveClass` / `sidebarMetaLinkClass` / `sidebarRunningSpinnerClass` / `sidebarUnreadDotClass` / `sidebarFooterNameClass` / `sidebarFooterMetaClass` / `sidebarFooterSettingsIconClass`（`src/lib/surfaces.ts`）。

---

## 业务专属视觉（🟡 **v0.2 初版**）

| 场景 | 视觉规范 |
| --- | --- |
| 侧栏选中项（主导航） | 底 `#EAEAED` + 正文 `#393E47` **Regular**（暗色走对应 token，见 §侧栏文字色） |
| 任务组 | `ClipboardList` h-4 + 手风琴（默认全收起，同时仅一组展开）+ 组级 chevron |
| 最近会话状态 | 运行 `#5F9274` spinner > 失败 destructive 图标 > 未读 6px 红点；折叠图标列同规则 |
| 侧栏折叠按钮 | 左上角，面板/汉堡图标 |
| 顶部 tab 切换 | 橙色下划线 `#FF6F00` `2px`（如"技能广场/我的技能"） |
| "新消息"红点 | 位置 top-right，尺寸 `8px`，色 `#FA3C3C` |
| "↓ 有新消息"按钮（对话窗口） | bottom-center，圆角，↓ 箭头 |
| 任务状态徽章（idle / running / done / error）| 复用 Tag 类型变体 |
| "即将上线" / "Coming Soon" 蒙层 | 半透明白色蒙层 + 居中文字 |
| 网点管理员卡片（侧栏底部）| 姓名（`font-semibold`） + ID 灰色小字 + 设置齿轮图标 |

---

## 业务术语视觉对照（🟡 待逐步补充）

| 业务概念 | 视觉规范 |
| --- | --- |
| "任务运行中" | running 工具调用卡 + primary 边框 + spinner |
| "新消息提示" | 红点 `#FA3C3C` 8px / NavItem 右侧 |
| "已读未读" | 🟡 待定 |
| "权限不足" | destructive 文字 + AlertCircle 图标 |
| "深度思考" | 系统消息样式 + 可折叠 |
| "工具调用" | 工具调用卡片（按 running / completed / error 三态） |
| "流式生成中" | StreamingCursor 光标 + StreamingPulse 脉冲 |

---

## AI 生成样式后必须自检

### 通用（已确定）

- [ ] 没有 inline `style={...}`
- [ ] 用 `cn()` 拼 className，没用模板字符串
- [ ] 新增或修改的可见组件在亮色 / 暗色下均可读，必要的 `dark:` 与语义 token 已保留
- [ ] 装饰图标加了 `aria-hidden`
- [ ] 语义图标（按钮替代文字）加了 `aria-label`
- [ ] focus 样式可见（用 `focus-visible:ring-*`）
- [ ] 没用全局 `outline: none`
- [ ] 用真实 `<button>` / `<a>`，没有 `<div onClick>`
- [ ] 没引入其他图标库
- [ ] 浮层用 Radix Portal（不是裸 `position: fixed`）
- [ ] shadcn 原件状态动画用 `data-[state=...]`，不用 Framer Motion
- [ ] 动画走 `transform` / `opacity`，没动 layout 属性

### Token 一致性

- [ ] 颜色用语义 Tailwind token（`bg-primary` / `text-foreground` 等），没用任意值
- [ ] 间距用项目 token，没硬编码
- [ ] 圆角用项目 token（13 档），没 `rounded-[7px]` 任意值
- [ ] 阴影用项目 token（4 档），没硬编码阴影
- [ ] 描边用项目颜色（10 场景），粗细只用 `1px` 或 `2px`
- [ ] 动画 duration 用 `120 / 200 / 300ms` 三档，easing 用规范的 4 类
- [ ] 状态色用语义（`destructive` / `warning` / `success`），不直接写 hex

### 业务组件

- [ ] 对话气泡按 user / assistant / system 三种角色分类样式
- [ ] 代码块用 `font-mono` + `13px` + 折叠 4 行
- [ ] 工具调用卡按 running / completed / error 三态切换边框 + 图标
- [ ] Loading / Empty / Error 三态优先复用 `FeedbackState` / `LoadingSpinner` 或当前 feature 已有状态组件
- [ ] Tag 用类型变体（`brand` / `success` / `warning` / `error` / `info` / `muted` / `neutral`），不直接拼色

---

## 还待 close 的 🟡 项（v0.3 目标）

按优先级排：

1. **链接默认色 / hover 色** —— 当前先复用 primary，等设计师 review
2. **Hover 边框颜色** —— 当前沿用默认或主色，等确认
3. **流式中状态视觉**（扫光参数）—— 实现后看效果再 close
4. ~~**侧栏折叠触发断点**~~ ✅ 已 close（手动折叠，不按宽度触发）
5. **Badge / 可关闭 tag / filter chip** —— 实际业务用到时再定
6. **prefers-reduced-motion 支持** —— 默认建议 respect
7. **全屏 Loading 样式** —— 实现时定
8. **"已读未读" 视觉** —— 业务用到时定

---

## 怎么和 Cursor 一起填剩余 TODO

1. **挑一个 🟡 项**（推荐顺序：链接色 → Hover 边框 → 流式状态 → 其他）
2. **给 Cursor 输入**：截图 / 描述 / Figma 链接
3. **指令模板**：
   > 按 `02-styles.mdc` 第 "🟡 待 close 项" 的第 N 项，
   > 当前设计是 [描述/截图]，帮我把规范写进对应章节。
4. **Cursor 编辑后**，把对应章节的 🟡 改成 🟢，并把项目从 v0.3 目标里移除
