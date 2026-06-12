import { cn } from '@/lib/utils';
import { LIBRARY_NODE_NAMES, NODE_KIND_ICON_CLASS } from '@/pages/Workflow/constants';
import type { WorkflowNodeKind } from '@/pages/Workflow/types';

const LIB_KIND: Record<string, WorkflowNodeKind> = {
  数据获取: 'db',
  数据处理: 'proc',
  条件判定: 'cond',
  结果输出: 'task',
  发送通知: 'notify',
  结束: 'end',
};

const LIB_ICON: Record<string, string> = {
  数据获取: 'DB',
  数据处理: '处',
  条件判定: '!',
  结果输出: '出',
  发送通知: '↗',
  结束: '■',
};

interface NodeLibraryPanelProps {
  variant: 'dock' | 'popover';
  className?: string;
  title?: string;
  hint?: string;
  onPick: (name: string) => void;
}

export function NodeLibraryPanel({ variant, className, title, hint, onPick }: NodeLibraryPanelProps) {
  return (
    <div className={cn('flex flex-col', className)}>
      {variant === 'dock' && title ? (
        <div className="shrink-0 px-[14px] pb-1 pt-[14px]">
          <b className="block text-[14.5px] font-semibold text-foreground">{title}</b>
          {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-2 overflow-auto p-3">
        {LIBRARY_NODE_NAMES.map((name) => {
          const kind = LIB_KIND[name] ?? 'proc';
          return (
            <button
              key={name}
              type="button"
              onClick={() => onPick(name)}
              className="flex items-center gap-[11px] rounded-xl border border-border p-[11px] text-left transition-all duration-fast active:scale-[0.98] hover:border-primary/30 hover:bg-primary/[0.04]"
            >
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[13px] font-semibold',
                  NODE_KIND_ICON_CLASS[kind],
                  kind === 'end' && 'text-[11px]',
                )}
              >
                {LIB_ICON[name]}
              </span>
              <b className="text-[13.5px] font-semibold text-foreground">{name}</b>
            </button>
          );
        })}
      </div>
    </div>
  );
}
