/**
 * 元素微调色板：系统色盘 + rgba/hex 输入 + token 色块（对齐 LowCodeEngine ColorSetter 交互）。
 */
import { useEffect, useState } from 'react';
import {
  formatRgba,
  parseColorToRgba,
  rgbaToHex,
  type RgbaColor,
} from '@/lib/app-dev-tune-tokens';

const SWATCHES: Array<{ label: string; value: string }> = [
  { label: '品牌橙', value: 'rgb(255, 111, 0)' },
  { label: '主文字', value: 'rgb(29, 33, 41)' },
  { label: '次文字', value: 'rgb(78, 89, 105)' },
  { label: '白', value: 'rgb(255, 255, 255)' },
  { label: '画布', value: 'rgb(250, 250, 250)' },
  { label: '成功', value: 'rgb(0, 181, 75)' },
  { label: '错误', value: 'rgb(250, 60, 60)' },
  { label: '信息', value: 'rgb(71, 96, 254)' },
];

interface AppDevColorFieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
}

export function AppDevColorField({ label, value, onChange }: AppDevColorFieldProps) {
  const parsed = parseColorToRgba(value) ?? { r: 29, g: 33, b: 41, a: 1 };
  const [draft, setDraft] = useState(formatRgba(parsed));
  const [rgba, setRgba] = useState<RgbaColor>(parsed);

  useEffect(() => {
    const next = parseColorToRgba(value);
    if (!next) return;
    setRgba(next);
    setDraft(formatRgba(next));
  }, [value]);

  const commit = (next: RgbaColor) => {
    setRgba(next);
    const formatted = formatRgba(next);
    setDraft(formatted);
    onChange(formatted);
  };

  return (
    <div className="space-y-2" data-testid="app-dev-color-field">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-[var(--sto-text-secondary)]">{label}</label>
        <input
          type="color"
          aria-label={`${label} 色盘`}
          className="h-7 w-9 cursor-pointer rounded-md border border-border bg-background p-0.5"
          value={rgbaToHex(rgba)}
          onChange={(e) => {
            const next = parseColorToRgba(e.target.value);
            if (next) commit({ ...next, a: rgba.a });
          }}
        />
      </div>
      <input
        className="sto-control-field h-8 w-full rounded-md px-2 font-mono text-xs"
        value={draft}
        placeholder="rgba(29, 33, 41, 1) 或 #1D2129"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = parseColorToRgba(draft);
          if (next) commit(next);
          else setDraft(formatRgba(rgba));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        aria-label={`${label} 色值`}
      />
      <div className="flex items-center gap-2">
        <span className="w-8 shrink-0 text-[11px] text-muted-foreground">透明</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={rgba.a}
          aria-label={`${label} 透明度`}
          className="h-1.5 flex-1 accent-[var(--sto-brand-primary,#FF6F00)]"
          onChange={(e) => commit({ ...rgba, a: Number(e.target.value) })}
        />
        <span className="w-8 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
          {Math.round(rgba.a * 100)}%
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map((item) => (
          <button
            key={item.label}
            type="button"
            title={item.label}
            aria-label={item.label}
            className="h-5 w-5 rounded-md border border-border"
            style={{ background: item.value }}
            onClick={() => {
              const next = parseColorToRgba(item.value);
              if (next) commit(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}
