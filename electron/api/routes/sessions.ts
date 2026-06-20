import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'node:path';
import { getOpenClawConfigDir } from '../../utils/paths';
import { deleteClaudeSessionByKey } from '../../engines/claude-adapter';
import { applyClaudeSessionModelSwitch } from '../../engines/claude-session-model';
import { deleteEngineSessionRegistryEntry, getEngineSessionRegistryEntry, upsertEngineSessionRegistryEntry } from '../../engines/session-registry';
import { getAgentIdFromSessionKey, rememberSessionEngineType, resolveSessionEngineType } from '../../engines/session-engine';
import { getAgentPreferredModel, getAgentWorkspacePath } from '../../utils/agent-config';
import {
  qualifyChatModelRef,
  setSessionModelViaGateway,
} from '../../utils/openclaw-model';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { deleteClaudeScheduledTaskSummarySession } from '../../services/claude-scheduled-task-session-store';

export async function handleSessionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  // POST /api/sessions/model — session-scoped model override (does not change agent default)
  if (url.pathname === '/api/sessions/model' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        sessionKey: string;
        model: string;
        accountId?: string;
        agentId?: string;
        engineType?: 'openclaw' | 'claude';
      }>(req);
      const sessionKey = (body.sessionKey ?? '').trim();
      const rawModel = (body.model ?? '').trim();
      if (!sessionKey || !sessionKey.startsWith('agent:')) {
        sendJson(res, 400, { success: false, error: 'Invalid sessionKey' });
        return true;
      }
      if (!rawModel) {
        sendJson(res, 400, { success: false, error: 'model is required' });
        return true;
      }
      // Route strictly by explicit engineType when provided. Claude and OpenClaw use
      // different backends (registry vs Gateway sessions.patch); registry inference alone
      // can mis-route OpenClaw requests after Claude in-session model switches.
      const requestedEngine = body.engineType === 'claude' || body.engineType === 'openclaw'
        ? body.engineType
        : undefined;
      const sessionEngineType = requestedEngine
        ?? await resolveSessionEngineType(sessionKey);
      await rememberSessionEngineType(sessionKey, sessionEngineType);
      if (sessionEngineType === 'claude') {
        const agentId = body.agentId?.trim() || getAgentIdFromSessionKey(sessionKey);
        const existing = await getEngineSessionRegistryEntry(sessionKey);
        const preferredModel = await getAgentPreferredModel(agentId);
        const cwd = existing?.cwd || await getAgentWorkspacePath(agentId);
        if (!cwd) {
          sendJson(res, 404, { success: false, error: `Agent '${agentId}' workspace not found` });
          return true;
        }
        const accountId = body.accountId?.trim() || existing?.accountId || preferredModel.accountId;
        const { model, modelChanged } = await applyClaudeSessionModelSwitch({
          sessionKey,
          agentId,
          cwd,
          rawModel,
          accountId,
          title: existing?.title,
        });
        sendJson(res, 200, {
          success: true,
          sessionKey,
          model,
          modelOverride: model,
          changedModel: modelChanged,
        });
        return true;
      }

      const qualifiedModel = await qualifyChatModelRef(rawModel, body.accountId);
      const result = await setSessionModelViaGateway(ctx.gatewayManager, {
        sessionKey,
        model: qualifiedModel,
        agentId: body.agentId?.trim() || undefined,
      });

      if (!result.ok) {
        sendJson(res, 503, { success: false, error: result.error ?? 'Failed to set session model' });
        return true;
      }

      sendJson(res, 200, {
        success: true,
        sessionKey,
        model: result.model ?? qualifiedModel,
        modelOverride: result.modelOverride,
        changedModel: result.changedModel,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/sessions/delete' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ sessionKey: string; engineType?: 'openclaw' | 'claude' }>(req);
      const sessionKey = body.sessionKey;
      if (!sessionKey) {
        sendJson(res, 400, { success: false, error: `Invalid sessionKey: ${sessionKey}` });
        return true;
      }
      const sessionEngineType = await resolveSessionEngineType(sessionKey, body.engineType);
      if (sessionEngineType === 'claude') {
        if (sessionKey.startsWith('claude-task:')) {
          await deleteClaudeScheduledTaskSummarySession(sessionKey);
        } else {
          await deleteClaudeSessionByKey(sessionKey);
        }
        sendJson(res, 200, { success: true });
        return true;
      }
      if (!sessionKey.startsWith('agent:')) {
        sendJson(res, 400, { success: false, error: `Invalid sessionKey: ${sessionKey}` });
        return true;
      }
      const parts = sessionKey.split(':');
      if (parts.length < 3) {
        sendJson(res, 400, { success: false, error: `sessionKey has too few parts: ${sessionKey}` });
        return true;
      }
      const agentId = parts[1];
      const sessionsDir = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
      const sessionsJsonPath = join(sessionsDir, 'sessions.json');
      const fsP = await import('node:fs/promises');
      const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
      const sessionsJson = JSON.parse(raw) as Record<string, unknown>;

      let uuidFileName: string | undefined;
      let resolvedSrcPath: string | undefined;
      if (Array.isArray(sessionsJson.sessions)) {
        const entry = (sessionsJson.sessions as Array<Record<string, unknown>>)
          .find((s) => s.key === sessionKey || s.sessionKey === sessionKey);
        if (entry) {
          uuidFileName = (entry.file ?? entry.fileName ?? entry.path) as string | undefined;
          if (!uuidFileName && typeof entry.id === 'string') {
            uuidFileName = `${entry.id}.jsonl`;
          }
        }
      }
      if (!uuidFileName && sessionsJson[sessionKey] != null) {
        const val = sessionsJson[sessionKey];
        if (typeof val === 'string') {
          uuidFileName = val;
        } else if (typeof val === 'object' && val !== null) {
          const entry = val as Record<string, unknown>;
          const absFile = (entry.sessionFile ?? entry.file ?? entry.fileName ?? entry.path) as string | undefined;
          if (absFile) {
            if (absFile.startsWith('/') || absFile.match(/^[A-Za-z]:\\/)) {
              resolvedSrcPath = absFile;
            } else {
              uuidFileName = absFile;
            }
          } else {
            const uuidVal = (entry.id ?? entry.sessionId) as string | undefined;
            if (uuidVal) uuidFileName = uuidVal.endsWith('.jsonl') ? uuidVal : `${uuidVal}.jsonl`;
          }
        }
      }
      if (!uuidFileName && !resolvedSrcPath) {
        sendJson(res, 404, { success: false, error: `Cannot resolve file for session: ${sessionKey}` });
        return true;
      }
      if (!resolvedSrcPath) {
        if (!uuidFileName!.endsWith('.jsonl')) uuidFileName = `${uuidFileName}.jsonl`;
        resolvedSrcPath = join(sessionsDir, uuidFileName!);
      }
      const dstPath = resolvedSrcPath.replace(/\.jsonl$/, '.deleted.jsonl');
      try {
        await fsP.access(resolvedSrcPath);
        await fsP.rename(resolvedSrcPath, dstPath);
      } catch {
        // Non-fatal; still try to update sessions.json.
      }
      const raw2 = await fsP.readFile(sessionsJsonPath, 'utf8');
      const json2 = JSON.parse(raw2) as Record<string, unknown>;
      if (Array.isArray(json2.sessions)) {
        json2.sessions = (json2.sessions as Array<Record<string, unknown>>)
          .filter((s) => s.key !== sessionKey && s.sessionKey !== sessionKey);
      } else if (json2[sessionKey]) {
        delete json2[sessionKey];
      }
      await fsP.writeFile(sessionsJsonPath, JSON.stringify(json2, null, 2), 'utf8');
      await deleteEngineSessionRegistryEntry(sessionKey).catch(() => {});
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
