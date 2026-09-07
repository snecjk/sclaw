// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessage, sendMessageWithMedia, runMainChatSend } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  sendMessageWithMedia: vi.fn(),
  runMainChatSend: vi.fn(),
}));

vi.mock('../../electron/engines/manager', () => ({
  getAdapterForSession: vi.fn(async () => ({
    type: 'pi',
    prepareMemoryInjection: (params: unknown) => params,
    sendMessage,
    sendMessageWithMedia,
  })),
}));

vi.mock('../../electron/services/chat-send-service', () => ({ runMainChatSend }));
vi.mock('../../electron/utils/agent-config', () => ({
  listAgentsSnapshot: vi.fn(async () => ({ agents: [] })),
}));

import { submitModelTurn } from '../../electron/services/submit-model-turn';

describe('submitModelTurn', () => {
  beforeEach(() => {
    sendMessage.mockReset();
    sendMessageWithMedia.mockReset();
    runMainChatSend.mockReset();
  });

  it('does not enter runtime or call an adapter when attachment preflight fails', async () => {
    await expect(submitModelTurn({} as never, {
      sessionKey: 'pi:main:test',
      message: '查看文件',
      idempotencyKey: 'turn-1',
      composition: {
        version: 1,
        segments: [{ type: 'attachment', mediaIndex: 0, displayName: 'missing.xlsx' }],
      },
      media: [{
        filePath: 'Z:\\definitely-missing\\missing.xlsx',
        fileName: 'missing.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }],
    })).rejects.toThrow('MODEL_ATTACHMENT_UNAVAILABLE');

    expect(runMainChatSend).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(sendMessageWithMedia).not.toHaveBeenCalled();
  });
});
