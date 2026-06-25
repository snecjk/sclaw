# MyTask 页面 React 实现计划

## Context

当前 `src/pages/MyTask/index.tsx` 是占位组件（19行），需要基于 `stoclaw-design/scheduled-tasks/scheduled-tasks.html` 原型实现完整页面。原型包含"定时任务"和"执行记录"双视图 Tab 切换，以及新建/编辑/删除弹窗和执行记录详情弹窗。

现有 `pages/ScheduledTasks/` 页面已实现了定时任务卡片、创建弹窗、计划时间选择器等功能，MyTask 页面在此基础上增加执行记录视图和双视图切换。

## 目标文件结构

```
src/pages/MyTask/
├── index.tsx                          # 页面主入口（重写）
├── types.ts                           # 页面级类型定义
├── constants.ts                       # 常量（推荐任务、排序选项、状态配置等）
├── api.ts                             # API 服务层（规范调用 + mock 兜底）
├── store.ts                           # Zustand Store（页面状态管理）
└── components/
    ├── ViewTabs.tsx                    # 一级 Tab（定时任务 / 执行记录）
    ├── TaskToolbar.tsx                 # 定时任务工具栏（搜索+排序+新建）
    ├── RecordToolbar.tsx              # 执行记录工具栏（搜索+任务类型筛选）
    ├── TaskCard.tsx                   # 定时任务卡片（含工作流标签）
    ├── TaskEmptyState.tsx             # 定时任务空状态（含推荐任务）
    ├── RecordStatusNav.tsx            # 执行记录状态筛选
    ├── RecordItem.tsx                 # 单条执行记录
    └── RecordDetailModal.tsx          # 执行记录详情弹窗
```

## 复用策略

| 组件 | 决策 | 来源 |
|------|------|------|
| `SchedulePicker` | 直接复用 import | `../ScheduledTasks/components/SchedulePicker` |
| `TaskCreateModal` | 直接复用 import | `../ScheduledTasks/components/TaskCreateModal` |
| `ConfirmDialog` | 直接复用 import | `@/components/ui/confirm-dialog` |
| `Switch` | 直接复用 import | `@/components/ui/switch` |
| `LoadingSpinner` | 直接复用 import | `@/components/common/LoadingSpinner` |
| `cn()` | 直接复用 import | `@/lib/utils` |
| `hostApiFetch()` | 直接复用 import | `@/lib/host-api` |

## Task 1: 创建类型定义 `types.ts`

```typescript
/** 执行记录状态 */
export type RecordStatus = 'running' | 'success' | 'failed';

/** 任务类型 */
export type TaskType = 'normal' | 'workflow';

/** 执行记录 */
export interface ExecutionRecord {
  id: string;
  taskId: number;            // 关联定时任务 ID
  taskName: string;
  status: RecordStatus;
  taskType: TaskType;
  workflowName?: string;     // 仅 workflow 类型
  triggerMethod: string;     // '定时触发' | '手动触发'
  startTime: string;         // ISO 时间字符串
  duration: string;          // 人类可读耗时
  durationMs: number;        // 毫秒（便于计算）
  failReason?: string;       // 仅 failed 状态
}

/** 执行记录查询参数 */
export interface ExecutionRecordQuery {
  taskId?: number;
  status?: RecordStatus;
  page?: number;
  pageSize?: number;
}

/** 执行记录分页响应 */
export interface ExecutionRecordPage {
  items: ExecutionRecord[];
  total: number;
}

/** 任务视图模型（扩展 ScheduledTask 以适配卡片展示） */
export interface TaskViewModel {
  id: string;
  taskId: number;            // 原始数字 ID
  name: string;
  description: string;
  cronExpr: string;
  enabled: boolean;
  workflowName?: string;     // 非空时显示"工作流任务"标签
  createdAt: string;
  updatedAt: string;
}
```

## Task 2: 创建常量 `constants.ts`

- `SORT_OPTIONS`: 排序选项数组
- `RECORD_STATUS_TABS`: 执行记录状态 Tab 配置
- `RECORD_TYPE_OPTIONS`: 任务类型筛选选项
- `RECOMMEND_TASKS`: 推荐任务（3 条，与 HTML 原型一致）

## Task 3: 创建 API 服务层 `api.ts`

模仿项目现有规范（`hostApiFetch<T>(path, init?)`），但 API 地址为占位符，当前返回 mock 数据。

