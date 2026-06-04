/**
 * Cron Page
 * Manage scheduled tasks (legacy local Gateway tasks)
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { useCronStore } from '@/stores/cron';
import { useGatewayStore } from '@/stores/gateway';
import { useChatStore } from '@/stores/chat';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { CronJob, CronJobCreateInput } from '@/types/cron';

import { CronTaskHero } from './components/CronTaskHero';
import { CronTaskCard } from './components/CronTaskCard';
import { CronTaskCreateModal } from './components/CronTaskCreateModal';
import { CronTaskEmptyState, type RecommendTask } from './components/CronTaskEmptyState';
import { filterTasks, sortTasks } from './components/utils';

export function Cron() {
  const { t } = useTranslation('cron');
  const { jobs, loading, error, fetchJobs, createJob, updateJob, toggleJob, deleteJob, triggerJob } = useCronStore();
  const gatewayStatus = useGatewayStore((state) => state.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const [searchQuery, setSearchQuery] = useState('');
  const [sortValue, setSortValue] = useState('created-desc');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CronJob | null>(null);
  const [recommendInitialValues, setRecommendInitialValues] = useState<{ name?: string; message?: string } | undefined>(undefined);

  // Fetch jobs on mount
  useEffect(() => {
    if (isGatewayRunning) {
      fetchJobs();
    }
  }, [fetchJobs, isGatewayRunning]);

  const safeJobs = useMemo(() => (Array.isArray(jobs) ? jobs : []), [jobs]);

  const filteredTasks = useMemo(() => {
    let result = filterTasks(safeJobs, searchQuery);
    result = sortTasks(result, sortValue);
    return result;
  }, [safeJobs, searchQuery, sortValue]);

  const handleSave = useCallback(
    async (input: CronJobCreateInput) => {
      try {
        if (editingJob) {
          await updateJob(editingJob.id, input);
          toast.success(t('toast.updated'));
        } else {
          await createJob(input);
          toast.success(t('toast.created'));
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
    [editingJob, createJob, updateJob, fetchJobs, t]
  );

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await toggleJob(id, enabled);
        toast.success(enabled ? t('toast.enabled') : t('toast.paused'));
      } catch {
        toast.error(t('toast.failedUpdate'));
      }
    },
    [toggleJob, t]
  );

  const handleTrigger = useCallback(
    async (job: CronJob) => {
      try {
        await triggerJob(job.id);
        const sessionKey = `agent:${job.agentId ?? 'main'}:cron:${job.id}`;
        useChatStore.getState().switchSession(sessionKey);
      } catch (error) {
        console.error('Failed to trigger cron job:', error);
        toast.error(t('toast.failedTrigger', { error: error instanceof Error ? error.message : String(error) }));
      }
    },
    [triggerJob, t]
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteJob(deleteTarget.id);
      toast.success(t('toast.deleted'));
      await fetchJobs().catch(() => {});
    } catch {
      toast.error(t('toast.failedDelete'));
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteJob, fetchJobs, t]);

  const handleRecommendAdd = useCallback((task: RecommendTask) => {
    setRecommendInitialValues({ name: task.title, message: task.desc });
    setEditingJob(null);
    setCreateOpen(true);
  }, []);

  if (loading && safeJobs.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-center py-20">
              <LoadingSpinner size="lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-7xl mx-auto">
          <CronTaskHero
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            sortValue={sortValue}
            onSortChange={setSortValue}
            onCreate={() => { setEditingJob(null); setRecommendInitialValues(undefined); setCreateOpen(true); }}
            totalCount={safeJobs.length}
            isGatewayRunning={isGatewayRunning}
          />

          {!isGatewayRunning && (
            <div className="flex items-center gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 mb-6">
              <AlertCircle className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
              <span className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                {t('gatewayWarning')}
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 mb-6">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              <span className="text-sm font-medium text-destructive">{error}</span>
            </div>
          )}

          {filteredTasks.length === 0 ? (
            <CronTaskEmptyState
              searchQuery={searchQuery}
              onCreate={() => { setEditingJob(null); setRecommendInitialValues(undefined); setCreateOpen(true); }}
              onRecommendAdd={handleRecommendAdd}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTasks.map((job) => (
                <CronTaskCard
                  key={job.id}
                  job={job}
                  onToggle={(newEnabled) => handleToggle(job.id, newEnabled)}
                  onEdit={() => { setEditingJob(job); setRecommendInitialValues(undefined); setCreateOpen(true); }}
                  onDelete={() => setDeleteTarget(job)}
                  onTrigger={() => handleTrigger(job)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <CronTaskCreateModal
        job={editingJob}
        open={createOpen}
        onClose={() => { setCreateOpen(false); setRecommendInitialValues(undefined); }}
        onSave={(input) => { setRecommendInitialValues(undefined); return handleSave(input); }}
        initialValues={recommendInitialValues}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('common:actions.confirm', 'Confirm')}
        message={t('card.deleteConfirm')}
        confirmLabel={t('common:actions.delete', 'Delete')}
        cancelLabel={t('common:actions.cancel', 'Cancel')}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default Cron;
