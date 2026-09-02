import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StoAppMenuPublishDialog } from '../../src/components/app-dev/StoAppMenuPublishDialog';

const { previewStoAppMenusMock, syncStoAppMenusMock } = vi.hoisted(() => ({
  previewStoAppMenusMock: vi.fn(),
  syncStoAppMenusMock: vi.fn(),
}));

vi.mock('@/lib/app-dev-api', () => ({
  previewStoAppMenus: previewStoAppMenusMock,
  syncStoAppMenus: syncStoAppMenusMock,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

describe('StoAppMenuPublishDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewStoAppMenusMock.mockResolvedValue({
      appCode: 'app_1',
      source: 'top-nav',
      skipped: [],
      menus: [
        { menu_code: 'workspace', parent_code: null, menu_name: '工作台', menu_type: 'directory' },
        { menu_code: 'home', parent_code: 'workspace', menu_name: '首页', menu_type: 'menu', resource_path: '/home' },
      ],
    });
    syncStoAppMenusMock.mockResolvedValue({ success: true, appCode: 'app_1', data: {} });
  });

  it('renders a nested tree and lets the user rename before sync', async () => {
    render(
      <StoAppMenuPublishDialog
        open
        workspaceId="ws-1"
        appName="示例站点"
        pageType="site"
        onClose={vi.fn()}
      />,
    );

    const nameInput = await screen.findByLabelText('菜单名称 home');
    expect(nameInput).toHaveValue('首页');
    fireEvent.change(nameInput, { target: { value: '欢迎页' } });

    fireEvent.click(screen.getByRole('button', { name: '确认同步' }));
    await waitFor(() => expect(syncStoAppMenusMock).toHaveBeenCalledTimes(1));
    expect(syncStoAppMenusMock.mock.calls[0]?.[0].menus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          menu_code: 'home',
          menu_name: '欢迎页',
          parent_code: 'workspace',
          menu_type: 'page',
        }),
      ]),
    );
  });
});
