/**
 * 按选中元素类型展示文字 / 颜色 / 图片等微调项，并即时覆写预览。
 */
import { useMemo } from 'react';
import { OklchColorField } from '@/components/app-dev/OklchColorField';
import { formatAppDevElementCaption } from '@/lib/app-dev-element-intent';
import type { AppDevPickedElement } from '@/lib/app-dev-element-intent';
import {
  classifyAppDevElementTuneKind,
  elementTuneFieldsForKind,
  normalizeFontWeight,
  parseCssPx,
  type AppDevElementTuneDraft,
  type AppDevElementTuneField,
} from '@/lib/app-dev-element-tune';
import { isTransparentCssColor, parseColorToOklch, formatOklch } from '@/lib/app-dev-tune-tokens';
import { buildApplyElementPatchScript } from '@/lib/app-dev-tune-scripts';

export type AppDevTuneExecuteJS = (code: string) => Promise<unknown>;

const KIND_LABEL: Record<string, string> = {
  text: '文字',
  image: '图片',
  button: '按钮',
  container: '容器',
};

const FONT_WEIGHTS = [
  { value: '400', label: '常规' },
  { value: '500', label: '中等' },
  { value: '600', label: '半粗' },
  { value: '700', label: '粗体' },
];

const TEXT_ALIGNS = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
];

const OBJECT_FITS = [
  { value: 'cover', label: '覆盖' },
  { value: 'contain', label: '包含' },
  { value: 'fill', label: '拉伸' },
  { value: 'none', label: '原始' },
];

interface AppDevElementTuneFormProps {
  element: AppDevPickedElement;
  executeJS: AppDevTuneExecuteJS | null;
  draft: AppDevElementTuneDraft;
  onDraftChange: (next: AppDevElementTuneDraft) => void;
}

export function AppDevElementTuneForm({
  element,
  executeJS,
  draft,
  onDraftChange,
}: AppDevElementTuneFormProps) {
  const kind = useMemo(() => classifyAppDevElementTuneKind(element), [element]);
  const fields = useMemo(() => elementTuneFieldsForKind(kind, element), [kind, element]);

  const patchLive = async (next: AppDevElementTuneDraft) => {
    onDraftChange(next);
    if (!executeJS) return;
    try {
      await executeJS(buildApplyElementPatchScript(element.selector, {
        text: next.text,
        src: next.src,
        alt: next.alt,
        styles: next.styles,
      }));
    } catch {
      // 预览不可用时仍保留草稿
    }
  };

  const setStyle = (name: string, value: string) => {
    void patchLive({ ...draft, styles: { ...draft.styles, [name]: value } });
  };

  return (
    <div className="space-y-4" data-testid="app-dev-element-tune-form">
      <div>
        <p className="text-xs font-medium text-foreground">
          {KIND_LABEL[kind] ?? kind}
          {element.a2uiComponent ? ` · ${element.a2uiComponent}` : ''}
        </p>
        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={element.selector}>
          {formatAppDevElementCaption(element)}
        </p>
      </div>
      {fields.map((field) => (
        <FieldEditor
          key={field}
          field={field}
          element={element}
          draft={draft}
          onText={(text) => void patchLive({ ...draft, text })}
          onSrc={(src) => void patchLive({ ...draft, src })}
          onAlt={(alt) => void patchLive({ ...draft, alt })}
          onStyle={setStyle}
        />
      ))}
    </div>
  );
}

export function createElementTuneDraft(element: AppDevPickedElement): AppDevElementTuneDraft {
  return {
    text: element.text ?? '',
    src: element.src ?? '',
    alt: element.alt ?? '',
    styles: {},
  };
}

