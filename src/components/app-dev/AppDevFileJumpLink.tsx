import type { MouseEvent, ReactNode } from 'react';
import { revealAppDevSourceFile } from '@/lib/app-dev-reveal-source';
import { cn } from '@/lib/utils';

interface AppDevFileJumpLinkProps {
  path: string;
  children: ReactNode;
  className?: string;
}

export function AppDevFileJumpLink({ path, children, className }: AppDevFileJumpLinkProps) {
  const trimmed = path.trim();
  if (!trimmed) {
    return <span className={cn('min-w-0 truncate', className)}>{children}</span>;
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    revealAppDevSourceFile(trimmed);
  };

  return (
    <button
      type="button"
      className={cn(
        'min-w-0 truncate text-left text-foreground underline decoration-transparent underline-offset-2',
        'hover:text-[var(--sto-brand-primary)] hover:decoration-current',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--sto-border-strong)]',
        className,
      )}
      title="点击跳转到文件"
      aria-label={`跳转到 ${typeof children === 'string' ? children : trimmed}`}
      onClick={handleClick}
    >
      {children}
    </button>
  );
}
