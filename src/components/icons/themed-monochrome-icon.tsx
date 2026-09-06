import { useId, type HTMLAttributes } from 'react';
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

/**
 * 内联 SVG 的 id 在整个 document 内共享，而不是以每个 <svg> 为作用域。
 * 同一带 clipPath/mask/gradient 的图标渲染多次时，固定 id 会相互引用，
 * 造成先渲染的图标被错误裁切。为每个实例重写 id 与内部引用。
 */
function namespaceSvgIds(source: string, prefix: string): string {
  const ids = new Map<string, string>();
  const withIds = source.replace(/\bid="([^"]+)"/g, (_match, id: string) => {
    const namespacedId = `${prefix}${id}`;
    ids.set(id, namespacedId);
    return `id="${namespacedId}"`;
  });

  if (ids.size === 0) return withIds;

  return withIds
    .replace(/url\(#([^)]+)\)/g, (match, id: string) => (
      ids.has(id) ? `url(#${ids.get(id)})` : match
    ))
    .replace(/\b(href|xlink:href)="#([^"]+)"/g, (match, attribute: string, id: string) => (
      ids.has(id) ? `${attribute}="#${ids.get(id)}"` : match
    ));
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
  const iconIdPrefix = `sto-icon-${useId().replaceAll(':', '')}-`;

  return (
    <span
      {...props}
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 [&_svg]:block [&_svg]:h-full [&_svg]:w-full',
        '[&_svg_path]:stroke-none',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: namespaceSvgIds(resolveThemedSvg(source), iconIdPrefix) }}
    />
  );
}
