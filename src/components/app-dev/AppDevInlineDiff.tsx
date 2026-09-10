/**
 * P5 W1-2：对话内轻量逐行 diff（不用 Monaco）。
 * 对齐算法与 diffAppDevLineCounts 同口径：公共前后缀裁剪后中间为增删块。
 */
import { memo } from 'react';
import { buildAppDevLineDiff, type AppDevEditSnippet } from '@/lib/app-dev-tool-rollup';
import { cn } from '@/lib/utils';

interface AppDevInlineDiffProps {
  edits: readonly AppDevEditSnippet[];
  className?: string;
}

export const AppDevInlineDiff = memo(function AppDevInlineDiff({
  edits,
  className,
}: AppDevInlineDiffProps) {
  if (edits.length === 0) return null;

  return (
    <div
      className={cn(
        'mt-1 max-h-80 overflow-auto rounded-md border border-[var(--sto-border-default)] bg-[var(--sto-bg-inset)] font-mono text-[11px] leading-4',
        className,
      )}
      data-testid="app-dev-inline-diff"
      style={{ contentVisibility: 'auto' }}
    >
      {edits.map((edit, editIndex) => {
        const lines = buildAppDevLineDiff(edit.oldText, edit.newText);
        return (
          <div
            key={`edit-${editIndex}`}
            className={cn(editIndex > 0 && 'border-t border-[var(--sto-border-default)]')}
          >
            {lines.length === 0 ? (
              <div className="px-2 py-1 text-[var(--sto-text-tertiary)]">(无差异)</div>
            ) : (
              lines.map((line, lineIndex) => (
                <div
                  key={`${editIndex}-${lineIndex}`}
                  className={cn(
                    'whitespace-pre-wrap break-all px-2 py-0.5',
                    line.type === 'add' && 'bg-[var(--sto-success-primary)]/10 text-[var(--sto-text-primary)]',
                    line.type === 'del' && 'bg-[var(--sto-danger-primary)]/10 text-[var(--sto-text-primary)]',
                    line.type === 'same' && 'text-[var(--sto-text-tertiary)]',
                  )}
                >
                  <span className="mr-2 select-none text-[var(--sto-text-tertiary)]">
                    {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
                  </span>
                  {line.text || ' '}
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
});
