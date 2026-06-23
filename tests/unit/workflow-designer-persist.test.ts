import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/workflow-api', () => ({
  createWorkflow: vi.fn(),
  getStartupSchema: vi.fn(),
  listWorkflowTemplates: vi.fn(),
  saveWorkflowDefinition: vi.fn(),
}));

vi.mock('@/lib/workflow-form-utils', () => ({
  buildStartupPreset: vi.fn((values: Record<string, unknown>, schemaHash: string) => ({
    schemaHash,
    values,
  })),
}));

import {
  createWorkflow,
  getStartupSchema,
  listWorkflowTemplates,
  saveWorkflowDefinition,
} from '@/lib/workflow-api';
import { persistNewWorkflow } from '@/lib/workflow-designer-persist';

describe('persistNewWorkflow', () => {
  beforeEach(() => {
    vi.mocked(listWorkflowTemplates).mockResolvedValue({
      items: [{ id: 'tpl_blank', label: '空白', description: '', nodeCount: 0 }],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    vi.mocked(getStartupSchema).mockResolvedValue({
      templateId: 'tpl_blank',
      schemaHash: 'hash-1',
      schema: { nodeId: 's1', enabled: false, steps: [], fields: [] },
    });
    vi.mocked(createWorkflow).mockResolvedValue({
      workflowId: 'wf_new',
      workflowName: '我的流程',
      defaultPresetId: 'p1',
      schemaHash: 'hash-1',
      startupValues: {},
    });
    vi.mocked(saveWorkflowDefinition).mockResolvedValue({
      schemaVersion: 'workflow/v2',
      id: 'wf_new',
      name: '我的流程',
      version: 1,
      nodes: [{ id: 'n1', type: 'trigger', name: '开始', config: {} }],
      edges: [],
    });
  });

  it('creates instance then saves graph on first save', async () => {
    const saved = await persistNewWorkflow({
      schemaVersion: 'workflow/v2',
      id: '',
      name: '我的流程',
      version: 0,
      nodes: [{ id: 'n1', type: 'trigger', name: '开始', config: {} }],
      edges: [],
    });
    expect(saved.id).toBe('wf_new');
    expect(createWorkflow).toHaveBeenCalled();
    expect(saveWorkflowDefinition).toHaveBeenCalledWith(
      'wf_new',
      expect.objectContaining({ name: '我的流程', nodes: expect.any(Array) }),
    );
  });
});
