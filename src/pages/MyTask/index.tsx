/**
 * MyTask 页面主入口
 * 包含"定时任务"和"执行记录"双视图 Tab 切换
 * 定时任务 CRUD 全部走 useCronStore（Gateway），与 Cron 页面一致
 * 执行记录数据 + 工作流选项消费 useMyTaskStore
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCronStore } from '@/stores/cron';
import type { ManagedLocalTask } from '@/stores/cron';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { navigateToMainChatHome } from '@/lib/main-chat-navigation';
import { stripInstructionFromTaskMessage } from '@/lib/scheduled-task-recipients';
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
import { ViewTabs } from './components/ViewTabs';
import { TaskToolbar } from './components/TaskToolbar';
import { RecordToolbar } from './components/RecordToolbar';
import { TaskCard } from './components/TaskCard';
import { TaskEmptyState } from './components/TaskEmptyState';
import { RecordStatusNav } from './components/RecordStatusNav';
import { RecordItem } from './components/RecordItem';
import { RecordDetailModal } from './components/RecordDetailModal';

// ──── 工具函数 ────

/** 将 ManagedLocalTask 转换为页面 TaskViewModel */
function managedTaskToViewModel(
  task: ManagedLocalTask,
  workflowMap: Map<string, string>,
): TaskViewModel {
  if (task.engineType === 'claude') {
    return {
      id: task.id,
      name: task.name,
      description: task.promptTemplate || '',
      cronExpr: task.cronExpr,
      enabled: task.enabled,
      nextRunAt: task.nextRunAt ?? null,
      workflowCode: undefined,
      workflowName: undefined,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      agentId: task.agentId,
      engineType: 'claude',
    };
  }

  // openclaw (CronJob)
  const cronExpr =
    typeof task.schedule === 'string'
      ? task.schedule
      : typeof task.schedule === 'object' && task.schedule.kind === 'cron'
        ? task.schedule.expr
        : '';

  return {
    id: task.id,
    name: task.name,
    description: stripInstructionFromTaskMessage(task.message || ''),
    cronExpr,
    enabled: task.enabled,
    nextRunAt: task.nextRun ?? null,
    workflowCode: task.workflowCode || undefined,
    workflowName: task.workflowCode ? workflowMap.get(task.workflowCode) : undefined,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    agentId: task.agentId,
    engineType: 'openclaw',
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

/** 根据引擎类型解析首选 Agent */
function resolvePreferredAgentByEngine(
  agents: Array<{ id: string; engineType?: 'openclaw' | 'claude'; workspace: string }>,
  defaultAgentId: string,
  engineType: 'openclaw' | 'claude',
) {
  const engineAgents = agents.filter((agent) => (agent.engineType ?? 'openclaw') === engineType);
  if (engineAgents.length === 0) return null;
  return engineAgents.find((agent) => agent.id === defaultAgentId) ?? engineAgents[0] ?? null;
}

// ──── 主组件 ────

export default function MyTask() {
  const navigate = useNavigate();
  const location = useLocation();

  // ── Cron Store（本地 Gateway + Claude 任务） ──
  const {
    jobs,
    loading: jobsLoading,
    fetchJobs,
    createJob,
    updateJob,
    toggleJob,
    deleteJob,
    triggerJob,
  } = useCronStore();

  // ── Agent 配置 ──
  const agents = useAgentsStore((state) => state.agents);
  const defaultAgentId = useAgentsStore((state) => state.defaultAgentId);

  // ── 执行记录 + 工作流 Store ──
  const {
    workflowOptions,
    fetchWorkflows: fetchWorkflowOptions,
    recordsLoading,
    recordStatus,
    recordSearch,
    fetchRecords,
    setRecordStatus,
    setRecordSearch,
  } = useMyTaskStore();

  const recordCounts = useMyTaskStore(useShallow(selectRecordCounts));
  const currentRecords = useMyTaskStore(useShallow(selectCurrentRecords));

  // ── 页面级状态 ──
  const [activeView, setActiveView] = useState<TaskView>('tasks');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortValue, setSortValue] = useState('created-desc');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ManagedLocalTask | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagedLocalTask | null>(null);
  const [detailRecord, setDetailRecord] = useState<ExecutionRecord | null>(null);
  const [recommendInitialValues, setRecommendInitialValues] = useState<
    { name?: string; message?: string } | undefined
  >(undefined);

  // ── 初始化加载 ──
  useEffect(() => {
    fetchJobs().catch(() => {});
    fetchWorkflowOptions().catch(() => {});
  }, [fetchJobs, fetchWorkflowOptions]);

  // ── 切换到执行记录 Tab 时加载 ──
  useEffect(() => {
    if (activeView === 'records') {
      fetchRecords();
    }
  }, [activeView, fetchRecords]);

  // ── 工作流 code → name 映射 ──
  const workflowMap = useMemo(
    () => new Map(workflowOptions.map((o) => [o.value, o.label])),
    [workflowOptions],
  );

  // ── 任务视图模型列表 ──
  const safeJobs = useMemo(() => (Array.isArray(jobs) ? jobs : []), [jobs]);

  const allTasks = useMemo(
    () => safeJobs.map((j) => managedTaskToViewModel(j, workflowMap)),
    [safeJobs, workflowMap],
  );

  const filteredTasks = useMemo(() => {
    let result = allTasks;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
      );
    }
    return sortTasks(result, sortValue);
  }, [allTasks, searchQuery, sortValue]);

  // ── 任务操作回调（对齐 Cron 页面） ──

  const handleToggle = useCallback(
    async (task: TaskViewModel, newEnabled: boolean) => {
      try {
        await toggleJob(task.id, newEnabled, task.engineType);
        toast.success(newEnabled ? '任务已启用' : '任务已暂停');
      } catch (err) {
        toast.error(String(err));
      }
    },
    [toggleJob],
  );

  const handleTrigger = useCallback(
    async (task: TaskViewModel) => {
      try {
        const result = await triggerJob(task.id, task.engineType);
        if (task.engineType === 'claude' && result && 'sessionKey' in result) {
          navigateToMainChatHome(navigate, location.pathname, () => {
            useChatStore.getState().switchSession(result.sessionKey);
          });
          void useChatStore.getState().loadSessions();
        } else {
          const sessionKey = `agent:${task.agentId ?? 'main'}:cron:${task.id}`;
          navigateToMainChatHome(navigate, location.pathname, () => {
            useChatStore.getState().switchSession(sessionKey);
          });
          void useChatStore.getState().loadSessions();
        }
        toast.success('测试运行已触发');
      } catch (err) {
        toast.error(String(err));
      }
    },
    [triggerJob, navigate, location.pathname],
  );

  const handleSave = useCallback(
    async (input: TaskCreateInputWithRun) => {
      const selectedAgent = resolvePreferredAgentByEngine(agents, defaultAgentId, input.engineType);
      try {
        if (editingJob) {
          if (editingJob.engineType === 'claude') {
            if (!selectedAgent?.workspace) {
              throw new Error('所选 Claude 代理缺少工作区，无法更新本地定时任务');
            }
            await updateJob(editingJob.id, {
              engineType: 'claude',
              payload: {
                id: editingJob.id,
                name: input.name,
                enabled: editingJob.enabled,
                cronExpr: input.schedule,
                promptTemplate: input.message,
                agentId: selectedAgent.id,
                workspacePath: selectedAgent.workspace,
              },
            });
          } else {
            await updateJob(editingJob.id, {
              engineType: 'openclaw',
              payload: {
                name: input.name,
                message: input.message,
                schedule: input.schedule,
                enabled: input.enabled,
                dingTalkMentions: input.dingTalkMentions,
                agentId: editingJob.agentId ?? undefined,
              },
            });
          }
          toast.success('任务已更新');
        } else {
          if (input.engineType === 'claude') {
            if (!selectedAgent?.workspace) {
              throw new Error('所选 Claude 代理缺少工作区，无法创建本地定时任务');
            }
            await createJob({
              engineType: 'claude',
              payload: {
                name: input.name,
                cronExpr: input.schedule,
                promptTemplate: input.message,
                agentId: selectedAgent.id,
                workspacePath: selectedAgent.workspace,
              },
            });
          } else {
            await createJob({
              engineType: 'openclaw',
              payload: {
                name: input.name,
                message: input.message,
                schedule: input.schedule,
                enabled: input.enabled,
                dingTalkMentions: input.dingTalkMentions,
              },
            });
          }
          toast.success('任务已创建');
        }
        await fetchJobs().catch(() => {});
      } catch (err) {
        const errStr = String(err);
        let userMessage = '操作失败，请稍后重试';
        if (errStr.includes('409') || errStr.includes('already exists') || errStr.includes('duplicate')) {
          userMessage = '任务名称已存在，请使用其他名称';
        } else if (errStr.includes('422') || errStr.includes('validation')) {
          userMessage = '输入内容不符合要求，请检查字段';
        }
        toast.error(userMessage);
        throw err;
      }
    },
    [agents, defaultAgentId, editingJob, createJob, updateJob, fetchJobs],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteJob(deleteTarget.id, deleteTarget.engineType);
      toast.success('任务已删除');
      await fetchJobs().catch(() => {});
    } catch (err) {
      toast.error(String(err));
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteJob, fetchJobs]);

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
              {jobsLoading && safeJobs.length === 0 ? (
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
                      key={`${task.engineType}:${task.id}`}
                      task={task}
                      onToggle={(enabled) => handleToggle(task, enabled)}
                      onEdit={() => {
                        const job = safeJobs.find((j) => j.id === task.id) ?? null;
                        setEditingJob(job);
                        setCreateOpen(true);
                      }}
                      onDelete={() => {
                        const job = safeJobs.find((j) => j.id === task.id) ?? null;
                        if (job) setDeleteTarget(job);
                      }}
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
        job={editingJob}
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
