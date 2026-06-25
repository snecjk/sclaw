# MyTask 页面 UI 还原度优化计划

   主要差异汇总

    P0 阻断级（2项）：
     - TaskCard 引用了不存在的 Task 类型（应为 TaskViewModel）
     - TaskCard 使用了不存在的 scheduleText 字段（应为 cronExpr + parseScheduleToLabel 转换）

    P1 视觉明显偏差（12项）：
     - 新建按钮：原型黑色 #111，实现用了 bg-primary（可能橙色），且缺少阴影
     - 排序下拉选中项：原型橙色系 #ff8c00/#fff3e0，实现用主色系
     - 详情弹窗状态 Pill：原型自定义绿/红/蓝（#1f9d57/#d04338/#3b82f6），实现用 Tailwind 默认值色偏暗
     - 弹窗遮罩：原型统一 rgba(15,23,42,0.42)，实现两处不一致且多了 backdrop-blur
     - TaskCard 圆角：原型 16px，实现 12px
     - 页面标题：原型 24-30px，实现 20px
     - 搜索框：原型 34px 高/184px 宽，实现 36px/192px
     - TaskCreateModal 弹窗：原型 820px 宽，实现仅 512px

    P3 缺失功能（2项）：
     - 工作流标签（紫色 pill）完全没有渲染
     - 计划时间可读文本因字段缺失而无法显示
		 
## 概述

对照 `stoclaw-design/scheduled-tasks/scheduled-tasks.html` 原型，对当前 `src/pages/MyTask/` 实现进行 UI 还原度审查。共发现 **5 类差异**：类型/编译错误、颜色偏差、布局/尺寸偏差、组件结构差异、缺失功能。按严重度分为 P0（编译阻断）、P1（视觉明显偏差）、P2（轻微偏差）、P3（增强项）。

---

## P0：类型/编译错误（阻断级）

### P0-1：TaskCard 引用未定义的 `Task` 类型

- **现状**：`TaskCard.tsx` import `type { Task } from '../types'`，但 `types.ts` 只导出 `TaskViewModel`，不存在 `Task`
- **原型期望**：TaskCard 应接收 `TaskViewModel` 类型数据
- **修复**：将 TaskCard 的 `Task` 改为 `TaskViewModel`，所有 props 类型同步更新

### P0-2：TaskCard 使用未定义的 `scheduleText` 字段

- **现状**：`task.scheduleText` 不存在于 `TaskViewModel`，原型中对应字段是 cron 表达式经 `parseScheduleToLabel` 转换后的中文文本
- **原型期望**：卡片底部显示人类可读的计划文本（如"每天 09:00"、"每周一至五 09:00"）
- **修复**：
  1. 从 `ScheduledTasks` 复用或新增 `parseScheduleToLabel(cronExpr)` 工具函数
  2. 在 TaskCard 中调用该函数将 `task.cronExpr` 转为可读文本显示

---

## P1：颜色偏差（视觉明显）

### P1-1：新建按钮颜色 — 黑色 vs 主色

| | 原型 | 实现 |
|---|---|---|
| 背景 | `#111`（纯黑） | `bg-primary`（项目主色，可能是橙色） |
| 文字 | `#fff` | `text-primary-foreground` |
| 阴影 | `0 2px 10px rgba(0,0,0,0.15)` | 无阴影 |
| 圆角 | `8px` | `rounded-lg` (8px) ✅ |
| 字重 | `600` | `font-medium` (500) |

- **修复**：改为 `bg-[#111] text-white shadow-[0_2px_10px_rgba(0,0,0,0.15)] font-semibold`

### P1-2：排序下拉选中项 — 橙色系 vs 主色系

| | 原型 | 实现 |
|---|---|---|
| 选中背景 | `#fff3e0`（橙色浅底 orange-soft） | `bg-primary/5` |
| 选中文字 | `#ff8c00`（橙色） | `text-primary` |
| hover 背景 | `#fff3e0` | `bg-muted` |

- **修复**：改为 `bg-[#fff3e0] text-[#ff8c00] hover:bg-[#fff3e0] font-semibold`（选中时），非选中 hover 保持 `bg-muted`

### P1-3：详情弹窗状态 Pill 颜色偏差

