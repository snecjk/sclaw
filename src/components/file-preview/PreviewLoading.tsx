/**
 * PreviewLoading — 预览统一加载骨架（对齐 Kimi 的分类型加载体验）
 *
 * variant 决定骨架形态：spreadsheet 表格 / document 文档 / slides 幻灯片 / text 文本行。
 */
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PreviewLoadingVariant = 'spreadsheet' | 'document' | 'slides' | 'text';

interface PreviewLoadingProps {
  label: string;
  variant?: PreviewLoadingVariant;
  className?: string;
}

const shimmer = 'animate-pulse rounded bg-muted/70 dark:bg-muted/40';

function SpreadsheetSkeleton() {
  return (
    <div className="grid w-full max-w-md grid-cols-4 gap-px overflow-hidden rounded-lg border border-border/60">
      {Array.from({ length: 24 }, (_, i) => (
        <div
          key={i}
          className={cn('h-7', shimmer, i < 4 && 'bg-muted')}
          style={{ animationDelay: `${(i % 8) * 90}ms` }}
        />
      ))}
    </div>
  );
}

function DocumentSkeleton() {
  return (
    <div className="flex w-full max-w-md flex-col gap-2.5">
      <div className={cn('h-5 w-2/5', shimmer)} />
      <div className={cn('h-3 w-full', shimmer)} />
      <div className={cn('h-3 w-full', shimmer)} />
      <div className={cn('h-3 w-4/5', shimmer)} />
      <div className={cn('mt-2 h-4 w-1/3', shimmer)} />
      <div className={cn('h-3 w-full', shimmer)} />
      <div className={cn('h-3 w-3/5', shimmer)} />
    </div>
  );
}

function SlidesSkeleton() {
  return (
    <div className={cn('aspect-video w-full max-w-lg', shimmer)} />
  );
}

function TextSkeleton() {
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      {['w-full', 'w-11/12', 'w-full', 'w-4/5', 'w-full', 'w-3/5'].map((w, i) => (
        <div key={i} className={cn('h-3', w, shimmer)} style={{ animationDelay: `${i * 80}ms` }} />
      ))}
    </div>
  );
}

export function PreviewLoading({ label, variant = 'text', className }: PreviewLoadingProps) {
  return (
    <div
      className={cn('flex h-full flex-col items-center justify-center gap-5 px-6', className)}
      role="status"
      aria-live="polite"
    >
      {variant === 'spreadsheet' ? <SpreadsheetSkeleton /> : null}
      {variant === 'document' ? <DocumentSkeleton /> : null}
      {variant === 'slides' ? <SlidesSkeleton /> : null}
      {variant === 'text' ? <TextSkeleton /> : null}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
        {label}
      </div>
    </div>
  );
}
