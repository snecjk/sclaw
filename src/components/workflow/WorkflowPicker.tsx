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
import { Search, SlidersHorizontal, Workflow, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useMyPublishedWorkflows } from './use-my-published-workflows';
import { OverlayScrollbar } from '@/components/ui/overlay-scrollbar';
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
import { PickerEmptyState } from '@/components/picker-empty-state';
import { useSkillPlazaStore } from '@/stores/skill-plaza';

interface WorkflowPickerProps {
  open: boolean;
  mode?: 'toolbar' | 'slash';
  query?: string;
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
  ({ open, mode = 'toolbar', query = '', onClose, onSelect, onSelectSkill, anchorRef, composerRef, className }, ref) => {
    const { t } = useTranslation('chat');
    const navigate = useNavigate();
    const [position, setPosition] = useState<PickerPosition | null>(null);
    const [toolbarQuery, setToolbarQuery] = useState('');
    const localRef = useRef<HTMLDivElement | null>(null);
    const listViewportRef = useRef<HTMLDivElement>(null);
    const listContentRef = useRef<HTMLDivElement>(null);
    const skillSectionRef = useRef<HTMLDivElement>(null);
    const workflowHeaderRef = useRef<HTMLButtonElement>(null);

    const { workflows, loading, refetch } = useMyPublishedWorkflows();
    const mySkills = useSkillPlazaStore((s) => s.mySkills);
    const skillsLoading = useSkillPlazaStore((s) => s.loading);
    const fetchLocalSkills = useSkillPlazaStore((s) => s.fetchLocalSkills);
    const isSlashMode = mode === 'slash';

    useEffect(() => {
      if (!open) {
        const timer = setTimeout(() => setToolbarQuery(''), 0);
        return () => clearTimeout(timer);
      }
      return undefined;
    }, [open]);

    // 仅在 picker 打开瞬间兜底重拉一次，避免「空列表 + loading 落定」形成自激重拉死循环。
    const prevOpenRef = useRef(false);
    useEffect(() => {
      if (open && !prevOpenRef.current) {
        void refetch();
        if (isSlashMode && mySkills.length === 0 && !skillsLoading) {
          void fetchLocalSkills({ reset: true });
        }
      }
      prevOpenRef.current = open;
    }, [fetchLocalSkills, isSlashMode, mySkills.length, open, refetch, skillsLoading]);

    useLayoutEffect(() => {
      if (!open) {
        const resetPositionId = window.requestAnimationFrame(() => setPosition(null));
        return () => window.cancelAnimationFrame(resetPositionId);
      }
      if (!anchorRef && !(isSlashMode && composerRef)) return;

      const updatePosition = () => {
        const rect = (isSlashMode ? composerRef?.current?.getBoundingClientRect() : null)
          ?? anchorRef?.current?.getBoundingClientRect();
        if (!rect) return;
        const width = isSlashMode
          ? Math.min(Math.max(280, Math.round(rect.width)), Math.max(280, window.innerWidth - 24))
          : Math.min(280, Math.max(280, window.innerWidth - 24));
        setPosition({
          left: Math.round(Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)),
          bottom: Math.round(window.innerHeight - rect.top + 8),
          width,
        });
      };

      updatePosition();
      const retryId = window.requestAnimationFrame(updatePosition);
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
      return () => {
        cancelAnimationFrame(retryId);
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }, [isSlashMode, open, anchorRef, composerRef]);

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

    const activeQuery = (isSlashMode ? query : toolbarQuery).trim();

    const filteredWorkflows = useMemo(
      () => {
        if (!activeQuery) return workflows;
        const normalizedQuery = activeQuery.toLocaleLowerCase();
        return workflows.filter((workflow) => {
          const haystack = `${workflow.name} ${workflow.description ?? ''}`.toLocaleLowerCase();
          return haystack.includes(normalizedQuery);
        });
      },
      [activeQuery, workflows],
    );

    const filteredSkills = useMemo(
      () => filterSkillsByQuery(skillItems, activeQuery),
      [activeQuery, skillItems],
    );

    if (!open) return null;
    if ((anchorRef || composerRef) && !position) return null;

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
      'sticky z-10 flex h-6 w-full items-center bg-white px-2 py-1 text-left text-[12px] font-medium leading-4 text-[#86909C] dark:bg-[var(--sto-surface-primary)] dark:text-[var(--sto-text-tertiary)]';
    const itemClass =
      'sto-navigation-item flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-left transition-colors';
    const itemIconClass = 'h-3 w-3 shrink-0 text-[#1D2129] dark:text-foreground';
    const itemTitleClass = 'max-w-[45%] shrink-0 truncate text-[12px] font-normal leading-4 text-[#111827] dark:text-foreground';
    const itemDescriptionClass = 'min-w-0 flex-1 truncate text-[10px] font-normal leading-3.5 text-[#86909C] dark:text-[var(--sto-text-tertiary)]';
    const workflowEmptyText = (
      <div className="px-2 py-2 text-[12px] font-normal leading-4 text-[#86909C] dark:text-muted-foreground">
        {t('composer.workflowNoTemplates')}
      </div>
    );
    const renderEmptyText = (message: string) => (
      <div className="px-2 py-2 text-[12px] font-normal leading-4 text-[#86909C] dark:text-muted-foreground">
        {message}
      </div>
    );

    // 点击【工作流 icon】展示的浮框面板
    const toolbarPanel = (
      <div
        ref={setRefs}
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
            : undefined
        }
      >
        <div className="mb-1 flex h-[34px] w-[264px] shrink-0 items-center gap-2 rounded-lg border border-[#E5E6EB] bg-white px-3 dark:border-white/10 dark:bg-white/[0.03]">
          <Search className="h-4 w-4 shrink-0 text-[#A7ADB8] dark:text-muted-foreground" strokeWidth={2} aria-hidden />
          <input
            value={toolbarQuery}
            onChange={(event) => setToolbarQuery(event.target.value)}
            placeholder={t('composer.workflowPlaceholder')}
            aria-label={t('composer.workflowPlaceholder')}
            className="h-full min-w-0 flex-1 bg-transparent text-[12px] font-normal text-[#111827] outline-none placeholder:text-[#C9CDD4] dark:text-foreground dark:placeholder:text-muted-foreground"
            autoFocus
          />
        </div>

        <div className="relative mt-1 min-h-0 flex-1 overflow-hidden">
          <div ref={listViewportRef} className={cn('sto-overlay-scroll-viewport', skillPickerListClass)}>
            <div ref={listContentRef}>
              {loading ? (
                <div className="px-3 py-2 text-[12px] text-muted-foreground">{t('composer.workflowLoading')}</div>
              ) : null}
              {!loading && workflows.length === 0 ? (
                <PickerEmptyState message={t('composer.workflowNoTemplates')} />
              ) : null}
              {!loading && workflows.length > 0 && filteredWorkflows.length === 0 ? (
                <PickerEmptyState message={t('composer.workflowNoResults')} />
              ) : null}
              {!loading && filteredWorkflows.map((workflow) => (
                <button
                  key={workflow.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onSelect(workflow.id, workflow.name);
                    onClose();
                  }}
                  className={skillPickerRowClass}
                >
                  <Workflow className="mt-0.5 h-3 w-3 shrink-0 text-[#1D2129] dark:text-muted-foreground" strokeWidth={2} />
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-normal leading-4 text-[#111827] dark:text-foreground">
                      <HighlightedText text={workflow.name} query={activeQuery} />
                    </div>
                    {workflow.description ? (
                      <div className="mt-0.5 truncate text-[10px] font-normal leading-3.5 text-[#86909C] dark:text-muted-foreground">
                        <HighlightedText text={workflow.description} query={activeQuery} />
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
            navigate('/my-tasks?tab=workflow');
          }}
          className="mt-1 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-[#E5E6EB] bg-white text-[12px] font-medium text-[#1D2129] transition-colors hover:bg-[#F0F2F5] dark:border-white/10 dark:bg-white/[0.03] dark:text-foreground dark:hover:bg-white/[0.06]"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          <span>{t('composer.workflowManage')}</span>
        </button>
      </div>
    );

    // 输入“/”符号打开【工作流 + 技能】组合浮框面板
    const panel = (
      <div
        ref={setRefs}
        className={cn(
          'z-[100001] flex max-h-[272px] flex-col overflow-hidden rounded-[18px] border border-[#E5E6EB] bg-white p-2 shadow-[0_4px_12px_0_rgba(0,0,0,0.1)] dark:border-[var(--sto-border-default)] dark:bg-[var(--sto-surface-primary)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.35)]',
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
                workflowEmptyText
              )}
              {!loading && workflows.length > 0 && filteredWorkflows.length === 0 ? (
                workflowEmptyText
              ) : null}
              {!loading && filteredWorkflows.map((workflow) => (
                <button
                  key={workflow.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onSelect(workflow.id, workflow.name);
                    onClose();
                  }}
                  className={itemClass}
                >
                  <Workflow className={itemIconClass} strokeWidth={2} />
                  <div className={itemTitleClass}>
                    <HighlightedText text={workflow.name} query={activeQuery} />
                  </div>
                  {workflow.description ? (
                    <div className={itemDescriptionClass}>
                      <HighlightedText text={workflow.description} query={activeQuery} />
                    </div>
                  ) : null}
                </button>
              ))}

              <div className="my-1 h-px bg-[#F2F3F5] dark:bg-[var(--sto-border-default)]" />

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
                  renderEmptyText(t('composer.skillNoInstalled'))
                ) : null}
                {!skillsLoading && skillItems.length > 0 && filteredSkills.length === 0 ? (
                  renderEmptyText(t('composer.skillNoResults'))
                ) : null}
                {filteredSkills.map((skill) => (
                  <button
                    key={skill.slug}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onSelectSkill?.({ slug: skill.slug, title: skill.title });
                      onClose();
                    }}
                    className={itemClass}
                  >
                    <Wrench className={itemIconClass} strokeWidth={2} aria-hidden />
                    <div className={itemTitleClass}>
                      <HighlightedText text={skill.title} query={activeQuery} />
                    </div>
                    {skill.description ? (
                      <div className={itemDescriptionClass}>
                        <HighlightedText text={skill.description} query={activeQuery} />
                      </div>
                    ) : null}
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
      return createPortal(isSlashMode ? panel : toolbarPanel, document.body);
    }
    return isSlashMode ? panel : toolbarPanel;
  },
);

WorkflowPicker.displayName = 'WorkflowPicker';
