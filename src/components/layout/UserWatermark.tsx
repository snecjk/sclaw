/**
 * Soft tiled user watermark for screen capture / preview protection.
 * Global: fixed overlay. Local: absolute (e.g. fullscreen preview).
 */
import { cn } from '@/lib/utils';
import { formatUserWatermarkText } from '@/lib/user-watermark-text';
import { useAuthStore } from '@/stores/auth';

/** Enough cells to fill the oversized rotated canvas edge-to-edge. */
const COLS = 14;
const ROWS = 18;
const TILE_COUNT = COLS * ROWS;

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
      {/*
        Canvas must exceed the viewport diagonal so rotation still covers corners.
        Grid stretches to the full canvas — do not center a sparse flex cluster.
      */}
      <div
        className="absolute left-1/2 top-1/2 grid"
        style={{
          width: '220vw',
          height: '220vh',
          transform: 'translate(-50%, -50%) rotate(-24deg)',
          gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: TILE_COUNT }, (_, i) => (
          <span
            key={i}
            className="flex items-center justify-center whitespace-nowrap text-[13px] font-medium tracking-wide text-[#1D2129]/[0.07] dark:text-white/[0.055]"
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
