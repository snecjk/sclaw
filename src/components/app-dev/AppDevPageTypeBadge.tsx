import type { CodeApplicationPageType } from '../../../shared/code-application-catalog';

export function AppDevPageTypeBadge({ pageType }: { pageType?: CodeApplicationPageType }) {
  if (!pageType) return null;
  const label = pageType === 'assets' ? 'Assets' : 'Site';
  return (
    <span
      aria-label={`应用类型：${label}`}
      className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
    >
      {label}
    </span>
  );
}
