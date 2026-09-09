import { memo, useState } from 'react';
import { ChevronDown, ChevronRight, MousePointer2 } from 'lucide-react';
import {
  formatAppDevElementCaption,
  formatAppDevElementLabel,
  type AppDevPickedElement,
} from '@/lib/app-dev-element-intent';
import { cn } from '@/lib/utils';

interface AppDevElementIntentCardProps {
  elements: AppDevPickedElement[];
  className?: string;
}

export const AppDevElementIntentCard = memo(function AppDevElementIntentCard({
  elements,
  className,
}: AppDevElementIntentCardProps) {
  const [expanded, setExpanded] = useState(false);
  if (elements.length === 0) return null;

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-xl border border-[var(--sto-overlay-border)] bg-[var(--sto-overlay-background)]',
        className,
      )}
      data-testid="app-dev-element-intent-card"
    >
      <button
        type="button"
        className="flex h-8 w-full items-center gap-1.5 px-2.5 text-left text-xs text-[var(--sto-text-secondary)] hover:bg-[var(--sto-control-hover-bg)]"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
        )}
        <MousePointer2 className="h-3.5 w-3.5 shrink-0 text-[var(--sto-brand-primary)]" aria-hidden />
        <span>包含 {elements.length} 个页面元素</span>
      </button>
      {expanded ? (
        <ul className="border-t border-[var(--sto-overlay-border)] px-2.5 py-1.5">
          {elements.map((el) => (
            <li
              key={`${el.selector}:${el.tag}`}
              className="flex min-w-0 items-baseline gap-2 py-1 text-xs"
            >
              <span className="min-w-0 truncate text-[var(--sto-text-primary)]" title={el.selector}>
                {formatAppDevElementCaption(el)}
              </span>
              <span className="ml-auto min-w-0 max-w-[55%] truncate font-mono text-[11px] text-[var(--sto-text-tertiary)]" title={el.selector}>
                {formatAppDevElementLabel(el)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
