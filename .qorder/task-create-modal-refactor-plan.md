# TaskCreateModal & SchedulePicker 对齐设计稿重构计划

## 目标

将 `sto-claw/src/pages/MyTask/components/TaskCreateModal.tsx` 和 `SchedulePicker.tsx` 的结构与样式对齐 `stoclaw-design/scheduled-tasks/scheduled-tasks.html` L581-793 的设计稿。

## 涉及文件

- `src/pages/MyTask/components/TaskCreateModal.tsx` — 弹窗整体结构
- `src/pages/MyTask/components/SchedulePicker.tsx` — 计划时间选择器

## 设计稿关键样式参数（来自 styles.css）

| 属性 | 设计稿值 | 当前值 | 差异 |
|------|---------|--------|------|
| Modal 宽度 | `min(820px, 100%)` | `max-w-lg (~512px)` | 过窄 |
| Modal 圆角 | `22px` | `rounded-2xl (16px)` | 偏小 |
| Modal 内边距 | `18px 18px 16px` | `px-6 pt-5 pb-2 / px-6 py-4` | 不一致 |
| 表单 field 间距 | `20px` | `space-y-5 (20px)` | OK |
| field 内 label→input 间距 | `8px` | `mb-1.5 (6px)` | 偏小 |
| label 字号/字重 | `14px / 600` | `13.5px / medium` | 偏小 |
| Input 高度 | `42px` | `h-10 (40px)` | 偏矮 |
| Input 圆角 | `10px` | `rounded-lg (8px)` | 偏小 |
| textarea rows | `12` (设计稿) | `6` | 行数不足 |
| 计划时间行 | 横向 flex 均分（频率 1/3，其余均分） | `flex-wrap items-center gap-3` | 布局不对 |
| 下拉面板方向 | 向上展开 (`bottom: calc(100% + 6px)`) | 向下展开 | 方向相反 |
| trigger 高度 | `42px` | `h-10 (40px)` | 偏矮 |
| trigger 圆角 | `10px` | `rounded-lg (8px)` | 偏小 |
| trigger 字号 | `14px / 500` | `13px` | 偏小 |
| panel 圆角 | `12px` | `rounded-lg (8px)` | 偏小 |
| 选中态颜色 | `orange-soft bg + orange text` | `primary/5 bg + primary text` | 颜色不对 |
| 频率下拉选项 | 带 check icon 选中态 | 无 check icon | 缺少图标 |
| 星期选择器 | 多选 listbox（check icon） | checkbox 样式 | 样式不对 |
| 一次性日期 | 自定义日历面板（月/年导航+星期行+today按钮） | `<input type="date">` | 原生控件 |
| 每月日期 | 7 列 grid 面板（1-31 号） | `<select>` | 原生控件 |
| 时间选择器 | 双列（时/分）独立滚动面板+check icon | 单列滚动列表 | 结构不对 |

## 分步任务

### 1. TaskCreateModal.tsx 整体结构对齐
- Modal 宽度改为 `max-w-[820px]`
- 圆角改为 `rounded-[22px]`
- 内边距统一 `p-[18px] pb-[16px]`
- label 字号/字重改为 `text-sm font-semibold`
- field 内 label→input 间距改为 `space-y-2 (8px)`
- input/select 高度改为 `h-[42px]`
- input 圆角改为 `rounded-[10px]`
- textarea rows 改为 `12`

### 2. SchedulePicker.tsx 计划时间行布局对齐
- 改为横向 `flex nowrap` 均分布局
- 频率 picker 固定 `1/3` 宽度
- 日期/星期/月日/时间 picker 均分剩余空间
- 下拉面板改为向上展开（`bottom: calc(100% + 6px)`）

### 3. 频率下拉样式对齐
- trigger 高度 42px、圆角 10px、字号 14px/500
- panel 圆角 12px
- 选中态：`orange-soft bg + orange text + font-semibold`
- 添加 check icon（选中时显示）

### 4. 星期选择器样式对齐
- trigger 42px、圆角 10px、字号 14px/500
- 多选 listbox 样式：选中项橙色背景 + check icon
- 面板向上展开

### 5. 一次性日期选择器 — 自定义日历组件
- trigger 42px、圆角 10px
- 日历面板：月/年导航（« ‹ title › »）、星期行（一二三四五六日）、日期 grid、today 按钮
- 过去日期禁用、选中态橙色、today 根据橙色描边
- 面板向上展开

### 6. 每月日期选择器 — 7 列 grid 面板
- trigger 42px、圆角 10px
- 7×5 grid 面板（1-31 号），选中态橙色圆角 8px
- 面板向上展开

### 7. 时间选择器 — 双列面板
- trigger 42px、圆角 10px、clock icon + chevron icon
- 双列面板：左列小时（0-23），右列分钟（0/5/10...55）
- 每列独立滚动、选中态橙色 + check icon
- 面板向上展开

### 8. Outside click 关闭逻辑
- 统一处理所有下拉面板的 click outside 关闭
- 使用单个 useEffect + document listener 管理

## 设计稿颜色 token 参考（来自 docs/sto-design.md）

| Token | 值 | 用途 |
|-------|-----|------|
| orange | `#c2410c` (STO Brand) | 选中态文字、选中日期背景 |
| orange-soft | `#fff7ed` | 选中态背景、hover 背景 |
| border | `#e5e7eb` | 描边 |
| text | `#111827` | 主文字 |
| text-secondary | `#6b7280` | 次文字 |
| text-muted | `#9ca3af` | 占位符、图标 |