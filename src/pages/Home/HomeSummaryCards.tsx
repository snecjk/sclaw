import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { taskLatestPath, type StoTaskId } from '@/lib/sto-tasks';

/** 状态角标：成功态对齐 sto-design Green-1 / Green-7；中性态 Grey-3 / Grey-9 */
function StatusChip({ children, variant }: { children: React.ReactNode; variant: 'ok' | 'neutral' }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium',
        variant === 'ok' && 'bg-[#DCF5E2] text-[#008F40] dark:bg-emerald-950/40 dark:text-emerald-300',
        variant === 'neutral' && 'bg-[#F0F2F5] text-[#4E5969] dark:bg-muted dark:text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

/** 分类标签：Brand-1 底 + Brand-7 字（sto-design） */
function CategoryPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-md bg-[#FFF5E6] px-2 py-0.5 text-xs font-medium text-[#D95700] dark:bg-amber-950/45 dark:text-amber-200">
      {children}
    </span>
  );
}

function StatBlock({ label, value, unit }: { label: string; value: string; unit?: string }) {
  const u = unit?.trim();
  return (
    <div className="min-w-0 text-left">
      <div className="text-[13px] leading-snug text-[#86909C] dark:text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-lg font-bold tabular-nums leading-tight text-[#1D2129] dark:text-foreground sm:text-xl">
        {value}
        {u ? <span className="text-[15px] font-semibold text-[#1D2129] dark:text-foreground"> {u}</span> : null}
      </div>
    </div>
  );
}

interface SummaryCardProps {
  taskId: StoTaskId;
  base: 'recon' | 'customer' | 'cost';
  statusVariant: 'ok' | 'neutral';
  columns: 2 | 3;
}

function SummaryCard({ taskId, base, statusVariant, columns }: SummaryCardProps) {
  const { t } = useTranslation('home');
  const p = `summary.${base}` as const;
  const bodyCaption = t(`${p}.bodyCaption`, { defaultValue: '' }).trim();
  const showStackBody = Boolean(bodyCaption);

  return (
    <Link
      to={taskLatestPath(taskId)}
      className={cn(
        'flex min-h-0 min-w-0 flex-col rounded-2xl bg-white p-5 shadow-[0_2px_12px_rgba(29,33,41,0.08)] ring-1 ring-[#E8EAEF]',
        'transition-shadow duration-200 hover:shadow-[0_8px_28px_rgba(29,33,41,0.1)]',
        'dark:bg-card dark:ring-border',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold leading-snug text-[#1D2129] dark:text-foreground">{t(`${p}.title`)}</h3>
            <CategoryPill>{t(`${p}.pill`)}</CategoryPill>
          </div>
        </div>
        <StatusChip variant={statusVariant}>{t(`${p}.status`)}</StatusChip>
      </div>

      {showStackBody ? (
        <div className="mt-5 min-h-[4.5rem]">
          <p className="text-[13px] leading-snug text-[#86909C] dark:text-muted-foreground">{bodyCaption}</p>
          <p className="mt-1.5 text-[15px] font-semibold leading-relaxed text-[#1D2129] dark:text-foreground">
            {t(`${p}.bodyDetail`)}
          </p>
        </div>
      ) : (
        <div
          className={cn(
            'mt-5 grid min-h-[4.5rem] gap-3',
            columns === 3 ? 'grid-cols-3' : 'grid-cols-2',
          )}
        >
          <StatBlock label={t(`${p}.stat1Label`)} value={t(`${p}.stat1Value`)} unit={t(`${p}.stat1Unit`, { defaultValue: '' })} />
          <StatBlock label={t(`${p}.stat2Label`)} value={t(`${p}.stat2Value`)} unit={t(`${p}.stat2Unit`, { defaultValue: '' })} />
          {columns === 3 ? (
            <StatBlock label={t(`${p}.stat3Label`)} value={t(`${p}.stat3Value`)} unit={t(`${p}.stat3Unit`, { defaultValue: '' })} />
          ) : null}
        </div>
      )}

      <div className="mt-5 flex min-h-[40px] items-center gap-2 border-t border-[#E5E6EB] pt-4 dark:border-border">
        <div className="flex shrink-0 -space-x-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-8 w-8 shrink-0 rounded-full border-2 border-white bg-gradient-to-br from-[#E5E6EB] to-[#C9CDD4] dark:border-card dark:from-slate-600 dark:to-slate-700"
            />
          ))}
        </div>
        <p className="min-w-0 flex-1 truncate text-center text-[13px] text-[#86909C] dark:text-muted-foreground" title={t(`${p}.footerTeam`)}>
          {t(`${p}.footerTeam`)}
        </p>
        <span className="flex max-w-[48%] shrink-0 items-center justify-end gap-0.5 truncate text-[13px] font-medium text-[#86909C] dark:text-muted-foreground">
          {t(`${p}.footerHint`)}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#86909C] opacity-80 dark:text-muted-foreground" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

export function HomeSummaryCards({ className }: { className?: string }) {
  const { t } = useTranslation('home');
  return (
    <section className={className} aria-labelledby="home-summary-heading">
      <h2 id="home-summary-heading" className="sr-only">
        {t('summary.heading')}
      </h2>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-5">
        <SummaryCard taskId="hq-reconciliation" base="recon" statusVariant="ok" columns={3} />
        <SummaryCard taskId="abnormal-customers" base="customer" statusVariant="neutral" columns={3} />
        <SummaryCard taskId="outbound-cost" base="cost" statusVariant="ok" columns={3} />
      </div>
    </section>
  );
}
