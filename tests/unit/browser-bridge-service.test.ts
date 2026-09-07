import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock('../../electron/utils/browser-bridge-extension', () => ({
  getBundledBrowserBridgeExtensionVersion: () => '1.0.0',
}));

vi.mock('../../electron/utils/paths', () => ({
  getOpenClawConfigDir: () => '/tmp/stoclaw-browser-bridge-test',
}));

import { BrowserBridgeService } from '../../electron/services/browser-bridge-service';

describe('BrowserBridgeService', () => {
  let service: BrowserBridgeService;

  beforeEach(() => {
    service = new BrowserBridgeService();
  });

  it('pairs with valid code and rejects invalid code', () => {
    const { code } = service.refreshPairingCode();
    const paired = service.pairWithCode(code);
    expect(paired?.token).toBeTruthy();
    expect(service.pairWithCode('000000')).toBeNull();
  });

  it('auto-connect issues token when enabled and rejects when disabled', () => {
    service.setAutoConnectEnabled(true);
    expect(service.getSettings().autoConnectEnabled).toBe(true);
    const paired = service.autoConnect('1.0.0');
    expect(paired?.token).toBeTruthy();

    service.setAutoConnectEnabled(false);
    expect(service.autoConnect('1.0.0')).toBeNull();
    expect(service.getSettings().installedExtensionVersion).toBe('1.0.0');
  });

  it('keeps pairing code until refresh or successful pair', () => {
    const first = service.refreshPairingCode();
    expect(service.getPairingCode()?.code).toBe(first.code);

    const second = service.refreshPairingCode();
    expect(second.code).not.toBe(first.code);
    expect(service.getPairingCode()?.code).toBe(second.code);
  });

  it('connects session and enqueues command', () => {
    const { code } = service.refreshPairingCode();
    const { token } = service.pairWithCode(code)!;
    const session = service.connectSession({
      sessionId: 'sess-1',
      tabId: 1,
      url: 'https://example.com',
      title: 'Example',
      token,
    });
    expect(session.sessionId).toBe('sess-1');

    const command = service.enqueueCommand('sess-1', 'snapshot');
    expect(command?.action).toBe('snapshot');

    const polled = service.pollCommands('sess-1');
    expect(polled).toHaveLength(1);
    expect(service.pollCommands('sess-1')).toHaveLength(0);
    expect(service.pollCommands('missing-session')).toBeNull();
  });

  it('waitForCommands returns queued work as soon as it is enqueued', async () => {
    const { code } = service.refreshPairingCode();
    const { token } = service.pairWithCode(code)!;
    service.connectSession({
      sessionId: 'sess-wait',
      tabId: 8,
      url: 'https://example.com',
      title: 'Example',
      token,
    });
    const pending = service.waitForCommands('sess-wait', 5_000);
    const command = service.enqueueCommand('sess-wait', 'navigate', { url: 'https://www.baidu.com' });
    expect(command?.action).toBe('navigate');
    await expect(pending).resolves.toEqual([command]);
  });

  it('stores and retrieves command result', () => {
    const { code } = service.refreshPairingCode();
    const { token } = service.pairWithCode(code)!;
    service.connectSession({
      sessionId: 'sess-2',
      tabId: 2,
      url: 'https://example.com',
      title: 'Example',
      token,
    });
    const command = service.enqueueCommand('sess-2', 'click', { ref: '@e1' });
    service.storeResult({
      sessionId: 'sess-2',
      commandId: command!.commandId,
      action: 'click',
      result: { success: true },
    });
    const result = service.getResult(command!.commandId);
    expect(result?.result).toEqual({ success: true });
  });

  it('defaults extension sessions to borrowed and embed to owned', () => {
    const { code } = service.refreshPairingCode();
    const { token } = service.pairWithCode(code)!;
    const extension = service.connectSession({
      sessionId: 'ext-1',
      tabId: 3,
      url: 'https://example.com',
      title: 'Example',
      token,
    });
    expect(extension.ownership).toBe('borrowed');

    const embed = service.connectEmbedSession({
      sessionId: 'embed-rt',
      embedRuntimeId: 'rt',
      url: 'https://app.example',
      title: 'App',
    });
    expect(embed.ownership).toBe('owned');
    const listed = service.listActiveSessions();
    expect(listed[0]?.sessionId).toBe('ext-1');
    expect(service.getPrimarySession()?.sessionId).toBe('embed-rt');
    expect(service.listSessionsByGroup('g1')).toEqual([]);
    service.connectSession({
      sessionId: 'ext-g',
      tabId: 4,
      url: 'https://example.com',
      title: 'Grouped',
      token,
      groupId: 'g1',
    });
    expect(service.listSessionsByGroup('g1')).toHaveLength(1);
    const replaced = service.connectSession({
      sessionId: 'ext-3',
      tabId: 3,
      url: 'https://example.com/next',
      title: 'Next',
      token,
    });
    expect(replaced.sessionId).toBe('ext-3');
    expect(service.getSession('ext-1')).toBeNull();
    expect(service.getSession('ext-3')?.tabId).toBe(3);
  });

  it('keeps rotated tokens valid during grace then drops them', () => {
    const { code } = service.refreshPairingCode();
    const { token } = service.pairWithCode(code)!;
    expect(service.validateToken(token)).toBe(true);
    service.rotateTokens({ keepGraceMs: 30_000 });
    expect(service.validateToken(token)).toBe(true);
    service.revokeAllTokens();
    expect(service.validateToken(token)).toBe(false);
  });

  it('caps stored command results at 1000', () => {
    const { code } = service.refreshPairingCode();
    const { token } = service.pairWithCode(code)!;
    service.connectSession({
      sessionId: 'sess-cap',
      tabId: 9,
      url: 'https://example.com',
      title: 'Cap',
      token,
    });
    const first = service.enqueueCommand('sess-cap', 'snapshot')!;
    service.storeResult({
      sessionId: 'sess-cap',
      commandId: first.commandId,
      action: 'snapshot',
      result: { n: 0 },
    });
    for (let index = 1; index <= 1000; index += 1) {
      const command = service.enqueueCommand('sess-cap', 'snapshot')!;
      service.storeResult({
        sessionId: 'sess-cap',
        commandId: command.commandId,
        action: 'snapshot',
        result: { n: index },
      });
    }
    expect(service.getResult(first.commandId)).toBeNull();
  });

  it('rejects auto-connect when extension major version mismatches', () => {
    service.setAutoConnectEnabled(true);
    expect(service.autoConnect('2.0.0')).toBeNull();
    expect(service.checkExtensionCompatibility('1.2.0').compatible).toBe(true);
    expect(service.autoConnect('1.0.0')?.token).toBeTruthy();
  });

  it('resurrects a pruned Chrome tab session on heartbeat with the same sessionId', () => {
    const revived = service.heartbeat('ext-464165454', {
      url: 'https://example.com',
      title: 'Example',
    }, 'tok');
    expect(revived?.sessionId).toBe('ext-464165454');
    expect(revived?.tabId).toBe(464165454);
    expect(revived?.source).toBe('extension');
    expect(service.getSession('ext-464165454')?.url).toBe('https://example.com');
  });

  it('finds a replacement session by chrome tab id after the old id is gone', () => {
    const { code } = service.refreshPairingCode();
    const { token } = service.pairWithCode(code)!;
    service.connectSession({
      sessionId: 'ext-12',
      tabId: 12,
      url: 'https://example.com',
      title: 'Live',
      token,
    });
    expect(service.findReplacementSession('ext-12-deadbeef')?.sessionId).toBe('ext-12');
    expect(service.findReplacementSession('missing')?.sessionId).toBe('ext-12');
  });
});
