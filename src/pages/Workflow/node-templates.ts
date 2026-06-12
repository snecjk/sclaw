import { MOCK_FLOW_NODES } from '@/pages/Workflow/mock-data';
import type { WorkflowNodeData } from '@/pages/Workflow/types';

function cloneNode(source: WorkflowNodeData, id: string): WorkflowNodeData {
  return structuredClone({ ...source, id, x: 0, y: 0 });
}

const baseByTitle = new Map(MOCK_FLOW_NODES.map((n) => [n.title, n]));

/** @mock: 待接入节点模板 API */
export function createNodeFromTemplate(name: string, id: string): WorkflowNodeData {
  const base = baseByTitle.get(name);
  if (base) {
    const node = cloneNode(base, id);
    if (name === '数据获取') {
      node.fields = [
        {
          key: 'datasource',
          label: '数据源（至少选一种，可多选）',
          type: 'dsgroup',
          dataSource: {},
        },
      ];
      delete node.summary;
    }
    return node;
  }

  if (name === '结束') {
    return {
      id,
      kind: 'end',
      icon: '■',
      label: '结束',
      title: '结束',
      description: '结束流程，不再执行后续节点。',
      x: 0,
      y: 0,
      fields: [{ key: 'note', label: '结束说明', type: 'text', value: '' }],
    };
  }

  return {
    id,
    kind: 'proc',
    icon: '＋',
    label: name,
    title: name,
    description: `新增的「${name}」节点，点击配置参数。`,
    x: 0,
    y: 0,
    fields: [{ key: 'param', label: '参数', type: 'text', value: '' }],
  };
}
