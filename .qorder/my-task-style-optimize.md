# MyTask 页面 UI 还原度优化计划

## 背景

MyTask 页面 14 个 Task 均已完成实现，但与 HTML 原型 (`stoclaw-design/scheduled-tasks/scheduled-tasks.html`) 在颜色、组件结构、弹窗样式、页面级细节上存在差距。本计划按优先级分三阶段逐步对齐原型。

---

## 一、颜色差异（高优先级）

| # | 位置 | 原型值 | React 实现 | 差距说明 |
|---|------|--------|------------|----------|
| 1 | **新建定时任务按钮** | `background: #111; color: #fff` (黑底白字) | `bg-primary text-primary-foreground` (Brand-6 `#FF6F00` 橙底白字) | **最大差距**。原型用深黑按钮，React 用 STO 品牌橙。需对齐原型 |
| 2 | **新建按钮阴影** | `box-shadow: 0 2px 10px rgba(0,0,0,0.15)` | 无阴影 | 原型按钮有投影，增强立体感 |
| 3 | **排序下拉选中项** | `background: var(--orange-soft) #fff3e0; color: var(--orange) #ff8c00` | `bg-primary/5 text-primary` (#FF6F00 淡底+深字) | 色调接近但原型用的是 `#ff8c00` (Orange)，不是 Brand-6 |
| 4 | **排序下拉 hover** | `background: var(--orange-soft); color: var(--orange)` | `hover:bg-muted` (灰色) | 原型 hover 为品牌浅橙，React 为灰色 |
| 5 | **详情弹窗 status pill - success** | `color: #1f9d57; background: #e3f7ec` | `text-green-700 bg-green-50` (#15803d / #f0fdf4) | Tailwind 绿色与原型不匹配 |
| 6 | **详情弹窗 status pill - failed** | `color: #d04338; background: #fdeceb` | `text-red-700 bg-red-50` (#b91c1c / #fef2f2) | Tailwind 红色与原型不匹配 |
| 7 | **详情弹窗 status pill - running** | `color: #3b82f6; background: #e8f1fe` | `text-blue-500 bg-blue-50` (#3b82f6 / #eff6ff) | 蓝色文字匹配，但背景色 #eff6ff ≠ #e8f1fe |
| 8 | **详情弹窗失败原因** | `color: #d04338` | `text-red-700` (#b91c1c) | 不匹配 |
| 9 | **筛选下拉选中项** | `background: #eef0ff; color: #4f46a8` | `bg-indigo-50 text-indigo-700` (#eef2ff / #4338ca) | 背景和文字色略有偏差 |

### Phase 1 优化项：颜色对齐

1. **新建按钮颜色** → `bg-[#111] text-white shadow-[0_2px_10px_rgba(0,0,0,0.15)]`，hover 加 `hover:brightness-[1.08]`，active 加 `active:brightness-[0.96]`
2. **排序下拉选中/hover** → 选中 `bg-[#fff3e0] text-[#ff8c00] font-semibold`，hover `bg-[#fff3e0] text-[#ff8c00]`
3. **详情弹窗 status pill** → 用精确 hex：
   - success: `text-[#1f9d57] bg-[#e3f7ec]`
   - failed: `text-[#d04338] bg-[#fdeceb]`
   - running: `text-[#3b82f6] bg-[#e8f1fe]`
4. **详情弹窗失败原因** → `text-[#d04338]`
5. **筛选下拉选中项** → `bg-[#eef0ff] text-[#4f46a8] font-semibold`
6. **搜索框 focus** → `focus:border-[#c5cad3] focus:shadow-[0_0_0_3px_rgba(15,23,42,0.06)] focus:ring-0`，去掉 `ring-primary`

---

## 二、组件结构差异（高优先级）

| # | 位置 | 原型值 | React 实现 | 差距说明 |
|---|------|--------|------------|----------|
| 10 | **TaskCard 圆角** | `border-radius: 16px (var(--radius-lg))` | `rounded-xl` → 映射到 `var(--radius)` = 0.5rem = 8px | 圆角从 16px 缩到 8px，视觉差异明显 |
| 11 | **TaskCard 缺少工作流标签** | `.task-card__flowtag` (紫色 pill `color: #4f46a8; background: #eeedfe; border: 1px solid #dcd9f7`) | TaskCard 组件完全未渲染 | **结构性缺失** |
| 12 | **RecordItem 圆角** | `border-radius: 12px` | `rounded-xl` → 映射到 8px | 圆角不匹配 |
| 13 | **排序下拉 trigger 圆角** | `border-radius: 10px` | `rounded-lg` → 映射到 8px | 圆角不匹配 |
| 14 | **排序下拉面板圆角** | `border-radius: 12px` | `rounded-lg` → 映射到 8px | 圆角不匹配 |
| 15 | **排序下拉选中勾选图标** | `.task-sort-picker__check` ✓ 图标 | 无勾选图标 | 结构缺失 |

### Phase 2 优化项：组件结构对齐

7. **TaskCard 圆角** → `rounded-2xl`（16px）替代 `rounded-xl`
8. **RecordItem 圆角** → `rounded-[12px]` 替代 `rounded-xl`
9. **排序下拉圆角** → trigger `rounded-[10px]`，面板 `rounded-[12px]`
10. **TaskCard 添加工作流标签** → 当 `task.workflowName` 存在时，标题行渲染 flowtag pill：
    - `inline-flex items-center gap-[4px] ml-[6px] px-[7px] py-[1px] rounded-full text-[11px] font-medium leading-[1.55] text-[#4f46a8] bg-[#eeedfe] border border-[#dcd9f7] whitespace-nowrap`
11. **排序下拉添加选中勾选图标** → 选中项右侧显示 ✓ SVG 图标，未选中时图标 `opacity: 0`
12. **TaskCard "立即运行"按钮字号** → `text-[12px]` 对齐原型 `font-size: 12px`

---

## 三、弹窗与页面级差异（中优先级）

| # | 位置 | 原型值 | React 实现 | 差距说明 |
|---|------|--------|------------|----------|
| 16 | **弹窗遮罩透明度** | `rgba(15, 23, 42, .42)` | `bg-slate-900/40` (0.4) | 透明度差 0.02 |
| 17 | **弹窗面板阴影** | `box-shadow: 0 24px 60px rgba(15,23,42,.22)` | `shadow-2xl` (Tailwind 默认) | 原型阴影更柔和 |
| 18 | **弹窗内边距** | head `padding: 20px 22px 4px`; body `padding: 8px 22px 22px` | `px-5 pt-5 pb-1` (20px); `px-5 pt-2 pb-5` (20px) | 原型左右 22px，React 20px |
| 19 | **弹窗行间距** | `padding: 11px 0` | `py-2.5` (10px) | 微小差距 |
| 20 | **标题字号** | `clamp(20px, 3vw, 26px)` (响应式) | `text-xl` (固定 20px) | 原型大屏标题更大 |
| 21 | **卡片网格间距** | `gap: clamp(12px, 1.4vw, 16px)` | `gap-4` (固定 16px) | 原型小屏间距更紧凑 |
| 22 | **搜索框尺寸** | `width: 184px; height: 34px` | `h-9 w-48` (36px × 192px) | 高度差 2px，宽度差 8px |
| 23 | **搜索框 focus 样式** | `border-color: #c5cad3; box-shadow: 0 0 0 3px rgba(15,23,42,0.06)` | `focus:ring-2 focus:ring-primary/30 focus:border-primary` | 原型用灰色环，React 用品牌色环 |
| 24 | **ViewTabs 底部指示器** | 原型靠 `font-weight` 切换 + `padding-bottom: 8px` | `border-b-2 border-foreground` (加了下边框) | 实现方式不同 |

### Phase 3 优化项：页面级和弹窗微调

13. **标题字号** → `text-[clamp(20px,3vw,26px)]` 或响应式 `text-xl md:text-[26px]`
14. **卡片网格间距** → `gap-[clamp(12px,1.4vw,16px)]` 或 `gap-3 sm:gap-4`
15. **弹窗面板内边距** → head/body 改为 `px-[22px]`；面板阴影改为 `shadow-[0_24px_60px_rgba(15,23,42,0.22)]`
16. **遮罩层** → `bg-[rgba(15,23,42,0.42)]`
17. **搜索框尺寸** → `h-[34px] w-[184px]`
18. **ViewTabs** → 移除 `border-b-2`，改为纯 `font-weight` 切换 + `pb-2`，对齐原型 `.task-tab` 样式

---

## 涉及文件清单

| 文件 | 优化阶段 |
|------|----------|
| `src/pages/MyTask/components/TaskToolbar.tsx` | Phase 1 (新建按钮)、Phase 2 (排序下拉) |
| `src/pages/MyTask/components/RecordToolbar.tsx` | Phase 1 (搜索框 focus)、Phase 2 (圆角) |
| `src/pages/MyTask/components/RecordDetailModal.tsx` | Phase 1 (status pill)、Phase 3 (弹窗间距) |
| `src/pages/MyTask/components/RecordItem.tsx` | Phase 2 (圆角) |
| `src/pages/MyTask/components/TaskCard.tsx` | Phase 2 (圆角、工作流标签) |
| `src/pages/MyTask/components/ViewTabs.tsx` | Phase 3 (移除底部边框) |
| `src/pages/MyTask/components/RecordStatusNav.tsx` | 无变更（已对齐） |
| `src/pages/MyTask/index.tsx` | Phase 3 (标题字号、网格间距) |

---

## 执行顺序建议

1. **Phase 1 → Phase 2 → Phase 3** 依次执行
2. 每阶段完成后运行 `tsc --noEmit` + `eslint src/pages/MyTask/` 验证
3. 最终在 dev server 上视觉验证双视图切换、弹窗、卡片网格等完整交互流程