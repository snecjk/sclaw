/**
 * SidebarTimerIcon — 侧栏「自动化」入口图标（timer.svg）。
 *
 * 必须内联 SVG：CSS mask-image 在 Electron file:// 下会拉取失败。
 * 颜色跟 Lucide 侧栏图标一致：由父级 `[&_svg]:text-*` / `[&_svg]:stroke-*` 注入，
 * 不继承一级正文色（否则会比其它 icon 更深）。
 */
import timerIconSvg from '@/assets/icons/timer.svg?raw';
import { cn } from '@/lib/utils';

const TIMER_ICON_SVG = timerIconSvg
  .replaceAll('fill="#393E47"', 'fill="currentColor"')
  .replaceAll('stroke="#393E47"', 'stroke="currentColor"');

export function SidebarTimerIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-4 w-4 shrink-0',
        // 跟随父级注入到 svg 上的 color（icon token），而非 NavLink 正文色
        '[&_svg]:block [&_svg]:h-full [&_svg]:w-full [&_svg]:fill-current [&_svg]:stroke-current',
        // 父级对所有 svg 设了 stroke；填充 path 不能再描边，否则会比 Lucide 更重
        '[&_svg_path]:stroke-none [&_svg_ellipse]:fill-none',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: TIMER_ICON_SVG }}
    />
  );
}
