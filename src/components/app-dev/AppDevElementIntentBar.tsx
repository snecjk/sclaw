/**
 * 选中区域对话修改浮条：圈选后就地输入意图，回车直接发给 AI。
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Code2, GripVertical, Send, Sparkles, X } from 'lucide-react';
import {
  formatAppDevElementLabel,
  type AppDevElementRect,
  type AppDevPickedElement,
} from '@/lib/app-dev-element-intent';
import { cn } from '@/lib/utils';
import './app-dev-element-intent.css';

export type { AppDevPickedElement } from '@/lib/app-dev-element-intent';
export { buildElementIntentPrompt } from '@/lib/app-dev-element-intent';

interface AppDevElementIntentBarProps {
  elements: AppDevPickedElement[];
  pickerActive?: boolean;
  onSubmit: (intent: string, elements: AppDevPickedElement[]) => void;
  onCancel: () => void;
  onOpenCode?: () => void;
}

const BAR_WIDTH = 560;
const BAR_GAP = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveBarPosition(
  rect: AppDevElementRect | undefined,
  host: DOMRect | null,
): { left: number; top: number; transform?: string } {
  const width = host ? Math.min(BAR_WIDTH, Math.max(280, host.width - 24)) : Math.min(BAR_WIDTH, 560);
  if (!rect || !host) {
    return { left: (host?.width ?? 0) / 2, top: (host?.height ?? 48) - 56, transform: 'translateX(-50%)' };
  }
  const left = clamp(rect.left + rect.width / 2, width / 2 + 12, Math.max(width / 2 + 12, host.width - width / 2 - 12));
  const below = rect.top + rect.height + BAR_GAP;
  const top = below + 48 < host.height - 8 ? below : Math.max(8, rect.top - 48 - BAR_GAP);
  return { left, top, transform: 'translateX(-50%)' };
}

export function AppDevElementIntentBar({
  elements,
  pickerActive = true,
  onSubmit,
  onCancel,
  onOpenCode,
}: AppDevElementIntentBarProps) {
  const [intent, setIntent] = useState('');
  const hostRef = useRef<HTMLDivElement>(null);
  const [hostBox, setHostBox] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const node = hostRef.current?.offsetParent instanceof HTMLElement
      ? hostRef.current.offsetParent
      : hostRef.current?.parentElement;
    if (!node) return;
    const update = () => {
      setHostBox(new DOMRect(0, 0, node.clientWidth, node.clientHeight));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [elements.length, pickerActive]);

  const submit = useCallback(() => {
    const next = intent.trim();
    if (!next || elements.length === 0) return;
    onSubmit(next, elements);
    setIntent('');
  }, [elements, intent, onSubmit]);

  if (!pickerActive) return null;

  const anchor = elements[elements.length - 1]?.rect;
  const position = resolveBarPosition(anchor, hostBox);
  const canSend = Boolean(intent.trim()) && elements.length > 0;

  return (
    <div
      ref={hostRef}
      className="app-dev-element-intent-bar"
      data-testid="app-dev-element-intent-bar"
      style={{
        left: position.left,
        top: position.top,
        transform: position.transform,
        width: `min(${BAR_WIDTH}px, calc(100% - 24px))`,
      }}
    >
      <span className="app-dev-element-intent-bar__grip" aria-hidden>
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <span className="app-dev-element-intent-bar__spark" aria-hidden>
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      {elements.length > 0 ? (
        <div className="app-dev-element-intent-bar__chips">
          {elements.map((el) => (
            <span
              key={el.selector}
              className="app-dev-element-intent-bar__chip"
              title={el.selector}
            >
              {formatAppDevElementLabel(el)}
            </span>
          ))}
        </div>
      ) : (
        <span className="app-dev-element-intent-bar__hint">点击预览中的元素，然后描述要改什么</span>
      )}
      <form
        className="app-dev-element-intent-bar__form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          className="app-dev-element-intent-bar__input sto-control-field"
          placeholder={elements.length > 0 ? '描述你想要的修改…' : '先选择一个元素'}
          value={intent}
          disabled={elements.length === 0}
          onChange={(event) => setIntent(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.key === 'Process') return;
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
          autoFocus={elements.length > 0}
          aria-label="选中区域修改意图"
        />
        <button
          type="submit"
          className="app-dev-element-intent-bar__send"
          disabled={!canSend}
        >
          <Send className="h-3.5 w-3.5" aria-hidden />
          发送
        </button>
      </form>
      {onOpenCode ? (
        <button
          type="button"
          className="app-dev-element-intent-bar__icon-btn"
          onClick={onOpenCode}
          title="查看代码"
          aria-label="查看代码"
        >
          <Code2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        className="app-dev-element-intent-bar__icon-btn"
        onClick={onCancel}
        aria-label="取消圈选"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
