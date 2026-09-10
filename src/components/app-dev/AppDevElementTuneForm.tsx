/**
 * 按选中元素类型分组展示 Setter（内容 / 文字 / 布局 / 间距 / 背景 / 边框 / 图片）。
 */
import { useMemo } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowRight,
} from 'lucide-react';
import { AppDevBoxModelField } from '@/components/app-dev/AppDevBoxModelField';
import { AppDevColorField } from '@/components/app-dev/AppDevColorField';
import { AppDevCssLengthField } from '@/components/app-dev/AppDevCssLengthField';
import { formatAppDevElementCaption } from '@/lib/app-dev-element-intent';
import type { AppDevPickedElement } from '@/lib/app-dev-element-intent';
import {
  classifyAppDevElementTuneKind,
  elementTuneSectorsForKind,
  expandAlignmentStyles,
  expandElementTunePaintStyles,
  normalizeFontWeight,
  parseCssBox,
  parseCssOpacity,
  parseCssPx,
  type AppDevElementTuneDraft,
  type AppDevElementTuneField,
  type CssBox,
} from '@/lib/app-dev-element-tune';
import { isTransparentCssColor, parseColorToRgba, formatRgba } from '@/lib/app-dev-tune-tokens';
import { buildApplyElementPatchScript } from '@/lib/app-dev-tune-scripts';

export type AppDevTuneExecuteJS = (code: string) => Promise<unknown>;

const KIND_LABEL: Record<string, string> = {
  text: '文字',
  image: '图片',
  button: '按钮',
  container: '容器',
  table: '表格',
};

const FONT_WEIGHTS = [
  { value: '400', label: '常规' },
  { value: '500', label: '中等' },
  { value: '600', label: '半粗' },
  { value: '700', label: '粗体' },
];

const OBJECT_FITS = [
  { value: 'cover', label: '覆盖' },
  { value: 'contain', label: '包含' },
  { value: 'fill', label: '拉伸' },
  { value: 'none', label: '原始' },
];

const JUSTIFY_OPTIONS = [
  { value: 'flex-start', label: '起点' },
  { value: 'center', label: '居中' },
  { value: 'flex-end', label: '终点' },
  { value: 'space-between', label: '两端' },
];

const ALIGN_ITEMS_OPTIONS = [
  { value: 'flex-start', label: '起点' },
  { value: 'center', label: '居中' },
  { value: 'flex-end', label: '终点' },
  { value: 'stretch', label: '拉伸' },
];

const DISPLAY_OPTIONS = [
  { value: 'block', label: '块' },
  { value: 'flex', label: '弹性' },
  { value: 'inline-flex', label: '行内弹性' },
  { value: 'none', label: '隐藏' },
];

