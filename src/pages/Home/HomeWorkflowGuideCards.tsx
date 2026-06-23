import { ChevronRight } from 'lucide-react';
import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  homeHubCardDescClass,
  homeHubCardGridClass,
  homeHubCardTagClass,
  homeHubCardTitleClass,
  homeHubInteractiveCardShellClass,
  homeHubTextPrimary,
  homeHubTextSecondary,
} from './home-hub-surface-styles';
import avatar01 from '@/assets/avatars/avatar-01.png.png';
import avatar02 from '@/assets/avatars/avatar-02.png.png';
import avatar03 from '@/assets/avatars/avatar-03.png.png';
import avatar04 from '@/assets/avatars/avatar-04.png.png';
import avatar05 from '@/assets/avatars/avatar-05.png.png';
import avatar06 from '@/assets/avatars/avatar-06.png.png';

const AVATAR_POOL = [avatar01, avatar02, avatar03, avatar04, avatar05, avatar06] as const;

function pickThreeAvatars(seed: string): readonly [string, string, string] {
  const arr = [...AVATAR_POOL];
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = arr.length - 1; i > 0; i--) {
    h = Math.imul(h ^ i, 16777619);
    const j = (h >>> 0) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return [arr[0], arr[1], arr[2]] as const;
}

function StatusChip({ children, variant }: { children: React.ReactNode; variant: 'ok' | 'pending' | 'neutral' }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium',
        variant === 'ok' && 'bg-[#DCF5E2] text-[#008F40] dark:bg-emerald-950/40 dark:text-emerald-300',
        variant === 'pending' && 'bg-[#FFF5E6] text-[#D95700] dark:bg-amber-950/45 dark:text-amber-200',
        variant === 'neutral' && 'bg-[#F0F2F5] text-[#4E5969] dark:bg-muted dark:text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function CategoryPill({ children }: { children: React.ReactNode }) {
  return (
    <span className={cn('shrink-0', homeHubCardTagClass)}>
      {children}
    </span>
  );
}

