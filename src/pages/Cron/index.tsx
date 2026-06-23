/**
 * Cron Page
 * Manage scheduled tasks (legacy local Gateway tasks)
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { useCronStore } from '@/stores/cron';
import { useGatewayStore } from '@/stores/gateway';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { navigateToMainChatHome } from '@/lib/main-chat-navigation';
import { useLocation, useNavigate } from 'react-router-dom';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from 'sonner';
import { stoMainInnerShell } from '@/lib/surfaces';
import { useTranslation } from 'react-i18next';
import type { ManagedLocalTask } from '@/stores/cron';
import { CronTaskHero } from './components/CronTaskHero';
import { CronTaskCard } from './components/CronTaskCard';
import { CronTaskCreateModal, type CronTaskFormInput } from './components/CronTaskCreateModal';
import { CronTaskEmptyState, type RecommendTask } from './components/CronTaskEmptyState';
import { filterTasks, sortTasks } from './components/utils';
import { prepareDingTalkAgentTurnMessage } from '@/lib/scheduled-task-recipients';

function resolvePreferredAgentByEngine(
  agents: Array<{ id: string; engineType?: 'openclaw' | 'claude'; workspace: string }>,
  defaultAgentId: string,
  _engineType: 'openclaw' | 'claude',
) {
  if (agents.length === 0) return null;
  return agents.find((agent) => agent.id === defaultAgentId) ?? agents[0] ?? null;
}

function toTriggerErrorMessage(error: unknown, t: (key: string, options?: Record<string, unknown>) => string): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('already running')) {
    return t('toast.alreadyRunning');
  }

  return t('toast.failedTrigger', { error: message });
}

export function Cron() {
  const { t } = useTranslation('cron');
  const { jobs, loading, error, fetchJobs, createJob, updateJob, toggleJob, deleteJob, triggerJob } = useCronStore();
  const agents = useAgentsStore((state) => state.agents);
  const defaultAgentId = useAgentsStore((state) => state.defaultAgentId);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const navigate = useNavigate();
  const location = useLocation();

  const [searchQuery, setSearchQuery] = useState('');
  const [sortValue, setSortValue] = useState('created-desc');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ManagedLocalTask | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagedLocalTask | null>(null);
  const [recommendInitialValues, setRecommendInitialValues] = useState<{ name?: string; message?: string } | undefined>(undefined);

  // Fetch jobs on mount
  const hasAnyAgent = useMemo(() => agents.length > 0, [agents]);
  const canCreateTasks = isGatewayRunning || hasAnyAgent;

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const safeJobs = useMemo(() => (Array.isArray(jobs) ? jobs : []), [jobs]);

  const filteredTasks = useMemo(() => {
    let result = filterTasks(safeJobs, searchQuery);
    result = sortTasks(result, sortValue);
    return result;
  }, [safeJobs, searchQuery, sortValue]);

  const handleSave = useCallback(
    async (input: CronTaskFormInput) => {
      const selectedAgent = resolvePreferredAgentByEngine(agents, defaultAgentId, input.engineType);
      try {
        if (editingJob) {
          if (editingJob.engineType === 'claude') {
            if (!selectedAgent?.id) {
              throw new Error('所选 Claude 代理缺少工作区，无法更新本地定时任务');
            }
            const promptTemplate = prepareDingTalkAgentTurnMessage(input.message, input.dingTalkMentions);
            await updateJob(editingJob.id, {
              engineType: 'claude',
              payload: {
                id: editingJob.id,
                name: input.name,
                enabled: editingJob.enabled,
                cronExpr: input.schedule,
                promptTemplate,
                agentId: selectedAgent.id,
                workspacePath: input.claudeWorkspacePath || selectedAgent.workspace,
                permissionProfile: input.claudePermissionProfile || 'dangerous-bypass',
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
          toast.success(t('toast.updated'));
        } else {
          if (input.engineType === 'claude') {
            if (!selectedAgent?.id) {
              throw new Error('所选 Claude 代理缺少工作区，无法创建本地定时任务');
            }
            const promptTemplate = prepareDingTalkAgentTurnMessage(input.message, input.dingTalkMentions);
            await createJob({
              engineType: 'claude',
              payload: {
                name: input.name,
                cronExpr: input.schedule,
                promptTemplate,
                agentId: selectedAgent.id,
                workspacePath: input.claudeWorkspacePath || selectedAgent.workspace,
                permissionProfile: input.claudePermissionProfile || 'dangerous-bypass',
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
    [agents, defaultAgentId, editingJob, createJob, updateJob, fetchJobs, t]
  );

  const handleToggle = useCallback(
    async (id: string, enabled: boolean, engineType: 'openclaw' | 'claude') => {
      try {
        await toggleJob(id, enabled, engineType);
        toast.success(enabled ? t('toast.enabled') : t('toast.paused'));
      } catch {
        toast.error(t('toast.failedUpdate'));
      }
    },
    [toggleJob, t]
  );

  const handleTrigger = useCallback(
    async (job: ManagedLocalTask) => {
      try {
        const result = await triggerJob(job.id, job.engineType);
        if (job.engineType === 'claude' && result && 'sessionKey' in result) {
          navigateToMainChatHome(navigate, location.pathname, () => {
            useChatStore.getState().switchSession(result.sessionKey);
          });
          void useChatStore.getState().loadSessions();
        } else {
          // Build dated session key instead of base key to avoid adding base session back
          const today = new Date();
          const y = today.getFullYear();
          const m = String(today.getMonth() + 1).padStart(2, '0');
          const d = String(today.getDate()).padStart(2, '0');
          const sessionKey = `agent:${job.agentId ?? 'main'}:cron:${job.id}:${y}-${m}-${d}`;
          navigateToMainChatHome(navigate, location.pathname, () => {
            useChatStore.getState().switchSession(sessionKey);
          });
          void useChatStore.getState().loadSessions();
        }
        toast.success(t('toast.triggered'));
      } catch (error) {
        console.error('Failed to trigger cron job:', error);
        toast.error(toTriggerErrorMessage(error, t));
      }
    },
    [triggerJob, t, navigate, location.pathname]
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteJob(deleteTarget.id, deleteTarget.engineType);
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
          <div className={stoMainInnerShell}>
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
        <div className={stoMainInnerShell}>
          <CronTaskHero
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            sortValue={sortValue}
            onSortChange={setSortValue}
            onCreate={() => { setEditingJob(null); setRecommendInitialValues(undefined); setCreateOpen(true); }}
            totalCount={safeJobs.length}
            isGatewayRunning={canCreateTasks}
          />

          {!isGatewayRunning && (
            <div className="flex items-center gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4 mb-6">
              <AlertCircle className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
              <span className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                {hasAnyAgent ? 'Gateway 未连接，现有 OpenClaw 本地任务不可用；仍可创建和查看 Claude 本地任务。' : t('gatewayWarning')}
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
                  key={`${job.engineType}:${job.id}`}
                  job={job}
                  onToggle={(newEnabled) => handleToggle(job.id, newEnabled, job.engineType)}
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
