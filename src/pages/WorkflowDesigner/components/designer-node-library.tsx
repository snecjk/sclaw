import { NODE_TEMPLATES } from '@/pages/WorkflowDesigner/constants';
import { cn } from '@/lib/utils';

const WEB_CANVAS_LIBRARY_TYPES = [
  'agent_data_fetch',
  'agent_task',
  'agent_condition',
  'agent_output',
  'output',
];

interface DesignerNodeLibraryProps {
  onPick: (type: string) => void;
  className?: string;
}

export function DesignerNodeLibrary({ onPick, className }: DesignerNodeLibraryProps) {
  const items = WEB_CANVAS_LIBRARY_TYPES
    .map((type) => NODE_TEMPLATES.find((template) => template.type === type))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <div className={cn('workflow-node-library-list', className)}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.type}
            type="button"
            draggable
            onClick={() => onPick(item.type)}
            onDragStart={(event) => {
              event.dataTransfer.setData('application/reactflow', item.type);
              event.dataTransfer.effectAllowed = 'move';
            }}
            className={cn('workflow-node-library-item', `tile-${item.accent}`)}
          >
            <span className="workflow-node-library-icon">
              <Icon size={18} />
            </span>
            <span className="workflow-node-library-copy">
              <span className="workflow-node-library-title">{item.label}</span>
              <span className="workflow-node-library-summary">{item.summary}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
