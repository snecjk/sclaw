import { forwardRef, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Plus, Search, Wrench } from 'lucide-react';
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
import { OverlayScrollbar } from '@/components/ui/overlay-scrollbar';

export interface SkillPickerProps {
  open: boolean;
  mode: 'inline' | 'toolbar';
  /** inline: query from editor after `*`; toolbar: ignored (internal search state) */
  query: string;
  onSelect: (skill: { slug: string; title: string }) => void;
  onClose: () => void;
  onAddMore?: () => void;
  className?: string;
  style?: CSSProperties;
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
  ({ open, mode, query: inlineQuery, onSelect, onClose, onAddMore, className, style }, ref) => {
    const { t } = useTranslation('chat');
    const [toolbarQuery, setToolbarQuery] = useState('');
    const mySkills = useSkillPlazaStore((s) => s.mySkills);
    const loading = useSkillPlazaStore((s) => s.loading);
    const fetchLocalSkills = useSkillPlazaStore((s) => s.fetchLocalSkills);

    const prevOpenRef = useRef(false);
    const listViewportRef = useRef<HTMLDivElement>(null);
    const listContentRef = useRef<HTMLDivElement>(null);
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
        style={style}
      >
        {mode === 'toolbar' ? (
          <div className="mb-1 flex h-[34px] w-[264px] items-center gap-2 rounded-lg border border-[#E5E6EB] bg-white px-3 dark:border-white/10 dark:bg-white/[0.03]">
            <Search className="h-4 w-4 shrink-0 text-[#A7ADB8]" strokeWidth={2} aria-hidden />
            <input
              value={toolbarQuery}
              onChange={(e) => setToolbarQuery(e.target.value)}
              placeholder={t('composer.skillSearchPlaceholder')}
              aria-label={t('composer.skillSearchPlaceholder')}
              className="h-full flex-1 bg-transparent text-[12px] font-normal text-[#111827] outline-none placeholder:text-[#C9CDD4]"
              autoFocus
            />
          </div>
        ) : null}

        <div className="relative mt-1 min-h-0 flex-1 overflow-hidden">
          <div ref={listViewportRef} className={cn('sto-overlay-scroll-viewport', skillPickerListClass)}>
            <div ref={listContentRef}>
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
                  <Wrench className="mt-0.5 h-3 w-3 shrink-0 text-[#1D2129]" strokeWidth={2} aria-hidden />
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-normal leading-4 text-[#111827] dark:text-foreground">
                      <HighlightedText text={skill.title} query={activeQuery} />
                    </div>
                    {skill.description ? (
                      <div className="mt-0.5 truncate text-[10px] font-normal leading-3.5 text-[#86909C]">
                        <HighlightedText text={skill.description} query={activeQuery} />
                      </div>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <OverlayScrollbar viewportRef={listViewportRef} contentRef={listContentRef} />
        </div>

        <button
          type="button"
          onClick={() => {
            onClose();
            onAddMore?.();
          }}
          className="mt-1 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-[#E5E6EB] bg-white text-[12px] font-medium text-[#1D2129] transition-colors hover:bg-[#F0F2F5] dark:border-white/10 dark:bg-white/[0.03] dark:text-foreground dark:hover:bg-white/[0.06]"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          <span>{t('composer.skillAddMore')}</span>
        </button>
      </div>
    );
  },
);

SkillPicker.displayName = 'SkillPicker';
