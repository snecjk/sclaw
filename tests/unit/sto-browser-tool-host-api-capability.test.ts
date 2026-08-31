import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoBrowserBridgePortError } from '../../electron/agent-extensions/extensions/sto-browser-tool/capability';
import { createHostApiBrowserBridgePort } from '../../electron/agent-extensions/extensions/sto-browser-tool/host-api-capability';

describe('sto-browser-tool Host API capability', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists sessions, submits a command, and polls its result', async () => {
    let resultPolls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/browser-bridge/sessions')) {
        return { ok: true, json: async () => ({ sessions: [{
          sessionId: 'chrome-1', tabId: 1, url: 'https://example.com', title: 'Example',
        }] }) };
      }
      if (url.endsWith('/api/browser-bridge/command')) {
        return { ok: true, json: async () => ({ commandId: 'cmd-1' }) };
      }
      resultPolls += 1;
      return { ok: true, json: async () => resultPolls === 1
        ? { ready: false }
        : { ready: true, result: { result: { clicked: true } } } };
    });
    vi.stubGlobal('fetch', fetchMock);

    const port = createHostApiBrowserBridgePort();
    await expect(port.listSessions()).resolves.toHaveLength(1);
    await expect(port.runCommand({
      sessionId: 'chrome-1', action: 'click', payload: { name: '菜单' },
    })).resolves.toEqual({ clicked: true });
    expect(resultPolls).toBe(2);
  });

  it('maps cancellation to a controlled error code', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await createHostApiBrowserBridgePort()
      .listSessions(controller.signal)
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(StoBrowserBridgePortError);
    expect(error).toMatchObject({ code: 'BROWSER_COMMAND_ABORTED' });
  });
});
