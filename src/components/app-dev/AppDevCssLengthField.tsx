/**
 * 尺寸 Setter：数值 + px/%/auto，对齐 LowCodeEngine NumberSetter。
 */
import {
  formatCssLength,
  parseCssLength,
  type CssLengthUnit,
} from '@/lib/app-dev-element-tune';

const UNITS: Array<{ value: CssLengthUnit; label: string }> = [
  { value: 'px', label: 'px' },
  { value: '%', label: '%' },
  { value: 'auto', label: 'auto' },
];

interface AppDevCssLengthFieldProps {
  label: string;
  value: string | undefined;
  fallback?: string;
  onChange: (next: string) => void;
}

export function AppDevCssLengthField({
  label,
  value,
  fallback = 'auto',
  onChange,
}: AppDevCssLengthFieldProps) {
  const parsed = parseCssLength(value) ?? parseCssLength(fallback) ?? { value: 0, unit: 'auto' as const };
  const unit = parsed.unit;

  return (
    <div className="space-y-1.5">
      <span className="text-xs text-[var(--sto-text-secondary)]">{label}</span>
      <div className="flex items-center gap-1.5">
        {unit === 'auto' ? (
          <span className="sto-control-field flex h-8 flex-1 items-center px-2 font-mono text-xs text-muted-foreground">
            auto
          </span>
        ) : (
          <input
            type="number"
            className="sto-control-field h-8 min-w-0 flex-1 rounded-md px-2 font-mono text-xs"
            min={0}
            max={unit === '%' ? 100 : 2400}
            step={1}
            value={Number.isFinite(parsed.value) ? parsed.value : 0}
            aria-label={label}
            onChange={(e) => onChange(formatCssLength({ value: Number(e.target.value) || 0, unit }))}
          />
        )}
        <div className="sto-segment-track sto-segment-track--plain flex h-8 shrink-0 rounded-md p-0.5">
          {UNITS.map((item) => {
            const active = unit === item.value;
            return (
              <button
                key={item.value}
                type="button"
                aria-label={`${label} ${item.label}`}
                aria-pressed={active}
                className="sto-segment-item sto-segment-item--plain h-7 px-1.5 text-[11px]"
                data-state={active ? 'active' : undefined}
                onClick={() => {
                  if (item.value === 'auto') {
                    onChange('auto');
                    return;
                  }
                  const nextValue = item.value === '%'
                    ? Math.min(100, parsed.unit === '%' ? parsed.value : 100)
                    : (parsed.unit === 'px' ? parsed.value : 120);
                  onChange(formatCssLength({ value: nextValue, unit: item.value }));
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
