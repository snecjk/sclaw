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
import { Search, SlidersHorizontal, Workflow } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useMyPublishedWorkflows } from './use-my-published-workflows';
import { OverlayScrollbar } from '@/components/ui/overlay-scrollbar';
import { splitHighlightSegments } from '@/lib/skill-picker-filter';
import { skillPickerHighlightClass } from '@/lib/surfaces';
import { PickerEmptyState } from '@/components/picker-empty-state';

interface WorkflowPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string, name: string) => void;
  /** 锚定按钮：有则 portal + fixed 定位，避免被输入壳 overflow 裁切 */
  anchorRef?: RefObject<HTMLElement | null>;
  className?: string;
}

type PickerPosition = {
  left: number;
  bottom: number;
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
  ({ open, onClose, onSelect, anchorRef, className }, ref) => {
    const { t } = useTranslation('chat');
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [position, setPosition] = useState<PickerPosition | null>(null);
    const localRef = useRef<HTMLDivElement | null>(null);
    const listViewportRef = useRef<HTMLDivElement>(null);
    const listContentRef = useRef<HTMLDivElement>(null);

    const { workflows, loading, refetch } = useMyPublishedWorkflows();

    useEffect(() => {
      if (!open) {
        const timer = setTimeout(() => setQuery(''), 0);
        return () => clearTimeout(timer);
      }
      return undefined;
    }, [open]);

    // 仅在 picker 打开瞬间兜底重拉一次，避免「空列表 + loading 落定」形成自激重拉死循环。
    const prevOpenRef = useRef(false);
    useEffect(() => {
      if (open && !prevOpenRef.current) {
        void refetch();
      }
      prevOpenRef.current = open;
    }, [open, refetch]);

    useLayoutEffect(() => {
      if (!open || !anchorRef?.current) {
        setPosition(null);
        return;
      }

      const updatePosition = () => {
        const rect = anchorRef.current?.getBoundingClientRect();
        if (!rect) return;
        setPosition({
          left: Math.round(rect.left),
          bottom: Math.round(window.innerHeight - rect.top + 9),
        });
      };

      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }, [open, anchorRef]);

    const filtered = useMemo(() => {
      const trimmed = query.trim().toLowerCase();
      if (!trimmed) return workflows;
      return workflows.filter(
        (w) =>
          w.name.toLowerCase().includes(trimmed) ||
          w.description.toLowerCase().includes(trimmed),
      );
    }, [workflows, query]);

    if (!open) return null;

    const setRefs = (node: HTMLDivElement | null) => {
      localRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    };

    const panel = (
      <div
        ref={setRefs}
        className={cn(
          'z-50 flex h-[390px] w-[280px] flex-col overflow-hidden rounded-lg border border-[#E5E6EB] bg-white p-2 shadow-[0_4px_12px_rgba(0,0,0,0.1)] dark:border-white/10 dark:bg-[#18181B]',
          position
            ? 'fixed'
            : 'absolute left-0 bottom-full mb-2',
          className,
        )}
        style={
          position
            ? {
                left: position.left,
                bottom: position.bottom,
              }
            : undefined
        }
      >
        {/* Search */}
        <div className="mb-1 flex h-[34px] w-[264px] items-center gap-2 rounded-lg border border-[#E5E6EB] bg-white px-3 dark:border-white/10 dark:bg-white/[0.03]">
          <Search className="h-4 w-4 shrink-0 text-[#A7ADB8]" strokeWidth={2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('composer.workflowPlaceholder')}
            className="h-full flex-1 bg-transparent text-[12px] font-normal text-[#111827] outline-none placeholder:text-[#C9CDD4]"
          />
        </div>

        {/* List */}
        <div className="relative mt-1 min-h-0 flex-1 overflow-hidden">
          <div ref={listViewportRef} className="sto-overlay-scroll-viewport h-full min-h-0 overflow-y-auto">
            <div ref={listContentRef}>
              {loading && (
                <div className="px-3 py-2 text-[12px] text-muted-foreground">{t('composer.workflowLoading')}</div>
              )}
              {!loading && filtered.length === 0 && (
                <PickerEmptyState message={t('composer.workflowNoTemplates')} />
              )}
              {!loading && filtered.map((workflow) => (
                <button
                  key={workflow.id}
                  type="button"
                  onClick={() => {
                    onSelect(workflow.id, workflow.name);
                    onClose();
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[#F0F2F5] dark:hover:bg-white/[0.06]"
                >
                  <Workflow className="mt-0.5 h-3 w-3 shrink-0 text-[#1D2129]" strokeWidth={2} />
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-normal leading-4 text-[#111827] dark:text-foreground">
                      <HighlightedText text={workflow.name} query={query} />
                    </div>
                    {workflow.description && (
                      <div className="mt-0.5 truncate text-[10px] font-normal leading-3.5 text-[#86909C]">
                        <HighlightedText text={workflow.description} query={query} />
                      </div>
                    )}
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
            navigate('/workflow');
          }}
          className="mt-1 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-[#E5E6EB] bg-white text-[12px] font-medium text-[#1D2129] transition-colors hover:bg-[#F0F2F5] dark:border-white/10 dark:bg-white/[0.03] dark:text-foreground dark:hover:bg-white/[0.06]"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          <span>{t('composer.workflowManage')}</span>
        </button>
      </div>
    );

    // Portal 到 body，彻底避开输入壳 / 首页列的 overflow 裁切。
    if (anchorRef) {
      return createPortal(panel, document.body);
    }
    return panel;
  },
);

WorkflowPicker.displayName = 'WorkflowPicker';
