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
import { Search, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useMyPublishedWorkflows } from './use-my-published-workflows';

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
  width: number;
};

export const WorkflowPicker = forwardRef<HTMLDivElement, WorkflowPickerProps>(
  ({ open, onClose, onSelect, anchorRef, className }, ref) => {
    const { t } = useTranslation('chat');
    const [query, setQuery] = useState('');
    const [position, setPosition] = useState<PickerPosition | null>(null);
    const localRef = useRef<HTMLDivElement | null>(null);

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
        const width = Math.min(320, Math.max(280, window.innerWidth - 24));
        const left = Math.min(
          Math.max(12, rect.left),
          window.innerWidth - width - 12,
        );
        setPosition({
          left,
          bottom: window.innerHeight - rect.top + 8,
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
          'z-50 overflow-hidden rounded-2xl border border-glass-border glass p-2',
          position
            ? 'fixed'
            : 'absolute left-0 bottom-full mb-2 w-80',
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
        {/* Search */}
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('composer.workflowPlaceholder')}
            className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none"
          />
        </div>

        {/* List */}
        <div className="max-h-64 overflow-y-auto mt-1">
          {loading && (
            <div className="px-3 py-2 text-[12px] text-muted-foreground">{t('composer.workflowLoading')}</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-muted-foreground">{t('composer.workflowNoTemplates')}</div>
          )}
          {!loading && filtered.map((workflow) => (
            <button
              key={workflow.id}
              type="button"
              onClick={() => {
                onSelect(workflow.id, workflow.name);
                onClose();
              }}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors',
                'hover:bg-black/5 dark:hover:bg-white/5',
              )}
            >
              <span className="text-lg shrink-0 mt-0.5"><Workflow className="h-4 w-4 text-muted-foreground" /></span>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-foreground truncate">{workflow.name}</div>
                {workflow.description && (
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">{workflow.description}</div>
                )}
              </div>
            </button>
          ))}
        </div>
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
