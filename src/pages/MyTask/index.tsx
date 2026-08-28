/**
 * MyTask 页面主入口
 * 一级 Tab：定时任务 / 工作流（URL ?tab=workflow）
 * 定时任务内二级 Tab：定时任务 / 执行记录
 * 定时任务 CRUD 全部走 useCronStore（Gateway），与 Cron 页面一致
 * 执行记录数据 + 工作流选项消费 useMyTaskStore
 * 工作流 Tab 复用 WorkflowDashboard；编辑/新建仍走 /workflow/*
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
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
import { StoSearchField } from '@/components/ui/sto-neutral-controls';
import { cn } from '@/lib/utils';
import {
  myTaskPageSubtitleClass,
  stoMainInnerShell,
  stoPageTitleClass,
  workflowListToolbarClass,
  workflowPageRootClass,
} from '@/lib/surfaces';
import { toast } from 'sonner';
import { hostApiFetch } from '@/lib/host-api';
import { TaskCreateModal, type TaskCreateInputWithRun } from './components/TaskCreateModal';
import { NewTaskDropdownButton } from './components/NewTaskDropdownButton';
import {
  TemplateSelectModal,
  buildRecommendTaskMessage,
} from './components/TemplateSelectModal';

import { useMyTaskStore, selectRecordCounts, selectCurrentRecords } from './store';
import type { MyTaskSection, TaskView, TaskViewModel, ExecutionRecord } from './types';
import { parseMyTaskSection } from './constants';
import { useRecommendItems } from '@/hooks/use-recommend-items';
import { RECOMMEND_POSITION_KEYS, type RecommendItem } from '@/lib/recommend-api';
import { SectionTabs } from './components/SectionTabs';
import { ViewTabs } from './components/ViewTabs';
import { TaskToolbar } from './components/TaskToolbar';
import { RecordToolbar } from './components/RecordToolbar';
import { TaskCard } from './components/TaskCard';
import { TaskEmptyState } from './components/TaskEmptyState';
import { RecordStatusNav } from './components/RecordStatusNav';
import { RecordItem } from './components/RecordItem';
import { RecordDetailModal } from './components/RecordDetailModal';
import { TaskRunGuardBar } from './components/TaskRunGuardBar';
import { WorkflowDashboard } from '@/pages/Workflow/components/workflow-dashboard';
import { WorkflowPageShading } from '@/pages/Workflow/components/workflow-page-shading';
import { useWorkflowListViewState } from '@/pages/Workflow/hooks/use-workflow-list-view-state';
import { useWorkflowUiStore } from '@/stores/workflow-ui';

// ──── 工具函数 ────

/** 将 ScheduleTask 转换为页面 TaskViewModel */
function managedTaskToViewModel(task: ManagedLocalTask): TaskViewModel {
  const segments = Array.isArray(task.extra?.composerSegments)
    ? (task.extra!.composerSegments as Array<{ type?: string }>)
    : [];
  const hasWorkflow = segments.some((seg) => seg?.type === 'workflow')
    || Boolean(task.workflowCode); // 迁移前短暂兼容列
  const hasSkill = segments.some((seg) => seg?.type === 'skill')
    || Boolean(task.skillCode);
  return {
    id: task.id,
    name: task.name,
    description: stripInstructionFromTaskMessage(task.prompt || ''),
    cronExpr: task.cronExpr,
    enabled: task.enabled,
    nextRunAt: task.nextRunAt ?? null,
    hasWorkflow,
    hasSkill,
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation('tasks');

  const activeSection = parseMyTaskSection(searchParams.get('tab'));
  const workflowViewState = useWorkflowListViewState();
  const setEditorActive = useWorkflowUiStore((s) => s.setEditorActive);

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
    bumpNameMapsRefreshKey,
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
  const [hasCloudUpdates, setHasCloudUpdates] = useState(false);
  const [pulling, setPulling] = useState(false);

  const handlePullFromCloud = async () => {
    if (pulling) return;
    setPulling(true);
    try {
      await hostApiFetch('/api/scheduled-tasks/cloud/pull', { method: 'POST' });
      await fetchJobs();
      const status = await hostApiFetch<{ hasCloudUpdates?: boolean }>(
        '/api/scheduled-tasks/cloud/sync-status',
      );
      setHasCloudUpdates(Boolean(status?.hasCloudUpdates));
      toast.success(t('myTask.toolbar.pullSuccess'));
    } catch {
      toast.error(t('myTask.toolbar.pullFailed'));
    } finally {
      setPulling(false);
    }
  };

  const handleSectionChange = (section: MyTaskSection) => {
    if (section === 'workflow') {
      setSearchParams({ tab: 'workflow' }, { replace: true });
      return;
    }
    setSearchParams({}, { replace: true });
  };

  // 列表 Tab 不处于编辑器；切回/离开时清掉 editorActive，避免顶栏残留
  useEffect(() => {
    if (activeSection !== 'workflow') return;
    setEditorActive(false);
    return () => setEditorActive(false);
  }, [activeSection, setEditorActive]);

  // ── 初始化加载 ──
  useEffect(() => {
    if (activeSection !== 'tasks') return;
    fetchJobs().catch(() => {});
  }, [activeSection, fetchJobs]);

  // 仅进入 MyTask 定时任务分区时请求一次 sync-status
  useEffect(() => {
    if (activeSection !== 'tasks') return;
    let cancelled = false;
    void hostApiFetch<{ hasCloudUpdates?: boolean }>('/api/scheduled-tasks/cloud/sync-status')
      .then((status) => {
        if (!cancelled) setHasCloudUpdates(Boolean(status?.hasCloudUpdates));
      })
      .catch(() => {
        if (!cancelled) setHasCloudUpdates(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection]);

  // ── 切换到执行记录 Tab 时串行加载 3 个状态桶 ──
  useEffect(() => {
    if (activeSection !== 'tasks' || activeView !== 'records') return;
    fetchRecords('running')
      .then(() => fetchRecords('success'))
      .then(() => fetchRecords('failed'))
      .catch(() => {});
    // fetchRecords 是 Zustand 稳定引用，仅在视图或状态切换时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, activeView, recordStatus]);

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
      const engineType = editingJob?.engineType ?? input.engineType;
      const selectedAgent = resolvePreferredAgentByEngine(agents, defaultAgentId, engineType);
      const isClaude = engineType === 'claude';
      try {
        if (isClaude && !selectedAgent?.id) {
          throw new Error(
            editingJob
              ? t('myTask.error.claudeAgentNoWorkspaceUpdate')
              : t('myTask.error.claudeAgentNoWorkspaceCreate'),
          );
        }
        // prompt 干净；技能/工作流/收件人只进 extra.composerSegments；附件由 service 持久化。
        const base = {
          name: input.name,
          cronExpr: input.schedule,
          prompt: input.message,
          dingtalkRecipients: null,
          skillCode: null,
          workflowCode: null,
          extra: input.extra ?? null,
          myArtifactFolderPath: input.myArtifactFolderPath ?? null,
          sharedArtifactFolderPath: input.sharedArtifactFolderPath ?? null,
        };
        const claudeFields = isClaude
          ? {
              workspacePath: input.claudeWorkspacePath || selectedAgent?.workspace || null,
              permissionProfile: input.claudePermissionProfile || 'dangerous-bypass',
            }
          : {};
        const nameChanged = Boolean(editingJob && input.name !== editingJob.name);
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
        if (nameChanged) bumpNameMapsRefreshKey();
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
    [agents, defaultAgentId, editingJob, createJob, updateJob, fetchJobs, bumpNameMapsRefreshKey, t]
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
  const isWorkflowSection = activeSection === 'workflow';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          'relative flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6 pt-0',
          isWorkflowSection && workflowPageRootClass,
        )}
      >
        {isWorkflowSection ? <WorkflowPageShading /> : null}
        <div
          className={cn(
            stoMainInnerShell,
            'relative z-[1] flex min-h-0 flex-1 flex-col overflow-hidden',
          )}
        >
          {/* 一级 Tab 固定顶栏：左分段；右为运行保障 + 搜索/新建 */}
          <div className="mb-[38px] flex flex-shrink-0 flex-wrap items-center gap-3">
            <SectionTabs
              activeSection={activeSection}
              onSectionChange={handleSectionChange}
            />
            {!isWorkflowSection ? (
              <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                <TaskRunGuardBar />
                {isTasksView ? (
                  <>
                    <StoSearchField
                      value={searchQuery}
                      onValueChange={setSearchQuery}
                      placeholder={t('myTask.toolbar.searchPlaceholder')}
                      aria-label={t('myTask.toolbar.searchSrOnly')}
                      autoComplete="off"
                      className="h-[34px] w-[184px] shrink-0 gap-1 border-[#E8EAEF] pr-[10px] focus-within:shadow-none"
                    />
                    <NewTaskDropdownButton
                      onSelfCreate={() => {
                        setEditingJob(null);
                        setCreateOpen(true);
                      }}
                      onTemplateCreate={() => setTemplateOpen(true)}
                    />
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* 仅内容区滚动 */}
          {isWorkflowSection ? (
            <div className="min-h-0 flex-1 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="pb-10">
                <WorkflowDashboard
                  embedded
                  viewState={workflowViewState}
                  onManualCreate={() => navigate('/workflow/new')}
                  onGenerate={(prompt) => {
                    navigate('/workflow/generate', { state: { prompt } });
                  }}
                  onEditCard={(workflowId) =>
                    navigate(`/workflow/${encodeURIComponent(workflowId)}`)
                  }
                />
              </div>
            </div>
          ) : (
            <>
              {/* 标题 + 工具栏固定；仅下方卡片/记录列表滚动 */}
              <header className="mb-[30px] shrink-0">
                <div className="min-w-0">
                  <h1 className={cn(stoPageTitleClass, 'h-[34px]')}>{t('myTask.pageTitle')}</h1>
                  <p className={myTaskPageSubtitleClass}>{t('myTask.subtitle')}</p>
                </div>
              </header>

              <div className={cn(workflowListToolbarClass, 'mb-[18px] shrink-0')}>
                <ViewTabs activeView={activeView} onViewChange={setActiveView} />

                {isTasksView ? (
                  <div className="ml-auto flex shrink-0 items-center gap-3">
                    {hasCloudUpdates ? (
                      <button
                        type="button"
                        disabled={pulling}
                        onClick={() => void handlePullFromCloud()}
                        className="inline-flex h-8 items-center rounded-[8px] border border-border bg-background px-3 text-[13px] text-foreground hover:bg-muted disabled:opacity-60"
                      >
                        {pulling ? t('myTask.toolbar.pulling') : t('myTask.toolbar.pullFromCloud')}
                      </button>
                    ) : null}
                    <TaskToolbar
                      sortValue={sortValue}
                      onSortChange={setSortValue}
                    />
                  </div>
                ) : (
                  <RecordToolbar searchQuery={recordSearch} onSearchChange={setRecordSearch} />
                )}
              </div>

              {!isTasksView ? (
                <div className="shrink-0">
                  <RecordStatusNav
                    activeStatus={recordStatus}
                    counts={recordCounts}
                    onStatusChange={(status) => {
                      setRecordStatus(status);
                      fetchRecords(status).catch(() => {});
                    }}
                  />
                </div>
              ) : null}

              <div className="min-h-0 flex-1 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {isTasksView ? (
                  <section aria-label={t('myTask.taskView.aria')} className="flex flex-col pb-6">
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
                        {filteredTasks.map((task) => {
                          const openTaskEdit = () => {
                            const job = safeJobs.find((j) => j.id === task.id) ?? null;
                            setEditingJob(job);
                            setCreateOpen(true);
                          };

                          return (
                            <TaskCard
                              key={`${task.engineType}:${task.id}`}
                              task={task}
                              onToggle={(enabled) => handleToggle(task, enabled)}
                              onClick={openTaskEdit}
                              onEdit={openTaskEdit}
                              onDelete={() => {
                                const job = safeJobs.find((j) => j.id === task.id) ?? null;
                                if (job) setDeleteTarget(job);
                              }}
                              onRun={() => handleTrigger(task)}
                            />
                          );
                        })}
                      </div>
                    )}
                  </section>
                ) : (
                  <section aria-label={t('myTask.recordView.aria')} className="pb-6">
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
            </>
          )}
        </div>
      </div>

      {/* ── 弹窗（仅定时任务区） ── */}

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
