import type { IncomingMessage, ServerResponse } from 'http';
import { getAllSkillConfigs, updateSkillConfig } from '../../utils/skill-config';
import {
  saveUserSkill,
  SaveUserSkillError,
  type SaveUserSkillInput,
} from '../../services/skills/create-user-skill';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  recordRuntimeSkillRead,
  searchRuntimeSkills,
  SkillRuntimeError,
} from '../../services/skills/skill-runtime-service';

function statusForSkillRuntimeError(code: SkillRuntimeError['code']): number {
  switch (code) {
    case 'INVALID_REQUEST':
      return 400;
    case 'SKILL_NOT_FOUND':
    case 'RESOURCE_NOT_FOUND':
      return 404;
    default:
      return 500;
  }
}

function statusForSaveUserSkillError(code: SaveUserSkillError['code']): number {
  switch (code) {
    case 'NOT_LOGGED_IN':
      return 401;
    case 'INVALID_SLUG':
    case 'INVALID_SKILL_MD':
      return 400;
    case 'PREINSTALL_PROTECTED':
      return 403;
    case 'ALREADY_EXISTS':
      return 409;
    default:
      return 500;
  }
}

export async function handleSkillRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/skills/runtime/search' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Parameters<typeof searchRuntimeSkills>[0]>(req);
      sendJson(res, 200, { success: true, data: await searchRuntimeSkills(body) });
    } catch (error) {
      sendJson(res, error instanceof SkillRuntimeError ? statusForSkillRuntimeError(error.code) : 500, {
        success: false,
        code: error instanceof SkillRuntimeError ? error.code : 'SKILL_SEARCH_FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (url.pathname === '/api/skills/runtime/read' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Parameters<typeof recordRuntimeSkillRead>[0]>(req);
      sendJson(res, 200, { success: true, data: await recordRuntimeSkillRead(body) });
    } catch (error) {
      sendJson(res, error instanceof SkillRuntimeError ? statusForSkillRuntimeError(error.code) : 500, {
        success: false,
        code: error instanceof SkillRuntimeError ? error.code : 'SKILL_READ_RECORD_FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (url.pathname === '/api/skills/save-user' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<SaveUserSkillInput>(req);
      const data = await saveUserSkill(body);
      sendJson(res, 200, { success: true, data });
    } catch (error) {
      if (error instanceof SaveUserSkillError) {
        sendJson(res, statusForSaveUserSkillError(error.code), {
          success: false,
          code: error.code,
          error: error.message,
        });
      } else {
        sendJson(res, 500, {
          success: false,
          code: 'WRITE_FAILED',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return true;
  }

  if (url.pathname === '/api/skills/import-orphans' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ reason?: string }>(req);
      const { scheduleOrphanSkillImport } = await import('../../services/skills/orphan-skill-import');
      scheduleOrphanSkillImport(body.reason || 'host-api');
      sendJson(res, 200, { success: true, scheduled: true });
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (url.pathname === '/api/skills/configs' && req.method === 'GET') {
    sendJson(res, 200, await getAllSkillConfigs());
    return true;
  }

  if (url.pathname === '/api/skills/config' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{
        skillKey: string;
        apiKey?: string;
        env?: Record<string, string>;
      }>(req);
      sendJson(res, 200, await updateSkillConfig(body.skillKey, {
        apiKey: body.apiKey,
        env: body.env,
      }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/search' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      sendJson(res, 200, {
        success: true,
        results: await ctx.clawHubService.search(body),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/install' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      await ctx.clawHubService.install(body);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/uninstall' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      await ctx.clawHubService.uninstall(body);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/list' && req.method === 'GET') {
    try {
      sendJson(res, 200, { success: true, results: await ctx.clawHubService.listInstalled() });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-readme' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillReadme(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-path' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillPath(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // ======================== STO Skill Plaza routes ========================

  if (url.pathname === '/api/sto-skills/list' && req.method === 'GET') {
    try {
      sendJson(res, 200, { success: true, results: ctx.stoSkillService.listInstalled() });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/sto-skills/search' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      sendJson(res, 200, {
        success: true,
        results: await ctx.stoSkillService.search(body),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/sto-skills/install' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      await ctx.stoSkillService.install(body);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/sto-skills/uninstall' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<Record<string, unknown>>(req);
      await ctx.stoSkillService.uninstall(body);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
