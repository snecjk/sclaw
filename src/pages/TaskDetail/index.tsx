import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isStoTaskId, isValidTaskEntry, taskLatestPath, type StoTaskId } from '@/lib/sto-tasks';
import { HomeAssistant } from '@/pages/Home/HomeAssistant';
import { cn } from '@/lib/utils';

function TaskTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--sto-sidebar-border)] bg-white dark:border-border dark:bg-card">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--sto-sidebar-border)] text-xs font-medium text-muted-foreground dark:border-border">
              {headers.map((h) => (
                <th key={h} className="px-4 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, i) => (
              <tr key={i} className="border-b border-[var(--sto-sidebar-border)] last:border-0 dark:border-border">
                {cells.map((c, j) => (
                  <td key={j} className="px-4 py-3 tabular-nums text-foreground">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TaskDetailBody({ taskId }: { taskId: StoTaskId }) {
  const { t } = useTranslation('tasks');
  const p = `detail.${taskId}` as const;

  const summary = t(`${p}.summary`, { returnObjects: true }) as { headers: string[]; rows: string[][] };
  const abnormal = t(`${p}.abnormal`, { returnObjects: true }) as { headers: string[]; rows: string[][] };

  return (
    <>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`${p}.intro`)}</p>
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm text-muted-foreground">
        <div>
          <dt className="inline text-muted-foreground">{t(`${p}.metaReconTime`)}</dt>
          <dd className="ml-2 inline font-medium text-foreground">{t(`${p}.metaReconTimeValue`)}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">{t(`${p}.metaGenerated`)}</dt>
          <dd className="ml-2 inline font-medium text-foreground">{t(`${p}.metaGeneratedValue`)}</dd>
        </div>
      </dl>

      <TaskTable title={t(`${p}.summaryTitle`)} headers={summary.headers} rows={summary.rows} />
      <TaskTable title={t(`${p}.abnormalTitle`)} headers={abnormal.headers} rows={abnormal.rows} />

      <div className="mt-10 space-y-3 rounded-xl border border-dashed border-[var(--sto-sidebar-border)] bg-[var(--sto-page-bg)] p-4 text-sm text-muted-foreground dark:border-border dark:bg-muted/30">
        <p>{t(`${p}.threadLine1`)}</p>
        <p>{t(`${p}.threadLine2`)}</p>
      </div>

      <HomeAssistant className="mt-10" />
    </>
  );
}

/**
 * 任务「最新一条」详情表面（占位数据 + 真实导航），对齐 OpenSpec home-task-list-surface。
 */
export function TaskDetail() {
  const { taskId, entryId } = useParams<{ taskId: string; entryId?: string }>();
  const { t } = useTranslation('tasks');

  if (!taskId || !isStoTaskId(taskId)) {
    return <Navigate to="/" replace />;
  }

  const id = taskId;

  if (!entryId) {
    return <Navigate to={taskLatestPath(id)} replace />;
  }

  if (!isValidTaskEntry(id, entryId)) {
    return <Navigate to={taskLatestPath(id)} replace />;
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

      <TaskDetailBody taskId={id} />
    </div>
  );
}
