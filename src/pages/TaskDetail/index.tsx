import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isStoTaskId, isYmdEntryId, taskOverviewPath, type StoTaskId } from '@/lib/sto-tasks';
import { formatMaterialDateFromEntryId } from '@/lib/sto-task-entry-label';
import { TaskSubitemChatSurface } from '@/pages/TaskDetail/TaskSubitemChatSurface';
import { stoTaskSubitemChatCanvasBg } from '@/lib/surfaces';
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
      <div
        className={cn(
          /* Pull into main bottom padding so gateway row sits closer to the window edge. */
          '-mb-5 flex min-h-0 min-w-0 flex-col overflow-hidden',
          /* TitleBar 2.5rem + main py-5 total 2.5rem vertical padding. */
          'h-[calc(100dvh-5rem)]',
        )}
      >
        <div
          className={cn(
            'sticky -top-5 z-20 w-full shrink-0 pt-0',
            stoTaskSubitemChatCanvasBg,
          )}
        >
          <div className="mx-auto w-full max-w-[var(--sto-main-inner-max)] pt-[16px]">
            <Link
              to="/"
              className={cn(
                'group flex min-w-0 max-w-full items-center gap-2.5 rounded-md text-foreground outline-none transition-colors',
                'hover:text-[var(--sto-brand-6)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sto-page-bg)] dark:focus-visible:ring-offset-background',
              )}
            >
              <ArrowLeft
                className="h-5 w-5 shrink-0 text-muted-foreground transition-colors group-hover:text-[var(--sto-brand-6)]"
                strokeWidth={2}
                aria-hidden
              />
              <h1 className="min-w-0 flex-1 truncate text-lg font-semibold leading-snug tracking-tight md:text-xl">{heading}</h1>
            </Link>
          </div>
        </div>
        <div className="mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden">
          <TaskSubitemChatSurface taskId={id} entryId={entryId} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[var(--sto-main-inner-max)] pb-10">
      <div className="mb-6">
        <Link
          to="/"
          className={cn(
            'group flex min-w-0 max-w-full items-center gap-2.5 rounded-md text-foreground outline-none transition-colors',
            'hover:text-[var(--sto-brand-6)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sto-page-bg)] dark:focus-visible:ring-offset-background',
          )}
        >
          <ArrowLeft
            className="h-5 w-5 shrink-0 text-muted-foreground transition-colors group-hover:text-[var(--sto-brand-6)]"
            strokeWidth={2}
            aria-hidden
          />
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold leading-snug tracking-tight md:text-xl">
            {t(`detail.${id}.pageTitle`)}
          </h1>
        </Link>
      </div>
      <TaskOverviewBody taskId={id} />
    </div>
  );
}
