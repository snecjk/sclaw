/**
 * 元素圈选后的意图浮条（T07）：展示已选选择器 + 意图输入 → 组包回填 composer。
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface AppDevPickedElement {
  selector: string;
  tag: string;
  text?: string;
  styles?: Record<string, string>;
}

interface AppDevElementIntentBarProps {
  elements: AppDevPickedElement[];
  onSubmit: (intent: string, elements: AppDevPickedElement[]) => void;
  onCancel: () => void;
}

export function buildElementIntentPrompt(
  intent: string,
  elements: AppDevPickedElement[],
): string {
  const lines = elements.map((el, i) => {
    const style = el.styles ? JSON.stringify(el.styles) : '{}';
    return `${i + 1}. 选择器 \`${el.selector}\`（${el.tag}${el.text ? ` / "${el.text.slice(0, 40)}"` : ''}）；当前样式摘要：${style}`;
  });
  return [
    '请只修改下列选中元素相关代码，不要改动无关区域。',
    ...lines,
    `修改意图：${intent.trim()}`,
  ].join('\n');
}

export function AppDevElementIntentBar({
  elements,
  onSubmit,
  onCancel,
}: AppDevElementIntentBarProps) {
  const [intent, setIntent] = useState('');
  if (elements.length === 0) return null;

  return (
    <div className="pointer-events-auto absolute bottom-3 left-1/2 z-20 flex h-10 w-[min(560px,calc(100%-24px))] -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-popover px-3 shadow-[var(--sto-shadow-content-popover)] animate-in fade-in duration-200">
      <div className="flex max-w-[40%] items-center gap-1 overflow-hidden">
        {elements.map((el) => (
          <span
            key={el.selector}
            className="truncate rounded bg-muted px-1.5 font-mono text-xs text-foreground"
            title={el.selector}
          >
            {el.selector}
          </span>
        ))}
      </div>
      <input
        className="h-7 min-w-0 flex-1 rounded-md border-0 bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground"
        placeholder="描述要改什么…"
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && intent.trim()) {
            onSubmit(intent, elements);
            setIntent('');
          }
          if (e.key === 'Escape') onCancel();
        }}
        autoFocus
      />
      <Button
        type="button"
        size="sm"
        className="h-7 shrink-0 px-2 text-xs"
        disabled={!intent.trim()}
        onClick={() => {
          if (!intent.trim()) return;
          onSubmit(intent, elements);
          setIntent('');
        }}
      >
        发送
      </Button>
      <button
        type="button"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        onClick={onCancel}
        aria-label="取消圈选"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
