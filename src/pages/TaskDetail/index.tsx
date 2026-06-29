import { Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isStoTaskId, isYmdEntryId, taskOverviewPath, type StoTaskId } from '@/lib/sto-tasks';
import { TaskSubitemChatSurface } from '@/pages/TaskDetail/TaskSubitemChatSurface';
import { stoChatShellPageClass } from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import { useSplitGridPassthroughClass } from '@/hooks/use-split-grid-passthrough-class';
import { useAuthStore } from '@/stores/auth';
import { useStoTaskSubitemsStore } from '@/stores/sto-task-subitems';
import { useContentHeader } from '@/components/layout/content-header-context';

function TaskOverviewBody({ taskId }: { taskId: StoTaskId }) {
  const { t } = useTranslation('tasks');
  const p = `detail.${taskId}` as const;
  return (
    <>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`${p}.intro`)}</p>
      <p className="mt-6 text-sm text-muted-foreground">{t('overviewHint')}</p>
    </>
  );
}

/** 任务总览：标题走全局 ContentHeader，避免与页内 h1 重复 */
function TaskOverviewPage({ taskId }: { taskId: StoTaskId }) {
  const { t } = useTranslation('tasks');
  useContentHeader({ title: t(`detail.${taskId}.pageTitle`) });

  return (
    <div className={cn(stoChatShellPageClass, 'pb-10')}>
      <TaskOverviewBody taskId={taskId} />
    </div>
  );
}

function TaskSubitemPage({ id, entryId }: { id: StoTaskId; entryId: string }) {
  const { isSplitGridPassthrough, splitGridPassthroughClass } = useSplitGridPassthroughClass();

  return (
    <div
      className={cn(
        isSplitGridPassthrough
          ? splitGridPassthroughClass
          : 'flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden',
      )}
    >
      <TaskSubitemChatSurface taskId={id} entryId={entryId} className="min-h-0 flex-1" />
    </div>
  );
}

export function TaskDetail() {
  const { taskId, entryId } = useParams<{ taskId: string; entryId?: string }>();
  const crmWeekReportSurfaceAllowed = useAuthStore((s) => s.crmWeekReportSurfaceAllowed);
  const listEntries = useStoTaskSubitemsStore((s) => s.listEntries);

  if (!crmWeekReportSurfaceAllowed) {
    return <Navigate to="/" replace />;
  }

  if (!taskId || !isStoTaskId(taskId)) {
    return <Navigate to="/" replace />;
  }

  const id = taskId;
  const entries = listEntries(id);

  if (entryId) {
    if (!isYmdEntryId(entryId) || !entries.includes(entryId)) {
      return <Navigate to={taskOverviewPath(id)} replace />;
    }
    useStoTaskSubitemsStore.getState().ensureSubitem(id, entryId);
    return <TaskSubitemPage id={id} entryId={entryId} />;
  }

  return <TaskOverviewPage taskId={id} />;
}