function FieldEditor({
  field,
  element,
  draft,
  onText,
  onSrc,
  onAlt,
  onStyle,
}: {
  field: AppDevElementTuneField;
  element: AppDevPickedElement;
  draft: AppDevElementTuneDraft;
  onText: (next: string) => void;
  onSrc: (next: string) => void;
  onAlt: (next: string) => void;
  onStyle: (name: string, value: string) => void;
}) {
  if (field === 'text') {
    return (
      <label className="block space-y-1.5">
        <span className="text-xs text-[var(--sto-text-secondary)]">文案</span>
        <textarea
          className="sto-control-field min-h-[64px] w-full resize-y rounded-md px-2 py-1.5 text-xs"
          value={draft.text ?? ''}
          onChange={(e) => onText(e.target.value)}
        />
      </label>
    );
  }
  if (field === 'src') {
    return (
      <label className="block space-y-1.5">
        <span className="text-xs text-[var(--sto-text-secondary)]">图片地址</span>
        <input
          className="sto-control-field h-8 w-full rounded-md px-2 text-xs"
          value={draft.src ?? ''}
          onChange={(e) => onSrc(e.target.value)}
        />
      </label>
    );
  }
  if (field === 'alt') {
    return (
      <label className="block space-y-1.5">
        <span className="text-xs text-[var(--sto-text-secondary)]">替代文字</span>
        <input
          className="sto-control-field h-8 w-full rounded-md px-2 text-xs"
          value={draft.alt ?? ''}
          onChange={(e) => onAlt(e.target.value)}
        />
      </label>
    );
  }
  if (field === 'color' || field === 'background') {
    const cssName = field === 'color' ? 'color' : 'background-color';
    const computed = field === 'color' ? element.styles?.color : element.styles?.background;
    const current = draft.styles[cssName]
      || (isTransparentCssColor(computed) ? formatOklch({ l: 0.7, c: 0.15, h: 50 }) : (computed ?? ''));
    return (
      <LiveColorField
        label={field === 'color' ? '文字颜色' : '背景色'}
        value={current}
        onChange={(next) => onStyle(cssName, next)}
      />
    );
  }
  if (field === 'fontSize') {
    const px = parseCssPx(draft.styles['font-size'] || element.styles?.fontSize) ?? 14;
    return (
      <SliderField
        label="字号"
        value={px}
        min={10}
        max={72}
        step={1}
        display={`${Math.round(px)}px`}
        onChange={(n) => onStyle('font-size', `${Math.round(n)}px`)}
      />
    );
  }
  if (field === 'borderRadius') {
    const px = parseCssPx(draft.styles['border-radius'] || element.styles?.borderRadius) ?? 0;
    return (
      <SliderField
        label="圆角"
        value={px}
        min={0}
        max={32}
        step={1}
        display={`${Math.round(px)}px`}
        onChange={(n) => onStyle('border-radius', `${Math.round(n)}px`)}
      />
    );
  }
  if (field === 'fontWeight') {
    const value = normalizeFontWeight(draft.styles['font-weight'] || element.styles?.fontWeight);
    return (
      <SelectField
        label="字重"
        value={value}
        options={FONT_WEIGHTS}
        onChange={(next) => onStyle('font-weight', next)}
      />
    );
  }
  if (field === 'textAlign') {
    const value = (draft.styles['text-align'] || element.styles?.textAlign || 'left').replace(/-webkit-/, '');
    return (
      <SelectField
        label="对齐"
        value={['left', 'center', 'right'].includes(value) ? value : 'left'}
        options={TEXT_ALIGNS}
        onChange={(next) => onStyle('text-align', next)}
      />
    );
  }
  const value = draft.styles['object-fit'] || element.styles?.objectFit || 'cover';
  return (
    <SelectField
      label="填充"
      value={OBJECT_FITS.some((item) => item.value === value) ? value : 'cover'}
      options={OBJECT_FITS}
      onChange={(next) => onStyle('object-fit', next)}
    />
  );
}

function LiveColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const parsed = parseColorToOklch(value);
  const safe = parsed ? formatOklch(parsed) : 'oklch(0.700 0.150 50.0)';
  return <OklchColorField label={label} value={safe} onChange={onChange} />;
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs text-[var(--sto-text-secondary)]">{label}</label>
        <span className="font-mono text-[11px] text-muted-foreground">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full accent-[var(--sto-brand-primary,#FF6F00)]"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-[var(--sto-text-secondary)]">{label}</span>
      <select
        className="sto-control-field h-8 w-full rounded-md px-2 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}
