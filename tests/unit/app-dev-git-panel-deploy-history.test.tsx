import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/app-dev-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/app-dev-api')>(),
  listAppCheckpoints: vi.fn().mockResolvedValue([]),
  listStoAppPushes: vi.fn().mockResolvedValue({ source: 'local', items: [] }),
  listStoAppCloudDeployments: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn().mockResolvedValue({ groupName: null }),
}));

import { AppDevGitPanel } from '@/components/app-dev/AppDevGitPanel';

describe('AppDevGitPanel deploy history', () => {
  it('opens the selected deployment record', async () => {
    const onOpenDeployHistory = vi.fn();
    render(<AppDevGitPanel
      workspaceId="ws-1"
      deployHistory={[{
        deploymentId: 'dep_1', env: 'daily', status: 'SUCCESS', startedAt: 1, updatedAt: 2,
      }]}
      onOpenDeployHistory={onOpenDeployHistory}
    />);
    const row = await waitFor(() => screen.getByRole('button', { name: /dep_1/ }));
    fireEvent.click(row);
    expect(onOpenDeployHistory).toHaveBeenCalledWith('dep_1');
  });
});
