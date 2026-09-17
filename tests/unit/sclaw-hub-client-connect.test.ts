import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const socketState = vi.hoisted(() => ({ instances: [] as MockWebSocket[] }));

class MockWebSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  closeCalls = 0;

  constructor(readonly url: string) {
    super();
    socketState.instances.push(this);
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit('open');
  }

  close(): void {
    this.closeCalls += 1;
    if (this.readyState === MockWebSocket.CONNECTING) {
      queueMicrotask(() => {
        this.emit('error', new Error('WebSocket was closed before the connection was established'));
        this.readyState = MockWebSocket.CLOSED;
        this.emit('close');
      });
      return;
    }
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close');
  }

  send(): void {}
}

vi.mock('ws', () => ({ default: MockWebSocket }));
vi.mock('@electron/message-channel/hub/hub-config', () => ({
  resolveSclawHubWsUrl: (token: string) => `wss://hub.example.test/ws/sclaw?refreshToken=${token}`,
}));
vi.mock('@electron/message-channel/hub/binding-service', () => ({ touchSharedHubOnline: vi.fn() }));
vi.mock('@electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('SclawHubClient connection concurrency', () => {
  beforeEach(() => {
    socketState.instances.length = 0;
  });

  it('shares one connecting socket for concurrent calls with the same token', async () => {
    const { SclawHubClient } = await import('@electron/message-channel/hub/hub-client');
    const client = new SclawHubClient();

    const first = client.connect('same-token');
    const second = client.connect('same-token');

    expect(socketState.instances).toHaveLength(1);
    socketState.instances[0].open();
    await Promise.all([first, second]);
    expect(socketState.instances[0].closeCalls).toBe(0);
  });

  it('keeps the old error listener while replacing a connecting socket', async () => {
    const { SclawHubClient } = await import('@electron/message-channel/hub/hub-client');
    const client = new SclawHubClient();

    const oldAttempt = client.connect('old-token').catch((error: Error) => error);
    const newAttempt = client.connect('new-token');

    expect(socketState.instances).toHaveLength(2);
    expect(socketState.instances[0].closeCalls).toBe(1);
    socketState.instances[1].open();

    const oldResult = await oldAttempt;
    await newAttempt;
    expect(oldResult).toBeInstanceOf(Error);
    expect(client.getStatus().connected).toBe(true);
  });
});
