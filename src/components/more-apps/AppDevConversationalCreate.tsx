/**
 * P5 W2-1：开发应用空态 / 顶部的一句话创建入口。
 */
import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formFieldFocusClass } from '@/lib/surfaces';
import { quickCreateAppFromPrompt } from '@/lib/app-dev-quick-create';

interface AppDevConversationalCreateProps {
  className?: string;
  /** 紧凑模式：嵌入工具栏下方一行。 */
  compact?: boolean;
  onOpenAdvanced?: () => void;
}

export function AppDevConversationalCreate({
  className,
  compact = false,
  onOpenAdvanced,
}: AppDevConversationalCreateProps) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await quickCreateAppFromPrompt(text);
      setPrompt('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        compact
          ? 'flex w-full flex-col gap-2'
          : 'mx-auto flex w-full max-w-xl flex-col items-stretch gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm',
        className,
      )}
      data-testid="app-dev-conversational-create"
    >
      {!compact ? (
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles className="h-4 w-4 text-[var(--sto-brand-primary)]" aria-hidden />
          一句话描述，开始做应用
        </div>
      ) : null}
      <textarea
        value={prompt}
        disabled={busy}
        rows={compact ? 2 : 3}
        placeholder="比如：做一个网点快递查询页，支持单号搜索和轨迹展示"
        className={cn(
          'w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground',
          'placeholder:text-muted-foreground transition-colors',
          formFieldFocusClass,
        )}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="flex items-center gap-2">
        {onOpenAdvanced ? (
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={onOpenAdvanced}
          >
            高级选项（模板 / 全栈 / 目录）…
          </button>
        ) : null}
        <span className="flex-1" />
        <Button
          type="button"
          size="sm"
          disabled={busy || !prompt.trim()}
          className="gap-1.5"
          onClick={() => void submit()}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {busy ? '创建中…' : '开始创建'}
        </Button>
      </div>
    </div>
  );
}
