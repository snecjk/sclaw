import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

import { hostApiFetch } from '@/lib/host-api';
import { dispatchChatRequest } from '@/stores/chat/dispatch-chat-request';

describe('dispatchChatRequest', () => {
  beforeEach(() => {
    vi.mocked(hostApiFetch).mockReset();
    vi.mocked(hostApiFetch).mockResolvedValue({ success: true, result: { runId: 'run-1' } });
  });

  it('sends text through the unified chat send endpoint', async () => {
    await dispatchChatRequest({
      sessionKey: 'agent:main:main',
      message: 'hello',
      idempotencyKey: 'msg-1',
      engineType: 'openclaw',
    });

    expect(hostApiFetch).toHaveBeenCalledWith('/api/chat/send', expect.objectContaining({
      method: 'POST',
      body: expect.any(String),
    }));
    const body = JSON.parse(String(vi.mocked(hostApiFetch).mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      sessionKey: 'agent:main:main',
      message: 'hello',
      deliver: false,
      idempotencyKey: 'msg-1',
      engineType: 'openclaw',
    });
    expect(body.media).toBeUndefined();
  });

  it('maps staged attachments to media payloads and preserves extras', async () => {
    await dispatchChatRequest({
      sessionKey: 'agent:main:main',
      message: 'see file',
      idempotencyKey: 'msg-2',
      engineType: 'claude',
      systemPromptAppend: 'memory',
      attachments: [{
        stagedPath: 'C:/tmp/a.png',
        mimeType: 'image/png',
        fileName: 'a.png',
      }],
      extras: {
        dingTalkSendFileIntent: true,
      },
    });

    const body = JSON.parse(String(vi.mocked(hostApiFetch).mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      engineType: 'claude',
      systemPromptAppend: 'memory',
      dingTalkSendFileIntent: true,
      media: [{
        filePath: 'C:/tmp/a.png',
        mimeType: 'image/png',
        fileName: 'a.png',
      }],
    });
  });
});
