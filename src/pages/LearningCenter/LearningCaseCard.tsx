import { Flame, ZoomIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import type { LearningCaseTemplate } from '@/types/learning-center';
import { LearningCoverImage } from './LearningCoverImage';

interface LearningCaseCardProps {
  item: LearningCaseTemplate;
  onViewDetail: (item: LearningCaseTemplate, trigger: HTMLElement) => void;
  onPreviewCover: (item: LearningCaseTemplate, trigger: HTMLElement) => void;
  onUse: (item: LearningCaseTemplate, trigger: HTMLElement) => void;
}

export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  if (value < 1000) return String(Math.round(value));
  const kilo = value / 1000;
  const compact = kilo >= 10 ? kilo.toFixed(0) : kilo.toFixed(1).replace(/\.0$/, '');
  return `${compact}k`;
}

export function LearningCaseCard({ item, onViewDetail, onPreviewCover, onUse }: LearningCaseCardProps) {
  const { t } = useTranslation('learningCenter');
  const title = item.title || item.name;
  const summary = item.subTitle || item.description;
  const useCountLabel = t('caseUseCount', { value: item.useCount });

  return (
    <Card className="learning-center-case-card">
      <div className="learning-center-case-card__body">
        <div className="learning-center-case-card__text">
          <p className="learning-center-case-card__title" title={title}>{title}</p>
          <p className="learning-center-case-card__summary">{summary || '\u00A0'}</p>
        </div>
        <div className="learning-center-case-cover">
          <button
            type="button"
            className="learning-center-case-cover__preview"
            aria-label={t('casePreviewCover', { title })}
            onClick={(event) => {
              event.stopPropagation();
              onPreviewCover(item, event.currentTarget);
            }}
          >
            <ZoomIn className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          </button>
          <LearningCoverImage
            url={item.coverImageUrl}
            alt={t('caseCoverAlt', { title })}
            className="learning-center-case-cover__image"
          />
        </div>
      </div>

      <div className="learning-center-case-card__footer">
        <span className="learning-center-case-card__count" aria-label={useCountLabel}>
          <Flame className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          {formatCompactCount(item.useCount)}
        </span>
        <div className="learning-center-case-card__actions">
          <button
            type="button"
            className="learning-center-case-card__action"
            onClick={(event) => onUse(item, event.currentTarget)}
          >
            {item.actionText || t('caseUseAction')}
          </button>
          <button
            type="button"
            className="learning-center-case-card__action"
            onClick={(event) => onViewDetail(item, event.currentTarget)}
          >
            {t('caseViewDetail')}
          </button>
        </div>
      </div>
    </Card>
  );
}
