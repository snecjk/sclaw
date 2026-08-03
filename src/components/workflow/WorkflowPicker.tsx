import {
  useState,
  useEffect,
  useMemo,
  forwardRef,
  useRef,
  useLayoutEffect,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Workflow, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useMyPublishedWorkflows } from './use-my-published-workflows';
import { OverlayScrollbar } from '@/components/ui/overlay-scrollbar';
import {
  filterSkillsByQuery,
  splitHighlightSegments,
  type SkillPickerItem,
} from '@/lib/skill-picker-filter';
import { skillPickerHighlightClass } from '@/lib/surfaces';
import { PickerEmptyState } from '@/components/picker-empty-state';
import { useSkillPlazaStore } from '@/stores/skill-plaza';

interface WorkflowPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string, name: string) => void;
  onSelectSkill?: (skill: { slug: string; title: string }) => void;
  /** 锚定按钮：有则 portal + fixed 定位，避免被输入壳 overflow 裁切 */
  anchorRef?: RefObject<HTMLElement | null>;
  /** 对齐输入框外壳宽度；传入后优先以它定位。 */
  composerRef?: RefObject<HTMLElement | null>;
  className?: string;
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

export const WorkflowPicker = forwardRef<HTMLDivElement, WorkflowPickerProps>(
  ({ open, onClose, onSelect, onSelectSkill, anchorRef, composerRef, className }, ref) => {
    const { t } = useTranslation('chat');
    const [position, setPosition] = useState<PickerPosition | null>(null);
    const localRef = useRef<HTMLDivElement | null>(null);
    const listViewportRef = useRef<HTMLDivElement>(null);
    const listContentRef = useRef<HTMLDivElement>(null);
    const skillSectionRef = useRef<HTMLDivElement>(null);
    const workflowHeaderRef = useRef<HTMLButtonElement>(null);

    const { workflows, loading, refetch } = useMyPublishedWorkflows();
    const mySkills = useSkillPlazaStore((s) => s.mySkills);
    const skillsLoading = useSkillPlazaStore((s) => s.loading);
    const fetchLocalSkills = useSkillPlazaStore((s) => s.fetchLocalSkills);

    // 仅在 picker 打开瞬间兜底重拉一次，避免「空列表 + loading 落定」形成自激重拉死循环。
    const prevOpenRef = useRef(false);
    useEffect(() => {
      if (open && !prevOpenRef.current) {
        void refetch();
        if (mySkills.length === 0 && !skillsLoading) {
          void fetchLocalSkills({ reset: true });
        }
      }
      prevOpenRef.current = open;
    }, [fetchLocalSkills, mySkills.length, open, refetch, skillsLoading]);

    useLayoutEffect(() => {
      if (!open || (!anchorRef?.current && !composerRef?.current)) {
        setPosition(null);
        return;
      }

      const updatePosition = () => {
        const rect = composerRef?.current?.getBoundingClientRect()
          ?? anchorRef?.current?.getBoundingClientRect();
        if (!rect) return;
        const width = Math.min(
          Math.max(280, Math.round(rect.width)),
          Math.max(280, window.innerWidth - 24),
        );
        setPosition({
          left: Math.round(Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)),
          bottom: Math.round(window.innerHeight - rect.top + 8),
          width,
        });
      };

      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }, [open, anchorRef, composerRef]);

    const skillItems: SkillPickerItem[] = useMemo(
      () => mySkills
        .filter((skill) => skill.enabled !== false)
        .map((skill) => ({
          slug: skill.slug,
          title: skill.title,
          description: skill.description ?? '',
        })),
      [mySkills],
    );

    const filteredSkills = useMemo(
      () => filterSkillsByQuery(skillItems, ''),
      [skillItems],
    );

    if (!open) return null;

    const setRefs = (node: HTMLDivElement | null) => {
      localRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    };

    const scrollToTop = () => {
      listViewportRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const scrollToSkillSection = () => {
      const viewport = listViewportRef.current;
      const skillSection = skillSectionRef.current;
      if (!viewport || !skillSection) return;

      const workflowHeaderHeight = workflowHeaderRef.current?.offsetHeight ?? 24;
      viewport.scrollTo({
        top: Math.max(0, skillSection.offsetTop - workflowHeaderHeight),
        behavior: 'smooth',
      });
    };

    const sectionTitleBaseClass =
      'sticky z-10 flex h-6 w-full items-center bg-white px-2 py-1 text-left text-[12px] font-medium leading-4 text-[#86909C] dark:bg-[#18181B] dark:text-muted-foreground';
    const itemClass =
      'flex w-full items-start gap-1.5 rounded-lg p-2 text-left transition-colors hover:bg-[#F0F2F5] dark:hover:bg-white/[0.06]';
    const itemIconClass = 'mt-0.5 h-3 w-3 shrink-0 text-[#1D2129] dark:text-foreground';
    const itemTitleClass = 'truncate text-[12px] font-normal leading-4 text-[#111827] dark:text-foreground';
    const itemDescriptionClass = 'mt-1 truncate text-[10px] font-normal leading-3.5 text-[#86909C]';

    const panel = (
      <div
        ref={setRefs}
        className={cn(
          'z-50 flex max-h-[272px] flex-col overflow-hidden rounded-[18px] border border-[#E5E6EB] bg-white p-2 shadow-[0_4px_12px_0_rgba(0,0,0,0.1)] dark:border-white/10 dark:bg-[#18181B]',
          position
            ? 'fixed'
            : 'absolute left-0 bottom-full mb-2 w-[280px]',
          className,
        )}
        style={
          position
            ? {
                left: position.left,
                bottom: position.bottom,
                width: position.width,
              }
            : undefined
        }
      >
        <div className="relative max-h-[256px] overflow-hidden">
          <div ref={listViewportRef} className="sto-overlay-scroll-viewport max-h-[256px] overflow-y-auto overscroll-contain">
            <div ref={listContentRef}>
              <button
                ref={workflowHeaderRef}
                type="button"
                className={cn(sectionTitleBaseClass, 'top-0')}
                onClick={scrollToTop}
              >
                {t('composer.workflowPickerSectionTitle')}
              </button>
              {loading && (
                <div className="px-3 py-2 text-[12px] text-muted-foreground">{t('composer.workflowLoading')}</div>
              )}
              {!loading && workflows.length === 0 && (
                <PickerEmptyState message={t('composer.workflowNoTemplates')} />
              )}
              {!loading && workflows.map((workflow) => (
                <button
                  key={workflow.id}
                  type="button"
                  onClick={() => {
                    onSelect(workflow.id, workflow.name);
                    onClose();
                  }}
                  className={itemClass}
                >
                  <Workflow className={itemIconClass} strokeWidth={2} />
                  <div className="min-w-0">
                    <div className={itemTitleClass}>
                      <HighlightedText text={workflow.name} query="" />
                    </div>
                    {workflow.description && (
                      <div className={itemDescriptionClass}>
                        <HighlightedText text={workflow.description} query="" />
                      </div>
                    )}
                  </div>
                </button>
              ))}

              <div className="my-1 h-px bg-[#F2F3F5]" />

              <div ref={skillSectionRef}>
                <button
                  type="button"
                  className={cn(sectionTitleBaseClass, 'top-6')}
                  onClick={scrollToSkillSection}
                >
                  {t('composer.skillPickerSectionTitle')}
                </button>
                {skillsLoading && mySkills.length === 0 ? (
                  <div className="px-3 py-2 text-[12px] text-muted-foreground">
                    {t('composer.skillLoading')}
                  </div>
                ) : null}
                {!skillsLoading && skillItems.length === 0 ? (
                  <PickerEmptyState message={t('composer.skillNoInstalled')} />
                ) : null}
                {!skillsLoading && skillItems.length > 0 && filteredSkills.length === 0 ? (
                  <PickerEmptyState message={t('composer.skillNoResults')} />
                ) : null}
                {filteredSkills.map((skill) => (
                  <button
                    key={skill.slug}
                    type="button"
                    onClick={() => {
                      onSelectSkill?.({ slug: skill.slug, title: skill.title });
                      onClose();
                    }}
                    className={itemClass}
                  >
                    <Wrench className={itemIconClass} strokeWidth={2} aria-hidden />
                    <div className="min-w-0">
                      <div className={itemTitleClass}>
                        <HighlightedText text={skill.title} query="" />
                      </div>
                      {skill.description ? (
                        <div className={itemDescriptionClass}>
                          <HighlightedText text={skill.description} query="" />
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <OverlayScrollbar viewportRef={listViewportRef} contentRef={listContentRef} />
        </div>
      </div>
    );

    // Portal 到 body，彻底避开输入壳 / 首页列的 overflow 裁切。
    if (anchorRef || composerRef) {
      return createPortal(panel, document.body);
    }
    return panel;
  },
);

WorkflowPicker.displayName = 'WorkflowPicker';
