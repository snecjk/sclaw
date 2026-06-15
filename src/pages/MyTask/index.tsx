/**
 * MyTask 页面主入口
 * 包含"定时任务"和"执行记录"双视图 Tab 切换
 * 定时任务 CRUD 消费 useScheduledTasksStore
 * 执行记录数据消费 useMyTaskStore
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useScheduledTasksStore } from '@/stores/scheduledTasks';
import { useChatStore } from '@/stores/chat';
import { navigateToMainChatHome } from '@/lib/main-chat-navigation';
import { useScheduledTaskUnreadStore } from '@/stores/scheduled-task-unread';
import { useShallow } from 'zustand/react/shallow';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import {
  myTaskCreateButtonClass,
  myTaskPageHeaderRowClass,
  stoMainInnerShell,
  stoPageTitleClass,
  workflowListToolbarClass,
} from '@/lib/surfaces';
import { toast } from 'sonner';
import {
  TaskCreateModal,
  type TaskCreateInputWithRun,
} from './components/TaskCreateModal';

import { useMyTaskStore, selectRecordCounts, selectCurrentRecords } from './store';
import type { TaskView, TaskViewModel, ExecutionRecord, RecommendTask } from './types';
import type { CronJob } from '@/types/cron';

import { ViewTabs } from './components/ViewTabs';
import { TaskToolbar } from './components/TaskToolbar';
import { RecordToolbar } from './components/RecordToolbar';
import { TaskCard } from './components/TaskCard';
import { TaskEmptyState } from './components/TaskEmptyState';
import { RecordStatusNav } from './components/RecordStatusNav';
import { RecordItem } from './components/RecordItem';
import { RecordDetailModal } from './components/RecordDetailModal';

// ──── 工具函数 ────

/** 将 ScheduledTask 转换为页面 TaskViewModel */
function toViewModel(
  task: import('@/types/scheduled-task').ScheduledTask,
  workflowMap: Map<string, string>,
): TaskViewModel {
  return {
    id: String(task.id),
    taskId: task.id,
    name: task.name,
    description: task.description || '',
    cronExpr: task.cronExpr,
    enabled: task.enabled,
    nextRunAt: task.nextRunAt,
    workflowName: task.workflowCode ? workflowMap.get(task.workflowCode) : undefined,
    workflowCode: task.workflowCode || undefined,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/** 排序任务列表 */
function sortTasks(tasks: TaskViewModel[], sort: string): TaskViewModel[] {
  const sorted = [...tasks];
  switch (sort) {
    case 'created-asc':
      return sorted.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    case 'created-desc':
      return sorted.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    case 'name-asc':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'name-desc':
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    default:
      return sorted;
  }
}

// ──── 主组件 ────

export default function MyTask() {
  const navigate = useNavigate();
  const location = useLocation();

  // ── 定时任务 Store ──
  const {
    tasks,
    workflowOptions,
    loading: tasksLoading,
    fetchTasks,
    fetchWorkflows,
    createTask,
    updateTask,
    deleteTask,
    toggleTask,
    triggerTask,
  } = useScheduledTasksStore();

  // ── 执行记录 Store ──
  const {
    recordsLoading,
    recordStatus,
    recordType,
    recordSearch,
    fetchRecords,
    setRecordStatus,
    setRecordType,
    setRecordSearch,
  } = useMyTaskStore();

  const recordCounts = useMyTaskStore(useShallow(selectRecordCounts));
  const currentRecords = useMyTaskStore(useShallow(selectCurrentRecords));

  // ── 页面级状态 ──
  const [activeView, setActiveView] = useState<TaskView>('tasks');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortValue, setSortValue] = useState('created-desc');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<TaskViewModel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskViewModel | null>(null);
  const [detailRecord, setDetailRecord] = useState<ExecutionRecord | null>(null);
  const [recommendInitialValues, setRecommendInitialValues] = useState<
    { name?: string; message?: string } | undefined
  >(undefined);

  // ── 初始化加载 ──
  useEffect(() => {
    fetchTasks().catch(() => {});
    fetchWorkflows().catch(() => {});
    useScheduledTaskUnreadStore.getState().markAllRead();
  }, [fetchTasks, fetchWorkflows]);

  // ── 切换到执行记录 Tab 时加载 ──
  useEffect(() => {
    if (activeView === 'records') {
      fetchRecords({});
    }
  }, [activeView, fetchRecords]);

  // ── 工作流 code → name 映射 ──
  const workflowMap = useMemo(
    () => new Map(workflowOptions.map((o) => [o.value, o.label])),
    [workflowOptions],
  );

  // ── 定时任务视图模型 ──
  const viewModels = useMemo(
    () => tasks.map((t) => toViewModel(t, workflowMap)),
    [tasks, workflowMap],
  );

  const filteredTasks = useMemo(() => {
    let result = viewModels;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
      );
    }
    return sortTasks(result, sortValue);
  }, [viewModels, searchQuery, sortValue]);

  // ── 定时任务操作回调 ──

  const handleToggle = useCallback(
    async (task: TaskViewModel, newEnabled: boolean) => {
      try {
        await toggleTask(task.taskId, newEnabled);
        toast.success(newEnabled ? '任务已启用' : '任务已暂停');
      } catch (err) {
        toast.error(String(err));
      }
    },
    [toggleTask],
  );

  const handleTrigger = useCallback(
    async (task: TaskViewModel) => {
      try {
        const extraInfo = {
          task_id: task.taskId,
          task_name: task.name,
          workflow_code: task.workflowCode ?? null,
          workflow_name: task.workflowName ?? null,
        };
        const result = await triggerTask(task.taskId, extraInfo);
        if (result.outcome === 'async_started') {
          toast.success('测试运行已在云端开始执行，结果将通过轮询同步');
        } else if (result.hasSession) {
          const today = new Date().toISOString().slice(0, 10);
          const agentSessionKey = `agent:main:scheduled-task:${task.id}:${today}`;
          useChatStore.getState().switchSession(agentSessionKey);
          navigateToMainChatHome(navigate, location.pathname);
          toast.success('测试运行已完成，结果已添加到会话');
          void useChatStore.getState().loadSessions();
        } else {
          toast.success('测试运行已触发');
        }
      } catch (err) {
        toast.error(String(err));
      }
    },
    [triggerTask, navigate, location.pathname],
  );

  const handleSave = useCallback(
    async (input: TaskCreateInputWithRun) => {
      try {
        if (editingJob) {
          await updateTask({
            taskId: editingJob.taskId,
            name: input.name,
            cronExpr: input.schedule,
            description: input.message,
            workflowCode: input.workflowCode,
          });
          toast.success('任务已更新');
        } else {
          await createTask({
            name: input.name,
            cronExpr: input.schedule,
            description: input.message,
            workflowCode: input.workflowCode,
          });
          toast.success('任务已创建');
        }
        await fetchTasks().catch(() => {});
      } catch (err) {
        toast.error('操作失败，请稍后重试');
        throw err;
      }
    },
    [editingJob, createTask, updateTask, fetchTasks],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteTask(deleteTarget.taskId);
      toast.success('任务已删除');
      await fetchTasks().catch(() => {});
    } catch (err) {
      toast.error(String(err));
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteTask, fetchTasks]);

  const handleRecommendAdd = useCallback((task: RecommendTask) => {
    setRecommendInitialValues({ name: task.title, message: task.desc });
    setEditingJob(null);
    setCreateOpen(true);
  }, []);

  // ── 渲染 ──
  const isTasksView = activeView === 'tasks';

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col">
        <div className={cn(stoMainInnerShell, 'flex flex-1 flex-col')}>
          {/* 页面标题 + 新建按钮 */}
          <header className="mb-6">
            <div className={myTaskPageHeaderRowClass}>
              <h1 className={stoPageTitleClass}>我的任务</h1>
              {isTasksView ? (
                <button
                  type="button"
                  className={myTaskCreateButtonClass}
                  onClick={() => {
                    setEditingJob(null);
                    setCreateOpen(true);
                  }}
                >
                  + 新建定时任务
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              按计划自动执行任务，也可随时手动触发。在任意对话中描述你想定期做的事，即可快速创建。
            </p>
          </header>

          {/* Tab 行：左侧视图 Tab + 右侧搜索/排序 */}
          <div className={cn(workflowListToolbarClass, 'mb-[26px]')}>
            <ViewTabs activeView={activeView} onViewChange={setActiveView} />

            {isTasksView ? (
              <TaskToolbar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                sortValue={sortValue}
                onSortChange={setSortValue}
              />
            ) : (
              <RecordToolbar
                searchQuery={recordSearch}
                onSearchChange={setRecordSearch}
                filterType={recordType}
                onFilterChange={setRecordType}
              />
            )}
          </div>

          {/* 执行记录状态筛选导航 */}
          {!isTasksView && (
            <RecordStatusNav
              activeStatus={recordStatus}
              counts={recordCounts}
              onStatusChange={setRecordStatus}
            />
          )}

          {/* ── 定时任务视图 ── */}
          {isTasksView && (
            <section aria-label="定时任务" className="flex-1 flex flex-col">
              {tasksLoading && tasks.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <LoadingSpinner size="lg" />
                </div>
              ) : filteredTasks.length === 0 ? (
                <TaskEmptyState
                  searchQuery={searchQuery}
                  onCreate={() => {
                    setEditingJob(null);
                    setCreateOpen(true);
                  }}
                  onRecommendAdd={handleRecommendAdd}
                />
              ) : (
                <div className="grid grid-cols-1 items-stretch sm:grid-cols-2 lg:grid-cols-3 gap-[clamp(12px,1.4vw,16px)]">
                  {filteredTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onToggle={(enabled) => handleToggle(task, enabled)}
                      onEdit={() => {
                        setEditingJob(task);
                        setCreateOpen(true);
                      }}
                      onDelete={() => setDeleteTarget(task)}
                      onRun={() => handleTrigger(task)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ── 执行记录视图 ── */}
          {!isTasksView && (
            <section aria-label="执行记录">
              {recordsLoading ? (
                <div className="flex items-center justify-center py-20">
                  <LoadingSpinner size="lg" />
                </div>
              ) : currentRecords.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-muted-foreground">
                  该状态下暂无执行记录
                </div>
              ) : (
                  <div className="flex flex-col gap-2.5">
                    {currentRecords.map((record) => (
                      <RecordItem
                        key={record.id}
                        record={record}
                        onViewDetail={setDetailRecord}
                      />
                    ))}
                  </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* ── 弹窗 ── */}

      {/* 新建/编辑任务弹窗 */}
      <TaskCreateModal
        job={editingJob ? { id: editingJob.id, name: editingJob.name, message: editingJob.description, schedule: editingJob.cronExpr, enabled: editingJob.enabled, workflowCode: editingJob.workflowCode, createdAt: editingJob.createdAt, updatedAt: editingJob.updatedAt } as CronJob : null}
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setRecommendInitialValues(undefined);
        }}
        onSave={(input) => {
          setRecommendInitialValues(undefined);
          return handleSave(input);
        }}
        initialValues={recommendInitialValues}
      />

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="删除定时任务？"
        message={`确定要删除「${deleteTarget?.name ?? ''}」吗？此操作无法撤销。`}
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="destructive"
      />

      {/* 执行记录详情弹窗 */}
      <RecordDetailModal record={detailRecord} onClose={() => setDetailRecord(null)} />
    </div>
  );
}
