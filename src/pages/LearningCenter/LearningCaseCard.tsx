import { useState } from 'react';
import { ImageOff, Sparkles, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { LearningCaseTemplate } from '@/types/learning-center';

interface LearningCaseCardProps {
  item: LearningCaseTemplate;
  onViewDetail: (item: LearningCaseTemplate, trigger: HTMLElement) => void;
  onUse: (item: LearningCaseTemplate, trigger: HTMLElement) => void;
}

export function LearningCaseCard({ item, onViewDetail, onUse }: LearningCaseCardProps) {
  const { t } = useTranslation('learningCenter');
  const [coverFailed, setCoverFailed] = useState(false);

  const title = item.title || item.name;
  const summary = item.subTitle || item.description;
  const showCover = Boolean(item.coverImageUrl) && !coverFailed;

  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden bg-muted">
        {showCover ? (
          <img
            src={item.coverImageUrl}
            alt={t('caseCoverAlt', { title })}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <div
            role="img"
            aria-label={t('caseCoverAlt', { title })}
            className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 via-muted to-primary/5 text-muted-foreground"
          >
            {coverFailed
              ? <ImageOff className="h-6 w-6" aria-hidden />
              : <Sparkles className="h-6 w-6 text-primary/70" aria-hidden />}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={title}>{title}</p>
          {summary && <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{summary}</p>}
        </div>

        <div className="mt-auto flex min-w-0 flex-wrap items-center justify-between gap-2">
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" aria-hidden />
            {t('caseUseCount', { value: item.useCount })}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={(event) => onViewDetail(item, event.currentTarget)}
            >
              {t('caseViewDetail')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={(event) => onUse(item, event.currentTarget)}
            >
              {item.actionText || t('caseUseAction')}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
