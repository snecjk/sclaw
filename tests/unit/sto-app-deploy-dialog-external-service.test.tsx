import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StoAppDeployDialog } from '@/components/app-dev/StoAppDeployDialog';

const listMock = vi.fn();
vi.mock('@/lib/app-dev-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/app-dev-api')>(),
  listAppExternalServiceBindings: (...args: unknown[]) => listMock(...args),
}));

describe('StoAppDeployDialog external service warning', () => {
  beforeEach(() => {
    listMock.mockResolvedValue([{ alias: 'policy', auth: { type: 'stoToken' } }]);
  });

  it('Assets 绑定 stoToken 服务时展示宿主 Bridge 提示', async () => {
    render(<StoAppDeployDialog open appName="Demo" workspaceId="ws-1" pageType="assets" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(await screen.findByText(/iframe 宿主提供身份/)).toBeInTheDocument();
  });
});