| 状态 | 原型颜色 | 实现颜色 | 偏差 |
|---|---|---|---|
| 成功 | 文字 `#1f9d57` / 背景 `#e3f7ec` | `text-green-700` (#15803d) / `bg-green-50` (#f0fdf4) | 色调偏暗，背景偏白 |
| 失败 | 文字 `#d04338` / 背景 `#fdeceb` | `text-red-700` (#b91c1c) / `bg-red-50` (#fef2f2) | 色调偏暗，背景偏白 |
| 执行中 | 文字 `#3b82f6` / 背景 `#e8f1fe` | `text-blue-500` (#3b82f6) ✅ / `bg-blue-50` (#eff6ff) | 文字匹配，背景偏白 |

- **修复**：改为硬编码精确值
  - success: `text-[#1f9d57] bg-[#e3f7ec]`
  - failed: `text-[#d04338] bg-[#fdeceb]`
  - running: `text-[#3b82f6] bg-[#e8f1fe]`

### P1-4：弹窗遮罩颜色不一致

| 弹窗 | 原型 | 实现 |
|---|---|---|
| RecordDetailModal | `rgba(15,23,42,0.42)` | `bg-slate-900/40` ≈ rgba(15,23,42,0.4) |
| TaskCreateModal | `rgba(15,23,42,0.42)` | `bg-black/40 backdrop-blur-sm` |
| 删除确认弹窗 | `rgba(15,23,42,0.42)` | 待确认 |

- **问题**：1) 透明度 0.42 vs 0.4；2) TaskCreateModal 用 `bg-black` 代替 `rgba(15,23,42)`；3) TaskCreateModal 多了 `backdrop-blur-sm`（原型无此效果）
- **修复**：统一为 `bg-[rgba(15,23,42,0.42)]`，移除 TaskCreateModal 的 `backdrop-blur-sm`

### P1-5：工作流标签颜色 — 紫色系

- **原型**：`color: #4f46a8; background: #eeedfe; border: 1px solid #dcd9f7; border-radius: 999px; font-size: 11px; font-weight: 500; padding: 1px 7px; margin-left: 6px`
- **现状**：TaskCard 中完全没有渲染工作流标签
- **修复**：在 TaskCard 标题行中，当 `task.workflowName` 非空时，渲染紫色 pill 标签

---

## P1：布局/尺寸偏差（视觉明显）

### P1-6：页面标题字号偏小

| | 原型 | 实现 |
|---|---|---|
| 标题字号 | `clamp(24px, 2.8vw, 30px)` | `text-xl` (20px) |
| 标题字重 | `700` | `font-bold` (700) ✅ |
| 描述字号 | `14px` | `text-sm` (14px) ✅ |
| 标题下方间距 | `margin-bottom: 20px` (hero区域) | `mb-6` (24px) |

- **修复**：标题改为 `text-[clamp(24px,2.8vw,30px)]` 或至少 `text-2xl` (24px)；hero 区域 `mb-5` (20px)

### P1-7：TaskCard 圆角偏小

| | 原型 | 实现 |
|---|---|---|
| 卡片圆角 | `16px` (var(--radius-lg)) | `rounded-xl` (12px) |

- **修复**：改为 `rounded-2xl` (16px)

### P1-8：搜索框高度偏差

| | 原型 | 实现 |
|---|---|---|
| 高度 | `34px` | `h-9` (36px) |
| 宽度 | `184px` | `w-48` (192px) |

- **修复**：改为 `h-[34px] w-[184px]`

### P1-9：排序下拉 Trigger 圆角偏差

| | 原型 | 实现 |
|---|---|---|
| 圆角 | `10px` | `rounded-lg` (8px) |
| 高度 | `36px` | `h-9` (36px) ✅ |

- **修复**：改为 `rounded-[10px]`

### P1-10：新建按钮高度偏差

| | 原型 | 实现 |
|---|---|---|
| 高度 | `34px` | `h-9` (36px) |

- **修复**：改为 `h-[34px]`（与 P1-1 合并修复）

### P1-11：TaskCreateModal 弹窗宽度严重偏窄

| | 原型 | 实现 |
|---|---|---|
| 面板宽度 | `min(820px, 100%)` | `max-w-lg` (512px) |
| 面板圆角 | `22px` | `rounded-2xl` (16px) |
| 输入框高度 | `42px` | `h-10` (40px) |