function StatBlock({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  unit?: string;
  highlight?: boolean;
}) {
  const u = unit?.trim();
  if (!label.trim() && !value.trim()) return null;
  return (
    <div className="min-w-0 text-left">
      <div className={cn('text-[13px] leading-snug', homeHubTextSecondary)}>{label}</div>
      <div
        className={cn(
          'mt-1 truncate text-lg font-bold tabular-nums leading-tight sm:text-xl',
          highlight ? 'text-primary' : homeHubTextPrimary,
        )}
      >
        {value}
        {u ? (
          <span
            className={cn(
              'text-[15px] font-semibold',
              highlight ? 'text-primary' : homeHubTextPrimary,
            )}
          >
            {' '}
            {u}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AvatarStack({ urls }: { urls: readonly [string, string, string] }) {
  return (
    <div className="flex shrink-0 -space-x-2" aria-hidden>
      {urls.map((src, i) => (
        <img
          key={`${src}-${i}`}
          src={src}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[#E5E6EB] dark:border-card dark:ring-border"
        />
      ))}
    </div>
  );
}

const cardShell = homeHubInteractiveCardShellClass;

type GuideCardBase = 'monitor' | 'recon' | 'cost';

type GuideCardProps = {
  avatarSeed: string;
  base: GuideCardBase;
  statusVariant: 'ok' | 'pending' | 'neutral';
  mode: 'configure' | 'disabled';
  hideStatus?: boolean;
  onSend?: (text: string) => void;
};

function GuideCard({
  avatarSeed,
  base,
  statusVariant,
  mode,
  hideStatus,
  onSend,
}: GuideCardProps) {
  const { t } = useTranslation('home');
  const disabled = mode === 'disabled';
  const p = `site.workflowGuide.${base}` as const;
  const avatarUrls = useMemo(() => pickThreeAvatars(avatarSeed), [avatarSeed]);

  const handleClick = useCallback(() => {
    if (disabled) return;
    onSend?.(t(`${p}.createPrompt`));
  }, [disabled, onSend, p, t]);

  const footerHintClass = disabled ? homeHubTextSecondary : 'text-[#4760FE] dark:text-blue-400';

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={homeHubCardTitleClass}>{t(`${p}.title`)}</h3>
            <CategoryPill>{t(`${p}.pill`)}</CategoryPill>
          </div>
        </div>
        {hideStatus ? null : <StatusChip variant={statusVariant}>{t(`${p}.status`)}</StatusChip>}
      </div>

      {mode === 'configure' ? (
        <div className="mt-5 min-h-[4.5rem]">
          <p className={homeHubCardDescClass}>{t(`${p}.bodyCaption`)}</p>
          <p className={cn('mt-1.5', homeHubCardDescClass)}>{t(`${p}.bodyDetail`)}</p>
        </div>
      ) : (
        <div className="mt-5 grid min-h-[4.5rem] grid-cols-3 gap-3">
          <StatBlock
            label={t(`${p}.stat1Label`)}
            value={t(`${p}.stat1Value`)}
            unit={t(`${p}.stat1Unit`, { defaultValue: '' })}
            highlight={!disabled}
          />
          <StatBlock
            label={t(`${p}.stat2Label`)}
            value={t(`${p}.stat2Value`)}
            unit={t(`${p}.stat2Unit`, { defaultValue: '' })}
          />
          <StatBlock
            label={t(`${p}.stat3Label`)}
            value={t(`${p}.stat3Value`)}
            unit={t(`${p}.stat3Unit`, { defaultValue: '' })}
          />
        </div>
      )}

      <div className="mt-5 flex min-h-[40px] items-center gap-3 border-t border-[#E5E6EB] pt-4 dark:border-border">
        <AvatarStack urls={avatarUrls} />
        <p className={cn('min-w-0 flex-1 truncate text-center text-[13px]', homeHubTextSecondary)} title={t(`${p}.footerTeam`)}>
          {t(`${p}.footerTeam`)}
        </p>
        <span
          className={cn(
            'flex max-w-[48%] shrink-0 items-center justify-end gap-0.5 truncate text-[13px] font-medium',
            footerHintClass,
          )}
        >
          {t(`${p}.footerHint`)}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
        </span>
      </div>
    </>
  );

  const shellClass = cardShell;

  if (disabled) {
    return (
      <div className={shellClass} role="group" aria-disabled aria-label={t(`${p}.title`)}>
        <div className="pointer-events-none select-none">{inner}</div>
        <div
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center justify-center rounded-[18px]',
            'bg-white/45 dark:bg-background/50',
          )}
        >
          <span className="rounded-lg border border-[#E5E6EB] bg-white px-4 py-2.5 text-sm font-medium text-[#86909C] shadow-sm dark:border-border dark:bg-card dark:text-muted-foreground">
            {t('summary.comingSoon')}
          </span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={shellClass}
    >
      {inner}
    </button>
  );
}

export function HomeWorkflowGuideCards({
  className,
  onSend,
}: {
  className?: string;
  onSend?: (text: string) => void;
}) {
  const { t } = useTranslation('home');
  return (
    <section className={className} aria-labelledby="home-workflow-guide-heading">
      <h2 id="home-workflow-guide-heading" className="sr-only">
        {t('site.workflowGuide.heading')}
      </h2>
      <div className={homeHubCardGridClass}>
        <GuideCard
          avatarSeed="site-monitor-setup"
          base="monitor"
          statusVariant="pending"
          mode="configure"
          hideStatus
          onSend={onSend}
        />
        <GuideCard avatarSeed="site-hq-reconciliation" base="recon" statusVariant="ok" mode="disabled" hideStatus />
        <GuideCard avatarSeed="site-cost-analysis" base="cost" statusVariant="ok" mode="disabled" hideStatus />
      </div>
    </section>
  );
}
