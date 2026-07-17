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
});
