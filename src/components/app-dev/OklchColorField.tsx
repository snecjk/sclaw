/**
 * OKLCH 色板：L/C/H 三滑杆 + 色块预览 + 文本框（支持 oklch / #hex）。
 */
import { useEffect, useState } from 'react';
import {
  formatOklch,
  parseColorToOklch,
  type OklchColor,
} from '@/lib/app-dev-tune-tokens';

interface OklchColorFieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
}

export function OklchColorField({ label, value, onChange }: OklchColorFieldProps) {
  const parsed = parseColorToOklch(value) ?? { l: 0.7, c: 0.15, h: 50 };
  const [draft, setDraft] = useState(value);
  const [oklch, setOklch] = useState<OklchColor>(parsed);

  useEffect(() => {
    setDraft(value);
    const next = parseColorToOklch(value);
    if (next) setOklch(next);
  }, [value]);

  const commitOklch = (next: OklchColor) => {
    setOklch(next);
    const formatted = formatOklch(next);
    setDraft(formatted);
    onChange(formatted);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-[var(--sto-text-secondary)]">{label}</label>
        <span
          className="h-5 w-5 shrink-0 rounded-md border border-border"
          style={{ background: formatOklch(oklch) }}
          aria-hidden
        />
      </div>
      <SliderRow
        label="L"
        min={0}
        max={1}
        step={0.01}
        value={oklch.l}
        onChange={(l) => commitOklch({ ...oklch, l })}
      />
      <SliderRow
        label="C"
        min={0}
        max={0.4}
        step={0.005}
        value={oklch.c}
        onChange={(c) => commitOklch({ ...oklch, c })}
      />
      <SliderRow
        label="H"
        min={0}
        max={360}
        step={1}
        value={oklch.h}
        onChange={(h) => commitOklch({ ...oklch, h })}
      />
      <input
        className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = parseColorToOklch(draft);
          if (next) commitOklch(next);
          else setDraft(formatOklch(oklch));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        aria-label={`${label} 色值`}
      />
    </div>
  );
}

function SliderRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-3 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 accent-[var(--sto-brand-primary,#FF6F00)]"
      />
      <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
        {value.toFixed(label === 'H' ? 0 : 2)}
      </span>
    </div>
  );
}
