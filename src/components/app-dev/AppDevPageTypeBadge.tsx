import { Globe2, Package } from 'lucide-react';
import type { CodeApplicationPageType } from '../../../shared/code-application-catalog';

export function AppDevPageTypeBadge({ pageType }: { pageType?: CodeApplicationPageType }) {
  if (!pageType) return null;
  const label = pageType === 'assets' ? '托管应用' : '独立站点';
  const Icon = pageType === 'assets' ? Package : Globe2;
  return (
    <span
      aria-label={`应用类型：${label}`}
      title={`应用类型：${label}`}
      className={pageType === 'assets'
        ? 'inline-flex shrink-0 text-amber-600 dark:text-amber-400'
        : 'inline-flex shrink-0 text-sky-600 dark:text-sky-400'}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </span>
  );
}