- **修复**：
  - 面板宽度：`max-w-[820px]`
  - 面板圆角：`rounded-[22px]`
  - 输入框高度：`h-[42px]`

### P1-12：ViewTabs 活动态样式偏差

| | 原型 | 实现 |
|---|---|---|
| 活动态底部边框 | `border-bottom` (1px, 隐含) | `border-b-2` (2px) |
| 活动态字重 | `700` | `font-bold` (700) ✅ |
| 非活动态上内边距 | 无 (`padding: 0 0 8px`) | `pt-2 pb-2` (上下均有) |
| 活动态上内边距 | `padding-top: 8px` (覆盖值) | `pt-2` (8px) ✅ |

- **原型 Tab 行为**：所有 Tab 底部有 8px padding，但非活动态没有顶部 padding。只有被覆盖的 `.task-tab` 规则加了 `padding-top: 8px`（与技能广场一级 Tab 一致），这意味着两个状态都有顶部 padding。
- **修复**：将 `border-b-2` 改为 `border-b` (1px)，或确认原型实际表现后调整

### P1-13：卡片网格响应式断点偏差

| | 原型 | 实现 |
|---|---|---|
| 3列触发断点 | `960px` | `lg` (1024px) |

- **修复**：改为 `xl:grid-cols-3`（1280px）或自定义媒体查询。考虑到 Tailwind 没有 960px 断点，最接近的是 `lg`(1024px)，差距不大，可保留或视设计意图调整。

---

## P2：轻微偏差

### P2-1：Tab 行底部间距

| | 原型 | 实现 |
|---|---|---|
| 定时任务视图 | `26px` | `mb-6` (24px) |
| 执行记录视图 | `14px` | `mb-4` (16px) |

- **修复**：定时任务改为 `mb-[26px]`；执行记录视图需根据 `activeView` 动态调整间距

### P2-2：RecordDetailModal DetailRow padding

| | 原型 | 实现 |
|---|---|---|
| 上下内边距 | `11px` | `py-2.5` (10px) |

- **修复**：改为 `py-[11px]`

### P2-3：更多菜单弹出方向

| | 原型 | 无明确指定 | 实现：向下弹出 `top-full mt-1.5` |
|---|---|---|
| ScheduledTasks 版 | 向上弹出 `bottom-full mb-1` | 当前实现向下弹出 |

- **说明**：原型无明确指定，向下弹出是合理的。保持现状。

### P2-4：执行记录列表间距

| | 原型 | 实现 |
|---|---|---|
| 列表 gap | `10px` | `gap-2.5` (10px) ✅ |

- 匹配，无需修改。

### P2-5：开关组件实现方式

- **原型**：自定义 div 开关 (`width:36px; height:20px; border-radius:999px`)
- **实现**：也是自定义 div 开关，尺寸和样式匹配
- **ScheduledTasks 版**：使用 `<Switch>` UI 组件
- **说明**：当前实现与原型视觉一致，但与 ScheduledTasks 页面不一致。考虑统一为 `<Switch>` 或保持与原型一致的 div 实现。

---

## P3：增强项（原型有但实现缺失）

### P3-1：工作流标签渲染缺失

- **原型**：TaskCard 标题后有紫色 pill 标签 `.task-card__flowtag`（`color: #4f46a8; background: #eeedfe; border: 1px solid #dcd9f7; font-size: 11px; padding: 1px 7px; margin-left: 6px`）
- **实现**：TaskCard 完全没有渲染工作流标签
- **修复**：在标题 `<h3>` 内，当 `task.workflowName` 非空时，添加：
  ```tsx
  <span className="ml-1.5 inline-flex items-center gap-1 px-[7px] py-[1px] rounded-full text-[11px] font-medium leading-[1.55] text-[#4f46a8] bg-[#eeedfe] border border-[#dcd9f7] whitespace-nowrap">
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
    工作流任务
  </span>
  ```

### P3-2：计划时间可读文本缺失

- **原型**：卡片底部 `.task-card__schedule` 显示人类可读的计划文本
- **实现**：引用了 `task.scheduleText`（不存在），实际显示为空白或 undefined
- **修复**：见 P0-2，引入 `parseScheduleToLabel` 函数

