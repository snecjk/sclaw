import { ChevronRight } from 'lucide-react';
import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useHomeOfficialWorkflows } from './use-home-official-workflows';
import { HomeWorkflowCard } from './HomeWorkflowCard';
import { HomeWorkflowGuideCards } from './HomeWorkflowGuideCards';
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
    <span className="shrink-0 rounded-md bg-[#FFF5E6] px-2 py-0.5 text-xs font-medium text-[#D95700] dark:bg-amber-950/45 dark:text-amber-200">
      {children}
    </span>
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

const cardShell = cn(
  'relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border bg-white p-5 shadow-[0_2px_12px_rgba(29,33,41,0.06)]',
  'dark:border-border dark:bg-card',
);

function HomeTemplateGuideCard({
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
    onSend?.(t('homeWorkflowCard.createPrompt', { label }));
  }, [onSend, label, t]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        cardShell,
        'w-full text-left transition-shadow duration-200 hover:shadow-[0_8px_24px_rgba(29,33,41,0.1)] dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold leading-snug text-[#1D2129] dark:text-foreground">{label}</h3>
            {category ? <CategoryPill>{category}</CategoryPill> : null}
          </div>
        </div>
      </div>

      <div className="mt-5 min-h-[4.5rem]">
        <p className="text-[13px] leading-snug text-[#86909C] dark:text-muted-foreground">{description}</p>
        <p className="mt-1.5 text-[15px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
          {t('homeWorkflowCard.bodyDetail')}
        </p>
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

export function HomeOfficialWorkflowCards({
  className,
  onSend,
}: {
  className?: string;
  onSend?: (text: string) => void;
}) {
  const { t } = useTranslation('home');
  const { templates, loading, error } = useHomeOfficialWorkflows();

  if (loading || error || templates.length === 0) {
    return <HomeWorkflowGuideCards className={className} onSend={onSend} />;
  }

  return (
    <section className={className} aria-labelledby="home-official-workflow-heading">
      <h2 id="home-official-workflow-heading" className="sr-only">
        {t('site.workflowGuide.heading')}
      </h2>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-5">
        {templates.map((item) =>
          item.hasMyWorkflow ? (
            <HomeWorkflowCard
              key={item.id}
              id={item.id}
              label={item.label}
              category={item.category}
              description={item.description}
              onSend={onSend}
            />
          ) : (
            <HomeTemplateGuideCard
              key={item.id}
              id={item.id}
              label={item.label}
              category={item.category}
              description={item.description}
              onSend={onSend}
            />
          ),
        )}
      </div>
    </section>
  );
}
