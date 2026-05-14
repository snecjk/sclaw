import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isStoTaskId, isYmdEntryId, taskOverviewPath, type StoTaskId } from '@/lib/sto-tasks';
import { formatMaterialDateFromEntryId } from '@/lib/sto-task-entry-label';
import { TaskSubitemChatSurface } from '@/pages/TaskDetail/TaskSubitemChatSurface';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { useStoTaskSubitemsStore } from '@/stores/sto-task-subitems';

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

export function TaskDetail() {
  const { taskId, entryId } = useParams<{ taskId: string; entryId?: string }>();
  const { t, i18n } = useTranslation('tasks');
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
    const dateLabel = formatMaterialDateFromEntryId(entryId, i18n.language);
    const heading = t('subitemMaterialHeading', { date: dateLabel });
    return (
      <div className="mx-auto w-full max-w-[var(--sto-main-inner-max)] pb-10">
        <div className="mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-[var(--sto-brand-6)]"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            {t('backHome')}
          </Link>
          <h1 className={cn('mt-4 text-2xl font-bold tracking-tight text-foreground')}>{heading}</h1>
        </div>
        <TaskSubitemChatSurface taskId={id} entryId={entryId} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[var(--sto-main-inner-max)] pb-10">
      <div className="mb-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-[var(--sto-brand-6)]"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          {t('backHome')}
        </Link>
        <h1 className={cn('mt-4 text-2xl font-bold tracking-tight text-foreground')}>{t(`detail.${id}.pageTitle`)}</h1>
      </div>
      <TaskOverviewBody taskId={id} />
    </div>
  );
}
