import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invokeIpc } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { ReleaseChangelogMarkdown } from './ReleaseChangelogMarkdown';
import { updateDividerLineClass } from './updateDivider';

export type ChangelogListItem = {
  semver: string;
  title?: string | null;
  changelog?: string | null;
  published_at?: string | null;
};

type ChangelogListResult =
  | { ok: true; data: { items: ChangelogListItem[]; total: number } }
  | { ok: false; reason?: { httpStatus?: number; serverMessage?: string } };

function formatPublishedDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

interface UpdateChangelogPanelProps {
  className?: string;
}

export function UpdateChangelogPanel({ className }: UpdateChangelogPanelProps) {
  const { t, i18n } = useTranslation('settings');
  const [items, setItems] = useState<ChangelogListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<'loginRequired' | 'loadFailed' | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErrorKey(null);
      try {
        const result = await invokeIpc<ChangelogListResult>('update:changelog-list', {
          limit: 10,
          offset: 0,
        });
        if (cancelled) return;
        if (!result.ok) {
          setErrorKey(result.reason?.httpStatus === 401 ? 'loginRequired' : 'loadFailed');
          setItems([]);
          return;
        }
        setItems(result.data.items ?? []);
      } catch {
        if (!cancelled) {
          setErrorKey('loadFailed');
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className={cn('space-y-4', className)}>
      <h2 className="text-[16px] font-bold text-[#1D2129] dark:text-foreground">
        {t('updates.changelogTitle')}
      </h2>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t('updates.changelogLoading')}</span>
        </div>
      ) : errorKey ? (
        <p className="py-4 text-[13px] text-[#86909C] dark:text-muted-foreground">
          {t(`updates.changelog.${errorKey}`)}
        </p>
      ) : items.length === 0 ? (
        <p className="py-4 text-[13px] text-[#86909C] dark:text-muted-foreground">
          {t('updates.changelog.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((item, index) => {
            const dateLabel = formatPublishedDate(item.published_at, i18n.language);
            const isLast = index === items.length - 1;

            return (
              <div key={`${item.semver}-${item.published_at ?? index}`} className="contents">
                <article className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-[15px] font-bold text-[#1D2129] dark:text-foreground">
                      v{item.semver}
                    </span>
                    {dateLabel ? (
                      <span className="text-[13px] font-normal text-[#86909C]">{dateLabel}</span>
                    ) : null}
                  </div>
                  {item.changelog?.trim() ? (
                    <ReleaseChangelogMarkdown content={item.changelog} />
                  ) : (
                    <p className="text-[13px] font-normal text-[#86909C]">{t('updates.modal.noReleaseNotes')}</p>
                  )}
                </article>
                {!isLast ? (
                  <div className={updateDividerLineClass} aria-hidden="true" />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
