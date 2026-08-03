/**
 * Soft tiled user watermark for screen capture / preview protection.
 * Global: fixed overlay. Local: absolute (e.g. fullscreen preview).
 */
import { cn } from '@/lib/utils';
import { formatUserWatermarkText } from '@/lib/user-watermark-text';
import { useAuthStore } from '@/stores/auth';

const TILE_COUNT = 600;

type UserWatermarkProps = {
  /** fixed = app-wide; absolute = scoped to a relative fullscreen host */
  mode?: 'fixed' | 'absolute';
  className?: string;
};

export function UserWatermark({ mode = 'fixed', className }: UserWatermarkProps) {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const text = isAuthenticated ? formatUserWatermarkText(user) : null;

  if (!text) return null;

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none inset-0 overflow-hidden select-none',
        mode === 'fixed' ? 'fixed z-[99990]' : 'absolute z-[5]',
        className,
      )}
    >
      <div
        className="absolute left-1/2 top-1/2 flex w-[200vmax] flex-wrap content-center justify-center gap-x-10 gap-y-12"
        style={{
          transform: 'translate(-50%, -50%) rotate(-24deg)',
        }}
      >
        {Array.from({ length: TILE_COUNT }, (_, i) => (
          <span
            key={i}
            className="shrink-0 whitespace-nowrap text-[13px] font-medium tracking-wide text-[#1D2129]/[0.08] dark:text-white/[0.1]"
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