const FLEX_WRAP_OPTIONS = [
  { value: 'nowrap', label: '不换行' },
  { value: 'wrap', label: '换行' },
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
  const display = draft.styles.display || element.styles?.display;
  const sectors = useMemo(
    () => elementTuneSectorsForKind(kind, element, display),
    [kind, element, display],
  );
  const asFlex = kind === 'container' || kind === 'table';

  const patchLive = async (next: AppDevElementTuneDraft) => {
    onDraftChange(next);
    if (!executeJS) return;
    try {
      await executeJS(buildApplyElementPatchScript(element.selector, {
        text: next.text,
        src: next.src,
        alt: next.alt,
        styles: expandElementTunePaintStyles(next.styles),
        cascadeAlign: 'text-align' in next.styles || 'justify-content' in next.styles,
      }));
    } catch {
      // 预览不可用时仍保留草稿
    }
  };

  const setStyles = (patch: Record<string, string>) => {
    void patchLive({ ...draft, styles: { ...draft.styles, ...patch } });
  };

  const setStyle = (name: string, value: string) => {
    setStyles({ [name]: value });
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
      {sectors.map((sector) => (
        <section key={sector.id} className="space-y-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
          <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground">{sector.title}</h3>
          {sector.fields.map((field) => (
            <FieldEditor
              key={field}
              field={field}
              element={element}
              draft={draft}
              asFlex={asFlex}
              onText={(text) => void patchLive({ ...draft, text })}
              onSrc={(src) => void patchLive({ ...draft, src })}
              onAlt={(alt) => void patchLive({ ...draft, alt })}
              onStyle={setStyle}
              onStyles={setStyles}
            />
          ))}
        </section>
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

function resolveBox(
  draft: AppDevElementTuneDraft,
  element: AppDevPickedElement,
  kind: 'padding' | 'margin',
): CssBox {
  return parseCssBox(draft.styles[kind] || element.styles?.[kind], {
    top: element.styles?.[`${kind}Top`],
    right: element.styles?.[`${kind}Right`],
    bottom: element.styles?.[`${kind}Bottom`],
    left: element.styles?.[`${kind}Left`],
  });
}

function BoxModelEditor({
  field,
  element,
  draft,
  onStyle,
}: {
  field: 'padding' | 'margin' | 'boxModel';
  element: AppDevPickedElement;
  draft: AppDevElementTuneDraft;
  onStyle: (name: string, value: string) => void;
}) {
  const padding = resolveBox(draft, element, 'padding');
  const margin = resolveBox(draft, element, 'margin');
  if (field === 'padding') {
    return <AppDevBoxModelField padding={padding} onPaddingChange={(next) => onStyle('padding', next)} />;
  }
  if (field === 'margin') {
    return <AppDevBoxModelField margin={margin} onMarginChange={(next) => onStyle('margin', next)} />;
  }
  return (
    <AppDevBoxModelField
      padding={padding}
      margin={margin}
      onPaddingChange={(next) => onStyle('padding', next)}
      onMarginChange={(next) => onStyle('margin', next)}
    />
  );
}

function FieldEditor({
  field,
  element,
  draft,
  asFlex,
  onText,
  onSrc,
  onAlt,
  onStyle,
  onStyles,
}: {
  field: AppDevElementTuneField;
  element: AppDevPickedElement;
  draft: AppDevElementTuneDraft;
  asFlex: boolean;
  onText: (next: string) => void;
  onSrc: (next: string) => void;
  onAlt: (next: string) => void;
  onStyle: (name: string, value: string) => void;
  onStyles: (patch: Record<string, string>) => void;
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
    const fallback = field === 'color' ? 'rgb(29, 33, 41)' : 'rgb(255, 255, 255)';
    const current = draft.styles[cssName]
      || (isTransparentCssColor(computed) ? fallback : (computed ?? fallback));
    const parsed = parseColorToRgba(current);
    return (
      <AppDevColorField
        label={field === 'color' ? '颜色' : '背景色'}
        value={parsed ? formatRgba(parsed) : fallback}
        onChange={(next) => {
          if (field === 'background') {
            onStyles(expandElementTunePaintStyles({ 'background-color': next }));
            return;
          }
          onStyle(cssName, next);
        }}
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
  if (field === 'lineHeight') {
    const px = parseCssPx(draft.styles['line-height'] || element.styles?.lineHeight) ?? 22;
    return (
      <SliderField
        label="行高"
        value={px}
        min={12}
        max={64}
        step={1}
        display={`${Math.round(px)}px`}
        onChange={(n) => onStyle('line-height', `${Math.round(n)}px`)}
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
  if (field === 'padding' || field === 'margin' || field === 'boxModel') {
    return (
      <BoxModelEditor
        field={field}
        element={element}
        draft={draft}
        onStyle={onStyle}
      />
    );
  }
  if (field === 'gap') {
    const px = parseCssPx(draft.styles.gap || element.styles?.gap) ?? 0;
    return (
      <SliderField
        label="间距"
        value={px}
        min={0}
        max={48}
        step={1}
        display={`${Math.round(px)}px`}
        onChange={(n) => onStyle('gap', `${Math.round(n)}px`)}
      />
    );
  }
  if (field === 'width' || field === 'height') {
    const cssName = field === 'width' ? 'width' : 'height';
    return (
      <AppDevCssLengthField
        label={field === 'width' ? '宽度' : '高度'}
        value={draft.styles[cssName] || element.styles?.[cssName]}
        fallback={field === 'width' ? '100%' : 'auto'}
        onChange={(next) => onStyle(cssName, next)}
      />
    );
  }
  if (field === 'opacity') {
    const value = parseCssOpacity(draft.styles.opacity || element.styles?.opacity);
    return (
      <SliderField
        label="不透明度"
        value={Math.round(value * 100)}
        min={0}
        max={100}
        step={1}
        display={`${Math.round(value * 100)}%`}
        onChange={(n) => onStyle('opacity', String(n / 100))}
      />
    );
  }
  if (field === 'borderWidth') {
    const px = parseCssPx(draft.styles['border-width'] || element.styles?.borderWidth) ?? 0;
    return (
      <SliderField
        label="边框粗细"
        value={px}
        min={0}
        max={12}
        step={1}
        display={`${Math.round(px)}px`}
        onChange={(n) => {
          const next = Math.round(n);
          onStyles({
            'border-width': `${next}px`,
            'border-style': next > 0 ? 'solid' : 'none',
          });
        }}
      />
    );
  }
  if (field === 'borderColor') {
    const computed = element.styles?.borderColor;
    const fallback = 'rgb(229, 230, 235)';
    const current = draft.styles['border-color']
      || (isTransparentCssColor(computed) ? fallback : (computed ?? fallback));
    const parsed = parseColorToRgba(current);
    return (
      <AppDevColorField
        label="边框色"
        value={parsed ? formatRgba(parsed) : fallback}
        onChange={(next) => onStyles({ 'border-color': next, 'border-style': draft.styles['border-style'] || 'solid' })}
      />
    );
  }
  if (field === 'display') {
    const value = (draft.styles.display || element.styles?.display || 'block').split(' ')[0];
    const current = DISPLAY_OPTIONS.some((item) => item.value === value) ? value : 'block';
    return (
      <SegmentedField
        label="显示"
        value={current}
        options={DISPLAY_OPTIONS}
        onChange={(next) => onStyle('display', next)}
      />
    );
  }
  if (field === 'flexWrap') {
    const value = draft.styles['flex-wrap'] || element.styles?.flexWrap || 'nowrap';
    return (
      <SegmentedField
        label="换行"
        value={FLEX_WRAP_OPTIONS.some((item) => item.value === value) ? value : 'nowrap'}
        options={FLEX_WRAP_OPTIONS}
        onChange={(next) => onStyles({ display: draft.styles.display || 'flex', 'flex-wrap': next })}
      />
    );
  }
  if (field === 'fontWeight') {
    const value = normalizeFontWeight(draft.styles['font-weight'] || element.styles?.fontWeight);
    return (
      <SegmentedField
        label="字重"
        value={value}
        options={FONT_WEIGHTS}
        onChange={(next) => onStyle('font-weight', next)}
      />
    );
  }
  if (field === 'textAlign') {
    const value = (draft.styles['text-align'] || element.styles?.textAlign || 'left').replace(/-webkit-/, '');
    const current = ['left', 'center', 'right'].includes(value) ? value : 'left';
    return (
      <div className="space-y-1.5">
        <span className="text-xs text-[var(--sto-text-secondary)]">对齐</span>
        <div className="sto-segment-track sto-segment-track--plain flex h-8 w-full rounded-md p-0.5">
          {([
            { value: 'left', label: '左对齐', icon: AlignLeft },
            { value: 'center', label: '居中', icon: AlignCenter },
            { value: 'right', label: '右对齐', icon: AlignRight },
          ] as const).map((item) => {
            const Icon = item.icon;
            const active = current === item.value;
            return (
              <button
                key={item.value}
                type="button"
                title={item.label}
                aria-label={item.label}
                aria-pressed={active}
                className="sto-segment-item sto-segment-item--plain flex h-7 flex-1 items-center justify-center rounded-sm"
                data-state={active ? 'active' : undefined}
                onClick={() => onStyles(expandAlignmentStyles(item.value, asFlex))}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (field === 'flexDirection') {
    const value = draft.styles['flex-direction'] || element.styles?.flexDirection || 'row';
    const current = value === 'column' ? 'column' : 'row';
    return (
      <div className="space-y-1.5">
        <span className="text-xs text-[var(--sto-text-secondary)]">方向</span>
        <div className="sto-segment-track sto-segment-track--plain flex h-8 w-full rounded-md p-0.5">
          {([
            { value: 'row', label: '横向', icon: ArrowRight },
            { value: 'column', label: '纵向', icon: ArrowDown },
          ] as const).map((item) => {
            const Icon = item.icon;
            const active = current === item.value;
            return (
              <button
                key={item.value}
                type="button"
                aria-label={item.label}
                aria-pressed={active}
                className="sto-segment-item sto-segment-item--plain flex h-7 flex-1 items-center justify-center gap-1 rounded-sm text-[11px]"
                data-state={active ? 'active' : undefined}
                onClick={() => onStyles({ display: 'flex', 'flex-direction': item.value })}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (field === 'justifyContent') {
    const value = draft.styles['justify-content'] || element.styles?.justifyContent || 'flex-start';
    return (
      <SegmentedField
        label="主轴对齐"
        value={JUSTIFY_OPTIONS.some((item) => item.value === value) ? value : 'flex-start'}
        options={JUSTIFY_OPTIONS}
        onChange={(next) => onStyles({ display: 'flex', 'justify-content': next })}
      />
    );
  }
  if (field === 'alignItems') {
    const value = draft.styles['align-items'] || element.styles?.alignItems || 'stretch';
    return (
      <SegmentedField
        label="交叉轴"
        value={ALIGN_ITEMS_OPTIONS.some((item) => item.value === value) ? value : 'stretch'}
        options={ALIGN_ITEMS_OPTIONS}
        onChange={(next) => onStyles({ display: 'flex', 'align-items': next })}
      />
    );
  }
  const value = draft.styles['object-fit'] || element.styles?.objectFit || 'cover';
  return (
    <SegmentedField
      label="填充"
      value={OBJECT_FITS.some((item) => item.value === value) ? value : 'cover'}
      options={OBJECT_FITS}
      onChange={(next) => onStyle('object-fit', next)}
    />
  );
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

function SegmentedField({
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
    <div className="space-y-1.5">
      <span className="text-xs text-[var(--sto-text-secondary)]">{label}</span>
      <div className="sto-segment-track sto-segment-track--plain flex min-h-8 w-full flex-wrap rounded-md p-0.5">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              className="sto-segment-item sto-segment-item--plain h-7 min-w-0 flex-1 px-1 text-[11px]"
              data-state={active ? 'active' : undefined}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
