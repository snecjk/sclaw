import { ChevronRight } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  homeHubCardDescClass,
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

export function HomeWorkflowCard({
  id,
  label,
  category,
  description,
  onSend,
}: {
  id: string;
  label: string;
  category: string;
  description: string;
  onSend?: (text: string) => void;
}) {
  const { t } = useTranslation('home');
  const avatarUrls = useMemo(() => pickThreeAvatars(id), [id]);

  const handleClick = useCallback(() => {
    onSend?.(t('homeWorkflowCard.startPrompt', { label }));
  }, [onSend, label, t]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cardShell}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={homeHubCardTitleClass}>{label}</h3>
            {category ? <CategoryPill>{category}</CategoryPill> : null}
          </div>
        </div>
      </div>

      <div className="mt-5 min-h-[4.5rem]">
        <p className={homeHubCardDescClass}>{description}</p>
      </div>

      <div className="mt-5 grid min-h-[4.5rem] grid-cols-3 gap-3">
        <StatBlock
          label={t('homeWorkflowCard.stat1Label')}
          value={t('homeWorkflowCard.stat1Value')}
          highlight
        />
        <StatBlock
          label={t('homeWorkflowCard.stat2Label')}
          value={t('homeWorkflowCard.stat2Value')}
        />
        <StatBlock
          label={t('homeWorkflowCard.stat3Label')}
          value={t('homeWorkflowCard.stat3Value')}
        />
      </div>

      <div className="mt-5 flex min-h-[40px] items-center gap-3 border-t border-[#E5E6EB] pt-4 dark:border-border">
        <AvatarStack urls={avatarUrls} />
        <p className="min-w-0 flex-1 truncate text-center text-[13px] text-[#86909C] dark:text-muted-foreground">
          {t('homeWorkflowCard.footerTeam')}
        </p>
        <span className="flex max-w-[48%] shrink-0 items-center justify-end gap-0.5 truncate text-[13px] font-medium text-[#4760FE] dark:text-blue-400">
          {t('homeWorkflowCard.footerHint')}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
        </span>
      </div>
    </button>
  );
}
