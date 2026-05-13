import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

function StatusChip({ children, variant }: { children: React.ReactNode; variant: 'ok' | 'neutral' }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
        variant === 'ok' && 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
        variant === 'neutral' && 'bg-slate-500/12 text-slate-600 dark:text-slate-400',
      )}
    >
      {children}
    </span>
  );
}

function StatBlock({ label, value, unit }: { label: string; value: string; unit?: string }) {
  const u = unit?.trim();
  return (
    <div className="min-w-0 flex-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold tabular-nums text-foreground">
        {value}
        {u ? <span className="text-sm font-medium text-muted-foreground"> {u}</span> : null}
      </div>
    </div>
  );
}

interface SummaryCardProps {
  to: string;
  base: 'recon' | 'customer' | 'cost';
  statusVariant: 'ok' | 'neutral';
  columns: 2 | 3;
}

function SummaryCard({ to, base, statusVariant, columns }: SummaryCardProps) {
  const { t } = useTranslation('home');
  const p = `summary.${base}` as const;

  return (
    <Link
      to={to}
      className={cn(
        'flex min-w-[260px] flex-1 flex-col rounded-[24px] bg-white p-4 shadow-[0_4px_24px_rgba(15,23,42,0.06)] ring-1 ring-[var(--sto-sidebar-border)]',
        'transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_80px_rgba(15,23,42,0.12)]',
        'dark:bg-card dark:ring-border',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold leading-snug text-foreground">{t(`${p}.title`)}</h3>
            <span className="rounded-full bg-[var(--sto-accent-soft)] px-2 py-0.5 text-xs font-medium text-[#b45309] dark:bg-amber-950/50 dark:text-amber-200">
              {t(`${p}.pill`)}
            </span>
          </div>
        </div>
        <StatusChip variant={statusVariant}>{t(`${p}.status`)}</StatusChip>
      </div>

      <div className="mt-4 flex flex-row flex-wrap gap-4 sm:flex-nowrap">
        <StatBlock label={t(`${p}.stat1Label`)} value={t(`${p}.stat1Value`)} unit={t(`${p}.stat1Unit`, { defaultValue: '' })} />
        <StatBlock label={t(`${p}.stat2Label`)} value={t(`${p}.stat2Value`)} unit={t(`${p}.stat2Unit`, { defaultValue: '' })} />
        {columns === 3 ? (
          <StatBlock label={t(`${p}.stat3Label`)} value={t(`${p}.stat3Value`)} unit={t(`${p}.stat3Unit`, { defaultValue: '' })} />
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--sto-sidebar-border)] pt-3 dark:border-border">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex -space-x-1.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-7 w-7 shrink-0 rounded-full border-2 border-white bg-gradient-to-br from-slate-200 to-slate-300 dark:border-card dark:from-slate-600 dark:to-slate-700"
              />
            ))}
          </div>
          <span className="truncate text-sm text-muted-foreground" title={t(`${p}.footerTeam`)}>
            {t(`${p}.footerTeam`)}
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-[var(--sto-accent)]">
          {t(`${p}.footerHint`)}
          <ChevronRight className="h-4 w-4" aria-hidden />
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
      <div className="-mx-1 flex gap-5 overflow-x-auto pb-1 pt-1 [scrollbar-gutter:stable]">
        <SummaryCard to="/chat" base="recon" statusVariant="ok" columns={3} />
        <SummaryCard to="/models" base="customer" statusVariant="neutral" columns={3} />
        <SummaryCard to="/cron" base="cost" statusVariant="ok" columns={2} />
      </div>
    </section>
  );
}