```typescript
/**
 * MyTask API 服务层
 * 
 * 所有 API 调用遵循项目规范（通过 hostApiFetch），当前使用 mock 数据兜底。
 * 联调时只需：
 *   1. 将 USE_MOCK 改为 false（或由环境变量控制）
 *   2. 替换 API 路径常量中的前缀为真实后端地址
 */
import { hostApiFetch } from '@/lib/host-api';
import type { ExecutionRecord, ExecutionRecordQuery, ExecutionRecordPage } from './types';

/** API 路径前缀 — 联调时替换为真实路径 */
const API_PREFIX = '/api/my-tasks';

/** Mock 开关 — 联调时改为 false 或读取 env */
const USE_MOCK = true;

// ──── 执行记录相关 API ────

/** 获取执行记录列表 */
export async function fetchExecutionRecords(
  query?: ExecutionRecordQuery
): Promise<ExecutionRecordPage> {
  if (USE_MOCK) {
    return mockFetchRecords(query);
  }
  const params = new URLSearchParams();
  if (query?.taskId) params.set('task_id', String(query.taskId));
  if (query?.status) params.set('status', query.status);
  if (query?.page) params.set('page', String(query.page));
  if (query?.pageSize) params.set('page_size', String(query.pageSize));
  const qs = params.toString();
  return hostApiFetch<ExecutionRecordPage>(
    `${API_PREFIX}/execution-records${qs ? `?${qs}` : ''}`
  );
}
```

mock 数据直接内联在 `api.ts` 底部（`mockFetchRecords` 等函数），不单独拆文件，保持 API 层自包含。包含 10 条执行记录（3 running + 4 success + 3 failed），与 HTML 原型一致。

## Task 4: 创建 Zustand Store `store.ts`

遵循项目规范（参照 `stores/scheduledTasks.ts`），管理执行记录数据和页面级筛选状态：

```typescript
import { create } from 'zustand';
import { fetchExecutionRecords } from './api';
import type { ExecutionRecord, RecordStatus, TaskType } from './types';

interface MyTaskState {
  // ── 执行记录数据 ──
  records: ExecutionRecord[];
  recordsLoading: boolean;
  recordsError: string | null;

  // ── 执行记录筛选状态 ──
  recordStatus: RecordStatus;
  recordType: TaskType | 'all';
  recordSearch: string;

  // ── Actions ──
  fetchRecords: () => Promise<void>;
  setRecordStatus: (status: RecordStatus) => void;
  setRecordType: (type: TaskType | 'all') => void;
  setRecordSearch: (q: string) => void;

  /** 派生：筛选后的记录列表 */
  filteredRecords: () => ExecutionRecord[];
  /** 派生：各状态计数（随 type+search 联动） */
  recordCounts: () => { running: number; success: number; failed: number };
}
```

定时任务的 CRUD 继续消费现有的 `useScheduledTasksStore`，不重复实现。

## Task 5: 实现 ViewTabs 组件

Props: `activeView: 'tasks' | 'records'`, `onViewChange`

两个 Tab 按钮，pill 样式切换。对应原型 `.task-view-tabs`。

## Task 6: 实现 TaskToolbar 组件

Props: `searchQuery`, `onSearchChange`, `sortValue`, `onSortChange`, `onCreate`

搜索框 + 排序下拉（4 个选项）+ "+ 新建定时任务" 按钮。参考 `ScheduledTasks/TaskHero.tsx`。

## Task 7: 实现 RecordToolbar 组件

Props: `searchQuery`, `onSearchChange`, `filterType`, `onFilterChange`

搜索框 + 任务类型筛选下拉（全部/普通/工作流）。对应原型 `.task-record-filter`。

## Task 8: 实现 TaskCard 组件

Props: `task: TaskViewModel`, `onToggle`, `onEdit`, `onDelete`, `onTrigger`

与 `ScheduledTasks/TaskCard` 类似但增加：
- **工作流标签**：当 `task.workflowName` 非空时，标题后渲染紫色 pill "工作流任务"
- 包含 `parseScheduleToLabel` 工具函数将 cron 转为人类可读文本

## Task 9: 实现 TaskEmptyState 组件

Props: `searchQuery`, `onCreate`, `onRecommendAdd`

两种状态：无任务（显示推荐卡片网格）/ 搜索无结果。参考现有 `ScheduledTasks/TaskEmptyState`。

## Task 10: 实现 RecordStatusNav 组件

Props: `activeStatus`, `counts`, `onStatusChange`

三个 pill 按钮：执行中(N) / 执行成功(N) / 执行失败(N)。计数随类型筛选和搜索联动更新。

## Task 11: 实现 RecordItem 组件

Props: `record: ExecutionRecord`, `onViewDetail`

状态指示器（running=蓝色旋转, success=绿色, failed=红色）+ 标题 + 元信息 + "查看详情" 按钮。

## Task 12: 实现 RecordDetailModal 组件

Props: `record: ExecutionRecord | null`, `onClose`

遮罩层 + 面板（440px 宽），key-value 行布局。状态 pill 配色：success 绿底、failed 红底、running 蓝底。失败原因行条件显示。Escape 键关闭。

## Task 13: 重写 index.tsx 主组件

