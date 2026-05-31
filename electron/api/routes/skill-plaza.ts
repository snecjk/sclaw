import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

export async function handleSkillPlazaRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  // GET /api/skill-plaza/categories
  if (url.pathname === '/api/skill-plaza/categories' && req.method === 'GET') {
    try {
      const categories = await ctx.skillPlazaService.getCategories();
      sendJson(res, 200, { success: true, data: { categories } });
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        error: String(error),
        code: 'CATEGORIES_LOAD_FAILED',
      });
    }
    return true;
  }

  // GET /api/skill-plaza/list
  if (url.pathname === '/api/skill-plaza/list' && req.method === 'GET') {
    try {
      const params = {
        q: url.searchParams.get('q') || undefined,
        category: url.searchParams.get('category') || undefined,
        source: (url.searchParams.get('source') as 'official' | 'mine') || undefined,
        sort: (url.searchParams.get('sort') as 'hot' | 'recent') || undefined,
        page: url.searchParams.has('page') ? Number(url.searchParams.get('page')) : undefined,
        pageSize: url.searchParams.has('pageSize') ? Number(url.searchParams.get('pageSize')) : undefined,
      };
      const data = await ctx.skillPlazaService.getPlazaSkills(params);
      sendJson(res, 200, { success: true, data });
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        error: String(error),
        code: 'PLAZA_LIST_FAILED',
      });
    }
    return true;
  }

  // GET /api/skill-plaza/mine
  if (url.pathname === '/api/skill-plaza/mine' && req.method === 'GET') {
    try {
      const params = {
        q: url.searchParams.get('q') || undefined,
        category: url.searchParams.get('category') || undefined,
        sort: (url.searchParams.get('sort') as 'hot' | 'recent') || undefined,
        page: url.searchParams.has('page') ? Number(url.searchParams.get('page')) : undefined,
        pageSize: url.searchParams.has('pageSize') ? Number(url.searchParams.get('pageSize')) : undefined,
      };
      const data = await ctx.skillPlazaService.getMySkills(params);
      sendJson(res, 200, { success: true, data });
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        error: String(error),
        code: 'MINE_LIST_FAILED',
      });
    }
    return true;
  }

  // GET /api/skill-plaza/skill/:slug
  if (url.pathname.startsWith('/api/skill-plaza/skill/') && req.method === 'GET') {
    try {
      const slug = url.pathname.replace('/api/skill-plaza/skill/', '');
      if (!slug) {
        sendJson(res, 400, { success: false, error: 'Missing slug', code: 'SKILL_NOT_FOUND' });
        return true;
      }
      const skill = await ctx.skillPlazaService.getSkillDetail(slug);
      sendJson(res, 200, { success: true, data: { skill } });
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        error: String(error),
        code: 'DETAIL_LOAD_FAILED',
      });
    }
    return true;
  }

  // POST /api/skill-plaza/install
  if (url.pathname === '/api/skill-plaza/install' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string }>(req);
      const slug = body.slug;
      if (!slug) {
        sendJson(res, 400, { success: false, error: 'Missing slug', code: 'SKILL_NOT_FOUND' });
        return true;
      }
      await ctx.stoSkillService.install({ slug });
      sendJson(res, 200, { success: true });
    } catch (error) {
      const message = String(error);
      const code = message.includes('already installed')
        ? 'INSTALL_ALREADY_INSTALLED'
        : 'INSTALL_FAILED';
      sendJson(res, 500, { success: false, error: message, code });
    }
    return true;
  }

  // POST /api/skill-plaza/uninstall
  if (url.pathname === '/api/skill-plaza/uninstall' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string }>(req);
      const slug = body.slug;
      if (!slug) {
        sendJson(res, 400, { success: false, error: 'Missing slug', code: 'SKILL_NOT_FOUND' });
        return true;
      }
      await ctx.stoSkillService.uninstall({ slug });
      sendJson(res, 200, { success: true });
    } catch (error) {
      const message = String(error);
      const code = message.includes('not installed')
        ? 'UNINSTALL_NOT_INSTALLED'
        : 'UNINSTALL_FAILED';
      sendJson(res, 500, { success: false, error: message, code });
    }
    return true;
  }

  // POST /api/skill-plaza/use
  if (url.pathname === '/api/skill-plaza/use' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string }>(req);
      const slug = body.slug;
      if (!slug) {
        sendJson(res, 400, { success: false, error: 'Missing slug', code: 'SKILL_NOT_FOUND' });
        return true;
      }
      await ctx.skillPlazaService.recordUse(slug);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        error: String(error),
        code: 'USE_LOG_FAILED',
      });
    }
    return true;
  }

  return false;
}
