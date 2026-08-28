import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  webContents: {
    fromId: () => ({
      isDestroyed: () => false,
      getURL: () => 'https://wd-vip-test.sto.cn/sclaw/clawQuotation',
      on: vi.fn(),
      send: vi.fn(),
    }),
  },
}));

import { JSBRIDGE_HOST_ACTION_MARKER } from '../../shared/jsbridge/host-actions';
import { JSBRIDGE_PROTOCOL, JSBRIDGE_VERSION, type BridgeRequest } from '../../shared/jsbridge/protocol';
import { createBridgeSession } from '../../electron/main/services/jsbridge/session-registry';
import {
  handleChatFillComposer,
  handleChatOpenSession,
  handleChatSendMessage,
} from '../../electron/main/services/jsbridge/handlers/chat';

function makeRequest(sessionId: string, method: string, params?: unknown): BridgeRequest {
  return {
    protocol: JSBRIDGE_PROTOCOL,
    version: JSBRIDGE_VERSION,
    type: 'request',
    id: `req-${method}`,
    sessionId,
    method,
    params,
    timestamp: Date.now(),
  };
}

describe('jsbridge chat handlers', () => {
  const session = createBridgeSession({
    runtimeId: 'rt-chat-segments',
    webContentsId: 401,
    pageUrl: 'https://wd-vip-test.sto.cn/sclaw/clawQuotation',
    appId: 'vip',
    bound: true,
  });

  it('creates a session for handler tests', () => {
    expect(session).toBeTruthy();
  });

  it('openSession forwards skill/workflow segments', async () => {
    const envelope = await handleChatOpenSession({
      session: session!,
      request: makeRequest(session!.sessionId, 'chat.openSession', {
        target: 'embed',
        title: '报价助手',
        send: true,
        segments: [
          { type: 'skill', slug: 'quote-assistant' },
          { type: 'text', text: '帮我新建一个报价' },
        ],
      }),
    }) as { [key: string]: unknown; action: Record<string, unknown> };

    expect(envelope[JSBRIDGE_HOST_ACTION_MARKER]).toBe(true);
    expect(envelope.action).toMatchObject({
      type: 'chat.openSession',
      target: 'embed',
      title: '报价助手',
      send: true,
      text: '帮我新建一个报价',
      segments: [
        { type: 'skill', slug: 'quote-assistant' },
        { type: 'text', text: '帮我新建一个报价' },
      ],
      runtimeId: 'rt-chat-segments',
    });
  });

  it('openSession still allows empty new sessions', async () => {
    const envelope = await handleChatOpenSession({
      session: session!,
      request: makeRequest(session!.sessionId, 'chat.openSession', {
        target: 'main',
        title: '空白会话',
      }),
    }) as { action: Record<string, unknown> };

    expect(envelope.action).toMatchObject({
      type: 'chat.openSession',
      target: 'main',
      title: '空白会话',
      send: false,
    });
    expect(envelope.action.segments).toBeUndefined();
  });

  it('sendMessage accepts segments without text', async () => {
    const envelope = await handleChatSendMessage({
      session: session!,
      request: makeRequest(session!.sessionId, 'chat.sendMessage', {
        target: 'embed',
        segments: [
          { type: 'skill', slug: 'quote-assistant' },
          { type: 'text', text: '提交这张报价单' },
        ],
      }),
    }) as { action: Record<string, unknown> };

    expect(envelope.action).toMatchObject({
      type: 'chat.fillComposer',
      send: true,
      text: '提交这张报价单',
      segments: [
        { type: 'skill', slug: 'quote-assistant' },
        { type: 'text', text: '提交这张报价单' },
      ],
    });
  });

  it('sendMessage keeps text-only compatibility', async () => {
    const envelope = await handleChatSendMessage({
      session: session!,
      request: makeRequest(session!.sessionId, 'chat.sendMessage', {
        text: '开始执行',
        target: 'main',
      }),
    }) as { action: Record<string, unknown> };

    expect(envelope.action).toMatchObject({
      type: 'chat.fillComposer',
      send: true,
      target: 'main',
      text: '开始执行',
      segments: [{ type: 'text', text: '开始执行' }],
    });
  });

  it('sendMessage rejects empty payload', async () => {
    await expect(handleChatSendMessage({
      session: session!,
      request: makeRequest(session!.sessionId, 'chat.sendMessage', {}),
    })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('fillComposer still prefers segments over text', async () => {
    const envelope = await handleChatFillComposer({
      session: session!,
      request: makeRequest(session!.sessionId, 'chat.fillComposer', {
        text: 'ignored',
        segments: [{ type: 'workflow', id: 'wf_1', name: '报价流程' }],
      }),
    }) as { action: Record<string, unknown> };

    expect(envelope.action).toMatchObject({
      type: 'chat.fillComposer',
      text: '报价流程',
      segments: [{ type: 'workflow', id: 'wf_1', name: '报价流程' }],
    });
  });
});
