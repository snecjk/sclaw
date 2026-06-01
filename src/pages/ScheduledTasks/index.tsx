/**
 * Scheduled Tasks Page (Redesigned)
 * Independent page using the new STO Scheduled Tasks API.
 * Does NOT mix with legacy local cron store.
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useScheduledTasksStore } from '@/stores/scheduledTasks';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { toast } from 'sonner';
import { TaskHero } from './components/TaskHero';
import { TaskCard } from './components/TaskCard';
import { TaskCreateModal } from './components/TaskCreateModal';
import { TaskEmptyState } from './components/TaskEmptyState';
import type { CronJob, CronJobCreateInput } from '@/types/cron';

// View model for the card grid (adapts ScheduledTask shape to what TaskCard expects)
interface TaskViewModel extends CronJob {
  isCloud: true;
}

function toViewModel(task: import('@/types/scheduled-task').ScheduledTask): TaskViewModel {
  return {
    id: String(task.id),
    name: task.name,
    message: task.description || '',
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

  useEffect(() => {
    fetchTasks().catch(() => {});
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
    async (job: TaskViewModel) => {
      try {
        await toggleTask(Number(job.id), !job.enabled);
        toast.success(job.enabled ? '任务已暂停' : '任务已启用');
      } catch (err) {
        toast.error(String(err));
      }
    },
    [toggleTask],
  );

  const handleTrigger = useCallback(
    async (job: TaskViewModel) => {
      try {
        await triggerTask(Number(job.id));
        toast.success('测试运行已触发');
      } catch (err) {
        toast.error(String(err));
      }
    },
    [triggerTask],
  );

  const handleSave = useCallback(
    async (input: CronJobCreateInput) => {
      if (editingJob) {
        await updateTask({
          taskId: Number(editingJob.id),
          name: input.name,
          cronExpr: input.schedule,
          description: input.message,
        });
        toast.success('任务已更新');
      } else {
        await createTask({
          name: input.name,
          cronExpr: input.schedule,
          description: input.message,
        });
        toast.success('任务已创建');
      }
      await fetchTasks().catch(() => {});
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
    setEditingJob(null);
    setCreateOpen(true);
    setTimeout(() => {
      const nameInput = document.querySelector<HTMLInputElement>('input[placeholder="描述你的任务"]');
      if (nameInput) nameInput.value = task.title;
      const msgInput = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="让 STO Claw 帮你做什么…"]');
      if (msgInput) msgInput.value = task.desc;
    }, 100);
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-7xl mx-auto">
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
                  onToggle={(enabled) => handleToggle({ ...job, enabled })}
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
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={handleSave}
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
