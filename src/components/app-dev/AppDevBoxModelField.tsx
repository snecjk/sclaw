/**
 * 盒模型 Setter：外边距套内边距，四边可分可锁，对齐 LowCodeEngine StyleSetter。
 */
import { useState, type ReactNode } from 'react';
import { Link, Unlink } from 'lucide-react';
import {
  formatCssBox,
  isUniformCssBox,
  type CssBox,
} from '@/lib/app-dev-element-tune';

interface AppDevBoxModelFieldProps {
  padding?: CssBox;
  margin?: CssBox;
  onPaddingChange?: (next: string) => void;
  onMarginChange?: (next: string) => void;
}

export function AppDevBoxModelField({
  padding,
  margin,
  onPaddingChange,
  onMarginChange,
}: AppDevBoxModelFieldProps) {
  return (
    <div className="space-y-2" data-testid="app-dev-box-model">
      {margin && onMarginChange ? (
        <BoxRing
          label="外边距"
          box={margin}
          insetClass="bg-[var(--sto-surface-subtle)]"
          onChange={(box) => onMarginChange(formatCssBox(box))}
        >
          {padding && onPaddingChange ? (
            <BoxRing
              label="内边距"
              box={padding}
              insetClass="bg-[var(--sto-card-panel-bg)]"
              onChange={(box) => onPaddingChange(formatCssBox(box))}
            >
              <div className="flex h-8 items-center justify-center rounded-sm border border-dashed border-border text-[10px] text-muted-foreground">
                内容
              </div>
            </BoxRing>
          ) : (
            <div className="flex h-8 items-center justify-center rounded-sm border border-dashed border-border text-[10px] text-muted-foreground">
              内容
            </div>
          )}
        </BoxRing>
      ) : padding && onPaddingChange ? (
        <BoxRing
          label="内边距"
          box={padding}
          insetClass="bg-[var(--sto-surface-subtle)]"
          onChange={(box) => onPaddingChange(formatCssBox(box))}
        >
          <div className="flex h-8 items-center justify-center rounded-sm border border-dashed border-border text-[10px] text-muted-foreground">
            内容
          </div>
        </BoxRing>
      ) : null}
    </div>
  );
}

function BoxRing({
  label,
  box,
  insetClass,
  onChange,
  children,
}: {
  label: string;
  box: CssBox;
  insetClass: string;
  onChange: (next: CssBox) => void;
  children: ReactNode;
}) {
  const [linked, setLinked] = useState(isUniformCssBox(box));

  const setSide = (side: keyof CssBox, raw: string) => {
    const n = Math.max(0, Number(raw) || 0);
    if (linked) {
      onChange({ top: n, right: n, bottom: n, left: n });
      return;
    }
    onChange({ ...box, [side]: n });
  };

  return (
    <div className={`rounded-md border border-border p-1.5 ${insetClass}`}>
      <div className="mb-1 flex items-center justify-between px-0.5">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <button
          type="button"
          className="sto-control-ghost inline-flex h-5 w-5 items-center justify-center rounded-sm"
          aria-label={linked ? `${label} 四边相同` : `${label} 四边独立`}
          aria-pressed={linked}
          title={linked ? '四边相同' : '四边独立'}
          onClick={() => {
            const next = !linked;
            setLinked(next);
            if (next) onChange({ top: box.top, right: box.top, bottom: box.top, left: box.top });
          }}
        >
          {linked ? <Link className="h-3 w-3" /> : <Unlink className="h-3 w-3" />}
        </button>
      </div>
      <div className="flex justify-center">
        <SideInput ariaLabel={`${label} 上`} value={box.top} onChange={(v) => setSide('top', v)} />
      </div>
      <div className="my-1 flex items-center gap-1">
        <SideInput ariaLabel={`${label} 左`} value={box.left} onChange={(v) => setSide('left', v)} />
        <div className="min-w-0 flex-1">{children}</div>
        <SideInput ariaLabel={`${label} 右`} value={box.right} onChange={(v) => setSide('right', v)} />
      </div>
      <div className="flex justify-center">
        <SideInput ariaLabel={`${label} 下`} value={box.bottom} onChange={(v) => setSide('bottom', v)} />
      </div>
    </div>
  );
}

function SideInput({
  ariaLabel,
  value,
  onChange,
}: {
  ariaLabel: string;
  value: number;
  onChange: (raw: string) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      max={240}
      step={1}
      aria-label={ariaLabel}
      className="sto-control-field h-6 w-11 shrink-0 rounded-sm px-0.5 text-center font-mono text-[11px]"
      value={Math.round(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
