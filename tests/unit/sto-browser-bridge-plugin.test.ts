import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

import register from '../../sto-plugin/openclaw/sto-browser-bridge/index.js';

describe('sto-browser-bridge plugin', () => {
  const registerTool = vi.fn();
  const on = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  function buildApi() {
    return {
      pluginConfig: {
        hostApiHost: '127.0.0.1',
        hostApiPort: 3210,
        commandTimeoutMs: 5000,
      },
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      registerTool,
      on,
    };
  }

  it('registers eleven bridge tools and before_prompt_build', () => {
    register.register(buildApi() as never);
    expect(registerTool).toHaveBeenCalledTimes(11);
    expect(on).toHaveBeenCalledWith('before_prompt_build', expect.any(Function));
  });

  it('bridge_list_sessions calls host api sessions endpoint', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessions: [{ sessionId: 's1', tabId: 1, url: 'https://a', title: 'A' }] }),
    });
    register.register(buildApi() as never);
    const listTool = registerTool.mock.calls.find((call) => call[0]?.id === 'bridge_list_sessions');
    expect(listTool).toBeTruthy();
    const result = await listTool![0].execute('tc-1', {});
    expect(result.content?.[0]?.text).toContain('s1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/api/browser-bridge/sessions',
      undefined,
    );
  });
});
