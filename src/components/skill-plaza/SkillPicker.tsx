import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  filterSkillsByQuery,
  splitHighlightSegments,
  type SkillPickerItem,
} from '@/lib/skill-picker-filter';
import {
  skillPickerHighlightClass,
  skillPickerListClass,
  skillPickerRowClass,
  skillPickerShellClass,
} from '@/lib/surfaces';
import { useSkillPlazaStore } from '@/stores/skill-plaza';

export interface SkillPickerProps {
  open: boolean;
  mode: 'inline' | 'toolbar';
  /** inline: query from editor after `*`; toolbar: ignored (internal search state) */
  query: string;
  onSelect: (skill: { slug: string; title: string }) => void;
  onClose: () => void;
  className?: string;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const segments = useMemo(() => splitHighlightSegments(text, query), [text, query]);
  return (
    <>
      {segments.map((segment, index) => (
        segment.highlight ? (
          <span key={`${index}-${segment.text}`} className={skillPickerHighlightClass}>
            {segment.text}
          </span>
        ) : (
          <span key={`${index}-${segment.text}`}>{segment.text}</span>
        )
      ))}
    </>
  );
}

export const SkillPicker = forwardRef<HTMLDivElement, SkillPickerProps>(
  ({ open, mode, query: inlineQuery, onSelect, onClose, className }, ref) => {
    const { t } = useTranslation('chat');
    const [toolbarQuery, setToolbarQuery] = useState('');
    const mySkills = useSkillPlazaStore((s) => s.mySkills);
    const loading = useSkillPlazaStore((s) => s.loading);
    const fetchLocalSkills = useSkillPlazaStore((s) => s.fetchLocalSkills);

    const prevOpenRef = useRef(false);
    useEffect(() => {
      if (!open) {
        const timer = setTimeout(() => setToolbarQuery(''), 0);
        return () => clearTimeout(timer);
      }
      return undefined;
    }, [open]);

    useEffect(() => {
      if (open && !prevOpenRef.current) {
        if (mySkills.length === 0 && !loading) {
          void fetchLocalSkills({ reset: true });
        }
      }
      prevOpenRef.current = open;
    }, [fetchLocalSkills, loading, mySkills.length, open]);

    const activeQuery = mode === 'toolbar' ? toolbarQuery : inlineQuery;

    const items: SkillPickerItem[] = useMemo(
      () => mySkills
        .filter((skill) => skill.enabled !== false)
        .map((skill) => ({
          slug: skill.slug,
          title: skill.title,
          description: skill.description ?? '',
        })),
      [mySkills],
    );

    const filtered = useMemo(
      () => filterSkillsByQuery(items, activeQuery),
      [activeQuery, items],
    );

    if (!open) return null;

    return (
      <div
        ref={ref}
        role="listbox"
        aria-label={t('composer.skillPickerAriaLabel')}
        className={cn(skillPickerShellClass, className)}
      >
        <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground/80">
          {t('composer.skillPickerTitle')}
        </div>

        {mode === 'toolbar' ? (
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              value={toolbarQuery}
              onChange={(e) => setToolbarQuery(e.target.value)}
              placeholder={t('composer.skillSearchPlaceholder')}
              aria-label={t('composer.skillSearchPlaceholder')}
              className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50"
              autoFocus
            />
          </div>
        ) : null}

        <div className={cn(skillPickerListClass, 'mt-1')}>
          {loading && mySkills.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-muted-foreground">
              {t('composer.skillLoading')}
            </div>
          ) : null}
          {!loading && items.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-muted-foreground">
              {t('composer.skillNoInstalled')}
            </div>
          ) : null}
          {!loading && items.length > 0 && filtered.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-muted-foreground">
              {t('composer.skillNoResults')}
            </div>
          ) : null}
          {filtered.map((skill) => (
            <button
              key={skill.slug}
              type="button"
              role="option"
              onClick={() => {
                onSelect({ slug: skill.slug, title: skill.title });
                onClose();
              }}
              className={skillPickerRowClass}
            >
              <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-foreground">
                  <HighlightedText text={skill.title} query={activeQuery} />
                </div>
                {skill.description ? (
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    <HighlightedText text={skill.description} query={activeQuery} />
                  </div>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  },
);

SkillPicker.displayName = 'SkillPicker';
