import { describe, expect, it } from 'vitest';
import { definitionFromDetail, definitionToSavePayload } from '@/lib/workflow-designer-adapter';

describe('workflow-designer-adapter', () => {
  it('maps detail to definition', () => {
    const def = definitionFromDetail({
      workflowId: 'wf_1',
      workflowName: '测试流程',
      version: 2,
      schemaVersion: 'workflow/v2',
      nodes: [{ id: 'n1', type: 'trigger', name: '开始' }],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      startup: { schemaHash: 'h', schema: { nodeId: 's', enabled: false, steps: [], fields: [] }, defaultPreset: null },
    });
    expect(def.id).toBe('wf_1');
    expect(def.nodes).toHaveLength(1);
    expect(def.edges[0].target).toBe('n2');
  });

  it('builds save payload', () => {
    const payload = definitionToSavePayload({
      schemaVersion: 'workflow/v2',
      id: 'wf_1',
      name: 'A',
      version: 1,
      nodes: [],
      edges: [],
    });
    expect(payload.name).toBe('A');
    expect(payload.id).toBe('wf_1');
  });
});
