import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  useReactFlow,
  useEdgesState,
  useNodesState,
  MarkerType,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '@/pages/WorkflowDesigner/workflow-designer-canvas.css';
import { WorkflowCanvasNode } from '@/pages/WorkflowDesigner/components/workflow-canvas-node';
import { DesignerEdge } from '@/pages/WorkflowDesigner/components/designer-edge';
import type { CanvasNodeData, WorkflowDefinition, WorkflowNode } from '@/pages/WorkflowDesigner/types';
import {
  buildCanvasEdges,
  buildCanvasNodes,
  centerDroppedNodePosition,
  createEdge,
  insertNodeOnEdge,
} from '@/pages/WorkflowDesigner/utils';

const nodeTypes = { workflowNode: WorkflowCanvasNode };
const edgeTypes = { designer: DesignerEdge };
const defaultEdgeOptions = { type: 'designer' as const };

interface DesignerCanvasProps {
  workflow: WorkflowDefinition;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  onWorkflowChange: (workflow: WorkflowDefinition) => void;
  onAddNodeAt: (type: string, position: { x: number; y: number }) => void;
  onDirty: () => void;
  canvasWrapRef: React.RefObject<HTMLDivElement | null>;
}

function DesignerCanvasInner({
  workflow,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  onWorkflowChange,
  onAddNodeAt,
  onDirty,
  canvasWrapRef,
}: DesignerCanvasProps) {
  const [nodes, setNodes] = useNodesState<Node<CanvasNodeData>>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const [insertMenuEdgeId, setInsertMenuEdgeId] = useState<string | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  const canvasRevision = useMemo(() => {
    const nodeSignature = workflow.nodes
      .map((node) => {
        const position = node.config?.editor as { position?: { x?: number; y?: number } } | undefined;
        const pos = position?.position;
        return [node.id, node.name, node.type, pos?.x ?? '', pos?.y ?? ''].join(':');
      })
      .join('|');
    const edgeSignature = workflow.edges
      .map((edge) => [edge.id, edge.source, edge.target, edge.condition ?? ''].join(':'))
      .join('|');
    return `${workflow.id}::${nodeSignature}::${edgeSignature}`;
  }, [workflow]);

  const handleInsertNodeOnEdge = useCallback(
    (edgeId: string, nodeType: string) => {
      const result = insertNodeOnEdge(workflow, edgeId, nodeType);
      if (!result) return;
      onWorkflowChange(result.workflow);
      onSelectNode(result.newNodeId);
      onSelectEdge(null);
      setInsertMenuEdgeId(null);
      onDirty();
    },
    [workflow, onWorkflowChange, onSelectNode, onSelectEdge, onDirty],
  );

  const handleNodeChange = useCallback(
    (nextNode: WorkflowNode) => {
      onWorkflowChange({
        ...workflow,
        nodes: workflow.nodes.map((node) => (node.id === nextNode.id ? nextNode : node)),
      });
      onDirty();
    },
    [workflow, onWorkflowChange, onDirty],
  );

  const handleDeleteNodeById = useCallback(
    (nodeId: string) => {
      const node = workflow.nodes.find((item) => item.id === nodeId);
      if (!node || node.type === 'trigger') return;
      onWorkflowChange({
        ...workflow,
        nodes: workflow.nodes.filter((item) => item.id !== nodeId),
        edges: workflow.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      });
      if (selectedNodeId === nodeId) onSelectNode(null);
      onDirty();
    },
    [workflow, selectedNodeId, onWorkflowChange, onSelectNode, onDirty],
  );

  const buildEdgesForCanvas = useCallback(
    () =>
      buildCanvasEdges(workflow, selectedEdgeId).map((edge) => ({
        ...edge,
        data: {
          ...(edge.data ?? {}),
          insertMenuOpen: edge.id === insertMenuEdgeId,
          onOpenInsertMenu: (edgeId: string) => setInsertMenuEdgeId(edgeId),
          onCloseInsertMenu: () => setInsertMenuEdgeId(null),
          onInsertNode: handleInsertNodeOnEdge,
        },
      })),
    [workflow, selectedEdgeId, insertMenuEdgeId, handleInsertNodeOnEdge],
  );

  useEffect(() => {
    setNodes(buildCanvasNodes(workflow, {
      onNodeChange: handleNodeChange,
      onDeleteNode: handleDeleteNodeById,
    }));
    setEdges(buildEdgesForCanvas());
  }, [canvasRevision, buildEdgesForCanvas, handleDeleteNodeById, handleNodeChange, setEdges, setNodes, workflow]);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
      })) as Node<CanvasNodeData>[],
    );
  }, [selectedNodeId, setNodes]);

  const onNodesChange = (changes: NodeChange<Node<CanvasNodeData>>[]) => {
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes));

    const positionChanges = changes
      .filter(
        (change): change is NodeChange<Node<CanvasNodeData>> & { id: string; position?: { x: number; y: number } } =>
          change.type === 'position' &&
          'position' in change &&
          (change as { dragging?: boolean }).dragging === false,
      )
      .map((change) => ({
        id: change.id,
        position: change.position,
      }));

    const removedIds = changes
      .filter((change) => change.type === 'remove')
      .map((change) => (change as { id: string }).id);

    if (positionChanges.length === 0 && removedIds.length === 0) return;

    let nextWorkflow = workflow;
    let dirty = false;

    if (removedIds.length > 0) {
      nextWorkflow = {
        ...nextWorkflow,
        nodes: nextWorkflow.nodes.filter((node) => !removedIds.includes(node.id)),
        edges: nextWorkflow.edges.filter(
          (edge) => !removedIds.includes(edge.source) && !removedIds.includes(edge.target),
        ),
      };
      if (selectedNodeId && removedIds.includes(selectedNodeId)) {
        onSelectNode(null);
      }
      dirty = true;
    }

    if (positionChanges.length > 0) {
      nextWorkflow = {
        ...nextWorkflow,
        nodes: nextWorkflow.nodes.map((node) => {
          const match = positionChanges.find((item) => item.id === node.id);
          if (!match?.position) return node;
          return {
            ...node,
            config: {
              ...node.config,
              editor: { ...(node.config.editor as object | undefined), position: match.position },
            },
          };
        }),
      };
      dirty = true;
    }

    if (dirty) {
      onWorkflowChange(nextWorkflow);
      onDirty();
    }
  };

  const onNodeDragStop: OnNodeDrag<Node<CanvasNodeData>> = (_, draggedNode) => {
    onWorkflowChange({
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === draggedNode.id
          ? {
              ...node,
              config: {
                ...node.config,
                editor: { ...(node.config.editor as object | undefined), position: draggedNode.position },
              },
            }
          : node,
      ),
    });
    onDirty();
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));

    const removedIds = changes
      .filter((change) => change.type === 'remove')
      .map((change) => (change as { id: string }).id);

    if (removedIds.length === 0) return;

    onWorkflowChange({
      ...workflow,
      edges: workflow.edges.filter((edge) => !removedIds.includes(edge.id)),
    });
    if (selectedEdgeId && removedIds.includes(selectedEdgeId)) {
      onSelectEdge(null);
    }
    onDirty();
  };

  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (workflow.edges.some((e) => e.source === connection.source && e.target === connection.target)) {
      return;
    }
    const nextEdge = createEdge(connection.source, connection.target);
    setEdges((currentEdges) =>
      addEdge(
        { ...nextEdge, markerEnd: { type: MarkerType.ArrowClosed }, interactionWidth: 20 },
        currentEdges,
      ),
    );
    onWorkflowChange({ ...workflow, edges: [...workflow.edges, nextEdge] });
    onDirty();
  };

  const onEdgeUpdate = (oldEdge: Edge, newConnection: Connection) => {
    setEdges((currentEdges) => reconnectEdge(oldEdge, newConnection, currentEdges));
    if (!newConnection.source || !newConnection.target) return;
    onWorkflowChange({
      ...workflow,
      edges: workflow.edges.map((edge) =>
        edge.id === oldEdge.id
          ? { ...edge, source: newConnection.source!, target: newConnection.target! }
          : edge,
      ),
    });
    onDirty();
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const nodeType = event.dataTransfer.getData('application/reactflow');
    if (!nodeType) return;
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    onAddNodeAt(nodeType, centerDroppedNodePosition(position));
  };

  return (
    <div ref={canvasWrapRef} className="relative min-h-0 min-w-0 flex-1">
      <ReactFlow
        className="workflow-designer-flow"
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.25}
        maxZoom={2}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onEdgeUpdate}
        onDragOver={onDragOver}
        onDrop={onDrop}
        deleteKeyCode={['Backspace', 'Delete']}
        onNodeClick={(_, node) => {
          onSelectNode(node.id);
          onSelectEdge(null);
        }}
        onEdgeClick={(_, edge) => {
          onSelectEdge(edge.id);
          onSelectNode(null);
        }}
        onPaneClick={() => {
          onSelectNode(null);
          onSelectEdge(null);
          setInsertMenuEdgeId(null);
        }}
      >
        <Background color="hsl(var(--muted-foreground) / 0.25)" gap={24} />
        <Controls showInteractive={false} />
        <MiniMap zoomable pannable />
      </ReactFlow>
    </div>
  );
}

export function DesignerCanvas(props: DesignerCanvasProps) {
  const providerKey = props.workflow.id || 'new-workflow';
  return (
    <ReactFlowProvider key={providerKey}>
      <DesignerCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
