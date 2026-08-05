import { beforeEach, describe, expect, it, vi } from 'vitest';

const memoryCenterFetchForSessionMock = vi.fn();

vi.mock('@electron/services/sto-memory-api-fetch', () => ({
  memoryCenterFetchForSession: (...args: unknown[]) => memoryCenterFetchForSessionMock(...args),
  StoMemoryApiError: class StoMemoryApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

import {
  adaptConnectorDescriptor,
  fetchConnectorCatalog,
} from '@electron/connectors/catalog-client';

const multilineUnicodePrompt = '帮我查询钉钉通讯录\n第二行：统计「研发部」人数\n完成率 100% ✅';

function baseServerItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'conn-dingtalk',
    name: '钉钉',
    description: '钉钉 CLI 描述',
    iconUrl: '',
    kind: 'managed_cli',
    order: 10,
    badge: '',
    minClientVersion: '',
    runtime: { binary: 'dws' },
    agent: { summary: '通讯录、发消息' },
    ...overrides,
  };
}

describe('connector catalog client', () => {
  beforeEach(() => memoryCenterFetchForSessionMock.mockReset());

  it('uses the authorized standalone connector catalog endpoint', async () => {
    memoryCenterFetchForSessionMock.mockResolvedValue({ success: true, data: [] });

    await expect(fetchConnectorCatalog()).resolves.toEqual([]);
    expect(memoryCenterFetchForSessionMock).toHaveBeenCalledWith('/agent/v1/connectors', {
      method: 'POST',
    });
  });

  it('adapts the trial prompt preserving multi-line Unicode verbatim', async () => {
    memoryCenterFetchForSessionMock.mockResolvedValue({
      success: true,
      data: [baseServerItem({ prompt: multilineUnicodePrompt })],
    });

    const catalog = await fetchConnectorCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0].prompt).toBe(multilineUnicodePrompt);
  });

  it('keeps the catalog usable when an older server omits prompt', async () => {
    memoryCenterFetchForSessionMock.mockResolvedValue({
      success: true,
      data: [baseServerItem()],
    });

    const catalog = await fetchConnectorCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0].id).toBe('conn-dingtalk');
    expect(catalog[0].prompt).toBeUndefined();
    // description / summary must never masquerade as the trial prompt
    expect(catalog[0].prompt).not.toBe(catalog[0].description);
    expect(catalog[0].prompt).not.toBe(catalog[0].agent.summary);
  });

  it('treats empty or whitespace-only prompt as absent', () => {
    expect(adaptConnectorDescriptor(baseServerItem({ prompt: '' }))?.prompt).toBeUndefined();
    expect(adaptConnectorDescriptor(baseServerItem({ prompt: '   \n\t ' }))?.prompt).toBeUndefined();
    expect(adaptConnectorDescriptor(baseServerItem({ prompt: 123 }))?.prompt).toBeUndefined();
  });

  it('trims outer whitespace but keeps inner newlines of the prompt', () => {
    const adapted = adaptConnectorDescriptor(baseServerItem({ prompt: `  ${multilineUnicodePrompt}  ` }));
    expect(adapted?.prompt).toBe(multilineUnicodePrompt);
  });
});
