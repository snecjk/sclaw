import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
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
import { useSettingsStore } from '@/stores/settings';
import { OverlayScrollbar } from '@/components/ui/overlay-scrollbar';
import { PickerEmptyState } from '@/components/picker-empty-state';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

export interface SkillPickerProps {
  open: boolean;
  mode: 'inline' | 'toolbar';
  /** inline: query from editor after `*`; toolbar: ignored (internal search state) */
  query: string;
  onSelect: (skill: { slug: string; title: string }) => void;
  onClose: () => void;
  onAddMore?: () => void;
  /** 锚定按钮：有则 portal + fixed，避免被 Task modal / composer overflow 裁切 */
  anchorRef?: RefObject<HTMLElement | null>;
  className?: string;
  /** 无 portal 时的绝对定位样式（兼容旧调用方） */
  style?: CSSProperties;
}

type PickerPosition = {
  left: number;
  bottom: number;
  width: number;
};

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
  ({ open, mode, query: inlineQuery, onSelect, onClose, onAddMore, anchorRef, className, style }, ref) => {
    const { t } = useTranslation('chat');
    const [toolbarQuery, setToolbarQuery] = useState('');
    const [position, setPosition] = useState<PickerPosition | null>(null);
    const [savingSkillDiscovery, setSavingSkillDiscovery] = useState(false);
    const skillDiscoveryEnabled = useSettingsStore((s) => s.skillDiscoveryEnabled);
    const setSkillDiscoveryEnabled = useSettingsStore((s) => s.setSkillDiscoveryEnabled);
    const mySkills = useSkillPlazaStore((s) => s.mySkills);
    const loading = useSkillPlazaStore((s) => s.loading);
    const fetchLocalSkills = useSkillPlazaStore((s) => s.fetchLocalSkills);

    const prevOpenRef = useRef(false);
    const localRef = useRef<HTMLDivElement | null>(null);
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

    useLayoutEffect(() => {
      if (!open) return;
      if (!anchorRef) return;

      const updatePosition = () => {
        const rect = anchorRef.current?.getBoundingClientRect();
        if (!rect) return;
        const width = Math.min(280, window.innerWidth - 24);
        setPosition({
          left: Math.round(Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)),
          bottom: Math.round(window.innerHeight - rect.top + 8),
          width,
        });
      };

      updatePosition();
      const retryId = window.requestAnimationFrame(updatePosition);

      let rafId: number | null = null;
      const scheduleUpdate = () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = null;
          updatePosition();
        });
      };

      window.addEventListener('resize', scheduleUpdate);
      window.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });
      return () => {
        if (retryId != null) cancelAnimationFrame(retryId);
        if (rafId !== null) cancelAnimationFrame(rafId);
        window.removeEventListener('resize', scheduleUpdate);
        window.removeEventListener('scroll', scheduleUpdate, { capture: true });
      };
    }, [open, anchorRef]);

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
    if (anchorRef && !position) return null;

    const setRefs = (node: HTMLDivElement | null) => {
      localRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    };

    const handleSkillDiscoveryChange = async (enabled: boolean) => {
      if (savingSkillDiscovery) return;
      setSavingSkillDiscovery(true);
      try {
        await setSkillDiscoveryEnabled(enabled);
      } catch {
        toast.error(t('composer.skillDiscoverySaveFailed'));
      } finally {
        setSavingSkillDiscovery(false);
      }
    };

    const panel = (
      <div
        ref={setRefs}
        role="listbox"
        aria-label={t('composer.skillPickerAriaLabel')}
        className={cn(
          skillPickerShellClass,
          position ? 'fixed' : 'absolute left-0 bottom-full mb-2',
          className,
        )}
        style={
          position
            ? {
                left: position.left,
                bottom: position.bottom,
                width: position.width,
              }
            : style
        }
      >
        {mode === 'toolbar' ? (
          <div className="mb-1 flex h-[34px] w-[264px] shrink-0 items-center gap-2 rounded-lg border border-[#E5E6EB] bg-white px-3 dark:border-white/10 dark:bg-white/[0.03]">
            <Search className="h-4 w-4 shrink-0 text-[#A7ADB8] dark:text-muted-foreground" strokeWidth={2} aria-hidden />
            <input
              value={toolbarQuery}
              onChange={(e) => setToolbarQuery(e.target.value)}
              placeholder={t('composer.skillSearchPlaceholder')}
              aria-label={t('composer.skillSearchPlaceholder')}
              className="h-full min-w-0 flex-1 bg-transparent text-[12px] font-normal text-[#111827] outline-none placeholder:text-[#C9CDD4] dark:text-foreground dark:placeholder:text-muted-foreground"
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
                <PickerEmptyState message={t('composer.skillNoInstalled')} />
              ) : null}
              {!loading && items.length > 0 && filtered.length === 0 ? (
                <PickerEmptyState message={t('composer.skillNoResults')} />
              ) : null}
              {filtered.map((skill) => (
                <button
                  key={skill.slug}
                  type="button"
                  role="option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onSelect({ slug: skill.slug, title: skill.title });
                    onClose();
                  }}
                  className={skillPickerRowClass}
                >
                  <Wrench className="mt-0.5 h-3 w-3 shrink-0 text-[#1D2129] dark:text-muted-foreground" strokeWidth={2} aria-hidden />
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-normal leading-4 text-[#111827] dark:text-foreground">
                      <HighlightedText text={skill.title} query={activeQuery} />
                    </div>
                    {skill.description ? (
                      <div className="mt-0.5 truncate text-[10px] font-normal leading-3.5 text-[#86909C] dark:text-muted-foreground">
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

        <div className="mt-1 flex min-h-11 items-center justify-between gap-3 border-t border-[#E5E6EB] px-2 pt-1 dark:border-white/10">
          <div className="min-w-0">
            <div className="text-[12px] font-medium leading-4 text-[#1D2129] dark:text-foreground">
              {t('composer.skillDiscovery')}
            </div>
            <div className="truncate text-[10px] leading-3.5 text-[#86909C] dark:text-muted-foreground">
              {t(skillDiscoveryEnabled
                ? 'composer.skillDiscoveryEnabledHint'
                : 'composer.skillDiscoveryDisabledHint')}
            </div>
          </div>
          <Switch
            size="compact"
            checked={skillDiscoveryEnabled}
            disabled={savingSkillDiscovery}
            aria-label={t('composer.skillDiscovery')}
            onCheckedChange={(checked) => void handleSkillDiscoveryChange(checked)}
          />
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

    // Portal 到 body，避开 Task modal / 输入壳 overflow 裁切（与 WorkflowPicker / QuickInputPicker 一致）
    return anchorRef ? createPortal(panel, document.body) : panel;
  },
);

SkillPicker.displayName = 'SkillPicker';