集成所有子组件：
- 视图切换：`activeView` 控制定时任务 / 执行记录
- 定时任务视图：搜索、排序、CRUD（消费 `useScheduledTasksStore`）
- 执行记录视图：搜索、状态筛选、类型筛选（消费 `useMyTaskStore`）
- 弹窗：复用 `TaskCreateModal`（新建/编辑）、`ConfirmDialog`（删除）、`RecordDetailModal`（记录详情）
- `useEffect` 中调用 `fetchTasks()` 和 `fetchRecords()` 加载数据

## Task 14: 验证

- TypeScript 编译无错误（`tsc --noEmit`）
- 页面渲染正确（双视图切换、卡片网格、记录列表）
- 交互功能正常（筛选、搜索、弹窗打开/关闭）

## API 层设计要点

1. **`api.ts` 是唯一的 API 出口**：所有后端交互通过此文件，组件不直接调用 `hostApiFetch`
2. **Mock 开关集中控制**：`USE_MOCK` 常量控制，联调时改为 `false` 即可走真实 API
3. **接口签名不变**：mock 函数和真实 API 函数返回相同类型，切换对调用方透明
4. **URL 占位符**：`API_PREFIX = '/api/my-tasks'` 联调时替换为真实路径
5. **遵循项目规范**：使用 `hostApiFetch<T>()`，错误处理、请求头设置与 `scheduledTasks.ts` store 一致

## 关键文件路径

**输入参考**：
- HTML 原型：`stoclaw-design/scheduled-tasks/scheduled-tasks.html`
- 现有 ScheduledTasks 页面：`src/pages/ScheduledTasks/index.tsx`
- 现有 Store 范例：`src/stores/scheduledTasks.ts`
- 现有 API 工具：`src/lib/host-api.ts`（`hostApiFetch<T>`）
- 现有类型：`src/types/scheduled-task.ts`, `src/types/cron.ts`

**输出**：
- 重写：`src/pages/MyTask/index.tsx`
- 新建：`types.ts`, `constants.ts`, `api.ts`, `store.ts`, `components/` 下 8 个组件文件

---

## 实现状态（2026-06-09 更新）

所有 14 个 Task 均已完成 ✅

| Task | 状态 | 备注 |
|------|------|------|
| Task 1: types.ts | ✅ 完成 | RecordStatus, TaskType, TaskView, ExecutionRecord, TaskViewModel 等 |
| Task 2: constants.ts | ✅ 完成 | SORT_OPTIONS, RECORD_STATUS_TABS, RECORD_TYPE_OPTIONS, RECOMMEND_TASKS, STATUS_LABEL |
| Task 3: api.ts | ✅ 完成 | hostApiFetch + USE_MOCK 开关 + 10 条 mock 执行记录 |
| Task 4: store.ts | ✅ 完成 | useMyTaskStore，派生选择器 selectRecordCounts / selectCurrentRecords |
| Task 5: ViewTabs.tsx | ✅ 完成 | 一级 Tab 切换 |
| Task 6: TaskToolbar.tsx | ✅ 完成 | 搜索 + 排序下拉 + 新建按钮 |
| Task 7: RecordToolbar.tsx | ✅ 完成 | 搜索 + 任务类型筛选下拉 |
| Task 8: TaskCard.tsx | ✅ 完成 | 工作流标签、cron 解析、更多菜单 |
| Task 9: TaskEmptyState.tsx | ✅ 完成 | 推荐任务网格 / 搜索无结果 |
| Task 10: RecordStatusNav.tsx | ✅ 完成 | 执行中/成功/失败 + 计数 |
| Task 11: RecordItem.tsx | ✅ 完成 | 状态指示器 + 元信息 + 查看详情 |
| Task 12: RecordDetailModal.tsx | ✅ 完成 | 状态 pill + 失败原因 + Escape 关闭 |
| Task 13: index.tsx | ✅ 完成 | 集成所有子组件、双视图切换、CRUD、弹窗 |
| Task 14: 验证 | ✅ 完成 | tsc --noEmit 零错误、ESLint 零错误、Vite 构建成功 |

### 验证结果

- **TypeScript 编译**：`tsc --noEmit` 无 MyTask 相关错误
- **ESLint**：`eslint src/pages/MyTask/` 零错误零警告
- **Vite 构建**：所有模块正确编译，dev server 正常启动
- **依赖验证**：所有导入（TaskCreateModal、useScheduledTasksStore、hostApiFetch 等）均已确认存在且接口匹配
- **路由注册**：`/my-tasks` 路由已在 `App.tsx` 中配置

### 联调注意事项

1. `api.ts` 中 `USE_MOCK = true`，联调时改为 `false` 并替换 `API_PREFIX`
2. `toViewModel` 中 `workflowName` 判断逻辑为 `task.taskType === 'workflow'`，需确认后端 `taskType` 字段实际值
3. 定时任务 CRUD 消费 `useScheduledTasksStore`，执行记录消费本地 `useMyTaskStore`
