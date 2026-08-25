import { hostApiFetch } from '@/lib/host-api';
import { logChatFlow } from './chat-flow-log';
import type { ChatSession } from './types';

export interface ChatSendAttachment {
  stagedPath: string;
  mimeType: string;
  fileName: string;
}

export interface DispatchChatRequestInput {
  sessionKey: string;
  message: string;
  sourceText?: string;
  idempotencyKey: string;
  engineType?: ChatSession['engineType'];
  systemPromptAppend?: string;
  attachments?: ChatSendAttachment[];
  extras?: Record<string, unknown>;
}

export interface DispatchChatRequestResult {
  success: boolean;
  result?: { runId?: string };
  error?: string;
}

export async function dispatchChatRequest(
  input: DispatchChatRequestInput,
): Promise<DispatchChatRequestResult> {
  const hasMedia = Boolean(input.attachments?.length);
  logChatFlow('dispatch.request', {
    path: '/api/chat/send',
    sessionKey: input.sessionKey,
    engineType: input.engineType,
    idempotencyKey: input.idempotencyKey,
    messageLength: input.message.length,
    mediaCount: input.attachments?.length ?? 0,
    hasSystemPromptAppend: Boolean(input.systemPromptAppend),
    extraKeys: input.extras ? Object.keys(input.extras) : [],
  });
  // `[USER-SEND]` 在主进程最终出口打印（含 memory / systemPromptAppend / media 拼装后的正文）

  return hostApiFetch<DispatchChatRequestResult>(
    '/api/chat/send',
    {
      method: 'POST',
      body: JSON.stringify({
        sessionKey: input.sessionKey,
        message: input.message,
        sourceText: input.sourceText,
        deliver: false,
        idempotencyKey: input.idempotencyKey,
        systemPromptAppend: input.systemPromptAppend,
        engineType: input.engineType,
        ...(hasMedia && input.attachments ? {
          media: input.attachments.map((attachment) => ({
            filePath: attachment.stagedPath,
            mimeType: attachment.mimeType,
            fileName: attachment.fileName,
          })),
        } : {}),
        ...input.extras,
      }),
    },
  );
}
