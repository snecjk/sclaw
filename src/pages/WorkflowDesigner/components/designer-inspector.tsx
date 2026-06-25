import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DesignerNodeTypeConfig } from '@/pages/WorkflowDesigner/components/designer-node-type-config';
import type { WorkflowDefinition, WorkflowNode } from '@/pages/WorkflowDesigner/types';
import { nodeTypeLabel } from '@/pages/WorkflowDesigner/utils';

interface DesignerInspectorProps {
  workflow: WorkflowDefinition;
  selectedNode: WorkflowNode | null;
  onWorkflowDescriptionChange: (description: string) => void;
  onNodeChange: (node: WorkflowNode) => void;
  onDeleteNode: () => void;
}

export function DesignerInspector({
  workflow,
  selectedNode,
  onWorkflowDescriptionChange,
  onNodeChange,
  onDeleteNode,
}: DesignerInspectorProps) {
  if (!selectedNode) {
    return (
      <div className="flex flex-1 flex-col gap-3 overflow-auto p-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">流程名称</label>
          <Input value={workflow.name} readOnly className="bg-muted/40" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">流程描述</label>
          <Textarea
            value={workflow.description ?? ''}
            onChange={(e) => onWorkflowDescriptionChange(e.target.value)}
            rows={4}
          />
        </div>
        <p className="text-xs text-muted-foreground">选择画布节点以编辑属性</p>
      </div>
    );
  }

  const canDelete = selectedNode.type !== 'trigger';

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-3">
      <div>
        <p className="text-xs font-medium text-primary">{nodeTypeLabel(selectedNode.type)}</p>
        <label className="mb-1 mt-2 block text-xs text-muted-foreground">节点名称</label>
        <Input
          value={selectedNode.name}
          onChange={(e) => onNodeChange({ ...selectedNode, name: e.target.value })}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">节点描述</label>
        <Textarea
          value={selectedNode.description ?? ''}
          onChange={(e) => onNodeChange({ ...selectedNode, description: e.target.value })}
          rows={2}
        />
      </div>

      <DesignerNodeTypeConfig node={selectedNode} workflow={workflow} onChange={onNodeChange} />

      {canDelete ? (
        <button
          type="button"
          onClick={onDeleteNode}
          className="mt-auto text-left text-sm text-destructive hover:underline"
        >
          删除节点
        </button>
      ) : (
        <p className="mt-auto text-xs text-muted-foreground">开始方式节点不可删除</p>
      )}
    </div>
  );
}
