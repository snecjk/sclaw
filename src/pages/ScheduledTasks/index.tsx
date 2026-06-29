/**
 * Scheduled Tasks Page (Redesigned)
 * Independent page using the new STO Scheduled Tasks API.
 * Does NOT mix with legacy local cron store.
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useScheduledTasksStore } from '@/stores/scheduledTasks';
import { forgetOptimisticDeletedSessionKey } from '@/lib/deleted-session-filter';
import {
  ensureTaskGroupFirstTriggeredOnRun,
  getCachedTaskGroupFirstTriggeredMap,
  rememberOptimisticTaskGroupFirstTriggered,
} from '@/lib/task-group-first-trigger';
import { stoCloudTaskGroupKey } from '../../../shared/task-group-key';
import { useChatStore } from '@/stores/chat';
import { navigateToMainChatHome } from '@/lib/main-chat-navigation';
import { useScheduledTaskUnreadStore } from '@/stores/scheduled-task-unread';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { toast } from 'sonner';
import { stoMainInnerShell } from '@/lib/surfaces';
import { TaskHero } from './components/TaskHero';
import { TaskCard } from './components/TaskCard';
import { TaskCreateModal, type TaskCreateInputWithRun } from './components/TaskCreateModal';
import { TaskEmptyState } from './components/TaskEmptyState';
import type { CronJob } from '@/types/cron';
import {
  buildTaskMessageWithRecipients,
  mentionsToScheduledTaskFields,
  stripInstructionFromTaskMessage,
} from '@/lib/scheduled-task-recipients';

// View model for the card grid (adapts ScheduledTask shape to what TaskCard expects)
interface TaskViewModel extends CronJob {
  isCloud: true;
}

function toViewModel(task: import('@/types/scheduled-task').ScheduledTask): TaskViewModel {
  return {
    id: String(task.id),
    name: task.name,
    message: stripInstructionFromTaskMessage(task.description || ''),
    schedule: task.cronExpr,
    enabled: task.enabled,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    nextRun: task.nextRunAt ?? undefined,
    lastRun: task.lastRunAt
      ? { time: task.lastRunAt, success: task.lastRunStatus === 'success' }
      : undefined,
    isCloud: true,
  };
}

function sortTasks(tasks: TaskViewModel[], sort: string): TaskViewModel[] {
  const sorted = [...tasks];
  switch (sort) {
    case 'created-asc':
      return sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    case 'created-desc':
      return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case 'name-asc':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'name-desc':
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    default:
      return sorted;
  }
}

export default function ScheduledTasks() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    tasks,
    loading,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    toggleTask,
    triggerTask,
  } = useScheduledTasksStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [sortValue, setSortValue] = useState('created-desc');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<TaskViewModel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskViewModel | null>(null);
  const [recommendInitialValues, setRecommendInitialValues] = useState<{ name?: string; message?: string } | undefined>(undefined);

  useEffect(() => {
    fetchTasks().catch(() => {});
    useScheduledTaskUnreadStore.getState().markAllRead();
  }, [fetchTasks]);

  const viewModels = useMemo(() => tasks.map(toViewModel), [tasks]);

  const filteredTasks = useMemo(() => {
    let result = viewModels;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (t) => t.name.toLowerCase().includes(q) || t.message.toLowerCase().includes(q),
      );
    }
    return sortTasks(result, sortValue);
  }, [viewModels, searchQuery, sortValue]);

  const handleToggle = useCallback(
    async (job: TaskViewModel, newEnabled: boolean) => {
      try {
        await toggleTask(Number(job.id), newEnabled);
        toast.success(newEnabled ? '任务已启用' : '任务已暂停');
      } catch (err) {
        toast.error(String(err));
      }
    },
    [toggleTask],
  );

  const handleTrigger = useCallback(
    async (job: TaskViewModel) => {
      const today = new Date().toISOString().slice(0, 10);
      const agentSessionKey = `agent:main:scheduled-task:${job.id}:${today}`;
      const groupKey = stoCloudTaskGroupKey(job.id);
      const triggeredAt = Date.now();
      flushSync(() => {
        useChatStore.getState().markScheduledSessionActivating(agentSessionKey);
        if (!getCachedTaskGroupFirstTriggeredMap()[groupKey]) {
          rememberOptimisticTaskGroupFirstTriggered(groupKey, triggeredAt);
        }
      });
      const chat = useChatStore.getState();
      try {
        const result = await triggerTask(Number(job.id));
        void ensureTaskGroupFirstTriggeredOnRun(groupKey, triggeredAt);
        if (result.outcome === 'async_started') {
          toast.success('测试运行已在云端开始执行，结果将通过轮询同步');
        } else if (result.hasSession) {
          forgetOptimisticDeletedSessionKey(agentSessionKey);
          navigateToMainChatHome(navigate, location.pathname, () => {
            useChatStore.getState().switchSession(agentSessionKey);
          });
          toast.success('测试运行已完成，结果已添加到会话');
          await useChatStore.getState().loadSessions();
        } else {
          toast.success('测试运行已触发');
        }
      } catch (err) {
        chat.clearScheduledSessionActivating(agentSessionKey);
        toast.error(String(err));
      } finally {
        chat.releaseScheduledSessionActivating(agentSessionKey);
      }
    },
    [triggerTask, navigate, location.pathname],
  );

  const editingSourceTask = useMemo(
    () => (editingJob ? tasks.find((task) => String(task.id) === editingJob.id) ?? null : null),
    [editingJob, tasks],
  );

  const handleSave = useCallback(
    async (input: TaskCreateInputWithRun) => {
      const recipientFields = mentionsToScheduledTaskFields(input.dingTalkMentions ?? []);
      const description = buildTaskMessageWithRecipients(input.message, input.dingTalkMentions);

      try {
        if (editingJob) {
          await updateTask({
            taskId: Number(editingJob.id),
            name: input.name,
            cronExpr: input.schedule,
            description,
            ...recipientFields,
            dingTalkMentions: input.dingTalkMentions,
          });
          toast.success('任务已更新');
        } else {
          await createTask({
            name: input.name,
            cronExpr: input.schedule,
            description,
            ...recipientFields,
            dingTalkMentions: input.dingTalkMentions,
          });
          toast.success('任务已创建');
        }
        
        await fetchTasks().catch(() => {});
      } catch (err) {
        const message = String(err);
        
        // 尝试解析 API 返回的详细错误信息
        let userFriendlyMessage = '操作失败，请稍后重试';
        
        if (message.includes('409') || message.includes('任务名称已存在')) {
          userFriendlyMessage = '任务名称已存在，请使用其他名称';
        } else if (message.includes('422') || message.includes('400')) {
          // 尝试从 JSON 中提取验证错误信息
          try {
            const jsonStart = message.indexOf('{');
            if (jsonStart !== -1) {
              const errorData = JSON.parse(message.substring(jsonStart));
              if (errorData.detail && Array.isArray(errorData.detail)) {
                // 提取验证错误字段
                const fieldErrors = errorData.detail.map((d: { msg?: string; loc?: unknown[] }) => {
                  if (d.msg) {
                    // 将技术性的错误消息转换为用户友好的提示
                    if (d.msg.includes('String should have at most')) {
                      const match = d.msg.match(/at most (\d+) characters/);
                      const maxLen = match ? match[1] : '最大';
                      const field = d.loc?.[1] || '字段';
                      return `${field}长度不能超过${maxLen}个字符`;
                    }
                    if (d.msg.includes('should have at least')) {
                      const field = d.loc?.[1] || '字段';
                      return `${field}长度不足`;
                    }
                    if (d.msg.includes('required') || d.msg.includes('Missing required')) {
                      return `${d.loc?.[1] || '该'}字段为必填项`;
                    }
                    return d.msg;
                  }
                  return null;
                }).filter(Boolean);
                
                if (fieldErrors.length > 0) {
                  userFriendlyMessage = fieldErrors.join('；');
                }
              } else if (errorData.msg) {
                userFriendlyMessage = errorData.msg;
              }
            }
          } catch {
            // JSON 解析失败，使用默认消息
          }
        }
        
        toast.error(userFriendlyMessage);
        throw err;
      }
    },
    [editingJob, createTask, updateTask, fetchTasks],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteTask(Number(deleteTarget.id));
      toast.success('任务已删除');
      await fetchTasks().catch(() => {});
    } catch (err) {
      toast.error(String(err));
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteTask, fetchTasks]);

  const handleRecommendAdd = useCallback((task: { title: string; desc: string }) => {
    setRecommendInitialValues({ name: task.title, message: task.desc });
    setEditingJob(null);
    setCreateOpen(true);
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className={stoMainInnerShell}>
          <TaskHero
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            sortValue={sortValue}
            onSortChange={setSortValue}
            onCreate={() => { setEditingJob(null); setCreateOpen(true); }}
            totalCount={tasks.length}
          />

          {loading && tasks.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <LoadingSpinner size="lg" />
            </div>
          ) : filteredTasks.length === 0 ? (
            <TaskEmptyState
              searchQuery={searchQuery}
              onCreate={() => { setEditingJob(null); setCreateOpen(true); }}
              onRecommendAdd={handleRecommendAdd}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTasks.map((job) => (
                <TaskCard
                  key={job.id}
                  job={job}
                  onToggle={(newEnabled) => handleToggle(job, newEnabled)}
                  onEdit={() => { setEditingJob(job); setCreateOpen(true); }}
                  onDelete={() => setDeleteTarget(job)}
                  onTrigger={() => handleTrigger(job)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <TaskCreateModal
        job={editingJob}
        sourceTask={editingSourceTask}
        open={createOpen}
        onClose={() => { setCreateOpen(false); setRecommendInitialValues(undefined); }}
        onSave={(input) => { setRecommendInitialValues(undefined); return handleSave(input); }}
        initialValues={recommendInitialValues}
      />

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
    </div>
  );
}
