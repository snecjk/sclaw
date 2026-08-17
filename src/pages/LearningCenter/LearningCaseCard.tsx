import { useState } from 'react';
import { Flame, ImageOff, ImageIcon, ZoomIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { LearningCaseTemplate } from '@/types/learning-center';

interface LearningCaseCardProps {
  item: LearningCaseTemplate;
  onViewDetail: (item: LearningCaseTemplate, trigger: HTMLElement) => void;
  onUse: (item: LearningCaseTemplate, trigger: HTMLElement) => void;
}

export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  if (value < 1000) return String(Math.round(value));
  const kilo = value / 1000;
  const compact = kilo >= 10 ? kilo.toFixed(0) : kilo.toFixed(1).replace(/\.0$/, '');
  return `${compact}k`;
}

export function LearningCaseCard({ item, onViewDetail, onUse }: LearningCaseCardProps) {
  const { t } = useTranslation('learningCenter');
  const [coverFailed, setCoverFailed] = useState(false);

  const title = item.title || item.name;
  const summary = item.subTitle || item.description;
  const showCover = Boolean(item.coverImageUrl) && !coverFailed;
  const useCountLabel = t('caseUseCount', { value: item.useCount });

  return (
    <Card className="learning-center-case-card">
      <div className="learning-center-case-card__body">
        <div className="min-w-0">
          <p className="truncate text-[0.9375rem] font-semibold leading-6" title={title}>{title}</p>
          {summary && <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{summary}</p>}
        </div>
        <div className="learning-center-case-cover relative w-full shrink-0">
          <button
            type="button"
            className="learning-center-case-cover__preview"
            aria-label={t('casePreviewCover', { title })}
            onClick={(event) => onViewDetail(item, event.currentTarget)}
          >
            <ZoomIn className="h-3.5 w-3.5" aria-hidden />
          </button>
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
              className="flex h-full w-full items-center justify-center text-muted-foreground"
            >
              {coverFailed
                ? <ImageOff className="h-7 w-7" aria-hidden />
                : <ImageIcon className="h-7 w-7" aria-hidden />}
            </div>
          )}
        </div>
      </div>

      <div className="learning-center-case-card__footer">
        <span className="learning-center-case-card__count" aria-label={useCountLabel}>
          <Flame className="h-3.5 w-3.5" aria-hidden />
          {formatCompactCount(item.useCount)}
        </span>
        <div className="learning-center-case-card__actions">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="learning-center-case-card__action"
            onClick={(event) => onUse(item, event.currentTarget)}
          >
            {item.actionText || t('caseUseAction')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="learning-center-case-card__action"
            onClick={(event) => onViewDetail(item, event.currentTarget)}
          >
            {t('caseViewDetail')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
