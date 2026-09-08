import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyAwareFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch: (...args: unknown[]) => proxyAwareFetchMock(...args),
}));

vi.mock('@electron/utils/auth-store', () => ({
  getStoToken: vi.fn().mockResolvedValue('test-token'),
}));

vi.mock('@electron/utils/sto-memory-api-auth', () => ({
  buildStoMemoryCenterAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
}));

vi.mock('@electron/utils/sto-domain', () => ({
  resolveStoBaseUrl: vi.fn().mockResolvedValue('https://memory.example.com'),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { SkillRoutingRemoteService } from '@electron/services/skills/skill-routing-remote-service';

describe('SkillRoutingRemoteService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls the server-side hybrid routing endpoint', async () => {
    proxyAwareFetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        items: [
          { slug: 'pdf', score: 0.03, sourceHash: 'hash', reasons: ['bm25', 'embedding'] },
        ],
        degraded: false,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const service = new SkillRoutingRemoteService();

    const result = await service.search({
      query: 'export workbook to pdf',
      engine: 'pi',
      mode: 'interactive',
    });
    expect(result.items.map((item) => item.slug)).toEqual(['pdf']);
    expect(result.items[0].reasons).toEqual(['bm25', 'embedding']);
    expect(result.degraded).toBe(false);
    expect(proxyAwareFetchMock.mock.calls[0]?.[0]).toBe(
      'https://memory.example.com/agent/v1/skill-routing/search',
    );
  });

  it('upserts routing cards through the catalog endpoint', async () => {
    proxyAwareFetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { accepted: 1, indexedVariants: 4, keywordIndexed: true },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const service = new SkillRoutingRemoteService();

    await expect(service.upsertCards([{
      slug: 'pdf',
      sourceHash: 'hash',
      engines: ['claude', 'pi'],
    }])).resolves.toMatchObject({ accepted: 1, indexedVariants: 4 });
    expect(proxyAwareFetchMock.mock.calls[0]?.[0]).toBe(
      'https://memory.example.com/agent/v1/skill-routing/cards/upsert',
    );
    const init = proxyAwareFetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ cards: [{ slug: 'pdf' }] });
  });
});
