/**
 * MyTask 页面主入口
 * 包含"定时任务"和"执行记录"双视图 Tab 切换
 * 定时任务 CRUD 全部走 useCronStore（Gateway），与 Cron 页面一致
 * 执行记录数据 + 工作流选项消费 useMyTaskStore
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCronStore } from '@/stores/cron';
import type { ManagedLocalTask } from '@/stores/cron';
import { forgetOptimisticDeletedSessionKey } from '@/lib/deleted-session-filter';
import {
  ensureTaskGroupFirstTriggeredOnRun,
  getCachedTaskGroupFirstTriggeredMap,
  rememberOptimisticTaskGroupFirstTriggered,
} from '@/lib/task-group-first-trigger';
import { resolveTaskGroupKeyFromSessionKey } from '../../../shared/task-group-key';
import { applyTaskExecutionModelToChatSession } from '@/lib/apply-task-execution-model';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { navigateToMainChatHome } from '@/lib/main-chat-navigation';
import {
  stripInstructionFromTaskMessage,
} from '@/lib/scheduled-task-recipients';
import { useShallow } from 'zustand/react/shallow';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import {
  myTaskPageHeaderRowClass,
  stoMainInnerShell,
  stoPageTitleClass,
  workflowListToolbarClass,
} from '@/lib/surfaces';
import { toast } from 'sonner';
import { TaskCreateModal, type TaskCreateInputWithRun } from './components/TaskCreateModal';
import { NewTaskDropdownButton } from './components/NewTaskDropdownButton';
import {
  TemplateSelectModal,
  buildRecommendTaskMessage,
} from './components/TemplateSelectModal';

import { useMyTaskStore, selectRecordCounts, selectCurrentRecords } from './store';
import type { TaskView, TaskViewModel, ExecutionRecord } from './types';
import { useRecommendItems } from '@/hooks/use-recommend-items';
import { RECOMMEND_POSITION_KEYS, type RecommendItem } from '@/lib/recommend-api';
import { ViewTabs } from './components/ViewTabs';
import { TaskToolbar } from './components/TaskToolbar';
import { RecordToolbar } from './components/RecordToolbar';
import { TaskCard } from './components/TaskCard';
import { TaskEmptyState } from './components/TaskEmptyState';
import { RecordStatusNav } from './components/RecordStatusNav';
import { RecordItem } from './components/RecordItem';
import { RecordDetailModal } from './components/RecordDetailModal';
import { TaskRunGuardBar } from './components/TaskRunGuardBar';

// ──── 工具函数 ────

/** 将 ScheduleTask 转换为页面 TaskViewModel */
function managedTaskToViewModel(task: ManagedLocalTask): TaskViewModel {
  return {
    id: task.id,
    name: task.name,
    description: stripInstructionFromTaskMessage(task.prompt || ''),
    cronExpr: task.cronExpr,
    enabled: task.enabled,
    nextRunAt: task.nextRunAt ?? null,
    workflowCode: task.workflowCode || undefined,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    agentId: task.agentId,
    engineType: task.engineType,
  };
}

/** 排序任务列表 */
function sortTasks(tasks: TaskViewModel[], sort: string): TaskViewModel[] {
  const sorted = [...tasks];
  switch (sort) {
    case 'created-asc':
      return sorted.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    case 'created-desc':
      return sorted.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    case 'name-asc':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'name-desc':
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    default:
      return sorted;
  }
}

/** 解析首选 Agent（与 Cron 页面一致，不按引擎过滤） */
function resolvePreferredAgentByEngine(
  agents: Array<{ id: string; engineType?: 'openclaw' | 'claude'; workspace: string }>,
  defaultAgentId: string,
  _engineType: 'openclaw' | 'claude'
) {
  if (agents.length === 0) return null;
  return agents.find((agent) => agent.id === defaultAgentId) ?? agents[0] ?? null;
}

// ──── 主组件 ────

