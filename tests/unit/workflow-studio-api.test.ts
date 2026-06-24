import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

import { hostApiFetch } from '@/lib/host-api';
import { createWorkflowStudio, listWorkflowStudioTemplates } from '@/lib/workflow-studio-api';

describe('workflow-studio-api', () => {
  beforeEach(() => {
    vi.mocked(hostApiFetch).mockReset();
  });

  it('lists templates from GET /workflow/v1/workflow-templates', async () => {
    vi.mocked(hostApiFetch).mockResolvedValue([
      { id: 'blank', label: '空白', nodeCount: 0 },
    ]);
    const items = await listWorkflowStudioTemplates();
    expect(hostApiFetch).toHaveBeenCalledWith(
      '/workflow/v1/workflow-templates',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(items[0].id).toBe('blank');
  });

  it('creates workflow via POST /workflow/v1/workflows', async () => {
    vi.mocked(hostApiFetch).mockResolvedValue({
      id: 'wf_new',
      name: '测试',
      version: 1,
      schemaVersion: 'workflow/v2',
      nodes: [],
      edges: [],
    });
    const created = await createWorkflowStudio({
      templateId: 'blank',
      name: '测试',
      category: 'common',
      nodes: [],
      edges: [],
    });
    expect(hostApiFetch).toHaveBeenCalledWith(
      '/workflow/v1/workflows',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"templateId":"blank"'),
      }),
    );
    expect(created.id).toBe('wf_new');
  });
});
