import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}));

describe('session-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requestSessionDelete returns success when API succeeds', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ success: true });
    const { requestSessionDelete } = await import('@/lib/session-delete');

    const result = await requestSessionDelete('agent:main:main', 'openclaw');
    expect(result).toEqual({ success: true });
  });

  it('requestSessionDelete returns API error message when API reports failure', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ success: false, error: 'not found' });
    const { requestSessionDelete } = await import('@/lib/session-delete');

    const result = await requestSessionDelete('agent:main:main', 'openclaw');
    expect(result).toEqual({ success: false, error: 'not found' });
  });

  it('notifySessionDeleteFailed shows toast with API error', async () => {
    const { notifySessionDeleteFailed } = await import('@/lib/session-delete');

    notifySessionDeleteFailed('disk busy');
    expect(toastErrorMock).toHaveBeenCalledWith('common:sidebar.deleteSessionFailed', {
      description: 'disk busy',
    });
  });
});
