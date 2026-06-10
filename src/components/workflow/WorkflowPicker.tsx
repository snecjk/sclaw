import { useState, useEffect, forwardRef } from 'react';
import { Search, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useWorkflowsStore } from '@/stores/workflows';

interface WorkflowPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  className?: string;
}

export const WorkflowPicker = forwardRef<HTMLDivElement, WorkflowPickerProps>(
  ({ open, onClose, onSelect, className }, ref) => {
    const { t } = useTranslation('chat');
    const [query, setQuery] = useState('');

    const { templates, loading, loadTemplates } = useWorkflowsStore();

    useEffect(() => {
      if (!open) {
        const timer = setTimeout(() => setQuery(''), 0);
        return () => clearTimeout(timer);
      }
      return undefined;
    }, [open]);

    useEffect(() => {
      if (!open) return undefined;

      const trimmed = query.trim();
      const timer = window.setTimeout(() => {
        if (trimmed) {
          void loadTemplates(trimmed, { force: true, catalog: false });
        } else {
          void loadTemplates('', { force: true, catalog: true });
        }
      }, trimmed ? 300 : 0);

      return () => window.clearTimeout(timer);
    }, [open, query, loadTemplates]);

    if (!open) return null;

    return (
      <div
        ref={ref}
        className={cn(
          'absolute left-0 bottom-full z-50 mb-2 w-80 overflow-hidden rounded-2xl border border-glass-border glass p-2',
          className,
        )}
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
          {!loading && templates.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-muted-foreground">{t('composer.workflowNoTemplates')}</div>
          )}
          {!loading && templates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => {
                onSelect(template.id);
                onClose();
              }}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors',
                'hover:bg-black/5 dark:hover:bg-white/5',
              )}
            >
              <span className="text-lg shrink-0 mt-0.5"><Workflow className="h-4 w-4 text-muted-foreground" /></span>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-foreground truncate">{template.label}</div>
                {template.description && (
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">{template.description}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  },
);

WorkflowPicker.displayName = 'WorkflowPicker';