export default function MyTask() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation('tasks');

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

  // ── 执行记录 Store ──
  const {
    recordStatus,
    recordSearch,
    setRecordStatus,
    setRecordSearch,
  } = useMyTaskStore();

  const fetchRecords = useMyTaskStore((s) => s.fetchRecords);

  const recordCounts = useMyTaskStore(useShallow(selectRecordCounts));
  const currentRecords = useMyTaskStore(useShallow(selectCurrentRecords));
  // 各 Tab 独立请求后端，命中 pageSize 上限时在底部给出提示
  const currentTab = useMyTaskStore((state) => state.recordsByStatus[state.recordStatus]);
  const currentTabLoading = currentTab.loading;
  const showRecordsCappedHint = !currentTabLoading && currentTab.total > 99;

  // ── 页面级状态 ──
  const [activeView, setActiveView] = useState<TaskView>('tasks');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortValue, setSortValue] = useState('created-desc');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ManagedLocalTask | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagedLocalTask | null>(null);
  const [detailRecord, setDetailRecord] = useState<ExecutionRecord | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const { items: recommendItems } = useRecommendItems(
    RECOMMEND_POSITION_KEYS.MY_TASK,
  );
  /** 从官方推荐选中后预填到创建弹窗的名称 / 任务描述 */
  const [recommendPrefill, setRecommendPrefill] = useState<{
    name: string;
    message: string;
  } | null>(null);

  // ── 初始化加载 ──
  useEffect(() => {
    fetchJobs().catch(() => {});
  }, [fetchJobs]);

  // ── 切换到执行记录 Tab 时串行加载 3 个状态桶 ──
  useEffect(() => {
    if (activeView === 'records') {
      fetchRecords('running')
        .then(() => fetchRecords('success'))
        .then(() => fetchRecords('failed'))
        .catch(() => {});
    }
    // fetchRecords 是 Zustand 稳定引用，仅在视图或状态切换时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, recordStatus]);

  // ── 任务视图轮询：到点后端会推进 nextRunAt，需及时拉取以重启倒计时。
  //     仅在页面可见时轮询；切回可见时立即补一次，避免长时间隐藏后数据陈旧 ──
  useEffect(() => {
    let timer: number | null = null;
    const POLL_INTERVAL = 60_000;
    const poll = async () => {
      try {
        if (document.visibilityState === 'visible' && activeView === 'tasks') {
          await fetchJobs();
        }
      } catch {
        // 轮询失败静默忽略，下一轮重试
      } finally {
        timer = window.setTimeout(poll, POLL_INTERVAL);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(poll, 0);
      }
    };
    timer = window.setTimeout(poll, POLL_INTERVAL);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [activeView, fetchJobs]);

  // ── 任务视图模型列表 ──
  const safeJobs = useMemo(() => (Array.isArray(jobs) ? jobs : []), [jobs]);

  const allTasks = useMemo(() => safeJobs.map((j) => managedTaskToViewModel(j)), [safeJobs]);

  const filteredTasks = useMemo(() => {
    let result = allTasks;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
      );
    }
    return sortTasks(result, sortValue);
  }, [allTasks, searchQuery, sortValue]);

  // ── 任务操作回调（对齐 Cron 页面） ──

  const handleToggle = useCallback(
    async (task: TaskViewModel, newEnabled: boolean) => {
      try {
        await toggleJob(task.id, newEnabled);
        toast.success(newEnabled ? t('myTask.toast.enabled') : t('myTask.toast.paused'));
      } catch (err) {
        toast.error(String(err));
      }
    },
    [toggleJob]
  );

  const handleTrigger = useCallback(
    async (task: TaskViewModel) => {
      const buildDatedSessionKey = (task: TaskViewModel) => {
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        if (task.engineType === 'claude') {
          return `claude-task:${task.id}:${y}-${m}-${d}`;
        }
        return `agent:${task.agentId ?? 'main'}:cron:${task.id}:${y}-${m}-${d}`;
      };

      const sessionKey = buildDatedSessionKey(task);
      const groupKey = resolveTaskGroupKeyFromSessionKey(sessionKey);
      const triggeredAt = Date.now();
      flushSync(() => {
        useChatStore.getState().markScheduledSessionActivating(sessionKey);
        if (groupKey && !getCachedTaskGroupFirstTriggeredMap()[groupKey]) {
          rememberOptimisticTaskGroupFirstTriggered(groupKey, triggeredAt);
        }
      });
      try {
        const result = await triggerJob(task.id);
        if (groupKey) {
          void ensureTaskGroupFirstTriggeredOnRun(groupKey, triggeredAt);
        }
        const executionMeta = result && typeof result === 'object'
          ? result as {
            executionSessionKey?: string;
            executionModel?: string;
            executionAgentId?: string;
          }
          : null;
        const targetSessionKey = executionMeta?.executionSessionKey || sessionKey;
        applyTaskExecutionModelToChatSession({
          sessionKey: targetSessionKey,
          model: executionMeta?.executionModel,
          agentId: executionMeta?.executionAgentId || task.agentId,
          engineType: task.engineType,
        });
        forgetOptimisticDeletedSessionKey(sessionKey);
        forgetOptimisticDeletedSessionKey(targetSessionKey);
        if (task.engineType !== 'claude' && task.agentId && task.agentId !== 'main') {
          const today = new Date();
          const y = today.getFullYear();
          const m = String(today.getMonth() + 1).padStart(2, '0');
          const d = String(today.getDate()).padStart(2, '0');
          forgetOptimisticDeletedSessionKey(`agent:main:cron:${task.id}:${y}-${m}-${d}`);
        }
        // 固定停留，给 gateway started/bindRun 一点时间写入 runtime，再进对话页，
        // 避免改 chat store 做乐观 sending。
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 2000);
        });

        navigateToMainChatHome(navigate, location.pathname, () => {
          useChatStore.getState().switchSession(targetSessionKey);
        });
        await useChatStore.getState().loadSessions();
        // toast.success(t('myTask.toast.triggered'));
      } catch (err) {
        useChatStore.getState().clearScheduledSessionActivating(sessionKey);
        toast.error(String(err));
      } finally {
        useChatStore.getState().releaseScheduledSessionActivating(sessionKey);
      }
    },
    [triggerJob, navigate, location.pathname, t]
  );

  const handleSave = useCallback(
    async (input: TaskCreateInputWithRun) => {
      const selectedAgent = resolvePreferredAgentByEngine(agents, defaultAgentId, input.engineType);
      const isClaude = input.engineType === 'claude';
      try {
        if (isClaude && !selectedAgent?.id) {
          throw new Error(
            editingJob
              ? t('myTask.error.claudeAgentNoWorkspaceUpdate')
              : t('myTask.error.claudeAgentNoWorkspaceCreate'),
          );
        }
        // 统一模型：prompt 干净（执行期由 executor 烘焙 dingtalk），dingtalkRecipients 走列。
        const base = {
          name: input.name,
          cronExpr: input.schedule,
          prompt: input.message,
          dingtalkRecipients: input.dingTalkMentions ?? null,
          workflowCode: input.workflowCode ?? null,
          myArtifactFolderPath: input.myArtifactFolderPath ?? null,
          sharedArtifactFolderPath: input.sharedArtifactFolderPath ?? null,
        };
        const claudeFields = isClaude
          ? {
              workspacePath: input.claudeWorkspacePath || selectedAgent?.workspace || null,
              permissionProfile: input.claudePermissionProfile || 'dangerous-bypass',
            }
          : {};
        if (editingJob) {
          await updateJob(editingJob.id, {
            ...base,
            ...claudeFields,
          });
          toast.success(t('myTask.toast.updated'));
        } else {
          await createJob({
            ...base,
            enabled: input.enabled,
            engineType: input.engineType,
            agentId: selectedAgent?.id || 'main',
            ...claudeFields,
          });
          toast.success(t('myTask.toast.created'));
        }
        await fetchJobs().catch(() => {});
      } catch (err) {
        const errStr = String(err);
        toast.error(errStr);
        // console.log(err, errStr);
        // let userMessage = '操作失败，请稍后重试';
        // if (
        //   errStr.includes('409') ||
        //   errStr.includes('already exists') ||
        //   errStr.includes('duplicate')
        // ) {
        //   userMessage = '任务名称已存在，请使用其他名称';
        // } else if (errStr.includes('422') || errStr.includes('validation')) {
        //   userMessage = '输入内容不符合要求，请检查字段';
        // }
        // toast.error(userMessage);
        throw err;
      }
    },
    [agents, defaultAgentId, editingJob, createJob, updateJob, fetchJobs]
  );

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    void (async () => {
      try {
        await deleteJob(target.id);
        toast.success(t('myTask.toast.deleted'));
      } catch (err) {
        toast.error(String(err));
      }
    })();
  }, [deleteTarget, deleteJob, t]);

  const handleRecommendSelect = useCallback((item: RecommendItem) => {
    const message = buildRecommendTaskMessage(item);
    if (!message) return;
    setTemplateOpen(false);
    setEditingJob(null);
    setRecommendPrefill({ name: item.title || '', message });
    setCreateOpen(true);
  }, []);

  // ── 渲染 ──
  const isTasksView = activeView === 'tasks';

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col [scrollbar-gutter:stable]">
        <div className={cn(stoMainInnerShell, 'flex flex-1 flex-col')}>
          {/* 页面标题 + 右侧运行保障控件 */}
          <header className="mb-6">
            <div className={myTaskPageHeaderRowClass}>
              <h1 className={cn(stoPageTitleClass, 'h-[34px]')}>{t('myTask.pageTitle')}</h1>
							<TaskRunGuardBar />
            </div>
          </header>

          {/* Tab 行：左侧视图 Tab + 右侧搜索/排序/新建 */}
          <div className={cn(workflowListToolbarClass, 'mb-[26px]')}>
            <ViewTabs activeView={activeView} onViewChange={setActiveView} />

            {isTasksView ? (
              <TaskToolbar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                sortValue={sortValue}
                onSortChange={setSortValue}
              >
								<NewTaskDropdownButton
                  onSelfCreate={() => {
                    setEditingJob(null);
                    setCreateOpen(true);
                  }}
                  onTemplateCreate={() => setTemplateOpen(true)}
                />
							</TaskToolbar>
            ) : (
              <RecordToolbar searchQuery={recordSearch} onSearchChange={setRecordSearch} />
            )}
          </div>

          {/* 执行记录状态筛选导航 */}
          {!isTasksView && (
            <RecordStatusNav
              activeStatus={recordStatus}
              counts={recordCounts}
              onStatusChange={(status) => {
                setRecordStatus(status);
                fetchRecords(status).catch(() => {});
              }}
            />
          )}

          {/* ── 定时任务视图 ── */}
          {isTasksView && (
            <section aria-label={t('myTask.taskView.aria')} className="flex-1 flex flex-col">
              {jobsLoading && safeJobs.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <LoadingSpinner size="lg" />
                </div>
              ) : filteredTasks.length === 0 ? (
                <TaskEmptyState
                  searchQuery={searchQuery}
                  onSelfCreate={() => {
                    setEditingJob(null);
                    setCreateOpen(true);
                  }}
                  onTemplateCreate={() => setTemplateOpen(true)}
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
            <section aria-label={t('myTask.recordView.aria')}>
              {currentTabLoading ? (
                <div className="flex items-center justify-center py-20">
                  <LoadingSpinner size="lg" />
                </div>
              ) : currentRecords.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-muted-foreground">
                  {t('myTask.taskView.emptyNoRecords')}
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {currentRecords.map((record) => (
                    <RecordItem key={record.id} record={record} onViewDetail={setDetailRecord} />
                  ))}
                </div>
              )}

              {showRecordsCappedHint && (
                <p className="mt-3 text-center text-[12px] text-muted-foreground">
                  {t('myTask.taskView.recordsCappedHint')}
                </p>
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
          setRecommendPrefill(null);
        }}
        onSave={(input) => handleSave(input)}
        initialValues={
          recommendPrefill
            ? { name: recommendPrefill.name, message: recommendPrefill.message }
            : undefined
        }
      />

      {/* 官方推荐选择弹窗 */}
      <TemplateSelectModal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        items={recommendItems}
        onSelect={handleRecommendSelect}
      />

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('myTask.delete.title')}
        message={t('myTask.delete.message', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('myTask.delete.confirm')}
        cancelLabel={t('myTask.delete.cancel')}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="destructive"
      />

      {/* 执行记录详情弹窗 */}
      <RecordDetailModal record={detailRecord} onClose={() => setDetailRecord(null)} />
    </div>
  );
}
