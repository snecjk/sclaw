import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const LOCKED_COLOR_ATTRIBUTES = /\b(fill|stroke)="(?!none")[^"]+"/g;
const themedSvgCache = new Map<string, string>();

function resolveThemedSvg(source: string): string {
  const cached = themedSvgCache.get(source);
  if (cached) return cached;

  const themed = source.replace(LOCKED_COLOR_ATTRIBUTES, '$1="currentColor"');
  themedSvgCache.set(source, themed);
  return themed;
}

interface ThemedMonochromeIconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  source: string;
}

/** 内联本地单色 SVG，使填充色跟随所在控件的语义图标色。 */
export function ThemedMonochromeIcon({
  source,
  className,
  ...props
}: ThemedMonochromeIconProps) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 [&_svg]:block [&_svg]:h-full [&_svg]:w-full',
        '[&_svg_path]:stroke-none',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: resolveThemedSvg(source) }}
    />
  );
}
