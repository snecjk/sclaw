import type { IncomingMessage, ServerResponse } from 'http';
import { PORTS } from '../../utils/config';
import { buildOpenClawControlUiUrl } from '../../utils/openclaw-control-ui';
import { getSetting } from '../../utils/store';
import { getStoToken } from '../../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../../utils/sto-domain';
import { listAgentsSnapshot } from '../../utils/agent-config';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { getAdapterForSession, listEngineSessions } from '../../engines/manager';
import type { AgentEngineType } from '../../engines/types';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { preprocessChatSendParams } from '../../utils/dingtalk-mention-send';

export async function handleGatewayRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  const parseEngineType = (value: string | null | undefined): AgentEngineType | undefined => (
    value === 'claude' || value === 'openclaw' ? value : undefined
  );
  const BIZ_AGENT_TEMP_UPLOAD_PATH = '/agent/v1/biz-agent/attachments/upload';
  const getAgentIdFromSessionKey = (sessionKey: string): string => {
    if (!sessionKey.startsWith('agent:')) return 'main';
    const [, agentId] = sessionKey.split(':');
    return (agentId || 'main').trim().toLowerCase();
  };
  const shouldTransformAttachmentsByOSS = async (sessionKey: string): Promise<boolean> => {
    const snapshot = await listAgentsSnapshot();
    const agentId = getAgentIdFromSessionKey(sessionKey);
    const agent = snapshot.agents.find((entry) => entry.id.trim().toLowerCase() === agentId);
    return agent?.fileTransformByOSS === true;
  };
  const uploadMediaToTempOSS = async (filePath: string, fileName: string): Promise<string> => {
    const token = await getStoToken();
    if (!token) {
      throw new Error('stoToken is missing, cannot upload media to OSS');
    }
    const fsP = await import('node:fs/promises');
    const fileBuffer = await fsP.readFile(filePath);
    const formData = new (globalThis as { FormData: new () => any }).FormData();
    const BlobCtor = (globalThis as { Blob: new (parts: Array<Buffer>) => any }).Blob;
    formData.append('file', new BlobCtor([fileBuffer]), fileName);
    const baseUrl = await resolveStoBaseUrl();
    const resp = await proxyAwareFetch(`${baseUrl}${BIZ_AGENT_TEMP_UPLOAD_PATH}`, {
      method: 'POST',
      headers: buildStoMemoryCenterAuthHeaders(token),
      body: formData,
    });
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => '');
      throw new Error(`temp OSS upload failed: ${resp.status} ${bodyText}`);
    }
    const payload = await resp.json() as { success?: boolean; data?: { url?: string }; url?: string };
    const url = payload.data?.url || payload.url;
    if (!url) {
      throw new Error('temp OSS upload response missing url');
    }
    return url;
  };

  if (url.pathname === '/api/app/gateway-info' && req.method === 'GET') {
    const status = ctx.gatewayManager.getStatus();
    const token = await getSetting('gatewayToken');
    const port = status.port || PORTS.OPENCLAW_GATEWAY;
    sendJson(res, 200, {
      wsUrl: `ws://127.0.0.1:${port}/ws`,
      token,
      port,
    });
    return true;
  }

  if (url.pathname === '/api/gateway/status' && req.method === 'GET') {
    sendJson(res, 200, ctx.gatewayManager.getStatus());
    return true;
  }

  if (url.pathname === '/api/gateway/health' && req.method === 'GET') {
    const health = await ctx.gatewayManager.checkHealth();
    sendJson(res, 200, health);
    return true;
  }

  if (url.pathname === '/api/gateway/start' && req.method === 'POST') {
    try {
      await ctx.gatewayManager.start();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/gateway/stop' && req.method === 'POST') {
    try {
      await ctx.gatewayManager.stop();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/gateway/restart' && req.method === 'POST') {
    try {
      await ctx.gatewayManager.restart();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/gateway/control-ui' && req.method === 'GET') {
    try {
      const status = ctx.gatewayManager.getStatus();
      const token = await getSetting('gatewayToken');
      const port = status.port || PORTS.OPENCLAW_GATEWAY;
      const urlValue = buildOpenClawControlUiUrl(port, token);
      sendJson(res, 200, { success: true, url: urlValue, token, port });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/chat/sessions' && req.method === 'GET') {
    try {
      const sessions = await listEngineSessions({ gatewayManager: ctx.gatewayManager });
      sendJson(res, 200, { success: true, sessions });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/chat/history' && req.method === 'GET') {
    try {
      const sessionKey = (url.searchParams.get('sessionKey') ?? '').trim();
      const limit = Number(url.searchParams.get('limit') ?? '1000');
      if (!sessionKey) {
        sendJson(res, 400, { success: false, error: 'sessionKey is required' });
        return true;
      }
      const adapter = await getAdapterForSession(sessionKey, parseEngineType(url.searchParams.get('engineType')));
      const result = await adapter.getHistory(
        { gatewayManager: ctx.gatewayManager },
        { sessionKey, limit: Number.isFinite(limit) && limit > 0 ? limit : 1000 },
      );
      if (!result.success) {
        sendJson(res, 500, result);
        return true;
      }
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/chat/send' && req.method === 'POST') {
    try {
      const rawBody = await parseJsonBody<{
        sessionKey: string;
        message: string;
        deliver?: boolean;
        idempotencyKey: string;
        engineType?: AgentEngineType;
        dingTalkMentions?: Array<{
          type: 'user' | 'group';
          displayName: string;
          userId?: string;
          openConversationId?: string;
          corpId?: string;
        }>;
        dingTalkSendFileIntent?: boolean;
        dingTalkAttachedFiles?: Array<{
          fileName: string;
          filePath: string;
          mimeType: string;
          fileSize?: number;
        }>;
      }>(req);
      const body = await preprocessChatSendParams(rawBody) as typeof rawBody;
      const adapter = await getAdapterForSession(body.sessionKey, parseEngineType(body.engineType));
      const result = await adapter.sendMessage(
        { gatewayManager: ctx.gatewayManager },
        {
          sessionKey: body.sessionKey,
          message: body.message,
          deliver: body.deliver,
          idempotencyKey: body.idempotencyKey,
        },
      );
      if (!result.success) {
        sendJson(res, 500, result);
        return true;
      }
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/chat/abort' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKey: string; engineType?: AgentEngineType }>(req);
      const adapter = await getAdapterForSession(body.sessionKey, parseEngineType(body.engineType));
      const result = await adapter.abortRun(
        { gatewayManager: ctx.gatewayManager },
        { sessionKey: body.sessionKey },
      );
      if (!result.success) {
        sendJson(res, 500, result);
        return true;
      }
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/chat/send-with-media' && req.method === 'POST') {
    try {
      const rawBody = await parseJsonBody<{
        sessionKey: string;
        message: string;
        deliver?: boolean;
        idempotencyKey: string;
        engineType?: AgentEngineType;
        media?: Array<{ filePath: string; mimeType: string; fileName: string }>;
        dingTalkMentions?: Array<{
          type: 'user' | 'group';
          displayName: string;
          userId?: string;
          openConversationId?: string;
          corpId?: string;
        }>;
        dingTalkSendFileIntent?: boolean;
        dingTalkAttachedFiles?: Array<{
          fileName: string;
          filePath: string;
          mimeType: string;
          fileSize?: number;
        }>;
      }>(req);
      const body = await preprocessChatSendParams(rawBody) as typeof rawBody;
      const VISION_MIME_TYPES = new Set([
        // Static images
        'image/png', 'image/jpeg', 'image/bmp', 'image/webp',
        // Animated images
        'image/gif',
        // Modern image formats
        'image/avif', 'image/heic', 'image/heif', 'image/tiff',
      ]);
      const imageAttachments: Array<{ content: string; mimeType: string; fileName: string }> = [];
      const fileReferences: string[] = [];
      const transformByOSS = await shouldTransformAttachmentsByOSS(body.sessionKey);
      const adapter = await getAdapterForSession(body.sessionKey, parseEngineType(body.engineType));
      if (adapter.type !== 'openclaw') {
        const result = await adapter.sendMessageWithMedia(
          { gatewayManager: ctx.gatewayManager },
          {
            sessionKey: body.sessionKey,
            message: body.message,
            deliver: body.deliver,
            idempotencyKey: body.idempotencyKey,
            media: body.media,
          },
        );
        if (!result.success) {
          sendJson(res, 500, result);
          return true;
        }
        sendJson(res, 200, result);
        return true;
      }
      if (body.media && body.media.length > 0) {
        const fsP = await import('node:fs/promises');
        for (const m of body.media) {
          if (transformByOSS) {
            const ossTempUrl = await uploadMediaToTempOSS(m.filePath, m.fileName);
            fileReferences.push(`[media attached: ${ossTempUrl} (${m.mimeType}) | ${ossTempUrl}]`);
            continue;
          }
          fileReferences.push(`[media attached: ${m.filePath} (${m.mimeType}) | ${m.filePath}]`);
          if (VISION_MIME_TYPES.has(m.mimeType)) {
            const fileBuffer = await fsP.readFile(m.filePath);
            imageAttachments.push({
              content: fileBuffer.toString('base64'),
              mimeType: m.mimeType,
              fileName: m.fileName,
            });
          }
        }
      }

      const message = fileReferences.length > 0
        ? [body.message, ...fileReferences].filter(Boolean).join('\n')
        : body.message;
      const rpcParams: Record<string, unknown> = {
        sessionKey: body.sessionKey,
        message,
        deliver: body.deliver ?? false,
        idempotencyKey: body.idempotencyKey,
      };
      if (imageAttachments.length > 0) {
        rpcParams.attachments = imageAttachments;
      }
      if (body.dingTalkMentions?.length) {
        rpcParams.dingTalkMentions = body.dingTalkMentions;
      }
      if (body.dingTalkSendFileIntent) {
        rpcParams.dingTalkSendFileIntent = body.dingTalkSendFileIntent;
      }
      if (body.dingTalkAttachedFiles?.length) {
        rpcParams.dingTalkAttachedFiles = body.dingTalkAttachedFiles;
      }
      const result = await adapter.sendMessage(
        { gatewayManager: ctx.gatewayManager },
        rpcParams as { sessionKey: string; message: string; deliver?: boolean; idempotencyKey: string },
      );
      if (!result.success) {
        sendJson(res, 500, result);
        return true;
      }
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
