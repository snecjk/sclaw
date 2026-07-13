import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSclawBrowserUrl } from '@/lib/open-sclaw-browser';

vi.mock('@/lib/workflow-api', () => ({
  getWorkflowStoToken: vi.fn(),
}));

import { getWorkflowStoToken } from '@/lib/workflow-api';

const mockedGetWorkflowStoToken = vi.mocked(getWorkflowStoToken);

describe('resolveSclawBrowserUrl', () => {
  beforeEach(() => {
    mockedGetWorkflowStoToken.mockReset();
  });

  it('replaces useStoToken=1 with stotoken when local token exists', () => {
    mockedGetWorkflowStoToken.mockReturnValue('tok-local-abc');
    expect(resolveSclawBrowserUrl('https://example.com/app?useStoToken=1&foo=bar')).toBe(
      'https://example.com/app?foo=bar&stotoken=tok-local-abc',
    );
  });

  it('removes useStoToken=1 when no local token is available', () => {
    mockedGetWorkflowStoToken.mockReturnValue(undefined);
    expect(resolveSclawBrowserUrl('https://example.com/app?useStoToken=1')).toBe(
      'https://example.com/app',
    );
  });

  it('leaves url unchanged when useStoToken is not 1', () => {
    mockedGetWorkflowStoToken.mockReturnValue('tok-local-abc');
    const url = 'https://example.com/app?useStoToken=0&stotoken=keep';
    expect(resolveSclawBrowserUrl(url)).toBe(url);
  });

  it('supports relative urls with useStoToken=1', () => {
    mockedGetWorkflowStoToken.mockReturnValue('tok-relative');
    expect(resolveSclawBrowserUrl('customer-quote.html?useStoToken=1')).toBe(
      'customer-quote.html?stotoken=tok-relative',
    );
  });
});
