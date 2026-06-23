import { ChevronRight } from 'lucide-react';
import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
import { formatLocalYmd } from '@/lib/sto-task-entry-label';
import {
  STO_TASK_PENDING_COMPOSE_KEY,
  STO_TASK_SUBITEM_NAV_SCROLL_END,
} from '@/lib/sto-task-compose-storage';
import { useStoTaskSubitemsStore } from '@/stores/sto-task-subitems';
import avatar01 from '@/assets/avatars/avatar-01.png.png';
import avatar02 from '@/assets/avatars/avatar-02.png.png';
import avatar03 from '@/assets/avatars/avatar-03.png.png';
import avatar04 from '@/assets/avatars/avatar-04.png.png';
import avatar05 from '@/assets/avatars/avatar-05.png.png';
import avatar06 from '@/assets/avatars/avatar-06.png.png';

const AVATAR_POOL = [avatar01, avatar02, avatar03, avatar04, avatar05, avatar06] as const;

/** Deterministic shuffle so avatars stay stable per card across re-renders. */
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

function CategoryPill({ children }: { children: React.ReactNode }) {
  return (
    <span className={cn('shrink-0', homeHubCardTagClass)}>
      {children}
    </span>
  );
}

function StatBlock({ label, value, unit }: { label: string; value: string; unit?: string }) {
  const u = unit?.trim();
  if (!label.trim() && !value.trim()) return null;
  return (
    <div className="min-w-0 text-left">
      <div className={cn('text-[13px] leading-snug', homeHubTextSecondary)}>{label}</div>
      <div className={cn('mt-1 truncate text-lg font-bold tabular-nums leading-tight sm:text-xl', homeHubTextPrimary)}>
        {value}
        {u ? <span className="text-[15px] font-semibold"> {u}</span> : null}
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

type SummaryCardBase = 'recon' | 'customer' | 'cost';

type SummaryCardProps =
  | {
      disabled: true;
      avatarSeed: string;
      base: SummaryCardBase;
      statusVariant: 'ok' | 'neutral';
      columns: 2 | 3;
    }
  | {
      disabled?: false;
      avatarSeed: string;
      stoTaskTarget: StoTaskId;
      base: SummaryCardBase;
      statusVariant: 'ok' | 'neutral';
      columns: 2 | 3;
    };

function SummaryCard(props: SummaryCardProps) {
  const { avatarSeed, base, statusVariant, columns } = props;
  const disabled = props.disabled === true;
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const ensureSubitem = useStoTaskSubitemsStore((s) => s.ensureSubitem);
  const stoTaskTarget = !disabled ? (props as Extract<SummaryCardProps, { stoTaskTarget: StoTaskId }>).stoTaskTarget : null;

  const openSubitem = useCallback(() => {
    if (!stoTaskTarget) return;
    const entryIdToday = formatLocalYmd(new Date());
    const hadToday = useStoTaskSubitemsStore.getState().listEntries(stoTaskTarget).includes(entryIdToday);
    ensureSubitem(stoTaskTarget, entryIdToday);
    const path = taskDetailPath(stoTaskTarget, entryIdToday);
    if (!hadToday) {
      try {
        sessionStorage.setItem(
          STO_TASK_PENDING_COMPOSE_KEY,
          JSON.stringify({ taskId: stoTaskTarget, entryId: entryIdToday, cardBase: base }),
        );
      } catch {
        /* ignore quota */
      }
      navigate(path);
    } else {
      navigate(path, { state: { [STO_TASK_SUBITEM_NAV_SCROLL_END]: true } });
    }
  }, [base, ensureSubitem, navigate, stoTaskTarget]);

  const p = `summary.${base}` as const;
  const bodyCaption = t(`${p}.bodyCaption`, { defaultValue: '' }).trim();
  const showStackBody = Boolean(bodyCaption);
  const avatarUrls = useMemo(() => pickThreeAvatars(avatarSeed), [avatarSeed]);

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={homeHubCardTitleClass}>{t(`${p}.title`)}</h3>
            <CategoryPill>{t(`${p}.pill`)}</CategoryPill>
          </div>
        </div>
        <StatusChip variant={statusVariant}>{t(`${p}.status`)}</StatusChip>
      </div>

      {showStackBody ? (
        <div className="mt-5 min-h-[4.5rem]">
          <p className={homeHubCardDescClass}>{bodyCaption}</p>
          <p className={cn('mt-1.5 text-[15px] font-semibold leading-relaxed', homeHubTextPrimary)}>
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

      <div className="mt-5 flex min-h-[40px] items-center gap-3 border-t border-[#E5E6EB] pt-4 dark:border-border">
        <AvatarStack urls={avatarUrls} />
        <p className={cn('min-w-0 flex-1 truncate text-center text-[13px]', homeHubTextSecondary)} title={t(`${p}.footerTeam`)}>
          {t(`${p}.footerTeam`)}
        </p>
        <span className={cn('flex max-w-[48%] shrink-0 items-center justify-end gap-0.5 truncate text-[13px] font-medium', homeHubTextSecondary)}>
          {t(`${p}.footerHint`)}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#86909C] opacity-80 dark:text-muted-foreground" aria-hidden />
        </span>
      </div>
    </>
  );

  if (disabled) {
    return (
      <div
        className={cn(cardShell)}
        role="group"
        aria-disabled
        aria-label={t(`${p}.title`)}
      >
        <div className="pointer-events-none select-none">{inner}</div>
        <div
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center justify-center rounded-[18px]',
            // 轻蒙层即可看清底层（设计稿）；不用 backdrop-blur，避免整卡发糊
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
      onClick={openSubitem}
      className={cardShell}
    >
      {inner}
    </button>
  );
}

export function HomeSummaryCards({ className }: { className?: string }) {
  const { t } = useTranslation('home');
  return (
    <section className={className} aria-labelledby="home-summary-heading">
      <h2 id="home-summary-heading" className="sr-only">
        {t('summary.heading')}
      </h2>
      <div className={homeHubCardGridClass}>
        <SummaryCard
          avatarSeed="hq-reconciliation:recon"
          stoTaskTarget="hq-reconciliation"
          base="recon"
          statusVariant="ok"
          columns={3}
        />
        <SummaryCard disabled avatarSeed="summary-customer" base="customer" statusVariant="neutral" columns={2} />
        <SummaryCard disabled avatarSeed="summary-cost" base="cost" statusVariant="ok" columns={2} />
      </div>
    </section>
  );
}
