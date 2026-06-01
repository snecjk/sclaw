/**
 * Scheduled Tasks Page (Redesigned)
 * Replaces the existing Cron page with a new card-based UI.
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useCronStore } from '@/stores/cron';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { toast } from 'sonner';
import { TaskHero } from './components/TaskHero';
import { TaskCard } from './components/TaskCard';
import { TaskCreateModal } from './components/TaskCreateModal';
import { TaskEmptyState } from './components/TaskEmptyState';
import type { CronJob, CronJobCreateInput, ScheduledTask } from '@/types/cron';

// Extended job type for unified display (local + scheduled)
interface UnifiedJob extends CronJob {
  isCloud?: boolean;
  agentId?: string;
  agentName?: string;
}

function mapScheduledTaskToUnified(task: ScheduledTask): UnifiedJob {
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
      ? {
          time: task.lastRunAt,
          success: task.lastRunStatus === 'success',
        }
      : undefined,
    isCloud: true,
  };
}

// Sort comparator
function sortJobs(jobs: UnifiedJob[], sort: string): UnifiedJob[] {
  const sorted = [...jobs];
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
    jobs,
    scheduledTasks,
    loading,
    fetchScheduledTasks,
    createScheduledTask,
    updateScheduledTask,
    deleteScheduledTask,
    toggleScheduledTask,
    triggerScheduledTask,
    fetchJobs,
    updateJob,
    deleteJob,
    toggleJob,
    triggerJob,
  } = useCronStore();

  // Local UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortValue, setSortValue] = useState('created-desc');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<UnifiedJob | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ job: UnifiedJob; isCloud: boolean } | null>(null);

  // Initial fetch
  useEffect(() => {
    Promise.all([
      fetchScheduledTasks().catch(() => {}),
      fetchJobs().catch(() => {}),
    ]);
  }, [fetchScheduledTasks, fetchJobs]);

  // Merge local jobs and scheduled tasks for unified display
  const allJobs = useMemo((): UnifiedJob[] => {
    const unified: UnifiedJob[] = [
      ...jobs.map(j => ({ ...j, isCloud: false as const })),
      ...scheduledTasks.map(mapScheduledTaskToUnified),
    ];
    return unified;
  }, [jobs, scheduledTasks]);

  // Filter + Sort
  const filteredJobs = useMemo(() => {
    let result = allJobs;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(j =>
        j.name.toLowerCase().includes(q) ||
        j.message.toLowerCase().includes(q)
      );
    }
    return sortJobs(result, sortValue);
  }, [allJobs, searchQuery, sortValue]);

  // Handlers
  const handleToggle = useCallback(async (job: UnifiedJob) => {
    try {
      if (job.isCloud) {
        await toggleScheduledTask(Number(job.id), !job.enabled);
      } else {
        await toggleJob(job.id, !job.enabled);
      }
      toast.success(job.enabled ? '任务已暂停' : '任务已启用');
    } catch (err) {
      toast.error(String(err));
    }
  }, [toggleJob, toggleScheduledTask]);

  const handleTrigger = useCallback(async (job: UnifiedJob) => {
    try {
      if (job.isCloud) {
        await triggerScheduledTask(Number(job.id));
      } else {
        await triggerJob(job.id);
      }
      toast.success('测试运行已触发');
    } catch (err) {
      toast.error(String(err));
    }
  }, [triggerJob, triggerScheduledTask]);

  const handleSave = useCallback(async (input: CronJobCreateInput) => {
    if (editingJob) {
      if (editingJob.isCloud) {
        await updateScheduledTask({
          taskId: Number(editingJob.id),
          name: input.name,
          cronExpr: input.schedule,
          description: input.message,
        });
      } else {
        await updateJob(editingJob.id, input);
      }
      toast.success('任务已更新');
    } else {
      // Create as scheduled task (new API) by default
      await createScheduledTask({
        name: input.name,
        cronExpr: input.schedule,
        description: input.message,
      });
      toast.success('任务已创建');
    }
    await Promise.all([
      fetchScheduledTasks().catch(() => {}),
      fetchJobs().catch(() => {}),
    ]);
  }, [editingJob, createScheduledTask, updateScheduledTask, updateJob, fetchScheduledTasks, fetchJobs]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.isCloud) {
        await deleteScheduledTask(Number(deleteTarget.job.id));
      } else {
        await deleteJob(deleteTarget.job.id);
      }
      toast.success('任务已删除');
      await Promise.all([
        fetchScheduledTasks().catch(() => {}),
        fetchJobs().catch(() => {}),
      ]);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteJob, deleteScheduledTask, fetchScheduledTasks, fetchJobs]);

  const handleRecommendAdd = useCallback((task: { title: string; desc: string }) => {
    setEditingJob(null);
    setCreateOpen(true);
    // Pre-fill after modal opens
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
          {/* Hero */}
          <TaskHero
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            sortValue={sortValue}
            onSortChange={setSortValue}
            onCreate={() => { setEditingJob(null); setCreateOpen(true); }}
            totalCount={allJobs.length}
          />

          {/* Loading */}
          {loading && allJobs.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <LoadingSpinner size="lg" />
            </div>
          ) : filteredJobs.length === 0 ? (
            <TaskEmptyState
              searchQuery={searchQuery}
              onCreate={() => { setEditingJob(null); setCreateOpen(true); }}
              onRecommendAdd={handleRecommendAdd}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredJobs.map((job) => (
                <TaskCard
                  key={`${job.isCloud ? 'cloud' : 'local'}-${job.id}`}
                  job={job}
                  onToggle={(enabled) => handleToggle({ ...job, enabled })}
                  onEdit={() => { setEditingJob(job); setCreateOpen(true); }}
                  onDelete={() => setDeleteTarget({ job, isCloud: !!job.isCloud })}
                  onTrigger={() => handleTrigger(job)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create / Edit Modal */}
      <TaskCreateModal
        job={editingJob}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={handleSave}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="删除定时任务？"
        message={`确定要删除「${deleteTarget?.job.name ?? ''}」吗？此操作无法撤销。`}
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="destructive"
      />
    </div>
  );
}