### P3-3：删除确认弹窗样式偏差

- **原型**：`.task-delete-modal` 有特定样式（宽度 min(400px,100%)，圆角 16px，按钮为 pill 形状 `border-radius:999px`，确认按钮红色实底 `#e53935`）
- **实现**：使用通用 `ConfirmDialog` 组件，样式可能不匹配
- **修复**：检查 `ConfirmDialog` 的实际渲染样式，确认是否匹配原型的 pill 按钮、宽度、圆角等

### P3-4：执行记录空状态样式

- **原型**：`.task-record-empty` = `padding: 40px 0; text-align: center; color: #9ca3af; font-size: 13px`
- **实现**：`py-10 text-center text-[13px] text-muted-foreground`
- **说明**：基本匹配，`py-10` (40px) ✅，`text-[13px]` ✅

---

## 修复优先级排序

| # | 编号 | 严重度 | 组件 | 描述 |
|---|---|---|---|---|
| 1 | P0-1 | 阻断 | TaskCard | `Task` 类型不存在，改为 `TaskViewModel` |
| 2 | P0-2 | 阻断 | TaskCard | `scheduleText` 字段不存在，引入 parseScheduleToLabel |
| 3 | P1-5+P3-1 | 高 | TaskCard | 缺失工作流标签渲染 |
| 4 | P1-1+P1-10 | 高 | TaskToolbar | 新建按钮：黑色背景+阴影+34px高度 |
| 5 | P1-2 | 高 | TaskToolbar | 排序下拉选中项：橙色系 |
| 6 | P1-3 | 高 | RecordDetailModal | 状态 Pill 精确颜色值 |
| 7 | P1-4 | 高 | 多个弹窗 | 遮罩颜色统一 + 移除 backdrop-blur |
| 8 | P1-6 | 高 | index.tsx | 页面标题字号增大 |
| 9 | P1-7 | 高 | TaskCard | 卡片圆角 16px |
| 10 | P1-8 | 高 | TaskToolbar | 搜索框高度 34px、宽度 184px |
| 11 | P1-9 | 高 | TaskToolbar | 排序 Trigger 圆角 10px |
| 12 | P1-11 | 高 | TaskCreateModal | 弹窗宽度 820px、圆角 22px、输入高度 42px |
| 13 | P1-12 | 中 | ViewTabs | 活动态 border-bottom 1px |
| 14 | P2-1 | 低 | index.tsx | Tab 行间距精确值 |
| 15 | P2-2 | 低 | RecordDetailModal | DetailRow padding 11px |
| 16 | P3-3 | 低 | ConfirmDialog | 删除弹窗样式匹配 |

---

## 执行策略

### 第一批：P0 + 核心 P1（TaskCard + 颜色体系）

1. 修复 TaskCard 类型错误（P0-1, P0-2）
2. 添加工作流标签渲染（P1-5/P3-1）
3. 添加 `parseScheduleToLabel` 工具函数
4. TaskCard 圆角改为 16px（P1-7）

### 第二批：颜色统一

5. 新建按钮改为黑色+阴影（P1-1/P1-10）
6. 排序下拉选中项改为橙色系（P1-2）
7. RecordDetailModal 状态 Pill 精确颜色（P1-3）
8. 弹窗遮罩统一 rgba(15,23,42,0.42)，移除 backdrop-blur（P1-4）

### 第三批：布局/尺寸修正

9. 页面标题字号增大（P1-6）
10. 搜索框高度/宽度精确值（P1-8）
11. 排序 Trigger 圆角（P1-9）
12. ViewTabs 活动态边框（P1-12）
13. Tab 行间距（P2-1）

### 第四批：弹窗类修正

14. TaskCreateModal 宽度/圆角/输入高度（P1-11）
15. RecordDetailModal DetailRow padding（P2-2）
16. 检查 ConfirmDialog 删除弹窗样式（P3-3）

---

## 验证方式

每批修改后执行：
1. `tsc --noEmit` — 确认无类型错误
2. `eslint src/pages/MyTask/` — 确认无 lint 错误
3. 浏览器视觉对照 — 与 HTML 原型逐项比对
4. 交互测试 — 确认筛选/搜索/弹窗功能正常