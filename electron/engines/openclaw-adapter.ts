import { readFile } from 'node:fs/promises';
import type { EngineAdapter, EngineAdapterContext, EngineSendWithMediaParams, EngineSessionSummary } from './types';

const VISION_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/bmp',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/tiff',
]);

export const openClawAdapter: EngineAdapter = {
  type: 'openclaw',

  async listSessions(ctx: EngineAdapterContext) {
    try {
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('sessions.list', {});
      const sessions: EngineSessionSummary[] = Array.isArray(result.sessions)
        ? result.sessions
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
          .map((entry): EngineSessionSummary => ({
            key: typeof entry.key === 'string' ? entry.key : '',
            label: typeof entry.label === 'string' ? entry.label : undefined,
            displayName: typeof entry.displayName === 'string' ? entry.displayName : undefined,
            thinkingLevel: typeof entry.thinkingLevel === 'string' ? entry.thinkingLevel : undefined,
            model: typeof entry.model === 'string' ? entry.model : undefined,
            updatedAt: typeof entry.updatedAt === 'number' || typeof entry.updatedAt === 'string' ? entry.updatedAt : undefined,
            engineType: 'openclaw',
          }))
          .filter((entry) => Boolean(entry.key))
        : [];
      return { success: true, result: { sessions } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async getHistory(ctx: EngineAdapterContext, params: { sessionKey: string; limit: number }) {
    try {
      const result = await ctx.gatewayManager.rpc<Record<string, unknown>>('chat.history', {
        sessionKey: params.sessionKey,
        limit: params.limit,
      });
      return {
        success: true,
        result: {
          messages: Array.isArray(result.messages) ? result.messages : [],
          thinkingLevel: typeof result.thinkingLevel === 'string' ? result.thinkingLevel : null,
        },
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async sendMessage(ctx: EngineAdapterContext, params) {
    try {
      const result = await ctx.gatewayManager.rpc<{ runId?: string }>('chat.send', params, 120000);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async sendMessageWithMedia(ctx: EngineAdapterContext, params: EngineSendWithMediaParams) {
    try {
      let message = params.message;
      const imageAttachments: Array<Record<string, unknown>> = [];
      const fileReferences: string[] = [];

      for (const media of params.media ?? []) {
        fileReferences.push(`[media attached: ${media.filePath} (${media.mimeType}) | ${media.filePath}]`);
        if (VISION_MIME_TYPES.has(media.mimeType)) {
          const fileBuffer = await readFile(media.filePath);
          imageAttachments.push({
            content: fileBuffer.toString('base64'),
            mimeType: media.mimeType,
            fileName: media.fileName,
          });
        }
      }

      if (fileReferences.length > 0) {
        message = message ? `${message}\n\n${fileReferences.join('\n')}` : fileReferences.join('\n');
      }

      const rpcParams: Record<string, unknown> = {
        sessionKey: params.sessionKey,
        message,
        deliver: params.deliver ?? false,
        idempotencyKey: params.idempotencyKey,
      };

      if (imageAttachments.length > 0) {
        rpcParams.attachments = imageAttachments;
      }

      const result = await ctx.gatewayManager.rpc<{ runId?: string }>('chat.send', rpcParams, 120000);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async abortRun(ctx: EngineAdapterContext, params) {
    try {
      await ctx.gatewayManager.rpc('chat.abort', { sessionKey: params.sessionKey });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
};
