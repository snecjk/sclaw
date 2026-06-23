import { BASIC_NODE_TEMPLATES, SMART_NODE_TEMPLATES } from '@/pages/WorkflowDesigner/constants';
import { cn } from '@/lib/utils';

interface DesignerNodeLibraryProps {
  onPick: (type: string) => void;
  className?: string;
}

export function DesignerNodeLibrary({ onPick, className }: DesignerNodeLibraryProps) {
  return (
    <div className={cn('px-3 pb-3', className)}>
      <p className="mb-2 text-xs font-medium text-muted-foreground">智能节点</p>
      <div className="mb-3 flex flex-col gap-1">
        {SMART_NODE_TEMPLATES.map((item) => (
          <button
            key={item.type}
            type="button"
            onClick={() => onPick(item.type)}
            className="rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted"
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">基础节点</p>
      <div className="flex flex-col gap-1">
        {BASIC_NODE_TEMPLATES.map((item) => (
          <button
            key={item.type}
            type="button"
            onClick={() => onPick(item.type)}
            className="rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
