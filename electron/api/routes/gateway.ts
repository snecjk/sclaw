import type { IncomingMessage, ServerResponse } from 'http';
import { PORTS } from '../../utils/config';
import { buildOpenClawControlUiUrl } from '../../utils/openclaw-control-ui';
import { getSetting } from '../../utils/store';
import { getAdapterForSession, listEngineSessions } from '../../engines/manager';
import type { AgentEngineType, EnginePermissionProfile } from '../../engines/types';
import type { ChatRuntimePolicy } from '../../../shared/chat-runtime-protocol';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { preprocessChatSendParams } from '../../utils/dingtalk-mention-send';
import { sanitizeMemoryFromChatPayload } from '../../../shared/agent-memory-display';
import { getMemoryTurnCoordinator } from '../../services/memory-turn-coordinator';
import { getChatRuntimeSupervisor } from '../../services/chat-runtime-supervisor';
import type { ModelMessageCompositionV1 } from '../../../shared/model-message-composition';
import type { ModelMessageMediaInput } from '../../services/model-message-normalizer';
import { submitModelTurn } from '../../services/submit-model-turn';
import { projectUserTurnCompositions } from '../../services/user-turn-composition-history';

type ChatSendRouteBody = {
  sessionKey: string;
  message: string;
  sourceText?: string;
  deliver?: boolean;
  idempotencyKey: string;
  systemPromptAppend?: string;
  engineType?: AgentEngineType;
  media?: ModelMessageMediaInput[];
  composition?: ModelMessageCompositionV1;
  runtimePolicy?: ChatRuntimePolicy;
  permissionProfile?: EnginePermissionProfile;
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
};

export async function handleGatewayRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  const parseEngineType = (value: string | null | undefined): AgentEngineType | undefined => (
    value === 'claude' || value === 'openclaw' || value === 'pi' ? value : undefined
  );
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
      sendJson(res, 200, { success: true, sessions: sanitizeMemoryFromChatPayload(sessions) });
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
      const projected = await projectUserTurnCompositions(
        sessionKey,
        result.result ?? { messages: [] },
        adapter.type,
      );
      sendJson(res, 200, sanitizeMemoryFromChatPayload({ ...result, result: projected }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/chat/send' && req.method === 'POST') {
    try {
      const rawBody = await parseJsonBody<ChatSendRouteBody>(req);
      const body = await preprocessChatSendParams(rawBody) as ChatSendRouteBody;
      console.info('[chat-flow]', 'main.send.received', {
        sessionKey: body.sessionKey,
        engineType: body.engineType ?? null,
        mediaCount: body.media?.length ?? 0,
        messageLength: body.message?.length ?? 0,
        idempotencyKey: body.idempotencyKey,
      });
      const result = await submitModelTurn(ctx.gatewayManager, {
        ...body,
        dingTalkMentions: rawBody.dingTalkMentions,
      });
      console.info('[chat-flow]', 'main.send.result', {
        sessionKey: body.sessionKey,
        success: result.success,
        runId: result.result?.runId ?? null,
        error: result.error ?? null,
      });
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
      const runtimeSupervisor = getChatRuntimeSupervisor(ctx.gatewayManager);
      const adapter = await getAdapterForSession(body.sessionKey, parseEngineType(body.engineType));
      await runtimeSupervisor.aborting(body.sessionKey);
      let result;
      try {
        result = await adapter.abortRun(
          { gatewayManager: ctx.gatewayManager },
          { sessionKey: body.sessionKey },
        );
      } catch (error) {
        await runtimeSupervisor.abortFailed(body.sessionKey, String(error));
        throw error;
      }
      if (!result.success) {
        await runtimeSupervisor.abortFailed(body.sessionKey, result.error || 'chat.abort failed');
        sendJson(res, 500, result);
        return true;
      }
      await getMemoryTurnCoordinator(ctx.gatewayManager).aborted(body.sessionKey, null);
      await runtimeSupervisor.aborted(body.sessionKey, null);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
